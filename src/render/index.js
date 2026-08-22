import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { renderHtml, CARD_W, CARD_H } from './templates.js';

// Card rendering: HTML -> JPEG, via headless Chromium.
//
// Chromium is doing the one job nothing else here can do — real bidi text
// layout for Hebrew. Hand-rolling that with a canvas library is how you end up
// with reversed strings and mis-shaped final letters, so the browser does it.
//
// JPEG, not PNG, because Instagram's Content Publishing API only accepts JPEG
// for image posts. Telegram takes either, so one format covers both.

let browserPromise = null;

function getBrowser() {
  // Chromium takes a second or two to start; a handful of cards a day would
  // otherwise pay that every time. Launched lazily so `npm start` doesn't need it.
  browserPromise ??= chromium.launch({ args: ['--font-render-hinting=none'] });
  return browserPromise;
}

export async function closeBrowser() {
  if (!browserPromise) return;
  const b = await browserPromise.catch(() => null);
  browserPromise = null;
  await b?.close().catch(() => {});
}

export const cardOutputDir = () =>
  process.env.CARD_OUTPUT_DIR || path.join(process.cwd(), 'out', 'cards');

/**
 * Public HTTPS URL for a rendered card.
 *
 * Instagram's `POST /{ig-user-id}/media` takes an `image_url` that *Instagram's
 * own servers fetch* — the bytes never travel through our request. So a card
 * that only exists on local disk cannot be published, and this returning null
 * is exactly why publishInstagram() refuses rather than failing halfway.
 */
export function cardPublicUrl(filename) {
  const base = process.env.CARD_PUBLIC_BASE_URL;
  if (!base) return null;
  return `${base.replace(/\/+$/, '')}/${encodeURIComponent(filename)}`;
}

/**
 * Render a draft to a JPEG on disk.
 *
 * Returns { file, filename, url, bytes }. `url` is null until
 * CARD_PUBLIC_BASE_URL is set — Telegram publishing works without it.
 */
export async function renderCard(draft, { id, data = null, image = null, outDir = cardOutputDir() } = {}) {
  const html = renderHtml(draft, { data, image });
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width: CARD_W, height: CARD_H },
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
    const font = await page.evaluate(() => {
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
      };
    });

    if (font.status !== 'loaded' || !font.distinct) {
      throw new Error(
        `Heebo did not load (@font-face status: ${font.status}, distinct from fallback: ${font.distinct}) — ` +
          'refusing to render, because the Hebrew would come out as tofu boxes'
      );
    }

    const buf = await page.screenshot({ type: 'jpeg', quality: 92 });

    mkdirSync(outDir, { recursive: true });
    const filename = `${id}.jpg`;
    const file = path.join(outDir, filename);
    // Atomic, same as the store: Instagram may fetch this URL moments after we
    // hand it over, and a half-written JPEG would be served as a broken image.
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, buf);
    renameSync(tmp, file);

    return { file, filename, url: cardPublicUrl(filename), bytes: buf.length };
  } finally {
    await context.close().catch(() => {});
  }
}
