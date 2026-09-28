import { heeboDataUri, assistantDataUri, escapeHtml } from './theme.js';
import { emojiHtml } from './emojiArt.js';
import { SIZES } from './deckTemplates.js';
import { fitPoints, scaleBar, pinMapHtml } from './map.js';

// The four looks the new post types are drawn in.
//
// WHY THESE ARE NOT MORE STYLES IN deckTemplates.js.
//
// That file draws one thing extremely well: a full-bleed photograph with a small
// line of type on whichever part of it is quietest, placed by measurement. Every
// decision in it follows from that - the placement search, the ink adaptation, the
// band confinement. A slide that is a CHECKLIST has no quiet part and nothing to
// measure; a slide that is four photographs in a grid has four. Adding them as
// styles would mean threading "this style ignores the measurement" through the
// whole of it.
//
// THE TYPE IS AT FIXED POSITIONS, AND THAT IS THE NATIVE LOOK RATHER THAN A
// SHORTCUT.
//
// The measured placement exists because a small caption in a normal weight needs a
// quiet background to survive. TikTok's own text tool does the opposite: it puts
// large heavy type wherever the user dropped it and gives it an outline or a solid
// box so that the background stops mattering. @teonakan's 108K-like post is exactly
// that and nothing more - "1. Astronomical clock" in white with a dark outline,
// centred, over whatever her photograph happened to be. So fixed positions plus a
// real outline is what makes these read as somebody's post rather than as ours, and
// it also means a twenty-slide list costs no image analysis at all.
//
// WHICH FACE, AND THE QUESTION IT ANSWERS.
//
// Not TikTok Sans. render/theme.js already establishes why and it is worth
// repeating here because this is the file where somebody would reach for it: TikTok
// Sans has no Hebrew coverage whatsoever - Latin, Greek and Cyrillic only - so the
// app itself never draws Hebrew in a TikTok font. It falls back to the handset's
// system face, SF Hebrew on iOS. Assistant is the closest licensable relative, and
// it is therefore what "looks like TikTok" means for Hebrew.

/**
 * The frame, for a size and an aspect-ratio choice.
 *
 * `frame` only affects TikTok. An Instagram carousel is 4:5 and that is not a
 * variable - it is what the grid crops to - so the frame is ignored there rather
 * than producing a 3:4 card that the feed then crops again.
 *
 * The safe areas SCALE rather than carry over. TikTok's furniture is a fraction of
 * the player, not a number of pixels: 300px off a 1920 frame is 15.6% of it, and
 * reusing 300 on a 1440 frame would reserve 21% for a bar that has not grown.
 */
export const FRAMES = {
  tall: { w: 1080, h: 1920 },
  phone: { w: 1080, h: 1440 },
};

export function geometryFor(size = 'tiktok', frame = 'tall') {
  if (size !== 'tiktok') return SIZES[size] || SIZES.instagram;
  const f = FRAMES[frame] || FRAMES.tall;
  const base = SIZES.tiktok;
  return {
    w: f.w,
    h: f.h,
    topSafe: Math.round((base.topSafe / base.h) * f.h),
    bottomSafe: Math.round((base.bottomSafe / base.h) * f.h),
    frame: FRAMES[frame] ? frame : 'tall',
  };
}

/** Every look this file can draw. `label` and `sheet` need a photograph; the others do not. */
export const LOOKS = ['label', 'sheet', 'route', 'notes', 'collage', 'pinmap'];
export const isLook = (l) => LOOKS.includes(l);

/* -------------------------------------------------------------------------- */
/* shared scaffolding                                                          */
/* -------------------------------------------------------------------------- */

// Sized off the frame WIDTH, like typeScale in deckTemplates.js and for the same
// reason: a percentage of the height means the same slide is two different sizes
// at the two aspect ratios, which is precisely what the frame test must not
// confound. Width is 1080 in both.
const px = (geo, pct) => Math.max(11, Math.round(geo.w * pct));

const FONTS = () => `
@font-face { font-family: 'Heebo'; src: url(${heeboDataUri()}) format('truetype'); font-weight: 100 900; font-display: block; }
@font-face { font-family: 'Assistant'; src: url(${assistantDataUri()}) format('truetype'); font-weight: 200 800; font-display: block; }`;

// Heebo is declared on every page here whether or not the design uses it, because
// renderToJpeg refuses a page whose Heebo did not load - it is the check that stops a
// slide of tofu boxes publishing. Assistant is what the type is actually set in.
//
// AND DECLARING IT IS NOT ENOUGH, which cost a render to find out. A @font-face that
// no rule actually draws with is never fetched: Chromium loads faces lazily, so the
// face sat at status "unloaded" and the guard threw "Heebo did not load" on a page
// whose Hebrew was perfectly fine. It threw INTERMITTENTLY, which is worse - the
// listed fallback in `font-family` is requested only if Assistant fails to cover a
// glyph, so whether it loaded depended on what was on the slide.
//
// `.font-probe` is one absolutely-positioned invisible character set in Heebo. It
// makes the declaration honest: the face is genuinely used, so it is genuinely
// fetched, and the guard is then answering the question it was written to answer
// rather than a question about lazy loading.
const base = (geo) => `${FONTS()}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: ${geo.w}px; height: ${geo.h}px; overflow: hidden; }
body { position: relative; background: #0b0d12; font-family: 'Assistant', sans-serif;
       -webkit-font-smoothing: antialiased; }
.font-probe { position: absolute; top: -200px; inset-inline-start: -200px; font-family: 'Heebo';
              font-weight: 700; font-size: 40px; color: transparent; pointer-events: none; }
.photo { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.none { position: absolute; inset: 0; background: linear-gradient(160deg, #1d2430, #0b0d12); }`;

/** The element that makes the Heebo declaration real. See the note above `base`. */
const PROBE = '<div class="font-probe">א</div>';

/**
 * The outline that makes white type survive any photograph.
 *
 * TWO MECHANISMS TOGETHER, and both are needed. `-webkit-text-stroke` draws a
 * crisp contour, which is what TikTok's tool does and what reads as native; four
 * offset shadows underneath it fill the diagonal gaps a stroke leaves at this
 * weight, and a soft wide shadow separates the whole block from a busy background.
 *
 * A stroke alone was tried first and it is not enough over foliage: the contour is
 * the same width everywhere, so where the photograph is the same value as the
 * letter the eye loses the edge anyway.
 */
const outlined = (stroke) => `
  color: #fff;
  -webkit-text-stroke: ${stroke}px rgba(0,0,0,.82);
  paint-order: stroke fill;
  text-shadow: 0 ${Math.round(stroke * 0.8)}px ${Math.round(stroke * 3)}px rgba(0,0,0,.55),
               0 0 ${Math.round(stroke * 6)}px rgba(0,0,0,.38);`;

/** The photograph, or the gradient that stands in for one. */
const photo = (image) =>
  image?.src ? `<img class="photo" src="${image.src}" alt="">` : '<div class="none"></div>';

/**
 * How big a line may be set before it stops fitting.
 *
 * A step table rather than a measurement. The renderer CAN measure - render/index.js
 * has a fit pass for deck covers - but that pass exists for one line per deck and
 * this would be twenty per post. The steps are coarse on purpose: a list label is
 * a place name, the distribution of place-name lengths is narrow, and the outline
 * makes a slightly small line read as deliberate where a clipped one reads as
 * broken.
 */
const step = (text, { mid, long }) => {
  const n = String(text || '').length;
  return n > long ? 0.74 : n > mid ? 0.86 : 1;
};

const emojiRow = (emojis) =>
  (emojis || []).length
    ? `<div class="emoji">${emojis.map((e) => emojiHtml(e, { size: '1em' })).join('')}</div>`
    : '';

/**
 * A line of text with its emoji drawn as pictures rather than as characters.
 *
 * WHY A WHOLE-STRING PASS AND NOT JUST emojiHtml. Some of these lines have an emoji
 * INSIDE them - "📍 גשר קארל", "⭐ חצי יום" - so there is no separate field to route
 * through emojiHtml, and escaping the string leaves the character to be drawn by
 * whatever font the rendering machine has.
 *
 * That is the exact failure emojiArt.js exists to prevent, and it is not theoretical:
 * these slides were reviewed on Windows, where Segoe UI Emoji drew every one of them
 * correctly, and the publishing box is Ubuntu. The one that gave itself away early was
 * a flag - 🇬🇷 has no glyph in the Windows font either, so it rendered as the letters
 * "GR" set in the middle of a Hebrew sentence.
 *
 * Escaping happens per text run, so the HTML this returns is safe for the same reason
 * escapeHtml's output is: nothing from the source string reaches the output unescaped.
 */
const EMOJI_RUN = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*|[\u{1F1E6}-\u{1F1FF}]{2}/gu;

export function withEmoji(text, { size = '1em' } = {}) {
  const s = String(text ?? '');
  let out = '';
  let at = 0;
  for (const m of s.matchAll(EMOJI_RUN)) {
    out += escapeHtml(s.slice(at, m.index));
    out += emojiHtml(m[0], { size });
    at = m.index + m[0].length;
  }
  return out + escapeHtml(s.slice(at));
}

/* -------------------------------------------------------------------------- */
/* 1. label — TikTok's text tool over a photograph                             */
/* -------------------------------------------------------------------------- */

/**
 * The look that carries the list, and the covers of everything.
 *
 * A number, a name, and one line that earns the slide. The number is the whole
 * mechanism on a list post: a viewer who sees "3." knows there are seventeen more
 * and that is the completion loop the 21-slide reference post runs on. It is set
 * LARGER than the name and in the accent, because it is the thing being counted.
 *
 * `band` says where the block sits - 'lower' for a list item, 'mid' for a cover.
 * Two positions rather than a placement search: a run of twenty slides whose labels
 * are all in the same place reads as one post, and one where they wander reads as
 * twenty.
 */
export function renderLabelSlideHtml(slide, { size = 'tiktok', frame = 'tall' } = {}) {
  const geo = geometryFor(size, frame);
  const cover = Boolean(slide.cover);
  const band = slide.band || (cover ? 'mid' : 'lower');

  const titleBase = cover ? 0.082 : 0.068;
  const scale = step(slide.titleHe, cover ? { mid: 26, long: 40 } : { mid: 20, long: 32 });
  const titlePx = px(geo, titleBase * scale);
  const notePx = px(geo, 0.042);
  const numPx = px(geo, 0.105);
  const stroke = Math.max(3, Math.round(titlePx * 0.055));

  // The block's own vertical anchor. `mid` is optically centred rather than
  // mathematically: type centred on the exact middle of a tall frame reads low,
  // because the caption and handle at the foot of the player take the bottom sixth.
  const top = band === 'mid' ? Math.round(geo.h * 0.36) : null;
  const bottom = band === 'mid' ? null : Math.round(geo.h * 0.2);

  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>${base(geo)}
.wrap { position: absolute; ${top != null ? `top:${top}px;` : `bottom:${bottom}px;`}
        inset-inline: ${Math.round(geo.w * 0.07)}px; display: flex; flex-direction: column;
        align-items: center; text-align: center; gap: ${Math.round(notePx * 0.42)}px; }
/* A gradient rather than a flat scrim, and only on the half the type is on. A flat
   panel is the designed-poster look that got the reference flop nine likes; a
   gradient is what the platform's own player already lays over a photograph. */
.veil { position: absolute; inset-inline: 0; height: ${Math.round(geo.h * 0.46)}px;
        ${band === 'mid' ? `top:${Math.round(geo.h * 0.22)}px;
        background: radial-gradient(ellipse at center, rgba(0,0,0,.42), rgba(0,0,0,0) 72%);`
          : `bottom:0; background: linear-gradient(to top, rgba(0,0,0,.52), rgba(0,0,0,0));`} }
/* LTR, ISOLATED. The page is RTL and "3." is a number followed by a full stop, so
   the bidi algorithm put the stop on the left and the slide counted ".3". The number
   is the one element here that is not Hebrew and it has to be told so. */
.num { direction: ltr; unicode-bidi: isolate;
       font-weight: 800; font-size: ${numPx}px; line-height: 1; color: #FFD84D;
       -webkit-text-stroke: ${Math.round(numPx * 0.05)}px rgba(0,0,0,.85); paint-order: stroke fill;
       text-shadow: 0 3px 16px rgba(0,0,0,.6); }
.title { font-weight: 800; font-size: ${titlePx}px; line-height: 1.14; ${outlined(stroke)} }
.note { font-weight: 600; font-size: ${notePx}px; line-height: 1.3;
        ${outlined(Math.max(2, Math.round(notePx * 0.05)))} opacity: .97; }
.emoji { font-size: ${px(geo, 0.055)}px; line-height: 1; display: flex; gap: .12em; }
</style></head><body>
${PROBE}
${photo(slide.image)}
<div class="veil"></div>
<div class="wrap">
  ${emojiRow(slide.emojis)}
  ${slide.number ? `<div class="num">${escapeHtml(String(slide.number))}</div>` : ''}
  <div class="title">${withEmoji(slide.titleHe || '')}</div>
  ${slide.noteHe ? `<div class="note">${withEmoji(slide.noteHe)}</div>` : ''}
</div>
</body></html>`;
}

/* -------------------------------------------------------------------------- */
/* 2. sheet — TikTok's boxed text, for two or three quoted lines               */
/* -------------------------------------------------------------------------- */

/**
 * White rounded boxes over a darkened photograph.
 *
 * FOR THE SLIDES THAT CARRY MORE THAN ONE CLAIM. An outline separates type from a
 * background; it does not separate three quoted drawbacks from each other, and a
 * verdict slide is exactly three quoted drawbacks. TikTok's tool has this mode too
 * - a solid rounded box behind each line - so it is still the platform's own
 * vocabulary rather than a panel of ours.
 *
 * One box PER LINE, not one box around the block. Per line is what the tool
 * produces, because the box hugs the text: the ragged right edge of a stack of
 * boxes is the tell that says a person typed this.
 */
export function renderSheetSlideHtml(slide, { size = 'tiktok', frame = 'tall' } = {}) {
  const geo = geometryFor(size, frame);
  const lines = (slide.lines || []).filter(Boolean).slice(0, 5);
  const headPx = px(geo, 0.062);
  const linePx = px(geo, lines.length > 3 ? 0.036 : 0.042);
  const pad = Math.round(linePx * 0.55);

  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>${base(geo)}
.dim { position: absolute; inset: 0; background: rgba(8,10,14,.52); }
.wrap { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center;
        align-items: center; gap: ${pad}px; padding: ${Math.round(geo.h * 0.12)}px ${Math.round(geo.w * 0.075)}px; }
.head { font-weight: 800; font-size: ${headPx}px; line-height: 1.16; text-align: center;
        margin-bottom: ${pad}px; ${outlined(Math.max(3, Math.round(headPx * 0.055)))} }
/* The box hugs its line: fit-content with a max is what makes the stack ragged,
   which is what a person typing produces and a template does not.
   THE MAX IS 88%, NOT 100%. At full width every long line filled the frame edge to
   edge and the stack came out as three identical rectangles - which is the designed
   panel this look exists to avoid. Wrapping a little earlier is what produces the
   uneven right edge that reads as somebody typing. */
.row { background: #fff; color: #14161c; font-weight: 700; font-size: ${linePx}px; line-height: 1.34;
       border-radius: ${Math.round(linePx * 0.42)}px; padding: ${pad}px ${Math.round(pad * 1.5)}px;
       width: fit-content; max-width: 88%; text-align: start;
       box-shadow: 0 ${Math.round(pad * 0.4)}px ${Math.round(pad * 1.6)}px rgba(0,0,0,.34); }
.row.mark { background: #FFD84D; }
.emoji { font-size: ${px(geo, 0.055)}px; line-height: 1; display: flex; gap: .12em; margin-bottom: ${pad}px; }
</style></head><body>
${PROBE}
${photo(slide.image)}
<div class="dim"></div>
<div class="wrap">
  ${emojiRow(slide.emojis)}
  ${slide.titleHe ? `<div class="head">${withEmoji(slide.titleHe)}</div>` : ''}
  ${lines
    .map((l) => {
      const text = typeof l === 'string' ? l : l.text;
      const mark = typeof l === 'object' && l.mark;
      return `<div class="row${mark ? ' mark' : ''}">${withEmoji(text)}</div>`;
    })
    .join('\n  ')}
</div>
</body></html>`;
}

/* -------------------------------------------------------------------------- */
/* 3. route — one day, as something drawn for a friend                         */
/* -------------------------------------------------------------------------- */

/**
 * A day's stops down a dotted line, with the walk between them.
 *
 * WHAT THE DOTTED LINE IS DOING. A day is an ordered thing and a list of names does
 * not say so. The line says "then", the chips between the rows say how far "then"
 * is, and together they answer the question a viewer actually has, which is whether
 * this day is doable rather than what is in it.
 *
 * THE DISTANCES ARE HEDGED IN THE DATA, NOT HERE. distanceHe in src/posts/source.js
 * rounds coarsely and puts a ~ on everything, because the number is a straight line
 * between two database coordinates and nobody walks in a straight line. This
 * template prints whatever it is given; it must never compute one.
 *
 * The background is the day's own first photograph, blurred. Not a flat colour: a
 * slideshow that cuts to a panel has visibly stopped being a slideshow, which is
 * the argument the site slide's own template makes at the bottom of siteSlide.js.
 */
export function renderRouteCardHtml(slide, { size = 'tiktok', frame = 'tall' } = {}) {
  const geo = geometryFor(size, frame);
  const stops = (slide.stops || []).slice(0, 5);
  const headPx = px(geo, 0.058);
  const namePx = px(geo, 0.041);
  const metaPx = px(geo, 0.03);
  const thumb = Math.round(geo.w * 0.115);
  const gap = Math.round(geo.h * (stops.length > 4 ? 0.016 : 0.022));

  const row = (stop, i) => `
  ${
    i > 0 && stop.gapHe
      ? `<div class="gap"><span>${escapeHtml(stop.gapHe)}</span></div>`
      : i > 0
        ? '<div class="gap plain"></div>'
        : ''
  }
  <div class="stop">
    <div class="dot"></div>
    ${
      stop.image?.src
        ? `<img class="thumb" src="${stop.image.src}" alt="">`
        : // NO EMPTY FRAME. A stop with no photograph used to draw a grey rounded
          // rectangle where the picture would be, which looks like an image that
          // failed to load rather than a place we have no photograph of - and on a
          // Prague day it was always the kosher restaurant, which is the one row the
          // audience most wants to trust. A spacer keeps the row aligned to the rail
          // and shows nothing.
          '<div class="thumb hollow"></div>'
    }
    <div class="text">
      <div class="name">${withEmoji(`📍 ${stop.nameHe}`)}</div>
      ${stop.noteHe ? `<div class="meta">${withEmoji(stop.noteHe)}</div>` : ''}
    </div>
  </div>`;

  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>${base(geo)}
/* The day's own photograph, blurred, as the ground.
   BRIGHT ENOUGH TO STILL BE A PHOTOGRAPH. The first pass ran brightness at .34 under
   a tint at .8 and the result was a black slide - which defeats the whole reason this
   is not a flat panel, and made a route card in the middle of a slideshow read as the
   post having ended. The type carries its own contrast, so the ground does not have to
   be dark, only quiet. */
.bg { position: absolute; inset: 0; background-size: cover; background-position: center;
      filter: blur(30px) saturate(1.1) brightness(.62); transform: scale(1.2); }
.tint { position: absolute; inset: 0;
        background: linear-gradient(180deg, rgba(9,11,16,.52), rgba(9,11,16,.68)); }
.wrap { position: absolute; inset: 0; padding: ${Math.round(geo.h * 0.1)}px ${Math.round(geo.w * 0.07)}px;
        display: flex; flex-direction: column; justify-content: center; }
.head { color: #fff; font-weight: 800; font-size: ${headPx}px; line-height: 1.16; text-align: center;
        margin-bottom: ${Math.round(gap * 1.6)}px; }
.head .sub { display: block; color: rgba(255,255,255,.72); font-weight: 600; font-size: ${metaPx}px;
             margin-top: ${Math.round(metaPx * 0.35)}px; }
.list { position: relative; display: flex; flex-direction: column; gap: ${gap}px; }
/* The dotted rail, behind the rows, on the side a Hebrew line starts from. */
.list::before { content: ''; position: absolute; top: ${thumb / 2}px; bottom: ${thumb / 2}px;
                inset-inline-start: ${Math.round(thumb / 2)}px; width: 0;
                border-inline-start: ${Math.max(2, Math.round(geo.w * 0.004))}px dotted rgba(255,255,255,.4); }
.stop { position: relative; display: flex; align-items: center; gap: ${Math.round(geo.w * 0.028)}px; }
.dot { position: absolute; inset-inline-start: ${Math.round(thumb / 2 - geo.w * 0.011)}px;
       width: ${Math.round(geo.w * 0.022)}px; height: ${Math.round(geo.w * 0.022)}px; border-radius: 50%;
       background: #FFD84D; box-shadow: 0 0 0 ${Math.round(geo.w * 0.006)}px rgba(9,11,16,.85); }
.thumb { width: ${thumb}px; height: ${thumb}px; border-radius: ${Math.round(thumb * 0.28)}px;
         object-fit: cover; flex: 0 0 auto; margin-inline-start: ${Math.round(thumb * 0.62)}px;
         box-shadow: 0 0 0 ${Math.max(2, Math.round(geo.w * 0.003))}px rgba(255,255,255,.16); }
.thumb.hollow { background: transparent; box-shadow: none; }
.text { min-width: 0; }
.name { color: #fff; font-weight: 700; font-size: ${namePx}px; line-height: 1.22; }
.meta { color: rgba(255,255,255,.76); font-weight: 600; font-size: ${metaPx}px; margin-top: 2px; }
/* The distance between two stops, as a chip on the rail. Indented to sit over the
   dotted line rather than beside the names, so it reads as part of the route. */
.gap { display: flex; align-items: center; height: ${Math.round(metaPx * 1.5)}px;
       margin-inline-start: ${Math.round(thumb * 0.62)}px; }
.gap.plain { height: ${Math.round(metaPx * 0.7)}px; }
.gap span { background: rgba(255,255,255,.14); color: rgba(255,255,255,.88); font-weight: 700;
            font-size: ${Math.round(metaPx * 0.92)}px; border-radius: 999px;
            padding: ${Math.round(metaPx * 0.2)}px ${Math.round(metaPx * 0.6)}px;
            margin-inline-start: ${Math.round(thumb / 2 - metaPx * 0.9)}px; }
.tip { color: rgba(255,255,255,.82); font-weight: 600; font-size: ${metaPx}px; line-height: 1.34;
       margin-top: ${Math.round(gap * 1.5)}px; text-align: center; }
</style></head><body>
${PROBE}
<div class="bg" style="background-image:url('${slide.bgImage?.src || slide.stops?.[0]?.image?.src || ''}')"></div>
<div class="tint"></div>
<div class="wrap">
  <div class="head">${withEmoji(slide.titleHe || '')}${
    slide.subHe ? `<span class="sub">${withEmoji(slide.subHe)}</span>` : ''
  }</div>
  <div class="list">${stops.map(row).join('')}</div>
  ${slide.tipHe ? `<div class="tip">${withEmoji(slide.tipHe)}</div>` : ''}
</div>
</body></html>`;
}

/* -------------------------------------------------------------------------- */
/* 4. notes — the iPhone Notes checklist                                       */
/* -------------------------------------------------------------------------- */

/**
 * A day as a checklist on black.
 *
 * THE HIGHEST-SAVING SHAPE IN THE WHOLE STUDY. @juliatraveltips' Rome post runs at
 * 0.83 saves per like, and its slides are screenshots of the Notes app - a plain
 * checklist, no design at all. That is not a coincidence and it is not laziness: a
 * checklist is a thing you save because it is a thing you will tick off, and it
 * looks like something a person made for themselves rather than for you.
 *
 * SO THIS SLIDE IS DELIBERATELY UNDESIGNED. Black ground, one weight of type, empty
 * circles, no photograph, no gradient, no accent except the day's emoji row. Every
 * instinct to improve it - a tint, a rule, a brand mark - is an instinct to make it
 * look made, and made is what the flop poster looked like.
 *
 * The day's own tip is the last row and reads differently on purpose: it is the
 * only line that is advice rather than an item, and it is the most useful sentence
 * on the post.
 */
export function renderNotesCardHtml(slide, { size = 'tiktok', frame = 'tall' } = {}) {
  const geo = geometryFor(size, frame);
  const rows = (slide.rows || []).filter(Boolean).slice(0, 7);
  const headPx = px(geo, 0.066);
  const rowPx = px(geo, rows.length > 5 ? 0.04 : 0.046);
  const circle = Math.round(rowPx * 0.86);

  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>${base(geo)}
body { background: #000; }
.wrap { position: absolute; inset: 0; padding: ${Math.round(geo.h * 0.13)}px ${Math.round(geo.w * 0.085)}px;
        display: flex; flex-direction: column; justify-content: center; }
.head { color: #fff; font-weight: 800; font-size: ${headPx}px; line-height: 1.14;
        margin-bottom: ${Math.round(rowPx * 1.1)}px; }
.head .e { margin-inline-start: .22em; }
.row { display: flex; align-items: flex-start; gap: ${Math.round(rowPx * 0.5)}px;
       color: #fff; font-weight: 600; font-size: ${rowPx}px; line-height: 1.42;
       padding: ${Math.round(rowPx * 0.24)}px 0; }
.o { flex: 0 0 auto; width: ${circle}px; height: ${circle}px; border-radius: 50%;
     border: ${Math.max(2, Math.round(circle * 0.1))}px solid rgba(255,255,255,.72);
     margin-top: ${Math.round(rowPx * 0.28)}px; }
.row .sub { color: rgba(255,255,255,.58); font-weight: 600; }
/* The tip. Set apart by a rule and a weight rather than by a colour, because a
   coloured line on a black slide reads as a button. */
.tip { margin-top: ${Math.round(rowPx * 1.1)}px; padding-top: ${Math.round(rowPx * 0.8)}px;
       border-top: 1px solid rgba(255,255,255,.16); color: rgba(255,255,255,.82);
       font-weight: 600; font-size: ${Math.round(rowPx * 0.86)}px; line-height: 1.44; }
</style></head><body>
${PROBE}
<div class="wrap">
  <div class="head">${withEmoji(slide.titleHe || '')}${
    (slide.emojis || []).length ? `<span class="e">${(slide.emojis || []).map((e) => emojiHtml(e, { size: '0.9em' })).join('')}</span>` : ''
  }</div>
  ${rows
    .map((r) => {
      const text = typeof r === 'string' ? r : r.text;
      const sub = typeof r === 'object' ? r.sub : null;
      return `<div class="row"><div class="o"></div><div>${withEmoji(text)}${
        sub ? ` <span class="sub">${withEmoji(sub)}</span>` : ''
      }</div></div>`;
    })
    .join('\n  ')}
  ${slide.tipHe ? `<div class="tip">${withEmoji(slide.tipHe)}</div>` : ''}
</div>
</body></html>`;
}

/* -------------------------------------------------------------------------- */
/* 5. collage — the breath between two days                                    */
/* -------------------------------------------------------------------------- */

/**
 * Two to four of a day's photographs in a grid.
 *
 * WHAT IT IS FOR. @juliatraveltips alternates a checklist with a 2x2 of her own
 * photographs, and the alternation is doing something a run of either would not: a
 * checklist is read and a photograph is looked at, and a post that only asks to be
 * read loses people at slide four. This is the slide that lets them rest.
 *
 * `1+2` for three photographs rather than a 2x2 with a hole in it. Three in a
 * two-column grid leaves a gap, and a gap reads as a missing image.
 */
export function renderCollageHtml(slide, { size = 'tiktok', frame = 'tall' } = {}) {
  const geo = geometryFor(size, frame);
  const shots = (slide.images || []).filter((i) => i?.src).slice(0, 4);
  const n = shots.length;
  const labelPx = px(geo, 0.048);
  const gapPx = Math.max(4, Math.round(geo.w * 0.008));

  // Four is a 2x2; three is one wide over two; two is stacked, which at 9:16 gives
  // each photograph a near-square crop rather than two letterbox strips.
  const areas =
    n >= 4
      ? '"a b" "c d"'
      : n === 3
        ? '"a a" "b c"'
        : n === 2
          ? '"a a" "b b"'
          : '"a a" "a a"';

  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>${base(geo)}
.grid { position: absolute; inset: 0; display: grid; gap: ${gapPx}px;
        grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr;
        grid-template-areas: ${areas}; background: #000; }
.cell { overflow: hidden; }
.cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
.c0 { grid-area: a; } .c1 { grid-area: b; } .c2 { grid-area: c; } .c3 { grid-area: d; }
/* One label, bottom centre, in the same outlined type the label look uses so the
   two read as the same post. No corner text: section 5's rule, and the reason is
   that tiny type in a corner is what a watermark looks like. */
/* Padded, because a day title is a sentence and an unpadded centred line starts at
   the very edge of the frame when it is long enough - which is what it did: "העיר
   העתיקה, הרובע היהודי והשווקים" ran off the right of a 1080 frame. */
.tag { position: absolute; inset-inline: ${Math.round(geo.w * 0.07)}px; bottom: ${Math.round(geo.h * 0.07)}px;
       text-align: center; line-height: 1.2;
       font-weight: 800; font-size: ${labelPx}px; ${outlined(Math.max(3, Math.round(labelPx * 0.055)))} }
</style></head><body>
${PROBE}
<div class="grid">
  ${shots.map((s, i) => `<div class="cell c${i}"><img src="${s.src}" alt=""></div>`).join('\n  ')}
</div>
${slide.titleHe ? `<div class="tag">${withEmoji(slide.titleHe)}</div>` : ''}
</body></html>`;
}

/* -------------------------------------------------------------------------- */
/* 6. pinmap — the itinerary's real coordinates                                */
/* -------------------------------------------------------------------------- */

// The day colours, and they are a fixed sequence rather than a palette choice.
//
// Five, because an itinerary longer than five days on one map is a map whose colours
// nobody can hold in their head, and the sequence wraps rather than running out. Chosen
// for distinguishability at pin size against a dark ground, which rules out the two
// blues that would read as the same colour at 56px.
const DAY_COLOURS = ['#FFD84D', '#4FC3F7', '#FF8A65', '#A5D6A7', '#CE93D8'];

/**
 * The pin map, projected here because the projection needs the frame.
 *
 * THE ONE LOOK WHOSE CONTENT IS GEOMETRY. Everything else in this file receives finished
 * strings and lays them out; this receives coordinates and has to turn them into pixels,
 * which cannot be done before the frame is known - and the frame is exactly what the
 * aspect-ratio test varies. A 3:4 frame fits a different bounding box than a 9:16 one
 * does, so the same itinerary is legitimately two different maps.
 */
export function renderPinMapHtml(slide, { size = 'tiktok', frame = 'tall' } = {}) {
  const geo = geometryFor(size, frame);
  const fit = fitPoints(slide.points || [], { width: geo.w, height: geo.h, padding: 0.16 });
  if (!fit) throw new Error('renderPinMapHtml: fewer than two points with coordinates');

  const placed = slide.points.map((p) => ({ ...p, ...fit.project(p) }));
  return pinMapHtml({
    points: placed,
    width: geo.w,
    height: geo.h,
    titleHe: slide.titleHe || null,
    subHe: slide.subHe || null,
    bar: scaleBar(fit.metresPerPixel, geo.w),
    dayColours: DAY_COLOURS,
  });
}

/* -------------------------------------------------------------------------- */

/** One entry point, so the renderer dispatches on a field rather than on a chain of ifs. */
export const RENDERERS = {
  label: renderLabelSlideHtml,
  sheet: renderSheetSlideHtml,
  route: renderRouteCardHtml,
  notes: renderNotesCardHtml,
  collage: renderCollageHtml,
  pinmap: renderPinMapHtml,
};

export function renderPostSlideHtml(slide, opts = {}) {
  const draw = RENDERERS[slide?.look];
  if (!draw) throw new Error(`renderPostSlideHtml: unknown look ${JSON.stringify(slide?.look)}`);
  return draw(slide, opts);
}
