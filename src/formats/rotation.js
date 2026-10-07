import { postConfig } from '../postConfig.js';
import { formatHistory } from '../store.js';

// WHICH FORMAT TO BUILD NEXT, WHICH IS A DIFFERENT QUESTION FROM HOW TO BUILD IT.
//
// Before this module the answer was implicit in five independent daily counters in
// bot.js: two posts, one postcard, one guide, no clips. Nothing chose between them,
// they simply all ran, and the mix was whatever the counters added up to. That is a
// perfectly good design right up to the moment somebody wants half the output to be
// one format, at which point the only way to express it is to edit four numbers in
// four places and hope they still add up to the same total.
//
// So the weights move into post-config.json and this picks one. The thing it must NOT
// change is how much goes out: the brief says do not change posting times or
// frequency, and the sum of those counters is the frequency. `slotsPerDay` is that
// sum, and the rotation fills the same number of slots with a different mix.
//
// IT IS ONE SWITCH TO TURN OFF. `formats.rotation.on: false` and bot.js goes back to
// the five counters, untouched. That matters more than usual here: this is the one
// change on the branch that alters what the account posts tomorrow rather than
// adding something it can post, and the brief asks for every old behaviour to stay
// reachable through config.

/** Is the config-driven rotation in charge, or the legacy per kind counters? */
export const rotationOn = () => postConfig().formats.rotation.on;

/** The formats with a live weight, in file order. */
export const liveFormats = () => postConfig().formats.mix.filter((f) => f.weight > 0);

/**
 * One format, weighted, refusing a run longer than `maxRun`.
 *
 * THE RUN LIMIT IS THE RULE THE WEIGHTS CANNOT EXPRESS, and the arithmetic is worth
 * writing down because it is the whole reason this is not just a weighted draw. At
 * weight 50 of 100, a fair draw produces three of the same format in a row one time
 * in four. Three identical formats in a row is what a viewer reads as a template,
 * which is the failure `typeMemory` prevents one level down and the failure that cost
 * the reference accounts their reach.
 *
 * EXCLUDED BEFORE THE WEIGHTS, NOT AFTER. The same decision drawWeighted makes in
 * posts/types.js: filtering after weighting re-normalises across the survivors and
 * lets the heavy favourite dominate the remainder, which is the run being prevented.
 *
 * THE FALLBACK IS THE WHOLE POOL. With one format left at a live weight, a run of
 * two exhausts the alternatives, and refusing to build anything is a worse answer
 * than a third of the same format. That is not a loophole: it means the run limit is
 * a preference that yields to there being something to post, which is the right
 * order of priorities for a feed.
 *
 * `exclude` IS DIFFERENT, AND HAS NO FALLBACK. It is the formats that just failed to
 * build, and a format that cannot be built is not a preference the draw may yield on:
 * drawing it again only spends the next slot on the same failure. With everything
 * excluded the answer is null, which the caller reads as "wait".
 */
export function pickFormat({ only = null, history = null, exclude = [], rand = Math.random } = {}) {
  const { mix, rotation } = postConfig().formats;
  if (only) {
    const found = mix.find((f) => f.id === only);
    if (!found) throw new Error(`unknown format "${only}" - have: ${mix.map((f) => f.id).join(', ')}`);
    return found;
  }

  const live = mix.filter((f) => f.weight > 0 && !exclude.includes(f.id));
  if (!live.length) return null;

  const recent = (history || formatHistory()).slice(0, rotation.maxRun);
  // A run only exists when every one of the last `maxRun` is the same format.
  const running = recent.length >= rotation.maxRun && recent.every((x) => x === recent[0]) ? recent[0] : null;

  const fresh = running ? live.filter((f) => f.id !== running) : live;
  const pool = fresh.length ? fresh : live;

  const total = pool.reduce((s, f) => s + f.weight, 0);
  let n = rand() * total;
  for (const f of pool) {
    n -= f.weight;
    if (n <= 0) return f;
  }
  return pool[pool.length - 1];
}

/**
 * How many posts a day the rotation is allowed to make.
 *
 * READ OFF THE EXISTING COUNTERS rather than configured separately, and that is the
 * load-bearing decision in this file. A `slotsPerDay` of its own in post-config.json
 * would be a second place that decides how much this account posts, and the first
 * one would still be there, in the env, quietly disagreeing. The brief's instruction
 * was to change the mix and not the frequency; this is how the two stay separable.
 *
 * So the env still says how much, exactly as it did, and the config says what.
 */
export function slotsPerDay(env = process.env) {
  const n = (key, fallback) => Math.max(0, Number(env[key] ?? fallback));
  return n('POSTS_PER_DAY', 2) + n('POSTCARDS_PER_DAY', 1) + n('GUIDES_PER_DAY', 1) + n('CLIPS_PER_DAY', 0);
}

/**
 * What the mix comes out as, as percentages, for the status line and the tests.
 *
 * Printed rather than computed in the head, because the weights in the file are
 * relative and "50" reads as a percentage even when the other weights do not sum to
 * fifty. If somebody edits one weight, this is what says what they actually did.
 */
export function mixShares() {
  const live = liveFormats();
  const total = live.reduce((s, f) => s + f.weight, 0) || 1;
  return live.map((f) => ({ id: f.id, he: f.he, kind: f.kind, weight: f.weight, share: f.weight / total }));
}
