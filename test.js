import { loadEnv } from './src/env.js';
loadEnv();

import { verifySource, flightPriceGuard, RejectedError } from './src/verify.js';
import { primaryAuthority } from './src/sources/index.js';
import { toCandidate } from './src/candidate.js';
import { approvalMessage } from './src/format.js';
import { closeBrowser } from './src/render/index.js';
import { hasApiKey } from './src/draft.js';

// Run one URL through the real pipeline and print what comes out, without
// touching Telegram. The equivalent of BrickDeal's test.js — the thing you
// reach for before wiring anything up, and again whenever a source misbehaves.
//
//   npm run test-url "https://www.gov.uk/foreign-travel-advice/japan"
//
// Without ANTHROPIC_API_KEY it stops after verification and reports what it
// found, which is still the half of the pipeline most likely to be wrong.

const url = process.argv[2];
if (!url) {
  console.error('usage: npm run test-url "<url>"');
  process.exit(1);
}

async function main() {
  const authority = primaryAuthority(url);
  console.log(`\nURL:       ${url}`);
  console.log(`authority: ${authority ? `${authority.suffix} — ${authority.why}` : 'NOT ON THE ALLOWLIST'}`);
  if (!authority) {
    console.log('\nRejected: not_primary_source. No source, no candidate.');
    return;
  }

  const item = {
    sourceId: 'manual',
    sourceName: 'manual test',
    authority: 'government',
    lang: 'en',
    pillarHints: [],
    title: url,
    summary: '',
    url,
    publishedAt: null,
  };

  const { sourceText, finalUrl } = await verifySource(item);
  console.log(`final URL: ${finalUrl}`);
  console.log(`source text: ${sourceText.length} chars`);
  console.log(`\n--- first 600 chars of what the drafting step would see ---`);
  console.log(sourceText.slice(0, 600));
  console.log('---');

  const fare = flightPriceGuard(sourceText);
  console.log(`\nfare mentions in source: ${fare ? `yes (${fare}) — a draft repeating one would be rejected` : 'none'}`);

  if (!hasApiKey()) {
    console.log('\nANTHROPIC_API_KEY is not set — stopping before the drafting step.');
    return;
  }

  console.log('\ndrafting + verifying + rendering...');
  const cand = await toCandidate(item);
  console.log(`\nlayout: ${cand.layout} · pillar: ${cand.pillar} · tags: ${cand.tags.join(', ') || 'none'}`);
  console.log(`card:   ${cand.card?.file} (${((cand.card?.bytes || 0) / 1024).toFixed(0)} KB)`);
  console.log(`\n--- approval message ---\n${approvalMessage(cand)}`);
  console.log(`\n--- channel caption ---\n${cand.channelCaption}`);
}

main()
  .catch((e) => {
    if (e instanceof RejectedError) {
      console.error(`\nRejected: ${e.reason}${e.detail ? ` — ${e.detail}` : ''}`);
    } else {
      console.error(e);
    }
    process.exitCode = 1;
  })
  .finally(closeBrowser);
