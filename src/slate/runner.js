import { inShabbat } from '../schedule.js';
import { israelDate, israelInstant } from './plan.js';
import { openingKey } from './build.js';

// The context a slate is planned in, read from what has published and from the
// slates before it. Pure: bot.js hands in the store's lists.

const DAY = 86_400_000;
const dateMinus = (date, days) => israelDate(Date.parse(`${date}T12:00:00Z`) - days * DAY);

/**
 * Week one posts fewer TikTok slots. Counted from the first slate this box ever
 * built, so the ramp starts when the schedule goes live, not when the code ships.
 * Returns the TikTok count for the day, or null for the full set.
 */
export function rampFor(cfg, slates, date) {
  if (!cfg.rampDays) return null;
  const first = slates.map((s) => s.date).filter((d) => d <= date).sort()[0] || date;
  const days = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${first}T12:00:00Z`)) / DAY);
  return days < cfg.rampDays ? cfg.rampTiktokPerDay : null;
}

/** The template each platform posted last before `date`, so today does not open on it. */
export function lastTemplates(slates, date) {
  const out = {};
  for (const s of slates.filter((x) => x.date < date).sort((a, b) => (a.date < b.date ? 1 : -1))) {
    for (const p of ['tiktok', 'instagram']) {
      if (out[p]) continue;
      const done = s.items.filter((it) => it[p]?.status === 'published' && it[`${p}At`]).sort((a, b) => Date.parse(b[`${p}At`]) - Date.parse(a[`${p}At`]));
      if (done[0]) out[p] = done[0].template;
    }
    if (out.tiktok && out.instagram) break;
  }
  return out;
}

/**
 * Places inside the destination window: what published in the last `days`, what
 * earlier slates planned in it (planned counts: tomorrow's Athens is still Athens
 * this week), and the suggestion ring the rest of the bot already avoids.
 */
export function recentPlacesFor(published, slates, date, days, suggested = []) {
  const since = Date.parse(`${dateMinus(date, days)}T00:00:00Z`);
  const fromPublished = published.filter((p) => (p.ts || 0) >= since).map((p) => p.place).filter(Boolean);
  const fromSlates = slates
    .filter((s) => s.date >= dateMinus(date, days) && s.date < date)
    .flatMap((s) => s.items.filter((it) => !it.skipped).map((it) => it.cand?.deck?.where))
    .filter(Boolean);
  return [...new Set([...fromPublished, ...fromSlates, ...suggested])];
}

/** Opening lines inside the opening window, from published rows and earlier slates. */
export function recentOpeningsFor(published, slates, date, days) {
  const since = Date.parse(`${dateMinus(date, days)}T00:00:00Z`);
  const fromPublished = published.filter((p) => (p.ts || 0) >= since).map((p) => p.headline).filter(Boolean);
  const fromSlates = slates
    .filter((s) => s.date >= dateMinus(date, days) && s.date < date)
    .flatMap((s) => s.items.map((it) => it.cand?.headline))
    .filter(Boolean);
  return [...new Set([...fromPublished, ...fromSlates].map(openingKey))];
}

/**
 * When the digest goes out. At `digestAt`, unless that falls inside Shabbat, in
 * which case at Shabbat's end: the owner is not messaged on Shabbat morning about
 * posts that cannot go out until the evening anyway.
 */
export function digestTimeFor(date, cfg) {
  let at = israelInstant(date, cfg.digestAt);
  for (let i = 0; i < 4 * 24 && inShabbat(at); i++) at = new Date(at.getTime() + 15 * 60_000);
  return at;
}
