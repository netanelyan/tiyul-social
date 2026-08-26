import { loadEnv } from '../src/env.js';
loadEnv();

import * as store from '../src/store.js';
import { primaryAuthority } from '../src/sources/index.js';
import { toCandidate, candidateId, RejectedError } from '../src/candidate.js';
import { publishInstagram, instagramConfigured, describeError } from '../src/publish/instagram.js';
import { closeBrowser } from '../src/render/index.js';
import { reasonHe } from '../src/verify.js';
import { hasApiKey } from '../src/draft.js';

// Republish to Instagram ONLY, for posts that reached Telegram and never made
// it to Instagram.
//
// This exists because of a real gap rather than as a convenience. When
// publishNext() recorded a card as published on the strength of Telegram alone,
// the card left the queue and the only thing kept about it was the row in the
// published log: id, pillar, tags, layout and the two destination flags. Not the
// headline, not the source URL, not the caption. So the store can say HOW MANY
// posts never reached Instagram and when, and cannot say which stories they
// were. The URLs have to come from you — they are in the Telegram channel, on
// the `מקור:` line of every post.
//
// Instagram only, deliberately. Re-approving through the bot would republish to
// Telegram too, and posting the same card to the channel twice to fix a gap on
// the other network is a worse outcome than the gap.
//
//   node scripts/backfill-instagram.js                    # what is missing
//   node scripts/backfill-instagram.js --check URL [...]  # does this URL match a gap?
//   node scripts/backfill-instagram.js URL [URL...]       # rebuild, do not publish
//   node scripts/backfill-instagram.js --yes URL [...]    # rebuild and publish

const args = process.argv.slice(2);
const confirmed = args.includes('--yes');
const checkOnly = args.includes('--check');
const urls = args.filter((a) => !a.startsWith('--'));

/** Posts in the quota window that Telegram carried and Instagram never did. */
function gap() {
  return store
    .recentPublished()
    .filter((p) => p.telegram && !p.instagram)
    .sort((a, b) => a.ts - b.ts);
}

function reportGap() {
  const missing = gap();
  const health = store.targetHealth('instagram');

  if (!missing.length) {
    console.log('No posts in the quota window reached Telegram without also reaching Instagram.');
  } else {
    const first = new Date(missing[0].ts);
    const last = new Date(missing[missing.length - 1].ts);
    console.log(`${missing.length} posts went to Telegram and never to Instagram.`);
    console.log(`   from ${first.toISOString().slice(0, 16).replace('T', ' ')}`);
    console.log(`   to   ${last.toISOString().slice(0, 16).replace('T', ' ')}\n`);
    for (const p of missing) {
      console.log(`   ${new Date(p.ts).toISOString().slice(0, 16).replace('T', ' ')}  ${p.id}  [${p.pillar}]`);
    }
    console.log(
      '\nThe published log keeps no headline, URL or caption, so these cannot be rebuilt\n' +
        'from the store alone. Find each post in the Telegram channel, copy the URL from\n' +
        'its `מקור:` line, and pass them to this script.'
    );
  }

  if (store.heldCount()) {
    console.log(`\n${store.heldCount()} posts are HELD and do not need this script — run /retry in the bot.`);
  }
  if (health.degraded) {
    console.log(`\nInstagram is currently marked broken: ${health.lastError || 'no detail'}`);
  }
}

/**
 * Does this URL rebuild the post you think it does?
 *
 * A candidate's id is a hash of its canonical source URL, so the id in the gap
 * report is checkable against a URL without drafting anything. Worth doing
 * first: a URL copied from the wrong message costs a drafting call and then
 * publishes the wrong story to real followers, and neither is undoable.
 */
function check(url) {
  let id;
  try {
    id = candidateId({ url });
  } catch {
    console.log(`   ✗ not a URL`);
    return false;
  }
  const row = gap().find((p) => p.id === id);
  if (row) {
    console.log(`   ✓ ${id} — missing since ${new Date(row.ts).toISOString().slice(0, 16).replace('T', ' ')}`);
    return true;
  }
  if (store.hasPublished(id)) {
    console.log(`   • ${id} — already published to both. Nothing to backfill.`);
    return false;
  }
  console.log(`   ✗ ${id} — not in the gap. Wrong URL, or it never published at all.`);
  return false;
}

async function backfill(url) {
  if (!primaryAuthority(url)) {
    console.log(`   ✗ ${new URL(url).hostname} is not on the primary-source allowlist`);
    return false;
  }

  // Refuses by default when the URL does not correspond to a post that is
  // actually missing. This script publishes to real followers and there is no
  // undo; a URL copied from the wrong message should cost nothing.
  if (!check(url) && !args.includes('--force')) {
    console.log('   skipped — pass --force to publish it anyway');
    return false;
  }

  // The same shape ingestUrl() builds in bot.js. The card is drafted and
  // rendered fresh; the original JPEG may still be on disk, but its caption is
  // not, and publishing an old image with a new caption is worse than either.
  const item = {
    sourceId: 'backfill',
    sourceName: 'השלמה ידנית',
    authority: 'government',
    lang: 'en',
    pillarHints: [],
    title: url,
    summary: '',
    url,
    publishedAt: null,
  };

  let cand;
  try {
    cand = await toCandidate(item);
  } catch (e) {
    const reason = e instanceof RejectedError ? e.reason : 'error';
    console.log(`   ✗ rejected [${reasonHe(reason)}] ${e.detail || e.message}`);
    return false;
  }

  console.log(`   ${cand.headline}`);
  console.log(`   card: ${cand.card?.file}`);

  if (!confirmed) {
    console.log('   (dry run — pass --yes to publish this to Instagram)');
    return false;
  }

  try {
    const r = await publishInstagram(cand);
    // Upserts by id, so a post already logged as telegram-only gains its
    // Instagram flag rather than being counted twice in the quota window.
    store.recordPublished({
      id: cand.id,
      pillar: cand.pillar,
      tags: cand.tags,
      layout: cand.layout,
      instagram: true,
    });
    store.noteTargetOk('instagram');
    console.log(`   ✓ published to Instagram (media ${r.mediaId})`);
    return true;
  } catch (e) {
    store.noteTargetFailed('instagram', describeError(e));
    console.log(`   ✗ ${describeError(e)}`);
    return false;
  }
}

async function main() {
  if (!urls.length) return reportGap();

  // Costs nothing and needs no credentials, so it can run against a blocked
  // Instagram — collect the URLs now, publish when the block clears.
  if (checkOnly) {
    let matched = 0;
    for (const url of urls) {
      console.log(url);
      if (check(url)) matched++;
      console.log('');
    }
    console.log(`--- ${matched}/${urls.length} match a missing post ---`);
    return;
  }

  if (!instagramConfigured()) {
    console.error('Instagram is not configured — needs IG_ACCESS_TOKEN, IG_USER_ID and CARD_PUBLIC_BASE_URL.');
    process.exitCode = 1;
    return;
  }
  if (!hasApiKey()) {
    console.error('ANTHROPIC_API_KEY is not set — each post has to be drafted again.');
    process.exitCode = 1;
    return;
  }

  console.log(`${urls.length} to backfill${confirmed ? '' : ' (dry run)'}\n`);
  let done = 0;
  for (const [i, url] of urls.entries()) {
    console.log(`${i + 1}/${urls.length} ${url}`);
    if (await backfill(url)) done++;
    console.log('');
  }

  console.log(`--- ${done}/${urls.length} published to Instagram ---`);
  if (!confirmed && urls.length) console.log('Nothing was published. Re-run with --yes.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(closeBrowser);
