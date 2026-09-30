import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The numbers, kept beside what produced them.
//
// ITS OWN FILE, NOT data/store.json, and the reason is how the two are written. The
// main store rewrites itself in full on every save - every time anything is marked
// seen, a candidate staged, a clip recorded - and it holds the live tokens. Metrics
// grow without bound, are appended to once a night, and are the one thing here that is
// safe to lose. Sharing a file would mean rewriting a year of numbers to mark one item
// seen, and risking the token file for data that can be re-fetched.
//
// WHAT A ROW IS. One published post, keyed on the CANDIDATE id rather than on the
// platform's media id, because the candidate is the thing that has a type, a look, a
// hook shape and an aspect ratio - and those four are what the report groups by. The
// platform ids hang off the row so the nightly job knows what to ask about.
//
// The numbers are stored RAW and per platform. Everything the report ranks on is a
// ratio computed at read time, because the ratio is the thing that changes as views
// accumulate and a stored ratio would be a snapshot nobody can re-derive.

const DEFAULT = fileURLToPath(new URL('../../data/metrics.json', import.meta.url));
const FILE = () => process.env.METRICS_PATH || DEFAULT;

const EMPTY = { version: 1, posts: {} };

let state = null;

function load() {
  if (state) return state;
  try {
    const raw = JSON.parse(readFileSync(FILE(), 'utf8'));
    state = { ...EMPTY, ...raw, posts: raw?.posts || {} };
  } catch {
    // A missing or unreadable file is an empty history, not an error. This is the one
    // collection in the project whose absence costs nothing: the numbers can be
    // re-fetched from both platforms.
    state = { ...EMPTY, posts: {} };
  }
  return state;
}

function save() {
  const at = FILE();
  mkdirSync(path.dirname(at), { recursive: true });
  // Written to a temporary file and renamed, like the main store: a process killed
  // mid-write should not leave a truncated JSON file that the next load silently reads
  // as an empty history.
  const tmp = `${at}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 1)}\n`);
  renameSync(tmp, at);
}

/**
 * Record that a post was published, with the shape that produced it.
 *
 * CALLED AT PUBLISH TIME, because this is the only moment both halves exist: the
 * platform has just handed back a media id, and the candidate that knows it was a
 * `list` post in the `label` look at 3:4 is still in hand. A week later neither is
 * derivable from the other.
 */
export function notePublished(candidateId, { platform, mediaId, shape = {}, at = null } = {}) {
  const id = String(candidateId || '').trim();
  if (!id || !platform || !mediaId) return null;
  const s = load();
  const row = s.posts[id] || { id, shape: {}, media: {}, stats: {}, at: at || new Date().toISOString() };
  row.shape = { ...row.shape, ...shape };
  row.media[platform] = String(mediaId);
  s.posts[id] = row;
  save();
  return row;
}

/**
 * Record numbers somebody read off the app, for a post the API cannot describe.
 *
 * THE ONLY WAY THIS ACCOUNT LEARNS ANYTHING ABOUT TIKTOK, and it is worth being blunt
 * about why a typed-in number earns a place in a system built on fetched ones.
 *
 * Every post this pipeline makes for TikTok is a photo carousel. The Display API's
 * video list needs a scope this app never requested, and it is documented as returning
 * videos - so the numbers that matter most are unreachable by any amount of code. See
 * src/metrics/tiktok.js.
 *
 * Meanwhile the owner can read the view count off the screen in two seconds. A pipeline
 * that ranks its formats on Instagram alone, while every post is aimed at TikTok and
 * TikTok is where the evidence came from, is measuring the wrong platform carefully.
 *
 * CREATES THE ROW IF THERE IS NONE, which is what makes it useful on the posts that
 * matter today: anything published before the metrics hook existed has a published-
 * ledger entry and no metrics row, and those are exactly the posts somebody wants to
 * record a number against.
 *
 * `by: 'hand'` is kept on the reading. The report prints it, because a number somebody
 * typed and a number Meta returned are not the same kind of evidence and the difference
 * should not be invisible in a ranking.
 */
export function noteByHand(candidateId, platform, stats, { shape = null, at = null } = {}) {
  const id = String(candidateId || '').trim();
  if (!id || !platform) return null;
  const s = load();
  const row = s.posts[id] || { id, shape: {}, media: {}, stats: {}, at: at || new Date().toISOString() };
  if (shape) row.shape = { ...row.shape, ...shape };
  if (at && !s.posts[id]) row.at = at;
  row.stats[platform] = {
    ...(row.stats[platform] || {}),
    ...stats,
    by: 'hand',
    readAt: new Date().toISOString(),
  };
  s.posts[id] = row;
  save();
  return row;
}

/** Record what a platform reported. Overwrites: the newest reading is the one that counts. */
export function noteStats(candidateId, platform, stats) {
  const s = load();
  const row = s.posts[String(candidateId)];
  if (!row || !stats) return null;
  row.stats[platform] = { ...stats, readAt: new Date().toISOString() };
  save();
  return row;
}

/** Every row, newest first. */
export const allRows = () =>
  Object.values(load().posts).sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));

/** The rows a nightly job should ask about: published, on this platform, and recent. */
export function rowsToRefresh(platform, { days = 30 } = {}) {
  const cutoff = Date.now() - days * 86_400_000;
  return allRows().filter((r) => r.media?.[platform] && Date.parse(r.at || '') >= cutoff);
}

/** For the tests: forget the parsed file so the next call re-reads it. */
export const __reset = () => {
  state = null;
};

/**
 * The two ratios everything is ranked on.
 *
 * PER VIEW, and the whole argument for this change is in that choice. The evidence
 * table is saves and shares per LIKE, which is the right comparison between accounts of
 * different sizes; within one account, per view is the same measure with the noise
 * taken out - a post that reached twice as many people should not rank twice as well
 * for being shown twice as often.
 *
 * Null rather than zero when there is nothing to divide by. A post with no views yet
 * has no rate, and calling it zero would rank it below a post that genuinely failed.
 */
export function rates(stats) {
  if (!stats) return { saveRate: null, shareRate: null, views: null };
  const views = Number(stats.views ?? stats.reach);
  if (!Number.isFinite(views) || views <= 0) return { saveRate: null, shareRate: null, views: null };
  const rate = (n) => (Number.isFinite(Number(n)) ? Number(n) / views : null);
  return { saveRate: rate(stats.saved), shareRate: rate(stats.shares), views };
}
