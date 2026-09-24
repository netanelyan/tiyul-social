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
  const vars = { dest: plan.dest.he, days, country: plan.dest.country || plan.dest.he };

  const text = {
    askWhoHe: cfg.askWhoHe,
    askHe: fill(cfg.askHe, vars),
    hookHe: fill(cfg.hookHe, vars),
    hookSubHe: fill(cfg.hookSubHe, vars),
    totalLabelHe: fill(cfg.totalLabelHe, vars),
    perPersonHe: fill(cfg.perPersonHe, vars),
    totalNoteHe: fill(cfg.totalNoteHe, vars),
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
    stepsHe: g.stepsHe.map((s) => fill(s, withKeyword)),
    captionHe: g.captionHe ? fill(g.captionHe, withKeyword) : null,
    footHe: g.footHe ? fill(g.footHe, withKeyword) : '',
  };

  for (const s of [out.titleHe, out.captionHe, out.footHe, ...out.stepsHe]) {
    if (s) assertNoUrl(s, 'plans.giveaway');
  }
  // An ask with no steps on it is a slide that says "חודש פרימיום במתנה" and
  // does not say how. That is worse than no slide: it promises and withholds.
  if (!out.stepsHe.length) {
    throw new Error('plans.giveaway is on but has no stepsHe — the ask slide would promise without asking');
  }
  return out;
}
