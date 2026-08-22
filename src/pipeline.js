import { gather, enabledSources } from './sources/index.js';
import { rank } from './score.js';
import { toCandidate, candidateId, RejectedError } from './candidate.js';
import * as store from './store.js';
import { snapshot as usageSnapshot } from './usage.js';

// The daily loop: gather -> rank -> build the best two or three -> hand them
// over for approval.
//
// It stops at the target rather than building everything it found. The brief
// asks for "the best two or three a day", and an approval queue you stop
// reading is worse than a short one — twenty cards a day is how a human gate
// quietly turns into a rubber stamp.

export const dailyTarget = () => Math.max(1, Number(process.env.DAILY_TARGET ?? '3'));

/**
 * Ceiling on drafting calls per run — the only thing here that costs money.
 *
 * Without it the run keeps trying until it hits the target or exhausts the
 * ranked list, so a day where every source is thin or off-topic quietly spends
 * a full ranked list of calls to produce nothing. The cap turns that from an
 * open-ended bill into a known one: at the default it is 9 calls, and if the
 * budget runs out before the target is met the run reports it rather than
 * pretending there was simply nothing to post.
 */
export const draftBudget = (target = dailyTarget()) =>
  Math.max(1, Number(process.env.MAX_DRAFT_CALLS ?? target * 3));

/**
 * One full pass.
 *
 * `onStaged` is awaited per candidate so the Telegram send is part of the run,
 * not a detached promise — an approval card that fails to send should show up
 * in the run report rather than vanishing.
 *
 * Returns a summary the caller can report; it never throws for a single bad
 * item, only for a failure that makes the whole run meaningless.
 */
export async function runOnce({ onStaged, onRejected, target = dailyTarget(), now = new Date() } = {}) {
  const summary = {
    gathered: 0,
    ranked: 0,
    staged: 0,
    rejected: 0,
    rejectedByReason: {},
    sourceErrors: [],
    perSource: {},
    sourceCount: enabledSources().length,
    draftCalls: 0,
    budgetExhausted: false,
  };

  const { items, errors, perSource } = await gather({ now });
  summary.gathered = items.length;
  summary.sourceErrors = errors;
  summary.perSource = perSource;

  const candidates = rank(items, { now: now.getTime() });
  summary.ranked = candidates.length;

  // Counted from the usage recorder rather than from loop iterations, because
  // the two differ: an item rejected by verifySource never reaches the model,
  // and charging it against a budget for API calls would cut the run short over
  // something that cost nothing.
  const budget = draftBudget(target);
  const callsBefore = usageSnapshot().calls;
  const callsUsed = () => usageSnapshot().calls - callsBefore;

  for (const { item } of candidates) {
    if (summary.staged >= target) break;
    if (callsUsed() >= budget) {
      summary.budgetExhausted = true;
      break;
    }

    const id = candidateId(item);

    // Claimed before the slow work, not after. Two feeds carrying the same
    // story minutes apart would otherwise both survive the pre-rank dedupe
    // check and both get drafted — BrickDeal's lesson, in a new pipeline.
    if (store.hasSeen(id)) continue;
    store.markSeen(id);

    try {
      const cand = await toCandidate(item);
      await onStaged?.(cand);
      summary.staged++;
    } catch (err) {
      const reason = err instanceof RejectedError ? err.reason : 'error';
      const detail = err instanceof RejectedError ? err.detail : err.message;

      // Which rejections deserve a second chance. A source that was briefly
      // unreachable may well be up tomorrow; a source that is not on the
      // allowlist will never be, and a quota breach should be re-evaluated
      // against a different published window rather than blocked forever.
      if (RETRYABLE.has(reason)) store.forgetSeen(id);

      summary.rejected++;
      summary.rejectedByReason[reason] = (summary.rejectedByReason[reason] || 0) + 1;
      await onRejected?.({ reason, detail, title: item.title, url: item.url, sourceId: item.sourceId });
    }
  }

  summary.draftCalls = callsUsed();
  return summary;
}

// `not_primary_source`, `redirected_off_allowlist` and `flight_price_out_of_scope`
// are deliberately absent: re-running them tomorrow re-reaches the same verdict,
// and forgetting them just means paying for the same rejection again.
const RETRYABLE = new Set([
  'source_unreachable',
  'source_too_thin',
  'draft_failed',
  'render_failed',
  'quota',
  'error',
]);
