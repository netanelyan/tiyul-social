import { deleteJson, postJson } from '../../clients/http.js';
import { SITE } from '../links.js';

// Publishing a creator's route on tiyulplus.com, and taking it down.
//
// Through POST /api/internal/trips, the endpoint SITE-SPEC.md asked the
// tiyul-plus session for: server to server, a bearer token, every trip owned by
// the editor account. The desk sends the route route.js built ({ citySlug,
// placeIds } per day, catalog ids only) under an externalId derived from the
// lead, so a re-send is an edit that keeps the slug, never a second page.
//
// WHEN, AND ONLY WHEN. A route goes public when the creator is shown in the
// Creators column (prepare/index.js calls publishRoute there and nowhere else),
// which is the day after the owner marked the warm-up comment. It comes down on
// [דלג], [לא מעוניינים] and [לא רלוונטי]; desk.js calls withdrawRoute on those,
// and its timer retries any withdrawal that failed, so a closed lead never keeps
// a live page.
//
// This is a write to OUR site. http.js allows exactly these two calls there and
// no write to any platform.

const ENDPOINT = `${SITE}/api/internal/trips`;

export const publishingConfigured = (env = process.env) => String(env.GROWTH_PUBLISH_TOKEN || '').trim().length >= 32;

const auth = (env) => ({ authorization: `Bearer ${String(env.GROWTH_PUBLISH_TOKEN || '').trim()}` });

/**
 * The idempotency key: the same lead is always the same trip.
 *
 * Handles are letters, digits, dots and underscores, so dropping the "@" cannot
 * make two leads collide; anything else the endpoint refuses becomes "_".
 */
export const externalIdFor = (lead) => `growth:${String(lead.id).replace(/@/g, '').replace(/[^A-Za-z0-9:._-]/g, '_')}`.slice(0, 120);

/** The request body, exactly as the endpoint validates it. */
export function tripBody(lead) {
  const r = lead.route;
  const days = (r?.days || [])
    .map((d) => ({ citySlug: d.citySlug, placeIds: [...new Set(d.placeIds)].slice(0, 12), notes: '' }))
    .filter((d) => d.placeIds.length);
  // The private name, seen only in the editor account: who it is for and what.
  const who = lead.handle ? `@${lead.handle}` : lead.name || 'יוצר/ת';
  const name = `${who} · ${r?.cityName || ''} ${days.length} ימים`.replace(/\s+/g, ' ').trim().slice(0, 80);
  return { externalId: externalIdFor(lead), name, days: days.slice(0, 14), startDate: null, preferences: null };
}

/**
 * Publish (or re-send) a creator's route. Returns the trip state to store.
 *
 * Never throws for an ordinary refusal: a failed publish is stored with its
 * reason, shown on the card, and retried on the next pass.
 */
export async function publishRoute(lead, { env = process.env, post = postJson, now = Date.now() } = {}) {
  if (!lead.route?.days?.some((d) => d.placeIds?.length)) {
    return { status: 'no-route', reason: 'אין מסלול לפרסם: היעד לא באתר או בלי מקומות' };
  }
  if (!publishingConfigured(env)) {
    return { status: 'failed', reason: 'GROWTH_PUBLISH_TOKEN חסר ב-.env (לפחות 32 תווים)' };
  }
  try {
    const res = await post(ENDPOINT, tripBody(lead), { headers: auth(env), timeoutMs: 30_000 });
    return {
      status: 'published',
      url: res.url || `${SITE}/trips/${res.slug}`,
      slug: res.slug,
      tripId: res.tripId,
      stopCount: res.stopCount,
      indexable: Boolean(res.indexable),
      publishedAt: lead.trip?.publishedAt && lead.trip.slug === res.slug ? lead.trip.publishedAt : new Date(now).toISOString(),
      externalId: externalIdFor(lead),
    };
  } catch (e) {
    const unknown = e.body?.unknownPlaces?.length || e.body?.unknownCities?.length ? ` (${[...(e.body.unknownCities || []), ...(e.body.unknownPlaces || [])].join(', ')})` : '';
    return { status: 'failed', reason: `הפרסום באתר נכשל: ${e.message}${unknown}`, failedAt: new Date(now).toISOString() };
  }
}

/**
 * Take a published route down. The page answers 410 afterwards.
 *
 * Returns the new trip state, or the old one with the error when the site did
 * not answer, so the timer can try again.
 */
export async function withdrawRoute(lead, { env = process.env, del = deleteJson, now = Date.now() } = {}) {
  if (lead.trip?.status !== 'published') return lead.trip || null;
  try {
    await del(`${ENDPOINT}?externalId=${encodeURIComponent(lead.trip.externalId || externalIdFor(lead))}`, { headers: auth(env), timeoutMs: 30_000 });
    return { ...lead.trip, status: 'withdrawn', withdrawnAt: new Date(now).toISOString(), withdrawError: undefined };
  } catch (e) {
    return { ...lead.trip, withdrawError: e.message };
  }
}

/** Every closed lead whose page is still up, taken down. For the timer. */
export async function withdrawClosed(state, opts = {}) {
  let n = 0;
  for (const lead of Object.values(state.leads)) {
    if (lead.closed && lead.trip?.status === 'published') {
      lead.trip = await withdrawRoute(lead, opts);
      if (lead.trip.status === 'withdrawn') n++;
    }
  }
  return n;
}
