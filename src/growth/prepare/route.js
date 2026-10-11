import { matchPlaces } from './site.js';
import { enoughStops, frameKm, hasPin, hopFor, km, outside, ROUTE_RULES } from './routeRules.js';

// A route on our site: a creator's (the places they named first) or an agency's
// sample. Built from the site's own curated itinerary, repaired to pass the
// route check (routeCheck.js), and only built from the catalog where the
// itinerary cannot supply a day.
//
// The output is exactly the `days` body the site endpoint in SITE-SPEC.md takes
// ({ citySlug, placeIds } per day); publish.js sends this object.
//
// THE SITE'S DAYS, REPAIRED (the owner's rules of 2026-10-11, routeRules.js).
// Only 24 of the site's 175 itineraries pass those rules as they are: days of
// one or two short stops, a 160 km hop inside a day, a day trip squeezed
// between city stops. So, for each of the site's days, in its order:
//
//   1. its city stops and its day-trip stops are pulled apart, and each part is
//      cut where a hop is longer than the destination allows (the site's order
//      is kept when its hops are fine, else the stops are walked nearest first);
//   2. two short parts that sit near each other become one day;
//   3. a part still short gets the best catalog places near it (must-sees and
//      the highest rated first), inserted where every hop stays within the limit;
//   4. a part that still has too few stops is dropped, and its places go back
//      to the catalog;
//   5. if that leaves fewer days than wanted, a day is built from the catalog
//      around the best place not used yet, nearest first.
//
// `exclude` is what Google said is closed or not there (prepare/index.js passes
// it from the check's cache), so a route is rebuilt around a closed stop rather
// than failed for it. A catalog with no pins at all keeps the site's days as
// they are: there is nothing to measure.

export const MAX_DAYS = 7;

// Bumped when the builder changes what it makes. A route an older builder made
// is rebuilt before it goes out again (prepare/index.js).
export const BUILDER = 2;

/** How many days: the post's own number when it says, else the site's, up to 5. */
export function routeDays(city, mentioned) {
  const siteDays = (city?.itinerary || []).length;
  const n = Number(mentioned);
  if (Number.isInteger(n) && n >= 2) return Math.min(MAX_DAYS, siteDays || MAX_DAYS, n);
  return Math.min(5, siteDays || 5);
}

/** Each place once, in the order given. */
const once = (ids) => [...new Set(ids || [])];

/** Groups of places that chain together within `near`, in the order they first appear. */
function clusters(ps, near) {
  const root = ps.map((_, i) => i);
  const find = (i) => (root[i] === i ? i : (root[i] = find(root[i])));
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) if (near(ps[i], ps[j])) root[find(j)] = find(i);
  const groups = new Map();
  ps.forEach((p, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(p);
  });
  return [...groups.values()];
}

/** The site's order when its hops are fine, else nearest first from its first stop. */
function walk(stops, near) {
  if (stops.every((p, i) => i === 0 || near(stops[i - 1], p))) return stops;
  const left = stops.slice(1);
  const path = [stops[0]];
  while (left.length) {
    const last = path.at(-1);
    let best = 0;
    for (let i = 1; i < left.length; i++) if (km(last, left[i]) < km(last, left[best])) best = i;
    path.push(...left.splice(best, 1));
  }
  return path;
}

/** A path cut wherever a hop is too long. */
function cut(path, near) {
  const runs = [];
  for (const p of path) {
    const run = runs.at(-1);
    if (run && near(run.at(-1), p)) run.push(p);
    else runs.push([p]);
  }
  return runs;
}

/** Two short parts as one day, when an end of one is near an end of the other; else null. */
function join(a, b, near) {
  const rb = b.slice().reverse();
  if (near(a.at(-1), b[0])) return [...a, ...b];
  if (near(b.at(-1), a[0])) return [...b, ...a];
  if (near(a.at(-1), rb[0])) return [...a, ...rb];
  if (near(rb.at(-1), a[0])) return [...rb, ...a];
  return null;
}

/** Where `p` fits into `stops` with every hop within the limit, cheapest first; -1 when nowhere. */
function slotFor(stops, p, near) {
  let best = -1;
  let cost = Infinity;
  for (let k = 0; k <= stops.length; k++) {
    const before = stops[k - 1];
    const after = stops[k];
    if ((before && !near(before, p)) || (after && !near(p, after))) continue;
    const c = (before ? km(before, p) : 0) + (after ? km(p, after) : 0) - (before && after ? km(before, after) : 0);
    if (c < cost) [best, cost] = [k, c];
  }
  return best;
}

/** How much a place is worth adding: must-sees first, then the rating. */
const worth = (p) => (p.mustSee ? 2 : 0) + (Number(p.rating) || 4);
const minutes = (stops) => stops.reduce((n, p) => n + (Number(p.durationMin) || 90), 0);

export function buildRoute(city, { places: named = [], days: mentioned = null, exclude = [], rules = ROUTE_RULES } = {}) {
  if (!city?.itinerary?.length && !city?.places?.length) return null;
  const want = routeDays(city, mentioned);
  const { matched, unmatched } = matchPlaces(named, city.places);
  if (!(city.places || []).some(hasPin)) return siteDays(city, { want, matched, unmatched });

  const skip = new Set(exclude);
  const byId = new Map((city.places || []).filter((p) => hasPin(p) && !skip.has(p.id)).map((p) => [p.id, p]));
  const frame = frameKm(city);
  const sideOf = (p) => (outside(city, p, frame) ? 'trip' : 'city');
  // A day trip's stops are a drive apart (routeRules.js): its own, longer hop.
  const hop = { city: hopFor(city, rules), trip: hopFor(city, rules, { dayTrip: true }) };
  const near = (a, b) => km(a, b) <= hop[sideOf(a) === 'trip' && sideOf(b) === 'trip' ? 'trip' : 'city'];
  const reachable = (p) => sideOf(p) === 'city' || km(city.center, p) <= rules.dayTripKm;
  const label = (p) => String(p.nameLocal || p.name || p.id).split('/')[0].trim();
  const changes = [];

  // 1. The site's days, each pulled apart into what can be one day.
  const itin = (city.itinerary || []).slice().sort((a, b) => a.day - b.day);
  const inUse = new Set();
  let parts = [];
  itin.forEach((d, i) => {
    const ps = [];
    for (const id of once(d.placeIds)) {
      const p = byId.get(id);
      if (!p || inUse.has(id)) continue;
      if (!reachable(p)) {
        changes.push(`Left out "${label(p)}": ${Math.round(km(city.center, p))} km from the centre, too far for a day trip.`);
        continue;
      }
      ps.push(p);
      inUse.add(id);
    }
    const left = once(d.placeIds).filter((id) => skip.has(id));
    for (const id of left) changes.push(`Left out "${label((city.places || []).find((p) => p.id === id) || { id })}": closed or not found on Google.`);
    const pieces = [];
    for (const side of ['city', 'trip']) {
      for (const group of clusters(ps.filter((p) => sideOf(p) === side), near)) {
        for (const run of cut(walk(group, near), near)) pieces.push({ from: i, side, stops: run, title: d.title || '' });
      }
    }
    if (pieces.length > 1) changes.push(`The site's day ${i + 1} became ${pieces.length} parts: ${pieces.some((x) => x.side === 'trip') && pieces.some((x) => x.side === 'city') ? 'its day trip goes on a day of its own' : 'its stops are too far apart for one day'}.`);
    // The site's title stays only on a day it still describes: the whole day, unchanged.
    for (const x of pieces) x.intact = pieces.length === 1 && x.stops.length === once(d.placeIds).length;
    parts.push(...pieces);
  });

  const short = (x) => !enoughStops(x.stops, rules);

  // 2. Two short parts near each other are one day.
  for (let merged = true; merged; ) {
    merged = false;
    outer: for (const a of parts.filter(short)) {
      for (const b of parts.filter(short)) {
        if (a === b || a.side !== b.side) continue;
        const both = join(a.stops, b.stops, near);
        if (!both) continue;
        a.stops = both;
        a.intact = false;
        parts = parts.filter((x) => x !== b);
        merged = true;
        break outer;
      }
    }
  }

  // 3. A short part takes the best catalog places near it.
  const free = () => [...byId.values()].filter((p) => !inUse.has(p.id) && reachable(p));
  for (const x of parts.filter(short)) {
    while (short(x)) {
      const fits = free()
        .filter((p) => sideOf(p) === x.side)
        .map((p) => ({ p, at: slotFor(x.stops, p, near) }))
        .filter((f) => f.at >= 0)
        .sort((a, b) => worth(b.p) - worth(a.p));
      if (!fits.length) break;
      x.stops.splice(fits[0].at, 0, fits[0].p);
      inUse.add(fits[0].p.id);
      x.intact = false;
      x.added = [...(x.added || []), fits[0].p];
    }
  }

  // 4. What is still short goes back to the catalog.
  for (const x of parts.filter(short)) {
    for (const p of x.stops) inUse.delete(p.id);
    changes.push(`Dropped ${x.side === 'trip' ? 'a day trip' : 'a part'} of the site's day ${x.from + 1} (${x.stops.map(label).join(', ')}): too few stops near each other for a day.`);
  }
  parts = parts.filter((x) => !short(x));

  // The places a creator named: on a day already, fitted into one, or a day of their own.
  const lifted = matched.map((m) => byId.get(m.id)).filter((p) => p && reachable(p));
  for (const p of lifted) {
    if (parts.some((x) => x.stops.includes(p))) continue;
    for (const x of parts.filter((y) => y.side === sideOf(p))) {
      const at = slotFor(x.stops, p, near);
      if (at < 0) continue;
      x.stops.splice(at, 0, p);
      inUse.add(p.id);
      x.intact = false;
      break;
    }
  }

  // 5. Days from the catalog, around the best places not used yet.
  const seeds = [...lifted.filter((p) => !inUse.has(p.id)), ...free().sort((a, b) => worth(b) - worth(a))];
  for (const seed of seeds) {
    if (parts.length >= want && !lifted.includes(seed)) break;
    if (inUse.has(seed.id)) continue;
    const day = [seed];
    while (day.length < 5 && !(enoughStops(day, rules) && (day.length >= 4 || minutes(day) >= 420))) {
      const next = free()
        .filter((p) => !day.includes(p) && sideOf(p) === sideOf(seed) && near(day.at(-1), p))
        .sort((a, b) => km(day.at(-1), a) - km(day.at(-1), b))[0];
      if (!next) break;
      day.push(next);
    }
    if (!enoughStops(day, rules)) continue;
    for (const p of day) inUse.add(p.id);
    parts.push({ from: Infinity, side: sideOf(seed), stops: day, title: '', scratch: true });
    changes.push(`Built a day from the catalog: ${day.map(label).join(', ')}.`);
  }

  // The named places' days first, then the site's order, then the catalog's days.
  const firstNamed = (x) => {
    const i = lifted.findIndex((p) => x.stops.includes(p));
    return i < 0 ? Infinity : i;
  };
  const chosen = parts
    .map((x, i) => ({ x, i }))
    .sort((a, b) => firstNamed(a.x) - firstNamed(b.x) || a.x.from - b.x.from || a.i - b.i)
    .slice(0, want)
    .map(({ x }) => x);
  for (const x of chosen) for (const p of x.added || []) changes.push(`Added "${label(p)}" to fill a short day.`);

  const days = chosen.map((x) => ({
    citySlug: city.slug,
    placeIds: x.stops.map((p) => p.id),
    title: x.intact ? x.title : '',
    // `names` is for the lead page and the draft; publish.js sends citySlug and placeIds.
    names: x.stops.map((p) => p.name || p.id),
    ...(x.side === 'trip' ? { dayTrip: true } : {}),
  }));
  return {
    citySlug: city.slug,
    cityName: city.name,
    builder: BUILDER,
    days,
    matched,
    unmatched,
    stops: days.reduce((n, d) => n + d.placeIds.length, 0),
    changes: [...new Set(changes)],
  };
}

/**
 * A catalog with no pins: the site's days as they are. The matched places are
 * lifted to the front and the rest cut back into days of the site's sizes.
 */
function siteDays(city, { want, matched, unmatched }) {
  const itin = (city.itinerary || []).slice().sort((a, b) => a.day - b.day);
  if (!itin.length) return null;
  const known = new Set((city.places || []).map((p) => p.id));
  const lifted = matched.map((m) => m.id);
  const flat = [];
  for (const d of itin) for (const id of d.placeIds || []) if (known.has(id) && !flat.includes(id)) flat.push(id);
  const ordered = [...lifted, ...flat.filter((id) => !lifted.includes(id))];
  const sizes = Array.from({ length: want }, (_, i) => Math.max(2, (itin[Math.min(i, itin.length - 1)].placeIds || []).length));
  const nameOf = new Map((city.places || []).map((p) => [p.id, p.name]));
  const days = [];
  let at = 0;
  for (let i = 0; i < want && at < ordered.length; i++) {
    const take = ordered.slice(at, at + sizes[i]);
    at += take.length;
    days.push({ citySlug: city.slug, placeIds: take, title: itin[i]?.title || '', names: take.map((id) => nameOf.get(id) || id) });
  }
  return { citySlug: city.slug, cityName: city.name, builder: BUILDER, days, matched, unmatched, stops: days.reduce((n, d) => n + d.placeIds.length, 0), changes: [] };
}
