import { heeboDataUri, assistantDataUri, escapeHtml, siteMark } from './theme.js';
import { SIZES } from './deckTemplates.js';

// The last slide: the real page, in a phone, over the deck's own cover.
//
// WHAT THIS SLIDE IS FOR, AND WHY IT REPLACES THE FOLLOW ASK.
//
// Every slideshow used to close on a sentence asking for a follow. That is the
// right ending for a post whose product is the post. It is the wrong one here:
// the account exists to send people to tiyulplus.com, and a slide that asks for
// a follow spends the last swipe, the one a viewer who watched to the end is
// most likely to act on, on the smaller of the two things we want. The follow
// ask is not lost; it moves to the description, where it costs the post
// nothing. See src/deck/follow.js.
//
// THE PHONE FRAME IS DOING A JOB, not decorating. A screenshot dropped flat
// onto a slide reads as a picture of a website, which is a thing nobody swipes
// to. In a phone it reads as somewhere you could be in two taps, and it says
// the page is built for the device the viewer is holding, which is the single
// most relevant fact about it.
//
// THE BACKGROUND IS THE COVER, BLURRED. Not a flat colour: a slideshow that
// ends on a panel has visibly stopped being a slideshow, and the cover is the
// one photograph already claimed by this post that no other slide is using at
// full size.
//
// WHAT MAY BE WRITTEN ON IT DIFFERS BY PLATFORM, and it is not a style choice.
// TikTok slides in this account carry no brand mark and no URL at all, which
// is the rule the whole deck format is built to (README, "no branding on it at
// all"), and a domain in a TikTok post is a demotion besides. Instagram's set
// is drawn as cards and carries the wordmark like every other card. The line
// underneath differs for a harder reason: on Instagram, with private replies
// switched on, there IS a way to hand somebody a link, and it is a comment. On
// TikTok there is not, so it says where the link lives instead.

// The phone, as a fraction of the frame. Tuned per size against rendered
// output rather than derived, and the two differ by more than their heights.
//
// `zoom` is the one worth explaining. Instagram's frame is 570px shorter, so
// the phone inside it is smaller, and at 1:1 the page's own body text came out
// too small to read on a feed-sized card - which defeats the slide, whose
// entire argument is "look at this page". Scaling the screenshot past the
// frame and clipping it keeps the hero and the "למסלול המלא" button legible
// and loses the footer, which nobody needed to see. TikTok's frame is tall
// enough not to need it.
const FRAME = {
  tiktok: { top: 0.20, phoneH: 0.56, titlePx: 60, notePx: 34, ctaPx: 40, zoom: 1 },
  instagram: { top: 0.13, phoneH: 0.58, titlePx: 54, notePx: 31, ctaPx: 37, zoom: 1.32 },
};

/**
 * The closing slide's HTML.
 *
 * `shot` is the data URI from captureSitePage. This function does not know how
 * to get one and does not have a fallback for not having one: a missing
 * screenshot is decided one level up, where the answer is to draw the ordinary
 * follow slide instead of this. An empty phone must never render.
 */
export function renderSiteSlideHtml(slide, { size = 'tiktok' } = {}) {
  const geo = SIZES[size] || SIZES.tiktok;
  const f = FRAME[size] || FRAME.tiktok;
  const brand = size === 'instagram';

  if (!slide?.shot) throw new Error('renderSiteSlideHtml: no screenshot - the caller should have drawn the follow slide');

  return `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8">
<style>
/* Heebo is declared because renderToJpeg refuses a page whose Heebo did not
   load, and it is the check that stops a slide of tofu boxes publishing. It is
   also what the type here is actually set in. */
@font-face { font-family: 'Heebo'; src: url(${heeboDataUri()}) format('truetype'); font-weight: 100 900; font-display: block; }
@font-face { font-family: 'Assistant'; src: url(${assistantDataUri()}) format('truetype'); font-weight: 200 800; font-display: block; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: ${geo.w}px; height: ${geo.h}px; overflow: hidden; }
body { position: relative; background: #11131a; font-family: 'Heebo', sans-serif; }

/* The cover, blurred and darkened. The scale is not vanity: a blur samples
   beyond its own edges and an unscaled layer feathers to transparent at the
   frame, which draws a pale border round the whole slide. */
.bg { position: absolute; inset: 0; background-size: cover; background-position: center;
      filter: blur(38px) saturate(1.05) brightness(0.42); transform: scale(1.18); }
.tint { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(10,12,18,.55), rgba(10,12,18,.78)); }

.wrap { position: absolute; inset: 0; display: flex; flex-direction: column;
        align-items: center; padding: ${Math.round(geo.h * f.top)}px 70px 0; }

.title { color: #fff; font-weight: 700; font-size: ${f.titlePx}px; line-height: 1.2;
         text-align: center; text-shadow: 0 2px 18px rgba(0,0,0,.45); }
.note { color: rgba(255,255,255,.82); font-family: 'Assistant', sans-serif; font-weight: 500;
        font-size: ${f.notePx}px; margin-top: 14px; text-align: center; }

/* The phone. A border, a radius and one shadow - enough to read as a device,
   not so much that it becomes an illustration of a device. */
.phone { margin-top: ${Math.round(geo.h * 0.035)}px; height: ${Math.round(geo.h * f.phoneH)}px;
         aspect-ratio: 390 / 844; border-radius: 42px; padding: 10px; background: #0b0d12;
         box-shadow: 0 30px 70px rgba(0,0,0,.55), 0 0 0 2px rgba(255,255,255,.10);
         flex: 0 0 auto; }
/* The screenshot is pinned to the TOP of the frame rather than fitted into it.
   The page's own hero and its "למסלול המלא" button are the first thing on it,
   and scaling the whole page down to fit would make all of it unreadable to
   show a footer nobody needs to see. */
.screen { width: 100%; height: 100%; border-radius: 34px; overflow: hidden; background: #fff; }
/* Scaled past the frame and clipped. See the zoom note above: this is what
   keeps the page readable on the shorter Instagram card.
   ANCHORED TO THE START, NOT CENTRED. The page is RTL, so its text begins at
   the right edge; centring the overflow clips both sides and takes the first
   character of every line with it. Anchored, the whole clip falls at the end
   of the line, where Hebrew has its margin. */
.screen img { width: ${Math.round(f.zoom * 100)}%; margin-inline-start: 0; display: block; }

.cta { margin-top: auto; margin-bottom: ${Math.round(geo.h * 0.055)}px; color: #fff;
       font-weight: 600; font-size: ${f.ctaPx}px; text-align: center;
       background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.22);
       border-radius: 999px; padding: 18px 38px; backdrop-filter: blur(6px); }
/* The wordmark, drawn the way src/render/deckInstagram.js draws it, because it
   lands in the same grid beside the same cards and a second treatment of one
   mark is two brands. TikTok gets none of this block at all. */
${
  brand
    ? `.mark { position: absolute; top: 46px; inset-inline-start: 56px; text-align: start; }
.mark .word { color: #fff; font-weight: 800; font-size: 44px; letter-spacing: -0.01em; }
.mark .word span { color: #ff5a36; }
.mark .site { color: rgba(255,255,255,.62); font-family: 'Assistant', sans-serif; font-size: 22px; margin-top: 2px; }`
    : ''
}
</style></head>
<body>
  <div class="bg" style="background-image:url('${slide.coverImage || ''}')"></div>
  <div class="tint"></div>
  ${brand ? `<div class="mark"><div class="word">טיול<span>+</span></div><div class="site">${escapeHtml(siteMark())}</div></div>` : ''}
  <div class="wrap">
    <div class="title">${escapeHtml(slide.titleHe)}</div>
    ${slide.noteHe ? `<div class="note">${escapeHtml(slide.noteHe)}</div>` : ''}
    <div class="phone"><div class="screen"><img src="${slide.shot}" alt=""></div></div>
    <div class="cta">${escapeHtml(slide.ctaHe)}</div>
  </div>
</body></html>`;
}
