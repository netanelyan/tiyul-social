import { loadCity, verdictOf, practicalOf, firstClause, bookingLines, notesSource } from '../posts/source.js';
import { costLine } from '../posts/verdict.js';
import { line, openClause, isKosherLine } from '../posts/voice.js';
import { postConfig } from '../postConfig.js';
import { targetsForKind } from '../publish/targets.js';
import { beforeCaption, captionFollow } from '../hashtags.js';
import { assertNoUrl } from '../format.js';
import { hasLongDash } from '../dashes.js';
import { COUNTRIES } from '../deck/flags.js';
import { findClips } from './pexels.js';
import { clipOutputDir } from './overlay.js';
import { buildHiddenGemsClip } from './hiddenGems.js';
import { silentSoundLine } from './tracks.js';

// THE "BEFORE YOU BOOK" REEL: the promise that reached the most people, paid off on
// video, with a fact on every cut.
//
// BUILT FROM THE ACCOUNT'S OWN TIKTOK NUMBERS, read off the app on 5 Oct 2026:
//
//   לפני שאתם מזמינים לסנטוריני, שתי דקות   carousel   2,051 views   0.4% likes
//   3 יעדים שאנשים לא חושבים עליהם מספיק    reel         615 views   3.4% likes
//   4 יעדים עם מים בצבע הזה                 reel         584 views   2.7% likes
//   carousels on average                              605 views   1.4% likes
//   reels on average                                  286 views   2.8% likes
//
// TWO HALVES OF A HIT, ON TWO DIFFERENT POSTS. The Santorini hook earned 4x the
// average reach because it names a place people are deciding on and promises the
// decision; it earned almost no likes because the slides did not pay that off. The
// counted reels earned the likes because moving footage of somewhere beautiful, one
// beat at a time, is a pleasure to watch; they earned half the reach because "3 places
// nobody thinks about" is a mood, not a decision. Nothing this account has posted does
// both. This is the post that does.
//
// THE SHAPE, and every part of it is something that already worked here:
//
//   0.0s   "לפני שאתם מזמינים לרומא" over the strongest shot of Rome, with
//          "4 דברים ששווה לדעת" under it. The Santorini hook, kept.
//   1.6s   the first cut, before the drop the 3.1 second reel measured.
//   3.2s   the hook shrinks to a header and stays; the counter starts. 1/4.
//          Each cut is new footage OF THE SAME PLACE with one fact on it:
//          when to go, what a day costs, what to book ahead, and what is worse
//          than the photos. The counter is the promise that more is coming.
//   end    "שמרו לפני שמזמינים". A reel that is a tool gets saved, and the saves
//          were the one number every carousel that worked had in common.
//
// EVERY FACT IS THE PAGE'S OWN. The advice formats were parked in BRIEF.md for a
// reason that still stands: "3 mistakes Israelis make in Georgia" needs three mistakes
// nobody reported. This reel says nothing a stock clip has to stand behind. The season,
// the cost, the booking note and the drawback all come off the tiyulplus.com page for
// the destination, through the same extractors the verdict post uses, and every
// drawback is a verbatim quote checked by `line`. The footage only has to be the place,
// which the vision judge confirms against the search.
//
// The encoder is the gems reel's, unchanged, fed a timeline built here. The two formats
// differ in what is written on each shot and how long it takes to read, which is all
// this file decides.

/** What one beat says, in the order a decision is made. Kosher is never a beat: see below. */
export const KICKERS = {
  cost: 'כמה זה עולה',
  season: 'מתי לטוס',
  book: 'מה להזמין מראש',
  know: 'טוב לדעת',
  con: 'מה פחות טוב',
  flight: 'איך מגיעים',
  pro: 'למה כן',
};

// How long a fact stays on screen, from its length. A label is a name and is read in a
// glance; a fact is a sentence and is read word by word. Measured against the lines the
// catalogue actually produces: a twenty character drawback gets 2.1s, a forty-five
// character booking note gets the 3.6s ceiling.
const READ = { base: 0.9, perChar: 0.06, min: 2.0, max: 3.6 };
// The ask on the last shot is read after the fact under it, not instead of it.
const ASK_SECONDS = 0.9;
// Past this the fourth beat goes rather than the reel running long. Rule 6 of the brief
// allows 35; the numbers here say completion falls with every second, and four facts at
// the ceiling would be seventeen.
const MAX_SECONDS = 16.5;
// A fact longer than this is a paragraph on a phone screen.
const MAX_CHARS = 62;

export const readSeconds = (factHe) => {
  const n = String(factHe || '').length;
  return Math.round(Math.min(READ.max, Math.max(READ.min, READ.base + READ.perChar * n)) * 10) / 10;
};

/**
 * When to go, as the page says it, short enough for a screen.
 *
 * The first sentence when it fits, which is seasonLine's rule. When it does not, the
 * text up to the first spaced dash or semicolon, which on these pages is where the
 * answer stops and the caveats start: Phuket's "נובמבר-אפריל (עונה יבשה...) - מאי-אוקטובר
 * מונסון" is a season and then a warning. Always a prefix of the page's own text, and
 * never one that leaves a bracket open, which cutting inside Phuket's would.
 */
export function seasonFact(text, { max = MAX_CHARS } = {}) {
  const whole = firstClause(text, { max });
  if (whole) return whole;
  let cut = String(text || '').split(/\s+[-\u2013\u2014]\s+|;/)[0].trim();
  if ((cut.match(/\(/g) || []).length > (cut.match(/\)/g) || []).length) cut = cut.split(/\s+\(/)[0].trim();
  return cut.length >= 5 && cut.length <= max ? cut : null;
}

/**
 * The facts this destination's page can stand behind, three or four of them, in order.
 *
 * ORDER IS RETENTION. The cost leads because a number is the most specific thing a
 * first beat can carry, and the reference account this brief was written against
 * opens on prices in four of its eight best hooks. The drawback closes, because it is
 * the one a viewer cannot get from a brochure: it is what makes the reel honest, and
 * the last beat is the one a viewer is on when deciding whether to save it.
 *
 * KOSHER IS NEVER A BEAT, by the owner's rule in src/posts/voice.js: kashrut may be a
 * note and never a slide's only line, and on this reel every beat is a whole screen.
 *
 * Pure: a city in, beats out. Throws nothing; the caller decides what too few means.
 */
export function beforeBeats(city, { max = 4, maxChars = MAX_CHARS, destHe = null } = {}) {
  const verdict = verdictOf(city);
  const practical = practicalOf(city);
  const fits = (s) => s && s.length <= maxChars && !isKosherLine(s) && !hasLongDash(s);
  const shortest = (list) => [...(list || [])].map(openClause).filter(fits).sort((a, b) => a.length - b.length)[0] || null;

  const cost = costLine(city);
  const season = seasonFact(practical.seasonHe, { max: maxChars });
  // A booking note comes from one day of the page's itinerary, and on a page that
  // covers two places that day may be the other one's: Santorini's page gave "חורה
  // סגורה לרכבים", which is Mykonos town, under a hook naming Santorini. On such a page
  // the note has to name the destination the hook names, or it is not this reel's.
  const ours = (s) => !destHe || !coversSeveral(city) || s.includes(destHe);
  const booking = bookingLines(city, { max: maxChars, want: 5 }).find((s) => fits(s) && ours(s)) || null;
  const con = verdict?.cued ? shortest(verdict.consHe) : null;
  const flight = firstClause(practical.flightsHe, { max: maxChars });
  const pro = shortest(verdict?.prosHe);

  // `quote` is the page text an OPINION must be a substring of. The cost and the season
  // are fields, formatted (the cost) or cut to the first sentence (the season), so they
  // run the voice guards without the substring check, exactly as the verdict post's
  // "who is this for" slide does with the same two lines.
  const candidates = [
    ['cost', cost, null],
    ['season', season, null],
    booking ? [/מראש|להזמין|הזמנה|כרטיס/.test(booking) ? 'book' : 'know', booking, notesSource(city)] : null,
    ['con', con, verdict?.source || null],
    // The fallbacks, used only when one of the four above is missing from the page.
    ['flight', flight, practical.flightsHe],
    ['pro', pro, verdict?.source || null],
  ].filter(Boolean);

  const out = [];
  const said = new Set();
  for (const [id, text, quote] of candidates) {
    if (out.length >= max) break;
    if (!fits(text) || said.has(text)) continue;
    said.add(text);
    out.push({ id, kickerHe: KICKERS[id], factHe: line(text, { where: `before.${id}`, quote }) });
  }

  // The drawback goes last whatever order it was found in; see ORDER IS RETENTION.
  const i = out.findIndex((b) => b.id === 'con');
  if (i >= 0 && i !== out.length - 1) out.push(...out.splice(i, 1));
  return out;
}

/**
 * The timeline: the hook shot, one shot per beat, and the cards over them.
 *
 * The same shape retentionPlan returns, so buildHiddenGemsClip encodes it without
 * knowing which format made it. Different in one way that matters: the holds are
 * solved per beat from how long each fact takes to read, rather than shared out evenly
 * across a target length, because a place name and a sentence are not read at the
 * same speed and a fact nobody can finish is the same defect as no fact.
 *
 * The first beat is held longer by the time the hook spends shrinking, the same bonus
 * the gems reel gives its first label: the fact is withheld until the hook is a header,
 * so there are never two full-size messages on screen.
 */
export function beforePlan({ beats = [], shots = [], hookHe = '', openLoopHe = null, askHe = null, cfg = null } = {}) {
  const r = (cfg || postConfig().gems).retention;
  const round = (x) => Math.round(x * 10) / 10;
  const hook = r.firstCutSeconds;
  const hookFull = r.hookFullSeconds;

  const holdsFor = (list) =>
    list.map((b, i) => {
      let h = readSeconds(b.factHe);
      if (i === 0) h += Math.max(0, hookFull - hook);
      if (i === list.length - 1 && askHe) h += ASK_SECONDS;
      return round(h);
    });
  const total = (hs) => round(hook + hs.reduce((s, h) => s + h, 0));

  let kept = beats.slice(0, Math.min(beats.length, shots.length));
  let holds = holdsFor(kept);
  // Too long: the beat before the last one goes, which keeps the number that opens and
  // the drawback that closes. Never below three, because the counter is the format.
  while (kept.length > 3 && total(holds) > MAX_SECONDS) {
    kept = [...kept.slice(0, -2), kept[kept.length - 1]];
    holds = holdsFor(kept);
  }
  const n = kept.length;

  const at = [];
  let clock = hook;
  for (const h of holds) {
    at.push(round(clock));
    clock += h;
  }
  const seconds = round(clock);

  const cards = [{ id: 'hook', from: 0, to: round(Math.min(hookFull, seconds)), hookHe, openLoopHe, big: true }];
  for (const [i, h] of holds.entries()) {
    const from = Math.max(at[i], hookFull);
    const last = i === holds.length - 1;
    cards.push({
      id: `beat${i + 1}`,
      from: round(from),
      to: round(at[i] + h),
      headerHe: hookHe,
      counterHe: `${i + 1}/${holds.length}`,
      kickerHe: kept[i].kickerHe,
      factHe: kept[i].factHe,
      questionHe: last ? askHe : null,
      big: false,
    });
  }

  return {
    hookSeconds: hook,
    holds,
    at,
    seconds,
    dropped: beats.length - n,
    // labelHe is what the encoder's filter asks every shot for. The card above is what
    // is drawn; the label is never rendered on this format.
    shots: shots.slice(0, n).map((s, i) => ({ ...s, labelHe: kept[i].factHe })),
    beats: kept,
    cards,
    firstCutAt: hook,
    hookFullUntil: round(Math.min(hookFull, seconds)),
    counted: true,
    hasQuestion: Boolean(askHe),
    hasOpenLoop: Boolean(openLoopHe),
  };
}

// The six site countries the flags table does not hold, keyed the same way.
const EXTRA_ISO = { בריטניה: 'GB', 'ארה״ב': 'US', סיישל: 'SC', 'צפון מקדוניה': 'MK', סינגפור: 'SG', 'דרום קוריאה': 'KR' };
const ISO_BY_HE = new Map([...Object.entries(COUNTRIES).map(([iso, he]) => [he, iso]), ...Object.entries(EXTRA_ISO)]);

// Every English country name ICU knows, plus the ones a model writes that ICU does not.
let isoByEn = null;
const ALIASES = {
  'czech republic': 'CZ', usa: 'US', 'united states of america': 'US', us: 'US', uk: 'GB', england: 'GB',
  scotland: 'GB', britain: 'GB', 'great britain': 'GB', uae: 'AE', 'south korea': 'KR', korea: 'KR',
  turkey: 'TR', 'the netherlands': 'NL', holland: 'NL',
};

/** The ISO code for a country the vision judge named in English, or null. */
export function isoForEnglish(name) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return null;
  if (!isoByEn) {
    isoByEn = new Map();
    const names = new Intl.DisplayNames(['en'], { type: 'region' });
    for (let a = 65; a <= 90; a++) {
      for (let b = 65; b <= 90; b++) {
        const iso = String.fromCharCode(a, b);
        try {
          const en = names.of(iso);
          // First code wins. ICU also names a few reserved codes, and "UK" comes after
          // "GB" and would otherwise claim "united kingdom" for a code no table holds.
          if (en && en !== iso && !isoByEn.has(en.toLowerCase())) isoByEn.set(en.toLowerCase(), iso);
        } catch {
          // Not a region code. Most of the 676 are not.
        }
      }
    }
  }
  return ALIASES[key] || isoByEn.get(key) || null;
}

/** The ISO code for a destination's Hebrew country, or null. */
export const isoForHebrew = (he) => ISO_BY_HE.get(String(he || '').trim()) || null;

/**
 * What to search the stock library for: the page's own English name, the catalogue's,
 * and the landmark the page leads with.
 *
 * The landmark is there because a clip of the Colosseum is a clip of Rome that no judge
 * can mistake.
 *
 * ONLY THE PLACE THE HOOK NAMES. Some pages cover two: "Santorini & Mykonos (Cyclades)".
 * The first build searched both and the landmark too, which on that page is the
 * windmills of Mykonos, so a reel opening "טסים לסנטוריני?" ran on Mykonos beaches. The
 * judge confirms the COUNTRY, and both islands are in Greece, so nothing caught it. A
 * page that names more than one place is searched by the first name alone, and its
 * landmark is left out, because the landmark may be the other place's.
 */
/** Whether a page covers more than one place: "Santorini & Mykonos", "Kyoto & Kansai". */
export const coversSeveral = (city) => /&|\band\b/i.test(String(city?.nameLocal || ''));

export function footageQueries(city, dest) {
  const parts = String(city?.nameLocal || '')
    .split(/\s*(?:&|\/|\(|\)|,|\band\b)\s*/i)
    .map((s) => s.replace(/^the\s+/i, '').trim())
    .filter((s) => /^[A-Za-z][A-Za-z .'-]{2,}$/.test(s));
  const several = coversSeveral(city);
  const landmark = String(city?.iconicLandmark?.nameLocal || '').trim();
  return [
    ...new Set([parts[0], several ? null : dest?.en, !several && /^[A-Za-z]/.test(landmark) ? landmark : null].filter(Boolean)),
  ];
}

/**
 * Clips of this destination and nowhere else, best first.
 *
 * THE COUNTRY IS THE GATE. The search names the place and the judge confirms the frame
 * is consistent with it, which is the question the judge is good at; a clip it places
 * in another country is the library being wrong, and a reel about Rome with a shot of
 * Lisbon on its cost beat is worse than no reel.
 */
export async function findBeforeFootage(city, dest, { seen = new Set(), want = 5, find = findClips } = {}) {
  const iso = isoForHebrew(dest?.country);
  const queries = footageQueries(city, dest);
  if (!queries.length) return { clips: [], queries, why: 'nothing to search for' };
  const found = await find({ limit: Math.max(want + 3, 8), seen, judge: true, queries });
  const here = (found.clips || []).filter((c) => iso && isoForEnglish(c.vision?.place) === iso);
  const elsewhere = (found.clips || []).length - here.length;
  return {
    clips: here.slice(0, want),
    queries,
    elsewhere,
    nowhere: found.nowhere || [],
    why: here.length ? null : `no clip placed in ${dest?.country || 'the country'} (${(found.clips || []).length} judged elsewhere or unplaced)`,
  };
}

/** The hook, and the second line that counts the beats. The Santorini hook leads. */
export function beforeHook(destHe, n, { rand = Math.random } = {}) {
  const shapes = [
    // The proven one, word for word, carries most of the weight. The second exists so
    // the opening is not one template forever, and it is light because it is untested.
    { id: 'book', weight: 0.8, hookHe: `לפני שאתם מזמינים ל${destHe}`, loopHe: `${n} דברים ששווה לדעת` },
    { id: 'flying', weight: 0.2, hookHe: `טסים ל${destHe}?`, loopHe: `${n} דברים לדעת לפני שמזמינים` },
  ];
  let x = rand();
  for (const s of shapes) {
    x -= s.weight;
    if (x <= 0) return s;
  }
  return shapes[0];
}

/** The on-screen ask on the last beat. A save, because this reel is a tool. */
export const ASK_HE = 'שמרו לפני שמזמינים 🔖';

/**
 * One "before you book" reel for one destination, as an approvable candidate.
 *
 * The same shape every other clip returns, so the Telegram album, the TikTok inbox
 * and the Instagram hand-off all take it without a change.
 */
export async function buildBeforeCandidate(dest, { outDir = clipOutputDir(), seen = new Set(), rand = Math.random } = {}) {
  const slug = dest?.siteSlug || null;
  const city = slug ? await loadCity(slug) : null;
  if (!city) throw new Error(`no page for ${dest?.he || slug || 'this destination'} - this reel is built from one`);

  const beats = beforeBeats(city, { destHe: dest.he });
  if (beats.length < 3) {
    throw new Error(`the page for ${dest.he} gives ${beats.length} usable fact(s) and this reel needs 3`);
  }

  const footage = await findBeforeFootage(city, dest, { seen, want: beats.length + 1 });
  // One clip for the hook and one per beat. Reusing a clip would put the same window on
  // two consecutive shots, which reads as a cut that did not happen.
  if (footage.clips.length < 4) {
    throw new Error(
      `only ${footage.clips.length} clip(s) of ${dest.he} cleared the judge (searched: ${footage.queries.join(', ')}), and this reel needs 4` +
        (footage.why ? ` - ${footage.why}` : '')
    );
  }
  const [hookClip, ...beatClips] = footage.clips;

  // THE COUNT FIRST, THEN THE HOOK THAT STATES IT. The second line promises a number of
  // beats, and the timeline may drop one to stay inside the length, so the hook is
  // written for the count that survived. The plan is pure and cheap; sizing it twice
  // costs nothing and cannot disagree with itself.
  const sizing = beforePlan({ beats, shots: beatClips, askHe: ASK_HE });
  const shape = beforeHook(dest.he, sizing.beats.length, { rand });
  const plan = beforePlan({ beats: sizing.beats, shots: sizing.shots, hookHe: shape.hookHe, openLoopHe: shape.loopHe, askHe: ASK_HE });

  const shots = plan.shots;
  const id = `bf${Math.abs([slug, ...shots.map((s) => s.id)].join('|').split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7)).toString(16).slice(0, 10)}`;
  const built = await buildHiddenGemsClip(shots, {
    hookHe: shape.hookHe,
    openLoopHe: shape.loopHe,
    questionHe: ASK_HE,
    plan,
    hookClip,
    id,
    outDir,
  });

  const follow = captionFollow({ rand });
  const cand = {
    kind: 'clip',
    id,
    hook: `${shape.hookHe} · ${shape.loopHe}`,
    hookLine: shape.hookHe,
    headline: `${shape.hookHe} · ${shape.loopHe}`,
    hookWritten: false,
    hookNote: `before you book: ${shape.id}, ${plan.beats.map((b) => b.id).join('/')}`,
    sourceName: `tiyulplus.com · ${dest.he} · Pexels ${[...new Set(footage.clips.map((c) => c.credit).filter(Boolean))].join(', ')}`,
    sourceUrl: city.url,
    pillar: 'day',
    tags: [],
    createdAt: new Date().toISOString(),
    publishTargets: targetsForKind('clip'),
    tiktokDraft: true,
    overrides: [],
    notes: [],
    place: dest.he,
    siteSlug: slug,
    clip: {
      shape: 'before',
      format: 'before_video',
      hookLine: shape.hookHe,
      hookTemplate: shape.id,
      file: built.file,
      audio: built.audio,
      track: built.track,
      seconds: built.seconds,
      holds: built.holds,
      firstCutAt: built.firstCutAt,
      hookFullUntil: built.hookFullUntil,
      counter: built.counter,
      looped: built.looped,
      loopDistance: built.loopDistance,
      openLoop: shape.loopHe,
      questionHe: ASK_HE,
      beats: plan.beats,
      places: [dest.he],
      follow,
      followAt: null,
      width: postConfig().clips.video.width,
      height: postConfig().clips.video.height,
      queries: footage.queries,
      pexelsIds: [...new Set(footage.clips.slice(0, plan.shots.length + 1).map((c) => String(c.id)))],
    },
  };

  const caption = assertNoUrl(beforeCaption({ dest, siteSlug: slug, follow }, { rand }), 'the before-you-book description');
  cand.caption = caption;
  cand.tiktokCaption = caption;
  cand.instagramCaption = caption;
  cand.channelCaption = caption;
  return cand;
}

/** The approval card: the hook, every beat with where it came from, the timing, the sound. */
export function beforeApprovalMessage(cand) {
  const c = cand.clip;
  const lines = [
    `🧳 לפני שמזמינים · ${cand.place} · ${c.seconds} שניות · ${c.beats.length} עובדות${c.looped ? ` · לופ ${c.looped}` : ''}`,
    '',
    c.hookLine,
    `   ↳ ${c.openLoop}`,
    '',
    ...c.beats.map((b, i) => `${i + 1}/${c.beats.length} ${b.kickerHe}: ${b.factHe}`),
    '',
    `⏱️ חיתוך ראשון ${c.firstCutAt}ש׳ · פתיח גדול עד ${c.hookFullUntil}ש׳ ואז כותרת`,
    `🔖 בסוף: ${c.questionHe}`,
    `📄 העובדות מהעמוד: ${cand.sourceUrl}`,
  ];
  if (!c.audio) lines.push('', silentSoundLine(cand.publishTargets || []));
  return lines.join('\n');
}
