import { loadEnv } from '../src/env.js';
import { writePlan, findDestination } from '../src/plan/write.js';
import { toPlanCandidate, planApprovalMessage } from '../src/plan/candidate.js';
import { closeBrowser } from '../src/render/index.js';

// Write one AI itinerary, render its slides, look at them.
//
//   npm run plan-lab                  somewhere chosen, the configured length
//   npm run plan-lab -- רומא          a named destination
//   npm run plan-lab -- רומא 5        and a named length
//   npm run plan-lab -- רומא 4 fake   no API call at all — see below
//
// Nothing is staged and nothing can publish. This is where the LAYOUT gets
// judged, and a queue full of slideshows nobody has looked at is the wrong
// place to do that.
//
// `fake` is the reason this script is worth having. Every other lab here needs
// a key and a network, and the question this one answers most often — does a
// four-stop day fit on a 1080x1920 frame with TikTok's rail cut out of it — has
// nothing to do with the model. The fixture is a real Rome plan with long names
// and long notes on purpose: if the worst case fits, the rest do.

loadEnv();

const args = process.argv.slice(2).filter((a) => a !== 'fake');
const fake = process.argv.includes('fake');
const asked = args.filter((a) => !/^\d+$/.test(a)).join(' ').trim();
const days = Number(args.find((a) => /^\d+$/.test(a))) || null;

const FIXTURE = {
  dest: { id: 'rome', he: 'רומא', en: 'Rome', country: 'איטליה' },
  days: [
    {
      n: 1,
      titleHe: 'העיר העתיקה',
      stops: [
        { timeHe: '09:00', nameHe: 'קולוסיאום', noteHe: 'כרטיס משולב עם הפורום, מזמינים מראש', costIls: 80 },
        { timeHe: '12:30', nameHe: 'הפורום הרומי', noteHe: 'נכנסים מרחוב הקדושים, פחות תור', costIls: 0 },
        { timeHe: '16:00', nameHe: 'כיכר ונציה', noteHe: 'עולים לגג של המונומנט למראה על העיר', costIls: 45 },
        { timeHe: '19:30', nameHe: 'טרסטוורה', noteHe: 'ארוחת ערב ברחובות הצדדיים, לא בכיכר', costIls: 120 },
      ],
    },
    {
      n: 2,
      titleHe: 'וותיקן ומערב הטיבר',
      stops: [
        { timeHe: '08:00', nameHe: 'מוזיאוני הוותיקן', noteHe: 'הכניסה הראשונה בבוקר, לפני הקבוצות', costIls: 90 },
        { timeHe: '11:30', nameHe: 'כנסיית פטרוס הקדוש', noteHe: 'הכניסה חינם, לכיפה משלמים בנפרד', costIls: 40 },
        { timeHe: '15:00', nameHe: 'טירת סנט אנג׳לו', noteHe: 'הגשר מלפניה הוא הצילום המוכר', costIls: 55 },
      ],
    },
  ],
  total: 430,
  dropped: [],
};

const plan = fake
  ? { ...FIXTURE, days: days ? FIXTURE.days.slice(0, days) : FIXTURE.days }
  : await writePlan({
      dest: asked ? findDestination(asked) : null,
      days,
    });

if (!fake && asked && !plan?.dest) {
  console.error(`${asked} is not in destinations.json`);
  process.exit(1);
}

// Recomputed rather than trusted on the fixture path too, so the lab cannot
// show a total the renderer would not have printed.
plan.total = plan.days.reduce((s, d) => s + d.stops.reduce((n, stop) => n + stop.costIls, 0), 0);

const cand = await toPlanCandidate(plan, { targets: ['instagram', 'tiktok'] });

console.log(`\n${planApprovalMessage(cand)}\n`);
console.log('slides:');
for (const size of ['tiktok', 'instagram']) {
  for (const s of cand.deck[size]) console.log(`   ${size.padEnd(9)} ${s.type.padEnd(5)} ${s.file}`);
}
console.log('\ncaption — instagram:');
console.log(cand.instagramCaption);
console.log('\ncaption — tiktok:');
console.log(cand.tiktokCaption);

await closeBrowser();
