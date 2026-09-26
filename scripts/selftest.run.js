import { loadEnv } from '../src/env.js';
loadEnv();

import { primaryAuthority, registry } from '../src/sources/index.js';
import { flightPriceGuard, verifyEvidence, verifyDraftText, minSourceChars, noDecimalsUpFront, noRepeatedWord, headlineLength, captionLength, fillerAdjective, rhetoricalOpening, RejectedError } from '../src/verify.js';
import { safeStem } from '../src/render/index.js';
import { htmlToText, stripBoilerplate, decodeEntities, fetchReadable, FetchError } from '../src/fetchPage.js';
import { parseFeed } from '../src/sources/rss.js';
import { monthlyNormals, verdictFor } from '../src/sources/climate.js';
import { quotaBlock, placeOverCap, describeRepeats } from '../src/pillars.js';
import { deckRepeats } from '../src/deck/candidate.js';
import { scoreItem, rank } from '../src/score.js';
import * as store from '../src/store.js';
import { candidateId, tripGap } from '../src/candidate.js';
import { renderHtml, LAYOUTS, PHOTO_LAYOUTS, isPhotoLayout, SCRIM_FALLBACK } from '../src/render/templates.js';
import { assertGenericAiPrompt, ImagePolicyError, imageQueries } from '../src/images.js';
import { approvalMessage, instagramCaption, tiktokCaption, publishedDescriptions, deckCaption, deckTiktokCaption, evidenceReport, deckApprovalMessage, captionHook, assertNoUrl, URL_LIKE } from '../src/format.js';
import { postConfig, byWeight, destinationWeight } from '../src/postConfig.js';
import { hashtagsFor, destinationTag } from '../src/hashtags.js';
import { renderSlideHtml, SIZES, sizeClass, INK_LUMINANCE, FACES } from '../src/render/deckTemplates.js';
import { renderInstagramSlideHtml } from '../src/render/deckInstagram.js';
import { sizesFor } from '../src/deck/candidate.js';
import { normaliseIdea, freeformFromIdea } from '../src/deck/ideas.js';
import { readFileSync } from 'node:fs';
import { FIELDS_BY_KIND } from '../src/deck/fields.js';
import { cinematicQueries } from '../src/images/curate.js';
import { countryMismatch } from '../src/deck/region.js';
import { SCRIM_INK } from '../src/render/theme.js';
import {
  lengthValue,
  yearValue,
  factsFor,
  countryFor,
  applyCountryVisibility,
  enoughFor,
  WIKIDATA_FIELDS,
} from '../src/deck/facts.js';
import { flagFor, COUNTRIES } from '../src/deck/flags.js';
import { emojiDataUri } from '../src/render/emojiArt.js';
import { isHebrew } from '../src/deck/hebrew.js';
import { parseLocally } from '../src/deck/request.js';
import { rotationFor, oneClause, emphasisFrom, COVER_SHAPES, COVER_VOICES } from '../src/deck/ideas.js';
import { deckPlace, namesPlace, REGIONS } from '../src/deck/region.js';
import { __test as photoTest, scrimAlpha, underScrim } from '../src/render/photo.js';
import { deckId } from '../src/deck/candidate.js';
import { sameSite } from '../src/search.js';
import { authorityDomains, KINDS, subjectEn, isSourcedKind } from '../src/sources/places.js';
import { pick, CATEGORY_HE, canonicalKind } from '../src/sources/tiyulplus.js';
import { keepByName } from '../src/deck/shape.js';
import {
  quietAlert,
  targetAbandoned as notifyTargetAbandoned,
  publishWaitingForSetup,
  published,
  descriptionToPaste,
  platformLimited,
  withDetail,
} from '../src/notify.js';
import {
  describeError,
  InstagramError,
  isPlatformLimit as isPlatformLimitInstagram,
  publishInstagram,
} from '../src/publish/instagram.js';
import { publishTargets, targetsForKind, allowedForKind, liveTargets } from '../src/publish/targets.js';
import {
  defaultPrivacy,
  nextPrivacy,
  privacyHe,
  publishTikTok,
  tiktokConfigured,
  describeError as describeTikTokError,
  isCardLevel as isCardLevelTikTok,
  isConfigProblem,
  missingScopes,
  scopeForMode,
  SCOPES as TK_SCOPES,
  TikTokError,
  waitForPublish,
  assertFetchable,
} from '../src/publish/tiktok.js';
import { codeFrom } from './tiktok-token.js';
import { hyphensOnly, stripEmoji, capHashtags, normalise } from '../src/draft.js';

// Offline behaviour checks. No network, no credentials, no Telegram.
//
// Everything here is a rule from the brief that would be expensive to get wrong
// quietly — the allowlist boundary, the fare guard, claim verification, the
// font guard. These started life as one-off shell commands while building,
// which meant they proved something once and then evaporated. This is the same
// checks, kept.
//
//   npm test

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail = '') {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(`${name}${detail ? ` - ${detail}` : ''}`);
  }
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond || !detail ? '' : ` - ${detail}`}`);
}

const eq = (name, got, want) => ok(name, got === want, `expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);

function throws(name, fn, reason) {
  try {
    fn();
    ok(name, false, 'did not throw');
  } catch (e) {
    ok(name, !reason || e.reason === reason || e instanceof ImagePolicyError, `threw ${e.reason || e.name}`);
  }
}

const group = (title) => console.log(`\n${title}`);

/* -------------------------------------------------------------------------- */
group('allowlist - "no source, no candidate"');

for (const [url, want, why] of [
  ['https://www.gov.uk/foreign-travel-advice/japan', true, 'FCDO'],
  ['https://whc.unesco.org/en/news/1', true, 'UNESCO subdomain'],
  ['https://www.nps.gov/x', true, 'US federal'],
  ['https://cnn.com/travel', false, 'news outlet'],
  ['https://evil-gov.uk/x', false, 'suffix must match on a label boundary'],
  ['https://gov.uk.attacker.com/x', false, 'prefix, not suffix'],
  ['https://notunesco.org/x', false, 'not a subdomain of unesco.org'],
  ['javascript:alert(1)', false, 'non-http scheme'],
  ['not a url', false, 'unparseable'],
]) {
  eq(`${want ? 'accepts' : 'rejects'} ${url} (${why})`, Boolean(primaryAuthority(url)), want);
}

/* -------------------------------------------------------------------------- */
group('fare guard - off by default since the brief, and still correct when on');

// THE DETECTOR IS UNCHANGED AND STILL TESTED. What changed is whether
// verifyDraftText consults it: the brief requires prices (rule 2), the owner
// lifted the ban after the cost was put to them, and FLIGHT_PRICE_GUARD=on
// restores it in one environment variable. See BRIEF.md.
//
// Testing the detector separately from the switch is the point. A guard that
// is off is one env var away from being on, and the day somebody flips it is
// the day they need it to still know a fare from an entry fee.
for (const [text, want] of [
  ['טיסה לאתונה החל מ-249 שקל', true],
  ['צ׳רטר ישיר, 1,200 ש״ח הלוך ושוב', true],
  ['כרטיס טיסה עולה 1200 ש"ח', true],
  ['round-trip fares from $420', true],
  ['כרטיס הכניסה לאלהמברה עולה 19 יורו', false],
  ['הכניסה לפארק חינם, החניה 8 יורו ליום', false],
  ['ארוחת ערב טובה בעיר: 120 ש״ח לזוג', false],
  ['הטיסה נוחתת ב-06:30 בבוקר', false],
]) {
  eq(`${want ? 'detects' : 'allows'}: ${text}`, Boolean(flightPriceGuard(text)), want);
}

{
  const { flightPriceGuardOn } = await import('../src/verify.js');
  const before = process.env.FLIGHT_PRICE_GUARD;
  // A draft that is clean on every OTHER rule, so what this measures is the
  // fare decision alone. The previous version of this test used a two-word
  // headline and, once the guard went off, failed on headline_length instead —
  // which is a pass for the wrong reason waiting to happen in the other
  // direction too.
  const fareDraft = {
    headline: 'הקו החדש מתל אביב לאתונה',
    subhead: 'איג׳יאן פותחת קו ישיר בנובמבר',
    caption: 'כרטיס טיסה החל מ-199 שקל הלוך ושוב לאתונה. הקו נפתח בנובמבר.',
  };

  delete process.env.FLIGHT_PRICE_GUARD;
  ok('off by default', !flightPriceGuardOn());
  ok(
    'so a draft carrying a fare now passes',
    (() => {
      try {
        verifyDraftText(fareDraft);
        return true;
      } catch (e) {
        return `threw ${e.reason || e.message}`;
      }
    })() === true
  );

  process.env.FLIGHT_PRICE_GUARD = 'on';
  ok('the switch turns it back on', flightPriceGuardOn());
  throws(
    'and the old rejection returns, unchanged',
    () => verifyDraftText(fareDraft),
    'flight_price_out_of_scope'
  );

  if (before === undefined) delete process.env.FLIGHT_PRICE_GUARD;
  else process.env.FLIGHT_PRICE_GUARD = before;
}

/* -------------------------------------------------------------------------- */
group('claim verification - quotes must be verbatim');

const SRC = 'The new Entry/Exit System starts on 12 October 2026 for all non-EU nationals crossing an external border.';

ok(
  'accepts a verbatim quote',
  (() => {
    try {
      return verifyEvidence({ evidence: [{ claim: 'x', quote: 'starts on 12 October 2026 for all non-EU nationals' }] }, SRC);
    } catch {
      return false;
    }
  })()
);
ok(
  'accepts a quote differing only in whitespace and punctuation',
  (() => {
    try {
      return verifyEvidence({ evidence: [{ claim: 'x', quote: 'starts  on 12 October, 2026 - for all non-EU nationals' }] }, SRC);
    } catch {
      return false;
    }
  })()
);
throws('rejects a paraphrase', () => verifyEvidence({ evidence: [{ claim: 'x', quote: 'begins in October 2026 for non-EU travellers' }] }, SRC), 'unsupported_claim');
throws('rejects a quote too short to be evidence', () => verifyEvidence({ evidence: [{ claim: 'x', quote: 'the new' }] }, SRC), 'unsupported_claim');
throws('rejects a draft that cites nothing', () => verifyEvidence({ evidence: [] }, SRC), 'no_evidence');

// Regression: the minimum quote length was a WORD count, and Japanese does not
// separate words with spaces. Every Japanese quote counted as one word and was
// rejected as too short, which made JNTO - one of four enabled sources -
// structurally unable to produce a candidate.
const JA_SRC = '2026年8月21日、最大44名対応の箸作り体験を渋谷で開始しました。';
ok(
  'accepts a substantial Japanese quote despite it having no spaces',
  (() => {
    try {
      return verifyEvidence({ evidence: [{ claim: 'x', quote: '最大44名対応の箸作り体験を渋谷で開始' }] }, JA_SRC);
    } catch {
      return false;
    }
  })()
);
ok(
  'accepts a dense 8-character Japanese quote as evidence',
  (() => { try { return verifyEvidence({ evidence: [{ claim: 'x', quote: '前年同月比0.1%増' }] }, '訪日外客数は前年同月比0.1%増となった。'); } catch { return false; } })()
);
throws(
  'still rejects a Japanese quote that is genuinely too short',
  () => verifyEvidence({ evidence: [{ claim: 'x', quote: '渋谷で' }] }, JA_SRC),
  'unsupported_claim'
);

/* -------------------------------------------------------------------------- */
group('source text extraction - boilerplate must not become citable evidence');

const HTML = `<html><body>
  <nav><a href="/">Home</a><a href="/x">Advice</a></nav>
  <div>We use some essential cookies to make this website work.</div>
  <div>We also use cookies set by other sites to help us deliver content.</div>
  <p>Skip to main content</p>
  <p>Latest update: biometric registration begins at external borders.</p>
  <p>Entry rules changed on 12 October 2026.</p>
  <footer>All content is available under the Open Government Licence v3.0</footer>
</body></html>`;

const text = htmlToText(HTML);
ok('keeps the substantive lines', text.includes('biometric registration begins') && text.includes('12 October 2026'));
ok('drops the cookie-consent lines', !/cookie/i.test(text), text.slice(0, 120));
ok('drops <nav> and <footer> wholesale', !text.includes('Open Government Licence') && !text.includes('Skip to main content'));
eq('decodes entities', decodeEntities('caf&eacute; &amp; b&#97;r'), 'café & bar');
ok(
  'refuses to gut a page it misreads',
  stripBoilerplate(['We use cookies', 'Search']).length === 2,
  'a page that is almost all boilerplate should pass through untouched rather than be emptied'
);

/* -------------------------------------------------------------------------- */
group('the 403 browser fallback - which failures are worth a second request');

// globalThis.fetch is stubbed rather than hitting the network, so this stays an
// offline check. It deliberately never exercises the Playwright path: launching
// Chromium to prove a routing decision would make `npm test` need a browser.
// The browser fetch itself was verified against UNESCO's live pages.
{
  const realFetch = globalThis.fetch;
  const stub = (status) => async () => ({
    ok: status < 400,
    status,
    url: 'https://whc.unesco.org/en/news/1',
    headers: new Map([['content-type', 'text/html']]),
    text: async () => '<html><body><p>hello</p></body></html>',
  });
  const grab = async (fn) => {
    try {
      await fn();
      return null;
    } catch (e) {
      return e;
    }
  };

  const prev = process.env.FETCH_BROWSER_FALLBACK;
  try {
    process.env.FETCH_BROWSER_FALLBACK = '0';

    globalThis.fetch = stub(404);
    const notFound = await grab(() => fetchReadable('https://whc.unesco.org/en/news/1'));
    ok('a 404 is a FetchError', notFound instanceof FetchError, String(notFound));
    eq('the status rides along on the error', notFound?.status, 404);
    ok('a 404 is never retried through a browser', notFound?.browserRetry === undefined, 'a dead link is not a bot wall');

    globalThis.fetch = stub(429);
    const rateLimited = await grab(() => fetchReadable('https://whc.unesco.org/en/news/1'));
    ok('a 429 is not retried either', rateLimited?.browserRetry === undefined, 'asking again does not fix a rate limit');

    globalThis.fetch = stub(403);
    const blocked = await grab(() => fetchReadable('https://whc.unesco.org/en/news/1'));
    eq('a 403 still reports 403', blocked?.status, 403);
    ok(
      'the kill switch stops the browser being reached for at all',
      blocked?.browserRetry === undefined,
      'FETCH_BROWSER_FALLBACK=0 must keep the offline suite off Chromium'
    );

    globalThis.fetch = stub(200);
    const fine = await fetchReadable('https://whc.unesco.org/en/news/1');
    eq('a 200 goes through the ordinary path', fine.text.trim(), 'hello');
  } finally {
    globalThis.fetch = realFetch;
    if (prev === undefined) delete process.env.FETCH_BROWSER_FALLBACK;
    else process.env.FETCH_BROWSER_FALLBACK = prev;
  }
}

/* -------------------------------------------------------------------------- */
group('feed parsing - RSS and Atom through one adapter');

const src = { id: 't', name: 'T', authority: 'government', lang: 'en', pillars: ['entry'] };

const rss = parseFeed(
  `<?xml version="1.0"?><rss version="2.0"><channel><item>
     <title>Entry rules change</title><link>https://www.gov.uk/a</link>
     <description>&lt;p&gt;From &lt;b&gt;October&lt;/b&gt;.&lt;/p&gt;</description>
     <pubDate>Wed, 20 Aug 2026 10:00:00 GMT</pubDate>
   </item></channel></rss>`,
  src
);
eq('RSS: one item', rss.length, 1);
eq('RSS: title', rss[0].title, 'Entry rules change');
eq('RSS: link', rss[0].url, 'https://www.gov.uk/a');
eq('RSS: escaped HTML in description is unwrapped', rss[0].summary, 'From October.');
ok('RSS: date parsed to ISO', rss[0].publishedAt?.startsWith('2026-08-20'), rss[0].publishedAt);

const atom = parseFeed(
  `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry>
     <title>Norway</title>
     <link rel="alternate" href="https://www.gov.uk/b"/>
     <summary>Updated advice.</summary>
     <updated>2026-08-19T09:00:00Z</updated>
   </entry></feed>`,
  src
);
eq('Atom: one item', atom.length, 1);
eq('Atom: href pulled from the alternate link element', atom[0].url, 'https://www.gov.uk/b');
ok('Atom: date parsed', atom[0].publishedAt?.startsWith('2026-08-19'), atom[0].publishedAt);
eq('an entry with no link is dropped', parseFeed('<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>x</title></entry></feed>', src).length, 0);

// urlIncludes — one feed carrying two kinds of thing.
//
// JNTO publishes travel news and its corporate wire down the same pipe. The
// junk was always rejected downstream as too thin, so this is about not letting
// fourteen procurement notices occupy the ranked list a real candidate needs.
const mixedFeed = `<?xml version="1.0"?><rss version="2.0"><channel>
   <item><title>Tool for inbound travellers</title><link>https://www.jnto.go.jp/news/press/_1.html</link><description>real</description></item>
   <item><title>Procurement notice</title><link>https://www.jnto.go.jp/news/info/post_53.html</link><description>stub</description></item>
   <item><title>Trade show exhibitors wanted</title><link>https://www.jnto.go.jp/news/expo-seminar/_925.html</link><description>stub</description></item>
 </channel></rss>`;
const jntoSrc = { ...src, id: 'jnto-news', urlIncludes: ['/news/press/'] };
eq('urlIncludes: keeps only the declared path', parseFeed(mixedFeed, jntoSrc).length, 1);
eq('urlIncludes: and it is the right one', parseFeed(mixedFeed, jntoSrc)[0].title, 'Tool for inbound travellers');
eq('a source with no urlIncludes is unfiltered', parseFeed(mixedFeed, src).length, 3);
eq(
  'urlIncludes accepts more than one fragment',
  parseFeed(mixedFeed, { ...src, urlIncludes: ['/news/press/', '/news/info/'] }).length,
  2
);
// The registry is data, so the filter has to survive a round trip through it.
ok(
  'the live JNTO entry declares the filter',
  (registry().sources.find((s) => s.id === 'jnto-news')?.urlIncludes || []).includes('/news/press/'),
  'sources.json lost urlIncludes'
);

// dedupeBy: 'url+updated' — a living document at a permanent URL.
//
// FCDO publishes one page per country and re-surfaces it whenever it is
// revised. Under URL-derived identity the first sighting of a country was the
// only one for SEEN_TTL_DAYS, so every later revision was skipped in silence.
const advisory = (updated) =>
  `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry>
     <title>Italy travel advice</title>
     <link rel="alternate" href="https://www.gov.uk/foreign-travel-advice/italy"/>
     <summary>Entry requirements updated.</summary>
     <updated>${updated}</updated>
   </entry></feed>`;
const fcdoSrc = { ...src, id: 'fcdo-travel-advice', dedupeBy: 'url+updated' };
const sept11 = parseFeed(advisory('2026-09-11T10:00:00Z'), fcdoSrc)[0];
const sept14 = parseFeed(advisory('2026-09-14T14:40:00Z'), fcdoSrc)[0];

eq('a re-read of the same revision is the same candidate', candidateId(parseFeed(advisory('2026-09-11T10:00:00Z'), fcdoSrc)[0]), candidateId(sept11));
ok('a revised advisory at the same URL is a new candidate', candidateId(sept11) !== candidateId(sept14), 'the revision would have been skipped as already-seen');

// The opposite case, which is why this is declared per source rather than on
// by default: a one-time article must not come back round on an edit.
const article = { ...src, id: 'nasa-earth-observatory' };
eq(
  'a source without the flag still keys on the URL alone',
  candidateId(parseFeed(advisory('2026-09-11T10:00:00Z'), article)[0]),
  candidateId(parseFeed(advisory('2026-09-14T14:40:00Z'), article)[0])
);
ok(
  'the live FCDO entry declares it',
  registry().sources.find((s) => s.id === 'fcdo-travel-advice')?.dedupeBy === 'url+updated',
  'sources.json lost dedupeBy'
);

/* -------------------------------------------------------------------------- */
group('climate - monthly normals and month verdicts');

const daily = { time: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_sum: [] };
for (const y of ['2023', '2024']) {
  for (let d = 1; d <= 28; d++) {
    daily.time.push(`${y}-07-${String(d).padStart(2, '0')}`);
    daily.temperature_2m_max.push(36);
    daily.temperature_2m_min.push(24);
    daily.precipitation_sum.push(0);
  }
}
const normals = monthlyNormals(daily);
eq('July mean max computed', normals[6].meanMax, 36);
eq('a month with no data stays null', normals[0].meanMax, null);
eq('36C in July is "avoid"', verdictFor(normals[6]), 'avoid');
eq('22C and dry is "good"', verdictFor({ meanMax: 22, wetDaysPerMonth: 4 }), 'good');
eq('22C but very wet is "avoid"', verdictFor({ meanMax: 22, wetDaysPerMonth: 18 }), 'avoid');
eq('no data is "unknown"', verdictFor({ meanMax: null }), 'unknown');

/* -------------------------------------------------------------------------- */
group('topic quotas - kosher is a thread, not the theme');

const hist = (n, tagged) =>
  Array.from({ length: n }, (_, i) => ({ pillar: 'inCity', tags: i < tagged ? ['kosher'] : [] }));

ok('below the sample floor nothing is capped', quotaBlock({ pillar: 'inCity', tags: ['kosher'] }, hist(4, 4)) === null);
ok('kosher blocked once it is over its share', quotaBlock({ pillar: 'timing', tags: ['kosher'] }, hist(20, 5)) !== null);
ok('kosher allowed while under its share', quotaBlock({ pillar: 'timing', tags: ['kosher'] }, hist(20, 1)) === null);
ok('a single pillar cannot take over', quotaBlock({ pillar: 'inCity', tags: [] }, hist(20, 0)) !== null);
ok('an untagged post in a fresh pillar passes', quotaBlock({ pillar: 'route', tags: [] }, hist(20, 0)) === null);

// The share that was missing. Every volcano report files as `conditions` — so
// does every closure, reopening and season — so one feed can fill that pillar's
// entire 40% while each individual post is filed perfectly correctly. Measured
// against the live registry: 22 of the 65 items gathered on an ordinary day were
// the Smithsonian's weekly volcano report, and the account read as one.
const srcHist = (n, fromWire) =>
  Array.from({ length: n }, (_, i) => ({
    pillar: i % 2 ? 'inCity' : 'timing',
    tags: [],
    sourceId: i < fromWire ? 'smithsonian-volcano' : `other-${i}`,
  }));

ok('one source cannot become the feed', quotaBlock({ pillar: 'route', tags: [], sourceId: 'smithsonian-volcano' }, srcHist(20, 6)) !== null);
ok('a source under its share still publishes', quotaBlock({ pillar: 'route', tags: [], sourceId: 'smithsonian-volcano' }, srcHist(20, 3)) === null);
ok('a candidate with no source is not capped by one', quotaBlock({ pillar: 'route', tags: [] }, srcHist(20, 20)) === null);
// Records written before sourceId was stored count toward nobody's share, so the
// cap loosens for a window rather than blocking real posts over a missing field.
ok('history from before the field existed blocks nothing', quotaBlock({ pillar: 'route', tags: [], sourceId: 'smithsonian-volcano' }, hist(20, 0)) === null);

// The axis none of the three caps above could see. A feed can satisfy every one
// of them and still be entirely about one city: decks file as pillar `day` with
// no sourceId, so only the 40% pillar cap could bite a run of Kyoto, and it did
// not. This is the cap that measures where a post is actually about.
const placeHist = (n, atPlace, place = 'Kyoto') =>
  Array.from({ length: n }, (_, i) => ({
    pillar: i % 2 ? 'inCity' : 'timing',
    tags: [],
    place: i < atPlace ? place : `Elsewhere-${i}`,
  }));

ok('one city cannot become the feed', quotaBlock({ pillar: 'route', tags: [], place: 'Kyoto' }, placeHist(20, 6)) !== null);
ok('a city under its share still publishes', quotaBlock({ pillar: 'route', tags: [], place: 'Kyoto' }, placeHist(20, 2)) === null);
ok('a candidate with no place is not capped by one', quotaBlock({ pillar: 'route', tags: [] }, placeHist(20, 20)) === null);
// Case and stray space are the same city; nothing beyond that is guessed at,
// because merging "Dolomites" into "Italian Dolomites" would cap two genuinely
// different destinations as one.
ok('case and space do not defeat the cap', placeOverCap('  kyoto ', placeHist(20, 6)) !== null);
ok('a different city is a different bucket', placeOverCap('Vienna', placeHist(20, 20)) === null);
// Same forgiveness the source cap gets: rows written before `place` existed
// count toward nobody's share rather than blocking real posts over a field that
// was never written.
ok('history from before the field existed blocks nothing', placeOverCap('Kyoto', hist(20, 0)) === null);
ok('below the sample floor nothing is capped', placeOverCap('Kyoto', placeHist(4, 4)) === null);

// A streak is not a share, and the place streak was measured by nothing at all.
const runHist = (places) => places.map((place) => ({ pillar: 'day', tags: [], place }));

ok(
  'three about one city in a row is said out loud',
  describeRepeats({ pillar: 'day', tags: [], place: 'Kyoto' }, runHist(['Kyoto', 'Kyoto', 'Lisbon'])).some((n) =>
    n.includes('Kyoto')
  )
);
ok(
  'a single previous post about it is not a streak',
  !describeRepeats({ pillar: 'day', tags: [], place: 'Kyoto' }, runHist(['Kyoto', 'Lisbon', 'Porto'])).some((n) =>
    n.includes('Kyoto')
  )
);
ok(
  'the streak is broken by anywhere else',
  !describeRepeats({ pillar: 'day', tags: [], place: 'Kyoto' }, runHist(['Lisbon', 'Kyoto', 'Kyoto'])).some((n) =>
    n.includes('Kyoto')
  )
);

// The gap that let the run through: deckTopic is "<where> · <category>", so
// Kyoto temples then Kyoto food then Kyoto gardens is three different topics.
// The topic run breaks at the first change and reports nothing, while the feed
// reads as three Kyoto posts running — which it is.
const kyotoDeck = { where: 'Kyoto', category: 'garden', slides: [] };
const mixedKyoto = [
  { topic: 'Kyoto · food', place: 'Kyoto' },
  { topic: 'Kyoto · temple', place: 'Kyoto' },
  { topic: 'Lisbon · city', place: 'Lisbon' },
];
eq('the topic run sees nothing across categories', deckRepeats({ ...kyotoDeck }, mixedKyoto).filter((n) => n.includes('חוזר על')).length, 0);
ok('but the place run catches it', deckRepeats({ ...kyotoDeck }, mixedKyoto).some((n) => n.includes('אותו מקום')));
// Decks never reach quotaBlock, so for them saying it IS the intervention.
ok(
  'a deck over its place share says so',
  deckRepeats({ ...kyotoDeck }, placeHist(20, 6)).some((n) => n.includes('share'))
);
ok('a deck about somewhere fresh says nothing', deckRepeats({ where: 'Porto', category: 'city', slides: [] }, mixedKyoto).length === 0);

/* -------------------------------------------------------------------------- */
group('what the idea prompt remembers - the list that was twelve hashes');

// The bug this guards, exactly: recordPublished never accepted a `headline`, so
// `p.headline || p.id` fell through to a sha1 on every row and the /deck prompt
// asked the model not to repeat twelve hex strings. With no readable memory it
// returned its prior every run, and for "beautiful travel slideshow" that prior
// is Kyoto — which is how a feed meant to span the world became one city.
const titleHist = [
  { headline: 'המקדשים והארמונות הכי יפים ביפן', topic: 'Kyoto · temple', place: 'Kyoto' },
  { headline: null, topic: 'Vienna · city', place: 'Vienna' },
  { headline: 'הרים באיטליה', topic: null, place: null },
];

eq(
  'a headline is shown with its place',
  store.recentTitles({ history: titleHist })[0],
  'המקדשים והארמונות הכי יפים ביפן (Kyoto)'
);
eq('a row with no headline falls back to its topic', store.recentTitles({ history: titleHist })[1], 'Vienna · city');
eq('a headline with no place is still readable', store.recentTitles({ history: titleHist })[2], 'הרים באיטליה');
ok(
  'nothing the model cannot read reaches the prompt',
  store.recentTitles({ history: titleHist }).every((t) => !/^[0-9a-f]{12}$/.test(t))
);
// Rows written before these fields existed are dropped, not padded into the
// list as empty strings — a short true list beats a long meaningless one.
eq('legacy rows drop out entirely', store.recentTitles({ history: [{ ts: 1, id: 'a3f9c1b2d4e5' }] }).length, 0);
eq('the list is capped', store.recentTitles({ history: Array.from({ length: 40 }, () => titleHist[0]) }).length, 12);

/* -------------------------------------------------------------------------- */
group('deck proposals - the text stage, before anything is built');

// A deck is an idea call, a search and a drafting call per place, then twelve
// renders. All of it used to happen before you had seen anything, so a deck you
// did not want cost the whole build and was rejected at the end of it. The
// proposal is the same decision taken while it is still one message.
const propIdea = { titleHe: 'המקדשים של קיוטו', where: 'Kyoto', kind: 'temple', want: 5, angleHe: 'מה פתוח בחורף' };
const propKey = store.addProposal({ idea: propIdea, alternatives: [{ where: 'Nara', kind: 'temple' }], chatId: 42 });

eq('a proposal round-trips', store.getProposal(propKey).idea.where, 'Kyoto');
ok('and is stamped with when it was proposed', typeof store.getProposal(propKey).proposedAt === 'number');

// Revision replaces the idea and nothing else: the fallbacks were generated in
// the same call and are still the right things to try if the build comes up dry.
store.updateProposal(propKey, { idea: { ...propIdea, where: 'Osaka' } });
eq('a revision moves the idea', store.getProposal(propKey).idea.where, 'Osaka');
eq('and keeps the alternatives', store.getProposal(propKey).alternatives.length, 1);
eq('and keeps the chat it was proposed in', store.getProposal(propKey).chatId, 42);

// Keyed per proposal, never per chat — the same lesson pendingEdit records.
const propKey2 = store.addProposal({ idea: { ...propIdea, where: 'Lisbon' }, chatId: 42 });
ok('two proposals do not collide', store.getProposal(propKey).idea.where !== store.getProposal(propKey2).idea.where);

// Building consumes it, so a second tap on a message still showing its buttons
// finds nothing rather than building the same deck twice.
store.clearProposal(propKey);
eq('building consumes the proposal', store.getProposal(propKey), null);

// The marker that splits the two reply paths. Both route through the same
// prompt-id lookup; only `kind` says whether the reply is an instruction for an
// idea or a replacement headline for a rendered card.
store.setPendingEdit(propKey2, { kind: 'idea', chatId: 42, promptMessageId: 777 });
eq('a reply routes to its own proposal', store.findPendingEditByPrompt(777), propKey2);
eq('and carries the marker that says which stage it is', store.getPendingEdit(propKey2).kind, 'idea');
eq('a reply to anything else routes nowhere', store.findPendingEditByPrompt(999), null);

// The drip alternates kinds. Approve five decks and then five cards and a
// plain FIFO posts five slideshows in a row, then five news cards — which
// reads as two accounts taking turns rather than one feed.
const kindTag = (c) => (c.kind === 'deck' ? 'D' : 'C') + c.n;
const drainQueue = () => {
  const out = [];
  for (;;) {
    const i = store.dequeue();
    if (!i) break;
    out.push(kindTag(i));
  }
  return out.join(' ');
};

for (let n = 1; n <= 3; n++) store.enqueue({ kind: 'deck', n });
for (let n = 1; n <= 3; n++) store.enqueue({ kind: 'card', n });
eq('the list shows the running order, not the array', store.queuedItems().map(kindTag).join(' '), 'D1 C1 D2 C2 D3 C3');
eq('and that is the order they publish in', drainQueue(), 'D1 C1 D2 C2 D3 C3');

// Alternation is a preference about ORDER and never a reason to hold a post
// back: a queue of one kind publishes all of it, in order.
for (let n = 1; n <= 4; n++) store.enqueue({ kind: 'deck', n });
eq('one kind alone still drains', drainQueue(), 'D1 D2 D3 D4');

// Uneven queues alternate as far as they can and then continue.
store.enqueue({ kind: 'card', n: 1 });
for (let n = 1; n <= 3; n++) store.enqueue({ kind: 'deck', n });
eq('uneven alternates then continues', drainQueue(), 'C1 D1 D2 D3');

// A queued item from before `kind` existed counts as a card rather than
// breaking the comparison.
store.enqueue({ n: 1 });
store.enqueue({ kind: 'deck', n: 1 });
store.enqueue({ n: 2 });
eq('kind-less items count as cards', drainQueue(), 'C1 D1 C2');

// /post takes the number printed, which is a position in the RUNNING order.
// Splicing the array at that index would publish a different post.
for (let n = 1; n <= 2; n++) store.enqueue({ kind: 'deck', n });
for (let n = 1; n <= 2; n++) store.enqueue({ kind: 'card', n });
eq('shown order', store.queuedItems().map(kindTag).join(' '), 'D1 C1 D2 C2');
eq('/post 2 takes the second LINE', kindTag(store.takeQueuedAt(2)), 'C1');
store.clearStaging();
while (store.dequeue());

// Picking one post out of the queue by the number /queue printed. 1-based,
// because the list a person reads from starts at 1 and asking them to subtract
// one is how the wrong post gets published.
store.enqueue({ headline: 'ראשון' });
store.enqueue({ headline: 'שני' });
store.enqueue({ headline: 'שלישי' });
eq('the queue lists in publish order', store.queuedItems().map((c) => c.headline).join(','), 'ראשון,שני,שלישי');
eq('taking 2 takes the second', store.takeQueuedAt(2).headline, 'שני');
eq('and the rest close up', store.queuedItems().map((c) => c.headline).join(','), 'ראשון,שלישי');

// Out of range returns null rather than clamping. Clamping would publish item 5
// when 6 was asked for — precisely the case where the person misread the list,
// and the last moment to confidently pick a neighbour.
eq('past the end is nothing', store.takeQueuedAt(9), null);
eq('zero is nothing', store.takeQueuedAt(0), null);
eq('nonsense is nothing', store.takeQueuedAt('abc'), null);
eq('and none of that disturbed the queue', store.queueSize(), 2);

// The listing hands out copies, so a caller cannot edit the queue by accident.
const listed = store.queuedItems();
listed[0].headline = 'נדרס';
eq('the listing is a copy', store.queuedItems()[0].headline, 'ראשון');
store.takeQueuedAt(1);
store.takeQueuedAt(1);
eq('emptied', store.queueSize(), 0);

// /clear_pending means everything awaiting a tap, not just the built ones.
store.clearStaging();
eq('clearing what is pending takes proposals too', store.proposalSize(), 0);

// The destination is chosen at the proposal, which is the only point at which
// choosing it saves anything: a deck renders twelve slides across two aspect
// ratios, and picking the platform first halves that.
eq('an Instagram deck renders one size', sizesFor(['instagram']).join(','), 'instagram');
eq('a TikTok deck renders the other', sizesFor(['tiktok']).join(','), 'tiktok');
eq('both still works, in the order given', sizesFor(['tiktok', 'instagram']).join(','), 'tiktok,instagram');
eq('telegram is not a render size', sizesFor(['telegram', 'instagram']).join(','), 'instagram');
eq('and nothing sensible is asked for nothing', sizesFor([]).join(','), '');

// The button carries the destination in its callback data, so the two buttons
// route to the same builder with different targets. The key never contains a
// colon, which is what lets the target be appended with one.
const cb = /^db:(.+):(instagram|tiktok)$/;
ok('the Instagram button parses', cb.exec('db:a1b2c3d:instagram')?.[2] === 'instagram');
ok('the TikTok button parses', cb.exec('db:a1b2c3d:tiktok')?.[2] === 'tiktok');
ok('and a bare build tap no longer matches anything', !cb.test('db:a1b2c3d'));

// Draft mode: the same destination reached a different way. TikTok's API has no
// field for choosing a sound on a photo post — auto_add_music is a boolean —
// so a deck that wants a particular track has to be finished by hand in the
// app. MEDIA_UPLOAD delivers it to the inbox for exactly that.
const cbd = /^db:(.+):(instagram|tiktok|tiktokdraft)$/;
eq('the draft button parses', cbd.exec('db:a1b2c3d:tiktokdraft')?.[2], 'tiktokdraft');
eq('and does not shadow the direct one', cbd.exec('db:a1b2c3d:tiktok')?.[2], 'tiktok');
// It resolves to the tiktok TARGET plus a flag, not a fourth destination —
// publishTargets stays a list of real places.
eq('a draft still renders the TikTok size', sizesFor(['tiktok']).join(','), 'tiktok');

// The message must not say "published". Nothing in the process can see whether
// the app was ever opened, so this is the last honest thing it can report.
// Reported per DESTINATION, not per post. A deck sent to both said
// "פורסם לאינסטגרם וטיקטוק" — half true, and false in the direction that
// matters: you read "posted", never open the app, and the app is the only
// place a draft becomes a post.
const bothMsg = published({ headline: 'המקדשים של קיוטו', succeeded: ['instagram', 'tiktok'], drafted: ['tiktok'] });
ok('Instagram is reported as published', /📤 אינסטגרם/.test(bothMsg));
ok('TikTok is reported as a draft', /טיקטוק טיוטה/.test(bothMsg));
ok('and never as published', !/פורסם.*טיקטוק/.test(bothMsg));
ok('and the draft is marked as such, not as posted', /📥/.test(bothMsg) && !/📤 טיקטוק/.test(bothMsg));
ok('it carries the headline', bothMsg.includes('המקדשים של קיוטו'));
// Where it actually is. An upload is an inbox notification, not the Drafts
// folder on the profile — the first place anybody looks, and the one place it
// will not be.
eq('and the whole thing is one line', bothMsg.split('\n').length, 1);

// TikTok alone: nothing published, so no posted line at all.
const only = published({ headline: 'מסלולים באירופה', succeeded: ['tiktok'], drafted: ['tiktok'] });
ok('a draft-only post claims nothing published', !only.includes('📤'));
ok('and still says it is a draft', only.includes('טיוטה'));

// And an ordinary post is untouched.
const plain = published({ headline: 'כרטיס', succeeded: ['instagram'] });
ok('a normal publish still reads as published', plain.includes('📤 אינסטגרם'));
ok('with no draft line', !plain.includes('טיוטות'));

// A THIRD STATE: a destination this program cannot reach and never tried to.
//
// A clip's Instagram half. Its API has no draft endpoint, no scheduling and no
// hand-off to the app, so the copy is one you make. The two wrong things to say
// about it are that it published and nothing at all, and the second is the one
// that actually happens: a message listing only TikTok reads as a post that is
// finished, and the Instagram copy silently never gets made.
{
  const handed = published({
    headline: 'שווייץ',
    succeeded: ['tiktok'],
    drafted: ['tiktok'],
    manual: ['instagram'],
    manualUrl: 'https://cards.example/clip-abc.mp4',
  });
  ok('a hand-off is named', handed.includes('📲'));
  ok('and says which destination it is', handed.includes('אינסטגרם'));
  ok('and that it is yours to do', handed.includes('ידנית'));
  // The URL is the point of the line. The mp4 is already hosted because TikTok
  // pulls video by URL, so the file is one tap away and byte-exact rather than
  // whatever a chat app decided to re-encode.
  ok('with the file to post', handed.includes('clip-abc.mp4'));
  // It must never be counted as published. That is the whole distinction.
  ok('a hand-off is not reported as published', !handed.includes('📤'));

  // A post with nothing to hand off says nothing about one.
  ok('an ordinary post carries no hand-off line', !plain.includes('📲'));
  const noUrl = published({ headline: 'x', succeeded: ['tiktok'], manual: ['instagram'] });
  ok('and a hand-off with no hosted file still names the destination', noUrl.includes('אינסטגרם'));

  // It points at the message that follows, so a block of Hebrew and five
  // hashtags arriving on its own reads as the caption rather than as one more
  // notification to work out.
  ok('a hand-off points at the description below it', handed.includes('👇'));
  ok('and an ordinary post does not', !plain.includes('👇'));

  // A HAND-OFF WITH NOTHING PUBLISHED AT ALL is the case on a box where TikTok
  // is not connected, which is the box this was written on. The mp4 is
  // rendered and hosted and the only step left was always you opening an app,
  // so the post is complete rather than waiting for setup, and the message has
  // to stand on its own with no posted or drafted half in front of it.
  const handOnly = published({
    headline: 'שווייץ',
    succeeded: [],
    drafted: [],
    manual: ['instagram'],
    manualUrl: 'https://cards.example/clip-abc.mp4',
  });
  ok('a hand-off alone still names the destination', handOnly.includes('אינסטגרם'));
  ok('and still carries the file', handOnly.includes('clip-abc.mp4'));
  ok('and still points at the description', handOnly.includes('👇'));
  ok('and claims nothing was published', !handOnly.includes('📤') && !handOnly.includes('📥'));
  ok('and is not an empty message', handOnly.trim().length > 'שווייץ'.length);
}

// THE DESCRIPTION, ALONE, TO BE COPIED WHOLE.
//
// Telegram's copy takes a whole message, so the test worth having is about what
// is NOT in it. Anything added here is a character that has to be deleted by
// hand in the Instagram composer every time, and the one deletion that gets
// forgotten is a post that goes out with a glyph in front of its first line.
{
  const caption = '📍 שווייץ\n\nמי היה שם? כמה יצא לכם ליום?\n\nשלחו את זה למי שאתם טסים איתו\n\n#טיול #חופשה #שווייץ';
  const cand = { headline: 'אני, אתה, טיסה לשוויץ?', instagramCaption: caption, tiktokCaption: caption };

  eq('the paste message is the caption, byte for byte', descriptionToPaste(cand), caption);
  ok('no label in front of it', !descriptionToPaste(cand).startsWith('🏷️'));
  // The headline is burned into the video. Repeating it is the caption's most
  // common way of wasting its first line, and here it would also be a line to
  // delete before pasting.
  ok('the headline is not in it', !descriptionToPaste(cand).includes(cand.headline));
  // Nothing published carries a domain, and this string goes straight into a
  // composer without passing assertNoUrl again.
  ok('and no URL', !URL_LIKE.test(descriptionToPaste(cand)));

  // An empty message is worse than an absent one, so the caller sends nothing.
  eq('no caption means no message', descriptionToPaste({ headline: 'x' }), null);
  eq('nor does a whitespace-only one', descriptionToPaste({ instagramCaption: '   \n ' }), null);

  // A clip sets both to the same text; anything that only set TikTok's still
  // has something to paste.
  eq('it falls back to the TikTok description', descriptionToPaste({ tiktokCaption: caption }), caption);
}

// The 24h cap counts posts PUBLISHED through the API. A draft publishes
// nothing, so charging it against the cap would spend a limit never touched.
const day = Date.now();
const capRows = [
  { tiktok: true, tiktokAt: day },
  { tiktok: true, tiktokAt: day, tiktokDraft: true },
  { tiktok: true, tiktokAt: day, tiktokDraft: true },
];
eq(
  'drafts do not eat the direct-post cap',
  capRows.filter((p) => p.tiktok && !p.tiktokDraft).length,
  1
);

// The proposal carries the CONTENT, not just a title. Deciding on a deck from
// its headline alone is deciding on a headline, and the list is the post.
const withPlaces = normaliseIdea({
  title_he: 'טופ 5 הרים יפים באוסטריה',
  where: 'Austria',
  kind: 'trail',
  want: 5,
  places_he: ['גרוסגלוקנר', 'דכשטיין'],
});
eq('the planned places survive normalisation', withPlaces.places.join(','), 'גרוסגלוקנר,דכשטיין');
eq('a long list is clamped', normaliseIdea({ title_he: 't', where: 'Austria', kind: 'trail', want: 5, places_he: Array(20).fill('x') }).places.length, 8);
// An older idea, or a model that omitted the field, must not throw — the
// proposal simply shows no list.
eq('an idea without places is still usable', normaliseIdea({ title_he: 't', where: 'Austria', kind: 'trail', want: 5 }).places.length, 0);

// A named region is used as named. This used to narrow a country to "the part
// travellers mean" — Austria became Tyrol — which overruled the one field the
// request was most explicit about, silently.
const req = readFileSync(new URL('../src/deck/request.js', import.meta.url), 'utf8');
ok('the resolver is told to use the region as named', /USE THE REGION THE REQUEST NAMES/.test(req));
ok('and the old narrowing instruction is gone', !/narrow to the part\s+travellers mean/.test(req));
ok('the schema no longer discourages a country', !/a country is acceptable only when/.test(req));

// Reaching TikTok always means a draft now. The direct button had nothing to
// recommend it: the API cannot name a sound, so a direct post takes whatever
// TikTok picks — and sound is the one thing not editable after publishing.
const cb3 = /^db:(.+):(instagram|tiktok|both)$/;
eq('instagram parses', cb3.exec('db:k:instagram')?.[2], 'instagram');
eq('tiktok parses', cb3.exec('db:k:tiktok')?.[2], 'tiktok');
eq('both parses', cb3.exec('db:k:both')?.[2], 'both');
ok('and the old separate draft button is gone', !cb3.test('db:k:tiktokdraft'));
// "both" is two destinations and one draft flag, not a third place to publish.
const destinationsFor = (c) => (c === 'both' ? ['instagram', 'tiktok'] : [c]);
eq('both means two destinations', destinationsFor('both').join(','), 'instagram,tiktok');
ok('and anything touching tiktok is a draft', destinationsFor('both').includes('tiktok'));
eq('both renders both sizes', sizesFor(destinationsFor('both')).join(','), 'instagram,tiktok');

/* -------------------------------------------------------------------------- */
group('one deck, one vocabulary - and a photo of what the deck is about');

// The screenshot that prompted this: one slide read "מרחק", the next "אורך",
// same measurement, same ruler emoji. Two field specs are live for a trail — a
// place with an official page gets its fields drafted from it, a place without
// gets them from Wikidata — and the two files disagreed on the word.
const allKinds = new Set([...Object.keys(FIELDS_BY_KIND), ...Object.keys(WIKIDATA_FIELDS)]);
for (const k of allKinds) {
  const specs = [...(FIELDS_BY_KIND[k] || []), ...(WIKIDATA_FIELDS[k] || [])];
  const byEmoji = new Map();
  const byKey = new Map();
  for (const f of specs) {
    if (!byEmoji.has(f.emoji)) byEmoji.set(f.emoji, new Set());
    byEmoji.get(f.emoji).add(f.labelHe);
    if (!byKey.has(f.key)) byKey.set(f.key, new Set());
    byKey.get(f.key).add(f.labelHe);
  }
  for (const [emoji, labels] of byEmoji)
    ok(`${k}: ${emoji} means one thing`, labels.size === 1, [...labels].join(' vs '));
  for (const [key, labels] of byKey)
    ok(`${k}: ${key} is named once`, labels.size === 1, [...labels].join(' vs '));
}

// The photo. "Bodensee-Rundweg" searched on its name alone returns the lakefront
// town — the right place, the wrong subject, on a slide in a deck about trails.
ok('every kind has an English subject for the search', [...Object.keys(KINDS)].every((k) => subjectEn(k)));
const qs = cinematicQueries('Bodensee-Rundweg', 'Austria', subjectEn('trail'));
ok('the subject leads the queries', qs[0].includes('hiking trail'));
ok('the bare name is still tried', qs.includes('Bodensee-Rundweg'));
// Without a subject the behaviour is exactly what it was, so a cover — which is
// a picture of the region and not of the category — is unaffected.
eq('no subject means the old queries', cinematicQueries('Prague', 'Prague')[0], 'Prague');

/* -------------------------------------------------------------------------- */
group('ranking - the two misfires found against live feeds');

const base = { sourceId: 's', publishedAt: new Date().toISOString(), pillarHints: [] };
const fcdo = { ...base, authority: 'government', title: 'Norway', summary: 'x'.repeat(400) };
const trade = { ...base, authority: 'official-dmo', title: '「第29回JNTOインバウンド旅行振興フォーラム」取材のご案内', summary: 'y'.repeat(400) };

ok('a short title with a real summary is not penalised as thin', scoreItem(fcdo) > scoreItem({ ...fcdo, summary: '' }));
// News that changes what a traveller can do still outranks a dataset item — but
// it now wins for the right reason.
//
// It used to win because evergreen carried a penalty, which made the feed a wire
// with a climate card as the fallback. Evergreen now earns a bonus, and the
// Louvre still comes first on the actionable vocabulary alone ("reopens"). That
// is the intended shape: something a reader can act on beats an evergreen fact,
// and everything else loses to it.
ok(
  'actionable news still outranks an evergreen dataset item',
  scoreItem({ title: 'Louvre reopens the Denon wing after two years', summary: 'x'.repeat(300), authority: 'government', publishedAt: new Date().toISOString(), pillarHints: ['inCity'] }) >
    scoreItem({ title: 'Bangkok - monthly climate normals 2016–2025 (ERA5)', summary: 'x'.repeat(300), authority: 'dataset', publishedAt: null, evergreen: true, pillarHints: ['timing'] })
);

// The reversal, pinned. A travel desk is not a wire: a fact that is worth saving
// beats a fact that merely happened, and "it happened today" is worth very
// little on its own. Both items below are ordinary news with nothing actionable
// in them; the evergreen one wins.
ok(
  'an evergreen fact now beats an undifferentiated news item',
  scoreItem({ title: 'T', summary: 'x'.repeat(300), authority: 'dataset', evergreen: true }) >
    scoreItem({ title: 'T', summary: 'x'.repeat(300), authority: 'dataset', publishedAt: new Date().toISOString(), evergreen: false })
);
ok(
  'the evergreen flag is what does it, not the source name',
  scoreItem({ title: 'T', summary: 'x'.repeat(300), authority: 'dataset', evergreen: true }) >
    scoreItem({ title: 'T', summary: 'x'.repeat(300), authority: 'dataset', evergreen: false })
);
// Recency is now a tie-breaker rather than a driver: it still orders two
// otherwise identical items, and it no longer decides the feed.
ok(
  'recency still breaks a tie between identical items',
  scoreItem({ title: 'T', summary: 'x'.repeat(300), authority: 'government', publishedAt: new Date().toISOString() }) >
    scoreItem({ title: 'T', summary: 'x'.repeat(300), authority: 'government', publishedAt: new Date(Date.now() - 90 * 86_400_000).toISOString() })
);

/* -------------------------------------------------------------------------- */
group('the trip rule - could they go, and does it make them want to');

// The six posts that made this a natural-phenomena account rather than a travel
// one. Each is checked against a mundane item from an equally authoritative
// source, published at the same moment, so the only thing that can separate them
// is the new question.
const sameDay = { sourceId: 's', authority: 'government', publishedAt: new Date().toISOString(), pillarHints: [], summary: 'x'.repeat(300) };
const ordinary = scoreItem({ ...sameDay, title: 'Alhambra opens timed-entry tickets for the Nasrid Palaces' });

for (const title of [
  'Waterspout observed off the coast of Puerto Rico',
  'Lava flows continue at Kilauea summit',
  'Icebergs calving into the strait off east Greenland',
  'Eruption at Fuego sends ash plume over Guatemala',
  'Emperor penguin colony surveyed from orbit, Antarctica',
]) {
  ok(`spectacle loses to an ordinary reachable item: ${title.slice(0, 34)}`, scoreItem({ ...sameDay, title }) < ordinary);
}

// The item that is both — a volcano the reader is being told they cannot visit.
// It matches both lists and lands between the two, which is the correct outcome
// for something that genuinely could go either way: it stays in the running and
// the drafting step, which has read the page, gets to make the actual call.
const both = scoreItem({ ...sameDay, title: 'Etna: summit craters closed to visitors until further notice' });
ok('a closure at a volcano is not treated as pure spectacle', both > scoreItem({ ...sameDay, title: 'Lava flows continue at Kilauea summit' }));

// The hole the penalty left, found by scoring a live gather rather than a
// fixture. Of the Smithsonian's 22 weekly reports, the two that ranked highest —
// 7th and 8th of 65 items, above every FCDO advisory — were the two that never
// say erupt, lava, ash or volcano. They say "unrest" and "the Alert Level was
// lowered". The vocabulary filter was not missing them, it was selecting them.
const unrest = {
  ...sameDay,
  title: 'Asosan (Japan) - Report for 27 August-2 September 2026 - Continuing Unrest',
  summary:
    'The Japan Meteorological Agency (JMA) reported that unrest at Asosan showed a downward trend ' +
    'since 17 August based on seismic and gas emission data. At 1600 on 1 September the Alert Level ' +
    'was lowered to 2 (on a scale of 1-5) and the public was warned not to enter the area around the crater.',
};
ok('an unrest report that never says volcano is still spectacle', scoreItem(unrest) < ordinary);

// And the guarantee that does not depend on wording at all: a feed that is one
// phenomenon is declared as such in sources.json, so next week's phrasing cannot
// walk around it.
const plainWording = { ...sameDay, title: 'Report for 27 August-2 September 2026' };
ok(
  'a wire declared as one phenomenon takes the penalty whatever the wording',
  scoreItem({ ...plainWording, spectacle: true }) < scoreItem(plainWording)
);

// The hard rule itself. Three ways the answer comes back no, and the case the
// brief was explicit about: a volcano you can stand near is a post, the same
// volcano closed to visitors is not.
ok('no place to stand is not a trip', tripGap({ where: '', how: 'fly to X', open: true, want: 'w' }) !== null);
ok('no way to get there is not a trip', tripGap({ where: 'איסלנד', how: '', open: true, want: 'w' }) !== null);
ok('closed to visitors is not a trip', tripGap({ where: 'הר הגעש פואגו', how: 'tours from Antigua', open: false, want: 'w' }) !== null);
ok(
  'a volcano someone can stand near is a trip',
  tripGap({ where: 'הר הגעש פואגו', how: 'overnight hike from Antigua, 2 hours from Guatemala City', open: true, want: 'you watch it erupt from the next ridge' }) === null
);
ok('a missing trip object is not a trip', tripGap(undefined) !== null);

ok('B2B trade notices rank below traveller content',scoreItem(trade) < scoreItem({ ...trade, title: '箸作り体験を渋谷で開始' }));

// The intergovernmental half of the same problem, checked against the live
// UNESCO feed rather than invented: the post that prompted this — the first
// World Heritage site of São Tomé — was ranking BELOW a fund project, a side
// event, a policy adoption and a public forum, each of which cost a drafting
// call to be told that a strategy document is not a place anyone can stand.
const unesco = (title, summary) => scoreItem({ ...sameDay, authority: 'intergovernmental', title, summary });

const inscription = unesco(
  'Three New Countries Join the World Heritage List: A Major Milestone for Africa and SIDS',
  'With the inscription of three new properties located in the Comoros, São Tomé and Príncipe, and South Sudan, three countries have joined the World Heritage List for the first time.'
);

for (const [title, summary] of [
  ['UNESCO Supports Nauru in Completing its First World Heritage International Assistance Project', 'Supported through the World Heritage Fund, the project has strengthened national capacities for implementing the Convention.'],
  ['World Heritage Committee adopts a landmark strategy for Small Island Developing States', 'The Committee adopted the World Heritage Strategy for SIDS 2026-2034, with over 20 SIDS State Parties present. A comprehensive roadmap backed by a budget of US$13 million.'],
  ['Flying Beyond Borders: Connecting People, Birds and Habitats', 'The side event was organized on 25 July 2026 during the 48th session of the World Heritage Committee in Busan.'],
  ['UNESCO-supported Public Forum Empowers Youth and Advances Partnerships', 'A Public Forum was held in Ravno, bringing together representatives of government institutions, academia and civil society.'],
]) {
  ok(`a new place outranks institutional news: ${title.slice(0, 38)}`, inscription > unesco(title, summary));
}

// Both halves of the feed say "the 48th session of the World Heritage
// Committee", so the session is not the signal and must not be treated as one.
ok(
  'the committee session itself is not what gets penalised',
  unesco('25 new sites inscribed', 'The World Heritage Committee wrapped up its 48th session in Busan with the addition of 25 new sites.') > 0.5
);

// Somewhere nobody can go, ever — top item of all 65 on the day this was found.
ok(
  'a post about Mars is not a trip and does not lead the run',
  scoreItem({ ...sameDay, title: "Curiosity Postcard Celebrates Rover's 5,000th Day on Mars" }) < ordinary
);

/* -------------------------------------------------------------------------- */
group('dedupe identity');

eq(
  'tracking parameters do not create a second candidate',
  candidateId({ url: 'https://www.gov.uk/a?utm_source=x&utm_campaign=y' }),
  candidateId({ url: 'https://www.gov.uk/a' })
);
eq('a fragment does not either', candidateId({ url: 'https://www.gov.uk/a#top' }), candidateId({ url: 'https://www.gov.uk/a' }));
ok('different pages stay distinct', candidateId({ url: 'https://www.gov.uk/a' }) !== candidateId({ url: 'https://www.gov.uk/b' }));
ok('a real query parameter is significant', candidateId({ url: 'https://www.gov.uk/a?id=1' }) !== candidateId({ url: 'https://www.gov.uk/a' }));

/* -------------------------------------------------------------------------- */
group('the daily cap survives repeated gathers and restarts');

// The gather now runs through the day instead of once, so "the best two or
// three a day" has to be counted rather than being a property of running once.
{
  eq('a fresh day starts at zero', store.stagedToday('2026-08-24'), 0);
  store.noteStaged('2026-08-24');
  store.noteStaged('2026-08-24');
  eq('counts up', store.stagedToday('2026-08-24'), 2);
  eq('yesterday is not today', store.stagedToday('2026-08-23'), 0);
  store.noteStaged('2026-08-25');
  eq('a new day resets', store.stagedToday('2026-08-25'), 1);
  eq('and the old day is gone rather than accumulating', store.stagedToday('2026-08-24'), 0);
}

// Rejecting a card gives its slot back.
//
// The day this was written: three cards staged in the morning, all three
// rejected, remaining quota zero, the gather stopped looking, and the day
// produced no posts at all. A card you turned down is not one of "the best two
// or three a day".
{
  const DAY = '2026-08-26';
  store.noteStaged(DAY);
  store.noteStaged(DAY);
  store.noteStaged(DAY);
  eq('three offered', store.stagedToday(DAY), 3);
  eq('none rejected yet', store.rejectedToday(DAY), 0);

  store.noteRejected(DAY);
  eq('a rejection is counted', store.rejectedToday(DAY), 1);
  eq('but the offer count stands - the ceiling is computed from it', store.stagedToday(DAY), 3);

  store.noteRejected(DAY);
  store.noteRejected(DAY);
  eq('all three refunded', store.rejectedToday(DAY), 3);

  // Bounded by what was actually offered, so a card staged yesterday and
  // rejected today cannot mint a slot today never spent.
  store.noteRejected(DAY);
  eq('a fourth rejection cannot refund what was never offered', store.rejectedToday(DAY), 3);
  eq('and rejections do not leak into another day', store.rejectedToday('2026-08-27'), 0);
}

// The scheduling decision itself, as a pure function of the clock and the counts.
{
  const RUN_HOUR = 8, UNTIL = 22, EVERY_MS = 2 * 3_600_000, TARGET = 3, CEILING = 9;
  const remaining = (offered, rejected) =>
    Math.min(TARGET - (offered - rejected), CEILING - offered);
  const wouldGather = (hour, offered, sinceLastMs, rejected = 0) =>
    hour >= RUN_HOUR && hour < UNTIL && remaining(offered, rejected) > 0 && sinceLastMs >= EVERY_MS;

  ok('gathers at the start of the window', wouldGather(8, 0, Infinity));
  ok('gathers again later in the day - this is the whole point', wouldGather(14, 1, EVERY_MS));
  ok('does not gather before the window opens', !wouldGather(6, 0, Infinity));
  ok('does not gather overnight', !wouldGather(23, 0, Infinity));
  ok('stops once the daily cap is met', !wouldGather(14, 3, Infinity));
  ok('does not gather twice inside one interval', !wouldGather(14, 0, EVERY_MS - 1));

  // The bug: rejecting the morning's three used to end the day.
  ok('a rejected card frees its slot, so the day is not over', wouldGather(14, 3, Infinity, 3));
  ok('rejecting one of three frees exactly one', remaining(3, 1) === 1);

  // ...but not without limit, or a day of rejections becomes a firehose and the
  // human gate becomes a rubber stamp.
  ok('the offer ceiling still ends the day', !wouldGather(14, 9, Infinity, 9));
  eq('and it binds before the target does', remaining(8, 8), 1);
}

/* -------------------------------------------------------------------------- */
group('the quiet alarm - the check that could not fire');

// It watched an in-memory `lastStagedAt` that started null, behind a truthiness
// guard, and was only ever set by a successful staging. So a bot that staged
// nothing — the exact thing the alarm exists to report — skipped the check
// forever, and a restart reset it. It also watched staging only, so a day where
// cards arrived and none was approved published nothing and said nothing.
{
  const HOURS = 30;
  const LIMIT = HOURS * 3_600_000;
  const now = 1_800_000_000_000;
  const bootedAt = now - 40 * 3_600_000;
  // Exactly the two lines from bot.js quietCheck().
  const isQuiet = (stagedAt, publishedAt) =>
    now - (stagedAt ?? bootedAt) >= LIMIT || now - (publishedAt ?? bootedAt) >= LIMIT;

  const fresh = now - 1 * 3_600_000;
  const stale = now - 31 * 3_600_000;

  ok('a bot that has never staged anything is quiet, not exempt', isQuiet(null, null));
  ok('nothing staged for 31 hours is quiet', isQuiet(stale, fresh));
  ok('staged all day but never published is quiet too', isQuiet(fresh, stale));
  ok('both moving recently is not quiet', !isQuiet(fresh, fresh));

  // The anchors have to survive a restart or 30 hours can never accumulate on a
  // bot that is restarted daily.
  store.noteStagedAt();
  ok('the staging anchor is persisted', store.lastStagedAt() != null);
  store.recordPublished({ id: 'quiet-alarm-probe', pillar: 'fact', tags: [], layout: 'numbers', instagram: true });
  ok('the publish anchor is persisted', store.lastPublishedAt() != null);
  store.forgetPublished('quiet-alarm-probe');
}

// The message has to say which half is quiet and what to do about it, or it is
// just a nudge to go and type /status.
{
  const dark = [{ target: 'instagram', hoursAgo: 31, ever: true }];
  const base = { hours: 30, stagedHoursAgo: 31, everStaged: true, darkTargets: dark };

  const waiting = quietAlert({ ...base, stagingSize: 2, queueSize: 0 });
  ok('names the approval tap when cards are waiting', waiting.includes('ממתינים לאישור שלך'));

  const stuck = quietAlert({ ...base, stagingSize: 0, queueSize: 3 });
  ok('names publishing when the queue is full but nothing goes out', stuck.includes('בדוק את הפרסום'));

  const dry = quietAlert({ ...base, stagingSize: 0, queueSize: 0 });
  ok('names the pipeline when there is nothing anywhere', dry.includes('/run'));

  const held = quietAlert({ ...base, stagingSize: 2, queueSize: 1, heldCount: 4 });
  ok('held posts outrank everything else as the thing to act on', held.includes('/retry'));

  const never = quietAlert({
    ...base,
    everStaged: false,
    darkTargets: [{ target: 'instagram', hoursAgo: 40, ever: false }],
  });
  ok('says "never staged" rather than an hour count it cannot know', never.includes('מאז שהבוט עלה'));
  ok('says "never published there" too', never.includes('מעולם לא פורסם'));

  const onlyPublish = quietAlert({ ...base, stagedHoursAgo: 1, stagingSize: 1 });
  ok('reports only the half that is actually quiet', !onlyPublish.includes('לא עלה מועמד חדש'));
  ok('and still reports the other half', onlyPublish.includes('שום דבר לא פורסם'));

  // The failure this was rewritten for: one destination up, one down.
  const oneDark = quietAlert({ ...base, stagedHoursAgo: 1, stagingSize: 0, queueSize: 0 });
  ok('names WHICH destination is dark', oneDark.includes('אינסטגרם'));
  ok('and does not blame the one that is working', !oneDark.includes('טלגרם'));
}

/* -------------------------------------------------------------------------- */
group('a blocked destination must not be silently abandoned');

// The actual outage: Instagram returned "API access blocked" on every post.
// Telegram succeeded, so `succeeded.length` was non-zero, so the item was
// recorded as published and never retried — one warning line per post, and the
// Instagram account dark for days behind it.
{
  const TARGET = 'instagram';
  store.clearDegraded(TARGET);

  // The retry unit is the destination, not the item. This is the arithmetic
  // from publishNext(): what a card still owes after a pass.
  const owedAfter = (owed, succeeded) => owed.filter((t) => !succeeded.includes(t));
  eq(
    'a card that reached Telegram still owes Instagram',
    owedAfter(['telegram', 'instagram'], ['telegram']).join(),
    'instagram'
  );
  eq(
    'and retrying it cannot duplicate Telegram',
    owedAfter(['telegram', 'instagram'], ['telegram']).includes('telegram'),
    false
  );
  eq('a card that reached both owes nothing', owedAfter(['telegram', 'instagram'], ['telegram', 'instagram']).length, 0);

  // Consecutive failures, reset by any success — a blip must not look like a
  // block, and a block must not stay invisible.
  const first = store.noteTargetFailed(TARGET, 'API access blocked [code 200]');
  eq('one failure is not yet a block', first.degraded, false);
  eq('and it does not escalate', first.justDegraded, false);

  store.noteTargetFailed(TARGET, 'API access blocked [code 200]');
  const third = store.noteTargetFailed(TARGET, 'API access blocked [code 200]');
  eq('three in a row is a block', third.degraded, true);
  ok('which escalates exactly once', third.justDegraded);

  const fourth = store.noteTargetFailed(TARGET, 'API access blocked [code 200]');
  ok('and does not escalate again on every later card', !fourth.justDegraded);
  ok('the error is kept for the report', store.targetHealth(TARGET).lastError.includes('code 200'));
  ok('the destination is skipped while degraded', store.isDegraded(TARGET));

  store.noteTargetOk(TARGET);
  eq('a success clears the streak', store.targetHealth(TARGET).failures, 0);
  eq('and un-degrades it', store.isDegraded(TARGET), false);
  ok('and stamps when it last worked', store.lastOkAt(TARGET) != null);

  // Telegram working must not vouch for Instagram — the whole reason the old
  // global "did anything publish" check never fired.
  ok('health is per destination', store.lastOkAt('telegram') == null);
}

// An approved post that a destination refused is set aside, not dropped.
{
  const cand = { id: 'held-probe', headline: 'כותרת', pillar: 'fact', tags: [], layout: 'numbers' };
  eq('nothing held to start', store.heldCount(), 0);

  store.hold(cand, ['instagram'], 'API access blocked');
  eq('the post is kept', store.heldCount(), 1);
  eq('with the destination it still owes', store.heldItems()[0].targets.join(), 'instagram');

  const released = store.releaseHeld();
  eq('/retry gets them all back', released.length, 1);
  eq('and the hold list empties', store.heldCount(), 0);
  eq('the card itself survives intact', released[0].cand.headline, 'כותרת');
}

// Not every held post CAN be retried, which is why there is a way to give up.
//
// A card is frozen at approval with whatever its destinations said then, and
// for TikTok that includes the privacy level - attached once by creator_info at
// staging and never re-read. A card approved while TikTok was unreachable
// carries none, so it throws the instant it is picked up, and /retry cannot
// help: it re-enqueues the stored candidate verbatim, so the same card fails
// the same way forever while re-degrading the destination behind it. Clearing
// the degraded flag is itself only something /retry does, so without this there
// is no exit from that loop.
{
  const frozen = { id: 'poisoned-probe', headline: 'בלי רמת פרטיות', pillar: 'fact', tags: [], layout: 'numbers' };
  store.hold(frozen, ['tiktok'], 'no privacy level was chosen at approval');
  store.hold({ ...frozen, id: 'poisoned-probe-2' }, ['tiktok'], 'no privacy level was chosen at approval');
  eq('two unpublishable cards are held', store.heldCount(), 2);

  eq('/clear_held reports what it discarded', store.clearHeld(), 2);
  eq('and the backlog is gone', store.heldCount(), 0);
  // The distinction that makes this safe to offer: a held row lists only what a
  // destination still OWES. Whatever already published did so before the card
  // was held, so giving up on the row cannot unpublish anything.
  eq('nothing is left to release afterwards', store.releaseHeld().length, 0);
  eq('and clearing an empty backlog is a no-op', store.clearHeld(), 0);
}

// Reaching the second destination later must not count the post twice.
{
  const id = 'partial-publish-probe';
  store.recordPublished({ id, pillar: 'fact', tags: [], layout: 'numbers', telegram: true, instagram: false });
  const afterFirst = store.recentPublished().filter((p) => p.id === id);
  eq('one row after the first destination', afterFirst.length, 1);

  store.recordPublished({ id, pillar: 'fact', tags: [], layout: 'numbers', telegram: false, instagram: true });
  const afterSecond = store.recentPublished().filter((p) => p.id === id);
  eq('still one row after the second', afterSecond.length, 1);
  eq('and it now records both', `${afterSecond[0].telegram}/${afterSecond[0].instagram}`, 'true/true');
  store.forgetPublished(id);
}

// "API access blocked" names a symptom and no cause. The code, subcode and step
// are what tell a dead token from a throttle from an app-level restriction, and
// they were being dropped before the message ever reached Telegram.
{
  const blocked = new InstagramError('API access blocked', { step: 'create_container', code: 200, subcode: 2207051 });
  const text = describeError(blocked);
  ok('keeps Graph\'s own message', text.includes('API access blocked'));
  ok('adds the code', text.includes('code 200'));
  ok('adds the subcode', text.includes('subcode 2207051'));
  ok('and says which step failed', text.includes('create_container'));

  const expired = describeError(new InstagramError('Session has expired', { step: 'publish', code: 190 }));
  ok('a token code carries the fix with it', expired.includes('ig-token'));

  const plain = describeError(new Error('socket hang up'));
  eq('a non-Graph error is passed through unchanged', plain, 'socket hang up');
}

/* -------------------------------------------------------------------------- */
group('/redo must not resurrect something already published');

// The exact sequence that happened: an iceberg post was approved, published to
// Instagram, then /redo cleared `seen` and it came straight back to the
// approval queue with a different photograph.
{
  const item = { url: 'https://earthobservatory.nasa.gov/images/1', title: 'Drifter', summary: 'x'.repeat(300), authority: 'government', pillarHints: ['fact'] };
  const id = candidateId(item);

  store.forgetAllSeen();
  ok('before publishing, it ranks', rank([item], { now: Date.now() }).length === 1);

  store.recordPublished({ id, pillar: 'fact', tags: [], layout: 'photoFull', instagram: true });
  eq('after publishing, it is remembered', store.hasPublished(id), true);
  ok('and it no longer ranks', rank([item], { now: Date.now() }).length === 0);

  // The whole point of /redo is to clear `seen`. It must not clear this.
  store.forgetAllSeen();
  eq('/redo does not forget it', store.hasPublished(id), true);
  ok('so it still does not rank', rank([item], { now: Date.now() }).length === 0);

  // A different item is unaffected — this is not a blanket freeze.
  const other = { ...item, url: 'https://earthobservatory.nasa.gov/images/2' };
  ok('an unpublished item still ranks', rank([other], { now: Date.now() }).length === 1);

  store.forgetPublished(id);
  ok('and it can be released deliberately', rank([item], { now: Date.now() }).length === 1);
}

/* -------------------------------------------------------------------------- */
group('no word twice in a headline');

// "יולי" appeared at both ends of a real staged card. Accurate, and it reads
// assembled rather than written.
ok('flags the live repeat', noRepeatedWord({ headline: 'יולי היה החודש הכי עמוס ביפן אי פעם ליולי' }));
ok('sees through an attached Hebrew prefix - ליולי is יולי', noRepeatedWord({ headline: 'יולי עמוס ליולי' }));
eq('the rewrite passes', noRepeatedWord({ headline: 'יולי השיא של התיירות ביפן' }), null);
eq('a real headline passes', noRepeatedWord({ headline: 'הקרחון הענק במיצר שבין גרינלנד לאיסלנד' }), null);
eq('an alert headline passes', noRepeatedWord({ headline: 'בריטניה ביטלה את האזהרה מנסיעה לבחריין' }), null);
eq('function words may repeat', noRepeatedWord({ headline: 'בין הים בין ההרים של הצפון' }), null);
throws('verifyDraftText refuses one', () =>
  verifyDraftText({ headline: 'יפן פתחה מסלול חדש ליפן', caption: 'a caption long enough to pass the length check' })
);

/* -------------------------------------------------------------------------- */
group('feeds that are themselves the publication');

// The Smithsonian weekly volcano report puts each volcano's full report in its
// own item and links all 21 of them to the same landing page — which returns
// 403 to anything that is not a browser.
const volcanoFeed = `<?xml version="1.0"?><rss version="2.0"><channel>
  <item><title>Etna (Italy) - Report for 13 August-19 August 2026</title>
    <link>https://volcano.si.edu/reports_weekly.cfm</link><description>Explosive activity at Voragine Crater persisted.</description></item>
  <item><title>Karangetang (Indonesia) - Report for 13 August-19 August 2026</title>
    <link>https://volcano.si.edu/reports_weekly.cfm</link><description>Lava advanced about 700 m south.</description></item>
</channel></rss>`;

const volSrc = { id: 'v', name: 'V', authority: 'research-institution', lang: 'en', pillars: ['fact'], dedupeBy: 'title', contentInFeed: true };
const volItems = parseFeed(volcanoFeed, volSrc);
eq('both items survive parsing', volItems.length, 2);
ok('a shared link does not collapse them into one candidate', candidateId(volItems[0]) !== candidateId(volItems[1]));
ok('identity comes from the title', Boolean(volItems[0].dedupeId));
ok('the feed-content flag is carried onto the item', volItems[0].contentInFeed === true);

const plainItems = parseFeed(volcanoFeed, { ...volSrc, dedupeBy: undefined, contentInFeed: undefined });
eq('without the flag, a shared link still collapses them', candidateId(plainItems[0]), candidateId(plainItems[1]));
ok('and no feed-content flag is set', plainItems[0].contentInFeed === undefined);

// A feed item carries no menus or breadcrumbs, so the same character count buys
// more substance than it does on a page. The real Smithsonian report that was
// being thrown away came to 779 characters.
ok('the feed floor is lower than the page floor', minSourceChars('english text', { fromFeed: true }) < minSourceChars('english text'));
ok('779 characters of clean report clears the feed floor', 779 > minSourceChars('english text', { fromFeed: true }));
ok('but 779 would not clear the page floor', 779 < minSourceChars('english text'));

/* -------------------------------------------------------------------------- */
group('rounding - a decimal on a card means it was generated, not written');

// Both of these shipped to the approval queue before the guard existed.
ok('rejects the live "16.7 מעלות" headline', noDecimalsUpFront({ headline: 'נובמבר בטוקיו: 16.7 מעלות ורק 8.6 ימי גשם' }));
ok('rejects the live "2.6 ימי גשם" headline', noDecimalsUpFront({ headline: 'בנובמבר בקטמנדו יורדים 2.6 ימי גשם בממוצע' }));
ok('rejects a decimal in the subhead too', noDecimalsUpFront({ headline: 'ok', subhead: 'ממוצע 30.9 ימים' }));
eq('a rounded headline passes', noDecimalsUpFront({ headline: 'נובמבר בטוקיו: 17 מעלות וכמעט בלי גשם' }), null);
eq('a time of day is not a decimal', noDecimalsUpFront({ headline: 'הטיסה נוחתת ב-06:30' }), null);
eq('a date is not a decimal', noDecimalsUpFront({ headline: 'נכנס לתוקף ב-1/10' }), null);
throws('verifyDraftText refuses a draft carrying one', () =>
  verifyDraftText({ headline: 'טוקיו ב-16.7 מעלות', caption: 'a caption long enough to pass the length check' })
);

/* -------------------------------------------------------------------------- */
group('card filenames - a dedupeId is not automatically a safe filename');

// Found by measuring a real run: two drafting calls a day were being paid for
// and then thrown away at the render step, because the climate adapter's
// readable dedupeId contains colons.
eq('colons are replaced - Windows rejects them outright', safeStem('climate:dubai:2025'), 'climate-dubai-2025');
eq('a hex id is untouched', safeStem('a1b2c3d4e5f6'), 'a1b2c3d4e5f6');
ok('nothing survives that would need URL-escaping', /^[A-Za-z0-9._-]+$/.test(safeStem('a b/c:d?e#f')));
eq('an id of only separators still yields a filename', safeStem(':::'), 'card');
ok('long ids are bounded', safeStem('x'.repeat(300)).length <= 100);

/* -------------------------------------------------------------------------- */
group('thin sources are rejected before a drafting call is paid for');

const thinItem = (text, title = 'x') => ({ title, summary: '', url: 'https://www.gov.uk/a', text });

eq(
  'a Japanese headline stub is under the CJK floor',
  minSourceChars('お知らせ：安全情報リーフレットを刷新しました。'.repeat(4)),
  700
);
eq('an English page is judged by the higher floor', minSourceChars('a plain english travel advisory update'), 1200);
ok(
  'the observed stub sizes (291 and 346 chars) fall under the CJK floor',
  291 < minSourceChars('日本語') && 346 < minSourceChars('日本語')
);
ok(
  'the thinnest genuinely usable source that day (3157 chars) clears the floor',
  3157 > minSourceChars('an english advisory')
);

/* -------------------------------------------------------------------------- */
group('image policy - AI imagery may only be generic');

throws('rejects a prompt naming the post\'s place', () => assertGenericAiPrompt('a sunny street in Lisbon', { place: 'Lisbon', country: 'Portugal' }));
throws('rejects a prompt naming the country', () => assertGenericAiPrompt('rooftops in portugal at dusk', { place: 'Lisbon', country: 'Portugal' }));
ok('allows an abstract prompt', assertGenericAiPrompt('abstract warm-toned travel texture', { place: 'Lisbon', country: 'Portugal' }));

/* -------------------------------------------------------------------------- */
group('rendering - escaping and layout selection');

const draft = {
  layout: 'fact',
  pillar: 'fact',
  headline: 'כותרת <script>alert(1)</script> a & b',
  subhead: 'זו שורת המשך שלא אמורה להופיע על הכרטיס',
  place: 'תל אביב',
  country: '',
  url: 'https://www.gov.uk/x',
  bullets: [],
};
const html = renderHtml(draft);
ok('interpolated content is escaped', !html.includes('<script>alert(1)</script>') && html.includes('&lt;script&gt;'));
ok('ampersand escaped', html.includes('a &amp; b'));

// The card is the hook. If the subhead is printed on it too, the description
// has nothing left to offer and nobody taps "more".
ok('the subhead is NOT printed on the card', !html.includes('שלא אמורה להופיע'));
for (const layout of LAYOUTS) {
  const h = renderHtml({ ...draft, layout, stat: { value: '1', label: 'x' }, compare: { a: 'a', b: 'b' }, route: {} });
  ok(`${layout} keeps the subhead off the card`, !h.includes('שלא אמורה להופיע'));
}
ok('document declares Hebrew and RTL', html.includes('lang="he"') && html.includes('dir="rtl"'));
ok('the font is inlined, not linked', html.includes('data:font/ttf;base64,') && !html.includes('fonts.googleapis'));
// The card is a hook, not a citation: no source line, no credit line. The
// sourcing rule is unaffected - it lives in the approval message, which is
// asserted separately below and prints the URL unconditionally.
ok(
  'the card carries no source line',
  !renderHtml({ ...draft, sourceUrl: 'https://www.jnto.go.jp/news/x' }).includes('jnto.go.jp')
);

// The card carries no photographer or library credit - Pexels does not require
// it and it is visual noise on a 4:5 card. The provenance trail is not lost:
// it still appears in the approval message, which is where the "show me which
// origin this came from" rule actually lives.
for (const l of PHOTO_LAYOUTS) {
  ok(
    `${l} keeps the card clean of credit lines`,
    !renderHtml({ ...draft, layout: l }, {
      image: { src: 'data:image/png;base64,AA', provenance: 'stock', credit: 'Pexels / Ada L' },
    }).includes('Ada L')
  );
}

eq('ten layouts registered', LAYOUTS.length, 10);
ok('the photo family is identified as such', PHOTO_LAYOUTS.every(isPhotoLayout) && !isPhotoLayout('fact'));

// A photo layout with no image must degrade to a text card, never render an
// empty frame. With no image provider configured this is not an edge case — it
// is what happens on every single render today.
for (const l of PHOTO_LAYOUTS) {
  const noImage = renderHtml({ ...draft, layout: l });
  ok(`${l} falls back to a text card when no image is supplied`, !noImage.includes('class="bg"') && noImage.includes('&lt;script&gt;'));
  ok(`${l} renders a background image when one is supplied`, renderHtml({ ...draft, layout: l }, { image: { src: 'data:image/png;base64,AA', provenance: 'stock' } }).includes('class="bg"'));
}

// Layout-specific payloads must actually reach the card.
ok(
  'numbers renders the figure, isolated so bidi cannot reorder it',
  (() => {
    const h = renderHtml({ ...draft, layout: 'numbers', stat: { value: '3,715', unit: 'מטר', label: 'גובה' } });
    return h.includes('3,715') && /unicode-bidi:\s*isolate/.test(h);
  })()
);
ok(
  'compare renders both panels',
  renderHtml({ ...draft, layout: 'compare', compare: { aTitle: 'מיתוס', aText: 'א', bTitle: 'מציאות', bText: 'ב' } }).includes('מציאות')
);
ok(
  'route renders origin and destination',
  (() => {
    const h = renderHtml({ ...draft, layout: 'route', route: { from: 'תל אביב', to: 'טביליסי', operator: '', startsOn: '' } });
    return h.includes('טביליסי') && h.includes('תל אביב');
  })()
);

/* -------------------------------------------------------------------------- */
group('approval message - the source URL is never optional');

const cand = {
  ...draft,
  caption: 'טקסט',
  tags: [],
  sourceUrl: 'https://www.gov.uk/foreign-travel-advice/japan',
  sourceName: 'UK FCDO',
  evidence: [{ claim: 'a', quote: 'b' }],
  image: null,
};
const msg = approvalMessage({ ...cand, publishTargets: ['instagram'] });
ok('contains the full source URL verbatim', msg.includes(cand.sourceUrl));
ok('states the image provenance (or that there is none)', /תמונה:/.test(msg));
ok('reports how many quotes were verified', /1 ציטוט/.test(msg));
ok('says where it will publish, before you tap', msg.includes('יפורסם לאינסטגרם'));
ok('warns when there is nowhere to publish', approvalMessage({ ...cand, publishTargets: [] }).includes('אין יעד פרסום'));

// A photo-led draft that arrives as a wall of type looks exactly like a draft
// that chose a text layout on purpose, so a stock provider that has stopped
// answering reads as a run of editorial decisions for as long as nobody checks.
const demoted = approvalMessage({
  ...cand,
  publishTargets: ['telegram'],
  layout: 'fact',
  photoDowngrade: 'photoFull',
  imageMiss: 'Pexels search failed: HTTP 429',
});
ok('a card that wanted a photograph and did not get one says so', demoted.includes('HTTP 429'));
ok('and names the layout it was demoted from', demoted.includes('photoFull'));
ok('a deliberately text-led card has nothing to explain', !/ירד ל/.test(approvalMessage({ ...cand, publishTargets: ['telegram'] })));

/* -------------------------------------------------------------------------- */
group('publish targets - Telegram may be approval-only');

const targetsFor = (env) => publishTargets({ ...env });
const IG = { IG_USER_ID: '1', IG_ACCESS_TOKEN: 'x', CARD_PUBLIC_BASE_URL: 'https://x/c' };

// instagramConfigured() reads process.env directly, so drive it there.
const withEnv = (patch, fn) => {
  const saved = {};
  for (const k of Object.keys(patch)) {
    saved[k] = process.env[k];
    if (patch[k] === undefined) delete process.env[k];
    else process.env[k] = patch[k];
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
};

withEnv({ ...IG, CHANNEL_ID: undefined }, () => {
  eq('Instagram only (no channel) is a valid setup', targetsFor({ CHANNEL_ID: undefined }).join(','), 'instagram');
});
withEnv({ IG_USER_ID: undefined, IG_ACCESS_TOKEN: undefined, CARD_PUBLIC_BASE_URL: undefined }, () => {
  eq('Telegram channel only is a valid setup', targetsFor({ CHANNEL_ID: '@c' }).join(','), 'telegram');
  eq('neither configured yields no targets - bot refuses to start', targetsFor({ CHANNEL_ID: undefined }).length, 0);
});
withEnv(IG, () => {
  eq('both configured publishes to both', targetsFor({ CHANNEL_ID: '@c' }).join(','), 'telegram,instagram');
});
withEnv({ ...IG, CARD_PUBLIC_BASE_URL: undefined }, () => {
  eq(
    'Instagram without a public card URL is not configured - it cannot fetch the image',
    targetsFor({ CHANNEL_ID: undefined }).length,
    0
  );
});

/* -------------------------------------------------------------------------- */
group('tiktok - the privacy level is chosen, never assumed');

// The whole point of the privacy plumbing: a default that errs towards the
// quietest setting, and a level the owner actually saw before tapping.
eq('defaults to the most private level available', defaultPrivacy(['PUBLIC_TO_EVERYONE', 'SELF_ONLY']), 'SELF_ONLY');
eq(
  'honours TIKTOK_PRIVACY when the account really offers it',
  defaultPrivacy(['PUBLIC_TO_EVERYONE', 'SELF_ONLY'], 'PUBLIC_TO_EVERYONE'),
  'PUBLIC_TO_EVERYONE'
);
eq(
  'ignores TIKTOK_PRIVACY when the account does not offer it - an unaudited app gets SELF_ONLY only',
  defaultPrivacy(['SELF_ONLY'], 'PUBLIC_TO_EVERYONE'),
  'SELF_ONLY'
);
eq('falls back to whatever came back when SELF_ONLY is absent', defaultPrivacy(['FOLLOWER_OF_CREATOR']), 'FOLLOWER_OF_CREATOR');
eq('with nothing offered at all, still names a level rather than undefined', defaultPrivacy([]), 'SELF_ONLY');

const two = ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'];
eq('the button cycles forward', nextPrivacy('PUBLIC_TO_EVERYONE', two), 'SELF_ONLY');
eq('and wraps', nextPrivacy('SELF_ONLY', two), 'PUBLIC_TO_EVERYONE');
eq('a level no longer offered lands on the first available one', nextPrivacy('MUTUAL_FOLLOW_FRIENDS', two), two[0]);
eq('one option means the button cannot change anything', nextPrivacy('SELF_ONLY', ['SELF_ONLY']), 'SELF_ONLY');
ok('every level has Hebrew', two.every((l) => privacyHe(l) !== l));

// Refusing before the network, not during it. A publish that reaches TikTok
// without a chosen privacy level is the one failure this path exists to stop,
// so it must not depend on the API to catch it.
const noPrivacy = await publishTikTok({ card: { url: 'https://x/c.jpg' } }).then(
  () => null,
  (e) => e
);
ok('refuses to publish with no privacy level chosen', noPrivacy instanceof TikTokError);
ok('and says so before any API call', noPrivacy.step === 'config', `step was ${noPrivacy?.step}`);

// `step: 'config'` is load-bearing beyond being a label. The publish loop reads
// it to tell "this CARD can never go here" from "this DESTINATION is having a
// bad day", and the difference is what stopped a run of unpublishable cards
// degrading TikTok and taking good cards down with them: three no-privacy
// cards marked the destination degraded, and every card behind them was then
// skipped and held without ever being attempted.
//
// Every per-card refusal must carry it, or it gets scored as an outage.
for (const [what, cand] of [
  ['no privacy level', { card: { url: 'https://x/c.jpg' } }],
  ['a non-https image', { tiktok: { privacy: 'SELF_ONLY' }, card: { url: 'http://x/c.jpg' } }],
]) {
  const e = await publishTikTok(cand).then(() => null, (err) => err);
  ok(`${what} is the card's problem, not the destination's`, e?.step === 'config', `step was ${e?.step}`);
}
// TikTok decides some of these at ITS end, and they are the same kind of thing.
//
// creator_info reports what the ACCOUNT supports, not what this CLIENT may use
// — a comment in tiktok.js claimed the opposite for months. So an unaudited app
// against a public account is offered all three privacy levels, offers them on
// the approval card, and is refused at init. Scoring that as an outage degraded
// TikTok after three cards and held every good card behind them, when a card
// asking for SELF_ONLY would have published perfectly well.
const unaudited = new TikTokError('Please review our integration guidelines', {
  step: 'init',
  code: 'unaudited_client_can_only_post_to_private_accounts',
});
ok("an unaudited-client refusal is the card's problem", isCardLevelTikTok(unaudited));
ok('a mismatched privacy level is too', isCardLevelTikTok(new TikTokError('x', { step: 'init', code: 'privacy_level_option_mismatch' })));
// The ones that really are the destination must still degrade it, or an outage
// would be retried forever with no backoff and no alert.
// The status poll, and the one coded error that is a TIMING window rather than
// an argument. TikTok's status endpoint does not always know a publish_id its
// own init endpoint minted a moment earlier, and the loop used to give up on
// the first sight of any code at all: "after 1 attempts: invalid_publish_id".
//
// Reported as a publish failure, on a video that was already on its way to the
// inbox. So the card went back round to be delivered a second time and the
// destination collected a failure it did not earn, which after three of them
// latches it degraded and holds every good post behind it.
{
  const realFetch = globalThis.fetch;
  // TikTok's envelope: an error is `error: {code, message}`, and the specific
  // problem is in the MESSAGE while the code is a generic bucket.
  const fail = (code, message) => ({ error: { code, message, log_id: 'L1' } });
  const fine = (status) => ({ data: { status }, error: { code: 'ok' } });
  const replies = (seq) => {
    let i = 0;
    return async () => ({ ok: true, status: 200, json: async () => seq[Math.min(i++, seq.length - 1)] });
  };
  const poll = () =>
    waitForPublish('p_inbox_url~v2.1', 'tok', { intervalMs: 0 }).then((d) => d.status, (e) => e);

  globalThis.fetch = replies([fail('invalid_params', 'invalid_publish_id'), fine('SEND_TO_USER_INBOX')]);
  eq('a publish_id the status endpoint has not caught up with is asked again', await poll(), 'SEND_TO_USER_INBOX');

  globalThis.fetch = replies([fail('invalid_params', 'invalid_publish_id')]);
  const forever = await poll();
  ok('but not forever', forever instanceof TikTokError && /after 4 attempts/.test(forever.message), forever?.message);

  // Everything else keeps failing on the first poll. Asking a dead token three
  // more times is three wasted calls and a promise that cannot be kept.
  globalThis.fetch = replies([fail('access_token_invalid', 'token is invalid')]);
  const dead = await poll();
  ok('a dead token still gives up at once', dead instanceof TikTokError && /after 1 attempts/.test(dead.message), dead?.message);

  // And TikTok saying the publish itself failed is still a failure, not a retry.
  globalThis.fetch = replies([fine('FAILED')]);
  const refused = await poll();
  ok('a FAILED status is not retried into a success', refused instanceof TikTokError && /publish failed/.test(refused.message), refused?.message);

  globalThis.fetch = realFetch;
}

// Are the files TikTok is about to fetch actually there?
//
// preflight checked the URLs were well formed, https and on a verified domain,
// and never that anything was AT them. A plan built before slideStem grew its
// `deck-` prefix kept its old URLs in the queue, the files under those names
// were gone, and every attempt passed preflight, reached init, and came back
// photo_pull_failed hours later - scored as a TikTok outage, because a status
// failure is not a card refusal. Three of those degraded the destination and
// held every good post behind one that could never work.
{
  const realFetch = globalThis.fetch;
  const A = 'https://cards.example.com/cards/deck-plan-a-tiktok-01.jpg';
  const B = 'https://cards.example.com/cards/deck-plan-a-tiktok-02.jpg';
  const heads = (map) => async (url) => {
    const s = map[String(url)] ?? 200;
    if (s === 'boom') throw new Error('connect ECONNREFUSED');
    return { ok: s < 400, status: s };
  };

  globalThis.fetch = heads({ [A]: 200, [B]: 200 });
  eq('files that are there pass', (await assertFetchable([A, B])).length, 2);

  globalThis.fetch = heads({ [A]: 200, [B]: 404 });
  const missing = await assertFetchable([A, B]).then(() => null, (e) => e);
  ok('a slide that 404s is refused before the post is made', missing instanceof TikTokError, missing?.message);
  // The distinction the publish loop acts on. Its files are not coming back, so
  // the POST is abandoned by name and TikTok keeps its health - the next post,
  // whose slides exist, publishes perfectly well.
  ok("a missing slide is the post's problem", isCardLevelTikTok(missing), `step ${missing?.step}`);

  globalThis.fetch = heads({ [A]: 'boom' });
  const down = await assertFetchable([A]).then(() => null, (e) => e);
  ok('a host that does not answer is refused too', down instanceof TikTokError, down?.message);
  ok('but THAT one is the destination, and must still degrade', !isCardLevelTikTok(down), `step ${down?.step}`);

  globalThis.fetch = heads({ [A]: 503 });
  const sick = await assertFetchable([A]).then(() => null, (e) => e);
  ok('a 5xx from the host is the destination too', !isCardLevelTikTok(sick), `step ${sick?.step}`);

  eq('nothing to check is not a failure', (await assertFetchable([])).length, 0);

  globalThis.fetch = realFetch;
}

ok('a dead token is NOT', !isCardLevelTikTok(new TikTokError('x', { step: 'init', code: 'access_token_invalid' })));
ok('nor is an unknown server error', !isCardLevelTikTok(new TikTokError('x', { step: 'init', code: 'internal_error' })));
ok('nor is a plain Error from somewhere else', !isCardLevelTikTok(new Error('socket hang up')));
// The raw TikTok sentence says nothing about what to do, so the code carries it.
ok('the refusal explains the way out', describeTikTokError(unaudited).includes('audit'));
ok('and names the level that would work', describeTikTokError(unaudited).includes('פרטי'));

// And the message the owner gets says so, rather than reading as a failure.
const abandonMsg = notifyTargetAbandoned('כותרת', [{ target: 'tiktok', message: 'no privacy level was chosen at approval' }]);
ok('the notice names the destination given up on', abandonMsg.includes('טיקטוק'));
ok('and names the reason', abandonMsg.includes('no privacy level was chosen at approval'));
eq('on one line', abandonMsg.split('\n').length, 1);
ok('tiktok is not configured in the test environment', !tiktokConfigured());

// The error text has to name the code, because TikTok's sentence alone often
// does not say what to do — same lesson as Instagram's describeError().
const unverified = describeTikTokError(
  new TikTokError('url ownership unverified', { step: 'init', code: 'url_ownership_unverified' })
);
ok('failure text carries the code', unverified.includes('url_ownership_unverified'));
ok('and the step', unverified.includes('init'));
ok('and translates the ones worth acting on', unverified.includes('דומיין'));
eq('a plain error passes through untouched', describeTikTokError(new Error('boom')), 'boom');

// What people actually paste is the whole address bar, and TikTok appends a
// "*1" to the code on some redirects — pasting it raw fails as an invalid code,
// which reads like the login went wrong rather than the copy.
eq('reads the code out of a redirected URL', codeFrom('https://tiyulplus.com/cb?code=abc123&state=x'), 'abc123');
// The one that cost an evening. A v2 code carries a `*v!NNNN.sN` tail and it is
// part of the code — trimming it sends a truncated code, and TikTok reports a
// truncated code as an EXPIRED one, so every fresh attempt fails with an error
// that blames the clock and sends you back to fetch another doomed code.
eq(
  'keeps the *v!... tail, which is part of the code and not a suffix to discard',
  codeFrom('https://tiyulplus.com/cb?code=abc123%2Av%215236.s1&state=x'),
  'abc123*v!5236.s1'
);
eq('accepts a bare code too', codeFrom('abc123'), 'abc123');
eq('a bare code copied still encoded is decoded once', codeFrom('abc123%2Av%215236.s1'), 'abc123*v!5236.s1');
eq('nothing pasted, nothing returned', codeFrom('   '), null);
eq('a URL with no code at all', codeFrom('https://tiyulplus.com/cb'), null);
ok(
  'a refusal in the URL is raised rather than read as a missing code',
  (() => {
    try {
      codeFrom('https://tiyulplus.com/cb?error=access_denied&error_description=user%20said%20no');
      return false;
    } catch (e) {
      return /access_denied|said/.test(e.message);
    }
  })()
);

// TikTok's rule for Direct Post: the creator sees the privacy level before it
// publishes. That means it has to be on the approval card, and only there.
const tkCand = { ...cand, publishTargets: ['tiktok'], tiktok: { privacy: 'SELF_ONLY', username: 'tiyulplus', options: ['SELF_ONLY'] } };
const tkMsg = approvalMessage(tkCand);
ok('the approval card names the privacy level', tkMsg.includes(privacyHe('SELF_ONLY')));
ok('and the account it would post as', tkMsg.includes('@tiyulplus'));
ok(
  'a card with no TikTok target says nothing about privacy',
  !approvalMessage({ ...cand, publishTargets: ['telegram'] }).includes('פרטיות')
);
ok(
  'a failed creator-info call is reported rather than papered over with a default',
  approvalMessage({ ...cand, publishTargets: ['tiktok'], tiktok: { error: 'access_token_invalid', options: [] } }).includes(
    'access_token_invalid'
  )
);

// One description, one review. A second wording would be a second thing to
// approve, and the approval message only ever shows you one.
//
// Through publishedDescriptions, which is now the only way to get both. The
// close is a question and sometimes an ask, drawn per call, so calling the two
// builders in sequence draws twice and the identity this asserts is exactly what
// breaks. The build path was changed to match; this is what holds it there.
const bothCand = { headline: 'כותרת', subhead: 'תת כותרת', caption: 'גוף הטקסט.', sourceUrl: 'https://gov.uk/x' };
{
  const both = publishedDescriptions(bothCand);
  eq('the TikTok description is the same text as the Instagram one', both.tiktok, both.instagram);
}

/* -------------------------------------------------------------------------- */
group('decks - a slideshow is not a card, and goes somewhere else');

// The editorial rule, in code: one destination each. A news card is written for
// a feed and goes to Instagram; a deck is written for a vertical scroll and goes
// to TikTok. Sending both kinds to several places at once made every account a
// copy of the others.
withEnv({ ...IG, CHANNEL_ID: '@c' }, () => {
  eq('a card goes to Instagram and nowhere else', targetsForKind('card').join(','), 'instagram');
  ok('a card never goes to TikTok', !allowedForKind('card').includes('tiktok'));
  // A deck goes to both, and it is not the same artefact twice: the TikTok set
  // is drawn to be read over a video player's furniture, the Instagram set is
  // drawn as cards so a slideshow sits in the grid looking like the account
  // that posted it. Same words, same photographs, two designs.
  ok('a deck goes to TikTok', allowedForKind('deck').includes('tiktok'));
  ok('and a deck also goes to Instagram', allowedForKind('deck').includes('instagram'));
  // CHANNEL_ID is set in this env and still nothing routes to it. Telegram is
  // where posts are APPROVED; that path runs on STAGING_CHAT_ID and never comes
  // through here.
  ok('nothing publishes to Telegram, even with a channel configured', !allowedForKind('card').includes('telegram'));
  ok('not even a deck', !allowedForKind('deck').includes('telegram'));

  // The distinction health and the quiet alarm depend on. publishTargets says
  // what is CONFIGURED and still counts a Telegram channel; liveTargets says
  // what can actually receive something. Reading the first one would have left
  // Telegram with a lastOkAt of null for ever, reported dark from boot onwards,
  // with no possible way to clear it.
  ok('a configured channel still counts as configured', publishTargets().includes('telegram'));
  ok('but is not a live destination', !liveTargets().includes('telegram'));
  eq('and the live set is exactly where the two kinds go', liveTargets().sort().join(','), 'instagram');
});

// With TikTok connected too, both kinds have somewhere to go and both show up.
withEnv({ ...IG, CHANNEL_ID: '@c', TIKTOK_CLIENT_KEY: 'k', TIKTOK_CLIENT_SECRET: 's' }, () => {
  ok('Instagram is live for cards', liveTargets().includes('instagram'));
  ok('Telegram is still not live', !liveTargets().includes('telegram'));
});

// The condition publishNext holds on. Before each kind had exactly ONE
// destination, "no destination at all" needed two things switched off at once
// and was a genuine edge case. Now an unconnected TikTok means every approved
// deck reaches it — and the branch it used to fall into recorded the post as
// published and dropped it. Silently, one slideshow at a time, at the drip
// interval.
withEnv({ ...IG, CHANNEL_ID: '@c' }, () => {
  // While TikTok approval is pending, a deck is NOT stuck: it publishes to
  // Instagram and owes TikTok nothing it can act on. That is the whole value of
  // the deck reaching two platforms rather than one.
  eq('with TikTok pending a deck still has Instagram', targetsForKind('deck').join(','), 'instagram');
  ok('so nothing is waiting on a destination that does not exist yet', targetsForKind('deck').length > 0);
  ok('and cards are unaffected', targetsForKind('card').length > 0);
});

// The hold path still matters, for the case where a kind genuinely has nowhere
// to go. Neither destination configured means a deck cannot publish anywhere —
// and the startup guard refuses to start at all in that state, which is the
// first of the two defences.
// Explicitly cleared, not merely absent from the patch: withEnv only touches
// the keys it is given, and a developer .env supplies the real ones.
withEnv({ CHANNEL_ID: '@c', IG_USER_ID: undefined, IG_ACCESS_TOKEN: undefined, CARD_PUBLIC_BASE_URL: undefined }, () => {
  eq('with neither destination a deck has nowhere to go', targetsForKind('deck').length, 0);
  eq('and neither do cards', targetsForKind('card').length, 0);
  ok('which is what the startup guard refuses to start on', !targetsForKind('card').length && !targetsForKind('deck').length);
});

// Its own message, not the outage one. "Held until TikTok comes back to work"
// is the wrong sentence for an account that has never been connected, and a bot
// that reports a setup step in the vocabulary of an outage teaches you to read
// real outages as setup steps.
const waitMsg = publishWaitingForSetup('המקדשים של קיוטו', ['tiktok'], 3);
ok('it names the destination being waited on', waitMsg.includes('טיקטוק'));
ok('it says the destination is not connected', waitMsg.includes('לא מחובר'));
ok('it carries the headline', waitMsg.includes('המקדשים של קיוטו'));
ok('and says how many are waiting', waitMsg.includes('3'));
ok('it does not claim anything failed', !/נכשל|שגיאה/.test(waitMsg));

/* -------------------------------------------------------------------------- */
group('a throttle is not a breakage');

// "Application request limit reached" came back on a publish and was retried
// three times, then counted against Instagram's health. Graph throttles by app,
// by user and by page, and every one clears on its own within the hour — so a
// busy afternoon ended with the destination marked down and a backlog held
// behind it at the exact moment nothing was wrong.
//
// TikTok has had this distinction since its daily cap; the code never made it
// across.
ok('the code that actually turned up is a limit', isPlatformLimitInstagram(new InstagramError('x', { code: 4, subcode: 2207051 })));
ok('so is a user throttle', isPlatformLimitInstagram(new InstagramError('x', { code: 17 })));
ok('and a page throttle', isPlatformLimitInstagram(new InstagramError('x', { code: 32 })));
// A dead token and a rejected image are NOT throttles: one needs you, the other
// needs a different card, and holding either as "not now" would wait forever.
ok('a dead token is not', !isPlatformLimitInstagram(new InstagramError('x', { code: 190 })));
ok('nor an unfetchable image', !isPlatformLimitInstagram(new InstagramError('x', { code: 9004 })));
ok('nor a non-Graph failure', !isPlatformLimitInstagram(new Error('network')));

/* -------------------------------------------------------------------------- */
group('a publish that reports failure on a post that is live');

// The throttle handling above was right and incomplete. Graph returns
// "Application request limit reached" from media_publish on posts it has
// already published, and treating that as a wait produced the worst message the
// bot can send: the post was on Instagram, the bot said it was not, the card
// went back on the queue as merely delayed, and the retry would have published
// a second copy.
//
// The container knows. status_code goes to PUBLISHED once media_publish has
// taken it, so the post is asked rather than the failing call believed.
{
  const realFetch = globalThis.fetch;
  const savedEnv = { ...IG };
  for (const [k, v] of Object.entries(IG)) {
    savedEnv[k] = process.env[k];
    process.env[k] = v;
  }

  const igCand = { card: { url: 'https://cdn.example/card.jpg' }, instagramCaption: 'שלום' };
  const throttle = {
    ok: false,
    status: 400,
    json: async () => ({
      error: { message: 'Application request limit reached', code: 4, error_subcode: 2207051 },
    }),
  };

  // Graph, in the shape the two publish paths actually call it. The container
  // poll and the verification both ask for status_code and are told apart the
  // way the real URLs differ: the poll asks for `status_code,status`.
  let posted = [];
  const graphStub = ({ publishFails = true, verify = 'PUBLISHED', containerStatus = 'FINISHED', throttleVerify = 0 } = {}) => {
    let refused = 0;
    return async (url, opts = {}) => {
      const u = String(url);
      if (u.includes('/media_publish')) {
        posted.push(u);
        return publishFails ? throttle : { ok: true, json: async () => ({ id: 'media-1' }) };
      }
      if (u.includes('status_code%2Cstatus')) return { ok: true, json: async () => ({ status_code: containerStatus }) };
      if (u.includes('fields=status_code')) {
        if (refused++ < throttleVerify) return throttle;
        return { ok: true, json: async () => ({ status_code: verify }) };
      }
      posted.push(u);
      return { ok: true, json: async () => ({ id: 'container-1' }) };
    };
  };

  globalThis.fetch = graphStub({ publishFails: true, verify: 'PUBLISHED' });
  const rescued = await publishInstagram({ ...igCand }).catch((e) => e);
  ok('a throttle on a container that did publish is not a failure', !(rescued instanceof Error));
  eq('the container it published is reported', rescued?.creationId, 'container-1');
  ok('and it says so, rather than reporting a clean publish', /Graph/.test(rescued?.notes?.[0] || ''));
  ok('the note carries what Graph actually said', /Application request limit/.test(rescued?.notes?.[0] || ''));

  // The other half, and the one that must not change: a throttle that really
  // did refuse the publish still throws, is still a platform limit, and still
  // sends the card back to wait.
  globalThis.fetch = graphStub({ publishFails: true, verify: 'FINISHED' });
  const refusedErr = await publishInstagram({ ...igCand }).catch((e) => e);
  ok('a throttle on a container that did NOT publish still fails', refusedErr instanceof InstagramError);
  ok('and is still read as a wait rather than a breakage', isPlatformLimitInstagram(refusedErr));
  eq('the container travels with it, for the retry to ask about', refusedErr?.creationId, 'container-1');

  // The verification runs into the same throttle that caused the problem. One
  // more ask, a few seconds later, is the whole difference.
  globalThis.fetch = graphStub({ publishFails: true, verify: 'PUBLISHED', throttleVerify: 1 });
  const retried = await publishInstagram({ ...igCand }).catch((e) => e);
  ok('a throttled verification is asked again rather than believed', !(retried instanceof Error));

  // The resume check. This is what stops the second copy.
  posted = [];
  globalThis.fetch = graphStub({ publishFails: false, verify: 'PUBLISHED' });
  const already = await publishInstagram({ ...igCand, instagramCreationId: 'container-1' });
  ok('a retry of a card that already published posts nothing', !posted.length);
  ok('and reports it as published rather than as a new post', /כבר/.test(already?.notes?.[0] || ''));

  posted = [];
  globalThis.fetch = graphStub({ publishFails: false, verify: 'EXPIRED' });
  const fresh = await publishInstagram({ ...igCand, instagramCreationId: 'container-old' });
  eq('a retry whose old container never published goes out normally', fresh?.mediaId, 'media-1');
  ok('which means it created and published one', posted.length === 2);

  // A container that is already a post is not a container still working. Left
  // out of waitForContainer it polls for a minute and then reports a timeout on
  // a post that is live.
  globalThis.fetch = graphStub({ publishFails: false, containerStatus: 'PUBLISHED' });
  const live = await publishInstagram({ ...igCand }).catch((e) => e);
  ok('an already-published container is not waited on', !(live instanceof Error));

  // A CLIP takes the reel path, and the fields are the whole of what separates a
  // reel from a post that fails a minute later saying nothing useful. A clip
  // candidate carries `card.file` pointing at the same mp4, that is how it
  // reached Telegram's video sender, so the image path is reachable from here
  // and `media_type=REELS` is the only thing keeping it out.
  {
    let params = null;
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes('/media_publish')) return { ok: true, json: async () => ({ id: 'media-reel' }) };
      if (u.includes('status_code')) return { ok: true, json: async () => ({ status_code: 'FINISHED' }) };
      params = new URLSearchParams(opts.body);
      return { ok: true, json: async () => ({ id: 'container-reel' }) };
    };

    const clip = {
      kind: 'clip',
      clip: { file: '/var/www/tiyul/cards/clip-abc.mp4' },
      card: { file: '/var/www/tiyul/cards/clip-abc.mp4' },
      instagramCaption: 'מה אתם עושים ראשון?',
    };
    const reel = await publishInstagram(clip);
    eq('a clip publishes as a reel', params?.get('media_type'), 'REELS');
    eq('by video_url, not image_url', params?.get('video_url'), 'https://x/c/clip-abc.mp4');
    ok('and never as an image', !params?.has('image_url'));
    eq('the caption travels with it', params?.get('caption'), 'מה אתם עושים ראשון?');
    // Stated rather than left to Instagram's default: it is the difference
    // between a reel in the profile grid and one that only exists in the Reels
    // tab, and the grid is where a profile visitor decides whether to follow.
    eq('it is shared to the feed, so it lands in the grid', params?.get('share_to_feed'), 'true');
    eq('and it reports the published media', reel?.mediaId, 'media-reel');
    ok('flagged as a reel, so the notification can say so', reel?.reel === true);

    // A clip with no host configured must refuse here rather than hand Instagram
    // a URL it cannot fetch, the same rule the card path has always had.
    const noHost = await withEnv({ CARD_PUBLIC_BASE_URL: undefined, CARD_PUBLIC_BASE_URLS: undefined }, () =>
      publishInstagram(clip).catch((e) => e)
    );
    ok('a clip with no public URL is refused, not attempted', noHost instanceof Error);
  }

  globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

// And the message. publishRetrying and publishHeld both name what DID publish;
// this one did not, so a deck that reached Instagram and was waiting on TikTok's
// cap was announced as though nothing had gone out.
{
  const both = platformLimited('המקדשים של קיוטו', [{ target: 'tiktok', message: 'מכסה יומית' }], null, ['instagram']);
  ok('a partial publish held on a limit says what published', both.includes('אינסטגרם'));
  ok('and still says what it is waiting on', both.includes('טיקטוק'));
  const neither = platformLimited('המקדשים של קיוטו', [{ target: 'tiktok', message: 'מכסה יומית' }]);
  ok('with nothing published it claims nothing', !neither.includes('📤'));
}

/* -------------------------------------------------------------------------- */
group('a deck must be where it says it is');

// A deck went out headed "United States" carrying six Swiss peaks, with Swiss
// flags and a Hebrew title naming שווייץ. Everything a reader saw was right and
// everything the bot RECORDED was wrong — and `place` is what the geographic
// quota measures and the repeat detector counts runs on, so the guard that
// exists to stop one country dominating was filing Switzerland under America.
//
// The two halves come from different places on purpose: the cover's country
// from each slide's own P17 claim, `where` from the string the map was searched
// with. Nothing compared them.
const swissSlides = [{ iso: 'CH', countryHe: 'שווייץ' }, { iso: 'CH', countryHe: 'שווייץ' }];
ok('Swiss slides in a US search is a mismatch', countryMismatch(swissSlides, 'US'));
eq('Swiss slides in a Swiss search is fine', countryMismatch(swissSlides, 'CH'), null);
// Compared on ISO rather than name: the two sides name countries differently
// and a string compare would fire on "USA" vs "United States".
eq('case does not matter', countryMismatch(swissSlides, 'ch'), null);

// Unknown is not mismatch. Refusing a deck because a geocoder timed out would
// trade a rare wrong label for a common missing post.
eq('no region resolved means nothing to check', countryMismatch(swissSlides, null), null);
eq('slides with no country claim likewise', countryMismatch([{}, {}], 'US'), null);
eq('and a deck spanning countries is not a mismatch', countryMismatch([{ iso: 'CH' }, { iso: 'IT' }], 'US'), null);

/* -------------------------------------------------------------------------- */
group('TikTok scopes - the half-connection that looked connected');

// A deck failed at init with scope_not_authorized against a token that plainly
// carried video.publish. TikTok splits posting by MODE, not by media: a direct
// post needs video.publish, an upload-to-inbox needs video.upload. Decks go out
// as drafts, and only video.publish had ever been requested — so the connection
// held a scope for the mode the bot no longer uses and not the one it does.
eq('a draft needs the upload scope', scopeForMode(true), 'video.upload');
eq('a direct post needs the publish scope', scopeForMode(false), 'video.publish');
ok('and both are requested at connect time', TK_SCOPES.includes('video.upload') && TK_SCOPES.includes('video.publish'));

// The exact token that was live when this failed.
store.setTikTokToken({
  accessToken: 't',
  refreshToken: 'r',
  expiresAt: Date.now() + 86_400_000,
  refreshExpiresAt: Date.now() + 30_000_000_000,
  openId: 'o',
  scope: 'user.info.basic,video.publish',
});
eq('that token cannot send a draft', missingScopes({ draft: true }).join(','), 'video.upload');
eq('though it could have posted directly', missingScopes({ draft: false }).length, 0);

store.setTikTokToken({
  accessToken: 't',
  refreshToken: 'r',
  expiresAt: Date.now() + 86_400_000,
  refreshExpiresAt: Date.now() + 30_000_000_000,
  openId: 'o',
  scope: 'user.info.basic,video.publish,video.upload',
});
eq('reconnecting with both clears it', missingScopes({ draft: true }).length, 0);

// No token is "not connected", which is a different message reported elsewhere.
store.clearTikTokToken();
eq('an absent token reports no missing scopes', missingScopes({ draft: true }).length, 0);

// And it is no longer retried. A missing scope refuses every post identically
// and will refuse the next hundred; "ניסיון 1/3" promised something that could
// not happen, three calls at a time.
ok('a scope failure is a config problem', isConfigProblem(new TikTokError('x', { code: 'scope_not_authorized' })));
ok('so is a dead token', isConfigProblem(new TikTokError('x', { code: 'access_token_invalid' })));
ok('a rate limit is not', !isConfigProblem(new TikTokError('x', { code: 'rate_limit_exceeded' })));
ok('nor is an unverified image host', !isConfigProblem(new TikTokError('x', { code: 'url_ownership_unverified' })));

/* -------------------------------------------------------------------------- */
group('the same deck, drawn as cards for Instagram');

// One deck, two designs. The words and the photographs are identical — what
// differs is that the Instagram set is built in the CARD's design language, so
// a slideshow lands in the grid looking like the account that posted it rather
// than like a TikTok slide with less headroom.
const igSlide = renderInstagramSlideHtml(
  { nameHe: 'אגם סורפיס', countryHe: 'איטליה', flag: '🇮🇹', fields: [{ emoji: '📏', labelHe: 'מרחק', value: '12.5 קמ' }] },
  { index: 3, total: 5, style: 'info', kicker: 'טופ 4 מסלולים בדולומיטים' }
);

ok('it carries the brand, which a TikTok slide never does', igSlide.includes('class="brand"'));
ok('and the site, the same as a card', igSlide.includes('class="site"'));
ok('it is numbered, because a carousel shows no progress of its own', igSlide.includes('3 / 5'));
ok('it names the deck it belongs to', igSlide.includes('טופ 4 מסלולים בדולומיטים'));
ok('the place name is there', igSlide.includes('אגם סורפיס'));
ok('and the info fields', igSlide.includes('מרחק'));
// Built at card dimensions, from the card stylesheet — not approximated.
ok('it is the card size', igSlide.includes('1080px') && igSlide.includes('1350px'));
ok('it uses the card accent rule under the header', igSlide.includes('border-bottom: 2px solid var(--accent)'));

// The minimal style has a note and no field list; the info style the reverse.
// Same split the TikTok slide makes, so the two stay one deck.
const igMinimal = renderInstagramSlideHtml(
  { nameHe: 'מאטרהורן', fields: [{ emoji: '🗻', labelHe: 'גובה', value: '4,478 מ' }] },
  { index: 2, total: 6, style: 'minimal' }
);
ok('the minimal style shows the fact as a note', igMinimal.includes('(4,478 מ)'));
ok('and does not list fields', !igMinimal.includes('גובה:'));

// The cover is the title alone, with the model's chosen phrase in the accent.
const igCover = renderInstagramSlideHtml(
  { titleHe: 'טופ 5 פסגות שאסור לפספס באלפים', emphasisHe: 'שאסור לפספס' },
  { cover: true, index: 1, total: 6 }
);
ok('the cover carries the title', igCover.includes('טופ 5 פסגות'));
ok('and lifts the emphasis into the accent colour', igCover.includes('class="emph"'));
ok('a cover is not numbered against a deck title it opens', !igCover.includes('class="kick"'));

// No photograph is not an error — a deck built with no image provider renders
// every slide this way, and an empty frame would be worse than a flat field.
ok('a slide with no photograph still renders', renderInstagramSlideHtml({ nameHe: 'x' }, {}).includes('bg-empty'));

/* -------------------------------------------------------------------------- */
group('Hebrew first - technical detail below the line, never inside it');

// Every failure read `❌ משהו נכשל: ${e.message}`, and e.message is whatever the
// API or the runtime said: always English. A Hebrew clause and an English
// clause on one line is hard to read in either, and genuinely hard to SKIM —
// RTL and LTR reorder each other at the boundary, so the punctuation ends up
// somewhere neither language put it.
const det = withDetail('❌ בניית המצגת נכשלה', new Error('only 2 slide(s) survived sourcing'));
eq('the first line is Hebrew and complete on its own', det.split('\n')[0], '❌ בניית המצגת נכשלה');
ok('the technical text survives, on its own line', det.split('\n')[1].includes('only 2 slide(s)'));
ok('and is marked as technical rather than narrated', det.includes('🔧'));

// A message with nothing to add should not grow an empty footnote.
eq('no detail means no second line', withDetail('❌ נכשל', null), '❌ נכשל');
eq('an empty error is the same as none', withDetail('❌ נכשל', new Error('')), '❌ נכשל');

// A stack in a notification is the message being replaced by its own footnote.
const long = withDetail('❌ נכשל', 'x'.repeat(900));
ok('a long detail is trimmed', long.length < 300);
ok('and says it was trimmed', long.includes('…'));

// Plain strings work too — not every failure arrives as an Error.
ok('a bare string is accepted', withDetail('❌ נכשל', 'ECONNRESET').includes('ECONNRESET'));

const deckFixture = {
  kind: 'deck',
  id: 'abc123',
  publishTargets: ['instagram', 'tiktok'],
  tiktok: { privacy: 'SELF_ONLY', username: 'tiyulplus', options: ['SELF_ONLY'] },
  deck: {
    titleHe: 'המוזיאונים של פראג',
    where: 'Prague',
    category: 'museum',
    idea: { angleHe: 'מה פתוח ביום שני ומה שווה את הכרטיס' },
    counts: { found: 75, withWikidata: 75, withAuthority: 52, asked: 5, built: 3 },
    short: true,
    dropped: [{ place: 'Kafka Museum', why: 'fetch failed: HTTP 403' }],
    slides: [
      {
        n: 1,
        nameHe: 'המוזיאון הלאומי',
        nameEn: 'National Museum',
        sourceHost: 'tiyulplus.com',
        sourceUrl: 'https://www.nm.cz/en/visit',
        fields: [
          { key: 'distance', labelHe: 'מרחק', emoji: '📏', value: '5.3 ק\"מ', quote: 'Admission 250 CZK' },
        ],
      },
      {
        n: 2,
        nameHe: 'הגלריה הלאומית',
        nameEn: 'National Gallery',
        sourceHost: 'tiyulplus.com',
        sourceUrl: 'https://www.ngprague.cz/en/visit',
        fields: [],
      },
    ],
  },
};

const deckMsg = approvalMessage(deckFixture);
ok('a deck gets the deck approval message', deckMsg.includes('מצגת'));
ok('which lists every slide', deckMsg.includes('המוזיאון הלאומי') && deckMsg.includes('הגלריה הלאומית'));
ok('and the domain each fact was quoted from', deckMsg.includes('nm.cz') && deckMsg.includes('ngprague.cz'));
// A deck that came up short and a deck that meant to be short look identical
// afterwards, so the shortfall is stated at the moment it can still be rejected.
ok('says when it came up short of what was asked', deckMsg.includes('ביקשנו 5'));
ok('reports how thin the region was', deckMsg.includes('75') && deckMsg.includes('52'));
ok('names what was dropped and why', deckMsg.includes('Kafka Museum') && deckMsg.includes('403'));
ok('carries the TikTok privacy level, same as a card', deckMsg.includes(privacyHe('SELF_ONLY')));
ok('every source URL is in the message', deckMsg.includes('https://www.nm.cz/en/visit'));

const deckEv = evidenceReport(deckFixture);
ok('evidence is grouped per slide, not flattened', deckEv.includes('המוזיאון הלאומי') && deckEv.includes('Admission 250 CZK'));
ok('with the page each quote came from', deckEv.includes('nm.cz'));

// A fixed hook, so the assertions below are about the shape of the caption
// rather than about which of twenty lines came up. The randomness itself is
// tested in its own group further down.
const HOOK = postConfig().caption.lines[0];
const dcap = deckCaption(deckFixture.deck, { hook: HOOK });
// The title and the shoutout, nothing else. This used to carry the angle and
// then every place, numbered — the deck retyped underneath the deck. Anyone
// who wants the list swipes; what the description is for is saying what this
// is and where to go next, and a wall of names pushes the only line that asks
// for anything below the fold.
// Two descriptions, because one platform has a title field and the other does
// not. Repeating the title in TikTok's description spends the first line of the
// only place a link can be asked for on a line already read two centimetres up.
const dtik = deckTiktokCaption(deckFixture.deck, { hook: HOOK });
eq('TikTok opens on the line, not on a call to action', dtik.split('\n')[0], HOOK);
ok('and never the title', !dtik.includes('פראג'));
ok('the Instagram caption is the title', dcap.startsWith('המוזיאונים של פראג'));
ok('and does not list the places', !dcap.includes('1. המוזיאון'));
ok('and drops the angle', !dcap.includes('מה פתוח'));

// NOTHING published carries a URL, and this used to be enforced per deck
// because a card's signature still printed one. The signature is gone, so the
// rule is now global and this is one of several places it holds.
ok('a deck caption carries no domain', !dcap.includes('tiyulplus.com'));
ok('nor does the TikTok description', !dtik.includes('tiyulplus.com'));

// A DECK NOW CLOSES LIKE A CLIP: a question, and on some posts one ask.
//
// It used to carry an opening line and five tags, with nothing to answer and
// nothing to do next, which on a slideshow is the whole caption spent on mood.
// "No ask at all" was asserted here, and it was the wrong rule, the argument
// that removed the old CTA was about the DOMAIN, and it took the ask with it.
{
  const closed = deckCaption(deckFixture.deck, { hook: HOOK, rand: () => 0 });
  const q = postConfig().caption.questions[0];
  const ask = postConfig().caption.ctas[0];
  ok('a deck caption asks something', closed.includes(q));
  ok('and names a next thing to do', closed.includes(ask));
  // The tags stay last whatever is added above them: a tag block is where a
  // reader stops reading, and anything under it is unread.
  ok('the tags are still last', /#\S+$/.test(closed.trim()));
  ok('the ask sits above the tags', closed.indexOf(ask) < closed.indexOf('#'));

  // Both halves of ONE deck close the same way. Drawn twice they would not, and
  // the approval card prints one description.
  const tik = deckTiktokCaption(deckFixture.deck, { hook: HOOK, question: q, cta: ask });
  const ig = deckCaption(deckFixture.deck, { hook: HOOK, question: q, cta: ask });
  ok('the TikTok half carries the same question', tik.includes(q));
  ok('and the same ask', tik.includes(ask));
  ok('the Instagram half too', ig.includes(q) && ig.includes(ask));

  // null means "the caller drew and got nothing", which is the normal case by
  // ctaShare and must not be re-rolled into a yes by the builder.
  const noAsk = deckTiktokCaption(deckFixture.deck, { hook: HOOK, question: q, cta: null });
  ok('a null ask stays null', !postConfig().caption.ctas.some((c) => noAsk.includes(c)));
}
ok('nor names the brand', !dcap.includes('טיול+') && !dtik.includes('טיול+'));

// The "always" in "always ends with the hashtags", which the old version could
// not keep for the thing it was reserving space for. It built the whole string
// and sliced it to 2200, so on a long deck the last block was what fell off the
// end — and the last block is now what the post is filed under.
const longCap = deckCaption(
  { titleHe: 'א'.repeat(2500), slides: [{ nameHe: 'מקדש א' }] },
  { hook: HOOK }
);
ok('a caption over the limit is still within it', longCap.length <= 2200);
ok('and the tags survive being over the limit', longCap.trimEnd().endsWith(longCap.trim().split('\n').pop()));
eq('which is five of them', longCap.trim().split('\n').pop().split(' ').length, 5);

// A slide is a numbered NAME, and fields only where the category has them.
// Never a sentence: prose on a slide is what made these read like a guidebook,
// and it survived every typographic fix because it was never typographic.
const slideHtml = renderSlideHtml(deckFixture.deck.slides[0], { size: 'tiktok', style: 'info' });
ok('the name stands alone, unnumbered', slideHtml.includes('המוזיאון הלאומי') && !slideHtml.includes('1. המוזיאון'));
ok('a field renders as icon, label, value', slideHtml.includes('מרחק: 5.3'));
ok('no score on a slide - it belongs in the cover line', !slideHtml.includes('class="score"'));

const bare = renderSlideHtml({ n: 3, nameHe: 'גשר קרל', fields: [] }, { style: 'minimal' });
ok('a name-only slide is just the name', bare.includes('גשר קרל'));
ok('and carries nothing else at all', !bare.includes('class="field"'));

// The minimal style is the one modelled on the reference that carries no facts
// at all, so it must not start printing them when a slide happens to have some.
ok(
  'the minimal style shows no fields even when the slide has them',
  !renderSlideHtml(deckFixture.deck.slides[0], { style: 'minimal' }).includes('class="field"')
);

// The flag belongs to the name, not to a line of its own.
//
// The reference puts it underneath and that was copied faithfully; in Hebrew at
// this size it read as a detached ornament floating below the label. Inline it
// wraps with the text and stays part of the thing it is labelling.
const flagged = renderSlideHtml(
  { nameHe: 'החוף האדום', flag: '🇬🇷', fields: [] },
  { style: 'minimal' }
);
ok('the flag sits inside the name', /class="name[^"]*">[^<]*החוף האדום[^<]*<img/.test(flagged));
ok('and there is no separate flag line', !flagged.includes('class="flag"'));

// Leading, which is the thing that has now been wrong three times and in both
// directions. Hebrew has almost no descenders and takes less than a Latin face,
// so at 1.2 a wrapped place name set at 51px read as two separate thoughts —
// and at 0.98 the same name set at 32px collides with itself, because the gap
// the eye reads is absolute and the type is a third smaller. Sub-1 leading is
// now the bug rather than the fix.
ok('a wrapped name is not set sub-1', !flagged.includes('line-height: 0.98'));
ok('it has room to wrap', /\.name \{[^}]*line-height: 1\.1/s.test(flagged));

// The country is named only when the deck spans countries; in a one-city deck
// every slide would repeat the same word.
ok(
  'a cross-country deck names the country and flies the flag',
  renderSlideHtml(
    { n: 1, nameHe: 'דולומיטים', countryHe: 'איטליה', flag: '🇮🇹', fields: [] },
    { style: 'minimal' }
  ).includes('דולומיטים, איטליה')
);

// The cover is one line with one word louder. Hebrew has no capitals, so the
// emphasis is colour; a word the model did not take from the title is dropped
// rather than appended.
const coverHtml = renderSlideHtml(
  { titleHe: '5 מקומות בפראג שאסור לפספס', emphasisHe: 'בפראג' },
  { cover: true, style: 'minimal' }
);
ok('the emphasis is set apart', coverHtml.includes('class="emph tight">בפראג</span>'));
ok('and the rest of the line survives intact', coverHtml.includes('5 מקומות') && coverHtml.includes('שאסור לפספס'));
ok(
  'an emphasis that is not in the title is ignored, not appended',
  !renderSlideHtml({ titleHe: '5 מקומות בפראג', emphasisHe: 'וויומינג' }, { cover: true, style: 'minimal' }).includes(
    'וויומינג'
  )
);
ok('no eyebrow and no second line on a cover', !coverHtml.includes('class="eyebrow"') && !coverHtml.includes('class="cover-angle"'));
// A two-word emphasis broken across a line break is two coloured fragments
// rather than one shouted phrase, which is the whole point of colouring it.
ok('a short emphasis is held on one line', coverHtml.includes('.emph.tight { white-space: nowrap; }'));

// A name is not a claim, so a name-only deck has nothing to quote - and the
// evidence report says exactly that rather than showing an empty list.
ok(
  'a name-only deck reports that there is nothing to quote',
  evidenceReport({ kind: 'deck', deck: { slides: [{ n: 1, nameHe: 'x', fields: [] }] } }).includes('אין טענות לצטט')
);
ok('a field-bearing deck still shows its quotes', evidenceReport(deckFixture).includes('Admission 250 CZK'));

// A cover set at full size wraps to four lines and eats the photograph.
eq('a short title stays large', sizeClass('חמישה מוזיאונים', { mid: 24, long: 36 }), '');
eq('a medium one steps down', sizeClass('המוזיאונים של פראג ששווים בהחלט', { mid: 24, long: 36 }), ' mid');
eq(
  'a long one steps down twice',
  sizeClass('המוזיאונים של פראג ששווים את הכרטיס ועוד כמה דברים', { mid: 24, long: 36 }),
  ' long'
);
ok('a long name steps down rather than overflowing', renderSlideHtml(
  { n: 1, nameHe: 'x'.repeat(40), fields: [] },
  { style: 'minimal' }
).includes('name long'));

// sizeClass emits BOTH a mid and a long step for everything it is given, and
// for a while only .long had a rule — so every name between twenty and thirty
// characters carried a class that styled nothing and set at full size, which is
// precisely the length at which a Hebrew place name begins to wrap. A class
// with no rule behind it fails silently, so each one is checked against the
// stylesheet it is supposed to match.
for (const [what, cls, html] of [
  ['a name', 'name', renderSlideHtml({ nameHe: 'x'.repeat(25), fields: [] }, { style: 'minimal' })],
  ['an info name', 'title-info', renderSlideHtml({ nameHe: 'x'.repeat(22), fields: [] }, { style: 'info' })],
  ['a cover', 'cover', renderSlideHtml({ titleHe: 'x'.repeat(25) }, { cover: true, style: 'minimal' })],
]) {
  ok(`${what} of middling length takes the middle step`, html.includes(`${cls} mid`));
  ok(`and the stylesheet actually has a rule for it`, html.includes(`.${cls}.mid {`));
}

// A fourth step, for the covers that got longer when they started naming the
// country. Same failure mode as the mid step had: a class the stylesheet has no
// rule for sets at full size and fails silently.
const xlongCover = renderSlideHtml({ titleHe: 'x'.repeat(50) }, { cover: true, style: 'minimal' });
ok('a very long cover takes the smallest step', xlongCover.includes('cover xlong'));
ok('and the stylesheet has a rule for that too', xlongCover.includes('.cover.xlong {'));
// Opt-in, because a place name has three steps and must never be handed a class
// that does not exist in the stylesheet.
eq('nothing else reaches for it', sizeClass('x'.repeat(80), { mid: 20, long: 30 }), ' long');

// The complaint that prompted the scale: a cover set as a poster rather than as
// a caption. Every step is measured against the frame so the two styles cannot
// drift apart silently.
const coverPx = (style, cls) =>
  Number(
    renderSlideHtml({ titleHe: 'x' }, { cover: true, style })
      .match(new RegExp(`\\.cover${cls ? `\\.${cls}` : ''} \\{[^}]*font-size: (\\d+)px`))?.[1]
  );
ok('a minimal cover is under 4% of the frame', coverPx('minimal', '') / 1920 < 0.04, coverPx('minimal', ''));
ok('an info cover is too', coverPx('info', '') / 1920 < 0.045, coverPx('info', ''));
ok('and every step is smaller than the one above it',
  coverPx('minimal', '') > coverPx('minimal', 'mid') &&
    coverPx('minimal', 'mid') > coverPx('minimal', 'long') &&
    coverPx('minimal', 'long') > coverPx('minimal', 'xlong'));
// A URL burned into a photograph is the clearest sign a post was made by a
// company. The sourcing did not weaken: every slide's URL is in the approval
// message, which is where the decision is actually made.
ok('no URL is burned into a fact slide', !slideHtml.includes('nm.cz'));
ok('but the approval message still carries every one', deckMsg.includes('https://www.nm.cz/en/visit'));
// TikTok draws its own slide counter and genuine posts carry no second one, so
// ours was the tell that this had been made elsewhere and uploaded.
ok('no counter of our own', !slideHtml.includes('class="counter"'));
// Nor our own domain on a fact slide. The source stays; branding on every
// slide is what an advertisement looks like.
ok('the brand is not on every slide', !slideHtml.includes('tiyulplus'));
// Not one reference post carries a domain, cover included.
ok('nor on the cover', !renderSlideHtml({ titleHe: 'x' }, { cover: true, style: 'minimal' }).includes('tiyulplus'));

// Placement is measured, not named. render/photo.js returns the centre of the
// empty region as a fraction of the frame, and the renderer applies it
// literally — a fixed centre is what put a title across the middle of a garden,
// and three named bands were not much better.
const placed = renderSlideHtml(
  { nameHe: 'x', fields: [] },
  { style: 'minimal', spot: { x: 0.34, y: 0.28, width: 0.52, color: '#FFFFFF', onDark: true, assist: 0, shadow: 0 } }
);
ok('the block is positioned from the measurement', placed.includes('top:538px') && placed.includes('width:562px'));
ok('a slide with no measurement still lands somewhere sane', bare.includes('class="block"'));

// Text ran off the left edge of the first renders because a 0.56-wide box
// centred at 0.3 reaches x=0.02. The margin is guaranteed here rather than
// trusted from the scoring.
const hugging = renderSlideHtml(
  { nameHe: 'x', fields: [] },
  { style: 'minimal', spot: { x: 0.05, y: 0.5, width: 0.9, color: '#FFFFFF', onDark: true, assist: 0, shadow: 0 } }
);
ok('and never touches the edge of the frame', hugging.includes('left:65px'));

// No outline in the minimal style. A stroke around every letter is not
// something TikTok's own text tool can produce, so the eye reads it as foreign
// no matter how good the rest of the slide is — it was the single loudest part
// of "the font looks like it was added in Photoshop".
ok('the minimal style carries no outline at all', placed.includes('-webkit-text-stroke: 0'));
ok('the info style is cream over bronze, which is its whole signature', slideHtml.includes('-webkit-text-stroke: var(--stroke) #7A4A12'));

// One Hebrew face, two weights. TikTok Sans has no Hebrew at all — it carries
// only the digits and punctuation — so the family after it is the one that
// actually draws the words.
ok('Latin and digits are always set in TikTok Sans', slideHtml.includes("font-family: 'TikTok Sans'"));
ok('the info style sets Hebrew in the display face', slideHtml.includes("font-family: 'TikTok Sans', 'Arimo'"));
ok('and so does the minimal style', placed.includes("font-family: 'TikTok Sans', 'Arimo'"));
// Heebo stays last, so a face that fails to parse degrades to legible-but-wrong
// rather than to a slide full of tofu boxes.
ok('both fall back rather than to nothing', placed.includes("'Heebo', sans-serif") && slideHtml.includes("'Heebo', sans-serif"));
ok('the faces are bundled into the page, not linked', placed.includes('data:font/ttf;base64,'));

// ONE weight across both styles, and it is a constraint rather than a taste.
//
// The shipped Arimo.ttf is a single static 600 instance, not a variable font.
// Asking for 800 from it does not get a heavier cut — the browser synthesises
// one by smearing the outlines, and faux-bold Hebrew over a photograph is
// exactly the "added in Photoshop" look the rest of this file works to avoid.
//
// The weights used to be what separated the two styles. They no longer need to
// be: an info slide already announces itself with a list of fields and a cream
// ink over a bronze outline, which is a louder difference than 200 units of
// weight ever was.
eq('the deck face is Arimo', FACES.minimal.family, 'Arimo');
eq('and both styles use it', FACES.info.family, FACES.minimal.family);
eq('at one weight', FACES.minimal.name, 600);
eq('the same one', FACES.info.name, FACES.minimal.name);
// Guard against a heavier weight being asked of a single-weight file again.
ok(
  'no style asks for a weight the file does not have',
  [FACES.minimal, FACES.info].every((f) => Object.values(f).filter((v) => typeof v === 'number').every((w) => w === 600))
);
// ...and the weight that reaches the stylesheet is no longer either of them.
//
// FACES is now the shape of the table and the fallback for a font-lab run that
// supplies its own weights; the weight an actual slide is set in comes from
// post-config.json, because 600 is a semibold and a semibold place name over a
// photograph is the loudest thing on the slide.
// ...and it arrives as the FALLBACK of a variable, not as a fixed value.
//
// That indirection is the fix for the regression this shipped with. The
// stylesheet declares `font-weight: var(--w, <configured>)`, and each slide
// sets --w from the shortfall render/photo.js measured for its own photograph:
// equal to the configured weight on a clean frame, heavier on one that cannot
// carry it. Asserting the literal would pass just as well against a stylesheet
// that had gone back to a constant, which is exactly what must not happen.
const cfgWeight = postConfig().overlay.weight;
ok('the configured weight is the stylesheet default', placed.includes(`font-weight: var(--w, ${cfgWeight});`));
ok('and it reaches the info style too', slideHtml.includes(`font-weight: var(--w, ${cfgWeight});`));
ok('the table weight no longer does', !placed.includes(`font-weight: ${FACES.minimal.name};`));
ok('opacity is a variable too', placed.includes('opacity: var(--op,'));

// The adaptation itself, which is the part with teeth. A slide measured as
// comfortable must come out at exactly the configured numbers — the whole
// point of the light look is that it is what you normally see — and a slide
// measured as hopeless must come out heavier and fully opaque.
{
  const base = { x: 0.3, y: 0.3, width: 0.44, color: '#FFFFFF', onDark: true, assist: 0, accent: null };
  const clean = renderSlideHtml({ nameHe: 'קפה סנטרל', fields: [] }, { spot: { ...base, shadow: 0 } });
  const hard = renderSlideHtml({ nameHe: 'קפה סנטרל', fields: [] }, { spot: { ...base, shadow: 1 } });
  const ad = postConfig().overlay.adapt;

  ok('a clean frame gets exactly the configured weight', clean.includes(`--w:${cfgWeight}`));
  ok('and exactly the configured opacity', clean.includes(`--op:${postConfig().overlay.opacity.toFixed(3)}`));
  ok('a hopeless frame gets the boosted weight', hard.includes(`--w:${cfgWeight + ad.weightBoost}`));
  ok('and goes fully opaque', hard.includes(`--op:${ad.opacityCeiling.toFixed(3)}`));
  ok('the extra shadow layer is absent on a clean frame', !/text-shadow:[^;"]*,[^;"]*rgba\(0,0,0,0\.\d\d\)/.test(clean));
  ok('and present on a hard one', hard.includes('rgba(0,0,0,0.55)'));
}

// The wash behind the text is the last resort and has to stay rare, or every
// slide grows a panel and the look is gone.
ok('no wash when the photograph offers enough contrast', !placed.includes('class="assist"'));
ok(
  'a wash appears when it does not',
  renderSlideHtml(
    { nameHe: 'x', fields: [] },
    { style: 'minimal', spot: { x: 0.5, y: 0.5, width: 0.7, color: '#FFFFFF', onDark: true, assist: 0.8, shadow: 1 } }
  ).includes('class="assist"')
);

// The info style's ink never changes, so the placement search has to score
// contrast against cream rather than against whichever of white and black it
// might otherwise pick. Getting this wrong put a cream line on a sunlit
// snowfield with clear blue sky directly above it.
ok('the info style declares a fixed ink luminance', INK_LUMINANCE.info > 0.7);
eq('the minimal style leaves it to the measurement', INK_LUMINANCE.minimal, null);
eq('TikTok slides are 9:16', `${SIZES.tiktok.w}x${SIZES.tiktok.h}`, '1080x1920');
eq('Instagram slides are 4:5, because the feed crops anything taller', `${SIZES.instagram.w}x${SIZES.instagram.h}`, '1080x1350');
ok('a slide with no photograph still renders', renderSlideHtml({ nameHe: 'x', fields: [] }, { style: 'minimal' }).includes('linear-gradient'));
ok('HTML in a place name cannot break out of the template', renderSlideHtml(
  { nameHe: '<script>alert(1)</script>', fields: [], sourceHost: 'x.cz' },
  { style: 'minimal' }
).includes('&lt;script&gt;'));
ok('nor out of a field value', renderSlideHtml(
  { nameHe: 'x', fields: [{ emoji: '🗻', labelHe: 'גובה', value: '<img src=x onerror=1>' }] },
  { style: 'info' }
).includes('&lt;img'));

// The deck id has to be stable across re-runs or the same five museums stage
// twice, and has to change when the places do.
const idA = deckId(deckFixture.deck);
eq('the same places give the same id', idA, deckId({ ...deckFixture.deck, titleHe: 'a different title' }));
ok(
  'different places give a different id',
  idA !== deckId({ ...deckFixture.deck, slides: [{ ...deckFixture.deck.slides[0], qid: 'Q999' }] })
);

// Site restriction is an allowlist check, not a convenience: the same
// label-boundary rule the source allowlist uses.
ok('a subdomain of the site matches', sameSite('https://en.nm.cz/visit', 'nm.cz'));
ok('the bare site matches', sameSite('https://www.nm.cz/visit', 'nm.cz'));
ok('a lookalike domain does not', !sameSite('https://evil-nm.cz/visit', 'nm.cz'));
ok('nor does a suffixed one', !sameSite('https://nm.cz.attacker.com/visit', 'nm.cz'));

// Authority order is meaning: the place's own site outranks whoever runs it,
// which outranks whatever contains it.
eq(
  'authority domains come back closest-to-the-horse first',
  authorityDomains({
    officialUrl: 'https://www.nm.cz/en',
    operatorUrl: 'https://www.mkcr.cz',
    withinUrl: 'https://www.praha.eu',
    osmTags: {},
  }).join(','),
  'nm.cz,mkcr.cz,praha.eu'
);
eq('a place with nothing has no authority', authorityDomains({ osmTags: {} }).length, 0);

/* -------------------------------------------------------------------------- */
group('the guide page - a deck of trails is not a deck of whatever is on the page');

// The bug this group exists for.
//
// CATEGORY_HE had no line for `trail`, and an unmapped kind fell through to the
// permissive branch of pick(), which takes the WHOLE destination page. So
// "trails in the Dolomites" shipped as a valley, two lakes, a town, a museum
// town and Piazza delle Erbe market — under a cover calling them the most
// beautiful mountains in Italy.
//
// A missing line is invisible until a deck goes out wrong, so the table is held
// against the registry instead of being read by eye.
// Sourced kinds only. CATEGORY_HE maps a deck kind onto the vocabulary our own
// destination pages use, and that mapping is how the site route picks places —
// a route a free-form kind never takes. A landscape deck names its own places
// and reads no guide page, so demanding a category for one would be demanding a
// mapping that nothing could ever use.
for (const id of Object.keys(KINDS).filter(isSourcedKind)) {
  ok(`the guide page knows what a ${id} deck wants`, Array.isArray(CATEGORY_HE[id]) && CATEGORY_HE[id].length > 0);
}

// The site's real vocabulary, sampled off the live pages. A category we invent
// matches nothing and fails exactly as silently as a missing line — 'shopping'
// said 'קניות' for months while the site said 'שופינג'.
const SITE_CATEGORIES = [
  'טבע', 'אתר היסטורי', 'תצפית', 'אטרקציה', 'אוכל', 'אוכל כשר', 'שופינג', 'שוק', 'מוזיאון', 'בית קפה', 'גלריה', 'מסעדה', 'פארק', 'גן', 'קניות',
];
for (const [id, cats] of Object.entries(CATEGORY_HE)) {
  for (const c of cats) ok(`${id} asks for a category the site actually uses: ${c}`, SITE_CATEGORIES.includes(c));
}

// The Dolomites page, as it actually parses.
const guide = [
  { nameHe: 'שוק פיאצה דלה ארבה', category: 'שוק', rating: 4.6 },
  { nameHe: 'אגם סוראפיס', category: 'טבע', rating: 4.8 },
  { nameHe: 'בולצאנו ומוזיאון אצי', category: 'אתר היסטורי', rating: 4.5 },
  { nameHe: 'סאס פורדוי', category: 'תצפית', rating: 4.7 },
];
const names = (list) => list.map((p) => p.nameHe);

ok('a trail deck no longer takes the market', !names(pick(guide, { kind: 'trail', want: 9 })).includes('שוק פיאצה דלה ארבה'));
ok('nor the museum town', !names(pick(guide, { kind: 'trail', want: 9 })).includes('בולצאנו ומוזיאון אצי'));
ok('a food deck still gets the market', names(pick(guide, { kind: 'food', want: 9 })).includes('שוק פיאצה דלה ארבה'));

// A registered kind with nothing on the page returns nothing, so buildDeck
// falls through to the map — whose Overpass tags cannot answer a summit query
// with a market. Taking the whole page instead is the bug, not the fallback.
eq('a registered kind with no match yields nothing', pick(guide, { kind: 'museum', want: 9 }).length, 0);
// And the permissive branch survives for what it was written for: a deck of
// "the best of Prague", where no category was asked for at all.
eq('an unregistered kind still takes the page', pick(guide, { kind: 'best of', want: 9 }).length, 4);
eq('and so does no kind at all', pick(guide, { want: 9 }).length, 4);

// The filter must never fail CLOSED on a formatting detail.
//
// Entries go to the model as "name — description" so it can judge the subject,
// and it is asked for the name. Told to copy "exactly as given", it reasonably
// echoed the WHOLE line — and an exact-string lookup then matched none of its
// ten correct answers, so Prague built zero slides out of ten good quarters and
// castles. An empty result from a filter is indistinguishable from "everything
// was rejected", which is why this is checked rather than eyeballed.
const pragueish = [
  { nameHe: 'מאלה סטראנה' },
  { nameHe: 'מצודת וישהראד' },
  { nameHe: 'קוטנה הורה' },
  { nameHe: 'סאס פורדוי - מרפסת הדולומיטים' },
];
eq(
  'a name echoed with its description still matches',
  keepByName(pragueish, ['מאלה סטראנה - הרובע הבארוקי שמתחת למצודה']).length,
  1
);
eq('and a bare name matches too', keepByName(pragueish, ['מצודת וישהראד']).length, 1);
// A place whose OWN name contains a dash reduces the same way on both sides,
// so it still matches itself rather than being cut in half and lost.
eq(
  'a name with a dash in it survives the reduction',
  keepByName(pragueish, ['סאס פורדוי - מרפסת הדולומיטים'])[0]?.nameHe,
  'סאס פורדוי - מרפסת הדולומיטים'
);
eq('a name nobody asked for stays out', keepByName(pragueish, ['מאלה סטראנה']).length, 1);
eq('and asking for nothing keeps nothing', keepByName(pragueish, []).length, 0);

// "/deck Italy mountains" must not fail on the plural.
eq('a plural resolves to the registry name', canonicalKind('mountains'), 'mountain');
eq('and so does a synonym', canonicalKind('hiking'), 'trail');
ok('a resolved synonym reaches a real mapping', Boolean(CATEGORY_HE[canonicalKind('waterfalls')]));

// The model will occasionally ask for eleven; that is a misunderstanding of the
// format rather than a richer list. The ceiling came down from seven to six
// when the format was measured against a comparable feed: twelve of its
// thirteen posts ran at exactly five destinations after the cover, and a list
// that goes long stops being a list you finish.
eq('slide count is clamped, not trusted', normaliseIdea({ title_he: 'x', where: 'Prague', kind: 'museum', want: 11 }).want, 6);
eq('and five is the template, so an unstated count is five', normaliseIdea({ title_he: 'x', where: 'Prague', kind: 'museum' }).want, 5);

/* -------------------------------------------------------------------------- */
group('landscape carries names, not facts');

// The channel drifted to museums and markets, and the reason was in the table
// rather than in the prompt: every kind was sourced, sourcing means quoting an
// official page, and a mountain does not have one. The idea prompt then told
// the model so, in as many words, and it obediently stopped proposing
// landscape — which is most of what a travel slideshow is.
//
// So the table now says which kinds carry quoted facts and which carry a name,
// a country and a photograph, and the routing follows the kind rather than a
// flag somebody remembered to set.
ok('a museum is sourced', isSourcedKind('museum'));
ok('so is an attraction', isSourcedKind('attraction'));
ok('and a food deck', isSourcedKind('food'));
ok('a mountain is not', !isSourcedKind('mountain'));
ok('nor a waterfall', !isSourcedKind('waterfall'));
ok('nor a beach', !isSourcedKind('beach'));
ok('an unknown kind is not sourced either', !isSourcedKind('nonsense'));

// The subjects the old table could not express at all. Each needs an English
// search subject or its photographs are of the right country and the wrong
// thing — the failure KIND_SUBJECT_EN was written for.
for (const id of ['lake', 'island', 'village', 'canyon', 'aurora']) {
  ok(`${id} is a category that can now be proposed`, Boolean(KINDS[id]));
  ok(`and it knows what its photographs must show`, Boolean(subjectEn(id)));
  ok(`and it is free-form, having no page to quote`, !isSourcedKind(id));
}
eq('the aurora searches for the aurora, not for the country', subjectEn('aurora'), 'northern lights');

// A free-form kind has no Overpass query, and reaching the sourced path with
// one is a routing bug. It should say so rather than dying on spec.q.
await (async () => {
  const { osmPlaces } = await import('../src/sources/places.js');
  const e = await osmPlaces('0,0,1,1', 'aurora').catch((x) => x);
  ok('a free-form kind refused by the sourced path names the reason', /not a sourced kind/.test(e?.message || ''));
})();

// An idea routes itself. This is what stops a landscape deck being sent off to
// find official pages that do not exist.
const landscape = normaliseIdea({
  title_he: 'המקומות הכי טובים לראות את האורות הצפוניים',
  emphasis_he: 'האורות הצפוניים',
  where: 'Arctic',
  kind: 'aurora',
  want: 5,
  places_he: ['אביסקו', 'טרומסה', 'רובנימי', 'אלטה', 'פיירבנקס'],
  places_en: ['Abisko', 'Tromso', 'Rovaniemi', 'Alta', 'Fairbanks'],
  subject_en: 'northern lights',
});
ok('a landscape idea marks itself free-form', landscape.freeform);
eq('and pairs its places for the photo search', landscape.freeformPlaces.length, 5);
eq('Hebrew on the slide', landscape.freeformPlaces[0].nameHe, 'אביסקו');
eq('English for the photograph', landscape.freeformPlaces[0].nameEn, 'Abisko');

const sourced = normaliseIdea({
  title_he: 'המוזיאונים של פראג',
  where: 'Prague',
  kind: 'museum',
  want: 5,
  places_he: ['מוזיאון לאומי'],
  places_en: ['National Museum'],
});
ok('a museum idea stays sourced', !sourced.freeform);

// A place with no English partner cannot be photographed, and one with no
// Hebrew partner renders a slide with no title. The pair is what survives.
const halfNamed = normaliseIdea({
  title_he: 'x',
  where: 'Norway',
  kind: 'mountain',
  want: 5,
  places_he: ['א', 'ב', 'ג'],
  places_en: ['A', 'B'],
});
eq('an unpaired name is dropped rather than rendered blank', halfNamed.freeformPlaces.length, 2);

// The adapter, which is what stops a proposal being asked for its places twice.
const forBuild = freeformFromIdea(landscape);
eq('the builder gets the region it will search', forBuild.whereEn, 'Arctic');
eq('and the subject the chooser rejects against', forBuild.subjectEn, 'northern lights');
eq('and the places that were approved, not new ones', forBuild.places.length, 5);
ok('and the cover phrase survives into the render', forBuild.emphasisHe.includes('האורות'));

// A kind with no subject of its own still gets one from the table.
eq(
  'an idea that named no subject falls back to its kind',
  freeformFromIdea({ ...landscape, subjectEn: '' }).subjectEn,
  'northern lights'
);

// /deck free and a deck requested by name BOTH carry `asked`, so `asked` cannot
// tell them apart — and `freeform` cannot either now that landscape kinds are
// free-form. `ownWords` is the discriminator, and it must be absent here: a
// landscape proposal revised through the free-form schema would lose the
// category that routed it.
eq('a landscape proposal is not a deck you described in words', landscape.ownWords, undefined);
eq('and clamped upwards too', normaliseIdea({ title_he: 'x', where: 'Prague', kind: 'museum', want: 2 }).want, 5);
eq('an idea in an unknown category is dropped', normaliseIdea({ title_he: 'x', where: 'p', kind: 'nightclub', want: 5 }), null);
ok(
  'em dashes are stripped from an idea title like everywhere else',
  !normaliseIdea({ title_he: 'פראג - מוזיאונים', where: 'Prague', kind: 'museum', want: 5 }).titleHe.includes('—')
);

/* -------------------------------------------------------------------------- */
group('copy style - hyphens only, never em or en dashes');

const EM = '—';
const EN = '–';
const NL = '\n';

eq('em dash becomes a spaced hyphen', hyphensOnly(`בין השוק לנמל ${EM} עשר דקות`), 'בין השוק לנמל - עשר דקות');
eq('en dash too', hyphensOnly(`ליסבון ${EN} פורטוגל`), 'ליסבון - פורטוגל');
eq('a numeric range stays tight', hyphensOnly(`2${EN}3 ימים`), '2-3 ימים');
eq('text without dashes is untouched', hyphensOnly('רגיל לגמרי'), 'רגיל לגמרי');
ok(
  'caption line breaks survive the substitution',
  hyphensOnly(`א ${EM} ב${NL}ג`).includes(NL),
  'a naive \\s* around the dash swallows the newline and flattens a multi-line caption'
);

/* -------------------------------------------------------------------------- */
group('instagram caption - short, no source URL, site line');

const capCand = {
  headline: 'העמק שנפתח רק 60 יום בשנה',
  subhead: 'ההרשמה נסגרת חודש מראש',
  // String.fromCharCode(10) rather than an escape: this file is edited by
  // scripts often enough that a literal backslash-n keeps getting mangled.
  caption: ['שאר השנה הדרך סגורה.', 'ההרשמה נפתחת בינואר.'].join(String.fromCharCode(10)),
  sourceUrl: 'https://www.govt.nz/some/very/long/path/that/nobody/can/tap',
};

const cap = instagramCaption(capCand);
ok('omits the source URL - nothing published carries one', !cap.includes('govt.nz'));
ok('omits the headline rather than repeating what the image already shows', !cap.includes(capCand.headline));
ok('keeps the caption body', cap.includes('ההרשמה נפתחת בינואר'));
ok('stays short', cap.length < 400, `${cap.length} chars`);

// The subhead is deliberately not on the card, so the description is the only
// place it can appear — and it opens it.
ok('carries the subhead, which the card no longer shows', cap.includes(capCand.subhead));
ok('the subhead comes first', cap.indexOf(capCand.subhead) < cap.indexOf('שאר השנה'));

// THE SIGN-OFF IS GONE. It was `לסוכן הטיולים החכם שלנו` over
// `www.tiyulplus.com` under every card, which is the one published string this
// pipeline still shipped a domain in, unclickable on both platforms, and a post
// that opens by pointing off the app neither app has a reason to distribute.
ok('no sign-off line', !cap.includes('לסוכן הטיולים החכם שלנו'));
ok('and no domain at all', !/tiyulplus\.com/.test(cap));
ok('no scheme-prefixed URL anywhere', !/https?:\/\//.test(cap));

// What replaced it: the close every other kind already had. A question, and on
// ctaShare of posts one ask naming the next thing to do here. Forced rather than
// drawn, because a test that depends on Math.random passes four times in five.
{
  const closed = instagramCaption(capCand, { rand: () => 0 });
  const q = postConfig().caption.questions[0];
  const ask = postConfig().caption.ctas[0];
  ok('the caption closes on a question', closed.includes(q));
  ok('and then the ask', closed.includes(ask));
  ok('the question comes before the ask', closed.indexOf(q) < closed.indexOf(ask));
  ok('the ask is last', closed.trim().endsWith(ask));

  // ctaShare is what makes it soft. A draw above the share appends no ask, and
  // the question still closes the caption on its own.
  const noAsk = instagramCaption(capCand, { rand: () => 0.99 });
  ok('most posts carry no ask', !postConfig().caption.ctas.some((c) => noAsk.includes(c)));
  ok('but every post carries a question', /\?/.test(noAsk));
}

// Both descriptions from ONE draw. Called separately they each draw their own
// question and ask, and the approval card, which prints one description -
// stops being a preview of either.
{
  const { publishedDescriptions } = await import('../src/format.js');
  let n = 0;
  // A rand that walks, so two independent draws would land on different entries.
  const both = publishedDescriptions(capCand, { rand: () => (n++ % 10) / 10 });
  eq('the Instagram and TikTok descriptions match', both.instagram, both.tiktok);
}

/* -------------------------------------------------------------------------- */
group('pexels stock provider');

{
  const realFetch = globalThis.fetch;
  const realKey = process.env.PEXELS_API_KEY;
  process.env.PEXELS_API_KEY = 'test-key';

  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const searchUrls = [];
  let sentAuth = null;
  let downloaded = null;

  const photo = (over) => ({
    width: 3000, height: 4000, alt: 'Lisbon old town alley at sunset', photographer: 'Ada L',
    url: 'https://pexels.com/photo/1',
    src: { original: 'https://images.pexels.com/photos/1/pexels-photo-1.jpeg', portrait: 'https://images.pexels.com/p.jpg' },
    ...over,
  });

  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).includes('api.pexels.com')) {
      searchUrls.push(String(url));
      sentAuth = opts.headers?.Authorization;
      return {
        ok: true,
        json: async () => ({
          photos: [
            photo({ width: 400, height: 600, photographer: 'Too Small' }),
            // Pexels' own first result: a person posing. Ranked below the scene.
            photo({ alt: 'Woman smiling in front of a tram in Lisbon', photographer: 'Portrait Guy' }),
            photo({ photographer: 'Ada L' }),
          ],
        }),
      };
    }
    downloaded = String(url);
    return {
      ok: true,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength),
    };
  };

  const { search, scorePhoto, pickBest, cropUrl } = await import('../src/images/pexels.js');
  const got = await search('Lisbon old town alley');

  ok('sends the API key as an Authorization header', sentAuth === 'test-key');
  ok('asks for portrait crops first - the card is 4:5, a landscape crop loses the subject', /orientation=portrait/.test(searchUrls[0] || ''));
  ok('inlines the bytes as a data URI rather than hotlinking', got?.src?.startsWith('data:image/jpeg;base64,'));
  eq('tags provenance as stock', got?.provenance, 'stock');
  ok('picks the scene over the person, not the first result', got?.credit?.includes('Ada L'));
  ok('skips photos narrower than the card', !/Too Small/.test(JSON.stringify(got)));
  ok('downloads an exact 1080x1350 crop from the CDN, not the 800x1200 portrait', /w=1080/.test(downloaded) && /h=1350/.test(downloaded) && /fit=crop/.test(downloaded));
  eq('an empty query returns null rather than searching', await search('  '), null);

  // Ranking on its own, no network.
  const scene = photo({});
  const person = photo({ alt: 'Man posing with a selfie stick in Lisbon' });
  const product = photo({ alt: 'Lisbon souvenir coffee cup mockup' });
  const wide = photo({ width: 6000, height: 2000 });
  ok('a described scene outranks a person in front of it', scorePhoto(scene, 'Lisbon old town alley') > scorePhoto(person, 'Lisbon old town alley'));
  ok('a product shot ranks below zero and is refused', scorePhoto(product, 'Lisbon old town alley') < 0);
  ok('portrait outranks a wide landscape of the same scene', scorePhoto(scene, 'Lisbon alley') > scorePhoto(wide, 'Lisbon alley'));
  eq('nothing acceptable means null, so the caller can broaden the query', pickBest([person, product], 'Lisbon alley'), null);
  ok('cropUrl keeps the original and adds the crop parameters', cropUrl(scene).startsWith('https://images.pexels.com/photos/1/pexels-photo-1.jpeg?'));
  ok('cropUrl falls back to a generic size without an original', cropUrl({ src: { large2x: 'https://x/l.jpg' } }) === 'https://x/l.jpg');

  // The second pass: the portrait search finds nothing usable, any orientation does.
  searchUrls.length = 0;
  let calls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('api.pexels.com')) {
      searchUrls.push(String(url));
      calls++;
      return { ok: true, json: async () => ({ photos: calls === 1 ? [person] : [wide] }) };
    }
    return { ok: true, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => jpeg.buffer.slice(0, 6) };
  };
  const second = await search('Lisbon alley');
  eq('a portrait miss triggers a second, unconstrained search', searchUrls.length, 2);
  ok('the second search carries no orientation', !/orientation=/.test(searchUrls[1]));
  ok('and its landscape result is used rather than a text card', Boolean(second?.src));

  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.PEXELS_API_KEY; else process.env.PEXELS_API_KEY = realKey;
}

/* -------------------------------------------------------------------------- */
group('image query fallback chain');

{
  const qs = imageQueries({ imageQuery: 'Kyoto wooden bridge', imageQueryAlt: 'Kyoto autumn temple', placeEn: 'Kyoto', countryEn: 'Japan' });
  eq('most specific first', qs[0], 'Kyoto wooden bridge');
  eq('then the broader one the model supplied', qs[1], 'Kyoto autumn temple');
  ok('then the place by name', qs.some((q) => q === 'Kyoto Japan landmark'));
  ok('and the country as a last resort', qs.at(-1) === 'Japan travel scenery');
  eq('no duplicates', new Set(qs).size, qs.length);
  eq('nothing to search for is an empty list, not [""]', imageQueries({}).length, 0);
  eq('a country alone still yields searches', imageQueries({ countryEn: 'Japan' }).length, 2);
}

/* -------------------------------------------------------------------------- */
group('copy shape - the exemplar passes, its failure modes do not');

{
  const exemplar = {
    headline: 'החודשים שבהם הזוהר הצפוני עובד לטובתכם',
    subhead: 'סביב השוויונים - ספטמבר ומרץ - הגיאומטריה המגנטית פשוט נוחה יותר.',
    caption:
      'זוהר אפשר לראות בכל חודש בשנה, אבל סביב השוויונים הזווית בין השדה המגנטי של כדור הארץ לרוח השמש מעבירה אנרגיה פנימה ביעילות - האפקט נקרא ראסל-מקפרון. ואם יצא לכם לראות סגול ולא ירוק: זה פשוט צבעים של גזים שונים שמתערבבים בעין. 💜 #זוהרצפוני #מתיטסים',
  };
  ok('the post that set the standard passes every check', verifyDraftText(exemplar) === true);

  ok('a one-word headline is too short', Boolean(headlineLength({ headline: 'ליסבון' })));
  ok('a twelve-word headline is a sentence', Boolean(headlineLength({ headline: 'א ב ג ד ה ו ז ח ט י כ ל' })));
  eq('six words is fine', headlineLength(exemplar), null);
  throws('rejected as headline_length', () => verifyDraftText({ ...exemplar, headline: 'ליסבון' }), 'headline_length');

  ok('six sentences is an article', Boolean(captionLength({ caption: 'א. ב. ג. ד. ה. ו.' })));
  ok('five hundred characters is an article', Boolean(captionLength({ caption: 'א'.repeat(500) })));
  eq('hashtags do not count toward the length', captionLength({ caption: 'משפט אחד. ' + '#תג '.repeat(3) }), null);
  throws('rejected as caption_too_long', () => verifyDraftText({ ...exemplar, caption: 'א. ב. ג. ד. ה. ו. ז.' }), 'caption_too_long');

  ok('"מדהים" is filler', Boolean(fillerAdjective({ headline: 'הנוף המדהים של ליסבון' })));
  ok('a prefixed form is still filler', Boolean(fillerAdjective({ caption: 'והמרהיבים שבהם' })));
  ok('"בלתי נשכח" is filler', Boolean(fillerAdjective({ caption: 'חוויה בלתי נשכחת' })));
  eq('a specific noun is not', fillerAdjective({ caption: 'השוק בשבת בבוקר' }), null);
  throws('rejected as filler_adjective', () => verifyDraftText({ ...exemplar, subhead: 'נוף מרהיב.' }), 'filler_adjective');

  ok('a headline ending in ? is rhetorical', Boolean(rhetoricalOpening({ headline: 'למה ליסבון?' })));
  ok('"ידעתם ש" is an opening the brief forbids', Boolean(rhetoricalOpening({ headline: 'x', caption: 'ידעתם שבליסבון יש חשמלית? כן.' })));
  ok('a caption opening on a question is rhetorical', Boolean(rhetoricalOpening({ headline: 'x', caption: 'רוצים לדעת מה? הנה.' })));
  eq('a question later in the caption is allowed', rhetoricalOpening({ headline: 'x', caption: 'השוק פתוח בשבת. למה? כי כן.' }), null);
  throws('rejected as rhetorical_opening', () => verifyDraftText({ ...exemplar, headline: 'מתי הזוהר הצפוני עובד לטובתכם?' }), 'rhetorical_opening');
}

/* -------------------------------------------------------------------------- */
group('normalise - what is fixed for free rather than re-drafted');

{
  eq('emoji leave the headline', stripEmoji('הזוהר 💜 הצפוני ✨'), 'הזוהר הצפוני');
  eq('three hashtags stay', capHashtags('טקסט. 💜 #א #ב #ג'), 'טקסט. 💜 #א #ב #ג');
  eq('a fourth and fifth are trimmed', capHashtags('טקסט. 💜 #א #ב #ג #ד #ה'), 'טקסט. 💜 #א #ב #ג');

  const item = { pillarHints: ['inCity'] };
  const base = { usable: true, layout: 'fact', headline: 'x', place_en: 'Lisbon', country_en: 'Portugal', image_query: '' };
  eq('a fact card about a named place becomes a photo card when images are available', normalise(base, item, { imagesAvailable: true }).layout, 'photoFull');
  eq('...but not when they are not', normalise(base, item, { imagesAvailable: false }).layout, 'fact');
  eq('...and not when the post names nowhere', normalise({ ...base, place_en: '', country_en: '' }, item, { imagesAvailable: true }).layout, 'fact');
  eq('the alert layout is left alone', normalise({ ...base, layout: 'alert' }, item, { imagesAvailable: true }).layout, 'alert');
  const n = normalise({ ...base, image_query: 'Lisbon tram', image_query_alt: 'Lisbon skyline' }, item, { imagesAvailable: true });
  eq('the second image query is carried', n.imageQueryAlt, 'Lisbon skyline');
  eq('the English place is carried', n.placeEn, 'Lisbon');
}

/* -------------------------------------------------------------------------- */
group('feed parsing - a full-text feed is not an entity bomb');

{
  // Three of the first six official tourism feeds probed carried escaped HTML
  // summaries with more than 1,000 entities between them, and the parser's
  // default budget rejected the whole feed. A billion-laughs document is
  // stopped by depth, not by count.
  const item = (i) =>
    `<item><title>Post ${i}</title><link>https://example.gov/${i}</link><description>${'&lt;p&gt;a &amp; b&lt;/p&gt;'.repeat(60)}</description></item>`;
  const body = `<?xml version="1.0"?><rss><channel><title>t</title>${Array.from({ length: 12 }, (_, i) => item(i)).join('')}</channel></rss>`;
  let parsed = null;
  let err = null;
  try {
    parsed = parseFeed(body, { id: 'x', name: 'x', authority: 'government', lang: 'en', pillars: [] });
  } catch (e) {
    err = e;
  }
  ok('a feed with thousands of ordinary entities parses', !err, err?.message);
  eq('all twelve items survive', parsed?.length, 12);
  ok('and the escaped HTML is decoded to text', parsed?.[0]?.summary.includes('a & b'));
}

/* -------------------------------------------------------------------------- */
group('ranking - what a title alone can rule out');

{
  const base = { authority: 'government', publishedAt: new Date().toISOString(), pillarHints: [], summary: 'x'.repeat(300) };
  const sc = (title) => scoreItem({ ...base, title });
  ok('a fatality comes last, however fresh and official', sc('Two Deceased Hikers Recovered and Identified Following Flash Flood') < sc('Timed entry reservations return in May'));
  ok('an MoU signing is trade noise', sc('Visit Maldives and Emirates sign MoU to strengthen tourism promotion') < sc('The night market reopens on the riverbank'));
  ok('a travel mart is trade noise', sc('TAT strengthens global golf tourism connections at Thailand Golf Travel Mart 2026') < sc('The night market reopens on the riverbank'));
  ok('a named destination is nudged up', sc('The Odeon of Herodes Atticus in Athens closes for restoration') > sc('The Odeon closes for restoration'));
  ok('a comedian is not a trip', sc('Elena Gabrielle: comedy special, live') < sc('Elena Gabrielle: the square'));
}

/* -------------------------------------------------------------------------- */
group('registry integrity');

const reg = registry();
ok('every source has an id, kind and note', reg.sources.every((s) => s.id && s.kind && s.note));
ok('every enabled source has an implemented adapter', reg.sources.filter((s) => s.enabled).every((s) => ['rss', 'climate'].includes(s.kind)));
ok('ids are unique', new Set(reg.sources.map((s) => s.id)).size === reg.sources.length);

/* -------------------------------------------------------------------------- */
// Last, and slowest: the guard that was silently broken. Needs Chromium but no
// network. Checked in both directions, because the whole point is that the
// obvious version of this check passed in both.
/* -------------------------------------------------------------------------- */
group('measured facts - the numbers a mountain has instead of a website');

const METRE = { amount: '+3967', unit: 'http://www.wikidata.org/entity/Q11573' };
eq('an elevation in metres reads as metres', lengthValue(METRE, 'm'), '3,967 מ׳');
eq(
  'feet are normalised rather than printed',
  lengthValue({ amount: '+14692', unit: 'http://www.wikidata.org/entity/Q3710' }, 'm'),
  '4,478 מ׳'
);
eq(
  'a trail in metres is stated in kilometres',
  lengthValue({ amount: '+5300', unit: 'http://www.wikidata.org/entity/Q11573' }, 'km'),
  '5.3 ק"מ'
);
// Wikidata's default unit for a bare quantity is "1", and guessing metres from
// that is how a slide ends up claiming a hill is four kilometres high.
eq('an unrecognised unit is refused, not guessed', lengthValue({ amount: '+900', unit: 'http://www.wikidata.org/entity/Q99' }, 'm'), null);
eq('and so is a missing amount', lengthValue({ unit: 'x' }, 'm'), null);

// Wikidata pads years to four digits; "נבנה: 0778" went out on a slide.
eq('a padded year loses its padding', yearValue({ time: '+0778-00-00T00:00:00Z' }), '778');
eq('a modern year is unchanged', yearValue({ time: '+1601-01-01T00:00:00Z' }), '1601');
eq('a year BCE says so rather than showing a minus', yearValue({ time: '-0447-00-00T00:00:00Z' }), '447 לפנה"ס');

const peakClaims = {
  P2044: [{ mainsnak: { datavalue: { value: METRE } } }],
  P17: [{ mainsnak: { datavalue: { value: { id: 'Q39' } } } }],
};
const peakLabels = new Map([['Q39', { he: 'שווייץ', iso: 'CH' }]]);
const peakFields = factsFor('mountain', peakClaims, { labels: peakLabels });
eq('a summit carries its height', peakFields[0].value, '3,967 מ׳');
eq('labelled in Hebrew', peakFields[0].labelHe, 'גובה');
// The flag beside the name already says the country; a field saying it again is
// the same fact twice, and five times over a one-country deck.
ok('and no country field, because the flag already says it', !peakFields.some((f) => f.key === 'country'));

const swiss = countryFor(peakClaims, peakLabels);
eq('the country resolves to Hebrew', swiss.he, 'שווייץ');
eq('and to its flag', swiss.flag, '🇨🇭');
eq('a place with no country claim says so', countryFor({}, peakLabels).flag, null);

// "Tromsø, Norway" earns the word because the next slide says Finland. Six
// Swiss summits do not.
const oneCountry = [{ countryHe: 'שווייץ', flag: '🇨🇭' }, { countryHe: 'שווייץ', flag: '🇨🇭' }];
applyCountryVisibility(oneCountry);
ok('a one-country deck drops the repeated word', oneCountry.every((s) => s.countryHe === null));
ok('but keeps the flag, which is what makes the set look like a set', oneCountry.every((s) => s.flag));
const manyCountries = [{ countryHe: 'נורווגיה' }, { countryHe: 'פינלנד' }];
applyCountryVisibility(manyCountries);
ok('a cross-country deck keeps it', manyCountries.every((s) => s.countryHe));

ok('a deck whose slides mostly have fields is an info deck', enoughFor([{ fields: [1] }, { fields: [1] }, { fields: [] }]));
ok('one where they mostly do not is not', !enoughFor([{ fields: [1] }, { fields: [] }, { fields: [] }]));
ok('and an empty deck is not', !enoughFor([]));

// Artwork for every emoji a slide can draw, checked rather than assumed.
//
// The whole reason the set is committed rather than left to the machine's own
// emoji font is that a missing glyph does not error, it renders as a box — and
// a slide full of boxes screenshots perfectly happily. Adding a field to
// WIKIDATA_FIELDS without running `npm run fetch-emoji` is the obvious way to
// reintroduce that, so the specs are checked against the files on disk.
for (const [kind, spec] of Object.entries(WIKIDATA_FIELDS)) {
  for (const f of spec) {
    ok(`${kind}/${f.key} has artwork for ${f.emoji}`, Boolean(emojiDataUri(f.emoji)));
  }
}
// Flags are the ones most likely to be missing: noto-emoji keeps them in a
// different directory, in a different format, and every one of them 404s at the
// path the pictograms come from — which is how the whole set came to be absent.
for (const iso of ['IT', 'CH', 'JP', 'NO', 'GR', 'IS', 'CZ']) {
  ok(`the ${iso} flag has artwork`, Boolean(emojiDataUri(flagFor(iso))));
}
eq('an ISO code becomes a flag', flagFor('it'), '🇮🇹');
eq('and nonsense does not', flagFor('xyz'), null);

/* -------------------------------------------------------------------------- */
group('Hebrew names - a Latin name on a Hebrew slide is the loudest tell there is');

ok('Hebrew passes', isHebrew('מאטרהורן'));
ok('Hebrew with a space and a comma passes', isHebrew('אלפה די סיוזי, איטליה'));
ok('Latin is refused', !isHebrew('Piz Bernina'));
// The failure that actually shipped: a transliteration that kept one Latin word.
ok('and so is a mixture, which is how "Aletschhorn" survived', !isHebrew('הר Aletschhorn'));
ok('an empty answer is refused', !isHebrew(''));
ok('so is whitespace', !isHebrew('   '));

/* -------------------------------------------------------------------------- */
group('module surfaces - a deleted export must not fail silently');

// A careless edit to deck/ideas.js removed hasApiKey and proposeIdeas along
// with the function it meant to replace. Nothing caught it: the tests did not
// import them, the renderer does not use them, and the only caller is the /deck
// command with no argument — which would have thrown at runtime, in the bot, on
// the one path nobody exercises while iterating on slides.
//
// Checked as a list rather than by importing each one, so the failure names the
// missing symbol instead of taking the whole suite down with a module error.
for (const [mod, expected] of [
  ['../src/deck/ideas.js', ['hasApiKey', 'proposeIdeas', 'reviseIdea', 'coverForDeck', 'titleForRequest', 'normaliseIdea', 'rotationFor', 'oneClause', 'emphasisFrom']],
  ['../src/deck/build.js', ['buildDeck', 'buildDeckFromSite', 'fillImages', 'draftSlide', 'findPage']],
  ['../src/deck/facts.js', ['factsFor', 'countryFor', 'enoughFor', 'applyCountryVisibility', 'lengthValue', 'yearValue']],
  ['../src/render/deck.js', ['renderDeck', 'renderDeckSize', 'slideStem']],
  ['../src/render/photo.js', ['analyseSlides', 'measureCardScrims', 'scrimAlpha', 'underScrim']],
  ['../src/render/deckTemplates.js', ['renderSlideHtml', 'SIZES', 'FACES', 'INK_LUMINANCE', 'typeScale']],
  ['../src/postConfig.js', ['postConfig', 'destinationWeight', 'byWeight']],
  ['../src/hashtags.js', ['hashtagsFor', 'hashtagLine', 'destinationTag']],
  ['../src/format.js', ['captionHook', 'assertNoUrl', 'URL_LIKE', 'deckCaption', 'deckTiktokCaption', 'publishedDescriptions']],
  ['../src/video/cuts.js', ['pickCuts', 'oneCountry', 'cutLabel', 'writeCutsHook', 'beatCountMismatch', 'hasApiKey']],
  ['../src/video/clip.js', ['buildClip', 'buildCutClip', 'buildClips', 'clipApprovalMessage', 'cutApprovalMessage', 'clipId', 'audioLine']],
  ['../src/video/overlay.js', ['burnClip', 'burnCuts', 'ffmpegReady', 'clipOutputDir', 'download']],
  ['../src/publish/imageHosts.js', ['cardBaseUrls', 'cardHostConfigured', 'publicUrlFor', 'clipPublicUrl', 'isVerifiedForTikTok']],
  ['../src/store.js', ['clipPexelsId', 'clipPexelsIds', 'markClipUsed', 'usedClipIds']],
  ['../src/angles.js', ['angles', 'pickAngle', 'anglePrompt']],
  ['../src/video/tracks.js', ['tracks', 'pickTrack', 'trackOffset', 'audioConfigured', 'audioDir', 'forgetTracks']],
  ['../src/notify.js', ['send', 'published', 'descriptionToPaste', 'publishHeld', 'publishRetrying']],
  ['../src/publish/targets.js', ['targetsForKind', 'allowedForKind', 'manualForKind', 'liveTargets', 'publishTargets', 'targetsHe']],
  ['../src/shoot/rotation.js', ['chooseFormat', 'nextSeries', 'seriesLabels', 'pickAngle']],
  ['../src/deck/attempt.js', ['buildWithFallback', 'describeAttempt']],
  ['../src/deck/request.js', ['resolveRequest', 'parseLocally']],
  ['../src/deck/hebrew.js', ['hebrewNames', 'isHebrew']],
  ['../src/deck/region.js', ['deckPlace', 'namesPlace', 'REGIONS']],
  ['../src/images/textbox.js', ['findTextRegion']],
]) {
  const loaded = await import(mod).catch((e) => ({ __error: e.message }));
  if (loaded.__error) {
    ok(`${mod} loads`, false, loaded.__error);
    continue;
  }
  for (const name of expected) {
    ok(`${mod.split('/').pop()} still exports ${name}`, typeof loaded[name] !== 'undefined');
  }
}

/* -------------------------------------------------------------------------- */
group('covers - variety is a property of the sequence, not of one call');

// A model asked once per deck cannot see the previous deck, so "vary it" in a
// brief converges on its favourite phrasing — which is how six decks in a row
// came back "טופ N ... שאסור לפספס". The shape and voice are therefore chosen
// outside the call and handed down.
// An example beats a rule, so the examples have to obey the rules.
//
// The brief says a number on a cover is written as a numeral and never spelled
// out — and one of the shape examples read "איסלנד בחמישה מפלים", three
// paragraphs below that rule. The model copied the example, not the rule, and
// shipped "האלפים של ברן בשישה הרים". Everything handed to the model as an
// exemplar is checked against the rule it is meant to illustrate.
const SPELLED_OUT = /\b(?:שניים|שתיים|שלושה|שלוש|ארבעה|ארבע|חמישה|חמש|שישה|שש|שבעה|שבע|שמונה|תשעה|תשע|עשרה|עשר)\b/;
for (const shape of COVER_SHAPES) {
  for (const example of shape.examples) {
    ok(`the ${shape.id} example writes its number as a numeral`, !SPELLED_OUT.test(example), example);
  }
}
for (const voice of Object.values(COVER_VOICES)) {
  ok(`the ${voice.id} example does too`, !SPELLED_OUT.test(voice.example), voice.example);
}

// A counter, not a hash of the deck.
//
// Hashing made the choice stable across re-runs, which nothing needed — the
// deck id is built from the region, the category and the place ids, and
// deliberately not from the title. What it cost was collisions: seven decks
// drawing independently from six buckets put four on the same picture and
// returned the identical closing phrase twice, which is the exact thing the
// rotation exists to prevent. A counter cannot collide.
const seq = Array.from({ length: 30 }, (_, i) => rotationFor(i));

ok('consecutive posts differ in shape', seq[0].shape.id !== seq[1].shape.id);
// Not voice: it follows the shape, and two impersonal shapes can sit next to
// each other. Three of the four covers the channel was specified by are
// impersonal, so that is the common case rather than a fault.
// The voice belongs to the shape rather than rotating beside it. Spun
// independently it put "אתם" on a shape with no room for it —
// "פסגות שאתם לא תאמינו שהן אמיתיות" where the spec says
// "הרים שלא נראים אמיתיים".
eq('the unreal shape is impersonal', seq[0].voice.id, 'none');
eq('the obligation shape takes the pronoun', seq[2].voice.id, 'you');
ok('every shape declares its voice', COVER_SHAPES.every((sh) => COVER_VOICES[sh.voice]));
// In the four covers the channel was specified by, "אתם" appears exactly once.
const pronouns = COVER_SHAPES.filter((sh) => sh.voice === 'you').length;
ok('most shapes carry no pronoun', pronouns <= 2);

eq('every shape is reachable', new Set(seq.map((r) => r.shape.id)).size, COVER_SHAPES.length);
eq('and both voices are used', new Set(seq.map((r) => r.voice.id)).size, Object.keys(COVER_VOICES).length);
// Most covers carry no count and name nowhere. The counted shape exists because
// the channel's own first example was "טופ 4 פסגות שאסור לפספס באלפים", but a
// list built AROUND counts and place names had every cover rejected.
const counted = seq.slice(0, 10).filter((r) => r.shape.id === 'top-n').length;
eq('one cover in five carries a count', counted, 2);
// Obligation is no longer rationed by a flag — it is one of the five shapes,
// which is what the channel's own examples do with it.
ok('obligation is a shape of its own', COVER_SHAPES.some((sh) => sh.id === 'urgency'));
ok('and so is the superlative', COVER_SHAPES.some((sh) => sh.id === 'superlative'));

// Nonsense in, first entry out, rather than a crash — the caller passes a count
// that could be absent on a fresh store.
eq('a missing count starts at the beginning', rotationFor(undefined).shape.id, seq[0].shape.id);
eq('and so does rubbish', rotationFor('x').shape.id, seq[0].shape.id);

// "One line, not a title plus a subtitle" was in the brief from the start and a
// cover still came back as "סנטוריני שאתם לא מכירים: חורבות ומצודות מול הים".
// The half before the colon is the line that was wanted.
eq(
  'a cover split by a colon keeps its first half',
  oneClause('סנטוריני שאתם לא מכירים: חורבות ומצודות מול הים'),
  'סנטוריני שאתם לא מכירים'
);
eq('a clean line is untouched', oneClause('6 מפלים באיסלנד שלא נראים אמיתיים'), '6 מפלים באיסלנד שלא נראים אמיתיים');
// Half of a short title is not a title, so a stub is refused and the whole
// line kept — better an awkward cover than a two-word one.
eq('but a stub is refused', oneClause('פראג: שישה מקומות'), 'פראג: שישה מקומות');
// Told not to use a colon, the next cover used a comma for the same splice.
eq(
  'a comma splice is cut the same way',
  oneClause('הסנטוריני שאתם לא מכירים, חורבות ומצודות'),
  'הסנטוריני שאתם לא מכירים'
);

// Cutting the splice can take the model's chosen emphasis with it, which left
// one cover with nothing set in colour. The closing clause is what should have
// been coloured anyway, and in Hebrew it opens with ש.
eq('the closing clause is recoverable', emphasisFrom('הסנטוריני שאתם לא מכירים'), 'שאתם לא מכירים');
eq('and from a longer line too', emphasisFrom('6 מפלים באיסלנד שלא נראים אמיתיים'), 'שלא נראים אמיתיים');
// No ש-clause: the last two words carry it.
eq('otherwise the tail does', emphasisFrom('6 פינות בפראג עם גגות כתומים'), 'גגות כתומים');
eq('a title too short to split gives nothing', emphasisFrom('פראג'), '');

/* -------------------------------------------------------------------------- */
group('where a deck is - the cover has to say it, so it has to be worked out');

// Six Icelandic waterfalls went out under "מפלים שאתם חייבים לראות פעם אחת
// בחיים". Every slide was in one country and the cover named nowhere, which is
// the one thing a viewer needed in order to save the post.
const ice = [
  { nameHe: 'סקוגאפוס', iso: 'IS', countryHe: 'איסלנד' },
  { nameHe: 'גודפוס', iso: 'IS', countryHe: 'איסלנד' },
  { nameHe: 'דטיפוס', iso: 'is', countryHe: 'איסלנד' },
];
eq('one country is named', deckPlace(ice, { kind: 'waterfall' }).he, 'איסלנד');
eq('and it is a country, not an area', deckPlace(ice, { kind: 'waterfall' }).scope, 'country');

// "even if all countries are nordic, the title should say in the nordics".
const nordic = [
  { iso: 'NO', countryHe: 'נורווגיה' },
  { iso: 'SE', countryHe: 'שוודיה' },
  { iso: 'IS', countryHe: 'איסלנד' },
];
eq('three nordic countries are one area', deckPlace(nordic).he, 'סקנדינביה');
eq('and it is an area, not a country', deckPlace(nordic).scope, 'region');

// Only when nothing is shared does the cover name nowhere.
eq(
  'places on different continents share nothing',
  deckPlace([{ iso: 'IS' }, { iso: 'JP' }, { iso: 'PE' }]).scope,
  'none'
);
eq('and nothing is what it offers', deckPlace([{ iso: 'IS' }, { iso: 'JP' }]).he, null);

// The SMALLEST covering group, not the first one that fits. Norway and Sweden
// are in Europe as well as in Scandinavia, and "באירופה" for two Nordic
// countries is the vaguer of two true answers.
eq('the tightest grouping wins', deckPlace([{ iso: 'NO' }, { iso: 'SE' }]).he, 'סקנדינביה');
// Italy and Norway have no region between them, and the continent is the last
// thing true of both.
eq('a continent is the last resort', deckPlace([{ iso: 'IT' }, { iso: 'NO' }]).he, 'אירופה');

// The one grouping that asks what the deck is about. A museum in Vienna is not
// in the Alps; a summit above it is.
eq('a cross-border summit deck is alpine', deckPlace([{ iso: 'CH' }, { iso: 'AT' }], { kind: 'mountain' }).he, 'האלפים');
eq(
  'the same two countries of museums are not',
  deckPlace([{ iso: 'CH' }, { iso: 'AT' }], { kind: 'museum' }).he,
  'מרכז אירופה'
);

// The tiyulplus route has no Wikidata entity and therefore no ISO code; it
// resolves one country for the whole deck and writes the Hebrew name onto every
// slide. That has to reach the cover too.
eq(
  'a deck with names but no codes still has a country',
  deckPlace([{ countryHe: 'צ׳כיה' }, { countryHe: 'צ׳כיה' }]).he,
  'צ׳כיה'
);
eq('an empty deck is nowhere', deckPlace([]).scope, 'none');
// A slide with no country does not vote. Filling it in from the region the deck
// was searched in is a guess, and the guess that adds a country is the one that
// turns "באיסלנד" into "בסקנדינביה".
eq('a slide with no country abstains', deckPlace([{ iso: 'IS' }, {}, { iso: 'IS' }]).he, 'איסלנד');

// Every region has to be sayable in Hebrew and reachable.
for (const r of REGIONS) {
  ok(`${r.id} is written in Hebrew`, isHebrew(r.he), r.he);
  ok(`${r.id} has countries in it`, r.isos.length >= 2);
}
// Smallest wins, so the list is written smallest first and reads in the order
// it resolves in.
const sizes = REGIONS.map((r) => r.isos.length);
ok('the groupings are declared smallest first', sizes.every((n, i) => i === 0 || n >= sizes[i - 1]), sizes.join(','));

// Two groupings of the same size that shared a country would be resolved by
// declaration order, which is a coin toss dressed as a rule. Same size is fine
// as long as they cannot both cover one deck.
for (const a of REGIONS) {
  for (const b of REGIONS) {
    if (a === b || a.isos.length !== b.isos.length) continue;
    ok(
      `${a.id} and ${b.id} are the same size and cannot both win`,
      !a.isos.some((c) => b.isos.includes(c))
    );
  }
}

// France and Germany: the same pair of countries, two different answers,
// because a summit between them is in the Alps and a museum in either is not.
eq('a cross-border summit deck gets the range',
  deckPlace([{ iso: 'FR' }, { iso: 'DE' }], { kind: 'mountain' }).he, 'האלפים');
eq('and the same two countries of museums get the half-continent',
  deckPlace([{ iso: 'FR' }, { iso: 'DE' }], { kind: 'museum' }).he, 'מערב אירופה');

// The check that closes the loop: the model writes the place with a preposition
// on it, so the cover is matched on the substring rather than on equality.
ok('a country with ב in front of it counts', namesPlace('המפלים הכי יפים באיסלנד', 'איסלנד'));
ok('and an area does too', namesPlace('המפלים הכי יפים בסקנדינביה', 'סקנדינביה'));
ok('a cover that names nowhere does not', !namesPlace('מפלים שאתם חייבים לראות', 'איסלנד'));
// ב absorbs a definite ה, so "הפיליפינים" is written "בפיליפינים" and a plain
// includes() would fail a perfectly good cover.
ok('the definite article is absorbed by the preposition', namesPlace('החופים הכי יפים בפיליפינים', 'הפיליפינים'));
// Checked WITH the ב attached, so stripping the ה cannot match a country whose
// name merely begins with one: "הודו" is not satisfied by a line that happens
// to contain the letters ודו.
ok('a stem on its own is not a match', !namesPlace('מקומות יפים עם ודו בשם', 'הודו'));
ok('nothing asked for is always satisfied', namesPlace('כל דבר', ''));

/* -------------------------------------------------------------------------- */
group('deck requests - the command has to answer with a slideshow');

eq('the category at the end is found', parseLocally('Prague museum')?.kind, 'museum');
eq('and the region with it', parseLocally('Prague museum')?.where, 'Prague');
// "/deck Italy mountains" is what people actually type.
eq('a plural at the end is found too', parseLocally('Dolomites trails')?.kind, 'trail');
eq('a category at the START is found', parseLocally('mountains Italy')?.kind, 'mountain');
eq('with the rest as the region', parseLocally('mountains Italy')?.where, 'Italy');
// Not a failure — a request the model is asked to interpret rather than one the
// command rejects. Answering a typed request with a grammar complaint is the
// behaviour being removed.
eq('a phrase with no category is handed upwards', parseLocally('japan autumn'), null);
eq('and so is a single word', parseLocally('Santorini'), null);

/* -------------------------------------------------------------------------- */
group('scrims - sized to the photograph, not to the worst photograph');

// The complaint: Instagram cards sometimes come out too dark. "Sometimes" is
// the tell — the scrim was a constant sized for a white sky, so over a
// photograph that was already dark it painted near-black onto near-black and
// the bottom half of the picture stopped existing.
const bright = scrimAlpha(0.6);
const dim = scrimAlpha(0.05, { floor: 0.34 });
ok('a blown-out sky still gets a heavy scrim', bright > 0.6, bright);
ok('an already-dark photograph gets a light one', dim <= 0.4, dim);
ok('and darker photographs never ask for more than brighter ones',
  scrimAlpha(0.05) <= scrimAlpha(0.25) && scrimAlpha(0.25) <= scrimAlpha(0.6));

// The floor is not a legibility number. Without it a dark photograph gets no
// scrim at all, which is legible and reads as an accident rather than as a
// block of type.
eq('the floor holds when no darkening is needed', scrimAlpha(0.02, { floor: 0.34 }), 0.34);
// And the ceiling holds when no amount would be enough, rather than running off
// the end of the search.
eq('the ceiling holds when nothing would be enough', scrimAlpha(1, { want: 99 }), 0.97);

// Composited the way the browser composites it. Averaging the LINEAR
// luminances instead reports a scrim as darker than it renders, which would
// size every scrim too light — the opposite failure, and a worse one.
ok('a scrim at full strength lands on the scrim colour',
  Math.abs(underScrim(0.9, 1) - 0.0124) < 0.001);
eq('and at zero it changes nothing', Number(underScrim(0.42, 0).toFixed(4)), 0.42);
ok('the sRGB midpoint is darker than the linear one would be',
  underScrim(0.6, 0.5) < (0.6 + 0.0124) / 2);

// The scrim the measurement produced has to actually reach the stylesheet, and
// a card that could not be measured has to fall back to the old constants
// rather than to no scrim at all.
const lit = renderHtml(
  { pillar: 'discover', layout: 'photoFull', headline: 'כותרת', place: 'ונציה' },
  { image: { src: 'data:image/jpeg;base64,x', scrim: { bottom: 0.4, top: 0.2 } } }
);
ok('a measured scrim reaches the gradient', lit.includes(`rgba(${SCRIM_INK},0.400)`), lit.match(/scrim-bottom[\s\S]{0,180}/)?.[0]);
ok('and so does the top one', lit.includes(`rgba(${SCRIM_INK},0.200)`));
const unlit = renderHtml(
  { pillar: 'discover', layout: 'photoFull', headline: 'כותרת', place: 'ונציה' },
  { image: { src: 'data:image/jpeg;base64,x' } }
);
ok('an unmeasured card falls back to the constants', unlit.includes(`rgba(${SCRIM_INK},${SCRIM_FALLBACK.bottom.toFixed(3)})`));
// The scrim is NOT the ink. Over a photograph at 97% the ink's deliberate green
// cast stops being a ground and becomes a filter on every shadow in the picture.
ok('and the scrim is not the flat-card ink', SCRIM_INK !== '16,32,31');
ok('rather than to no scrim at all', unlit.includes('scrim-bottom'));

// TikTok draws a caption in white across the foot of the frame and a search bar
// across the top; Instagram draws neither. The band that protects those is a
// TikTok band, and applying it to the Instagram render darkened the bottom
// fifth of every slide for furniture that is not there.
const tikScrim = renderSlideHtml({ nameHe: 'x', fields: [] }, { size: 'tiktok', style: 'minimal' });
const igScrim = renderSlideHtml({ nameHe: 'x', fields: [] }, { size: 'instagram', style: 'minimal' });
ok('the TikTok slide darkens its foot for the caption bar', tikScrim.includes('rgba(4,10,12,0.42) 100%'));
ok('the Instagram slide does not', !igScrim.includes('rgba(4,10,12,0.42) 100%'));
ok('and takes only the edge off the sky', igScrim.includes('rgba(4,10,12,0.12) 100%'));
// An unknown size is a TikTok slide, which is the shape the deck is designed
// for — never an unscrimmed one.
ok('an unknown size keeps the TikTok scrim',
  renderSlideHtml({ nameHe: 'x', fields: [] }, { size: 'nonsense', style: 'minimal' }).includes('rgba(4,10,12,0.42) 100%'));

/* -------------------------------------------------------------------------- */
group('placement - measured off the photograph, not guessed at');

// White until the frame is genuinely pale. Strict contrast arithmetic flips to
// near-black above about 0.22 luminance, which is most skies, and near-black
// lettering on a mid grey-blue sky reads as a watermark.
ok('light type over a dark frame', photoTest.colourFor({ mean: 0.05, sat: 0.1 }, null).color === '#FFFFFF');
ok('light type still, over a mid-tone sky', photoTest.colourFor({ mean: 0.3, sat: 0.1 }, null).color === '#FFFFFF');
ok('dark type only once the frame is genuinely pale', photoTest.colourFor({ mean: 0.7, sat: 0.1 }, null).color === '#14110E');

// Judged on the worst BAND the block crosses, not on its average. A cover over
// bright sky at the top and dark rock at the bottom averages to a comfortable
// mid-tone, and its last line disappears into the mountain — which it did.
const split = photoTest.colourFor({ mean: 0.42, lo: 0.12, hi: 0.72, sat: 0.2 }, null);
ok('a block spanning sky and rock knows it is in trouble', split.contrast < 4.5);
ok('and calls for the wash', split.assist > 0);
// Cream is the same luminance as a bright sky, so the coloured phrase has to be
// refused there rather than set in something invisible.
eq('no cream accent across a band it cannot survive', split.accent, null);
ok('an evenly dark block still gets one', photoTest.colourFor({ mean: 0.12, lo: 0.1, hi: 0.15, sat: 0.3 }, null).accent !== null);
// Not pure black: a true #000 over a photograph reads as a hole punched in it.
ok('and it is not pure black', photoTest.colourFor({ mean: 0.9, sat: 0.1 }, null).color !== '#000000');

// The shadow is the first line of defence and it is invisible; the wash is the
// last and has to stay rare, or every slide grows a panel.
ok('a clean dark frame needs no help at all', photoTest.colourFor({ mean: 0.02, sat: 0.1 }, null).assist === 0);
ok('a frame with nothing left to give gets a wash', photoTest.colourFor({ mean: 0.42, sat: 0.1 }, null).assist > 0);
ok(
  'and the shadow works harder before the wash appears',
  photoTest.colourFor({ mean: 0.3, sat: 0.1 }, null).shadow > photoTest.colourFor({ mean: 0.02, sat: 0.1 }, null).shadow
);

// Tinting the accent with the photograph's own hue was the obvious idea and it
// is camouflage: a cover over a blue sky came back pale blue and read as white.
const blueish = photoTest.colourFor({ mean: 0.2, sat: 0.5 }, 210).accent;
ok('the accent is warm even over a cool photograph', blueish === '#F7E3A1');
ok('and steps aside when the photograph is itself yellow', photoTest.colourFor({ mean: 0.2, sat: 0.5 }, 45).accent !== '#F7E3A1');
ok('a pale frame gets no accent, having no contrast left to give', photoTest.colourFor({ mean: 0.8, sat: 0.5 }, 210).accent === null);

// Background, not smoothness.
//
// The rule is "the words go in the sky or on the water, never across the
// mountain". Four pixel heuristics were built for it and all four failed,
// because the shaded face of a mountain measures CALMER than the sky above it —
// smoothness and background are different properties. A region identified
// semantically is turned into a mask, and coverage of that mask outranks
// everything else in the score.
const skyBox = { x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.4 };
const skyMask = photoTest.maskFromBox(skyBox);
ok('a hinted region becomes a mask', Boolean(skyMask));
eq('a box inside it is fully covered', photoTest.coverage(skyMask, 0.2 * photoTest.GW, 0.25 * photoTest.GH, 0.8 * photoTest.GW, 0.35 * photoTest.GH), 1);
eq('a box outside it is not', photoTest.coverage(skyMask, 0.2 * photoTest.GW, 0.6 * photoTest.GH, 0.8 * photoTest.GW, 0.7 * photoTest.GH), 0);
ok('a box half in, half out lands between', (() => {
  const c = photoTest.coverage(skyMask, 0.2 * photoTest.GW, 0.35 * photoTest.GH, 0.8 * photoTest.GW, 0.45 * photoTest.GH);
  return c > 0.2 && c < 0.8;
})());
// A degenerate rectangle is a misunderstanding rather than an answer, and the
// pixel fallback beats honouring it.
eq('a zero-width region yields no mask', photoTest.maskFromBox({ x0: 0.5, y0: 0.2, x1: 0.5, y1: 0.4 }), null);

// TikTok draws its button rail over the right of the frame; text under it is
// text nobody reads. Instagram draws nothing, so the exclusion is not a
// constant in SIZES.
ok('a box under the button rail is penalised', photoTest.railOverlap(0.8, 0.6, 0.4, 0.2) > 0);
ok('one above it is not', photoTest.railOverlap(0.8, 0.2, 0.4, 0.1) === 0);
ok('nor one away to the left', photoTest.railOverlap(0.3, 0.6, 0.4, 0.2) === 0);

// Confinement — the measurement still runs, it just no longer gets to answer
// "the middle".
//
// This is the assertion the whole change rests on. The free search is a good
// answer to "put the words where the photograph is quietest" and the wrong
// answer to "put them in the upper-left or lower-left third": on a landscape
// the quietest region IS the middle of the sky, so left as it was it would
// keep choosing dead centre and the config would be decoration.
{
  // A frame that is uniformly calm everywhere, so nothing but the confinement
  // can decide where the block lands. Any bias in the scorer would show up as a
  // centre or right-hand answer.
  const flat = { lum: new Array(45 * 80).fill(0.08), sat: new Array(45 * 80).fill(0), hue: new Array(45 * 80).fill(0) };
  const ov = postConfig().overlay;
  const args = { topSafe: 300 / 1920, bottomSafe: 400 / 1920, blockH: 0.08, blockW: ov.width };

  const free = photoTest.place(flat, args);
  const held = photoTest.place(flat, {
    ...args,
    confine: { x: ov.x, width: ov.width, bands: [ov.bands.upper, ov.bands.lower] },
  });

  ok('unconfined, the search can land anywhere', free !== null);
  ok('confined, it still finds a spot', held !== null);
  eq('and the spot is in the configured column', held.cx, ov.x);
  ok('which is the left third of the frame', held.cx < 0.4);
  ok(
    'and in one of the two allowed bands',
    (held.cy >= ov.bands.upper[0] - 0.05 && held.cy <= ov.bands.upper[1] + 0.05) ||
      (held.cy >= ov.bands.lower[0] - 0.05 && held.cy <= ov.bands.lower[1] + 0.05),
    `cy=${held.cy}`
  );
  ok('never the middle of the frame', Math.abs(held.cy - 0.5) > 0.1);

  // A hint aims candidates at wherever the sky actually is, which is exactly
  // the freedom being withdrawn — and a hint candidate carries its own cx, so
  // honouring one would walk straight out of the allowed column.
  const hinted = photoTest.place(flat, {
    ...args,
    confine: { x: ov.x, width: ov.width, bands: [ov.bands.upper, ov.bands.lower] },
    hint: { x0: 0.6, y0: 0.44, x1: 0.98, y1: 0.56 },
  });
  eq('a hint cannot drag a confined block out of its column', hinted.cx, ov.x);
}

/* -------------------------------------------------------------------------- */
group('post-config - the caption, the tags, and where the account leans');

// The whole reason this file exists: every one of these was a literal in a
// module, and every one of them is a decision that gets revisited after looking
// at a week of numbers.

const pcfg = postConfig();

// The caption pool, and above all not a template: one opening line across
// twenty posts IS a template, and the template is what the old signature was.
//
// "Short, emotional, asking for nothing" was the rule and the pool obeyed it:
// `נראה כמו ציור`, `הנוף עוצר נשימה`. Every one was a reaction to the picture,
// which is the one thing the viewer already had, faster, from the picture. The
// pool now names who the post is for or what it is worth keeping for, which is
// what a first line can buy that an admiring adjective cannot.
ok('there is a pool, not a line', pcfg.caption.lines.length >= 10);

// EIGHT WORDS, NOT SIX. The ceiling moved with the job: six is the length of a
// fragment, and a line that names an audience ("למי שיש כמה ימים ולא יודע לאן")
// is a clause and cannot be one. Eight is still far inside the ~125 characters
// Instagram shows before "more", which is the only hard limit there is.
ok(
  'every line is short enough to read before the picture does',
  pcfg.caption.lines.every((l) => l.split(/\s+/).length <= 8),
  pcfg.caption.lines.find((l) => l.split(/\s+/).length > 8)
);
ok('and none of them carries a URL', pcfg.caption.lines.every((l) => !URL_LIKE.test(l)));
ok('nor the brand name', pcfg.caption.lines.every((l) => !l.includes('טיול+') && !l.includes('tiyulplus')));

// AND NONE OF THEM CLAIMS A FACT.
//
// The angle rules apply to a caption exactly as they apply to a slide: the
// pipeline does not know that a flight is four hours, that anywhere is kosher,
// or what a trip costs in shekels, and an opening line is the easiest place in
// the whole project for one of those to be typed in by hand and never checked.
// Framing is ours to write; facts are not.
{
  const claims = /(\d+\s*(שעות|שעה|ש״ח|₪|שקל)|טיסה ישירה|כשר|ללא ויזה|בלי ויזה)/;
  ok(
    'no opening line states something nothing sourced',
    pcfg.caption.lines.every((l) => !claims.test(l)),
    pcfg.caption.lines.find((l) => claims.test(l))
  );
}

// Randomness is the point of a pool. Drawn from a fixed sequence rather than
// from Math.random, because a test that samples a real random source either
// flakes or proves nothing.
{
  const seen = new Set();
  for (let i = 0; i < pcfg.caption.lines.length; i++) {
    let k = 0;
    seen.add(captionHook({ rand: () => (i + k++) / pcfg.caption.lines.length }));
  }
  ok('the pool is actually drawn from', seen.size === pcfg.caption.lines.length);
  eq('the first draw is the first line', captionHook({ rand: () => 0 }), pcfg.caption.lines[0]);
  eq('and a draw at the top of the range stays in bounds', typeof captionHook({ rand: () => 0.999999 }), 'string');
}

// The URL guard. Broader than a URL parser on purpose: what gets a post demoted
// is a domain a human can retype, and "tiyulplus.com" with no scheme and no www
// is the same signal as a well-formed link.
for (const bad of ['http://x.io', 'https://x.io', 'www.tiyulplus.com', 'tiyulplus.com', 'קישור: ynet.co.il']) {
  ok(`rejected: ${bad}`, URL_LIKE.test(bad));
}
for (const good of ['מקומות שנראים לא אמיתיים', '5.3 ק״מ', '#טיולים #fyp', 'יעד לרשימה']) {
  ok(`allowed: ${good}`, !URL_LIKE.test(good));
}
// And it throws rather than stripping. A caption assembled from a pool with a
// domain in it is a configuration error; silently repairing it would leave
// post-config.json broken and every future post quietly fixed.
ok(
  'a caption with a URL never becomes something you can approve',
  (() => {
    try {
      assertNoUrl('בואו ל www.tiyulplus.com');
      return false;
    } catch {
      return true;
    }
  })()
);
eq('a clean caption passes through untouched', assertNoUrl('יעד לרשימה'), 'יעד לרשימה');

// Five tags, and EXACTLY five whether or not the deck's country resolved. The
// destination tag replaces a niche draw rather than being appended to it —
// otherwise the count moves for a reason that has nothing to do with the thing
// being tested.
{
  const withCountry = { category: 'museum', slides: [{ iso: 'PT' }, { iso: 'PT' }] };
  const noCountry = { category: 'museum', slides: [{ iso: 'PT' }, { iso: 'JP' }, { iso: 'BR' }] };
  const n = pcfg.hashtags.broadCount + pcfg.hashtags.nicheCount;

  eq('five tags on a deck with a country', hashtagsFor(withCountry).length, n);
  eq('and five on a deck without one', hashtagsFor(noCountry).length, n);
  eq('the destination tag is the country, in Hebrew', destinationTag(withCountry), '#פורטוגל');
  eq('a deck spanning three countries has no country tag', destinationTag(noCountry), null);
  ok('the destination tag is on the post', hashtagsFor(withCountry).includes('#פורטוגל'));

  const tags = hashtagsFor(withCountry);
  eq('no tag appears twice', new Set(tags).size, tags.length);
  ok('every tag is a tag', tags.every((t) => /^#\S+$/.test(t)));
  eq(
    'broad tags lead, because the first line is what gets read',
    tags.slice(0, pcfg.hashtags.broadCount).filter((t) => pcfg.hashtags.broad.includes(t)).length,
    pcfg.hashtags.broadCount
  );

  // A country read off the SLIDES, not off deck.where. `where` is the English
  // string the map was searched with, and the Hebrew country name does not
  // survive the build: applyCountryVisibility strips it from every slide once
  // they all agree on one, which is the common case.
  eq(
    'a Czech deck is filed under Czechia even after the name was stripped',
    destinationTag({ where: 'Prague', category: 'museum', slides: [{ iso: 'CZ', countryHe: null }] }),
    '#צ׳כיה'
  );
  eq('a deck with no slides at all has no tag', destinationTag({ slides: [] }), null);
}

// Destination weighting. What it buys, given that the climate rotation caps a
// destination at one post a year, is ORDER — the places this audience books
// flights to get posted early and the cold ones get what is left.
{
  const dests = JSON.parse(readFileSync(new URL('../destinations.json', import.meta.url), 'utf8')).destinations;
  const ordered = byWeight(dests);
  const favoured = ['יוון', 'קפריסין', 'גאורגיה', 'איטליה', 'תאילנד', 'יפן', 'פורטוגל', 'ספרד', 'וייטנאם', 'צ׳כיה'];

  ok('every favoured country is actually in the catalogue', favoured.every((c) => dests.some((d) => d.country === c)));
  ok('Greece outranks Iceland', destinationWeight({ country: 'יוון' }) > destinationWeight({ country: 'איסלנד' }));
  ok('and Cyprus outranks Canada', destinationWeight({ country: 'קפריסין' }) > destinationWeight({ country: 'קנדה' }));
  ok('an unlisted country is not banned, only unpromoted', destinationWeight({ country: 'קנדה' }) > 0);

  ok('the first ten are all favoured', ordered.slice(0, 10).every((d) => favoured.includes(d.country)));
  ok('nothing is dropped', ordered.length === dests.length);
  // Stable, which is what lets the climate adapter keep its day-of-year
  // rotation INSIDE each weight tier — the thing that stops the same Greek
  // island coming up every morning.
  const greek = ordered.filter((d) => d.country === 'יוון').map((d) => d.id);
  eq('ties keep their incoming order', greek.join(','), dests.filter((d) => d.country === 'יוון').map((d) => d.id).join(','));
}

// The overlay, as numbers. The rendered result is asserted in the deck slide
// group; this is the contract those assertions read from.
{
  const ov = pcfg.overlay;
  // A band rather than a number, and the band is wide on purpose.
  //
  // This asserted 26-36px, which is the reading of the brief that shipped names
  // nobody could read on a busy street photograph. The honest constraint is not
  // a target size at all — it is that the type stays in caption territory and
  // out of poster territory. Roughly 2.5% to 5% of the frame's short edge; the
  // reference accounts sit at the bottom of that and a headline would blow
  // through the top of it.
  const px = Math.round((ov.sizeBasis === 'height' ? 1920 : 1080) * ov.sizePct);
  ok('the type is a caption, not a headline', px >= 27 && px <= 54, `${px}px`);
  ok('and legible without the adaptive boost having to save it', px >= 40, `${px}px`);
  ok('it is lighter than a semibold', ov.weight <= 500);
  ok('and held below full opacity', ov.opacity > 0.7 && ov.opacity < 1);
  eq('two lines and no more', ov.maxLines, 2);
  ok('the column is in the left third', ov.x < 0.4);
  ok('and the block cannot reach across the middle', ov.x + ov.width / 2 <= 0.56);
  ok('neither band is the middle of the frame', ov.bands.upper[1] < 0.45 && ov.bands.lower[0] > 0.55);
}

/* -------------------------------------------------------------------------- */
group('clips - participant or spectator, judged from the title');

// The owner's own verdicts, used as the fixture.
//
// These are not invented examples. They are the six clips picked by eye out of
// a 959-clip gallery and the three rejected by name, and the first version of
// this filter got EVERY ONE of them wrong way round: the rejects scored 5-6 and
// the keeps scored 2-4, because `prefer` rewarded the subject (forest, trail,
// mountain, dog) and could not see the camera. A filter is only worth having if
// it agrees with the person it is standing in for, so that agreement is the
// test.
{
  const { tasteScore } = await import('../src/video/pexels.js');
  const min = postConfig().clips.search.minScore;
  const keeps = (t) => tasteScore(t) !== null && tasteScore(t) >= min;

  for (const t of [
    'pov bike ride on forest trail in summer',
    'scenic hike behind a majestic waterfall',
    'hiking adventure on rocky mountain trail',
    'walking through autumn leaves in a forest',
    'dog exploring a tranquil forest creek',
    'serene forest walk at sunrise',
  ]) {
    ok(`keeps: ${t}`, keeps(t), `scored ${tasteScore(t)}, needs ${min}`);
  }

  // The three rejected by name are vetoed outright rather than merely
  // outscored — bikini, shoreline and "beach at sunset" are on the reject list,
  // and a veto cannot be argued back by any number of forest words.
  for (const t of [
    'serene woman walking along ocean shoreline',
    'a woman walking on the beach at sunset',
    'young african american woman walking on the beach in bikini',
  ]) {
    eq(`vetoed outright: ${t.slice(0, 34)}…`, tasteScore(t), null);
  }

  // And the two that actually shipped in the first batch, which is how the
  // fault was found. Both are third-person shots of somebody on a trail.
  // Ranked BELOW the participant shots rather than dropped outright.
  //
  // Title scoring is a pre-filter now, not the decision — src/video/vision.js
  // judges the actual thumbnail, because a title is a string an uploader typed
  // and it turned out to be a poor proxy for anything. What the words still
  // have to do is order the queue and enforce the vetoes, so a spectator shot
  // must never outrank a participant one.
  // Wrapped, not passed by reference: tasteScore's second parameter is the
  // config, and .map hands a callback the index as its second argument.
  const floor = Math.min(
    ...['pov bike ride on forest trail in summer', 'scenic hike behind a majestic waterfall'].map((t) => tasteScore(t))
  );
  for (const t of [
    'woman walking in autumn forest pathway',
    'hiker walking mountain trail with dog',
    'photographer walking on scenic boardwalk',
    'couple walking in the mountains',
  ]) {
    ok(`ranks below every keeper: ${t}`, tasteScore(t) < floor, `scored ${tasteScore(t)}, keepers floor ${floor}`);
  }

  // Whole words for the spectator list, prefixes for prefer. "hiker" is a
  // person being filmed, "hiking" is the activity, and the prefix matching that
  // `prefer` needs cannot separate them — which is the pair that got through.
  ok('"hiking" is an activity, not a person', tasteScore('hiking a forest trail') > 0);
  ok('"hiker" is a person', tasteScore('hiker on a forest trail') < tasteScore('hiking a forest trail'));

  // ...but an explicit point-of-view marker means the camera IS the person, so
  // it has to be able to outrun one penalty.
  ok('pov rescues a named person', keeps('pov hiker on a mountain ridge trail'));

  // Overlapping stems counted once. "hiking" matches both the "hike" and
  // "hiking" entries in prefer, and counting per term scored it twice for one
  // word — which is why the threshold could not be tuned.
  eq('one word scores once', tasteScore('hiking'), tasteScore('hike'));

  // The vision gate, which is the actual filter.
  //
  // `destination` is a gate and not a term in a sum, and that is the whole
  // lesson of the batch that shipped four bike videos on anonymous roads: a
  // beautifully composed POV of nowhere is still nowhere. Folding it into a
  // weighted score would let the POV bonus buy a road back in, which is
  // precisely how the old title filter failed.
  const { rankVision } = await import('../src/video/vision.js');
  const vcfg = postConfig().clips.search;
  const V = (o) => ({
    destination: 8, pov: false, aerial: false, staged: false, personSubject: false, urban: false, subject: '', ...o,
  });

  eq('nowhere is rejected however good the camera', rankVision(V({ destination: 3, pov: true }), vcfg), null);
  eq('a staged shoot is rejected', rankVision(V({ staged: true }), vcfg), null);

  // A person standing in front of the view, which the owner prohibits by name.
  //
  // The clip that caused this rule was not staged — nobody was posing, nothing
  // was being sold, and `staged` therefore came back false while the frame was
  // a stranger with a landscape behind them. So it is its own field and its own
  // veto, and unlike an aerial no destination score buys it back: a drone shot
  // is the right subject from the wrong height, this is the wrong subject.
  eq('a person filmed in front of the place is rejected', rankVision(V({ personSubject: true }), vcfg), null);
  eq(
    'and the best destination in the world does not buy it back',
    rankVision(V({ destination: 10, personSubject: true, pov: true }), vcfg),
    null
  );
  ok('the rule is on', postConfig().clips.search.rejectPersonSubject === true);
  ok(
    'and a config that forgot the key still refuses',
    rankVision(V({ personSubject: true }), { ...vcfg, rejectPersonSubject: undefined }) === null
  );

  // The carve-out that keeps this from eating the format. POV footage always
  // has a body edge in it — hands, feet, handlebars — and preferPov says this
  // account wants POV. A participant camera is not a person being filmed.
  ok('a POV body edge is not a person in front of the camera', rankVision(V({ pov: true }), vcfg) > 0);
  ok('a real destination passes', rankVision(V({}), vcfg) > 0);
  ok(
    'POV breaks a tie between two real places',
    rankVision(V({ pov: true }), vcfg) > rankVision(V({ pov: false }), vcfg)
  );
  ok(
    'but POV cannot rescue nowhere',
    rankVision(V({ destination: vcfg.visionMinDestination - 1, pov: true }), vcfg) === null
  );
  ok(
    'an aerial of a real place still ranks, just lower',
    rankVision(V({ aerial: true })) < rankVision(V({})) && rankVision(V({ aerial: true })) !== null
  );

  // A drone shot is priced out rather than banned, and the price is the whole
  // point — a /clip batch shipped one when aerial cost 1, which a destination
  // score of 9 pays without noticing. BRIEF.md files "another stock landscape"
  // under Never and an aerial is the purest form of it.
  //
  // The two facts that have to hold together: the best possible drone shot
  // loses to the worst clip that cleared the gate on the ground, so an aerial
  // is only ever built when the ground returned nothing at all — and it is
  // still buildable then, which is what separates this from rejectAerialOnly.
  ok(
    'the best drone shot loses to the weakest clip shot on the ground',
    rankVision(V({ destination: 10, aerial: true }), vcfg) <
      rankVision(V({ destination: vcfg.visionMinDestination }), vcfg)
  );
  ok(
    'but it is still ranked, so it can carry a day the ground could not',
    rankVision(V({ destination: 10, aerial: true }), vcfg) !== null
  );
  eq('an unjudged clip never publishes', rankVision(null, vcfg), null);
}

/* -------------------------------------------------------------------------- */
group('clip look - the owner settled these by eye, one render at a time');

// Every assertion here is a decision that cost a round of screenshots. They are
// locked so the next change to this pipeline cannot quietly undo one, and so
// nobody has to re-litigate them clip by clip.
{
  const ov = postConfig().clips.overlay;

  // One colour, and it is the one that was asked for. The palette held white
  // for a while and drew it on a third of posts; white was rejected on sight
  // twice before anyone noticed it was still in the pool.
  eq('exactly one ink colour', ov.colors.length, 1);
  eq('and it is the chosen yellow', ov.colors[0].fill.toUpperCase(), '#FFF4B3');

  // No stroke. It went in because TikTok's own text tool produces one and the
  // Hebrew reference posts use it; at this size over these frames it read as an
  // outline rather than as native text.
  eq('no stroke', ov.strokePct, 0);
  eq('and none is added back under pressure', ov.strokeBoost, 0);

  // Narrow, so a line WRAPS. This is the one that matters most: at 0.72 a block
  // is 777px on a 1080px frame, and on a picture whose subject stands in the
  // middle no position fits it on clean sky — so the search picks the least-bad
  // straddle and the line runs from sky onto rock. Two short rows on clean
  // background beat one long row across the subject.
  ok('the block is narrow enough to force a wrap', ov.width <= 0.5, `${ov.width}`);
  eq('two rows, never three', ov.maxLines, 2);

  // Not pinned to the centre. Pinning it there put text on a cliff while clear
  // sky sat unused either side.
  ok('several columns are offered', ov.xs.length >= 3, ov.xs.join(','));
  ok('including a left and a right one', Math.min(...ov.xs) < 0.35 && Math.max(...ov.xs) > 0.65);

  // Upper area only, and neither band sits where a horizon usually falls.
  ok('both bands are in the upper half', ov.bands.upper[1] < 0.5 && ov.bands.mid[1] < 0.5);

  // The flip to dark type is a deck rule — small, light, unstroked caption with
  // nothing else to survive on. A 52px clip line has a shadow and a wash, so the
  // threshold sits high and the yellow survives a blue sky.
  ok('the ink does not flip to dark on an ordinary sky', ov.flipToDarkAbove >= 0.55);
}

// The frame clamp. A latent bug that only became reachable once the search was
// allowed to pick an off-centre column: a 0.72-wide block centred at x=0.72
// ends at 1166px on a 1080px frame, and the first words of the line are simply
// not in the video. deckTemplates.js has clamped this since it was written.
{
  const { overlayHtml } = await import('../src/video/overlay.js');
  const W = 1080;
  const far = { x: 0.72, y: 0.27, width: 0.9, color: '#FFF4B3', onDark: true, assist: 0, shadow: 0, lum: 0.2 };
  const html = overlayHtml('תזכורת שיש מסלולים כאלה בעולם', { width: W, height: 1920, spot: far, id: 'x' });
  const left = Number(html.match(/\.hook \{[^}]*left:(-?\d+)px/s)?.[1]);
  const wide = Number(html.match(/\.hook \{[^}]*width:(\d+)px/s)?.[1]);
  ok('the block starts inside the frame', left >= 0, `left=${left}`);
  ok('and ends inside it', left + wide <= W, `right=${left + wide} of ${W}`);
  ok('it was narrowed rather than cropped', wide <= W, `width=${wide}`);
}

/* -------------------------------------------------------------------------- */
group('clip candidate - the fields the publish path reads');

{
  const { targetsForKind, allowedForKind } = await import('../src/publish/targets.js');

  // A clip is PUBLISHED to TikTok alone, and belongs on Instagram anyway.
  //
  // Both halves matter and they are separate assertions on purpose.
  //
  // The editorial rule is unchanged: a clip should reach Instagram, because
  // every other Instagram post this account makes is a photograph or a carousel
  // and those are the formats with the least reach to non-followers. What
  // changed is that this program cannot deliver it. The owner picks the sound
  // in each app by hand; TikTok supports that through MEDIA_UPLOAD, and
  // Instagram's Content Publishing API has no draft state, no scheduling and no
  // hand-off, so its only options are "publish now" or "do not call". A reel's
  // audio cannot be changed after posting, so publishing now means publishing
  // silent for ever.
  const { manualForKind } = await import('../src/publish/targets.js');
  eq('a clip publishes to TikTok alone', allowedForKind('clip').join(','), 'tiktok');
  eq('and Instagram is still where it belongs, by hand', manualForKind('clip').join(','), 'instagram');

  // A hand-off is NOT a publish target. Nothing calls it, nothing can fail on
  // it, and nothing records it as published; adding it to one is how a copy
  // nobody made gets logged as a post.
  ok('a manual destination never appears in the publish list',
    manualForKind('clip').every((t) => !allowedForKind('clip').includes(t)));
  eq('nothing else has one', manualForKind('deck').length + manualForKind('card').length, 0);

  // targetsForKind filters by what is CONFIGURED, so this is empty on a box
  // with no credentials. That is the correct answer and the publish path holds
  // rather than failing, but the editorial rule above must hold regardless of
  // what happens to be configured.
  ok('the rule does not depend on configuration', allowedForKind('clip').length === 1);
  ok('targetsForKind is a subset of what is allowed',
    targetsForKind('clip').every((t) => allowedForKind('clip').includes(t)));
}

/* -------------------------------------------------------------------------- */
group('the Israeli angle - moved out of shoot, and what it may not become');

{
  const { angles, pickAngle, anglePrompt } = await import('../src/angles.js');
  const cfg = postConfig();

  // It used to live under `shoot` and reach exactly one kind of post: the one
  // the bot cannot make. Both keys now read the same list, so a reader here and
  // a reader there cannot drift apart.
  ok('there is a pool', angles().length >= 6);
  eq('the top-level key and shoot.angles are the same list', cfg.angles, cfg.shoot.angles);
  ok('and the shoot did not lose its own', cfg.shoot.angles.length > 0);

  // Recently used angles are excluded outright rather than weighted down: the
  // pool is a dozen long and the window is five, so exclusion always leaves
  // something, and "kosher food" twice in a week is what a viewer notices.
  {
    const recent = angles().slice(0, 5).map((a) => ({ angle: a }));
    const drawn = new Set();
    for (let i = 0; i < 40; i++) drawn.add(pickAngle(recent, { rand: () => i / 40 }));
    ok('nothing from the recent window comes back', recent.every((r) => !drawn.has(r.angle)),
      [...drawn].find((d) => recent.some((r) => r.angle === d)));
    ok('and something does', drawn.size > 1);
  }

  // A history with no angles on it is the normal case for every kind that has
  // never recorded one, and it must not empty the pool.
  ok('a history of postless rows still yields an angle', Boolean(pickAngle([{}, {}, {}])));
  ok('so does an empty one', Boolean(pickAngle([])));

  // THE WARNING IS THE LOAD-BEARING HALF.
  //
  // On a shoot the angle is the content: you are the source and you know whether
  // the flight is direct. Nothing automated knows any of that, so on a deck the
  // angle steers WHICH destination and never becomes a line on a slide. A model
  // handed "kosher food" and no warning will helpfully write that a place is
  // kosher, which is a fabricated claim of exactly the kind an Israeli traveller
  // is most likely to act on.
  {
    const p = anglePrompt('אוכל כשר, ומה עושים כשאין');
    ok('the prompt names the angle', p.includes('אוכל כשר'));
    ok('and says it chooses the destination, not the words', /קובעת איזה יעד/.test(p));
    ok('and forbids printing it on a slide', /אל תדפיס/.test(p));
    ok('and names the specific claims it must not invent', /טיסה ישירה/.test(p) && /ויזה/.test(p));
    eq('no angle means no paragraph at all', anglePrompt(null), null);
  }
}

/* -------------------------------------------------------------------------- */
group('the music bed - a reel cannot be given a sound after it is posted');

{
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const t = await import('../src/video/tracks.js');
  const { audioLine } = await import('../src/video/clip.js');

  const dir = mkdtempSync(join(tmpdir(), 'tiyul-audio-'));
  const saved = process.env.AUDIO_DIR;
  process.env.AUDIO_DIR = dir;

  const manifest = (tracks) => {
    writeFileSync(join(dir, 'tracks.json'), JSON.stringify({ tracks }));
    t.forgetTracks();
  };
  const declared = (over = {}) => ({
    file: 'bed.mp3', title: 'A Bed', credit: 'Somebody', licence: 'CC0', source: 'https://example.invalid/x', ...over,
  });
  writeFileSync(join(dir, 'bed.mp3'), 'not really an mp3, but it exists');
  writeFileSync(join(dir, 'stray.mp3'), 'a file nobody declared');

  // THE MANIFEST IS THE ALLOWLIST, NOT THE DIRECTORY.
  //
  // The one thing that can go badly wrong with a music bed is publishing
  // something we do not have the right to publish, and "whatever is in the
  // folder" is exactly the rule that lets a file somebody dropped in to listen
  // to become the soundtrack of a post. Same argument imageHosts.js makes about
  // verified domains: a check derived from what is present agrees with every
  // mistake it was written to catch.
  manifest([declared()]);
  eq('only declared tracks are tracks', t.tracks().length, 1);
  ok('a file in the folder that nobody declared is not one',
    !t.tracks().some((x) => x.name === 'stray.mp3'));
  ok('and audio counts as configured', t.audioConfigured());

  // Each of these is somebody meaning to do something and not finishing, and
  // the cost of guessing is a post carrying music whose terms nobody can state.
  for (const field of ['title', 'credit', 'licence', 'source']) {
    manifest([declared({ [field]: '' })]);
    let threw = null;
    try { t.tracks(); } catch (e) { threw = e.message; }
    ok(`a track with no ${field} is refused by name`, threw?.includes('bed.mp3') && threw?.includes(field), threw);
  }

  // Declared and absent throws too. Skipping it silently would leave a silent
  // post, which is indistinguishable from the bug this exists to fix.
  manifest([declared({ file: 'missing.mp3' })]);
  {
    let threw = null;
    try { t.tracks(); } catch (e) { threw = e.message; }
    ok('a declared track that is not on disk is refused', threw?.includes('missing.mp3'), threw);
  }

  // NO MANIFEST IS NOT AN ERROR. It is where this project starts: the repo
  // ships no audio, clips render silent exactly as before, and bot.js says so
  // at boot rather than letting it be discovered after publishing.
  rmSync(join(dir, 'tracks.json'));
  t.forgetTracks();
  eq('no manifest means no tracks', t.tracks().length, 0);
  ok('and audio is not configured', !t.audioConfigured());
  eq('picking from nothing gives nothing, rather than throwing', t.pickTrack(), null);

  // Exclusion, not weighting: with a handful of tracks the thing a viewer
  // notices is the same bed twice running, and a weight permits exactly that.
  manifest([declared(), declared({ file: 'bed.mp3', title: 'Two' })]);
  writeFileSync(join(dir, 'bed.mp3'), 'x');
  {
    const all = t.tracks();
    const used = new Set([all[0].name]);
    // Both entries point at the same filename here, so "everything is used" is
    // the fallback case: a repeat beats publishing silence to avoid one.
    ok('a fully-spent pool still returns something', Boolean(t.pickTrack(used)));
  }

  // The offset exists because eight seconds from the top of the same file is
  // the most automated-sounding thing a feed can do. Derived from the id so a
  // re-render sounds the same and this can be asserted at all.
  eq('the same clip always starts in the same place', t.trackOffset('abc', 45), t.trackOffset('abc', 45));
  ok('different clips do not', t.trackOffset('abc', 45) !== t.trackOffset('zzz', 45));
  ok('and it stays inside the bound', t.trackOffset('anything', 45) < 45);
  eq('a zero bound means start at the beginning', t.trackOffset('abc', 0), 0);

  // THE CARD SAYS SO EITHER WAY, because a silent file and a sounded one are
  // indistinguishable in a Telegram video preview unless the volume is up, and
  // which one it is changes what you do next.
  ok('a sounded clip names the track and its licence',
    audioLine({ clip: { audio: { title: 'A Bed', credit: 'Somebody', licence: 'CC0', offset: 12 } } }).includes('CC0'));

  // NO TRACK IS NOT A WARNING ANY MORE, and that is a real change rather than a
  // softened string. It read "⚠️ אין פסקול - יעלה אילם לרילס", which was true
  // while a clip published to Instagram unattended: a reel's audio is fixed at
  // upload, so a silent file meant a permanently silent post. Nothing publishes
  // a reel now, so silence is the plan, and a warning against the intended
  // workflow is what teaches somebody to skim the card.
  ok('a silent clip says where its sound comes from', /באפליקציה/.test(audioLine({ clip: {} })));
  ok('and does not warn about the normal case', !audioLine({ clip: {} }).includes('⚠️'));

  // The mix itself is config, and the ceiling exists so a typo of 35 for 0.35
  // cannot ship a clip that clips. Asserted whatever `on` says, because the
  // numbers have to still be right on the day it is switched back on.
  const acfg = postConfig().clips.audio;
  ok('the bed sits under the line rather than over it', acfg.volume > 0 && acfg.volume <= 1, `volume=${acfg.volume}`);
  ok('it fades out, so an eight-second loop does not click', acfg.fadeOutSeconds > 0);
  // Off by default: the sound is chosen by hand in each app, and a bed under a
  // track added in the Instagram app MIXES with it rather than being replaced.
  ok('and it is off, because the sound is chosen in the app', acfg.on === false);

  if (saved === undefined) delete process.env.AUDIO_DIR;
  else process.env.AUDIO_DIR = saved;
  t.forgetTracks();
  rmSync(dir, { recursive: true, force: true });
}

/* -------------------------------------------------------------------------- */
group('cuts - the second clip shape, where every line change is a cut');

{
  const { pickCuts, oneCountry, cutLabel, beatCountMismatch } = await import('../src/video/cuts.js');
  const { clipPexelsIds, clipPexelsId } = await import('../src/store.js');
  const cfg = postConfig().clips.cuts;

  // A shot the vision judge could place, in the form findClips returns.
  const shot = (id, place, site) => ({
    id: String(id),
    title: `shot ${id}`,
    vision: { place, site: site || '', siteHe: '', placeConfidence: 10 },
  });

  eq('a shot is labelled with its place', cutLabel(shot(1, 'Switzerland')), 'שווייץ');
  eq('an unplaceable shot has no label', cutLabel(shot(2, null)), null);

  // Rule 1: a shot with no name cannot be in a list of places. The viewer
  // counting against the hook's number will not count it.
  const withBlank = [shot(1, 'Switzerland'), shot(2, null), shot(3, 'Iceland'), shot(4, 'Italy'), shot(5, 'Japan')];
  const picked = pickCuts(withBlank, cfg);
  ok('an unnamed shot is left out', !picked.some((c) => c.id === '2'));
  eq('and the rest are taken in rank order', picked.map((c) => c.id).join(','), '1,3,4,5');

  // Rule 2, and it is the one a count guard cannot see: four shots of four
  // corners of Switzerland all label "שווייץ", so the hook's number matches and
  // the post is still a list of one place four times.
  const sameCountry = [
    shot(1, 'Switzerland'),
    shot(2, 'Switzerland'),
    shot(3, 'Switzerland'),
    shot(4, 'Switzerland'),
  ];
  eq('four shots of one unnamed country are not a list', pickCuts(sameCountry, cfg).length, 0);

  // ...unless the judge named the SITE, which is what makes them four places.
  const sites = [
    shot(1, 'Switzerland', 'Lauterbrunnen'),
    shot(2, 'Switzerland', 'Zermatt'),
    shot(3, 'Switzerland', 'Grindelwald'),
    shot(4, 'Switzerland', 'Interlaken'),
  ];
  eq('four named sites in one country are', pickCuts(sites, cfg).length, 4);
  eq('and the hook may name that country', oneCountry(pickCuts(sites, cfg)), 'שווייץ');
  eq('a mixed list names none', oneCountry(picked), null);

  ok('too few shots build nothing', pickCuts([shot(1, 'Italy'), shot(2, 'Japan')], cfg).length === 0);
  ok('and never more than the ceiling', pickCuts(
    ['Italy', 'Japan', 'Iceland', 'Peru', 'Norway', 'Greece'].map((p, i) => shot(i + 1, p)),
    cfg
  ).length <= cfg.cutsMax);

  // THE RULE THAT CANNOT BE WAIVED. A hook promising five places over four cuts
  // breaks its promise in the last two seconds, which BRIEF.md identifies as
  // worse than a dull hook and is what cost the beats their first outing.
  const four = [1, 2, 3, 4];
  eq('a hook that counts right passes', beatCountMismatch('4 מקומות שלא נראים אמיתיים', four), null);
  ok('one that over-promises does not', beatCountMismatch('5 מקומות שלא נראים אמיתיים', four));
  ok('nor does one that under-promises', beatCountMismatch('3 מקומות שלא נראים אמיתיים', four));
  // A number that is not a count is not a promise. Reading every digit as one is
  // the false positive that made promisesList an allowlist.
  eq('a hook with no leading number is not counted', beatCountMismatch('מקומות שלא נראים אמיתיים', four), null);

  // THE FOOTAGE LEDGER. A cuts clip spends four or five shots, and recording
  // one of them would quietly re-offer the other four on the next batch, the
  // repeat the ledger exists to stop, through the shape that spends the most.
  const cutsCand = {
    kind: 'clip',
    id: 'abc123def456',
    clip: { shape: 'cuts', cuts: [{ pexelsId: '11' }, { pexelsId: '22' }, { pexelsId: '33' }, { pexelsId: '44' }] },
  };
  eq('every shot of a cuts clip is spent', clipPexelsIds(cutsCand).join(','), '11,22,33,44');
  eq('and the singular field still answers with the first', clipPexelsId(cutsCand), '11');
  eq('a held clip still spends one', clipPexelsIds({ kind: 'clip', clip: { pexelsId: '99' } }).join(','), '99');
  // Clips built before clip.pexelsId existed used the Pexels id AS the
  // candidate id, and three of them are in staging.
  eq('and a legacy clip still resolves', clipPexelsIds({ kind: 'clip', id: '35714980' }).join(','), '35714980');
  eq('a card spends nothing', clipPexelsIds({ kind: 'card', id: '123' }).length, 0);

  // THE PIN AND THE COUNTRY TAG on a shape that has several of both.
  //
  // Both read clip.vision and both turn it into a published claim, so handing
  // either the first shot's reading labels the whole post with one of its four
  // places. The country survives only when every shot shares it; the site never
  // does, because one named place out of four is the same error smaller.
  const { clipPlaceLine, clipDestinationTag } = await import('../src/hashtags.js');
  const swiss = { clip: { shape: 'cuts', vision: { place: 'Switzerland', site: '', siteHe: '' } } };
  eq('a one-country cut pins the country', clipPlaceLine(swiss), '📍 שווייץ');
  eq('and tags it', clipDestinationTag(swiss), '#שווייץ');
  const mixed = { clip: { shape: 'cuts', vision: null } };
  eq('a cut spanning countries pins nothing', clipPlaceLine(mixed), null);
  eq('and spends no tag slot on a country', clipDestinationTag(mixed), null);
}

/* -------------------------------------------------------------------------- */
group('clip description - a published post with an empty caption is invisible');

{
  const { clipHashtags, clipDestinationTag } = await import('../src/hashtags.js');
  const cfg = postConfig().hashtags;
  const n = cfg.broadCount + cfg.nicheCount;

  // buildClip never set tiktokCaption, and publishTikTok reads exactly that
  // field for post_info.description — so every clip would have published with
  // no description and no tags at all. Nothing would have failed; the post
  // would simply have had no way of being found.
  const known = { clip: { vision: { place: 'Italy' } } };
  const unknown = { clip: { vision: { place: '' } } };

  eq('five tags on a clip whose country is known', clipHashtags(known).length, n);
  eq('and five when it is not', clipHashtags(unknown).length, n);
  eq('the country tag is the Hebrew spelling', clipDestinationTag(known), '#איטליה');
  eq('an unidentified frame gets no country tag', clipDestinationTag(unknown), null);
  ok('the country tag is on the post', clipHashtags(known).includes('#איטליה'));

  const tags = clipHashtags(known);
  eq('no tag twice', new Set(tags).size, tags.length);
  ok('every tag is a tag', tags.every((t) => /^#\S+$/.test(t)));
  ok(
    'broad tags lead',
    tags.slice(0, cfg.broadCount).every((t) => cfg.broad.includes(t)),
    tags.join(' ')
  );

  // A clip's country comes from the vision judge, not from Wikidata, and is
  // only present when it cleared placeMinConfidence. Tagging #יוון on footage
  // that might be Croatia is the fabrication this pipeline exists to refuse.
  eq('a country with no Hebrew spelling is dropped', clipDestinationTag({ clip: { vision: { place: 'Narnia' } } }), null);

  // The pin line: 📍 site, country — or the country alone, or nothing.
  const { clipPlaceLine, clipCaption, clipSiteName } = await import('../src/hashtags.js');
  const pin = (v) => clipPlaceLine({ clip: { vision: v } });

  eq('site and country', pin({ place: 'Switzerland', site: 'Lauterbrunnen' }), '📍 לאוטרברונן, שווייץ');
  eq('country alone when the site is unknown', pin({ place: 'Italy', site: '' }), '📍 איטליה');
  eq('nothing at all when the country is unknown', pin({ place: '', site: 'Somewhere' }), null);

  // EVERY word of the description is Hebrew, including the names that are
  // awkward to write. One Latin word in the middle of a Hebrew line reads as a
  // machine filling in a field, which is the impression this account cannot
  // afford — so a site with no Hebrew spelling available is dropped rather
  // than printed in Latin as a fallback.
  ok('no Latin survives in the pin', !/[A-Za-z]/.test(pin({ place: 'Switzerland', site: 'Lauterbrunnen' })));
  eq(
    'the owner-pinned spelling wins over the judge',
    clipSiteName({ site: 'Lauterbrunnen', siteHe: 'לאוטרברונען' }),
    'לאוטרברונן'
  );
  eq(
    'an unpinned site uses the spelling the judge returned',
    clipSiteName({ site: 'Val Gardena', siteHe: 'ואל גרדנה' }),
    'ואל גרדנה'
  );
  eq('a site the judge left in Latin is dropped', clipSiteName({ site: 'Val Gardena', siteHe: 'Val Gardena' }), null);
  eq('and so is one with no spelling at all', clipSiteName({ site: 'Val Gardena', siteHe: '' }), null);
  eq(
    'the pin then names the country alone rather than half in Latin',
    pin({ place: 'Italy', site: 'Val Gardena', siteHe: '' }),
    '📍 איטליה'
  );

  // The judge returns "Cinque Torri, Dolomites" often enough to matter, and
  // that renders as a pin with two commas and a region nobody asked for. The
  // schema asks for the bare name; this trims it anyway, because a prompt is a
  // request and this is the line that publishes.
  eq(
    'a site carrying its own region is trimmed',
    pin({ place: 'Italy', site: 'Cinque Torri, Dolomites' }),
    '📍 צ׳ינקווה טורי, איטליה'
  );

  // The description is the pin line and the tags, and NOT the hook — that is
  // burned into the video, and repeating it spends the description on something
  // the viewer read two seconds ago.
  const desc = clipCaption({ hook: 'אני, אתה, טיסה לאיטליה?', clip: { vision: { place: 'Italy', site: 'Lago di Braies' } } });
  ok('the description opens with the pin', desc.startsWith('📍 לאגו די בראייס, איטליה'));
  ok('and ends with the tags', /#\S+( #\S+){4}$/.test(desc.trim()), desc);
  ok('the hook is not repeated in it', !desc.includes('אני, אתה'));
  ok('the whole description is Hebrew but for the tag pool', !/[A-Za-z]/.test(desc.split('\n')[0]), desc);
}

/* -------------------------------------------------------------------------- */
group('clip footage - the same video must never come back');

// The bug, exactly: /clip built its "already used" set with
//   store.recentPublished().map((p) => String(p.pexelsId || ''))
// and recordPublished had never accepted, let alone stored, a pexelsId. So the
// set was empty on every run, findClips filtered against nothing, and the
// highest-ranked clip in the catalogue was offered again and again. The owner
// was handed footage they had already posted.
//
// Two things had to be true for the filter to work at all, and neither was: the
// id has to be WRITTEN when a clip goes out, and it has to be remembered past
// the 30-day quota window and past a rejection.
{
  const seenIds = (rows) => rows.map((p) => String(p.pexelsId || '')).filter(Boolean);

  store.recordPublished({
    id: 'clip-ledger-probe',
    pillar: 'day',
    tags: [],
    layout: null,
    headline: 'אני, אתה, טיסה לאיטליה?',
    pexelsId: '35714980',
    tiktok: true,
    tiktokDraft: true,
  });

  const row = store.recentPublished().find((p) => p.id === 'clip-ledger-probe');
  eq('the published row records which video it was', row?.pexelsId, '35714980');
  ok('so the set /clip builds is not empty', seenIds(store.recentPublished()).includes('35714980'));

  // And the ledger, which is the half that survives everything the log does
  // not: a rejection, a second line over the same footage, a month passing.
  ok('publishing spends the footage', store.clipUsed('35714980'));
  ok('the set handed to the search is strings', [...store.usedClipIds()].every((v) => typeof v === 'string'));
  ok('the search would skip it', store.usedClipIds().has(String(35714980)));

  store.markClipUsed('31384734');
  ok('a clip that was only ever built is spent too', store.clipUsed('31384734'));
  ok('which is the case a published-only check could not see', !store.hasPublished('31384734'));

  // The candidate id is a hash of the footage AND the line, so the same video
  // under a second line is a different id. That is why the ledger is keyed on
  // the Pexels id and not on the candidate: dedupe by candidate id is dedupe by
  // sentence, and the sentence is the part that changes every run.
  const { clipId } = await import('../src/video/clip.js');
  ok(
    'the same video under two lines is two candidate ids',
    clipId('35714980', 'אני, אתה, טיסה לאיטליה?') !== clipId('35714980', 'אני, אתה, טיסה לשוויץ?')
  );
  ok('but one footage id', store.clipUsed('35714980'));

  eq('footage can be deliberately put back', store.forgetClip('31384734'), true);
  ok('and is then offered again', !store.clipUsed('31384734'));

  // Both shapes a clip's footage id has had, read by ONE function.
  //
  // The rule lived in two places and was missing from a third, and the missing
  // one is what leaks: a clip built before `clip.pexelsId` existed carries the
  // Pexels id as its candidate id, and the published log recorded null for it.
  // A row that says null cannot stop a repeat of footage real followers have
  // already been shown, which is the complaint this whole ledger answers.
  eq('the current shape', store.clipPexelsId({ kind: 'clip', id: 'ab12cd34', clip: { pexelsId: '35714980' } }), '35714980');
  eq('the shape that predates the field', store.clipPexelsId({ kind: 'clip', id: '35714980' }), '35714980');
  eq('a card has no footage', store.clipPexelsId({ kind: 'card', id: '35714980' }), null);
  // Bounded, so a candidate id that happens to be all digits is not mistaken
  // for a Pexels id — a sha1 slice can be, and a wrong id spends footage that
  // was never used while leaving the real one on offer.
  eq('and a long all-digit candidate id is not one', store.clipPexelsId({ kind: 'clip', id: '1234567890123' }), null);

  store.forgetPublished('clip-ledger-probe');
  store.forgetClip('35714980');
}

/* -------------------------------------------------------------------------- */
group('one country per clip - the line, the pin and the tag are one fact');

// The post that prompted this said "אני, אתה, טיסה לאיטליה?" burned into the
// video with a pin underneath it reading the same country — consistent, and
// consistent is the point: the three statements are built by three different
// routes from one judgement, and nothing checked they agreed. A writer that
// ignores the country it was given produces a video whose own description
// contradicts it, and no viewer needs to know which half is right to see it.
{
  const { namesOtherCountry } = await import('../src/video/hooks.js');

  eq('the clip\'s own country is fine', namesOtherCountry('אני, אתה, טיסה לאיטליה?', 'איטליה'), null);
  eq('another country is not', namesOtherCountry('אני, אתה, טיסה לאיטליה?', 'שווייץ'), 'איטליה');
  eq('the glued preposition is caught', namesOtherCountry('חייב להיות בטופ 3 מסלולים ביוון', 'איטליה'), 'יוון');

  // Hebrew spells a foreign name by ear and both spellings are in use. A guard
  // that only knew post-config.json's שווייץ would have rejected the owner's
  // own line, which is the way this kind of check usually fails.
  eq('שוויץ and שווייץ are the same country', namesOtherCountry('אני, אתה, טיסה לשוויץ?', 'שווייץ'), null);
  eq('and it is still caught against a different one', namesOtherCountry('אני, אתה, טיסה לשוויץ?', 'איטליה'), 'שווייץ');

  // With no country established the line may name none at all. The pin and the
  // tag both withdraw in that case, and a line that named a country anyway
  // would be the only claim on the post — an unverifiable one.
  eq('an unplaced clip may not name a country', namesOtherCountry('אני, אתה, טיסה ליוון?', null), 'יוון');
  eq('a line with no country in it is always fine', namesOtherCountry('העובדה שהשביל הזה לא עולה כסף', null), null);
}

/* -------------------------------------------------------------------------- */
group('clip lines - the owner-approved shapes must survive their own guards');

// The rule this group has always encoded: A GUARD THAT REJECTS A CANONICAL LINE
// IS A BROKEN GUARD. Three separate guards silently ate the owner's approved
// lines, each time looking like the writer had failed, and the fix was to lock
// the canonical lines into the tests.
//
// The canon has been both things now — these meme shapes, then the brief's
// advice hooks with beats under them, then these again — and the rule survived
// every swap. What is locked here is the shapes that are actually burned into
// videos today.
{
  const { hasPerson, isLabel, promisesList, trailsOff } = await import('../src/video/hooks.js');
  const cfg = postConfig().clips;
  const fmt = (id) => cfg.formats.find((f) => f.id === id);

  // The two place formats are built out of pronouns. hasPerson bans אני, אתה
  // and אחי — correctly, in general: it stops the account claiming to have
  // stood somewhere it has not. A vocative and an invitation make no such
  // claim, so they carry an explicit exemption rather than weakening the rule.
  for (const id of ['vocative', 'invite']) {
    ok(`${id} exists`, Boolean(fmt(id)));
    ok(`${id} is exempt from the person guard`, fmt(id).allowsPerson === true);
    ok(`${id} only fires when the country is known`, fmt(id).needsPlace === true);
  }
  ok('the guard still bans the on-location voice', hasPerson('אני נשבע שהאוויר פה אחר'));
  ok('and the past tense of it', hasPerson('כשהייתי שם לא היה אף אחד'));
  ok('but not the viewer voice the owner approved', !hasPerson('למה אף אחד לא סיפר לי על השביל הזה'));
  // Second person is back on the list with the formats that need it gone. The
  // advice voice — "אל תטוסו... לפני שאתם יודעים" — is the shape that owed the
  // viewer beats, and beats are what a single held line cannot deliver.
  ok('and the advice voice is refused again', hasPerson('אל תטוסו לשם לפני שאתם יודעים את זה'));

  // Both place shapes are short by design — three and four words. A blanket
  // five-word floor rejected both on every single run.
  ok('the vocative may be three words', fmt('vocative').minWords <= 3);
  ok('the invite may be four', fmt('invite').minWords <= 4);

  // The label check has to let nature vocabulary through. Its first version
  // rejected any line containing יער / הר / שביל, which would have thrown out
  // the 229K reference post the whole format is modelled on.
  ok('a bare noun phrase is still a label', isLabel('שביל יפה ביער'));
  ok('and so is a caption of the picture', isLabel('הדולומיטים, איטליה'));
  ok('but a statement about nature is not', !isLabel('יש רגע בהליכה שבו הראש מתרוקן'));

  // A PROMISE THE CLIP CANNOT KEEP. One line is held for the whole eight
  // seconds, so a hook that opens on a count owes the viewer a list that never
  // arrives — the exact failure the beats were built to prevent, and the one
  // thing that came out of that format rather than going back with it.
  ok('a list promise is refused', Boolean(promisesList('3 טעויות שישראלים עושים בגאורגיה')));
  ok('and so is a list of destinations', Boolean(promisesList('5 יעדים לאוקטובר בלי ויזה')));
  // The false positives it is not allowed to have. A ranking is not a list:
  // "בטופ 3 דברים" is an owner-approved line whose digit enumerates nothing,
  // and a duration is not a count either.
  eq('a ranking is not a promise', promisesList('חייב להיות בטופ 3 דברים שעשיתי השבוע'), null);
  eq('nor is the other one', promisesList('חייב להיות בטופ 3 מסלולים שקיימים'), null);
  eq('nor is a duration', promisesList('5 ימים בלי טלפון בהרים'), null);

  // Every line the owner approved verbatim must pass every check. If one of
  // these fails, the guards have drifted away from the taste they encode.
  const approved = [
    'העובדה שהשביל הזה לא עולה כסף',
    'חייב להיות בטופ 3 מסלולים שקיימים',
    'יש אנשים שזה המסלול שלהם לעבודה',
    'חייב להיות בטופ 3 דברים שעשיתי השבוע',
    'למה אף אחד לא סיפר לי על השביל הזה',
    'איך לא שמעתי על המסלול הזה עד היום',
  ];
  for (const line of approved) {
    ok(`approved line survives: ${line}`, !hasPerson(line) && !isLabel(line) && !trailsOff(line) && !promisesList(line));
  }

  // A LINE THAT DOES NOT FINISH ITS OWN SENTENCE, which is what shipped: text
  // burned into a video with "..." after it. On a screen there is nothing to
  // click for the rest, so a teaser is simply half a sentence — and it passed
  // every other guard in this file, because it carries no URL, no emoji, no
  // claim of presence, and it is not a label. It matters more now than when it
  // was written: this line is the whole text of the post.
  ok('an ellipsis is unfinished', Boolean(trailsOff('3 דברים שחייבים לדעת לפני ש...')));
  ok('and so is the typographic one', Boolean(trailsOff('המקום שאף אחד לא מספר לכם עליו…')));
  ok('two dots count', Boolean(trailsOff('הדרכון חייב להיות בתוקף..')));
  ok('a dangling connector is unfinished', Boolean(trailsOff('והכי חשוב, הדבר ש')));
  ok('so is a dangling preposition', Boolean(trailsOff('3 טעויות שישראלים עושים ב')));
  ok('and trailing punctuation', Boolean(trailsOff('שלושה דברים לבדוק —')));

  // The false positives this check is NOT allowed to have. Each is a line this
  // account would print: a sentence may end on a comparative, on a time before
  // something, or on a full stop. A guard that rejects a good line is the
  // failure this file has recorded twice already.
  for (const line of [
    'טיסה לשם זולה יותר בנובמבר',
    'מזמינים את הכרטיס חודש לפני',
    'הכניסה חינם עד השעה תשע',
    'העובדה שהשביל הזה לא עולה כסף',
  ]) {
    eq(`a finished line passes: ${line}`, trailsOff(line), null);
  }

  // And the fallback pool is drawn from those approved lines, so a failed API
  // call degrades to something already judged rather than to something invented.
  ok(
    'the fallback pool is owner-approved copy',
    cfg.hooks.every((l) => approved.includes(l) || /אני, אתה/.test(l)),
    cfg.hooks.find((l) => !approved.includes(l) && !/אני, אתה/.test(l))
  );
}

/* -------------------------------------------------------------------------- */
group('clip length - one line, one length, and a source long enough to fill it');

{
  const cfg = postConfig().clips;

  // Eight seconds and no arithmetic. The length was briefly COMPUTED from how
  // many beats a hook had, which is the right rule for a video that cuts and
  // the wrong one for a single held shot — see the note in post-config.json.
  eq('a clip is one fixed length', typeof cfg.video.seconds, 'number');
  ok('and it is short enough to loop', cfg.video.seconds <= 12, `${cfg.video.seconds}s`);

  // The length has to be reachable from the shortest footage the search will
  // accept. Pexels serves clips from five seconds; without looping, everything
  // between minDuration and `seconds` ships under length and nothing says so.
  ok(
    'the shortest allowed source can still fill it',
    cfg.search.minDuration >= cfg.video.seconds || cfg.video.loopSource === true,
    `minDuration=${cfg.search.minDuration}s, seconds=${cfg.video.seconds}s, loop=${cfg.video.loopSource}`
  );
}

/* -------------------------------------------------------------------------- */
group('the em dash, banned everywhere a reader can see one');

// An owner's instruction, and an absolute one. The reason it is a test rather
// than a habit is that almost nothing here writes its own strings: a model does,
// and a model reaches for the character constantly in both languages. A rule
// that lives only in a prompt is a rule that holds at temperature 0 and nowhere
// else.
{
  const { stripDashes, hasLongDash } = await import('../src/dashes.js');
  const { planText, planGiveaway } = await import('../src/plan/text.js');

  eq('an em dash becomes a hyphen', stripDashes('טיסה הלוך ושוב — 700 ₪'), 'טיסה הלוך ושוב - 700 ₪');
  eq('and so does an en dash', stripDashes('a – b'), 'a - b');
  eq('the double space it leaves is collapsed', stripDashes('a —  b'), 'a - b');
  ok('and a line with one is detectable', hasLongDash('a — b') && !hasLongDash('a - b'));

  // EVERY LIVE STRING IN post-config.json. Not the _comment blocks, which are
  // prose for whoever edits the file; everything else there is either published
  // or printed on a slide.
  const live = [];
  const walk = (o, path) => {
    if (typeof o === 'string') return live.push([path, o]);
    if (Array.isArray(o)) return o.forEach((v, i) => walk(v, `${path}[${i}]`));
    if (o && typeof o === 'object') {
      for (const k of Object.keys(o)) {
        if (k.startsWith('_')) continue;
        walk(o[k], path ? `${path}.${k}` : k);
      }
    }
  };
  walk(JSON.parse(readFileSync(new URL('../post-config.json', import.meta.url), 'utf8')), '');
  const dashed = live.filter(([, v]) => hasLongDash(v));
  eq('no live config string carries one', dashed.length, 0, dashed.map(([p]) => p).join(', '));

  // The strings a plan puts on a slide, after the templates are filled. A
  // destination name arrives from destinations.json by a different route than
  // the templates do, so filling is where one could still get in.
  const plan = {
    id: 'dashprobe01',
    dest: { id: 'rome', he: 'רומא', en: 'Rome', country: 'איטליה' },
    days: [{ n: 1, titleHe: 'העיר העתיקה', stops: [{ timeHe: '09:00', nameHe: 'קולוסיאום', nameEn: 'Colosseum', noteHe: 'מזמינים מראש', costIls: 80 }] }],
    total: 80,
  };
  const text = planText(plan);
  const give = planGiveaway(plan);
  for (const [k, v] of Object.entries(text)) {
    if (typeof v === 'string') ok(`plan text ${k} is clean`, !hasLongDash(v), v);
  }
  if (give) {
    for (const [k, v] of Object.entries(give)) {
      if (typeof v === 'string') ok(`giveaway ${k} is clean`, !hasLongDash(v), v);
    }
  }

  // THE WRITERS REPAIR RATHER THAN REFUSE. A dash is the most common thing a
  // model puts in a Hebrew line, and rejecting on it would throw away most of a
  // good itinerary over typography.
  const { shapePlan } = await import('../src/plan/write.js');
  const shaped = shapePlan(
    {
      days: [
        {
          titleHe: 'העיר — העתיקה',
          stops: [
            { timeHe: '09:00', nameHe: 'קולוסיאום — הזירה', nameEn: 'Colosseum', noteHe: 'מזמינים מראש — בלי תור', costIls: 80 },
            { timeHe: '11:00', nameHe: 'הפורום', nameEn: 'Roman Forum', noteHe: 'הכניסה מהצד', costIls: 0 },
            { timeHe: '13:00', nameHe: 'טרסטוורה', nameEn: 'Trastevere', noteHe: 'ארוחה בסמטאות', costIls: 90 },
          ],
        },
      ],
    },
    { days: 1, stopsMin: 3, stopsMax: 4 }
  );
  ok('a written day title is repaired', !hasLongDash(shaped.days[0].titleHe), shaped.days[0].titleHe);
  ok('and so is a stop', !hasLongDash(shaped.days[0].stops[0].nameHe + shaped.days[0].stops[0].noteHe));
  eq('the stop is kept, not dropped', shaped.days[0].stops.length, 3);

  // The clip writer and the shot list run the same repair on the way out, so
  // the rule does not depend on which of the three wrote the line.
  const hooks = readFileSync(new URL('../src/video/hooks.js', import.meta.url), 'utf8');
  const shoot = readFileSync(new URL('../src/shoot/plan.js', import.meta.url), 'utf8');
  ok('the clip writer strips them', /stripDashes\(l\.text\)/.test(hooks));
  ok('the shot list strips them', /stripDashes\(s\)/.test(shoot));
}

/* -------------------------------------------------------------------------- */
group('AI itineraries - the plan has to survive its own shape check');

{
  const { shapePlan, planTotal } = await import('../src/plan/write.js');
  const cfg = postConfig().plans;

  const stop = (nameHe, costIls, extra = {}) => ({
    timeHe: '09:00',
    nameHe,
    // Not printed anywhere — it is what the photo search runs on, and a stop
    // without one has no picture and therefore no slide.
    nameEn: 'Colosseum',
    noteHe: 'מגיעים מוקדם ובלי תור',
    costIls,
    ...extra,
  });
  const day = (titleHe, stops) => ({ titleHe, stops });
  const shape = (raw, opts = {}) =>
    shapePlan(raw, { days: 2, stopsMin: cfg.stopsMin, stopsMax: cfg.stopsMax, ...opts });

  const good = {
    days: [
      day('העיר העתיקה', [stop('קולוסיאום', 80), stop('הפורום הרומי', 0), stop('טרסטוורה', 120)]),
      day('וותיקן', [stop('מוזיאוני הוותיקן', 90), stop('כנסיית פטרוס', 40), stop('טירת סנט אנג׳לו', 55)]),
    ],
  };
  eq('a clean plan keeps both days', shape(good).days.length, 2);
  eq('and drops nothing', shape(good).dropped.length, 0);

  // THE TOTAL IS SUMMED, NEVER WRITTEN. A model asked for an itinerary and a
  // total returns two numbers that disagree about one plan, and the viewer can
  // see both on the same slideshow — which is the broken-promise failure that
  // cost the clip format its beats, arrived at by arithmetic instead.
  eq('the total is the sum of the stops', planTotal(shape(good).days), 385);

  // A Latin place name is ONE bullet dropped, not a lost plan. The slides are
  // RTL and a Latin run inside a Hebrew line is this project's oldest rendering
  // bug — but losing a whole itinerary to it would be the guard costing more
  // than the defect.
  const latin = { days: [day('העיר העתיקה', [stop('Colosseum', 80), stop('הפורום הרומי', 0), stop('טרסטוורה', 120), stop('פנתאון', 0)])] };
  const afterLatin = shape(latin, { days: 1 });
  eq('a Latin name costs its own stop', afterLatin.days[0].stops.length, 3);
  ok('and says so', afterLatin.dropped.some((d) => /Colosseum/.test(d)));

  // A stop with no English name has nothing to search a photograph on, and a
  // slide with no photograph is not a slide — the deck's rule, inherited whole.
  const noEn = {
    days: [day('העיר העתיקה', [stop('קולוסיאום', 80, { nameEn: '' }), stop('הפורום', 0), stop('טרסטוורה', 120), stop('פנתאון', 0)])],
  };
  eq('a stop with no English name leaves', shape(noEn, { days: 1 }).days[0].stops.length, 3);

  // The full stop comes off the note, which is printed as a parenthesised
  // fragment under the name. "(75 ₪ · נכנסים מראש.)" reads as a typo.
  eq(
    'a trailing period is stripped',
    shape({ days: [day('יום', [stop('א', 0, { noteHe: 'נכנסים בלי תור.' }), stop('ב', 0), stop('ג', 0)])] }, { days: 1 })
      .days[0].stops[0].noteHe,
    'נכנסים בלי תור'
  );

  // A day that loses too many stops is dropped whole: three bullets and then
  // one is a slideshow that looks like it ran out of material.
  const thin = { days: [day('העיר העתיקה', [stop('קולוסיאום', 80), stop('Forum', 0)])] };
  eq('a day under the floor is dropped', shape(thin, { days: 1 }).days.length, 0);

  // Prices are the one field nothing sourced, so the check on them is a sanity
  // bound rather than a fact check — a four-figure "entry fee" is the model
  // having answered a different question.
  const silly = { days: [day('יום', [stop('קולוסיאום', 80), stop('טיסה פנימית', 4000), stop('טרסטוורה', 120), stop('פנתאון', 0)])] };
  ok('an implausible stop price is refused', shape(silly, { days: 1 }).dropped.some((d) => /4000/.test(d)));

  // A time that did not parse is dropped rather than printed. "בערך" where a
  // time should be makes the whole column look invented.
  const when = { days: [day('יום', [stop('קולוסיאום', 80, { timeHe: 'בבוקר' }), stop('הפורום', 0), stop('טרסטוורה', 120)])] };
  eq('an unparseable time is dropped, not printed', shape(when, { days: 1 }).days[0].stops[0].timeHe, null);
  eq('but the stop survives it', shape(when, { days: 1 }).days[0].stops.length, 3);

  // Instagram takes ten images in a carousel and a plan is days + 3 slides.
  // A config that allowed seven days would build a post Instagram rejects at
  // publish time, hours after it was approved.
  ok('the day ceiling fits a carousel', cfg.daysMax + 3 <= 10, `daysMax=${cfg.daysMax}`);
}

/* -------------------------------------------------------------------------- */
group('/trip resolves what you typed - it does not send you to edit a JSON file');

{
  const { resolveDestination, pickDestination, findDestination } = await import('../src/plan/write.js');

  // The paths that cost nothing. Both of these used to be "not in
  // destinations.json - add it with the Hebrew spelling", and one of them is a
  // country the file mentions 102 times.
  const rome = await resolveDestination('רומא');
  eq('a Hebrew city name resolves without a call', rome.how, 'exact');
  eq('and to the row the file already has', rome.dest.id, 'rome');
  eq('an English city name resolves too', (await resolveDestination('Rome')).dest.id, 'rome');
  eq('so does the id', (await resolveDestination('rome')).dest.id, 'rome');

  const norway = await resolveDestination('נורווגיה');
  eq('a Hebrew COUNTRY name is a country, not a miss', norway.how, 'country');
  eq('and answers with a city in it', norway.dest.country, 'נורווגיה');
  ok('a city an itinerary fits, never the country itself', norway.dest.he !== 'נורווגיה', norway.dest.he);

  // Nothing typed is not an error, it is /trip with no argument.
  eq('an empty ask stays null', await resolveDestination('  '), null);
  eq('and findDestination is unchanged for it', findDestination(''), null);

  // Which city a country resolves to is the FRESHNESS rules' decision, the same
  // ones /trip with no argument obeys. Otherwise "/trip italy" twice in a week
  // is Rome twice, which is the repeat the picker exists to prevent.
  const all = JSON.parse(readFileSync(new URL('../destinations.json', import.meta.url), 'utf8')).destinations;
  const inItaly = all.filter((d) => d.country === 'איטליה');
  ok('the catalogue has several Italian cities to choose between', inItaly.length > 1);
  const held = pickDestination([inItaly[0].he], { from: inItaly, rand: () => 0 });
  ok('a city just published is held back', held.he !== inItaly[0].he, held.he);
  ok('and the pool is honoured - nothing outside it comes back', inItaly.some((d) => d.he === held.he));
  // A country with exactly one city in the file still answers. Norway is that
  // country, and it is the one that started this.
  eq('a one-city country falls back to that city', pickDestination(['אוסלו'], { from: all.filter((d) => d.id === 'oslo') }).id, 'oslo');

  // The model path is not exercised here (it costs a call), but its contract is
  // asserted where it can be: the resolver must not be able to answer with a
  // Latin name, because that name reaches the cover slide and the caption.
  const src = readFileSync(new URL('../src/plan/write.js', import.meta.url), 'utf8');
  ok('the resolver refuses a non-Hebrew name', /if \(!isHebrew\(he\)/.test(src));
  ok('and runs on the cheap tier', /const RESOLVE_MODEL = modelFor\('mechanical'\)/.test(src));
  ok('the bot no longer tells you to edit destinations.json', !/לא ב-destinations\.json/.test(readFileSync(new URL('../bot.js', import.meta.url), 'utf8')));
}

/* -------------------------------------------------------------------------- */
group('the itinerary slideshow - what it says, and what it promises');

{
  const { tripDecks, deckForSize, allStops, dayTotal, flagForHebrew } = await import('../src/plan/slides.js');
  const { renderSlideHtml } = await import('../src/render/deckTemplates.js');
  const { planText, planGiveaway } = await import('../src/plan/text.js');
  const { planCaption } = await import('../src/hashtags.js');
  const cfg = postConfig().plans;

  const plan = {
    id: 'testplan0001',
    dest: { id: 'rome', he: 'רומא', en: 'Rome', country: 'איטליה' },
    days: [
      { n: 1, titleHe: 'העיר העתיקה', stops: [
        { timeHe: '09:00', nameHe: 'קולוסיאום', nameEn: 'Colosseum', noteHe: 'מזמינים מראש', costIls: 80 },
        { timeHe: '13:00', nameHe: 'הפורום', nameEn: 'Roman Forum', noteHe: 'הכניסה מהצד', costIls: 0 },
      ] },
      { n: 2, titleHe: 'וותיקן', stops: [
        { timeHe: '08:00', nameHe: 'מוזיאוני הוותיקן', nameEn: 'Vatican Museums', noteHe: 'הכניסה הראשונה', costIls: 90 },
      ] },
    ],
    total: 170,
  };
  const text = planText(plan);
  const give = planGiveaway(plan);

  // The cover promises a count and the slides have to deliver it, which is the
  // same rule as a hook that says "3 טעויות".
  eq('the stop count is the slides own', allStops(plan).length, 3);
  eq('a day total is its own stops', dayTotal(plan.days[0]), 80);

  // A PLAN IS BUILT AS A DECK. The first version of this drew its own branded
  // card and it read as a different account's post beside the real slideshows —
  // so these return the slide shape render/deckTemplates.js already understands
  // and the deck's renderer draws them.
  const decks = tripDecks(plan, { text, giveaway: give });
  const full = deckForSize(decks, 'tiktok');
  const short = deckForSize(decks, 'instagram');

  // One stop per slide on TikTok, one DAY per slide on Instagram. Instagram
  // takes ten images and a four-day plan is nineteen slides, so the two sets
  // are two lengths of the same plan rather than two crops of one set.
  eq('tiktok gets a slide per stop', full.slides.length, allStops(plan).length + (give ? 2 : 1));
  eq('instagram gets a slide per day', short.slides.length, plan.days.length + (give ? 2 : 1));
  ok('and the Instagram set fits a carousel', short.slides.length + 1 <= 10);
  ok('both sets are the minimal deck style', full.style === 'minimal' && short.style === 'minimal');

  // The cover's emphasis has to be a SUBSTRING of the title or coverTitle
  // silently drops the colour — which is a slide that renders correctly and
  // looks like the accent was never configured.
  ok('the cover emphasis is inside the hook', full.titleHe.includes(full.idea.emphasisHe));

  // Every fact of a stop reaches its slide. The name line carries the time, the
  // note line carries the price — see the note on stopSlide — and losing either
  // is an itinerary that stopped being one.
  const first = full.slides[0];
  ok('the time is on the name line', first.nameHe.includes('09:00'));
  ok('and the place', first.nameHe.includes('קולוסיאום'));
  ok('the price leads the note', first.bullets[0].text.startsWith('80 ₪'));
  ok('and the note follows it', first.bullets[0].text.includes('מזמינים מראש'));
  // Free is a word, not a blank. An empty price on a slide reads as an
  // omission; "חינם" reads as an answer.
  ok('free says so', full.slides[1].bullets[0].text.startsWith('חינם'));

  // The Instagram day slide names the day's stops in order — that is what makes
  // it a summary of the same plan rather than a different, shorter plan.
  ok('a day slide names its stops', short.slides[0].bullets[0].text.includes('קולוסיאום'));
  ok('all of them', short.slides[0].bullets[0].text.includes('הפורום'));

  // The flag comes off the Hebrew country name, because that is what
  // destinations.json stores — there is no ISO code anywhere on a plan.
  eq('Italy gets its flag', flagForHebrew('איטליה'), '🇮🇹');
  eq('and an unknown country gets none', flagForHebrew('אטלנטיס'), null);

  // THE ASK IS ALL OR NOTHING. `giveaway.on: false` is how somebody stops
  // promising strangers a month of premium, and a slide that survived the
  // switch would keep making the promise after it was withdrawn.
  const noAsk = deckForSize(tripDecks(plan, { text, giveaway: null }), 'tiktok');
  eq('with the giveaway off there is no ask slide', noAsk.slides.length, allStops(plan).length + 1);

  // The templates are filled with the plan's own facts — an ask naming a
  // different city than the slides is the contradiction this kind is most
  // likely to ship, because both strings come from different places.
  ok('the hook names the destination', text.hookHe.includes('רומא'));
  ok('and the day count', text.hookHe.includes(String(plan.days.length)));
  ok('no placeholder survives filling', !/[{}]/.test([text.hookHe, text.askHe, text.dayLabelFor(1)].join(' ')));

  if (give) {
    ok('the keyword is the destination', give.keyword.includes('רומא'));
    ok('the ask names the action', give.actionHe.includes(give.keyword));
    ok('and the line under it names the prize', give.prizeHe.includes(String(give.premiumDays)));
    ok('neither keeps a placeholder', !/[{}]/.test(`${give.actionHe} ${give.prizeHe}`));
    // The last two slides are not places, so they carry no flag. "525 ₪ לאדם 🇮🇹"
    // says nothing and costs a line at this type size.
    ok('the closing slides carry no flag', full.slides.slice(-2).every((s) => !s.flag));
    // The same numbers on the slide and in the caption. A post whose last frame
    // says five winners and whose description says three is a broken promise to
    // whoever commented for the third one.
    const caption = planCaption(plan, { text, giveaway: give });
    ok('the caption repeats the keyword', caption.includes(give.keyword));
    ok('and the same winner count', caption.includes(String(give.winners)));
    // ONE ASK PER POST: the bio CTA stands down while the giveaway is running.
    const cta = postConfig().caption.cta;
    ok('the bio CTA stands aside for it', !cta || !caption.includes(cta));
  }

  // The caption is a published string like any other.
  const captions = [
    planCaption(plan, { text, giveaway: give, titled: true }),
    planCaption(plan, { text, giveaway: give, titled: false }),
  ];
  for (const c of captions) ok('no domain in the caption', !/(https?:\/\/|www\.|\.com\b)/i.test(c));
  ok('instagram opens with the hook', captions[0].startsWith(text.hookHe));
  ok('tiktok does not repeat it', !captions[1].startsWith(text.hookHe));

  // The total slide has to say what its own number covers. A four-figure sum
  // under "4 ימים ברומא" reads as the price of the trip unless something says
  // it is entrance fees — and that misreading is as bad as a wrong number.
  ok('the total is qualified', Boolean(cfg.totalNoteHe), 'plans.totalNoteHe is empty');
  const totalSlide = full.slides.at(give ? -2 : -1);
  ok('the total slide carries the qualification', totalSlide.bullets[0].text === cfg.totalNoteHe);
  ok('and the total itself', totalSlide.nameHe.includes('170'));

  // Nothing after a photograph should be a flat gradient: a bare closing slide
  // reads as the post running out of material at the moment it asks for a
  // follow. The last two borrow pictures rather than fetching their own.
  const withPhotos = deckForSize(
    tripDecks(
      {
        ...plan,
        coverImage: { src: 'data:image/jpeg;base64,AAA' },
        days: plan.days.map((d) => ({ ...d, stops: d.stops.map((s) => ({ ...s, image: { src: 'data:image/jpeg;base64,BBB' } })) })),
      },
      { text, giveaway: give }
    ),
    'tiktok'
  );
  ok('every slide has a photograph', withPhotos.slides.every((s) => s.image?.src));

  // Every slide renders through the DECK's template at both sizes. It is the
  // same call render/deck.js makes, so this catches a slide shape the deck
  // cannot draw — which is invisible until the one post that uses it.
  for (const size of ['tiktok', 'instagram']) {
    for (const [i, slide] of deckForSize(decks, size).slides.entries()) {
      const html = renderSlideHtml(slide, { size, cover: false, style: 'minimal' });
      ok(`slide ${i + 1} renders at ${size}`, html.includes('class="block"'));
      // The font guard in render/index.js refuses any page whose declared faces
      // did not parse, and it can only refuse faces the page DECLARED. A slide
      // that forgot @font-face draws Hebrew in whatever Chromium falls back to.
      ok(`slide ${i + 1} declares Heebo at ${size}`, /font-family:\s*'Heebo'/.test(html));
    }
  }

  // Markup cannot come in through a destination name. The keyword is drawn
  // from the plan and painted into the ask slide, which is the one place a
  // string from a data file reaches the page as something other than text.
  const evil = { ...plan, dest: { ...plan.dest, he: '<script>x</script>' } };
  const evilDeck = deckForSize(tripDecks(evil, { text: planText(evil), giveaway: give }), 'instagram');
  const evilHtml = evilDeck.slides.map((s) => renderSlideHtml(s, { size: 'tiktok', style: 'minimal' })).join('');
  ok('a name cannot inject markup', !evilHtml.includes('<script>x</script>'));
}

/* -------------------------------------------------------------------------- */
group('posting windows - Israel time, and not on Shabbat');

{
  const { israelNow, inShabbat, inWindow, sendableNow, nextSendableAt } = await import('../src/schedule.js');

  // Fixed UTC instants, so this measures the TIME ZONE CONVERSION rather than
  // whatever the machine running the tests thinks the time is. That is the
  // whole reason the module uses Intl instead of getHours(): the VPS is not in
  // Israel, and a schedule that means something different per box is the kind
  // of bug that reads as "the bot is quiet today".
  const at = (iso) => new Date(iso);
  eq('13:00 Israel from 10:00Z', Math.round(israelNow(at('2026-09-23T10:00:00Z')).hour), 13);
  eq('and the weekday comes with it', israelNow(at('2026-09-23T10:00:00Z')).day, 3);

  ok('midday is a window', inWindow(at('2026-09-23T10:00:00Z')));
  ok('so is the evening', inWindow(at('2026-09-23T17:00:00Z')));
  ok('08:00 is not', !inWindow(at('2026-09-23T05:00:00Z')));
  ok('nor is 16:00, between the two', !inWindow(at('2026-09-23T13:00:00Z')));

  ok('Friday afternoon is Shabbat', inShabbat(at('2026-09-25T13:00:00Z')));
  ok('Saturday midday is Shabbat', inShabbat(at('2026-09-26T10:00:00Z')));
  ok('Friday lunchtime is not yet', !inShabbat(at('2026-09-25T09:00:00Z')));
  ok('Saturday night is past it', !inShabbat(at('2026-09-26T18:00:00Z')));

  // Shabbat beats the window. Friday 12:00 is inside a posting window AND
  // before candle-lighting, so it sends; Friday 16:00 is inside no window and
  // inside Shabbat, and the reason given has to be the Shabbat one because
  // that is the one that lasts another day.
  ok('Friday lunchtime sends', sendableNow(at('2026-09-25T09:00:00Z')).ok);
  ok('Friday evening does not', !sendableNow(at('2026-09-25T13:00:00Z')).ok);
  ok('and says why', /שבת/.test(sendableNow(at('2026-09-25T13:00:00Z')).why));
  ok('outside hours says something else', /שעות/.test(sendableNow(at('2026-09-23T05:00:00Z')).why));

  // The next opening after Shabbat is Saturday evening, not Sunday.
  const next = nextSendableAt(at('2026-09-25T13:00:00Z'));
  ok('there is a next opening', Boolean(next));
  ok('and it is after Shabbat ends', !inShabbat(next) && inWindow(next));
  ok('within a day and a half', next - at('2026-09-25T13:00:00Z') < 36 * 3_600_000);
}

/* -------------------------------------------------------------------------- */
group('shoot rotation - the brief’s counting rules are checks, not hopes');

{
  const { chooseFormat, nextSeries, seriesLabels, pickAngle } = await import('../src/shoot/rotation.js');
  const cfg = postConfig().shoot;

  // A deterministic PRNG, because the claims below are about what happens over
  // a run and a flaky counting test is worse than none.
  const prng = (seed) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

  const simulate = (n, seed) => {
    const rand = prng(seed);
    const history = [];
    for (let i = 0; i < n; i++) {
      const { format } = chooseFormat(history, { rand });
      const series = nextSeries(history);
      const angle = pickAngle(history, { rand });
      history.unshift({
        formatId: format.id,
        shape: format.shape,
        needsProduct: format.needsProduct,
        series,
        angle,
      });
    }
    return history.reverse();
  };

  for (const seed of [7, 41, 1009]) {
    const run = simulate(20, seed);

    // Rule 5: never the same template twice in a row. Checked on SHAPE, not on
    // id — mistakes → warning is two different ids and one template as far as
    // anybody scrolling is concerned.
    const repeats = run.filter((r, i) => i > 0 && r.shape && r.shape === run[i - 1].shape);
    eq(`seed ${seed}: no back-to-back shapes`, repeats.length, 0);

    // Rule 3: the product in at least half. A floor, so it is a check — and
    // the check is on EVERY ROLLING WINDOW, not on the average, because an
    // average can be met by a burst of demos after a fortnight without one.
    //
    // This is the assertion that caught the real bug. The first version of the
    // rule counted the window that had just slid past and forced the demo when
    // it was short, which converges to 44% rather than 50%: by the time a
    // window is measurably short, the window it was protecting has gone out.
    const need = Math.ceil(cfg.productShare * cfg.productWindow);
    let worst = Infinity;
    for (let i = 0; i + cfg.productWindow <= run.length; i++) {
      worst = Math.min(worst, run.slice(i, i + cfg.productWindow).filter((r) => r.needsProduct).length);
    }
    ok(
      `seed ${seed}: every ${cfg.productWindow}-shoot window has ${need}+ product (worst ${worst})`,
      worst >= need,
      `worst window ${worst}/${cfg.productWindow}, need ${need}`
    );

    const product = run.filter((r) => r.needsProduct).length;
    ok(
      `seed ${seed}: product in at least half overall (${product}/${run.length})`,
      product >= run.length * cfg.productShare,
      `${product}/${run.length} below ${cfg.productShare}`
    );

    // Rule 7: a series that starts must reach its last part. A series
    // abandoned at part 1 is a promise broken to everyone who followed for it.
    const starts = run.filter((r) => r.series?.index === 1).length;
    const finishes = run.filter((r) => r.series && r.series.index === r.series.of).length;
    ok(`seed ${seed}: ${starts} series started, ${finishes} finished`, finishes >= starts - 1);

    // And every series runs 1, 2, 3 in order with nothing skipped.
    const parts = run.filter((r) => r.series).map((r) => r.series.index);
    ok(
      `seed ${seed}: series parts are consecutive`,
      parts.every((p, i) => i === 0 || p === 1 || p === parts[i - 1] + 1),
      parts.join(',')
    );
  }

  // A SERIES IS ABOUT ONE THING. Part 1 records its destination as the topic
  // and every later part is pinned to it — without which the mechanism breaks
  // in the one way that matters: part 1 ends on "עקבו לחלק 2 מחר", part 2
  // arrives about a different city, and the only people who acted on the
  // promise are the ones let down.
  {
    const started = nextSeries([]);
    eq('a new series opens at part 1', started.index, 1);
    eq('with no topic yet - part 1 chooses it', started.topic, null);

    const afterOne = [{ formatId: 'demo', shape: 'C', needsProduct: true, series: { index: 1, of: 3, topic: 'קורפו' } }];
    const second = nextSeries(afterOne);
    eq('part 2 follows part 1', second.index, 2);
    eq('and inherits the topic', second.topic, 'קורפו');

    const afterTwo = [{ formatId: 'myth', shape: 'E', needsProduct: false, series: { index: 2, of: 3, topic: 'קורפו' } }, ...afterOne];
    eq('part 3 still inherits it', nextSeries(afterTwo).topic, 'קורפו');

    // And a finished series does not silently continue into a fourth part.
    const afterThree = [{ formatId: 'list', shape: 'D', needsProduct: false, series: { index: 3, of: 3, topic: 'קורפו' } }, ...afterTwo];
    const next = nextSeries(afterThree);
    ok('a finished series does not run to part 4', !next || next.index === 1, JSON.stringify(next));
  }

  // "עקבו לחלק 4 מחר" under part 3 of 3 is the exact promise-breaking the
  // series mechanism exists to avoid.
  eq('the last part asks for no next one', seriesLabels({ index: 3, of: 3 }).next, null);
  ok('an earlier part does', Boolean(seriesLabels({ index: 1, of: 3 }).next));
  ok('and is labelled', /1/.test(seriesLabels({ index: 1, of: 3 }).label));

  // An empty history must not crash the first ever shoot.
  ok('a cold start chooses something', Boolean(chooseFormat([]).format));
  ok('and picks an angle', Boolean(pickAngle([])));
}

/* -------------------------------------------------------------------------- */
group('the caption - a question, sometimes a CTA, and never a URL');

{
  const { captionQuestion, captionCta, clipCaption } = await import('../src/hashtags.js');
  const { assertNoUrl } = await import('../src/format.js');
  const { shootMessage, shootCaption } = await import('../src/shoot/message.js');
  const cfg = postConfig().caption;

  ok('there are questions to draw from', cfg.questions.length > 0);
  ok('every one of them asks something', cfg.questions.every((q) => q.includes('?')));
  ok('a question comes back', Boolean(captionQuestion({ rand: () => 0.1 })));

  // THE CTA CAME BACK AND THE URL DID NOT, AND THEN IT BECAME A POOL. One
  // closing line across every post is a signature however soft the wording is,
  // which is the argument that made `lines` a pool in the first place.
  ok('there are several asks to draw from', cfg.ctas.length > 1);
  ok('none of them carries a domain',
    cfg.ctas.every((c) => { try { assertNoUrl(c); return true; } catch { return false; } }));

  // What the asks ask for. A send is the highest-weighted signal either platform
  // has for reaching somebody who does not follow you, and a follow is what
  // turns this post's reach into the next post's baseline, so the pool has to
  // contain both, not four rewordings of one.
  ok('at least one asks for a send', cfg.ctas.some((c) => /שלחו|תייגו/.test(c)));
  ok('at least one asks for a follow', cfg.ctas.some((c) => /עקבו|עוקבים/.test(c)));
  // The bio pointer survives as ONE entry: it is the only tappable route to the
  // product either platform offers, and a pipeline that never mentions it never
  // sends anybody anywhere.
  ok('and exactly one still points at the bio', cfg.ctas.filter((c) => /ביו/.test(c)).length === 1);

  // Soft means "not on every post". ctaShare is what makes that true, and the
  // two ends of the random range are what prove it is wired up at all.
  ok('below the share, an ask appears', Boolean(captionCta({ rand: () => 0 })));
  eq('above it, nothing', captionCta({ rand: () => 0.999 }), null);
  ok('and the share is under one', cfg.ctaShare < 1, `ctaShare=${cfg.ctaShare}`);
  // Two independent draws: one for whether, one for which. Tied together the
  // rarest asks would get rarer as the share fell.
  const asks = new Set();
  for (let i = 0; i < cfg.ctas.length; i++) {
    const at = i / cfg.ctas.length;
    asks.add(captionCta({ rand: () => at }));
  }
  ok('the whole pool is reachable', asks.size > 1, `${asks.size} distinct`);

  const cand = { clip: { vision: { place: 'Italy', site: 'Cinque Torri', siteHe: 'צ׳ינקווה טורי' } } };
  const caption = clipCaption(cand, { rand: () => 0.1 });
  ok('the clip caption still opens with the pin', caption.startsWith('📍'));
  ok('carries a question', /\?/.test(caption));
  ok('and still ends with the tags', /#\S+$/.test(caption.trim()));
  ok('and has no URL in it', (() => { try { assertNoUrl(caption); return true; } catch { return false; } })());

  // The hashtag pools went Hebrew. #fyp and #foryou were two English words on a
  // Hebrew post, doing the least of the five.
  const tags = postConfig().hashtags;
  ok('no English tags remain', [...tags.broad, ...tags.niche].every((t) => !/[A-Za-z]/.test(t)), [...tags.broad, ...tags.niche].find((t) => /[A-Za-z]/.test(t)));
  ok('between three and five tags go out', tags.broadCount + tags.nicheCount >= 3 && tags.broadCount + tags.nicheCount <= 5);

  // AND THEN #פוריו AND #ויראלי WENT TOO.
  //
  // Removing #fyp was right and stopped one step short. A broad tag is supposed
  // to buy the first impressions from a pool this post could plausibly win in;
  // #פוריו is #fyp with Hebrew letters, which is the same non-pool, and #ויראלי
  // names a hoped-for outcome rather than a subject, so there is no audience on
  // the other side of it at all. Broad now means broad WITHIN TRAVEL.
  ok('no for-you tag survives', tags.broad.every((t) => !/פוריו|פוריואו|foryou|fyp/i.test(t)), tags.broad.find((t) => /פוריו/.test(t)));
  ok('and no outcome tag', [...tags.broad, ...tags.niche].every((t) => !/ויראלי/.test(t)));
  // A tag in both pools is a slot that silently becomes a different tag: draw()
  // shares one `taken` set across the two, so the niche draw skips it.
  eq('the two pools do not overlap', tags.broad.filter((t) => tags.niche.includes(t)).join(','), '');

  // A shot list is the one message in this bot that ends at a person rather
  // than at a button, and it has to say so.
  const shoot = {
    formatHe: 'הדגמת המוצר', shape: 'C', destination: 'ליסבון',
    seriesLabel: 'חלק 2 מתוך 3', seriesNext: 'עקבו לחלק 3 מחר',
    angle: 'טיול עם ילדים', lengthSeconds: [15, 35],
    hook: 'ביקשתי מ-AI לתכנן לי 4 ימים בליסבון',
    beats: ['הקלדתי את הבקשה', 'חזר מסלול יום-יום', 'היום השלישי בסינטרה'],
    caption: 'ככה נראה מסלול שנבנה בשתי דקות',
    prompt: '4 ימים בליסבון עם שני ילדים',
    note: 'תחזיקו על היום השלישי',
    shots: ['הקלטת מסך', 'התוכנית חוזרת'],
  };
  const msg = shootMessage(shoot, { rand: () => 0.1 });
  ok('the shot list leads with the hook', msg.indexOf(shoot.hook) < msg.indexOf(shoot.beats[0]));
  ok('numbers the beats', /1\. הקלדתי/.test(msg));
  ok('prints the exact thing to type', msg.includes(shoot.prompt));
  ok('says nobody else will publish it', /אף אחד לא מפרסם/.test(msg));
  ok('and the copyable caption carries no URL', (() => { try { assertNoUrl(shootCaption(shoot, { rand: () => 0.1 })); return true; } catch { return false; } })());
}

/* -------------------------------------------------------------------------- */
group('model tiering - the cheap tier has to be legal, not just cheaper');

{
  const { modelFor, modelSplit, supportsEffort, outputConfig } = await import('../src/models.js');
  const split = modelSplit();

  // The split exists at all. Everything ran on opus-5 before, including
  // transliteration and command parsing.
  ok('three distinct tiers', new Set(Object.values(split)).size === 3, JSON.stringify(split));
  eq('editorial stays on the expensive model', split.editorial, 'claude-opus-5');
  ok('judgement is cheaper than editorial', split.judgement !== split.editorial);
  ok('mechanical is cheapest', split.mechanical !== split.editorial && split.mechanical !== split.judgement);

  // The incompatibility that made this more than a config change: Haiku 4.5
  // REJECTS output_config.effort with a 400, so a cheap tier that still sends
  // it is not cheaper, it is broken. Found by pointing the mechanical tier at
  // Haiku and watching every call fail.
  ok('Claude 5 models take effort', supportsEffort('claude-opus-5') && supportsEffort('claude-sonnet-5'));
  ok('Haiku 4.5 does not', !supportsEffort('claude-haiku-4-5'));

  const S = { type: 'object', properties: {} };
  ok('effort is sent where it is legal', outputConfig('claude-opus-5', 'medium', S).effort === 'medium');
  eq('and omitted where it is not', outputConfig('claude-haiku-4-5', 'medium', S).effort, undefined);
  ok('the schema always survives', outputConfig('claude-haiku-4-5', 'low', S).format.schema === S);

  // Every call site has to go through the helper, or the next model without
  // effort support breaks exactly one forgotten call — at 3am, on one deck.
  const { readFileSync: rf } = await import('node:fs');
  const callSites = [
    '../src/deck/build.js', '../src/deck/hebrew.js', '../src/deck/shape.js',
    '../src/deck/request.js', '../src/deck/ideas.js',
    '../src/images/textbox.js', '../src/images/curate.js', '../src/video/vision.js',
  ];
  for (const f of callSites) {
    const src = rf(new URL(f, import.meta.url), 'utf8');
    ok(
      `${f.split('/').pop()} builds output_config through the helper`,
      !/output_config: \{ effort:/.test(src),
      'a raw effort literal will 400 on a model that does not support it'
    );
  }

  // Billing follows the model actually used. A call moved to the cheap tier but
  // still recorded against opus reports a saving that did not happen.
  const { costOf } = await import('../src/usage.js');
  const u = { input_tokens: 10000, output_tokens: 2000 };
  ok('haiku costs a fifth of opus', costOf(u, 'claude-haiku-4-5') * 4.9 < costOf(u, 'claude-opus-5'));
  ok('sonnet sits between them',
    costOf(u, 'claude-haiku-4-5') < costOf(u, 'claude-sonnet-5') &&
    costOf(u, 'claude-sonnet-5') < costOf(u, 'claude-opus-5'));
}

/* -------------------------------------------------------------------------- */
group('font guard - the check that was silently passing');

try {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const probe = async (html) => {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const r = await page.evaluate(() => {
      const face = [...document.fonts].find((f) => f.family.replace(/['"]/g, '') === 'Heebo');
      const measure = (family) => {
        const el = document.createElement('span');
        el.textContent = 'מסלול טיול בחו״ל';
        el.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:900 100px ${family}`;
        document.body.appendChild(el);
        const w = el.getBoundingClientRect().width;
        el.remove();
        return w;
      };
      return {
        naive: document.fonts.check('900 100px Heebo'),
        status: face?.status ?? 'missing',
        distinct: Math.abs(measure("'Heebo'") - measure("'__no_such_font__'")) > 0.5,
      };
    });
    await page.close();
    return r;
  };

  const bare = await probe('<html dir="rtl"><body style="font-family:Heebo">שלום</body></html>');
  ok('document.fonts.check() is unreliable - it reports true with no @font-face at all', bare.naive === true, 'if this ever fails, the naive check may have become usable');
  ok('the real guard fires when the font is absent', bare.status !== 'loaded' && !bare.distinct);

  const real = await probe(renderHtml(draft));
  ok('the real guard passes on an actual card', real.status === 'loaded' && real.distinct);
  ok('Heebo measurably differs from the fallback', real.distinct);

  await browser.close();
} catch (e) {
  console.log(`  ⚠ skipped (Playwright unavailable: ${e.message})`);
}

/* -------------------------------------------------------------------------- */
console.log(`\n${'─'.repeat(56)}`);
if (fail) {
  console.log(`${pass} passed, ${fail} FAILED\n`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exitCode = 1;
} else {
  console.log(`${pass} passed, 0 failed`);
}
