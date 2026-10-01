// The destination page, in the shape the five post types read it.
//
// One place where the site's JSON is turned into the facts a slide can carry, so
// the builders never touch a raw API field and there is one answer per question:
// how long a visit takes, whether it is free, whether the kosher entry may name
// its supervision, how far apart two stops are.
//
// WHY THE BUILDERS MUST NOT READ THE API DIRECTLY. Almost every honesty rule in
// this change is a rule about ONE field. `priceLevel` 0 may be printed and 1, 2, 3
// may not. `durationMin` may be printed in bands and never to the minute.
// `kashrut.provenance.sourceType` decides whether a supervision body may appear at
// all. Five builders each reading `place.priceLevel` is five chances to print "₪₪"
// on a slide, and the guard would have to be written five times.

import { fetchCities, durationHe, CATEGORY_HE, KOSHER } from '../plan/site.js';

export { durationHe, CATEGORY_HE, KOSHER };

const BASE = process.env.TIYULPLUS_BASE || 'https://www.tiyulplus.com';

export class PostSourceError extends Error {
  constructor(message, { step, slug } = {}) {
    super(message);
    this.step = step;
    this.slug = slug;
  }
}

/**
 * One city, or null when the site has no page for it.
 *
 * Null rather than a throw for a miss, the same convention writeSitePlan uses: a
 * destination we do not cover is an ordinary answer, and the caller's next move is
 * to try another destination rather than to report a broken site.
 */
export async function loadCity(slug) {
  const clean = String(slug || '').trim().toLowerCase();
  if (!clean) return null;
  const city = (await fetchCities([clean])).get(clean);
  if (!city) return null;
  return { ...city, url: `${BASE}/destinations/${clean}`, slug: clean };
}

/* -------------------------------------------------------------------------- */
/* what a place is allowed to say about itself                                 */
/* -------------------------------------------------------------------------- */

/** Free to walk into, as a fact rather than as a band. See noteFor in plan/site.js. */
export const isFree = (place) => Number(place?.priceLevel) === 0;

/**
 * Whether this place's kosher supervision may be NAMED.
 *
 * THE ONE RULE THIS FILE EXISTS FOR.
 *
 * The site's `kashrut` object is careful about where it learned what it knows.
 * Some entries carry `provenance.sourceType: "community"` with a URL and a date it
 * was checked - the Prague community's own page, read on 2026-08-19. Others carry
 * `"legacy-unverified"` and a `legacySupervision` string like "גלאט, בהשגחת רבנות
 * פראג", which means the catalogue recorded that once and nobody has confirmed it.
 *
 * A slide that prints "בהשגחת רבנות פראג" off a legacy entry is making a kashrut
 * claim on behalf of a rabbinate, sourced to a note in our own database. That is
 * the single most consequential thing this pipeline could get wrong: somebody eats
 * there because a post said so. The prompt's rule is "never state a supervision
 * level the data doesn't carry", and this is the field that says whether it does.
 *
 * So: a legacy entry may be called a kosher restaurant, because the site lists it
 * as one, and may not name a body, a level or a hechsher.
 */
export const mayNameSupervision = (place) => {
  const k = place?.kashrut;
  if (!k || k.knowledge !== 'certified') return false;
  const from = String(k.provenance?.sourceType || '').toLowerCase();
  if (!from || from === 'legacy-unverified' || from === 'legacy') return false;
  return Array.isArray(k.certifications) && k.certifications.some((c) => c?.body);
};

/**
 * The kosher line for a place, as strong as the data allows and no stronger.
 *
 * Returns null for a place with no kosher status at all, which is most of them -
 * the caller prints nothing rather than printing "לא כשר", a claim nobody made.
 */
export function kosherLine(place) {
  const kosher = KOSHER.has(String(place?.category || '')) || place?.kashrut?.knowledge === 'certified';
  if (!kosher) return null;
  if (!mayNameSupervision(place)) {
    // Deliberately vague, and the vagueness is the honest part. The site lists it
    // under a kosher category; that is the whole of what can be said.
    return String(place?.category || '') === 'kosher-market' ? 'מכולת כשרה' : 'מסעדה כשרה';
  }
  const body = place.kashrut.certifications.find((c) => c?.body)?.body;
  const descriptors = place.kashrut.certifications.flatMap((c) => c?.descriptors || []).filter(Boolean);
  // The body, and a descriptor only when the same certification carried one.
  return [descriptors[0], `בהשגחת ${body}`].filter(Boolean).join(', ');
}

/**
 * The one line under a place name on a list or route slide.
 *
 * Built only from the site's own fields, and it is deliberately NOT noteFor from
 * plan/site.js: that one leads with the category, which is the right emphasis on
 * an itinerary where the reader is scanning for what kind of day it is, and the
 * wrong one on a numbered list where twenty slides reading "אתר היסטורי" is twenty
 * slides of the same word.
 *
 * ORDER IS THE DECISION, and it is by what changes somebody's plan:
 *
 *   1. the kosher line, where there is one. It is the reason this audience reads
 *      this account rather than an English one.
 *   2. free entry, because it changes whether you go.
 *   3. how long it takes, because it changes when.
 *
 * Two facts at most. A third wraps the line onto the photograph.
 */
export function placeLine(place, { withCategory = false } = {}) {
  const bits = [];
  const kosher = kosherLine(place);
  if (kosher) bits.push(kosher);
  if (isFree(place)) bits.push('כניסה חופשית');
  else {
    const d = durationHe(place?.durationMin);
    if (d) bits.push(d);
  }
  if (withCategory && bits.length < 2) {
    const cat = CATEGORY_HE[String(place?.category || '').trim()];
    if (cat) bits.push(cat);
  }
  return bits.slice(0, 2).join(' · ') || null;
}

/* -------------------------------------------------------------------------- */
/* how far apart two stops are                                                 */
/* -------------------------------------------------------------------------- */

/** Kilometres between two places, from the coordinates the site publishes. */
export function kmBetween(a, b) {
  const ok = (p) => Number.isFinite(Number(p?.lat)) && Number.isFinite(Number(p?.lng));
  if (!ok(a) || !ok(b)) return null;
  const R = 6371;
  const rad = (d) => (Number(d) * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * The distance between two stops, said the way a person says it - and HEDGED.
 *
 * The number is a straight line between two points a database holds, and nobody
 * walks in a straight line. On a Prague day the real walk between two stops 600
 * metres apart is nearer 800, because there is a river and a bridge. So every
 * answer carries a ~ and every answer is rounded coarsely: "~600 מ׳" is honest
 * about being an estimate in a way "612 מ׳" is not, and "612 מ׳" is the kind of
 * number that makes a viewer trust the next thing on the slide less rather than
 * more.
 *
 * Over the walking threshold it stops giving a distance at all and says "נסיעה".
 * A straight-line kilometre count between two points three kilometres apart tells
 * somebody nothing they can act on; that it is not a walk tells them everything.
 */
export function distanceHe(a, b, { walkMaxKm = 3 } = {}) {
  const km = kmBetween(a, b);
  if (km == null) return null;
  if (km > walkMaxKm) return 'נסיעה קצרה';
  // ONE UNIT DOWN A WHOLE DAY, and the unit is metres.
  //
  // The first version switched at a kilometre, so a single route card read "~300 מ׳",
  // then "~1.4 ק״מ", then "~800 מ׳" - three numbers a reader has to convert in their
  // head to compare, on a slide whose entire job is to say whether the day is walkable.
  // Everything under the walking threshold is metres now, rounded to the nearest
  // hundred, so the column reads 300, 600, 1,400, 800 and the comparison is free.
  if (km < 0.12) return 'ממש ליד';
  const metres = Math.round((km * 1000) / 100) * 100;
  return `~${metres.toLocaleString('en-US')} מ׳`;
}

/* -------------------------------------------------------------------------- */
/* the itinerary                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The site's itinerary as days of real places, in the site's own order.
 *
 * DAY NUMBERS ARE THE SITE'S, never renumbered. A viewer who opens the page after
 * seeing the post has to find יום 3 saying what יום 3 said - the argument
 * planDaysFrom makes, for the same reason, and the reason a thin day stops the
 * plan rather than being skipped over.
 */
export function daysOf(city, { max = 5, stopsMin = 3, stopsMax = 5 } = {}) {
  const byId = new Map((city?.places || []).map((p) => [p.id, p]));
  const out = [];
  const dropped = [];

  for (const day of (city?.itinerary || []).slice().sort((a, b) => (a.day || 0) - (b.day || 0))) {
    if (out.length >= max) break;
    const stops = (day.placeIds || []).map((id) => byId.get(id)).filter(Boolean);
    if (stops.length < stopsMin) {
      dropped.push(`יום ${day.day}: ${stops.length} עצירות, צריך ${stopsMin} - המסלול נעצר כאן`);
      break;
    }
    out.push({
      n: day.day,
      titleHe: String(day.title || '').trim(),
      // The day's own tip, verbatim. Every itinerary day on every page checked has
      // one, and it is the most useful sentence on the whole post: "להתחיל מוקדם
      // בכיכר העיר העתיקה, לפני קבוצות המטיילים".
      noteHe: String(day.notes || '').trim() || null,
      stops: stops.slice(0, stopsMax),
      // What was cut, so the slide can say "ועוד 2" rather than silently
      // shortening the day. A viewer who opens the page and finds six stops on a
      // day the post showed four should have been told.
      more: Math.max(0, stops.length - stopsMax),
    });
  }
  return { days: out, dropped };
}

/**
 * The places a list post counts through, best first.
 *
 * `mustSee` is the site's own editorial flag and it is the right primary sort:
 * it is a human saying "if you only do one thing". Rating breaks the tie, and a
 * photograph is required - a numbered list slide is a photograph with a number on
 * it, and a place with no photograph has no slide to be number 7 of.
 *
 * KOSHER ENTRIES ARE PULLED FORWARD rather than left to the sort. The site marks a
 * place kosher only where supervision was actually reported, which makes those
 * entries the one thing on the page this audience cannot get from an English
 * guide, and `mustSee` is about sightseeing so it never flags them.
 */
export function listPlaces(city, { want = 18, needPhoto = true } = {}) {
  const all = (city?.places || []).filter((p) => p?.name && (!needPhoto || p.photo));
  const score = (p) => (p.mustSee ? 100 : 0) + (Number(p.rating) || 0);
  const ranked = all.slice().sort((a, b) => score(b) - score(a));

  const kosher = ranked.filter((p) => KOSHER.has(String(p.category || '')));
  const rest = ranked.filter((p) => !kosher.includes(p));
  // One kosher entry near the top and any others in their ranked place. A list of
  // twenty that is half restaurants is a food post wearing a sightseeing title.
  const head = kosher.slice(0, 1);
  return [...head, ...rest, ...kosher.slice(1)].slice(0, want);
}

/* -------------------------------------------------------------------------- */
/* the verdict                                                                 */
/* -------------------------------------------------------------------------- */

// Where a verdict turns from what is good to what is not, and back.
//
// NINE DIFFERENT SEPARATORS, because a human wrote these and a human was right to.
// Across the pages checked: "חסרונות:", "החסרונות אמיתיים:", "החיסרון:", a bare
// mid-sentence "אבל", "יש כמה דברים שחייבים לדעת מראש", "כדאי להגיע עם הציפייה
// הנכונה", "אחד המאכזבים אם מגיעים עם ציפיות מאינסטגרם", and two that turn BACK to
// the good news at the end, "ובכל זאת," and "מנגד,".
//
// SO THE CONS ARE ONE CONTIGUOUS CUE-ANCHORED REGION, not a per-sentence
// classification. The first version tagged sentence by sentence and got two
// verdicts badly wrong in opposite directions: Bangkok's whole verdict is one
// sentence with the "אבל" in the middle of it, so the selling points were filed as
// drawbacks; and Bali states its drawbacks with no cue in the opening sentence, so
// fifteen clauses about traffic jams, queues at sunset and an industrialised dawn
// hike came back as things to recommend. The second is the one that matters - a
// drawback printed as a selling point is the post lying - and it is why the region
// starts at a cue and why an absent cue means the verdict post does not get built.
//
// The region ENDS at a turn-back cue, which is what keeps Sicily's closing "ובכל
// זאת, צפיפות האתרים ההיסטוריים כאן היא מהגבוהות באירופה" out of the drawbacks.
//
// Every string that reaches a slide is still a verbatim substring of the verdict.
// The cues decide which region to quote from; they never decide the words.
const CONS_CUE =
  /חסרונות|החיסרון|חסרון אחד|אבל |מצד שני|יש לדעת|חייבים לדעת|כדאי להגיע עם הציפייה|בתנאי ש|המאכזב/;
const PROS_CUE = /ובכל זאת|מנגד|ולמרות/;

/** Sentences, for a language whose sentences end in a full stop like everyone else's. */
const sentences = (text) =>
  String(text || '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * A quote's edges, cleaned. ONLY EVER REMOVES CHARACTERS FROM THE ENDS, which is
 * what keeps the result a verbatim substring of the source.
 *
 * Cutting a verdict at a cue lands mid-phrase, and the leftovers read as a
 * rendering bug on a slide: Sicily's pro came back as "סיציליה היא לא איטליה של
 * טוסקנה, ו" and Paris's as "יעד שקשה להיכשל בו," - a dangling conjunction and a
 * trailing comma. Hebrew attaches its conjunction to the following word, so a
 * split before that word leaves the letter stranded as a token of its own.
 */
const tidy = (s) =>
  String(s || '')
    .trim()
    // The author's own label for the section, which the slide is already headed
    // with. "חסרונות: העיר העתיקה עמוסה" under a slide titled "החסרונות" says the
    // word twice, and the second one is inside the quote.
    .replace(/^(?:ו?ה?חסרונות|ו?החיסרון|ו?חסרון)\s*(?:אמיתיים)?\s*:\s*/, '')
    // Punctuation at either end. The dashes are written as escapes rather than as
    // themselves: an em dash in the source of this project is banned outright, and a
    // literal one inside a character class is also the easiest thing in the file to
    // break - "[.–—-]" edited carelessly becomes "[.-—-]", which is not three
    // characters but the RANGE from "." to "—", quietly matching several hundred.
    .replace(/^[\s,;:.–—-]+/, '')
    .replace(/[\s,;:.–—-]+$/, '')
    // A one-letter Hebrew conjunction or preposition left on its own at either end.
    .replace(/(?:^|\s)[ובלמשכה]$/, '')
    .replace(/^[ובלמשכה](?=\s)/, '')
    .trim();

/** Where the clause containing `at` begins. Used to cut on a boundary, not mid-phrase. */
function clauseStart(text, at) {
  const before = text.slice(0, at);
  // The last boundary the author actually wrote: a stop, a semicolon, a comma, or
  // a spaced dash, whichever is nearest.
  const m = /[.;,]\s*|\s[–—-]\s*/g;
  let last = 0;
  for (const hit of before.matchAll(m)) last = hit.index + hit[0].length;
  return last;
}

/**
 * A long sentence as the clauses a slide can hold.
 *
 * Verdict sentences run to forty words - Sicily's drawbacks are one paragraph of
 * them - and a slide holds about twelve. Split on the semicolons and commas the
 * author already used, keep whatever lands in a readable range, and never join
 * anything: every piece is a contiguous run of the original, so it is still a
 * quote.
 */
export function clausesOf(text, { min = 14, max = 95 } = {}) {
  const out = [];
  const keep = (s) => {
    const t = tidy(s);
    if (t.length >= min && t.length <= max) out.push(t);
  };
  for (const sentence of sentences(text)) {
    const body = sentence.replace(/[.!?]+$/, '').trim();
    if (body.length <= max) {
      keep(body);
      continue;
    }
    // Semicolons first - the author used them to separate whole thoughts - then
    // commas, which separate items within one.
    let parts = body.split(/\s*;\s*/);
    if (parts.every((p) => p.length > max)) parts = body.split(/\s*,\s*/);
    for (const p of parts) keep(p);
  }
  return out;
}

/**
 * The verdict, split into what is good and what is not.
 *
 * Returns `{ score, prosHe, consHe, cued, full, source }`. Every entry in both
 * lists is a verbatim substring of `source`, which is the verdict and the tagline
 * concatenated - so a caller can assert the quote without knowing which field it
 * came from.
 *
 * `cued` is false when no drawback cue was found anywhere. That is NOT "this
 * destination has no drawbacks"; it is "this text does not say where they are",
 * and the verdict post refuses on it. The two must not print the same.
 *
 * THE PROS DO NOT COME FROM THE SAME PLACE AS THE CONS, and that asymmetry is
 * deliberate. The drawbacks live in the verdict and nowhere else, so they are
 * quoted from the cue-anchored region of it. The selling points live in `tagline`,
 * which is a field whose whole job is to say what a place is - structurally
 * positive, impossible to misread as a warning. The pre-cue part of the verdict is
 * used too, because it is usually the sharpest version ("טיסה ישירה של כ-4 שעות
 * ומחירים סבירים"), but the tagline is what guarantees there is always something.
 */
export function verdictOf(city) {
  const full = String(city?.editorialRating?.verdict || '').trim();
  const tagline = String(city?.tagline || '').trim();
  if (!full && !tagline) return null;

  // The cons region: from the first drawback cue to the turn-back, or to the end.
  //
  // Widened BACK to the start of the cue's own clause, so the quote reads as the
  // author wrote it rather than starting mid-phrase. Bali's cue is the word
  // "המאכזבים", and cutting at the cue produced the drawback "המאכזבים אם מגיעים
  // אליה עם ציפיות מאינסטגרם" - true, and beginning in the middle of a noun. From
  // the clause boundary it is "ובדיוק בגלל זה היא גם אחד המאכזבים אם מגיעים אליה
  // עם ציפיות מאינסטגרם", which is a sentence a person could read aloud.
  const hit = full.search(CONS_CUE);
  const cued = hit >= 0;
  const at = cued ? clauseStart(full, hit) : -1;
  const head = cued ? full.slice(0, at) : full;
  let tail = cued ? full.slice(at) : '';
  const back = tail.search(PROS_CUE);
  if (back > 0) tail = tail.slice(0, back);

  return {
    score: Number(city?.editorialRating?.score) || null,
    // The verdict's own opening first, because it is the specific version, then the
    // tagline, which is the guaranteed one. Deduplicated: a short verdict whose
    // whole head is one clause should not produce it twice.
    prosHe: [...new Set([...clausesOf(head), ...clausesOf(tagline)])],
    consHe: clausesOf(tail),
    cued,
    full,
    // What every quote above is a substring of, for the caller's assertion.
    source: [full, tagline].filter(Boolean).join('\n'),
  };
}

/**
 * The first sentence of a practical paragraph, VERBATIM.
 *
 * An earlier version stripped the parenthetical list of airlines, because "טיסות
 * ישירות מנתב״ג (אל על, סמארטווינגס ועוד) - כ-4 שעות" is tidier without it. That
 * broke the rule every opinion here rests on: the result was no longer a substring of
 * the page, so `quoted` in ./voice.js refused it - and the honest fix is to keep the
 * parenthesis rather than to stop checking. It is better information anyway. Which
 * airlines fly it is exactly what this audience is reading for.
 *
 * Only the trailing full stop comes off, which leaves a prefix of the original.
 */
export function firstClause(text, { max = 110 } = {}) {
  const s = String(text || '').trim();
  if (!s) return null;
  const cut = s.split(/(?<=\.)\s/)[0].replace(/[.\s]+$/, '').trim();
  return cut && cut.length <= max ? cut : null;
}

/**
 * The best season, as one line.
 *
 * `bestSeason` is usually a phrase - "אפריל-יוני, ספטמבר-אוקטובר" - and sometimes a
 * paragraph. Santorini's runs to four clauses about July prices and winter closures,
 * and printed whole it filled a slide and pushed everything else off it. So this takes
 * the first sentence, which is always the answer to the question, and leaves the
 * caveats to the verdict post, which is the type whose job is the whole picture.
 */
export function seasonLine(practical, { max = 60 } = {}) {
  const first = firstClause(practical?.seasonHe, { max });
  return first ? `העונה הטובה: ${first}` : null;
}

/** The practical paragraphs, trimmed. Flights and kosher are the Israeli angle. */
export const practicalOf = (city) => ({
  flightsHe: String(city?.practical?.flights || '').trim() || null,
  aroundHe: String(city?.practical?.gettingAround || '').trim() || null,
  kosherHe: String(city?.practical?.kosherOverview || '').trim() || null,
  seasonHe: String(city?.bestSeason || '').trim() || null,
});

/**
 * The page's own rating, as a badge.
 *
 * ONE BADGE SHAPE ON EVERY TYPE, and it is always the rating. It used to be whatever
 * number the type happened to have - days on a plan, places on a list, alternatives on
 * an instead post - and two of those were actively bad. The day count repeats what the
 * hook already says ("4 ימים בדובאי" over a badge reading 4), and "4 במקום" on an
 * instead cover is a phrase nobody parses.
 *
 * The rating is the right number for all of them because it is the only one that is not
 * already on the slide and the only one that is a JUDGEMENT: it says a person graded
 * this, which is the thing an aggregator cannot say. `4.6/5` with a star rather than a
 * bare number, because a bare 4.6 could be anything.
 */
export function ratingBadge(city) {
  const score = Number(city?.editorialRating?.score);
  if (!Number.isFinite(score) || score <= 0) return null;
  return { badgeHe: `${score}/5`, badgeLabelHe: null, badgeEmoji: '⭐' };
}

/**
 * A tip from the page, softened out of the imperative.
 *
 * THE PAGE WRITES INSTRUCTIONS AND A POST SHOULD WRITE ADVICE. The day notes are in the
 * imperative - "להתחיל מוקדם בכיכר העיר העתיקה" - which is the right voice for a guide
 * somebody opened on purpose and the wrong one on a slide somebody was shown. An
 * instruction from a stranger reads as presumptuous; the same sentence behind "עדיף" or
 * "מומלץ" reads as somebody who has thought about it, which is what the planner's voice
 * is.
 *
 * ONLY THE OPENING IS TOUCHED, and only when it is actually an infinitive. The rest of
 * the sentence is the page's own words - this does not rewrite, it prefixes - so the
 * quote check still passes on everything after the first word.
 */
const SOFTENERS = ['עדיף', 'מומלץ', 'שווה', 'כדאי'];

export function adviseHe(text, { nth = 0 } = {}) {
  const t = String(text || '').trim();
  if (!t) return null;
  // Already hedged by the author: "כדאי להזמין מראש" needs nothing.
  if (new RegExp(`^(?:${SOFTENERS.join('|')})`).test(t)) return t;
  // An opening infinitive is the imperative shape this is for: "להתחיל מוקדם...",
  // "לתאם מול הקהילה...". Anything else is already a sentence and is left alone.
  if (!/^ל[א-ת]/.test(t)) return t;
  // Varied by position so a four-day plan does not open every tip with the same word.
  const soft = SOFTENERS[nth % SOFTENERS.length];
  return `${soft} ${t.charAt(0).toLowerCase() === t.charAt(0) ? t : t}`;
}
