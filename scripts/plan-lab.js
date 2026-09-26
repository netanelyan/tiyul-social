import { loadEnv } from '../src/env.js';
import { writePlan, resolveDestination } from '../src/plan/write.js';
import { toPlanCandidate, planApprovalMessage } from '../src/plan/candidate.js';
import { closeBrowser } from '../src/render/index.js';

// Write one AI itinerary, render its slides, look at them.
//
//   npm run plan-lab                  somewhere chosen, the configured length
//   npm run plan-lab -- רומא          a named destination
//   npm run plan-lab -- רומא 5        and a named length
//   npm run plan-lab -- רומא fake     a fixture itinerary, real photographs
//   npm run plan-lab -- רומא fake flat   ...and no photographs either
//
// Nothing is staged and nothing can publish. This is where the LAYOUT gets
// judged, and a queue full of slideshows nobody has looked at is the wrong
// place to do that.
//
// TWO SWITCHES, because there are two paid steps and they answer different
// questions. `fake` skips the planner and uses a fixture — a real Rome plan
// with long names on purpose — which is what you want when the question is
// about the slides rather than about the writing. `flat` additionally skips the
// photo libraries, so every slide falls back to the deck's own gradient: no
// keys, no money, and the fastest way to see where a line lands.
//
// Note what a real run costs: one search per stop across two libraries, each
// ending in a vision call, so a four-day plan looks at sixteen places before it
// draws anything. It is the slowest build in this project.

loadEnv();

const args = process.argv.slice(2).filter((a) => a !== 'fake' && a !== 'flat');
const fake = process.argv.includes('fake');
const flat = process.argv.includes('flat');
const asked = args.filter((a) => !/^\d+$/.test(a)).join(' ').trim();
const days = Number(args.find((a) => /^\d+$/.test(a))) || null;

const FIXTURE = {
  dest: { id: 'rome', he: 'רומא', en: 'Rome', country: 'איטליה' },
  days: [
    {
      n: 1,
      titleHe: 'העיר העתיקה',
      stops: [
        { timeHe: '09:00', nameHe: 'קולוסיאום', nameEn: 'Colosseum', noteHe: 'מזמינים מראש לשעה קבועה', costIls: 80 },
        { timeHe: '12:30', nameHe: 'הפורום הרומי', nameEn: 'Roman Forum', noteHe: 'נכנסים מרחוב הקדושים, פחות תור', costIls: 0 },
        { timeHe: '16:00', nameHe: 'כיכר ונציה', nameEn: 'Piazza Venezia', noteHe: 'עולים לגג של המונומנט', costIls: 45 },
        { timeHe: '19:30', nameHe: 'טרסטוורה', nameEn: 'Trastevere', noteHe: 'ארוחת ערב ברחובות הצדדיים', costIls: 120 },
      ],
    },
    {
      n: 2,
      titleHe: 'וותיקן ומערב הטיבר',
      stops: [
        { timeHe: '08:00', nameHe: 'מוזיאוני הוותיקן', nameEn: 'Vatican Museums', noteHe: 'הכניסה הראשונה בבוקר', costIls: 90 },
        { timeHe: '11:30', nameHe: 'כנסיית פטרוס הקדוש', nameEn: "St Peter's Basilica", noteHe: 'לכיפה משלמים בנפרד', costIls: 40 },
        { timeHe: '15:00', nameHe: 'טירת סנט אנג׳לו', nameEn: 'Castel Sant Angelo', noteHe: 'הגשר מלפניה הוא הצילום המוכר', costIls: 55 },
      ],
    },
  ],
  total: 430,
  dropped: [],
};

// Resolved the same way /trip resolves it, which is the point of a lab: a
// destination that works here works there. The old line called findDestination
// and passed null on a miss, so an unknown name silently planned SOMEWHERE ELSE
// and the check below it could never fire - `plan.dest` is always set.
const found = !fake && asked ? await resolveDestination(asked) : null;
if (!fake && asked && !found) {
  console.error(`could not work out where "${asked}" is`);
  process.exit(1);
}
if (found) console.log(`${asked} -> ${found.dest.he} (${found.how})`);

const plan = fake
  ? { ...FIXTURE, days: days ? FIXTURE.days.slice(0, days) : FIXTURE.days }
  : await writePlan({ dest: found?.dest || null, days });

// Recomputed rather than trusted on the fixture path too, so the lab cannot
// show a total the renderer would not have printed.
plan.total = plan.days.reduce((s, d) => s + d.stops.reduce((n, stop) => n + stop.costIls, 0), 0);

const cand = await toPlanCandidate(plan, {
  targets: ['instagram', 'tiktok'],
  // `flat` is the only thing that turns the photographs off. The slides then
  // fall back to the deck's own gradient, which is what an unphotographed slide
  // looks like in a real deck too.
  photos: !flat,
  onProgress: ({ done, of, name, ok }) => console.log(`   photo ${done}/${of} ${ok ? '✓' : '✗'} ${name}`),
});

console.log(`\n${planApprovalMessage(cand)}\n`);
console.log('slides:');
for (const size of ['tiktok', 'instagram']) {
  for (const s of cand.deck[size]) console.log(`   ${size.padEnd(9)} ${s.nameHe || 'cover'} - ${s.file}`);
}
console.log('\ncaption - instagram:');
console.log(cand.instagramCaption);
console.log('\ncaption - tiktok:');
console.log(cand.tiktokCaption);

await closeBrowser();
