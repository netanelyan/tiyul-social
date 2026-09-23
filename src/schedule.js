import { postConfig } from './postConfig.js';

// When an Israeli audience is on the application, and when it is definitively
// is not.
//
// This exists because of one line in the brief: post at 12:00-14:00 and
// 19:00-22:00 Israel time, and never from Friday evening to Saturday evening.
// Both halves are about the same mechanism. A TikTok post's reach is decided by
// how the first few hundred impressions perform, those impressions are served
// in the minutes after posting, and a post published to an audience that is
// asleep, at work or off the app spends that one test on whoever happens to be
// left. There is no second test.
//
// WHAT THIS GOVERNS IS THE SHOOT QUEUE, not the card and deck drip. A shot list
// is a thing you act on within the hour — it says "film this now" — so asking
// for one at 03:00 or during Shabbat is asking for something that will be read
// eight hours later, by which point the window it was timed for has closed. The
// drip has its own quiet hours and its own interval and is deliberately left
// alone.
//
// TIME ZONE, AND WHY THIS IS NOT `new Date().getHours()`
//
// The VPS this runs on is not necessarily in Israel and its clock is not
// necessarily UTC. Reading local hours would make the schedule mean something
// different on every box it is deployed to, which is the kind of bug that looks
// like "the bot is quiet today" and takes a week to find. Intl is used to ask
// what the wall clock says in Asia/Jerusalem specifically, which also gets DST
// right without this file knowing when DST is.

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * The day-of-week and hour in Israel, whatever this machine thinks the time is.
 *
 * Returns fractional hours — 19.5 for half past seven — because the Shabbat
 * boundary is configured at an hour and comparing 19 to 19.5 has to be able to
 * tell them apart.
 */
export function israelNow(at = new Date()) {
  const cfg = postConfig().schedule;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: cfg.timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);

  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  // hourCycle h23 still emits "24" for midnight in some ICU versions, which
  // would put a post an entire day out. Normalised rather than trusted.
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute')) || 0;
  const day = DAYS.indexOf(get('weekday'));

  return { day: day < 0 ? at.getDay() : day, hour: hour + minute / 60 };
}

/**
 * Friday evening to Saturday evening, approximately.
 *
 * Approximately is the specification, not a shortcut. Real candle-lighting time
 * moves week to week with the season and the latitude, and being an hour early
 * on the Friday and an hour late on the Saturday costs a slot nobody wanted
 * anyway — while computing it properly means shipping a zmanim table and
 * keeping it right, to save an hour of reach at the edges of a window the
 * audience is not in.
 *
 * Written as a wrap-around comparison rather than as two separate day checks,
 * because the window crosses a day boundary and "day 5 after 15:00 OR day 6
 * before 20:00" stops being correct the moment somebody configures it to start
 * on Thursday.
 */
export function inShabbat(at = new Date()) {
  const { shabbat } = postConfig().schedule;
  if (!shabbat) return false;

  const { day, hour } = israelNow(at);
  const now = day * 24 + hour;
  const from = shabbat.fromDay * 24 + shabbat.fromHour;
  const to = shabbat.toDay * 24 + shabbat.toHour;

  return from <= to ? now >= from && now < to : now >= from || now < to;
}

/** Is the wall clock in Israel inside one of the configured posting windows? */
export function inWindow(at = new Date()) {
  const { windows } = postConfig().schedule;
  // No windows configured means no restriction, NOT no posting. An empty list
  // is what a schedule block that failed to parse degrades to, and a bot that
  // silently suppressed its whole queue would look exactly like a bot that had
  // nothing to say.
  if (!windows.length) return true;
  const { hour } = israelNow(at);
  return windows.some(([a, b]) => hour >= a && hour < b);
}

/**
 * Should a shot list be sent right now?
 *
 * Both conditions, and the reason is given rather than returned as a bare
 * false: "why is it quiet" is the question this answers, and `/status` prints
 * the string.
 */
export function sendableNow(at = new Date()) {
  if (inShabbat(at)) return { ok: false, why: 'שבת — לא נשלח עכשיו' };
  if (!inWindow(at)) return { ok: false, why: `מחוץ לשעות הפעילות (${windowsHe()})` };
  return { ok: true, why: null };
}

/** The configured windows, as something printable in a status line. */
export function windowsHe() {
  const { windows } = postConfig().schedule;
  if (!windows.length) return 'כל היום';
  const two = (n) => String(Math.floor(n)).padStart(2, '0') + ':' + String(Math.round((n % 1) * 60)).padStart(2, '0');
  return windows.map(([a, b]) => `${two(a)}-${two(b)}`).join(' · ');
}

/**
 * The next moment a shot list could go out, as a Date.
 *
 * Stepped forward in fifteen-minute jumps rather than solved arithmetically.
 * The closed form has to handle a window inside Shabbat, a Shabbat that wraps
 * the week boundary, an empty window list and a DST transition that adds or
 * removes an hour from the day it lands on — and the loop handles all four by
 * construction, at a cost of at most 672 comparisons for a whole week ahead.
 *
 * Returns null if nothing in the next eight days works, which can only happen
 * if every configured window sits inside Shabbat. That is a configuration
 * error, and null is what makes it visible rather than a date a year out.
 */
export function nextSendableAt(at = new Date()) {
  const step = 15 * 60_000;
  for (let t = at.getTime(); t < at.getTime() + 8 * 86_400_000; t += step) {
    const when = new Date(t);
    if (sendableNow(when).ok) return when;
  }
  return null;
}
