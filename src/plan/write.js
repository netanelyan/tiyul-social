import { readFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { record as recordUsage } from '../usage.js';
import { postConfig, byWeight } from '../postConfig.js';
import { modelFor, outputConfig } from '../models.js';
import { isHebrew } from '../deck/hebrew.js';
import { URL_LIKE } from '../urlLike.js';
import { stripDashes } from '../dashes.js';

// The itinerary an AI wrote, which is the post.
//
// WHAT THIS CLAIMS, AND WHAT IT DOES NOT.
//
// The post says "ביקשתי מ-AI לתכנן לי 4 ימים ברומא". An AI did plan it — this
// call — and that is the entire claim being made. It is deliberately NOT a
// claim that the product produced this plan: nothing here talks to tiyulplus,
// the slides are drawn in the account's own design language, and no slide
// imitates a screen the app actually has. The day somebody wires the real
// product in, this comment is the first thing that has to change.
//
// The other difference from every writer in this project: there is no source
// page behind a single line of it. A card quotes an authority, a deck quotes
// Wikidata, a clip claims nothing at all beyond a country. An itinerary names
// places, puts them in an order and prices them, and none of that is fetched.
//
// That is survivable for one reason and one only: it is a PLAN, which is a
// proposal rather than a fact. "יום 2: וותיקן, ואז טרסטוורה" is not a statement
// about the world that can be false, it is a suggestion that can be bad. Prices
// are the same bargain the brief struck when it lifted the fare ban — the
// number is the owner's to stand behind, so every one of them is printed on the
// approval card before anything publishes.
//
// What the guards below are therefore for is not truth, it is SHAPE: real
// Hebrew, the right number of days, stops that fit on a slide, sums that agree
// with themselves. A plan whose own total contradicts its own stops is the
// broken promise that cost the clip format its beats, and it is the one failure
// a viewer can catch from the screen alone.

const MODEL = modelFor('editorial');
const EFFORT = process.env.PLAN_EFFORT || 'medium';

let client = null;
const getClient = () => (client ??= new Anthropic());
export const hasApiKey = () => Boolean(process.env.ANTHROPIC_API_KEY);

// The same file the shoot queue and the climate cards rotate through, read the
// same way: an object with a `_comment` and a `destinations` array.
let dests = null;
const destinations = () =>
  (dests ??= JSON.parse(readFileSync(new URL('../../destinations.json', import.meta.url), 'utf8')).destinations || []);

/**
 * Which destination this plan is for.
 *
 * Weighted by where this audience actually flies, then held off the ones just
 * used. A second Rome itinerary the week after the first is the same post
 * twice: the footage is not what varies here, the destination is the ONLY thing
 * that varies, so repeating it is repeating everything.
 */
export function pickDestination(recentHe = [], { rand = Math.random } = {}) {
  const used = new Set(recentHe.filter(Boolean).map((s) => String(s).trim()));
  const ranked = byWeight(destinations());
  const fresh = ranked.filter((d) => !used.has(d.he));
  const pool = fresh.length ? fresh : ranked;
  return pool[Math.floor(rand() * Math.min(pool.length, 12))] || pool[0] || null;
}

/** The destination somebody named by hand, in Hebrew or in English. */
export function findDestination(asked) {
  const q = String(asked || '').trim().toLowerCase();
  if (!q) return null;
  return (
    destinations().find((d) => d.he === asked.trim()) ||
    destinations().find((d) => String(d.en).toLowerCase() === q || d.id === q) ||
    null
  );
}

const SYSTEM = `אתה מתכנן מסלול טיול קצר בעברית, לזוג או לחברים מישראל, ומחזיר אותו כנתונים.

זה לא טקסט שיווקי ולא תיאור של מקום. זה מסלול שמישהו הולך לבצע: לאן הולכים
ביום הראשון, אחר כך לאן, וכמה זה עולה בערך. כל שורה נמדדת בשאלה אחת, האם
אפשר לקום מחר בבוקר ולעשות את זה בדיוק ככה.

מה שפוסל שורה:
- התפעלות. "נוף עוצר נשימה", "אווירה קסומה" - הצופה רוצה לדעת לאן ללכת.
- עמימות. "מסתובבים במרכז העיר" זה לא עצירה. "שוק קמפו דה פיורי" זה כן.
- אתר שלא קיים, או שם שהומצא. אם אינך בטוח שהמקום קיים, אל תכתוב אותו.
- מסלול בלתי אפשרי. שתי עצירות בשני קצוות העיר ברבע שעה זה מסלול שלא נוסה.

מבנה כל יום:
- כותרת קצרה ליום, האזור או הנושא. "העיר העתיקה", "וותיקן ומערב הטיבר".
- {STOPSMIN} עד {STOPSMAX} עצירות, לפי הסדר שבו עושים אותן.
- לכל עצירה: שעה משוערת, שם המקום בעברית, שורה אחת מה עושים שם, ומחיר.

מחירים:
- בשקלים, לאדם, מעוגל. 60, 120, 250, לא 137.
- כניסה חינם זה 0. אל תמציא מחיר כדי למלא שדה.
- אל תכתוב סכום כולל בשום מקום. הוא מחושב מהעצירות, לא נכתב.

שפה:
- עברית בכל שדה שמופיע על המסך. שם לועזי נכתב בעברית: "טרסטוורה", "קולוסיאום".
- nameEn הוא היוצא מן הכלל, והוא לא מוצג לצופה: השם באנגלית שמשמש לחיפוש
  תצלום של המקום. כתוב אותו כמו שצלם היה מתייג אותו, "Colosseum",
  "Trastevere", "Vatican Museums". בלי מילות תיאור ובלי שם המדינה.
- בלי אימוג׳י, האשטג, קישור, שם מותג, קריאה לפעולה.
- שורת "מה עושים" - עד 6 מילים, משפט שלם שנגמר. היא נדפסת בשורה אחת קטנה
  מתחת לשם על גבי תצלום, ומשפט ארוך יותר נשבר לשלוש שורות על התמונה.

החזר JSON בלבד.`;

const systemFor = (stopsMin, stopsMax) =>
  SYSTEM.replace('{STOPSMIN}', String(stopsMin)).replace('{STOPSMAX}', String(stopsMax));

// additionalProperties: false on every object, which the structured output API
// requires rather than merely prefers — without it the whole request comes back
// a 400 and the only symptom is that no plan was ever built.
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    days: {
      type: 'array',
      description: 'יום אחד לכל אובייקט, לפי הסדר',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          titleHe: { type: 'string', description: 'כותרת קצרה ליום - אזור או נושא, עד 4 מילים' },
          stops: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                timeHe: { type: 'string', description: 'שעה משוערת, בפורמט 09:30' },
                nameHe: { type: 'string', description: 'שם המקום בעברית' },
                nameEn: {
                  type: 'string',
                  description: 'The same place in English, as a photographer would label it: "Colosseum", "Trastevere"',
                },
                noteHe: { type: 'string', description: 'מה עושים שם - משפט אחד קצר' },
                costIls: { type: 'integer', description: 'מחיר לאדם בשקלים, מעוגל. 0 אם חינם' },
              },
              required: ['timeHe', 'nameHe', 'nameEn', 'noteHe', 'costIls'],
            },
          },
        },
        required: ['titleHe', 'stops'],
      },
    },
  },
  required: ['days'],
};

/** A time that reads as a time. Anything else is dropped rather than printed. */
const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/;

/**
 * Is this string printable on a slide?
 *
 * The same four refusals every published string in this project runs, collected
 * here because a plan has forty of them and checking each at its own call site
 * is how one gets missed.
 */
function badString(s, { maxWords = 0 } = {}) {
  const t = String(s || '').trim();
  if (!t) return 'empty';
  if (URL_LIKE.test(t)) return 'carries a URL';
  if (/[#@]/.test(t)) return 'carries a hashtag or handle';
  if (/\p{Extended_Pictographic}/u.test(t)) return 'carries an emoji';
  // Hebrew, because the whole post is Hebrew and a Latin place name in the
  // middle of an RTL line is the one rendering bug this project keeps finding.
  // Digits and the shekel sign are not Latin letters and are allowed through.
  if (!isHebrew(t.replace(/[\d\s.,:()׳״'"+–—-]|₪/g, '') || t)) return 'not Hebrew';
  if (maxWords && t.split(/\s+/).length > maxWords) return `over ${maxWords} words`;
  return null;
}

/**
 * One itinerary, checked into shape.
 *
 * Dropping is preferred to failing all the way up wherever a drop still leaves
 * a publishable post — a stop with a Latin name is one bullet, and losing the
 * whole plan for it would be the guard costing more than the defect. A DAY that
 * loses too many stops is dropped whole, because three bullets and then one is
 * a slideshow that looks like it ran out.
 */
export function shapePlan(raw, { days, stopsMin, stopsMax }) {
  const dropped = [];
  const out = [];

  for (const [i, day] of (Array.isArray(raw?.days) ? raw.days : []).entries()) {
    // Repaired before it is judged, not rejected for it. An em dash is banned
    // on anything this account publishes (src/dashes.js) and it is also the
    // single most common thing a model puts in a Hebrew line, so refusing on it
    // would throw away most of a perfectly good itinerary over typography.
    const titleHe = stripDashes(day?.titleHe);
    const titleBad = badString(titleHe, { maxWords: 5 });
    if (titleBad) {
      dropped.push(`יום ${i + 1}: title - ${titleBad}`);
      continue;
    }

    const stops = [];
    for (const stop of (Array.isArray(day.stops) ? day.stops : []).slice(0, stopsMax)) {
      const nameHe = stripDashes(stop?.nameHe);
      // Six words, because the note is printed under the name ON A PHOTOGRAPH
      // in the deck's small type. A seventh word is a third line across the
      // picture, which is the thing that layout exists to avoid.
      const noteHe = stripDashes(stop?.noteHe);
      const nameBad = badString(nameHe, { maxWords: 6 });
      const noteBad = badString(noteHe, { maxWords: 6 });
      if (nameBad || noteBad) {
        dropped.push(`${nameHe || '(ללא שם)'} - ${nameBad || noteBad}`);
        continue;
      }
      // The English name is not printed anywhere. It is what the photo search
      // is run on, and a stop with no usable one has no picture, which under
      // the deck's rule means no slide. Dropping it here rather than at the
      // image step keeps the plan and the slideshow the same thing.
      const nameEn = String(stop?.nameEn || '').trim();
      if (!/[A-Za-z]{3}/.test(nameEn)) {
        dropped.push(`${nameHe} - no English name to search a photograph on`);
        continue;
      }
      // A cost that is not a number is the field being left empty, which is
      // different from free. Printed as free either way, because a blank price
      // on a slide reads as an omission and 0 reads as an answer.
      const cost = Math.max(0, Math.round(Number(stop.costIls) || 0));
      if (cost > 2000) {
        dropped.push(`${nameHe} - ${cost} ₪ is not a per-person stop price`);
        continue;
      }
      stops.push({
        // A time that did not parse is dropped rather than printed: "בערך"
        // where a time should be makes the whole column look invented.
        timeHe: TIME.test(String(stop.timeHe || '').trim()) ? String(stop.timeHe).trim() : null,
        nameHe,
        nameEn,
        // The full stop comes off too. The note is printed as a parenthesised
        // fragment under the name, "(75 ₪ · נכנסים עם כרטיס מוזמן מראש.)", and a
        // sentence-ending period inside brackets reads as a typo rather than as
        // grammar. Asking the prompt for it would be one more rule to obey at
        // temperature; taking it off here always works.
        noteHe: noteHe.replace(/\s*\.$/, ''),
        costIls: cost,
      });
    }

    if (stops.length < stopsMin) {
      dropped.push(`יום ${i + 1}: ${stops.length} usable stop(s), needs ${stopsMin}`);
      continue;
    }
    out.push({ n: out.length + 1, titleHe, stops });
  }

  return { days: out.slice(0, days), dropped };
}

/** What the plan costs, summed from the stops rather than taken on trust. */
export const planTotal = (days) =>
  days.reduce((sum, d) => sum + d.stops.reduce((s, stop) => s + (stop.costIls || 0), 0), 0);

/**
 * Ask for one itinerary.
 *
 * Returns { dest, days, total, dropped } or throws. One call, not several
 * candidates the way a clip hook is drawn — there is no cheap way to judge two
 * itineraries against each other, and a plan that fails its shape check is a
 * plan to re-run rather than one to pick an alternative for.
 */
export async function writePlan({ dest, days = null, rand = Math.random, recent = [] } = {}) {
  const cfg = postConfig().plans;
  const want = Math.min(cfg.daysMax, Math.max(cfg.daysMin, Math.round(Number(days) || cfg.days)));
  const where = dest || pickDestination(recent, { rand });
  if (!where) throw new Error('no destination available - destinations.json is empty');
  if (!hasApiKey()) throw new Error('ANTHROPIC_API_KEY is not set');

  const user = [
    `היעד: ${where.he}${where.country && where.country !== where.he ? ` (${where.country})` : ''}.`,
    `מספר ימים: ${want}.`,
    'המטיילים: זוג ישראלי, טיסה קצרה, בלי רכב שכור אלא אם אין ברירה.',
    '',
    `החזר בדיוק ${want} ימים, לפי הסדר, ${cfg.stopsMin} עד ${cfg.stopsMax} עצירות בכל יום.`,
  ].join('\n');

  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 3000,
    // Through the helper, not hand-built: Haiku rejects output_config.effort
    // with a 400, so the tier and the effort cannot be chosen independently —
    // see the note in src/models.js.
    output_config: outputConfig(MODEL, EFFORT, SCHEMA),
    system: [{ type: 'text', text: systemFor(cfg.stopsMin, cfg.stopsMax), cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
  });

  recordUsage(res.usage, MODEL);
  if (res.stop_reason === 'refusal') throw new Error('the planner refused');

  const text = res.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('the planner returned no text');

  const { days: kept, dropped } = shapePlan(JSON.parse(text), {
    days: want,
    stopsMin: cfg.stopsMin,
    stopsMax: cfg.stopsMax,
  });

  // A plan short of its own promise is not publishable, and the hook is where
  // the promise is: "4 ימים ברומא" over three slides is the same broken
  // promise as a hook counting three mistakes over two beats.
  if (kept.length < want) {
    const err = new Error(`only ${kept.length} of ${want} day(s) survived - ${dropped[0] || 'no reason recorded'}`);
    err.dropped = dropped;
    throw err;
  }

  return { dest: where, days: kept, total: planTotal(kept), dropped };
}
