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
//
// THE FIRST MESSAGES ARE NO LONGER TEMPLATES. The agency message was a fixed
// brochure sentence and the creator DM a template around one model line, and
// both read as written by a bot (the owner's examples, 2026-10-11). They are
// now written whole by the drafting model, in Netanel's voice, about the one
// thing that is specific to that agency or that video (prepare/draft.js). The
// follow-ups and the customer reply's link line stay templates: they are one
// short sentence each, and the same sentence is the right one every time.
export const PLACEHOLDERS = ['[יעד]', '[קישור]'];

export const TEMPLATE_NAMES = ['creator-followup', 'agency-followup', 'customer-link'];

export const TEMPLATE_LABELS = {
  'creator-followup': 'Follow-up to a creator',
  'agency-followup': 'Follow-up to an agency',
  'customer-link': 'Link line in a reply (only when they asked for a route)',
};

// The limits, in characters and sentences, enforced in code (prepare/tells.js).
// `target` is what the prompt asks for; `max` is where code refuses. A link
// counts as `linkChars`, whatever its real length, so a long trip slug does not
// push a short message over.
export const LIMITS = Object.freeze({
  // A reaction to a video: one tip, said the way people say it in comments.
  comment: { target: 150, max: 170, sentences: 2 },
  // An answer to somebody asking how to plan a trip needs a little more room.
  reply: { target: 250, max: 280, sentences: 3 },
  // A first message to an agency or a creator, on WhatsApp or in a DM.
  message: { target: 350, max: 380, sentences: 5, links: 1 },
  followup: { target: 120, max: 140, sentences: 2 },
  linkChars: 25,
});

export const DEFAULT_SETTINGS = Object.freeze({
  caps: { comment: 10, creator: 5, agency: 3, customer: 5 },
  // Dollars a month, billable: after each API's free allowance. $50 from
  // 2026-10-11, when drafting moved to Opus 5.5 with a review pass.
  budgetUsd: 50,
  // New route pages a day on tiyulplus.com, creators and agencies together. The
  // site caps new publications by the editor account at 20 per 24 hours
  // (SITE-SPEC.md); a re-send does not count.
  publishPerDay: 20,
  // Brave gives a monthly credit on the Search plan. If the account turns out
  // not to get it, set this to 0 and the ledger stops subtracting it.
  braveCreditUsd: 5,
  runHour: 8,
  warmupDays: 1,
  // Days without a reply before the one follow-up comes back on Today, and again
  // after it before the lead closes as "no reply" (the owner, 2026-10-11: 5).
  followupDays: 5,
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
  // Drafting and the skeptical-reader pass: Opus 5.5, the owner's choice on
  // 2026-10-11 over Fable 5.1, which costs two and a half times as much and is
  // to be switched to only if the side-by-side proof shows it clearly better.
  // Reading an agency's own site into facts is extraction, not text anybody
  // reads, so Sonnet. Sorting found posts stays on Haiku.
  models: { draft: 'claude-opus-5-5', review: 'claude-opus-5-5', extract: 'claude-sonnet-5-5', sort: 'claude-haiku-4-5' },
  // How hard the drafting and review calls think. Thinking cannot be turned off
  // on Opus 5.5 or Fable 5.1; effort is the only dial, and Opus 5.5's own
  // default is medium.
  effort: 'medium',
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
