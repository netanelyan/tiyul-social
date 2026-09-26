import { captionFollow } from '../hashtags.js';

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

/** Whether this deck gets one. The count, for anything adding up slides. */
export const hasFollowSlide = (deck) => Boolean(followSlideFor(deck));

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
  1 + (deck?.slides || []).length + (hasFollowSlide(deck) ? 1 : 0);
