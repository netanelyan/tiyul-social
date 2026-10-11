import { BUILDER, buildRoute } from './route.js';
import { checkRoute, knownBad, ROUTE_RULES, routeKey } from './routeCheck.js';

// A sample route ready to go out: built (route.js), checked on Google
// (routeCheck.js), and rebuilt without whatever Google said is closed or not
// there, until it passes or there is nothing left to leave out. The desk
// (prepare/index.js) and the report (scripts/growth-route-check.js) both go
// through here, so the report shows exactly what the desk would send.

const ROUNDS = 4;

/**
 * A route's check, reused while the route is the same one and the check is
 * fresh; run again when the route changed, the check is a month old, or it
 * could not run last time (at most once an hour).
 */
export async function checkedOnce(prev, route, city, { state, settings, env, now, check = checkRoute }) {
  const fresh = prev && prev.routeKey === routeKey(route) && now - Date.parse(prev.checkedAt || 0) < ROUTE_RULES.cacheDays * 86_400_000;
  if (fresh && prev.status !== 'error') return prev;
  if (fresh && now - Date.parse(prev.checkedAt) < 3_600_000) return prev;
  return check(route, city, { state, settings, env, now });
}

/**
 * Returns { route, check }. `route` (the lead's) is kept when the current
 * builder made it and nothing on it is known to be closed; `check` (the lead's)
 * is reused while fresh. A BudgetError from the check is thrown, as everywhere.
 */
export async function readyRoute(city, { state, settings, env, now = Date.now(), route = null, check = null, days = null, named = [], deps = {} } = {}) {
  const build = deps.buildRoute || buildRoute;
  const run = deps.checkRoute || checkRoute;
  const holdsBad = (r, bad) => r.days.some((d) => d.placeIds.some((id) => bad.has(id)));
  for (let round = 0; round < ROUNDS; round++) {
    const bad = knownBad(state, city, { now });
    if (!route || route.builder !== BUILDER || holdsBad(route, bad)) route = build(city, { places: named, days, exclude: [...bad] });
    if (!route) return { route: null, check: null };
    check = await checkedOnce(check, route, city, { state, settings, env, now, check: run });
    // Rebuilt only when the check named a stop to leave out that the builder did not know of.
    if (check.status !== 'fail' || !holdsBad(route, knownBad(state, city, { now }))) break;
  }
  return { route, check };
}
