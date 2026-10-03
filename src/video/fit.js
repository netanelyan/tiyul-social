import { postConfig } from '../postConfig.js';

// HOW LONG TO HOLD EACH SHOT SO THE REEL LANDS INSIDE ITS TARGET LENGTH.
//
// ITS OWN MODULE FOR ONE REASON, AND IT IS NOT SIZE. The arithmetic was in
// hiddenGems.js, where it belongs by subject, and video/retention.js needs the same
// solver with two of its inputs overridden. Importing it from there and being imported
// back by it is a cycle, and this project's dependency graph has none: ESM resolves
// cycles when every use is inside a function, right up until somebody moves one line
// to the top level and the error names a module nobody edited.
//
// So the solver sits below both of them. `fitHolds` in hiddenGems.js is still the
// public name and still has its signature, because the tests and the labs call it.

/**
 * `{ holds, seconds, dropped }` for `count` shots, inside `cfg.targetSeconds`.
 *
 * AIMED AT THE MIDDLE OF THE TARGET, NOT AT EITHER END, so a three shot reel and a
 * five shot one are the same length rather than one being the floor and the other the
 * ceiling. At a 7 to 9 second target that is 8 seconds either way.
 *
 * WHEN IT CANNOT FIT, IT DROPS A SHOT RATHER THAN RUNNING LONG, and after the
 * retention change that is the ordinary case rather than the edge: four places at the
 * two second floor plus a 1.6 second hook shot is 9.6 seconds against a ceiling of 9,
 * so a morning that placed five clips still makes a three shot reel. That is the
 * brief's own "3 clips of about 2 to 3 seconds", arrived at from its own "7 to 9
 * seconds" rather than configured separately and kept in step by hand.
 *
 * `hookSeconds` overrides the configured hook length, which is what the retention
 * timeline does: its hook shot is as long as the first cut, which is a different
 * number from the old dedicated hook shot.
 *
 * `firstBonus` lengthens the FIRST shot only. The caller is the only thing that knows
 * why: the retention timeline withholds the first place's name until the hook shrinks
 * to a header, and without the bonus that label gets a sliver of its own shot.
 */
export function solveHolds(count, cfg = postConfig().gems, { hookSeconds = null, firstBonus = 0 } = {}) {
  const hook = hookSeconds == null ? cfg.hookSeconds : hookSeconds;
  const { min: lo, max: hi } = cfg.holdSeconds;
  const target = cfg.targetSeconds;
  const mid = (target.min + target.max) / 2;

  let n = Math.max(1, count);
  let dropped = 0;
  let hold = 0;

  for (;;) {
    hold = Math.min(hi, Math.max(lo, (mid - hook) / n));
    const total = hook + n * hold;
    if (total > target.max && n > 1 && hook + n * lo > target.max) {
      n -= 1;
      dropped += 1;
      continue;
    }
    if (total > target.max) hold = (target.max - hook) / n;
    break;
  }

  const round = (x) => Math.round(x * 10) / 10;
  const holds = Array.from({ length: n }, () => round(hold));
  if (firstBonus > 0 && holds.length) holds[0] = round(Math.max(holds[0], firstBonus));

  return { holds, seconds: round(hook + holds.reduce((a, b) => a + b, 0)), dropped };
}
