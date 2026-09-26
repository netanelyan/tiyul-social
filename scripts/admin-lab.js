import { readdirSync } from 'node:fs';
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

// Real pictures, because the layout questions are all about real proportions: a
// 4:5 card and a 9:16 slide do different things to a row that scrolls.
const dir = cardOutputDir();
let pics = [];
let vids = [];
try {
  const files = readdirSync(dir);
  pics = files.filter((n) => n.endsWith('.jpg'));
  vids = files.filter((n) => n.endsWith('.mp4'));
} catch {
  console.log(`(no media in ${dir} - the cards will draw without pictures)`);
}

const did = [];
const done = (what, said) => {
  did.push(what);
  console.log(`  → ${what}`);
  return { ok: true, said };
};

const ops = {
  mediaDir: () => dir,
  state: async () => ({
    // SAY SO, LOUDLY, AT THE TOP OF THE PAGE.
    //
    // The headlines here are invented and the pictures are whatever real cards
    // happen to be on disk, so the two never match - a card about a Berlin
    // terminal over a slide about a volcano in Uganda. That is unavoidable
    // without shipping sample images, and it reads exactly like the bug where
    // the site draws the wrong file for an item. Which is worse than a plain
    // placeholder would be, because it is a bug report waiting to happen about
    // code that is working.
    lab: 'תוכן לדוגמה · הכותרות מומצאות והתמונות הן קבצים אמיתיים מהדיסק, ולכן אינן תואמות',
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
        images: pics.slice(0, 1), video: null,
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
        images: pics.slice(1, 7), video: null,
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
        images: pics.slice(7, 8), video: null, targets: ['instagram'], draft: false,
      },
      {
        n: 2, id: 'card2', kind: 'card', headline: 'רכבת חדשה בין וינה לפראג',
        images: pics.slice(8, 9), video: null, targets: ['instagram'], draft: false,
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
