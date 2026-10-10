import { fill, line } from '../posts/voice.js';

// A format card turned into a post this account can build from its own data, or
// dropped with the reason. Pure.
//
// THE RULE: fill the format only with our own site data. A format that needs a
// fact we do not have is dropped, and the report says which fact.
//
// AND THE COVER HAS TO PROMISE WHAT THE BUILDER DELIVERS. The builders are fixed:
// a know post is five practical facts, a plan is a day per slide. A hook the model
// filed under know_before but that promises "what happens behind the scenes when
// the route closes" would sit on five facts about flights and seasons, which is
// the undelivered promise src/posts/deliver.js exists to stop. So each topic says
// what its builder gives, and a hook that does not promise that is dropped. Found
// on the first real run, where exactly that hook came back as know_before.

/**
 * Which of our builders carries each topic, the placeholders it can fill, and
 * what its cover has to promise (`needs`, on the template, all must match).
 */
export const TOPICS = {
  versus: { type: 'verdict', fills: ['dest'], needs: [/שווה|כדאי|מול|או ש/], promiseHe: 'שווה או לא שווה' },
  itinerary: { type: 'plan', fills: ['dest', 'days'], needs: [/\{days\}/, /ימים|ימי /], promiseHe: 'מסלול של כמה ימים' },
  know_before: { type: 'know', fills: ['dest', 'n'], needs: [/\{n\}/, /לדעת|לפני|טיפים/], promiseHe: 'רשימה של דברים שכדאי לדעת' },
  // A day on the ground, without flights or lodging: "how much to fly to X" is a
  // promise the page's daily cost cannot keep.
  budget: { type: 'budget', fills: ['dest'], needs: [/עולה|עלות|תקציב|מחיר|כסף/, /יום|יומי/], promiseHe: 'כמה עולה יום, בלי טיסות ולינה' },
  places_list: { type: 'list', fills: ['dest', 'n'], needs: [/\{n\}/, /מקומות|אתרים|לראות|לעשות|עצירות/], promiseHe: 'רשימת מקומות' },
};

// Words that tie a cover to a moment ("this season", "new"). No page says which
// places are best in which season, or which of its facts changed lately, so the
// claim would be ours, not the site's.
const TIMELY = /העונה|בעונה|השנה|החודש|עכשיו|הקיץ|החורף|האביב|הסתיו|השבוע|חדשים|חדשות|עדכני|מעודכן/;

export const DROPPED = {
  hidden_gems:
    'אין לאתר סימון של "פחות מוכר": מקום שלא מסומן חובה עדיין יכול להיות מפורסם (הפורום הרומאי), ו"ג׳מים נסתרים" על מקומות כאלה הוא טענה שאין לנו',
  mistakes: 'אין לנו "טעויות" מנוסחות כעובדות בדפים. פורמט שמבטיח טעויות היה צריך להמציא אותן',
  dont: 'אותו דבר כמו טעויות: "אל תעשו" צריך אזהרות מפורשות, ואין לנו כאלה כעובדות',
  other: 'הפורמט לא מתאים לאף אחד מהבונים שלנו',
};

/**
 * The card as { type, hook } or { dropped }.
 *
 * The hook is the card's own Hebrew shape. {n} means the count each builder
 * already supplies, and on a plan the count is days, so it becomes {days}. Dropped:
 *   - a shape without {dest}: it would print a sentence about a place without the place
 *   - a placeholder the builder has nothing to fill with (a budget post has no
 *     count): it would print "{n}" on the cover
 *   - a shape that does not promise what the builder delivers (see TOPICS), or
 *     ties itself to a moment ("this season") the site has no data for
 *   - a shape the voice rules refuse (a first-person experience, filler, an em
 *     dash), checked on a sample fill so it fails here rather than at build time
 */
export function mapCard(card) {
  const topic = TOPICS[card?.topicType];
  if (!topic) return { dropped: DROPPED[card?.topicType] || DROPPED.other };
  let he = String(card.hookShapeHe || '').trim();
  if (topic.type === 'plan') he = he.replaceAll('{n}', '{days}');
  if (!he.includes('{dest}')) return { dropped: `פתיח בלי {dest}: "${he}"` };
  const unfillable = [...he.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((k) => !topic.fills.includes(k));
  if (unfillable.length) {
    return { dropped: `הפתיח צריך {${unfillable[0]}} ולפוסט ${topic.type} אין ממה למלא אותו: "${he}"` };
  }
  const timely = TIMELY.exec(he);
  if (timely) return { dropped: `הפתיח קושר את עצמו לזמן ("${timely[0]}") ואין לאתר נתון שתומך בזה: "${he}"` };
  if (!topic.needs.every((re) => re.test(he))) {
    return { dropped: `הפתיח לא מבטיח את מה שפוסט ${topic.type} נותן (${topic.promiseHe}): "${he}"` };
  }
  try {
    line(fill(he, { dest: 'פראג', n: 5, days: 3 }), { where: 'trend hook' });
  } catch (e) {
    return { dropped: `הפתיח נפסל בכללי הקול: ${e.message}` };
  }
  return { type: topic.type, hook: { id: `trend-${card.id}`, he } };
}
