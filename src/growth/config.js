import { readFileSync } from 'node:fs';

// The growth desk's switch, its port, and the settings it starts from.
//
// THE SWITCH LIVES IN post-config.json BECAUSE THAT IS WHERE SWITCHES LIVE, and
// it is read here, raw, rather than through src/postConfig.js. That module
// validates and returns the posting pipeline's own sections and nothing else; a
// growth key is not its business, and teaching it one would be a change to the
// posting code path for the sake of a tool that must not touch it.
//
// GROWTH_ON beats the file in both directions. `GROWTH_ON=1 npm run growth`
// tries it without editing a tracked file; `GROWTH_ON=0` turns it off on a
// machine where the file says on.
//
// Everything else the owner tunes (caps, budget, queries, offers) is a SETTING,
// kept in data/growth.json and edited on the Settings page. The defaults below
// are what a fresh store starts with.

const CONFIG_URL = new URL('../../post-config.json', import.meta.url);

const truthy = (v) => /^(1|true|on|yes)$/i.test(String(v ?? '').trim());
const falsy = (v) => /^(0|false|off|no)$/i.test(String(v ?? '').trim());

function rawGrowth(configUrl) {
  try {
    return JSON.parse(readFileSync(configUrl, 'utf8')).growth || {};
  } catch {
    // An unreadable post-config.json is the posting bot's problem and it will
    // say so loudly. Here it can only mean "not switched on".
    return {};
  }
}

/** Is the desk on, and why. Reads nothing but the env and one JSON key. */
export function growthSwitch({ env = process.env, configUrl = CONFIG_URL } = {}) {
  if (truthy(env.GROWTH_ON)) return { on: true, why: 'GROWTH_ON is set' };
  if (falsy(env.GROWTH_ON)) return { on: false, why: 'GROWTH_ON=0 turns it off' };
  const g = rawGrowth(configUrl);
  if (g.on === true) return { on: true, why: 'growth.on is true in post-config.json' };
  return { on: false, why: 'growth.on is false in post-config.json and GROWTH_ON is not set' };
}

/** The port. Always on 127.0.0.1; only the number is configurable. */
export function growthPort({ env = process.env, configUrl = CONFIG_URL } = {}) {
  const n = Number(env.GROWTH_PORT || rawGrowth(configUrl).port || 4600);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : 4600;
}

// Placeholders the templates may use. Anything else in square brackets is a
// typo, and the Settings page refuses to save it rather than sending a DM with
// "[שמ]" in it.
export const PLACEHOLDERS = ['[שם]', '[יעד]', '[שורה אישית אחת על הפוסט]', '[קישור]', '[מתנה]'];

export const TEMPLATE_NAMES = ['creator', 'creator-followup', 'agency', 'agency-followup', 'customer-link'];

export const TEMPLATE_LABELS = {
  creator: 'הודעה ליוצר/ת',
  'creator-followup': 'תזכורת ליוצר/ת',
  agency: 'הודעה לסוכנות',
  'agency-followup': 'תזכורת לסוכנות',
  'customer-link': 'שורת קישור בתגובה ללקוח (רק כשביקשו מסלול)',
};

export const DEFAULT_SETTINGS = Object.freeze({
  caps: { comment: 10, creator: 5, agency: 3, customer: 5 },
  // Dollars a month, billable: after each API's free allowance.
  budgetUsd: 25,
  // Brave gives a monthly credit on the Search plan. If the account turns out
  // not to get it, set this to 0 and the ledger stops subtracting it.
  braveCreditUsd: 5,
  runHour: 8,
  warmupDays: 1,
  followupDays: 4,
  offers: { creator: '3 חודשי פרו מתנה', agency: 'חודש ראשון חינם' },
  followers: { min: 1000, max: 30000 },
  maxPostAgeDays: 45,
  maxCustomerAgeDays: 14,
  // The site plans trips abroad; a hike in the Galilee is not a route it can build.
  skipCountries: ['ישראל'],
  destinationsPerDay: 3,
  youtubeDestinationsPerDay: 8,
  hashtagsPerDay: 2,
  instagram: true,
  // On since 2026-10-10: the only fresh source of creators. Brave's TikTok and
  // Instagram results were all older than the 45-day limit on the first real run.
  youtube: true,
  tiktokQueries: ['מסלול ב{dest}', 'טיול ל{dest}', 'המלצות {dest}', 'כמה ימים ב{dest}', 'מישהו היה ב{dest}'],
  instagramQueries: ['טיול ל{dest}', 'המלצות {dest}'],
  hashtags: [
    '#טיולבחול', '#מסלולטיול', '#המלצותלטיול', '#טיולים', '#טיוללחול', '#טיולמשפחתי',
    '#טיולזוגי', '#חופשהבחול', '#מטיילים', '#טיולבאירופה', '#טיולכשר', '#טיולשורשים',
  ],
  // "לחו"ל" in the query steers Places toward agencies. Without it, a kosher
  // query plus a city returned a Jerusalem walking-tour company and a farm.
  agencyQueries: ['סוכנות נסיעות', 'סוכן נסיעות', 'טיולים מאורגנים לחו"ל', 'טיולים כשרים לחו"ל', 'מארגני טיולים לחו"ל'],
  agencyCities: [
    'ירושלים', 'בני ברק', 'בית שמש', 'תל אביב', 'פתח תקווה', 'מודיעין עילית', 'חיפה',
    'אשדוד', 'ראשון לציון', 'נתניה', 'רחובות', 'באר שבע', 'אלעד', 'ביתר עילית',
  ],
  models: { draft: 'claude-sonnet-5-5', sort: 'claude-haiku-4-5' },
});

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Stored settings over the defaults, one level deep for the grouped ones. */
export function mergeSettings(stored = {}) {
  const out = structuredClone(DEFAULT_SETTINGS);
  for (const [k, v] of Object.entries(stored || {})) {
    if (!(k in out)) continue;
    if (isObj(out[k]) && isObj(v)) out[k] = { ...out[k], ...v };
    else if (Array.isArray(out[k]) && Array.isArray(v)) out[k] = v.map((s) => String(s).trim()).filter(Boolean);
    else if (typeof out[k] === typeof v) out[k] = v;
  }
  return out;
}

/** Which keys the desk needs, and which of them this machine has. Names only. */
export function keyStatus(env = process.env) {
  const has = (k) => Boolean(String(env[k] || '').trim());
  return {
    anthropic: has('ANTHROPIC_API_KEY'),
    brave: has('BRAVE_API_KEY'),
    places: has('GOOGLE_MAPS_KEY'),
    youtube: has('YOUTUBE_API_KEY') || has('GOOGLE_MAPS_KEY'),
    ga4: has('GA4_PROPERTY_ID') && (has('GA4_SERVICE_ACCOUNT_FILE') || has('GOOGLE_APPLICATION_CREDENTIALS')),
  };
}
