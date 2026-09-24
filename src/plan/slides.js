import { COUNTRIES, flagFor } from '../deck/flags.js';

// An itinerary, expressed as DECK SLIDES.
//
// The first version of this drew its own thing: a dark branded card with a
// timeline rail, chips and the wordmark at the top. It was legible and it was
// wrong on the feed — beside the account's own slideshows it read as a
// different account's post. A deck slide is a full-bleed photograph with a
// small typed line on the quiet part of it and nothing else, no panel and no
// branding, because that is what a photo post on this platform looks like when
// a person made it rather than a company.
//
// So a plan is now built AS a deck and rendered by the deck's own renderer.
// Nothing here draws anything: these functions return the slide shape
// render/deckTemplates.js already understands — nameHe, countryHe, flag,
// bullets, image — and render/deck.js measures the photographs and places the
// type exactly as it does for a real deck. The itinerary decides what the words
// are; the deck decides how they look.
//
// ONE STOP, ONE PHOTOGRAPH. That is the whole reason this shape works: a deck
// slide is one place and one line, and an itinerary is a list of places with
// one line each. It is also what makes the count awkward, which is the next
// note down.

/** ₪ 2,340 — grouped, because a number on a slide is read at a glance or not at all. */
export const shekels = (n) => Number(n || 0).toLocaleString('en-US');

/** What one day costs, summed from its own stops. */
export const dayTotal = (day) => day.stops.reduce((s, stop) => s + (stop.costIls || 0), 0);

/** Every stop of the plan, flattened, each carrying the day it belongs to. */
export const allStops = (plan) => plan.days.flatMap((day) => day.stops.map((stop) => ({ ...stop, day })));

/** The flag for a Hebrew country name, or null. Only the countries this channel posts about. */
export function flagForHebrew(countryHe) {
  const iso = Object.keys(COUNTRIES).find((k) => COUNTRIES[k] === String(countryHe || '').trim());
  return iso ? flagFor(iso) : null;
}

/** A price as it reads on a slide. A blank would look like an omission; 0 is an answer. */
const price = (n) => (n > 0 ? `${shekels(n)} ₪` : 'חינם');

/**
 * One stop, as a deck slide.
 *
 * The time goes on the NAME line and the price goes on the note line, which is
 * the only arrangement that fits all four facts into the two lines a minimal
 * deck slide has. It also reads in the right order: a viewer scrolling an
 * itinerary is looking for when and where first, and what it costs second.
 */
export const stopSlide = (stop, { flag = null } = {}) => ({
  nameHe: stop.timeHe ? `${stop.timeHe} · ${stop.nameHe}` : stop.nameHe,
  nameEn: stop.nameEn,
  countryHe: null,
  flag,
  // The price LEADS the note line. A deck's note is one short line and this one
  // is two facts, so it wraps — and when it wraps, whichever fact is second
  // gets broken across the line. A broken sentence still reads; a price with
  // its number on one line and its currency on the next does not.
  bullets: [{ text: `${price(stop.costIls)} · ${stop.noteHe}` }],
  fields: [],
});

/**
 * One day, as a single deck slide — the Instagram set's unit.
 *
 * INSTAGRAM TAKES TEN IMAGES. A four-day plan at one stop per slide is
 * nineteen, so the TikTok set simply cannot be posted there, and the two ways
 * of fitting it are to truncate the itinerary or to summarise it. Truncating
 * publishes a plan that stops on day two with no indication that it did, which
 * is the same broken promise as a hook that counts three and delivers two.
 *
 * So Instagram gets a day per slide: the day's title, its stops named in order
 * on one line, and its own subtotal. Same photographs — a day's slide takes its
 * first stop's picture — same plan, fewer slides. That is the bargain the deck
 * already makes between its two sizes, extended from "two designs" to "two
 * lengths", and it is stated on the approval card so nobody discovers it from
 * the feed.
 */
export const daySlide = (day, { flag = null, dayLabelHe = 'יום' } = {}) => ({
  nameHe: `${dayLabelHe} · ${day.titleHe}`,
  nameEn: day.stops[0]?.nameEn || null,
  countryHe: null,
  flag,
  bullets: [{ text: `${day.stops.map((s) => s.nameHe).join(' · ')} · ${price(dayTotal(day))}` }],
  fields: [],
  image: day.stops[0]?.image || null,
});

// NO FLAG on the last two slides, and it is not an oversight.
//
// A deck's flag says which country the PLACE on this slide is in. The total and
// the ask are not places — "525 ₪ לאדם 🇮🇹" says nothing, and at this type size
// the flag takes a line of its own, so it is a line of the slide spent on
// decoration. It stays on the stop and day slides, where it means what it says.

/** The total, as a slide. A number this size is the whole line. */
export const totalSlide = (plan, text) => ({
  nameHe: `${shekels(plan.total)} ₪ ${text.perPersonHe}`,
  nameEn: null,
  countryHe: null,
  flag: null,
  bullets: text.totalNoteHe ? [{ text: text.totalNoteHe }] : [],
  fields: [],
});

/**
 * The follow ask, as a slide.
 *
 * The ACTION on the name line and the PRIZE under it, which is the only split
 * that fits. The first version put the whole sentence in the note — "עקבו
 * ותגיבו רומא — 5 מכם מקבלים 30 יום פרימיום" — and a deck's note is one small
 * line, so it wrapped to three and arrived as a paragraph in brackets.
 *
 * Splitting it also puts the instruction where the eye goes first. What a
 * viewer has to DO is the point of the slide; what they get for it is the
 * reason, and a reason can be read second.
 */
export const askSlide = (giveaway) => ({
  nameHe: giveaway.actionHe,
  nameEn: null,
  countryHe: null,
  flag: null,
  bullets: [{ text: giveaway.prizeHe }],
  fields: [],
});

/**
 * The two slide sets, as deck-shaped objects the deck renderer accepts.
 *
 * `full` is every stop and goes to TikTok, which takes 35 photos. `short` is a
 * slide per day and goes to Instagram, which takes 10. Both open on the same
 * cover and close on the same total and ask, and both draw from the same
 * photographs — nothing extra is fetched for the second set.
 *
 * The id is prefixed so the files on disk say what they are. render/deck.js
 * names every slide `deck-<id>-<size>-<nn>`, and a directory of `deck-4f2a…`
 * files that are actually itineraries is a directory nobody can read.
 */
export function tripDecks(plan, { text, giveaway = null }) {
  const flag = flagForHebrew(plan.dest.country);
  const cover = {
    titleHe: text.hookHe,
    // The phrase the cover colours. It is a substring of the title or it is
    // ignored — see coverTitle — so it is built from the same two facts the
    // hook was built from rather than written separately.
    emphasisHe: `${plan.days.length} ימים ב${plan.dest.he}`,
  };

  // The last two slides carry a photograph too, and they borrow rather than
  // fetch one. A flat gradient after thirteen photographs reads as the post
  // running out of material at exactly the moment it asks for a follow.
  //
  // WHICH pictures is the whole of the decision: the total takes the cover's
  // and the ask takes the first stop's, so neither repeats the slide directly
  // before it. A deck never shows the same photograph twice for that reason,
  // and twelve slides of distance is far enough that this reads as a bookend
  // rather than as a repeat.
  const stops = allStops(plan);
  const total = { ...totalSlide(plan, text), image: plan.coverImage || stops[0]?.image || null };
  const ask = giveaway ? { ...askSlide(giveaway), image: stops[0]?.image || plan.coverImage || null } : null;
  const tail = [total, ...(ask ? [ask] : [])];

  const full = stops.map((stop) => ({ ...stopSlide(stop, { flag }), image: stop.image || null }));
  const short = plan.days.map((day, i) => daySlide(day, { flag, dayLabelHe: text.dayLabelFor(i + 1) }));

  const base = {
    id: `plan-${plan.id}`,
    titleHe: text.hookHe,
    idea: { emphasisHe: cover.emphasisHe },
    // The cover's own photograph, claimed before the stops take theirs, exactly
    // as a deck's is: opening on the picture the next slide shows reads as
    // running out of material.
    coverImage: plan.coverImage || null,
    // Minimal, not info. The info style prints the same four measured fields on
    // every slide, which is right for a deck of summits and wrong here — a stop
    // has a time, a price and a sentence, and they are already the two lines
    // minimal gives. See the note at the top of render/deckTemplates.js.
    style: 'minimal',
    where: plan.dest.he,
    category: 'מסלול AI',
  };

  return {
    full: { ...base, slides: [...full, ...tail] },
    short: { ...base, slides: [...short, ...tail] },
  };
}

/** Which of the two sets a size gets. Instagram's ten is the whole reason there are two. */
export const deckForSize = (decks, size) => (size === 'instagram' ? decks.short : decks.full);
