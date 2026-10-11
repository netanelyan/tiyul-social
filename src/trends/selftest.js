import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyTrends, openTrends } from './store.js';
import { checkPromise, DELIVERS, extractCard, setClient, sourceLeak } from './extract.js';
import { DROPPED, mapCard } from './formats.js';
import { findWinners, youtubeId } from './find.js';
import { credit, ensureOwnFormats, formatOf, formatPicker, judge, pickFormat, postScore } from './mix.js';
import { describeRun, promoteCardsToTrials, recheckCards, runWatcher, watcherDue } from './run.js';
import { weeklyTrendsReport } from './report.js';
import { buildSlateDecks } from '../slate/build.js';
import { recentFormatPicks } from '../slate/runner.js';
import { buildKnowPost, knowFacts, KNOW_MIN } from '../posts/know.js';
import { buildBudgetPost, checkedHe, hasSplitCost } from '../posts/budget.js';
import { summaryTitle } from '../posts/plan.js';

// The trend watcher's tests, run from scripts/selftest.run.js like the growth
// desk's. Every outside call is a stand-in: no network, no model, no spend.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-10-11T07:00:00Z'); // Sunday 10:00 in Israel

export async function trendsSelftest({ ok, eq }) {
  /* ---- extraction never carries the source's words or picture ---- */
  const src = { title: 'Ten things to know before visiting Prague in 2026', description: 'My honest Prague guide, watch till the end' };
  const clean = { hookShapeHe: '{n} דברים שכדאי לדעת לפני {dest}', slideStructure: 'שער, דבר אחד בכל שקף, סיכום', captionStyle: 'שאלה קצרה ובקשה לשמור', why: 'הבטחה ברורה ומספר' };
  ok('a card in its own words passes the leak check', sourceLeak(clean, src) === null);
  ok('three words of the title in any field is refused', /repeats the source/.test(sourceLeak({ ...clean, why: 'things to know before visiting' }, src) || ''));
  ok('a number from the source in the hook is refused', /number/.test(sourceLeak({ ...clean, hookShapeHe: '10 דברים לפני {dest}' }, src) || ''));
  ok('a Latin word in the hook (a name) is refused', /Latin/.test(sourceLeak({ ...clean, hookShapeHe: '{n} דברים לפני Prague {dest}' }, src) || ''));
  ok('a hook with no {dest} is refused', /\{dest\}/.test(sourceLeak({ ...clean, hookShapeHe: '{n} דברים שכדאי לדעת' }, src) || ''));

  const fakeModel = (out) => {
    const calls = [];
    setClient({ messages: { create: async (req) => (calls.push(req), { usage: { input_tokens: 1200, output_tokens: 200 }, content: [{ type: 'text', text: JSON.stringify(out) }] }) } });
    return calls;
  };
  const item = { platform: 'youtube', url: 'https://www.youtube.com/shorts/abc', title: src.title, description: src.description, thumb: 'https://i.ytimg.com/vi/abc/hq.jpg', lang: 'en', signal: 'strong', views: 250_000, likes: 9_000, comments: 300, channelTitle: 'Some Creator' };
  const bytes = Buffer.from('fake-jpeg-bytes-that-must-never-be-stored');
  const deps = { getBytes: async () => ({ buf: bytes, type: 'image/jpeg' }) };
  const state = emptyTrends();
  const settings = { budgetUsd: 3, braveCreditUsd: 0 };
  const calls = fakeModel({ isTravelFormat: true, hookShapeHe: clean.hookShapeHe, topicType: 'know_before', look: 'native_text', slideStructure: clean.slideStructure, captionStyle: clean.captionStyle, why: clean.why });
  const got = await extractCard(item, { state, settings, now: NOW, deps });
  ok('the model is shown the image once, as bytes in the request', calls.length === 1 && calls[0].messages[0].content.some((b) => b.type === 'image'));
  eq('the card keeps exactly the abstract fields and the source pointer', Object.keys(got.card).sort().join(','), 'captionStyle,hookShapeHe,look,slideStructure,source,topicType,why');
  eq('the source keeps its link and numbers and nothing else', Object.keys(got.card.source).sort().join(','), 'comments,lang,likes,platform,publishedAt,signal,url,views');
  const stored = JSON.stringify(got.card);
  ok('no image bytes, no title, no description, no creator name in the card', !stored.includes(bytes.toString('base64')) && !stored.includes('Prague') && !stored.includes('honest') && !stored.includes('Some Creator') && !/thumb|image|title|description/i.test(Object.keys(got.card).join(' ')));
  ok('the vision call is charged to the watcher\'s own ledger', Object.values(state.spend)[0]?.claude?.usd > 0);

  fakeModel({ isTravelFormat: true, hookShapeHe: 'things to know before visiting {dest}', topicType: 'know_before', look: 'native_text', slideStructure: 'x', captionStyle: 'y', why: 'z' });
  const leaked = await extractCard(item, { state, settings, now: NOW, deps });
  ok('a model answer that copies the title is refused, not kept', Boolean(leaked.rejected) && !leaked.card);
  fakeModel({ isTravelFormat: false, hookShapeHe: '', topicType: 'other', look: 'other', slideStructure: '', captionStyle: '', why: 'a vlog' });
  ok('a post that is not a reusable travel format is refused', Boolean((await extractCard(item, { state, settings, now: NOW, deps })).rejected));

  const promiseCalls = fakeModel({ delivers: false, why: 'השער מבטיח טיול עם סבים, והשקפים לא עוסקים בזה' });
  const verdictHook = { type: 'verdict', hook: { id: 'trend-x', he: 'האם כדאי לטייל עם סבתא וסבא ל{dest}?' } };
  const second = await checkPromise(verdictHook, { state, settings, now: NOW });
  ok('the second look answers whether the cover over-promises', second.delivers === false && /סבים/.test(second.why));
  const asked = promiseCalls[0]?.messages?.[0]?.content || '';
  ok('it is shown the hook, a filled example for the grammar, and what the builder delivers, and nothing of the source', asked.includes(verdictHook.hook.he) && asked.includes('האם כדאי לטייל עם סבתא וסבא לפראג?') && asked.includes(DELIVERS.verdict) && !asked.includes(src.title));

  /* ---- a format is filled from our data, or dropped with the reason ---- */
  const card = (topicType, hookShapeHe) => ({ id: 'c1', topicType, hookShapeHe });
  eq('versus becomes a verdict post', mapCard(card('versus', '{dest}: שווה או לא שווה?')).type, 'verdict');
  eq('itinerary becomes a plan, and its count is days', mapCard(card('itinerary', '{n} ימים ב{dest}')).hook?.he, '{days} ימים ב{dest}');
  eq('know_before becomes the know listicle', mapCard(card('know_before', '{n} דברים שכדאי לדעת לפני {dest}')).type, 'know');
  eq('a hidden-gems format is dropped, and says why', mapCard(card('hidden_gems', '{n} מקומות סודיים ב{dest}')).dropped, DROPPED.hidden_gems);
  eq('a mistakes format is dropped, and says why', mapCard(card('mistakes', '{n} טעויות ב{dest}')).dropped, DROPPED.mistakes);
  ok('a budget shape with a count is dropped: nothing fills {n} on a budget post', /\{n\}/.test(mapCard(card('budget', '{n} דרכים לחסוך ב{dest}')).dropped || ''));
  ok('a shape without {dest} is dropped', /\{dest\}/.test(mapCard(card('places_list', '{n} מקומות שחייבים')).dropped || ''));
  // The three the first real run (10 Oct 2026) filed under a builder whose slides
  // would not keep the cover's promise.
  ok('a "behind the scenes" cover filed as know_before is dropped: five facts would not deliver it', /לא מבטיח/.test(mapCard(card('know_before', 'מה קורה מאחורי הקלעים כש{dest} סוגר את המסלול בגלל מזג אוויר?')).dropped || ''));
  ok('"day {n} in X" is one day, and a plan post is several: dropped', /לא מבטיח/.test(mapCard(card('itinerary', 'יום {n} ב{dest}')).dropped || ''));
  ok('"how much to fly to X" is not the cost of a day: dropped', /לא מבטיח/.test(mapCard(card('budget', 'כמה כסף צריך בשביל לטוס ל{dest}?')).dropped || ''));
  ok('"this season" is a claim no page backs: dropped', /לזמן/.test(mapCard(card('places_list', '{n} מקומות שחובה לבקר ב{dest} בעונה הזו')).dropped || ''));
  ok('"new things to know" is a claim no page backs: dropped', /לזמן/.test(mapCard(card('know_before', '{n} דברים חדשים שחייבים לדעת לפני כניסה ל{dest}')).dropped || ''));
  ok('a food cover filed as itinerary is dropped', /לא מבטיח/.test(mapCard(card('itinerary', 'תטעמו את האוכל המקומי ב{dest}')).dropped || ''));
  ok('a first-person shape is dropped by the voice rules', /קול|voice/i.test(mapCard(card('places_list', 'הייתי ב{dest} וגיליתי {n} מקומות')).dropped || ''));

  /* ---- the know and budget builders, from the page alone ---- */
  const city = {
    name: 'פראג',
    slug: 'prague',
    practical: { flights: 'טיסה ישירה מתל אביב נמשכת כשלוש שעות וחצי.', gettingAround: 'המטרו והחשמליות מכסים את רוב העיר.' },
    bestSeason: 'אפריל עד יוני, ספטמבר עד אוקטובר',
    itinerary: [{ notes: 'כרטיסים לטירה כדאי להזמין מראש באתר הרשמי. ברובע היהודי יש כרטיס משולב לכל בתי הכנסת.' }],
    dailyCost: { currency: 'CZK', mid: { transport: 120, food: 650, activities: 450 }, budget: { transport: 80, food: 350 }, comfort: { food: 1200, activities: 900 }, source: { checked: '2026-07-29', name: 'example.org' } },
    places: [{ name: 'גשר קארל', priceLevel: 0 }, { name: 'כיכר העיר העתיקה', priceLevel: 0 }, { name: 'טירת פראג', priceLevel: 2 }],
  };
  const facts = knowFacts(city);
  ok(`the know post finds at least ${KNOW_MIN} of the page's own facts`, facts.length >= KNOW_MIN && facts.some((f) => f.label === 'כמה עולה יום'));
  // The page's flight paragraph is not among them until the flight data is verified
  // (FLIGHTS_VERIFIED in src/posts/source.js).
  ok('and the flight is not one of them', !facts.some((f) => f.label === 'הטיסה'));
  const know = buildKnowPost(city, { hook: { id: 'h', he: '{n} דברים שכדאי לדעת לפני {dest}' }, dest: { he: 'פראג' } });
  eq('its cover counts exactly the facts it carries', know.slides[0].titleHe, `${facts.length} דברים שכדאי לדעת לפני פראג`);
  let thin = null;
  try {
    buildKnowPost({ name: 'x', practical: { flights: 'טיסה ישירה.' } }, { hook: { id: 'h', he: '{n} דברים לפני {dest}' }, dest: { he: 'x' } });
  } catch (e) {
    thin = e;
  }
  ok('a page too thin for the promise throws rather than padding the count', /needs 4/.test(thin?.message || ''));
  eq('the checked date prints Israeli style', checkedHe('2026-07-29'), '29.7.2026');
  ok('a daily cost without a checked date cannot carry a budget post', !hasSplitCost({ dailyCost: { ...city.dailyCost, source: {} } }) && hasSplitCost(city));
  const budget = buildBudgetPost(city, { hook: { id: 'h', he: 'כמה עולה יום ב{dest}?' }, dest: { he: 'פראג' } });
  ok('the budget cover carries the date the figures were checked', budget.slides[0].noteHe.includes('29.7.2026'));
  ok('and no domain or URL anywhere on its slides', !JSON.stringify(budget.slides).includes('example.org'));
  ok('the mid tier is the page\'s own parts, summed', budget.slides[1].lines.some((l) => l.text.includes('1,220')));

  // The plan format the first build found: its cover was the summary slide's own
  // title, and the echo guard refused the post.
  eq('a plan whose cover is "N ימים ב..." closes on "לסיכום" instead of saying it twice', summaryTitle(3, 'פאפוס', '3 ימים בפאפוס'), 'לסיכום');
  eq('any other cover keeps the summary title as it was', summaryTitle(3, 'פאפוס', 'מסלול לפאפוס'), '3 ימים בפאפוס');

  /* ---- scoring: never a TikTok save ---- */
  eq('TikTok scores (shares + likes) per view', postScore('tiktok', { views: 1000, likes: 50, shares: 10 }), 0.06);
  eq('a "saved" field on TikTok numbers is ignored, never counted', postScore('tiktok', { views: 1000, likes: 50, shares: 10, saved: 500 }), 0.06);
  eq('Instagram scores (saves + shares) per view', postScore('instagram', { views: 1000, saved: 30, shares: 10, likes: 400 }), 0.04);
  ok('no views is no score, not zero', postScore('tiktok', { views: 0, likes: 3 }) === null);
  eq('a trend post is credited to its format, an ordinary one to its type', [formatOf({ trendFormat: 'trend:x', type: 'list' }), formatOf({ type: 'list' })].join(' '), 'trend:x type:list');
  ok('a deck or a clip is never credited to a post type of the same name', formatOf({ kind: 'deck', type: 'list' }) === null && formatOf({ kind: 'clip', type: 'postcard' }) === null && formatOf({ kind: 'post', type: 'list' }) === 'type:list');

  const types = [{ id: 'verdict', weight: 60 }, { id: 'plan', weight: 4 }, { id: 'list', weight: 3 }, { id: 'know', weight: 0 }];
  const t1 = ensureOwnFormats(emptyTrends(), types);
  ok('our own types with weight start as proven formats; weight 0 does not', t1.formats['type:verdict']?.kind === 'proven' && !t1.formats['type:know']);
  const seededT = ensureOwnFormats(emptyTrends(), types, { seedTrials: ['know'] });
  ok('a weight-0 type named in seedTrials starts as a trial, to earn its place', seededT.formats['type:know']?.kind === 'trial' && seededT.formats['type:know'].own);
  const row = (id, at, stats, shape = { type: 'list' }) => ({ id, at: new Date(at).toISOString(), shape, stats });
  const young = row('p1', NOW - 70 * HOUR, { tiktok: { views: 100, likes: 5, shares: 1 } });
  eq('a post under 72 hours old is not scored yet', credit(t1, [young], { now: NOW }), 0);
  const old = row('p2', NOW - 73 * HOUR, { tiktok: { views: 100, likes: 5, shares: 1 }, instagram: { views: 200, saved: 4, shares: 2 } });
  eq('at 72 hours both platforms are scored', credit(t1, [old], { now: NOW }), 2);
  eq('and never twice', credit(t1, [old], { now: NOW + DAY }), 0);

  /* ---- drop after 3 losses, promote a winner ---- */
  const tj = emptyTrends();
  const fmt = (id, kind, results) => (tj.formats[id] = { id, kind, type: 'list', weight: 1, status: 'active', results });
  const r = (score, h) => ({ post: `p${h}`, platform: 'tiktok', score, at: new Date(NOW - h * HOUR).toISOString() });
  fmt('type:a', 'proven', [r(0.05, 90), r(0.05, 80), r(0.05, 70)]);
  fmt('type:b', 'proven', [r(0.05, 91), r(0.05, 81), r(0.05, 71)]);
  fmt('type:c', 'proven', [r(0.05, 92), r(0.05, 82), r(0.05, 72)]);
  fmt('trend:loser', 'trial', [r(0.01, 60), r(0.01, 50), r(0.01, 40)]);
  fmt('trend:mixed', 'trial', [r(0.01, 61), r(0.01, 51), r(0.09, 41)]);
  fmt('trend:winner', 'trial', [r(0.09, 62), r(0.08, 52), r(0.07, 42)]);
  const changes = judge(tj, { now: NOW, dropAfter: 3, minPosts: 3 });
  ok('three losses in a row drop a format, with the reason kept', tj.formats['trend:loser'].status === 'dropped' && /3 פעמים ברצף מתחת ל-70% מהחציון/.test(tj.formats['trend:loser'].droppedWhy));
  const near = emptyTrends();
  near.formats['type:m'] = { id: 'type:m', kind: 'proven', type: 'list', status: 'active', results: [r(0.05, 95), r(0.05, 85), r(0.05, 75)] };
  near.formats['type:n'] = { id: 'type:n', kind: 'proven', type: 'plan', status: 'active', results: [r(0.05, 96), r(0.05, 86), r(0.05, 76)] };
  near.formats['trend:near'] = { id: 'trend:near', kind: 'trial', type: 'know', status: 'active', results: [r(0.04, 60), r(0.04, 50), r(0.04, 40)] };
  judge(near, { now: NOW });
  ok('a little under the median is not a loss: 0.8 of it three times stays', near.formats['trend:near'].status === 'active');
  const rest = emptyTrends();
  rest.formats['type:roll'] = { id: 'type:roll', kind: 'proven', own: true, type: 'roll', status: 'dropped', droppedAt: new Date(NOW - 15 * DAY).toISOString(), results: [r(0.01, 400)] };
  rest.formats['trend:old'] = { id: 'trend:old', kind: 'trial', type: 'list', status: 'dropped', droppedAt: new Date(NOW - 60 * DAY).toISOString(), results: [] };
  const back = judge(rest, { now: NOW, restDays: 14 });
  ok('our own dropped type comes back as a trial with a clean record after its rest', rest.formats['type:roll'].status === 'active' && rest.formats['type:roll'].kind === 'trial' && !rest.formats['type:roll'].results.length && back.some((c) => c.change === 'returned'));
  ok('a found format stays dropped', rest.formats['trend:old'].status === 'dropped');
  ok('two losses and a win do not', tj.formats['trend:mixed'].status === 'active');
  ok('a trial at or above the median after 3 posts becomes proven', tj.formats['trend:winner'].kind === 'proven' && changes.some((c) => c.id === 'trend:winner' && c.change === 'promoted'));
  const tk = emptyTrends();
  tk.formats['type:x'] = { id: 'type:x', kind: 'proven', type: 'list', status: 'active', results: [r(0.01, 90), r(0.01, 80), r(0.01, 70)] };
  tk.formats['type:y'] = { id: 'type:y', kind: 'proven', type: 'plan', status: 'active', results: [r(0.09, 91), r(0.09, 81), r(0.09, 71)] };
  judge(tk, { now: NOW, keepProven: 2 });
  ok('the last two proven formats stay, whatever their run, so the slate can still build', tk.formats['type:x'].status === 'active');
  ok('a dropped format is never picked again', ![...Array(50)].some(() => pickFormat(tj, { recent: [], rand: Math.random, now: NOW })?.formatId === 'trend:loser'));

  /* ---- the 70/30 mix ---- */
  const tm = emptyTrends();
  for (const [id, type, w] of [['type:verdict', 'verdict', 60], ['type:plan', 'plan', 4], ['type:list', 'list', 3]]) tm.formats[id] = { id, kind: 'proven', own: true, type, weight: w, status: 'active', results: [] };
  for (const [id, type] of [['trend:t1', 'know'], ['trend:t2', 'budget']]) tm.formats[id] = { id, kind: 'trial', type, hook: { id, he: 'x {dest}' }, weight: 1, status: 'active', results: [] };
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pick = formatPicker(tm, { provenShare: 0.7, rand, now: NOW, keep: 1000 });
  const picks = [];
  let prev = null;
  for (let i = 0; i < 100; i++) {
    const p = pick(prev);
    picks.push(p);
    prev = p.type;
  }
  const trialShare = picks.filter((p) => p.kind === 'trial').length / picks.length;
  ok(`100 slots: ${Math.round(trialShare * 100)}% go to new formats, about 30`, trialShare >= 0.28 && trialShare <= 0.32);
  ok('both trials get slots', picks.some((p) => p.formatId === 'trend:t1') && picks.some((p) => p.formatId === 'trend:t2'));
  ok('no two neighbouring slots share a type when another is available', picks.every((p, i) => i === 0 || p.type !== picks[i - 1].type));
  ok('a trial carries its own opening shape to the builder', picks.find((p) => p.kind === 'trial')?.hook?.he === 'x {dest}');
  const noTrials = emptyTrends();
  noTrials.formats['type:plan'] = tm.formats['type:plan'];
  ok('with no trials every slot is proven', [...Array(10)].every(() => pickFormat(noTrials, { now: NOW }).kind === 'proven'));
  ok('with no formats at all the ordinary rotation decides', formatPicker(emptyTrends(), { fallback: () => 'plan' })() === 'plan');
  eq('earlier slates count toward the split, oldest first', recentFormatPicks([{ date: '2026-10-09', items: [{ formatKind: 'trial', formatId: 'trend:a' }, { formatKind: 'proven', formatId: 'type:plan' }] }, { date: '2026-10-01', items: [{ formatKind: 'proven', formatId: 'type:list' }] }, { date: '2026-09-01', items: [{ formatKind: 'trial', formatId: 'trend:b' }] }], '2026-10-10').map((p) => p.formatId).join(','), 'type:list,trend:a,type:plan');
  const turns = emptyTrends();
  turns.formats['type:plan'] = { id: 'type:plan', kind: 'proven', type: 'plan', weight: 1, status: 'active', results: [] };
  for (const id of ['trend:a', 'trend:b']) turns.formats[id] = { id, kind: 'trial', type: 'list', hook: null, weight: 1, status: 'active', results: [] };
  eq('trials take turns: the one offered least lately goes next', pickFormat(turns, { recent: [{ kind: 'trial', formatId: 'trend:a' }, ...Array(9).fill({ kind: 'proven', formatId: 'type:plan' })] }).formatId, 'trend:b');

  const built = await buildSlateDecks({
    count: 2,
    pickType: (() => {
      const q = [{ type: 'know', hook: { id: 'trend-1', he: '{n} דברים לפני {dest}' }, formatId: 'trend:1', kind: 'trial' }, 'plan'];
      return () => q.shift();
    })(),
    pickDest: (type, avoid) => [{ he: 'פראג' }, { he: 'רומא' }].find((d) => !avoid.includes(d.he)) || null,
    buildOne: async (dest, type, format) => ({ id: `${type}-${dest.he}`, headline: `${type} ${dest.he}`, deck: { type, look: 'label', where: dest.he }, hookSeen: format?.hook?.he || null }),
  });
  ok('the slate hands a format pick to the builder and records it on the deck', built.decks[0].cand.hookSeen === '{n} דברים לפני {dest}' && built.decks[0].formatKind === 'trial' && built.decks[1].formatKind === null);

  /* ---- the run: find, look once, keep the format ---- */
  const env = { YOUTUBE_API_KEY: 'k', BRAVE_API_KEY: 'b' };
  const ttId = (BigInt(Math.floor((NOW - 5 * DAY) / 1000)) << 32n).toString();
  const oldTtId = (BigInt(Math.floor((NOW - 400 * DAY) / 1000)) << 32n).toString();
  const cfg = { queries: { he: ['טיפים'], en: ['tips'] }, tiktokQueries: ['טיפים'], minViews: { he: 1000, en: 20000 }, windowDays: 30, perRun: 10, maxTrials: 1, budgetUsd: 3 };
  const findDeps = {
    searchTop: async (q, { lang }) =>
      lang === 'he'
        ? [{ id: 'he1', url: 'https://www.youtube.com/shorts/he1', title: 'כמה עולה', thumb: 't1' }, { id: 'he2', url: 'https://www.youtube.com/shorts/he2', title: 'קטן', thumb: 't2' }]
        : [{ id: 'en1', url: 'https://www.youtube.com/shorts/en1', title: 'tips', thumb: 't3' }],
    videoStats: async () => new Map([['he1', { views: 5000, likes: 100, comments: 4 }], ['he2', { views: 300, likes: 1, comments: 0 }], ['en1', { views: 90000, likes: 3000, comments: 50 }]]),
    brave: async () => [{ url: `https://www.tiktok.com/@someone/photo/${ttId}` }, { url: `https://www.tiktok.com/@old/photo/${oldTtId}` }],
    oembed: async () => ({ thumbUrl: 'tt-thumb', title: 'x' }),
  };
  const fs1 = emptyTrends();
  const winners = await findWinners(cfg, { state: fs1, settings, env, now: NOW, deps: findDeps });
  eq('YouTube under the per-language view floor is left out; strong results first, by views', winners.found.map((f) => f.url.split('/').pop()).join(','), `en1,he1,${ttId}`);
  ok('a TikTok post is a weak signal with no numbers, never a made-up one', winners.found.at(-1).signal === 'weak' && winners.found.at(-1).views === null && winners.found.at(-1).likes === null);
  ok('a TikTok post older than the window is dropped by its own id date', !winners.found.some((f) => f.url.includes(oldTtId)));

  // Search's 100 a day ran out on the first real day of runs. The fallback.
  eq('a Shorts or watch URL gives its video id', [youtubeId('https://www.youtube.com/shorts/abcdefghijk'), youtubeId('https://youtube.com/watch?v=ABCDEFGHIJ_'), youtubeId('https://www.youtube.com/@someone')].join(','), 'abcdefghijk,ABCDEFGHIJ_,');
  let searches = 0;
  const quota = Object.assign(new Error('Quota exceeded for quota metric Search Queries'), { status: 403 });
  const fallback = await findWinners({ ...cfg, fallbackWindowDays: 60 }, {
    state: emptyTrends(),
    settings,
    env,
    now: NOW,
    deps: {
      ...findDeps,
      searchTop: async () => {
        searches++;
        throw quota;
      },
      brave: async (q, site) => (site === 'youtube.com' ? [{ url: 'https://www.youtube.com/shorts/aaaaaaaaaaa' }, { url: 'https://www.youtube.com/shorts/bbbbbbbbbbb' }, { url: 'https://www.youtube.com/shorts/ccccccccccc' }] : []),
      // bbbbbbbbbbb is outside the fallback window of 60 days set below.
      videoDetails: async () =>
        new Map([
          ['aaaaaaaaaaa', { id: 'aaaaaaaaaaa', url: 'https://www.youtube.com/shorts/aaaaaaaaaaa', title: 'a', thumb: 'x', publishedAt: new Date(NOW - 3 * DAY).toISOString(), views: 80000 }],
          ['bbbbbbbbbbb', { id: 'bbbbbbbbbbb', url: 'https://www.youtube.com/shorts/bbbbbbbbbbb', title: 'b', thumb: 'x', publishedAt: new Date(NOW - 90 * DAY).toISOString(), views: 900000 }],
          ['ccccccccccc', { id: 'ccccccccccc', url: 'https://www.youtube.com/shorts/ccccccccccc', title: 'c', thumb: 'x', publishedAt: new Date(NOW - 2 * DAY).toISOString(), views: 40000 }],
        ]),
      videoStats: async () => new Map([['aaaaaaaaaaa', { views: 80000, likes: 900, comments: 9 }], ['bbbbbbbbbbb', { views: 900000, likes: 1, comments: 1 }], ['ccccccccccc', { views: 40000, likes: 400, comments: 4 }]]),
    },
  });
  eq('search is not asked again once its quota is out', searches, 1);
  ok('Brave finds the Shorts and YouTube itself gives the numbers: still a strong signal', fallback.found.some((f) => f.url.endsWith('aaaaaaaaaaa') && f.signal === 'strong' && f.views === 80000));
  ok('the fallback window holds, by the upload date YouTube reports', !fallback.found.some((f) => f.url.endsWith('bbbbbbbbbbb')));
  ok('and the upload date travels with the source, so the age of the evidence shows', fallback.found.find((f) => f.url.endsWith('aaaaaaaaaaa'))?.publishedAt === new Date(NOW - 3 * DAY).toISOString());
  ok('the note says why the run went through Brave', fallback.notes.some((n) => /מכסת החיפוש/.test(n)));

  const dir = mkdtempSync(join(tmpdir(), 'trends-'));
  try {
    const store = openTrends(join(dir, 'trends.json'));
    let looked = 0;
    const shapes = { en1: ['know_before', '{n} דברים שכדאי לדעת לפני {dest}'], he1: ['budget', 'כמה עולה יום ב{dest}?'] };
    const runDeps = {
      ...findDeps,
      checkPromise: async () => ({ delivers: true, why: '' }),
      extractCard: async (it) => {
        looked++;
        const key = it.url.split('/').pop();
        if (shapes[key]) return { card: { hookShapeHe: shapes[key][1], topicType: shapes[key][0], look: 'native_text', slideStructure: 's', captionStyle: 'c', why: 'w', source: { platform: it.platform, url: it.url, lang: it.lang, signal: it.signal, views: it.views ?? null, likes: it.likes ?? null, comments: it.comments ?? null } } };
        return { card: { hookShapeHe: '{n} מקומות סודיים ב{dest}', topicType: 'hidden_gems', look: 'native_text', slideStructure: 's', captionStyle: 'c', why: 'w', source: { platform: it.platform, url: it.url, lang: it.lang, signal: it.signal, views: null, likes: null, comments: null } } };
      },
    };
    const run1 = await runWatcher(cfg, { trends: store.data, env, now: NOW, deps: runDeps });
    store.save();
    eq('each new winner is looked at once', looked, 3);
    ok('a format we cannot fill is kept as a card with its reason, never as a format', Object.values(store.data.cards).some((c) => c.dropped === DROPPED.hidden_gems && !c.formatId) && run1.dropped.length === 1);
    eq('trials start up to maxTrials, the strongest source first', run1.trials.join(','), `trend:${Object.values(store.data.cards).find((c) => c.source.url.endsWith('en1')).id}`);
    eq('the rest wait their turn', run1.waiting.length, 1);
    const run2 = await runWatcher(cfg, { trends: store.data, env, now: NOW + DAY, deps: runDeps });
    eq('a second run never pays to look at the same post again', [looked, run2.looked].join(','), '3,0');
    const onDisk = readFileSync(join(dir, 'trends.json'), 'utf8');
    ok('the store on disk holds no image and no source title', !onDisk.includes('tt-thumb') && !onDisk.includes('"title"') && !onDisk.includes('"thumb"'));
    ok('the run reads as Hebrew lines with each card\'s source and its numbers', /90,000 צפיות/.test(describeRun(run1, store.data)) && /אות חלש/.test(describeRun(run1, store.data)));

    store.data.formats[run1.trials[0]].status = 'dropped';
    eq('when a trial ends, the next waiting card takes its place', promoteCardsToTrials(store.data, cfg, NOW).length, 1);

    const strict = emptyTrends();
    const run4 = await runWatcher(cfg, { trends: strict, env, now: NOW, deps: { ...runDeps, checkPromise: async (m) => ({ delivers: m.type !== 'know', why: 'השער מבטיח קהל מסוים' }) } });
    ok('a cover the second look says over-promises is dropped, with its reason', Object.values(strict.cards).some((c) => c.type === undefined && /מבטיח יותר ממה שפוסט know נותן: השער מבטיח קהל מסוים/.test(c.dropped || '')) && run4.trials.length === 1);
    const shaky = emptyTrends();
    await runWatcher(cfg, { trends: shaky, env, now: NOW, deps: { ...runDeps, checkPromise: async () => { throw new Error('timeout'); } } });
    ok('a second look that fails drops the format too: an unchecked promise never enters', Object.values(shaky.formats).filter((f) => f.kind === 'trial').length === 0);

    const re = emptyTrends();
    re.cards.k1 = { id: 'k1', topicType: 'know_before', hookShapeHe: '{n} דברים חדשים שחייבים לדעת לפני {dest}', type: 'know', hook: { id: 'trend-k1', he: '{n} דברים חדשים שחייבים לדעת לפני {dest}' }, formatId: 'trend:k1', source: {} };
    re.cards.k2 = { id: 'k2', topicType: 'places_list', hookShapeHe: '{n} מקומות שחובה לבקר ב{dest}', type: 'list', hook: { id: 'trend-k2', he: '{n} מקומות שחובה לבקר ב{dest}' }, formatId: 'trend:k2', source: {} };
    re.cards.k3 = { id: 'k3', topicType: 'know_before', hookShapeHe: '{n} דברים שחובה לדעת לפני ש{dest}', type: 'know', hook: { id: 'trend-k3', he: '{n} דברים שחובה לדעת לפני ש{dest}' }, formatId: 'trend:k3', source: {} };
    for (const id of ['k1', 'k2', 'k3']) re.formats[`trend:${id}`] = { id: `trend:${id}`, kind: 'trial', type: re.cards[id].type, status: 'active', results: [] };
    const gone = await recheckCards(re, { now: NOW, settings, deps: { checkPromise: async (m) => ({ delivers: !m.hook.he.includes('לפני ש{dest}'), why: 'לא עברית תקינה' }) } });
    ok('a recheck drops kept cards that fail today\'s rules, with their trials, and keeps the rest', gone.length === 2 && re.formats['trend:k1'].status === 'dropped' && re.formats['trend:k3'].status === 'dropped' && re.formats['trend:k2'].status === 'active' && /עברית/.test(re.cards.k3.dropped));

    let budgetStop = 0;
    const broke = emptyTrends();
    broke.spend = { '2026-10': { claude: { units: 1, usd: 3 } } };
    const run3 = await runWatcher(cfg, {
      trends: broke,
      env,
      now: NOW,
      deps: { ...findDeps, extractCard: async () => { budgetStop++; const e = new Error('תקציב החודש נוצל'); e.code = 'budget'; throw e; } },
    });
    ok('the monthly cap stops the run at the first refused call', budgetStop === 1 && run3.notes.some((n) => /תקציב/.test(n)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  /* ---- the watcher's days ---- */
  const days = { days: [0, 3], hour: 9 };
  ok('due on a watcher day after its hour', watcherDue(days, { now: NOW }));
  ok('not before the hour', !watcherDue(days, { now: Date.parse('2026-10-11T05:00:00Z') }));
  ok('not on other days', !watcherDue(days, { now: NOW + DAY }));
  ok('not twice the same day', !watcherDue(days, { now: NOW + 2 * HOUR, lastRunAt: new Date(NOW).toISOString() }));

  /* ---- the weekly report ---- */
  const tr = emptyTrends();
  tr.formats['type:list'] = { id: 'type:list', kind: 'proven', own: true, type: 'list', status: 'active', results: [] };
  tr.formats['trend:z'] = { id: 'trend:z', kind: 'trial', type: 'know', hook: { he: '{n} דברים לפני {dest}' }, from: 'z', status: 'active', results: [] };
  tr.formats['trend:gone'] = { id: 'trend:gone', kind: 'trial', type: 'list', hook: { he: '{n} מקומות ב{dest}' }, status: 'dropped', droppedAt: new Date(NOW - DAY).toISOString(), droppedWhy: '3 פעמים ברצף מתחת ל-70% מהחציון (0.40, 0.30, 0.20)', results: [] };
  tr.cards.z = { source: { platform: 'youtube', views: 90000 } };
  const rows = [
    row('a', NOW - 2 * DAY, { tiktok: { views: 4000, likes: 300, shares: 40 }, instagram: { views: 900, saved: 45, shares: 9 } }, { type: 'list', hookText: 'רומא ב-3 ימים' }),
    row('b', NOW - 3 * DAY, { tiktok: { views: 1000, likes: 20, shares: 2 } }, { trendFormat: 'trend:z', type: 'know' }),
  ];
  const report = weeklyTrendsReport(tr, rows, { now: NOW });
  ok('the report ranks by Instagram saves and says so', /בשמירות \(אינסטגרם\)/.test(report) && /5\.0% שמירות לצפייה/.test(report));
  ok('a TikTok number is labelled shares and likes, never saves', /טיקטוק: [\d.]+% שיתופים ולייקים לצפייה/.test(report) && !/טיקטוק[^\n]*שמירות/.test(report));
  ok('a format with no Instagram numbers says so rather than showing a save rate', /אין עדיין שמירות מאינסטגרם/.test(report));
  ok('trials are listed with their source', /בניסיון \(1\)/.test(report) && /90,000 צפיות/.test(report));
  ok('dropped formats are listed with the reason', /ירדו השבוע \(1\)/.test(report) && /3 פעמים ברצף/.test(report));
  ok('the best post is named with its numbers', /רומא ב-3 ימים/.test(report) && /4000 צפיות, 300 לייקים, 40 שיתופים/.test(report));
}
