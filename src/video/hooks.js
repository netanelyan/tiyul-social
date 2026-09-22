import Anthropic from '@anthropic-ai/sdk';
import { record as recordUsage } from '../usage.js';
import { postConfig } from '../postConfig.js';
import { URL_LIKE } from '../format.js';

// The line that goes on a clip, written per clip.
//
// It started as a pool of twenty in post-config.json, drawn at random. That was
// wrong for a reason worth writing down: a pool is a template with extra steps.
// Twenty lines across a hundred posts is the same five sentences five times
// each, and the fifth time is the one somebody notices. The footage is already
// interchangeable stock — if the line is a rerun too, there is nothing left
// that is ours.
//
// So a line is written for THIS clip, from what is actually in it. The pool
// survives as the fallback for a failed call, which is the honest thing to
// degrade to: a slightly repetitive post beats no post.
//
// WHAT THE BRIEF IS BUILT FROM
//
// Five real posts, supplied by the owner, ranging from 122 likes to 284K:
//
//   284K  "Hiking with your gf has to be top 5 activities oat"
//   229K  "one of the coolest feelings that a human can experience is to feel
//          so small in a world that's so big"
//   130K  "Average supermarket exit in Slovenia"
//   1.5K  "Fuck electrical engineering / go to lake como"
//   122   "דפנה אחי, קיבוץ דפנה"
//
// What the top four share, and what the 122 does not, is that NONE of them
// describes the footage. They are a thought the footage happens to answer. The
// 122 is a caption — it names the place in the video, which is the one thing
// the viewer can already see. That contrast is the whole brief, and it is also
// exactly the trap a model falls into unprompted: asked to write a line for a
// forest trail video it will write "a beautiful forest trail".
//
// The second thing they share is that they are badly written on purpose. "oat"
// for "of all time", a swear, no capital letter, a run-on sentence. Polish is
// what an advertisement has.

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5';
const EFFORT = process.env.HOOKS_EFFORT || 'low';

let client = null;
const getClient = () => (client ??= new Anthropic());
export const hasApiKey = () => Boolean(process.env.ANTHROPIC_API_KEY);

// The system prompt deliberately does NOT try to teach taste. Four rounds of
// that failed identically: whatever the register, free composition returns
// clever original sentences — personification, similes, wry turns — and clever
// is the wrong TYPE. The references are all recognizable meme templates filled
// in, so the job given to the model is exactly that: fill the format, add no
// cleverness of your own.
const SYSTEM = `אתה ממלא תבניות משפט מוכרות מטיקטוק עבור סרטון טבע קצר, בעברית, לקהל ישראלי צעיר.

זו לא כתיבה יצירתית. התבנית היא הבדיחה, והתוכן שממלא אותה חייב להיות הכי
פשוט ובנאלי שאפשר. כל ניסיון להוסיף רעיון משלך הורס את השורה.

אלה שורות שהבעלים אישר, מילה במילה — זה הסטנדרט:
  "העובדה שהשביל הזה לא עולה כסף"
  "חייב להיות בטופ 3 מסלולים שקיימים"
  "יש אנשים שזה המסלול שלהם לעבודה"
  "חייב להיות בטופ 3 דברים שעשיתי השבוע"
  "למה אף אחד לא סיפר לי על השביל הזה"
  "איך לא שמעתי על המסלול הזה עד היום"

ואלה שורות שנפסלו, עם הסיבה:
  "איך זה חוקי שלשביל הזה אין שעות פתיחה"    ← רעיון מומצא. לשביל אין שעות פתיחה — זו הברקה, והברקות פסולות.
  "תזכורת שהנחל הזה זורם גם בשעות העבודה"    ← אותה הברקה: הצלבה חכמה בין נחל למשרד.
  "עשר דקות ליד מפל כזה > יום חופש מהעבודה"   ← השוואה בנויה מדי. נשמע כמו קופירייטינג.
  "יש אנשים שזה סוף השבוע הרגיל שלהם"         ← מעורפל. "סוף שבוע רגיל" לא נאחז בכלום.
  "אף אחד לא מדבר על הצל בשביל הזה"           ← הצל הוא פרט שולי. הסוד חייב להיות החוויה עצמה.
  "אף אחד לא מדבר על הקול של המים"            ← אותה בעיה: פיצ'ר פיזי קטן במקום החוויה.
  "חדר כושר עולה 200 שקל בחודש וזה בחינם"     ← חדר כושר לא מתחלף בטבע.
  "חופשה עולה אלפי שקלים והשביל הזה בחינם"    ← גם זה לא עבד. תבנית השוואת המחיר בוטלה כליל — אל תשתמש בה.
  "אף אחד לא מדבר על כמה ריק בשביל הזה"       ← ברור שאף אחד לא מדבר על שביל ריק. אין שם סוד.

ההבדל: השורות הטובות נאחזות במשהו שבאמת שייך לעולם — מחיר, דרך לעבודה, מה
עשיתי השבוע. הפסולות ממציאות מפגש שנון בין הטבע למושג ממוסד (שעות פתיחה,
שעות עבודה, חשבון ימי חופש). אם יש בשורה "רעיון" — היא פסולה.

דיוקים שנלמדו מהסבבים:
- "אף אחד לא מדבר על X" — ה-X חייב להיות משהו שאנשים באמת היו מתפארים בו
  והוא בכל זאת לא מדובר. השקט עובד. צל, קול מים, "כמה ריק" — לא: אלה פרטים
  שאין סיבה שידברו עליהם, אז אין סוד ואין שורה.
- גוף ראשון קל מותר כשהוא קול של צופה שמגיב לסרטון: "סיפר לי", "שעשיתי",
  "שראיתי". אסור קול של מי שנמצא שם עכשיו: "אני פה", "האוויר פה".
- השורה נגמרת בסוף הטבעי של התבנית. שני תיקונים של הבעלים, מילה במילה:
    "לא עולה כסף לאף אחד"  →  "לא עולה כסף"        (זנב מיותר, נחתך)
    "איך לא שמעתי... בחורף"  →  "איך לא שמעתי... עד היום"  (התבנית רוצה את
     הסיום הטבעי שלה, לא פרט מהסרטון שנדחף אליה)
  זה לא איסור על מילים מסוימות — "פתוח לכולם" תקין כי שם זו הטענה עצמה.
  השאלה היא אם המילים האחרונות מוסיפות טענה או רק נגררות.

חוקים:
- 4 עד 9 מילים. עברית פשוטה. בלי סלנג מודגש. בלי מילות הדגשה בסוף ("אף פעם", "בכלל").
- גוף ראשון מותר רק כשהוא חלק מהתבנית עצמה ("דברים שעשיתי השבוע").
  אסור "אני" מפורש, ואסור לטעון שהיית במקום הספציפי הזה.
- מותר להגיד "השביל הזה" / "המסלול הזה" — הסרטון מראה שביל.
- בלי אימוג׳י, האשטג, קריאה לפעולה, שם מותג, קישור, שם מדינה או אתר.

החזר JSON בלבד: שורה אחת לכל תבנית שקיבלת.`;

// additionalProperties: false on every object is REQUIRED by the structured
// output API, not optional tidiness — it rejects the whole request with a 400
// without it, and the fallback pool catches that silently.
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    lines: {
      type: 'array',
      description: 'One filled line per requested format, same order',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          format: { type: 'string', description: 'the id of the format this line fills' },
          text: { type: 'string', description: 'השורה, עברית, 4-10 מילים, נאמנה לתבנית' },
        },
        required: ['format', 'text'],
      },
    },
  },
  required: ['lines'],
};

/**
 * First or second person, which this format forbids.
 *
 * The strictest rule here and the one that took three rejected rounds to find.
 * The account publishes STOCK footage: nobody who posts it has stood in that
 * forest. "אני נשבע שהאוויר פה אחר" is therefore a claim about a place the
 * poster has never been, and it reads false in a way viewers feel without being
 * able to name — the same way a stock lifestyle shot reads as an advertisement.
 *
 * An impersonal observation makes no such claim. It can still be funny and can
 * still make somebody want to go; it just does not pretend anyone was there.
 *
 * Matched with prefixes attached, because Hebrew glues them on: שלי, ולי,
 * ושלך all carry the pronoun and all have to be caught.
 */
// לי / לנו / אותי are deliberately ABSENT: the owner's own approved line is
// "למה אף אחד לא סיפר לי על השביל הזה", and the first version of this regex
// would have filtered it. What stays banned is the on-location voice — the
// explicit standing pronouns and the possessives that claim the place.
const PERSON = /(^|\s|ו|ש|ב|ל|כ|מ)(אני|אנחנו|אתה|אתם|שלי|שלך|שלנו|אחי|איתי|איתך|איתנו|הייתי|נשבע)($|\s|,|\.|\?)/;

export const hasPerson = (line) => PERSON.test(String(line || ''));

// The markers that make a line a STATEMENT rather than a bare label. The tail
// of the list is the format openers — חייב, תזכורת, העובדה, הכי — because a
// filled template asserts by construction and must not be filed as a caption.
const STATEMENT =
  /(^|\s)(אני|אתה|את|אנחנו|אתם|הם|זה|זו|יש|אין|הייתי|היית|היה|תמיד|אף פעם|פעם|למה|איך|מתי|כמה|לא|רק|סוף סוף|פתאום|כל|שום|מישהו|כשאני|כשאתה|חייב|חייבת|תזכורת|העובדה|הכי|מסתבר|אפשר|עולה|שווה|נחשב|אמור|קיים|קיימת|קיימים|>)($|\s|,)/;

export function isLabel(line) {
  const s = String(line || '').trim();
  if (!s) return true;
  if (s.includes('?')) return false;
  return !STATEMENT.test(s);
}

/** A line is unusable if it carries a link, runs long, or is a caption. */
function reject(text, { maxWords }) {
  const s = String(text || '').trim();
  if (!s) return 'empty';
  if (URL_LIKE.test(s)) return 'carries a URL';
  if (/[#@]/.test(s)) return 'carries a hashtag or handle';
  if (/\p{Extended_Pictographic}/u.test(s)) return 'carries an emoji';
  const words = s.split(/\s+/).length;
  if (words > maxWords) return `${words} words, over ${maxWords}`;
  if (words < 5) return `${words} words, under 5 — too short to say anything`;
  if (hasPerson(s)) return 'first or second person — the footage is not ours';
  if (isLabel(s)) return 'a label, not a statement — nothing is asserted';
  return null;
}

/**
 * One line for one clip.
 *
 * Several candidates are asked for and the first usable one is taken, because
 * the checks above reject maybe one in five and a second API call to replace a
 * rejected line costs the same as asking for four up front.
 *
 * `used` is the set of lines already burned into other clips, so a batch cannot
 * come back with the same sentence twice — which a pool could not avoid and is
 * the whole reason this file exists.
 */
/**
 * Which formats this clip is offered — weighted, then rotated by the clip.
 *
 * The weight is the owner's grade made mechanical: a format weighted 3 appears
 * in the expanded deck three times, so the rotation lands on it three times as
 * often. The picks are still deduplicated, so one call never asks for the same
 * format twice; the weight moves which formats lead, not what a single call
 * looks like. Stable per clip title, so a re-run offers the same menu.
 */
function pickFormats(all, clipTitle, n) {
  if (!all.length) return [];
  const expanded = all.flatMap((f) => Array(f.weight || 1).fill(f));
  let h = 0;
  for (const ch of String(clipTitle || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const out = [];
  for (let i = 0; i < expanded.length && out.length < Math.min(n, all.length); i++) {
    const f = expanded[(h + i * 7) % expanded.length];
    if (!out.includes(f)) out.push(f);
  }
  return out;
}

export async function writeHook(clip, { used = new Set(), candidates = 3 } = {}) {
  const cfg = postConfig().clips;
  const maxWords = cfg.hooksMaxWords;
  const formats = pickFormats(cfg.formats, clip.title, candidates);

  if (!hasApiKey()) return { text: null, error: 'ANTHROPIC_API_KEY is not set', rejected: [] };
  if (!formats.length) return { text: null, error: 'no formats configured in post-config.json', rejected: [] };

  // What is ACTUALLY in the frame, from the vision judge, rather than the
  // uploader's title. This is why a clip of an empty road produced "העובדה
  // שהכביש הזה לא עולה כסף" — the writer was told "pov mountain road cycling
  // adventure" and had no way to know the frame contained no mountain. Given
  // the description it can attach the line to something real.
  const seen = clip.vision?.subject ? `מה רואים בפריים: ${clip.vision.subject}` : null;

  const user = [
    'הסרטון: ' + `"${clip.title}"` + ` — צילום סטוק אנכי, ${clip.duration} שניות.`,
    seen,
    '',
    'התבניות למלא, אחת שורה לכל אחת:',
    ...formats.map(
      (f) => `- ${f.id} (${f.he}): ${f.desc}
  דוגמאות: ${f.examples.join(' · ')}`
    ),
    '',
    used.size
      ? ['שורות שכבר בשימוש בסבב הזה — אל תחזור עליהן:', ...[...used].map((u) => `  ${u}`)].join('\n')
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 2000,
    output_config: { effort: EFFORT, format: { type: 'json_schema', schema: SCHEMA } },
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
  });

  recordUsage(res.usage, MODEL);
  if (res.stop_reason === 'refusal') return { text: null, error: 'hook writing refused', rejected: [] };

  const raw = res.content.find((b) => b.type === 'text')?.text;
  if (!raw) return { text: null, error: 'hook writing returned no text', rejected: [] };

  const lines = (JSON.parse(raw).lines || []).map((l) => ({
    format: String(l.format || ''),
    text: String(l.text || '').trim(),
  }));

  const rejected = [];
  for (const { format, text } of lines) {
    const why = reject(text, { maxWords });
    if (why) {
      rejected.push(`${text} — ${why}`);
      continue;
    }
    if (used.has(text)) {
      rejected.push(`${text} — already used in this batch`);
      continue;
    }
    return {
      text,
      format,
      rejected,
      alternatives: lines.filter((l) => l.text !== text).map((l) => `[${l.format}] ${l.text}`),
    };
  }

  return { text: null, error: 'every candidate was rejected', rejected };
}
