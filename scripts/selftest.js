import { loadEnv } from '../src/env.js';
loadEnv();

import { primaryAuthority, registry } from '../src/sources/index.js';
import { flightPriceGuard, verifyEvidence, verifyDraftText, minSourceChars, noDecimalsUpFront, RejectedError } from '../src/verify.js';
import { safeStem } from '../src/render/index.js';
import { htmlToText, stripBoilerplate, decodeEntities } from '../src/fetchPage.js';
import { parseFeed } from '../src/sources/rss.js';
import { monthlyNormals, verdictFor } from '../src/sources/climate.js';
import { quotaBlock } from '../src/pillars.js';
import { scoreItem } from '../src/score.js';
import { candidateId } from '../src/candidate.js';
import { renderHtml, LAYOUTS, PHOTO_LAYOUTS, isPhotoLayout } from '../src/render/templates.js';
import { assertGenericAiPrompt, ImagePolicyError } from '../src/images.js';
import { approvalMessage, instagramCaption } from '../src/format.js';
import { publishTargets } from '../src/publish/targets.js';
import { hyphensOnly } from '../src/draft.js';

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
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  }
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond || !detail ? '' : ` — ${detail}`}`);
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
group('allowlist — "no source, no candidate"');

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
group('fare guard — flight prices out of scope in v1, other costs fine');

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
  eq(`${want ? 'blocks' : 'allows'}: ${text}`, Boolean(flightPriceGuard(text)), want);
}

throws(
  'verifyDraftText rejects a draft carrying a fare',
  () => verifyDraftText({ headline: 'טיסות זולות', caption: 'כרטיס טיסה החל מ-199 שקל הלוך ושוב לאתונה' }),
  'flight_price_out_of_scope'
);

/* -------------------------------------------------------------------------- */
group('claim verification — quotes must be verbatim');

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
      return verifyEvidence({ evidence: [{ claim: 'x', quote: 'starts  on 12 October, 2026 — for all non-EU nationals' }] }, SRC);
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
throws(
  'still rejects a Japanese quote that is genuinely too short',
  () => verifyEvidence({ evidence: [{ claim: 'x', quote: '渋谷で' }] }, JA_SRC),
  'unsupported_claim'
);

/* -------------------------------------------------------------------------- */
group('source text extraction — boilerplate must not become citable evidence');

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
group('feed parsing — RSS and Atom through one adapter');

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

/* -------------------------------------------------------------------------- */
group('climate — monthly normals and month verdicts');

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
group('topic quotas — kosher is a thread, not the theme');

const hist = (n, tagged) =>
  Array.from({ length: n }, (_, i) => ({ pillar: 'place', tags: i < tagged ? ['kosher'] : [] }));

ok('below the sample floor nothing is capped', quotaBlock({ pillar: 'place', tags: ['kosher'] }, hist(4, 4)) === null);
ok('kosher blocked once it is over its share', quotaBlock({ pillar: 'fact', tags: ['kosher'] }, hist(20, 5)) !== null);
ok('kosher allowed while under its share', quotaBlock({ pillar: 'fact', tags: ['kosher'] }, hist(20, 1)) === null);
ok('a single pillar cannot take over', quotaBlock({ pillar: 'place', tags: [] }, hist(20, 0)) !== null);
ok('an untagged post in a fresh pillar passes', quotaBlock({ pillar: 'route', tags: [] }, hist(20, 0)) === null);

/* -------------------------------------------------------------------------- */
group('ranking — the two misfires found against live feeds');

const base = { sourceId: 's', publishedAt: new Date().toISOString(), pillarHints: [] };
const fcdo = { ...base, authority: 'government', title: 'Norway', summary: 'x'.repeat(400) };
const trade = { ...base, authority: 'official-dmo', title: '「第29回JNTOインバウンド旅行振興フォーラム」取材のご案内', summary: 'y'.repeat(400) };

ok('a short title with a real summary is not penalised as thin', scoreItem(fcdo) > scoreItem({ ...fcdo, summary: '' }));
// An eruption at Etna is news; ten-year rainfall normals are not. The climate
// source stamped itself with the current time, took maximum recency every day,
// and led the queue with "4 rain days in Bangkok".
ok(
  'a real event outranks an evergreen dataset item',
  scoreItem({ title: 'Etna (Italy) - New Eruptive Activity', summary: 'x'.repeat(300), authority: 'government', publishedAt: new Date().toISOString(), pillarHints: ['fact'] }) >
    scoreItem({ title: 'Bangkok — monthly climate normals 2016–2025 (ERA5)', summary: 'x'.repeat(300), authority: 'dataset', publishedAt: null, evergreen: true, pillarHints: ['timing'] })
);
ok(
  'the evergreen flag is what does it, not the source name',
  scoreItem({ title: 'T', summary: 'x'.repeat(300), authority: 'dataset', evergreen: false }) >
    scoreItem({ title: 'T', summary: 'x'.repeat(300), authority: 'dataset', evergreen: true })
);

ok('B2B trade notices rank below traveller content',scoreItem(trade) < scoreItem({ ...trade, title: '箸作り体験を渋谷で開始' }));

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
group('rounding — a decimal on a card means it was generated, not written');

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
group('card filenames — a dedupeId is not automatically a safe filename');

// Found by measuring a real run: two drafting calls a day were being paid for
// and then thrown away at the render step, because the climate adapter's
// readable dedupeId contains colons.
eq('colons are replaced — Windows rejects them outright', safeStem('climate:dubai:2025'), 'climate-dubai-2025');
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
group('image policy — AI imagery may only be generic');

throws('rejects a prompt naming the post\'s place', () => assertGenericAiPrompt('a sunny street in Lisbon', { place: 'Lisbon', country: 'Portugal' }));
throws('rejects a prompt naming the country', () => assertGenericAiPrompt('rooftops in portugal at dusk', { place: 'Lisbon', country: 'Portugal' }));
ok('allows an abstract prompt', assertGenericAiPrompt('abstract warm-toned travel texture', { place: 'Lisbon', country: 'Portugal' }));

/* -------------------------------------------------------------------------- */
group('rendering — escaping and layout selection');

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
group('approval message — the source URL is never optional');

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

/* -------------------------------------------------------------------------- */
group('publish targets — Telegram may be approval-only');

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
  eq('neither configured yields no targets — bot refuses to start', targetsFor({ CHANNEL_ID: undefined }).length, 0);
});
withEnv(IG, () => {
  eq('both configured publishes to both', targetsFor({ CHANNEL_ID: '@c' }).join(','), 'telegram,instagram');
});
withEnv({ ...IG, CARD_PUBLIC_BASE_URL: undefined }, () => {
  eq(
    'Instagram without a public card URL is not configured — it cannot fetch the image',
    targetsFor({ CHANNEL_ID: undefined }).length,
    0
  );
});

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

// One fixed sign-off under every post, and no other link anywhere.
ok('carries the sign-off line', cap.includes('לסוכן הטיולים החכם שלנו'));
ok('carries the site', cap.includes('www.tiyulplus.com'));
ok('the sign-off is last', cap.trim().endsWith('www.tiyulplus.com'));
eq('exactly one link in the whole caption', (cap.match(/tiyulplus\.com/g) || []).length, 1);
ok('no scheme-prefixed URL anywhere', !/https?:\/\//.test(cap));

/* -------------------------------------------------------------------------- */
group('pexels stock provider');

{
  const realFetch = globalThis.fetch;
  const realKey = process.env.PEXELS_API_KEY;
  process.env.PEXELS_API_KEY = 'test-key';

  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  let searchUrl = null;
  let sentAuth = null;

  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).includes('api.pexels.com')) {
      searchUrl = String(url);
      sentAuth = opts.headers?.Authorization;
      return {
        ok: true,
        json: async () => ({
          photos: [
            { width: 400, src: { portrait: 'https://x/small.jpg' }, photographer: 'Too Small' },
            { width: 2000, src: { portrait: 'https://images.pexels.com/p.jpg' }, photographer: 'Ada L', url: 'https://pexels.com/photo/1' },
          ],
        }),
      };
    }
    return {
      ok: true,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength),
    };
  };

  const { search } = await import('../src/images/pexels.js');
  const got = await search('Lisbon old town alley');

  ok('sends the API key as an Authorization header', sentAuth === 'test-key');
  ok('asks for portrait crops - the card is 4:5, a landscape crop loses the subject', /orientation=portrait/.test(searchUrl || ''));
  ok('inlines the bytes as a data URI rather than hotlinking', got?.src?.startsWith('data:image/jpeg;base64,'));
  eq('tags provenance as stock', got?.provenance, 'stock');
  ok('credits the photographer', got?.credit?.includes('Ada L'));
  ok('skips photos narrower than the card', !/Too Small/.test(JSON.stringify(got)));
  eq('an empty query returns null rather than searching', await search('  '), null);

  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.PEXELS_API_KEY; else process.env.PEXELS_API_KEY = realKey;
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
group('font guard — the check that was silently passing');

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
  ok('document.fonts.check() is unreliable — it reports true with no @font-face at all', bare.naive === true, 'if this ever fails, the naive check may have become usable');
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
