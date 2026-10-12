// The Israel month, YYYY-MM: the ledger's key. Local, so this module needs
// nothing from the growth desk or the bot.
const MONTH = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' });
export const monthKey = (t = Date.now()) => MONTH.format(new Date(t)).slice(0, 7);

// The monthly ledger, and the stop.
//
// Every paid call asks `guard` first and reports to `record` after. The cap is
// on BILLABLE dollars, after each API's own free allowance, because that is the
// number on the card statement; the gross list price is kept beside it so the
// page can say how much of the month the free tiers absorbed.
//
// Claude is priced from the tokens each response reports, at the published
// rates below. src/usage.js has a table too, but for the models the posting
// pipeline runs, and its fallback for an unknown model is a guess this ledger
// should not make silently: an unknown model here is billed at the most
// expensive rate in the table, so a typo in Settings overstates the spend
// rather than hiding it.

// $ per 1M tokens: input, output, and a cache read, from Anthropic's published
// rates as of 2026-10-11. A cache write is billed at 1.25 times the input rate.
// Opus 5.5 was listed here at $5/$25 until the drafting moved to it; its price
// is $4/$20.
export const MODEL_RATES = {
  'claude-fable-5-1': { in: 10, out: 50, cacheRead: 0.25 },
  'claude-fable-5': { in: 10, out: 50, cacheRead: 0.25 },
  'claude-opus-5-5': { in: 4, out: 20, cacheRead: 0.2 },
  'claude-opus-5': { in: 5, out: 25, cacheRead: 0.5 },
  'claude-sonnet-5-5': { in: 2, out: 10, cacheRead: 0.2 },
  'claude-sonnet-5': { in: 2, out: 10, cacheRead: 0.2 },
  'claude-haiku-4-5': { in: 1, out: 5, cacheRead: 0.1 },
};

// An unknown model is billed at the most expensive rate in the table, so a typo
// in Settings overstates the spend rather than hiding it. Computed, so adding a
// dearer model above can never leave this at a cheaper one's price.
export const WORST = Object.values(MODEL_RATES).reduce((a, b) => (b.in + b.out > a.in + a.out ? b : a));

/** Dollars for one Claude response's usage block. */
export function claudeCost(usage = {}, model) {
  const r = MODEL_RATES[model] || WORST;
  const fresh = usage.input_tokens || 0;
  const write = usage.cache_creation_input_tokens || 0;
  const read = usage.cache_read_input_tokens || 0;
  const out = usage.output_tokens || 0;
  return (fresh * r.in + write * r.in * 1.25 + read * (r.cacheRead ?? r.in * 0.1) + out * r.out) / 1e6;
}

// Per-unit list prices for the metered APIs. `free` is a monthly allowance in
// units, or `freeUsd` a monthly credit in dollars (Brave's, set in Settings).
export const API_PRICES = {
  brave: { label: 'Brave Search', usdPerUnit: 5 / 1000 },
  places: { label: 'Google Places', usdPerUnit: 35 / 1000, free: 1000 },
  claude: { label: 'Claude', usdPerUnit: 0 },
  oembed: { label: 'TikTok oEmbed', usdPerUnit: 0 },
  youtube: { label: 'YouTube', usdPerUnit: 0 },
  instagram: { label: 'Instagram Graph', usdPerUnit: 0 },
  ga4: { label: 'GA4', usdPerUnit: 0 },
};

export class BudgetError extends Error {
  constructor(message) {
    super(message);
    this.code = 'budget';
  }
}

const month = (state, now) => (state.spend[monthKey(now)] ??= {});

/** Record a call (or `units` of them), with `usd` when the cost is not per unit. */
export function record(state, api, { units = 1, usd = null, now = Date.now() } = {}) {
  const m = month(state, now);
  const row = (m[api] ??= { units: 0, usd: 0 });
  row.units += units;
  row.usd += usd ?? units * (API_PRICES[api]?.usdPerUnit || 0);
}

/** This month: gross list price, billable after allowances, per API and total. */
export function monthSpend(state, settings, now = Date.now()) {
  const m = state.spend[monthKey(now)] || {};
  const rows = {};
  let gross = 0;
  let billable = 0;
  for (const [api, row] of Object.entries(m)) {
    const p = API_PRICES[api] || {};
    let bill = row.usd;
    if (p.free) bill = Math.max(0, row.units - p.free) * p.usdPerUnit;
    if (api === 'brave') bill = Math.max(0, row.usd - (Number(settings?.braveCreditUsd) || 0));
    rows[api] = { units: row.units, gross: row.usd, billable: bill };
    gross += row.usd;
    billable += bill;
  }
  const cap = Number(settings?.budgetUsd) || 0;
  return { rows, gross, billable, cap, left: Math.max(0, cap - billable), reached: billable >= cap };
}

/**
 * Refuse a call that would take the month past the cap.
 *
 * `estimateUsd` is what the call is expected to add to the BILLABLE total. A
 * call inside a free allowance costs nothing billable and is still refused once
 * the cap is reached: the cap is a stop, not a forecast, and "finding stops at
 * the cap" has to be true without anyone working out which tier a call is in.
 */
export function guard(state, settings, api, estimateUsd = 0, now = Date.now()) {
  const s = monthSpend(state, settings, now);
  if (s.reached) throw new BudgetError(`This month's budget is used up ($${s.billable.toFixed(2)} of $${s.cap}).`);
  if (s.billable + estimateUsd > s.cap) {
    throw new BudgetError(`The next ${API_PRICES[api]?.label || api} call would go over this month's budget ($${s.billable.toFixed(2)} of $${s.cap}).`);
  }
}

/**
 * What one drafting call is expected to cost, for the guard.
 *
 * The guard refuses a call that would cross the cap, so this has to be a fair
 * ceiling for the model in use: $0.03 was right for Sonnet and is a tenth of a
 * Fable call. About 12,000 tokens in and 4,000 out (thinking included) is the
 * size of a three-variant draft with its context and few-shot examples.
 */
export function draftEstimate(model, { inTokens = 12_000, outTokens = 4_000 } = {}) {
  const r = MODEL_RATES[model] || WORST;
  return (inTokens * r.in + outTokens * r.out) / 1e6;
}

/** What one more call of this API adds to the billable total, right now. */
export function marginal(state, settings, api, now = Date.now()) {
  const p = API_PRICES[api];
  if (!p || !p.usdPerUnit) return 0;
  const row = (state.spend[monthKey(now)] || {})[api] || { units: 0, usd: 0 };
  if (p.free && row.units + 1 <= p.free) return 0;
  if (api === 'brave' && row.usd + p.usdPerUnit <= (Number(settings?.braveCreditUsd) || 0)) return 0;
  return p.usdPerUnit;
}
