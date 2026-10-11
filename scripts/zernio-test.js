import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { loadEnv } from '../src/env.js';

loadEnv();

// The two test posts the owner asked for before the daily slate goes live.
//
//   npm run zernio-test -- private
//       Builds one real slideshow (the same buildPost every post uses), renders it
//       where the card host serves it, and posts it to TikTok through Zernio as
//       SELF_ONLY with auto music. Only the account owner can see it.
//
//   npm run zernio-test -- prepare-public
//       Builds and renders another post and stops. Prints its cover, caption and
//       slides, and saves it to data/zernio-public.json. Nothing is posted.
//
//   npm run zernio-test -- publish-public <id>
//       Posts the prepared post PUBLICLY, and only if <id> is the id printed by
//       prepare-public. Running this command with that id is the owner's approval.
//
// RUN WHERE THE CARD HOST SERVES THE FILES (the VPS: CARD_OUTPUT_DIR is the folder
// Caddy serves at CARD_PUBLIC_BASE_URL). Zernio fetches the images by URL and has no
// upload endpoint; a slide rendered on a laptop is a URL nobody can fetch.
//
// It never imports bot.js and never touches the bot's queue or approvals.
//
// IT RENDERS INTO A FOLDER OF ITS OWN under the card host, served at the same base
// plus /zernio-test. A post's id is keyed on its content (postId in src/posts), and
// its slide files are named by that id, so a test post of the same type and
// destination as one the bot has queued would otherwise write over that queued
// post's slides in the folder they share.
const TEST_DIR = 'zernio-test';
if (process.env.CARD_OUTPUT_DIR) {
  process.env.CARD_OUTPUT_DIR = path.join(process.env.CARD_OUTPUT_DIR, TEST_DIR);
  mkdirSync(process.env.CARD_OUTPUT_DIR, { recursive: true });
}
for (const key of ['CARD_PUBLIC_BASE_URLS', 'CARD_PUBLIC_BASE_URL']) {
  if (!process.env[key]) continue;
  process.env[key] = process.env[key]
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((base) => `${base.replace(/\/+$/, '')}/${TEST_DIR}`)
    .join(',');
}

const mode = process.argv[2];
const PUBLIC_FILE = new URL('../data/zernio-public.json', import.meta.url);

async function buildOne() {
  const { buildPost } = await import('../src/posts/index.js');
  const { pickDestination } = await import('../src/plan/write.js');
  const { nextShape, destinationsFor } = await import('../src/posts/types.js');
  const { targetsForKind } = await import('../src/publish/targets.js');
  const rows = JSON.parse(readFileSync(new URL('../destinations.json', import.meta.url), 'utf8')).destinations;
  const type = nextShape().type;
  const tried = [];
  for (let i = 0; i < 3; i++) {
    const dest = pickDestination(tried, { from: destinationsFor(type, rows) });
    if (!dest) break;
    tried.push(dest.he);
    try {
      const { cand } = await buildPost({
        dest,
        type,
        alternatives: rows.filter((r) => r.country === dest.country && r.id !== dest.id && r.siteSlug).slice(0, 4),
        defaultHe: dest.he,
        regionHe: dest.country,
        targets: targetsForKind('post'),
        remember: false,
        onProgress: (t) => console.log(`  ${t}`),
      });
      return cand;
    } catch (e) {
      console.log(`  ${dest.he}: ${e.message}`);
    }
  }
  throw new Error(`no destination could carry a ${type} post`);
}

async function checkFetchable(urls) {
  for (const u of urls) {
    const res = await fetch(u, { method: 'HEAD', signal: AbortSignal.timeout(15_000) }).catch((e) => ({ ok: false, status: e.message }));
    if (!res.ok) throw new Error(`${u} is not publicly fetchable (${res.status}). Run this where CARD_PUBLIC_BASE_URL serves CARD_OUTPUT_DIR.`);
  }
}

function show(cand) {
  console.log(`\n  ${cand.deck.type} · ${cand.deck.where} · ${cand.deck.urls.tiktok.length} slides`);
  console.log(`  title:   ${cand.headline}`);
  console.log(`  caption: ${String(cand.tiktokCaption || '').split('\n').join(' / ')}`);
  console.log(`  cover:   ${cand.deck.urls.tiktok[0]}`);
}

async function post(cand, privacy) {
  const { publishZernioTikTok } = await import('../src/publish/zernio.js');
  console.log(`\n  posting through Zernio as ${privacy}, auto music on...`);
  const res = await publishZernioTikTok(cand, { privacy, autoAddMusic: true });
  console.log(`  ✓ ${res.status} · Zernio post ${res.zernioId}${res.url ? ` · ${res.url}` : ''}`);
  for (const n of res.notes || []) console.log(`  · ${n}`);
  return res;
}

if (mode === 'private') {
  const cand = await buildOne();
  show(cand);
  await checkFetchable(cand.deck.urls.tiktok);
  await post(cand, 'SELF_ONLY');
  console.log('\n  Open TikTok on the account: the post is visible to you only. Check it has music.');
} else if (mode === 'prepare-public') {
  const cand = await buildOne();
  show(cand);
  await checkFetchable(cand.deck.urls.tiktok);
  writeFileSync(PUBLIC_FILE, JSON.stringify(cand, null, 1));
  console.log(`\n  Prepared, NOT posted. To post it publicly:\n    npm run zernio-test -- publish-public ${cand.id}`);
} else if (mode === 'publish-public') {
  const id = process.argv[3];
  if (!existsSync(PUBLIC_FILE)) throw new Error('nothing prepared - run prepare-public first');
  const cand = JSON.parse(readFileSync(PUBLIC_FILE, 'utf8'));
  if (!id || id !== cand.id) throw new Error(`publish-public needs the id prepare-public printed (${cand.id}); that id is the approval`);
  show(cand);
  await checkFetchable(cand.deck.urls.tiktok);
  await post(cand, 'PUBLIC_TO_EVERYONE');
} else {
  console.log('usage: npm run zernio-test -- private | prepare-public | publish-public <id>');
  process.exitCode = 1;
}
