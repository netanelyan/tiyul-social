import { getBrowser } from '../src/render/index.js';
import { RENDERERS, geometryFor } from '../src/render/postSlides.js';
import { renderSlideHtml, coverTitle, SIZES } from '../src/render/deckTemplates.js';
import { renderHtml as renderCardHtml } from '../src/render/templates.js';

// WHAT A SCREENSHOT LOOKS LIKE, CHECKED BY MEASURING IT RATHER THAN BY LOOKING.
//
// Every defect this catches was first found by eye, in a rendered JPEG, after it had
// shipped. The owner's list, verbatim: "check for an emoji in a newline, check for
// missing text, check for any inconcsistencies in the design. bad text visibility."
//
// Each of those is a property of the laid-out page, not of the template source, which is
// why none of them is catchable by reading the HTML and all of them are catchable by
// asking the browser where things ended up. So this opens the same Chromium the renderer
// uses, lays out every look with awkward content, and interrogates the DOM:
//
//   AN EMOJI ON A LINE OF ITS OWN. The Vienna Opera slide put Austria's flag alone
//   between the name and the note. The cause was structural - `-webkit-box` lays out
//   every child on its own line, so an <img> sibling of a text node is always a separate
//   line - and it was invisible in the markup, which reads as "name then flag". Here it
//   is caught by comparing the emoji's box with the text box beside it: if no text shares
//   its vertical band, the emoji is stranded.
//
//   TEXT THAT DID NOT RENDER. An element with a width and no visible glyphs, or one
//   clipped to zero height by a line clamp. A slide that silently drops its note is
//   worse than one that fails, because it publishes.
//
//   TEXT OUTSIDE THE FRAME. Overflow is invisible in a JPEG - it is simply not there -
//   so a line pushed past the bottom edge by one word too many looks like a design
//   choice rather than a bug.
//
//   TYPE TOO SMALL TO READ ON A PHONE. A 1080px-wide frame viewed at about 390 CSS
//   pixels means anything under roughly 30px renders at under 11pt in the hand.
//
// It is a script rather than a test because it renders real content and takes a minute;
// the selftest asserts the INVARIANTS these findings produced, which is the cheap half.

// TikTok's own furniture, and ONLY TikTok's. Instagram's topSafe/bottomSafe in
// deckTemplates are composition margins rather than furniture - the feed draws almost
// nothing over the image - so a card's brand mark sitting above them is a design choice,
// not a line nobody can read.
const FRAME = { w: 1080, h: 1920, topSafe: 300, bottomSafe: 400 };

/** Content chosen to be awkward: long names, flags, numbers, mixed scripts. */
const CASES = [];

// Every post look, with the content that has broken each of them before.
const photo = { src: dataPhoto('#6c7a89') };
const bright = { src: dataPhoto('#f2efe6') };

CASES.push(
  {
    name: 'label / cover with a badge and a flag',
    html: () =>
      RENDERERS.label(
        {
          look: 'label',
          cover: true,
          titleHe: 'תפסיקו לטוס רק לברצלונה כשיש את ספרד כולה 🇪🇸',
          noteHe: '4 יעדים, כולם עם מסלול מלא באתר',
          badgeHe: '4.6/5',
          badgeEmoji: '⭐',
          band: 'mid',
          image: bright,
          legible: { treatment: 'band', alpha: 0.78, ratio: 7.2, measured: true },
        },
        { size: 'tiktok' }
      ),
  },
  {
    name: 'label / numbered place, long name',
    html: () =>
      RENDERERS.label(
        {
          look: 'label',
          number: '12.',
          titleHe: 'כיכר העיר העתיקה והשעון האסטרונומי',
          noteHe: '⭐ כניסה חופשית · כשעה',
          band: 'lower',
          image: photo,
          legible: { treatment: 'veil', alpha: 0.44, ratio: 7.1, measured: true },
        },
        { size: 'tiktok' }
      ),
  },
  {
    name: 'sheet / three quoted lines',
    html: () =>
      RENDERERS.sheet(
        {
          look: 'sheet',
          titleHe: 'מדריד',
          emojis: ['🇪🇸'],
          lines: [
            { text: 'טיסה ישירה קצרה' },
            { text: 'טיסות ישירות מנתב״ג למדריד (MAD), כחמש שעות' },
            { text: 'מוזיאון פראדו - כשלוש שעות' },
          ],
          image: photo,
        },
        { size: 'tiktok' }
      ),
  },
  {
    name: 'roll / serif cover',
    html: () =>
      RENDERERS.roll(
        {
          look: 'roll',
          cover: true,
          titleHe: 'ככה נראים 5 ימים בפראג',
          noteHe: '12 תמונות',
          badgeHe: '4.7/5',
          badgeEmoji: '⭐',
          image: bright,
          legible: { treatment: 'band', alpha: 0.72, ratio: 7.1, measured: true },
        },
        { size: 'tiktok' }
      ),
  },
  {
    name: 'notes / checklist',
    html: () =>
      RENDERERS.notes(
        {
          look: 'notes',
          titleHe: 'יום 2 · העיר העתיקה',
          rows: [{ text: 'גשר קרל' }, { text: 'הרובע היהודי (יוזפוב)' }, { text: 'כיכר העיר העתיקה' }],
          bgImage: photo,
          legible: { treatment: 'veil', alpha: 0.5, ratio: 7.0, measured: true },
        },
        { size: 'tiktok' }
      ),
  }
);

// Both deck styles at a RANGE OF NAME LENGTHS, because the flag stranded at exactly one
// of them. "האופרה הממלכתית" measures 421px in a 475px block and the flag is 53px, so
// the pair overflows by a pixel; a shorter name fits and a longer one steps down a size
// and also fits. Checking one length would have passed while the bug was live, which is
// how it reached a rendered deck twice.
const DECK_NAMES = [
  'ארמון שנברון',
  'האופרה הממלכתית',
  'בית העירייה וכיכר הרטהאוס',
  'מוזיאון ההיסטוריה של האמנות בווינה',
];
for (const style of ['minimal', 'info']) {
  for (const nameHe of DECK_NAMES) {
    CASES.push({
      name: `deck / ${style} / ${nameHe}`,
      size: SIZES.tiktok,
      html: () =>
        renderSlideHtml(
          { nameHe, countryHe: 'אוסטריה', flag: '🇦🇹', bullets: [{ text: 'מבתי האופרה המפורסמים' }], fields: [{ emoji: '📍', value: 'וינה' }], image: photo },
          { size: 'tiktok', style, spot: { x: 0.3, y: 0.7, width: 0.44, onDark: true, contrast: 3.6, assist: 0.6 } }
        ),
    });
  }
}

CASES.push({
  name: 'deck / emphasised cover title',
  size: SIZES.tiktok,
  html: () =>
    renderSlideHtml(
      { titleHe: 'המוזיאונים במרכז אירופה שלא נראים כמו מוזיאונים', emphasisHe: 'לא נראים', image: photo },
      { size: 'tiktok', cover: true, style: 'minimal', spot: { x: 0.3, y: 0.3, width: 0.44, onDark: true, contrast: 4, assist: 0.4 } }
    ),
});

CASES.push({
  name: 'card / numbers layout',
  size: SIZES.instagram,
  html: () =>
    renderCardHtml(
      {
        layout: 'numbers',
        pillar: 'fact',
        place: 'וינה',
        country: 'אוסטריה',
        headline: 'כרטיס יומי לתחבורה בוינה עולה 8 יורו',
        subhead: 'תקף לרכבת התחתית, לחשמליות ולאוטובוסים עד חצות.',
        url: 'https://www.wien.info/en',
        bullets: [{ text: 'כרטיס בודד: 2.40 יורו' }, { text: 'כרטיס 72 שעות: 17.10 יורו' }],
      },
      { image: photo }
    ),
});

/** A flat colour as a data URI, so no network and no fixture file. */
function dataPhoto(hex) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='1080' height='1920'><rect width='1080' height='1920' fill='${hex}'/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

const findings = [];
const note = (slide, kind, detail) => findings.push({ slide, kind, detail });

const browser = await getBrowser();

for (const c of CASES) {
  // Instagram's topSafe/bottomSafe are composition margins rather than platform
  // furniture - the feed draws almost nothing over the image - so the furniture check is
  // zeroed there. A card's brand mark above them is a design choice, not a covered line.
  const base = c.size || FRAME;
  const size = base === SIZES.instagram ? { ...base, topSafe: 0, bottomSafe: 0 } : base;
  const context = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1, locale: 'he-IL' });
  const page = await context.newPage();
  try {
    let html;
    try {
      html = await c.html();
    } catch (e) {
      note(c.name, 'build', `the look threw: ${e.message.slice(0, 90)}`);
      continue;
    }
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);

    const report = await page.evaluate((frame) => {
      const out = { stranded: [], empty: [], overflow: [], tiny: [], clipped: [], unsafe: [] };
      const vis = (el) => {
        const s = getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.05;
      };

      // AN EMOJI WITH NO TEXT BESIDE IT. The emoji's vertical band is compared against
      // every text-bearing box on the slide; if nothing shares it, the emoji is on a
      // line of its own.
      for (const img of document.querySelectorAll('img.emoji')) {
        if (!vis(img)) continue;
        const r = img.getBoundingClientRect();
        if (!r.width) continue;
        // Emoji deliberately alone: a row of them, or a badge, is not a stranded flag.
        const row = img.closest('.emoji-row, .badge, .thumb, .pin, .o');
        if (row) continue;

        let beside = false;
        const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
          if (!n.textContent.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          for (const tr of range.getClientRects()) {
            if (!tr.width || !tr.height) continue;
            const overlap = Math.min(tr.bottom, r.bottom) - Math.max(tr.top, r.top);
            if (overlap > r.height * 0.4) beside = true;
          }
          if (beside) break;
        }
        if (!beside) out.stranded.push({ alt: img.alt, top: Math.round(r.top), left: Math.round(r.left) });
      }

      // TEXT THAT IS THERE IN THE DOM AND NOT ON THE SCREEN.
      for (const el of document.querySelectorAll('div, span, p, li')) {
        if (!vis(el)) continue;
        // The font probe is one invisible character parked off-frame on purpose: it is
        // what makes the Heebo @font-face declaration honest so renderToJpeg's
        // "did the font load" guard answers the question it was written for. See PROBE
        // in render/postSlides.js. It is off-frame by design, not by accident.
        if (el.classList.contains('font-probe')) continue;
        const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('');
        if (!own) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) {
          out.empty.push({ text: own.slice(0, 40), cls: el.className });
          continue;
        }
        if (r.bottom > frame.h + 2 || r.top < -2 || r.right > frame.w + 2 || r.left < -2) {
          out.overflow.push({ text: own.slice(0, 40), cls: el.className, box: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)] });
        }
        if (el.scrollHeight > el.clientHeight + 4 && getComputedStyle(el).overflow === 'hidden') {
          out.clipped.push({ text: own.slice(0, 40), cls: el.className, lost: el.scrollHeight - el.clientHeight });
        }
        // INSIDE THE PLATFORM'S OWN FURNITURE.
        //
        // TikTok draws its search bar and slide counter across the top of the frame and
        // the caption, handle and button rail across the bottom. Text under either is
        // text nobody reads - it is not clipped, it is covered, which is worse because
        // the render looks fine. The deck has respected these numbers since it was
        // written; the post looks were given them by geometryFor and never used them.
        if (frame.topSafe && r.top < frame.topSafe) {
          out.unsafe.push({ text: own.slice(0, 32), edge: 'top', at: Math.round(r.top), safe: frame.topSafe });
        }
        if (frame.bottomSafe && r.bottom > frame.h - frame.bottomSafe) {
          out.unsafe.push({ text: own.slice(0, 32), edge: 'bottom', at: Math.round(r.bottom), safe: frame.h - frame.bottomSafe });
        }

        const px = parseFloat(getComputedStyle(el).fontSize);
        // 1080px of frame shown across about 390 CSS px on a phone: a 30px glyph lands
        // at roughly 11pt in the hand, which is the floor for a caption read at a glance.
        if (px && px < 28) out.tiny.push({ text: own.slice(0, 30), px: Math.round(px) });
      }
      return out;
    }, size);

    for (const s of report.stranded) note(c.name, 'emoji on its own line', `${s.alt} at y=${s.top}`);
    for (const e of report.empty) note(c.name, 'text with no box', `"${e.text}" (.${e.cls})`);
    for (const o of report.overflow) note(c.name, 'text outside the frame', `"${o.text}" box=${o.box.join(',')}`);
    for (const k of report.clipped) note(c.name, 'text clipped away', `"${k.text}" lost ${k.lost}px`);
    for (const t of report.tiny) note(c.name, 'type under 28px', `"${t.text}" at ${t.px}px`);
    for (const u of report.unsafe) note(c.name, `text under TikTok's ${u.edge} furniture`, `"${u.text}" reaches ${u.at}, safe is ${u.safe}`);
  } finally {
    await context.close().catch(() => {});
  }
}

console.log(`\nslide-lint: ${CASES.length} layouts checked\n`);
if (!findings.length) {
  console.log('  no findings');
} else {
  const byKind = {};
  for (const f of findings) (byKind[f.kind] ||= []).push(f);
  for (const [kind, list] of Object.entries(byKind)) {
    console.log(`  ${kind} (${list.length})`);
    for (const f of list) console.log(`     ${f.slide}: ${f.detail}`);
  }
}
process.exitCode = findings.some((f) => f.kind !== 'type under 28px') ? 1 : 0;
