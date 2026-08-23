import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Same tiny persistent store as BrickDeal: one JSON file, written atomically
// (tmp + rename), no database. Single process, a handful of posts a day.
//
// One collection is new here: `published`. The pillar quotas (src/pillars.js)
// are computed over a rolling window of what actually went out, so "kosher and
// Shabbat is an occasional thread, not the theme" is a number the code can
// check rather than a hope about the drafting prompt.
const FILE = fileURLToPath(new URL('../data/store.json', import.meta.url));

const DAY_MS = 24 * 60 * 60 * 1000;
// Read lazily rather than at module load — store.js can be evaluated before
// .env has been read. Same hoisting trap BrickDeal's deals.js documents.
const ttlMs = () => Math.max(0, Number(process.env.SEEN_TTL_DAYS ?? '45')) * DAY_MS;
const publishedWindowMs = () =>
  Math.max(1, Number(process.env.QUOTA_WINDOW_DAYS ?? '30')) * DAY_MS;

const empty = { seen: {}, queue: [], staging: {}, pendingEdit: {}, published: [], igToken: null };
let state = load();

function pruneSeen(s) {
  const cutoff = Date.now() - ttlMs();
  let changed = false;
  for (const [id, ts] of Object.entries(s.seen)) {
    if (ts < cutoff) {
      delete s.seen[id];
      changed = true;
    }
  }
  return changed;
}

// The published log only exists to answer quota questions over a rolling
// window, so anything older than that window is dead weight.
function prunePublished(s) {
  const cutoff = Date.now() - publishedWindowMs();
  const before = s.published.length;
  s.published = s.published.filter((p) => p.ts >= cutoff);
  return s.published.length !== before;
}

function load() {
  let s;
  try {
    s = { ...empty, ...JSON.parse(readFileSync(FILE, 'utf8')) };
  } catch {
    s = structuredClone(empty);
  }
  if (!Array.isArray(s.published)) s.published = [];
  const changed = pruneSeen(s) || prunePublished(s);
  if (changed) save(s);
  return s;
}

function save(s = state) {
  try {
    mkdirSync(dirname(FILE), { recursive: true });
  } catch {}
  const tmp = FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(s, null, 2));
  renameSync(tmp, FILE);
}

// --- dedupe -----------------------------------------------------------------
// Keyed by a candidate's stable id (src/candidate.js derives it from the
// canonical source URL). TTL defaults to 45 days here rather than BrickDeal's
// 10: a deal's price moves, but "the Alhambra caps daily tickets" doesn't
// become news again in a fortnight.
export const hasSeen = (id) => {
  const ts = state.seen[id];
  return Boolean(ts) && Date.now() - ts < ttlMs();
};
export function markSeen(id) {
  state.seen[id] = Date.now();
  pruneSeen(state);
  save();
}
// Roll back a claim when the pipeline fails *after* claiming it, so a transient
// error doesn't permanently bury a source item that would otherwise be fine.
export function forgetSeen(id) {
  delete state.seen[id];
  save();
}

/**
 * Forget every claimed item, so the next run rebuilds today's candidates from
 * scratch. Returns how many were dropped.
 *
 * This is for iterating on how the cards look and read: a change to the layout
 * or the copy rules is invisible until the same sources are drafted again, and
 * they are all marked seen the moment the first run claims them. Without this
 * the only way to see the effect of a change was to wait for tomorrow's news.
 *
 * Deliberately touches `seen` and nothing else. The published log stays (the
 * topic quotas are computed from it) and so does the Instagram token, which
 * lives in the same file and is expensive to replace — deleting store.json to
 * get the same effect would take both with it.
 */
export function forgetAllSeen() {
  const n = Object.keys(state.seen).length;
  state.seen = {};
  save();
  return n;
}

// --- staging (awaiting your approve/reject tap) ------------------------------
export function addStaging(item) {
  const key = Math.random().toString(36).slice(2, 9);
  state.staging[key] = item;
  save();
  return key;
}
export function takeStaging(key) {
  const item = state.staging[key];
  delete state.staging[key];
  save();
  return item || null;
}
export const getStaging = (key) => state.staging[key] || null;
export function updateStaging(key, patch) {
  if (!state.staging[key]) return false;
  state.staging[key] = { ...state.staging[key], ...patch };
  save();
  return true;
}
export const hasStaging = (key) => Boolean(state.staging[key]);
export const stagingSize = () => Object.keys(state.staging).length;
export function clearStaging() {
  const n = Object.keys(state.staging).length;
  state.staging = {};
  state.pendingEdit = {};
  save();
  return n;
}

// --- pending edits ----------------------------------------------------------
// Keyed by the staging key, never by chat: BrickDeal learned the hard way that
// a single "currently editing" value per chat lets the second of two in-flight
// edits steal the reply meant for the first. Routing is by the prompt's own
// message id (see bot.js), not by "whatever text arrived next".
export function setPendingEdit(key, edit) {
  state.pendingEdit[key] = edit;
  save();
}
export const getPendingEdit = (key) => state.pendingEdit[key] || null;
export function clearPendingEdit(key) {
  delete state.pendingEdit[key];
  save();
}
export function findPendingEditByPrompt(promptMessageId) {
  for (const [key, edit] of Object.entries(state.pendingEdit)) {
    if (edit.promptMessageId === promptMessageId) return key;
  }
  return null;
}

// --- publish queue ----------------------------------------------------------
export function enqueue(item) {
  state.queue.push(item);
  save();
}
export function dequeue() {
  const item = state.queue.shift() || null;
  if (item) save();
  return item;
}
export const queueSize = () => state.queue.length;
export const peekQueue = () => state.queue.slice(0, 10);

// --- published log (drives the pillar quotas) -------------------------------
export function recordPublished({ id, pillar, tags = [], layout, telegram, instagram }) {
  state.published.push({
    ts: Date.now(),
    id,
    pillar,
    tags,
    layout,
    telegram: Boolean(telegram),
    instagram: Boolean(instagram),
  });
  prunePublished(state);
  save();
}
// Newest first, already inside the quota window.
export function recentPublished() {
  prunePublished(state);
  return [...state.published].sort((a, b) => b.ts - a.ts);
}
export const publishedToday = () => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return state.published.filter((p) => p.ts >= start.getTime()).length;
};

// --- Instagram token ---------------------------------------------------------
// The Instagram Login path issues 60-day tokens that must be refreshed. The
// refreshed value has to outlive the process, or every restart would fall back
// to the stale seed in .env and the pipeline would still die on day 60. So the
// env var is the starting point and this is the source of truth thereafter.
export function setIgToken({ token, expiresAt }) {
  state.igToken = { token, expiresAt, updatedAt: Date.now() };
  save();
}
export const getIgToken = () => state.igToken || null;

export { existsSync };
