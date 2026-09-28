import { loadEnv } from '../src/env.js';
loadEnv();

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildPost } from '../src/posts/index.js';
import { closeBrowser } from '../src/render/index.js';
import { postConfig } from '../src/postConfig.js';
import { readFileSync } from 'node:fs';

// Render one post of one type, without going anywhere near Telegram.
//
// The equivalent of deck-lab and clip-lab, and it exists for the same reason: the
// questions these formats raise are visual, and the only way to answer "does a
// twenty-slide list read as one post" is to look at twenty slides.
//
//   npm run post-lab -- --type list --dest prague
//   npm run post-lab -- --type plan --look notes --dest rome --frame phone
//   npm run post-lab -- --type instead --dest rhodes --alts crete,santorini,corfu
//   npm run post-lab -- --type map --dest prague --sizes tiktok,instagram
//
// `--no-stock` stops at the site's own Commons files and skips the stock search, which
// is what makes a layout iteration take seconds instead of minutes and still puts real
// photographs on the slides. `--no-photos` skips pictures altogether, for a pure layout
// question.

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] && !args[at + 1].startsWith('--') ? args[at + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const DESTS = JSON.parse(readFileSync(new URL('../destinations.json', import.meta.url), 'utf8')).destinations;
const rowFor = (key) => {
  const k = String(key || '').trim().toLowerCase();
  return DESTS.find((d) => d.id === k || d.siteSlug === k || d.he === key) || { id: k, he: k, en: k, siteSlug: k };
};

const type = flag('type', 'plan');
const dest = rowFor(flag('dest', 'prague'));
const look = flag('look');
const frame = flag('frame');
const sizes = (flag('sizes', 'tiktok') || '').split(',').map((s) => s.trim()).filter(Boolean);
const outDir = path.resolve(flag('out', 'out/post-lab'));
mkdirSync(outDir, { recursive: true });

// The `instead` type needs its alternatives named, because "which destinations are in
// the same region" is a judgement and the lab is where it gets made by hand.
const alts = (flag('alts', '') || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map(rowFor);

console.log(`post-lab: ${type} · ${dest.he} (${dest.siteSlug || dest.id})`);
if (look) console.log(`  look: ${look}`);
if (frame) console.log(`  frame: ${frame}`);
if (alts.length) console.log(`  alternatives: ${alts.map((a) => a.he).join(', ')}`);
console.log(`  sizes: ${sizes.join(', ')}  ->  ${outDir}`);
if (has('no-stock')) console.log("  photographs: the site's own Commons files only, no stock search");
if (has('no-photos')) console.log('  photographs: none at all, layout only');

try {
  const { post, shape, rendered, cand } = await buildPost({
    dest,
    type,
    look,
    frame,
    days: flag('days') ? Number(flag('days')) : null,
    alternatives: alts,
    defaultHe: flag('default', dest.he),
    regionHe: flag('region'),
    targets: sizes,
    photos: !has('no-photos'),
    search: !has('no-stock'),
    outDir,
    // The lab must not write to the rotation's memory. A morning spent rendering
    // fifteen list posts would otherwise leave a history that says the account has
    // posted nothing but lists, and the next real post would avoid the one type that
    // had actually not gone out.
    history: [],
  });

  console.log('');
  console.log(`✅ ${post.slides.length} slides + ${rendered.siteSlide ? 'the site page' : 'a follow ask'}`);
  console.log(`   shape: type=${shape.type} look=${shape.look} frame=${shape.frame} hook=${post.hook} caption=${cand.captionShape}`);
  console.log(`   photographs: ${post.photos.commons} from the site (Commons) · ${post.photos.stock} from stock · ${post.photos.missing} missing`);
  if (post.dropped.length) {
    console.log(`   dropped:`);
    for (const d of post.dropped.slice(0, 5)) console.log(`     ✗ ${d}`);
  }

  console.log('');
  for (const size of sizes) {
    for (const slide of rendered[size] || []) {
      console.log(`   ${size} ${String(slide.index).padStart(2, '0')} ${(slide.look || '-').padEnd(8)} ${slide.filename}`);
    }
  }

  console.log('');
  console.log('--- the TikTok description ---');
  console.log(cand.tiktokCaption);
  console.log('');
  console.log('--- the Instagram caption ---');
  console.log(cand.instagramCaption);

  // A contact sheet of filenames, so a reviewer can open the set in order rather than
  // guessing which of thirty files in the directory belong to this run.
  const manifest = {
    type: shape.type,
    look: shape.look,
    frame: shape.frame,
    hook: post.hook,
    caption: cand.captionShape,
    dest: dest.he,
    slug: post.slug,
    photos: post.photos,
    slides: Object.fromEntries(
      sizes.map((s) => [s, (rendered[s] || []).map((x) => ({ index: x.index, look: x.look, file: x.filename }))])
    ),
    tiktokCaption: cand.tiktokCaption,
    instagramCaption: cand.instagramCaption,
  };
  const at = path.join(outDir, `manifest-${shape.type}-${shape.look}-${shape.frame}.json`);
  writeFileSync(at, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log('');
  console.log(`manifest: ${at}`);
} catch (e) {
  console.error(`\n❌ ${e.message}`);
  if (has('trace')) console.error(e.stack);
  process.exitCode = 1;
} finally {
  await closeBrowser().catch(() => {});
}
