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
import { renderSlideHtml, SIZES, sizeClass, INK_LUMINANCE, FACES, coverTitle } from '../src/render/deckTemplates.js';
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
import { rotationFor, oneClause, emphasisFrom, COVER_SHAPES, COVER_VOICES, COVER_ROTATION } from '../src/deck/ideas.js';
import { deckPlace, namesPlace, REGIONS } from '../src/deck/region.js';
import { __test as photoTest, scrimAlpha, underScrim } from '../src/render/photo.js';
import { treatmentFor, worstPatch, assertLegible, TEXT_BOXES, TARGET as LEGIBLE_TARGET } from '../src/render/legibility.js';
import { wordsFromAlignment, estimateTimings, subtitleLines, speechReady } from '../src/video/speech.js';
import { buildScript } from '../src/video/narrated.js';
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
  initRequest,
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
    // How Node's fetch really reports a transport failure: a useless message
    // and the actual reason hidden in `cause`.
    if (s === 'tls') throw Object.assign(new TypeError('fetch failed'), { cause: new Error('tlsv1 alert internal error') });
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

  // The failure must SAY what it was. "fetch failed" about an image host sends
  // you looking in the wrong codebase; "tlsv1 alert internal error" sends you
  // to the web server, which is where the problem actually was.
  globalThis.fetch = heads({ [A]: 'tls' });
  const tls = await assertFetchable([A]).then(() => null, (e) => e);
  ok('a TLS refusal names the handshake, not just "fetch failed"', /tlsv1 alert internal error/.test(tls?.message || ''), tls?.message);

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

  // /draft asks whether the KIND belongs on TikTok, not whether this copy still
  // owes it one.
  //
  // Approving a deck hands TikTok its draft at once and leaves only Instagram
  // queued, so the target is spent a second after the tap - and a draft was
  // therefore unrepeatable. The one moment you most want to send it again is
  // after the file behind it has been fixed (npm run redraw), and the answer
  // was "this item is not meant for TikTok" about a deck just sent there.
  //
  // The kind check is what keeps that from becoming "anything, anywhere": a
  // card is still refused by name, because a card is an Instagram post.
  const botSrc = readFileSync(new URL('../bot.js', import.meta.url), 'utf8');
  ok('/draft allows a re-send', /const belongs = targetsForKind\(item\.kind\)\.includes\('tiktok'\)/.test(botSrc));
  ok('and still refuses a kind that does not belong there', /!targets\.includes\('tiktok'\) && !belongs/.test(botSrc));
  ok('a card is such a kind', !allowedForKind('card').includes('tiktok'));
  ok('a plan is not', allowedForKind('plan').includes('tiktok'));
  // The second draft cannot withdraw the first, so the command has to say so.
  ok('and it says the old draft stays in the inbox', /מחקו את הקודמת בטיקטוק/.test(botSrc));

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
group('TikTok init - three endpoints, and a clip was going through the wrong one');

// Every clip this account approved came back `Invalid media_type or post_mode`
// while decks drafted through the same function perfectly well, and the reason
// was one endpoint doing the work of three: a video was being sent to
// content/init with media_type VIDEO, which that endpoint does not accept. The
// mode was right, the scope was right, the URL was right, and the door was
// wrong.
//
// Pinned by PATH rather than by body shape, because the path is the fact that
// was wrong and the bodies follow from it.
{
  const photo = { images: ['https://h/1.jpg', 'https://h/2.jpg'] };
  const clip = { videoUrl: 'https://h/clip.mp4' };

  eq(
    'a clip drafted goes to the inbox endpoint',
    initRequest({ isClip: true, draft: true, title: 'x', description: 'd', ...clip }).path,
    '/v2/post/publish/inbox/video/init/'
  );
  eq(
    'a clip posted directly goes to the video endpoint',
    initRequest({ isClip: true, draft: false, title: 'x', description: 'd', privacy: 'SELF_ONLY', ...clip }).path,
    '/v2/post/publish/video/init/'
  );
  eq(
    'a deck still goes to the content endpoint',
    initRequest({ isClip: false, draft: true, title: 'x', description: 'd', ...photo }).path,
    '/v2/post/publish/content/init/'
  );

  // And the fields that do not belong on a video endpoint are not on one. Both
  // halves matter: `media_type` is what TikTok refused, and `post_info` on the
  // inbox endpoint is the field whose absence costs the description.
  const inbox = initRequest({ isClip: true, draft: true, title: 'x', description: 'd', ...clip });
  ok('and it carries no media_type or post_mode', !('media_type' in inbox.body) && !('post_mode' in inbox.body));
  ok('nor a post_info TikTok would ignore', !('post_info' in inbox.body));
  eq('the URL is pulled, not uploaded', inbox.body.source_info.source, 'PULL_FROM_URL');
  eq('and it is the clip that was asked for', inbox.body.source_info.video_url, 'https://h/clip.mp4');

  // The description cannot travel, so the owner is told rather than left to
  // find an empty caption box in the app.
  ok('an upload says the description has to be pasted by hand', inbox.notes.length === 1, inbox.notes.join(' | '));

  // A photo post keeps the two fields that endpoint actually documents, and
  // keeps PHOTO as the only value either of them is ever given.
  const deck = initRequest({ isClip: false, draft: true, title: 'x', description: 'd', ...photo });
  eq('a drafted deck is a photo upload', `${deck.body.media_type}/${deck.body.post_mode}`, 'PHOTO/MEDIA_UPLOAD');
  eq(
    'and a published one is a photo direct post',
    (() => {
      const b = initRequest({ isClip: false, draft: false, title: 'x', description: 'd', privacy: 'SELF_ONLY', ...photo }).body;
      return `${b.media_type}/${b.post_mode}`;
    })(),
    'PHOTO/DIRECT_POST'
  );
  eq('a deck upload states no privacy level', deck.body.post_info.privacy_level, undefined);
  ok('and nothing anywhere asks for media_type VIDEO', !JSON.stringify([inbox, deck]).includes('"VIDEO"'));
}

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
// THE CARD NO LONGER LISTS SOURCES, and that is the change rather than a regression.
// One URL per slide meant a six-slide deck spent six lines of the approval card on
// addresses nobody reads before tapping. Nothing is lost: the evidence report below
// carries every one, which is where somebody checking actually goes.
ok('the card does NOT list a URL per slide', !deckMsg.includes('nm.cz'), 'the source list came back');
// A deck that came up short and a deck that meant to be short look identical
// afterwards, so the shortfall is stated at the moment it can still be rejected.
ok('says when it came up short of what was asked', deckMsg.includes('ביקשנו 5'));
ok('reports how thin the region was', deckMsg.includes('75') && deckMsg.includes('52'));
ok('names what was dropped and why', deckMsg.includes('Kafka Museum') && deckMsg.includes('403'));
ok('carries the TikTok privacy level, same as a card', deckMsg.includes(privacyHe('SELF_ONLY')));
ok('and the evidence report carries them instead', evidenceReport(deckFixture).includes('https://www.nm.cz/en/visit'));

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
// Matched on the TEXT rather than on the markup. The label is split at its last space
// so the final word and the flag can be bound with nowrap (see labelWithFlag), which
// means the name is no longer one contiguous string in the HTML - and asserting on the
// HTML made a correct layout look like a regression.
const textOf = (html) => html.replace(/<img[^>]*alt="([^"]*)"[^>]*>/g, '$1').replace(/<[^>]+>/g, '');
ok('the flag sits inside the name', /החוף האדום\s*🇬🇷/.test(textOf(/<div class="name[\s\S]*?<\/div>/.exec(flagged)?.[0] || '')));

// AND THE NAME HAS EXACTLY ONE CHILD ELEMENT.
//
// This is the invariant, and the markup assertion above is only a proxy for it. `.name`
// is clamped with `display: -webkit-box; -webkit-box-orient: vertical`, which lays out
// EVERY CHILD ON ITS OWN LINE. With the text as a bare node and the flag as a sibling
// <img>, Austria's flag rendered on a line of its own between the Vienna Opera's name
// and its note - "check for an emoji in a newline". It was not a wrapping accident; it
// was structural, and it happened at every length.
//
// So anything inside a clamped element is wrapped in one span, and these check that the
// three clamped elements in this file stay that way.
for (const [what, html] of [
  ['a name with a flag', flagged],
  ['a name without one', renderSlideHtml({ nameHe: 'סקוגאפוס', fields: [] }, { style: 'minimal' })],
  ['an info-style name', renderSlideHtml({ nameHe: 'סקוגאפוס', flag: '🇮🇸', fields: [{ emoji: '📍', value: 'איסלנד' }] }, { style: 'info' })],
]) {
  const block = /<div class="(?:name|title-info)[^"]*">(.*?)<\/div>/s.exec(html);
  ok(`${what} wraps its content in one inline child`, Boolean(block) && block[1].trim().startsWith('<span>'),
    block ? block[1].slice(0, 70) : 'no name element');
}

// The cover title is the same element and the same trap, and it had THREE children when
// an emphasis was set - text, the emphasis span, text - so an emphasised cover came out
// as three stacked lines whatever its length.
{
  const plain = coverTitle('חמישה ימים בוינה', '');
  const emph = coverTitle('חמישה ימים בוינה', 'וינה');
  for (const [what, html] of [['a plain cover', plain], ['an emphasised cover', emph]]) {
    const inner = /<div class="cover[^"]*">(.*?)<\/div>$/s.exec(html);
    ok(`${what} wraps its content in one inline child`, Boolean(inner) && inner[1].startsWith('<span>'),
      inner ? inner[1].slice(0, 70) : html.slice(0, 70));
  }
  ok('and the emphasis survives the wrapper', /class="emph/.test(emph));
}
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
  textOf(
    renderSlideHtml(
      { n: 1, nameHe: 'דולומיטים', countryHe: 'איטליה', flag: '🇮🇹', fields: [] },
      { style: 'minimal' }
    )
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
// company. The sourcing did not weaken: every slide's URL is in the evidence report,
// which is where somebody checking a claim actually goes.
ok('no URL is burned into a fact slide', !slideHtml.includes('nm.cz'));
ok('but the evidence report still carries every one', evidenceReport(deckFixture).includes('https://www.nm.cz/en/visit'));
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

// THE WASH IS NOW UNCONDITIONAL, AND THAT IS A REVERSAL.
//
// This used to assert the opposite - "no wash when the photograph offers enough
// contrast" - on the reasoning that a wash is a last resort and has to stay rare "or
// every slide grows a panel and the look is gone". That reasoning was right about the
// treatment it was written for, which was a RADIAL BLOB centred on the text, and a
// frame full of those would indeed destroy the look.
//
// The treatment is now a gradient anchored to the frame edge, and the argument inverts:
//
//   It is not a panel. It has no far edge to notice, it runs off the frame, and a light
//   bottom gradient over a photograph is the house style of every account this project
//   is modelled on rather than a patch over a problem.
//
//   Making it conditional made the DECK inconsistent. Slide 2 with a gradient and slide
//   3 without reads as two designs shuffled together; a viewer sees six slides in a row,
//   not each one against a contrast target.
//
//   And the block's own score cannot see a note that overruns it. Valletta's town-hall
//   slide measured comfortably on dark foliage and its second line continued onto sunlit
//   paving, where it disappeared.
//
// So: every slide has one, and the measurement decides how dark rather than whether.
ok('every slide gets a band', placed.includes('class="assist"'));
ok('and a comfortable photograph gets only the floor',
  /rgba\(0,0,0,0\.300\)/.test(placed), placed.slice(placed.indexOf('class="assist"'), placed.indexOf('class="assist"') + 160));
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

// What replaced it: the close every other kind already had. A question, then one
// ask naming the next thing to do here. Forced rather than drawn, because a test
// that depends on Math.random passes four times in five.
{
  const closed = instagramCaption(capCand, { rand: () => 0 });
  const q = postConfig().caption.questions[0];
  const ask = postConfig().caption.ctas[0];
  const follow = postConfig().caption.follows[0];
  ok('the caption closes on a question', closed.includes(q));
  ok('and then the ask', closed.includes(ask));
  ok('the question comes before the ask', closed.indexOf(q) < closed.indexOf(ask));
  // THE REASON TO FOLLOW IS THE LAST LINE, on the owner's instruction: every post
  // ends on one. The ask was last until it arrived, and it now sits above it -
  // the ask is about this post, the follow is about the account, and the end of a
  // description is where somebody who read the whole thing decides.
  ok('and the reason to follow after that', closed.includes(follow.lineHe));
  ok('the ask comes before the follow', closed.indexOf(ask) < closed.indexOf(follow.lineHe));
  ok('the follow reason is last', closed.trim().endsWith(follow.lineHe));

  // EVERY DESCRIPTION CARRIES ONE, at the owner's instruction. This used to
  // assert the opposite — that a draw above ctaShare appended nothing — which
  // was the 0.7 rule written down. Both ends of the random range now land on an
  // ask, and which ask still varies, so the pool is doing the work the share
  // used to: one closing line on every post is a signature, six are a rotation.
  const high = instagramCaption(capCand, { rand: () => 0.99 });
  ok('every post carries an ask', postConfig().caption.ctas.some((c) => high.includes(c)));
  ok('and a different one at the other end of the draw', !high.includes(ask));
  ok('and every post carries a question', /\?/.test(high));
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
  // Including the reason to follow, which is the third thing in the close and the
  // one that has to agree with the closing slide or frame as well. A walking rand
  // is what catches it: with three independent draws per platform the two sides
  // land on different entries and the approval card previews neither.
  ok(
    'and one of the follow reasons is in both',
    postConfig().caption.follows.some((f) => both.instagram.includes(f.lineHe) && both.tiktok.includes(f.lineHe))
  );
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
eq('the surprise shape is impersonal', seq[0].voice.id, 'none');
// The warning shape talks straight at them, because "אל תזמינו" is addressed to
// somebody by construction. It is third in the rotation.
eq('the warning shape takes the pronoun', seq[2].voice.id, 'you');
ok('every shape declares its voice', COVER_SHAPES.every((sh) => COVER_VOICES[sh.voice]));
// In the four covers the channel was specified by, "אתם" appears exactly once.
// Three of eight shapes now take it — the two that are built from an address to
// the viewer, obligation and warning, plus the counted one. Still the minority,
// which is the property this asserts.
const pronouns = COVER_SHAPES.filter((sh) => sh.voice === 'you').length;
ok('most shapes carry no pronoun', pronouns * 2 < COVER_SHAPES.length, `${pronouns} of ${COVER_SHAPES.length}`);

eq('every shape is reachable', new Set(seq.map((r) => r.shape.id)).size, COVER_SHAPES.length);
eq('and both voices are used', new Set(seq.map((r) => r.voice.id)).size, Object.keys(COVER_VOICES).length);
// Most covers carry no count and name nowhere. The counted shape exists because
// the channel's own first example was "טופ 4 פסגות שאסור לפספס באלפים", but a
// list built AROUND counts and place names had every cover rejected.
const counted = seq.slice(0, COVER_ROTATION.length).filter((r) => r.shape.id === 'top-n').length;
eq('the counted shape gets one slot in the rotation', counted, 1);

// THE FEELING SHAPES GET HALF OF IT, which is the owner's note turned into a
// number: a cover can be useful and still be expected, and the four shapes that
// are a form of "here is a good list" were what "expected" meant. Asserted on the
// rotation rather than on the shape list, because share is what the sequence
// decides and the list only says what exists.
const FEELING = new Set(['surprise', 'mistake', 'secret']);
const feeling = seq.slice(0, COVER_ROTATION.length).filter((r) => FEELING.has(r.shape.id)).length;
eq('half the covers open on a feeling', feeling * 2, COVER_ROTATION.length);
// And the four "here is a good list" shapes get a quarter of it between them,
// which is the other half of the same decision. `unreal` sits with neither: it is
// a picture claim, so it keeps two slots.
const LIST = new Set(['superlative', 'best-for', 'urgency', 'top-n']);
const listy = seq.slice(0, COVER_ROTATION.length).filter((r) => LIST.has(r.shape.id)).length;
eq('and the expected shapes share a quarter', listy * 3, COVER_ROTATION.length);
ok('every shape in the rotation exists', COVER_ROTATION.every((id) => COVER_SHAPES.some((sh) => sh.id === id)));
// No shape twice in a row, which is the whole reason the order is written out
// rather than derived from weights.
ok(
  'the rotation never repeats a shape back to back',
  seq.slice(1, COVER_ROTATION.length + 1).every((r, i) => r.shape.id !== seq[i].shape.id)
);
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
group('the Israeli angle, and what it may not become');

{
  const { angles, pickAngle, anglePrompt } = await import('../src/angles.js');
  const cfg = postConfig();

  // It used to live under `shoot` and reach exactly one kind of post: the one
  // the bot cannot make. Both keys now read the same list, so a reader here and
  // a reader there cannot drift apart.
  ok('there is a pool', angles().length >= 6);

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
  const { pickCuts, oneCountry, cutLabel, cutsReason, beatCountMismatch } = await import('../src/video/cuts.js');
  const { clipPexelsIds, clipPexelsId } = await import('../src/store.js');
  const cfg = postConfig().clips.cuts;

  // A shot the vision judge could place, in the form findClips returns.
  //
  // `siteHe` is filled in from this table rather than left blank, because
  // clipSiteName needs Hebrew letters and will return null without them — so a
  // site spelled only in Latin is, correctly, not a nameable place. Half of
  // these happen to be pinned in clips.sites and would resolve anyway; writing
  // them all out keeps the tests from depending on which half.
  const SITE_HE = {
    Lauterbrunnen: 'לאוטרברונן',
    Zermatt: 'צרמט',
    Grindelwald: 'גרינדלוולד',
    Interlaken: 'אינטרלאקן',
    Skogafoss: 'סקוגאפוס',
    'Lago di Braies': 'לאגו די בראייס',
    'Fushimi Inari': 'פושימי אינארי',
    'Machu Picchu': 'מאצ׳ו פיצ׳ו',
    Trolltunga: 'טרולטונגה',
    Oia: 'אואיה',
  };
  const shot = (id, place, site) => ({
    id: String(id),
    title: `shot ${id}`,
    vision: {
      place,
      site: site || '',
      siteHe: site ? SITE_HE[site] || '' : '',
      placeConfidence: 10,
      siteConfidence: 10,
    },
  });

  eq('a shot is labelled with its place', cutLabel(shot(1, 'Switzerland')), 'שווייץ');
  eq('an unplaceable shot has no label', cutLabel(shot(2, null)), null);

  // Rule 1: a shot with no name cannot be in a list of places. The viewer
  // counting against the hook's number will not count it.
  const withBlank = [
    shot(1, 'Switzerland', 'Lauterbrunnen'),
    shot(2, null),
    shot(3, 'Iceland', 'Skogafoss'),
    shot(4, 'Italy', 'Lago di Braies'),
    shot(5, 'Japan', 'Fushimi Inari'),
  ];
  const picked = pickCuts(withBlank, cfg);
  ok('an unnamed shot is left out', !picked.some((c) => c.id === '2'));
  eq('and the rest are taken in rank order', picked.map((c) => c.id).join(','), '1,3,4,5');

  // RULE 2, AND IT IS THE OWNER'S: the name burned onto a cut has to be a
  // SPECIFIC PLACE. clipPlaceLabel falls back to the bare country, which is
  // right for the pin under a post and wrong on a cut — the first cuts video
  // went out as four country names and the note back was "places should be
  // specific, not a whole country".
  const countriesOnly = [
    shot(1, 'Switzerland'),
    shot(2, 'Iceland'),
    shot(3, 'Italy'),
    shot(4, 'Japan'),
  ];
  eq('four countries are not four places', pickCuts(countriesOnly, cfg).length, 0);
  eq('and the reason says which of the three things went wrong',
    cutsReason(countriesOnly, cfg).includes('0 with a named site'), true);
  // The escape hatch, for a day when the judge named nothing and a country list
  // beats no post at all.
  eq('unless the rule is turned off', pickCuts(countriesOnly, { ...cfg, labelNeedsSite: false }).length, 4);

  // Rule 3, and it is the one a count guard cannot see: two shots of the same
  // valley are one place twice, so the hook's number matches and the post is
  // still a list that repeats itself.
  const sameSite = [
    shot(1, 'Switzerland', 'Lauterbrunnen'),
    shot(2, 'Switzerland', 'Lauterbrunnen'),
    shot(3, 'Switzerland', 'Zermatt'),
    shot(4, 'Switzerland', 'Interlaken'),
  ];
  eq('the same site twice counts once', pickCuts(sameSite, cfg).length, 0);

  // FOUR PLACES IN ONE COUNTRY, which used to be unreachable. The labels were
  // deduplicated whole, so "שווייץ" collided with itself and every cut had to
  // come from a different country — which meant oneCountry never found one and
  // the writer was never allowed to name it. Deduplicating on the SITE is what
  // opens "4 מקומות בשווייץ".
  const sites = [
    shot(1, 'Switzerland', 'Lauterbrunnen'),
    shot(2, 'Switzerland', 'Zermatt'),
    shot(3, 'Switzerland', 'Grindelwald'),
    shot(4, 'Switzerland', 'Interlaken'),
  ];
  eq('four named sites in one country are a list', pickCuts(sites, cfg).length, 4);
  eq('and the hook may name that country', oneCountry(pickCuts(sites, cfg)), 'שווייץ');
  eq('a mixed list names none', oneCountry(picked), null);

  ok('too few shots build nothing',
    pickCuts([shot(1, 'Italy', 'Lago di Braies'), shot(2, 'Japan', 'Fushimi Inari')], cfg).length === 0);
  ok('and never more than the ceiling', pickCuts(
    [['Italy', 'Lago di Braies'], ['Japan', 'Fushimi Inari'], ['Iceland', 'Skogafoss'],
     ['Peru', 'Machu Picchu'], ['Norway', 'Trolltunga'], ['Greece', 'Oia']]
      .map(([p, s], i) => shot(i + 1, p, s)),
    cfg
  ).length <= cfg.cutsMax);

  // The opening cut is held for its own length, because it is the one cut with
  // no place name on it. "hook is too long" was a quarter of the video spent on
  // a title card.
  ok('the opening cut is shorter than the rest', cfg.hookSeconds < cfg.secondsPerCut,
    `hook ${cfg.hookSeconds}s vs ${cfg.secondsPerCut}s`);
  ok('and the hook is read in one glance', cfg.hookMaxWords <= 6, `${cfg.hookMaxWords} words`);

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
  // THE SHAPES CYCLE ACROSS DAYS, not across a batch index.
  //
  // This is the bug that made the held shape unreachable. suggestClip builds ONE
  // clip, so `i % 2 === 0` was 'cuts' every single day, and every unattended clip
  // this account ever produced was a cuts clip. The owner asked for "1 video with
  // a static text" believing the shape had been dropped; it had been, from the
  // only path that reaches it.
  //
  // THERE ARE THREE NOW, and the property being protected is unchanged. The old
  // note argued a strict alternation beats a weighting because a weighting
  // permits a run of five of the same thing. A strict CYCLE over three keeps
  // exactly that guarantee, which is what the "twice in a row" check below is
  // really asserting - it was never about there being two.
  {
    const { nextShapes, clipShapeArg } = await import('../src/video/clip.js');
    eq('a fresh box opens on the stronger shape', nextShapes(1).join(','), 'cuts');
    eq('after a cuts clip comes the montage', nextShapes(1, { after: 'cuts' }).join(','), 'montage');
    eq('after a montage, the held shape', nextShapes(1, { after: 'montage' }).join(','), 'held');
    eq('and after a held clip, round to cuts again', nextShapes(1, { after: 'held' }).join(','), 'cuts');
    eq('a batch cycles from wherever it starts',
      nextShapes(4, { after: 'cuts' }).join(','), 'montage,held,cuts,montage');
    eq('nothing is ever asked for twice in a row',
      nextShapes(9).filter((s, i, a) => i && s === a[i - 1]).length, 0);
    // Every shape reachable from the unattended path, which is the whole point
    // of the bug this cycle was written for: one clip a day means the rotation
    // IS the only way a shape ever gets built.
    eq('and every shape comes round', new Set(nextShapes(3)).size, 3);

    // With a shape switched off in config it leaves the ring, and the rest keep
    // cycling. Asking for a disabled shape would fail every build rather than
    // degrade, which is why this is a filter and not a fallback.
    eq('with cuts off, the other two alternate',
      nextShapes(4, { cutsOn: false }).join(','), 'montage,held,montage,held');
    eq('with the montage off, the original two do',
      nextShapes(4, { montageOn: false }).join(','), 'cuts,held,cuts,held');
    eq('with both off, every clip is held',
      nextShapes(3, { cutsOn: false, montageOn: false }).join(','), 'held,held,held');
    // A shape that was just switched off cannot strand the cycle: `after` names
    // something no longer in the ring, and the next call has to start somewhere
    // rather than return nothing.
    eq('and a retired shape does not strand the rotation',
      nextShapes(2, { after: 'montage', montageOn: false }).join(','), 'cuts,held');

    // And the shape can be named, for the occasion you have just changed one and
    // want to see it now rather than wait for the alternation to come round.
    eq('/clip cuts names the shape', clipShapeArg('cuts'), 'cuts');
    eq('/clip 2 held names both', clipShapeArg('2 held'), 'held');
    eq('and in Hebrew', clipShapeArg('חתוך'), 'cuts');
    eq('/clip montage names the third', clipShapeArg('montage'), 'montage');
    eq('and its Hebrew word too', clipShapeArg('רצף'), 'montage');
    eq('a bare count names no shape', clipShapeArg('3'), null);
    eq('and neither does nothing at all', clipShapeArg(''), null);

    // AND /help HAS TO KNOW ABOUT EVERY SHAPE THERE IS.
    //
    // A shape was added and the help text was left saying "שתי הצורות
    // מתחלפות" and listing two of the three. Nothing broke, nothing failed, and
    // the owner had to ask how to reach a format that had been shipped and
    // deployed - which is the whole cost of documentation that drifts: the
    // feature exists and is unreachable by the only person who would use it.
    //
    // Checked against the argument table rather than a hardcoded list, so
    // adding a fourth shape fails here until the help mentions it.
    const botSrcHelp = readFileSync(new URL('../bot.js', import.meta.url), 'utf8');
    const help = botSrcHelp.slice(botSrcHelp.indexOf("bot.command('help'"), botSrcHelp.indexOf("// Timers"));
    for (const shape of new Set(['cuts', 'held', 'montage'])) {
      ok(`/help mentions the ${shape} shape`, help.includes(`/clip ${shape}`),
        'a shape the help does not name is a shape nobody can ask for');
    }
    ok('and does not still claim there are two',
      !/שתי הצורות/.test(help),
      'the help counts the shapes and the count went stale');
  }

  // THE MEASURED SPOT IS ROUNDED THE SAME WAY ON BOTH SHAPES. A held clip
  // rounded its numbers where it built them; a cuts clip stored the raw object
  // measureClip returns, whose worst contrast lives at `spread.worst` — so the
  // approval card, which prints `spot.worstContrast`, said "ניגודיות undefined"
  // on every cut of every cuts clip. One function for both now.
  {
    const { spotNote } = await import('../src/video/clip.js');
    const raw = {
      x: 0.5001234, y: 0.2698, color: '#fff', onDark: true,
      contrast: 9.123456, spread: { worst: 7.15432 }, assist: 0.4,
      onBackground: 0.8123, frames: 5, agreed: 5,
    };
    const note = spotNote(raw);
    eq('the worst contrast is lifted out of spread', note.worstContrast, 7.15);
    eq('and is a number, not a string', typeof note.worstContrast, 'number');
    eq('the position is rounded to three places', note.y, 0.27);
    eq('an unmeasured shot notes nothing', spotNote(null), null);
    // The field the card actually reads, on the shape that was printing undefined.
    ok('so the card has a contrast to print', Number.isFinite(note.worstContrast));
  }

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
group('the map slide - a country ringed on a night satellite photograph');

// The frame that answers "where" in a slideshow that otherwise carries no text
// at all. Everything below is pure arithmetic and string building; the network
// halves (Nominatim's boundary, NASA's tiles) are exercised by running it.
{
  const { fitZoom, projectRings, ringCentre, mapHtml } = await import('../src/render/map.js');
  const width = 1080, height = 1920;

  // Finland, as Nominatim returns it: [south, north, west, east].
  const finland = [59.4541578, 70.092293, 19.0832, 31.5867071];
  const z = fitZoom(finland, { width, height });
  ok('a country gets a zoom that fits it', z >= 3 && z <= 8, `zoom=${z}`);

  // THE POINT OF fitZoom IS THAT IT FITS. Asserted by projecting the corners
  // rather than by trusting the number: a country touching the frame edge reads
  // as a screenshot of a map, and one that overflows is simply wrong.
  const centre = { lat: (finland[0] + finland[1]) / 2, lon: (finland[2] + finland[3]) / 2 };
  const box = {
    type: 'Polygon',
    coordinates: [[
      [finland[2], finland[0]], [finland[3], finland[0]],
      [finland[3], finland[1]], [finland[2], finland[1]], [finland[2], finland[0]],
    ]],
  };
  const [ring] = projectRings(box, { zoom: z, centre, width, height });
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  ok('and the whole country lands inside the frame',
    Math.min(...xs) >= 0 && Math.max(...xs) <= width && Math.min(...ys) >= 0 && Math.max(...ys) <= height,
    `x ${Math.min(...xs).toFixed(0)}..${Math.max(...xs).toFixed(0)} y ${Math.min(...ys).toFixed(0)}..${Math.max(...ys).toFixed(0)}`);
  ok('with room around it rather than touching the edge', Math.min(...xs) > 20 && Math.min(...ys) > 20);
  // Centred, which is what makes it read as a place being pointed at.
  ok('and centred', Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - width / 2) < 2);

  // The whole world still returns a drawable zoom rather than failing. It is 1
  // rather than 0 because at zoom 1 the world is 512px wide, which fits inside
  // the 691px this frame has spare — the function returns the LARGEST zoom that
  // fits, and that is the point of it.
  const world = fitZoom([-85, 85, -180, 180], { width, height });
  ok('the whole world still gets a drawable zoom', world >= 0 && world <= 1, `zoom=${world}`);

  // Mercator is undefined at the poles. A country reaching past the limit must
  // not produce NaN, which would silently draw nothing.
  const polar = projectRings(
    { type: 'Polygon', coordinates: [[[0, 89.9], [1, 89.9], [1, 88], [0, 88], [0, 89.9]]] },
    { zoom: 3, centre: { lat: 89, lon: 0.5 }, width, height }
  );
  ok('a polygon reaching the pole still projects to numbers',
    polar.every((r) => r.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))));

  // DECIMATION. Nominatim returns Finland as ~20,000 points at a fidelity meant
  // for cartography, every one of which Chromium would lay out and rasterise.
  const dense = { type: 'Polygon', coordinates: [[]] };
  for (let i = 0; i <= 5000; i++) {
    const a = (i / 5000) * Math.PI * 2;
    dense.coordinates[0].push([25 + Math.cos(a) * 5, 65 + Math.sin(a) * 3]);
  }
  const [thinned] = projectRings(dense, { zoom: 5, centre: { lat: 65, lon: 25 }, width, height, maxPoints: 400 });
  ok('a dense boundary is thinned', thinned.length <= 402, `${thinned.length} points`);
  // Closed explicitly: decimation drops the repeated last point, and an open
  // ring leaves a visible gap in a dashed outline.
  eq('and closed, so the dashes meet', thinned[0].join(), thinned[thinned.length - 1].join());

  // Islands are separate rings, or a line is drawn through the sea to join
  // them. Fragments too small to read are dropped whole.
  const archipelago = {
    type: 'MultiPolygon',
    coordinates: [
      [[[20, 60], [26, 60], [26, 64], [20, 64], [20, 60]]],
      [[[19.0, 60.1], [19.01, 60.1], [19.01, 60.11], [19.0, 60.11], [19.0, 60.1]]],
    ],
  };
  const many = projectRings(archipelago, { zoom: 5, centre: { lat: 62, lon: 23 }, width, height });
  eq('a speck of an island is dropped', many.length, 1);

  eq('a ring centre is the middle of its extent', ringCentre([[0, 0], [100, 0], [100, 50], [0, 50]]).join(), '50,25');
  eq('nothing drawable returns no rings', projectRings(null, { zoom: 4, centre, width, height }).length, 0);

  // THE COMPOSITING REGRESSION, AND IT IS THE REASON THIS FILE HAS A CANVAS.
  //
  // The tiles were seventy <img> elements. Every one laid out at the pixel it
  // was asked for, none broken, every JPEG verified to have content — and the
  // screenshot came back with two whole columns painted as page background.
  // Drawing the same decoded images to a canvas at the same coordinates in the
  // same page produced the correct pixels.
  //
  // So: no <img> in the basemap, ever. Anyone reverting to one will find the
  // page looks right in a browser and renders wrong to a file, which is the
  // worst possible shape for a bug and took a dozen measurements to corner.
  const html = mapHtml({
    tiles: [{ src: 'data:image/jpeg;base64,AAAA', x: -101, y: 0 }],
    rings: [[[10, 10], [20, 10], [20, 20], [10, 10]]],
    width, height, label: 'פינלנד',
  });
  ok('the basemap is a canvas', /<canvas id="map"/.test(html));
  ok('and never an img', !/<img/.test(html), 'seventy img layers composite wrong to a screenshot');
  ok('the tiles are handed to a draw loop', /drawImage/.test(html));
  ok('which signals when it has finished', /__mapReady/.test(html), 'a screenshot before the draw is a black slide');
  ok('the outline is drawn over it', /class="ring"/.test(html) && /stroke-dasharray/.test(html));
  ok('and the label goes inside the country', html.includes('פינלנד'));
}

/* -------------------------------------------------------------------------- */
group('the montage - many shots of ONE place under one unchanging line');

// THE THIRD SHAPE, from a reference the owner supplied: "lots of clips being
// changed each 1-2s, with 1 static text that showcases the place".
//
// It is the two existing shapes' halves swapped. Its selection rule is the
// exact inverse of pickCuts, which is the part most likely to be broken by
// somebody later tidying the two into one function: a cuts video must have NO
// two shots of the same place, a montage must have NOTHING ELSE.
{
  const { pickMontage, montageReason, pickCuts } = await import('../src/video/cuts.js');
  const { clipPlaceLabel } = await import('../src/hashtags.js');
  const cfg = { cutsMin: 3, cutsMax: 5 };
  // vision shapes that clipPlaceLabel/clipSiteName can read. `place` is the
  // English country the judge returned; post-config maps it to Hebrew.
  // siteHe has to be real Hebrew: clipSiteName refuses a field with a Latin
  // letter in it, which is the guard that stops an untranslated name reaching a
  // published pin.
  const HE = { Lauterbrunnen: 'לאוטרברונן', Skogafoss: 'סקוגאפוס', Dolomites: 'דולומיטים' };
  const shot = (id, query, place, site) => ({
    id,
    query,
    vision: place ? { place, site: site || '', siteHe: site ? HE[site] || site : '', destination: 9 } : null,
  });

  // GROUPED BY THE SEARCH, NOT BY THE JUDGE'S VERDICT PER SHOT.
  //
  // The first version of this required every shot to be individually placed and
  // never assembled once. Measured on a live run narrowed to one destination:
  // "meteora greece" returned eleven usable shots and the judge placed THREE.
  // That is placeMinConfidence working as designed - most frames of a cliff are
  // not identifiable as any particular cliff - and it is fatal to a rule that
  // wants six placed shots of one place.
  //
  // A cuts video burns a name onto every shot and must have them all. A montage
  // burns none, and its evidence that the shots are one place is that one
  // search for that place returned them.
  const meteora = [
    shot(1, 'meteora greece', 'Greece', 'Meteora'),
    shot(2, 'meteora greece', null),
    shot(3, 'meteora greece', null),
    shot(4, 'meteora greece', 'Greece', 'Meteora'),
    shot(5, 'meteora greece', null),
    shot(6, 'santorini greece', 'Greece', ''),
  ];
  const m = pickMontage(meteora, cfg);
  eq('it takes the biggest group from one search', m.cuts.length, 5);
  ok('and only that search', m.cuts.every((c) => c.query === 'meteora greece'));
  ok('including the shots the judge could not place', m.cuts.filter((c) => !c.vision).length === 3);
  eq('naming it from the ones it could', m.placed, 2);
  ok('with the site in Hebrew', /^\p{Script=Hebrew}/u.test(m.site), m.site);
  // The vision that will be PUBLISHED, returned whole from one real shot
  // rather than assembled from two fields of two different shots. Crossing them
  // put "גשר קרל, צ׳כיה" on the approval card and "קתדרלת סנט ויטוס, צ׳כיה" in
  // the caption of the same Prague montage.
  ok('it returns a real shot vision, not a synthetic one',
    m.cuts.some((c) => c.vision && c.vision.site === m.vision.site && c.vision.siteHe === m.vision.siteHe));
  ok('and the pin derives from it', /,/.test(clipPlaceLabel({ clip: { vision: m.vision } })),
    clipPlaceLabel({ clip: { vision: m.vision } }));

  // THE INVERSE OF pickCuts, on the same input, so the two cannot be quietly
  // merged into one function later. A cuts video needs distinct places and
  // finds one; a montage needs sameness and finds five.
  eq('the same shots make a cuts video of one place', pickCuts(meteora, { cutsMin: 3, cutsMax: 5, labelNeedsSite: true }).length, 0);
  eq('and a montage of five shots', m.cuts.length, 5);

  // A stray verdict does not rename the post. One frame in a Meteora search
  // read as Italy is the judge being wrong about one rock, and a majority is
  // what the pin rests on.
  const withStray = [
    shot(1, 'dolomites italy', 'Italy', 'Dolomites'),
    shot(2, 'dolomites italy', 'Italy', 'Dolomites'),
    shot(3, 'dolomites italy', 'Austria', ''),
    shot(4, 'dolomites italy', null),
  ];
  const stray = pickMontage(withStray, { cutsMin: 3, cutsMax: 12 });
  ok('a minority verdict does not name the post', !/אוסטריה/.test(stray.place), stray.place);

  // A site named by ONE shot out of many is a guess, not a group agreeing.
  const oneSite = [
    shot(1, 'iceland waterfall', 'Iceland', 'Skogafoss'),
    shot(2, 'iceland waterfall', 'Iceland', ''),
    shot(3, 'iceland waterfall', 'Iceland', ''),
    shot(4, 'iceland waterfall', 'Iceland', ''),
  ];
  const loose = pickMontage(oneSite, { cutsMin: 3, cutsMax: 12 });
  eq('one recognition out of four names no site', loose.site, null);
  ok('but the country still survives', Boolean(loose.vision?.place));
  ok('and the pin is the country alone',
    !/,/.test(clipPlaceLabel({ clip: { vision: loose.vision } }) || ''),
    clipPlaceLabel({ clip: { vision: loose.vision } }));

  // Too few from any one search is a REPORT naming the fix, not a crash.
  const thin = [shot(1, 'a', 'Greece', ''), shot(2, 'b', 'Italy', ''), shot(3, 'c', 'Spain', '')];
  eq('shots spread across searches build no montage', pickMontage(thin, cfg).cuts.length, 0);
  ok('and the reason names the best-covered search', /best-covered query is/.test(montageReason(thin, cfg)));
  ok('and the config dial that would fix it', /visionMaxCandidates|cutsMin/.test(montageReason(thin, cfg)));
  eq('an empty search builds nothing', pickMontage([], cfg).cuts.length, 0);

  // Nothing placed at all: no pin, no country hashtag, and the video still
  // builds. Same position a held clip is in when the judge is unsure.
  const unplaced = [shot(1, 'q', null), shot(2, 'q', null), shot(3, 'q', null)];
  const blind = pickMontage(unplaced, cfg);
  eq('an unplaced group still makes a montage', blind.cuts.length, 3);
  eq('it just has no vision to publish', blind.vision, null);
  eq('so no pin is printed', clipPlaceLabel({ clip: { vision: blind.vision } }), null);
  eq('and says nothing was confirmed', blind.placed, 0);
}

{
  // ONE OVERLAY FOR THE WHOLE VIDEO, which is the shape's defining property and
  // the thing a later "tidy-up" would most plausibly break by reusing burnCuts'
  // per-segment compositing. N identical PNGs would be N Chromium renders AND
  // N separate measurements, so a line that shifted band between shots would
  // jump while reading as unchanged.
  const overlay = readFileSync(new URL('../src/video/overlay.js', import.meta.url), 'utf8');
  const mont = overlay.slice(overlay.indexOf('export async function burnMontage'), overlay.indexOf('/** Pull the source clip down'));
  ok('burnMontage composites once, after the concat', /concat=n=\$\{segments\.length\}:v=1:a=0\[cat\];/.test(mont));
  ok('and takes one pngFile rather than one per segment', /pngFile/.test(mont) && !/seg\.pngFile/.test(mont));
  ok('with no window on it', !/enable='/.test(mont), 'the line must not change partway through');
  eq('so exactly one overlay is composited', (mont.match(/overlay=0:0:format=auto/g) || []).length, 1);

  // The single line is measured against EVERY shot, combined pessimistically.
  // A line measured on shot one and held over twelve is the failure this shape
  // has and the other two do not.
  const { combineSpots } = await import('../src/video/overlay.js');
  const spot = (y, contrast, shadow, assist) => ({
    x: 0.5, y, contrast, shadow, assist, onDark: true, color: '#fff',
    spread: { best: contrast, worst: contrast },
  });
  const combined = combineSpots([spot(0.25, 9, 0.1, 0), spot(0.26, 3.2, 0.8, 0.4), spot(0.24, 7, 0.2, 0.1)]);
  eq('the WORST contrast decides the treatment', combined.contrast, 3.2);
  eq('the heaviest shadow any shot asked for wins', combined.shadow, 0.8);
  eq('and the strongest wash', combined.assist, 0.4);
  eq('it counts shots, not frames', combined.frames, 3);
  eq('and how many agreed on the band', combined.agreed, 3);
  eq('nothing measurable means the default placement', combineSpots([null, null]), null);

  // A shot in the other band does not drag the agreed count silently.
  const split = combineSpots([spot(0.25, 9, 0, 0), spot(0.42, 2, 0, 0), spot(0.26, 8, 0, 0)]);
  eq('a shot in the other band is excluded from the band vote', split.agreed, 2);
  eq('but still counted as a shot', split.frames, 3);
  ok('so the card can say 2/3 and warn', split.agreed < split.frames);
}

/* -------------------------------------------------------------------------- */
group('a held clip never changes its text - not even to ask for a follow');

// THE OWNER'S RULE, AND IT HAS NOW BEEN BROKEN TWICE BY DIFFERENT CODE.
//
// First by `beats`: four or five lines gated to their own windows over one
// unbroken stock shot, which turned the footage into wallpaper for a caption
// rewriting itself. Reverted, and the reasoning written down above burnClip.
//
// Then by the closing frame, which is the same swap with a better motive - the
// hook for six seconds, a reason to follow for the last two. Every argument for
// it was true and it was still the text changing over a picture that never
// cuts, at the exact moment a viewer is deciding whether the eight seconds were
// worth it. The owner's instruction is that a single-shot clip keeps one line
// from the first frame to the last, in exchange for fewer follows.
//
// Twice is what makes this a test. The next person to notice that a held clip
// ends on nothing will be right about the reach and wrong about the post, and
// the argument is in overlay.js where a reader will only find it after the
// change is written. This fails first.
{
  const overlay = readFileSync(new URL('../src/video/overlay.js', import.meta.url), 'utf8');
  const held = overlay.slice(overlay.indexOf('export async function burnClip'), overlay.indexOf('export async function burnCuts'));

  ok('burnClip takes no closing-frame arguments', !/followText|followPngFile/.test(held));
  // The mechanism, not just the arguments. A second overlay gated by `enable`
  // IS the text changing, whatever the thing it switches to is called.
  ok('and burns exactly one overlay', (held.match(/overlay=0:0:format=auto/g) || []).length === 1, held.match(/overlay=[^[]*/g)?.join(' | '));
  ok('with no window on it', !/enable='/.test(held), "an `enable` window means the line changes partway through");
  // Two inputs: the footage and one PNG. A third would be another line.
  ok('and feeds ffmpeg one text image', (held.match(/'-i', pngFile/g) || []).length === 1);

  // The CUTS shape keeps its closing frame, and that is not an inconsistency:
  // there the line arrives with new footage under it, which is the condition
  // the whole rule is about. A test that killed both would be over-applying it.
  const cuts = readFileSync(new URL('../src/video/clip.js', import.meta.url), 'utf8');
  const cutBuild = cuts.slice(cuts.indexOf('export async function buildCutClip'), cuts.indexOf('export function nextShapes'));
  ok('a cuts clip still closes on a reason to follow', /followPng/.test(cutBuild));
  ok('and it is still one more CUT rather than a swap', /source: sources\[0\]/.test(cutBuild));

  // The description carries the reason on every post either way. That was never
  // the part in question and removing it here would be answering a different
  // instruction than the one given.
  const heldBuild = cuts.slice(cuts.indexOf('export async function buildClip'), cuts.indexOf('export async function buildCutClip'));
  ok('a held clip still draws a follow for its description', /const follow = captionFollow\(\)/.test(heldBuild));
  ok('and passes it to the caption', /clipCaption\(cand, \{ follow \}\)/.test(heldBuild));
  ok('but records no second for it', /followAt: null/.test(heldBuild));

  // And the approval card says WHICH kind of nothing, because three states look
  // identical in a Telegram video preview on a phone.
  const { followFrameLine } = await import('../src/video/clip.js');
  const follow = { askHe: 'תעקבו', whyHe: 'מחר יש עוד', lineHe: 'מחר יש עוד. תעקבו' };
  ok('a held clip says its line does not change',
    /לא מתחלפת/.test(followFrameLine({ clip: { shape: 'held', follow, followAt: null } })));
  ok('and still shows what the description closes on',
    followFrameLine({ clip: { shape: 'held', follow, followAt: null } }).includes(follow.lineHe));
  ok('a cuts clip names the second it starts',
    /מ-16ש׳/.test(followFrameLine({ clip: { shape: 'cuts', follow, followAt: 16 } })));
  ok('and the switch being off is still its own answer',
    /כבוי/.test(followFrameLine({ clip: { shape: 'cuts', follow: null, followAt: null } })));
}


/**
 * A giveaway, whatever post-config.json currently says.
 *
 * plans.giveaway.on is false now that igReplies replaces it, and eighteen
 * checks below used to be wrapped in `if (give)` and simply stopped running
 * when it went off. A test that silently does nothing is worse than a deleted
 * one: the count still looks healthy and the coverage is gone.
 *
 * So the giveaway PATH is tested from a fixture of the same shape
 * planGiveaway returns, and whether the SWITCH works is tested separately and
 * explicitly. Those are two questions and only one of them is about the config.
 */
function giveawayFixture() {
  return {
    on: true,
    winners: 5,
    premiumDays: 30,
    keyword: 'רומא',
    titleHe: 'חודש פרימיום במתנה',
    actionHe: 'תעקבו ותגיבו רומא',
    prizeHe: '5 מכם מקבלים 30 יום פרימיום',
    captionHe: 'תעקבו ותגיבו רומא, ו-5 מכם מקבלים 30 יום פרימיום',
    footHe: '',
  };
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
  const give = giveawayFixture();
  for (const [k, v] of Object.entries(text)) {
    if (typeof v === 'string') ok(`plan text ${k} is clean`, !hasLongDash(v), v);
  }
  {
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
  ok('the clip writer strips them', /stripDashes\(l\.text\)/.test(hooks));
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
  const give = giveawayFixture();

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

  // A SLIDE PER DAY ON BOTH NOW. TikTok used to get one per STOP - nineteen slides for
  // a four-day trip, each a photograph with a name and a line on it, each skippable in
  // half a second. That is the shape the five post types were built to replace, and
  // there was never a reason for it: TikTok takes 35 images, so the limit was not the
  // constraint; the stop list simply fell into it.
  eq('tiktok gets a slide per day', full.slides.length, plan.days.length + (give ? 2 : 1));
  eq('and so does instagram', short.slides.length, plan.days.length + (give ? 2 : 1));
  ok('and the Instagram set fits a carousel', short.slides.length + 1 <= 10);
  ok('both sets are the minimal deck style', full.style === 'minimal' && short.style === 'minimal');

  // The cover's emphasis has to be a SUBSTRING of the title or coverTitle
  // silently drops the colour — which is a slide that renders correctly and
  // looks like the accent was never configured.
  ok('the cover emphasis is inside the hook', full.titleHe.includes(full.idea.emphasisHe));

  // A day slide names its stops in order and totals them, which is what makes it a
  // summary of the same plan rather than a shorter, different plan.
  const first = full.slides[0];
  ok('a day slide names the day', first.nameHe.includes('יום'));
  ok('and its stops in order', first.bullets[0].text.includes('קולוסיאום'));
  ok('all of them', first.bullets[0].text.includes('הפורום'));
  ok('with the day total', first.bullets[0].text.includes('₪'));
  // The two sets are now the same slides, which is the point: one itinerary, drawn once.
  eq('both platforms get the same day slides', full.slides[0].nameHe, short.slides[0].nameHe);

  // stopSlide still carries a stop's every fact, for anything that draws one.
  const { stopSlide } = await import('../src/plan/slides.js');
  const oneStop = stopSlide(allStops(plan)[0], { flag: '🇮🇹' });
  ok('the time is on the name line', oneStop.nameHe.includes('09:00'));
  ok('and the place', oneStop.nameHe.includes('קולוסיאום'));
  ok('the price leads the note', oneStop.bullets[0].text.startsWith('80 ₪'));
  ok('and the note follows it', oneStop.bullets[0].text.includes('מזמינים מראש'));

  // The flag comes off the Hebrew country name, because that is what
  // destinations.json stores — there is no ISO code anywhere on a plan.
  eq('Italy gets its flag', flagForHebrew('איטליה'), '🇮🇹');
  eq('and an unknown country gets none', flagForHebrew('אטלנטיס'), null);

  // THE ASK IS ALL OR NOTHING. `giveaway.on: false` is how somebody stops
  // promising strangers a month of premium, and a slide that survived the
  // switch would keep making the promise after it was withdrawn.
  const noAsk = deckForSize(tripDecks(plan, { text, giveaway: null }), 'tiktok');
  eq('with the giveaway off there is no ask slide', noAsk.slides.length, plan.days.length + 1);

  // The templates are filled with the plan's own facts — an ask naming a
  // different city than the slides is the contradiction this kind is most
  // likely to ship, because both strings come from different places.
  ok('the hook names the destination', text.hookHe.includes('רומא'));
  ok('and the day count', text.hookHe.includes(String(plan.days.length)));
  ok('no placeholder survives filling', !/[{}]/.test([text.hookHe, text.askHe, text.dayLabelFor(1)].join(' ')));

  {
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
group('a plan with a number on the cover');

{
  const { parseTripArgs, shapeCosts, fixedTotal, budgetVerdict, breakdownLine, BUDGET_MIN } = await import(
    '../src/plan/budget.js'
  );
  const { tripDecks, deckForSize } = await import('../src/plan/slides.js');
  const { planText } = await import('../src/plan/text.js');
  const { planApprovalMessage } = await import('../src/plan/candidate.js');

  // THE ARGUMENT THAT USED TO BE SWALLOWED.
  //
  // The old parser took the last run of digits as days whatever it was, so
  // "/trip פראג 5 1200" planned a trip to a place called "פראג 5" for 1200
  // days, clamped to 5, and dropped the budget without a word. It looked like
  // it had worked, which is why this is the first thing tested.
  const p = (s) => parseTripArgs(s);
  eq('a destination, days and a budget', JSON.stringify(p('פראג 5 1200')),
    JSON.stringify({ asked: 'פראג', days: 5, budgetIls: 1200, error: null }));
  eq('the budget alone', p('פראג 1200').budgetIls, 1200);
  eq('and it does not become the day count', p('פראג 1200').days, null);
  eq('days alone still mean days', p('רומא 5').days, 5);
  eq('with no budget attached', p('רומא 5').budgetIls, null);
  eq('a bare number is days, as it always was', p('5').days, 5);

  // The split is at the budget floor, NOT at the day ceiling. /trip רומא 7 has
  // always meant seven days clamped to five, and a parser that called it a
  // seven shekel budget would turn a working command into an error.
  eq('a day count over the maximum is still days', p('רומא 7').days, 7);
  eq('and is not mistaken for money', p('רומא 7').budgetIls, null);

  // An explicit mark beats the magnitude, so a number that is obviously money
  // is refused for being too small rather than silently planned as days.
  ok('a marked number under the floor is refused', Boolean(p('פראג ב-300').error));
  eq('and no budget comes back from it', p('פראג ב-300').budgetIls, null);
  eq('a shekel sign is read as money', p('פראג 5 1200₪').budgetIls, 1200);
  eq('and so is a grouped number', p('פראג 5 1,200').budgetIls, 1200);
  ok('two budgets are refused', Boolean(p('פראג 1200 1500').error));
  eq('nothing at all is not an error', p('').error, null);

  // THE COSTS, which are the difference between this and a plain /trip.
  const good = { flightIls: 420, lodgingIls: 300, foodIls: 280, transitIls: 60 };
  eq('four lines sum to the fixed cost', fixedTotal(good), 1060);
  ok('a good set survives', shapeCosts(good, { days: 5 }).costs !== null);
  // A trip with no flight and no bed is a day out. Both are the model
  // satisfying a cap by deleting the two largest numbers on the page.
  ok('a free flight is refused', Boolean(shapeCosts({ ...good, flightIls: 0 }, { days: 5 }).bad));
  ok('a free bed is refused', Boolean(shapeCosts({ ...good, lodgingIls: 0 }, { days: 5 }).bad));
  // Food is per trip, not per day, and confusing the two is a factor of five.
  ok('food priced per day is refused', Boolean(shapeCosts({ ...good, foodIls: 60 }, { days: 5 }).bad));
  ok('and an absurd flight is refused', Boolean(shapeCosts({ ...good, flightIls: 99999 }, { days: 5 }).bad));

  // THE VERDICT. Over is the only failing direction a reader can catch from
  // the screen, and thin is the one they catch from experience.
  ok('under budget is fine', !budgetVerdict(1188, 1200).over);
  eq('and says what is left', budgetVerdict(1188, 1200).left, 12);
  ok('exactly on budget is not over', !budgetVerdict(1200, 1200).over);
  ok('over budget fails', budgetVerdict(1340, 1200).over);
  ok('and a plan too cheap to be true fails too', budgetVerdict(300, 1200).thin);
  ok('no budget means no verdict', !budgetVerdict(1188, null).on);

  // One line, because a minimal slide renders exactly one bullet.
  const line = breakdownLine(good, 128, { attractionsHe: 'כניסות' });
  eq('the breakdown is a single line', line.split('\n').length, 1);
  ok('and carries all five figures', ['420', '300', '280', '60', '128'].every((n) => line.includes(n)));

  const budgeted = {
    id: 'testplan0002',
    dest: { id: 'prague', he: 'פראג', en: 'Prague', country: "צ'כיה" },
    days: [
      { n: 1, titleHe: 'העיר העתיקה', stops: [
        { timeHe: '09:30', nameHe: 'גשר קארל', nameEn: 'Charles Bridge', noteHe: 'מוקדם בבוקר', costIls: 0 },
        { timeHe: '13:00', nameHe: 'טירת פראג', nameEn: 'Prague Castle', noteHe: 'כרטיס משולב', costIls: 110 },
      ] },
      { n: 2, titleHe: 'העיר החדשה', stops: [
        { timeHe: '10:00', nameHe: 'כיכר ואצלב', nameEn: 'Wenceslas Square', noteHe: 'הליכה קצרה', costIls: 18 },
      ] },
    ],
    stopsIls: 128,
    costs: good,
    budgetIls: 1200,
    left: 12,
    total: 1188,
  };
  const plain = { ...budgeted, costs: null, budgetIls: null, left: undefined, total: 128, stopsIls: 128 };

  // THE PAIRING THAT MUST BE UNREACHABLE: a cover promising a trip for 1,200 ₪
  // over a total slide explaining the figure excludes the flight. Both strings
  // are chosen off one flag so the wrong combination cannot be assembled.
  const bText = planText(budgeted);
  const pText = planText(plain);
  ok('a budgeted cover carries the number', bText.hookHe.includes('1,200'));
  ok('and says how many days and where', bText.hookHe.includes('פראג'));
  ok('a plain cover does not invent one', !/\d,\d{3}/.test(pText.hookHe));
  ok('the budgeted total says everything is included', bText.totalNoteHe.includes('טיסה'));
  ok('the plain total says the opposite', pText.totalNoteHe.includes('בלי טיסה'));
  ok('and the two are never the same sentence', bText.totalNoteHe !== pText.totalNoteHe);
  ok('what is left over is said', bText.leftHe.includes('12'));
  // "נשאר 0 ₪" is a sentence nobody writes.
  ok('landing exactly on the number reads as that',
    !planText({ ...budgeted, left: 0, total: 1200 }).leftHe.includes('0 ₪'));

  // THE SLIDES. The itemisation is the argument and the total is the
  // conclusion, so the order between them is load bearing.
  const bDecks = tripDecks(budgeted, { text: bText, giveaway: null });
  const bFull = deckForSize(bDecks, 'tiktok');
  const names = bFull.slides.map((s) => s.nameHe);
  const iBreak = names.findIndex((n) => n === bText.breakdownLabelHe);
  const iTotal = names.findIndex((n) => n.includes('1,188'));
  ok('the breakdown is a slide', iBreak >= 0);
  ok('and it comes before the total', iBreak >= 0 && iTotal >= 0 && iBreak < iTotal);
  ok('the total slide shows what is left', bFull.slides[iTotal].bullets[0].text.includes('12'));
  ok('the coloured phrase on the cover is the number', bFull.idea.emphasisHe.includes('1,200'));
  ok('and it is a substring of the title it colours', bFull.titleHe.includes(bFull.idea.emphasisHe));

  const pFull = deckForSize(tripDecks(plain, { text: pText, giveaway: null }), 'tiktok');
  ok('a plain plan grows no breakdown slide',
    !pFull.slides.some((s) => s.nameHe === pText.breakdownLabelHe));

  // Instagram takes ten images and the breakdown is an eleventh candidate. A
  // five day plan is the longest this config can ask for, so that is the one
  // worth counting: cover, five days, breakdown, total and an ask.
  const long = {
    ...budgeted,
    days: [1, 2, 3, 4, 5].map((n) => ({ n, titleHe: `יום ${n}`, stops: budgeted.days[0].stops })),
  };
  const longShort = deckForSize(tripDecks(long, { text: planText(long), giveaway: null }), 'instagram');
  ok('the longest budgeted plan still fits a carousel', longShort.slides.length + 1 <= 10,
    `${longShort.slides.length + 1} images`);

  // THE APPROVAL CARD. Every figure that becomes the account's claim is
  // printed before the tap, which is the bargain BRIEF.md struck when the fare
  // ban came off, and the itemisation is the only place it can be audited.
  const card = planApprovalMessage({
    headline: bText.hookHe,
    plan: {
      dest: budgeted.dest, days: 2, stops: 3, total: 1188,
      budgetIls: 1200, costs: good, stopsIls: 128,
      totalNoteHe: bText.totalNoteHe, leftHe: bText.leftHe, attractionsHe: bText.attractionsHe,
      slides: { tiktok: 7, instagram: 5 }, dropped: [], giveaway: null,
    },
    deck: { days: budgeted.days },
  });
  ok('the card prints the budget', card.includes('1,200'));
  ok('and every fixed cost under it', ['420', '300', '280', '60'].every((n) => card.includes(n)));
  ok('and what is left', card.includes('נשאר 12'));
  ok('and no longer claims entrances only', !card.includes('כניסות ואטרקציות בלבד'));
}

/* -------------------------------------------------------------------------- */
group('the itinerary the site publishes');

{
  const site = await import('../src/plan/site.js');
  const { planText } = await import('../src/plan/text.js');
  const { tripDecks, deckForSize } = await import('../src/plan/slides.js');
  const { publishedSlideCount, hasSiteSlide, hasFollowSlide, siteSlideFor } = await import('../src/deck/follow.js');

  // A city exactly as /api/cities returns one, trimmed to what this reads.
  // Five stops a day, which is what the real pages carry and one more than a
  // slide set holds, and a short final day, which is what Prague actually has.
  const city = {
    slug: 'prague',
    name: 'פראג',
    itinerary: [
      { day: 1, title: 'העיר העתיקה', placeIds: ['a', 'b', 'c', 'd', 'kosher'] },
      { day: 2, title: 'המצודה', placeIds: ['e', 'f', 'g', 'h'] },
      { day: 3, title: 'יום קצר', placeIds: ['i', 'j'] },
      { day: 4, title: 'אחרי הקצר', placeIds: ['a', 'b', 'c', 'd'] },
    ],
    places: [
      { id: 'a', name: 'גשר קארל', nameLocal: 'Charles Bridge', category: 'historic', priceLevel: 0, durationMin: 45 },
      { id: 'b', name: 'טירת פראג', nameLocal: 'Prague Castle', category: 'historic', priceLevel: 2, durationMin: 210 },
      { id: 'c', name: 'המוזיאון', nameLocal: 'National Museum', category: 'museum', priceLevel: 1, durationMin: 120 },
      { id: 'd', name: 'כיכר ואצלב', nameLocal: 'Wenceslas Square', category: 'attraction', priceLevel: 0 },
      { id: 'e', name: 'סטרהוב', nameLocal: 'Strahov', category: 'historic', durationMin: 90 },
      { id: 'f', name: 'מאלה סטראנה', nameLocal: 'Mala Strana', category: 'historic', durationMin: 60 },
      { id: 'g', name: 'פטרשין', nameLocal: 'Petrin', category: 'nature', durationMin: 120 },
      { id: 'h', name: 'לטנה', nameLocal: 'Letna', category: 'viewpoint', durationMin: 45 },
      { id: 'i', name: 'קוטנה הורה', nameLocal: 'Kutna Hora', category: 'historic', durationMin: 400 },
      { id: 'j', name: 'סדלץ', nameLocal: 'Sedlec', category: 'historic', durationMin: 60 },
      { id: 'kosher', name: 'דיניץ', nameLocal: 'Dinitz', category: 'kosher-food', durationMin: 60 },
    ],
  };
  const cfg = { days: 4, daysMin: 3, daysMax: 5, stopsMin: 3, stopsMax: 4, source: { prefer: 'site', minDays: 3 } };
  const built = site.planDaysFrom(city, { days: 5, stopsMin: cfg.stopsMin, stopsMax: cfg.stopsMax });

  // STOPS AT THE SHORT DAY, DOES NOT SKIP IT. Day 3 has two stops and the
  // floor is three, so the plan is two days. Skipping it and taking day 4
  // would renumber the rest, and the post would then disagree with the page it
  // is advertising about what יום 3 is.
  eq('the plan stops at the first short day', built.days.length, 2);
  ok('and says why', built.dropped.some((d) => d.includes('יום 3')));
  eq('the day numbers are the site’s own', built.days.map((d) => d.n).join(','), '1,2');

  // THE KOSHER SWAP. Day 1 has five stops with the kosher one fifth, so taking
  // the first four in order would drop it. It is the strongest Israeli angle
  // on the page and the site only marks a place kosher where supervision was
  // reported, so it replaces the last kept stop instead.
  const day1 = built.days[0].stops.map((s) => s.nameHe);
  eq('a day is cut to the slide limit', day1.length, 4);
  ok('and the kosher place is swapped in', day1.includes('דיניץ'), day1.join(' '));
  ok('replacing the last stop, not appending', !day1.includes('כיכר ואצלב'), day1.join(' '));
  // A day already carrying one is left alone rather than given a second.
  const already = site.stopsForDay(['kosher', 'a', 'b', 'c', 'd'], new Map(city.places.map((p) => [p.id, p])), { stopsMax: 4 });
  eq('a day that already has one is untouched', already.map((p) => p.id).join(','), 'kosher,a,b,c');

  // NO INVENTED NUMBERS. The site has a price BAND and no times at all.
  const stops = built.days.flatMap((d) => d.stops);
  ok('no stop carries a time', stops.every((s) => s.timeHe === null));
  ok('and none carries a price', stops.every((s) => s.costIls === null));
  // null rather than 0, because 0 renders as חינם, which is a claim that
  // somebody checked. Nobody checked; the site publishes a band.
  ok('not even zero', stops.every((s) => s.costIls !== 0));

  // The note is built from the site's own facts.
  eq('free entry is said', site.noteFor(city.places[0]), 'אתר היסטורי · כניסה חופשית');
  eq('a visit length is said the way people say it', site.noteFor(city.places[4]), 'אתר היסטורי · כשעה וחצי');
  eq('a paid place shows its length, not its band', site.noteFor(city.places[1]), 'אתר היסטורי · חצי יום');
  eq('minutes are never printed', site.durationHe(45), 'כשעה');
  eq('and neither is a band', site.noteFor({ category: 'museum', priceLevel: 3 }), 'מוזיאון');
  // An unknown category contributes nothing rather than printing English onto
  // a Hebrew slide, which is the rule deck/hebrew.js applies to names.
  eq('an unknown category is left out', site.noteFor({ category: 'nightlife', durationMin: 60 }), 'כשעה');

  // The slug, from the row, with the override winning.
  eq('the id is the slug', site.siteSlugFor({ id: 'prague', en: 'Prague' }), 'prague');
  eq('an override wins', site.siteSlugFor({ id: 'nyc', siteSlug: 'new-york', en: 'New York' }), 'new-york');
  eq('the English name is the fallback', site.siteSlugFor({ en: 'Lake Como' }), 'lake-como');

  // THE COVER SAYS WHOSE PLAN IT IS. "ביקשתי מ-AI" on a post carrying the
  // site's own itinerary is false, and false in the direction that costs
  // traffic: it argues against opening the page.
  const plan = {
    id: 'sitetest01',
    source: 'site',
    slug: 'prague',
    url: 'https://www.tiyulplus.com/destinations/prague',
    dest: { id: 'prague', he: 'פראג', en: 'Prague', country: 'צ׳כיה' },
    days: built.days,
    priced: false,
    total: null,
    stopsIls: null,
    costs: null,
    budgetIls: null,
  };
  const text = planText(plan);
  ok('a site plan says it is the site’s', text.hookHe.includes('טיול+'), text.hookHe);
  ok('and never says an AI wrote it', !text.hookHe.includes('AI'), text.hookHe);
  ok('it is flagged unpriced', text.priced === false);

  const decks = tripDecks(plan, { text, giveaway: null });
  const full = deckForSize(decks, 'tiktok');
  const short = deckForSize(decks, 'instagram');

  // NO TOTAL SLIDE, because the slide's whole content is a number and there is
  // no number. Not an empty one and not a zero.
  ok('there is no total slide', !full.slides.some((s) => /₪/.test(s.nameHe || '')), full.slides.map((s) => s.nameHe).join(' | '));
  ok('and no day subtotal either', !short.slides.some((s) => /₪/.test(s.bullets?.[0]?.text || '')));
  // A day slide on an unpriced plan names its stops and nothing else: no subtotal,
  // because there are no prices to total, and no "חינם" in front of anything - the site
  // publishes a price BAND and חינם is a claim that somebody checked.
  ok('a day slide names its stops', full.slides[0].bullets[0].text.includes(built.days[0].stops[0].nameHe));
  ok('with no price anywhere on it', !/₪|חינם/.test(full.slides[0].bullets[0].text));

  // THE SLIDE COUNT INCLUDES THE SITE SLIDE, and it replaces the follow ask
  // rather than joining it. Two closing slides is two asks on one post.
  ok('the deck knows it has a page', hasSiteSlide(full));
  ok('so it does not also get a follow slide', !hasFollowSlide(full));
  eq('the count includes it', publishedSlideCount(short), 1 + short.slides.length + 1);

  // ONE CLOSING SLIDE, FROM ONE FUNCTION. The renderer used to compose its own
  // tail out of the predicates above and got a different answer from the count:
  // it appended the follow ask AND the site slide, so a site deck published one
  // more slide than publishedSlideCount promised. Which matters beyond the extra
  // ask - renderPlan checks that count against Instagram's ten, so an
  // eleven-slide carousel passed a check for ten and Instagram rejected it hours
  // after approval. Both now read closingSlidesFor.
  const { closingSlidesFor } = await import('../src/deck/follow.js');
  const closeSite = closingSlidesFor(full, { size: 'tiktok', destHe: 'פראג', replies: { on: false } });
  eq('a site deck closes on exactly one slide', closeSite.length, 1);
  ok('and it is the page, not the follow ask', closeSite[0].site === true && !closeSite[0].follow);
  const plainOne = closingSlidesFor({ where: 'רומא', slides: [{ nameHe: 'x' }], coverImage: null });
  eq('a deck with no page closes on exactly one too', plainOne.length, 1);
  ok('and that one is the follow ask', plainOne[0].follow === true);
  const askOne = closingSlidesFor({ where: 'רומא', slides: [{ nameHe: 'x', ask: true }] });
  eq('a deck already ending on an ask gets none', askOne.length, 0);
  // The count IS the length of that list, for every shape, rather than
  // arithmetic over the same predicates that could drift from it again.
  for (const [what, d] of [
    ['a site deck', full],
    ['a plain deck', { where: 'רומא', slides: [{ nameHe: 'x' }, { nameHe: 'y' }] }],
    ['one ending on an ask', { where: 'רומא', slides: [{ nameHe: 'x', ask: true }] }],
  ]) {
    eq(`the count matches the drawn list - ${what}`, publishedSlideCount(d), 1 + d.slides.length + closingSlidesFor(d).length);
  }
  // The count has to run with no browser anywhere near it: renderPlan checks
  // it against Instagram's ten before rendering, and follow.js must not pull
  // the renderer in behind it.
  const followSrc = readFileSync(new URL('../src/deck/follow.js', import.meta.url), 'utf8');
  ok('and follow.js imports no renderer', !/from '\.\.\/render\//.test(followSrc), 'follow.js now needs a browser');

  // The words differ by platform because the platforms differ in what can
  // honestly be promised. TikTok has no route from a comment to a link.
  const tk = siteSlideFor(full, { size: 'tiktok', destHe: 'פראג', replies: { on: true } });
  const ig = siteSlideFor(full, { size: 'instagram', destHe: 'פראג', replies: { on: true } });
  const igOff = siteSlideFor(full, { size: 'instagram', destHe: 'פראג', replies: { on: false } });
  ok('the title names the destination', tk.titleHe.includes('פראג'));
  ok('TikTok points at the bio', tk.ctaHe.includes('בביו'));
  ok('Instagram asks for a comment when replies are on', ig.ctaHe.includes('תגיבו'));
  ok('and points at the bio when they are off', igOff.ctaHe.includes('בביו'));
  ok('no slide text carries a URL', ![tk, ig].some((s) => /https?:|www\.|\.com/.test(`${s.titleHe} ${s.noteHe} ${s.ctaHe}`)));
  ok('a deck with no page gets no site slide', siteSlideFor({ where: 'רומא' }) === null);

  // THE SWITCH, tested separately from the giveaway's own behaviour.
  //
  // The eighteen checks on what a giveaway LOOKS like now run off a fixture
  // (giveawayFixture) so they keep running with the feature off. That leaves
  // exactly one thing the config decides, and this is it: whether the promise
  // is made at all. It is off because igReplies replaces it - the giveaway
  // asked for a comment and offered a month of premium that nothing here could
  // hand out, and the replacement asks for the same comment and sends the
  // thing it promised.
  const { planGiveaway } = await import('../src/plan/text.js');
  const { postConfig: cfgNow } = await import('../src/postConfig.js');
  eq('the giveaway is off', cfgNow().plans.giveaway.on, false);
  eq('so no plan carries one', planGiveaway(plan), null);
  // And with it off, a plan that has no site page falls back to the ordinary
  // follow slide rather than closing on nothing.
  const plain = { ...plan, source: 'ai', slug: null, priced: true, total: 0 };
  const plainDeck = deckForSize(tripDecks(plain, { text: planText(plain), giveaway: null }), 'tiktok');
  ok('a plain plan still closes on a follow ask', hasFollowSlide(plainDeck));
}

/* -------------------------------------------------------------------------- */
group('the caption points at the page');

{
  const { captionCta } = await import('../src/hashtags.js');
  const { postConfig } = await import('../src/postConfig.js');

  // The 1-in-6 problem this replaces: one of six pool entries mentions the bio
  // and none says what is there, so a post about a city we cover mentioned the
  // site about one time in six. With a page, the ask is not drawn at all.
  const bio = captionCta({ siteSlug: 'prague', destHe: 'פראג', target: 'tiktok', rand: () => 0.99 });
  ok('a site post always gets the site ask', Boolean(bio));
  ok('and it names the destination', bio.includes('פראג'), bio);
  ok('even when the random draw would have skipped one', !postConfig().caption.ctas.includes(bio));

  // Instagram may ask for a comment ONLY when something answers comments.
  const off = captionCta({ siteSlug: 'prague', destHe: 'פראג', target: 'instagram', rand: () => 0.99 });
  ok('with replies off Instagram points at the bio too', off.includes('בביו'), off);

  // No URL, ever, in either of them. Same rule as every other published string.
  for (const line of [postConfig().caption.siteCtaBioHe, postConfig().caption.siteCtaDmHe]) {
    ok(`the site ask carries no URL: ${line.slice(0, 24)}`, !/https?:|www\.|\.com|\.co\.il/.test(line));
  }

  // Without a page nothing changes: the pool and its share still decide.
  eq('no page means the old behaviour', captionCta({ rand: () => 0.99, share: 0 }), null);
}

/* -------------------------------------------------------------------------- */
group('a plan with no prices prints no prices');

{
  const { planApprovalMessage, fillPlanPhotos } = await import('../src/plan/candidate.js');

  // THE CARD IS THE ONLY PLACE A SITE PLAN CAN BE DISAGREED WITH, which is what
  // made this the worst place to be wrong. Every stop read "· חינם" and the foot
  // read "סה״כ 0 ₪", so the card asserted eighteen times that somebody had
  // checked and found the whole trip free. The slides said none of that: they
  // carry no total slide at all, by design, because the site publishes a price
  // BAND and a band is not a price.
  const days = [
    {
      n: 1,
      titleHe: 'העיר העתיקה',
      stops: [
        { nameHe: 'גשר קארל', noteHe: 'אתר היסטורי · כניסה חופשית', costIls: null, timeHe: null },
        { nameHe: 'טירת פראג', noteHe: 'אתר היסטורי · חצי יום', costIls: null, timeHe: null },
      ],
    },
  ];
  const base = {
    headline: '4 ימים בפראג, המסלול של טיול+',
    tiktokCaption: 'x\n\n#טיול',
    deck: { days },
    plan: {
      dest: { he: 'פראג' }, days: 1, stops: 2, source: 'site', slug: 'prague',
      url: 'https://www.tiyulplus.com/destinations/prague', siteSlide: true,
      priced: false, total: null, stopsIls: null, costs: null, budgetIls: null,
      totalNoteHe: 'כניסות ואטרקציות בלבד, בלי טיסה ולינה', leftHe: '', attractionsHe: 'כניסות',
      slides: { tiktok: 4 }, dropped: [], giveaway: null,
    },
  };
  const unpriced = planApprovalMessage(base);
  ok('no shekel sign anywhere on the card', !unpriced.includes('₪'), unpriced.split('\n').find((l) => l.includes('₪')));
  ok('and no stop is called free', !unpriced.includes('חינם'), unpriced.split('\n').find((l) => l.includes('חינם')));
  ok('the stop count is still printed', unpriced.includes('2 עצירות'));
  ok('and it says why there are no prices', unpriced.includes('רמת מחיר'));
  // The entrances-only disclaimer qualifies a total. Printed under a line saying
  // there is no total, it is the card arguing with itself.
  ok('the total disclaimer is gone with the total', !unpriced.includes('כניסות ואטרקציות בלבד'));
  // The stops themselves still have to be readable - that is the card's job.
  ok('every stop is still listed', ['גשר קארל', 'טירת פראג'].every((n) => unpriced.includes(n)));
  ok('with its note', unpriced.includes('כניסה חופשית'));

  // A PRICED PLAN IS UNTOUCHED. The fix must not quietly remove the figures from
  // the one shape where printing them is the whole bargain BRIEF.md struck when
  // the fare ban came off.
  const priced = planApprovalMessage({
    ...base,
    deck: { days: [{ ...days[0], stops: [{ ...days[0].stops[0], costIls: 0 }, { ...days[0].stops[1], costIls: 450 }] }] },
    plan: { ...base.plan, source: 'ai', priced: true, total: 450, stopsIls: 450 },
  });
  ok('a priced plan still prints its total', priced.includes('סה״כ 450 ₪'), priced.split('\n').find((l) => l.includes('סה״כ')));
  ok('and still calls a zero stop free', priced.includes('חינם'));
  ok('and still carries the disclaimer', priced.includes('כניסות ואטרקציות בלבד'));
  // A candidate staged before `priced` existed is an AI plan, and reads as one.
  const legacy = planApprovalMessage({ ...base, plan: { ...base.plan, priced: undefined, total: 450, source: 'ai' } });
  ok('a card with no `priced` field falls back to priced', legacy.includes('₪'));

  // AND THE TOTAL IS NEVER RECOMPUTED INTO EXISTENCE.
  //
  // This is where the 0 came from. The photo step re-sums the days because a stop
  // that lost its picture leaves and the arithmetic has to describe what survived
  // - but summing a column of nulls is 0, and 0 renders as חינם. One line, one
  // shape of plan it was never asked about.
  //
  // WITH THE LIBRARIES SWITCHED OFF FOR THE DURATION, which is what keeps this
  // offline. cinematicImage returns null the moment neither Pexels nor Unsplash is
  // configured, before any request leaves, so every stop loses its photograph and
  // every day is dropped. That is the harshest version of the case: nothing
  // survives, the sum runs over an empty list, and the answer still has to be
  // null rather than zero.
  {
    const keys = {
      PEXELS_API_KEY: process.env.PEXELS_API_KEY,
      UNSPLASH_ACCESS_KEY: process.env.UNSPLASH_ACCESS_KEY,
      DECK_SOURCED_IMAGES: process.env.DECK_SOURCED_IMAGES,
    };
    delete process.env.PEXELS_API_KEY;
    delete process.env.UNSPLASH_ACCESS_KEY;
    // AND THE SOURCED PATH, which needs no key and would otherwise keep this online.
    // Commons geosearch is tried before either stock library (see sourcedImage), so
    // unsetting the two keys no longer makes cinematicImage return null before any
    // request leaves. This case is specifically "nothing could be photographed", so it
    // has to switch that off too rather than quietly depend on the network.
    process.env.DECK_SOURCED_IMAGES = 'off';
    try {
      const shape = (priced) => ({
        priced,
        dest: { en: 'Prague', he: 'פראג' },
        days: [{ n: 1, titleHe: 'x', stops: days[0].stops.map((s, i) => ({ ...s, costIls: priced ? i * 30 : null })) }],
      });
      const after = await fillPlanPhotos(shape(false), { stopsMin: 1 });
      eq('an unpriced plan keeps a null total', after.total, null);
      ok('and says every stop lost its photograph', after.dropped.length >= 2, JSON.stringify(after.dropped));
      // A priced plan still gets a number, and 0 is the right number when nothing
      // survived: the sum of no stops. The distinction the fix draws is between
      // "no stops" and "no prices", which used to print identically.
      eq('a priced one is still summed', (await fillPlanPhotos(shape(true), { stopsMin: 1 })).total, 0);
    } finally {
      Object.assign(process.env, keys);
    }
  }
}

/* -------------------------------------------------------------------------- */
group('a deck built from our own page points at it');

{
  const { slugFromUrl } = await import('../src/sources/tiyulplus.js');
  const { hasSiteSlide } = await import('../src/deck/follow.js');

  // THE STAMP IS THE ANSWER. Every slide a site deck carries records the page it
  // was built from, and that stamp is the only thing that survives the whole
  // build - the shortlist, the filter, the image step, the cover. So it is what
  // the deck's `siteSlug` is read off, rather than a variable that would keep
  // claiming the page the build set out to use.
  eq('the slug comes out of the page URL', slugFromUrl('https://www.tiyulplus.com/destinations/prague'), 'prague');
  eq('a trailing slash is fine', slugFromUrl('https://www.tiyulplus.com/destinations/new-york/'), 'new-york');
  eq('and a query string', slugFromUrl('https://www.tiyulplus.com/destinations/abu-dhabi?x=1'), 'abu-dhabi');
  // Anything that is not one of our destination pages is not one. The map route's
  // slides carry an official website; a freeform deck's carry nothing.
  for (const url of ['https://www.prague.eu/en', 'https://www.tiyulplus.com/about', null, '', 'https://www.tiyulplus.com/destinations/']) {
    eq(`not a destination page: ${JSON.stringify(url)}`, slugFromUrl(url), null);
  }

  // A deck that HAS the field closes on the page. Until this shipped nothing
  // ever set it on a deck, so the one route that knows for certain the page
  // exists - because it just parsed it - was the route closing on "רוצים עוד?
  // תעקבו" and advertising nothing.
  ok('a deck with the slug knows it has a page', hasSiteSlide({ siteSlug: 'prague' }));
  ok('and one without does not', !hasSiteSlide({ where: 'פראג' }));
}

/* -------------------------------------------------------------------------- */
group('every siteSlug is a page that exists');

{
  // CHECKED AGAINST A SAVED COPY, not against the live API. A test that needs
  // the internet is a test that fails on a train and then gets deleted; and the
  // failure mode being guarded here is a TYPO in destinations.json, which a
  // snapshot catches exactly as well as a live call.
  const saved = JSON.parse(readFileSync(new URL('../assets/site/cities.json', import.meta.url), 'utf8'));
  const rows = JSON.parse(readFileSync(new URL('../destinations.json', import.meta.url), 'utf8')).destinations;
  const known = new Map(saved.options.map((o) => [o.slug, o]));

  ok('the saved slug list is there', known.size > 100, `${known.size} slugs`);
  const mapped = rows.filter((r) => r.siteSlug);
  ok('and rows are mapped with it', mapped.length >= 24, `${mapped.length} mapped`);

  for (const row of mapped) {
    ok(`${row.id} -> ${row.siteSlug} exists`, known.has(row.siteSlug), 'no such page on the site');
  }

  // THE COUNTRY HAS TO AGREE. A valid slug for the wrong country is the mapping
  // error a slug check cannot see: `nice -> nice-riviera` and `nice -> nicosia`
  // both resolve, and one of them sends everybody who taps through to Cyprus.
  // The catalogue and the site spell a few countries differently, so this
  // compares on the site's own Hebrew name with the known aliases allowed.
  const ALIAS = { 'ארה״ב': 'ארצות הברית' };
  for (const row of mapped) {
    const want = ALIAS[row.country] || row.country;
    eq(`${row.id} is in the country the catalogue says`, known.get(row.siteSlug).country, want);
  }

  // No two rows may claim the same page. Two destinations closing on one page is
  // two posts advertising the same thing, and the repeat detector - which keys on
  // the destination - cannot see it.
  const byslug = new Map();
  for (const row of mapped) byslug.set(row.siteSlug, [...(byslug.get(row.siteSlug) || []), row.id]);
  const shared = [...byslug].filter(([, ids]) => ids.length > 1);
  ok('no page is claimed twice', shared.length === 0, shared.map(([s, ids]) => `${s}: ${ids.join('+')}`).join(', '));
}

/* -------------------------------------------------------------------------- */
group('the voice - a planner who has not been anywhere');

{
  const { claimsExperience, assertNoExperience, assertNoFiller, quoted, line, assertPostVoice, VoiceError } =
    await import('../src/posts/voice.js');

  // THE GUARD THAT NEVER FIRED, AND WHY IT IS THE FIRST THING TESTED HERE.
  //
  // The first version of this used \b, which is defined on ASCII word characters.
  // Hebrew letters are not among them, so in /\bהיינו\b/ the "boundary" sits between a
  // space and a Hebrew letter - two non-word characters, no boundary at all. Every
  // pattern tested false against the exact sentence it was written to refuse. Nothing
  // failed, nothing logged, and the most important honesty check in this change was
  // dead for as long as nobody wrote this test.
  for (const s of [
    'היינו שם בקיץ',
    'כשהיינו בפראג התחלנו מוקדם',
    'טסנו לשם באוגוסט',
    'אכלנו במסעדה הזאת',
    'ביקרנו בטירה',
    'הייתי שם',
    'מניסיון, כדאי להזמין מראש',
    'בטיול שלנו לרומא',
    'וטסנו לשם',
  ]) {
    ok(`refused: ${s}`, claimsExperience(s), 'the experience guard did not fire');
  }

  // AND THE VOICE IT MUST NOT REFUSE, which is the whole point of the distinction.
  //
  // "ככה היינו בונים את זה" is a planner talking about a plan. It is true - building
  // itineraries is what the site does - and it is the exact sentence the brief names as
  // the honest version of personal. It begins with the same word as "היינו שם", so the
  // conditional is whitelisted by the verb that follows rather than the experience being
  // guessed at from context.
  for (const s of [
    'ככה היינו בונים את זה',
    'המסלול שהיינו בונים לחבר שטס לפראג',
    'היינו ממליצים על יומיים',
    'מה הייתם מוסיפים?',
    'הייתם שם?',
    'תתחילו מוקדם, העיר העתיקה עמוסה',
    'שמרו את זה לטיול',
  ]) {
    ok(`allowed: ${s}`, !claimsExperience(s), 'the guard refused the planner voice');
  }

  throws('assertNoExperience throws rather than warning', () => assertNoExperience('היינו שם', 'a slide'), 'invented_experience');

  // Filler and markup artefacts. The flop post gave itself away with leftover
  // markdown asterisks in its caption; the em dash is banned project-wide.
  for (const s of ['פראג מושלמת', 'נוף עוצר נשימה', 'יעד קסום']) {
    throws(`filler refused: ${s}`, () => assertNoFiller(s, 'a slide'), 'filler');
  }
  for (const s of ['פראג — עיר יפה', '**פראג**', 'ימים ב{dest}']) {
    throws(`artefact refused: ${s.slice(0, 14)}`, () => assertNoFiller(s, 'a slide'), 'artefact');
  }
  ok('an ordinary line passes both', assertNoFiller(assertNoExperience('העיר העתיקה עמוסה מאוד', 'x'), 'x').length > 0);

  // EVERY OPINION IS A QUOTE. The rule that makes it safe for these posts to have
  // opinions at all: the judgement is the site's and the assertion is that we did not
  // write it.
  const page = 'אחת הערים היפות באירופה. חסרונות: העיר העתיקה עמוסה מאוד כמעט כל השנה.';
  eq('a verbatim quote passes', quoted('העיר העתיקה עמוסה מאוד', page, 'a drawback'), 'העיר העתיקה עמוסה מאוד');
  ok('whitespace is normalised on both sides', quoted('העיר  העתיקה\nעמוסה מאוד', page, 'x'));
  throws('a paraphrase is refused', () => quoted('העיר העתיקה די עמוסה', page, 'a drawback'), 'unquoted_opinion');
  throws('and so is an invention', () => quoted('המחירים זולים', page, 'a drawback'), 'unquoted_opinion');

  // THE WHOLE-OBJECT PASS. Builders call `line` on what they write, and this runs over
  // the result - so a field somebody adds next year is covered by a check nobody had to
  // remember to write.
  const bad = { slides: [{ titleHe: 'יום 1', rows: [{ text: 'כשהיינו שם אכלנו כאן' }] }] };
  throws('the object walk finds a line no builder guarded', () => assertPostVoice(bad), 'invented_experience');
  const good = { slides: [{ titleHe: 'יום 1', rows: [{ text: 'גשר קארל' }], image: { src: 'data:image/jpeg;base64,AAAA' } }] };
  ok('and passes a clean post', Boolean(assertPostVoice(good)));
  // The image data URI is skipped rather than scanned. A megabyte of base64 through
  // seven regular expressions per slide is the kind of cost that gets a guard removed.
  ok('an English field is left alone', Boolean(assertPostVoice({ nameEn: 'Charles Bridge was here' })));
}

/* -------------------------------------------------------------------------- */
group('what a place is allowed to say about itself');

{
  const src = await import('../src/posts/source.js');

  // THE KOSHER RULE, AND IT IS THE SHARPEST GUARD IN THE WHOLE CHANGE.
  //
  // The site records where it learned each kashrut fact. `community` means somebody
  // read the community's own page on a date; `legacy-unverified` means the catalogue
  // recorded it once and nobody has confirmed it. A slide printing "בהשגחת רבנות פראג"
  // off a legacy entry is making a kashrut claim on a rabbinate's behalf, sourced to a
  // note in our own database - and somebody eats there because a post said so.
  const certified = {
    category: 'kosher-food',
    name: 'שלום',
    kashrut: {
      knowledge: 'certified',
      certifications: [{ body: 'הרבנות הראשית של קהילת פראג' }],
      provenance: { source: 'https://www.kehilaprag.cz/', sourceType: 'community', checked: '2026-08-19' },
    },
  };
  const legacy = {
    category: 'kosher-food',
    name: 'דיניץ',
    kashrut: {
      knowledge: 'certified',
      certifications: [{ body: 'רבנות פראג', descriptors: ['גלאט'] }],
      provenance: { source: 'קטלוג טיול+ (דיווח קודם)', sourceType: 'legacy-unverified', checked: null },
      legacySupervision: 'גלאט, בהשגחת רבנות פראג',
    },
  };

  ok('a checked entry may name its supervision', src.mayNameSupervision(certified));
  ok('a legacy entry may not', !src.mayNameSupervision(legacy));
  ok('and the line says so', src.kosherLine(certified).includes('הרבנות הראשית'), src.kosherLine(certified));
  eq('while the legacy one says only that it is kosher', src.kosherLine(legacy), 'מסעדה כשרה');
  ok('never leaking the unconfirmed body', !src.kosherLine(legacy).includes('רבנות'), src.kosherLine(legacy));
  ok('nor the descriptor', !src.kosherLine(legacy).includes('גלאט'));
  eq('a market says what it is', src.kosherLine({ ...legacy, category: 'kosher-market' }), 'מכולת כשרה');
  // A place with no kosher status says NOTHING, rather than "not kosher" - which is a
  // claim nobody made.
  eq('a place with no kashrut field gets no line', src.kosherLine({ category: 'museum' }), null);

  // PRICE BANDS ARE NOT PRICES. Only 0 may be printed, and it is printed as a fact
  // about entry rather than as a number.
  ok('free entry is said', src.placeLine({ category: 'historic', priceLevel: 0 }).includes('כניסה חופשית'));
  ok('a band is never printed', !/[₪]|\d/.test(src.placeLine({ category: 'museum', priceLevel: 3, durationMin: 90 }) || ''));
  eq('a duration is said the way people say it', src.placeLine({ priceLevel: 2, durationMin: 90 }), 'כשעה וחצי');
  ok('and never to the minute', !/90|דקות/.test(src.placeLine({ priceLevel: 2, durationMin: 90 })));
  // The kosher fact outranks both, because it is the one that decides whether this
  // audience goes at all.
  ok('kosher leads the line', src.placeLine(certified).startsWith('בהשגחת'), src.placeLine(certified));

  // DISTANCES ARE HEDGED, ALWAYS. The number is a straight line between two database
  // coordinates and nobody walks in a straight line.
  const a = { lat: 50.0865, lng: 14.4114 };
  const near = { lat: 50.0875, lng: 14.4124 };
  const mid = { lat: 50.0905, lng: 14.4204 };
  const far = { lat: 49.948, lng: 15.268 };
  ok('a short walk is approximate', src.distanceHe(a, near).startsWith('~'), src.distanceHe(a, near));
  ok('and coarsely rounded', /^~[\d,]+ מ׳$/.test(src.distanceHe(a, near)), src.distanceHe(a, near));
  ok('a longer walk too', src.distanceHe(a, mid).startsWith('~'), src.distanceHe(a, mid));
  // ONE UNIT DOWN THE WHOLE CARD. The first version switched to kilometres at 1,000m,
  // so one route card read "~300 מ׳", then "~1.4 ק״מ", then "~800 מ׳" - three numbers
  // a reader has to convert to compare, on a slide whose job is to say whether the day
  // is walkable.
  ok('every walking distance is in metres', [near, mid].every((p) => /מ׳$/.test(src.distanceHe(a, p))));
  ok('and none is in kilometres', ![near, mid].some((p) => /ק״מ/.test(src.distanceHe(a, p))));
  eq('and past the walking threshold it stops giving a number', src.distanceHe(a, far), 'נסיעה קצרה');
  ok('no distance is ever exact', !/\d+\.\d\d/.test(src.distanceHe(a, mid) || ''));
  eq('two places with no coordinates get no line', src.distanceHe({}, {}), null);

  // THE VERDICT SPLITTER. Cue-anchored, and it refuses rather than guessing - because
  // guessing wrong prints a drawback as a selling point.
  const cued = {
    tagline: 'עיר הזהב: גשרים, טירות והרובע היהודי המפורסם בעולם',
    editorialRating: { score: 4.7, verdict: 'אחת הערים היפות באירופה. חסרונות: העיר העתיקה עמוסה מאוד כמעט כל השנה.' },
  };
  const v = src.verdictOf(cued);
  ok('the cue is found', v.cued);
  ok('the drawback is quoted verbatim', v.source.includes(v.consHe[0]), v.consHe[0]);
  ok('and the label is not repeated inside the quote', !v.consHe[0].startsWith('חסרונות'), v.consHe[0]);
  ok('the good side comes from the verdict and the tagline', v.prosHe.length >= 2, JSON.stringify(v.prosHe));
  ok('every pro is verbatim too', v.prosHe.every((p) => v.source.includes(p)));

  const uncued = { tagline: 'אי יפה', editorialRating: { score: 4.2, verdict: 'אי יפה מאוד עם חופים ארוכים.' } };
  const u = src.verdictOf(uncued);
  ok('a verdict with no cue reports no drawbacks', !u.cued && u.consHe.length === 0);
  // NOT the same as "this place has no drawbacks" - which is why canBuild refuses on it
  // rather than publishing one side of an argument.
  const { canBuild } = await import('../src/posts/types.js');
  // THE PAGE CARRIES TWO PRACTICAL FACTS, and it has to now: a verdict post needs a
  // cued drawback AND enough concrete detail to pay off a cover that promises the
  // practical answer. See posts.deliver in post-config.json. The page used to be
  // `{ places: [], itinerary: [] }`, which is a page no destination has.
  const page = {
    places: [],
    itinerary: [],
    bestSeason: 'אפריל עד יוני',
    practical: { flights: 'טיסה ישירה מתל אביב, כשלוש שעות.' },
  };
  ok('so a verdict post cannot be built from it', !canBuild('verdict', page, { verdict: u }).ok);
  ok('and it says why', canBuild('verdict', page, { verdict: u }).why.includes('drawbacks'));
  ok('while a cued one can', canBuild('verdict', page, { verdict: v }).ok);

  // AND THE SECOND GATE, ON ITS OWN. A page with a real drawbacks clause and nothing
  // concrete on it is the 0.5%-like post: a cover that promises the practical answer
  // over slides that quote an opinion and stop.
  const bare = { places: [], itinerary: [] };
  const thin = canBuild('verdict', bare, { verdict: v });
  ok('a page with a cued verdict and no concrete facts is refused', !thin.ok);
  ok('and the refusal names what it counted', /concrete fact/.test(thin.why || ''), thin.why);
  const { pageSpecifics } = await import('../src/posts/deliver.js');
  eq('the bare page carries nothing countable', pageSpecifics(bare).length, 0);
  ok('the furnished one carries two kinds', pageSpecifics(page).length >= 2, pageSpecifics(page).join(','));
}

/* -------------------------------------------------------------------------- */
group('the rotation - a pipeline is a template machine unless it is stopped');

{
  const { drawWeighted, pickType, pickLook, pickCaptionShape, nextShape, platformsFor } =
    await import('../src/posts/types.js');
  const { postConfig } = await import('../src/postConfig.js');

  // THE EXCLUSION IS APPLIED BEFORE THE WEIGHTS, NOT AFTER. A post-weighting filter
  // re-normalises across the survivors and lets the heavy favourite dominate the
  // remainder, which is the run being prevented.
  const pool = [{ id: 'a', weight: 9 }, { id: 'b', weight: 1 }];
  eq('the favourite wins an ordinary draw', drawWeighted(pool, { rand: () => 0.5 }).id, 'a');
  eq('and is excluded when it was last', drawWeighted(pool, { avoid: ['a'], rand: () => 0.5 }).id, 'b');
  // Exhausting the pool falls back rather than refusing: with a memory of three and a
  // pool of four, a run does exhaust it, and repeating the oldest beats building nothing.
  eq('an exhausted pool falls back', drawWeighted(pool, { avoid: ['a', 'b'], rand: () => 0.99 }).id, 'b');
  eq('a zero weight is never drawn', drawWeighted([{ id: 'z', weight: 0 }, { id: 'y', weight: 1 }], { rand: () => 0.99 }).id, 'y');

  // No two consecutive posts share a type, a look or a caption shape.
  const hist = [{ type: 'plan', look: 'route', caption: 'toolfirst', hook: 'howid' }];
  for (let i = 0; i < 40; i++) {
    const r = i / 40;
    ok(`type varies at rand=${r.toFixed(2)}`, pickType({ history: hist, rand: () => r }).id !== 'plan');
  }
  const looks = new Set();
  for (let i = 0; i < 40; i++) looks.add(pickLook('plan', { history: hist, rand: () => i / 40 }).id);
  ok('a plan look is never the one used last', !looks.has('route'), [...looks].join(','));
  const shapes = new Set();
  for (let i = 0; i < 40; i++) shapes.add(pickCaptionShape({ history: hist, rand: () => i / 40 }).id);
  ok('nor is the caption shape', !shapes.has('toolfirst'), [...shapes].join(','));

  // A look only ever draws the types that declare it. A notes checklist is a day.
  for (const look of postConfig().posts.looks) {
    for (const type of look.types) {
      ok(`${look.id} accepts ${type}`, postConfig().posts.types.some((t) => t.id === type), 'a look names a type that does not exist');
    }
  }
  for (const type of postConfig().posts.types) {
    ok(`${type.id} has a look`, postConfig().posts.looks.some((l) => l.types.includes(type.id)));
    ok(`${type.id} has a hook shape`, (postConfig().posts.hooks[type.id] || []).length > 0);
  }
  throws('an unknown type is an error rather than a default', () => pickType({ only: 'nonsense' }));
  throws('and so is a look that does not fit', () => pickLook('map', { only: 'notes' }));

  // THE LAB MUST NOT WRITE TO THE ROTATION'S MEMORY, and `history: []` is only half of
  // stopping it. That flag decides what the draw READS; `remember` decides what it
  // WRITES, and for a while only the first existed - so an evening spent rendering
  // samples filled the live store's history to its cap with lab runs, after which the
  // next real post would have been steered by whatever the lab happened to render last.
  // The lab's own comment claimed this was handled, which is why nobody looked.
  {
    const src = readFileSync(new URL('../scripts/post-lab.js', import.meta.url), 'utf8');
    ok('the lab ignores the history', /history:\s*\[\]/.test(src));
    ok('AND refuses to write to it', /remember:\s*false/.test(src), 'post-lab would pollute the live rotation');
    const build = readFileSync(new URL('../src/posts/index.js', import.meta.url), 'utf8');
    ok('and the builder honours the flag', /if \(remember\)/.test(build), 'notePostShape is called unconditionally');
  }

  // THE FRAME IS NO LONGER A VARIABLE. There was an A/B test here between 9:16 and 3:4,
  // and it was withdrawn: TikTok's player is 9:16, so a 3:4 slide is letterboxed by
  // TikTok itself and anchored to the TOP, which puts the hook under the search bar and
  // a black band under the photograph. Every draw returns the one frame.
  const frames = new Set();
  for (let i = 0; i < 20; i++) frames.add(nextShape({ history: hist, rand: () => i / 20 }).frame);
  eq('every post is drawn at the one frame', [...frames].join(','), 'tall');

  // WHERE A TYPE MAY GO. A list post is twenty-one slides because its hook promises
  // twenty things; there is no honest nine-slide version for an Instagram carousel.
  eq('a list post is TikTok only', platformsFor('list').join(','), 'tiktok');
  eq('a plan post goes to both', platformsFor('plan').join(','), 'instagram,tiktok');

  // And the limit it exists to respect, enforced where it can still be acted on.
  const { fitTo, IG_MAX } = await import('../src/render/post.js');
  const many = Array.from({ length: 21 }, (_, i) => ({ titleHe: `${i}` }));
  eq('TikTok is never trimmed', fitTo(many, 'tiktok').length, 21);
  throws('and Instagram refuses what it cannot carry', () => fitTo(many, 'instagram', 'list'));
  // A plan fits by dropping its collages, which are the breath in the post rather than
  // its content - so nothing it promised is lost.
  const plan = [
    ...Array.from({ length: 6 }, (_, i) => ({ titleHe: `day${i}` })),
    ...Array.from({ length: 4 }, (_, i) => ({ titleHe: `c${i}`, optional: true })),
  ];
  eq('a plan is trimmed to fit', fitTo(plan, 'instagram', 'plan').length, 6);
  ok('and it is the collages that went', fitTo(plan, 'instagram', 'plan').every((s) => !s.optional));
  eq('the ceiling is Instagram’s own', IG_MAX, 10);
}

/* -------------------------------------------------------------------------- */
group('captions vary, and the emoji are pictures');

{
  const { buildCaption, captionsRepeat, tagsFor, siteLine } = await import('../src/posts/caption.js');
  const { postConfig } = await import('../src/postConfig.js');
  const { withEmoji } = await import('../src/render/postSlides.js');

  const post = {
    where: 'פראג',
    countryHe: 'צ׳כיה',
    titleHe: '4 ימים בפראג',
    captionHookHe: '4 ימים בפראג, ככה היינו בונים את זה',
    practicalHe: 'טיסות ישירות מנתב"ג - כ-4 שעות',
    signoffHe: 'מקווה שזה עוזר לתכנן 🤍',
    siteSlug: 'prague',
    slides: [{ countryHe: 'צ׳כיה' }],
    category: 'plan',
  };
  const shapes = postConfig().posts.captions;

  // NO TWO SHAPES PRODUCE THE SAME CAPTION. The old pipeline had one skeleton and
  // varied only the words in it, which is the template problem in the place nobody
  // looks at closely.
  const built = shapes.map((s) => ({ shape: s.id, instagram: buildCaption(post, { shape: s, titled: true, question: 'מה הייתם מוסיפים?' }) }));
  ok('every shape is a different caption', new Set(built.map((b) => b.instagram)).size === shapes.length);
  ok('and the shapes differ in length', new Set(built.map((b) => b.instagram.split('\n\n').length)).size > 1);

  // NOT EVERY SHAPE OPENS ON THE SAME PART, and this is what the first run of this
  // test found: all five skeletons began with `hook`, so five different shapes produced
  // five captions with an identical first line - the template problem moved one line
  // down, onto the line Instagram shows before the fold.
  const firstParts = new Set(shapes.map((s) => s.parts[0]));
  ok('the shapes open on more than one part', firstParts.size >= 3, [...firstParts].join(','));

  // CONSECUTIVE POSTS, which is what the rule is actually about. Two posts in a row are
  // never the same TYPE - the rotation sees to that - so their hooks name different
  // destinations and the openings differ even where the shapes do not. What this
  // asserts is that `captionsRepeat` catches both ways of repeating.
  const other = {
    ...post,
    where: 'רומא',
    countryHe: 'איטליה',
    captionHookHe: '3 ימים ברומא, ככה היינו בונים את זה',
    siteSlug: 'rome',
    slides: [{ countryHe: 'איטליה' }],
  };
  const a = { shape: shapes[0].id, instagram: buildCaption(post, { shape: shapes[0], titled: true, question: 'x' }) };
  const b = { shape: shapes[1].id, instagram: buildCaption(other, { shape: shapes[1], titled: true, question: 'y' }) };
  ok('two consecutive posts do not repeat', captionsRepeat(a, b).length === 0, captionsRepeat(a, b).join(', '));
  ok('the same shape twice IS a repeat', captionsRepeat(a, a).some((r) => r.includes('shape')));
  ok(
    'and so is the same opening under a different shape',
    captionsRepeat(a, { shape: 'elsewhere', instagram: a.instagram }).some((r) => r.includes('opening'))
  );

  // The tags: exactly the configured count, the feed tag always first, the destination
  // among them, and no duplicates.
  const tags = tagsFor(post).split(' ');
  eq('the tag count is fixed', tags.length, postConfig().hashtags.broadCount + postConfig().hashtags.nicheCount);
  eq('the feed tag leads', tags[0], '#פוריו');
  ok('the destination is tagged', tags.includes('#צ׳כיה'), tags.join(' '));
  eq('no tag appears twice', new Set(tags).size, tags.length);

  // TikTok opens with the pin because the hook is already the post title; Instagram has
  // no title field on a carousel, so it must open with the hook or the post has none.
  const ig = buildCaption(post, { shape: shapes[0], titled: true, question: 'x' });
  const tk = buildCaption(post, { shape: shapes[0], titled: false, question: 'x' });
  ok('Instagram opens on the hook', ig.startsWith('4 ימים בפראג'), ig.split('\n')[0]);
  ok('TikTok opens on the pin', tk.startsWith('📍'), tk.split('\n')[0]);
  ok('the tags are last on both', ig.trim().split('\n').pop().startsWith('#') && tk.trim().split('\n').pop().startsWith('#'));

  // A post with no page drops the site part rather than substituting a random ask into
  // a shape that was not designed to carry one.
  const noPage = buildCaption({ ...post, siteSlug: null }, { shape: shapes[0], titled: true, question: 'x' });
  ok('no page means no site line', !noPage.includes('בלינק בביו'));
  ok('and the rest of the shape survives', noPage.includes('שמרו את זה לטיול'));
  // An `instead` post names the page it LINKS to, not the destination it argues about.
  eq(
    'the site line names the linked page',
    siteLine({ siteSlug: 'crete', destHe: 'כרתים', target: 'tiktok' }).includes('כרתים'),
    true
  );

  // EMOJI ARE PICTURES, NOT CHARACTERS. A flag set as text came out as the letters
  // "GR" in the middle of a Hebrew line, because the rendering machine's font has no
  // glyph for a regional-indicator pair - and the machine that publishes is not the
  // machine that was reviewed on.
  ok('a flag becomes an image', withEmoji('🇬🇷 כרתים').includes('<img'), withEmoji('🇬🇷 כרתים'));
  ok('so does an emoji inside a line', withEmoji('📍 גשר קארל').includes('<img'));
  ok('the text around it survives', withEmoji('📍 גשר קארל').includes('גשר קארל'));
  ok('and is still escaped', withEmoji('<b>x</b>').includes('&lt;b&gt;'), withEmoji('<b>x</b>'));
  eq('a line with no emoji is just escaped text', withEmoji('גשר קארל'), 'גשר קארל');

  // Every emoji these posts can draw has committed artwork, so none of them depends on
  // the host font. The flag proved why: it rendered perfectly in review and would not
  // have on the box that publishes.
  const { haveArtFor } = await import('../src/render/emojiArt.js');
  for (const e of ['🏰', '🏛️', '🎡', '🌿', '🌄', '☕', '🍽️', '🧺', '🛍️', '🥙', '🛒', '📍', '⭐', '🤍']) {
    ok(`artwork for ${e}`, haveArtFor(e), 'run npm run fetch-emoji');
  }
}

/* -------------------------------------------------------------------------- */
group('the photograph ladder starts on our own page');

{
  const commons = await import('../src/images/commons.js');
  const { PROVENANCE } = await import('../src/images.js');

  // The file name out of the URL the site publishes. A thumbnail URL carries the name
  // TWICE and it is the first one that is the file - taking the last path segment asks
  // the API for "500px-Name.jpg", which does not exist.
  eq(
    'a thumbnail URL yields the file',
    commons.titleFromUrl('https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Karl%C5%AFv_most.jpg/500px-Karl%C5%AFv_most.jpg'),
    'Karlův most.jpg'
  );
  eq(
    'and so does a full-size one',
    commons.titleFromUrl('https://upload.wikimedia.org/wikipedia/commons/5/5e/Karl%C5%AFv_most.jpg'),
    'Karlův most.jpg'
  );
  eq('underscores become spaces, as the API wants', commons.titleFromUrl('https://upload.wikimedia.org/wikipedia/commons/a/ab/Old_Town.jpg'), 'Old Town.jpg');

  // ANYTHING THAT IS NOT A COMMONS FILE IS NOT ONE. The day the site starts publishing
  // photographs from a stock library or a hotel's own page, this route goes quiet and
  // the search ladder takes over - which is the correct outcome, because a photograph
  // on a business's own page is the one origin BRIEF.md forbids outright.
  for (const url of [
    'https://images.unsplash.com/photo-1541849546',
    'https://wikimedia-mirror.example.com/wikipedia/commons/a/ab/X.jpg',
    'https://www.tiyulplus.com/x.jpg',
    null,
    '',
    'not a url',
  ]) {
    eq(`refused: ${JSON.stringify(url)}`, commons.titleFromUrl(url), null);
  }

  // The provenance is declared, so the approval card names it rather than printing
  // "לא ידוע", and findImage's policy check would accept it.
  ok('commons is a declared provenance', Boolean(PROVENANCE.commons), 'src/images.js does not know about it');
  ok('and it does not claim the photograph is ours', !PROVENANCE.commons.includes('שלנו'), PROVENANCE.commons);
  eq('the credit carries the author and the licence', commons.creditFor({ author: 'Tilman2007', license: 'CC BY-SA 4.0' }), 'Tilman2007 / CC BY-SA 4.0');
  ok('a half-known credit is still a credit', commons.creditFor({ license: 'CC BY 2.0' }).includes('CC BY 2.0'));
  ok('and an unknown one names the source', commons.creditFor({}).includes('Commons'));
}

/* -------------------------------------------------------------------------- */
group('the map says what it can honestly say');

{
  const { fitPoints, scaleBar } = await import('../src/render/map.js');
  const { coreOf } = await import('../src/posts/mapPost.js');

  // Prague: a walkable centre plus day trips sixty to a hundred and seventy kilometres
  // out. At full extent twenty-six of thirty-two pins land on top of each other, which
  // is why the core is the map and the wide view is conditional.
  const centre = [
    { lat: 50.0865, lng: 14.4114, n: 1, dayN: 1 },
    { lat: 50.0875, lng: 14.4204, n: 2, dayN: 1 },
    { lat: 50.089, lng: 14.4004, n: 3, dayN: 2 },
    { lat: 50.081, lng: 14.4004, n: 4, dayN: 2 },
    { lat: 50.09, lng: 14.42, n: 5, dayN: 3 },
  ];
  const withTrip = [...centre, { lat: 49.948, lng: 15.268, n: 6, dayN: 4 }];

  const core = coreOf(withTrip);
  eq('the day trip is left off the core map', core.length, centre.length);
  ok('and the numbers are kept rather than reassigned', core.map((p) => p.n).join(',') === '1,2,3,4,5');

  // The projection fits, and the scale bar is a round number rather than a measurement.
  const fit = fitPoints(centre, { width: 1080, height: 1920 });
  ok('every point lands inside the frame', centre.every((p) => {
    const { x, y } = fit.project(p);
    return x >= 0 && x <= 1080 && y >= 0 && y <= 1920;
  }));
  ok('the scale is plausible for a city', fit.metresPerPixel > 0.5 && fit.metresPerPixel < 20, `${fit.metresPerPixel} m/px`);
  const bar = scaleBar(fit.metresPerPixel, 1080);
  ok('the bar is a round number', [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000].includes(bar.metres), String(bar.metres));
  ok('and it fits across the frame', bar.px > 0 && bar.px < 1080, String(bar.px));
  ok('labelled in the unit a person would use', /מ׳|ק״מ/.test(bar.labelHe), bar.labelHe);
  // Two points in the same doorway must not scale to a map of two buildings.
  const tiny = fitPoints([{ lat: 50.0865, lng: 14.4114 }, { lat: 50.0866, lng: 14.4115 }], { width: 1080, height: 1920 });
  ok('a degenerate box is floored rather than divided by zero', Number.isFinite(tiny.metresPerPixel) && tiny.metresPerPixel > 0);
  eq('one point is not a map', fitPoints([{ lat: 1, lng: 1 }], { width: 1080, height: 1920 }), null);
}

/* -------------------------------------------------------------------------- */
group('every TikTok frame is 9:16 and every Instagram frame is 4:5');

{
  const { geometryFor, FRAMES } = await import('../src/render/postSlides.js');
  const { SIZES } = await import('../src/render/deckTemplates.js');
  const { postConfig } = await import('../src/postConfig.js');

  // ONE RATIO PER PLATFORM, ASSERTED ACROSS EVERY FORMAT RATHER THAN PER FILE.
  //
  // This has been got wrong repeatedly and each time it looked like a different bug, so
  // the check is on the ratio itself: TikTok's player is 9:16, and a 3:4 or 4:5 slide
  // in it is letterboxed by TikTok and anchored to the TOP - which puts the hook under
  // the search bar and a black band under the photograph. Instagram's feed crops to
  // 4:5. Neither is a variable.
  const ratio = (g) => +(g.w / g.h).toFixed(4);
  const NINE_SIXTEEN = +(9 / 16).toFixed(4);
  const FOUR_FIVE = +(4 / 5).toFixed(4);

  eq('the deck renderer draws TikTok at 9:16', ratio(SIZES.tiktok), NINE_SIXTEEN);
  eq('and Instagram at 4:5', ratio(SIZES.instagram), FOUR_FIVE);
  eq('the post renderer agrees on TikTok', ratio(geometryFor('tiktok', 'tall')), NINE_SIXTEEN);
  eq('and on Instagram', ratio(geometryFor('instagram')), FOUR_FIVE);

  // ONE frame, and an unknown one resolves UP to 9:16 rather than to something
  // smaller. The A/B test that used to live here shipped 3:4 slides to a 9:16 feed.
  eq('there is exactly one TikTok frame', Object.keys(FRAMES).length, 1);
  eq('and the config offers exactly one', postConfig().posts.frames.length, 1);
  eq('an unknown frame still renders 9:16', ratio(geometryFor('tiktok', 'phone')), NINE_SIXTEEN);
  for (const f of postConfig().posts.frames) {
    eq(`the configured frame ${f.id} is 9:16`, +(f.w / f.h).toFixed(4), NINE_SIXTEEN);
  }

  // A card is Instagram-only and 4:5, which is why it is not in the TikTok list below.
  const { CARD_W, CARD_H } = await import('../src/render/theme.js');
  eq('a card is 4:5', +(CARD_W / CARD_H).toFixed(4), FOUR_FIVE);

  // A clip is encoded rather than rendered, so its ratio is in the video config.
  const clip = postConfig().clips.video;
  eq('a clip is 9:16', +(clip.width / clip.height).toFixed(4), NINE_SIXTEEN);

  // AND THE PUBLISHER REFUSES THE WRONG SHAPE rather than padding it. Every slideshow
  // kind must be named, or it falls through to cand.card - the 4:5 cover - and reaches
  // a 9:16 feed top-anchored.
  const src = readFileSync(new URL('../src/publish/tiktok.js', import.meta.url), 'utf8');
  const guard = src.match(/\[([^\]]*)\]\.includes\(cand\.kind\) && !deckImages\.length/);
  ok('the TikTok preflight names the slideshow kinds', Boolean(guard), 'the shape guard moved or went');
  for (const kind of ['deck', 'plan', 'post']) {
    ok(`${kind} may not fall back to the 4:5 cover`, guard[1].includes(`'${kind}'`), guard?.[1]);
  }
}

/* -------------------------------------------------------------------------- */
group('every command is in /help');

{
  // A SHAPE YOU CANNOT FIND IN /help IS A SHAPE NOBODY CAN ASK FOR.
  //
  // That is a commit title in this repository, and it happened again: /make, /views and
  // /report were registered, deployed and working, and none of them was in the help
  // text. This bot sets no Telegram command menu, so /help is the ONLY place a command
  // is discoverable - a command missing from it exists for whoever wrote it and for
  // nobody else.
  //
  // Read off the source rather than off a list somebody maintains, because a list
  // somebody maintains is the thing that just failed.
  const src = readFileSync(new URL('../bot.js', import.meta.url), 'utf8');
  const registered = [...src.matchAll(/bot\.command\('([a-z_]+)'/g)].map((m) => m[1]);
  ok('the bot registers commands', registered.length > 15, `${registered.length} found`);

  const helpAt = src.indexOf("bot.command('help'");
  const help = src.slice(helpAt, helpAt + 6000);

  // `help` itself never documents itself, which is conventional and fine.
  const missing = registered.filter((c) => c !== 'help' && !help.includes(`/${c}`));
  ok('every registered command appears in /help', missing.length === 0, `missing: ${missing.join(', ')}`);

  // And the reverse, so a command that is renamed or deleted does not leave a line in
  // the help promising something that no longer answers.
  const documented = [...help.matchAll(/'\/([a-z_]+)/g)].map((m) => m[1]);
  const phantom = [...new Set(documented)].filter((c) => !registered.includes(c));
  ok('and /help promises nothing that is not registered', phantom.length === 0, `phantom: ${phantom.join(', ')}`);
}

/* -------------------------------------------------------------------------- */
group('measuring - saves and shares, never likes');

{
  const { rates } = await import('../src/metrics/store.js');
  const { rankBy, window: reportWindow, weeklyReport } = await import('../src/metrics/report.js');
  const { available: tiktokAvailable, hasListScope, LIST_SCOPE } = await import('../src/metrics/tiktok.js');
  const { SCOPES } = await import('../src/publish/tiktok.js');

  // PER VIEW, WHICH IS THE WHOLE POINT. A post with 40 saves off 20,000 views did worse
  // than one with 12 off 400, and ranking by the raw count says the opposite.
  const big = rates({ views: 20_000, saved: 40, shares: 10 });
  const small = rates({ views: 400, saved: 12, shares: 8 });
  ok('the smaller post ranks higher', small.saveRate > big.saveRate, `${small.saveRate} vs ${big.saveRate}`);

  // NULL RATHER THAN ZERO when there is nothing to divide by. A post with no views yet
  // has no rate, and calling it zero ranks it below a post that genuinely failed.
  eq('no views means no rate', rates({ views: 0, saved: 5 }).saveRate, null);
  eq('and neither does a missing stats object', rates(null).saveRate, null);
  // Reach stands in for views where views is absent, because it is the same question
  // asked of people rather than of plays.
  ok('reach stands in for views', rates({ reach: 500, saved: 50 }).saveRate === 0.1);

  const now = Date.parse('2026-09-28T12:00:00Z');
  const at = (daysAgo) => new Date(now - daysAgo * 86_400_000).toISOString();
  const rows = [
    { id: 'a', at: at(1), shape: { type: 'plan', look: 'route', frame: 'tall' }, stats: { instagram: { views: 2000, saved: 120, shares: 40 } } },
    { id: 'b', at: at(2), shape: { type: 'plan', look: 'notes', frame: 'phone' }, stats: { instagram: { views: 1500, saved: 150, shares: 60 } } },
    { id: 'c', at: at(3), shape: { type: 'list', look: 'label', frame: 'tall' }, stats: { instagram: { views: 3000, saved: 60, shares: 10 } } },
    { id: 'd', at: at(4), shape: { type: 'list', look: 'label', frame: 'phone' }, stats: { instagram: { views: 2500, saved: 75, shares: 15 } } },
    { id: 'old', at: at(40), shape: { type: 'verdict', look: 'sheet', frame: 'tall' }, stats: { instagram: { views: 9999, saved: 9999, shares: 9999 } } },
  ];

  eq('the window excludes what is outside it', reportWindow(7, { rows, now }).length, 4);
  ok('however good it was', !reportWindow(7, { rows, now }).some((r) => r.id === 'old'));

  const byType = rankBy(reportWindow(7, { rows, now }), 'type');
  eq('the better-saved type leads', byType[0].key, 'plan');
  // THE MEAN OF THE RATES, NOT THE RATE OF THE TOTALS. Summing saves and dividing by
  // summed views lets one post that reached far more people decide the whole row -
  // which is exactly the post least like the others.
  ok('plan averages its two posts', Math.abs(byType[0].saveRate - (0.06 + 0.1) / 2) < 1e-9, String(byType[0].saveRate));
  eq('and the counts are reported', byType[0].posts, 2);
  ok('a two-post group is not called thin', !byType[0].thin);
  ok('a one-post group is', rankBy(reportWindow(40, { rows, now }), 'type').find((r) => r.key === 'verdict').thin);

  // Every dimension the report groups by is a field the builder actually records, or
  // the column is always empty and nobody notices for a month.
  for (const field of ['type', 'look', 'frame']) {
    ok(`${field} groups`, rankBy(reportWindow(7, { rows, now }), field).length >= 2, `${field} produced no groups`);
  }

  const text = weeklyReport({ days: 7, rows, now });
  ok('the report names the ratios it ranks on', text.includes('שמירות') && text.includes('שיתופים'));
  ok('and never ranks on likes', !/לייק/.test(text), 'a likes column crept into the report');
  ok('it suggests rather than changes', text.includes('לא משנה כלום לבד'));
  ok('and says where the edit is made', text.includes('post-config.json'));
  ok('an empty window says so plainly', weeklyReport({ days: 1, rows: [], now }).includes('לא פורסם כלום'));

  // NUMBERS TYPED IN BY HAND, for the platform no API will describe.
  //
  // Every TikTok post here is a photo carousel and the Display API will not list one.
  // The owner can read the view count off the screen in two seconds, so the ranking
  // takes it - and says that it did, because a typed number and a fetched one are not
  // the same kind of evidence.
  {
    const handRows = [
      { id: 'a', at: at(1), shape: { type: 'verdict', look: 'sheet', frame: 'tall' }, stats: { tiktok: { views: 1919, saved: 40, shares: 12, by: 'hand' } } },
      { id: 'b', at: at(2), shape: { type: 'plan', look: 'route', frame: 'tall' }, stats: { instagram: { views: 800, saved: 8, shares: 2 } } },
    ];
    const w = reportWindow(7, { rows: handRows, now });
    // TIKTOK WINS WHERE IT EXISTS. These posts are made for TikTok - the formats were
    // read off TikTok and the drafts land in its inbox - so ranking them on Instagram
    // because Instagram is the platform with an API would be measuring the wrong thing
    // carefully.
    eq('a post with TikTok numbers is ranked on them', w[0].on, 'tiktok');
    eq('and one without falls back to Instagram', w[1].on, 'instagram');
    ok('the hand-entered one is marked', w[0].byHand === true);
    ok('the fetched one is not', w[1].byHand === false);
    ok('the rate comes from the TikTok views', Math.abs(w[0].best.saveRate - 40 / 1919) < 1e-9);

    const text = weeklyReport({ days: 7, rows: handRows, now });
    ok('the report says which platform each number is from', text.includes('מטיקטוק'));
    ok('and admits which were typed', text.includes('הוזנו ביד'), text.split(String.fromCharCode(10))[2]);
    // With TikTok numbers present it must stop telling you TikTok has none.
    ok('it stops printing the blocker once numbers arrive', !text.includes('אין מספרים -'));
  }

  // TIKTOK, SAID IN WORDS. The scope was never requested and cannot be gained by
  // refreshing, and the endpoint is documented as returning videos while every post
  // here is a photo carousel. The report has to name the blocker rather than print an
  // empty table, which reads as a bad week.
  ok(`${LIST_SCOPE} is not among the scopes this app asked for`, !SCOPES.includes(LIST_SCOPE), SCOPES.join(','));
  ok('so the list scope is not held', !hasListScope());
  const gate = tiktokAvailable();
  ok('and TikTok metrics report themselves unavailable', !gate.ok);
  ok('with a reason somebody can act on', gate.why.length > 20, gate.why);
  ok('the report says it too', text.includes('טיקטוק'));
}

/* -------------------------------------------------------------------------- */
group('nothing promises a DM while nothing answers one');

{
  const { assertNoDm, promisesDm, DmPromiseError } = await import('../src/dmPromise.js');
  const { postConfig } = await import('../src/postConfig.js');
  const { siteSlideFor } = await import('../src/deck/follow.js');

  // The listener is off, and this is the fact the whole guard hangs on.
  eq('igReplies is off', postConfig().igReplies.on, false);

  // WHAT THE GUARD IS FOR. Not a typo - a correct conditional being lost. Two
  // one-line checks in two files decide between the bio wording and the comment
  // one, and if either is lost the post looks completely normal: nothing fails,
  // nothing logs, and the only symptom is a stranger's comment going unanswered.
  ok('the configured DM line is recognised as a promise', promisesDm(postConfig().caption.siteCtaDmHe));
  ok('and the slide’s version too', promisesDm(postConfig().plans.sitePage.ctaDmHe));
  for (const line of ['תגיבו "פראג" ונשלח לכם את הלינק', 'שלחו הודעה ואשלח לך את המסלול', 'כתבו לי ב-DM']) {
    ok(`refused while replies are off: ${line.slice(0, 22)}`, promisesDm(line), line);
  }

  // AND WHAT IT MUST NOT CATCH. The bio pointer is the honest ask and it has to
  // survive; so does a slide saying the community takes bookings by message,
  // which is a fact about the place rather than a promise by us.
  for (const line of [
    postConfig().caption.siteCtaBioHe,
    postConfig().plans.sitePage.ctaBioHe,
    'שמרו את זה לטיול',
    'ארוחות שבת בהרשמה מראש, בהודעה לקהילה',
    'מקווה שזה עוזר לתכנן 🤍',
  ]) {
    ok(`allowed: ${line.slice(0, 26)}`, !promisesDm(line), line);
  }

  // The assertion throws rather than stripping the sentence. A guard that edited
  // the text would publish a post whose ending was rewritten by a regex.
  let threw = null;
  try {
    assertNoDm('תגיבו "פראג" ונשלח לכם את הלינק', 'the test', { replies: { on: false } });
  } catch (e) {
    threw = e;
  }
  ok('the guard throws', threw instanceof DmPromiseError);
  eq('with a reason', threw?.reason, 'dm_promise_while_off');
  ok('and names where', String(threw?.message).includes('the test'));

  // BOTH DIRECTIONS. A guard that cannot be switched on is a guard nothing has
  // ever seen pass, and the day igReplies is turned on the DM line is the
  // correct thing to publish.
  eq(
    'with replies on it is allowed through',
    assertNoDm('תגיבו "פראג" ונשלח לכם את הלינק', 'the test', { replies: { on: true } }),
    'תגיבו "פראג" ונשלח לכם את הלינק'
  );

  // The live call sites, end to end. With the config as it ships, neither
  // platform's closing slide may ask for a comment.
  const deck = { siteSlug: 'prague', where: 'פראג' };
  for (const size of ['tiktok', 'instagram']) {
    const slide = siteSlideFor(deck, { size, destHe: 'פראג', replies: postConfig().igReplies });
    ok(`the ${size} site slide points at the bio`, slide.ctaHe.includes('בביו'), slide.ctaHe);
    ok(`and promises no message`, !promisesDm(slide.ctaHe), slide.ctaHe);
  }
}

/* -------------------------------------------------------------------------- */
group('answering a comment with the link');

{
  const { asksForLink, words, stem } = await import('../src/igReplies/match.js');
  const { verifySignature } = await import('../src/igReplies/verify.js');
  const { commentsIn, handleComment } = await import('../src/igReplies/server.js');
  const { linkFor, replyText, messagesEndpoint } = await import('../src/igReplies/send.js');
  const { createHmac } = await import('node:crypto');

  // WHAT COUNTS AS ASKING. The slide says תגיבו "פראג" and what arrives is
  // every one of these. A matcher that only takes the bare word answers about
  // half of them, which is worse than not asking: somebody did as they were
  // told and got nothing.
  const ask = (t) => asksForLink(t, { destHe: 'פראג', keywords: ['מסלול', 'לינק'] });
  for (const t of ['פראג', 'לפראג', 'בפראג', '"פראג"', 'פראג!!', 'פראג 😍', 'אני רוצה לפראג בבקשה', 'פְּרָאג']) {
    ok(`"${t}" is asking`, Boolean(ask(t)), t);
  }
  eq('and it says why', ask('לפראג').why, 'destination');
  eq('a keyword counts too', ask('מסלול בבקשה').why, 'keyword');
  eq('with a prefix on it', ask('המסלול?').why, 'keyword');

  // AND WHAT DOES NOT. Every match DMs a stranger, so the failure to avoid is
  // a reply nobody asked for.
  for (const t of ['יפה מאוד', 'הייתי שם בקיץ', '', '❤️❤️', 'budapest']) {
    ok(`"${t}" is not asking`, ask(t) === null, t);
  }
  // Whole words only. A keyword inside a longer word is not a request.
  ok('a keyword inside a word does not count', asksForLink('לינקולן', { destHe: 'פראג', keywords: ['לינק'] }) === null);
  eq('words are split on punctuation and emoji', words('פראג, בבקשה! 😍').join('|'), 'פראג|בבקשה');
  eq('a prefix is stripped only when something is left', stem('לפראג'), 'פראג');
  eq('and a short word keeps its letters', stem('לי'), 'לי');

  // THE SIGNATURE. Everything behind this endpoint sends a DM to a stranger,
  // so an unsigned delivery is an open relay for the account's messages.
  const body = Buffer.from(JSON.stringify({ object: 'instagram', entry: [] }), 'utf8');
  const good = `sha256=${createHmac('sha256', 'topsecret').update(body).digest('hex')}`;
  ok('a correct signature passes', verifySignature(body, good, 'topsecret'));
  ok('the wrong secret fails', !verifySignature(body, good, 'other'));
  ok('a tampered body fails', !verifySignature(Buffer.concat([body, Buffer.from('x')]), good, 'topsecret'));
  ok('no header fails', !verifySignature(body, null, 'topsecret'));
  ok('no secret fails', !verifySignature(body, good, ''));
  ok('a short hex digest fails rather than throwing', !verifySignature(body, 'sha256=abcd', 'topsecret'));
  ok('non-hex fails rather than throwing', !verifySignature(body, 'sha256=zzzz', 'topsecret'));
  ok('an unprefixed digest fails', !verifySignature(body, good.slice(7), 'topsecret'));

  // The payload shape, and the entries that are not comments.
  const found = commentsIn({
    entry: [
      { changes: [{ field: 'comments', value: { id: 'c1', text: 'פראג', media: { id: 'm1' }, from: { id: 'u1', username: 'dana' } } }] },
      { changes: [{ field: 'mentions', value: { id: 'x', media: { id: 'm1' } } }] },
      { changes: [{ field: 'comments', value: { id: 'c2', text: 'hi' } }] },
    ],
  });
  eq('only comments are read', found.length, 1);
  eq('and only ones naming their media', found[0].commentId, 'c1');

  // THE LINK, with the campaign on it. The candidate id rather than the
  // destination, because two posts about Prague are two posts.
  const link = linkFor('prague', 'cand123');
  ok('the link is the destination page', link.includes('/destinations/prague'));
  ok('tagged by source', link.includes('utm_source=instagram'));
  ok('and medium', link.includes('utm_medium=dm'));
  ok('and the campaign is the post', link.includes('utm_campaign=cand123'));
  ok('the DM carries it', replyText({ destHe: 'פראג', slug: 'prague', candidateId: 'cand123' }).includes(link));
  ok('and no placeholder survives', !/[{}]/.test(replyText({ destHe: 'פראג', slug: 'prague', candidateId: 'c' })));

  // THE REQUEST SHAPE, against a mocked fetch. Whether Meta accepts it is not
  // knowable offline; that it is the documented call is.
  {
    const saved = { ...process.env };
    process.env.IG_USER_ID = '17841400000000000';
    process.env.IG_ACCESS_TOKEN = 'tok-abc';
    delete process.env.IG_AUTH;
    const { sendPrivateReply } = await import('../src/igReplies/send.js');
    let seen = null;
    await sendPrivateReply(
      { commentId: 'c1', destHe: 'פראג', slug: 'prague', candidateId: 'cand123' },
      {
        fetchImpl: async (url, init) => {
          seen = { url, init };
          return { ok: true, json: async () => ({ message_id: 'mid_1' }) };
        },
      }
    );
    ok('it posts to the messages endpoint', seen.url.includes('/17841400000000000/messages'), seen.url);
    ok('on graph.instagram.com in Instagram Login mode', seen.url.startsWith('https://graph.instagram.com/'), seen.url);
    eq('as a POST', seen.init.method, 'POST');
    // A Bearer header rather than ?access_token=, which would put the token in
    // every access log and proxy in front of this.
    eq('with a bearer token', seen.init.headers.authorization, 'Bearer tok-abc');
    ok('no token in the query string', !seen.url.includes('access_token'));
    const sent = JSON.parse(seen.init.body);
    eq('the recipient is the comment', sent.recipient.comment_id, 'c1');
    ok('and the message carries the link', sent.message.text.includes('utm_campaign=cand123'));
    ok('the endpoint moves with the auth mode', (() => {
      process.env.IG_AUTH = 'facebook';
      process.env.IG_PAGE_ID = '99';
      const u = messagesEndpoint();
      return u.startsWith('https://graph.facebook.com/') && u.includes('/99/messages');
    })());
    for (const k of ['IG_USER_ID', 'IG_ACCESS_TOKEN', 'IG_AUTH', 'IG_PAGE_ID']) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }

  // DEDUPE, which is the rule Meta itself enforces (one private reply per
  // comment) and the one a redelivered webhook would break.
  {
    const store = await import('../src/store.js');
    const mediaId = 'm-dedupe';
    const cid = `c-${Date.now()}`;
    store.noteIgPost(mediaId, { slug: 'prague', destHe: 'פראג', candidateId: 'cand1' });
    ok('a published post is remembered', Boolean(store.igPost(mediaId)));
    eq('with the page it was about', store.igPost(mediaId).slug, 'prague');
    ok('the first claim is granted', store.claimIgReply(cid, { mediaId, userId: 'u1' }));
    ok('the same comment cannot be claimed twice', !store.claimIgReply(cid, { mediaId, userId: 'u1' }));
    ok('nor the same person again under that post', !store.claimIgReply('c-other', { mediaId, userId: 'u1' }));
    ok('but somebody else may be', store.claimIgReply('c-third', { mediaId, userId: 'u2' }));
    ok('and it reads back as answered', store.igReplied(cid, { mediaId, userId: 'u1' }));
    ok('the hourly count sees them', store.igRepliesLastHour() >= 2);
  }

  // THE HANDLER'S REFUSALS, which are most of what it does.
  {
    const store = await import('../src/store.js');
    const { postConfig } = await import('../src/postConfig.js');
    const on = postConfig().igReplies.on;
    const never = async () => { throw new Error('should not have sent'); };
    const base = { mediaId: 'm-h', userId: 'u9', text: 'פראג', commentId: 'c-h1' };
    store.noteIgPost('m-h', { slug: 'prague', destHe: 'פראג', candidateId: 'c' });

    eq('a post it has no record of is ignored',
      await handleComment({ ...base, mediaId: 'nope' }, { deps: { sendPrivateReply: never } }),
      on ? 'no record of that post' : 'replies are off');

    const savedUser = process.env.IG_USER_ID;
    process.env.IG_USER_ID = 'u9';
    eq('and it never answers itself',
      await handleComment(base, { deps: { sendPrivateReply: never } }),
      on ? 'our own comment' : 'replies are off');
    if (savedUser === undefined) delete process.env.IG_USER_ID; else process.env.IG_USER_ID = savedUser;

    eq('a comment that did not ask is left alone',
      await handleComment({ ...base, text: 'יפה מאוד' }, { deps: { sendPrivateReply: never } }),
      on ? 'did not ask' : 'replies are off');
  }
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

  // AND EVERY CALL SITE PUTS ITS FIXED TEXT IN A CACHED SYSTEM BLOCK.
  //
  // The rule the whole project already followed except in one file. A prompt in
  // the user message is billed fresh every call, and in src/video/vision.js
  // that was 2,213 tokens times a 24-candidate cap: 28 cents a run, on a
  // suggestion the owner had not asked for yet. Cache reads are a tenth of the
  // input rate, so this is the single cheapest saving available anywhere here,
  // and it is invisible until somebody adds up the bill.
  //
  // Checked by reading the source rather than by making a call, for the reason
  // the effort check above is: the failure is a number on an invoice, not an
  // exception, so nothing else would ever notice.
  const cachedSites = [...callSites, '../src/draft.js', '../src/plan/write.js', '../src/video/hooks.js', '../src/video/cuts.js'];
  for (const f of cachedSites) {
    const src = rf(new URL(f, import.meta.url), 'utf8');
    ok(
      `${f.split('/').pop()} caches its system prompt`,
      /cache_control: \{ type: 'ephemeral' \}/.test(src),
      'a fixed prompt outside a cached system block is billed in full on every call'
    );
  }

  // And nothing pins a model by name any more. Four files carried their own
  // `ANTHROPIC_MODEL || 'claude-opus-5'`, so MODEL_EDITORIAL reached none of
  // them and the split was a dial wired to half the pipeline.
  for (const f of cachedSites) {
    const src = rf(new URL(f, import.meta.url), 'utf8');
    ok(
      `${f.split('/').pop()} takes its model from the role dial`,
      !/const MODEL = process\.env\.ANTHROPIC_MODEL/.test(src),
      'a model pinned in the file is a model MODEL_EDITORIAL cannot move'
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

  // WHICH KIND OF POST SPENT IT, which the per-model split cannot answer.
  {
    const usage = await import('../src/usage.js');
    usage.reset();
    const call = { input_tokens: 1000, output_tokens: 100 };
    // Through an await, because that is the only version worth having: a clip
    // is a search, up to twenty-four judgements and a hook writer, and the
    // scope has to survive every one of them.
    await usage.forKind('clip', async () => {
      await new Promise((r) => setTimeout(r, 1));
      usage.record(call, 'claude-sonnet-5');
    });
    await usage.forKind('deck', async () => {
      usage.record(call, 'claude-opus-5');
      usage.recordWasted();
    });
    // Outside any scope. Bucketed honestly rather than filed under whatever ran
    // last, which would make the readout confidently wrong.
    usage.record(call, 'claude-haiku-4-5');

    const byKind = Object.fromEntries(usage.snapshot().byKind.map((k) => [k.kind, k]));
    eq('a clip call is billed to clips', byKind.clip?.calls, 1);
    eq('across an await', byKind.clip?.cost > 0, true);
    eq('a deck call to decks', byKind.deck?.calls, 1);
    eq('and its waste with it', byKind.deck?.wasted, 1);
    ok('waste is charged to the kind that spent it, not to the current scope',
      byKind.deck?.wastedCost > 0 && !byKind.clip?.wasted);
    eq('an unscoped call is unattributed, not guessed at', byKind.other?.calls, 1);
    eq('nothing is lost between the buckets',
      usage.snapshot().byKind.reduce((n, k) => n + k.calls, 0), usage.snapshot().calls);
    ok('and the readout prints the split', /לפי סוג/.test(usage.usageReport()));
    usage.reset();
    eq('which resets with everything else', usage.snapshot().byKind.length, 0);
  }
}

/* -------------------------------------------------------------------------- */
group('the vision thumbnail - the biggest line in the bill');

{
  const { visionThumb } = await import('../src/video/vision.js');
  const poster =
    'https://images.pexels.com/videos/35575505/lago-35575505.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=1200&w=630';

  const small = visionThumb(poster, 640);
  ok('the height asked for is the height sent', /[?&]h=640(&|$)/.test(small), small);
  // BOTH NUMBERS MOVE. `fit=crop` means the server crops to the box it is
  // given, so shrinking the height alone would hand the judge a letterboxed
  // slice and then ask it whether a person is the subject of a shot it can no
  // longer see.
  eq('and the width comes with it, in proportion', /[?&]w=(\d+)/.exec(small)[1], '336');
  ok('the rest of the URL is untouched', small.includes('auto=compress') && small.includes('fit=crop'));

  // Never upscale. A 630x1200 poster asked for 1600 would be a bigger bill for
  // a picture with no more detail in it.
  eq('a request larger than the poster is left alone', visionThumb(poster, 1600), poster);
  eq('and so is the poster at its own size', visionThumb(poster, 1200), poster);

  // A URL with nothing to rewrite is the right kind of failure: no saving, and
  // a picture that still arrives.
  const bare = 'https://images.pexels.com/videos/1/x.jpeg';
  eq('a URL with no size to rewrite is returned as it is', visionThumb(bare, 640), bare);
  eq('and so is nothing at all', visionThumb(null, 640), '');

  // The configured default is the one that was measured. 448 was tried and
  // moved a `destination` score from 9 to 8, which with the gate at 7 is close
  // enough to matter - see the comment in post-config.json.
  const { postConfig } = await import('../src/postConfig.js');
  const h = postConfig().clips.search.visionThumbHeight;
  ok('the configured height is the measured one', h === 640, `visionThumbHeight=${h}`);
  // The floor, checked in the source because postConfig() reads one file and
  // takes no overrides, so there is no way to hand it a bad value from here. A
  // height small enough to make the frame unreadable would not fail loudly — it
  // would return confident nonsense about a picture nobody could see, which is
  // the worst shape a saving can take.
  ok('and a floor stops it being set small enough to make the frame unreadable',
    /visionThumbHeight: Math\.max\(240,/.test(readFileSync(new URL('../src/postConfig.js', import.meta.url), 'utf8')));

  // The judge fetches the SHRUNK url, not the poster. The helper existing and
  // the call site using it are two different facts, and only the second one
  // shows up on the bill.
  ok('and judgeThumb fetches through it',
    /fetch\(visionThumb\(url\)/.test(readFileSync(new URL('../src/video/vision.js', import.meta.url), 'utf8')));
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
group('the cover is made to fit - nothing publishes with its title cut');

// The size a cover is set at is chosen by COUNTING CHARACTERS (sizeClass,
// thresholds 20/30/42) and the block is clamped to overlay.maxLines, so a line
// the count guessed wrong about came out with "…" on the end of it. A published
// post with a cut title is not a signal anybody can act on, and the clip writer
// already treats that character as a defect (ELLIPSIS in video/hooks.js).
//
// So the renderer asks Chromium, which has actually laid the page out, and
// steps the size down until it fits. Rendered for real here rather than
// asserted against the HTML, because the whole point is that the HTML cannot
// answer this question - only layout can.
try {
  const { renderToJpeg } = await import('../src/render/index.js');
  const os = await import('node:os');
  const nodePath = await import('node:path');
  const outDir = nodePath.join(os.tmpdir(), 'tiyul-selftest-fit');
  const cover = (titleHe, emphasisHe) =>
    renderSlideHtml({ titleHe, emphasisHe }, { size: 'tiktok', cover: true, style: 'minimal' });
  const draw = (name, html) =>
    renderToJpeg(html, { stem: name, width: SIZES.tiktok.w, height: SIZES.tiktok.h, outDir });

  // THE CONTROL, AND IT IS THE HALF THAT MATTERS MOST. This is the real
  // Helsinki cover, which published correctly. Two earlier versions of the
  // overflow test shrank it from 55px to 34px - once by measuring width on a
  // clamped block, once by calling a 3px ascender overshoot an overflow - and
  // either would have quietly restyled every post in the account.
  for (const [what, title, emph] of [
    ['a short cover', '4 ימים בהלסינקי', '4 ימים'],
    ['the real Helsinki cover', 'ביקשתי מ-AI לתכנן 4 ימים בהלסינקי', '4 ימים בהלסינקי'],
    ['a longer one that still fits', 'ביקשתי מ-AI לתכנן 7 ימים בסנט פטרסבורג', '7 ימים'],
  ]) {
    const r = await draw(`fit-ok-${title.length}`, cover(title, emph));
    eq(`${what} is left exactly as it was`, r.fitted.length, 0);
  }

  // Past what the character ladder can handle: this is the shape that used to
  // publish with its title cut.
  const long = 'ביקשתי מ-AI לתכנן 5 ימים בקופנהגן ובמלמו שמעבר לגשר';
  const shrunk = await draw('fit-long', cover(long, '5 ימים'));
  ok('a cover the ladder set too large is shrunk', shrunk.fitted.length === 1, JSON.stringify(shrunk.fitted));
  ok('smaller than it was set at', shrunk.fitted[0]?.to < shrunk.fitted[0]?.from, JSON.stringify(shrunk.fitted[0]));
  ok('and it ends up fitting, whole', shrunk.fitted[0]?.fits === true, JSON.stringify(shrunk.fitted[0]));

  // And the floor holds. A title long enough that no readable size fits is not
  // shrunk into illegibility to hide the problem - it is reported instead.
  const absurd = 'ביקשתי מ-AI לתכנן 7 ימים בסנט פטרסבורג ובסביבותיה הרחוקות והקרות מאוד';
  const floored = await draw('fit-absurd', cover(absurd, '7 ימים'));
  ok('an impossible title stops at the floor', floored.fitted[0]?.to / floored.fitted[0]?.from >= 0.6, JSON.stringify(floored.fitted[0]));
  eq('and says so rather than pretending', floored.fitted[0]?.fits, false);

  // Re-rendering ONE slide of a deck, which is how a post already built can be
  // repaired after a rendering bug is found. A stored candidate keeps its
  // photographs' provenance and credit but not their `src`, so re-rendering the
  // whole deck to fix its cover would return five slides with no pictures and
  // overwrite five good files.
  const { renderDeckSize } = await import('../src/render/deck.js');
  const deck = {
    id: 'selftest-only',
    titleHe: 'המקומות הכי טובים בסקנדינביה',
    idea: { emphasisHe: '' },
    style: 'minimal',
    coverImage: null,
    slides: [1, 2, 3, 4, 5].map((n) => ({ n, nameHe: `מקום ${n}`, fields: [], image: null })),
  };
  const one = await renderDeckSize(deck, { size: 'instagram', outDir, only: [2] });
  eq('only: [2] renders one slide', one.length, 1);
  // The index comes from the slide's place in the WHOLE deck, not from the
  // filtered array. Getting this wrong writes the right picture to the wrong
  // filename, and on an Instagram cover it also prints "1 / 1" on a deck of six.
  eq('numbered by its place in the whole deck', one[0].index, 2);
  ok('which is what the filename says', /-instagram-02\.jpg$/.test(one[0].filename), one[0].filename);

  // Seven, not six: the cover, five places, and the closing slide every
  // slideshow now ends on. See src/deck/follow.js.
  const whole = await renderDeckSize(deck, { size: 'instagram', outDir });
  eq('and without `only` the whole deck still renders', whole.length, 7);
  ok('the last slide is the reason to follow', whole.at(-1).follow === true);
  ok('and it is the only one', whole.filter((s) => s.follow).length === 1);
  // It carries the drawn ask as its headline, which is what the approval message
  // prints and what the viewer reads on the last swipe.
  {
    const { captionFollow } = await import('../src/hashtags.js');
    const asks = new Set(postConfig().caption.follows.map((f) => f.askHe));
    ok('naming one of the asks from the pool', asks.has(whole.at(-1).nameHe), whole.at(-1).nameHe);
    ok('captionFollow is what drew it', Boolean(captionFollow({ rand: () => 0 }).askHe));
  }

  // A deck that already ends on an ask does not get a second one. An itinerary
  // with the giveaway on closes on "עקבו ותגיבו רומא", which is a follow ask with
  // a better reason attached than anything in the pool.
  const asked = await renderDeckSize(
    { ...deck, id: 'selftest-asked', slides: [...deck.slides, { n: 6, nameHe: 'עקבו ותגיבו רומא', fields: [], bullets: [{ text: '5 מכם מקבלים 30 יום' }], image: null, ask: true }] },
    { size: 'instagram', outDir }
  );
  eq('a deck ending on an ask is left alone', asked.length, 7);
  ok('and closes on that ask rather than on a second one', asked.at(-1).follow === false);

  // A SITE DECK, RENDERED, AND ITS CLOSING SLIDES COUNTED.
  //
  // The bug this covers was invisible everywhere except on disk: a deck with a
  // destination page drew the follow ask AND the screenshot, eight files for a
  // deck the count called seven. Only a render can catch that, because the
  // duplication was in how the renderer composed its own list.
  //
  // `siteShot` is handed in rather than captured. renderDeck's probe loads the
  // real page, and this suite does not touch the network - with no screenshot the
  // probe would clear `siteSlug`, the deck would fall back to the follow slide,
  // and the test would pass by testing the wrong thing. A stub PNG is enough:
  // what is being counted is how many slides there are, not what is on them.
  const stubShot =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
  const sited = await renderDeckSize(
    { ...deck, id: 'selftest-site', where: 'פראג', siteSlug: 'prague' },
    { size: 'instagram', outDir, siteShot: stubShot }
  );
  eq('a site deck renders the cover, its places and one close', sited.length, 7);
  ok('no follow slide among them', sited.every((s) => s.follow === false), `${sited.filter((s) => s.follow).length} follow slides`);
  {
    const { publishedSlideCount: count } = await import('../src/deck/follow.js');
    eq(
      'and the count agrees with the files',
      count({ ...deck, where: 'פראג', siteSlug: 'prague' }),
      sited.length
    );
  }

  const { closeBrowser } = await import('../src/render/index.js');
  await closeBrowser().catch(() => {});
} catch (e) {
  console.log(`  ⚠ skipped (Playwright unavailable: ${e.message})`);
}

/* -------------------------------------------------------------------------- */
group('the admin site - the same decisions, in a browser');

{
  const { readUsers, checkLogin, signSession, readSession, cookieFor, readCookie, createThrottle } =
    await import('../src/admin/auth.js');

  // --- who may get in ------------------------------------------------------
  const users = readUsers('neta:hunter2,dana:pw,:blank,noPassword:');
  eq('a user list is parsed', [...users.keys()].join(','), 'neta,dana');
  ok('a nameless entry is dropped', !users.has(''));
  ok('and so is a passwordless one', !users.has('noPassword'));
  // A blank password would let anybody who guessed the name straight in, and a
  // typo in .env is the likeliest way to write one.
  eq('an empty user list means the site is off', readUsers('').size, 0);
  eq('and so does a missing one', readUsers(undefined).size, 0);

  ok('the right password gets in', checkLogin('neta', 'hunter2', users));
  ok('the wrong one does not', !checkLogin('neta', 'hunter3', users));
  ok('a name nobody has does not', !checkLogin('ghost', 'hunter2', users));
  ok('and neither does an empty password', !checkLogin('neta', '', users));
  // One password per person is what makes "who approved this" answerable.
  ok('a second admin has their own password', checkLogin('dana', 'pw', users));
  ok('and cannot use the first one', !checkLogin('dana', 'hunter2', users));

  // --- sessions ------------------------------------------------------------
  const key = Buffer.from('a-test-key-for-sessions-only....');
  eq('a session round-trips', readSession(signSession('neta', { key }), { key }), 'neta');
  eq('a tampered signature is refused', readSession(signSession('neta', { key }).slice(0, -3) + 'xyz', { key }), null);
  eq('junk is refused rather than thrown at', readSession('nonsense', { key }), null);
  eq('so is nothing at all', readSession(null, { key }), null);
  // The expiry is INSIDE the signed payload rather than left to the cookie's
  // Max-Age, which is a request to the browser and nothing more.
  eq('an expired session is refused', readSession(signSession('neta', { key, hours: -1 }), { key }), null);
  // A different key must not validate — this is what stops a session signed on
  // one box being replayed against another.
  eq('a session signed with another key is refused',
    readSession(signSession('neta', { key }), { key: Buffer.from('b-different-key-entirely.......!') }), null);
  // The name cannot be swapped without re-signing: the payload is inside the MAC.
  {
    const [, expiry, sig] = signSession('neta', { key }).split('.');
    const forged = `${Buffer.from('dana').toString('base64url')}.${expiry}.${sig}`;
    eq('and the name cannot be swapped', readSession(forged, { key }), null);
  }

  const cookie = cookieFor('tok');
  ok('the cookie is HttpOnly', /HttpOnly/.test(cookie), cookie);
  ok('and SameSite=Strict, which is most of the CSRF defence', /SameSite=Strict/.test(cookie));
  ok('and Secure, because Caddy terminates TLS in front', /Secure/.test(cookie));
  ok('clearing it expires immediately', /Max-Age=0/.test(cookieFor('')));
  eq('the cookie is read back out of a crowded header',
    readCookie('other=1; tiyul_admin=abc; third=2'), 'abc');
  eq('and a header without it reads null', readCookie('other=1'), null);

  // --- the login throttle --------------------------------------------------
  // A delay rather than a lockout: a lockout on a site with three users is a
  // denial of service anybody can trigger on the owner's behalf.
  const throttle = createThrottle({ base: 100, max: 1000 });
  eq('a fresh address waits for nothing', throttle.delayFor('1.2.3.4'), 0);
  throttle.fail('1.2.3.4');
  eq('one wrong password costs the base delay', throttle.delayFor('1.2.3.4'), 100);
  throttle.fail('1.2.3.4');
  throttle.fail('1.2.3.4');
  eq('and it doubles', throttle.delayFor('1.2.3.4'), 400);
  for (let i = 0; i < 20; i++) throttle.fail('1.2.3.4');
  eq('up to a ceiling', throttle.delayFor('1.2.3.4'), 1000);
  eq('another address is unaffected', throttle.delayFor('5.6.7.8'), 0);
  throttle.pass('1.2.3.4');
  eq('and a correct password clears it', throttle.delayFor('1.2.3.4'), 0);

  // --- what a candidate looks like to the page ------------------------------
  {
    const { stagedView, queuedView, mediaName } = await import('../src/admin/views.js');
    const { mkdtempSync, writeFileSync, utimesSync, rmSync: rmTmp } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join: j } = await import('node:path');

    const dir = mkdtempSync(j(tmpdir(), 'tiyul-views-'));
    const put = (name) => {
      writeFileSync(j(dir, name), 'x');
      return j('/var/www/tiyul/cards', name);
    };
    const cardFile = put('abc123.jpg');
    const slideFiles = [put('deck-1-01.jpg'), put('deck-1-02.jpg'), put('deck-1-03.jpg')];
    const clipFile = put('clip-xyz.mp4');
    const at = (ref) => String(ref).split('?v=')[0];

    // A CARD IN THE QUEUE HAS A PICTURE. It did not: the cover was chosen with
    // `slides.slice(0, 1) || [cardFile]`, and an empty array is truthy, so the
    // fallback never ran once and every queued card came back with none.
    const card = { id: 'abc123', kind: 'card', headline: 'כותרת', card: { file: cardFile }, publishTargets: ['instagram'] };
    const q = queuedView(card, 0, { dir });
    eq('a queued card carries exactly one picture', q.images.length, 1);
    eq('and it is its own rendered card', at(q.images[0]), 'abc123.jpg');
    eq('numbered from one, the way the list reads', q.n, 1);

    // A deck shows every slide where it is being reviewed, and only the cover
    // where it is being scanned.
    const deck = {
      id: 'deck1', kind: 'deck', headline: 'מצגת',
      deck: {
        preview: slideFiles.map((file) => ({ file })),
        // Enough of a deck for approvalMessage to render one, since `text` is
        // that message verbatim and rendering it is half of what is being
        // tested here.
        titleHe: 'מצגת',
        where: 'איסלנד',
        slides: [
          { n: 1, nameHe: 'סקוגאפוס', fields: [] },
          { n: 2, nameHe: 'גיסיר', fields: [] },
        ],
        counts: { asked: 2, built: 2, found: 5, withAuthority: 4 },
        dropped: [],
      },
      card: { file: slideFiles[0] },
      publishTargets: ['instagram', 'tiktok'],
      tiktokDraft: true,
    };
    eq('a queued deck shows its cover alone', queuedView(deck, 1, { dir }).images.length, 1);
    eq('and it is the FIRST slide, not an arbitrary one', at(queuedView(deck, 1, { dir }).images[0]), 'deck-1-01.jpg');
    eq('a staged deck shows every slide', stagedView({ key: 'k', cand: deck }, { dir }).images.length, 3);
    eq('in play order', stagedView({ key: 'k', cand: deck }, { dir }).images.map(at).join(','),
      'deck-1-01.jpg,deck-1-02.jpg,deck-1-03.jpg');

    // A clip is a video and nothing else, or the page draws a broken <img>
    // beside a working player.
    const clip = { id: 'clip1', kind: 'clip', headline: 'שורה', clip: { file: clipFile }, card: { file: clipFile }, publishTargets: ['tiktok'] };
    const cv = stagedView({ key: 'k', cand: clip }, { dir });
    eq('a clip carries a video', at(cv.video), 'clip-xyz.mp4');
    eq('and no stills at all', cv.images.length, 0);
    eq('a queued clip likewise', queuedView(clip, 0, { dir }).images.length, 0);

    // WHICH BUTTONS ARE LEGAL, answered by the server so the page cannot offer
    // one the server refuses. The same rules stagingButtons applies.
    ok('a card can be retitled', stagedView({ key: 'k', cand: card }, { dir }).canRetitle);
    ok('a deck cannot - its title is on the cover', !stagedView({ key: 'k', cand: deck }, { dir }).canRetitle);
    ok('and neither can a clip - its line is burned in', !cv.canRetitle);
    ok('a clip has no evidence to show', !cv.canSeeEvidence);
    ok('a card does', stagedView({ key: 'k', cand: card }, { dir }).canSeeEvidence);
    // Privacy is offered only when TikTok returned more than one level. A
    // button that cycles back to the same value lies about having options.
    eq('no privacy button without a choice', cv.privacy, null);
    eq('and one when there is',
      stagedView({ key: 'k', cand: { ...clip, tiktok: { options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'], privacy: 'SELF_ONLY' } } }, { dir }).privacy !== null,
      true);

    // THE VERSION TOKEN. A rendered card's filename comes from its candidate id,
    // so editing a headline writes over the same name — and without this the
    // browser keeps drawing the picture it already had while the text updates.
    const before = mediaName(cardFile, { dir });
    ok('a media reference carries a version', /\?v=\d+$/.test(before), before);
    // Re-rendered: same name, new bytes, new mtime.
    utimesSync(j(dir, 'abc123.jpg'), new Date(), new Date(Date.now() + 60_000));
    const after = mediaName(cardFile, { dir });
    eq('the name does not change when the card is re-rendered', at(after), at(before));
    ok('but the version does, so the browser refetches', after !== before, `${before} -> ${after}`);
    // A file that is gone still names itself, so the page can say which one.
    eq('a missing file still reports its name', mediaName('/nowhere/gone.jpg', { dir }), 'gone.jpg');
    ok('and carries no version to pretend with', !mediaName('/nowhere/gone.jpg', { dir }).includes('?v='));
    eq('nothing at all is nothing', mediaName(null, { dir }), null);

    // What it will ACTUALLY publish to, not what it was built for. A card queued
    // before the routing rule changed still carries telegram.
    const stale = { ...card, kind: 'card', pendingTargets: ['telegram', 'instagram'] };
    ok('a destination this kind may not use is dropped',
      !queuedView(stale, 0, { dir }).targets.includes('telegram'),
      queuedView(stale, 0, { dir }).targets.join(','));

    rmTmp(dir, { recursive: true, force: true });
  }

  // --- the server, driven over real HTTP -----------------------------------
  //
  // Started for real rather than stubbed, because everything worth checking here
  // is a property of the wiring: that a mutation without the CSRF header is
  // refused, that /api/media cannot be walked out of, that an action is
  // attributed to the person who signed in. None of that is visible from a unit
  // test of the handler.
  const saved = {
    users: process.env.ADMIN_USERS,
    secret: process.env.ADMIN_SECRET,
    insecure: process.env.ADMIN_INSECURE_COOKIES,
  };
  process.env.ADMIN_USERS = 'neta:hunter2';
  process.env.ADMIN_SECRET = 'selftest-admin-secret';
  process.env.ADMIN_INSECURE_COOKIES = '1';

  const { startAdminServer } = await import('../src/admin/server.js');
  const calls = [];
  const ops = {
    mediaDir: () => new URL('../public/admin/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    state: async () => ({ pending: [], proposals: [], queue: [], held: [], status: 's', health: 'h', usage: 'u', budgets: {} }),
    approve: async (k, o) => (calls.push(`approve:${k}:${o.by}`), { ok: true, said: 'ok' }),
    reject: async (k, o) => (calls.push(`reject:${k}:${o.by}`), { ok: true }),
    privacy: async () => ({ ok: true }),
    retitle: async (k, h) => (calls.push(`retitle:${k}:${h}`), { ok: true }),
    evidence: async () => ({ ok: true, text: 'quotes' }),
    buildProposal: async (k, t) => (calls.push(`prop:${k}:${(t || []).join('+')}`), { ok: true }),
    rejectProposal: async () => ({ ok: true }),
    publish: async (n) => (calls.push(`publish:${n}`), { ok: true }),
    draft: async (n) => (calls.push(`draft:${n}`), { ok: true }),
    retryHeld: async () => ({ ok: true }),
    clearHeld: async () => ({ ok: true }),
    build: async (b) => (calls.push(`build:${b.what}:${b.count ?? ''}`), { ok: true }),
  };

  // Port 0 so a developer with something on 8787 — or two test runs at once —
  // does not get EADDRINUSE instead of a result.
  const server = startAdminServer(ops, { port: 0, log: { lines: () => [{ at: 1, level: 'log', text: 'hello' }] } });
  ok('the server starts when ADMIN_USERS is set', Boolean(server));

  if (server) {
    await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
    const base = `http://127.0.0.1:${server.address().port}`;
    let jar = null;
    const hit = async (path, { method = 'GET', body, csrf = true, cookies = true } = {}) => {
      const res = await fetch(base + path, {
        method,
        headers: {
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...(csrf && method !== 'GET' ? { 'x-tiyul-admin': '1' } : {}),
          ...(cookies && jar ? { cookie: jar } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.get('set-cookie');
      if (set) jar = set.split(';')[0];
      const text = await res.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch {}
      return { status: res.status, text, json: parsed };
    };

    eq('the state needs a session', (await hit('/api/state')).status, 401);
    eq('and so does approving something', (await hit('/api/staging/k/approve', { method: 'POST' })).status, 401);
    eq('the login page itself is public', (await hit('/')).status, 200);
    ok('and it is the real page', (await hit('/')).text.includes('tiyul+'));

    eq('a wrong password is refused',
      (await hit('/api/login', { method: 'POST', body: { name: 'neta', password: 'no' } })).status, 401);
    ok('and hands out no cookie', jar === null);

    const login = await hit('/api/login', { method: 'POST', body: { name: 'neta', password: 'hunter2' } });
    eq('the right one signs in', login.status, 200);
    eq('and says who', login.json.me, 'neta');
    eq('the state now reads', (await hit('/api/state')).json?.ok, true);
    eq('and carries the name', (await hit('/api/state')).json?.me, 'neta');

    // THE CSRF CHECK. A cross-site form post cannot set a custom header, and
    // SameSite=Strict means the cookie would not travel anyway.
    eq('a mutation with no x-tiyul-admin header is refused',
      (await hit('/api/staging/k1/approve', { method: 'POST', csrf: false })).status, 403);
    eq('with the header it goes through',
      (await hit('/api/staging/k1/approve', { method: 'POST' })).json?.ok, true);
    ok('and the action is attributed to whoever signed in', calls.includes('approve:k1:neta'), calls.join(' '));

    await hit('/api/staging/k2/headline', { method: 'POST', body: { headline: 'כותרת חדשה' } });
    ok('a new headline reaches the bot with its text', calls.includes('retitle:k2:כותרת חדשה'));
    eq('evidence comes back as text', (await hit('/api/staging/k2/evidence')).json?.text, 'quotes');
    await hit('/api/proposals/p1/build', { method: 'POST', body: { targets: ['instagram', 'tiktok'] } });
    ok('a proposal carries its destinations', calls.includes('prop:p1:instagram+tiktok'));
    await hit('/api/queue/publish', { method: 'POST', body: { n: 3 } });
    ok('publish carries the number from the list', calls.includes('publish:3'));
    await hit('/api/queue/publish', { method: 'POST', body: {} });
    ok('and a bare publish means "the next one"', calls.includes('publish:null'));
    await hit('/api/build', { method: 'POST', body: { what: 'clip', count: 2 } });
    ok('a build request routes by name', calls.includes('build:clip:2'));
    eq('the log is readable', (await hit('/api/log')).json?.lines?.[0]?.text, 'hello');

    eq('an unknown route is 404', (await hit('/api/nope')).status, 404);
    eq('a real route with the wrong method is 405', (await hit('/api/staging/k/approve')).status, 405);

    // MEDIA CANNOT BE WALKED OUT OF. The check is on the resolved path, not on
    // the requested string: testing for ".." is the version that misses
    // url-encoding, backslashes and absolute paths.
    eq('media serves a file that is there', (await hit('/api/media?file=style.css')).status, 200);
    eq('and refuses an empty name', (await hit('/api/media?file=')).status, 400);
    // THE CACHE-BUSTING VERSION IS IGNORED BY THE SERVER. A rendered card's
    // filename comes from its candidate id, so editing a headline writes over
    // the same name and the browser keeps drawing what it already had — the
    // text updates and the picture does not. The client appends `&v=<mtime>`;
    // the server must serve the file regardless of what is in it.
    eq('a versioned request serves the same file',
      (await hit('/api/media?file=style.css&v=1727380000000')).status, 200);
    eq('and an unknown version is not a cache miss either',
      (await hit('/api/media?file=style.css&v=nonsense')).status, 200);
    for (const evil of ['../../.env', '..%2f..%2f.env', '....//.env', '/etc/passwd', 'C:\\Windows\\win.ini', '..\\..\\.env']) {
      const r = await hit(`/api/media?file=${encodeURIComponent(evil)}`);
      ok(`nothing escapes the media directory: ${evil}`, r.status === 404 || r.status === 403, `got ${r.status}`);
    }

    await hit('/api/logout', { method: 'POST' });
    eq('logging out ends the session', (await hit('/api/state')).status, 401);
    jar = `tiyul_admin=${'x'.repeat(48)}`;
    eq('a forged cookie is refused', (await hit('/api/state')).status, 401);

    await new Promise((r) => server.close(r));
  }

  // THE LAB MUST NOT SERVE REAL CARDS FOR ITS INVENTED POSTS.
  //
  // It used to: whatever JPEGs were in the card directory, under headlines that
  // had nothing to do with them — a Berlin airport post over a rendered card
  // about Ebola in Uganda, a deck listing Tromsø and Abisko showing Tokyo and
  // São Tomé. Which is indistinguishable from the site drawing the wrong file,
  // a bug it has actually had, so the lab was manufacturing false alarms about
  // working code. The pictures are generated per post now.
  //
  // Checked as source text because the lab is a script that opens a listener,
  // and the property worth protecting is structural: it must not reach into the
  // real card directory for its stills.
  {
    const lab = readFileSync(new URL('../scripts/admin-lab.js', import.meta.url), 'utf8');
    ok('the lab draws its own placeholders', lab.includes('function placeholder('));
    ok('and never serves a real card as a sample',
      !/images:\s*pics\b/.test(lab) && !/pics\.slice/.test(lab),
      'admin-lab.js is reading real card files again');
    ok('it serves them from a temp directory of its own', /mkdtempSync/.test(lab));
    ok('and still says the content is invented', /lab:\s*'/.test(lab));
    // The banner was `top: 0` at z-index 4 under a header at z-index 5, so it
    // parked itself exactly beneath the header and vanished on the first scroll.
    const css = readFileSync(new URL('../public/admin/style.css', import.meta.url), 'utf8');
    const labRule = css.slice(css.indexOf('.flash.lab'), css.indexOf('.flash.lab') + 240);
    ok('and the banner does not hide under the header', /position:\s*static/.test(labRule), labRule.slice(0, 80));
  }

  // Skeletons, and the four ways they go wrong.
  //
  // Source text again, for the reason the block above gives: app.js is a
  // browser script that touches `document` the moment it is evaluated, so
  // there is nothing to import. What is being protected here is not appearance
  // but the states where a placeholder outlives the thing it stood in for,
  // which is strictly worse than the blank box it replaced.
  {
    const html = readFileSync(new URL('../public/admin/index.html', import.meta.url), 'utf8');
    const app = readFileSync(new URL('../public/admin/app.js', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../public/admin/style.css', import.meta.url), 'utf8');

    // The page boots by asking /state, so the login form must not be what
    // ships visible: a valid cookie is the normal case and everybody was being
    // shown a password box for a few hundred milliseconds and then having it
    // taken away, which reads as having been signed out.
    ok('the login form ships hidden', /<div id="login" class="gate" hidden>/.test(html));
    ok('and the boot shell ships visible', /<div id="boot"[^>]*>/.test(html) && !/<div id="boot"[^>]*\shidden/.test(html));

    // Both real states have to dismiss it. A boot shell left up behind the app
    // is invisible; left up in place of it, the site never loads at all.
    ok('the boot shell is dismissed when signed in', /\$\('#boot'\)\.hidden = true/.test(app));
    ok('and when signed out', app.slice(app.indexOf('function showLogin')).includes("$('#boot').hidden = true"));

    // THE LAZY IMAGE DEADLOCK. An <img loading="lazy"> that is built detached
    // and waited on never loads, because it is never in any viewport, so the
    // placeholder stays up forever. The image has to be inside the slot.
    const shots = app.slice(app.indexOf('function shots('), app.indexOf('function pendingCard('));
    ok('a lazy image loads inside its placeholder', /box2\.append\(img\)/.test(shots),
      'the <img> is not being appended into the skeleton slot - a lazy image outside the document never fires load');
    ok('and a video waits on metadata, not load', /loadedmetadata/.test(shots));

    // Re-skeletoning content that is already there makes the page strobe on
    // the twenty second poll.
    ok('a filled region is never re-skeletoned', /node\.textContent\.trim\(\)/.test(app));

    // A placeholder for a build the server refused is a chair for a guest who
    // was turned away at the door.
    ok('a build placeholder waits for the server to accept', /res\.ok !== false && BUILD_HE\[what\]/.test(app));
    // A shoot never reaches the pending list, so a placeholder for one has
    // nothing that could ever clear it.
    ok('and a shoot gets none', /const BUILD_HE = \{[^}]*\}/.test(app) && !/BUILD_HE = \{[^}]*shoot/.test(app));
    ok('and no placeholder outlives its cap', /BUILD_MAX_MS/.test(app) && /b\.at > cutoff/.test(app));

    // Motion off means off. A pulse is still motion.
    const motion = css.slice(css.indexOf('@media (prefers-reduced-motion'));
    ok('reduced motion stops the sweep', /animation:\s*none/.test(motion.slice(0, 220)), motion.slice(0, 120));
  }

  // And the site is OFF, not merely unguarded, when nobody is configured.
  delete process.env.ADMIN_USERS;
  eq('with no users configured there is no listener', startAdminServer(ops, { port: 0, users: readUsers('') }), null);

  if (saved.users === undefined) delete process.env.ADMIN_USERS; else process.env.ADMIN_USERS = saved.users;
  if (saved.secret === undefined) delete process.env.ADMIN_SECRET; else process.env.ADMIN_SECRET = saved.secret;
  if (saved.insecure === undefined) delete process.env.ADMIN_INSECURE_COOKIES; else process.env.ADMIN_INSECURE_COOKIES = saved.insecure;
}

/* -------------------------------------------------------------------------- */
group('the contrast gate - no slide ships under target');

// WHAT THIS REPLACES, and why it is a gate rather than a default.
//
// The previous version measured a wash off the photograph and returned null for every
// image ever passed to it: it read `grid.length` on an object photo.js returns as
// `{lum, sat, hue}`. Every template silently used its own constant, sized for an
// average picture, and a sunlit white wall got the same treatment as a night shot.
// The owner's report was "the text cant be read because of the background ... one bad
// slide makes a whole deck useless".
//
// So these tests check the two properties that failure violated: that the measurement
// PRODUCES A NUMBER, and that a photograph a gradient cannot carry changes the slide
// rather than shipping dim.
{
  const white = treatmentFor(0.92);
  const mid = treatmentFor(0.21);
  const night = treatmentFor(0.012);

  ok('a blown-out sky cannot be carried by a soft wash and gets a band', white.treatment === 'band', JSON.stringify(white));
  ok('an ordinary photograph keeps its gradient', mid.treatment === 'veil', JSON.stringify(mid));
  ok('and a dark one keeps it too', night.treatment === 'veil', JSON.stringify(night));

  // THE PROPERTY THAT MATTERS. Every treatment reaches target, whichever it is.
  for (const [name, t] of [['white sky', white], ['mid', mid], ['night', night]]) {
    ok(`${name} clears the ${LEGIBLE_TARGET}:1 target at ${t.ratio}:1`, t.ratio >= LEGIBLE_TARGET - 0.05, JSON.stringify(t));
  }

  // Monotonic: a brighter picture never asks for less help than a darker one.
  ok('brighter photographs never ask for less treatment',
    treatmentFor(0.05).alpha <= treatmentFor(0.3).alpha && treatmentFor(0.3).alpha <= treatmentFor(0.8).alpha);

  // The floor is composition, not legibility - without it a dark photograph gets no
  // treatment at all, which reads as type that landed somewhere convenient.
  eq('a dark photograph still gets the composition floor', treatmentFor(0.01, { floor: 0.2 }).alpha, 0.2);

  // An unmeasurable image gets the treatment that always works, not the worst guess at
  // a gradient. A picture nobody could measure is exactly the white-sky case.
  eq('an unmeasurable image falls back to a band', treatmentFor(null).treatment, 'band');
  eq('and says so rather than claiming a measurement', treatmentFor(undefined).measured, false);

  // NEITHER TREATMENT IS EVER A PANEL. An earlier version escalated to a translucent
  // rounded box with a backdrop blur behind the type; it cleared the target and read as
  // a patch, which is what "i dont like the blur behind the text, does not look
  // professional at all" was about. Both answers are now gradients to a frame edge, and
  // this asserts the vocabulary so a panel cannot creep back in under a new name.
  for (const lum of [0.01, 0.2, 0.5, 0.8, 0.99]) {
    ok(`a photograph at ${lum} gets a gradient and not a panel`,
      ['veil', 'band'].includes(treatmentFor(lum).treatment), treatmentFor(lum).treatment);
  }
}

// THE WORST PATCH, NOT THE BRIGHTEST ROW. This is the case a row mean loses: a band
// that is dark across three quarters of its width with a sunlit wall in the last
// quarter. The mean reads comfortable; the words that land on the wall do not.
{
  const gw = 64, gh = 96;
  const lum = new Array(gw * gh).fill(0.02);
  for (let y = Math.floor(0.6 * gh); y < Math.floor(0.9 * gh); y++)
    for (let x = Math.floor(0.75 * gw); x < gw; x++) lum[y * gw + x] = 0.95;

  const worst = worstPatch({ lum }, { gw, gh, box: [0.07, 0.56, 0.93, 0.95], lines: 3 });
  const rowMean = (() => {
    let best = 0;
    for (let y = Math.floor(0.56 * gh); y < Math.floor(0.95 * gh); y++) {
      let s = 0;
      for (let x = 0; x < gw; x++) s += lum[y * gw + x];
      best = Math.max(best, s / gw);
    }
    return best;
  })();

  ok('the worst patch finds the bright corner a row mean averages away', worst > rowMean * 1.5,
    `patch ${worst.toFixed(3)} vs row mean ${rowMean.toFixed(3)}`);
  // And it buys real treatment with it. Not necessarily a plate - the window is half
  // the box wide and the bright block is a quarter of it, so the window correctly
  // averages the two, which is what a line of type does too. What matters is that the
  // slide is darkened for the corner rather than for the comfortable mean.
  ok('and pays for that corner in treatment',
    treatmentFor(worst).alpha >= treatmentFor(rowMean).alpha + 0.1,
    `worst ${treatmentFor(worst).alpha} vs row mean ${treatmentFor(rowMean).alpha}`);
  ok('both still land on target', treatmentFor(worst).ratio >= LEGIBLE_TARGET - 0.05);
}

// THE GATE ITSELF. It cannot fire on a measured slide, because the plate always
// reaches target - what it catches is the measurement path silently breaking, which is
// precisely how the last version failed.
{
  assertLegible([null, { treatment: 'veil', alpha: 0.4, ratio: 7.1, measured: true }], { where: 'ok' });
  ok('a post of passing slides passes', true);

  let stopped = null;
  try {
    assertLegible([{ treatment: 'veil', alpha: 0.72, ratio: 3.1, measured: true }], { where: 'post X' });
  } catch (e) {
    stopped = e.message;
  }
  ok('a slide under target stops the build', stopped !== null, 'did not throw');
  // And says which slide and how bad, because a gate that fails anonymously sends
  // somebody back through twenty-six renders by eye.
  ok('and names the slide and the ratio', /post X/.test(stopped || '') && /slide 1 at 3\.1/.test(stopped || ''), stopped);

  assertLegible([{ treatment: 'plate', alpha: 0.82, ratio: null, measured: false }]);
  ok('an unmeasured slide is not a failure', true);
}

// Every look that puts type on a photograph has a box. A look added without one would
// be measured against the bottom third whatever it actually does, which is the quiet
// kind of wrong this module exists to stop.
for (const look of ['label.cover', 'label.mid', 'label.lower', 'collage', 'route', 'notes', 'roll', 'deck', 'site']) {
  const box = TEXT_BOXES[look];
  ok(`${look} declares where its type sits`, Array.isArray(box) && box.length === 4 && box[2] > box[0] && box[3] > box[1],
    JSON.stringify(box));
}


/* -------------------------------------------------------------------------- */
group('narration - the voice, and what the subtitles do with it');

// WORD TIMINGS FROM CHARACTER ALIGNMENT.
//
// ElevenLabs reports a start and an end for every CHARACTER it spoke. A word's span is
// its first character's start to its last character's end, and assembling it that way
// rather than asking for word timings is not a workaround: characters are what the
// model aligns, so words built from them are exact rather than approximated.
{
  const alignment = {
    characters: ['ש', 'ל', 'ו', 'ם', ' ', 'ע', 'ו', 'ל', 'ם'],
    character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
    character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
  };
  const words = wordsFromAlignment('שלום עולם', alignment);
  eq('two words out of nine characters', words.length, 2);
  eq('the first word is the first run', words[0].text, 'שלום');
  eq('and it starts where its first character does', words[0].start, 0);
  eq('and ends where its last character does', Number(words[0].end.toFixed(2)), 0.4);
  eq('the second word starts after the space', Number(words[1].start.toFixed(2)), 0.5);
  ok('neither is marked as an estimate', !words[0].estimated && !words[1].estimated);
}

// A provider that reports nothing falls back to an estimate, AND SAYS SO. A caller has
// to be able to tell, because subtitles built on an estimate drift and a format that
// cares about sync should show whole sentences rather than pretend.
{
  const words = estimateTimings('אחת שתיים שלוש', 3);
  eq('an estimate still produces a word per word', words.length, 3);
  ok('and marks every one of them', words.every((w) => w.estimated === true));
  ok('and fills the duration it was given', Math.abs(words[2].end - 3) < 0.01, words[2].end);
  ok('longer words get longer spans', words.find((w) => w.text === 'שתיים').end - words.find((w) => w.text === 'שתיים').start >
    words.find((w) => w.text === 'אחת').end - words.find((w) => w.text === 'אחת').start);

  const nothing = wordsFromAlignment('אחת שתיים', null);
  ok('and a null alignment degrades to the estimate rather than throwing', nothing.length === 2 && nothing[0].estimated);
}

// SUBTITLE LINES NEVER STRADDLE A FULL STOP.
//
// Grouping on word count alone produced "באירופה. טיסות ישירות מנתב״ג" - the end of one
// sentence and the start of the next on one line, which reads as a line that begins in
// the middle of a thought because it does.
{
  const words = estimateTimings('פראג יפה. טיסות ישירות מנתבג כארבע שעות.', 8);
  const lines = subtitleLines(words);
  for (const l of lines) {
    const inner = l.text.slice(0, -1);
    ok(`"${l.text}" does not straddle a sentence end`, !/[.!?:]\s/.test(inner), l.text);
  }
  ok('and there is more than one line', lines.length > 1, lines.length);
}

// A pause ends a line wherever it falls, because that pause is where the speaker ended
// a thought - which a word counter cannot see.
{
  const words = [
    { text: 'אחת', start: 0, end: 0.4 },
    { text: 'שתיים', start: 0.4, end: 0.8 },
    // A full second of silence.
    { text: 'שלוש', start: 1.8, end: 2.2 },
  ];
  const lines = subtitleLines(words);
  eq('a pause breaks the line', lines.length, 2);
  eq('and the break falls at the pause', lines[0].text, 'אחת שתיים');
}

// A one-word tail joins the line before it. "שעות." alone on screen flashes past and
// reads as a stutter.
{
  const words = [
    { text: 'טיסות', start: 0, end: 0.4 },
    { text: 'ישירות', start: 0.4, end: 0.8 },
    { text: 'מנתבג', start: 0.8, end: 1.2 },
    { text: 'שעות.', start: 1.2, end: 1.5 },
  ];
  const lines = subtitleLines(words, { maxWords: 3, maxSeconds: 4 });
  ok('the orphan is merged rather than left alone', !lines.some((l) => l.text === 'שעות.'), JSON.stringify(lines.map((l) => l.text)));
}

// No key is not an error. The format degrades to a silent video with the same
// subtitles, which is a real post - but it must say which one it built.
{
  const saved = process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  const ready = speechReady();
  ok('with no key, narration is not ready', ready.ok === false);
  ok('and it names the missing thing', /ELEVENLABS_API_KEY/.test(ready.why || ''), ready.why);
  if (saved !== undefined) process.env.ELEVENLABS_API_KEY = saved;
}

// THE SCRIPT IS ASSEMBLED, NOT WRITTEN. Every sentence traces to a page field, and the
// one that does not is an ask rather than a claim. This is the honesty surface of the
// whole format: a narrator is the most persuasive thing this pipeline can produce.
{
  const city = {
    name: 'פראג',
    editorialRating: { verdict: 'אחת הערים היפות באירופה. העיר העתיקה עמוסה מאוד כמעט כל השנה.', score: 4.6 },
    practical: { flights: 'טיסות ישירות מנתבג כארבע שעות', around: 'מרכז העיר כולו מהלך' },
    places: [
      { id: 'a', name: 'גשר קרל', image: { src: 'data:image/jpeg;base64,x' }, rating: 5, mustSee: true },
      { id: 'b', name: 'הרובע היהודי', image: { src: 'data:image/jpeg;base64,x' }, rating: 5, mustSee: true },
      { id: 'c', name: 'מצודת פראג', image: { src: 'data:image/jpeg;base64,x' }, rating: 4, mustSee: true },
    ],
  };
  const script = buildScript(city, 'פראג');
  ok('the script opens by naming the destination', script.text.startsWith('פראג'), script.text.slice(0, 30));
  ok('and closes on the site rather than on a claim', /באתר/.test(script.text), script.text.slice(-40));
  ok('and the title promises what it delivers', /כל מה שצריך לדעת/.test(script.titleHe), script.titleHe);
  ok('it carries the shots it will be cut over', script.shots.length >= 3, script.shots.length);
}

/* -------------------------------------------------------------------------- */
group('the rotation offers every format, on different topics');

const { pickType } = await import('../src/posts/types.js');
const { hookShape } = await import('../src/posts/voice.js');
const { pickDestination } = await import('../src/plan/write.js');

{
  const botSrc = readFileSync(new URL('../bot.js', import.meta.url), 'utf8');

  // A FORMAT WITH NO DAILY BUDGET IS A FORMAT NOBODY IS SHOWN.
  //
  // The narrated guide was built, tested, deployed and reachable only from `/guide`:
  // the timer never produced one, so the only way to see the format was to remember it
  // existed. That is the same failure as a command missing from /help, one layer down -
  // and it is invisible in exactly the same way, because everything works.
  //
  // Read off the source rather than off a list, because a list is what just failed.
  const budgeted = [...botSrc.matchAll(/const ([A-Z]+)_PER_DAY\s*=/g)].map((m) => m[1].toLowerCase());
  for (const kind of ['decks', 'posts', 'postcards', 'guides', 'clips']) {
    ok(`${kind} has a daily budget`, budgeted.includes(kind), budgeted.join(', '));
  }

  // And each budget is actually SPENT by the timer. A constant nothing reads is the
  // same as no constant.
  for (const kind of ['DECKS', 'POSTS', 'POSTCARDS', 'GUIDES']) {
    ok(
      `${kind}_PER_DAY is read by the timer`,
      new RegExp(`${kind}_PER_DAY > 0`).test(botSrc),
      'declared but never compared'
    );
  }

  // Clips are the one deliberate zero: the owner paused the three stock shapes and
  // asked for the code to stay. Asserted so that "0" stays a decision rather than
  // becoming an accident somebody copies.
  ok('clips are paused on purpose, not missing', /CLIPS_PER_DAY = Math\.max\(0, Number\(process\.env\.CLIPS_PER_DAY \?\? '0'\)\)/.test(botSrc));
}

// EVERY POST TYPE CAN ACTUALLY BE DRAWN. A type with weight 0, or one the look table
// has no entry for, is configured and unreachable - the rotation would never produce it
// and nothing would say so.
{
  const cfg = postConfig().posts;
  for (const t of cfg.types) {
    ok(`${t.id} has a weight the rotation can draw`, Number(t.weight) > 0, String(t.weight));
    ok(
      `${t.id} has at least one look`,
      cfg.looks.some((l) => (l.types || []).includes(t.id)),
      cfg.looks.map((l) => l.id).join(', ')
    );
    ok(`${t.id} has at least one hook`, hookShape(t.id)?.he?.length > 0);
  }

  // And the draw really reaches all of them rather than merely being allowed to.
  const seen = new Set();
  for (let i = 0; i < 4000; i++) seen.add(pickType({ history: [] }).id);
  for (const t of cfg.types) ok(`${t.id} comes up in the rotation`, seen.has(t.id), [...seen].join(', '));
}

// DIFFERENT TOPICS EACH TIME, which is a property of what the picker is TOLD rather
// than of the picker. recentPublished answers "what went out"; a destination suggested
// this morning and still awaiting approval is not in it, so five formats drawing
// independently could offer the same place all day.
{
  const ring = [];
  const note = (p) => {
    const name = String(p || '').trim();
    if (!name) return;
    ring.length = 0;
    ring.push(...[name, ...ring.filter((x) => x !== name)].slice(0, 20));
  };
  note('פראג');
  ok('a suggested place is remembered', ring.includes('פראג'));

  // The real one, through the store.
  const before = store.recentSuggested();
  store.noteSuggestedPlace('בדיקת רוטציה');
  ok('the store remembers a suggested place', store.recentSuggested().includes('בדיקת רוטציה'));
  ok('and it is the most recent one', store.recentSuggested()[0] === 'בדיקת רוטציה');
  store.noteSuggestedPlace('בדיקה שנייה');
  store.noteSuggestedPlace('בדיקת רוטציה');
  const ids = store.recentSuggested();
  ok('a repeat moves to the front rather than duplicating',
    ids[0] === 'בדיקת רוטציה' && ids.filter((x) => x === 'בדיקת רוטציה').length === 1, ids.slice(0, 4).join(', '));

  // EVERY KIND'S DESTINATION IS FOUND. Four kinds keep it in four different fields, and
  // a kind whose field is missed records nothing - the ring would quietly stop covering
  // it and the repetition would come back for that format alone.
  for (const [kind, cand, want] of [
    ['post', { kind: 'post', where: 'פראג' }, 'פראג'],
    ['deck', { kind: 'deck', where: 'וינה' }, 'וינה'],
    ['clip', { kind: 'clip', place: 'סנטוריני' }, 'סנטוריני'],
    ['card', { kind: 'card', card: { place: 'ליסבון' } }, 'ליסבון'],
  ]) {
    const key = store.addStaging(cand);
    ok(`a ${kind} records its destination`, store.recentSuggested()[0] === want, store.recentSuggested()[0]);
    store.takeStaging(key);
  }

  // And the picker honours it.
  const all = pickDestination([]);
  ok('a picker with nothing excluded returns something', Boolean(all));
  const avoided = pickDestination([all.he]);
  ok('and excludes what it was told to avoid', !avoided || avoided.he !== all.he, `${all.he} -> ${avoided?.he}`);
}

/* -------------------------------------------------------------------------- */
group('the hidden gems reel - the length is the format, and the hook has to deliver');

{
  const { fitHolds, sortShots } = await import('../src/video/hiddenGems.js');
  const cfg = postConfig().gems;

  // THE LENGTH IS THE FORMAT, AND EVERY ASSERTION HERE READS THE TARGET RATHER THAN
  // NAMING A NUMBER. Three of these tests hardcoded "about twelve seconds" and all
  // three failed the day the target moved to 7-9 for retention. A test that restates
  // a config value tests the config file, and it fails for the one reason that is
  // never a bug: somebody changed their mind on purpose.
  for (const n of [3, 4, 5]) {
    const fit = fitHolds(n, cfg);
    ok(
      `${n} offered lands inside the ${cfg.targetSeconds.min} to ${cfg.targetSeconds.max} second target`,
      fit.seconds >= cfg.targetSeconds.min && fit.seconds <= cfg.targetSeconds.max,
      `${fit.seconds}s`
    );
    ok(`${n} offered holds within the configured range`,
      fit.holds.every((h) => h >= cfg.holdSeconds.min && h <= cfg.holdSeconds.max), fit.holds.join(','));
    ok(`${n} offered is never MORE than ${n} shots`, fit.holds.length <= n, String(fit.holds.length));
    ok(`${n} offered keeps at least the ${cfg.shots.min} shot floor`, fit.holds.length >= Math.min(n, cfg.shots.min),
      String(fit.holds.length));
  }

  // THE SHOT COUNT FOLLOWS FROM THE LENGTH rather than being configured beside it,
  // which is the thing that changed. At a 7 to 9 second target four places do not
  // fit, so a morning that placed five clips still makes a three shot reel and the
  // brief's "3 clips of about 2 to 3 seconds" is an outcome rather than a setting.
  const five = fitHolds(5, cfg);
  ok('a five clip morning is cut to fit the target', five.dropped > 0 && five.holds.length < 5, JSON.stringify(five));

  // A configuration that cannot fit drops a shot rather than running long, because
  // the ceiling is the brief's and a viewer leaves a long one.
  const tight = fitHolds(5, { ...cfg, hookSeconds: 5, targetSeconds: { min: 8, max: 12 }, holdSeconds: { min: 2, max: 4 } });
  ok('a reel that cannot fit drops a shot', tight.dropped > 0, JSON.stringify(tight));
  ok('and stays under the ceiling', tight.seconds <= 12, `${tight.seconds}s`);

  // THE SHOT FILTER. Three different reasons a clip cannot carry a place name, and
  // they must not collapse into one: no confident place, the same place twice, and
  // the brief's fortnight rule.
  const clips = [
    { id: '1', src: 'a', duration: 20, vision: { place: 'Switzerland', site: 'Lauterbrunnen' } },
    { id: '2', src: 'b', duration: 20, vision: { place: 'Greece', site: 'Meteora' } },
    { id: '3', src: 'c', duration: 20, vision: { place: 'Switzerland', site: 'Lauterbrunnen' } },
    { id: '4', src: 'd', duration: 20, vision: {} },
    { id: '5', src: 'e', duration: 20, vision: { place: 'Iceland', site: 'Skogafoss' } },
  ];

  // TWO SITES IN ONE COUNTRY ARE TWO PLACES, which keying the dedupe on the country
  // got wrong and which cost five consecutive dry runs. Measured on a live search:
  // 14 labelled clips keyed by country are three places, barely the minimum, and on
  // an hour when one country dominates the reel cannot be built at all.
  const greek = sortShots(
    [
      { id: '1', src: 'a', duration: 20, vision: { place: 'Greece', site: 'Santorini' } },
      { id: '2', src: 'b', duration: 20, vision: { place: 'Greece', site: 'Meteora' } },
      // siteHe as the judge actually returns it, which is what makes the label a site
      // rather than the bare country - see clipSiteName.
      { id: '3', src: 'c', duration: 20, vision: { place: 'Italy', site: 'Dolomites', siteHe: 'דולומיטים' } },
      { id: '4', src: 'd', duration: 20, vision: { place: 'Italy', site: 'Dolomites', siteHe: 'דולומיטים' } },
      { id: '5', src: 'e', duration: 20, vision: { place: 'Greece' } },
    ],
    { want: 5, floor: 3 }
  );
  const greekLabels = greek.placed.map((p) => p.labelHe);
  eq('two Greek sites and one Italian are three places', greekLabels.length, 3);
  ok('the same site twice is one place', greekLabels.filter((l) => /דולומיטים/.test(l)).length === 1, greekLabels.join(' · '));
  ok('and a bare country is dropped beside a named site in it',
    !greekLabels.includes('יוון'), greekLabels.join(' · '));
  // WHICHEVER ORDER THEY ARRIVE IN. The first version checked inside the loop, so a
  // bare label that came first had no named site to be compared against yet: one reel
  // went out as "סנטוריני, יוון · יוון · פושימי אינארי טאישה, יפן".
  const bareFirst = sortShots(
    [
      { id: '1', src: 'a', duration: 20, vision: { place: 'Greece' } },
      { id: '2', src: 'b', duration: 20, vision: { place: 'Greece', site: 'Santorini' } },
      { id: '3', src: 'c', duration: 20, vision: { place: 'Iceland', site: 'Skogafoss' } },
    ],
    { want: 5, floor: 3 }
  ).placed.map((p) => p.labelHe);
  ok('a bare country arriving first is dropped too', !bareFirst.includes('יוון'), bareFirst.join(' · '));
  ok('and the named site in it survives', bareFirst.some((l) => /סנטוריני/.test(l)), bareFirst.join(' · '));
  // The reverse of that rule: a bare country with no named site of its own stays, and
  // is exactly what the brief's own example label "גאורגיה" is.
  const bare = sortShots(
    [
      { id: '1', src: 'a', duration: 20, vision: { place: 'Georgia' } },
      { id: '2', src: 'b', duration: 20, vision: { place: 'Greece', site: 'Meteora' } },
      { id: '3', src: 'c', duration: 20, vision: { place: 'Iceland', site: 'Skogafoss' } },
    ],
    { want: 5, floor: 3 }
  );
  ok('a country with no site of its own is still a place',
    bare.placed.some((p) => p.labelHe === 'גאורגיה'), bare.placed.map((p) => p.labelHe).join(' · '));
  // With three fresh places available the fortnight rule costs nothing: Skogafoss is
  // held back and the reel is built from the other three.
  const extra = [...clips, { id: '6', src: 'f', duration: 20, vision: { place: 'Italy', site: 'Cinque Torri' } }];
  const sorted = sortShots(extra, { seenPlaces: new Map([['סקוגאפוס, איסלנד', Date.now()]]), want: 5, floor: 3 });
  const labels = sorted.placed.map((p) => p.labelHe);
  eq('one shot per place', labels.length, 3);
  ok('the second angle on one valley is not a second place', labels.filter((l) => /לאוטרברונן/.test(l)).length === 1);
  ok('a place named this fortnight is held back', !labels.some((l) => /סקוגאפוס/.test(l)), labels.join(' · '));
  ok('and the holding back is recorded', sorted.skipped.some((s) => /held back/.test(s)), sorted.skipped.join('; '));
  ok('an unplaceable clip becomes a spare', sorted.spare.some((c) => c.id === '4'));
  ok('the strongest shot is last', labels[labels.length - 1] === 'לאוטרברונן, שווייץ', labels.join(' · '));
  const ordered = sortShots(extra, { want: 5, strongestLast: false }).placed.map((p) => p.labelHe);
  ok('and the order is reversible', ordered[0] === 'לאוטרברונן, שווייץ', ordered.join(' · '));

  // THE RULE YIELDS TO THERE BEING A POST, which is what drawWeighted and pickTrack
  // both do when their exclusions empty the pool. Two fresh places and a floor of
  // three: the reel is built, the oldest-named place comes back, and the card says so.
  const squeezed = sortShots(clips, {
    seenPlaces: new Map([
      ['סקוגאפוס, איסלנד', Date.now() - 86_400_000],
      ['מטאורה, יוון', Date.now() - 10 * 86_400_000],
    ]),
    want: 5,
    // A floor of two against one fresh place, so exactly one repeat is needed and the
    // question is WHICH. At a floor of three both stale places come back, which is
    // correct and tests nothing about the ordering.
    floor: 2,
  });
  eq('the reel is built rather than refused', squeezed.placed.length, 2);
  const back = squeezed.placed.map((p) => p.labelHe);
  ok('and it is the place named longest ago that comes back', back.some((l) => /מטאורה/.test(l)), back.join(' · '));
  ok('not the one named yesterday', !back.some((l) => /סקוגאפוס/.test(l)), back.join(' · '));
  ok('and the reuse is on the record', squeezed.skipped.some((s) => /is back/.test(s)), squeezed.skipped.join('; '));

  // And it never relaxes past the floor: a fourth or fifth shot is never a repeat.
  const plenty = sortShots(extra, { seenPlaces: new Map([['צ׳ינקווה טורי, איטליה', Date.now()]]), want: 5, floor: 3 });
  ok('a reel that reaches the floor on fresh places takes no repeat',
    !plenty.placed.some((p) => /צ׳ינקווה/.test(p.labelHe)), plenty.placed.map((p) => p.labelHe).join(' · '));
}

{
  const gems = await import('../src/hooks/gems.js');
  const cfg = postConfig().gems.hooks;
  const vars = { n: 3, placeList: ['לאוטרברונן, שווייץ', 'מטאורה, יוון', 'אגם בלד, סלובניה'], alt: 'סנטוריני' };

  // THE CATEGORY GATE IS THE HONESTY MECHANISM. A reel of place labels cannot deliver
  // a mistake or an insider claim, so those categories are not offered to it at all.
  const forReel = gems.templatesFor('hidden_gems_video').map((t) => t.category);
  ok('the reel is offered the counted shapes', forReel.includes('overlooked'));
  ok('and the comparison', forReel.includes('comparison'));
  ok('and never the mistake shape', !forReel.includes('mistake'), forReel.join(','));
  ok('and never the insider shape', !forReel.includes('insider'), forReel.join(','));
  const forVerdict = gems.templatesFor('verdict').map((t) => t.category);
  ok('the verdict post IS offered the mistake shape', forVerdict.includes('mistake'));
  ok('because its drawbacks are quoted off the page', forVerdict.includes('insider'));

  // A template whose variable this post cannot answer is skipped, never printed.
  const noAlt = gems.templateCandidates({ format: 'hidden_gems_video', vars: { n: 3, placeList: vars.placeList } });
  ok('a template needing an alternative is withheld without one',
    !noAlt.some((c) => /\{alt\}/.test(c.text) || c.template.id === 'insteadof'), noAlt.map((c) => c.template.id).join(','));
  ok('and nothing ships with a brace in it', !noAlt.some((c) => /[{}]/.test(c.text)));

  // THE DELIVERY GATE. A counted hook on a post with a different number of things is
  // the failure the account's own 0.5% like rate is.
  const guard = { maxWords: cfg.maxWords, minWords: cfg.minWords, banned: cfg.banned, deliverable: 3 };
  ok('a hook promising five on a three shot reel is refused',
    /promises 5/.test(gems.rejectHook('5 יעדים שאנשים לא חושבים עליהם מספיק', guard) || ''));
  eq('and the same line promising three is fine',
    gems.rejectHook('3 יעדים שאנשים לא חושבים עליהם מספיק', guard), null);
  ok('a banned word is refused', /banned/.test(gems.rejectHook('3 יעדים מטורף שלא מכירים', guard) || ''));
  // AND ITS INFLECTIONS. Hebrew writes five letters differently at the end of a word,
  // so "מטורף" and "מטורפים" share no substring and a plain match catches only the
  // singular - which is not how anybody would write it.
  ok('and so is the plural of it', /banned/.test(gems.rejectHook('3 יעדים מטורפים שלא מכירים', guard) || ''));
  ok('a line that stops mid phrase is refused', gems.rejectHook('הטעות שכל ישראלי עושה ב', guard) != null);
  ok('an unfilled slot is refused', /unfilled/.test(gems.rejectHook('במקום {alt}, תטוסו לכאן', guard) || ''));
  ok('an em dash is refused', /dash/.test(gems.rejectHook('3 יעדים — ששווים את הטיסה', { ...guard, maxWords: 9 }) || ''));
  ok('a claim of having been there is refused',
    /been there/.test(gems.rejectHook('3 יעדים שהייתי בהם בשנה האחרונה', guard) || ''));

  // A COUNTRY IN THE LINE HAS TO BE TRUE OF EVERY SHOT. The model writes "5 מקומות
  // ביוון" when it is handed five Greek labels, which is correct and was unchecked:
  // over a reel of three countries the same sentence is false, with the
  // counter-evidence burned onto the shots underneath it.
  const greekOnly = ['סנטוריני, יוון', 'מטאורה, יוון', 'לוטרו, יוון'];
  const mixed = ['סנטוריני, יוון', 'לאוטרברונן, שווייץ', 'נין בין, וייטנאם'];
  eq('naming the one country every shot is in is fine',
    gems.rejectHook('3 מקומות ביוון לטיול הקרוב שלכם', { ...guard, places: greekOnly }), null);
  ok('naming a country the reel does not show is refused',
    /names/.test(gems.rejectHook('3 מקומות באיטליה לטיול הקרוב שלכם', { ...guard, places: greekOnly }) || ''));
  ok('and naming one country over a reel of three is refused',
    /names/.test(gems.rejectHook('3 מקומות ביוון לטיול הקרוב שלכם', { ...guard, places: mixed }) || ''));
  eq('while a line that names none is fine over any reel',
    gems.rejectHook('3 יעדים שאנשים לא חושבים עליהם מספיק', { ...guard, places: mixed }), null);

  // THE THREE GUARDS THAT HAD TO BE NARROWED, each of which had rejected a line the
  // owner wrote himself. These are regression tests for exactly that.
  eq('an owner-written counted noun phrase is not a label',
    gems.rejectHook('3 מקומות לטיול הבא שלכם', guard), null);
  eq('the brief\'s own comparison line survives address',
    gems.rejectHook('במקום סנטוריני, תטוסו לכאן', { ...guard, deliverable: null }), null);
  eq('and a published post\'s own hook survives the pronoun',
    gems.rejectHook('לפני שאתם מזמינים לסנטוריני, שתי דקות', { ...guard, deliverable: null }), null);

  // THE SCORE. Honesty is a multiplier, so an unsourceable line cannot win on style.
  const templates = new Map(gems.templatesFor('hidden_gems_video').map((t) => [t.id, t]));
  const best = gems.scoreHook('3 יעדים שאנשים לא חושבים עליהם מספיק', { template: templates.get('notenough'), vars, maxWeight: 5 });
  const worst = gems.scoreHook('3 מקומות באירופה שכמעט אף ישראלי לא מכיר', { template: templates.get('noisraeli'), vars, maxWeight: 5 });
  ok('the account\'s best line scores highest', best.total > worst.total, `${best.total.toFixed(3)} vs ${worst.total.toFixed(3)}`);
  ok('the unsourceable one is demoted rather than deleted', worst.total > 0 && worst.total < best.total / 2, worst.total.toFixed(3));
  ok('a counted line reads as specific', best.specificity > 0, JSON.stringify(best.why));
  ok('and as curious', best.curiosity > 0.5, String(best.curiosity));
  const zero = gems.scoreHook('3 יעדים ששווים את הטיסה', { template: { ...templates.get('worthflight'), honesty: 0 }, maxWeight: 5 });
  eq('honesty zero is a score of zero however it reads', zero.total, 0);

  // THE MEMORY, WHICH IS WHAT STOPS THE SCORER BECOMING A TEMPLATE. Argmax over a
  // fixed pool ships the same line every time: four reels in one dry run opened on
  // the identical sentence, which is the right line and the wrong feed.
  const depth = postConfig().gems.hooks.memory;
  ok('the hook keeps a memory at all', depth >= 1, String(depth));
  const run = [];
  let used = [];
  for (let i = 0; i < 6; i++) {
    const one = await gems.writeGemHook({ format: 'hidden_gems_video', vars, deliverable: 3, write: false, avoid: used.slice(0, depth) });
    run.push(one.templateId);
    used.unshift(one.templateId);
  }
  eq('no two reels running open on the same shape', run.filter((x, i) => i && x === run[i - 1]).length, 0);
  ok('and the cycle is at least as deep as the memory', new Set(run.slice(0, depth + 1)).size === depth + 1, run.join(' '));
  ok('the best line still leads it', run[0] === 'notenough', run.join(' '));
  // And it yields rather than refusing when the memory would empty the pool, which is
  // the same fallback drawWeighted makes.
  const cornered = await gems.writeGemHook({
    format: 'hidden_gems_video',
    vars,
    deliverable: 3,
    write: false,
    avoid: gems.templatesFor('hidden_gems_video').map((t) => t.id),
  });
  ok('a memory that excludes everything still returns a hook', Boolean(cornered.text), cornered.error || '');

  // AND THE WHOLE CALL, with the model half switched off so it is deterministic.
  const got = await gems.writeGemHook({ format: 'hidden_gems_video', vars, deliverable: 3, write: false });
  eq('the chosen hook is the line that worked', got.text, '3 יעדים שאנשים לא חושבים עליהם מספיק');
  eq('and it is attributed', got.category, 'overlooked');
  ok('the runners up are kept', got.considered.length >= 3, String(got.considered.length));
  ok('and every one of them is deliverable', got.considered.every((c) => !/^\s*[0-9]/.test(c.text) || c.text.startsWith('3')));
  ok('nothing is ever returned with a brace', !/[{}]/.test(got.text));

  // The price comparison gate: a cost claim needs two published figures in one
  // currency, because converting would invent the rate.
  const cheap = { dailyCost: { currency: 'EUR', mid: { food: 30, transport: 10 } } };
  const dear = { dailyCost: { currency: 'EUR', mid: { food: 80, transport: 20 } } };
  const other = { dailyCost: { currency: 'JPY', mid: { food: 3000 } } };
  ok('cheaper is cheaper when both pages say so in one currency', gems.cheaperThan(cheap, dear));
  ok('and not when the figures are close', !gems.cheaperThan(dear, { dailyCost: { currency: 'EUR', mid: { food: 85, transport: 20 } } }));
  ok('and never across currencies', !gems.cheaperThan(cheap, other));
  ok('and never without a figure', !gems.cheaperThan({}, dear));
}

{
  // THE GENERIC CLIP CARD, which three multi-shot shapes used to fall through and
  // which printed four false warnings at them.
  const { clipApprovalMessage, audioLine } = await import('../src/video/clip.js');
  const reel = {
    kind: 'clip',
    hook: '4 יעדים שאנשים לא חושבים עליהם מספיק',
    hookNote: 'hidden gems: overlooked/notenough',
    place: 'איסלנד · גאורגיה',
    tiktokCaption: 'כל אלה במרחק טיסה: איסלנד · גאורגיה',
    clip: { shape: 'hidden_gems_video', seconds: 12.6, width: 1080, height: 1920, places: ['איסלנד', 'גאורגיה', 'לאוטרברונן, שווייץ'], audio: false },
  };
  const card = clipApprovalMessage(reel);
  ok('the card names the shape in Hebrew', /ג׳מים/.test(card), card.split('\n')[0]);
  ok('and the places in play order', /1\. איסלנד/.test(card));
  ok('and claims nothing it does not know', !/undefined/.test(card), card);
  ok('and never says the footage was not judged', !/לא נשפט/.test(card));
  ok('and never says the text was not measured', !/לא נמדד/.test(card));
  ok('the postcard reel gets the same card', /גלויות/.test(clipApprovalMessage({ ...reel, clip: { ...reel.clip, shape: 'postcard' } })));
  ok('and a held clip still gets its own', /Pexels/.test(clipApprovalMessage({ ...reel, clip: { ...reel.clip, shape: 'held' } })));

  // The audio line takes two shapes of the same field, because the three stock shapes
  // record the whole track entry and the reels record whether there is one at all.
  eq('no bed says so', audioLine({ clip: { audio: false } }), '🎵 הסאונד נבחר באפליקציה');
  ok('a named track prints its name', /bed-02/.test(audioLine({ clip: { audio: true, track: 'bed-02.mp3' } })));
  ok('and a track entry prints its licence', /CC0/.test(audioLine({ clip: { audio: { title: 'x', credit: 'y', licence: 'CC0' } } })));
  ok('and neither ever prints undefined', !/undefined/.test(audioLine({ clip: { audio: true } })));
}

{
  const { gemsCaption } = await import('../src/hashtags.js');
  const cand = { clip: { places: ['לאוטרברונן, שווייץ', 'מטאורה, יוון', 'אגם בלד, סלובניה'] } };
  const caption = gemsCaption(cand, { rand: () => 0 });
  const brand = postConfig().hashtags.brand;
  ok('the caption leads with a line about this post', caption.split('\n')[0].length > 0);
  ok('it names the places', /לאוטרברונן/.test(caption), caption);
  ok('it asks something a comment answers', /\?/.test(caption), caption);
  ok('the brand tag is on it', caption.includes(brand), caption);
  ok('and it is the first tag', caption.indexOf(brand) < (caption.indexOf('#טיול') + 1 || Infinity));
  const tags = caption.split(/\s+/).filter((w) => w.startsWith('#'));
  ok('two to four tags, not five', tags.length >= 2 && tags.length <= 4, tags.join(' '));
  ok('no pin, because every place is already on screen', !caption.includes('📍'), caption);
  ok('and no URL', !URL_LIKE.test(caption), caption);
}

/* -------------------------------------------------------------------------- */
group('the format rotation - half the output, and never three in a row');

{
  const { pickFormat, mixShares, slotsPerDay } = await import('../src/formats/rotation.js');

  // THE MIX IS WHAT THE OWNER ASKED FOR. Read off the config rather than hardcoded
  // here, so editing the file is not a test failure, but the SHAPE is asserted: the
  // reel leads, and the slideshows keep a real share.
  const shares = Object.fromEntries(mixShares().map((s) => [s.id, s.share]));
  ok('the gems reel is the lead format', shares.hidden_gems_video >= 0.4, String(shares.hidden_gems_video));
  ok('the slideshows keep a quarter', shares.post >= 0.2, String(shares.post));
  ok('and the video formats together are most of it',
    1 - shares.post >= 0.6, String(1 - shares.post));

  // The slot count is the four counters added up, NOT a new setting, which is how the
  // mix changes without the frequency changing.
  eq('four slots a day, from the four existing counters', slotsPerDay({}), 4);
  eq('and it follows the env rather than the config',
    slotsPerDay({ POSTS_PER_DAY: '3', POSTCARDS_PER_DAY: '0', GUIDES_PER_DAY: '0', CLIPS_PER_DAY: '1' }), 4);

  // NEVER THREE IN A ROW. The one rule the weights cannot express: at weight 50 a
  // fair draw produces a run of three one time in four.
  let history = ['hidden_gems_video', 'hidden_gems_video'];
  for (let i = 0; i < 40; i++) {
    const f = pickFormat({ history, rand: () => 0.01 });
    ok(i === 0 ? 'after two of the same format a third is refused' : `  and again at draw ${i}`, f.id !== 'hidden_gems_video', f.id);
    if (i === 0) break;
  }
  ok('a run of two is allowed', pickFormat({ history: ['hidden_gems_video'], rand: () => 0.01 }).id === 'hidden_gems_video');

  // The realized share, simulated, which is lower than the weight BECAUSE of the run
  // limit. Written into the config comment so nobody reads 50 and measures 43.
  const tally = {};
  let hist = [];
  let longest = 0;
  let run = 0;
  let last = null;
  for (let i = 0; i < 4000; i++) {
    const f = pickFormat({ history: hist });
    tally[f.id] = (tally[f.id] || 0) + 1;
    run = f.id === last ? run + 1 : 1;
    last = f.id;
    longest = Math.max(longest, run);
    hist = [f.id, ...hist].slice(0, 12);
  }
  eq('no format ever runs three deep', longest, 2);
  const realized = tally.hidden_gems_video / 4000;
  ok('the reel still comes out as about half', realized > 0.38 && realized < 0.5, realized.toFixed(3));
  ok('and every live format comes up', Object.keys(tally).length === mixShares().length, Object.keys(tally).join(','));

  // A named format bypasses the rotation, like /make does one level down.
  eq('a named format is honoured', pickFormat({ only: 'post' }).id, 'post');
  throws('and an unknown one is refused', () => pickFormat({ only: 'nope' }));
}

{
  // THE PER TYPE MEMORY, which is what lets a slideshow type actually lead. The global
  // memory of 2 is a 33% ceiling on share whatever the weight says.
  const { typesToAvoid, nextShape } = await import('../src/posts/types.js');
  const types = postConfig().posts.types;
  const verdict = types.find((t) => t.id === 'verdict');
  eq('the verdict type opts out of the memory', verdict.memory, 0);

  const history = [{ type: 'verdict' }, { type: 'verdict' }];
  const avoid = typesToAvoid(types, 2, history);
  ok('so it is not excluded after being used twice', !avoid.includes('verdict'), avoid.join(','));
  const after = typesToAvoid(types, 2, [{ type: 'plan' }, { type: 'list' }]);
  ok('while a type that declares nothing still is', after.includes('plan') && after.includes('list'), after.join(','));

  // And the realized share, which is the point of the whole mechanism.
  let hist = [];
  const tally = {};
  for (let i = 0; i < 2000; i++) {
    const s = nextShape({ history: hist });
    tally[s.type] = (tally[s.type] || 0) + 1;
    hist = [{ type: s.type, look: s.look, frame: s.frame, caption: s.caption }, ...hist].slice(0, 24);
  }
  const share = tally.verdict / 2000;
  ok('the lead slideshow type exceeds the 33% the global memory would cap it at', share > 0.5, share.toFixed(3));
  ok('and every other type still appears', types.every((t) => tally[t.id] > 0), JSON.stringify(tally));
}

/* -------------------------------------------------------------------------- */
group('delivery - a promise the post does not keep costs the like, not the view');

{
  const { costLine } = await import('../src/posts/verdict.js');
  const { bookingLine, bookingLines, notesSource } = await import('../src/posts/source.js');
  const { specificsIn, promisedBy, assertDelivers, pageSpecifics } = await import('../src/posts/deliver.js');

  // THE PRICE LINE, WHICH RETURNED NULL FOR EVERY DESTINATION IN THE CATALOGUE. Both
  // shapes the site actually publishes, neither of which is a number.
  const split = costLine({ dailyCost: { currency: 'CZK', mid: { transport: 191, food: 1055, activities: 381 } } });
  ok('the split shape is summed', /1,627/.test(split || ''), split);
  ok('and says what it does not cover', /בלי לינה/.test(split || ''), split);
  const range = costLine({ dailyCost: { currency: 'EUR', midRange: [20, 80] } });
  ok('the range shape stays a range', /20 עד 80/.test(range || ''), range);
  ok('the currency is in Hebrew', /יורו/.test(range || ''), range);
  eq('a page with no cost gets no line', costLine({}), null);
  eq('and neither does one with a currency and no figure', costLine({ dailyCost: { currency: 'EUR' } }), null);
  ok('no Latin currency code reaches a Hebrew slide for the common ones',
    !/[A-Z]{3}/.test(costLine({ dailyCost: { currency: 'JPY', mid: { food: 9877 } } }) || ''),
    costLine({ dailyCost: { currency: 'JPY', mid: { food: 9877 } } }));
  // An unknown currency falls back to its code rather than losing the price.
  ok('and an unlisted currency still prints',
    /XYZ/.test(costLine({ dailyCost: { currency: 'XYZ', mid: { food: 10 } } }) || ''));

  // THE BOOKING FACT. Verbatim off the page's own day notes, which is where this
  // catalogue keeps the one thing a "before you book" cover is actually for.
  const city = {
    itinerary: [
      { day: 1, notes: 'להתחיל מוקדם בכיכר העיר העתיקה. הרובע היהודי דורש כרטיס משולב לבתי הכנסת.' },
      { day: 2, notes: 'כרטיסים לסגרדה פמיליה נמכרים לפי שעת כניסה וכדאי להזמין מראש.' },
    ],
  };
  const booked = bookingLine(city);
  ok('a booking fact is found', Boolean(booked), booked);
  ok('and it is verbatim off the page', notesSource(city).includes(booked), booked);
  ok('the plan-for-the-day sentence is not mistaken for one', !/להתחיל מוקדם/.test(booked), booked);
  eq('two can be had when the page has two', bookingLines(city, { want: 2 }).length, 2);
  eq('a page with no notes has none', bookingLine({ itinerary: [] }), null);

  // WHAT THE COVER PROMISED, read off the hook rather than guessed.
  ok('a counted cover is read as counted', promisedBy('3 יעדים ששווים את הטיסה').counted === 3);
  ok('the before-you-book cover promises the practical answer', promisedBy('לפני שאתם מזמינים לפראג, שתי דקות').specifics);
  ok('and so does the score cover', promisedBy('נתנו לפראג 4.7. וזה למה').specifics);
  ok('a scenic cover promises nothing measurable', !promisedBy('המקומות הכי יפים בפראג').specifics);

  // AND THE GATE ITSELF.
  const thin = {
    titleHe: 'לפני שאתם מזמינים לפראג, שתי דקות',
    slides: [{ titleHe: 'לפני שאתם מזמינים לפראג, שתי דקות' }, { lines: [{ text: 'העיר העתיקה עמוסה מאוד' }] }],
  };
  eq('a practical promise with nothing behind it carries nothing', specificsIn(thin).length, 0);
  throws('and is refused', () => assertDelivers(thin, { where: 'verdict/פראג' }), 'undelivered_promise');
  const full = {
    titleHe: 'לפני שאתם מזמינים לפראג, שתי דקות',
    slides: [
      { titleHe: 'לפני שאתם מזמינים לפראג, שתי דקות' },
      { lines: [{ text: 'יום טיפוסי: כ-1,627 קורונה צ׳כית לאדם, בלי לינה' }] },
      { lines: [{ text: 'העונה הטובה: אפריל עד יוני' }] },
      { lines: [{ text: 'הרובע היהודי דורש כרטיס משולב' }] },
    ],
  };
  const audit = assertDelivers(full, { where: 'verdict/פראג' });
  ok('a post that answers the question passes', audit.ok);
  ok('and the audit says what it carried', audit.carries.length >= 3, audit.carries.join(','));
  ok('a scenic cover is never asked for specifics',
    assertDelivers({ titleHe: 'המקומות הכי יפים בפראג', slides: [{ titleHe: 'המקומות הכי יפים בפראג' }] }).ok);

  // A counted cover against the items the post actually has.
  throws('a cover promising twenty items over nine is refused', () => assertDelivers({
    titleHe: '20 דברים לעשות בפראג',
    slides: [{ titleHe: '20 דברים לעשות בפראג' }, ...Array.from({ length: 9 }, (_, i) => ({ number: `${i + 1}.`, titleHe: 'מקום' }))],
  }), 'overpromised_count');

  // THE FREE PREDICTOR must never be stricter than the gate it predicts, or it
  // deletes destinations that would have built fine.
  eq('a bare page predicts nothing', pageSpecifics({ places: [], itinerary: [] }).length, 0);
  const furnished = {
    bestSeason: 'אפריל עד יוני',
    practical: { flights: 'טיסה ישירה מתל אביב, כשלוש שעות.' },
    dailyCost: { currency: 'EUR', midRange: [20, 80] },
    editorialRating: { score: 4.5, verdict: 'עיר יפה. חסרונות: עמוס בקיץ.' },
  };
  ok('and a furnished one predicts at least the floor',
    pageSpecifics(furnished).length >= postConfig().posts.deliver.minSpecifics, pageSpecifics(furnished).join(','));
}

{
  // THE LIKE RATE, added to the ratios rather than replacing them.
  const { rates } = await import('../src/metrics/store.js');
  const { rankLikes, hookReport } = await import('../src/metrics/report.js');

  const r = rates({ views: 197, likes: 12, saved: 3, shares: 1 });
  ok('likes per view is computed', Math.abs(r.likeRate - 12 / 197) < 1e-9, String(r.likeRate));
  ok('and the save rate is untouched', Math.abs(r.saveRate - 3 / 197) < 1e-9, String(r.saveRate));
  eq('a post with no views has no like rate', rates({ likes: 5 }).likeRate, null);
  eq('and no rate at all', rates(null).views, null);

  // The account's own four posts, which is the table the whole change is built on.
  const rows = [
    { id: 'a', at: new Date().toISOString(), shape: { format: 'hidden_gems_video', hookCategory: 'overlooked', hookText: '3 יעדים שאנשים לא חושבים עליהם מספיק' }, media: { tiktok: '1' }, stats: { tiktok: { views: 197, likes: 12, by: 'hand' } } },
    { id: 'b', at: new Date().toISOString(), shape: { format: 'post', type: 'verdict', hookCategory: 'mistake', hookText: 'לפני שאתם מזמינים לסנטוריני, שתי דקות' }, media: { tiktok: '2' }, stats: { tiktok: { views: 1993, likes: 9, by: 'hand' } } },
    { id: 'c', at: new Date().toISOString(), shape: { format: 'post', type: 'verdict', hookText: 'נתנו לטוקיו 4.8, וזה למה' }, media: { tiktok: '3' }, stats: { tiktok: { views: 711, likes: 9, by: 'hand' } } },
  ];
  const ranked = rankLikes(rows.map((row) => ({ ...row, best: rates(row.stats.tiktok) })), 'format');
  eq('the reel ranks first on likes per view', ranked[0].key, 'hidden_gems_video');
  ok('and the slideshow last', ranked[ranked.length - 1].key === 'post', JSON.stringify(ranked.map((x) => x.key)));

  const report = hookReport({ days: 14, rows });
  ok('the report ranks by format', /hidden_gems_video/.test(report));
  ok('and by hook category', /overlooked/.test(report));
  ok('and names the hooks themselves', /לא חושבים עליהם מספיק/.test(report));
  ok('and prints the views beside the rate, because the two disagree', /1,993/.test(report), report.slice(0, 200));
  ok('and says the weekly report still leads on saves', /שמירות/.test(report));
  ok('an empty window says how to type numbers in', /views/.test(hookReport({ days: 14, rows: [] })));
}

{
  // THE SLIDE REEL is off by default and the types it may run on are declared.
  const { reelable } = await import('../src/video/slideReel.js');
  const cfg = postConfig().posts.video;
  ok('the video variant is off until somebody turns it on', cfg.on === false);
  ok('the list format may be one', reelable('list'));
  ok('and the camera roll', reelable('roll'));
  ok('a map post may not', !reelable('map'));
  ok('the cover is held longer than the rest', cfg.coverSeconds > cfg.holdSeconds);
}

/* -------------------------------------------------------------------------- */
group('retention - 3.1 seconds of 12 is where the hook used to disappear');

{
  const { retentionPlan, validateRetentionPlan, orderForOpenLoop, shotMeasure, loopDistance, ordinalHe } =
    await import('../src/video/retention.js');
  const { pickOpenLoop } = await import('../src/hooks/gems.js');
  const cfg = postConfig().gems;
  const r = cfg.retention;

  const shots = [
    { labelHe: 'לאוטרברונן, שווייץ', vision: { destination: 9 }, rank: 9 },
    { labelHe: 'אושגולי, גאורגיה', vision: { destination: 7 }, rank: 8.5 },
    { labelHe: 'מטאורה, יוון', vision: { destination: 8 }, rank: 7 },
  ];
  const plan = retentionPlan({ shots, hookHe: '3 יעדים', openLoopHe: 'תחכו לאחרון', questionHe: '1, 2 או 3? 👇' });

  // THE FIVE NUMBERS THE ANALYTICS ASKED FOR, each one a moment on the timeline.
  ok('the first cut lands before the drop-off', plan.firstCutAt <= r.maxFirstCutSeconds, `${plan.firstCutAt}s`);
  ok('the hook is the only message for three to four seconds',
    plan.hookFullUntil >= r.hookFullSeconds - 0.01, `${plan.hookFullUntil}s`);
  ok('the whole reel fits the target',
    plan.seconds >= cfg.targetSeconds.min && plan.seconds <= cfg.targetSeconds.max, `${plan.seconds}s`);
  ok('the hook is still on screen at the end, as a header',
    plan.cards[plan.cards.length - 1].headerHe === '3 יעדים');
  ok('every place card carries a counter', plan.cards.filter((c) => !c.big).every((c) => /^\d+\/3$/.test(c.counterHe)));
  ok('the question is on the last card and nowhere else',
    plan.cards.filter((c) => c.questionHe).length === 1 && plan.cards[plan.cards.length - 1].questionHe);

  // THE FIRST PLACE'S NAME IS READABLE AFTER THE HOOK SHRINKS, which is the constraint
  // that makes the first shot longer than the others. Without it the label gets eight
  // tenths of a second, which is the same defect as no label.
  const firstLabel = plan.cards.find((c) => c.labelHe);
  ok('the first label gets its minimum on screen',
    firstLabel.to - firstLabel.from >= r.labelMinSeconds - 0.01, `${(firstLabel.to - firstLabel.from).toFixed(2)}s`);
  ok('which is why the first shot is held longest', plan.holds[0] >= plan.holds[1], plan.holds.join(','));

  // AND THE CARDS NEVER OVERLAP, because two of them on screen at once is two
  // messages, which is the thing the owner's own rule is about.
  const sorted = [...plan.cards].sort((a, b) => a.from - b.from);
  ok('no two cards are on screen together',
    sorted.every((c, i) => i === 0 || c.from >= sorted[i - 1].to - 0.001), JSON.stringify(sorted.map((c) => [c.from, c.to])));

  // THE GATE. Every one of the brief's refusal reasons, checked on a plan that has it.
  ok('a good plan passes', validateRetentionPlan(plan, { openLoop: { orderBy: 'surprise', needsSite: true, he: 'x' }, lastShot: { labelHe: 'א, ב', measure: 1 } }).ok);
  const noLoop = retentionPlan({ shots, hookHe: '3 יעדים', openLoopHe: null, questionHe: 'q' });
  ok('a hook with no open loop is refused',
    validateRetentionPlan(noLoop).problems.some((p) => /open loop/.test(p)));
  const noQuestion = retentionPlan({ shots, hookHe: '3 יעדים', openLoopHe: 'x', questionHe: null });
  ok('no question on the last shot is refused',
    validateRetentionPlan(noQuestion).problems.some((p) => /question/.test(p)));
  const slow = retentionPlan({
    shots,
    hookHe: 'h',
    openLoopHe: 'x',
    questionHe: 'q',
    cfg: { ...cfg, retention: { ...r, firstCutSeconds: 3.5 } },
  });
  ok('a first cut after the drop-off is refused',
    validateRetentionPlan(slow, { cfg: { ...cfg, retention: { ...r, firstCutSeconds: 3.5 } } }).problems.some((p) => /first cut/.test(p)),
    JSON.stringify(validateRetentionPlan(slow, { cfg: { ...cfg, retention: { ...r, firstCutSeconds: 3.5 } } }).problems));
  const promised = validateRetentionPlan(plan, {
    openLoop: { orderBy: 'surprise', needsSite: true, he: 'האחרון הכי מפתיע' },
    lastShot: { labelHe: 'יוון', measure: null },
  });
  ok('a promise about a place with no name is refused', !promised.ok, JSON.stringify(promised.problems));
  ok('and the refusal quotes the promise', promised.problems.some((p) => /מפתיע/.test(p)));

  // THE ORDER. Strongest first and the payoff last, which are two measures and
  // therefore not in conflict.
  const bySurprise = orderForOpenLoop(shots, { openLoop: { orderBy: 'surprise' }, strongestFirst: true });
  eq('the strongest shot opens', bySurprise.ordered[0].labelHe, 'לאוטרברונן, שווייץ');
  eq('and the one place not in the pinned list closes', bySurprise.last.labelHe, 'אושגולי, גאורגיה');
  const byBeauty = orderForOpenLoop(shots, { openLoop: { orderBy: 'beauty' }, strongestFirst: true });
  eq('a beauty loop closes on the highest destination score', byBeauty.last.labelHe, 'לאוטרברונן, שווייץ');
  ok('and then something else opens', byBeauty.ordered[0].labelHe !== 'לאוטרברונן, שווייץ', byBeauty.ordered[0].labelHe);

  eq('a bare country cannot be measured for surprise', shotMeasure({ labelHe: 'יוון' }, 'surprise'), null);
  ok('and can be for beauty', shotMeasure({ labelHe: 'יוון', vision: { destination: 8 } }, 'beauty') === 8);

  // THE MEASURES ARE CHECKED AGAINST THE RECORD THE PIPELINE ACTUALLY BUILDS, not
  // against a hand-made one. Both beauty loops were dead code in production for a
  // commit because sortShots built its shot without the judge's verdict on it, and
  // every test here passed: the fixtures carried a vision object and the real data did
  // not. A test that invents its own input is right about the function and can be
  // wrong about everything else.
  {
    const { sortShots } = await import('../src/video/hiddenGems.js');
    const judged = [
      { id: '1', src: 'a', duration: 20, rank: 9, vision: { place: 'Switzerland', site: 'Lauterbrunnen', destination: 9 } },
      { id: '2', src: 'b', duration: 20, rank: 7, vision: { place: 'Georgia', site: 'Ushguli', siteHe: 'אושגולי', destination: 8 } },
      { id: '3', src: 'c', duration: 20, rank: 8, vision: { place: 'Greece', site: 'Meteora', destination: 7 } },
    ];
    const real = sortShots(judged, { want: 5, floor: 3 }).placed;
    ok('a shot off the real path can be measured for beauty',
      real.every((s) => shotMeasure(s, 'beauty') != null), JSON.stringify(real.map((s) => s.vision?.destination)));
    ok('and for surprise', real.every((s) => shotMeasure(s, 'surprise') != null));
    ok('and carries the rank the opening order needs', real.every((s) => Number.isFinite(s.rank)));
  }

  // WHICH LOOPS ARE OFFERED IS A QUESTION ABOUT THE SHOTS, not about the words.
  const offered = new Set();
  for (let i = 0; i < 12; i++) {
    const o = pickOpenLoop({ shots, rand: () => i / 12 });
    if (o) offered.add(o.id);
  }
  ok('a reel of named sites is offered a surprise loop', [...offered].some((id) => /surprise|noone|lastsurprise/.test(id)), [...offered].join(','));
  ok('and never the price loop, which nothing can source', !offered.has('lastcheapest'), [...offered].join(','));
  const flat = [
    { labelHe: 'יוון', vision: { destination: 8 }, rank: 8 },
    { labelHe: 'איטליה', vision: { destination: 8 }, rank: 8 },
  ];
  const flatOffered = new Set();
  for (let i = 0; i < 12; i++) {
    const o = pickOpenLoop({ shots: flat, rand: () => i / 12 });
    if (o) flatOffered.add(o.id);
  }
  ok('a reel nothing can order gets only the loop that claims nothing',
    [...flatOffered].every((id) => id === 'waitend'), [...flatOffered].join(','));

  eq('the ordinal agrees with the shot count', ordinalHe(3), 'השלישי');
  eq('and falls back to "the last" past the table', ordinalHe(9), 'האחרון');

  // THE LOOP MEASURE. Identical frames are a perfect loop, opposites are not.
  const black = { r: 0, g: 0, b: 0, grid: Array(64).fill(0) };
  const white = { r: 255, g: 255, b: 255, grid: Array(64).fill(255) };
  eq('a frame against itself is a perfect loop', loopDistance(black, black), 0);
  ok('and against its opposite is the worst', loopDistance(black, white) > 0.9, String(loopDistance(black, white)));
  eq('an unmeasurable frame has no distance', loopDistance(null, white), null);

  // THE OLD TIMELINE IS STILL REACHABLE, which is the rollback.
  const off = retentionPlan({
    shots,
    hookHe: 'h',
    openLoopHe: 'x',
    questionHe: 'q',
    cfg: { ...cfg, retention: { ...r, on: false } },
  });
  eq('retention off puts the hook back on its own three second shot', off.hookSeconds, cfg.hookSeconds);
  ok('and draws one line per shot with nothing persistent',
    off.cards.every((c) => !c.headerHe && !c.counterHe && !c.questionHe));
  ok('and the gate passes anything when it is off', validateRetentionPlan(off, { cfg: { ...cfg, retention: { ...r, on: false } } }).ok);
}

{
  // THE SCORE GAINED A TERM, and it has to move the ranking without rewriting it.
  const gems = await import('../src/hooks/gems.js');
  const vars = { n: 3, placeList: ['לאוטרברונן, שווייץ'] };
  const t = gems.templatesFor('hidden_gems_video').find((x) => x.id === 'notenough');
  const bare = gems.scoreHook('3 יעדים שאנשים לא חושבים עליהם מספיק', { template: t, vars, maxWeight: 5 });
  const looped = gems.scoreHook('3 יעדים שאנשים לא חושבים עליהם מספיק תחכו לאחרון', { template: t, vars, maxWeight: 5 });
  ok('a counted line gets partial credit for implying more', bare.stay > 0 && bare.stay < 1, String(bare.stay));
  eq('an open loop gets all of it', looped.stay, 1);
  ok('and it moves the total', looped.total > bare.total, `${bare.total.toFixed(3)} -> ${looped.total.toFixed(3)}`);
  ok('but not by more than its weight', (looped.total - bare.total) / bare.total < 0.5, String((looped.total - bare.total) / bare.total));
}

{
  // THE METRICS THE RANKING NOW TURNS ON.
  const { rates } = await import('../src/metrics/store.js');
  const { rankWatch, hookReport } = await import('../src/metrics/report.js');

  // The post this whole change is about, as the owner read it off the app.
  const measured = rates({ views: 559, likes: 21, comments: 0, shares: 1, saved: 1, followers: 0, watchSeconds: 3.1, seconds: 12, fullWatch: 5.03 });
  ok('the watch ratio is the watch time over the length', Math.abs(measured.watchRatio - 3.1 / 12) < 1e-9, String(measured.watchRatio));
  ok('full watches come in as a percentage and store as a fraction', Math.abs(measured.fullWatchRate - 0.0503) < 1e-9);
  eq('followers are a count rather than a rate', measured.followers, 0);
  eq('a post with no watch time has no ratio', rates({ views: 100, likes: 4 }).watchRatio, null);
  eq('and no length means no ratio either', rates({ views: 100, watchSeconds: 3 }).watchRatio, null);

  // THE SAME POST WOULD RANK ABOVE A BETTER-LIKED ONE ON THE OLD TABLE AND BELOW IT
  // ON THIS ONE, which is the whole argument for the change.
  const now = new Date().toISOString();
  const rows = [
    { id: 'old', at: now, shape: { format: 'hidden_gems_video', openLoopId: null }, media: { tiktok: '1' },
      stats: { tiktok: { views: 559, likes: 21, watchSeconds: 3.1, seconds: 12, fullWatch: 5.03, by: 'hand' } } },
    { id: 'new', at: now, shape: { format: 'hidden_gems_video', openLoopId: 'lastsurprise' }, media: { tiktok: '2' },
      stats: { tiktok: { views: 400, likes: 14, watchSeconds: 5.4, seconds: 8.6, fullWatch: 34, by: 'hand' } } },
  ];
  const byLoop = rankWatch(rows.map((r) => ({ ...r, best: rates(r.stats.tiktok) })), 'openLoopId');
  eq('the open loop ranks first on watch time', byLoop[0].key, 'lastsurprise');
  const report = hookReport({ days: 14, rows });
  ok('the report leads with watch time', /זמן צפייה/.test(report.split('\n')[0]), report.split('\n')[0]);
  ok('it groups by open loop', /lastsurprise/.test(report));
  ok('it states the goal', /60%/.test(report) && /30%/.test(report));
  ok('and it still prints the like table underneath', /לייקים\/צפיות/.test(report));
}

/* -------------------------------------------------------------------------- */
group('the judging budget is spread across queries, not spent inside one');

{
  // THE MEASUREMENT THAT PRODUCED THIS, on the live box: 24 clips judged, 20 past the
  // destination gate, 16 labelled, and SIX distinct places - every one of them in
  // Greece. Thirty-eight other queries were never looked at, because their clips sat
  // below the Greek ones on a title string score. A reel needs three DIFFERENT places,
  // so a judging pass that spends itself inside one country starves the format
  // however many candidates the search returned.
  const { interleaveByQuery } = await import('../src/video/pexels.js');

  const ranked = [];
  for (const q of ['greece', 'italy', 'japan']) {
    for (let i = 0; i < 10; i++) ranked.push({ id: `${q}${i}`, query: q, score: q === 'greece' ? 100 - i : 10 - i });
  }
  ranked.sort((a, b) => b.score - a.score);
  ok('ranked by score alone, the first six are one query',
    new Set(ranked.slice(0, 6).map((c) => c.query)).size === 1, ranked.slice(0, 6).map((c) => c.query).join(' '));

  const queue = interleaveByQuery(ranked);
  eq('interleaved, the first three are three queries', new Set(queue.slice(0, 3).map((c) => c.query)).size, 3);
  eq('nothing is lost', queue.length, ranked.length);
  ok('and within a query the title order is kept',
    queue.filter((c) => c.query === 'greece').every((c, i, a) => i === 0 || a[i - 1].score >= c.score));
  // The best clip of the strongest query is still first, so the formats that want the
  // single best frame of the day are unaffected.
  eq('the best clip overall still leads', queue[0].id, 'greece0');
  eq('one query in is a no-op, which is what the montage shape passes', interleaveByQuery(ranked.filter((c) => c.query === 'italy')).length, 10);
  eq('and an empty pool stays empty', interleaveByQuery([]).length, 0);
}

/* -------------------------------------------------------------------------- */
group('every module loads - the check node --check cannot make');

{
  // WHY THIS EXISTS, AND IT IS A REAL BUG IT WOULD HAVE CAUGHT.
  //
  // A CSS comment inside a template literal contained backticks, which closed the
  // literal and broke the module. `node --check src/video/retention.js` passed it,
  // because that parses the file as a SCRIPT and every file here is ESM, and the
  // failure only appeared when something imported it. Three modules were broken for
  // the length of one commit and the syntax checker said they were fine.
  //
  // Importing each one also catches the two faults a parser cannot see at all: a
  // named import that does not exist in the module it comes from, and a dependency
  // cycle that is used during evaluation rather than inside a function.
  //
  // SRC ONLY, AND bot.js IS DELIBERATELY NOT IN IT. Importing bot.js STARTS THE BOT:
  // it launches Telegraf against the real token, and a second poller on one token
  // knocks the live instance off its long poll until pm2 restarts it. That is not a
  // hypothetical - it was done once while checking whether a module parsed, and the
  // production process restarted. Nothing under src/ has a side effect at import.
  const { readdirSync, statSync } = await import('node:fs');
  const { join, relative } = await import('node:path');

  const walk = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const at = join(dir, name);
      return statSync(at).isDirectory() ? walk(at) : at.endsWith('.js') ? [at] : [];
    });

  const root = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const files = walk(root).sort();
  let bad = 0;
  for (const file of files) {
    try {
      await import(`file:///${file.replace(/\\/g, '/')}`);
    } catch (e) {
      bad += 1;
      ok(`${relative(root, file)} loads`, false, e.message.slice(0, 120));
    }
  }
  ok(`all ${files.length} modules under src/ load`, bad === 0, `${bad} failed`);
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
