import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { templateOf } from './plan.js';

// Posts the owner asked to see in the next morning's digest, from outside the bot.
//
// One file per post in data/slate-inbox/, written by a script (the first is the
// Florence verdict's Instagram half: `npm run zernio-test -- prepare-instagram`).
// A FILE, NOT A STORE WRITE: the bot holds data/store.json in memory and saves
// over anything another process writes there.
//
// The slate takes them before it builds its own, each into the earliest slot of
// every platform it names, and moves the file to used/ once a slate holds it. One
// that finds no slot (a day with none left) waits for the next. Nothing here skips
// the morning tap: an inbox post is an item of the digest like any other.

export const inboxDir = () =>
  process.env.SLATE_INBOX_DIR || fileURLToPath(new URL('../../data/slate-inbox/', import.meta.url));

const PLATFORMS = ['tiktok', 'instagram'];

/** Why an entry cannot go on a slate, or null. */
export function entryProblem(entry) {
  const cand = entry?.cand;
  if (!cand?.id || cand.kind !== 'post') return 'not a post candidate';
  if (entry.notBefore && !/^\d{4}-\d{2}-\d{2}$/.test(entry.notBefore)) return `notBefore must be YYYY-MM-DD (got ${entry.notBefore})`;
  const platforms = entry.platforms || [];
  if (!platforms.length || platforms.some((p) => !PLATFORMS.includes(p))) return `platforms must be tiktok and/or instagram (got ${platforms.join(', ') || 'none'})`;
  for (const p of platforms) {
    const urls = cand.deck?.urls?.[p] || [];
    if (urls.length < 2) return `no ${p} slides`;
    if (urls.some((u) => !String(u).startsWith('https://'))) return `a ${p} slide is not https`;
    if (p === 'instagram' && urls.length > 10) return `${urls.length} Instagram slides, a carousel takes 10`;
  }
  return null;
}

/** Save one entry. The file is named by the post id, so writing it twice replaces it. */
export function addToInbox(entry, dir = inboxDir()) {
  const problem = entryProblem(entry);
  if (problem) throw new Error(`slate inbox: ${problem}`);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${entry.cand.id}.json`);
  writeFileSync(file, JSON.stringify({ ...entry, addedAt: entry.addedAt || new Date().toISOString() }, null, 1));
  return file;
}

/** Every waiting entry, oldest first, and a warning for each file that cannot be used. */
export function readInbox(dir = inboxDir()) {
  if (!existsSync(dir)) return { entries: [], warnings: [] };
  const entries = [];
  const warnings = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const file = path.join(dir, name);
    let entry = null;
    try {
      entry = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      entry = null;
    }
    const problem = entry ? entryProblem(entry) : 'not JSON';
    if (problem) {
      warnings.push(`תיבת התוכנית: ${name} לא נכנס (${problem})`);
      moveTo(dir, file, 'rejected');
      continue;
    }
    entries.push({ file, entry });
  }
  entries.sort((a, b) => String(a.entry.addedAt || '').localeCompare(String(b.entry.addedAt || '')));
  return { entries, warnings };
}

/**
 * Give inbox entries the day's earliest slots. Pure. Returns the slate items for
 * the ones placed, the files they came from, and the slots left for the built posts.
 * An entry with `notBefore` (an Israel date) waits for the first slate on or after it.
 */
export function placeInbox(entries, slots, { date = null } = {}) {
  const left = { ...slots, tiktok: [...slots.tiktok], instagram: [...slots.instagram] };
  const items = [];
  const files = [];
  for (const { file, entry } of entries) {
    if (entry.notBefore && date && date < entry.notBefore) continue;
    if (entry.platforms.some((p) => !left[p].length)) continue;
    const at = Object.fromEntries(entry.platforms.map((p) => [p, left[p].shift()]));
    items.push({
      key: entry.cand.id,
      cand: { ...entry.cand, publishTargets: entry.platforms, ...(at.tiktok ? { tiktokVia: 'zernio' } : {}) },
      template: templateOf(entry.cand.deck),
      tiktokAt: at.tiktok || null,
      instagramAt: at.instagram || null,
      note: entry.note || null,
    });
    files.push(file);
  }
  return { items, files, slots: left };
}

/** Out of the inbox once a slate holds it, so it is offered once. */
export const markUsed = (file) => moveTo(path.dirname(file), file, 'used');

function moveTo(dir, file, sub) {
  try {
    mkdirSync(path.join(dir, sub), { recursive: true });
    renameSync(file, path.join(dir, sub, path.basename(file)));
  } catch (e) {
    console.error(`slate inbox: could not move ${file} to ${sub}: ${e.message}`);
  }
}
