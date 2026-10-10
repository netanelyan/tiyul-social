import { generateKeyPairSync, createVerify } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hasLongDash } from '../dashes.js';
import { BudgetError, guard, monthSpend, record } from './budget.js';
import { growthSwitch, mergeSettings, TEMPLATE_NAMES } from './config.js';
import { createOps } from './desk.js';
import { runDiscovery } from './find/index.js';
import { cleanText, instagramPost, instagramTime, parseFollowers, stripIgCounts, tiktokPost, tiktokTime } from './find/brave.js';
import { todaysSearches } from './find/queries.js';
import { scoreAgency, scoreCreator } from './find/score.js';
import { assertAllowed, isSocial, RULES } from './http.js';
import { campaignFor, hasUtm, tagged } from './links.js';
import { compose, linkFor } from './prepare/compose.js';
import { checkDraft, urlsIn } from './prepare/guards.js';
import { agencySample, prepareToday } from './prepare/index.js';
import { externalIdFor, publishRoute, tripBody, withdrawClosed, withdrawRoute } from './prepare/publish.js';
import { buildRoute } from './prepare/route.js';
import { destinationSupported, matchPlaces, postDestination, resolveDestination } from './prepare/site.js';
import { checkTemplate, fill, readTemplates } from './prepare/templates.js';
import { ga4Missing, jwtFor } from './report/ga4.js';
import { applyAction, blockedBy, dmReady, followupDue, ilDate, leadKeys, pickToday, RuleError } from './rules.js';
import { emptyState, openStore } from './store.js';
import { HOST, listen } from './web/server.js';
import { leadPage, leadsPage, reportsPage, settingsPage, todayPage } from './web/pages.js';

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
    const { server, token, port } = await listen({ ops: fakeOps, port: 0 });
    try {
      eq('the server binds to 127.0.0.1 only', server.address().address, '127.0.0.1');
      eq('and the host is a constant, not a setting', HOST, '127.0.0.1');
      const page = await get(port);
      ok('Today answers on 127.0.0.1', page.status === 200 && page.body.includes('dir="rtl"'), `status ${page.status}`);
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

  /* ---------------------------------------------------------- warm-up, one follow-up */

  {
    const state = emptyState();
    const l = (state.leads['tt:@maker1'] = creator(1));
    applyAction(state, l, 'commented', { postId: l.posts[0].id }, { now: NOW, settings: S });
    eq('commenting moves the creator to "commented"', l.stage, 'commented');
    eq('no DM on the day of the comment', dmReady(l, { now: NOW, warmupDays: 1 }), false);
    let threw = null;
    try {
      applyAction(state, l, 'sent', {}, { now: NOW, settings: S });
    } catch (e) {
      threw = e;
    }
    ok('and [נשלח] that day is refused', threw instanceof RuleError && threw.code === 'not-warm');
    eq('the DM is ready the next Israel day', dmReady(l, { now: NOW + DAY, warmupDays: 1 }), true);

    const t0 = NOW + DAY;
    applyAction(state, l, 'sent', {}, { now: t0, settings: S });
    eq('the message is recorded', l.stage, 'messaged');
    const sendAt = (t) => {
      try {
        applyAction(state, l, 'sent', {}, { now: t, settings: S });
        return 'sent';
      } catch (e) {
        return e.code;
      }
    };
    eq('a second message the next day is refused (follow-up not due)', sendAt(t0 + DAY), 'not-due');
    eq('the follow-up is due after 4 days', followupDue(l, { now: t0 + 4 * DAY, followupDays: 4 }), true);
    eq('and can be sent once', sendAt(t0 + 4 * DAY), 'sent');
    eq('then never again', sendAt(t0 + 9 * DAY), 'done');
    eq('and it never comes back to Today', followupDue(l, { now: t0 + 20 * DAY, followupDays: 4 }), false);

    const r = (state.leads['tt:@maker2'] = creator(2, { warmedAt: new Date(NOW - 9 * DAY).toISOString(), messagedAt: new Date(NOW - 6 * DAY).toISOString(), stage: 'messaged' }));
    applyAction(state, r, 'replied', {}, { now: NOW, settings: S });
    eq('a reply cancels the follow-up', followupDue(r, { now: NOW, followupDays: 4 }), false);
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
    const live = { ...lead, trip: t };
    ok('the DM then carries that address, tagged', compose(live, 'dm', { templates: readTemplates(), settings: S, state: emptyState() }).text.includes('/trips/athens-2-ab12cd34?utm_source=creator&utm_medium=dm&utm_campaign=maker1'));

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

    // Public only when shown: the Creators column, the day after the warm-up.
    const store = memStore();
    store.data.leads['tt:@maker1'] = creator(1);
    store.data.leads['tt:@maker2'] = creator(2, { warmedAt: new Date(NOW - DAY).toISOString(), stage: 'commented', posts: [{ ...creator(2).posts[0], status: 'commented' }] });
    let published = [];
    const deps = {
      cityFor: async () => CITY,
      draftComments: async () => ['a', 'b'],
      draftCreatorLine: async () => ({ name: '', line: 'x', problems: [] }),
      draftCustomerReply: async () => 'r',
      publishRoute: async (l) => {
        published.push(l.id);
        return { status: 'published', url: 'https://www.tiyulplus.com/trips/x', slug: 'x', externalId: externalIdFor(l), publishedAt: new Date(NOW).toISOString() };
      },
      brave: async () => [],
    };
    await prepareToday({ store, settings: S, now: NOW, deps, env: {} });
    eq('a route goes public only for the creator shown in the Creators column', published.join(), 'tt:@maker2');
    await prepareToday({ store, settings: S, now: NOW + 60_000, deps, env: {} });
    eq('and once: the next pass does not publish it again', published.length, 1);

    const withdrawn = [];
    const ops = createOps({ store, env: {}, clock: () => NOW, deps: { runDiscovery: async () => {}, prepareToday: async () => {}, withdrawRoute: async (l) => (withdrawn.push(l.id), { ...l.trip, status: 'withdrawn' }) } });
    await ops.post('/api/lead/tt:@maker2/action', { action: 'skip' });
    ok('[דלג] takes the route down', withdrawn.join() === 'tt:@maker2' && store.data.leads['tt:@maker2'].trip.status === 'withdrawn');

    const writes = RULES.filter((r) => r.method !== 'GET');
    ok('the only writes anywhere: Google APIs, and our own trips endpoint', writes.every((r) => ['places.googleapis.com', 'oauth2.googleapis.com', 'analyticsdata.googleapis.com'].includes(r.host) || (r.host === 'www.tiyulplus.com' && r.path?.test('/api/internal/trips') && !r.path.test('/api/trips/publish'))), writes.map((r) => `${r.method} ${r.host}`).join(', '));
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
    record(state, 'claude', { usd: 30, now: NOW });
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
    record(s2, 'claude', { usd: 24.995, now: NOW });
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
    const c = creator(1, { trip: { status: 'published', url: 'https://www.tiyulplus.com/trips/athens-4-ab12cd34' }, drafts: { dm: { name: 'מאיה', line: 'אהבתי את הטיפ על פלאקה' } } });
    const a = agency(1, { agencyDest: { slug: 'athens', he: 'אתונה', path: '/itinerary/athens/5' } });
    const u = customer(1, { dest: { he: 'אתונה', slug: 'athens' }, drafts: { reply: 'שלושה ימים מספיקים לרוב.' } });
    const state = { ...emptyState(), site: { options: OPTIONS, itineraries: [{ slug: 'athens', days: 5 }] } };
    for (const [lead, what] of [[c, 'dm'], [a, 'message'], [u, 'reply']]) {
      const link = linkFor(lead, what, { state });
      ok(`${lead.type}: the link carries utm_source, utm_medium and utm_campaign`, hasUtm(link), link);
    }
    eq('a creator campaign is their handle', campaignFor(c), 'maker1');
    eq('an agency campaign is its website', campaignFor(a), 'agency1.co.il');
    ok('tagged() replaces stale tags', new URL(tagged('https://www.tiyulplus.com/x?utm_source=old', c)).searchParams.get('utm_source') === 'creator');

    const templates = readTemplates();
    const ctx = { templates, settings: S, state };
    for (const [lead, what] of [[c, 'dm'], [a, 'message'], [u, 'reply'], [c, 'followup']]) {
      for (const gender of ['f', 'm']) {
        const out = compose({ ...lead, gender, messagedAt: what === 'followup' ? 'x' : lead.messagedAt }, what, ctx);
        const link = linkFor(lead, what, { state });
        const urls = urlsIn(out.text);
        ok(`${lead.type} ${what} (${gender}): no URL but our tagged link`, urls.every((x) => x === link) && (!link || urls.length === 1), urls.join(' '));
        ok(`${lead.type} ${what} (${gender}): no long dash`, !hasLongDash(out.text));
      }
    }
    const waiting = compose(creator(2, { trip: { status: 'waiting-for-site', reason: 'מחכה לאתר' }, drafts: { dm: { name: '', line: '' } } }), 'dm', ctx);
    ok('a creator DM without a published route says why and is not sendable', waiting.missing.some((m) => /מחכה לאתר/.test(m)) && waiting.text.includes('[קישור]'));
    const customerNoAsk = compose(customer(3, { dest: { he: 'אתונה', slug: 'athens' }, drafts: { reply: 'תשובה' }, posts: [{ ...customer(3).posts[0], asksForRoute: false }] }), 'reply', ctx);
    eq('a customer who did not ask for a route gets no link', urlsIn(customerNoAsk.text).length, 0);

    eq('a clean comment passes', checkDraft('שווה לעלות לליקבטוס בשקיעה', { kind: 'comment', sources: ['גבעת ליקבטוס בשקיעה'] }).length, 0);
    ok('a comment with a link is refused', checkDraft('תבדקו את tiyulplus.com', { kind: 'comment' }).length > 0);
    ok('a comment that mentions the site is refused', checkDraft('יש לנו באתר שלנו מסלול', { kind: 'comment' }).length > 0);
    ok('a long dash is refused', checkDraft('יפה \u2014 מאוד', { kind: 'comment' }).length > 0);
    ok('an invented number is refused', checkDraft('צריך 3 ימים', { kind: 'comment', sources: ['אתונה'] }).some((p) => /מספר/.test(p)));
    ok('a number from the source passes', checkDraft('צריך 3 ימים', { kind: 'comment', sources: ['יום 3: פלאקה'] }).length === 0);
    ok('a message with a foreign URL is refused', checkDraft('הנה https://evil.example/x', { kind: 'message', link: 'https://www.tiyulplus.com/trips/a' }).length > 0);

    for (const n of TEMPLATE_NAMES) {
      eq(`template ${n}.txt passes its own checks`, checkTemplate(n, templates[n]).join('; '), '');
    }
    ok('a template with a URL is refused', checkTemplate('creator', 'היי [קישור] www.example.com').length > 0);
    ok('a template with an unknown placeholder is refused', checkTemplate('creator', 'היי [שמ] [קישור]').length > 0);
    const base = { dest: 'אתונה', link: 'L', gift: 'G' };
    ok('the route-demand sentence appears only when the post shows demand', fill(templates.creator, { ...base, demand: true }).includes('שואלים אותך') && !fill(templates.creator, { ...base, demand: false }).includes('שואלים אותך'));
    ok('with no name, "היי [שם]!" becomes "היי!"', fill(templates.creator, base).startsWith('היי!'));
    ok('the toggle picks the gendered form', fill('{תרצה|תרצי}', { gender: 'm' }) === 'תרצה' && fill('{תרצה|תרצי}', { gender: 'f' }) === 'תרצי');
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
    ok('unknown followers are fine, and said', scoreCreator({ verdict: v, ageDays: 1, onSite: 'x' }, S).why.includes('מספר עוקבים לא ידוע'));
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
    ok('a personal line that talks about the writer is refused', checkDraft('ואני עוקבת אחרי הסדרה הזאת כבר מפרק 1', { kind: 'line', sources: ['פרק 1'] }).some((p) => /לא על הכותב/.test(p)));
    ok('a personal line may mention that they answer in DMs', checkDraft('ראיתי שאת עונה על שאלות בפרטי', { kind: 'line' }).length === 0);
    ok('a comment claiming personal experience is refused', checkDraft('אני מכיר את הצפון טוב, שווה לעלות', { kind: 'comment' }).some((p) => /חוויה אישית/.test(p)));

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
    state.leads['tt:@maker1'] = creator(1, { posts: [{ ...creator(1).posts[0], title: '<script>alert(1)</script> מסלול' }] });
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
      ok(`${name}: Hebrew, right to left`, html.includes('lang="he" dir="rtl"'));
      ok(`${name}: no long dash anywhere on the page`, !hasLongDash(html));
    }
    ok('a caption is shown as text, never as markup', !pages.today.includes('<script>alert') && pages.today.includes('&lt;script&gt;'));
    ok('Today has the four columns', ['תור תגובות', 'יוצרים', 'סוכנויות', 'לקוחות'].every((t) => pages.today.includes(t)));
    ok('the lead page has every button', ['העתק ופתח', 'ערוך', 'נסח מחדש', 'נקבה', 'זכר', 'נשלח', 'דלג', 'ענו', 'מעוניינים', 'לא מעוניינים'].every((t) => pages.lead.includes(`>${t}<`)));

    const tmp = join(REPO, 'data', '.selftest-growth.json');
    rmSync(tmp, { force: true });
    const store = openStore(tmp);
    Object.assign(store.data.leads, state.leads);
    const ops = createOps({ store, env: {}, clock: () => NOW, deps: { runDiscovery: async () => {}, prepareToday: async () => {} } });
    const bad = await ops.post('/api/lead/ag:place1/action', { action: 'edit', field: 'message', text: 'הנה https://evil.example' });
    ok('an edit with a foreign URL is refused', Boolean(bad.error), JSON.stringify(bad));
    const dash = await ops.post('/api/lead/ag:place1/action', { action: 'edit', field: 'message', text: 'שלום \u2014 עולם' });
    ok('an edit with a long dash is refused', Boolean(dash.error));
    const good = await ops.post('/api/lead/ag:place1/action', { action: 'edit', field: 'message', text: 'שלום, זו הודעה שלי' });
    ok('a clean edit is saved, and is what gets copied', good.ok && compose(store.data.leads['ag:place1'], 'message', { templates, settings: S, state: store.data }).text === 'שלום, זו הודעה שלי');
    ok('settings out of range are refused', Boolean((await ops.post('/api/settings', { settings: { runHour: 30 } })).error));
    ok('settings in range are saved', (await ops.post('/api/settings', { settings: { caps: { comment: 8 } } })).ok && mergeSettings(store.data.settings).caps.comment === 8);
    ok('the store file is the one it was given, never the posting store', existsSync(tmp) && !/store\.json$/.test(store.path));
    rmSync(tmp, { force: true });
  }
}
