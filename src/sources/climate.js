import { readFileSync } from 'node:fs';
import { fetchText } from '../fetchPage.js';

// The "when to go somewhere, and when not to" pillar.
//
// Every other adapter waits for someone else to publish something. This one
// asks a question of a dataset, which makes it the only source that reliably
// has something to say on a quiet day. The claim it produces ("July is brutal
// in Athens, May and October are the sweet spot") is derived arithmetic over
// ERA5 reanalysis, and the source URL recorded on the candidate is the exact
// API request — anyone can re-run it and get the same numbers back. That is a
// stronger primary source than a travel article asserting the same thing.

const HE_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];
export const monthHe = (i) => HE_MONTHS[i];

const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';

// Ten full years of ERA5 daily values. Long enough that one freak summer
// doesn't move a month's verdict, short enough to still describe the climate
// someone will actually travel into.
const YEARS = 10;

function windowDates(now = new Date()) {
  const endYear = now.getUTCFullYear() - 1; // last complete year
  return { start: `${endYear - YEARS + 1}-01-01`, end: `${endYear}-12-31`, endYear };
}

export function buildUrl(dest, now = new Date()) {
  const { start, end } = windowDates(now);
  const p = new URLSearchParams({
    latitude: String(dest.lat),
    longitude: String(dest.lon),
    start_date: start,
    end_date: end,
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum',
    timezone: 'UTC',
  });
  return `${ARCHIVE}?${p}`;
}

export function loadDestinations() {
  const raw = JSON.parse(readFileSync(new URL('../../destinations.json', import.meta.url), 'utf8'));
  return raw.destinations || [];
}

/** Fold daily ERA5 values into per-month normals. */
export function monthlyNormals(daily) {
  const buckets = Array.from({ length: 12 }, () => ({ maxSum: 0, minSum: 0, days: 0, wetDays: 0, precipSum: 0, years: new Set() }));
  const { time = [], temperature_2m_max: tmax = [], temperature_2m_min: tmin = [], precipitation_sum: prcp = [] } = daily || {};

  for (let i = 0; i < time.length; i++) {
    const d = time[i];
    if (typeof d !== 'string' || d.length < 7) continue;
    const m = Number(d.slice(5, 7)) - 1;
    if (!(m >= 0 && m < 12)) continue;
    const b = buckets[m];
    const hi = tmax[i];
    const lo = tmin[i];
    const pr = prcp[i];
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) continue;
    b.maxSum += hi;
    b.minSum += lo;
    b.days++;
    b.years.add(d.slice(0, 4));
    if (Number.isFinite(pr)) {
      b.precipSum += pr;
      if (pr >= 1) b.wetDays++;
    }
  }

  return buckets.map((b, i) => {
    if (!b.days) return { month: i, meanMax: null, meanMin: null, wetDaysPerMonth: null, precipPerMonth: null };
    const years = Math.max(1, b.years.size);
    return {
      month: i,
      meanMax: round1(b.maxSum / b.days),
      meanMin: round1(b.minSum / b.days),
      wetDaysPerMonth: round1(b.wetDays / years),
      precipPerMonth: Math.round(b.precipSum / years),
    };
  });
}

const round1 = (n) => Math.round(n * 10) / 10;

// Thresholds are stated here rather than buried in the drafting prompt, so the
// verdict on a month is reproducible and arguable. They describe general
// sightseeing comfort — walking a city, being outdoors most of the day.
const T = {
  goodMaxHigh: 30,
  goodMaxLow: 17,
  avoidMaxHigh: 34,
  avoidMaxLow: 8,
  goodWetDays: 10,
  avoidWetDays: 16,
};

export function verdictFor(n) {
  if (n.meanMax == null) return 'unknown';
  if (n.meanMax >= T.avoidMaxHigh || n.meanMax <= T.avoidMaxLow) return 'avoid';
  if (n.wetDaysPerMonth != null && n.wetDaysPerMonth >= T.avoidWetDays) return 'avoid';
  if (
    n.meanMax <= T.goodMaxHigh &&
    n.meanMax >= T.goodMaxLow &&
    (n.wetDaysPerMonth == null || n.wetDaysPerMonth <= T.goodWetDays)
  ) {
    return 'good';
  }
  return 'shoulder';
}

/**
 * Build a when-to-go item for one destination.
 *
 * `summary` is written as plain factual English rather than as a draft — the
 * drafting step turns it into Hebrew copy, and verify.js checks the drafted
 * claim against this text, so the numbers here are the ones that get checked.
 */
export async function fetchClimate(source, dest, now = new Date()) {
  const url = buildUrl(dest, now);
  const { body } = await fetchText(url, { accept: 'application/json', timeoutMs: 40_000 });

  let json;
  try {
    json = JSON.parse(body);
  } catch (e) {
    throw new Error(`open-meteo returned unparseable JSON: ${e.message}`);
  }
  if (json.error) throw new Error(`open-meteo error: ${json.reason || 'unknown'}`);

  const normals = monthlyNormals(json.daily);
  const months = normals.map((n) => ({ ...n, verdict: verdictFor(n) }));
  if (months.every((m) => m.verdict === 'unknown')) throw new Error('no usable climate data returned');

  const { start, end } = windowDates(now);
  const good = months.filter((m) => m.verdict === 'good').map((m) => HE_MONTHS[m.month]);
  const avoid = months.filter((m) => m.verdict === 'avoid').map((m) => HE_MONTHS[m.month]);

  const lines = months.map(
    (m) =>
      `${String(m.month + 1).padStart(2, '0')} — mean daily high ${m.meanMax}C, mean low ${m.meanMin}C, ` +
      `${m.wetDaysPerMonth} wet days/month (>=1mm), verdict ${m.verdict}`
  );

  return {
    sourceId: source.id,
    sourceName: source.name,
    authority: source.authority,
    lang: 'data',
    pillarHints: ['timing'],
    title: `${dest.en} — monthly climate normals ${start.slice(0, 4)}–${end.slice(0, 4)} (ERA5)`,
    summary:
      `Destination: ${dest.en}, ${dest.country}. Hebrew name to use verbatim: ${dest.he}.\n` +
      `Source: Open-Meteo ERA5 reanalysis, daily values ${start} to ${end}, averaged per calendar month.\n` +
      `Comfort thresholds applied: "avoid" if mean daily high >= ${T.avoidMaxHigh}C or <= ${T.avoidMaxLow}C ` +
      `or >= ${T.avoidWetDays} wet days; "good" if mean daily high is ${T.goodMaxLow}–${T.goodMaxHigh}C ` +
      `and <= ${T.goodWetDays} wet days; otherwise "shoulder".\n` +
      lines.join('\n') +
      `\nBest months: ${good.join(', ') || 'none by these thresholds'}.` +
      `\nMonths to avoid: ${avoid.join(', ') || 'none by these thresholds'}.`,
    url,
    publishedAt: new Date().toISOString(),
    // Carried through to the renderer — the whenToGo template draws this strip
    // directly from the data rather than from anything the model wrote.
    data: {
      kind: 'climate',
      destination: { id: dest.id, he: dest.he, en: dest.en, country: dest.country },
      months: months.map((m) => ({ month: m.month, meanMax: m.meanMax, wetDays: m.wetDaysPerMonth, verdict: m.verdict })),
      window: { start, end },
    },
    // Stable per destination per year: one when-to-go post per place per year is
    // plenty, and the dedupe store enforces exactly that.
    dedupeId: `climate:${dest.id}:${end.slice(0, 4)}`,
  };
}
