import { createHash } from 'node:crypto';
import { postJson } from '../../clients/http.js';
import { guard, marginal, record } from '../../clients/budget.js';

// The route check: an agency's sample route, held against Google Places before
// the message is ready (the owner's rule of 2026-10-11).
//
//   - every stop exists: Google finds it by its local name within `pinKm` of our pin;
//   - every stop is open: a stop Google marks closed, for now or for good, fails.
//     A town, a beach or a mountain has no business status at all, and that is
//     shown on the stop rather than counted as closed;
//   - every stop sits inside the destination: in the country most of the route is
//     in, and inside the frame the site's own map of the destination shows (its
//     centre and zoom), so Tokyo the region and Florence the city are each judged
//     by their own size;
//   - consecutive stops on a day are a sensible distance apart: `hopKm` for a
//     city, an area or a region, by the same zoom;
//   - at least `minDays` days, and at least `minStopsPerDay` stops on each.
//
// A route that fails is not published and gets no send button (pages.js), no
// draft (prepare/index.js), and no "Sent" (rules.js). One the check could not
// run on is treated the same until it runs.
//
// Google is asked once per catalog place a month, whichever agency's route it is
// on (state.placeChecks), and every ask is recorded as a Places call in the
// desk's budget.

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
const FIELDS = ['places.id', 'places.displayName', 'places.businessStatus', 'places.location', 'places.formattedAddress', 'places.addressComponents'].join(',');

export const ROUTE_RULES = Object.freeze({
  minDays: 2,
  minStopsPerDay: 4,
  // How far Google's place may sit from our pin and still be the same place.
  pinKm: 2,
  // The longest hop between two stops on one day, by the site's map zoom for the
  // destination: a city (zoom 11 and closer), an area (9 to 10), a region.
  hopKm: { city: 10, area: 25, region: 50 },
  cacheDays: 30,
});

const DAY = 86_400_000;

export function km(a, b) {
  const t = Math.PI / 180;
  const dLat = (b.lat - a.lat) * t;
  const dLng = (b.lng - a.lng) * t;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(x));
}

/** What the site's map of the destination calls its size: city, area or region. */
export const scaleOf = (city) => (Number(city?.zoom) >= 11 || !city?.zoom ? 'city' : Number(city.zoom) >= 9 ? 'area' : 'region');

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

const nameOf = (p) => String(p?.nameLocal || p?.name || p?.id || '').split('/')[0].trim();
const queryOf = (p) => nameOf(p);
export const routeKey = (route) => createHash('sha1').update(JSON.stringify((route?.days || []).map((d) => d.placeIds))).digest('hex').slice(0, 12);

/** One catalog place on Google: the first answer within `pinKm` of our pin, else the nearest, marked not found. */
export async function findOnGoogle(place, { env = process.env, post = postJson, pinKm = ROUTE_RULES.pinKm } = {}) {
  const body = await post(
    ENDPOINT,
    {
      textQuery: queryOf(place),
      languageCode: 'en',
      pageSize: 5,
      locationBias: { circle: { center: { latitude: place.lat, longitude: place.lng }, radius: pinKm * 1000 } },
    },
    { headers: { 'x-goog-api-key': String(env.GOOGLE_MAPS_KEY || '').trim(), 'x-goog-fieldmask': FIELDS } }
  );
  const answers = (body?.places || [])
    .map((p) => ({
      name: String(p.displayName?.text || '').trim(),
      status: p.businessStatus || null,
      lat: p.location?.latitude,
      lng: p.location?.longitude,
      country: (p.addressComponents || []).find((c) => (c.types || []).includes('country'))?.shortText || null,
      address: p.formattedAddress || '',
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .map((p) => ({ ...p, pinKm: Math.round(km(place, p) * 100) / 100 }));
  const near = answers.find((p) => p.pinKm <= pinKm);
  if (near) return { found: true, ...near };
  const nearest = answers.sort((a, b) => a.pinKm - b.pinKm)[0];
  return { found: false, nearestKm: nearest ? nearest.pinKm : null, nearestName: nearest?.name || null };
}

/**
 * The verdict on one route, from what Google said about each stop. Pure.
 * `facts` maps a catalog place id to findOnGoogle's answer.
 */
export function judgeRoute(route, city, facts, rules = ROUTE_RULES) {
  const issues = [];
  const byId = new Map((city?.places || []).map((p) => [p.id, p]));
  const days = (route?.days || []).filter((d) => d.placeIds?.length);
  const scale = scaleOf(city);
  const hop = rules.hopKm[scale];
  const frame = frameKm(city);
  const cityName = nameOf({ nameLocal: city?.nameLocal, name: city?.name }) || city?.slug;

  if (days.length < rules.minDays) issues.push(`${days.length} ${days.length === 1 ? 'day' : 'days'}; a sample route needs at least ${rules.minDays}.`);
  days.forEach((d, i) => {
    if (d.placeIds.length < rules.minStopsPerDay) issues.push(`Day ${i + 1} has ${d.placeIds.length} ${d.placeIds.length === 1 ? 'stop' : 'stops'}; each day needs at least ${rules.minStopsPerDay}.`);
  });

  // The route's country: the one most of its stops are in, on Google.
  const tally = {};
  for (const f of Object.values(facts)) if (f?.found && f.country) tally[f.country] = (tally[f.country] || 0) + 1;
  const country = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  const stops = [];
  const seen = new Set();
  for (const id of days.flatMap((d) => d.placeIds)) {
    if (seen.has(id)) continue;
    seen.add(id);
    const p = byId.get(id);
    const f = facts[id];
    const n = nameOf(p) || id;
    if (!p) {
      issues.push(`"${id}" is not in the site's catalog for ${cityName}.`);
      stops.push({ id, name: id, ok: false });
      continue;
    }
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) {
      issues.push(`"${n}" has no pin in our catalog, so it cannot be checked.`);
      stops.push({ id, name: n, ok: false });
      continue;
    }
    const stop = { id, name: n, ok: true, google: f?.found ? f.name : null, status: f?.found ? f.status : null };
    if (!f?.found) {
      issues.push(`"${n}" was not found on Google near our pin${f?.nearestKm != null ? ` (the nearest match is ${f.nearestKm.toFixed(1)} km away)` : ''}.`);
      stop.ok = false;
    } else {
      if (f.status && f.status !== 'OPERATIONAL') {
        issues.push(`"${n}" is ${f.status === 'CLOSED_PERMANENTLY' ? 'closed for good' : f.status === 'CLOSED_TEMPORARILY' ? 'closed for now' : f.status.toLowerCase()} on Google.`);
        stop.ok = false;
      }
      if (country && f.country && f.country !== country) {
        issues.push(`"${n}" is in ${f.country}; the rest of the route is in ${country}.`);
        stop.ok = false;
      }
    }
    const where = f?.found ? { lat: f.lat, lng: f.lng } : { lat: p.lat, lng: p.lng };
    const fromCentre = city?.center ? km(city.center, where) : 0;
    stop.centreKm = Math.round(fromCentre * 10) / 10;
    if (city?.center && fromCentre > frame) {
      issues.push(`"${n}" is ${Math.round(fromCentre)} km from the centre of ${cityName}, outside the destination (${Math.round(frame)} km).`);
      stop.ok = false;
    }
    stop.where = where;
    stops.push(stop);
  }

  const at = new Map(stops.map((s) => [s.id, s.where]));
  days.forEach((d, i) => {
    for (let k = 1; k < d.placeIds.length; k++) {
      const a = at.get(d.placeIds[k - 1]);
      const b = at.get(d.placeIds[k]);
      if (!a || !b) continue;
      const dist = km(a, b);
      if (dist > hop) {
        issues.push(`Day ${i + 1}: "${nameOf(byId.get(d.placeIds[k - 1]))}" to "${nameOf(byId.get(d.placeIds[k]))}" is ${Math.round(dist)} km; on a ${scale} route a day's stops stay within ${hop} km of each other.`);
      }
    }
  });

  return {
    status: issues.length ? 'fail' : 'pass',
    issues,
    stops: stops.map(({ where, ...s }) => s),
    country,
    scale,
    days: days.length,
    stopCount: seen.size,
  };
}

/**
 * Check a route, asking Google only for places not asked about in the last
 * `cacheDays`. Returns the stored check. A failed Google call is a check with
 * status "error", tried again on the next pass; a BudgetError is thrown, as
 * everywhere in the desk, so the pass stops at the cap.
 */
export async function checkRoute(route, city, { state, settings, env = process.env, now = Date.now(), post = postJson } = {}) {
  const rules = { ...ROUTE_RULES, ...(settings?.routeCheck || {}) };
  const key = routeKey(route);
  if (!String(env.GOOGLE_MAPS_KEY || '').trim()) {
    return { status: 'error', error: 'GOOGLE_MAPS_KEY is missing from .env', routeKey: key, checkedAt: new Date(now).toISOString() };
  }
  const byId = new Map((city?.places || []).map((p) => [p.id, p]));
  const cache = (state.placeChecks ??= {});
  const facts = {};
  const ids = [...new Set((route?.days || []).flatMap((d) => d.placeIds || []))];
  for (const id of ids) {
    const p = byId.get(id);
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const hit = cache[id];
    const pin = `${p.lat},${p.lng}`;
    if (hit && hit.query === queryOf(p) && hit.pin === pin && now - Date.parse(hit.at) < rules.cacheDays * DAY) {
      facts[id] = hit.answer;
      continue;
    }
    guard(state, settings, 'places', marginal(state, settings, 'places', now), now);
    try {
      const answer = await findOnGoogle(p, { env, post, pinKm: rules.pinKm });
      cache[id] = { at: new Date(now).toISOString(), query: queryOf(p), pin, answer };
      facts[id] = answer;
    } catch (e) {
      return { status: 'error', error: `Google Places did not answer for "${nameOf(p)}": ${e.message}`, routeKey: key, checkedAt: new Date(now).toISOString() };
    } finally {
      record(state, 'places', { now });
    }
  }
  return { ...judgeRoute(route, city, facts, rules), routeKey: key, checkedAt: new Date(now).toISOString() };
}

export { routeProblem } from '../rules.js';
