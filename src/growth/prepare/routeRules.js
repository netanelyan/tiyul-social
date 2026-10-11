// What makes a sample route's day a day, shared by the builder (route.js) and
// the check (routeCheck.js), so the builder makes exactly what the check passes.
// Pure: no imports, no network.
//
// The owner's rules, 2026-10-11, as revised the same evening:
//   - at least `minDays` days;
//   - at least three stops a day, or two when one of them takes three hours or
//     more (a Fuji day, a desert camp). Four was too strict: most of the site's
//     own days are shorter;
//   - consecutive stops on a day within `hopKm`, by the size of the
//     destination: these were the real failures (56 to 929 km inside one day);
//   - a day trip is fine when it is the whole day (a Fuji day from Tokyo, Tivoli
//     from Rome), not squeezed between city stops, and within `dayTripKm` of the
//     centre: further than that is not a day out, it is another destination. Its
//     stops are a drive apart, not a walk, so its hops are held to the next size
//     up: a city's day trip to the area limit, an area's to the region's.

export const ROUTE_RULES = Object.freeze({
  minDays: 2,
  minStopsPerDay: 3,
  minStopsLongDay: 2,
  longStopMin: 180,
  // How far Google's place may sit from our pin and still be the same place, and
  // the largest area (its diagonal) whose outline may stand in for a point.
  pinKm: 2,
  areaKm: 150,
  // The longest hop between two stops on one day, by the site's map zoom for the
  // destination: a city (zoom 12 and closer), an area (10 to 11: Dubai), a region.
  hopKm: { city: 10, area: 25, region: 50 },
  dayTripKm: 200,
  cacheDays: 30,
});

export function km(a, b) {
  const t = Math.PI / 180;
  const dLat = (b.lat - a.lat) * t;
  const dLng = (b.lng - a.lng) * t;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(x));
}

export const hasPin = (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng);

/** What the site's map of the destination calls its size: city, area or region. */
export const scaleOf = (city) => (Number(city?.zoom) >= 12 || !city?.zoom ? 'city' : Number(city.zoom) >= 10 ? 'area' : 'region');

/**
 * How far from its centre a stop may be and still be inside the destination:
 * the width of a 1024-pixel map at the zoom the site draws the destination at
 * (Web Mercator, 156,543 m a pixel at zoom 0 on the equator). Rome and Florence
 * (zoom 13) come to about 15 km, Vienna (12) about 26, Sinai (8) about 550. A
 * day trip the catalog lists (Prague to Cesky Krumlov, 142 km) is outside it.
 */
export function frameKm(city) {
  const zoom = Number(city?.zoom) || 12;
  const lat = Number(city?.center?.lat) || 0;
  return (1024 * 156_543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom / 1000;
}

const UP = { city: 'area', area: 'region', region: 'region' };

/** The longest hop a day of this destination may have; a whole day trip, the next size up. */
export const hopFor = (city, rules = ROUTE_RULES, { dayTrip = false } = {}) => rules.hopKm[dayTrip ? UP[scaleOf(city)] : scaleOf(city)];

/** Is this stop outside the destination's frame (a day-trip stop)? A city with no centre has no outside. */
export const outside = (city, p, frame = frameKm(city)) => Boolean(city?.center && hasPin(p) && km(city.center, p) > frame);

export const isLong = (p, rules = ROUTE_RULES) => Number(p?.durationMin) >= rules.longStopMin;

/** Enough stops for a day: three, or two when one of them is long. */
export const enoughStops = (stops, rules = ROUTE_RULES) =>
  stops.length >= rules.minStopsPerDay || (stops.length >= rules.minStopsLongDay && stops.some((p) => isLong(p, rules)));

/** The day-size rule in words, for the check's issues and the card. */
export const dayRuleText = (rules = ROUTE_RULES) =>
  `${rules.minStopsPerDay} stops, or ${rules.minStopsLongDay} when one takes ${rules.longStopMin / 60} hours or more`;
