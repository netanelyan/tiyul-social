import { postConfig } from '../postConfig.js';
import { hashtagsFor, captionQuestion, followLine, placeTag, destinationTag, tagAllowed } from '../hashtags.js';
import { assertNoUrl } from '../format.js';
import { assertNoDm } from '../dmPromise.js';
import { closingSlidesFor } from '../deck/follow.js';
import { line } from './voice.js';
import { hasFlightClaim } from './source.js';

export { FLIGHT_CLAIM } from './source.js';

// The description, built from a SHAPE rather than from one skeleton.
//
// WHAT WAS WRONG WITH THE OLD ONE. Every published caption in this project had the
// same four parts in the same order: a line, a question, sometimes an ask, the
// follow reason, the tags. The pools behind each part were varied and the SHAPE never
// was, so every post read as the same post. That is the template problem in the one
// place nobody looks at closely, and it is the reason a caption that is individually
// fine can still mark an account as automated.
//
// The flop's caption is the other half of the lesson: a long AI paragraph with
// leftover markdown asterisks in it. Nothing here is written by a model. Every part
// is either a pool entry, a filled format, or a verbatim line off the destination
// page - which is also why `line()` from ./voice.js runs over each part rather than
// over the joined string: a failure should name the part.

/**
 * The site ask, naming the destination.
 *
 * Deliberately NOT captionCta: that function decides between a pool draw and the
 * site line, and here the decision is already made by the caption shape. A `site`
 * part means the shape asked for the site line, and a post with no page simply drops
 * that part rather than falling back to a random ask - which would put an ask in a
 * shape that was not designed to carry one.
 */
export function siteLine({ siteSlug, destHe, target }) {
  if (!siteSlug || !destHe) return null;
  const cfg = postConfig();
  const canDm = target === 'instagram' && cfg.igReplies.on;
  const raw = canDm ? cfg.caption.siteCtaDmHe : cfg.caption.siteCtaBioHe;
  return raw ? String(raw).replace(/\{dest\}/g, destHe) : null;
}

/**
 * The tag block for a post: the always-on tags, the destination, then the pools.
 *
 * THE COUNT IS FIXED and the always-on tags replace pool draws rather than joining
 * them. hashtagsFor already makes this argument for the destination tag and it is
 * the same one: a post with a resolved country and a post without must publish the
 * same number of tags, or the one thing being measured changes for a reason that has
 * nothing to do with the measurement.
 *
 * Trimmed from the END, which is the niche pool. Broad tags lead because they are
 * where the first impressions come from, and `#פוריו` leads them because it is the
 * feed tag.
 */
export function tagsFor(post, opts = {}) {
  const always = postConfig().posts.alwaysTags.filter(tagAllowed);
  const drawn = hashtagsFor(post, { ...opts, placeHe: post.where });
  const out = [...always, ...drawn.filter((t) => !always.includes(t))];
  // Trimmed from the end, but never past the post's own destination: #פירנצה and
  // #איטליה are the two tags that are about this post, and the owner's rule is that
  // the destination is always tagged.
  const kept = new Set([...always, placeTag(post.where), destinationTag(post)].filter(Boolean));
  const count = Math.max(always.length, drawn.length);
  for (let i = out.length - 1; i >= 0 && out.length > count; i--) if (!kept.has(out[i])) out.splice(i, 1);
  return out.join(' ');
}

/** For comparison only: punctuation, emoji and spacing are not what a line says. */
const bare = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Does this caption line say what a slide line already says?
 *
 * The same words, or the caption line sitting inside a slide line (it adds nothing),
 * or a slide line of some length sitting inside the caption line with a few words
 * around it: "המסלול המלא לפירנצה, עם מפה, בלינק בביו" under a closing slide titled
 * "המסלול המלא לפירנצה" is the slide said again.
 */
export function repeatsSlideLine(captionLine, slideLine) {
  const c = bare(captionLine);
  const s = bare(slideLine);
  if (!c || !s) return false;
  if (c === s) return true;
  if (c.length >= 8 && s.includes(c)) return true;
  return s.length >= 12 && c.includes(s);
}

// Keys that hold no published words: ids, links, photographs and their credits.
const NOT_WORDS = new Set(['id', 'placeId', 'slug', 'siteSlug', 'url', 'src', 'image', 'images', 'bgImage', 'coverImage', 'shot', 'credit', 'provenance', 'nameEn', 'iso']);

/**
 * Every Hebrew line the viewer reads on the slides, the closing slide included.
 *
 * The closing slide is not in `post.slides` (see closingSlidesFor for why), so it is
 * asked for here exactly as the renderer asks for it, with the post's own follow
 * reason rather than a fresh draw, or the comparison would be against a slide that
 * was never drawn.
 */
export function slideLines(post, { target = 'tiktok', follow = null } = {}) {
  const out = [];
  const walk = (node, key) => {
    if (node == null || NOT_WORDS.has(key)) return;
    if (typeof node === 'string') {
      if (/[֐-׿]/.test(node)) out.push(node);
      return;
    }
    if (Array.isArray(node)) return node.forEach((v) => walk(v, key));
    if (typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, k);
  };
  walk(post?.slides || [], 'slides');
  const closing = closingSlidesFor(
    { ...post, follow: follow || post?.follow || undefined },
    { size: target === 'instagram' ? 'instagram' : 'tiktok', destHe: post?.siteDestHe || post?.where, replies: postConfig().igReplies }
  );
  walk(closing, 'closing');
  return out;
}

/**
 * One caption, from one shape.
 *
 * `shape` is the ordered list of part names from post-config.json. A part that
 * produces nothing is skipped rather than substituted, which is what keeps the
 * shapes honest: `toolfirst` on a destination with no page is four parts rather than
 * five, and that is a real variation rather than a hole.
 *
 * `titled` is Instagram, which has no title field on a carousel and so must open
 * with the hook. TikTok carries the title separately, so repeating it there would
 * spend the first line on something the viewer read two centimetres higher - the
 * same split a deck's two captions make.
 */
export function buildCaption(post, { shape, target = 'tiktok', titled = false, question = null, follow = null } = {}) {
  const cfg = postConfig().posts;
  const parts = [];
  const asked = [];

  for (const part of shape.parts) {
    let text = null;
    switch (part) {
      case 'hook':
        // On TikTok the hook is the post TITLE and is not repeated; the pin takes
        // its place, because it is the one thing the slides cannot say and the thing
        // somebody searching matches on.
        text = titled
          ? post.captionHookHe || post.titleHe
          : `📍 ${post.where}${post.countryHe && post.countryHe !== post.where ? `, ${post.countryHe}` : ''}`;
        break;
      case 'practical':
        text = post.practicalHe || null;
        break;
      case 'save':
        text = cfg.saveAskHe;
        break;
      case 'site':
        // The destination the LINK goes to, not the post's subject. On an `instead`
        // post those differ on purpose - it argues about Rhodes and links to Crete -
        // and getting this wrong published "המסלול המלא לרודוס" pointing at a page
        // that does not exist, which is the one thing the site ask must never do.
        text = siteLine({ siteSlug: post.siteSlug, destHe: post.siteDestHe || post.where, target });
        break;
      case 'question':
        text = question ?? captionQuestion();
        break;
      case 'signoff':
        text = post.signoffHe || null;
        break;
      case 'follow':
        text = followLine(follow);
        break;
      case 'tags':
        text = tagsFor(post);
        break;
      default:
        text = null;
    }
    // NO FLIGHT CLAIM IN A CAPTION until the flight data is verified; see
    // FLIGHTS_VERIFIED in ./source.js. A part that carries one is dropped rather than
    // published. A question is not a claim. A tag like #טיסות is not one either, and
    // is kept out anyway, by tagAllowed in ../hashtags.js.
    if (!text || (part !== 'tags' && hasFlightClaim(text))) continue;
    (part === 'question' ? asked : parts).push(String(text).trim());
  }

  // NOTHING A SLIDE ALREADY SAYS, the owner's rule of 2026-10-11. Florence's caption
  // opened on "מי היה שם ויכול להגיד אם זה מדויק?", which is also the last line of
  // slide 11: the first line under the post spent on something the viewer reads
  // anyway. A part that repeats a slide line is dropped, the question included, and
  // the caption then opens on whatever part is next.
  const onSlides = slideLines(post, { target, follow });
  const fresh = (p) => !onSlides.some((s) => repeatsSlideLine(p, s));

  // The tags are last whatever the shape says, because a tag block is where a reader
  // stops reading and anything under it is unread. A shape that puts them elsewhere
  // is a configuration mistake and this is where it is corrected rather than
  // published.
  //
  // THE QUESTION ONCE, AT THE END of what is read, the same rule: never the opening,
  // and never twice. A shape that lists it earlier is corrected here like the tags.
  const tags = parts.filter((p) => p.startsWith('#'));
  const body = [];
  for (const p of [...parts.filter((x) => !x.startsWith('#')), ...asked.slice(0, 1)]) {
    if (fresh(p) && !body.some((b) => bare(b) === bare(p))) body.push(p);
  }
  for (const [i, p] of body.entries()) line(p, { where: `caption.${shape.id}[${i}]` });

  const text = [...body, ...tags].join('\n\n').trim();
  return assertNoDm(assertNoUrl(text, `the ${target} description`), `the ${target} description`);
}

/**
 * Both captions of a post, from one shape.
 *
 * ONE SHAPE FOR BOTH PLATFORMS, and one draw of the question and the follow line.
 * Two draws would give a post whose Instagram caption asks one thing and whose TikTok
 * description asks another, which is not variation - it is one post apparently
 * written by two people, and it is the bug the deck's single hook draw already fixed
 * once.
 */
export function captionsFor(post, { shape, question = null, follow = null } = {}) {
  const q = question ?? captionQuestion();
  return {
    instagram: buildCaption(post, { shape, target: 'instagram', titled: true, question: q, follow }),
    tiktok: buildCaption(post, { shape, target: 'tiktok', titled: false, question: q, follow }),
    shape: shape.id,
  };
}

/**
 * Do two captions open the same way, or share a shape?
 *
 * Exported because it is the assertion, not a helper. The rotation in ./types.js
 * decides the shapes and the store remembers them, but the thing that actually has
 * to be true is about the finished text - and the finished text is what a selftest
 * can hold two consecutive posts against.
 */
export function captionsRepeat(a, b) {
  const open = (t) => String(t || '').split('\n')[0].trim();
  const reasons = [];
  if (a?.shape && a.shape === b?.shape) reasons.push(`the same shape (${a.shape})`);
  if (open(a?.instagram) && open(a.instagram) === open(b?.instagram)) reasons.push('the same opening line');
  return reasons;
}

/**
 * New captions for a post that is already built, from the caption code as it is now.
 *
 * The slides are not touched: nothing is fetched, nothing is rendered, and the id,
 * which is keyed on the slides, stays the same. It is how a caption rule reaches a
 * post that is waiting for approval without rebuilding a post the owner has already
 * looked at. The shape, the follow reason and the question are the post's own: the
 * question is read back off the closing slide where the type asks it there, and off
 * the old caption otherwise.
 *
 * THE TAGS ARE THE POST'S OWN, corrected rather than redrawn: a tag the rules now
 * refuse goes, the destination comes in beside its country, and only a gap left
 * after that is filled from a fresh draw. Redrawing all five would change tags
 * nothing was wrong with, on a post the owner has already read.
 */
export function recaption(cand) {
  const post = cand?.deck;
  if (!post?.slides?.length) throw new Error('recaption: this candidate has no slides');
  const shape = postConfig().posts.captions.find((c) => c.id === cand.captionShape);
  if (!shape) throw new Error(`recaption: unknown caption shape "${cand.captionShape}"`);
  const onSlide = post.slides.flatMap((s) => s.lines || []).filter((l) => l?.mark && /\?\s*$/.test(l.text || '')).pop()?.text;
  const inCaption = String(cand.tiktokCaption || cand.instagramCaption || '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => !l.startsWith('#') && /\?\s*$/.test(l));
  const tagged = { ...post, slides: post.slides.map((s) => ({ ...s, countryHe: post.countryHe })) };
  const captions = captionsFor(tagged, { shape, question: onSlide || inCaption || '', follow: post.follow || null });
  const instagram = keepTags(captions.instagram, cand.instagramCaption, tagged);
  return {
    ...cand,
    instagramCaption: instagram,
    tiktokCaption: keepTags(captions.tiktok, cand.tiktokCaption, tagged),
    channelCaption: instagram,
    captionShape: captions.shape,
  };
}

/** The new caption's body over the old caption's tags, corrected. See recaption. */
function keepTags(fresh, old, post) {
  const tagsOf = (c) => (String(c || '').trim().split('\n\n').pop() || '').split(/\s+/).filter((t) => t.startsWith('#'));
  const drawn = tagsOf(fresh);
  const out = tagsOf(old).filter(tagAllowed);
  if (!out.length) return fresh;
  const place = placeTag(post.where);
  const country = destinationTag(post);
  if (country && !out.includes(country)) out.push(country);
  if (place && !out.includes(place)) out.splice(country ? out.indexOf(country) : out.length, 0, place);
  const kept = new Set([...postConfig().posts.alwaysTags, place, country].filter(Boolean));
  for (let i = out.length - 1; i >= 0 && out.length > drawn.length; i--) if (!kept.has(out[i])) out.splice(i, 1);
  for (const t of drawn) if (out.length < drawn.length && !out.includes(t)) out.push(t);
  const body = String(fresh).trim().split('\n\n').filter((p) => !p.startsWith('#'));
  return [...body, out.join(' ')].join('\n\n');
}
