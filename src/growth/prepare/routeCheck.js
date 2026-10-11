import { createHash } from 'node:crypto';
import { postJson } from '../../clients/http.js';
import { guard, marginal, record } from '../../clients/budget.js';
import { dayRuleText, enoughStops, frameKm, hasPin, hopFor, km, outside, ROUTE_RULES, scaleOf } from './routeRules.js';

export { frameKm, km, ROUTE_RULES, scaleOf } from './routeRules.js';

// The route check: an agency's sample route, held against Google Places before
// the message is ready (the owner's rule of 2026-10-11).
//
//   - every stop exists: Google finds it by its local name (then by its name and
//     the destination's, for a name as plain as "Old Market") either within
//     `pinKm` of our pin or, for a town, a park or a lake, with our pin inside the
//     area Google draws for it;
//   - every stop is open: a stop Google marks closed, for now or for good, fails.
//     A town, a beach or a mountain has no business status at all, and that is
//     shown on the stop rather than counted as closed;
//   - every stop sits inside the destination: inside the frame the site's own map
//     of the destination shows (its centre and zoom), so Tokyo the region and
//     Florence the city are each judged by their own size. Not by country: the
//     Vatican Museums are on every Rome route and in another country. A stop
//     outside it is a day trip, fine when its whole day is outside (a Fuji day)
//     and within `dayTripKm`, and a failure when it is squeezed between city stops;
//   - consecutive stops on a day are a sensible distance apart: `hopKm` for a
//     city, an area or a region, by the same zoom;
//   - at least `minDays` days, and three stops on each, or two when one is long.
//   The numbers are in routeRules.js, which the builder (route.js) shares.
//
// Distances are measured between OUR pins: a stop counts as found only when
// Google's place is within `pinKm` of the pin or its area holds the pin, so the
// pin is where the stop is, and the builder measures the same thing.
//
// A route that fails is not published and gets no send button (pages.js), no
// draft (prepare/index.js), and no "Sent" (rules.js). One the check could not
// run on is treated the same until it runs. A stop that fails on Google carries
// `code` ('missing', 'closed', 'no-pin', 'unknown'), and the desk rebuilds the
// route without it (prepare/index.js).
//
// Google is asked once per catalog place a month, whichever agency's route it is
// on (state.placeChecks), and every ask is recorded as a Places call in the
// desk's budget.

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
const FIELDS = ['places.id', 'places.displayName', 'places.businessStatus', 'places.location', 'places.viewport', 'places.formattedAddress'].join(',');

const DAY = 86_400_000;

const nameOf = (p) => String(p?.nameLocal || p?.name || p?.id || '').split('/')[0].trim();
const queryOf = (p) => nameOf(p);
export const routeKey = (route) => createHash('sha1').update(JSON.stringify((route?.days || []).map((d) => d.placeIds))).digest('hex').slice(0, 12);

/** Is our pin inside the area Google draws for a place, padded by `padKm`, when that area is a town or a park and not a country? */
export function pinInside(pin, viewport, { padKm = ROUTE_RULES.pinKm, areaKm = ROUTE_RULES.areaKm } = {}) {
  const lo = viewport?.low;
  const hi = viewport?.high;
  if (!lo || !hi || !Number.isFinite(lo.latitude) || !Number.isFinite(hi.latitude)) return false;
  if (km({ lat: lo.latitude, lng: lo.longitude }, { lat: hi.latitude, lng: hi.longitude }) > areaKm) return false;
  const dLat = padKm / 111;
  const dLng = padKm / (111 * Math.max(0.1, Math.cos((pin.lat * Math.PI) / 180)));
  return pin.lat >= lo.latitude - dLat && pin.lat <= hi.latitude + dLat && pin.lng >= lo.longitude - dLng && pin.lng <= hi.longitude + dLng;
}

/**
 * One catalog place on Google: the first answer within `pinKm` of our pin, or
 * whose area holds our pin. Asked by its own name first, then by its name and
 * the destination's when that found nothing. Returns `asks`, the calls it made.
 */
export async function findOnGoogle(place, { env = process.env, post = postJson, pinKm = ROUTE_RULES.pinKm, areaKm = ROUTE_RULES.areaKm, cityName = null } = {}) {
  const ask = async (textQuery) => {
    const body = await post(
      ENDPOINT,
      {
        textQuery,
        languageCode: 'en',
        pageSize: 5,
        locationBias: { circle: { center: { latitude: place.lat, longitude: place.lng }, radius: pinKm * 1000 } },
      },
      { headers: { 'x-goog-api-key': String(env.GOOGLE_MAPS_KEY || '').trim(), 'x-goog-fieldmask': FIELDS } }
    );
    return (body?.places || [])
      .map((p) => ({
        name: String(p.displayName?.text || '').trim(),
        status: p.businessStatus || null,
        lat: p.location?.latitude,
        lng: p.location?.longitude,
        address: p.formattedAddress || '',
        area: pinInside(place, p.viewport, { padKm: pinKm, areaKm }),
      }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      .map((p) => ({ ...p, pinKm: Math.round(km(place, p) * 100) / 100 }));
  };
  const queries = [queryOf(place), ...(cityName && !queryOf(place).toLowerCase().includes(cityName.toLowerCase()) ? [`${queryOf(place)}, ${cityName}`] : [])];
  const seen = [];
  for (const [i, q] of queries.entries()) {
    const answers = await ask(q);
    seen.push(...answers);
    const near = answers.find((p) => p.pinKm <= pinKm || p.area);
    if (near) return { found: true, ...near, asks: i + 1 };
  }
  const nearest = seen.sort((a, b) => a.pinKm - b.pinKm)[0];
  return { found: false, nearestKm: nearest ? nearest.pinKm : null, nearestName: nearest?.name || null, asks: queries.length };
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
  const hop = hopFor(city, rules);
  const frame = frameKm(city);
  const cityName = nameOf({ nameLocal: city?.nameLocal, name: city?.name }) || city?.slug;

  if (days.length < rules.minDays) issues.push(`${days.length} ${days.length === 1 ? 'day' : 'days'}; a sample route needs at least ${rules.minDays}.`);
  days.forEach((d, i) => {
    const ps = d.placeIds.map((id) => byId.get(id) || { id });
    if (!enoughStops(ps, rules)) {
      issues.push(`Day ${i + 1} has ${ps.length} ${ps.length === 1 ? 'stop' : 'stops'}${ps.length >= rules.minStopsLongDay ? ', none of them long' : ''}; a day needs ${dayRuleText(rules)}.`);
    }
  });

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
      stops.push({ id, name: id, ok: false, code: 'unknown' });
      continue;
    }
    if (!hasPin(p)) {
      issues.push(`"${n}" has no pin in our catalog, so it cannot be checked.`);
      stops.push({ id, name: n, ok: false, code: 'no-pin' });
      continue;
    }
    const stop = { id, name: n, ok: true, google: f?.found ? f.name : null, status: f?.found ? f.status : null };
    if (!f?.found) {
      issues.push(`"${n}" was not found on Google near our pin${f?.nearestKm != null ? ` (the nearest match is ${f.nearestKm.toFixed(1)} km away)` : ''}.`);
      stop.ok = false;
      stop.code = 'missing';
    } else {
      if (f.status && f.status !== 'OPERATIONAL') {
        issues.push(`"${n}" is ${f.status === 'CLOSED_PERMANENTLY' ? 'closed for good' : f.status === 'CLOSED_TEMPORARILY' ? 'closed for now' : f.status.toLowerCase()} on Google.`);
        stop.ok = false;
        stop.code = 'closed';
      }
    }
    stop.centreKm = city?.center ? Math.round(km(city.center, p) * 10) / 10 : 0;
    stop.where = { lat: p.lat, lng: p.lng };
    stops.push(stop);
  }

  // Inside the destination, or a day trip that is the whole day.
  const at = new Map(stops.map((s) => [s.id, s.where]));
  const stopOf = new Map(stops.map((s) => [s.id, s]));
  days.forEach((d, i) => {
    const pinned = d.placeIds.map((id) => byId.get(id)).filter(hasPin);
    const out = pinned.filter((p) => outside(city, p, frame));
    if (!out.length) return;
    if (out.length < pinned.length) {
      for (const p of out) {
        issues.push(`Day ${i + 1} squeezes a day trip between city stops: "${nameOf(p)}" is ${Math.round(km(city.center, p))} km from the centre of ${cityName}, outside the destination (${Math.round(frame)} km). A day trip has to be the whole day.`);
        stopOf.get(p.id).ok = false;
      }
      return;
    }
    for (const p of out.filter((x) => km(city.center, x) > rules.dayTripKm)) {
      issues.push(`Day ${i + 1}: "${nameOf(p)}" is ${Math.round(km(city.center, p))} km from the centre of ${cityName}, too far for a day trip (${rules.dayTripKm} km).`);
      stopOf.get(p.id).ok = false;
    }
  });

  const tripHop = hopFor(city, rules, { dayTrip: true });
  const wholeTrip = (d) => {
    const pinned = d.placeIds.map((id) => byId.get(id)).filter(hasPin);
    return pinned.length > 0 && pinned.every((p) => outside(city, p, frame));
  };
  days.forEach((d, i) => {
    const limit = wholeTrip(d) ? tripHop : hop;
    for (let k = 1; k < d.placeIds.length; k++) {
      const a = at.get(d.placeIds[k - 1]);
      const b = at.get(d.placeIds[k]);
      if (!a || !b) continue;
      const dist = km(a, b);
      if (dist > limit) {
        issues.push(`Day ${i + 1}: "${nameOf(byId.get(d.placeIds[k - 1]))}" to "${nameOf(byId.get(d.placeIds[k]))}" is ${Math.round(dist)} km; ${limit === hop ? `on a ${scale} route a day's stops stay` : 'a day trip\'s stops stay'} within ${limit} km of each other.`);
      }
    }
  });

  return {
    status: issues.length ? 'fail' : 'pass',
    issues,
    stops: stops.map(({ where, ...s }) => s),
    scale,
    days: days.length,
    dayTrips: days.filter(wholeTrip).length,
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
    let units = 1;
    try {
      const answer = await findOnGoogle(p, { env, post, pinKm: rules.pinKm, areaKm: rules.areaKm, cityName: nameOf({ nameLocal: city?.nameLocal, name: city?.name }) });
      units = answer.asks || 1;
      cache[id] = { at: new Date(now).toISOString(), query: queryOf(p), pin, answer };
      facts[id] = answer;
    } catch (e) {
      return { status: 'error', error: `Google Places did not answer for "${nameOf(p)}": ${e.message}`, routeKey: key, checkedAt: new Date(now).toISOString() };
    } finally {
      record(state, 'places', { units, now });
    }
  }
  return { ...judgeRoute(route, city, facts, rules), routeKey: key, checkedAt: new Date(now).toISOString() };
}

/**
 * The places of `city` Google has already said are closed or not there, from
 * the check's cache: the builder leaves them out (route.js). Only answers still
 * fresh, for the pin and the name the catalog has now.
 */
export function knownBad(state, city, { now = Date.now(), rules = ROUTE_RULES } = {}) {
  const bad = new Set();
  for (const p of city?.places || []) {
    const hit = state?.placeChecks?.[p.id];
    if (!hit || !hasPin(p) || hit.query !== queryOf(p) || hit.pin !== `${p.lat},${p.lng}` || now - Date.parse(hit.at) >= rules.cacheDays * DAY) continue;
    const a = hit.answer || {};
    if (!a.found || (a.status && a.status !== 'OPERATIONAL')) bad.add(p.id);
  }
  return bad;
}

export { routeProblem } from '../rules.js';
