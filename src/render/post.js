import { renderToJpeg, cardOutputDir, cardPublicUrl } from './index.js';
import { renderPostSlideHtml, geometryFor } from './postSlides.js';
import { renderSiteSlideHtml } from './siteSlide.js';
import { closingSlidesFor } from '../deck/follow.js';
import { postConfig } from '../postConfig.js';
import { withSiteShot } from '../plan/sitePage.js';
import { planLegibility, assertLegible, TEXT_BOXES } from './legibility.js';

// A post of the five new types, to files on disk.
//
// WHY NOT renderDeckSize.
//
// A deck is one kind of slide repeated: a photograph with a measured line on it.
// Everything in render/deck.js follows from that - it samples every photograph in
// one pass, finds the quiet region, scores the ink against it, and places the type.
// That whole apparatus is the right answer for a deck and the wrong question for
// these: a checklist has no photograph to measure, a collage has four, and a label
// is deliberately at a fixed position because that is what TikTok's own text tool
// does (see the note at the top of render/postSlides.js).
//
// So this renderer is much simpler, and the simplicity is the point:
//
//   - no image analysis at all, which is most of what a deck costs. A twenty-slide
//     list post renders for the price of twenty screenshots rather than twenty
//     screenshots plus twenty thumbnail decodes plus a vision call each.
//   - one dispatch on `slide.look`, so a new look is a template plus a key.
//   - the same closing-slide list every other kind uses, from deck/follow.js, so a
//     post cannot disagree with publishedSlideCount about how long it is.
//
// The FRAME is this renderer's own variable and nothing else has one. `tall` is
// 9:16 and `phone` is 3:4; a post carries whichever it drew and both sizes of the
// same post use it, because the two aspect ratios are a test of the post and not of
// the slide.

/** Deterministic and sortable, so the order on disk is the order on the post. */
export const postSlideStem = (id, size, index) => `post-${id}-${size}-${String(index).padStart(2, '0')}`;

/** Instagram publishes at most ten images in a carousel, and rejects the eleventh. */
export const IG_MAX = 10;

// The cover, the slides, and the one closing slide every post carries.
const IG_BUDGET = IG_MAX - 1;

/**
 * Whether fitTo can make these slides an Instagram carousel, asked without throwing.
 *
 * For the one post of a type that USUALLY fits and this time does not: a verdict is
 * seven to ten slides, and the day a page has more to quote it is eleven. Which slides
 * a post has is only known once it is built, so this is asked by the builder before it
 * renders, and the answer narrows that one post to TikTok instead of losing it on both.
 */
export const fitsInstagram = (slides = []) =>
  slides.length <= IG_BUDGET || slides.filter((s) => !s.optional).length <= IG_BUDGET;

/**
 * The slides that fit the platform, and what it costs to make them fit.
 *
 * INSTAGRAM'S TEN IS A HARD LIMIT AND IT IS ENFORCED HOURS LATE. A carousel over ten
 * is refused at publish time, which is after the post was approved, by an error that
 * names none of this - the same failure renderPlan's own check was written for. TikTok
 * takes 35, so this never trims there.
 *
 * TWO WAYS TO FIT, AND THE ORDER MATTERS.
 *
 *   First, drop the OPTIONAL slides. On a plan post those are the collages between the
 *   days: they are the breath in the post rather than its content, and a plan without
 *   them is the same itinerary read a little faster. Nothing is lost that the post
 *   promised.
 *
 *   Then, refuse. A list post is twenty-one slides because its hook says "20 דברים",
 *   and there is no honest nine-slide version of that - trimming it publishes a post
 *   whose cover promises twice what the carousel delivers. So a type whose content
 *   cannot shrink does not go to Instagram at all, and `platformsFor` in
 *   src/posts/types.js is where that is declared rather than discovered here.
 *
 * Throwing is the correct end of that road: it means a type was routed to a platform
 * its own config says it does not go to, which is a configuration error and not
 * something to paper over by shipping half a post.
 */
export function fitTo(slides, size, type = null) {
  if (size !== 'instagram') return slides;
  if (slides.length <= IG_BUDGET) return slides;

  const trimmed = slides.filter((s) => !s.optional);
  if (trimmed.length <= IG_BUDGET) return trimmed;

  throw new Error(
    `a ${type || 'post'} is ${slides.length} slides and an Instagram carousel takes ${IG_MAX} - ` +
      'this type should not be routed to Instagram (see posts.types[].platforms in post-config.json)'
  );
}

/**
 * Every slide of a post at one size.
 *
 * `only` re-renders some slides by 1-based index, exactly as renderDeckSize's does
 * and for the same reason: a rendering fault found after the post was built should
 * be repairable without re-fetching twenty photographs.
 */
export async function renderPostSize(
  post,
  { size = 'tiktok', outDir = cardOutputDir(), only = null, siteShot = null } = {}
) {
  const frame = post.frame || 'tall';
  const geo = geometryFor(size, frame);
  const wanted = (i) => !only || only.includes(i + 1);

  // The cover is a slide like any other here, which it is not on a deck.
  //
  // A deck's cover is the same template as its places with `cover: true` flipped,
  // because it IS the same thing: a photograph with a bigger line on it. A post's
  // cover is built by the post type - a list post's cover counts, a verdict post's
  // cover carries a score - so the builder produces it as slide one and this
  // renderer does not need to know anything about it.
  // WHICH DESTINATION THE CLOSING SLIDE NAMES, which is not always the post's own.
  //
  // An `instead` post is about Rhodes and closes on the page for Crete, because Rhodes
  // is exactly the destination the site does not cover - that is the argument the post
  // is making. So the close names the page it actually links to rather than the post's
  // subject, and `siteDestHe` is how the builder says which.
  const closing = closingSlidesFor(post, {
    size,
    destHe: post.siteDestHe || post.where,
    replies: postConfig().igReplies,
  });

  // A closing slide with no look is the ordinary follow ask, which reaches here only
  // when the screenshot failed - none of these types is supposed to end on one. Drawn
  // as a sheet rather than refused: the alternative is that a Commons outage or a slow
  // page turns a finished twenty-slide post into a build failure, and a post that ends
  // on a plain "עוד כאלה? תעקבו" is a worse post rather than a broken one.
  const drawn = closing.map((s) =>
    s.site || s.look
      ? s
      : { look: 'sheet', titleHe: s.nameHe, lines: [{ text: s.bullets?.[0]?.text, mark: true }], image: post.slides[0]?.image || null, follow: true }
  );
  const items = [...fitTo(post.slides, size, post.type), ...drawn];

  // THE CONTRAST GATE, RUN IN ONE PASS BEFORE ANY SLIDE IS DRAWN.
  //
  // Measured first and drawn second, which is the order render/deck.js uses and for the
  // same reason: how dark the treatment behind the type has to be is a property of the
  // photograph, and the template cannot know it from the HTML.
  //
  // EVERY LOOK THAT PUTS TYPE ON A PHOTOGRAPH IS MEASURED, not just the two that were
  // measured before. A route card and a checklist blur their own ground, and "blurred"
  // is not "dark" - a blurred white-sky beach is still a white sky, and the type on it
  // still disappears. The treatment the gate returns is per look, which is why the box
  // comes from TEXT_BOXES rather than from one band constant shared by all of them.
  //
  // The gate may answer `band` instead of `veil`, which CHANGES THE SLIDE rather than
  // dimming it: see src/render/legibility.js for why a cap on a wash is the wrong answer
  // to a photograph a wash cannot carry, and why neither answer is ever a panel.
  const boxFor = (s) => {
    if (s.look === 'label') return TEXT_BOXES[`label.${s.cover ? 'cover' : s.band === 'mid' ? 'mid' : 'lower'}`];
    return TEXT_BOXES[s.look] || TEXT_BOXES['label.lower'];
  };
  // The CSS brightness each look already applies to its own ground, so the gate decides
  // against the picture as rendered rather than as filed. 1 means "shown as it is".
  // These MUST match the `brightness()` each look applies to its own ground in
  // render/postSlides.js. They were lowered together when the grounds were softened:
  // measuring against 0.42 while the template renders at 0.72 sizes every tint for a
  // picture darker than the one on screen, which is the same class of error as not
  // measuring at all.
  const GAIN = { label: 1, collage: 1, route: 0.78, notes: 0.72, roll: 1 };
  const LIT = new Set(Object.keys(GAIN));
  const plans = await planLegibility(
    items.map((s, i) => {
      const src = s.look === 'route' || s.look === 'notes' ? s.bgImage?.src || s.stops?.[0]?.image?.src || s.image?.src : s.image?.src;
      if (!wanted(i) || !LIT.has(s.look) || !src) return null;
      return { src, box: boxFor(s), lines: s.look === 'label' ? 3 : 6, gain: GAIN[s.look] };
    })
  );
  // Throws rather than shipping a slide under target. It cannot fire on a measured
  // slide - the plate always reaches target - so what it catches is the measurement
  // path silently breaking, which is exactly how the last version failed.
  assertLegible(plans, { where: `post ${post.id} (${size})` });

  const out = [];
  for (const [i, slide] of items.entries()) {
    if (!wanted(i)) continue;
    const index = i + 1;
    const html = slide.site
      ? renderSiteSlideHtml(
          { ...slide, shot: siteShot, coverImage: post.slides[0]?.image?.src || null },
          // The site slide has its own two frames and neither is 3:4. Drawn at the
          // deck sizes it has always used, because it is a phone in the middle of a
          // blurred photograph and that composition does not survive being asked to
          // fit a shorter frame - and a closing slide that is the wrong shape for
          // its post is more obvious than one that is the wrong aspect ratio for
          // the platform, which the platform will letterbox either way.
          { size }
        )
      : await renderPostSlideHtml({ ...slide, legible: plans[i] ?? null }, { size, frame });

    const rendered = await renderToJpeg(html, {
      stem: postSlideStem(post.id, size, index),
      width: geo.w,
      height: geo.h,
      outDir,
    });

    out.push({
      ...rendered,
      index,
      cover: i === 0,
      // Never true on a post of these types: none of them has a follow slide, by
      // design. Carried anyway because the approval card, the album send and the
      // labs all read it off a slideshow's slides and a missing field would read as
      // undefined rather than as false.
      follow: Boolean(slide.follow),
      site: Boolean(slide.site),
      look: slide.look || (slide.site ? 'site' : null),
      nameHe: slide.titleHe || slide.nameHe || null,
    });
  }

  return out;
}

/**
 * Both sizes, in the shape the publishers want.
 *
 * Identical in shape to renderDeck's return, deliberately: `deck.urls.tiktok` is
 * what the carousel publishers read, and a post that invented its own field names
 * would need every one of them changed.
 */
export async function renderPost(post, { outDir = cardOutputDir(), sizes = ['instagram', 'tiktok'] } = {}) {
  const want = sizes.filter((s) => s === 'tiktok' || s === 'instagram');
  if (!want.length) throw new Error(`renderPost: no known size in [${sizes.join(', ')}]`);

  // The screenshot once, before anything counts slides. See the note in renderDeck.
  const { deck: probed, shot: siteShot, why } = await withSiteShot(post);
  if (why) console.log(`post: no site slide (${why})`);

  const out = {};
  for (const size of want) out[size] = await renderPostSize(probed, { size, outDir, siteShot });

  return {
    tiktok: out.tiktok || [],
    instagram: out.instagram || [],
    preview: out[want[0]],
    urls: {
      tiktok: (out.tiktok || []).map((s) => s.url),
      instagram: (out.instagram || []).map((s) => s.url),
    },
    slideCounts: Object.fromEntries(want.map((s) => [s, out[s].length])),
    siteSlide: Boolean(probed.siteSlug),
    // Which aspect ratio this post was drawn at, echoed back so the candidate
    // records what was actually rendered rather than what was asked for.
    frame: post.frame || 'tall',
  };
}

export { cardPublicUrl, geometryFor };
