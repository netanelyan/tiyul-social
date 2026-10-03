import { loadEnv } from '../src/env.js';
loadEnv();

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { buildHiddenGemsCandidate, hiddenGemsApprovalMessage } from '../src/video/hiddenGems.js';
import { buildPost } from '../src/posts/index.js';
import { closeBrowser } from '../src/render/index.js';
import { pickFormat, mixShares, slotsPerDay } from '../src/formats/rotation.js';
import { postConfig } from '../src/postConfig.js';

// THE DRY RUN. Five hidden gems reels and two slideshows, built and encoded, and
// nothing published and nothing remembered.
//
//   npm run gems-lab
//   npm run gems-lab -- --reels 2 --posts 1
//   npm run gems-lab -- --no-hook        the template hooks only, no model call
//   npm run gems-lab -- --out output/examples
//
// WHAT "NOTHING REMEMBERED" MEANS, AND WHY IT IS THE HARDEST PART OF A LAB HERE.
//
// Three ledgers would otherwise be written by a run like this: the footage ledger
// (this Pexels file is spent), the place ledger (a reel named Lauterbrunnen today)
// and the post rotation's shape history. post-lab records what happened the last
// time one of them was forgotten - an evening of sample renders filled the live
// history to its cap, after which the next real post would have been steered by
// whatever the lab happened to render last.
//
// So this writes to none of them. `remember: false` and `history: []` on the posts,
// and the reels are handed an accumulating `seen` set held in memory here, which is
// what stops five reels in one run from using the same footage without telling the
// live store anything.

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] && !args[at + 1].startsWith('--') ? args[at + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const reels = Number(flag('reels', '5'));
const posts = Number(flag('posts', '2'));
const write = !has('no-hook');
const outDir = path.resolve(flag('out', 'output/examples'));
mkdirSync(outDir, { recursive: true });

const DESTS = JSON.parse(readFileSync(new URL('../destinations.json', import.meta.url), 'utf8')).destinations;

console.log(`gems-lab: ${reels} reel(s), ${posts} slideshow(s) -> ${outDir}`);
console.log(`   hooks: ${write ? 'generated, then scored' : 'templates only, no model call'}`);
console.log(`   the mix: ${mixShares().map((s) => `${s.id} ${(s.share * 100).toFixed(0)}%`).join(' · ')}`);
console.log(`   ${slotsPerDay()} posts a day, filled by the rotation`);
console.log('');

const examples = [];
const seen = new Set();
let failed = 0;

// EACH REEL SEARCHES A DIFFERENT SLICE OF THE CATALOGUE, and the first run of this
// lab is why. Five reels from one pool produced three: the first three took every
// clip the vision judge would commit to a place on, and the last two came back with
// "only 2 of 17 could be placed". The queue is ordered by title score, so a second
// reel in the same sitting is working down the same list rather than looking
// somewhere else.
//
// The live drip does not have this problem - it builds two a day, hours apart, from
// the whole pool, which is why `queries` defaults to all of them. A lab that builds
// five in ten minutes does, and the honest fix is to look somewhere else rather than
// to report a format that cannot be built five times.
// THE WHOLE CATALOGUE FOR EVERY REEL, WHICH IS NOT WHAT THIS LAB TRIED FIRST.
//
// Five reels from one pool produce three: the first three take every clip the vision
// judge will commit to a place on, and the last two come back with "only 2 of 17
// could be placed". The obvious fix was to point each reel at its own slice of
// clips.search.queries. It was tried twice and measured both times:
//
//   all 30 searches, five reels sharing    3 of 5 built
//   six searches each, nothing shared      3 of 5, and a different two failed
//   fifteen searches, stepped per reel     the FIRST reel failed, 1 of 21 placed
//
// The third row is the answer. Narrowing does stop the reels competing, and it also
// decides which part of the catalogue each one is stuck with: the window that opens on
// the Greek island searches comes back almost entirely as people walking through
// streets, which the judge vetoes, so a reel pointed there has nothing at all rather
// than a share of something. Breadth is what makes a placeable clip likely in the
// first place, and sharing the pool costs less than being narrowed into the wrong part
// of it.
//
// So the lab searches everything, as the drip does, and three of five is the honest
// answer to "how many of these can be built in one sitting". The drip builds two a
// day, hours apart, and never asks the question.
//
// `queries` stays a parameter on the builder. It is the right handle for a `/gems` that
// names a region, and the montage shape already narrows for its own reasons.

for (let i = 0; i < reels; i++) {
  console.log(`--- reel ${i + 1} of ${reels} ---`);
  try {
    const cand = await buildHiddenGemsCandidate({ outDir, seen, write });
    // Spent HERE, in memory, rather than in the store. The next reel of this run must
    // not be handed the same footage; the live account's ledger is none of a lab's
    // business. See the note at the top.
    for (const id of cand.clip.pexelsIds) seen.add(String(id));

    console.log(hiddenGemsApprovalMessage(cand));
    console.log('');
    console.log(cand.caption);
    console.log('');

    examples.push({
      kind: 'hidden_gems_video',
      id: cand.id,
      file: path.basename(cand.clip.file),
      seconds: cand.clip.seconds,
      holdSeconds: cand.clip.holdSeconds,
      looped: cand.clip.looped,
      audio: cand.clip.audio,
      hook: cand.hook,
      hookCategory: cand.clip.hookCategory,
      hookTemplate: cand.clip.hookTemplate,
      hookWritten: cand.hookWritten,
      hookScore: cand.clip.hookScore,
      hookConsidered: cand.clip.hookConsidered,
      hookRejected: cand.clip.hookRejected,
      clips: cand.clip.places,
      caption: cand.caption,
      source: cand.sourceName,
      notes: cand.notes,
    });
  } catch (e) {
    failed += 1;
    console.log(`❌ ${e.message}`);
    console.log('');
    examples.push({ kind: 'hidden_gems_video', failed: e.message });
  }
}

// THE SLIDESHOWS, ON THE DESTINATIONS THE ROTATION WOULD ACTUALLY PICK FOR THEM.
//
// Verdict posts, because that is what the slideshow share leads with now and because
// they are the type the delivery check is about. Named rather than drawn so the run
// is repeatable and so the two are different destinations.
const slideshowDests = (flag('dests', 'prague,barcelona') || '').split(',').map((s) => s.trim()).filter(Boolean);

for (let i = 0; i < posts; i++) {
  const key = slideshowDests[i % slideshowDests.length];
  const dest = DESTS.find((d) => d.siteSlug === key || d.id === key) || { id: key, he: key, en: key, siteSlug: key };
  console.log(`--- slideshow ${i + 1} of ${posts}: ${dest.he} ---`);
  try {
    const { post, shape, rendered, cand } = await buildPost({
      dest,
      type: 'verdict',
      targets: ['tiktok'],
      outDir,
      // The optional video variant, on for the examples, so the brief's "same content
      // as a short video" is a file somebody can watch rather than a claim.
      video: true,
      history: [],
      remember: false,
    });

    console.log(`✅ ${post.slides.length} slides · hook ${post.hook} · carries ${post.delivers.carries.join(', ')}`);
    if (post.reel) console.log(`   and as one video: ${post.reel.seconds}s, ${post.reel.slides} slides`);
    console.log('');
    console.log(cand.tiktokCaption);
    console.log('');

    examples.push({
      kind: 'slideshow',
      id: post.id,
      type: shape.type,
      dest: dest.he,
      hook: post.hook,
      titleHe: post.titleHe,
      slides: (rendered.tiktok || []).map((s) => ({ index: s.index, look: s.look, file: s.filename, titleHe: s.nameHe })),
      // WHAT THE POST ACTUALLY CARRIES, which is the whole point of the examples: the
      // brief's complaint is that the slides did not deliver the hook's promise.
      delivers: post.delivers,
      reel: post.reel ? { file: path.basename(post.reel.file), seconds: post.reel.seconds, slides: post.reel.slides } : null,
      caption: cand.tiktokCaption,
    });
  } catch (e) {
    failed += 1;
    console.log(`❌ ${e.message}`);
    console.log('');
    examples.push({ kind: 'slideshow', dest: dest.he, failed: e.message });
  }
}

// THE ROTATION'S OWN ANSWER, for the record: what it would build over the next
// fortnight at the shipped weights. Not a simulation of anything expensive, just the
// draw, so the manifest says what the mix means in posts rather than in percentages.
const fortnight = [];
let history = [];
for (let i = 0; i < slotsPerDay() * 14; i++) {
  const f = pickFormat({ history });
  fortnight.push(f.id);
  history = [f.id, ...history].slice(0, 12);
}
const counts = {};
for (const f of fortnight) counts[f] = (counts[f] || 0) + 1;

const manifest = {
  builtAt: new Date().toISOString(),
  mix: mixShares(),
  slotsPerDay: slotsPerDay(),
  fortnight: counts,
  gems: postConfig().gems,
  deliver: postConfig().posts.deliver,
  examples,
};
writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// And the same thing as something a person reads.
const lines = [
  '# Examples',
  '',
  `Built ${new Date().toISOString()} by \`npm run gems-lab\`. Nothing here was published,`,
  'and nothing was written to the account\'s ledgers.',
  '',
  `The mix: ${mixShares().map((s) => `${s.id} ${(s.share * 100).toFixed(0)}%`).join(', ')}.`,
  `Over a fortnight at ${slotsPerDay()} posts a day that comes out as ` +
    `${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`).join(', ')}.`,
  '',
];

for (const e of examples) {
  if (e.failed) {
    lines.push(`## ${e.kind}${e.dest ? ` · ${e.dest}` : ''}: did not build`, '', `    ${e.failed}`, '');
    continue;
  }
  if (e.kind === 'hidden_gems_video') {
    lines.push(
      `## ${e.hook}`,
      '',
      `\`${e.file}\` · ${e.seconds}s · ${e.clips.length} shots held ${e.holdSeconds}s${e.looped ? ' · loops' : ''}` +
        `${e.audio ? ` · music` : ' · silent, sound chosen in the app'}`,
      '',
      `Hook: **${e.hookCategory}/${e.hookTemplate}**, scored ${e.hookScore?.total?.toFixed(3)} ` +
        `(specific ${e.hookScore?.specificity?.toFixed(2)}, curious ${e.hookScore?.curiosity?.toFixed(2)}, ` +
        `honest ${e.hookScore?.honesty?.toFixed(2)})${e.hookWritten ? ', written by the model' : ', filled from a template'}`,
      '',
      'Shots:',
      ...e.clips.map((c, i) => `${i + 1}. ${c}`),
      '',
      'Runners up:',
      ...(e.hookConsidered || []).slice(1).map((c) => `- ${c.total.toFixed(3)} ${c.text}`),
      ...((e.hookRejected || []).length ? ['', 'Refused:', ...e.hookRejected.map((r) => `- ${r.text} (${r.why})`)] : []),
      '',
      'Caption:',
      '',
      '```',
      e.caption,
      '```',
      '',
      `Footage: ${e.source}`,
      '',
    );
  } else {
    lines.push(
      `## ${e.titleHe}`,
      '',
      `${e.type} · ${e.dest} · hook \`${e.hook}\` · ${e.slides.length} slides`,
      '',
      `Carries: ${e.delivers?.carries?.join(', ') || 'nothing'}` +
        `${e.reel ? ` · also encoded as one ${e.reel.seconds}s video (\`${e.reel.file}\`)` : ''}`,
      '',
      'Slides:',
      ...e.slides.map((s) => `${s.index}. ${s.titleHe || s.look}`),
      '',
      'Caption:',
      '',
      '```',
      e.caption,
      '```',
      '',
    );
  }
}

writeFileSync(path.join(outDir, 'README.md'), `${lines.join('\n')}\n`);

console.log('');
console.log(`manifest: ${path.join(outDir, 'manifest.json')}`);
console.log(`readme:   ${path.join(outDir, 'README.md')}`);
console.log(`over a fortnight the rotation would build: ${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`).join(', ')}`);
if (failed) console.log(`\n${failed} example(s) did not build. The reasons are in the readme.`);

await closeBrowser().catch(() => {});
process.exitCode = failed === reels + posts ? 1 : 0;
