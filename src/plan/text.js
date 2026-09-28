import { postConfig } from '../postConfig.js';
import { assertNoUrl } from '../format.js';

// Every word on a plan's slides that was not written by the model.
//
// The hook, the ask, the day labels, the giveaway steps — all of them are
// templates in post-config.json with `{dest}`, `{days}`, `{n}`, `{winners}` and
// `{premiumDays}` in them, and this is the one place they are filled. Two
// reasons it is a module rather than three template literals at the call sites:
//
//   · The SAME strings go on a slide and into the caption. "עקבו ותגיבו רומא"
//     burned into the last frame while the description says a different number
//     of winners is the kind of contradiction a viewer reads as carelessness and
//     a commenter reads as a broken promise.
//
//   · It is a promise about a giveaway. `on: false` has to remove it from
//     everywhere at once, and one function is how that is guaranteed rather than
//     remembered.

/** {dest}, {days}, {n}, {keyword}, {winners}, {premiumDays} — nothing else. */
const fill = (tpl, vars) =>
  String(tpl || '').replace(/\{(\w+)\}/g, (whole, key) => (key in vars ? String(vars[key]) : whole));

/**
 * The fixed text for one plan, with the destination and the day count in it.
 *
 * Every string is run through assertNoUrl on the way out. post-config.json is
 * checked for a domain when it is read, which catches a template — but not a
 * DESTINATION name, and that arrives from destinations.json by a different
 * route. A slide is as published as a caption.
 */
export function planText(plan) {
  const cfg = postConfig().plans;
  const days = plan.days.length;
  const money = (n) => Number(n || 0).toLocaleString('en-US');
  // `budget` and `left` are only ever read by the budgeted templates, and a
  // budgeted plan always carries both: src/plan/write.js throws rather than
  // return one without them. Grouped, so an unbudgeted plan substitutes an
  // empty string into a template that should never have been chosen for it,
  // instead of the word "undefined" appearing on a cover.
  const vars = {
    dest: plan.dest.he,
    days,
    country: plan.dest.country || plan.dest.he,
    budget: plan.budgetIls ? money(plan.budgetIls) : '',
    left: plan.budgetIls ? money(plan.left) : '',
  };

  // WHICH COVER AND WHICH DISCLAIMER, decided once, here.
  //
  // The two pairs are not interchangeable and the wrong pairing is the failure
  // this format was most likely to ship: a cover promising a trip for 1,200 ₪
  // over a total slide explaining that the figure excludes the flight. Picking
  // both off the same flag is what makes that combination unreachable.
  const budgeted = Boolean(plan.budgetIls);

  // WHOSE PLAN IT IS, and it decides the cover.
  //
  // "ביקשתי מ-AI לתכנן" was the exact truth for as long as a model wrote every
  // itinerary here. On a plan lifted from the site's own page it is false, and
  // falsely modest in the one direction that costs something: the post exists
  // to send somebody to that page, and telling them a bot invented the route
  // is an argument against going. Three sources, three covers, picked here so
  // the wrong pairing cannot be assembled downstream.
  const fromSite = plan.source === 'site';

  const text = {
    budgeted,
    fromSite,
    // Whether any number on this plan may be printed. A site plan has a visit
    // length and a price band and no prices at all, so the slide, the caption
    // and the approval card all have to stop asking for them, and one flag is
    // how they agree about it.
    priced: plan.priced !== false,
    askWhoHe: cfg.askWhoHe,
    askHe: fill(cfg.askHe, vars),
    hookHe: fill(fromSite ? cfg.hookSiteHe : budgeted ? cfg.hookBudgetHe : cfg.hookHe, vars),
    hookSubHe: fill(cfg.hookSubHe, vars),
    totalLabelHe: fill(cfg.totalLabelHe, vars),
    perPersonHe: fill(cfg.perPersonHe, vars),
    totalNoteHe: fill(budgeted ? cfg.totalNoteBudgetHe : cfg.totalNoteHe, vars),
    breakdownLabelHe: fill(cfg.breakdownLabelHe, vars),
    attractionsHe: cfg.attractionsHe,
    // "נשאר 0 ₪" is a sentence nobody writes. Coming in exactly on the number
    // is a better outcome than coming in under it and deserves to say so.
    leftHe: fill(plan.left === 0 ? cfg.leftNoneHe : cfg.leftHe, vars),
    // A function rather than a string, because the day number is the one
    // variable the caller has and this module does not.
    dayLabelFor: (n) => fill(cfg.dayLabelHe, { ...vars, n }),
  };

  for (const [k, v] of Object.entries(text)) {
    if (typeof v === 'string') assertNoUrl(v, `plans.${k}`);
  }
  assertNoUrl(text.dayLabelFor(1), 'plans.dayLabelHe');

  return text;
}

/**
 * The giveaway, filled — or null when it is switched off.
 *
 * Null is load-bearing: it is what removes the ask slide, the caption line and
 * the promise together. See the note on `giveaway.on` in src/postConfig.js.
 */
export function planGiveaway(plan) {
  const g = postConfig().plans.giveaway;
  if (!g.on) return null;

  const vars = { dest: plan.dest.he, days: plan.days.length, winners: g.winners, premiumDays: g.premiumDays };
  const keyword = fill(g.keywordHe, vars);
  const withKeyword = { ...vars, keyword };

  const out = {
    on: true,
    winners: g.winners,
    premiumDays: g.premiumDays,
    keyword,
    titleHe: fill(g.titleHe, withKeyword),
    actionHe: g.actionHe ? fill(g.actionHe, withKeyword) : null,
    prizeHe: g.prizeHe ? fill(g.prizeHe, withKeyword) : null,
    captionHe: g.captionHe ? fill(g.captionHe, withKeyword) : null,
    footHe: g.footHe ? fill(g.footHe, withKeyword) : '',
  };

  for (const s of [out.titleHe, out.actionHe, out.prizeHe, out.captionHe, out.footHe]) {
    if (s) assertNoUrl(s, 'plans.giveaway');
  }
  // An ask with no instruction on it is a slide that offers a month of premium
  // and does not say how to get it. That is worse than no slide: it promises
  // and withholds.
  if (!out.actionHe || !out.prizeHe) {
    throw new Error('plans.giveaway is on but has no actionHe/prizeHe - the ask slide would promise without asking');
  }
  return out;
}
