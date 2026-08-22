import { loadEnv } from '../src/env.js';
loadEnv();

import { gather, registry, enabledSources, primaryAuthority } from '../src/sources/index.js';
import { rank, scoreItem } from '../src/score.js';

// Runs every enabled source against the live endpoint and prints what came
// back, without drafting, rendering, or touching Telegram.
//
// This is the command to reach for when the answer to "why did nothing get
// staged today" might be "the feed moved". It separates a source that is broken
// from a source that simply had nothing new, which a run report alone can't.

async function main() {
  const { sources, allowlist } = registry();

  console.log(`registry: ${sources.length} sources (${enabledSources().length} enabled), ${allowlist.length} allowlisted domains\n`);

  const { items, errors, perSource } = await gather();

  console.log('per source:');
  for (const s of enabledSources()) {
    const n = perSource[s.id] ?? 0;
    const err = errors.find((e) => e.sourceId === s.id);
    const state = err ? `FAILED — ${err.message}` : n === 0 ? 'ok, but nothing returned' : `${n} items`;
    console.log(`  ${err ? '✗' : '✓'} ${s.id.padEnd(22)} ${state}`);
  }

  // Every item must be publishable in principle before it is worth ranking —
  // an item whose own link is off the allowlist can never become a candidate.
  const offList = items.filter((it) => !primaryAuthority(it.url));
  if (offList.length) {
    console.log(`\n⚠️ ${offList.length} item(s) link off the allowlist and would be rejected:`);
    for (const it of offList.slice(0, 5)) console.log(`   ${new URL(it.url).hostname} — ${it.title.slice(0, 70)}`);
  }

  const ranked = rank(items);
  console.log(`\ntop ${Math.min(8, ranked.length)} of ${items.length} gathered (already-seen items excluded):`);
  for (const { item, score } of ranked.slice(0, 8)) {
    console.log(`  ${score.toFixed(2)}  [${item.sourceId}] ${item.title.slice(0, 78)}`);
  }

  if (!ranked.length && items.length) {
    console.log('  (everything gathered has been seen before — this is normal on a repeat run)');
  }

  if (errors.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
