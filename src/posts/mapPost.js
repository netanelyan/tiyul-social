import { daysOf, placeLine } from './source.js';
import { line, fill } from './voice.js';
import { postConfig } from '../postConfig.js';

// TYPE E: THE MAP. "מפת {dest}: כל המקומות מהמסלול"
//
// THE HIGHEST SAVE RATE PER SLIDE OF ANYTHING HERE, and the reason is mechanical: a
// map is the one slide whose whole value is still there a month later, when the trip is
// actually being planned. Every other post is read once and saved on the strength of
// what it promises; a map is saved because it will be opened again.
//
// IT IS TWO OR THREE SLIDES, NOT ONE. A map alone has no hook - it is an image with no
// promise on it, and the first slide is what decides whether anybody swipes. So: a
// cover that says what the map is, the map, and on a long itinerary a second map of
// just the walkable core.
//
// WHAT THE PINS ARE NUMBERED BY. The itinerary's own order, continuing across days, so
// the numbers key to the same places a plan or list post about the same destination
// showed. Two posts about Prague a week apart then reinforce each other instead of
// being two unrelated sets of numbers.
//
// The map itself is drawn by src/render/map.js. Read the note above fitPoints there
// before changing anything about what it looks like: the absence of a street basemap is
// a licensing constraint with a real argument behind it, not an unfinished feature.

/**
 * One map post.
 *
 * Returns the slides plus the POINTS, because the map slide cannot be drawn by the
 * ordinary template dispatch - it needs the browser to project and draw, which happens
 * in the renderer. The builder's job is to decide what is on it.
 */
export function buildMapPost(city, { hook, dest } = {}) {
  const cfg = postConfig().posts;
  const destHe = dest?.he || city.name;

  // Every day of the itinerary, not just the first four. A map is the one type that
  // gets better with more on it - the whole point is the shape of the trip - so this
  // ignores `posts.days` and takes what the page has.
  const { days } = daysOf(city, { max: 12, stopsMin: 1, stopsMax: 8 });

  // Points, numbered continuously across days, keeping only what has coordinates.
  const points = [];
  for (const day of days) {
    for (const p of day.stops) {
      if (!Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lng))) continue;
      points.push({
        lat: Number(p.lat),
        lng: Number(p.lng),
        dayN: day.n,
        n: points.length + 1,
        nameHe: p.name,
        noteHe: placeLine(p),
        id: p.id,
      });
    }
  }
  if (points.length < 8) {
    throw new Error(`only ${points.length} places have coordinates, and a map needs 8 to be worth a slide`);
  }

  // THE CORE IS THE MAP, AND THE WHOLE TRIP IS THE OPTIONAL SECOND ONE.
  //
  // This was the other way round and the first render is why it is not. A Prague
  // itinerary is a walkable centre plus day trips to Kutná Hora, Terezín and Český
  // Krumlov - sixty to a hundred and seventy kilometres out. One map that fits all of
  // them is drawn at a scale where fifty kilometres is an inch, so twenty-six of the
  // thirty-two pins land on top of each other and the only legible things on the slide
  // are the three day trips. The core map at the same frame is readable and useful:
  // twenty-six pins, real separation, a two-kilometre scale bar.
  //
  // Which is also the better post. "What is near what, and can I walk it" is the
  // question somebody saves a map to answer, and the day trips are not part of that
  // question - they are a different kind of information and they are already on the
  // plan post.
  const core = coreOf(points);
  const outliers = points.length - (core?.length || 0);

  const cover = {
    look: 'label',
    cover: true,
    titleHe: line(fill(hook.he, { dest: destHe }), { where: 'cover' }),
    // What is on the map, counted, and the day trips named separately rather than
    // folded into one number. A cover promising 32 places over a map showing 26 is a
    // broken promise even though every place is real.
    noteHe: line(
      outliers ? `${core.length} במרכז, ${outliers} מסביב · הכל בהליכה` : `${days.length} ימים · הכל בהליכה`,
      { where: 'cover.note' }
    ),
    badgeHe: String(points.length),
    badgeLabelHe: 'מקומות',
    band: 'mid',
    image: (city.places || []).find((p) => p.image?.src)?.image || null,
  };

  const slides = [
    cover,
    {
      look: 'pinmap',
      points: core?.length >= 5 ? core : points,
      titleHe: line(destHe, { where: 'map.title' }),
      subHe: line(`${(core?.length >= 5 ? core : points).length} מקומות · ממוספר לפי ימים`, { where: 'map.sub' }),
      days: days.length,
    },
  ];

  // The whole trip, ONLY WHEN IT IS LEGIBLE.
  //
  // The test is a ratio rather than a distance, because the thing that breaks the map
  // is not how far the outliers are, it is how far they are RELATIVE to the cluster:
  // a trip round three Greek islands has no core and reads perfectly at full extent.
  // Below a quarter, the core collapses into a blob and the slide says nothing.
  if (outliers >= 1 && spanKm(core) / Math.max(spanKm(points), 0.001) >= 0.25) {
    slides.push({
      look: 'pinmap',
      points,
      titleHe: line(`כל המסלול`, { where: 'wide.title' }),
      subHe: line(`${points.length} מקומות, כולל מה שמחוץ לעיר`, { where: 'wide.sub' }),
      days: days.length,
    });
  }

  return {
    slides,
    points,
    captionHookHe: line(`כל המקומות מהמסלול ל${destHe} על מפה אחת`, { where: 'caption.hook' }),
    stats: { points: points.length, days: days.length, core: core?.length || 0, outliers },
  };
}

/** The diagonal of a set of points' bounding box, in kilometres. */
function spanKm(points) {
  if (!points?.length) return 0;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const dLat = (Math.max(...lats) - Math.min(...lats)) * 111;
  const dLng = (Math.max(...lngs) - Math.min(...lngs)) * 111 * Math.cos((lats[0] * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

/**
 * The points that are close enough together to be one walk.
 *
 * The median point, then everything within a radius of it. Median rather than mean
 * because a single day trip sixty kilometres out drags a mean far enough to pull the
 * centre off the city; the median of the coordinates is inside the cluster whatever
 * the outliers do.
 */
export function coreOf(points, { radiusKm = 4 } = {}) {
  if (!points?.length) return null;
  const mid = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const c = { lat: mid(points.map((p) => p.lat)), lng: mid(points.map((p) => p.lng)) };
  const km = (p) => {
    const R = 6371;
    const rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(p.lat - c.lat);
    const dLng = rad(p.lng - c.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(c.lat)) * Math.cos(rad(p.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  // Numbers are KEPT rather than reassigned, so a place is number 7 on both maps. A
  // second numbering of the same places is two posts contradicting each other.
  return points.filter((p) => km(p) <= radiusKm);
}
