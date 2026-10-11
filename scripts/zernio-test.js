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
//   npm run zernio-test -- prepare-public [--dest florence] [--type verdict]
//       Builds and renders another post and stops. Prints its cover, caption and
//       slides, and saves it to data/zernio-public.json. Nothing is posted. The two
//       flags rebuild a post the owner has already seen, after a fix to it.
//
//   npm run zernio-test -- recaption
//       Rebuilds the prepared post's captions with the caption code as it is now and
//       saves them. The slides, their files and the id are untouched, so the same
//       publish-public <id> still posts it. For a caption rule that arrives after the
//       owner has seen the slides.
//
//   npm run zernio-test -- publish-public <id>
//       Posts the prepared post PUBLICLY, and only if <id> is the id printed by
//       prepare-public. Running this command with that id is the owner's approval.
//
//   npm run zernio-test -- prepare-instagram <id> --inbox /opt/tiyul-social/data/slate-inbox
//       The prepared post's Instagram half, at 4:5, into the bot's slate inbox: an
//       item of the next morning's digest, posted only after that tap. Rebuilt,
//       because a candidate keeps no photographs, and saved only when the rebuild is
//       the same post (same id, same words, same photographs). Posts nothing itself.
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

const flag = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] || null : null;
};

async function buildOne({ destAsked = null, typeAsked = null, hookId = null, targets = ['tiktok'] } = {}) {
  const { buildPost } = await import('../src/posts/index.js');
  const { pickDestination } = await import('../src/plan/write.js');
  const { nextShape, destinationsFor } = await import('../src/posts/types.js');
  const { postConfig } = await import('../src/postConfig.js');
  const rows = JSON.parse(readFileSync(new URL('../destinations.json', import.meta.url), 'utf8')).destinations;
  const type = nextShape({ type: typeAsked }).type;
  if (typeAsked && type !== typeAsked) throw new Error(`no post type "${typeAsked}"`);
  // The hook a post already drew, so a rebuild of it opens the same way.
  const hooks = postConfig().posts.hooks || {};
  const hookOverride = hookId ? [...(hooks[type] || []), ...(hooks.shared || [])].find((h) => h.id === hookId) || null : null;
  if (hookId && !hookOverride) throw new Error(`no hook "${hookId}" for ${type}`);
  const q = String(destAsked || '').trim().toLowerCase();
  const asked = q ? rows.find((r) => [r.id, r.siteSlug, r.he, r.en].some((v) => String(v || '').toLowerCase() === q)) : null;
  if (q && !asked) throw new Error(`no destination "${destAsked}" in destinations.json`);
  const tried = [];
  for (let i = 0; i < (asked ? 1 : 3); i++) {
    const dest = asked || pickDestination(tried, { from: destinationsFor(type, rows) });
    if (!dest) break;
    tried.push(dest.he);
    try {
      const { cand } = await buildPost({
        dest,
        type,
        alternatives: rows.filter((r) => r.country === dest.country && r.id !== dest.id && r.siteSlug).slice(0, 4),
        defaultHe: dest.he,
        regionHe: dest.country,
        // TikTok by name, not targetsForKind('post'): that one includes TikTok only
        // when our own app's token is in data/store.json, and this checkout has no
        // store of its own. Zernio posts with its own app and never reads ours.
        targets,
        hookOverride,
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
  if (!urls?.length) throw new Error('no TikTok slides were rendered, so there is nothing for Zernio to fetch');
  for (const u of urls) {
    const res = await fetch(u, { method: 'HEAD', signal: AbortSignal.timeout(15_000) }).catch((e) => ({ ok: false, status: e.message }));
    if (!res.ok) throw new Error(`${u} is not publicly fetchable (${res.status}). Run this where CARD_PUBLIC_BASE_URL serves CARD_OUTPUT_DIR.`);
  }
}

/**
 * What differs between two builds' slides, or null when they are the same post:
 * the same words in the same order on the same photographs.
 */
function sameSlides(a = [], b = []) {
  const face = (s) => JSON.stringify([s.look, s.titleHe, s.noteHe, (s.lines || []).map((l) => l.text), s.image?.provenance || null]);
  if (a.length !== b.length) return `${a.length} slides against ${b.length}`;
  const i = a.findIndex((s, k) => face(s) !== face(b[k]));
  return i < 0 ? null : `slide ${i + 1} differs`;
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
  const cand = await buildOne({ destAsked: flag('dest'), typeAsked: flag('type') });
  show(cand);
  await checkFetchable(cand.deck.urls.tiktok);
  cand.deck.urls.tiktok.forEach((u, i) => console.log(`  slide ${i + 1}: ${u}`));
  // The test checkout has no data/ of its own until something writes there.
  mkdirSync(new URL('.', PUBLIC_FILE), { recursive: true });
  writeFileSync(PUBLIC_FILE, JSON.stringify(cand, null, 1));
  console.log(`\n  Prepared, NOT posted. To post it publicly:\n    npm run zernio-test -- publish-public ${cand.id}`);
} else if (mode === 'recaption') {
  if (!existsSync(PUBLIC_FILE)) throw new Error('nothing prepared - run prepare-public first');
  const { recaption } = await import('../src/posts/caption.js');
  const before = JSON.parse(readFileSync(PUBLIC_FILE, 'utf8'));
  const cand = recaption(before);
  writeFileSync(PUBLIC_FILE, JSON.stringify(cand, null, 1));
  console.log(`\n  was:     ${String(before.tiktokCaption || '').split('\n').join(' / ')}`);
  show(cand);
  console.log(`\n  Captions rebuilt, slides untouched, NOT posted. To post it publicly:\n    npm run zernio-test -- publish-public ${cand.id}`);
} else if (mode === 'publish-public') {
  const id = process.argv[3];
  if (!existsSync(PUBLIC_FILE)) throw new Error('nothing prepared - run prepare-public first');
  const cand = JSON.parse(readFileSync(PUBLIC_FILE, 'utf8'));
  if (!id || id !== cand.id) throw new Error(`publish-public needs the id prepare-public printed (${cand.id}); that id is the approval`);
  show(cand);
  await checkFetchable(cand.deck.urls.tiktok);
  await post(cand, 'PUBLIC_TO_EVERYONE');
} else if (mode === 'prepare-instagram') {
  const id = process.argv[3];
  const inbox = flag('inbox');
  if (!inbox) throw new Error("prepare-instagram needs --inbox <the bot's data/slate-inbox>");
  if (!existsSync(PUBLIC_FILE)) throw new Error('nothing prepared - run prepare-public first');
  const saved = JSON.parse(readFileSync(PUBLIC_FILE, 'utf8'));
  if (!id || id !== saved.id) throw new Error(`prepare-instagram needs the id of the prepared post (${saved.id})`);
  const cand = await buildOne({ destAsked: saved.deck.slug, typeAsked: saved.deck.type, hookId: saved.deck.hook, targets: ['instagram'] });
  const differs = sameSlides(saved.deck.slides, cand.deck.slides);
  if (cand.id !== saved.id || differs) throw new Error(`the rebuild is not the same post (${cand.id}: ${differs || 'another id'}); nothing saved`);
  const { addToInbox } = await import('../src/slate/inbox.js');
  const urls = cand.deck.urls.instagram;
  if (!urls.length) throw new Error('no Instagram slides were rendered');
  await checkFetchable(urls);
  console.log(`\n  ${cand.deck.type} · ${cand.deck.where} · ${urls.length} Instagram slides (4:5)${cand.deck.instagramTrimmed ? ` · ${cand.deck.instagramTrimmed}` : ''}`);
  urls.forEach((u, i) => console.log(`  slide ${i + 1}: ${u}`));
  console.log(`  caption: ${String(cand.instagramCaption || '').split('\n').join(' / ')}`);
  const file = addToInbox({ cand, platforms: ['instagram'], note: `↩️ פורסם בטיקטוק (${saved.id}); כאן חצי האינסטגרם שלו` }, inbox);
  console.log(`\n  In the slate inbox, NOT posted: ${file}\n  It is an item of the next morning's digest, and posts only after that tap.`);
} else {
  console.log('usage: npm run zernio-test -- private | prepare-public | recaption | publish-public <id> | prepare-instagram <id> --inbox <dir>');
  process.exitCode = 1;
}
