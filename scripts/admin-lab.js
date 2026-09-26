import { mkdtempSync, readdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadEnv } from '../src/env.js';
import { startAdminServer } from '../src/admin/server.js';
import { cardOutputDir } from '../src/render/index.js';

// Serve the admin site with made-up content, and no bot behind it.
//
//   npm run admin-lab              http://127.0.0.1:8788, log in as lab/lab
//   ADMIN_PORT=9000 npm run admin-lab
//
// WHY THIS EXISTS. The site's whole job is to show things awaiting a decision,
// so working on it against the real bot means either having something staged —
// which costs a gather, or a deck, or a clip — or looking at an empty page. And
// the interesting cases are the ones that are rare on purpose: a deck with six
// slides, a clip whose video has to play, a backlog cap that has gone full, an
// error long enough to wrap.
//
// Nothing here touches the store, the queue, or Telegram. Every action prints
// what it would have done and answers as though it worked, which is also how the
// screenshots in a review get taken.

loadEnv();
process.env.ADMIN_USERS = process.env.ADMIN_USERS || 'lab:lab';
process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || 'admin-lab-not-a-secret';
// The lab is plain http on localhost, and a Secure cookie is never sent back
// over it — which looks exactly like a site rejecting a correct password.
process.env.ADMIN_INSECURE_COOKIES = '1';
process.env.ADMIN_PORT = process.env.ADMIN_PORT || '8788';

// DRAWN PLACEHOLDERS, NOT REAL CARDS, and this is the whole point of the file.
//
// The first version of this lab served whatever JPEGs happened to be in the card
// directory. The proportions were right, which is what the layout questions are
// about — but the pictures had nothing to do with the invented headlines above
// them, so a post about a Berlin terminal sat over a rendered card about an Ebola
// outbreak in Uganda, and a deck listing Tromsø, Abisko and Rovaniemi showed
// Tokyo, São Tomé and Los Angeles.
//
// That is indistinguishable from the site drawing the wrong file, which is a real
// bug it has had. A lab that produces a convincing false alarm is worse than no
// lab: it costs an hour of looking for a fault in working code, and then it
// teaches you to ignore the thing it is meant to demonstrate. A banner saying
// "the pictures do not match" was the first attempt and was not good enough — the
// only correct fix is for there to be nothing to mismatch.
//
// So each one is generated, at the real aspect ratio, saying what it belongs to.
// Nothing here can be mistaken for a photograph, and every picture names its own
// post.
const dir = mkdtempSync(join(tmpdir(), 'tiyul-admin-lab-'));

const HUES = [210, 160, 28, 280, 340, 95];
function placeholder(name, { w, h, title, sub, n = null, hue = 210 }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="hsl(${hue} 34% 26%)"/>
    <stop offset="1" stop-color="hsl(${hue} 38% 14%)"/>
  </linearGradient></defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
  <rect x="18" y="18" width="${w - 36}" height="${h - 36}" fill="none"
        stroke="hsl(${hue} 40% 62%)" stroke-width="4" stroke-dasharray="22 16" opacity="0.55"/>
  <text x="${w / 2}" y="86" fill="hsl(${hue} 30% 72%)" font-family="system-ui, sans-serif"
        font-size="34" text-anchor="middle" letter-spacing="2">LAB · דוגמה</text>
  ${n === null ? '' : `<text x="${w / 2}" y="${h / 2 - 90}" fill="hsl(${hue} 45% 78%)"
        font-family="system-ui, sans-serif" font-size="150" font-weight="700" text-anchor="middle">${n}</text>`}
  <text x="${w / 2}" y="${h / 2 + 20}" fill="#ffffff" font-family="system-ui, sans-serif"
        font-size="60" font-weight="700" text-anchor="middle" direction="rtl">${title}</text>
  <text x="${w / 2}" y="${h / 2 + 100}" fill="hsl(${hue} 28% 80%)" font-family="system-ui, sans-serif"
        font-size="40" text-anchor="middle" direction="rtl">${sub}</text>
  <text x="${w / 2}" y="${h - 56}" fill="hsl(${hue} 25% 66%)" font-family="ui-monospace, monospace"
        font-size="28" text-anchor="middle">${w}×${h}</text>
</svg>`;
  writeFileSync(join(dir, name), svg);
  return name;
}

// A card is 4:5 for Instagram; a slide is 9:16. Both matter — they do different
// things to a row that scrolls, which is the layout question this lab answers.
const CARD = { w: 1080, h: 1350 };
const SLIDE = { w: 1080, h: 1920 };

// The one thing that cannot be drawn. A real clip is the only way to check that
// the player appears, is the right shape and has a scrubber — and a video of
// scenery makes no claim the headline above it can contradict, so borrowing one
// is honest in a way a rendered card with a headline burned into it is not.
let vids = [];
try {
  vids = readdirSync(cardOutputDir()).filter((n) => n.endsWith('.mp4'));
  if (vids[0]) copyFileSync(join(cardOutputDir(), vids[0]), join(dir, vids[0]));
} catch {
  // No card directory on this machine. The clip then draws the site's
  // "file not found" panel, which is a case worth seeing anyway.
}

const did = [];
const done = (what, said) => {
  did.push(what);
  console.log(`  → ${what}`);
  return { ok: true, said };
};

// Every picture is drawn for the post it belongs to, so the two can never
// disagree. See the note at `dir`.
const DECK_SLIDES = [
  'שער',
  'טרומסו, נורווגיה',
  'אבישקו, שוודיה',
  'רוברמולה, פינלנד',
  'סנפלסנס, איסלנד',
  'לופוטן, נורווגיה',
];
const cardPic = placeholder('lab-card.svg', { ...CARD, title: 'כרטיס', sub: 'ברלין', hue: 210 });
const deckPics = DECK_SLIDES.map((name, i) =>
  placeholder(`lab-deck-${String(i + 1).padStart(2, '0')}.svg`, {
    ...SLIDE, title: name, sub: 'מצגת · סקנדינביה', n: i + 1, hue: HUES[i % HUES.length],
  })
);
const planPic = placeholder('lab-plan.svg', { ...SLIDE, title: 'קופנהגן', sub: 'מסלול · 5 ימים', n: 1, hue: 160 });
const queuedCardPic = placeholder('lab-queued-card.svg', { ...CARD, title: 'כרטיס', sub: 'וינה - פראג', hue: 28 });
// The held tab draws no pictures - what is being read there is the error - so
// there is nothing to generate for it.

const ops = {
  mediaDir: () => dir,
  state: async () => ({
    // Still said out loud, because the CONTENT is invented even though the
    // pictures now match it - and somebody looking at a queue of five posts
    // should not have to work out whether they are real before acting on them.
    // The pictures no longer carry the claim; this line carries it.
    lab: 'תוכן לדוגמה · אף אחד מהפוסטים כאן אינו אמיתי ושום כפתור לא עושה דבר',
    pending: [
      {
        key: 'lab-card', id: 'card1', kind: 'card',
        headline: 'שדה התעופה בברלין פותח טרמינל חדש במרץ',
        text: [
          '📰 כרטיס · חדשות',
          '',
          'מקור: Berlin Brandenburg Airport',
          'ציטוט: "Terminal 2 will reopen for scheduled traffic in March"',
          '',
          '🏷️ #טיולים #ברלין #גרמניה #טיולבאירופה #חופשה',
        ].join('\n'),
        images: [cardPic], video: null,
        targets: ['instagram'], draft: false,
        canRetitle: true, canSeeEvidence: true, privacy: null,
        sourceName: 'Berlin Airport', sourceUrl: 'https://ber.de/',
      },
      {
        key: 'lab-deck', id: 'deck1', kind: 'deck',
        headline: 'המקומות הכי טובים בסקנדינביה לראות את האורות הצפוניים',
        text: [
          '🎞️ מצגת · 6 שקפים · אינסטגרם + טיקטוק',
          '',
          '1. טרומסו, נורווגיה',
          '2. אבישקו, שוודיה',
          '3. רוברמולה, פינלנד',
          '4. סנפלסנס, איסלנד',
          '',
          '🏷️ #סקנדינביה #אורותצפוניים #טיולים',
        ].join('\n'),
        images: deckPics, video: null,
        targets: ['instagram', 'tiktok'], draft: true,
        canRetitle: false, canSeeEvidence: true, privacy: null,
      },
      {
        key: 'lab-clip', id: 'clip1', kind: 'clip',
        headline: '4 מקומות שנראים מצוירים',
        text: [
          '🎬 קליפ חתוך · 4 קטעים · 15ש׳ · 1080x1920',
          '',
          '✍️ הפתיחה: 4 מקומות שנראים מצוירים',
          '   (מקומות שלא נראים אמיתיים · כמה מדינות)',
          '',
          '🎞️ הקטעים, לפי הסדר:',
          '   1. (הפתיחה) צ׳ינקווה טורי, איטליה',
          '   2. דולומיטים, איטליה',
          '   3. לאוטרברונן, שווייץ',
          '   4. טירס אל קטינאצ׳ו, איטליה',
        ].join('\n'),
        images: [], video: vids[0] || null,
        targets: ['tiktok'], draft: true,
        canRetitle: false, canSeeEvidence: false,
        // Only shown when TikTok offered more than one level, which is the case
        // the button exists for.
        privacy: 'ציבורי',
      },
    ],
    proposals: [
      {
        key: 'lab-idea', title: 'חופים נסתרים ביוון',
        text: '💡 חופים נסתרים ביוון\n\nיוון · 6 מקומות · לא פורסם משהו דומה ב-30 יום',
        proposedAt: Date.now() - 3_600_000,
      },
    ],
    queue: [
      {
        n: 1, id: 'plan1', kind: 'plan', headline: '5 ימים בקופנהגן ובמלמו',
        images: [planPic], video: null, targets: ['instagram'], draft: false,
      },
      {
        n: 2, id: 'card2', kind: 'card', headline: 'רכבת חדשה בין וינה לפראג',
        images: [queuedCardPic], video: null, targets: ['instagram'], draft: false,
      },
    ],
    held: [
      {
        n: 1, headline: 'פוסט שנתקע על אינסטגרם', kind: 'card',
        missing: ['instagram'], missingHe: 'אינסטגרם',
        error: 'Instagram: API access blocked (code 190) - the token may have been invalidated',
      },
    ],
    status: [
      '📊 מצב',
      '',
      '12 מקורות · 3 ממתינים לאישור · 2 בתור',
      'היום: 2/3 כרטיסים · נדחו 1',
      'האיסוף הבא בעוד 47 דק׳',
    ].join('\n'),
    health: ['🩺 יעדי פרסום', '', '✅ אינסטגרם: 14 הצלחות, 0 כשלונות', '⚠️ טיקטוק: מושפל · 3 כשלונות'].join('\n'),
    usage: 'opus 18.4k in / 2.1k out · sonnet 96k / 4k · haiku 11k / 0.6k',
    budgets: {
      cards: { today: 2, perDay: 3 },
      decks: { today: 1, perDay: 1, waiting: 1, max: 2 },
      // Deliberately full: the backlog cap is the one thing that stays shut for
      // days and is released by a decision rather than by waiting.
      clips: { today: 2, perDay: 2, waiting: 3, max: 3 },
      shoots: { today: 0, perDay: 1, window: '12:00-14:00, 19:00-22:00', now: { ok: false, why: 'מחוץ לחלון' } },
      clipShapes: ['cuts', 'held', 'cuts', 'held'],
    },
  }),

  evidence: async () => ({
    ok: true,
    text: [
      '📎 ציטוטים',
      '',
      '1. "Terminal 2 will reopen for scheduled traffic in March"',
      '   Berlin Brandenburg Airport · https://ber.de/',
    ].join('\n'),
  }),
  approve: async (k, o) => done(`approve ${k} (by ${o.by})`, '✅ אושר - 3 בתור'),
  reject: async (k, o) => done(`reject ${k} (by ${o.by})`, '❌ נדחה'),
  privacy: async (k) => done(`cycle privacy on ${k}`, '🔒 חברים בלבד'),
  retitle: async (k, h) => done(`retitle ${k} -> "${h}"`, '✏️ הכותרת עודכנה והכרטיס רונדר מחדש'),
  buildProposal: async (k, t) => done(`build ${k} for ${(t || []).join('+')}`, '⏳ בונה'),
  rejectProposal: async (k) => done(`reject proposal ${k}`, '❌ נדחה'),
  publish: async (n) => done(`publish ${n ?? 'next'}`, '⏳ מפרסם'),
  draft: async (n) => done(`draft ${n}`, '⏳ שולח לטיוטות'),
  retryHeld: async () => done('retry held', '🔁 1 פוסטים חזרו לתור'),
  clearHeld: async () => done('clear held', '🗑️ 1 פוסטים מוחזקים נמחקו'),
  build: async (b) =>
    done(
      `make ${b.what}${b.count ? ` x${b.count}` : ''}${b.shape ? ` (${b.shape})` : ''}${b.dest ? ` "${b.dest}"` : ''}`,
      `⏳ בונה ${b.what}`
    ),
};

const server = startAdminServer(ops, {
  log: {
    lines: () => [
      { at: Date.now() - 60_000, level: 'log', text: 'bot live (@tiyulplus_bot)' },
      { at: Date.now() - 50_000, level: 'log', text: '   cards to: instagram' },
      { at: Date.now() - 40_000, level: 'error', text: 'tiktok: publish failed - photo_pull_failed [code spam_risk_too_many_posts]' },
      { at: Date.now() - 30_000, level: 'log', text: 'clip: nothing to suggest - 24 judged, none above the destination gate' },
      ...did.map((d, i) => ({ at: Date.now() - i, level: 'log', text: `lab: ${d}` })),
    ],
  },
});

if (!server) {
  console.error('the lab could not start - ADMIN_USERS was cleared');
  process.exit(1);
}
console.log(`\nadmin lab · log in as ${process.env.ADMIN_USERS.split(':')[0]} / ${process.env.ADMIN_USERS.split(':')[1]}`);
console.log('nothing here touches the store, the queue or Telegram. ctrl-c to stop.\n');
