import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// data/growth.json, and nothing else.
//
// THIS IS NOT src/store.js AND MUST NEVER BECOME A WAY INTO IT. The posting
// store holds the live Instagram token, the publish history and the dedupe
// record, and it is written whole by the bot's one process: a second reader
// that saved would revert the bot. The selftest walks every import this folder
// makes and fails if any of them reaches that module.
//
// The same shape of design, for the same reason, applied to our own file: the
// whole state in memory, written whole on every change, atomically (a temp file
// and a rename, so a crash mid-write leaves the last good copy rather than half
// of one). Only the desk's process writes it. A second `npm run growth` finds
// the port taken and exits before it opens this file.

export const DEFAULT_PATH = fileURLToPath(new URL('../../data/growth.json', import.meta.url));
export const THUMB_DIR = fileURLToPath(new URL('../../data/growth-thumbs/', import.meta.url));

export const VERSION = 1;

export const emptyState = () => ({
  v: VERSION,
  settings: {},
  // id -> lead. See rules.js for the shape.
  leads: {},
  // Dedupe, forever: a video, a handle, a phone or a place seen once is never
  // a new lead again. key -> { at, lead }.
  seen: {},
  // Do not contact, forever. key -> { at, why }.
  dnc: {},
  // date (Israel) -> { comment: [], creator: [], agency: [], customer: [] } of
  // item keys. What Today showed that day, so the caps hold across reloads.
  daily: {},
  // 'YYYY-MM' -> { api -> { units, usd } }.
  spend: {},
  runs: [],
  // Hashtags used on Brave queries, for the rotation. [{ tag, at }].
  hashtagLog: [],
  // The site's city list and itinerary pages, refreshed once a day.
  site: { at: null, options: [], itineraries: [] },
});

/**
 * Open the store at `path`.
 *
 * Returns the state plus `save()`. A missing file is a fresh desk. An unreadable
 * one throws: silently starting empty would forget every do-not-contact and
 * every dedupe key, which is the one thing this file exists to remember.
 */
export function openStore(path = process.env.GROWTH_STORE_PATH || DEFAULT_PATH) {
  let data = emptyState();
  if (existsSync(path)) {
    try {
      data = { ...emptyState(), ...JSON.parse(readFileSync(path, 'utf8')) };
    } catch (e) {
      throw new Error(`${path} could not be read (${e.message}). Fix or move it; starting empty would forget every do-not-contact.`);
    }
  }

  const save = () => {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 1));
    renameSync(tmp, path);
  };

  return { data, save, path };
}
