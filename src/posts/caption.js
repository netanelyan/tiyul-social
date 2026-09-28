import { postConfig } from '../postConfig.js';
import { hashtagLine, captionQuestion, followLine } from '../hashtags.js';
import { assertNoUrl } from '../format.js';
import { assertNoDm } from '../dmPromise.js';
import { line } from './voice.js';

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
  const always = postConfig().posts.alwaysTags;
  const drawn = hashtagLine(post, opts).split(' ').filter(Boolean);
  const fresh = drawn.filter((t) => !always.includes(t));
  const out = [...always, ...fresh].slice(0, Math.max(always.length, drawn.length));
  return out.join(' ');
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
    if (text) parts.push(String(text).trim());
  }

  // The tags are last whatever the shape says, because a tag block is where a reader
  // stops reading and anything under it is unread. A shape that puts them elsewhere
  // is a configuration mistake and this is where it is corrected rather than
  // published.
  const tags = parts.filter((p) => p.startsWith('#'));
  const body = parts.filter((p) => !p.startsWith('#'));
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
