import { loadEnv } from '../src/env.js';
loadEnv();

import { mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { buildBeforeCandidate, beforeApprovalMessage } from '../src/video/before.js';
import { closeBrowser } from '../src/render/index.js';

// THE DRY RUN FOR THE "BEFORE YOU BOOK" REEL. Built and encoded, nothing published and
// nothing remembered: the footage seen in this run is held in memory here and the live
// store is never touched, for the reason scripts/gems-lab.js gives at length.
//
//   npm run before-lab                       Rome, Santorini, Prague
//   npm run before-lab -- rome paris dubai   by site slug or English name
//   npm run before-lab -- --out output/examples/before

const args = process.argv.slice(2);
const at = args.indexOf('--out');
const outDir = path.resolve(at >= 0 ? args[at + 1] : 'output/examples/before');
const asked = args.filter((a, i) => !a.startsWith('--') && (at < 0 || i !== at + 1));
mkdirSync(outDir, { recursive: true });

const DESTS = JSON.parse(readFileSync(new URL('../destinations.json', import.meta.url), 'utf8')).destinations;
const find = (q) =>
  DESTS.find((d) => d.siteSlug === q || String(d.en).toLowerCase() === q.toLowerCase() || d.he === q) || null;
const wanted = (asked.length ? asked : ['rome', 'santorini-mykonos', 'prague']).map((q) => [q, find(q)]);

const seen = new Set();
const report = [];
for (const [q, dest] of wanted) {
  if (!dest?.siteSlug) {
    console.log(`✗ ${q}: not a destination with a page`);
    continue;
  }
  const t0 = Date.now();
  try {
    const cand = await buildBeforeCandidate(dest, { seen, outDir });
    for (const id of cand.clip.pexelsIds) seen.add(id);
    const file = path.join(outDir, `before-${dest.siteSlug}.mp4`);
    copyFileSync(cand.clip.file, file);
    console.log(`\n✓ ${dest.he} in ${((Date.now() - t0) / 1000).toFixed(0)}s -> ${file}\n`);
    console.log(beforeApprovalMessage(cand));
    console.log(`\n--- caption ---\n${cand.instagramCaption}\n`);
    report.push({ dest: dest.he, file, seconds: cand.clip.seconds, beats: cand.clip.beats, hook: cand.hook, caption: cand.instagramCaption });
  } catch (e) {
    console.log(`✗ ${dest.he}: ${e.message}`);
    report.push({ dest: dest.he, error: e.message });
  }
}

writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 1)}\n`);
await closeBrowser().catch(() => {});
