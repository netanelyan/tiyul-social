import { readFileSync } from 'node:fs';
import { loadEnv } from '../src/env.js';
import { renderDeckSize } from '../src/render/deck.js';
import { cardOutputDir, closeBrowser } from '../src/render/index.js';

// Redraw slides of a deck or itinerary that is already built.
//
//   npm run redraw -- 12962e431939 tiktok 1        one slide, one size
//   npm run redraw -- 12962e431939 tiktok          the whole TikTok set
//   npm run redraw -- 12962e431939 both 1          the cover, both sizes
//
// WHY THIS EXISTS. A rendering bug is found after the post is built, which is
// exactly when the post is the thing you want back. The filenames are
// deterministic - deck-<id>-<size>-NN.jpg - so redrawing slide 01 over the top
// of the old one is the entire repair: the URLs already in the queue keep
// working and point at the corrected picture.
//
// The first case was a cover whose line the clamp had cut: "...לראות את האור".
//
// WHAT IT CANNOT DO. A stored candidate keeps each photograph's provenance and
// credit but NOT its `src`, so only slides whose picture is still reachable can
// be redrawn. In practice that is the cover, whose image is kept whole on the
// candidate, and that is usually the slide that needed it.
//
// A DRAFT ALREADY DELIVERED DOES NOT CHANGE. TikTok downloads the image when
// the draft is handed over, so fixing the file afterwards does nothing to the
// copy sitting in the inbox. Delete that one in the app and send a new draft.
// An Instagram post still in the queue is the opposite: it has not been fetched
// yet, so redrawing the file is all that is needed.
//
// IT NEVER WRITES TO THE STORE. The bot holds the whole store in memory and
// saves it entire, so a second process saving a snapshot it read a minute ago
// would revert everything the bot did in between. This reads data/store.json as
// a plain file and imports nothing that could write it back - importing
// src/store.js alone is enough to prune and rewrite the file.

loadEnv();

const [id, sizeArg = 'both', ...rest] = process.argv.slice(2);
if (!id) {
  console.error('usage: npm run redraw -- <candidate-or-deck-id> [tiktok|instagram|both] [slide numbers...]');
  process.exit(1);
}

const sizes = sizeArg === 'both' ? ['tiktok', 'instagram'] : [sizeArg];
const only = rest.map(Number).filter((n) => Number.isInteger(n) && n > 0);

const storePath = process.env.STORE_PATH || new URL('../data/store.json', import.meta.url);
const state = JSON.parse(readFileSync(storePath, 'utf8'));

// Everywhere a built post can be sitting. Held items wrap theirs in `.cand`.
const everywhere = [
  ...Object.values(state.staging || {}),
  ...(state.queue || []),
  ...(state.held || []).map((h) => h.cand),
].filter(Boolean);

const cand = everywhere.find((c) => c.id === id || c.deck?.id === id || c.deck?.id === `plan-${id}`);
if (!cand) {
  console.error(`no staged, queued or held post with id ${id}`);
  console.error(`there are ${everywhere.length}: ${everywhere.map((c) => `${c.kind}:${c.id}`).join(', ')}`);
  process.exit(1);
}
if (!cand.deck) {
  console.error(`${cand.kind} ${cand.id} has no slides - only a deck or a plan can be redrawn`);
  process.exit(1);
}

console.log(`${cand.kind} ${cand.id}: ${cand.headline}`);
console.log(`   cover image: ${cand.deck.coverImage?.src ? 'kept' : 'MISSING - the cover cannot be redrawn'}`);
console.log(`   slides with a reachable photo: ${(cand.deck.slides || []).filter((s) => s.image?.src).length}/${(cand.deck.slides || []).length}`);

for (const size of sizes) {
  const drawn = await renderDeckSize(cand.deck, {
    size,
    outDir: cardOutputDir(),
    only: only.length ? only : null,
  });
  for (const d of drawn) {
    // `fitted` is the fit pass in render/index.js reporting that it had to
    // shrink a line to keep it whole. On a redraw it is the point of the run.
    const fit = d.fitted?.length ? ` · fitted ${d.fitted[0].from}px -> ${d.fitted[0].to}px` : '';
    console.log(`   ${size} ${String(d.index).padStart(2, '0')} ${d.filename} ${Math.round(d.bytes / 1024)}kb${fit}`);
  }
}

await closeBrowser().catch(() => {});
console.log('\ndone. The files are overwritten in place, so any URL already queued now serves the new picture.');
console.log('A TikTok draft already in the inbox keeps the OLD image - delete it there and send a fresh draft.');
