import { readFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { record as recordUsage } from '../usage.js';
import { postConfig, byWeight } from '../postConfig.js';
import { URL_LIKE } from '../urlLike.js';
import { chooseFormat, nextSeries, seriesLabels, pickAngle } from './rotation.js';
import { stripDashes } from '../dashes.js';

// A shot list: what to film today, in what order, with the words already
// written.
//
// NOTHING HERE IS PUBLISHED. That is the whole shape of this module and it is
// worth being blunt about, because every other candidate in this project ends
// at a publish call and this one ends at a person picking up a phone. The two
// rules the pipeline cannot obey — show the product, use real footage — are the
// two the brief says matter most, and a program cannot film anything. What it
// can do is remove every excuse not to: choose the destination, pick the angle,
// rotate the shape, write the hook and the beats and the caption and the tags,
// remember which part of which series is next, and hand all of it over as a
// list short enough to act on before the window closes.
//
// So the expensive half of a shoot is a human. This makes the cheap half free.

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5';
const EFFORT = process.env.SHOOT_EFFORT || 'medium';

let client = null;
const getClient = () => (client ??= new Anthropic());
export const hasApiKey = () => Boolean(process.env.ANTHROPIC_API_KEY);

// The file is an OBJECT with a `_comment` and a `destinations` array, not a
// bare array — every other file in this project that holds a list is shaped the
// same way, because the comment is how the list explains itself.
let dests = null;
const destinations = () =>
  (dests ??= JSON.parse(readFileSync(new URL('../../destinations.json', import.meta.url), 'utf8')).destinations || []);

const MONTHS_HE = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

/**
 * Which destinations to offer the writer.
 *
 * Weighted by where this audience actually flies and then filtered against
 * what has been shot recently, which is the same two-part rule the deck's
 * idea generator uses. The recent filter matters more here than it looks: a
 * shot list is acted on the same day, so two Greece shoots in a week is two
 * Greece videos in a week, with none of the delay a proposal queue provides.
 */
function offer(history, n = 8) {
  const recent = new Set(history.slice(0, 10).map((h) => h?.destination).filter(Boolean));
  const ranked = byWeight(destinations());
  const fresh = ranked.filter((d) => !recent.has(d.he));
  return (fresh.length >= n ? fresh : ranked).slice(0, n * 2).slice(0, n);
}

const SYSTEM = `אתה מכין תדריך צילום לסרטון טיקטוק אחד בעברית, לחשבון ישראלי שמתכנן טיולים.

התדריך נמסר לאדם שהולך לצלם את הסרטון בעצמו בעשר הדקות הקרובות. לכן כל מה
שאתה כותב חייב להיות משהו שאפשר לומר למצלמה או להציג על המסך כמו שהוא. לא
רעיון לסרטון, הטקסט עצמו.

המבנה:
  הוק, שורה אחת, נאמרת ומופיעה בשנייה הראשונה, מבטיחה משהו מסוים.
  ביטים, 2 עד 5 שורות קצרות שמוסרות בדיוק את מה שההוק הבטיח.
  כיתוב, שורה אחת קצרה מתחת לסרטון.

הכלל שאי אפשר להפר: ההוק מבטיח, והביטים מקיימים. אם ההוק אומר "3 טעויות", 
יש בדיוק 3 ביטים וכל אחד הוא טעות. אם ההוק נוקב בסכום, הסכומים בביטים
מסתכמים אליו בערך.

ספציפיות היא כל העניין. שם יעד, מספר, חודש, עונה, סכום בשקלים, מרחק, שעה.
סרטון שהיה נקרא אותו דבר לקהל אמריקאי הוא סרטון שאין בו כלום לקהל הזה.

דוגמאות טובות:
  "3 טעויות שישראלים עושים בגאורגיה"
    · שוכרים רכב רק בשדה התעופה, יקר בהרבה
    · מגיעים באוגוסט, כשכולם שם
    · לא מזמינים מראש ומשלמים כפול

  "ביקשתי מ-AI לתכנן לי 4 ימים בליסבון"
    · הקלדתי: 4 ימים בליסבון, זוג, תקציב בינוני
    · חזר מסלול יום-יום עם זמני הליכה
    · היום השלישי בסינטרה, לא הייתי חושב על זה

ואלה שורות שנפסלות, עם הסיבה:
  "יעדים מדהימים באירופה"        ← לא מבטיח כלום.
  "המקום הזה פשוט קסום"          ← התפעלות. הצופה רואה את התמונה.
  "כדאי להזמין מראש"             ← נכון וריק. כמה זה חוסך, מתי, איפה.
  "טעות אחת שכולם עושים"         ← מעורפל. איזו טעות, איפה.

מחירים: סכומים בשקלים מותרים ורצויים. סכום עגול וסביר, 1,500 ₪, 2,000 ₪,
700 ₪. לא 1,847 ₪. אל תמציא מחיר לפורמט שלא ביקש אותו.

אסור: אימוג׳י בהוק ובביטים, האשטגים, כתובת אתר, שם דומיין, אנגלית בטקסט
שעל המסך.

החזר JSON בלבד.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    destination: { type: 'string', description: 'שם היעד בעברית, מתוך הרשימה שניתנה' },
    hook: { type: 'string', description: 'ההוק - שורה אחת, נאמרת ומופיעה בשנייה הראשונה' },
    beats: {
      type: 'array',
      description: 'השורות שמקיימות את ההוק, לפי הסדר',
      items: { type: 'string' },
    },
    caption: { type: 'string', description: 'שורה אחת קצרה לכיתוב מתחת לסרטון' },
    prompt: {
      type: 'string',
      description:
        'רק לפורמט הדגמת המוצר: הבקשה המדויקת להקליד ב-Tiyul+, בעברית. אחרת מחרוזת ריקה.',
    },
    note: {
      type: 'string',
      description: 'משפט אחד: מה הדבר שהצופה לא יודע וכדאי להדגיש בצילום. אפשר ריק.',
    },
  },
  required: ['destination', 'hook', 'beats', 'caption', 'prompt', 'note'],
};

/** Everything that must not appear in anything filmed or posted. */
function clean(s, where) {
  // The em dash comes off before anything else looks at the line. It is banned
  // on everything this account publishes (src/dashes.js) and a shot list is
  // read off a phone and typed into an app by hand, so a dash that survives
  // here is a dash somebody copies into a caption.
  const t = stripDashes(s);
  if (URL_LIKE.test(t)) throw new Error(`${where} carries a URL, and the link lives in the bio`);
  return t;
}

/**
 * One shot list.
 *
 * `history` is the most recent shoots first, and everything deterministic is
 * decided from it BEFORE the model is called — format, angle, series, the
 * destinations on offer. That ordering is the point: the model is choosing
 * words inside a decision that has already been made, which is the only way the
 * brief's counting rules (never twice in a row, product in half, a series that
 * reaches part 3) can actually hold. See rotation.js.
 */
export async function planShoot({ history = [], at = new Date(), rand = Math.random } = {}) {
  const cfg = postConfig().shoot;

  const chosen = chooseFormat(history, { rand });
  if (!chosen) throw new Error('no shoot formats configured');
  const { format, why } = chosen;

  const series = nextSeries(history);
  const labels = seriesLabels(series);
  const angle = pickAngle(history, { rand });
  const month = MONTHS_HE[at.getMonth()];

  // A SERIES IS ABOUT ONE THING, and this is what makes that true.
  //
  // Without it the mechanism is broken in exactly the way BRIEF.md warns
  // against: part 1 ends on "עקבו לחלק 2 מחר", part 2 arrives about a different
  // city, and everyone who followed for the rest of the Thessaloniki series
  // gets something else. That is worse than never having promised — it is a
  // promise made to the only people who acted on one.
  //
  // So part 1 records its destination as the series topic, and every later part
  // is pinned to it. The freshness filter is bypassed for those parts on
  // purpose: repeating the destination is the whole point of a series, and the
  // filter exists to stop repeats that were not.
  const pinned = series?.topic || null;
  const choices = pinned
    ? [destinations().find((d) => d.he === pinned) || { he: pinned }]
    : offer(history);

  if (!hasApiKey()) throw new Error('ANTHROPIC_API_KEY is not set');

  const user = [
    `הפורמט: ${format.he} - ${format.desc}`,
    format.hookExamples.length ? `דוגמאות להוק בפורמט הזה: ${format.hookExamples.join(' · ')}` : null,
    format.allowsPrice ? 'הפורמט הזה בנוי סביב סכום בשקלים.' : null,
    format.needsProduct
      ? 'הפורמט הזה הוא הקלטת מסך של Tiyul+ - מתכנן טיולים בעברית. מלא גם את השדה prompt: הבקשה המדויקת שיוקלד בו.'
      : null,
    '',
    angle ? `הזווית הישראלית לסרטון הזה: ${angle}` : null,
    `החודש: ${month}.`,
    labels.label ? `הסרטון הוא ${labels.label} בסדרה. הכיתוב צריך לרמוז על ההמשך.` : null,
    // Stated as a constraint rather than as a preference, because a later part
    // that wanders to another destination is the one failure this whole
    // mechanism exists to prevent.
    pinned ? `הסדרה כולה על ${pinned}. הסרטון הזה חייב להיות על ${pinned} ועל שום מקום אחר.` : null,
    '',
    pinned
      ? `היעד נקבע: ${pinned}.`
      : `בחר יעד אחד מהרשימה (לפי הסדר - הראשונים מועדפים): ${choices.map((d) => d.he).join(' · ')}`,
    '',
    `אורך: ${cfg.lengthSeconds[0]}-${cfg.lengthSeconds[1]} שניות. זה מגביל כמה ביטים אפשר - כל ביט בערך 4 שניות.`,
  ]
    .filter((x) => x !== null)
    .join('\n');

  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 2000,
    output_config: { effort: EFFORT, format: { type: 'json_schema', schema: SCHEMA } },
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
  });

  recordUsage(res.usage, MODEL);
  if (res.stop_reason === 'refusal') throw new Error('shoot planning refused');
  const raw = res.content.find((b) => b.type === 'text')?.text;
  if (!raw) throw new Error('shoot planning returned no text');

  const out = JSON.parse(raw);
  const beats = (Array.isArray(out.beats) ? out.beats : [])
    .map((b, i) => clean(b, `beat ${i + 1}`))
    .filter(Boolean);
  if (!beats.length) throw new Error('shoot planning returned no beats');

  // The destination is matched back against the list rather than taken as
  // typed. A model handed eight names occasionally returns a ninth, and the
  // rotation's freshness filter is keyed on this string — a name that is not in
  // destinations.json never matches anything and silently stops suppressing
  // repeats of itself.
  const destination =
    choices.find((d) => d.he === String(out.destination || '').trim())?.he || choices[0].he;

  // Part 1 names the topic every later part is pinned to. Written back onto the
  // series object because that object is what store.addShoot persists, and
  // nextSeries reads it off the history to answer "what is this series about".
  const carried = series ? { ...series, topic: series.topic || destination } : null;

  return {
    kind: 'shoot',
    id: Math.random().toString(36).slice(2, 10),
    createdAt: new Date().toISOString(),

    formatId: format.id,
    formatHe: format.he,
    shape: format.shape,
    needsProduct: format.needsProduct,
    rotationNote: why,

    destination,
    angle,
    month,
    series: carried,
    seriesLabel: labels.label,
    seriesNext: labels.next,

    hook: clean(out.hook, 'the hook'),
    beats,
    caption: clean(out.caption, 'the caption'),
    // Only meaningful for the product format, and blanked otherwise rather than
    // carried as whatever the model felt like putting there.
    prompt: format.needsProduct ? clean(out.prompt, 'the Tiyul+ prompt') : '',
    note: clean(out.note, 'the note'),
    shots: format.shots,
    lengthSeconds: cfg.lengthSeconds,
  };
}
