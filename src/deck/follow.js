import { captionFollow } from '../hashtags.js';
import { postConfig } from '../postConfig.js';

// The closing slide of every slideshow: why to follow.
//
// Its own module, and the reason is who needs to know about it. The RENDERER
// draws it, the APPROVAL MESSAGE counts and prints it, and the PLAN checks the
// slide count against Instagram's ten before it renders anything. Left in
// render/deck.js, the second and third of those would have to import the
// renderer, which pulls a browser in behind it; left in format.js it would sit
// among the approval texts and be drawn by nobody.
//
// It is deliberately NOT a member of `deck.slides`. Everything that reads that
// array reads it as the places: the approval message lists a source per entry,
// the evidence report quotes them, countryMismatch checks their flags. A closing
// slide filed among them is a place with no country, no source and nothing to
// verify, and every one of those readers would have to learn to skip it.

/**
 * The closing slide for a deck, or null when it must not have one.
 *
 * THE ASK IS THE BIG LINE AND THE REASON IS THE NOTE. The same split askSlide
 * makes in src/plan/slides.js, for the same reason: what a viewer has to DO is
 * the point of the slide, what they get for it is why, and a reason can be read
 * second. It is also the only version that fits - the whole sentence on the name
 * line wraps to three lines and arrives as a paragraph.
 *
 * NULL WHEN THE DECK ALREADY ENDS ON AN ASK. A plan with the giveaway on closes
 * on "עקבו ותגיבו רומא" over "5 מכם מקבלים 30 יום פרימיום", which is a follow
 * ask with a better reason attached than anything in the pool. A second closing
 * slide under it asks twice for one thing and spends the last swipe doing it,
 * which is the rule planCaption already applies to the description.
 *
 * The photograph is BORROWED from the cover. A flat gradient after six
 * photographs reads as the post running out of material at exactly the moment it
 * asks for something, and the cover is far enough back that its picture reads as
 * a bookend rather than as a repeat - the argument tripDecks already made for the
 * two slides it bolts on.
 */
export function followSlideFor(deck) {
  if (!deck || (deck.slides || []).some((s) => s.ask)) return null;
  // Drawn per post by the caller and carried on the deck, so the slide and the
  // description name the SAME reason. Drawn here only when nothing did, which is
  // the labs, the tests, and any deck stored before this existed - a redraw of
  // one of those should still close properly rather than crash.
  const follow = deck.follow || captionFollow();
  return {
    nameHe: follow.askHe,
    nameEn: null,
    countryHe: null,
    // No flag. It is not a place - the same reason the total and the ask slides
    // of an itinerary carry none.
    flag: null,
    bullets: [{ text: follow.whyHe }],
    // No brackets around it. A place slide's note is an aside and is drawn
    // parenthesised for that reason; this one is the argument, and in brackets
    // it read as a footnote to the word above it.
    plainNote: true,
    fields: [],
    image: deck.coverImage || deck.slides?.[0]?.image || null,
    follow: true,
  };
}

/**
 * Does this deck close on the real page instead?
 *
 * A deck about a destination the site has a page for ends on a screenshot of
 * that page rather than on the generic follow ask: the ask is a sentence and
 * the screenshot is the thing the post is for. The follow line is not lost, it
 * moves to the description, which is where it costs the post nothing.
 *
 * KEYED ON A SLUG, AND THAT IS LOAD BEARING. This module is imported by the
 * approval message and by renderPlan's check against Instagram's ten-image
 * limit, and neither may pull a browser in behind it. A string on the deck is
 * something this file can read; the screenshot it stands for is not, and the
 * capture can still fail later without changing any of this arithmetic (see
 * the fallback note in src/plan/sitePage.js).
 */
export const hasSiteSlide = (deck) => Boolean(deck?.siteSlug);

/**
 * The words on the site slide, or null when this deck does not get one.
 *
 * Here rather than in the renderer for the same reason followSlideFor is: the
 * approval message has to be able to print what the last slide will say, and
 * the plan has to count it, and neither may import a browser to find out.
 *
 * THE LINE UNDERNEATH DIFFERS BY PLATFORM, AND NOT FOR STYLE. On Instagram,
 * with private replies on, a comment is a route to a link and the slide can
 * honestly promise one. On TikTok there is no such route, so it names where
 * the link is instead. Promising a DM on TikTok would be a promise nothing
 * could keep, which is the same failure the giveaway had.
 */
export function siteSlideFor(deck, { size = 'tiktok', destHe = null, replies = null } = {}) {
  if (!hasSiteSlide(deck)) return null;
  const cfg = postConfig().plans.sitePage || {};
  const dest = destHe || deck.where || '';
  const fill = (s) => String(s || '').replace(/\{dest\}/g, dest);

  const canDm = size === 'instagram' && Boolean(replies?.on);
  return {
    titleHe: fill(cfg.titleHe),
    noteHe: fill(cfg.noteHe),
    ctaHe: fill(canDm ? cfg.ctaDmHe : cfg.ctaBioHe),
    slug: deck.siteSlug,
    site: true,
  };
}

/**
 * Whether this deck gets a follow slide. The count, for anything adding up slides.
 *
 * The site slide REPLACES it rather than joining it. Two closing slides is two
 * asks on one post, which is the rule followSlideFor already applies to a plan
 * carrying the giveaway.
 */
export const hasFollowSlide = (deck) => !hasSiteSlide(deck) && Boolean(followSlideFor(deck));

/**
 * How many images a deck publishes: the cover, its places, and the close.
 *
 * One function because three places were adding this up by hand and one of them
 * was already wrong the moment a closing slide existed — renderPlan checks the
 * total against Instagram's limit of ten, and a carousel over it is rejected by
 * Instagram hours after the post was approved, by an error that names none of
 * this.
 */
export const publishedSlideCount = (deck) =>
  1 + (deck?.slides || []).length + (hasFollowSlide(deck) ? 1 : 0) + (hasSiteSlide(deck) ? 1 : 0);
