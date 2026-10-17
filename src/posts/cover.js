import { postConfig } from '../postConfig.js';
import { verdictOf, bookingLines, practicalOf, seasonLine, hasFlightClaim } from './source.js';
import { isKosherLine, line, VoiceError } from './voice.js';
import { checkedHe } from './budget.js';
import { toShekels, dateHe } from '../fx.js';

// THE COVER TEST, from the owner's brief of 17 Oct 2026.
//
// 36 posts sat at 420-570 views, TikTok's first test pool, at about 1% likes and no
// comments. The concept was judged fine and the covers were judged invisible. For two
// weeks only the cover and its hook change: every post type keeps its slides, and its
// first slide is replaced by one hook, set huge near the top (render/postSlides.js,
// the `hook` look), in one of two styles that alternate.
//
// THE HOOK IS ONE OF FIVE SHAPES, EACH FILLED FROM THE SITE'S OWN PAGE:
//
//   fact     a drawback the page states, shortened for the cover:  "פראג העתיקה עמוסה כמעט כל השנה"
//   money    the page's low-budget day, in shekels at the ECB rate: "אתונה ב-180 ₪ ליום, בלי טיסה ולינה"
//   mistake  a booking rule the page states:                       "הטעות שכל ישראלי עושה ברומא"
//   swap     a popular neighbour the page's own words argue against: "כולם טסים לפראג. תטוסו לבודפשט"
//   season   the best season, when it ends within two months:       "עד סוף נובמבר: אתונה בלי חום הקיץ"
//
// A shape the page cannot supply is not offered. Flights never are: no flight claim
// reaches a slide until the flight data is verified (FLIGHTS_VERIFIED in ./source.js).
//
// EVERY HOOK CARRIES ITS PAYOFF, and the payoff goes on slide two when the post does
// not already say it. A cover that promises a mistake and a post that never names it is
// the 0.5% post src/posts/deliver.js was written about. The payoff lines are the page's
// own words, verbatim, so the cover can be short and the claim still sourced.

export const SHAPES = ['fact', 'money', 'mistake', 'swap', 'season'];
export const STYLES = ['bars', 'outline'];

const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

const cfg = () => postConfig().posts.cover;

/* -------------------------------------------------------------------------- */
/* what a cover may say                                                        */
/* -------------------------------------------------------------------------- */

// The owner's banned list: our rating, "שווה או לא?", "ככה היינו עושים את זה",
// "שתי דקות", and a generic "X מקומות".
const BANNED = [
  { re: /\d(?:\.\d)?\s*\/\s*5|דירוג|נתנו ל/, why: 'our rating' },
  { re: /שווה או לא/, why: '"שווה או לא?"' },
  { re: /ככה (?:היינו|הייתי) עושים|ככה (?:היינו|הייתי) עושה/, why: '"ככה היינו עושים את זה"' },
  { re: /שתי דקות/, why: '"שתי דקות"' },
  { re: /\d+\s+(?:מקומות|דברים|אתרים)/, why: 'a generic "X מקומות"' },
];

/** Throws when a cover says something the owner banned, or something no slide may say. */
export function assertCoverHook(lines, { where = 'cover' } = {}) {
  const text = lines.join(' ');
  for (const b of BANNED) {
    if (b.re.test(text)) throw new VoiceError(`${where}: the cover says ${b.why}, which the cover test bans: ${text}`, { reason: 'banned_cover', where, text });
  }
  if (hasFlightClaim(text)) throw new VoiceError(`${where}: a flight claim on the cover: ${text}`, { reason: 'unverified_flight', where, text });
  for (const l of lines) line(l, { where });
  return lines;
}

/* -------------------------------------------------------------------------- */
/* fitting a sentence into two or three huge lines                             */
/* -------------------------------------------------------------------------- */

/**
 * Words into 2 or 3 lines, as even as they go. Null when no split keeps every line
 * within `max` characters: past that a line cannot be set near 10% of the frame.
 *
 * Two lines when two fit comfortably (the type is then larger), else three.
 */
export function splitLines(text, { max = cfg().maxLineChars, comfy = cfg().twoLineChars } = {}) {
  // A number and its unit stay on one line: "180 ₪" split over two reads as two facts.
  const words = String(text || '')
    .replace(/(\d)\s+(₪)/g, '$1 $2')
    .trim()
    // Ordinary spaces only, so a no-break space holds a name or "180 ₪" together.
    .split(/[ \t\n]+/)
    .filter(Boolean);
  const best = (k) => {
    if (words.length < k) return null;
    let top = null;
    const cut = (from, left, acc) => {
      if (left === 1) {
        const all = [...acc, words.slice(from).join(' ')];
        const worst = Math.max(...all.map((l) => l.length));
        if (!top || worst < top.worst) top = { lines: all, worst };
        return;
      }
      for (let i = from + 1; i <= words.length - left + 1; i++) cut(i, left - 1, [...acc, words.slice(from, i).join(' ')]);
    };
    cut(0, k, []);
    return top;
  };
  const two = best(2);
  if (two && two.worst <= comfy) return two.lines;
  const three = best(3);
  if (three && three.worst <= max) return three.lines;
  if (two && two.worst <= max) return two.lines;
  return null;
}

const fits = (lines, max = cfg().maxLineChars) => lines.every((l) => l.length <= max);

/* -------------------------------------------------------------------------- */
/* the five shapes                                                             */
/* -------------------------------------------------------------------------- */

const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// A clause the verdict joined on with "ו" reads as a fragment on its own. Only the
// prefixes that are the conjunction, so "ורשה" keeps its first letter.
const dropAnd = (s) => s.replace(/^ו(?=[המחלבכשאע])/, '');

/**
 * A drawback, shortened for a cover. The payoff slide quotes the clause whole.
 *
 * Shortening only ever REMOVES: a parenthesis, the part after a dash or a comma,
 * an intensifier. The one substitution is the city's own name for "העיר" or "היא",
 * which is what the sentence is about.
 */
export function shortFact(clause, destHe) {
  let s = dropAnd(flat(clause));
  // A clause that names the city past its first word is about something else
  // ("לא יעד לחופשה עצמאית בלי קופנהגן כבסיס"), or the city is mid-measurement
  // ("הגובה בקוסקו כ-3,400").
  if (s.includes(destHe) && !s.startsWith(destHe)) return null;
  // "גם" leans on a comparison the cover would not show; a leading "מ" is "from",
  // the tail of a sentence ("מצפיפות בנייה"), except the two nouns it begins.
  if (/(?<![א-ת])גם(?![א-ת])/.test(s) || /^מ(?!זג|חיר)/.test(s)) return null;
  // A clause that starts on a number was cut inside one ("3,400" split at its comma),
  // and one that points back ("להיערך אליו") needs the sentence before it.
  if (/^\d/.test(s) || /(?<![א-ת])(?:אליו|אליה|אותו|אותה|עליו|עליה)(?![א-ת])/.test(s)) return null;
  // A comma with a space is a clause boundary; "כ-3,400" is a number.
  s = s.replace(/\s*\([^)]*\)/g, '').split(/\s+-\s+|,\s+/)[0];
  s = s.replace(/\s+(?:מאוד|משמעותית|ממש|במיוחד)(?=\s|$)/g, '').trim();
  // What was left has to be a sentence: "הרכיבה" off "הרכיבה - פשוט נמחק" is a
  // word, "אבל היא גם מתישה" leans on a sentence that is not there, and a dangling
  // parenthesis means the page's own clause was cut mid-way.
  if (s.split(/\s+/).length < 2 || /^אבל\s/.test(s) || /[()]/.test(s)) return null;
  s = s.replace(/^העיר העתיקה(?=\s)/, `${destHe} העתיקה`).replace(/^(?:העיר|היא|הוא)(?=\s)/, destHe);
  if (!s.includes(destHe)) s = `${destHe}: ${s}`;
  return s;
}

// Anything about flying, not only what FLIGHT_CLAIM catches: "הטיסה ארוכה מאוד" and
// "כשעתיים טיסה" are statements about flights all the same.
// A word that starts with טיס after its prefixes, so "כרטיס" is a ticket and stays.
const FLIGHTISH = /(?<![א-ת])[הובלמשכ]*טיס/;
const usable = (s) => s && !isKosherLine(s) && !hasFlightClaim(s) && !FLIGHTISH.test(s);

function factHook(city, destHe) {
  const v = verdictOf(city);
  for (const clause of v?.consHe || []) {
    if (!usable(clause)) continue;
    const short = shortFact(clause, destHe);
    if (!usable(short)) continue;
    // The city's name stays on one line: "פלמה דה / מיורקה" reads as two places.
    const lines = splitLines(short.replace(destHe, destHe.replace(/ /g, ' ')));
    if (!lines) continue;
    return {
      shape: 'fact',
      lines,
      payoff: { titleHe: `${destHe}, בלי לייפות`, lines: [dropAnd(clause)], quote: v.source },
    };
  }
  return null;
}

/** The page's low-budget day, as one figure and its parts. Only a split figure with a checked date. */
export function lowDay(city) {
  const c = city?.dailyCost;
  const tier = c?.budget && typeof c.budget === 'object' && !Array.isArray(c.budget) ? c.budget : null;
  const checked = checkedHe(c?.source?.checked);
  if (!c?.currency || !tier || !checked) return null;
  const parts = Object.entries(tier).filter(([, v]) => Number(v) > 0);
  const total = parts.reduce((a, [, v]) => a + Number(v), 0);
  return total > 0 ? { currency: c.currency, total, parts, checked } : null;
}

const PARTS_HE = { food: 'אוכל', transport: 'תחבורה', activities: 'אטרקציות' };
const round10 = (x) => Math.max(10, Math.round(x / 10) * 10);

function moneyHook(city, destHe, rates) {
  const day = lowDay(city);
  if (!day || !rates) return null;
  const ils = toShekels(day.total, day.currency, rates);
  if (!ils) return null;
  const n = round10(ils).toLocaleString('en-US');
  let lines = [`${destHe} ב-${n} ₪`, 'ליום, בלי', 'טיסה ולינה'];
  if (!fits(lines)) lines = [`ב-${n} ₪ ליום`, `ב${destHe}`, 'בלי טיסה ולינה'];
  if (!fits(lines)) return null;
  const parts = day.parts
    .filter(([k]) => PARTS_HE[k])
    .map(([k, v]) => `${PARTS_HE[k]} כ-${round10(toShekels(v, day.currency, rates)).toLocaleString('en-US')} ₪`)
    .join(', ');
  return {
    shape: 'money',
    lines,
    payoff: {
      titleHe: `יום ב${destHe} בתקציב נמוך`,
      lines: [parts, 'בלי טיסה ובלי לינה, לאדם', `נתונים מ-${day.checked}, שער ${dateHe(rates.date)}`].filter(Boolean),
    },
    fx: { date: rates.date, currency: day.currency, total: day.total, ils },
  };
}

// "מראש" is also "arrive early" and "check the hours"; the mistake is not booking.
const BOOKED = /להזמין|הזמנה|הזמינו|הזמנתם|מזמינים|מוזמן|שהוזמן|כרטיס|הרשמה|רישום|נגמר/;

function mistakeHook(city, destHe) {
  const ahead = bookingLines(city, { want: 6 }).filter((l) => /מראש/.test(l) && BOOKED.test(l) && usable(l) && l.length <= 110);
  if (!ahead.length) return null;
  const lines = ['הטעות שכל', 'ישראלי עושה', `ב${destHe}`];
  if (!fits(lines)) return null;
  return { shape: 'mistake', lines, payoff: { titleHe: 'הטעות: לא להזמין מראש', lines: ahead.slice(0, 2) } };
}

// What makes a popular neighbour's page argue against itself, and this page for itself,
// in two kinds so a price answers a price and quiet answers a crowd where it can.
const DEAR = /מחיר|יקר|התייקר/;
const CROWDED = /עמוס|צפוף|תיירים|תורים/;
const CHEAP = /מחירים נמוכים|זול|ערך תמורת|תמורת כסף|תמורה/;
const QUIET = /פחות צפוף|פחות תיירים|שקט|השקטה/;

/**
 * The page's own short clauses, finer than clausesOf: Budapest's verdict says
 * "מחירים נמוכים" between two commas, and that is the whole argument for it.
 * Every piece is still a substring of the page.
 */
const pieces = (text) =>
  flat(text)
    .split(/[.;:]\s+|,\s+|\s+-\s+/)
    .map((s) => dropAnd(s.trim()))
    // Not "גם": "מיקונוס גם יקרה" on Santorini's page is about another island.
    .filter((s) => s.length >= 8 && s.length <= 95 && usable(s) && !/[()]/.test(s) && !/(?<![א-ת])גם(?![א-ת])/.test(s));

const km = (a, b) => {
  const rad = (d) => (Number(d) * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};

/**
 * "כולם טסים ל{A}. תטוסו ל{B}", on a post about B.
 *
 * Only when the site supports it in its own words: A's page names a price or crowd
 * drawback, B's page names good value or quiet, A is on the owner's list of where
 * everybody flies, and the two are close enough to be the same kind of trip.
 * `neighbours` is [{ row, city }] for the candidates for A, loaded by the caller.
 */
function swapHook(city, dest, neighbours) {
  const destHe = dest?.he || city.name;
  const mine = verdictOf(city);
  if (!mine) return null;
  // The selling part of the verdict only: the region before its drawbacks, and the tagline.
  const pros = [...new Set([...pieces(mine.full.split(/חסרונות|אבל/)[0]), ...pieces(city.tagline)])];
  const cheap = pros.find((p) => CHEAP.test(p));
  const quiet = pros.find((p) => QUIET.test(p));
  if (!cheap && !quiet) return null;
  const near = (neighbours || [])
    .filter(({ row, city: other }) => other && row.id !== dest?.id)
    .map((n) => ({ ...n, km: dest?.lat != null && n.row.lat != null ? km(dest, n.row) : Infinity }))
    .filter((n) => n.km <= cfg().swapMaxKm)
    .sort((a, b) => a.km - b.km);
  for (const { row, city: other } of near) {
    const v = verdictOf(other);
    const cons = (v?.consHe || []).flatMap(pieces);
    const pair =
      (cheap && cons.find((c) => DEAR.test(c)) && [cons.find((c) => DEAR.test(c)), cheap]) ||
      (quiet && cons.find((c) => CROWDED.test(c)) && [cons.find((c) => CROWDED.test(c)), quiet]) ||
      (cons.find((c) => DEAR.test(c) || CROWDED.test(c)) && [cons.find((c) => DEAR.test(c) || CROWDED.test(c)), cheap || quiet]);
    if (!pair) continue;
    const [con, pro] = pair;
    const lines = ['כולם טסים', `ל${row.he}.`, `תטוסו ל${destHe}`];
    if (!fits(lines, cfg().maxLineChars + 1)) continue;
    return {
      shape: 'swap',
      lines,
      against: row.id,
      payoff: {
        titleHe: `למה ${destHe}?`,
        lines: [`${row.he}: ${con}`, `${destHe}: ${pro}`],
        quotes: [
          [con, v.source],
          [pro, `${mine.full}\n${city.tagline || ''}`],
        ],
      },
    };
  }
  return null;
}

/** The best-season ranges a page names, as [start, end] month indexes. Exported for the tests. */
export function seasonRanges(text) {
  const head = String(text || '').split(/[.(]/)[0];
  const at = (m) => MONTHS.indexOf(m);
  const out = [];
  const re = new RegExp(`(${MONTHS.join('|')})\\s*[-–]\\s*(${MONTHS.join('|')})`, 'g');
  for (const m of head.matchAll(re)) out.push([at(m[1]), at(m[2])]);
  return out;
}

const inRange = (m, [s, e]) => (s <= e ? m >= s && m <= e : m >= s || m <= e);

function seasonHook(city, destHe, month) {
  const text = practicalOf(city).seasonHe;
  const range = seasonRanges(text).find((r) => inRange(month, r) && (r[1] - month + 12) % 12 <= 1);
  if (!range) return null;
  const end = MONTHS[range[1]];
  // The parenthesis is where a page says what the off months are like. "(יולי-אוגוסט
  // חם מאוד)" is the reason to go now, and it is only true while summer is not now.
  const aside = String(text).match(/\(([^)]*)\)/)?.[1] || '';
  // Hot as a complaint, not "חם אך נסבל": Lisbon's page says its summer is bearable.
  const hot = /חם מאוד|לוהט|חם ועמוס|חם ומלא/.test(aside) && /קיץ|יולי|אוגוסט/.test(aside) && ![5, 6, 7].includes(month);
  const lines = hot ? [`עד סוף ${end}:`, `${destHe} בלי`, 'חום הקיץ'] : [`עד סוף ${end}:`, 'העונה הטובה', `ב${destHe}`];
  if (!fits(lines, cfg().maxLineChars + 2)) return null;
  const said = seasonLine(practicalOf(city), { max: 90 });
  if (!said) return null;
  return { shape: 'season', lines, payoff: { titleHe: `עד סוף ${end}`, lines: [said] } };
}

/**
 * Every shape this page can carry today, in SHAPES order.
 *
 * `rates` is ecbRates() or null, `neighbours` the loaded candidates for a swap, and
 * `month` the Israel month now (0-11).
 */
export function coverHooks(city, { dest = null, rates = null, neighbours = [], month = new Date().getMonth() } = {}) {
  const destHe = dest?.he || city?.name;
  if (!city || !destHe) return [];
  const on = cfg().shapes || {};
  const all = {
    fact: () => factHook(city, destHe),
    money: () => moneyHook(city, destHe, rates),
    mistake: () => mistakeHook(city, destHe),
    swap: () => swapHook(city, dest, neighbours),
    season: () => seasonHook(city, destHe, month),
  };
  return SHAPES.filter((s) => Number(on[s] ?? 1) > 0)
    .map((s) => all[s]())
    .filter(Boolean);
}

/** The `instead` type argues with a destination we have no page for, which is the swap shape already. */
export function insteadHook({ defaultHe, alts }) {
  const to = alts?.[0]?.name;
  if (!defaultHe || !to) return null;
  const lines = ['כולם טסים', `ל${defaultHe}.`, `תטוסו ל${to}`];
  return fits(lines, cfg().maxLineChars + 1) ? { shape: 'swap', lines, payoff: null } : null;
}

/* -------------------------------------------------------------------------- */
/* the draws                                                                   */
/* -------------------------------------------------------------------------- */

/** Not the shape the last `memory` covers used, when anything else is on offer. */
export function pickCoverHook(hooks, { history = [], rand = Math.random } = {}) {
  if (!hooks.length) return null;
  const recent = history.map((h) => h.coverHook).filter(Boolean).slice(0, cfg().shapeMemory);
  const fresh = hooks.filter((h) => !recent.includes(h.shape));
  const pool = fresh.length ? fresh : hooks;
  const weight = (h) => Number(cfg().shapes?.[h.shape] ?? 1) || 1;
  let n = rand() * pool.reduce((a, h) => a + weight(h), 0);
  for (const h of pool) if ((n -= weight(h)) <= 0) return h;
  return pool[pool.length - 1];
}

/** The other style from the last cover's. The owner's "alternate between the two". */
export function nextCoverStyle(history = []) {
  const last = history.find((h) => h.coverStyle)?.coverStyle;
  return last === 'bars' ? 'outline' : 'bars';
}

/* -------------------------------------------------------------------------- */
/* onto the post                                                               */
/* -------------------------------------------------------------------------- */

const textOf = (slides) =>
  flat(
    slides
      .flatMap((s) => [s.titleHe, s.noteHe, ...(s.lines || []).map((l) => l?.text)])
      .filter(Boolean)
      .join('\n')
  );

/**
 * The cover slide, and the payoff slide when the post does not already carry it.
 *
 * Returns the new slide list. The builder's own cover goes, along with its rating
 * badge and its note: the owner's brief takes both off covers.
 */
export function withCover(slides, hook, { style, image, payoffImage = null, where = 'cover' } = {}) {
  assertCoverHook(hook.lines, { where });
  const cover = {
    look: 'hook',
    cover: true,
    titleHe: hook.lines.join(' '),
    hookLines: hook.lines,
    coverStyle: style,
    image: image || slides[0]?.image || null,
  };
  const rest = slides.slice(1);
  const p = hook.payoff;
  if (!p) return [cover, ...rest];

  // Only the lines the post does not already say: a verdict post quotes the page's
  // drawbacks and booking rules on its own slides, and the echo rule refuses a post
  // that says one line twice.
  const already = textOf(rest);
  const lines = p.lines.filter((l) => l && !already.includes(flat(l)));
  if (!lines.length) return [cover, ...rest];
  for (const l of lines) line(l, { where: `${where}.payoff`, quote: p.quote && hook.shape === 'fact' ? p.quote : null });
  for (const [q, src] of p.quotes || []) line(q, { where: `${where}.payoff`, quote: src });
  const payoff = {
    look: 'sheet',
    payoff: true,
    titleHe: line(p.titleHe, { where: `${where}.payoff.title` }),
    lines: lines.map((text) => ({ text })),
    image: payoffImage || slides[0]?.image || rest[0]?.image || null,
  };
  return [cover, payoff, ...rest];
}

/** Queries for a close, real-looking cover photograph: a street, food, people. */
export function coverQueries(shape, en) {
  if (!en) return [];
  return shape === 'money'
    ? [`${en} street food`, `${en} food market`, `${en} street`]
    : [`${en} street`, `${en} old town people`, `${en} market`];
}

/**
 * The cover's photograph: the first query that finds a close shot naming the place,
 * checked for nudity like every other photograph here. Null when there is none, and
 * the caller keeps the builder's own.
 */
export async function closeCoverPhoto(shape, en, { search, isNude, rand = Math.random } = {}) {
  for (const q of coverQueries(shape, en)) {
    const got = await search(q, { must: en, rand }).catch((e) => {
      console.error(`cover: the photo search "${q}" failed - ${e.message}`);
      return null;
    });
    if (got && !(await isNude(got.src))) return got;
  }
  return null;
}

/** The swap candidates near `dest`, with their pages: the A in "כולם טסים ל-A". */
export async function loadNeighbours(dest, { rows, loadCity }) {
  const ids = new Set(cfg().swapFrom);
  const near = (rows || []).filter(
    (r) => ids.has(r.id) && r.id !== dest?.id && dest?.lat != null && r.lat != null && km(dest, r) <= cfg().swapMaxKm
  );
  const out = [];
  for (const row of near) {
    const city = await loadCity(row.siteSlug || row.id).catch(() => null);
    if (city) out.push({ row, city });
  }
  return out;
}

/** The month in Israel now, 0-11, for the season shape. */
export const israelMonth = (t = Date.now()) =>
  Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', month: 'numeric' }).format(new Date(t))) - 1;
