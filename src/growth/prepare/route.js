import { matchPlaces } from './site.js';

// A creator's route: the places they named first, then the site's itinerary.
//
// The output is exactly the `days` body the site endpoint in SITE-SPEC.md takes
// ({ citySlug, placeIds } per day), so the day that endpoint exists nothing here
// changes; publish.js sends this object.
//
// THE DAY SHAPE IS THE SITE'S. The itinerary is flattened in its own order, the
// matched places are lifted to the front, and the result is cut back into days
// of the sizes the site's itinerary used. So a creator who named the Acropolis
// and Lycabettus gets both on day one, and the rest of the route reads the way
// the site's editors laid it out.

export const MAX_DAYS = 7;

/** How many days: the post's own number when it says, else the site's, up to 5. */
export function routeDays(city, mentioned) {
  const siteDays = (city?.itinerary || []).length;
  const n = Number(mentioned);
  if (Number.isInteger(n) && n >= 2) return Math.min(MAX_DAYS, siteDays || MAX_DAYS, n);
  return Math.min(5, siteDays || 5);
}

export function buildRoute(city, { places: named = [], days: mentioned = null } = {}) {
  if (!city?.itinerary?.length) return null;
  const want = routeDays(city, mentioned);
  const itin = city.itinerary.slice().sort((a, b) => a.day - b.day);
  const known = new Set((city.places || []).map((p) => p.id));

  const { matched, unmatched } = matchPlaces(named, city.places);
  const lifted = matched.map((m) => m.id);

  // The site's order, without repeats, without anything the catalog does not
  // hold (the endpoint would refuse it), and without what was lifted.
  const flat = [];
  for (const d of itin) for (const id of d.placeIds || []) if (known.has(id) && !flat.includes(id)) flat.push(id);
  const rest = flat.filter((id) => !lifted.includes(id));
  const ordered = [...lifted, ...rest];

  // Day sizes from the site's own days, repeating the last size if the post
  // asked for more days than the site has.
  const sizes = Array.from({ length: want }, (_, i) => Math.max(2, (itin[Math.min(i, itin.length - 1)].placeIds || []).length));
  const nameOf = new Map((city.places || []).map((p) => [p.id, p.name]));
  const days = [];
  let at = 0;
  for (let i = 0; i < want && at < ordered.length; i++) {
    const take = ordered.slice(at, at + sizes[i]);
    at += take.length;
    // `names` is for the lead page only; publish.js sends citySlug and placeIds.
    days.push({ citySlug: city.slug, placeIds: take, title: itin[i]?.title || '', names: take.map((id) => nameOf.get(id) || id) });
  }

  return {
    citySlug: city.slug,
    cityName: city.name,
    days,
    matched,
    unmatched,
    stops: days.reduce((n, d) => n + d.placeIds.length, 0),
  };
}
