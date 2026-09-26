import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { renderHtml, CARD_W, CARD_H } from './templates.js';
import { publicUrlFor } from '../publish/imageHosts.js';

// Card rendering: HTML -> JPEG, via headless Chromium.
//
// Chromium is doing the one job nothing else here can do — real bidi text
// layout for Hebrew. Hand-rolling that with a canvas library is how you end up
// with reversed strings and mis-shaped final letters, so the browser does it.
//
// JPEG, not PNG, because Instagram's Content Publishing API only accepts JPEG
// for image posts. Telegram takes either, so one format covers both.

let browserPromise = null;
let idleTimer = null;

// How long a launched Chromium is kept warm after the last render.
//
// The cards for a run come in a burst a few seconds apart, then nothing happens
// for a day. Keeping the browser for the burst avoids paying the ~1.5s launch
// per card; keeping it for the other 23 hours just holds ~200MB resident on a
// VPS that is also running BrickDeal. Five minutes covers a run, including a
// re-render from an edit, with room to spare.
const IDLE_SHUTDOWN_MS = Number(process.env.RENDER_IDLE_MS ?? 5 * 60_000);

// Shared rather than private because the photo measuring in ./photo.js runs in
// the same Chromium: it decodes each slide's image to a canvas and reads the
// pixels back, which is a page and a browser, and launching a second one to do
// it would double the resident memory for no gain.
export function getBrowser() {
  // Chromium takes a second or two to start; a handful of cards a day would
  // otherwise pay that every time. Launched lazily so `npm start` doesn't need it.
  browserPromise ??= chromium.launch({ args: ['--font-render-hinting=none'] });
  return browserPromise;
}

function scheduleIdleShutdown() {
  if (idleTimer) clearTimeout(idleTimer);
  if (!(IDLE_SHUTDOWN_MS > 0)) return;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    closeBrowser().catch(() => {});
  }, IDLE_SHUTDOWN_MS);
  // Do not let a warm browser be the reason the process cannot exit — scripts
  // like render-samples finish and should just end.
  idleTimer.unref?.();
}

export async function closeBrowser() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (!browserPromise) return;
  const b = await browserPromise.catch(() => null);
  browserPromise = null;
  await b?.close().catch(() => {});
}

/**
 * A candidate id is not automatically a safe filename.
 *
 * Most ids are hex digests, but a source may supply its own `dedupeId` — the
 * climate adapter uses `climate:dubai:2025`, which is meaningful and readable
 * and completely illegal as a Windows filename. That cost two paid drafting
 * calls per run before it was caught, because the render is the *last* step:
 * the money is spent by the time the write fails.
 *
 * Linux would have accepted the colon and hidden the problem, then handed
 * Instagram a URL containing `%3A` to fetch. Restricting the stem to characters
 * that are unambiguous in both a path and a URL settles both cases at once.
 */
export function safeStem(id) {
  const clean = String(id)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 100);
  return clean || 'card';
}

export const cardOutputDir = () =>
  process.env.CARD_OUTPUT_DIR || path.join(process.cwd(), 'out', 'cards');

/**
 * How far the fit pass may shrink a line that does not fit its clamp.
 *
 * 0.62 of the size it was set at, which is one step below the smallest the
 * character-count ladder can choose on its own (`xlong` is 0.76). That is a
 * deliberate ordering: the ladder still decides the look of a normal cover, and
 * this only goes past it for the lines the ladder got wrong.
 *
 * A floor rather than no limit, because a title small enough to always fit is a
 * title nobody reads on a phone. Overridable for the lab.
 */
const FIT_FLOOR_SCALE = Math.min(1, Math.max(0.3, Number(process.env.RENDER_FIT_FLOOR || '0.62')));

/**
 * Public HTTPS URL for a rendered card.
 *
 * Instagram's `POST /{ig-user-id}/media` takes an `image_url` that *Instagram's
 * own servers fetch* — the bytes never travel through our request. So a card
 * that only exists on local disk cannot be published, and this returning null
 * is exactly why publishInstagram() refuses rather than failing halfway.
 */
export function cardPublicUrl(filename) {
  // The host list, not the single variable — see src/publish/imageHosts.js.
  // The first entry is the one cards are published under; the rest exist so a
  // second domain can be verified with TikTok and swapped to without a code
  // change.
  //
  // The address-building itself lives in imageHosts.js now, because a clip's
  // mp4 needs the same URL from a path that never touched this renderer.
  return publicUrlFor(filename);
}

/**
 * Render a draft to a JPEG on disk.
 *
 * Returns { file, filename, url, bytes }. `url` is null until
 * CARD_PUBLIC_BASE_URL is set — Telegram publishing works without it.
 */
export async function renderCard(draft, { id, data = null, image = null, outDir = cardOutputDir() } = {}) {
  // Measured before the card is built, because the scrim is part of the
  // stylesheet rather than something that can be adjusted afterwards.
  //
  // Only for the photo layouts: the text-led cards are a flat dark ground by
  // design and have no photograph to measure. Failure is silent and falls back
  // to the old constants — a scrim sized for the worst photograph is what the
  // card had before this existed, and it is not worth losing a card over.
  //
  // Imported here rather than at the top of the file because ./photo.js imports
  // getBrowser from this module: a static import back would close the cycle,
  // and the measuring module is the one that should depend on the renderer
  // rather than the other way round. The module is cached after the first card.
  let shot = image;
  if (image?.src) {
    const scrim = await import('./photo.js')
      .then((m) => m.measureCardScrims([image.src]))
      .then(([s]) => s)
      .catch(() => null);
    if (scrim?.bottom != null) shot = { ...image, scrim };
  }

  return renderToJpeg(renderHtml(draft, { data, image: shot }), {
    stem: id,
    width: CARD_W,
    height: CARD_H,
    outDir,
  });
}

/**
 * Any HTML, at any size, to a JPEG on disk.
 *
 * Extracted from renderCard when slideshows arrived at 1080x1920 and the same
 * deck had to be re-rendered at 1080x1350 for Instagram. The font guard below
 * is the reason this is shared rather than copied: it is the check that stops a
 * card of tofu boxes being published, it is subtle enough to get wrong, and a
 * second renderer without it would fail silently in exactly the way the first
 * one used to.
 */
export async function renderToJpeg(html, { stem, width = CARD_W, height = CARD_H, outDir = cardOutputDir() } = {}) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    // Explicit, so a VPS with a different system locale can't change how the
    // page lays out or which fallback font Chromium reaches for.
    locale: 'he-IL',
    colorScheme: 'dark',
  });
  const page = await context.newPage();

  try {
    await page.setContent(html, { waitUntil: 'load' });

    // The failure this guards against is silent, which is what makes it worth
    // a hard check: if the bundled font hasn't parsed, Chromium falls back, and
    // for Hebrew on a bare Linux box the fallback is very often tofu boxes.
    // A card full of ▯▯▯ still screenshots perfectly happily.
    //
    // NOTE: `document.fonts.check('900 100px Heebo')` is the obvious way to
    // write this and it does NOT work — it returns true whenever the text can
    // be rendered by *something*, fallback included, so it reports success on a
    // page with no @font-face at all. Verified against a bare page before
    // replacing it. The two checks below test the thing we actually care about:
    // that our own @font-face rule loaded, and that it is what's being drawn.
    await page.evaluate(() => document.fonts.ready);
    const font = await page.evaluate(async () => {
      const face = [...document.fonts].find((f) => f.family.replace(/['"]/g, '') === 'Heebo');

      // Width comparison against a family that cannot exist. If Heebo failed,
      // both spans fall back to the same face and measure identically.
      const measure = (family) => {
        const el = document.createElement('span');
        el.textContent = 'מסלול טיול בחו״ל';
        el.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:900 100px ${family}`;
        document.body.appendChild(el);
        const w = el.getBoundingClientRect().width;
        el.remove();
        return w;
      };

      return {
        status: face?.status ?? 'missing',
        distinct: Math.abs(measure("'Heebo'") - measure("'__no_such_font__'")) > 0.5,
        // Every OTHER face the page declared, forced to resolve.
        //
        // The check above was written when Heebo carried all the Hebrew and it
        // still earns its place — it proves a font reached the page at all. But
        // the slides now set Hebrew in Assistant and the info style sets it in
        // Rubik, and a face that fails to PARSE falls through to the next
        // family silently: the render succeeds, the text is legible, and it is
        // in the wrong typeface. Four of the bundled files turned out to be
        // corrupt and had never once loaded, which is exactly that failure.
        //
        // load() is what makes this meaningful. @font-face is lazy: a declared
        // face that nothing has drawn with yet sits at "unloaded", which is not
        // an error and must not be treated as one — doing that refused every
        // render outright. Asking for it explicitly resolves the question,
        // after which "error" means the bytes are not a font.
        others: await Promise.all(
          [...document.fonts]
            .filter((f) => f.family.replace(/['"]/g, '') !== 'Heebo')
            .map(async (f) => {
              try {
                await f.load();
              } catch {
                /* status carries the answer */
              }
              return { family: f.family.replace(/['"]/g, ''), status: f.status };
            })
        ),
      };
    });

    if (font.status !== 'loaded' || !font.distinct) {
      throw new Error(
        `Heebo did not load (@font-face status: ${font.status}, distinct from fallback: ${font.distinct}) - ` +
          'refusing to render, because the Hebrew would come out as tofu boxes'
      );
    }

    const broken = font.others.filter((f) => f.status === 'error');
    if (broken.length) {
      throw new Error(
        `these faces are not valid fonts: ${broken.map((f) => f.family).join(', ')} - ` +
          'refusing to render, because the text would silently come out in a fallback typeface'
      );
    }

    // NOTHING GOES OUT WITH AN ELLIPSIS ON IT.
    //
    // Every text block on a slide is clamped to overlay.maxLines, and the clamp
    // is what puts "…" on the end of a line that did not fit. The size that line
    // was set at had been chosen by COUNTING CHARACTERS - sizeClass() in
    // deckTemplates.js, thresholds at 20/30/42 - which is a fair proxy and blind
    // to the three things that actually decide whether it fits: how wide the
    // text box is at that size, which glyphs the words happen to use, and an
    // emphasis span inside the line.
    //
    // The comment on .cover argued the truncation was a SIGNAL - "a cover that
    // needs three lines is a cover that needs rewriting". The signal is real and
    // the delivery was wrong: it arrives as a published post with its title cut,
    // which nobody can act on afterwards, and the clip writer already takes the
    // opposite view of the same character (see ELLIPSIS in video/hooks.js: a
    // line that ends in one is a line that was cut).
    //
    // So ask the only authority there is. Chromium has laid the page out; a
    // clamped block that overflows is scrollHeight > clientHeight, and the
    // answer is to set it smaller and ask again. Down to a floor, because type
    // too small to read on a phone is not an improvement on a cut line - and if
    // it still does not fit there, the line really is too long and THAT is worth
    // a word in the log.
    //
    // Only blocks that overflow are touched, so a slide that already fits comes
    // out byte-identical to before.
    const fitted = await page.evaluate((floorScale) => {
      const clamped = [...document.querySelectorAll('*')].filter(
        (el) => getComputedStyle(el).webkitLineClamp !== 'none'
      );
      // VERTICAL, BY THE LINE, AND NOT BY THE PIXEL.
      //
      // Two wrong versions of this check shipped in the same hour, and both had
      // the same tell: they shrank a fifteen-character cover that fits on one
      // line, from 55px to 34px.
      //
      //   scrollWidth > clientWidth   - a clamped block reports a scrollWidth
      //     wider than its client box whatever the text says, so everything
      //     matched. The clamp cuts by LINE; width was never the question.
      //
      //   scrollHeight - clientHeight > 1   - a single line measured 64px
      //     client against 67px scroll. The 3px is the font's ascender and
      //     descender overshooting the line box, present on text that fits
      //     perfectly, and a one-pixel tolerance calls it an overflow.
      //
      // A line that did not fit costs a whole lineHeight, so anything under a
      // third of one is the typeface breathing. Measured, not assumed: those
      // numbers are from the Helsinki cover that published correctly.
      const over = (el) => {
        const cs = getComputedStyle(el);
        const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
        return el.scrollHeight - el.clientHeight > Math.max(2, line * 0.3);
      };

      const out = [];
      for (const el of clamped) {
        if (!over(el)) continue;
        const from = parseFloat(getComputedStyle(el).fontSize);
        const floor = Math.max(12, from * floorScale);
        let px = from;
        // 2% a step: small enough that it stops at the first size that fits
        // rather than overshooting into type smaller than it needed to be.
        while (over(el) && px > floor) {
          px = Math.max(floor, px * 0.98);
          el.style.fontSize = `${px}px`;
        }
        out.push({
          text: (el.textContent || '').trim().slice(0, 48),
          from: Math.round(from),
          to: Math.round(px),
          fits: !over(el),
        });
      }
      return out;
    }, FIT_FLOOR_SCALE);

    for (const f of fitted) {
      console.log(
        f.fits
          ? `render: fitted "${f.text}" ${f.from}px -> ${f.to}px`
          : `render: "${f.text}" does not fit even at ${f.to}px - it is too long for the slide`
      );
    }

    const buf = await page.screenshot({ type: 'jpeg', quality: 92 });

    mkdirSync(outDir, { recursive: true });
    const filename = `${safeStem(stem)}.jpg`;
    const file = path.join(outDir, filename);
    // Atomic, same as the store: Instagram may fetch this URL moments after we
    // hand it over, and a half-written JPEG would be served as a broken image.
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, buf);
    renameSync(tmp, file);

    // `fitted` is empty on every slide that laid out as written, which is the
    // normal case. A non-empty one is the signal the clamp used to deliver by
    // cutting the line: this cover is longer than the format wants.
    return { file, filename, url: cardPublicUrl(filename), bytes: buf.length, fitted };
  } finally {
    await context.close().catch(() => {});
    scheduleIdleShutdown();
  }
}
