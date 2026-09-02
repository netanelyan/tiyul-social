import { loadEnv } from '../src/env.js';
loadEnv();

import { runOnce, draftBudget } from '../src/pipeline.js';
import { approvalMessage } from '../src/format.js';
import { closeBrowser } from '../src/render/index.js';
import { reasonHe } from '../src/verify.js';
import { hasApiKey } from '../src/draft.js';
import { pillarHe } from '../src/pillars.js';

// The next N candidates, printed rather than sent, and — unlike run-once — with
// nothing written to the store.
//
// That difference is the entire reason this file exists. `npm run run-once`
// marks every item it touches as seen, exactly as the real run does, so using it
// to preview a day means the five posts you just read can never be staged again.
// Fine for "what would a day look like", useless for "show me the next five
// before you publish any of them".
//
// It prints the trip line for every candidate and the reason for every skip,
// because after a change to the selection rule the rejections are half the
// evidence: what stopped coming through matters as much as what did.
//
//   npm run preview        -> next 5
//   npm run preview 8      -> next 8

const n = Math.max(1, Number(process.argv[2] || 5));

// The daily budget is target x3, sized for a run where most drafts succeed.
// Under the trip rule most of them do not — a wire of eruptions gets read and
// declined, and each of those declines is a paid call. Six per target is what it
// takes to actually reach n; an explicit MAX_DRAFT_CALLS still wins.
process.env.MAX_DRAFT_CALLS ||= String(n * 6);

async function main() {
  if (!hasApiKey()) {
    console.error('ANTHROPIC_API_KEY is not set — drafting is required.');
    process.exitCode = 1;
    return;
  }

  console.log(`preview: the next ${n} candidates. Nothing is staged, published, or marked seen.`);
  console.log(`drafting budget for this pass: ${draftBudget(n)} calls\n`);

  // Wider than the daily run on purpose. The daily run stops at twelve ranked
  // items because it only needs three; a preview that stops there can run out of
  // list before it runs out of target and report "only two qualified" when what
  // actually happened is "only twelve were looked at".
  const rankOptions = { perSource: 4, limit: 40 };

  const staged = [];
  const skipped = [];

  const summary = await runOnce({
    target: n,
    markSeen: false,
    rankOptions,
    onStaged: (cand) => {
      staged.push(cand);
      console.log('='.repeat(74));
      console.log(`#${staged.length}  ${pillarHe(cand.pillar)}  ·  ${cand.sourceName}`);
      console.log('-'.repeat(74));
      console.log(approvalMessage(cand));
      console.log(`\n🗂  card: ${cand.card?.file || '(not rendered)'}`);
      console.log('='.repeat(74), '\n');
    },
    onRejected: (r) => {
      skipped.push(r);
      console.log(`  ✗ [${reasonHe(r.reason)}] ${String(r.title).slice(0, 70)}`);
      if (r.detail) console.log(`      ${String(r.detail).slice(0, 180)}`);
    },
  });

  console.log('\n--- summary ---');
  console.log(
    `gathered ${summary.gathered} · ranked ${summary.ranked} · shown ${summary.staged} · skipped ${summary.rejected} · drafting calls ${summary.draftCalls}`
  );
  for (const [reason, count] of Object.entries(summary.rejectedByReason)) {
    console.log(`  ${reason}: ${count}  (${reasonHe(reason)})`);
  }
  for (const e of summary.sourceErrors) console.log(`  source failed — ${e.name}: ${e.message}`);
  if (summary.budgetExhausted) {
    console.log('  ⚠ the drafting budget ran out before the target was met');
  }
  if (staged.length < n) {
    console.log(
      `\n  Only ${staged.length} of ${n} cleared the rule. That is a fact about the source registry,\n` +
        '  not a bug: see the skip reasons above for which ones it was and why.'
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(closeBrowser);
