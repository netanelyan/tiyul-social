import { generateKeyPairSync, createVerify } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer, request } from 'node:http';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hasLongDash } from '../dashes.js';
import { BudgetError, claudeCost, draftEstimate, guard, monthSpend, record, WORST } from '../clients/budget.js';
import { setClient } from './claude.js';
import { growthSwitch, mergeSettings, TEMPLATE_NAMES } from './config.js';
import { createOps } from './desk.js';
import { runDiscovery } from './find/index.js';
import { cleanText, instagramPost, instagramProfile, instagramTime, parseFollowers, stripIgCounts, tiktokPost, tiktokTime } from '../clients/brave.js';
import { instagramOnLinktree } from './find/igHandles.js';
import { todaysSearches } from './find/queries.js';
import { scoreAgency, scoreCreator } from './find/score.js';
import { assertAllowed, isSocial, RULES } from '../clients/http.js';
import { campaignFor, channelOf, creatorContact, hasUtm, openTarget, plainLink, tagged } from './links.js';
import { contactsIn } from '../clients/youtube.js';
import { chooseExample, tripLinks } from './prepare/agencyProfile.js';
import { compose, linkFor } from './prepare/compose.js';
import { contextFor, draftItem, specificProblem } from './prepare/draft.js';
import { examplesFor, noteCopied, recordSent, weeklyEdits } from './prepare/learn.js';
import { shortLinkFor } from './prepare/short.js';
import { CONNECTIVES, FORMAL, lengthOf, PRAISE, tellsIn } from './prepare/tells.js';
import { addressLine } from './prepare/voice.js';
import { checkDraft, urlsIn } from './prepare/guards.js';
import { agencySample, prepareToday } from './prepare/index.js';
import { dropSpend, foldInbox, inboxDir, spendDelta } from './ledgerInbox.js';
import { readyRoute } from './prepare/sampleRoute.js';
import { canPublishNew, externalIdFor, publishRoute, tripBody, withdrawClosed, withdrawRoute } from './prepare/publish.js';
import { BUILDER, buildRoute } from './prepare/route.js';
import { checkRoute, findOnGoogle, frameKm, judgeRoute, knownBad, ROUTE_RULES, routeKey, scaleOf } from './prepare/routeCheck.js';
import { destinationSupported, matchPlaces, postDestination, resolveDestination } from './prepare/site.js';
import { checkTemplate, fill, readTemplates } from './prepare/templates.js';
import { ga4Missing, jwtFor } from './report/ga4.js';
import { byChannel } from './report/stats.js';
import { applyAction, awaitingOutcome, blockedBy, closeSilent, dmReady, followupDue, ilDate, leadKeys, lineState, nextInLine, parseItem, pickToday, RuleError } from './rules.js';
import { emptyState, migrate, openStore } from './store.js';
import { main } from './main.js';
import { authConfig, makeSession, sessionOk, startProblem } from './web/auth.js';
import { createHandler, HOST, listen } from './web/server.js';
import { leadPage, leadsPage, reportsPage, settingsPage, todayPage, todaySummary } from './web/pages.js';

// The growth desk's selftest group: every hard rule in the brief, proved
// against fakes. No network, no keys, and data/growth.json is never touched.
//
// Called from scripts/selftest.run.js with its ok/eq, so a failure here fails
// `npm test` like any other.

const HERE = fileURLToPath(new URL('./', import.meta.url));
const REPO = resolve(HERE, '..', '..');
const DAY = 86_400_000;
// 12:00 in Israel, so "today" and "tomorrow" are unambiguous.
const NOW = Date.parse('2026-10-10T09:00:00Z');
const S = mergeSettings({});

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const at = join(dir, name);
    return statSync(at).isDirectory() ? walk(at) : at.endsWith('.js') ? [at] : [];
  });

/** Relative imports of one file, static and literal dynamic, resolved to paths. */
function importsOf(file) {
  const src = readFileSync(file, 'utf8');
  const specs = [];
  for (const m of src.matchAll(/(?:^|[\s;])(?:import|export)\s+(?:[^'"`;]*?\s+from\s+)?['"]([^'"]+)['"]/gm)) specs.push(m[1]);
  for (const m of src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(m[1]);
  return specs.filter((s) => s.startsWith('.')).map((s) => resolve(dirname(file), s));
}

/** Every file reachable from `entry` through relative imports. */
function reachable(entry) {
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f) || !existsSync(f)) continue;
    seen.add(f);
    stack.push(...importsOf(f));
  }
  return seen;
}

const memStore = (data = emptyState()) => ({ data, save() {}, path: null });

// A TikTok id whose top 32 bits are `daysAgo` before NOW.
const ttId = (daysAgo, n = 1) => String((BigInt(Math.floor((NOW - daysAgo * DAY) / 1000)) << 32n) | BigInt(n));

function creator(n, extra = {}) {
  const id = `tt:@maker${n}`;
  return {
    id,
    type: 'creator',
    source: 'tiktok',
    foundAt: new Date(NOW - DAY).toISOString(),
    name: `Maker ${n}`,
    handle: `maker${n}`,
    profileUrl: `https://www.tiktok.com/@maker${n}`,
    followers: 5000,
    dest: { he: 'אתונה', slug: 'athens' },
    posts: [{ id: ttId(2, n), platform: 'tiktok', url: `https://www.tiktok.com/@maker${n}/video/${ttId(2, n)}`, title: 'מסלול באתונה', publishedAt: new Date(NOW - 2 * DAY).toISOString(), status: 'open', score: 50 + n, why: [], places: [], drafts: {} }],
    score: 50 + n,
    why: [],
    gender: 'f',
    stage: 'found',
    closed: null,
    drafts: {},
    edits: {},
    history: [],
    ...extra,
  };
}

const agency = (n, extra = {}) => ({
  id: `ag:place${n}`,
  type: 'agency',
  source: 'places',
  foundAt: new Date(NOW - DAY).toISOString(),
  name: `סוכנות ${n}`,
  placeId: `place${n}`,
  phone: `+972 50-000-00${String(n).padStart(2, '0')}`,
  website: `https://agency${n}.co.il/`,
  score: 40 + n,
  why: [],
  gender: 'f',
  stage: 'found',
  closed: null,
  posts: [],
  drafts: {},
  edits: {},
  history: [],
  ...extra,
});

const customer = (n, extra = {}) => ({
  ...creator(n),
  id: `cust:tt:@asker${n}`,
  type: 'customer',
  handle: `asker${n}`,
  posts: [{ id: ttId(1, 100 + n), platform: 'tiktok', url: 'https://www.tiktok.com/@asker/video/1', title: 'מישהו היה באתונה? כמה ימים צריך?', publishedAt: new Date(NOW - DAY).toISOString(), status: 'open', score: 60, why: [], asksForRoute: true, days: 4, drafts: {} }],
  ...extra,
});

const CITY = {
  slug: 'athens',
  name: 'אתונה',
  places: [
    { id: 'ath-acropolis', name: 'האקרופוליס והפרתנון', nameLocal: 'Acropolis' },
    { id: 'ath-plaka', name: 'פלאקה', nameLocal: 'Plaka' },
    { id: 'ath-museum', name: 'מוזיאון האקרופוליס', nameLocal: 'Acropolis Museum' },
    { id: 'ath-lycabettus', name: 'גבעת ליקבטוס', nameLocal: 'Lycabettus' },
    { id: 'ath-agora', name: 'האגורה העתיקה', nameLocal: 'Ancient Agora' },
    { id: 'ath-psiri', name: 'פסירי', nameLocal: 'Psiri' },
  ],
  itinerary: [
    { day: 1, title: 'האקרופוליס ופלאקה', placeIds: ['ath-acropolis', 'ath-museum', 'ath-plaka'] },
    { day: 2, title: 'שווקים ושקיעה', placeIds: ['ath-agora', 'ath-psiri', 'ath-lycabettus'] },
  ],
};

const OPTIONS = [
  { slug: 'athens', name: 'אתונה', nameLocal: 'Athens', country: 'יוון', haystack: 'אתונה | athens' },
  { slug: 'crete', name: 'כרתים', nameLocal: 'Crete', country: 'יוון', haystack: 'כרתים | crete' },
  { slug: 'rome', name: 'רומא', nameLocal: 'Rome', country: 'איטליה', haystack: 'רומא | rome' },
];

function fakeDeps(over = {}) {
  const calls = { brave: 0, classify: 0 };
  const deps = {
    calls,
    refreshSite: async (state) => {
      state.site = { at: new Date(NOW).toISOString(), options: OPTIONS, itineraries: [{ slug: 'athens', days: 5 }] };
      return state.site;
    },
    brave: async (text, site) => {
      calls.brave++;
      return site === 'tiktok.com' ? [{ url: `https://www.tiktok.com/@maya.travels/video/${ttId(2, 7)}`, title: '', description: 'מסלול באתונה', extra: [], thumb: null }] : [];
    },
    oembed: async (url) => ({ title: 'מסלול 4 ימים באתונה, המון שאלתם על המסלול', authorName: 'Maya', handle: url.split('@')[1].split('/')[0], authorUrl: null, thumbUrl: null }),
    saveThumb: async () => null,
    fetchCities: async (slugs) => new Map(slugs.filter((x) => x === 'athens').map((x) => [x, CITY])),
    classify: async (posts) => {
      calls.classify++;
      return posts.map(() => ({ hebrew: true, kind: 'creator', destination: 'אתונה', places: ['האקרופוליס'], routeDemand: true, asksForRoute: false, days: 4, gender: 'f', reason: '' }));
    },
    searchAgencies: async () => [],
    classifyAgencies: async (list) => list.map(() => null),
    enrichAgency: async () => ({ email: null, whatsapp: null, socials: [], kosher: null, siteError: null }),
    searchShorts: async () => [],
    channelStats: async () => new Map(),
    descriptions: async () => new Map(),
    linktree: async () => null,
    sleep: async () => {},
    ...over,
  };
  return deps;
}

const ENV = { ANTHROPIC_API_KEY: 'test', BRAVE_API_KEY: 'test' };

function get(port, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((done, fail) => {
    const r = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let s = '';
      res.on('data', (d) => (s += d));
      res.on('end', () => done({ status: res.statusCode, body: s }));
    });
    r.on('error', fail);
    if (body) r.write(body);
    r.end();
  });
}

export async function growthSelftest({ ok, eq }) {
  const growthFiles = walk(HERE);
  const rel = (f) => relative(REPO, f).split(sep).join('/');

  /* ---------------------------------------------------------- isolation */

  {
    const fakeOps = {
      context: () => ({ state: emptyState(), settings: S, templates: readTemplates(), now: NOW, env: {} }),
      today: () => ({ comment: [], creator: [], agency: [], customer: [] }),
      status: () => ({ running: false }),
      post: async () => ({ ok: true }),
      ga4: async () => ({ configured: false, missing: ga4Missing({}) }),
    };
    const { server, token, port } = await listen({ ops: fakeOps, port: 0, env: {} });
    try {
      eq('the server binds to 127.0.0.1 only', server.address().address, '127.0.0.1');
      eq('and the host is a constant, not a setting', HOST, '127.0.0.1');
      const page = await get(port);
      ok('Today answers on 127.0.0.1', page.status === 200 && page.body.includes('dir="ltr"'), `status ${page.status}`);
      eq('a request under another Host name is refused (DNS rebinding)', (await get(port, { headers: { host: `evil.example:${port}` } })).status, 421);
      const json = { 'content-type': 'application/json' };
      eq('a POST without the page token is refused', (await get(port, { method: 'POST', path: '/api/run', headers: json, body: '{}' })).status, 403);
      eq('a POST from another origin is refused', (await get(port, { method: 'POST', path: '/api/run', headers: { ...json, 'x-growth-token': token, origin: 'https://evil.example' }, body: '{}' })).status, 403);
      eq('a POST with the token and no foreign origin goes through', (await get(port, { method: 'POST', path: '/api/run', headers: { ...json, 'x-growth-token': token }, body: '{}' })).status, 200);
    } finally {
      server.close();
    }
    const src = readFileSync(join(HERE, 'web', 'server.js'), 'utf8');
    ok('server.js listens on HOST and nowhere else', /server\.listen\(port, HOST,/.test(src) && !/listen\([^)]*0\.0\.0\.0/.test(src));
  }

  {
    const tmp = join(REPO, 'data', '.selftest-growth-config.json');
    const at = (obj) => {
      writeFileSync(tmp, JSON.stringify(obj));
      return new URL(`file:///${tmp.split(sep).join('/')}`);
    };
    eq('off when post-config.json says nothing', growthSwitch({ env: {}, configUrl: at({}) }).on, false);
    eq('off when growth.on is false', growthSwitch({ env: {}, configUrl: at({ growth: { on: false } }) }).on, false);
    eq('on when growth.on is true', growthSwitch({ env: {}, configUrl: at({ growth: { on: true } }) }).on, true);
    eq('GROWTH_ON=1 turns it on over the file', growthSwitch({ env: { GROWTH_ON: '1' }, configUrl: at({ growth: { on: false } }) }).on, true);
    eq('GROWTH_ON=0 turns it off over the file', growthSwitch({ env: { GROWTH_ON: '0' }, configUrl: at({ growth: { on: true } }) }).on, false);
    rmSync(tmp, { force: true });
    const live = JSON.parse(readFileSync(join(REPO, 'post-config.json'), 'utf8'));
    eq('post-config.json ships with growth.on false', live.growth?.on, false);

    const r = spawnSync(process.execPath, [join(HERE, 'main.js')], { env: { ...process.env, GROWTH_ON: '0' }, encoding: 'utf8', timeout: 20_000 });
    ok('with growth off, `npm run growth` exits 0 with a message', r.status === 0 && /off/.test(r.stdout), `status ${r.status} ${r.stderr.slice(0, 200)}`);
    const mainSrc = readFileSync(join(HERE, 'main.js'), 'utf8');
    ok('main.js loads the desk only after the switch, by dynamic import', !/^import .*desk\.js/m.test(mainSrc) && /await import\('\.\/desk\.js'\)/.test(mainSrc));
  }

  {
    const fromBot = reachable(join(REPO, 'bot.js'));
    const intoGrowth = [...fromBot].filter((f) => f.startsWith(HERE));
    eq('the bot never imports src/growth/ (whole import graph from bot.js)', intoGrowth.length, 0);
    ok('and bot.js does not mention it', !/growth/i.test(readFileSync(join(REPO, 'bot.js'), 'utf8')));
    ok('the graph walk is real: bot.js reaches src/store.js', fromBot.has(join(REPO, 'src', 'store.js')));

    const postingStore = join(REPO, 'src', 'store.js');
    const leaks = growthFiles.filter((f) => reachable(f).has(postingStore)).map(rel);
    eq('no growth file reaches the posting store through any import', leaks.join(', '), '');
    const named = growthFiles.filter((f) => !f.endsWith('selftest.js') && /store\.json|(?<!GROWTH_)STORE_PATH/.test(readFileSync(f, 'utf8'))).map(rel);
    eq('and none names its file or its path variable', named.join(', '), '');
  }

  /* ---------------------------------------------------------- never sends */

  {
    const direct = growthFiles
      .filter((f) => !f.endsWith(`${sep}http.js`) && !f.endsWith('selftest.js') && !f.endsWith(`web${sep}client.js`))
      .filter((f) => /\bfetch\s*\(/.test(readFileSync(f, 'utf8')))
      .map(rel);
    eq('no growth file calls fetch except http.js, the one door', direct.join(', '), '');
    const client = readFileSync(join(HERE, 'web', 'client.js'), 'utf8');
    const clientUrls = [...client.matchAll(/fetch\(\s*([^,)]+)/g)].map((m) => m[1].trim());
    ok('the browser script only ever fetches the desk itself', clientUrls.every((u) => /^(url|'\/api\/status')$/.test(u)) && /post\('\/api\//.test(client), clientUrls.join(' | '));

    const writes = RULES.filter((r) => r.method !== 'GET' && (isSocial(r.host || '') || isSocial(r.suffix || '')));
    eq('the allowlist has no write to any social platform', writes.length, 0);
    for (const [m, u] of [
      ['POST', 'https://graph.facebook.com/v21.0/17841/messages'],
      ['POST', 'https://graph.instagram.com/v21.0/17841/comments'],
      ['POST', 'https://graph.instagram.com/v21.0/me/media'],
      ['GET', 'https://graph.instagram.com/v21.0/me'],
      ['POST', 'https://www.tiktok.com/api/commit/follow/user/'],
      ['POST', 'https://open.tiktokapis.com/v2/post/publish/content/init/'],
      ['POST', 'https://www.googleapis.com/youtube/v3/commentThreads'],
      ['POST', 'https://www.googleapis.com/youtube/v3/subscriptions'],
      ['GET', 'https://www.instagram.com/someone/'],
    ]) {
      let refused = false;
      try {
        assertAllowed(m, u);
      } catch {
        refused = true;
      }
      ok(`refused: ${m} ${u.replace(/^https:\/\//, '')}`, refused);
    }
    ok('the reads it does need are allowed', ['https://api.search.brave.com/res/v1/web/search?q=x', 'https://www.tiktok.com/oembed?url=x'].every((u) => assertAllowed('GET', u)));

    const banned = growthFiles
      .filter((f) => !f.endsWith('selftest.js'))
      .filter((f) => /from\s+['"][^'"]*(?:\/publish\/|\/igReplies\/|\/notify\.js|telegraf|playwright|browserFetch)/.test(readFileSync(f, 'utf8')))
      .map(rel);
    eq('no growth file imports a publisher, a DM sender, Telegram or a browser', banned.join(', '), '');
  }

  /* ---------------------------------------------------------- caps */

  {
    const state = emptyState();
    for (let i = 0; i < 30; i++) state.leads[`tt:@maker${i}`] = creator(i);
    for (let i = 30; i < 38; i++) state.leads[`tt:@maker${i}`] = creator(i, { warmedAt: new Date(NOW - 2 * DAY).toISOString(), stage: 'commented' });
    for (let i = 0; i < 6; i++) state.leads[`ag:place${i}`] = agency(i);
    for (let i = 0; i < 9; i++) state.leads[`cust:tt:@asker${i}`] = customer(i);
    const day = pickToday(state, S, NOW);
    eq('comment queue stops at 10', day.comment.length, 10);
    eq('creators stop at 5', day.creator.length, 5);
    eq('agencies stop at 3', day.agency.length, 3);
    eq('customers stop at 5', day.customer.length, 5);
    const again = pickToday(state, S, NOW + 3_600_000);
    eq('the same day picks the same items', JSON.stringify(again), JSON.stringify(day));
    for (const key of day.comment) {
      const [, ...rest] = key.split(':');
      const postId = rest.pop();
      applyAction(state, state.leads[rest.join(':')], 'commented', { postId }, { now: NOW, settings: S });
    }
    eq('ten done comments do not pull in an eleventh', pickToday(state, S, NOW + 7_200_000).comment.length, 10);

    const s2 = emptyState();
    for (let i = 0; i < 5; i++) s2.leads[`tt:@maker${i}`] = creator(i, { warmedAt: new Date(NOW - 9 * DAY).toISOString(), messagedAt: new Date(NOW - 5 * DAY).toISOString(), stage: 'messaged' });
    for (let i = 5; i < 8; i++) s2.leads[`tt:@maker${i}`] = creator(i, { warmedAt: new Date(NOW - 2 * DAY).toISOString(), stage: 'commented' });
    const d2 = pickToday(s2, S, NOW);
    ok('follow-ups come first and count inside the cap', d2.creator.length === 5 && d2.creator.every((k) => k.endsWith(':followup')), d2.creator.join(' '));
  }

  /* ---------------------------------------------------------- the message right away, one follow-up */

  {
    // The owner, 2026-10-14: no comment first and no day's wait.
    const state = emptyState();
    const l = (state.leads['tt:@maker1'] = creator(1));
    eq('a creator found today is owed the message today, with no comment first', dmReady(l), true);
    const day = pickToday(state, S, NOW);
    ok('so it is on today\'s Creators list', day.creator.includes('creator:tt:@maker1:dm'), day.creator.join(' '));
    ok('and their TikTok video is still in Comments, as an extra', day.comment.some((k) => k.startsWith('comment:tt:@maker1:')));
    eq('the warm-up setting is gone', 'warmupDays' in mergeSettings({ warmupDays: 3 }), false);

    const w = (state.leads['tt:@maker3'] = creator(3));
    applyAction(state, w, 'commented', { postId: w.posts[0].id }, { now: NOW, settings: S });
    eq('commenting still moves a creator to "commented"', w.stage, 'commented');
    applyAction(state, w, 'sent', {}, { now: NOW, settings: S });
    eq('and the message can go the same day', w.stage, 'messaged');

    const t0 = NOW;
    applyAction(state, l, 'sent', {}, { now: t0, settings: S });
    eq('the message is recorded without any comment', l.stage, 'messaged');
    const sendAt = (t) => {
      try {
        applyAction(state, l, 'sent', {}, { now: t, settings: S });
        return 'sent';
      } catch (e) {
        return e.code;
      }
    };
    eq('a second message the next day is refused (follow-up not due)', sendAt(t0 + DAY), 'not-due');
    eq('the follow-up waits 5 days by default (the owner, 2026-10-11)', S.followupDays, 5);
    eq('so it is not due after 4', followupDue(l, { now: t0 + 4 * DAY, followupDays: S.followupDays }), false);
    eq('and is after 5', followupDue(l, { now: t0 + 5 * DAY, followupDays: S.followupDays }), true);
    eq('and can be sent once', sendAt(t0 + 5 * DAY), 'sent');
    eq('then never again', sendAt(t0 + 9 * DAY), 'done');
    eq('and it never comes back to Today', followupDue(l, { now: t0 + 20 * DAY, followupDays: S.followupDays }), false);

    const r = (state.leads['tt:@maker2'] = creator(2, { warmedAt: new Date(NOW - 9 * DAY).toISOString(), messagedAt: new Date(NOW - 6 * DAY).toISOString(), stage: 'messaged' }));
    applyAction(state, r, 'replied', {}, { now: NOW, settings: S });
    eq('a reply cancels the follow-up', followupDue(r, { now: NOW, followupDays: 4 }), false);
  }

  /* ---------------------------------------------------------- YouTube creators: straight to the message */

  {
    const yt = (n, extra = {}) =>
      creator(n, { id: `yt:@yt${n}`, source: 'youtube', handle: `yt${n}`, profileUrl: `https://www.youtube.com/@yt${n}`, socials: [], email: null, posts: [{ ...creator(n).posts[0], id: `v${n}`, platform: 'youtube', url: `https://www.youtube.com/shorts/v${n}` }], ...extra });
    const state = emptyState();
    const none = (state.leads['yt:@yt4'] = yt(4));
    const withIg = (state.leads['yt:@yt1'] = yt(1, { socials: ['https://www.tiktok.com/@yt1', 'https://www.instagram.com/yt1.trips/'] }));
    const day = pickToday(state, S, NOW);
    eq('a YouTube creator is never offered in Comments', day.comment.length, 0);
    eq('both go straight to Creators, one with a channel that takes a message first, whatever the score', day.creator.join(), 'creator:yt:@yt1:dm,creator:yt:@yt4:dm');

    eq('the message goes to the Instagram they list, before a TikTok', creatorContact(withIg).url, 'https://www.instagram.com/yt1.trips/');
    eq('else to the business email, before a TikTok', creatorContact({ ...none, email: 'yt4@gmail.com', socials: ['https://www.tiktok.com/@yt4'] }).channel, 'Email');
    eq('else to a TikTok', creatorContact({ ...none, socials: ['https://www.tiktok.com/@yt4'] }).channel, 'TikTok');
    const about = creatorContact(none);
    ok('with none, the channel\'s About page, marked as no known channel', !about.known && about.url === 'https://www.youtube.com/@yt4/about' && openTarget(none, 'dm') === about.url);

    const told = contextFor('creator', { lead: withIg, post: withIg.posts[0], extra: { channel: creatorContact(withIg), commented: false } }).text;
    ok('the draft is told where it goes and that there was no comment', told.includes('an Instagram direct message') && told.includes('has not commented'), told);
    const unknown = contextFor('creator', { lead: none, post: none.posts[0], extra: { channel: about, commented: false } }).text;
    ok('and, with no known channel, to read right as a DM or an email', unknown.includes('reads right as either'));
    const html = todayPage({ state, settings: S, token: 't', now: NOW, day, templates: readTemplates(), env: {} });
    ok('the card says where it goes', html.includes('Goes by Instagram DM') && html.includes('View email address'));
    const page = leadPage({ state, settings: S, token: 't', now: NOW, lead: none, templates: readTemplates() });
    ok('and the lead page offers no comment for a YouTube creator', !page.includes('Comment on the video') && !page.includes('data-act="commented"'));

    // Prepared on the first pass: route from the video, published, the message drafted for its channel.
    const store = memStore(state);
    const asked = [];
    await prepareToday({
      store,
      settings: S,
      now: NOW,
      env: ENV,
      deps: {
        cityFor: async () => CITY,
        draftItem: async (kind, args) => (asked.push({ kind, ...args }), { variants: [{ text: 'היי, ראיתי ביוטיוב את הסרטון. בניתי לכם מסלול: [קישור]', score: 1, tells: [] }] }),
        fillVideoContext: async () => 0,
        shortLink: async () => null,
        publishRoute: async (l) => ({ status: 'published', url: `https://www.tiyulplus.com/trips/${l.handle}`, slug: l.handle, externalId: externalIdFor(l), publishedAt: new Date(NOW).toISOString() }),
        brave: async () => [],
      },
    });
    const dm = asked.find((a) => a.kind === 'creator' && a.lead.id === 'yt:@yt1');
    ok('the message is drafted the day they are found, about their video, for their Instagram', dm && dm.post.id === 'v1' && dm.extra.channel.channel === 'Instagram' && dm.extra.commented === false && dm.extra.route);
    ok('with the route on the site and the video it was written about kept', withIg.trip?.status === 'published' && withIg.drafts.dm.postId === 'v1');
    ok('and the text carries that page', compose(withIg, 'dm', { templates: readTemplates(), settings: S, state }).text.includes('tiyulplus.com/trips/yt1'));
    eq('no comment was drafted for either', asked.filter((a) => a.kind === 'comment').length, 0);
  }

  /* ---------------------------------------------------------- do-not-contact, dedupe */

  {
    const store = memStore();
    const deps = fakeDeps();
    const run1 = await runDiscovery({ store, settings: S, now: NOW, deps, env: ENV });
    eq('discovery creates the creator once', run1.found.creator, 1);
    const lead = store.data.leads['tt:@maya.travels'];
    ok('with the post, the route demand and the reasons', lead && lead.posts.length === 1 && lead.routeDemand && lead.why.length > 0);
    const run2 = await runDiscovery({ store, settings: S, now: NOW + 1000, deps, env: ENV });
    eq('the same video a second time is not a new lead', run2.found.creator + run2.attached, 0);

    applyAction(store.data, lead, 'skip-post', { postId: lead.posts[0].id }, { now: NOW, settings: S });
    await runDiscovery({ store, settings: S, now: NOW + 2000, deps, env: ENV });
    eq('a skipped video never returns', lead.posts.filter((p) => p.status === 'open').length, 0);
    ok('but [דלג] skipped only the video, not the creator', !lead.closed);

    const newVideo = fakeDeps({ brave: async (t, site) => (site === 'tiktok.com' ? [{ url: `https://www.tiktok.com/@maya.travels/video/${ttId(1, 9)}`, title: '', description: '', extra: [], thumb: null }] : []) });
    const run3 = await runDiscovery({ store, settings: S, now: NOW + 3000, deps: newVideo, env: ENV });
    eq('a new video by the same creator brings them back', run3.attached, 1);
    ok('to the comment queue', pickToday(store.data, S, NOW + 3000).comment.some((k) => k.startsWith('comment:tt:@maya.travels:')));

    applyAction(store.data, lead, 'irrelevant', {}, { now: NOW, settings: S });
    const another = fakeDeps({ brave: async (t, site) => (site === 'tiktok.com' ? [{ url: `https://www.tiktok.com/@maya.travels/video/${ttId(1, 11)}`, title: '', description: '', extra: [], thumb: null }] : []) });
    const run4 = await runDiscovery({ store, settings: S, now: NOW + 4000, deps: another, env: ENV });
    ok('[לא רלוונטי] drops the creator for good', run4.attached === 0 && run4.found.creator === 0 && blockedBy(store.data, ['tt:user:maya.travels']));

    const state = emptyState();
    const a = (state.leads['ag:place1'] = agency(1));
    applyAction(state, a, 'no', {}, { now: NOW, settings: S });
    const keys = leadKeys(a);
    ok('"not interested" is stored against every key the agency has', keys.length >= 3 && keys.every((k) => state.dnc[k]?.why === 'not-interested'), keys.join(' '));
    ok('so the same phone under another listing is blocked', Boolean(blockedBy(state, [`phone:972500000001`])));
    ok('and the same website', Boolean(blockedBy(state, ['site:agency1.co.il'])));
  }

  {
    // The first live run's false positive: both homepages say "חו"ל", only one
    // of them sends anybody there.
    const store = memStore();
    const biz = (placeId, name, types) => ({ placeId, name, address: '', website: `https://${placeId}.co.il/`, phone: placeId === 'farm' ? '+972 2-588-7888' : '+972 3-526-0900', mapsUrl: null, status: 'OPERATIONAL', types });
    const deps = fakeDeps({
      searchAgencies: async () => [biz('farm', 'החווה האורגנית', ['farm']), biz('gesher', 'טיולי גשר', ['travel_agency'])],
      enrichAgency: async (a) => ({ email: null, whatsapp: null, socials: [], kosher: null, abroad: 'חו"ל', siteRead: true, siteError: null, snippet: a.name }),
      classifyAgencies: async (list) => list.map((a) => ({ sellsAbroad: a.placeId === 'gesher', kosherAudience: true, reason: a.placeId === 'gesher' ? 'מארגנים טיולים לחו"ל' : 'חווה' })),
    });
    await runDiscovery({ store, settings: S, now: NOW, deps, env: { ...ENV, GOOGLE_MAPS_KEY: 'test' } });
    eq('the reader keeps the travel agency and drops the farm, whatever words its site uses', Object.keys(store.data.leads).filter((k) => k.startsWith('ag:')).join(), 'ag:gesher');
    ok('and the agency carries the kosher audience it read', Boolean(store.data.leads['ag:gesher']?.kosher));
    ok('and the farm is never looked at again', Boolean(store.data.seen['place:farm']?.rejected));
  }

  {
    // The live runs' mistake, replayed: the sorter files a Corfu post under a
    // destination the site has. Nothing the post names is in that destination.
    const store = memStore();
    const two = fakeDeps({
      brave: async (t, site) =>
        site === 'tiktok.com'
          ? [
              { url: `https://www.tiktok.com/@corfu.fan/video/${ttId(2, 21)}`, title: '', description: '', extra: [], thumb: null },
              { url: `https://www.tiktok.com/@athens.fan/video/${ttId(2, 22)}`, title: '', description: '', extra: [], thumb: null },
            ]
          : [],
      classify: async (posts) =>
        posts.map((p, i) => ({
          hebrew: true, kind: 'creator', destination: i === 0 ? 'קורפו' : 'אתונה', places: i === 0 ? ['העיר העתיקה של קורפו'] : ['האקרופוליס'],
          routeDemand: false, asksForRoute: false, days: 0, gender: 'unknown', reason: '', siteDestination: 'אתונה',
        })),
    });
    await runDiscovery({ store, settings: S, now: NOW, deps: two, env: ENV });
    ok('a destination the post never names is refused (Corfu is not Athens)', !store.data.leads['tt:@corfu.fan']);
    ok('and one it does name is kept', store.data.leads['tt:@athens.fan']?.posts[0]?.dest?.slug === 'athens');
  }

  /* ---------------------------------------------------------- YouTube */

  {
    const c = contactsIn('Travel vlogs 🇮🇱 | Insta: https://instagram.com/noa.trips. TikTok tiktok.com/@noa_trips | business: noa@trips.co.il');
    ok('a channel description yields its Instagram, TikTok and email', c.socials.join() === 'https://www.instagram.com/noa.trips/,https://www.tiktok.com/@noa_trips' && c.email === 'noa@trips.co.il', JSON.stringify(c));

    let searches = 0;
    const store = memStore();
    const short = (id, channelId) => ({ id, url: `https://www.youtube.com/shorts/${id}`, title: 'טיול לאתונה ב-3 ימים', description: '', channelId, channelTitle: channelId, publishedAt: new Date(NOW - 3 * DAY).toISOString(), thumb: null });
    const deps = fakeDeps({
      brave: async () => [],
      searchShorts: async () => (searches++, [short('vidA', 'chanA'), short('vidB', 'chanB')]),
      channelStats: async () =>
        new Map([
          ['chanA', { subscribers: 5200, handle: 'noa.trips', socials: ['https://www.instagram.com/noa.trips/'], email: null }],
          ['chanB', { subscribers: 120_000, handle: 'big.channel', socials: [], email: null }],
        ]),
    });
    await runDiscovery({ store, settings: S, now: NOW, deps, env: { ...ENV, YOUTUBE_API_KEY: 'test' } });
    eq('YouTube runs every Hebrew template for its destinations, plus the day\'s hashtags', searches, S.youtubeDestinationsPerDay * S.tiktokQueries.length + S.hashtagsPerDay);
    ok('and stays inside the free 100 searches a day', searches <= 100);
    const yt = store.data.leads['yt:@noa.trips'];
    ok('a channel inside 1,000 to 30,000 subscribers becomes a creator, counted by YouTube itself', yt && yt.followers === 5200 && yt.followersFrom === 'youtube' && yt.posts.length === 1);
    ok('one channel is one lead, however many searches found it', Object.keys(store.data.leads).filter((k) => k.startsWith('yt:')).length === 1);
    ok('a channel with 120K subscribers is left out for good', !store.data.leads['yt:@big.channel'] && Boolean(store.data.seen['yt:channel:chanB']?.rejected));
    eq('YouTube has no DMs: [העתק ופתח] opens the Instagram the channel lists', openTarget(yt, 'dm'), 'https://www.instagram.com/noa.trips/');
    eq('or its email', openTarget({ ...yt, socials: [], email: 'noa@trips.co.il' }, 'dm'), 'mailto:noa@trips.co.il');
    eq('or, listing neither, the channel\'s About page, where YouTube shows the business email', openTarget({ ...yt, socials: [], email: null }, 'dm'), 'https://www.youtube.com/@noa.trips/about');

    // What "טיול לקורפו" really returned on 2026-10-10: Shorts in other languages.
    const store2 = memStore();
    const foreign = fakeDeps({
      brave: async () => [],
      searchShorts: async () => [{ ...short('vidRu', 'chanRu'), title: 'Греция, остров Корфу', description: '' }],
      channelStats: async () => new Map(),
    });
    const run2 = await runDiscovery({ store: store2, settings: S, now: NOW, deps: foreign, env: { ...ENV, YOUTUBE_API_KEY: 'test' } });
    ok('a Short with no Hebrew is dropped before it is sorted', run2.notHebrew > 0 && foreign.calls.classify === 0);
    ok('and only the Short: its channel is not judged on one title', Boolean(store2.data.seen['yt:post:vidRu']) && !store2.data.seen['yt:channel:chanRu']);
    ok('Settings refuse more YouTube searches than the free 100 a day', Boolean((await createOps({ store: memStore(), env: {}, clock: () => NOW, deps: { runDiscovery: async () => {}, prepareToday: async () => {} } }).post('/api/settings', { settings: { youtubeDestinationsPerDay: 30 } })).error));
  }

  /* ---------------------------------------------------------- Instagram handles for the trend watcher */

  {
    const named = contactsIn('כל הטיפים בפרופיל. אינסטגרם: @Maya.Goes | linktr.ee/maya_trips. מייל: noa@trips.co.il');
    ok('a description names an Instagram with an @ beside the word, and a Linktree', named.socials.includes('https://www.instagram.com/Maya.Goes/') && named.linktree.join() === 'https://linktr.ee/maya_trips', JSON.stringify(named));
    ok('an email is not an Instagram handle', contactsIn('כתבו לי noa@trips.co.il').socials.length === 0);
    eq('an Instagram profile URL gives its handle; a post or a reserved path does not', [instagramProfile('https://www.instagram.com/roni.abroad/'), instagramProfile('https://www.instagram.com/explore/'), instagramProfile('https://www.instagram.com/p/AbCdEf123/')].join(','), 'roni.abroad,,');
    const lt = '<script id="__NEXT_DATA__">{"socialLinks":[{"type":"TIKTOK","url":"https://tiktok.com/@x"},{"type":"INSTAGRAM","url":"https://instagram.com/Tom.Abroad","position":1}]}</script>';
    eq("a Linktree page's own Instagram icon gives the handle", instagramOnLinktree(lt), 'tom.abroad');
    eq('else its first Instagram link', instagramOnLinktree('<a href="https:\\/\\/www.instagram.com\\/dana.trips">'), 'dana.trips');
    ok("and Linktree's own account is none of them", instagramOnLinktree('<a href="https://instagram.com/linktree_">') === null);
    ok('a Linktree page may be read, one level deep, and never written', Boolean(assertAllowed('GET', 'https://linktr.ee/maya_trips')) && (() => { try { assertAllowed('GET', 'https://linktr.ee/s/abc/def'); return false; } catch { return true; } })() && (() => { try { assertAllowed('POST', 'https://linktr.ee/maya_trips'); return false; } catch { return true; } })());

    // Brave's instagram.com finds that cannot be leads: a post a year old, a profile.
    const IGA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const igCode = (daysAgo) => {
      let id = BigInt(NOW - daysAgo * DAY - 1314220021721) << 23n;
      let s = '';
      while (id > 0n) {
        s = IGA[Number(id % 64n)] + s;
        id /= 64n;
      }
      return s;
    };
    ok('the test shortcode decodes to its age', Math.round((NOW - Date.parse(instagramTime(igCode(400)))) / DAY) === 400);
    const store = memStore();
    store.data.dnc['ig:user:blocked.one'] = { at: new Date(NOW).toISOString(), why: 'asked' };
    const igResults = [
      { url: `https://www.instagram.com/p/${igCode(400)}/`, title: 'Dana (@dana.abroad) on Instagram: "טיול לאתונה, כל הטיפים"', description: '', extra: [], thumb: null },
      { url: 'https://www.instagram.com/roni.abroad/', title: 'Roni (@roni.abroad) • Instagram photos and videos', description: 'מטיילת בעולם, מסלולים וטיפים', extra: [], thumb: null },
      { url: `https://www.instagram.com/p/${igCode(300)}/`, title: 'Blocked (@blocked.one) on Instagram: "טיול"', description: '', extra: [], thumb: null },
      { url: `https://www.instagram.com/p/${igCode(200)}/`, title: 'Airline (@airline.il) on Instagram: "מבצע טיסות"', description: '', extra: [], thumb: null },
    ];
    const sorted = [];
    const deps = fakeDeps({
      brave: async (text, site) => (site === 'instagram.com' ? igResults : []),
      classify: async (posts) => {
        deps.calls.classify++;
        sorted.push(...posts.map((p) => p.author));
        return posts.map((p) => (p.author === 'airline.il' ? { hebrew: true, kind: 'other', reason: 'פרסומת של חברת תעופה' } : { hebrew: true, kind: 'creator', reason: 'מספרת על הטיול שלה' }));
      },
    });
    const run1 = await runDiscovery({ store, settings: S, now: NOW, deps, env: ENV });
    eq('the authors of Instagram finds too old to be leads, and of profiles, are sorted for their handle alone, once each', sorted.sort().join(','), 'airline.il,dana.abroad,roni.abroad');
    ok('the creators go on the list for the trend watcher, from Brave', store.data.igHandles['dana.abroad']?.via === 'brave' && Boolean(store.data.igHandles['roni.abroad']));
    ok('one the sorter turned down is set aside with its reason, not listed', !store.data.igHandles['airline.il'] && /תעופה/.test(store.data.igNot['airline.il']?.why || ''));
    ok('a handle on the do-not-contact list is never sorted or listed', !sorted.includes('blocked.one') && !store.data.igHandles['blocked.one']);
    ok('none of them becomes a lead', !Object.keys(store.data.leads).some((k) => /dana|roni|airline/.test(k)));
    ok('the run counts what it added, for the Today page', run1.igHandles === 2 && run1.igHandlesTotal === 2);
    const before = deps.calls.classify;
    await runDiscovery({ store, settings: S, now: NOW + 1000, deps, env: ENV });
    eq('a handle already judged is not sorted again', deps.calls.classify, before);

    // YouTube: the Short's full description, and a Linktree.
    const ytStore = memStore();
    const short = (id, channelId) => ({ id, url: `https://www.youtube.com/shorts/${id}`, title: 'טיול לאתונה ב-3 ימים', description: '', channelId, channelTitle: channelId, publishedAt: new Date(NOW - 3 * DAY).toISOString(), thumb: null });
    const pages = [];
    const ytDeps = fakeDeps({
      brave: async () => [],
      searchShorts: async () => [short('vidC', 'chanC'), short('vidD', 'chanD'), short('vidE', 'chanE')],
      channelStats: async () =>
        new Map([
          ['chanC', { subscribers: 5200, handle: 'maya.yt', socials: [], email: null, linktree: [] }],
          ['chanD', { subscribers: 4100, handle: 'tom.yt', socials: [], email: null, linktree: ['https://linktr.ee/tom.trips'] }],
          ['chanE', { subscribers: 3000, handle: 'shop.yt', socials: [], email: null, linktree: [] }],
        ]),
      descriptions: async () => new Map([['vidC', 'כל הטיפים בפרופיל. Instagram: @maya.goes'], ['vidE', 'instagram.com/shop.il']]),
      linktree: async (url) => (pages.push(url), 'tom.abroad'),
      classify: async (posts) => posts.map((p) => (p.author === 'chanE' ? { hebrew: true, kind: 'other', reason: 'חנות' } : { hebrew: true, kind: 'creator', destination: 'אתונה', places: ['האקרופוליס'], routeDemand: true, asksForRoute: false, days: 4, gender: 'f', reason: '' })),
    });
    await runDiscovery({ store: ytStore, settings: S, now: NOW, deps: ytDeps, env: { ...ENV, YOUTUBE_API_KEY: 'test' } });
    eq("an Instagram named under a creator's Short goes on the list", ytStore.data.igHandles['maya.goes']?.via, 'youtube');
    ok("and becomes the lead's DM target too", ytStore.data.leads['yt:@maya.yt']?.socials?.includes('https://www.instagram.com/maya.goes/'));
    ok('a channel that links only a Linktree: the page is read once, for its Instagram', pages.join() === 'https://linktr.ee/tom.trips' && ytStore.data.igHandles['tom.abroad']?.via === 'linktree' && ytStore.data.linktrees['https://linktr.ee/tom.trips']?.handle === 'tom.abroad');
    ok('a channel the sorter did not call a travel creator adds nothing', !ytStore.data.igHandles['shop.il']);
  }

  /* ---------------------------------------------------------- publishing */

  {
    const TOKEN = { GROWTH_PUBLISH_TOKEN: 'x'.repeat(40) };
    const route = buildRoute(CITY, { places: ['גבעת ליקבטוס'], days: 2 });
    const lead = creator(1, { route });
    const body = tripBody(lead);
    eq('the externalId is the lead, in the characters the endpoint accepts', body.externalId, 'growth:tt:maker1');
    ok('the body is what the endpoint validates', /^[A-Za-z0-9:._-]{1,120}$/.test(body.externalId) && body.name.length <= 80 && body.days.length >= 1 && body.days.every((d) => d.placeIds.length >= 1 && d.placeIds.length <= 12 && new Set(d.placeIds).size === d.placeIds.length) && body.startDate === null);
    ok('and carries catalog ids only, no names', body.days.every((d) => Object.keys(d).join() === 'citySlug,placeIds,notes'));

    const sent = [];
    const post = async (url, payload, opts) => {
      sent.push({ url, payload, auth: opts.headers.authorization });
      return { ok: true, tripId: 'g-1', slug: 'athens-2-ab12cd34', url: 'https://www.tiyulplus.com/trips/athens-2-ab12cd34', indexable: false, stopCount: 6, created: true };
    };
    const t = await publishRoute(lead, { env: TOKEN, post, now: NOW });
    ok('a route publishes to our own endpoint with the token', sent[0]?.url === 'https://www.tiyulplus.com/api/internal/trips' && sent[0].auth === `Bearer ${'x'.repeat(40)}`);
    ok('and the trip is stored as published with its address', t.status === 'published' && t.url.endsWith('/trips/athens-2-ab12cd34') && t.externalId === 'growth:tt:maker1');
    const live = { ...lead, trip: t, drafts: { dm: { variants: [{ text: 'היי, בניתי את המסלול שלכם: [קישור]', score: 1, tells: [] }] } } };
    const dmText = compose(live, 'dm', { templates: readTemplates(), settings: S, state: emptyState() }).text;
    ok('the DM then carries that address, plain: no tags for WhatsApp to show in full', dmText.includes('https://tiyulplus.com/trips/athens-2-ab12cd34') && !/utm_|\[קישור\]/.test(dmText), dmText);

    const refuse = async () => {
      throw Object.assign(new Error('unknown-ids'), { status: 422, body: { unknownPlaces: ['athens/ath-gone'] } });
    };
    const failed = await publishRoute(lead, { env: TOKEN, post: refuse, now: NOW });
    ok('a refusal is stored with its reason, not thrown', failed.status === 'failed' && failed.reason.includes('ath-gone'));
    eq('without a token nothing is sent', (await publishRoute(lead, { env: {}, post: async () => { throw new Error('called'); } })).status, 'failed');
    eq('without a route nothing is sent', (await publishRoute(creator(2), { env: TOKEN, post: async () => { throw new Error('called'); } })).status, 'no-route');

    const dels = [];
    const del = async (url) => {
      dels.push(url);
      return { ok: true, withdrawn: true };
    };
    const gone = await withdrawRoute(live, { env: TOKEN, del, now: NOW });
    ok('withdrawing calls DELETE with the same externalId', dels[0] === 'https://www.tiyulplus.com/api/internal/trips?externalId=growth%3Att%3Amaker1' && gone.status === 'withdrawn');
    ok('a route that was never published is not withdrawn', (await withdrawRoute({ ...lead, trip: { status: 'failed' } }, { env: TOKEN, del })) && dels.length === 1);
    const stuck = await withdrawRoute(live, { env: TOKEN, del: async () => { throw new Error('timed out'); }, now: NOW });
    ok('a failed withdrawal keeps the page marked live, with the error', stuck.status === 'published' && stuck.withdrawError === 'timed out');
    const st = emptyState();
    st.leads[lead.id] = { ...lead, closed: 'skipped', trip: stuck };
    eq('and the timer takes it down on the next pass', await withdrawClosed(st, { env: TOKEN, del, now: NOW }), 1);

    // Public only when shown: the Creators column, inside its cap (one here).
    const store = memStore();
    store.data.leads['tt:@maker1'] = creator(1);
    store.data.leads['tt:@maker2'] = creator(2, { warmedAt: new Date(NOW - DAY).toISOString(), stage: 'commented', posts: [{ ...creator(2).posts[0], status: 'commented' }] });
    let published = [];
    const deps = {
      cityFor: async () => CITY,
      draftItem: async () => ({ variants: [{ text: 'x', score: 1, tells: [] }] }),
      fillVideoContext: async () => 0,
      shortLink: async () => null,
      publishRoute: async (l) => {
        published.push(l.id);
        return { status: 'published', url: 'https://www.tiyulplus.com/trips/x', slug: 'x', externalId: externalIdFor(l), publishedAt: new Date(NOW).toISOString() };
      },
      brave: async () => [],
    };
    const one = mergeSettings({ caps: { creator: 1 } });
    await prepareToday({ store, settings: one, now: NOW, deps, env: {} });
    eq('a route goes public only for the creator shown in the Creators column', published.join(), 'tt:@maker2');
    await prepareToday({ store, settings: one, now: NOW + 60_000, deps, env: {} });
    eq('and once: the next pass does not publish it again', published.length, 1);

    const withdrawn = [];
    const ops = createOps({ store, env: {}, clock: () => NOW, deps: { runDiscovery: async () => {}, prepareToday: async () => {}, withdrawRoute: async (l) => (withdrawn.push(l.id), { ...l.trip, status: 'withdrawn' }) } });
    await ops.post('/api/lead/tt:@maker2/action', { action: 'skip' });
    ok('[Skip] takes the route down', withdrawn.join() === 'tt:@maker2' && store.data.leads['tt:@maker2'].trip.status === 'withdrawn');

    const writes = RULES.filter((r) => r.method !== 'GET');
    ok('the only writes anywhere: Google APIs, and our own trips and short-link endpoints', writes.every((r) => ['places.googleapis.com', 'oauth2.googleapis.com', 'analyticsdata.googleapis.com'].includes(r.host) || (r.host === 'www.tiyulplus.com' && (r.path?.test('/api/internal/trips') || r.path?.test('/api/internal/links')) && !r.path.test('/api/trips/publish'))), writes.map((r) => `${r.method} ${r.host}`).join(', '));
  }

  {
    // Brave's social index is mostly old. Those posts cost nothing beyond the search.
    const store = memStore();
    const deps = fakeDeps({ brave: async (t, site) => (site === 'tiktok.com' ? [{ url: `https://www.tiktok.com/@old.one/video/${ttId(400, 31)}`, title: '', description: '', extra: [], thumb: null }] : []) });
    const run = await runDiscovery({ store, settings: S, now: NOW, deps, env: ENV });
    ok('a post older than every limit is skipped before it is sorted', run.tooOld > 0 && deps.calls.classify === 0);
    ok('and is not marked seen, so a higher limit would bring it back', !store.data.seen[`tt:post:${ttId(400, 31)}`]);
  }

  /* ---------------------------------------------------------- budget */

  {
    const state = emptyState();
    for (let i = 0; i < 900; i++) record(state, 'brave', { now: NOW });
    eq('900 Brave queries sit inside the $5 credit', monthSpend(state, S, NOW).billable, 0);
    for (let i = 0; i < 200; i++) record(state, 'brave', { now: NOW });
    ok('1,100 bill the 100 over it', Math.abs(monthSpend(state, S, NOW).billable - 0.5) < 1e-9);
    for (let i = 0; i < 1000; i++) record(state, 'places', { now: NOW });
    ok('1,000 Places calls are free', Math.abs(monthSpend(state, S, NOW).rows.places.billable) < 1e-9);
    record(state, 'claude', { usd: S.budgetUsd + 5, now: NOW });
    let stopped = false;
    try {
      guard(state, S, 'claude', 0.01, NOW);
    } catch (e) {
      stopped = e instanceof BudgetError;
    }
    ok('over the cap, every paid call is refused', stopped);

    const store = memStore(state);
    const deps = fakeDeps();
    const run = await runDiscovery({ store, settings: S, now: NOW, deps, env: ENV });
    ok('and discovery stops before searching', run.stopped === 'budget' && deps.calls.brave === 0);

    const s2 = emptyState();
    record(s2, 'claude', { usd: S.budgetUsd - 0.005, now: NOW });
    const store2 = memStore(s2);
    const deps2 = fakeDeps({
      classify: async (posts, { state: st, settings }) => {
        guard(st, settings, 'claude', 0.02, NOW);
        return posts.map(() => null);
      },
    });
    const run2 = await runDiscovery({ store: store2, settings: S, now: NOW, deps: deps2, env: ENV });
    eq('a run that reaches the cap mid-way stops and says so', run2.stopped, 'budget');
    eq('the ledger is by month', Object.keys(state.spend)[0], ilDate(NOW).slice(0, 7));
  }

  /* ---------------------------------------------------------- links and drafts */

  {
    const v = (text) => ({ variants: [{ text, score: 1, tells: [] }] });
    const c = creator(1, { trip: { status: 'published', url: 'https://www.tiyulplus.com/trips/athens-4-ab12cd34' }, drafts: { dm: v('היי, ראיתי את הסרטון על פלאקה. בניתי את המסלול שלכם באתר: [קישור]') } });
    const a = agency(1, { agencyDest: { slug: 'athens', he: 'אתונה', path: '/itinerary/athens/5' }, drafts: { message: v('היי, נתנאל כאן. הנה דוגמה לאתונה: [קישור]') } });
    const u = customer(1, { dest: { he: 'אתונה', slug: 'athens' }, drafts: { reply: v('שלושה ימים מספיקים לרוב.') } });
    const state = { ...emptyState(), site: { options: OPTIONS, itineraries: [{ slug: 'athens', days: 5 }] } };
    for (const [lead, what] of [[c, 'dm'], [a, 'message'], [u, 'reply']]) {
      const link = linkFor(lead, what, { state });
      ok(`${lead.type}: the link is our page, plain, with no tags for WhatsApp to show in full`, Boolean(link) && !hasUtm(link) && /^https:\/\/tiyulplus\.com\/[a-z]/.test(link), link);
    }
    eq('a creator campaign is their handle', campaignFor(c), 'maker1');
    eq('an agency campaign is its website', campaignFor(a), 'agency1.co.il');
    ok('tagged() replaces stale tags', new URL(tagged('https://www.tiyulplus.com/x?utm_source=old', c)).searchParams.get('utm_source') === 'creator');

    const templates = readTemplates();
    const ctx = { templates, settings: S, state };
    for (const [lead, what] of [[c, 'dm'], [a, 'message'], [u, 'reply'], [c, 'followup']]) {
      for (const gender of ['f', 'm', 'unknown']) {
        const out = compose({ ...lead, gender, messagedAt: what === 'followup' ? 'x' : lead.messagedAt }, what, ctx);
        const link = linkFor(lead, what, { state });
        const urls = urlsIn(out.text);
        ok(`${lead.type} ${what} (${gender}): no URL but our own link`, urls.every((x) => x === link) && (!link || urls.length === 1), urls.join(' '));
        ok(`${lead.type} ${what} (${gender}): no long dash`, !hasLongDash(out.text));
      }
    }
    const waiting = compose(creator(2, { trip: { status: 'waiting-limit', reason: 'The site takes 20 new route pages a day.' }, drafts: { dm: v('היי, בניתי את המסלול: [קישור]') } }), 'dm', ctx);
    ok('a creator DM without a published route says why and is not sendable', waiting.missing.some((m) => /20 new route pages/.test(m)) && waiting.text.includes('[קישור]'));
    const customerNoAsk = compose(customer(3, { dest: { he: 'אתונה', slug: 'athens' }, drafts: { reply: v('תשובה') }, posts: [{ ...customer(3).posts[0], asksForRoute: false }] }), 'reply', ctx);
    eq('a customer who did not ask for a route gets no link', urlsIn(customerNoAsk.text).length, 0);

    eq('a clean comment passes', checkDraft('שווה לעלות לליקבטוס בשקיעה', { kind: 'comment', sources: ['גבעת ליקבטוס בשקיעה'] }).length, 0);
    ok('a comment with a link is refused', checkDraft('תבדקו את tiyulplus.com', { kind: 'comment' }).length > 0);
    ok('a comment that mentions the site is refused', checkDraft('יש לנו באתר שלנו מסלול', { kind: 'comment' }).length > 0);
    ok('a long dash is refused', checkDraft('יפה \u2014 מאוד', { kind: 'comment' }).length > 0);
    ok('an invented number is refused', checkDraft('צריך 3 ימים', { kind: 'comment', sources: ['אתונה'] }).some((p) => /number that is not in the sources/.test(p)));
    ok('a number from the source passes', checkDraft('צריך 3 ימים', { kind: 'comment', sources: ['יום 3: פלאקה'] }).length === 0);
    ok('a message with a foreign URL is refused', checkDraft('הנה https://evil.example/x', { kind: 'message', link: 'https://www.tiyulplus.com/trips/a' }).length > 0);

    for (const n of TEMPLATE_NAMES) {
      eq(`template ${n}.txt passes its own checks`, checkTemplate(n, templates[n]).join('; '), '');
      eq(`template ${n}.txt reads like a person`, tellsIn(fill(templates[n], { dest: 'אתונה', link: 'https://tiyulplus.com/x' }), { kind: 'followup' }).map((t) => t.msg).join('; '), '');
    }
    ok('a template with a URL is refused', checkTemplate('customer-link', 'היי [קישור] www.example.com').length > 0);
    ok('a template with an unknown placeholder is refused', checkTemplate('customer-link', 'היי [שמ] [קישור]').length > 0);
    ok('a template with a gendered pair is refused: most genders are unknown', checkTemplate('creator-followup', 'אם {תרצה|תרצי}, אתקן').length > 0);
    const filled = fill(templates['customer-link'], { dest: 'אתונה', link: 'L' });
    ok('fill puts in the destination and the link', filled.includes('אתונה') && filled.endsWith('L'), filled);
  }

  /* ---------------------------------------------------------- matching, scoring, parsing */

  {
    const { matched, unmatched } = matchPlaces(['האקרופוליס', 'בפלאקה', 'מקום שלא קיים'], CITY.places);
    ok('places named in a post match the catalog', matched.map((m) => m.id).join() === 'ath-acropolis,ath-plaka', JSON.stringify(matched));
    eq('and the rest are listed, not guessed', unmatched.join(), 'מקום שלא קיים');
    const route = buildRoute(CITY, { places: ['גבעת ליקבטוס'], days: 2 });
    eq('the place they named goes first', route.days[0].placeIds[0], 'ath-lycabettus');
    eq('the days are the site days', route.days.length, 2);
    ok('every stop is a catalog id', route.days.every((d) => d.placeIds.every((id) => CITY.places.some((p) => p.id === id))));
    eq('a city resolves by name', resolveDestination('אתונה', OPTIONS)?.slug, 'athens');
    eq('with a prefix', resolveDestination('לאתונה', OPTIONS)?.slug, 'athens');
    eq('a country resolves to the preferred city', resolveDestination('יוון', OPTIONS, ['crete', 'athens'])?.slug, 'crete');
    eq('an unknown place is null', resolveDestination('קטמנדו', OPTIONS), null);

    const v = { hebrew: true, kind: 'creator', places: [], routeDemand: true };
    ok('not Hebrew rejects the person', scoreCreator({ verdict: { ...v, hebrew: false }, ageDays: 1, onSite: 'x' }, S).rejectPerson === true);
    ok('followers outside 1,000 to 30,000 reject the person', scoreCreator({ verdict: v, followers: 120_000, ageDays: 1, onSite: 'x' }, S).rejectPerson === true);
    ok('unknown followers are fine, and said', scoreCreator({ verdict: v, ageDays: 1, onSite: 'x' }, S).why.includes('follower count unknown'));
    ok('no site destination, no creator lead', Boolean(scoreCreator({ verdict: v, ageDays: 1, onSite: null }, S).reject));
    ok('kosher agencies get the bonus', scoreAgency({ phone: '1', abroad: 'טיסות', siteRead: true, kosher: 'כשר' }).score > scoreAgency({ phone: '1', abroad: 'טיסות', siteRead: true }).score);
    // Both found on the first live run under "טיולים לשומרי כשרות ירושלים".
    ok('a business whose site never mentions travelling abroad is not an agency (the organic farm)', Boolean(scoreAgency({ phone: '1', siteRead: true, abroad: null, types: ['farm'] }).reject));
    ok('when the site cannot be read, Google\'s travel_agency type is enough', !scoreAgency({ phone: '1', siteRead: false, abroad: null, types: ['travel_agency'] }).reject);

    const OPTS = [...OPTIONS, { slug: 'naples', name: 'נאפולי', nameLocal: 'Naples', country: 'איטליה', haystack: 'נאפולי | naples' }, { slug: 'jerusalem', name: 'ירושלים', nameLocal: 'Jerusalem', country: 'ישראל', haystack: 'ירושלים | jerusalem | ישראל' }];
    eq('a post that names a city gets that city', postDestination('רומא', 'נאפולי', OPTS, ['rome'], ['ישראל'])?.slug, 'rome');
    eq('a post that names only the region gets the searched city in it', postDestination('דרום איטליה', 'נאפולי', OPTS, ['rome'], ['ישראל'])?.slug, 'naples');
    eq('a hike in Israel is not a destination (the site plans trips abroad)', postDestination('צפון ישראל', 'נאפולי', OPTS, ['rome'], ['ישראל']), null);
    eq('not even Jerusalem by name', postDestination('ירושלים', '', OPTS, [], ['ישראל']), null);
    eq('a post found for a place the site lacks (Corfu) does not become the country default (Athens)', postDestination('יוון', 'קורפו', OPTS, ['athens'], ['ישראל']), null);
    eq('a post that names nothing gets what was searched', postDestination('', 'נאפולי', OPTS, [], ['ישראל'])?.slug, 'naples');
    const himachal = { slug: 'himachal', name: 'הימאצ׳ל והרי ההימלאיה', nameLocal: 'Himachal', country: 'הודו', haystack: 'הימאצל | הימלאיה' };
    const nepal = new Set(['נפאל', 'הודו', 'יוון']);
    ok('a post that names Nepal is not filed in India, Himalaya or not', !destinationSupported(himachal, { destination: 'נפאל', places: ['ההימלאיה'] }, { countries: nepal }));
    ok('the same Himalaya post with no country named may be', destinationSupported(himachal, { destination: 'ההימלאיה', places: [] }, { countries: nepal }));
    ok('a comment claiming personal experience is refused', checkDraft('אני מכיר את הצפון טוב, שווה לעלות', { kind: 'comment' }).some((p) => /personal travel experience/.test(p)));

    eq('a TikTok id carries its upload time', tiktokTime('6718335390845095173')?.slice(0, 10), '2019-07-27');
    eq('a TikTok video URL parses', tiktokPost('https://www.tiktok.com/@a.b/video/7400000000000000001?lang=he')?.handle, 'a.b');
    eq('an Instagram handle comes from the indexed title', instagramPost({ url: 'https://www.instagram.com/reel/AbCdEf123/', title: 'Noa (@noa.trips) • Instagram reel', description: '' })?.handle, 'noa.trips');
    eq('"12.5K Followers" is 12,500', parseFollowers('12.5K Followers, 300 Following'), 12500);
    // A real shortcode seen in search results on 2026-10-10, posted that spring.
    ok('an Instagram shortcode carries its post date', /^2026-0[3-5]/.test(instagramTime('DXmTeByChYx') || ''), instagramTime('DXmTeByChYx'));
    eq('and nonsense carries none', instagramTime('!!'), null);
    eq('search snippets lose their highlight tags and entities', cleanText('<strong>טיול</strong> &quot;כשר&quot; &amp; זול'), 'טיול "כשר" & זול');
    eq('an Instagram caption loses the account counter line', stripIgCounts('12K Followers, 2,846 Following, 1,455 Posts - Galit (@blogalit) on Instagram: המלצות לפאפוס'), 'המלצות לפאפוס');
    ok('TikTok queries carry "video", without which the index returns topic pages', todaysSearches(S, { now: NOW, dests: [{ he: 'אתונה' }] }).brave.filter((q) => q.platform === 'tiktok').every((q) => / video$/.test(q.text)));

    const sample = agencySample({ site: { options: OPTIONS, itineraries: [{ slug: 'athens', days: 5 }, { slug: 'rome', days: 5 }] } }, agency(1));
    ok('an agency sample is a live itinerary page', /^\/itinerary\/(athens|rome)\/5$/.test(sample.path));
  }

  /* ---------------------------------------------------------- GA4 */

  {
    eq('without credentials, GA4 says what is needed', ga4Missing({}).length, 3);
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwt = jwtFor({ client_email: 'desk@x.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }, NOW);
    const [h, c, sig] = jwt.split('.');
    const verify = createVerify('RSA-SHA256');
    verify.update(`${h}.${c}`);
    ok('the GA4 assertion is signed correctly', verify.verify(publicKey, Buffer.from(sig.replace(/-/g, '+').replace(/_/g, '/'), 'base64')));
    eq('and asks only to read', JSON.parse(Buffer.from(c, 'base64').toString()).scope, 'https://www.googleapis.com/auth/analytics.readonly');
  }

  /* ---------------------------------------------------------- pages and buttons */

  {
    const state = emptyState();
    const drafted = { variants: [{ text: 'ראיתי את העלייה לליקבטוס. כדאי להגיע לפני השקיעה', score: 2, tells: [], specific: { quote: 'מסלול', source: 'title' } }] };
    state.leads['tt:@maker1'] = creator(1, { posts: [{ ...creator(1).posts[0], title: '<script>alert(1)</script> מסלול', drafts: drafted }] });
    state.leads['ag:place1'] = agency(1, { agencyDest: { slug: 'athens', he: 'אתונה', path: '/itinerary/athens/5' } });
    state.leads['cust:tt:@asker1'] = customer(1);
    const templates = readTemplates();
    const ctx = { state, settings: S, token: 't', now: NOW, templates };
    const pages = {
      today: todayPage({ ...ctx, day: pickToday(state, S, NOW), env: {} }),
      lead: leadPage({ ...ctx, lead: state.leads['tt:@maker1'] }),
      leads: leadsPage({ ...ctx, query: {} }),
      reports: reportsPage({ ...ctx, ga4: { configured: false, missing: ga4Missing({}) } }),
      settings: settingsPage(ctx),
    };
    for (const [name, html] of Object.entries(pages)) {
      ok(`${name}: English, left to right`, html.includes('lang="en" dir="ltr"'));
      ok(`${name}: no long dash anywhere on the page`, !hasLongDash(html));
    }
    ok('Hebrew content sits in its own right-to-left blocks', ['today', 'lead', 'settings'].every((n) => pages[n].includes('dir="rtl" lang="he"')));
    ok('a caption is shown as text, never as markup', !pages.today.includes('<script>alert') && pages.today.includes('&lt;script&gt;'));
    ok('Today has the four columns', ['Comments', 'Creators', 'Agencies', 'Questions'].every((t) => pages.today.includes(t)));
    ok('the lead page has every button, in plain words', ['Copy &amp; open', 'Edit', 'Redraft', 'She', 'He', 'Unknown', 'Sent', 'Skip', 'They replied', 'Interested', 'Not for us'].every((t) => pages.lead.includes(`>${t}<`)));
    ok('the card shows the bot score', pages.lead.includes('Bot score 2/10'));
    ok('the internal counts sit behind Details', !/older than the age limit/.test(pages.today.split('<details class="details">')[0] || ''));

    // The summary says what to do, in a person's words.
    const s1 = emptyState();
    for (let i = 1; i <= 16; i++) s1.leads[`ag:place${i}`] = agency(i);
    const day = pickToday(s1, S, NOW);
    const words = todaySummary(s1, day, S, NOW);
    ok('the summary leads with what is ready and says why nothing new was looked for', /^No new creators today\./.test(words) && /16 agencies are still waiting for you, so I didn't look for more\./.test(words), words);

    const tmp = join(REPO, 'data', '.selftest-growth.json');
    rmSync(tmp, { force: true });
    const store = openStore(tmp);
    Object.assign(store.data.leads, state.leads);
    const ops = createOps({ store, env: {}, clock: () => NOW, deps: { runDiscovery: async () => {}, prepareToday: async () => {} } });
    const bad = await ops.post('/api/lead/ag:place1/action', { action: 'edit', field: 'message:0', text: 'הנה https://evil.example' });
    ok('an edit with a foreign URL is refused', Boolean(bad.error), JSON.stringify(bad));
    const dash = await ops.post('/api/lead/ag:place1/action', { action: 'edit', field: 'message:0', text: 'שלום \u2014 עולם' });
    ok('an edit with a long dash is refused', Boolean(dash.error));
    const good = await ops.post('/api/lead/ag:place1/action', { action: 'edit', field: 'message:0', text: 'שלום, זו הודעה שלי' });
    ok('a clean edit is saved, and is what gets copied', good.ok && compose(store.data.leads['ag:place1'], 'message', { templates, settings: S, state: store.data, i: 0 }).text === 'שלום, זו הודעה שלי');
    ok('settings out of range are refused', Boolean((await ops.post('/api/settings', { settings: { runHour: 30 } })).error));
    ok('settings in range are saved', (await ops.post('/api/settings', { settings: { caps: { comment: 8 } } })).ok && mergeSettings(store.data.settings).caps.comment === 8);
    ok('the store file is the one it was given, never the posting store', existsSync(tmp) && !/store\.json$/.test(store.path));
    // A file written before the one-time changes existed gets them when it is opened.
    writeFileSync(tmp, JSON.stringify({ v: 1, settings: { budgetUsd: 40 }, leads: {} }));
    const old = openStore(tmp).data;
    ok('a live desk file without the list gets the pause when it opens', old.settings.agencyPaused === true && old.settings.budgetUsd === 40 && old.applied.includes('agency-pause-2026-10-11'));
    writeFileSync(tmp, JSON.stringify({ v: 1, settings: { agencyPaused: false }, leads: {}, applied: ['agency-pause-2026-10-11'] }));
    eq('and once only: unticked, it stays unticked', openStore(tmp).data.settings.agencyPaused, false);
    rmSync(tmp, { force: true });
    eq('a new desk (no file) is not paused', openStore(tmp).data.settings.agencyPaused, undefined);
    rmSync(tmp, { force: true });
  }

  /* ---------------------------------------------------------- the bot tells, in code */

  {
    const refused = (text, kind = 'comment', opts = {}) => tellsIn(text, { kind, ...opts }).length > 0;
    for (const t of [...CONNECTIVES, ...FORMAL, ...PRAISE]) ok(`refused: "${t.p}"`, refused(`${t.p} אפשר לעלות לגבעה בשקיעה`));
    ok('with a one-letter prefix: "ובנוסף"', refused('ובנוסף אפשר לעלות לגבעה'));
    ok('inside a word it is not: "שניתן"', refused('המקום שניתן לראות משם'));
    ok('with niqqud', refused('בְּנוֹסָף אפשר לעלות'));
    ok('"נקודה שמתחברת", the owner\'s example', refused('נקודה שמתחברת לעניין המוניות'));
    // The owner's own examples of what good looks like pass every check.
    const goodAgency = 'היי, נתנאל כאן 🙂 ראיתי שאתם עושים טיולים מאורגנים למצרים עם כשרות. בניתי אתר שמכין מסלולים בעברית עם זמני שבת וכשרות לכל יום. הנה דוגמה לסיני: [קישור]. אם בא לכם, שלחו לי בקשה של לקוח ואכין לו מסלול בחינם.';
    eq('the owner\'s good agency message passes', tellsIn(goodAgency, { kind: 'message' }).map((t) => t.msg).join('; '), '');
    eq('the owner\'s good taxi comment passes', tellsIn('המוניות שם זה סיפור 😅 ה-BTS וה-MRT מגיעים לרוב המקומות, ממוזגים וגם זולים יותר. ואם כבר מונית, רק עם מונה או Grab').map((t) => t.msg).join('; '), '');
    eq('and the palace one, colon and all', tellsIn('טיפ לארמון המלכותי: להגיע ממש בפתיחה, לפני החום וההמונים. וכתפיים וברכיים מכוסות, אחרת לא נכנסים').map((t) => t.msg).join('; '), '');

    const bad = 'היי, אני נתנאל מטיול+. בנינו כלי שמכין ללקוחות מסלול יום-יום בעברית: מפה, ניווט לכל יום, זמני שבת לכל עיר ונספח כשרות. הנה https://www.tiyulplus.com/itinerary/prague/5?utm_source=agency';
    const why = tellsIn(bad, { kind: 'message' }).map((t) => t.msg).join(' | ');
    ok('the old agency message is refused for "we"', /first person plural/.test(why), why);
    ok('for its brochure colon', /a colon/.test(why), why);
    ok('and for its list of features', /a list of three/.test(why), why);
    ok('a semicolon is refused', refused('עולים בבוקר; יורדים בערב'));
    ok('a summing-up last sentence is refused', refused('עולים מוקדם. בקיצור, שווה'));
    ok('an exclamation mark is refused', refused('איזה נוף מטורף!'));
    ok('two emoji are refused', refused('נוף מטורף 😍😍'));
    ok('a colon in a clock time is not a tell', !refused('הפתיחה ב-08:00 והתור קצר'));

    // Length, by kind: a reaction to a video is short, an answer to a question has more room.
    eq('a comment of 170 characters passes', tellsIn('א'.repeat(170)).filter((t) => t.code === 'length').length, 0);
    ok('a comment of 171 is refused', tellsIn('א'.repeat(171)).some((t) => t.code === 'length'));
    ok('a comment of three sentences is refused', tellsIn('עולים מוקדם. יורדים בצהריים. אוכלים בשוק.').some((t) => t.code === 'length'));
    eq('a reply to a question may be 250 characters in three sentences', tellsIn(`${'א'.repeat(80)}. ${'ב'.repeat(80)}. ${'ג'.repeat(80)}.`, { kind: 'reply' }).filter((t) => t.code === 'length').length, 0);
    ok('but not 281', tellsIn('א'.repeat(281), { kind: 'reply' }).some((t) => t.code === 'length'));
    ok('nor four sentences', tellsIn('א. ב. ג. ד.', { kind: 'reply' }).some((t) => t.code === 'length'));
    ok('a first message over 380 is refused', tellsIn(`${'א'.repeat(370)} [קישור]`, { kind: 'message' }).some((t) => t.code === 'length'));
    eq('and the link counts as 25 characters, whatever its length', lengthOf(`שלום ${'x'.repeat(0)}https://tiyulplus.com/trips/a-very-long-slug-that-goes-on-and-on-forever`), 4 + 25);
    ok('a message with no link is refused', tellsIn('היי, נתנאל כאן', { kind: 'message' }).some((t) => t.code === 'link'));
    ok('and with two', tellsIn('היי [קישור] ועוד [קישור]', { kind: 'message' }).some((t) => t.code === 'link'));

    // @tiyulplus has never travelled, and Netanel is one person.
    for (const p of ['הייתי שם', 'ניסינו', 'אנחנו עשינו']) {
      ok(`fake experience refused in a comment: "${p}"`, tellsIn(`${p} את זה וזה שווה`).some((t) => t.code === 'experience'));
      ok(`and in a message: "${p}"`, tellsIn(`${p} את זה [קישור]`, { kind: 'message' }).some((t) => t.code === 'experience'));
    }
    ok('"בניתי" and "הכנתי" are how he talks', !tellsIn('בניתי אתר והכנתי לכם דוגמה: [קישור]', { kind: 'message' }).some((t) => t.code === 'experience' || t.code === 'phrase'));

    // Gender: unknown is the default, and then nobody is "את" or "מי שנוסעת".
    ok('a singular "you" is refused when the gender is unknown', tellsIn('אם תרצי אני אשלח').some((t) => t.code === 'gender'));
    ok('so is "ומי שנוסעת", the owner\'s example', tellsIn('ומי שנוסעת במונית, רק עם מונה').some((t) => t.code === 'gender'));
    ok('both are fine for a woman', !tellsIn('אם תרצי, ומי שנוסעת במונית', { gender: 'f' }).some((t) => t.code === 'gender'));
    ok('"מי שרוצה" is the same word for everybody', !tellsIn('מי שרוצה לעלות, בבוקר').some((t) => t.code === 'gender'));
    ok('the prompt for an unknown gender asks for the plural', /plural/.test(addressLine('unknown', 'creator')) && /feminine/.test(addressLine('f', 'creator')));
    const old = migrate({ leads: { a: { gender: 'f', genderFrom: 'default' }, b: { gender: 'f', genderFrom: 'post' } } });
    ok('a gender nobody established becomes unknown; one the post showed stays', old.leads.a.gender === 'unknown' && old.leads.b.gender === 'f');
    const store = memStore();
    await runDiscovery({ store, settings: S, now: NOW, deps: fakeDeps({ classify: async (posts) => posts.map(() => ({ hebrew: true, kind: 'creator', destination: 'אתונה', places: [], routeDemand: false, gender: null, reason: '' })) }), env: ENV });
    const found = Object.values(store.data.leads)[0];
    eq('a new lead whose post says nothing is unknown, not female', found?.gender, 'unknown');
  }

  /* ---------------------------------------------------------- the one specific thing */

  {
    const sources = { title: 'סיור בגנים של וינה: Belvedere ו-Volksgarten', description: 'הגן הכי יפה בעיר', comment: ['איפה הכי שווה לשבת?'] };
    eq('a draft that uses a real quote passes', specificProblem('הגנים של וינה בשקיעה זה משהו', { quote: 'בגנים של וינה', source: 'title' }, { ...sources, title: 'סיור בגנים של וינה' }), null);
    ok('a quote that is not in the source it names fails', Boolean(specificProblem('הגנים של וינה', { quote: 'הגנים של פריז', source: 'title' }, sources)));
    ok('a quote from another source fails', Boolean(specificProblem('איפה לשבת', { quote: 'איפה הכי שווה לשבת', source: 'description' }, sources)));
    ok('a quote from a viewer\'s comment passes', !specificProblem('הכי שווה לשבת בבלוודרה', { quote: 'איפה הכי שווה לשבת', source: 'comment' }, sources));
    ok('a draft that does not use the detail it quotes fails', Boolean(specificProblem('יפה מאוד שם', { quote: 'הגן הכי יפה בעיר', source: 'description' }, { ...sources, description: 'הגן הכי מרשים בעיר' })));
    ok('no detail at all fails', Boolean(specificProblem('יפה', null, sources)));
  }

  /* ---------------------------------------------------------- drafting, with a stand-in model */

  {
    // The whole loop: three drafts, one refused by code and asked for again, the
    // reviewer's scores, a rewrite that passes, and the second look at it.
    const lead = creator(9, { name: 'נועה טיולים', handle: 'noa', gender: 'unknown' });
    const post = { ...lead.posts[0], platform: 'youtube', title: 'שקיעה בליקבטוס עם כל העיר מתחת', description: 'עלינו ברגל', topComments: [{ text: 'כמה זמן העלייה?', likes: 3 }] };
    const draftsOut = (variants) => ({ firstName: 'נועה', variants });
    const answers = [
      draftsOut([
        { text: 'השקיעה מליקבטוס עם כל העיר מתחת, זה בדיוק הרגע', specific: { quote: 'שקיעה בליקבטוס', source: 'title' } },
        { text: 'בנוסף, בליקבטוס יש רכבל', specific: { quote: 'שקיעה בליקבטוס', source: 'title' } },
        { text: 'לשאלה כמה זמן העלייה: ברגל זה חלק מהכיף', specific: { quote: 'כמה זמן העלייה', source: 'comment' } },
      ]),
      draftsOut([{ text: 'עם כל העיר מתחת קשה לרדת משם, ושווה להישאר לאורות', specific: { quote: 'כל העיר מתחת', source: 'title' } }]),
      { reviews: [
        { index: 0, botScore: 2, tells: [], factProblem: '', rewrite: '' },
        { index: 1, botScore: 6, tells: ['too polished'], factProblem: '', rewrite: 'כמה זמן העלייה? ברגל זה חצי מהכיף שם' },
        { index: 2, botScore: 1, tells: [], factProblem: '', rewrite: '' },
      ] },
      { reviews: [{ index: 0, botScore: 2, tells: [], factProblem: '', rewrite: '' }] },
    ];
    const calls = [];
    setClient({
      messages: {
        create: async (body) => {
          calls.push(body);
          const next = answers.shift();
          return { model: body.model, stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 50 }, content: [{ type: 'text', text: JSON.stringify(next) }] };
        },
      },
    });
    const state = emptyState();
    const out = await draftItem('comment', { state, settings: S, lead, post, site: 'יעד: אתונה' });
    eq('four calls: draft, the redo of the refused one, review, the second look at a rewrite', calls.length, 4);
    ok('the refused draft went back with its reason', /בנוסף/.test(calls[1].messages[0].content) && /AI opener/.test(calls[1].messages[0].content));
    eq('three variants on the card', out.variants.length, 3);
    ok('each with the reviewer\'s score, best first', out.variants.every((v) => Number.isInteger(v.score)) && out.variants[0].score <= out.variants[2].score);
    const rw = out.variants.find((v) => v.rewritten);
    ok('the rewrite replaced its draft and was scored again', rw && rw.score === 2 && rw.originalScore === 6 && /חצי מהכיף/.test(rw.text));
    ok('every variant passed the code checks', out.variants.every((v) => !tellsIn(v.text).length));
    ok('the drafting model is Opus 5.5 by default, and so is the reviewer', calls[0].model === 'claude-opus-5-5' && calls[2].model === 'claude-opus-5-5');
    ok('no thinking parameter is sent (it cannot be turned off on these models)', calls.every((b) => !('thinking' in b)));
    ok('and the fallback is asked for', calls.every((b) => b.fallbacks === 'default'));
    ok('the cost is in the ledger', monthSpend(state, S, NOW).rows.claude?.units === 4);

    // A fact the reviewer cannot find in the context is not offered while a clean
    // variant remains (the proof run's London season, said of the South Downs).
    const fine = (q) => ({ text: `השקיעה מליקבטוס ${q}`, specific: { quote: 'שקיעה בליקבטוס', source: 'title' } });
    const review = (flags) => ({ reviews: flags.map((f, index) => ({ index, botScore: 2, tells: [], factProblem: f, rewrite: '' })) });
    const run = async (flags) => {
      const queue = [draftsOut([fine('עם כל העיר'), fine('בערב'), fine('בקיץ')]), review(flags)];
      setClient({ messages: { create: async (body) => ({ model: body.model, stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: JSON.stringify(queue.shift()) }] }) } });
      return draftItem('comment', { state: emptyState(), settings: S, lead, post, site: 'יעד: אתונה' });
    };
    const flagged = await run(['', 'the season is not in the context', '']);
    ok('a variant with a fact the reviewer could not find is dropped', flagged.variants.length === 2 && flagged.variants.every((v) => !v.factProblem) && flagged.droppedForFacts === 1);
    const allFlagged = await run(['x', 'y', 'z']);
    ok('when every variant is flagged they stay, each with its warning', allFlagged.variants.length === 3 && allFlagged.variants.every((v) => v.factProblem));
    setClient(null);
  }

  /* ---------------------------------------------------------- the agency's example */

  {
    const options = [
      ...OPTIONS,
      { slug: 'sinai', name: 'סיני', nameLocal: 'Sinai', country: 'מצרים', haystack: 'סיני | sinai' },
      { slug: 'samarkand', name: 'סמרקנד', nameLocal: 'Samarkand', country: 'אוזבקיסטן', haystack: 'סמרקנד | samarkand' },
      { slug: 'prague', name: 'פראג', nameLocal: 'Prague', country: 'צ׳כיה', haystack: 'פראג | prague' },
    ];
    const state = { ...emptyState(), site: { options, itineraries: [{ slug: 'athens', days: 5 }, { slug: 'prague', days: 5 }] } };
    const fallback = (st, l) => ({ slug: 'prague', he: 'פראג', path: '/itinerary/prague/5' });
    const egypt = agency(1, { name: 'עמק המלכים - טיולים מאורגנים למצרים', profile: { destinations: [{ name: 'מצרים' }, { name: 'סין' }, { name: 'אוזבקיסטן' }] } });
    const ex1 = chooseExample(state, egypt, { fallback, preferred: [] });
    ok('an agency that sells Egypt gets a route in Egypt, never Prague', ex1.kind === 'route' && ex1.slug === 'sinai', JSON.stringify(ex1));
    ok('and the card says why', /They sell מצרים, סין, אוזבקיסטן/.test(ex1.reason));
    eq('the agency\'s own name is enough when its site says nothing', chooseExample(state, agency(2, { name: 'טיולים מאורגנים למצרים' }), { fallback, preferred: [] }).slug, 'sinai');
    eq('a country resolves to the city this audience flies to', chooseExample(state, agency(3, { profile: { destinations: [{ name: 'יוון' }] } }), { fallback, preferred: ['athens'] }).slug, 'athens');
    const none = chooseExample(state, agency(4, { profile: { destinations: [{ name: 'פטגוניה' }] } }), { fallback, preferred: [] });
    ok('nothing they sell in our catalog: a route on one of our most complete destinations, with the reason', none.kind === 'route' && none.fallback && none.slug === 'prague' && /None of what they sell \(פטגוניה\) is in our catalog, so the example is a route on פראג/.test(none.reason), JSON.stringify(none));
    const links = tripLinks('<a href="/trips/egypt">טיולים למצרים</a><a href="/about">אודות</a><a href="https://other.example/trips">x</a><a href="/destinations">יעדים</a><a href="/blog/x">טיול</a>', 'https://agency.co.il/');
    eq('their own trip pages are followed, two at most, same site only', links.join(' '), 'https://agency.co.il/trips/egypt https://agency.co.il/destinations');
  }

  /* ---------------------------------------------------------- agency routes go public, inside the limit */

  {
    const store = memStore();
    store.data.site = { options: OPTIONS, itineraries: [{ slug: 'athens', days: 5 }] };
    store.data.leads['ag:place1'] = agency(1, { score: 90 });
    store.data.leads['ag:place2'] = agency(2, { score: 10 });
    const published = [];
    const deps = {
      cityFor: async () => CITY,
      draftItem: async () => ({ variants: [{ text: 'היי, נתנאל כאן. הנה דוגמה לאתונה: [קישור]', score: 1, tells: [] }] }),
      fillVideoContext: async () => 0,
      readAgencySite: async () => ({ text: 'טיולים מאורגנים ליוון' }),
      extractProfile: async () => ({ siteText: 'טיולים מאורגנים ליוון', destinations: [{ name: 'יוון', quote: 'ליוון' }], clientele: [], tripTypes: [] }),
      publishRoute: async (l) => (published.push(l.id), { status: 'published', url: `https://www.tiyulplus.com/trips/${l.id}`, slug: 'x', externalId: externalIdFor(l), publishedAt: new Date(NOW).toISOString() }),
      shortLink: async () => null,
      brave: async () => [],
      checkRoute: async (route) => ({ status: 'pass', issues: [], stops: [], days: route.days.length, stopCount: route.stops, routeKey: routeKey(route), checkedAt: new Date(NOW).toISOString() }),
    };
    const one = { ...S, caps: { ...S.caps, agency: 1 } };
    const KEY = { ANTHROPIC_API_KEY: 'test' };
    await prepareToday({ store, settings: one, now: NOW, deps, env: KEY });
    eq('a sample route goes public only for the agency picked for today', published.join(), 'ag:place1');
    const a1 = store.data.leads['ag:place1'];
    ok('on a city they sell, built from our catalog', a1.route?.citySlug === 'athens' && a1.route.days.every((d) => d.placeIds.every((id) => CITY.places.some((p) => p.id === id))));
    ok('and the card shows the route before anything is sent', todayPage({ state: store.data, settings: one, token: 't', now: NOW, templates: readTemplates(), day: pickToday(store.data, one, NOW), env: {} }).includes('Their example'));
    ok('the message carries the route page, plain', compose(a1, 'message', { templates: readTemplates(), settings: one, state: store.data }).text.includes('https://tiyulplus.com/trips/ag:place1'));

    // The site's limit is one number for creators and agencies together.
    const full = memStore();
    full.data.site = store.data.site;
    full.data.leads['tt:@maker1'] = creator(1, { trip: { status: 'published', url: 'u', publishedAt: new Date(NOW - 3_600_000).toISOString() } });
    full.data.leads['ag:place3'] = agency(3);
    const limited = { ...S, publishPerDay: 1 };
    eq('one page up in the last day fills a limit of one', canPublishNew(full.data, limited, NOW), false);
    await prepareToday({ store: full, settings: limited, now: NOW, deps, env: KEY });
    eq('so the agency waits, and says why', full.data.leads['ag:place3'].trip?.status, 'waiting-limit');
    eq('a day later it may go up', canPublishNew(full.data, limited, NOW + 86_400_000), true);

    const withdrawn = [];
    const ops = createOps({ store, env: {}, clock: () => NOW, deps: { runDiscovery: async () => {}, prepareToday: async () => {}, withdrawRoute: async (l) => (withdrawn.push(l.id), { ...l.trip, status: 'withdrawn' }) } });
    await ops.post('/api/lead/ag:place1/action', { action: 'skip' });
    ok('[Skip] takes the agency\'s route down', withdrawn.join() === 'ag:place1' && store.data.leads['ag:place1'].trip.status === 'withdrawn');
  }

  /* ---------------------------------------------------------- the route check (owner, 2026-10-11) */

  {
    // Florence at the site's zoom 13, with a day trip to Pisa in the catalog.
    const GEO = {
      slug: 'florence', name: 'פירנצה', nameLocal: 'Florence', zoom: 13, center: { lat: 43.7696, lng: 11.2558 },
      places: [
        { id: 'f1', name: 'הדואומו', nameLocal: 'Duomo', lat: 43.7731, lng: 11.2569 },
        { id: 'f2', name: 'אופיצי', nameLocal: 'Uffizi', lat: 43.7678, lng: 11.2553 },
        { id: 'f3', name: 'פונטה וקיו', nameLocal: 'Ponte Vecchio', lat: 43.768, lng: 11.2531 },
        { id: 'f4', name: 'סיניוריה', nameLocal: 'Piazza della Signoria', lat: 43.7696, lng: 11.2556 },
        { id: 'f5', name: 'בובולי', nameLocal: 'Boboli Gardens', lat: 43.7625, lng: 11.2483 },
        { id: 'f6', name: 'סנטה קרוצ\'ה', nameLocal: 'Santa Croce', lat: 43.7686, lng: 11.2622 },
        { id: 'f7', name: 'מיכלאנג\'לו', nameLocal: 'Piazzale Michelangelo', lat: 43.7629, lng: 11.2651 },
        { id: 'f8', name: 'פיאזולה', nameLocal: 'Fiesole', lat: 43.8066, lng: 11.2939 },
        { id: 'pisa', name: 'פיזה', nameLocal: 'Leaning Tower of Pisa', lat: 43.723, lng: 10.3966 },
        { id: 'pisa-bapt', name: 'הבפטיסטריום', nameLocal: 'Pisa Baptistery', lat: 43.7233, lng: 10.3944 },
        { id: 'lucca', name: 'לוקה', nameLocal: 'Lucca', lat: 43.8429, lng: 10.5027 },
      ],
    };
    const route = { days: [{ placeIds: ['f1', 'f2', 'f3', 'f4'] }, { placeIds: ['f5', 'f6', 'f7', 'f8'] }] };
    const place = (id) => GEO.places.find((p) => p.id === id);
    const found = (id, over = {}) => ({ found: true, name: place(id).nameLocal, status: 'OPERATIONAL', lat: place(id).lat, lng: place(id).lng, country: 'IT', pinKm: 0.1, ...over });
    const facts = (r, over = {}) => Object.fromEntries(r.days.flatMap((d) => d.placeIds).map((id) => [id, over[id] || found(id)]));
    const judge = (r, over) => judgeRoute(r, GEO, facts(r, over));

    eq('a city route of two days, four open stops each, passes', judge(route).status, 'pass', judge(route).issues.join(' | '));
    eq('Florence at zoom 13 is a city', scaleOf(GEO), 'city');
    ok('and its frame is about 14 km', frameKm(GEO) > 13 && frameKm(GEO) < 15, String(frameKm(GEO)));
    eq('Sinai at zoom 8 is a region', scaleOf({ zoom: 8 }), 'region');
    eq('Dubai at zoom 11 is an area, not a compact city', scaleOf({ zoom: 11 }), 'area');
    ok('about 550 km across its frame', Math.abs(frameKm({ zoom: 8, center: { lat: 28.6 } }) - 550) < 10, String(frameKm({ zoom: 8, center: { lat: 28.6 } })));

    const short = { days: [{ placeIds: ['f1', 'f2', 'f3', 'f4'] }, { placeIds: ['f5', 'f6'] }] };
    ok('a day of two short stops fails', judge(short).issues.some((i) => /Day 2 has 2 stops, none of them long; a day needs 3 stops, or 2 when one takes 3 hours or more/.test(i)), judge(short).issues.join(' | '));
    eq('three stops are a day (the owner: four was too strict)', judge({ days: [route.days[0], { placeIds: ['f5', 'f6', 'f7'] }] }).status, 'pass');
    const longBoboli = { ...GEO, places: GEO.places.map((p) => (p.id === 'f5' ? { ...p, durationMin: 180 } : p)) };
    eq('and two are, when one of them takes three hours', judgeRoute(short, longBoboli, facts(short)).status, 'pass');
    ok('one day fails', judge({ days: [route.days[0]] }).issues.some((i) => /1 day; a sample route needs at least 2/.test(i)));
    ok('a stop closed for good fails', judge(route, { f3: found('f3', { status: 'CLOSED_PERMANENTLY' }) }).issues.some((i) => /"Ponte Vecchio" is closed for good on Google/.test(i)));
    ok('and one closed for now', judge(route, { f3: found('f3', { status: 'CLOSED_TEMPORARILY' }) }).issues.some((i) => /closed for now/.test(i)));
    ok('a stop Google cannot find near our pin fails, with the distance', judge(route, { f5: { found: false, nearestKm: 3.24 } }).issues.some((i) => /"Boboli Gardens" was not found on Google near our pin \(the nearest match is 3\.2 km away\)/.test(i)));
    const town = judge(route, { f8: found('f8', { status: null }) });
    ok('a town has no business status, and that is not "closed"', town.status === 'pass' && town.stops.find((s) => s.id === 'f8').status === null);
    const trip = { days: [{ placeIds: ['f1', 'f2', 'f3', 'pisa'] }, { placeIds: ['f5', 'f6', 'f7', 'f8'] }] };
    const far = judge(trip);
    ok('a day trip squeezed between city stops fails', far.issues.some((i) => /Day 1 squeezes a day trip between city stops: "Leaning Tower of Pisa" is 69 km from the centre of Florence, outside the destination \(14 km\)/.test(i)), far.issues.join(' | '));
    const dayOut = { days: [route.days[0], { placeIds: ['pisa', 'pisa-bapt', 'lucca'] }] };
    const whole = judge(dayOut);
    ok('a day trip that is the whole day passes, its stops a drive apart (16 km)', whole.status === 'pass' && whole.dayTrips === 1, whole.issues.join(' | '));
    ok('but not further out than a day allows', judgeRoute(dayOut, GEO, facts(dayOut), { ...ROUTE_RULES, dayTripKm: 50 }).issues.some((i) => /too far for a day trip \(50 km\)/.test(i)));
    ok('and its hop from the last stop is not a sensible day', far.issues.some((i) => /Day 1: "Ponte Vecchio" to "Leaning Tower of Pisa" is \d+ km; on a city route a day's stops stay within 10 km/.test(i)));
    ok('a stop missing from the catalog fails', judgeRoute({ days: [{ placeIds: ['f1', 'f2', 'f3', 'nope'] }, route.days[1]] }, GEO, facts(route)).issues.some((i) => /"nope" is not in the site's catalog/.test(i)));

    // findOnGoogle takes the first answer within 2 km of our pin, not the first answer.
    const answer = (name, lat, lng, status = 'OPERATIONAL') => ({ displayName: { text: name }, businessStatus: status, location: { latitude: lat, longitude: lng }, addressComponents: [{ types: ['country', 'political'], shortText: 'IT' }] });
    const asked = [];
    const post = async (url, body, opts) => (asked.push({ url, body, opts }), { places: [answer('Uffizi Gift Shop, Rome', 41.9, 12.49), answer('Uffizi Gallery', 43.7678, 11.2553)] });
    const hit = await findOnGoogle(place('f2'), { env: { GOOGLE_MAPS_KEY: 'k' }, post });
    ok('the match is the one near our pin', hit.found && hit.name === 'Uffizi Gallery' && hit.asks === 1);
    ok('asked by its local name, biased to our pin', asked[0].body.textQuery === 'Uffizi' && asked[0].body.locationBias.circle.center.latitude === 43.7678 && asked[0].opts.headers['x-goog-fieldmask'].includes('places.businessStatus'));
    const miss = await findOnGoogle(place('f2'), { env: { GOOGLE_MAPS_KEY: 'k' }, post: async () => ({ places: [answer('Uffizi Gift Shop, Rome', 41.9, 12.49)] }) });
    ok('nothing near the pin is not found, with the nearest distance', !miss.found && miss.nearestKm > 200);
    // A town, a park, a lake: Google's point for it can be kilometres from our pin,
    // and our pin is inside the area Google draws for it (Hakone, 9 km).
    const townArea = { ...answer('Fiesole', 43.84, 11.33), viewport: { low: { latitude: 43.78, longitude: 11.25 }, high: { latitude: 43.86, longitude: 11.36 } } };
    ok('a town whose area holds our pin is found', (await findOnGoogle(place('f8'), { env: { GOOGLE_MAPS_KEY: 'k' }, post: async () => ({ places: [townArea] }) })).found);
    const country = { ...answer('Italy', 41.87, 12.56), viewport: { low: { latitude: 35.5, longitude: 6.6 }, high: { latitude: 47.1, longitude: 18.5 } } };
    ok('a country-sized area does not stand in for a stop', !(await findOnGoogle(place('f8'), { env: { GOOGLE_MAPS_KEY: 'k' }, post: async () => ({ places: [country] }) })).found);
    // A plain name ("Old Market"; Rome's kosher "Yotvata" found the kibbutz) is
    // asked again with the destination's name.
    const queries = [];
    const twice = await findOnGoogle(place('f2'), { cityName: 'Florence', env: { GOOGLE_MAPS_KEY: 'k' }, post: async (u, body) => (queries.push(body.textQuery), { places: [queries.length === 1 ? answer('Uffizi, Israel', 29.9, 35.06) : answer('Uffizi Gallery', 43.7678, 11.2553)] }) });
    ok('a plain name is asked again with the destination, and found', twice.found && twice.asks === 2 && queries.join(' | ') === 'Uffizi | Uffizi, Florence', queries.join(' | '));

    // checkRoute: once per place a month, recorded as Places calls, an error is not a verdict.
    const state = emptyState();
    let calls = 0;
    const fake = async (url, body) => {
      calls++;
      const p = GEO.places.find((x) => x.nameLocal === body.textQuery);
      return { places: [answer(p.nameLocal, p.lat, p.lng)] };
    };
    const first = await checkRoute(route, GEO, { state, settings: S, env: { GOOGLE_MAPS_KEY: 'k' }, now: NOW, post: fake });
    ok('a real check of eight stops asks Google eight times and passes', calls === 8 && first.status === 'pass' && first.routeKey === routeKey(route), JSON.stringify(first.issues));
    eq('each ask is a Places call in the budget', state.spend[Object.keys(state.spend)[0]].places.units, 8);
    await checkRoute(short, GEO, { state, settings: S, env: { GOOGLE_MAPS_KEY: 'k' }, now: NOW + DAY, post: fake });
    eq('the same places a day later are not asked again', calls, 8);
    GEO.places[0] = { ...GEO.places[0], lat: 43.78 };
    await checkRoute(route, GEO, { state, settings: S, env: { GOOGLE_MAPS_KEY: 'k' }, now: NOW + DAY, post: fake });
    eq('a place whose pin moved is asked again', calls, 9);
    GEO.places[0] = { ...GEO.places[0], lat: 43.7731 };
    const refusedState = emptyState();
    const down = await checkRoute(route, GEO, { state: refusedState, settings: S, env: { GOOGLE_MAPS_KEY: 'k' }, now: NOW, post: async () => { throw new Error('HTTP 503'); } });
    ok('Google down is "could not run", not a failed route', down.status === 'error' && /HTTP 503/.test(down.error));
    ok('and a refused call is not billed, so not recorded', !Object.keys(refusedState.spend).length);
    eq('and with no key it says so', (await checkRoute(route, GEO, { state: emptyState(), settings: S, env: {}, now: NOW })).error, 'GOOGLE_MAPS_KEY is missing from .env');

    // The desk: a route that fails is not published, not drafted, and has no send button.
    const store = memStore();
    store.data.site = { options: OPTIONS, itineraries: [{ slug: 'athens', days: 5 }] };
    store.data.leads['ag:place1'] = agency(1, { score: 90 });
    store.data.leads['ag:place5'] = agency(5, { score: 80 });
    const published = [];
    let drafted = 0;
    let verdict = { status: 'fail', issues: ['Day 2 has 3 stops; each day needs at least 4.'], stops: [], days: 2, stopCount: 6 };
    const deps = {
      cityFor: async () => CITY,
      draftItem: async () => (drafted++, { variants: [{ text: 'היי, נתנאל כאן. הנה דוגמה לאתונה: [קישור]', score: 1, tells: [] }] }),
      fillVideoContext: async () => 0,
      readAgencySite: async () => ({ text: 'טיולים מאורגנים ליוון' }),
      extractProfile: async () => ({ siteText: 'טיולים מאורגנים ליוון', destinations: [{ name: 'יוון', quote: 'ליוון' }], clientele: [], tripTypes: [] }),
      publishRoute: async (l) => (published.push(l.id), { status: 'published', url: `https://www.tiyulplus.com/trips/${l.id}`, slug: 'x', externalId: externalIdFor(l), publishedAt: new Date(NOW).toISOString() }),
      shortLink: async () => null,
      brave: async () => [],
      checkRoute: async (r) => ({ ...verdict, routeKey: routeKey(r), checkedAt: new Date(NOW).toISOString() }),
    };
    const one = { ...S, caps: { ...S.caps, agency: 1 } };
    const KEY = { ANTHROPIC_API_KEY: 'test' };
    await prepareToday({ store, settings: one, now: NOW, deps, env: KEY });
    const aside = store.data.leads['ag:place1'];
    ok('a failed route is not published', published.length === 0 && !aside.trip);
    eq('and no message is written for it', drafted, 0);
    ok('it gives its slot back: set aside, off Today, never picked again', Boolean(aside.routeSetAside) && !pickToday(store.data, one, NOW).agency.includes(`agency:${aside.id}:message`) && aside.history.some((h) => /set aside/.test(h.what)));
    await prepareToday({ store, settings: one, now: NOW + 1000, deps, env: KEY });
    const lead = store.data.leads['ag:place5'];
    ok('the next agency takes the slot, and past the day\'s set-asides a failure stays on Today', pickToday(store.data, one, NOW).agency.includes(`agency:${lead.id}:message`) && !lead.routeSetAside);
    const page = () => todayPage({ state: store.data, settings: one, token: 't', now: NOW, templates: readTemplates(), day: pickToday(store.data, one, NOW), env: {} });
    ok('the card shows the check and its issues', page().includes('Route check: 1 issue') && page().includes('Day 2 has 3 stops'));
    ok('with no send button: no Copy & open, no Sent', !page().includes('data-act="sent"') && !page().includes('data-copy-open'));
    ok('the lead page has no Sent either', !leadPage({ state: store.data, settings: one, token: 't', now: NOW, templates: readTemplates(), lead, env: {} }).includes('data-act="sent"'));
    ok('it is not counted as ready', !/agency message ready/.test(todaySummary(store.data, pickToday(store.data, one, NOW), one, NOW)));
    lead.drafts = { message: { variants: [{ text: 'היי [קישור]', score: 1, tells: [] }] } };
    ok('a drafted message under a failed route says why it cannot go', compose(lead, 'message', { templates: readTemplates(), settings: one, state: store.data }).missing.some((m) => /failed its check/.test(m)));
    let refused = null;
    try {
      applyAction(store.data, lead, 'sent', {}, { now: NOW, settings: one });
    } catch (e) {
      refused = e;
    }
    ok('and "Sent" is refused by the rules too', refused instanceof RuleError && refused.code === 'route' && !lead.messagedAt);

    verdict = { status: 'pass', issues: [], stops: [], days: 2, stopCount: 8 };
    delete lead.routeCheck;
    delete lead.drafts;
    await prepareToday({ store, settings: one, now: NOW + 60_000, deps, env: KEY });
    ok('a route that passes is published and written', published.join() === 'ag:place5' && drafted === 1);
    ok('the Agencies column names the one set aside', page().includes('Set aside today') && page().includes(`/lead/${encodeURIComponent(aside.id)}`));
    eq('the published trip remembers the route it shows', lead.trip.routeKey, routeKey(lead.route));
    ok('with the passed badge and the send buttons', page().includes('Route check: passed') && page().includes('data-act="sent"') && page().includes('data-copy-open'));

    const errStore = memStore();
    errStore.data.site = store.data.site;
    errStore.data.leads['ag:place2'] = agency(2, { score: 90 });
    verdict = { status: 'error', error: 'Google Places did not answer', issues: [] };
    await prepareToday({ store: errStore, settings: one, now: NOW, deps, env: KEY });
    ok('a check that could not run holds the message too', !errStore.data.leads['ag:place2'].trip && errStore.data.leads['ag:place2'].routeCheck.status === 'error');
  }

  /* ---------------------------------------------------------- the route builder (owner, 2026-10-11) */

  {
    // Florence at zoom 13 (a 14 km frame): a curated day with a day trip squeezed
    // in, a short day, a closed cafe, and a lone day trip nothing is near.
    const P = (id, name, nameLocal, lat, lng, durationMin, extra = {}) => ({ id, name, nameLocal, lat, lng, durationMin, rating: 4.5, ...extra });
    const PIN = {
      slug: 'florence', name: 'פירנצה', nameLocal: 'Florence', zoom: 13, center: { lat: 43.7696, lng: 11.2558 },
      places: [
        P('f1', 'הדואומו', 'Duomo', 43.7731, 11.2569, 90, { mustSee: true }),
        P('f2', 'אופיצי', 'Uffizi', 43.7678, 11.2553, 180),
        P('f3', 'פונטה וקיו', 'Ponte Vecchio', 43.768, 11.2531, 30),
        P('f4', 'סיניוריה', 'Piazza della Signoria', 43.7696, 11.2556, 30),
        P('f5', 'בובולי', 'Boboli Gardens', 43.7625, 11.2483, 120),
        P('f6', 'סנטה קרוצ\'ה', 'Santa Croce', 43.7686, 11.2622, 60),
        P('f7', 'מיכלאנג\'לו', 'Piazzale Michelangelo', 43.7629, 11.2651, 45),
        P('f8', 'פיאזולה', 'Fiesole', 43.8066, 11.2939, 120),
        P('f9', 'סן דומניקו', 'San Domenico', 43.7985, 11.2833, 60),
        P('f10', 'סטיניאנו', 'Settignano', 43.785, 11.32, 60),
        P('c1', 'קפה סגור', 'Closed Cafe', 43.805, 11.292, 30),
        P('pisa', 'פיזה', 'Leaning Tower of Pisa', 43.723, 10.3966, 120, { mustSee: true }),
        P('pisa-bapt', 'הבפטיסטריום', 'Pisa Baptistery', 43.7233, 10.3944, 45),
        P('lucca', 'לוקה', 'Lucca', 43.8429, 10.5027, 180),
        P('siena', 'סיינה', 'Siena', 43.3188, 11.3308, 240),
      ],
      itinerary: [
        { day: 1, title: 'המרכז', placeIds: ['f1', 'f2', 'f3', 'f4'] },
        { day: 2, title: 'מעבר לארנו', placeIds: ['f5', 'f6', 'pisa', 'f7'] },
        { day: 3, title: 'פיאזולה', placeIds: ['f8', 'c1'] },
        { day: 4, title: 'סיינה', placeIds: ['siena'] },
      ],
    };
    const open = (r) => Object.fromEntries(r.days.flatMap((d) => d.placeIds).map((id) => [id, { found: true, status: 'OPERATIONAL' }]));
    const r = buildRoute(PIN, {});
    const ids = r.days.map((d) => d.placeIds);
    eq('the site\'s whole day stays as it is, with its title', [ids[0].join(), r.days[0].title].join(' | '), 'f1,f2,f3,f4 | המרכז');
    eq('a day trip squeezed into a city day is pulled out: the city stops stay a day', ids[1].join(), 'f5,f6,f7');
    ok('and the day trip becomes a whole day, filled from the catalog near it', r.days[2].dayTrip && ids[2].slice().sort().join() === 'lucca,pisa,pisa-bapt', JSON.stringify(ids[2]));
    ok('a short day takes the nearest catalog places, with every hop within the limit', ids[3].includes('f8') && ids[3].length >= 3, JSON.stringify(ids[3]));
    ok('a lone day trip nothing is near is dropped, and the change says so', !ids.flat().includes('siena') && r.changes.some((c) => /Dropped a day trip of the site's day 4 \(Siena\)/.test(c)), r.changes.join(' | '));
    eq('the route passes the check it was built for', judgeRoute(r, PIN, open(r)).status, 'pass', judgeRoute(r, PIN, open(r)).issues.join(' | '));
    eq('it says which builder made it', r.builder, BUILDER);
    ok('only a day still the site\'s whole day keeps the site\'s title', r.days[1].title === '' && r.days[2].title === '');
    const named = buildRoute(PIN, { places: ['פיאזולה'], days: 2 });
    ok('a creator\'s named place leads, on a day it fits', named.days.length === 2 && named.days[0].placeIds.includes('f8') && named.matched[0].id === 'f8');
    ok('a stop Google says is closed is left out, and the day is filled around it', !buildRoute(PIN, { exclude: ['c1'] }).days.flatMap((d) => d.placeIds).includes('c1'));

    // The desk's loop: build, check, rebuild without what Google says is closed.
    const state = emptyState();
    const iso = new Date(NOW).toISOString();
    let rounds = 0;
    const check = async (route, c, { state: st }) => {
      rounds++;
      if (route.days.some((d) => d.placeIds.includes('c1'))) {
        st.placeChecks = { c1: { at: iso, query: 'Closed Cafe', pin: '43.805,11.292', answer: { found: true, status: 'CLOSED_PERMANENTLY' } } };
        return { status: 'fail', issues: ['"Closed Cafe" is closed for good on Google.'], routeKey: routeKey(route), checkedAt: iso };
      }
      return { status: 'pass', issues: [], routeKey: routeKey(route), checkedAt: iso };
    };
    const ready = await readyRoute(PIN, { state, settings: S, now: NOW, deps: { checkRoute: check } });
    ok('a route that fails on a closed stop is rebuilt without it and passes', ready.check.status === 'pass' && rounds === 2 && !ready.route.days.flatMap((d) => d.placeIds).includes('c1'), `${rounds} ${JSON.stringify(ready.route.days.map((d) => d.placeIds))}`);
    ok('the closed stop is known from then on, for any route on that city', knownBad(state, PIN, { now: NOW }).has('c1'));
    const again = await readyRoute(PIN, { state, settings: S, now: NOW + 60_000, route: ready.route, check: ready.check, deps: { checkRoute: check } });
    ok('a ready route and its fresh check are reused, not asked again', again.route === ready.route && rounds === 2);
    const hopeless = await readyRoute(PIN, { state: emptyState(), settings: S, now: NOW, deps: { checkRoute: async (route) => ({ status: 'fail', issues: ['Day 1 has 2 stops'], routeKey: routeKey(route), checkedAt: iso }) } });
    ok('a failure with nothing to leave out stops after one round', hopeless.check.status === 'fail');

    // The routes already sent are rebuilt and re-sent to the same page.
    const store = memStore();
    store.data.site = { options: OPTIONS, itineraries: [{ slug: 'florence', days: 4 }] };
    const sent = agency(6, {
      stage: 'messaged',
      messagedAt: new Date(NOW - DAY).toISOString(),
      example: { kind: 'route', slug: 'florence', he: 'פירנצה' },
      route: { citySlug: 'florence', cityName: 'פירנצה', days: [{ citySlug: 'florence', placeIds: ['f1', 'pisa'], names: [] }, { citySlug: 'florence', placeIds: ['siena'], names: [] }], stops: 3 },
      routeCheck: { status: 'fail', issues: ['x'], routeKey: 'old', checkedAt: iso },
      trip: { status: 'published', url: 'https://www.tiyulplus.com/trips/florence-2-ab12', slug: 'florence-2-ab12', externalId: 'growth:ag:place6', publishedAt: new Date(NOW - DAY).toISOString() },
    });
    store.data.leads[sent.id] = sent;
    const resent = [];
    let verdict = 'fail';
    const deps = {
      cityFor: async () => PIN,
      draftItem: async () => ({ variants: [] }),
      fillVideoContext: async () => 0,
      publishRoute: async (l) => (resent.push({ id: l.id, days: l.route.days.length }), { status: 'published', url: 'https://www.tiyulplus.com/trips/florence-2-ab12', slug: 'florence-2-ab12', externalId: externalIdFor(l), publishedAt: l.trip.publishedAt }),
      shortLink: async () => null,
      brave: async () => [],
      checkRoute: async (route) => ({ status: verdict, issues: verdict === 'pass' ? [] : ['still failing'], stops: [], days: route.days.length, stopCount: 9, routeKey: routeKey(route), checkedAt: iso }),
    };
    const quiet = { ...S, agencyPaused: true };
    await prepareToday({ store, settings: quiet, now: NOW, deps, env: {} });
    ok('a rebuilt route that fails its check is not sent: the page they have stays', resent.length === 0 && sent.trip.url.endsWith('florence-2-ab12') && sent.routeRefresh?.check?.status === 'fail' && sent.route.days[0].placeIds.join() === 'f1,pisa');
    verdict = 'pass';
    delete sent.routeRefresh;
    await prepareToday({ store, settings: quiet, now: NOW + 60_000, deps, env: {} });
    ok('once it passes, it is re-sent under the same externalId, to the same address', resent.length === 1 && resent[0].id === sent.id && sent.trip.url === 'https://www.tiyulplus.com/trips/florence-2-ab12' && sent.route.builder === BUILDER);
    ok('the lead keeps the new route and its check, and says so', sent.routeCheck.status === 'pass' && sent.trip.routeKey === routeKey(sent.route) && sent.history.some((h) => /route rebuilt and re-sent to the same page/.test(h.what)) && !sent.routeRefresh);
    await prepareToday({ store, settings: quiet, now: NOW + 120_000, deps, env: {} });
    eq('and it is not sent again', resent.length, 1);

    // A page example of an agency not yet messaged becomes a route on the same kind of city.
    const pageStore = memStore();
    pageStore.data.site = { options: [...OPTIONS, { slug: 'florence', name: 'פירנצה', nameLocal: 'Florence', country: 'איטליה', haystack: 'פירנצה' }], itineraries: [{ slug: 'florence', days: 4 }] };
    pageStore.data.leads['ag:place7'] = agency(7, { score: 90, profile: { siteText: '', destinations: [], clientele: [], tripTypes: [] }, example: { kind: 'page', slug: 'florence', he: 'פירנצה', path: '/itinerary/florence/4', reason: 'old' }, agencyDest: { slug: 'florence', path: '/itinerary/florence/4' } });
    await prepareToday({ store: pageStore, settings: { ...S, caps: { ...S.caps, agency: 1 } }, now: NOW, deps, env: {} });
    const pg = pageStore.data.leads['ag:place7'];
    ok('a page example is chosen again, as a route built from the itinerary', pg.example.kind === 'route' && pg.example.fallback && !pg.agencyDest && pg.route?.builder === BUILDER, JSON.stringify(pg.example));
  }

  /* ---------------------------------------------------------- paused: the next agencies in line made ready (owner, 2026-10-11) */

  {
    const store = memStore();
    store.data.site = { options: OPTIONS, itineraries: [{ slug: 'athens', days: 5 }] };
    for (const [n, score] of [[41, 90], [42, 85], [43, 80], [44, 75]]) store.data.leads[`ag:place${n}`] = agency(n, { score });
    const published = [];
    let drafted = 0;
    let reads = 0;
    const failing = new Set();
    const deps = {
      cityFor: async () => CITY,
      draftItem: async () => (drafted++, { variants: [] }),
      fillVideoContext: async () => 0,
      readAgencySite: async () => (reads++, { text: 'טיולים מאורגנים ליוון' }),
      extractProfile: async () => ({ siteText: 'טיולים מאורגנים ליוון', destinations: [{ name: 'יוון', quote: 'ליוון' }], clientele: [], tripTypes: [] }),
      publishRoute: async (l) => (published.push(l.id), { status: 'published', url: 'x', slug: 'x', externalId: externalIdFor(l), publishedAt: new Date(NOW).toISOString() }),
      shortLink: async () => null,
      brave: async () => [],
      checkRoute: async (route, c, { now }) => ({ status: 'pass', issues: [], stops: [], days: route.days.length, stopCount: 6, routeKey: routeKey(route), checkedAt: new Date(now).toISOString() }),
    };
    const paused = { ...S, agencyPaused: true };
    const KEY = { ANTHROPIC_API_KEY: 'test' };
    eq('next in line: the three the column takes once unpaused', nextInLine(store.data, paused, NOW).map((l) => l.id).join(), 'ag:place41,ag:place42,ag:place43');
    await prepareToday({ store, settings: paused, now: NOW, deps, env: KEY });
    const line = nextInLine(store.data, paused, NOW);
    ok('paused, the next three in line are made ready: site read, route built and checked', reads === 3 && line.every((l) => l.profile && l.route && l.routeCheck?.status === 'pass'));
    ok('and nothing goes out: not published, not drafted, not on Today', published.length === 0 && drafted === 0 && !pickToday(store.data, paused, NOW).agency.length);
    ok('lineState says they are ready', line.every((l) => lineState(l).ready));
    const page = todayPage({ state: store.data, settings: paused, token: 't', now: NOW, templates: readTemplates(), day: pickToday(store.data, paused, NOW), env: {} });
    ok('the Agencies column lists them with where they stand', page.includes('Next in line, made ready meanwhile') && page.includes('סוכנות 41: route passed'));
    eq('the fourth is not touched', store.data.leads['ag:place44'].profile, undefined);

    // Unpaused, the desk picks the same three with the same routes, and does not check them again.
    const keys = line.map((l) => routeKey(l.route));
    let asked = 0;
    const counting = { ...deps, checkRoute: async (...a) => (asked++, deps.checkRoute(...a)) };
    const open = { ...S, agencyPaused: false };
    await prepareToday({ store, settings: open, now: NOW + 60_000, deps: counting, env: KEY });
    ok('unpaused, they are picked with the routes that passed, not checked again, then published and drafted', asked === 0 && line.every((l, i) => routeKey(l.route) === keys[i]) && published.length === 3 && drafted === 3, `${asked} ${published.length} ${drafted}`);

    // A route that still fails is set aside, and the next agency moves into line.
    const s2 = memStore();
    s2.data.site = store.data.site;
    for (const [n, score] of [[51, 90], [52, 85], [53, 80], [54, 75]]) s2.data.leads[`ag:place${n}`] = agency(n, { score });
    const fail52 = { ...deps, checkRoute: async (route, c, o) => (failingFor(route, c, o)) };
    function failingFor(route, c, { now }) {
      return { status: failing.size ? 'fail' : 'pass', issues: failing.size ? ['x'] : [], stops: [], days: route.days.length, stopCount: 6, routeKey: routeKey(route), checkedAt: new Date(now).toISOString() };
    }
    failing.add('all');
    await prepareToday({ store: s2, settings: paused, now: NOW, deps: fail52, env: KEY });
    ok('paused, a route that fails is set aside like on Today, up to the day\'s cap', ['ag:place51', 'ag:place52', 'ag:place53'].every((id) => s2.data.leads[id].routeSetAside));
    eq('and the next agency moves into line', nextInLine(s2.data, paused, NOW).map((l) => l.id)[0], 'ag:place54');
  }

  /* ---------------------------------------------------------- runs by hand count in the ledger (owner, 2026-10-11) */

  {
    const dir = mkdtempSync(join(tmpdir(), 'growth-ledger-'));
    try {
      const storePath = join(dir, 'growth.json');
      const inbox = inboxDir(storePath);
      const month = '2026-10';
      const before = { [month]: { places: { units: 5, usd: 0.175 } } };
      const after = { [month]: { places: { units: 115, usd: 4.025 }, claude: { units: 12, usd: 0.4 } } };
      const delta = spendDelta(before, after);
      ok('a script\'s spend is what it added', delta[month].places.units === 110 && Math.abs(delta[month].places.usd - 3.85) < 1e-9 && delta[month].claude.units === 12, JSON.stringify(delta));
      dropSpend(inbox, { source: 'scripts/growth-route-check.js', at: '2026-10-11T16:47:12.000Z', spend: delta, placeChecks: { x1: { at: '2026-10-11T16:47:12.000Z', query: 'X', pin: '1,2', answer: { found: true, status: 'OPERATIONAL' } } } });
      writeFileSync(join(inbox, 'zz-broken.json'), '{ not json');

      const state = emptyState();
      state.spend = { [month]: { places: { units: 20, usd: 0.7 } } };
      const pending = structuredClone(state);
      foldInbox(pending, inbox, { move: false });
      ok('a script counts what is still waiting in the inbox, and leaves it there', pending.spend[month].places.units === 130 && readdirSync(inbox).filter((f) => f.endsWith('.json')).length === 2);

      const order = [];
      const desk = { data: state, save: () => order.push('save'), path: storePath };
      const ops = createOps({ store: desk, env: {}, clock: () => NOW, deps: { runDiscovery: async () => {}, prepareToday: async () => {}, withdrawClosed: async () => 0 } });
      await ops.tick();
      ok('the desk folds it into its ledger on its tick', state.spend[month].places.units === 130 && Math.abs(state.spend[month].claude.usd - 0.4) < 1e-9);
      ok('with the Google answers it paid for, so the desk does not ask again', state.placeChecks.x1?.answer?.found === true);
      ok('saved before the file moves to used/, and a broken file goes to rejected/', order[0] === 'save' && existsSync(join(inbox, 'used')) && readdirSync(join(inbox, 'used')).length === 1 && readdirSync(join(inbox, 'rejected')).join() === 'zz-broken.json');
      await ops.tick();
      eq('folded once only', state.spend[month].places.units, 130);
      const report = reportsPage({ state, settings: S, token: 't', now: NOW, ga4: { configured: false, missing: [] } });
      ok('Reports says which runs by hand are in the month', report.includes('Included above: 1 run by hand, scripts/growth-route-check.js on 2026-10-11, $4.25 list price'), report.slice(report.indexOf('budget'), report.indexOf('budget') + 1500));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  /* ---------------------------------------------------------- outcomes of a message (owner, 2026-10-11) */

  {
    const store = memStore();
    const state = store.data;
    const a = agency(7, { whatsapp: '+972 50-123-4567', messagedAt: new Date(NOW).toISOString(), stage: 'messaged' });
    const c = creator(8, { source: 'instagram', profileUrl: 'https://www.instagram.com/maker8', messagedAt: new Date(NOW).toISOString(), stage: 'messaged', warmedAt: new Date(NOW - DAY).toISOString() });
    const quiet = agency(9, { phone: null, email: 'hi@agency9.co.il', messagedAt: new Date(NOW).toISOString(), stage: 'messaged' });
    for (const l of [a, c, quiet]) state.leads[l.id] = l;

    eq('a lead is waiting for an outcome once messaged', awaitingOutcome(state).length, 3);
    const today = todayPage({ state, settings: S, token: 't', now: NOW + DAY, templates: readTemplates(), day: pickToday(state, S, NOW + DAY), env: {} });
    ok('Today lists them under "Waiting for a reply"', today.includes('Waiting for a reply') && today.includes('the follow-up comes back on Today on'));
    ok('each card carries the four outcomes', ['data-act="replied"', 'data-act="yes"', 'data-act="no"', 'data-act="no-reply"'].every((x) => today.includes(x)));
    ok('and the lead page too', leadPage({ state, settings: S, token: 't', now: NOW, templates: readTemplates(), lead: a, env: {} }).includes('data-act="no-reply"'));

    applyAction(state, a, 'replied', {}, { now: NOW + DAY, settings: S });
    applyAction(state, a, 'yes', {}, { now: NOW + DAY, settings: S });
    eq('replied, then interested', [Boolean(a.repliedAt), a.stage].join(), 'true,yes');
    ok('an interested lead leaves the waiting list', !awaitingOutcome(state).includes(a));
    const r = applyAction(state, c, 'no-reply', {}, { now: NOW + 2 * DAY, settings: S });
    ok('"No reply" closes a messaged lead, and its page comes down', c.closed === 'no-reply' && r.withdraw);
    ok('without putting them on the do-not-contact list', !JSON.stringify(state.dnc || {}).includes('no-reply'));
    let refused = null;
    try {
      applyAction(state, agency(10), 'no-reply', {}, { now: NOW, settings: S });
    } catch (e) {
      refused = e;
    }
    ok('and is refused for a lead never messaged', refused instanceof RuleError && refused.code === 'not-messaged');

    // Silent: the follow-up after 5 days, once, then closed 5 days after it.
    eq('no follow-up after 4 days', followupDue(quiet, { now: NOW + 4 * DAY, followupDays: S.followupDays }), false);
    ok('it comes back on Today after 5, inside the cap', pickToday(state, S, NOW + 5 * DAY).agency.includes(`agency:${quiet.id}:followup`));
    applyAction(state, quiet, 'sent', {}, { now: NOW + 5 * DAY, settings: S });
    eq('nothing closes 4 days after the follow-up', closeSilent(state, { now: NOW + 9 * DAY, followupDays: S.followupDays }).length, 0);
    const closed = closeSilent(state, { now: NOW + 10 * DAY, followupDays: S.followupDays });
    ok('5 days after it, still silent: closed as no reply', closed.length === 1 && quiet.closed === 'no-reply' && quiet.history.some((h) => /no reply after the follow-up/.test(h.what)));
    const replied = agency(11, { messagedAt: new Date(NOW).toISOString(), followupSentAt: new Date(NOW + 5 * DAY).toISOString(), repliedAt: new Date(NOW + 6 * DAY).toISOString(), stage: 'replied' });
    state.leads[replied.id] = replied;
    eq('a lead that replied is never closed as silent', closeSilent(state, { now: NOW + 30 * DAY, followupDays: 5 }).length, 0);

    // The channel the message went out on, recorded at Sent, and Reports by channel.
    eq('a WhatsApp link is WhatsApp', channelOf('https://wa.me/972501234567'), 'WhatsApp');
    eq('mailto is Email', channelOf('mailto:x@y.co'), 'Email');
    eq('an Instagram profile is Instagram', channelOf('https://www.instagram.com/maker8'), 'Instagram');
    const fresh = memStore();
    const b = agency(12, { whatsapp: '+972 50-765-4321' });
    fresh.data.leads[b.id] = b;
    const ops = createOps({ store: fresh, env: {}, clock: () => NOW, deps: { runDiscovery: async () => {}, prepareToday: async () => {}, withdrawRoute: async (l) => l.trip } });
    await ops.post(`/api/lead/${b.id}/action`, { action: 'sent' });
    eq('Sent records the channel it went out on', b.channel, 'WhatsApp');
    const rows = byChannel(Object.values(state.leads));
    const wa = rows.find((x) => x.channel === 'WhatsApp');
    ok('Reports count messaged, replied, interested per channel', wa && wa.messaged === 2 && wa.replied === 2 && wa.yes === 1 && wa.noReply === 0, JSON.stringify(rows));
    ok('and no reply', rows.find((x) => x.channel === 'Instagram')?.noReply === 1 && rows.find((x) => x.channel === 'Email')?.noReply === 1);
    const report = reportsPage({ state, settings: S, token: 't', now: NOW, ga4: { configured: false, missing: [] } });
    ok('the Reports page shows the table', report.includes('Messages by channel') && report.includes('<td>WhatsApp</td>'));

    // An Agencies column that is empty because today's cap is used says so.
    const capped = memStore();
    for (let n = 20; n < 25; n++) capped.data.leads[`ag:place${n}`] = agency(n);
    const d = pickToday(capped.data, S, NOW);
    for (const k of d.agency) applyAction(capped.data, capped.data.leads[parseItem(k).leadId], 'sent', {}, { now: NOW, settings: S });
    const page = todayPage({ state: capped.data, settings: S, token: 't', now: NOW, templates: readTemplates(), day: d, env: {} });
    ok('a full day of agencies says the cap, and how many wait', page.includes(`${S.caps.agency} agency messages are done`) && page.includes('2 agencies still waiting'));

    // Paused: no new agency messages, and the follow-ups still come.
    const paused = { ...S, agencyPaused: true };
    const p = memStore();
    for (let n = 30; n < 33; n++) p.data.leads[`ag:place${n}`] = agency(n);
    const owed = agency(33, { messagedAt: new Date(NOW - 6 * DAY).toISOString(), stage: 'messaged' });
    p.data.leads[owed.id] = owed;
    const pd = pickToday(p.data, paused, NOW);
    ok('paused, the Agencies column takes no new message', !pd.agency.some((k) => k.endsWith(':message')), JSON.stringify(pd.agency));
    ok('and still takes the follow-up that is owed', pd.agency.includes(`agency:${owed.id}:followup`));
    const p2 = memStore();
    for (let n = 30; n < 33; n++) p2.data.leads[`ag:place${n}`] = agency(n);
    const pausedPage = todayPage({ state: p2.data, settings: paused, token: 't', now: NOW, templates: readTemplates(), day: pickToday(p2.data, paused, NOW), env: {} });
    ok('the empty column says it is paused, and how many wait', pausedPage.includes('New agency messages are paused in Settings; 3 agencies waiting'));
    ok('Settings has the switch', settingsPage({ state: p2.data, settings: paused, token: 't', now: NOW, templates: readTemplates() }).includes('name="agencyPaused" checked'));
    const live = migrate({ leads: {}, settings: { budgetUsd: 40 } });
    ok('the live desk starts paused, once, keeping its other settings', live.settings.agencyPaused === true && live.settings.budgetUsd === 40 && live.applied.includes('agency-pause-2026-10-11'));
    live.settings.agencyPaused = false;
    eq('unticked, it stays unticked', migrate(live).settings.agencyPaused, false);
    eq('a new desk is not paused', migrate(emptyState()).settings.agencyPaused, undefined);
  }

  /* ---------------------------------------------------------- learning from what was sent */

  {
    const state = emptyState();
    const lead = creator(1, { posts: [{ ...creator(1).posts[0], drafts: { variants: [{ text: 'בנוסף, שווה לעלות בשקיעה', score: 3 }, { text: 'שווה לעלות בשקיעה', score: 1 }] } }] });
    state.leads[lead.id] = lead;
    const pid = lead.posts[0].id;
    noteCopied(lead, { what: 'comment', postId: pid, variant: 1, text: 'שווה לעלות ממש בשקיעה', draft: 'שווה לעלות בשקיעה', at: NOW });
    const rec = recordSent(state, lead, { what: 'comment', postId: pid, at: NOW });
    ok('copy then sent writes the draft, the sent text and the variant', rec && rec.draft === 'שווה לעלות בשקיעה' && rec.sent === 'שווה לעלות ממש בשקיעה' && rec.variant === 1 && rec.edited === true);
    noteCopied(lead, { what: 'dm', variant: 0, text: 'x', draft: 'x', at: NOW });
    const final = recordSent(state, lead, { what: 'dm', final: 'מה ששלחתי באמת', at: NOW });
    ok('the text pasted after sending wins', final.sent === 'מה ששלחתי באמת' && final.kind === 'creator' && final.edited);
    eq('nothing copied and nothing pasted logs nothing', recordSent(state, lead, { what: 'dm', at: NOW }), null);
    for (let i = 0; i < 12; i++) state.sentLog.push({ at: new Date(NOW + i).toISOString(), kind: 'comment', sent: `תגובה ${i}`, draft: `טיוטה ${i}`, edited: true });
    const ex = examplesFor(state, 'comment');
    ok('few-shot is the last ten of that kind, newest first', ex.length === 10 && ex[0] === 'תגובה 11' && ex[9] === 'תגובה 2');
    ok('and never another kind', !examplesFor(state, 'agency').length && !examplesFor(state, 'comment').includes('מה ששלחתי באמת'));
    const s2 = emptyState();
    for (let i = 0; i < 3; i++) s2.sentLog.push({ at: new Date(NOW).toISOString(), kind: 'comment', variant: 0, draft: 'בנוסף שווה לעלות בשקיעה', sent: 'שווה לעלות בשקיעה', edited: true });
    const w = weeklyEdits(s2, NOW);
    ok('the weekly diff names what you usually cut', w.removed[0]?.phrase === 'בנוסף' && w.removed[0].count === 3, JSON.stringify(w.removed));
    ok('and how much shorter you make them', w.avgLengthChange < 0 && w.edited === 3 && w.variants[0] === 3);
    ok('Reports shows it', reportsPage({ state: s2, settings: S, token: 't', now: NOW, ga4: { configured: false, missing: [] } }).includes('You usually cut'));
  }

  /* ---------------------------------------------------------- budget, at Fable's and Opus's prices */

  {
    ok('Fable 5.1 is billed at $10 in and $50 out', Math.abs(claudeCost({ input_tokens: 1e6, output_tokens: 1e6 }, 'claude-fable-5-1') - 60) < 1e-9);
    ok('Opus 5.5 at $4 and $20', Math.abs(claudeCost({ input_tokens: 1e6, output_tokens: 1e6 }, 'claude-opus-5-5') - 24) < 1e-9);
    ok('a cache read at the model\'s own rate', Math.abs(claudeCost({ cache_read_input_tokens: 1e6 }, 'claude-fable-5-1') - 0.25) < 1e-9);
    ok('an unknown model is billed at the dearest rate in the table, not half of it', claudeCost({ input_tokens: 1e6 }, 'claude-typo') === claudeCost({ input_tokens: 1e6 }, 'claude-fable-5-1') && WORST.in === 10);
    eq('the default cap is $50', S.budgetUsd, 50);
    const state = emptyState();
    record(state, 'claude', { usd: 49.9, now: NOW });
    let stopped = false;
    try {
      guard(state, S, 'claude', draftEstimate('claude-fable-5-1'), NOW);
    } catch (e) {
      stopped = e instanceof BudgetError;
    }
    ok('the guard refuses a Fable call that would cross the cap, before it is made', stopped && draftEstimate('claude-fable-5-1') > 0.1);
  }

  /* ---------------------------------------------------------- short links */

  {
    const lead = creator(1);
    const state = emptyState();
    const TOKEN = { GROWTH_PUBLISH_TOKEN: 'x'.repeat(40) };
    const url = 'https://www.tiyulplus.com/trips/athens-4-ab12cd34';
    const missing = async () => {
      throw Object.assign(new Error('not found'), { status: 404 });
    };
    eq('with no short-link endpoint on the site, the plain link', await shortLinkFor(state, lead, url, { env: TOKEN, post: missing, now: NOW }), 'https://tiyulplus.com/trips/athens-4-ab12cd34');
    let asked = 0;
    await shortLinkFor(state, creator(2), url, { env: TOKEN, post: async () => (asked++, { url: 'https://tiyulplus.com/go/k3f9a' }), now: NOW + 1000 });
    eq('a missing endpoint is not asked again for a day', asked, 0);
    const later = await shortLinkFor(state, creator(3), url, { env: TOKEN, post: async (u, body) => (asked++, { url: 'https://tiyulplus.com/go/k3f9a', body }), now: NOW + 2 * DAY, campaign: 'maker3' });
    ok('the day the site has it, the desk uses it by itself', later === 'https://tiyulplus.com/go/k3f9a' && asked === 1);
    eq('plainLink drops the tags and the www', plainLink('https://www.tiyulplus.com/itinerary/athens/5?utm_source=x'), 'https://tiyulplus.com/itinerary/athens/5');
    ok('a video\'s top comments may be read, never written', Boolean(assertAllowed('GET', 'https://www.googleapis.com/youtube/v3/commentThreads?videoId=x')));
  }

  /* ---------------------------------------------------------- the login */

  {
    const fakeOps = {
      context: () => ({ state: emptyState(), settings: S, templates: readTemplates(), now: NOW, env: {} }),
      today: () => ({ comment: [], creator: [], agency: [], customer: [] }),
      status: () => ({ running: false }),
      post: async () => ({ ok: true }),
      ga4: async () => ({ configured: false, missing: [] }),
    };
    const env = { GROWTH_PASSWORD: 'correct horse battery', GROWTH_PUBLIC_HOST: 'desk.example.test' };
    const server = createServer();
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const { handler, token } = createHandler({ ops: fakeOps, port, env, failDelayMs: 0 });
    server.on('request', handler);
    const local = `127.0.0.1:${port}`;
    const form = (pw) => ({ method: 'POST', path: '/login', headers: { host: local, 'content-type': 'application/x-www-form-urlencoded' }, body: `password=${encodeURIComponent(pw)}` });
    const raw = (opts) =>
      new Promise((done, fail) => {
        const r = request({ host: '127.0.0.1', port, method: opts.method || 'GET', path: opts.path || '/', headers: opts.headers || {} }, (res) => {
          let s = '';
          res.on('data', (d) => (s += d));
          res.on('end', () => done({ status: res.statusCode, headers: res.headers, body: s }));
        });
        r.on('error', fail);
        if (opts.body) r.write(opts.body);
        r.end();
      });
    try {
      const home = await raw({ headers: { host: local } });
      ok('without a session, every page goes to the login', home.status === 302 && home.headers.location === '/login');
      eq('and the API answers 401', (await raw({ path: '/api/status', headers: { host: local } })).status, 401);
      eq('so does a thumbnail', (await raw({ path: '/thumb/tt-1.jpg', headers: { host: local } })).status, 401);
      eq('and a button, even with the page token', (await raw({ method: 'POST', path: '/api/run', headers: { host: local, 'content-type': 'application/json', 'x-growth-token': token }, body: '{}' })).status, 401);
      eq('the login page itself answers', (await raw({ path: '/login', headers: { host: local } })).status, 200);
      eq('a wrong password is refused', (await raw(form('wrong'))).status, 401);
      for (let i = 0; i < 3; i++) await raw(form('wrong'));
      const fifth = await raw(form('wrong'));
      const sixth = await raw(form('correct horse battery'));
      ok('after five wrong passwords even the right one waits, with Retry-After', fifth.status === 401 && sixth.status === 429 && Number(sixth.headers['retry-after']) > 0, `${fifth.status} ${sixth.status}`);
      const fresh = createHandler({ ops: fakeOps, port, env, failDelayMs: 0 });
      server.removeAllListeners('request');
      server.on('request', fresh.handler);
      const good = await raw(form('correct horse battery'));
      const cookie = String(good.headers['set-cookie'] || '');
      ok('the right password logs in with an HttpOnly, SameSite=Strict cookie', good.status === 303 && /HttpOnly/.test(cookie) && /SameSite=Strict/.test(cookie), cookie);
      const viaProxy = await raw({ ...form('correct horse battery'), headers: { ...form('').headers, host: 'desk.example.test', 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.9' } });
      ok('over HTTPS it is Secure, with the __Host- prefix', /^__Host-desk=/.test(String(viaProxy.headers['set-cookie'])) && /Secure/.test(String(viaProxy.headers['set-cookie'])));

      // THE BROWSER'S OWN ORIGIN HEADER. Every post above went without one, as curl
      // does, and a browser never does: in production the login form was refused
      // because no-referrer made Chromium send "Origin: null". These go through the
      // proxy path exactly as Chromium's did through Caddy.
      const viaCaddy = (origin, ip, pw = 'wrong') => ({
        ...form(pw),
        headers: { ...form('').headers, host: 'desk.example.test', 'x-forwarded-proto': 'https', 'x-forwarded-for': ip, origin },
      });
      eq('a browser login from the public origin reaches the password check', (await raw(viaCaddy('https://desk.example.test', '203.0.113.21'))).status, 401);
      eq('and with the right password it logs in', (await raw(viaCaddy('https://desk.example.test', '203.0.113.22', 'correct horse battery'))).status, 303);
      for (const [bad, ip] of [
        ['null', '203.0.113.23'],
        ['https://evil.example', '203.0.113.24'],
        ['http://desk.example.test', '203.0.113.25'],
        ['https://desk.example.test.evil.example', '203.0.113.26'],
      ]) {
        eq(`a login from origin ${bad} is refused`, (await raw(viaCaddy(bad, ip, 'correct horse battery'))).status, 403);
      }
      const loginPage = await raw({ path: '/login', headers: { host: 'desk.example.test', 'x-forwarded-proto': 'https' } });
      eq('the login page lets the browser send its real origin', loginPage.headers['referrer-policy'], 'same-origin');
      const secureSession = String(viaProxy.headers['set-cookie']).split(';')[0];
      const button = await raw({
        method: 'POST',
        path: '/api/run',
        headers: { host: 'desk.example.test', 'x-forwarded-proto': 'https', origin: 'https://desk.example.test', cookie: secureSession, 'content-type': 'application/json', 'x-growth-token': fresh.token },
        body: '{}',
      });
      eq('and a button pressed on the public page goes through', button.status, 200);
      const session = cookie.split(';')[0];
      eq('with the session, Today answers', (await raw({ headers: { host: local, cookie: session } })).status, 200);
      eq('a forged session does not', (await raw({ headers: { host: local, cookie: 'desk=v1.99999999999999.AAAA' } })).status, 302);
      ok('an expired one does not either', !sessionOk(makeSession(authConfig(env), NOW - 31 * DAY), authConfig(env), NOW));
      eq('the public name over plain HTTP is refused', (await raw({ headers: { host: 'desk.example.test', cookie: session } })).status, 403);
      ok('a public desk with no password does not start', Boolean(startProblem({ GROWTH_PUBLIC_HOST: 'desk.example.test' })) && !startProblem(env));

      // A STRANGER CANNOT LOCK THE OWNER OUT. Twenty failures in an hour tighten every
      // address to one try in fifteen minutes, and an address that has not failed
      // still gets its try.
      const { createLimiter } = await import('./web/auth.js');
      const lim = createLimiter();
      for (let i = 0; i < 20; i++) lim.fail(`198.51.100.${Math.floor(i / 5)}`, NOW + i * 1000);
      eq('after twenty failures from four addresses, a fresh one may still try', lim.check('203.0.113.7', NOW + 30_000), null);
      lim.fail('203.0.113.7', NOW + 31_000);
      ok('but only once in fifteen minutes', lim.check('203.0.113.7', NOW + 32_000) > 0);
      ok('and the address that sent them waits too', lim.check('198.51.100.0', NOW + 40_000) > 0);
      const calm = createLimiter();
      calm.fail('192.0.2.1', NOW);
      eq('with nobody attacking, one wrong password leaves more tries', calm.check('192.0.2.1', NOW + 1000), null);
    } finally {
      server.close();
    }
    const broken = createHandler({ ops: { ...fakeOps, today: () => { throw new Error('secret path /var/lib/x'); } }, port: 1, env: {} });
    const out = { status: 0, body: '' };
    const quiet = console.error;
    console.error = () => {};
    await broken.handler({ method: 'GET', url: '/', headers: { host: '127.0.0.1:1' }, socket: {} }, { writeHead: (s) => (out.status = s), end: (b) => (out.body = String(b)) });
    console.error = quiet;
    ok('an error page shows no stack and no path', out.status === 500 && !/secret path|at /.test(out.body), out.body);
  }

  /* ---------------------------------------------------------- one desk */

  {
    const moved = join(REPO, 'data', '.selftest-growth.MOVED');
    writeFileSync(moved, 'https://desk.example.test');
    const r = await main({ env: { GROWTH_ON: '1' }, movedFile: moved });
    rmSync(moved, { force: true });
    ok('a desk next to a growth.MOVED marker does not start', r.on === false && r.moved === true);
  }
}
