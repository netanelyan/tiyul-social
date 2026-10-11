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
// On the VPS the data lives outside the code folder (/var/lib/tiyul-growth), so
// both paths can be set: GROWTH_STORE_PATH below, GROWTH_THUMB_DIR here.
export const THUMB_DIR = process.env.GROWTH_THUMB_DIR || fileURLToPath(new URL('../../data/growth-thumbs/', import.meta.url));

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
  // Every text the owner marked sent or commented: the draft, what was really
  // sent, and whether they differ. Few-shot examples and the weekly edits
  // report read it (prepare/learn.js).
  sentLog: [],
  // One-time changes migrate() has made to this file, by name. A new desk starts
  // with all of them, so none applies to it.
  applied: ['agency-pause-2026-10-11'],
});

/**
 * Bring an older file up to today's shape, in place.
 *
 * Every lead used to start as female ("gender: 'f', genderFrom: 'default'"),
 * which is where "ומי שנוסעת" came from. A gender nobody established is now
 * 'unknown', and the drafts address the person in the plural.
 */
export function migrate(data) {
  for (const lead of Object.values(data.leads || {})) {
    if (lead.genderFrom === 'default' || !lead.gender) {
      lead.gender = 'unknown';
      lead.genderFrom = 'default';
    }
  }
  data.sentLog ??= [];
  // The owner's pause of 2026-10-11: no new agency messages until the new route
  // builder's routes pass the check. Set once, here, so the desk starts paused;
  // unticking "Pause new agency messages" in Settings then sticks.
  data.applied ??= [];
  if (!data.applied.includes('agency-pause-2026-10-11')) {
    data.settings = { ...(data.settings || {}), agencyPaused: true };
    data.applied.push('agency-pause-2026-10-11');
  }
  return data;
}

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
      // `applied: []` before the file: a file that never had the list has had none
      // of the one-time changes. emptyState's own list is for a NEW desk only;
      // filling it in here is how the pause of 2026-10-11 never reached the live desk.
      data = migrate({ ...emptyState(), applied: [], ...JSON.parse(readFileSync(path, 'utf8')) });
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
