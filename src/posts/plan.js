import { daysOf, placeLine, distanceHe, practicalOf, verdictOf, firstClause } from './source.js';
import { line, fill } from './voice.js';
import { postConfig } from '../postConfig.js';

// TYPE A: THE PLAN. The flagship, and the one all three top mechanisms point at.
//
// It is a TOOL (people save a plan for a trip they are planning, and saves run at 47
// to 95% of likes on every post that worked), it SETTLES A DECISION somebody is
// having in a group chat (where, and for how many nights - which is why it gets
// forwarded, and shares run at 19 to 52%), and it HOLDS ATTENTION because a viewer
// always knows where they are in it: day 1, day 2, day 3.
//
// HOW IT DIFFERS FROM THE EXISTING PLAN FORMAT, which it replaces rather than joins.
//
// The old one is one slide per STOP: nineteen slides of "a photograph, a name, a
// note". That is a deck of places with day numbers on it, and it has the deck's
// problem - each slide can be skipped in half a second because there is nothing on it
// to read. This one is one slide per DAY, with the day's stops, the walk between them
// and the day's own tip on it. Fewer slides, far more on each, and every slide
// answers the question the format is for.
//
// TWO LOOKS, NEVER MIXED INSIDE ONE POST.
//
//   route  stops down a dotted line with a thumbnail each and the distance between
//   notes  the iPhone Notes checklist, which is the highest-saving shape in the study
//
// Between the day slides, a collage of that day's photographs. The alternation is
// doing something neither look does alone: a checklist is READ and a photograph is
// LOOKED AT, and a post that only ever asks to be read loses people at slide four.

/**
 * The day slides, in the chosen look.
 *
 * `route` carries the distances and `notes` does not, and that is not an oversight.
 * A checklist is a list of things to do; a dotted line is a route, and a route is the
 * thing a distance belongs on. Putting "~600 מ׳" between two checklist rows would be
 * two facts fighting for the same line.
 */
function daySlides(days, look, { walkMaxKm }) {
  return days.map((day) => {
    const emojis = dayEmojis(day);
    if (look === 'notes') {
      return {
        look: 'notes',
        titleHe: line(`יום ${day.n}`, { where: `day${day.n}.title` }),
        emojis,
        rows: day.stops.map((p) => ({
          text: line(p.name, { where: `day${day.n}.stop` }),
          // The second half of a row, greyed: what it is or how long it takes. On a
          // checklist this is the detail, not the item, and it reads as one.
          sub: placeLine(p) || null,
        })),
        // The day's own tip, verbatim off the page, as the last line. The single most
        // useful sentence on the whole post - "להתחיל מוקדם בכיכר העיר העתיקה, לפני
        // קבוצות המטיילים" - and the one thing here no English guide would tell you.
        tipHe: day.noteHe ? line(day.noteHe, { where: `day${day.n}.note` }) : null,
        dayN: day.n,
      };
    }

    // The route card. Each stop after the first carries the gap from the one before.
    const stops = day.stops.map((p, i) => ({
      nameHe: line(p.name, { where: `day${day.n}.stop` }),
      noteHe: placeLine(p),
      image: p.image || null,
      // Computed from the site's own coordinates and hedged in source.js. This
      // builder must never do the arithmetic itself - see the note on distanceHe.
      gapHe: i > 0 ? distanceHe(day.stops[i - 1], p, { walkMaxKm }) : null,
    }));
    return {
      look: 'route',
      titleHe: line(`יום ${day.n}`, { where: `day${day.n}.title` }),
      // The day's own title from the page, as the small line under the number. It is
      // the page's editorial summary of the day and it is better than anything that
      // could be derived from the stop names.
      subHe: day.titleHe ? line(day.titleHe, { where: `day${day.n}.subtitle` }) : null,
      stops,
      tipHe: day.noteHe ? line(day.noteHe, { where: `day${day.n}.note` }) : null,
      bgImage: day.stops.find((p) => p.image?.src)?.image || null,
      dayN: day.n,
    };
  });
}

/**
 * The emoji row for a day, from the categories its stops actually are.
 *
 * FROM THE DATA, NOT CHOSEN. An emoji picked freely for a sentence produces
 * decoration rather than meaning - deckTemplates.js records a sheaf of wheat turning
 * up beside a line about the Velvet Revolution - and the fix there was to allow only
 * emoji tied to a fixed set of labels. Same rule: each one here IS a category the
 * site assigned, so "🏰🍺" on a Prague day means that day has a historic site and a
 * place to eat on it.
 */
const CATEGORY_EMOJI = {
  historic: '🏰',
  // 🏛️ rather than 🖼️. The framed picture is the obvious choice for a museum and it
  // renders as "an image" - on a black slide beside a castle and a shopping bag it
  // reads as a photo attachment rather than as a place to go.
  museum: '🏛️',
  attraction: '🎡',
  nature: '🌿',
  viewpoint: '🌄',
  cafe: '☕',
  food: '🍽️',
  market: '🧺',
  shopping: '🛍️',
  'kosher-food': '🥙',
  'kosher-market': '🛒',
};

/**
 * BY HOW MANY, not by which came first.
 *
 * First-seen order is the obvious implementation and it produces a misleading row: a
 * Prague trip whose first stop happens to be a market came back "🛍️🖼️🏰", which
 * announces a shopping trip. Counting instead puts the castles first because the trip
 * is mostly castles, which is what an emoji row on a cover is claiming.
 *
 * Ties keep the itinerary's own order, so the result is stable rather than depending on
 * how the sort happens to break them.
 */
export function dayEmojis(day, { max = 3 } = {}) {
  const tally = new Map();
  for (const [i, p] of (day.stops || []).entries()) {
    const e = CATEGORY_EMOJI[String(p.category || '').trim()];
    if (!e) continue;
    if (!tally.has(e)) tally.set(e, { n: 0, first: i });
    tally.get(e).n++;
  }
  return [...tally.entries()]
    .sort((a, b) => b[1].n - a[1].n || a[1].first - b[1].first)
    .slice(0, max)
    .map(([e]) => e);
}

/**
 * The collage that sits between two days.
 *
 * Takes the day's own photographs, so the pictures under a day are that day's places
 * rather than a general view of the city. Fewer than two and there is no collage -
 * one photograph in a grid is a photograph with a grid drawn round it.
 */
function collageFor(day) {
  const images = (day.stops || []).map((p) => p.image).filter((i) => i?.src);
  if (images.length < 2) return null;
  return {
    look: 'collage',
    // OPTIONAL, which is what lets an Instagram carousel fit. A collage is the breath
    // between two days rather than a day's content: dropping it costs the post its
    // pacing and nothing it promised. See fitTo in src/render/post.js.
    optional: true,
    images: images.slice(0, 4),
    titleHe: day.titleHe ? line(day.titleHe, { where: `day${day.n}.collage` }) : null,
    dayN: day.n,
  };
}

/**
 * The summary slide, in the planner's voice.
 *
 * TWO OR THREE LINES AND A REAL QUESTION, which is how every one of the reference
 * posts ends - "לסיכום... מקווה שעזרתי 🤍" with 252 comments under it.
 *
 * THE OPINION IS A QUOTE. "העיר העתיקה עמוסה, אז מתחילים מוקדם" is two things: a
 * claim about Prague, which is the page's own drawback quoted verbatim, and a
 * decision, which is ours to make because making itineraries is what we do. The
 * claim is checked against the page (see `line`'s `quote` option); the decision is
 * the only part this pipeline writes, and it is written as a filled format rather
 * than composed, so it cannot become a sentence a model chose.
 */
function summarySlide(city, { days, verdict, practical, image, questionHe = null }) {
  const lines = [];

  // The sharpest drawback first, because the decision follows from it. Shortest
  // available: a summary slide holds a line, not a paragraph.
  const sharpest = [...(verdict?.consHe || [])].sort((a, b) => a.length - b.length)[0] || null;
  if (sharpest) lines.push({ text: line(sharpest, { where: 'summary.drawback', quote: verdict.source }) });

  // The flight, which is the most Israeli fact on the page and the one that decides
  // whether this trip happens at all. Verbatim, parenthesis and all - see the note on
  // firstClause in ./source.js for why tidying it would break the quote check.
  const flight = firstClause(practical?.flightsHe);
  if (flight) lines.push({ text: line(flight, { where: 'summary.flight', quote: practical.flightsHe }) });

  // Kosher, where the page has something real to say. Never a supervision level -
  // this is the overview paragraph, which is about the destination rather than about
  // one restaurant, and kosherLine is what handles the per-place version.
  const kosher = firstClause(practical?.kosherHe);
  if (kosher && lines.length < 3) {
    lines.push({ text: line(kosher, { where: 'summary.kosher', quote: practical.kosherHe }) });
  }

  // The question, MARKED, so it reads as the one line that wants an answer rather
  // than as a fourth fact. This is what the reference posts' comment counts come
  // from - @travel.with.dorina's 24-slide itinerary ends "מקווה שעזרתי 🤍" and has
  // 252 comments under it. It is drawn once per post and the caption gets the same
  // one, so the post is not asking two different questions.
  if (questionHe) lines.push({ text: line(questionHe, { where: 'summary.question' }), mark: true });

  return {
    look: 'sheet',
    titleHe: line(`${days} ימים ב${city.name}`, { where: 'summary.title' }),
    lines,
    image,
  };
}

/**
 * One plan post.
 *
 * `city` must already have photographs on its places - fillPostPhotos is run by the
 * caller, before this, because a day whose stops have no pictures is a different post
 * (fewer stops) and the shape has to be decided after that is known.
 */
export function buildPlanPost(city, { look = 'route', hook, dest, days = null, questionHe = null } = {}) {
  const cfg = postConfig().posts;
  const want = days || cfg.days;
  const { days: built, dropped } = daysOf(city, {
    max: want,
    stopsMin: cfg.stopsMin,
    stopsMax: cfg.stopsMax,
  });
  if (built.length < 2) {
    throw new Error(`the itinerary gives only ${built.length} usable day(s) - ${dropped[0] || 'no reason recorded'}`);
  }

  const verdict = verdictOf(city);
  const practical = practicalOf(city);
  const destHe = dest?.he || city.name;

  // The cover. A label slide, because a cover is one line over one photograph and
  // that is what the label look is - even on a post whose day slides are checklists.
  // The cover is the ONE slide that may differ from the post's look: it is the thing
  // that has to stop a scroll, and a black checklist does not.
  const coverHe = line(fill(hook.he, { dest: destHe, days: built.length }), { where: 'cover' });

  const dayMade = daySlides(built, look, { walkMaxKm: cfg.walkMaxKm });

  // Days, with a collage after each one except the last.
  //
  // NOT AFTER THE LAST, because the slide after the last day is the summary and a
  // collage between them separates the itinerary from its own conclusion. The last
  // day's photographs are not lost: they are on its own route card, or in the case of
  // the notes look they were never on a slide, which is the price of that look and is
  // why the two alternate across posts.
  const middle = [];
  for (const [i, slide] of dayMade.entries()) {
    middle.push(slide);
    if (i < dayMade.length - 1) {
      const c = collageFor(built[i]);
      if (c) middle.push(c);
    }
  }

  const cover = {
    look: 'label',
    cover: true,
    titleHe: coverHe,
    // The number of days as the sub-line, and the count of stops with it. Both are
    // facts about what is in the post, which is what a cover is for: the viewer
    // decides whether to swipe on what they are being promised.
    noteHe: line(`${built.reduce((n, d) => n + d.stops.length, 0)} עצירות · הכל מסומן על מפה`, { where: 'cover.note' }),
    // The day count as the badge. It is the single fact somebody is deciding on -
    // "where, and for how many nights" is the question this format exists to settle -
    // and inside the hook sentence it is one word among eight.
    badgeHe: String(built.length),
    badgeLabelHe: 'ימים',
    emojis: dayEmojis({ stops: built.flatMap((d) => d.stops) }, { max: 3 }),
    band: 'mid',
  };

  const summary = summarySlide(city, {
    days: built.length,
    verdict,
    practical,
    questionHe,
    image: built.at(-1)?.stops?.find((p) => p.image?.src)?.image || null,
  });

  return {
    slides: [cover, ...middle, summary],
    days: built,
    dropped,
    verdict,
    practical,
    // What the caption's `hook` part says on Instagram, which opens with it. The
    // cover line restated in a spoken way rather than repeated verbatim - the cover
    // is type on a photograph and a caption is somebody talking.
    captionHookHe: line(`${built.length} ימים ב${destHe}, ככה היינו בונים את זה`, { where: 'caption.hook' }),
    stats: {
      days: built.length,
      stops: built.reduce((n, d) => n + d.stops.length, 0),
      collages: middle.filter((s) => s.look === 'collage').length,
    },
  };
}
