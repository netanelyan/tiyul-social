import { monthKey } from './rules.js';

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

// $ per 1M tokens, checked on platform.claude.com/docs pricing, 2026-10-10.
export const MODEL_RATES = {
  'claude-sonnet-5-5': { in: 2, out: 10 },
  'claude-haiku-4-5': { in: 1, out: 5 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5 },
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-opus-5': { in: 5, out: 25 },
  'claude-opus-5-5': { in: 5, out: 25 },
};
const WORST = { in: 5, out: 25 };

/** Dollars for one Claude response's usage block. */
export function claudeCost(usage = {}, model) {
  const r = MODEL_RATES[model] || WORST;
  const fresh = usage.input_tokens || 0;
  const write = usage.cache_creation_input_tokens || 0;
  const read = usage.cache_read_input_tokens || 0;
  const out = usage.output_tokens || 0;
  return (fresh * r.in + write * r.in * 1.25 + read * r.in * 0.1 + out * r.out) / 1e6;
}

// Per-unit list prices for the metered APIs. `free` is a monthly allowance in
// units, or `freeUsd` a monthly credit in dollars (Brave's, set in Settings).
export const API_PRICES = {
  brave: { label: 'Brave Search', usdPerUnit: 5 / 1000 },
  places: { label: 'Google Places', usdPerUnit: 35 / 1000, free: 1000 },
  claude: { label: 'Claude', usdPerUnit: 0 },
  oembed: { label: 'TikTok oEmbed', usdPerUnit: 0 },
  youtube: { label: 'YouTube', usdPerUnit: 0 },
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
  if (s.reached) throw new BudgetError(`תקציב החודש נוצל ($${s.billable.toFixed(2)} מתוך $${s.cap})`);
  if (s.billable + estimateUsd > s.cap) {
    throw new BudgetError(`הקריאה הבאה (${API_PRICES[api]?.label || api}) תעבור את התקציב ($${s.billable.toFixed(2)} מתוך $${s.cap})`);
  }
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
