import { readFileSync } from 'node:fs';
import { ilDate } from '../rules.js';

// What to search for today.
//
// A rotation, not a random draw: a random draw repeats Athens three days running
// and leaves Hanoi untouched for a month. Day N takes the next block of
// destinations from destinations.json, wrapping, so every destination comes back
// on a fixed cycle (102 destinations at 3 a day is about five weeks). The same
// for hashtags and for the agency searches.
//
// destinations.json is read, never written, and it is the same file the posting
// pipeline rotates through. Its Hebrew names are the ones this audience types.

let cached = null;
export const destinations = () =>
  (cached ??= JSON.parse(readFileSync(new URL('../../../destinations.json', import.meta.url), 'utf8')).destinations || []);

/** Days since 2026-01-01, Israel time. The rotation's clock. */
export const dayNumber = (now = Date.now()) => Math.round((Date.parse(`${ilDate(now)}T00:00:00Z`) - Date.parse('2026-01-01T00:00:00Z')) / 86_400_000);

/** `n` items from `list`, block number `day`, wrapping. */
export function rotate(list, n, day) {
  if (!list.length || n <= 0) return [];
  const start = (((day * n) % list.length) + list.length) % list.length;
  return Array.from({ length: Math.min(n, list.length) }, (_, i) => list[(start + i) % list.length]);
}

export const fillDest = (template, dest) => String(template).replaceAll('{dest}', dest.he);

/**
 * Today's searches: Brave queries for TikTok and Instagram, and one Places query.
 *
 * Each query carries what produced it (`query`, `hashtag`, `dest`), so a lead
 * remembers it and the Reports page can say which ones turned into a yes.
 */
export function todaysSearches(settings, { now = Date.now(), dests = destinations() } = {}) {
  const day = dayNumber(now);
  const todayDests = rotate(dests, settings.destinationsPerDay, day);
  const out = [];

  // " video" on TikTok queries: without it the index answers with topic pages
  // instead of videos (see the measurement in brave.js).
  for (const d of todayDests) {
    for (const q of settings.tiktokQueries) {
      out.push({ platform: 'tiktok', site: 'tiktok.com', text: `${fillDest(q, d)} video`, query: q, dest: d });
    }
    if (settings.instagram) {
      for (const q of settings.instagramQueries) {
        out.push({ platform: 'instagram', site: 'instagram.com', text: fillDest(q, d), query: q, dest: d });
      }
    }
  }

  for (const tag of rotate(settings.hashtags, settings.hashtagsPerDay, day)) {
    out.push({ platform: 'tiktok', site: 'tiktok.com', text: `${tag} video`, hashtag: tag });
    if (settings.instagram) out.push({ platform: 'instagram', site: 'instagram.com', text: tag, hashtag: tag });
  }

  // One Places search a day returns twenty businesses, which is a week of
  // three-a-day. The query and the city rotate on different cycles so every
  // pairing comes up eventually.
  const aq = settings.agencyQueries[day % Math.max(1, settings.agencyQueries.length)];
  const city = settings.agencyCities[Math.floor(day / Math.max(1, settings.agencyQueries.length)) % Math.max(1, settings.agencyCities.length)];
  const agency = aq && city ? { text: `${aq} ${city}`, query: aq, city } : null;

  return { day, dests: todayDests, brave: out, agency };
}
