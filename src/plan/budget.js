// A plan with a number on the cover.
//
// BRIEF.md names this format: "B | Budget breakdown | the trip itemised in ₪",
// and the hook it gives as an example is "טיול 5 ימים ברומא ב-2,000 ₪, ככה".
// That hook is a promise about the WHOLE trip, and it is the reason this module
// exists rather than a `budget` field on writePlan.
//
// WHAT CHANGES WHEN A BUDGET IS NAMED, AND WHY IT HAD TO.
//
// A plain /trip prices entrances and nothing else. `plans.totalNoteHe` says so
// on the slide, and the config comment under it is blunt about why: "a number
// that invites the wrong reading is the same defect as a wrong number". That is
// survivable when the cover makes no claim about the total. It is not
// survivable under a cover reading "1,200 ₪ ל-5 ימים בפראג", because a viewer
// reads that as the trip, and a total that quietly excludes the flight and four
// nights is off by a factor of three.
//
// So a budgeted plan carries FIXED COSTS as well as stops, the total is the sum
// of both, and the breakdown is printed on its own slide. The cover's number is
// then a claim the post can actually support on screen.
//
// None of this touches the unbudgeted path. /trip with no number asks for the
// same plan it always did, against the same frozen system prompt, and its total
// is still entrances only.

/** The fixed costs, in the order they are printed. Stops are the fifth line. */
export const COST_LINES = [
  { key: 'flightIls', he: 'טיסה', max: 6000 },
  { key: 'lodgingIls', he: 'לינה', max: 8000 },
  { key: 'foodIls', he: 'אוכל', max: 4000 },
  { key: 'transitIls', he: 'תחבורה', max: 1500 },
];

/**
 * The smallest budget worth accepting, in shekels.
 *
 * Not a style rule. Below this the flight alone eats the budget, the planner
 * has nothing to allocate, and what comes back is a plan that satisfies the cap
 * by pricing four days of a European city at zero. A refusal naming the floor
 * is a better answer than a plan nobody believes.
 */
export const BUDGET_MIN = 600;

/** Above this a "budget" is a typo, or somebody typed a phone number. */
export const BUDGET_MAX = 40_000;

/**
 * `/trip פראג 5 1200` and everything else somebody actually types.
 *
 * The old parser took one trailing number and called it days. A budget is also
 * a trailing number, so the two cannot be told apart by position alone and the
 * split is by MAGNITUDE instead: anything under `BUDGET_MIN` is a day count and
 * anything at or above it is money.
 *
 * The split is at the budget floor rather than at the day ceiling on purpose.
 * `/trip רומא 7` has always meant seven days, clamped to five by writePlan, and
 * a parser that reclassified it as a seven shekel budget would turn a working
 * command into an error message. Days are still clamped downstream exactly as
 * they were; nothing about the unbudgeted path changes.
 *
 * Returns `{ asked, days, budgetIls, error }`. `error` is a Hebrew sentence
 * for the chat when the numbers cannot be read, because the command answering
 * with a plan is the whole point and a silent misparse costs a model call and
 * produces the wrong post.
 */
export function parseTripArgs(arg) {
  const raw = String(arg || '').trim();
  if (!raw) return { asked: '', days: null, budgetIls: null, error: null };

  // Money as it gets typed: "1200₪", "1200 ש״ח", "ב-1200", "1,200".
  // The currency mark and the leading ב- are stripped here so the number
  // survives into the token list; what they signal is picked up below.
  const marked = new Set();
  const tokens = raw
    .split(/\s+/)
    .map((t) => {
      const money = /₪|ש״ח|ש"ח|שח/.test(t) || /^ב-?\d/.test(t);
      const cleaned = t
        .replace(/₪|ש״ח|ש"ח|שח/g, '')
        .replace(/^ב-?(?=\d)/, '')
        .replace(/(\d),(?=\d{3}\b)/g, '$1')
        .trim();
      if (money && /^\d+$/.test(cleaned)) marked.add(cleaned);
      return cleaned;
    })
    .filter(Boolean);

  const numbers = tokens.filter((t) => /^\d+$/.test(t)).map(Number);
  const asked = tokens.filter((t) => !/^\d+$/.test(t)).join(' ').trim();

  if (numbers.length > 2) {
    return { asked, days: null, budgetIls: null, error: 'יותר מדי מספרים. הצורה היא: /trip פראג 5 1200' };
  }

  let days = null;
  let budgetIls = null;

  for (const n of numbers) {
    // An explicit ₪ or ב- settles it whatever the size, which is what lets
    // "/trip פראג ב-300" be a budget that gets refused for being too small
    // rather than a silent request for three hundred days.
    const isMoney = marked.has(String(n)) || n >= BUDGET_MIN;
    if (isMoney) {
      if (budgetIls !== null) {
        return { asked, days, budgetIls: null, error: 'שני תקציבים בבקשה אחת' };
      }
      budgetIls = n;
    } else {
      if (days !== null) {
        return { asked, days: null, budgetIls, error: 'שני מספרי ימים בבקשה אחת' };
      }
      days = n;
    }
  }

  if (budgetIls !== null && (budgetIls < BUDGET_MIN || budgetIls > BUDGET_MAX)) {
    return {
      asked,
      days,
      budgetIls: null,
      error: `תקציב של ${budgetIls.toLocaleString('en-US')} ₪ לא ניתן לתכנון. בין ${BUDGET_MIN} ל-${BUDGET_MAX.toLocaleString('en-US')} ₪ לאדם`,
    };
  }

  return { asked, days, budgetIls, error: null };
}

/** What the fixed lines come to, summed rather than taken on trust. */
export const fixedTotal = (costs) =>
  COST_LINES.reduce((sum, line) => sum + Math.max(0, Math.round(Number(costs?.[line.key]) || 0)), 0);

/**
 * The fixed costs, checked into shape.
 *
 * Returns `{ costs, bad }`. Unlike a stop, a cost line cannot be dropped: four
 * lines and a total that does not equal them is the arithmetic failure this
 * whole format is built to avoid, so a bad line fails the plan instead.
 */
export function shapeCosts(raw, { days }) {
  const costs = {};
  for (const line of COST_LINES) {
    const n = Number(raw?.[line.key]);
    if (!Number.isFinite(n) || n < 0) return { costs: null, bad: `${line.he}: לא מספר` };
    const v = Math.round(n);
    if (v > line.max) return { costs: null, bad: `${line.he}: ${v} ₪ לאדם זה לא סביר` };
    costs[line.key] = v;
  }
  // A trip with no flight and no bed is not a trip, it is a day out. Both are
  // per person and both are for the whole stay, so zero is a wrong answer
  // rather than a cheap one.
  if (costs.flightIls <= 0) return { costs: null, bad: 'טיסה: 0 ₪' };
  if (costs.lodgingIls <= 0) return { costs: null, bad: 'לינה: 0 ₪' };
  // Food is per trip, not per day, and the difference is a factor of five. A
  // figure under 25 ₪ a day is the model having answered the other question.
  if (costs.foodIls < days * 25) return { costs: null, bad: `אוכל: ${costs.foodIls} ₪ ל-${days} ימים` };
  return { costs, bad: null };
}

/**
 * Does the plan fit what the cover promises?
 *
 * `left` is what the cover can honestly say is left over, and it is allowed to
 * be zero. `over` is the only failing state, and it fails the plan rather than
 * being printed: a post headed "1,200 ₪" whose own total slide says 1,340 is
 * the broken promise that cost the clip format its beats.
 *
 * The floor is the other half of the same check. A planner told to come in
 * under a cap can always do it by pricing a city break at nothing, and the
 * result passes every other guard here while being obvious nonsense on screen.
 */
export function budgetVerdict(total, budgetIls) {
  if (!budgetIls) return { on: false, over: false, thin: false, left: 0 };
  const left = budgetIls - total;
  return {
    on: true,
    over: left < 0,
    thin: total < budgetIls * 0.35,
    left,
  };
}

/**
 * The breakdown as ONE line, because that is all a slide has.
 *
 * The minimal template renders a single bullet per slide and ignores the rest
 * (render/deckTemplates.js), so the five figures are joined with the same
 * separator the day slide already uses rather than stacked. Stops are folded
 * into one "כניסות" figure: they are itemised on their own slides already, and
 * repeating thirteen prices here would be a paragraph.
 */
export function breakdownLine(costs, stopsIls, { attractionsHe = 'כניסות' } = {}) {
  const n = (v) => Number(v || 0).toLocaleString('en-US');
  return [...COST_LINES.map((l) => `${l.he} ${n(costs[l.key])}`), `${attractionsHe} ${n(stopsIls)}`].join(' · ');
}
