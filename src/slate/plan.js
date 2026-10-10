import { postConfig } from '../postConfig.js';
import { inShabbat, inWindow } from '../schedule.js';

// The day's slots, and which deck goes in which. Pure.
//
// THE RULES THIS FILE HOLDS, from the owner's brief for the daily slate:
//   - times are Israel wall clock, from post-config.json, never a timer from boot
//   - inside the posting windows, outside Shabbat (src/schedule.js decides both)
//   - Friday and Saturday have their own times, so they still count as posting days
//   - week one posts fewer TikTok slots (the ramp), then the full set
//   - TikTok and Instagram never carry the same deck within the same hour
//   - no two consecutive posts on one platform share a template

const tz = () => postConfig().schedule.timeZone || 'Asia/Jerusalem';

function wallClock(t, timeZone = tz()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(t));
  const get = (k) => Number(parts.find((p) => p.type === k)?.value);
  return { y: get('year'), m: get('month'), d: get('day'), H: get('hour'), M: get('minute') };
}

/** The Israel date of an instant, as YYYY-MM-DD. */
export function israelDate(t = Date.now(), timeZone = tz()) {
  const w = wallClock(t, timeZone);
  return `${w.y}-${String(w.m).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`;
}

/** The instant at which the Israel wall clock reads `hhmm` on `date`. DST-safe. */
export function israelInstant(date, hhmm, timeZone = tz()) {
  const [y, m, d] = date.split('-').map(Number);
  const [H, M] = hhmm.split(':').map(Number);
  const want = Date.UTC(y, m - 1, d, H, M);
  let t = want - 2 * 3_600_000;
  for (let i = 0; i < 3; i++) {
    const w = wallClock(t, timeZone);
    const diff = want - Date.UTC(w.y, w.m - 1, w.d, w.H, w.M);
    if (!diff) break;
    t += diff;
  }
  return new Date(t);
}

/** 0 Sunday ... 6 Saturday, for an Israel date string. */
export const weekday = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();

/** `n` of `list`, spread across it: two of three slots are the first and the last. */
export function spread(list, n) {
  if (n >= list.length) return list.slice();
  if (n <= 0) return [];
  if (n === 1) return [list[0]];
  return Array.from({ length: n }, (_, i) => list[Math.round((i * (list.length - 1)) / (n - 1))]);
}

/**
 * The day's slots, as instants, with any that fall inside Shabbat or outside a
 * window dropped and named (a configured slot that can never post is a mistake
 * in the file, and the digest says so rather than quietly posting less).
 */
export function slotsFor(date, cfg = postConfig().slate, { rampTiktok = null } = {}) {
  const day = cfg.slotsByDay?.[String(weekday(date))] || cfg.slots;
  const dropped = [];
  const keep = (hhmm, platform) => {
    const at = israelInstant(date, hhmm);
    if (inShabbat(at)) return dropped.push(`${platform} ${hhmm}: שבת`), null;
    if (!inWindow(at)) return dropped.push(`${platform} ${hhmm}: מחוץ לשעות הפרסום`), null;
    return at;
  };
  let tiktok = day.tiktok.map((t) => keep(t, 'טיקטוק')).filter(Boolean);
  const instagram = day.instagram.map((t) => keep(t, 'אינסטגרם')).filter(Boolean);
  if (rampTiktok != null) tiktok = spread(tiktok, rampTiktok);
  return { tiktok, instagram, dropped };
}

/** What a viewer sees as "the same post again". The plan type is the one whose look changes the design. */
export const templateOf = (deck) => (deck?.type === 'plan' ? `plan:${deck.look}` : deck?.type || 'unknown');

function permutations(list) {
  if (list.length <= 1) return [list.slice()];
  return list.flatMap((x, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((p) => [x, ...p]));
}

const neighboursDiffer = (seq, before) => seq.every((t, i) => t !== (i === 0 ? before : seq[i - 1]));

/**
 * Put decks in slots.
 *
 * `decks` are { template } in any order; `slots` from slotsFor; `last` the
 * template each platform posted last (yesterday), so today cannot open on it.
 * Returns items [{ deck, tiktokAt, instagramAt }] where `deck` is an index into
 * `decks`, plus `warnings` for any rule that could not be kept.
 */
export function assign(decks, slots, { gapMs = 60 * 60_000, last = {} } = {}) {
  const warnings = [];
  const n = Math.min(decks.length, slots.tiktok.length);
  const idx = decks.map((_, i) => i);

  // TikTok: an order in which no two neighbours share a template, starting away
  // from yesterday's last. At three or four decks every order can be tried.
  const orders = idx.length <= 6 ? permutations(idx) : [idx];
  const tiktokOrder =
    orders.find((o) => neighboursDiffer(o.slice(0, n).map((i) => decks[i].template), last.tiktok)) || idx;
  if (!neighboursDiffer(tiktokOrder.slice(0, n).map((i) => decks[i].template), last.tiktok)) {
    warnings.push('לא נמצא סדר שבו שני פוסטים רצופים בטיקטוק שונים בתבנית');
  }
  const items = tiktokOrder.slice(0, n).map((d, i) => ({ deck: d, tiktokAt: slots.tiktok[i], instagramAt: null }));

  // Instagram: which decks, in which of its slots. Same rule for neighbours, and
  // no deck within `gapMs` of its own TikTok slot.
  const m = Math.min(slots.instagram.length, items.length);
  const candidates = permutations(items.map((_, i) => i)).map((p) => p.slice(0, m));
  const fits = (pick) =>
    pick.every((it, j) => Math.abs(slots.instagram[j] - items[it].tiktokAt) >= gapMs) &&
    neighboursDiffer(pick.map((it) => decks[items[it].deck].template), last.instagram);
  const pick = candidates.find(fits) || candidates.find((p) => p.every((it, j) => Math.abs(slots.instagram[j] - items[it].tiktokAt) >= gapMs));
  if (!pick && m) warnings.push('לא נמצא שיבוץ לאינסטגרם שמרחיק כל פוסט שעה מאותו פוסט בטיקטוק');
  else if (pick && !fits(pick)) warnings.push('באינסטגרם שני פוסטים רצופים באותה תבנית');
  (pick || []).forEach((it, j) => {
    items[it].instagramAt = slots.instagram[j];
  });
  return { items, warnings };
}
