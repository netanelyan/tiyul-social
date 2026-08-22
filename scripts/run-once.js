import { loadEnv } from '../src/env.js';
loadEnv();

import { runOnce, dailyTarget } from '../src/pipeline.js';
import { approvalMessage } from '../src/format.js';
import { closeBrowser } from '../src/render/index.js';
import { reasonHe } from '../src/verify.js';
import { hasApiKey } from '../src/draft.js';

// One full gather -> rank -> draft -> render pass, printed to the terminal
// instead of sent to Telegram. Nothing publishes, nothing is queued.
//
// Use it to see what a day would actually produce — including what got
// rejected and why — before pointing the bot at a live channel. Note that it
// does mark items as seen, exactly as the real run does, so a second run in a
// row will look emptier; that is the dedupe store working, not a bug.

async function main() {
  if (!hasApiKey()) {
    console.error('ANTHROPIC_API_KEY is not set — drafting is required for a full run.');
    console.error('Run `npm run check-sources` to exercise gathering and ranking without it.');
    process.exitCode = 1;
    return;
  }

  console.log(`running one pass (target: ${dailyTarget()})...\n`);

  const summary = await runOnce({
    onStaged: (cand) => {
      console.log('='.repeat(72));
      console.log(approvalMessage(cand));
      console.log(`\ncard: ${cand.card?.file}`);
      console.log('='.repeat(72), '\n');
    },
    onRejected: (r) => {
      console.log(`  ✗ [${reasonHe(r.reason)}] ${r.title.slice(0, 60)}`);
      if (r.detail) console.log(`      ${String(r.detail).slice(0, 200)}`);
    },
  });

  console.log('\n--- summary ---');
  console.log(`gathered ${summary.gathered} · ranked ${summary.ranked} · staged ${summary.staged} · rejected ${summary.rejected}`);
  for (const [reason, n] of Object.entries(summary.rejectedByReason)) {
    console.log(`  ${reason}: ${n}`);
  }
  for (const e of summary.sourceErrors) console.log(`  source failed — ${e.name}: ${e.message}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(closeBrowser);
