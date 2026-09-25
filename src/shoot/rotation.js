import { postConfig } from '../postConfig.js';

// WHICH shape the next shoot is, and which part of which series.
//
// All of this is arithmetic over the last few shoots, deliberately, and none of
// it is a model call. Three of the brief's rules are counting rules — never the
// same template twice in a row, the product in at least half, a series that
// actually reaches part 3 — and a model asked to obey a counting rule obeys it
// most of the time. Most of the time is what produced the feed this brief was
// written to fix.
//
// The model writes the words. This decides what it is writing about.

/**
 * The next format.
 *
 * Three passes, in priority order, and the order is the interesting part:
 *
 *   1. THE PRODUCT FLOOR WINS OUTRIGHT. Rule 3 says the product appears in at
 *      least half the videos, which is a floor, and a floor is a check rather
 *      than a preference. A weight of 3 on the demo format is a tendency, and a
 *      run of five non-product shoots sits comfortably inside normal for any
 *      weighting — which is exactly how an account ends up with reach and no
 *      conversions. So the window is counted and, if it is short, the next
 *      shoot is the demo whatever else was due.
 *
 *   2. NO REPEAT, BY SHAPE AND BY ID. Rule 5 is "don't post the same template
 *      twice in a row", and two different ids that are both shape A are the
 *      same template as far as a viewer scrolling is concerned. Excluding only
 *      the id would let mistakes → warning through, which is two "don't do this
 *      in X" videos back to back.
 *
 *   3. WEIGHTED CHOICE among whatever survives.
 *
 * The exclusion is dropped rather than enforced into a corner: if every format
 * is excluded — which happens when there is exactly one left after the product
 * rule, or when someone configures a single format — the repeat rule loses.
 * A repeated shape is worse than no shot list at all only in theory; in
 * practice a queue that goes silent is a queue you stop opening.
 */
export function chooseFormat(history = [], { rand = Math.random } = {}) {
  const cfg = postConfig().shoot;
  const formats = cfg.formats;
  if (!formats.length) return null;

  // THE WINDOW ENDS AT THIS PICK, and that off-by-one is the whole correctness
  // of the rule. The obvious version counts the last `productWindow` shoots and
  // forces the demo when they are short — and it measurably converges to 44%,
  // not 50%, because by the time the window that just slid is short it is too
  // late to have fixed it. The window it was protecting has already gone out.
  //
  // The question that gives the right answer is forward-looking: "if this shoot
  // is NOT the product, will the window ending here be short?" That window is
  // the last W-1 shoots plus this one, so the count to test is over W-1.
  const window = cfg.productWindow;
  const need = Math.ceil(cfg.productShare * window);
  const preceding = history.slice(0, Math.max(0, window - 1));
  const productSoFar = preceding.filter((h) => h?.needsProduct).length;

  // AND IT STILL MAY NOT REPEAT. Rule 3 and rule 5 look like they are in
  // tension and are not: there is one product format, so "the product in at
  // least half" plus "never the same shape twice in a row" is satisfied exactly
  // by alternating — P,-,P,-,- gives three in six with no two adjacent, and a
  // window of six needs three.
  //
  // Both rules therefore hold together, and the only way to break one is to be
  // reactive about it. Forcing the demo the moment the window falls short
  // produces demo-after-demo whenever the shortfall spans two turns, which
  // measured at 23 adjacent repeats over a hundred shoots. Declining to force
  // when the previous shoot was already the product costs nothing, because the
  // forward-looking window above has already taken it early enough.
  const last = history[0] || null;
  const product = formats.filter((f) => f.needsProduct);
  if (product.length && productSoFar < need && !last?.needsProduct) {
    return {
      format: pick(product, rand),
      why: `מכסת מוצר: ${productSoFar}/${need} ב-${preceding.length} האחרונים`,
    };
  }

  const fresh = formats.filter((f) => !last || (f.id !== last.formatId && (!f.shape || f.shape !== last.shape)));

  return {
    format: pick(fresh.length ? fresh : formats, rand),
    why: fresh.length ? null : 'אין פורמט אחר זמין - חזרה על הצורה',
  };
}

/** Weighted draw. The weight is the owner's grade made mechanical. */
function pick(formats, rand) {
  const total = formats.reduce((n, f) => n + (f.weight || 1), 0);
  let r = rand() * total;
  for (const f of formats) {
    r -= f.weight || 1;
    if (r <= 0) return f;
  }
  return formats[formats.length - 1];
}

/**
 * Which part of which series this shoot is, or null for a standalone.
 *
 * Rule 7: a series is the cheapest reason to follow there is — "חלק 1 מתוך 3"
 * tells a viewer something specific is coming and that following is how to get
 * it. The bot holds the state because the whole value is that part 2 arrives,
 * and a series that stops at part 1 is worse than no series: it is a promise
 * made to everyone who followed for it.
 *
 * NOT EVERY SHOOT IS IN A SERIES, and `every` is what controls that. A feed
 * where everything is part of something has no standalone entry point, and a
 * viewer landing on part 2 of 3 has been handed a middle.
 *
 * Continuation beats starting: if a series is open, the next shoot continues it
 * regardless of where `every` has got to. Two open series at once is how both
 * of them get abandoned.
 */
export function nextSeries(history = []) {
  const cfg = postConfig().shoot.series;
  if (!cfg.every || cfg.length < 2) return null;

  const open = history.find((h) => h?.series);
  if (open?.series && open.series.index < open.series.of) {
    return {
      topic: open.series.topic || null,
      index: open.series.index + 1,
      of: open.series.of,
    };
  }

  // Count back to the last time a series STARTED. `every` is spacing between
  // series, not between posts that happen to be in one.
  let since = 0;
  for (const h of history) {
    if (h?.series?.index === 1) break;
    since += 1;
  }
  if (history.length && since < cfg.every) return null;

  return { topic: null, index: 1, of: cfg.length };
}

/** "חלק 2 מתוך 3", and the line that asks for the follow. */
export function seriesLabels(series) {
  if (!series) return { label: null, next: null };
  const cfg = postConfig().shoot.series;
  const fill = (s, n) => String(s).replace('{n}', String(n)).replace('{of}', String(series.of));
  return {
    label: fill(cfg.labelHe, series.index),
    // Only when there IS a next part. "עקבו לחלק 4 מחר" under part 3 of 3 is
    // the promise-breaking this whole mechanism exists to avoid.
    next: series.index < series.of ? fill(cfg.nextHe, series.index + 1) : null,
  };
}

// One angle from the pool, or null when none are configured.
//
// The implementation moved to src/angles.js when a deck started drawing from
// the same pool, and this is a re-export rather than a second copy: the
// exclusion window is the interesting part and two copies of it is one that
// will be tuned and one that will not. Re-exported rather than deleted because
// shoot/plan.js and the tests both import it from here.
export { pickAngle } from '../angles.js';
