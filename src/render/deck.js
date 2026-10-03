import { renderToJpeg, cardOutputDir, cardPublicUrl } from './index.js';
import { renderSlideHtml, SIZES, isStyle, INK_LUMINANCE } from './deckTemplates.js';
import { renderInstagramSlideHtml } from './deckInstagram.js';
import { analyseSlides, measureCardScrims } from './photo.js';
import { pickGround } from './legibility.js';
import { findTextRegion } from '../images/textbox.js';
import { postConfig } from '../postConfig.js';
import { closingSlidesFor } from '../deck/follow.js';
import { renderSiteSlideHtml } from './siteSlide.js';
// Lives under plan/ because a plan was the only thing that closed on the real
// page when it was written. A deck does now too, and both renderers need the same
// probe, so this is the one import that crosses from the renderer into plan/ - the
// alternative was a second capture with its own page load, its own seven seconds
// and its own visit to keep out of the site's analytics.
import { withSiteShot } from '../plan/sitePage.js';

// A deck to files on disk, twice.
//
// Both platforms fetch the images from a public URL rather than receiving
// bytes, so every slide of every size has to exist as its own file with its own
// address — there is no "post the same picture, cropped" shortcut available
// here even if the crop were acceptable, which it is not.
//
// Filenames carry the size and the index because both are load-bearing: TikTok
// publishes `photo_images` in array order, and a carousel that ships its slides
// out of order is a deck that counts 1, 4, 2, 5, 3.

/** Deterministic and sortable, so the order on disk is the order on the post. */
export const slideStem = (deckId, size, index) => `deck-${deckId}-${size}-${String(index).padStart(2, '0')}`;

/**
 * Roughly how tall the text on a slide will be, as a fraction of the frame.
 *
 * Not a layout measurement — it is the size of the hole the placement search
 * goes looking for. Searching with the wrong height finds a gap the words do
 * not fit in, which is how a four-line block lands in a narrow strip of sky
 * with a ridge through the middle of it.
 */
/**
 * How wide the text needs to be, as a fraction of the frame.
 *
 * A cover is a sentence and needs room to break into two or three even lines;
 * a place name is two words and does not. Given too little, the text stacks one
 * word per line and reads as ragged rather than as a title — which is what a
 * cover squeezed into a narrow strip of sky looked like.
 */
function blockWidth({ cover = false, style = 'minimal' } = {}) {
  // One width, from the config, for everything on a TikTok slide.
  //
  // It used to be three — 0.78 for a cover, 0.54 and 0.48 for the two styles —
  // sized so a large centred title could break into even lines across most of
  // the frame. A block pinned to the left third cannot be 78% of the frame
  // wide, because its far edge is then past the middle of the picture and the
  // whole point of the position is lost. At the current type size it does not
  // need to be: a cover at 37px fits roughly twice the characters per line it
  // did at 68px.
  const { width } = postConfig().overlay;
  // A cover is still a sentence and still wants a little more room than a place
  // name, which is two words.
  return cover ? Math.min(0.6, width * 1.18) : width;
}

function blockHeight(slide, { cover = false, style = 'minimal' } = {}) {
  if (cover) {
    // Two lines, or three for a title long enough to need the smallest step.
    //
    // It used to allow four, which was true of the old type scale and is not of
    // this one: every step down also buys more characters per line, so a title
    // that wrapped to four lines at the old sizes wraps to two at these. Asking
    // for a hole twice the height of the words is not caution, it is a search
    // that rejects every gap in the photograph and settles for the least bad
    // one — which is how a cover ended up across a ridge.
    const n = String(slide.titleHe || '').length;
    const lines = n > 44 ? 3 : 2;
    return Math.min(0.24, lines * (style === 'info' ? 0.05 : 0.044));
  }

  if (style === 'info') {
    const fields = Math.min(4, (slide.fields || []).length);
    return 0.05 + fields * 0.035;
  }

  const label = [slide.nameHe, slide.countryHe].filter(Boolean).join(', ');
  const nameLines = label.length > 30 ? 2 : 1;
  // The minimal style shows a note when it has either a written bullet or a
  // measured fact to fall back on, so the search has to allow for one in both
  // cases or the block lands in a gap one line too short for it.
  const hasNote = (slide.bullets || []).length > 0 || (slide.fields || []).length > 0;
  return nameLines * 0.032 + (slide.flag ? 0.032 : 0) + (hasNote ? 0.03 : 0);
}

/**
 * Render every slide of a deck at one size.
 *
 * Measured first, drawn second. Every photograph in the deck is sampled in one
 * pass — the empty region, its brightness, its colour — and each slide is then
 * rendered against its own answer. That order is the point: placement and text
 * colour are properties of the photograph, and the renderer cannot know either
 * of them from the HTML.
 */
export async function renderDeckSize(deck, { size = 'tiktok', outDir = cardOutputDir(), only = null, siteShot = null } = {}) {
  if (!SIZES[size]) throw new Error(`unknown deck size: ${size}`);
  const geometry = SIZES[size];
  const style = isStyle(deck.style) ? deck.style : 'minimal';

  // `only` re-renders SOME slides of a deck, by 1-based index, leaving the
  // files for the rest exactly as they are.
  //
  // It exists because a rendering bug is discovered after the post is built. A
  // deck published with its cover line cut by the clamp could not be repaired:
  // the filenames are deterministic, so overwriting slide 01 is all that is
  // needed, but the only way to produce one was to render the whole deck - and
  // a stored candidate keeps its photographs' provenance and credit, not their
  // `src`, so the other five slides would have come back without pictures and
  // overwritten five good files.
  //
  // The full item list is still built, so `total` on an Instagram cover and
  // every index still describe the WHOLE deck. Rendering slide 1 of 6 must
  // print "1 / 6"; a version of this that trimmed the list first printed
  // "1 / 1", which is a different bug wearing the same fix.
  const wanted = (i) => !only || only.includes(i + 1);

  const cover = {
    titleHe: deck.titleHe,
    emphasisHe: deck.idea?.emphasisHe,
    // Its own photograph, claimed before the slides took theirs. Opening on the
    // same picture the next slide shows reads as running out of material.
    image: deck.coverImage || deck.slides[0]?.image,
  };

  // Cover, places, and the reason to follow. See followSlideFor — it is appended
  // here rather than pushed into `deck.slides`, because everything that reads
  // that array reads it as the places: the approval message lists their sources,
  // the evidence report quotes them, and a closing slide filed among them would
  // be a place with no country, no source and nothing to verify.
  // The site slide closes the deck instead of the follow ask when this post is
  // about a destination the site has a page for. It is appended here with the
  // others, but it is NOT drawn by the same template: it is a screenshot in a
  // phone rather than a photograph with a line on it, so it skips the
  // placement measurement below (there is no photograph to measure) and gets
  // its own renderer at the bottom of the loop.
  // EXACTLY ONE CLOSING SLIDE, and it is not this function's decision.
  //
  // These were two independent lines here - `followSlideFor(deck)` and the site
  // slide, each appended if truthy - so a deck with a destination page got both:
  // "רוצים עוד? תעקבו" and then the screenshot. Two asks on one post, which is
  // the exact thing src/deck/follow.js says it is preventing, and the arithmetic
  // in that file was the only part of the build that knew. Now the list comes
  // from closingSlidesFor, which is also what publishedSlideCount counts, so the
  // renderer and the count cannot say different things again.
  // A SITE SLIDE WITH NO SCREENSHOT FALLS BACK HERE, rather than throwing at the caller.
  //
  // renderSiteSlideHtml refuses to draw an empty phone, which is right - an
  // advertisement for a page that appears to be broken is worse than no slide. But it
  // enforced that by throwing, which made every caller responsible for having run the
  // capture first, and that responsibility was invisible until somebody did not: a deck
  // now carries `siteSlug`, and `npm run deck-once` calls this function directly rather
  // than through renderDeck, so a perfectly good five-slide Lisbon deck died at the
  // render with an error about a screenshot nobody had asked it to take.
  //
  // So the fallback lives where the decision is made. No screenshot means this deck does
  // not have a site slide, which is exactly what withSiteShot would have concluded, and
  // closingSlidesFor then returns the follow ask on its own.
  const closable = { ...deck, siteSlug: siteShot ? deck.siteSlug : null };
  if (deck.siteSlug && !siteShot) {
    console.log('deck: no screenshot was supplied, closing on the follow ask instead');
  }
  const closing = closingSlidesFor(closable, { size, destHe: deck.where, replies: postConfig().igReplies });
  const items = [cover, ...deck.slides, ...closing];

  // The follow slide is drawn MINIMAL whatever the deck is, because the info
  // style is a name over a grid of measured fields and this slide has none: in
  // that style its reason would simply not be drawn. Minimal is name-plus-note,
  // which is exactly the shape of an ask and its why.
  const styleAt = (i) => (items[i].follow ? 'minimal' : style);

  // Instagram is drawn as cards, and a card pins its text: header to the top,
  // name to the bottom, same on every slide. So the placement search is skipped
  // for it — not as an optimisation but because moving the text is the thing
  // that would break it. A run of cards reads as a set because they line up,
  // and a headline that wandered to wherever the photograph was quietest would
  // undo exactly that. It does also mean the Instagram pass costs no image
  // analysis, which is most of what rendering a deck spends its time on.
  // A slide that will not be rendered is not analysed either. Image analysis is
  // most of what a TikTok deck costs, and asking about six slides to redraw one
  // cover would spend a whole deck's budget on it. The indices are carried
  // through rather than the filtered array's own, so `i === 0` still means the
  // cover and the answers still land back on the slide they describe.
  // The site slide carries a screenshot rather than a photograph, so there is
  // nothing for the placement search to measure and nothing it could tell us:
  // its type is at fixed positions in its own template. Analysing it would
  // hand analyseSlides a null src and spend a slot of the deck's image budget
  // asking where the words go on a picture that does not exist.
  // THE GROUND, chosen once for the whole deck.
  //
  // The slides with no photograph of their own - the closing slide, a text-led slide -
  // used to paint a flat gradient. They now borrow the deck's best-looking photograph
  // and blur it, so a deck reads as one post throughout rather than as photographs
  // followed by a grey card. Scored rather than taken first: see pickGround.
  const groundSrc = await pickGround(items.filter((s) => !s.site).map((s) => s.image?.src || null)).catch(() => null);
  const ground = groundSrc ? { src: groundSrc } : null;

  const analysed = items.map((_, i) => i).filter((i) => wanted(i) && !items[i].site);
  const measured = size === 'instagram' ? [] : await analyseSlides(
    analysed.map((i) => ({
      src: items[i].image?.src || null,
      place: i === 0 ? deck.titleHe : items[i].nameHe,
      blockH: blockHeight(items[i], { cover: i === 0, style: styleAt(i) }),
      blockW: blockWidth({ cover: i === 0, style: styleAt(i) }),
      // Instagram draws none of TikTok's furniture over the image, so the rail
      // exclusion that pushes text left on a TikTok slide would be inventing a
      // constraint here.
      rail: size === 'tiktok',
    })),
    {
      topSafe: geometry.topSafe,
      bottomSafe: geometry.bottomSafe,
      height: geometry.h,
      inkLum: INK_LUMINANCE[style],
      // The two zones the words are allowed into, from post-config.json: the
      // configured column, in the upper or the lower band. The measurement
      // still chooses between them and still chooses the colour — what it no
      // longer gets to do is put the type across the middle of the picture.
      // THE LOWER BAND ONLY. A deck slide is a photograph with a TITLE on it, and a
      // title is at the bottom - that is what makes six slides read as one set rather
      // than as six captions that each landed somewhere different.
      //
      // The upper band was there so the placement search could dodge a busy foreground,
      // and it worked: about half the slides came out with the type in the top third.
      // The cost was that the bottom-up gradient behind the text could only be a title
      // treatment on half of them, and on the other half it had to anchor to the top
      // instead - so the same deck carried two arrangements and looked it.
      //
      // The search still chooses WHERE in the lower band and which side, which is where
      // most of its value was anyway.
      confine: {
        x: postConfig().overlay.x,
        width: postConfig().overlay.width,
        bands: [postConfig().overlay.bands.lower],
      },
      // Where the background is. The pixel heuristic could not tell sky from a
      // snowfield — see the note in images/textbox.js — so the semantic half of
      // the question is asked, and the measurements then search inside the
      // answer. Skippable with DECK_TEXTBOX=off, which falls back to the pixel
      // detector and costs nothing.
      regionHint:
        process.env.DECK_TEXTBOX === 'off'
          ? null
          : (thumb, item) => findTextRegion(thumb, { place: item.place }),
    }
  );

  // The scrims, measured off the photograph exactly as a card's are.
  //
  // Skipping the placement search for Instagram was deliberate; skipping this
  // was not, and the two got skipped together. With nothing measured, the
  // fallbacks in deckInstagram fire on every slide — 0.97 at the foot of the
  // frame, 0.72 across the top — and those are the constants written for the
  // worst photograph there is, a white sky. At 0.97 the scrim is no longer a
  // shadow over the picture, it IS the picture: the bottom fifth of the slide
  // is a flat field of the scrim's own colour, the photograph contributes three
  // percent, and whatever cast the scrim has stops being a tint and becomes the
  // colour of the slide. Six slides of that in a carousel is what "the green"
  // was.
  //
  // Cards have been measuring theirs since render/index.js started doing it.
  // This is the same call on the same 4:5 frame, so a dark photograph now gets
  // the light scrim it needs instead of near-black over near-black.
  const scrims =
    size === 'instagram'
      ? await measureCardScrims(items.map((s, i) => (wanted(i) ? s.image?.src || null : null))).catch(() => [])
      : [];

  // Back onto the full-length axis, so spots[i] still describes slide i whether
  // or not its neighbours were rendered.
  const spots = items.map(() => null);
  analysed.forEach((i, k) => {
    spots[i] = measured[k] ?? null;
  });

  const out = [];
  for (const [i, slide] of items.entries()) {
    if (!wanted(i)) continue;
    const index = i + 1;
    // Measured or not at all — a slide whose photograph could not be sampled
    // keeps its image untouched and falls through to the worst-photograph
    // constants, which is what they are for.
    const drawn0 =
      scrims[i]?.bottom != null ? { ...slide, image: { ...slide.image, scrim: scrims[i] } } : slide;
    // THE BORROWED PHOTOGRAPH, for a slide that has none of its own.
    //
    // Every slide used to fall back to a flat gradient, which is the one thing on a
    // travel account that looks like a slide deck. A post is ABOUT somewhere and that
    // somewhere has pictures on its other slides, so the closing and text-led slides
    // borrow one and blur it past recognition. See photoTag in render/deckTemplates.js.
    const drawn = drawn0.image?.src ? drawn0 : { ...drawn0, groundImage: ground };
    // Same content, two design languages. The TikTok slide is built to be read
    // over a video player's furniture with no branding on it; the Instagram one
    // is a card, because it lands in a feed beside our own news cards and
    // should look like the same account made it.
    const html = slide.site
      ? renderSiteSlideHtml({ ...slide, shot: siteShot, coverImage: cover.image?.src || null }, { size })
      : size === 'instagram'
        ? renderInstagramSlideHtml(drawn, {
            cover: i === 0,
            style: styleAt(i),
            index,
            total: items.length,
            kicker: i === 0 ? '' : deck.titleHe,
            pillar: 'day',
          })
        : renderSlideHtml(
            { ...slide, blockH: blockHeight(slide, { cover: i === 0, style: styleAt(i) }) },
            { size, cover: i === 0, style: styleAt(i), spot: spots[i] }
          );
    const rendered = await renderToJpeg(html, {
      stem: slideStem(deck.id, size, index),
      width: geometry.w,
      height: geometry.h,
      outDir,
    });
    out.push({
      ...rendered,
      index,
      cover: i === 0,
      // Which one is the closing slide, so a lab or a contact sheet can label it
      // as what it is rather than as a place called "עקבו".
      follow: Boolean(slide.follow),
      nameHe: i === 0 ? deck.titleHe : slide.nameHe,
      // Kept so a slide that came out wrong can be argued about with the
      // numbers that placed it rather than from memory.
      spot: spots[i] || null,
    });
  }

  return out;
}

/**
 * Both sizes, in the shape the publishers want.
 *
 * Returns { tiktok: [...], instagram: [...] } with each entry carrying the
 * public URL. A null url means CARD_PUBLIC_BASE_URL is unset, and both
 * publishers refuse on that rather than posting a broken image.
 */
export async function renderDeck(deck, { outDir = cardOutputDir(), sizes = ['instagram', 'tiktok'] } = {}) {
  // Only the sizes that will actually be posted.
  //
  // Both were rendered unconditionally, which was right when every deck went to
  // both platforms. Now the destination is chosen before the build, and
  // rendering the other platform's set is twelve screenshots nobody will ever
  // look at — on the one step of the pipeline that costs a browser.
  const want = sizes.filter((s) => SIZES[s]);
  if (!want.length) throw new Error(`renderDeck: no known size in [${sizes.join(', ')}]`);

  // The screenshot, ONCE, before either size is drawn — the same probe renderPlan
  // has always run, now that a deck can claim a page too.
  //
  // It is not optional politeness. renderSiteSlideHtml THROWS on a missing
  // screenshot rather than drawing an empty phone, deliberately (see the note at
  // the top of src/plan/sitePage.js: an advertisement for a page that appears to
  // be broken is worse than no slide). So the first site deck to reach this
  // function without a probe would not have produced a bad slide, it would have
  // failed the whole render. A failed capture clears `siteSlug` instead, which
  // puts the ordinary follow slide back and keeps every count in follow.js right
  // without either of them knowing this happened.
  const { deck: probed, shot: siteShot, why: siteWhy } = await withSiteShot(deck);
  if (siteWhy) console.log(`deck: no site slide (${siteWhy})`);

  const out = {};
  for (const size of want) out[size] = await renderDeckSize(probed, { size, outDir, siteShot });

  return {
    tiktok: out.tiktok || [],
    instagram: out.instagram || [],
    // Whether the close is the screenshot or the ordinary follow ask, so the
    // approval card can say which ending this post got rather than leaving it to
    // be discovered in the album. The plan's render has reported this since the
    // site slide shipped.
    siteSlide: Boolean(probed.siteSlug),
    // What the approval message shows you is what is about to be published —
    // the first requested size, which is the destination that was chosen. A
    // deck bound for Instagram should not be reviewed in the TikTok crop.
    preview: out[want[0]],
    urls: {
      tiktok: (out.tiktok || []).map((s) => s.url),
      instagram: (out.instagram || []).map((s) => s.url),
    },
  };
}

export { cardPublicUrl };
