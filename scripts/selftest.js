import { loadEnv } from '../src/env.js';
loadEnv();

import { primaryAuthority, registry } from '../src/sources/index.js';
import { flightPriceGuard, verifyEvidence, verifyDraftText, RejectedError } from '../src/verify.js';
import { htmlToText, stripBoilerplate, decodeEntities } from '../src/fetchPage.js';
import { parseFeed } from '../src/sources/rss.js';
import { monthlyNormals, verdictFor } from '../src/sources/climate.js';
import { quotaBlock } from '../src/pillars.js';
import { scoreItem } from '../src/score.js';
import { candidateId } from '../src/candidate.js';
import { renderHtml, LAYOUTS, PHOTO_LAYOUTS, isPhotoLayout } from '../src/render/templates.js';
import { assertGenericAiPrompt, ImagePolicyError } from '../src/images.js';
import { approvalMessage } from '../src/format.js';
import { publishTargets } from '../src/publish/targets.js';

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
ok('B2B trade notices rank below traveller content', scoreItem(trade) < scoreItem({ ...trade, title: '箸作り体験を渋谷で開始' }));

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
group('image policy — AI imagery may only be generic');

throws('rejects a prompt naming the post\'s place', () => assertGenericAiPrompt('a sunny street in Lisbon', { place: 'Lisbon', country: 'Portugal' }));
throws('rejects a prompt naming the country', () => assertGenericAiPrompt('rooftops in portugal at dusk', { place: 'Lisbon', country: 'Portugal' }));
ok('allows an abstract prompt', assertGenericAiPrompt('abstract warm-toned travel texture', { place: 'Lisbon', country: 'Portugal' }));

/* -------------------------------------------------------------------------- */
group('rendering — escaping and layout selection');

const draft = {
  layout: 'fact',
  pillar: 'fact',
  headline: 'כותרת <script>alert(1)</script>',
  subhead: 'a & b',
  place: 'תל אביב',
  country: '',
  url: 'https://www.gov.uk/x',
  bullets: [],
};
const html = renderHtml(draft);
ok('interpolated content is escaped', !html.includes('<script>alert(1)</script>') && html.includes('&lt;script&gt;'));
ok('ampersand escaped', html.includes('a &amp; b'));
ok('document declares Hebrew and RTL', html.includes('lang="he"') && html.includes('dir="rtl"'));
ok('the font is inlined, not linked', html.includes('data:font/ttf;base64,') && !html.includes('fonts.googleapis'));
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
