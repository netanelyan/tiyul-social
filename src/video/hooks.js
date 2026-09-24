import Anthropic from '@anthropic-ai/sdk';
import { record as recordUsage } from '../usage.js';
import { postConfig } from '../postConfig.js';
import { URL_LIKE } from '../format.js';
import { stripDashes } from '../dashes.js';

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
// ONE LINE, AND IT DOES NOT MOVE.
//
// This file briefly wrote a hook plus two to five BEATS — advice lines, each
// burned over its own window, so the text changed four times across a
// twenty-six second clip. It was built to satisfy the brief's "a hook promises,
// the video delivers", and as writing it did that.
//
// It was still the wrong thing over THIS footage. The picture underneath never
// changes: one steady stock shot, held for half a minute, while lines swap
// above it. That is a slideshow with a video background, and it reads as one —
// the footage stops being the post and becomes wallpaper for a caption that
// keeps rewriting itself.
//
// The advice formats and their beats are not deleted for being bad. They are
// waiting for the post type they belong to, where every line change is a CUT —
// new footage under every beat, which is what makes a list of five destinations
// worth watching rather than worth reading. Until that type exists, the writer
// here returns one line and overlay.js burns it once.
//
// git show 97ec1c1 has the beats machinery whole: the prompt that produced
// them, the per-beat guards, and the timeline that spaced them. Lift it from
// there rather than rebuilding it.
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

השורה הזו היא כל הטקסט בסרטון. היא מופיעה בשנייה הראשונה ונשארת עד הסוף, 
אין שורה שנייה שתסביר אותה ואין המשך. היא צריכה לעמוד לבד.

אלה שורות שהבעלים אישר, מילה במילה, זה הסטנדרט:
  "העובדה שהשביל הזה לא עולה כסף"
  "חייב להיות בטופ 3 מסלולים שקיימים"
  "יש אנשים שזה המסלול שלהם לעבודה"
  "חייב להיות בטופ 3 דברים שעשיתי השבוע"
  "למה אף אחד לא סיפר לי על השביל הזה"
  "איך לא שמעתי על המסלול הזה עד היום"

ואלה שורות שנפסלו, עם הסיבה:
  "איך זה חוקי שלשביל הזה אין שעות פתיחה"    ← רעיון מומצא. לשביל אין שעות פתיחה - זו הברקה, והברקות פסולות.
  "תזכורת שהנחל הזה זורם גם בשעות העבודה"    ← אותה הברקה: הצלבה חכמה בין נחל למשרד.
  "עשר דקות ליד מפל כזה > יום חופש מהעבודה"   ← השוואה בנויה מדי. נשמע כמו קופירייטינג.
  "יש אנשים שזה סוף השבוע הרגיל שלהם"         ← מעורפל. "סוף שבוע רגיל" לא נאחז בכלום.
  "אף אחד לא מדבר על הצל בשביל הזה"           ← הצל הוא פרט שולי. הסוד חייב להיות החוויה עצמה.
  "אף אחד לא מדבר על הקול של המים"            ← אותה בעיה: פיצ'ר פיזי קטן במקום החוויה.
  "חדר כושר עולה 200 שקל בחודש וזה בחינם"     ← חדר כושר לא מתחלף בטבע.
  "חופשה עולה אלפי שקלים והשביל הזה בחינם"    ← גם זה לא עבד. תבנית השוואת המחיר בוטלה כליל - אל תשתמש בה.
  "אף אחד לא מדבר על כמה ריק בשביל הזה"       ← ברור שאף אחד לא מדבר על שביל ריק. אין שם סוד.
  "3 דברים שחייבים לדעת לפני ש..."            ← נקטע. השורה לא נגמרת, ואין שורה הבאה שתשלים אותה.
  "3 טעויות שישראלים עושים בגאורגיה"          ← מבטיח רשימה. בסרטון הזה יש שורה אחת בלבד, אז ההבטחה לא מקוימת.

ההבדל: השורות הטובות נאחזות במשהו שבאמת שייך לעולם, מחיר, דרך לעבודה, מה
עשיתי השבוע. הפסולות ממציאות מפגש שנון בין הטבע למושג ממוסד (שעות פתיחה,
שעות עבודה, חשבון ימי חופש). אם יש בשורה "רעיון" - היא פסולה.

דיוקים שנלמדו מהסבבים:
- "אף אחד לא מדבר על X" - ה-X חייב להיות משהו שאנשים באמת היו מתפארים בו
  והוא בכל זאת לא מדובר. השקט עובד. צל, קול מים, "כמה ריק" - לא: אלה פרטים
  שאין סיבה שידברו עליהם, אז אין סוד ואין שורה.
- גוף ראשון קל מותר כשהוא קול של צופה שמגיב לסרטון: "סיפר לי", "שעשיתי",
  "שראיתי". אסור קול של מי שנמצא שם עכשיו: "אני פה", "האוויר פה".
- השורה נגמרת בסוף הטבעי של התבנית. שני תיקונים של הבעלים, מילה במילה:
    "לא עולה כסף לאף אחד"  →  "לא עולה כסף"        (זנב מיותר, נחתך)
    "איך לא שמעתי... בחורף"  →  "איך לא שמעתי... עד היום"  (התבנית רוצה את
     הסיום הטבעי שלה, לא פרט מהסרטון שנדחף אליה)
  זה לא איסור על מילים מסוימות, "פתוח לכולם" תקין כי שם זו הטענה עצמה.
  השאלה היא אם המילים האחרונות מוסיפות טענה או רק נגררות.

השורה נגמרת:
- היא משפט שלם. היא נקראת לבד על המסך, ואין על מה ללחוץ בשביל ההמשך.
- בלי "..." בסוף ובלי שורה שנקטעת באמצע. אם אין מקום לכל המשפט - כתוב משפט
  קצר יותר, לא חצי משפט.
- אסור לסיים במילת חיבור או יחס: "של", "את", "עם", "ש", "ו", "כי", "ב", "ל".
- אל תבטיח רשימה, מספר פריטים או "ככה עושים את זה". אין המשך שיקיים את זה.

חוקים:
- עד {MAXWORDS} מילים. עברית פשוטה. בלי סלנג מודגש. בלי מילות הדגשה בסוף ("אף פעם", "בכלל").
- גוף ראשון מותר רק כשהוא חלק מהתבנית עצמה ("דברים שעשיתי השבוע").
  אסור "אני" מפורש, ואסור לטעון שהיית במקום הספציפי הזה.
- מותר להגיד "השביל הזה" / "המסלול הזה" - הסרטון מראה שביל.
- בלי אימוג׳י, האשטג, קריאה לפעולה, שם מותג, קישור.
- שם מדינה מותר אך ורק בתבניות שמבקשות אותו במפורש, ורק את השם שניתן לך.
  בכל תבנית אחרת אל תנחש מדינה, לא ידוע איפה צולם.

החזר JSON בלבד: שורה אחת לכל תבנית שקיבלת.`;

/** The word ceiling is configured, so the prompt is built rather than fixed. */
const systemFor = (maxWords) => SYSTEM.replace('{MAXWORDS}', String(maxWords));

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
 * SECOND PERSON IS BACK ON THIS LIST, and the reason is the formats. It came
 * off when the writer filled advisory shapes — "אל תטוסו לתאילנד לפני שאתם
 * יודעים את זה" is address, not presence, and banning it rejected every line
 * those formats produced. Those formats are parked (see the note at the top),
 * and the ones that came back are observations rather than advice: a clip that
 * tells the viewer what to do is the shape that needed the beats underneath it.
 *
 * Matched with prefixes attached, because Hebrew glues them on: שלי, ולי,
 * ושלך all carry the pronoun and all have to be caught.
 */
// לי / לנו / אותי are deliberately ABSENT: the owner's own approved line is
// "למה אף אחד לא סיפר לי על השביל הזה", and the first version of this regex
// would have filtered it. What stays banned is the on-location voice — the
// explicit standing pronouns and the possessives that claim the place.
const PERSON = /(^|\s|ו|ש|ב|ל|כ|מ)(אני|אנחנו|אתה|אתם|שלי|שלך|שלנו|אחי|איתי|איתך|איתנו|הייתי|היינו|נשבע)($|\s|,|\.|\?)/;

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

// Hebrew spells a foreign name by ear, so the same country has two or three
// accepted forms — שווייץ and שוויץ, נורווגיה and נורבגיה. Collapsing doubled
// י and ו makes them one string for comparison purposes only; nothing is
// published from this.
const sameName = (a) => String(a || '').replace(/([יו])\1+/g, '$1');

/**
 * A country named in the line that is not the country of the clip.
 *
 * The line, the pin under the video and the country hashtag are three
 * statements of one fact, and until this guard existed nothing checked that
 * they agreed. The writer is TOLD which country to use and mostly obeys; when
 * it does not, the result is a post whose burned-in line says one country while
 * its own description says another, and that contradiction is visible to every
 * viewer without them having to know which one is right.
 *
 * Only the countries this account has a Hebrew spelling for are checked — the
 * same list the pin and the tag are drawn from — so this can only ever fire on
 * a word the post could itself have printed.
 */
export function namesOtherCountry(line, placeHe) {
  const s = String(line || '');
  const mine = sameName(placeHe);
  for (const he of new Set(Object.values(postConfig().places))) {
    if (sameName(he) === mine) continue;
    // Hebrew glues its prepositions on: לאיטליה, באיטליה, ואיטליה all carry
    // the name and all have to be caught. The optional letter between each
    // pair is the other half of the spelling problem — it lets נורבגיה match
    // נורווגיה without either spelling having to be the canonical one.
    //
    // Escaped per character because the names come out of post-config.json,
    // and a country typed in with a bracket in it would otherwise be a regex
    // that throws in the middle of building a clip.
    const stem = sameName(he)
      .split('')
      .map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[יו]?');
    if (new RegExp(`(^|[\\s"'״׳]|[בלוהמשכ])${stem}($|[\\s,.!?"'״׳])`).test(s)) return he;
  }
  return null;
}

// An ellipsis, in either spelling. A line that ends in one is a line that was
// not finished.
const ELLIPSIS = /…|\.\s*\.\s*\.?/;

// The words a Hebrew sentence cannot end on. Every one of them takes something
// after it, so a line that stops here stopped in the middle.
//
// Conspicuously ABSENT, and each for a line this account would actually
// publish: יותר and פחות ("זול יותר" is a finished sentence), לפני and אחרי
// ("מזמינים חודש לפני" is a whole line and a good one), גם, רק. The test for
// membership is not "does it feel unfinished" — it is "is there any sentence
// this bot would print that ends on this word", and if there is, the word does
// not belong here. A guard that rejects a good line is the failure this file
// has already recorded twice.
const DANGLING =
  /(^|\s)(ו|ש|של|את|עם|על|אל|כי|אבל|או|כמו|בין|כדי|ב|ל|מ|כ|ה)$/;

/**
 * A line that trails off instead of ending.
 *
 * Written for a batch that shipped with "..." burned into the video. The model
 * had been told to fill a format and wrote the first half of one — a teaser,
 * which is a shape that works in a caption a reader can scroll and is worthless
 * on screen, where there is nothing to click and nothing after it. It matters
 * more now than when it was written: this line is the whole text of the post,
 * so half a sentence is half a post.
 *
 * It is also the one defect none of the other checks could see. It is not a
 * URL, not an emoji, not a claim of presence, not a label — it is a correctly
 * formatted line that does not finish its own sentence, and it passed every
 * guard in this file on the way to being encoded.
 *
 * Returns the reason, or null when the line ends.
 */
export function trailsOff(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  if (ELLIPSIS.test(s)) return 'trails off - a line on screen has nothing to click for the rest';
  if (/[,\-–—:;]$/.test(s)) return 'ends on punctuation that expects more after it';
  const last = s.split(/\s+/).pop();
  if (DANGLING.test(` ${last}`)) return `ends on "${last}" - the sentence is cut off`;
  return null;
}

/** A line is unusable if it carries a link, runs long, or is a caption. */
/**
 * `allowsPerson` is the escape hatch for the two formats built out of pronouns.
 *
 * "אני, אתה, טיסה לפרו?" and "פרו אחי, פרו" are the owner's own words, and the
 * person guard rejected both — אני, אתה and אחי are all on its list. They were
 * produced correctly on every run and filtered out every time, which is why
 * they only ever appeared as alternates.
 *
 * The guard is still right in general. What it is for is stopping the account
 * claiming to have BEEN somewhere — "אני נשבע שהאוויר פה אחר" over footage
 * nobody shot. A vocative and an invitation make no such claim: "me, you, a
 * flight to Peru?" is addressed to the viewer from here, not from Peru.
 */
function reject(text, { maxWords, minWords = 5, allowsPerson = false }) {
  const s = String(text || '').trim();
  if (!s) return 'empty';
  if (URL_LIKE.test(s)) return 'carries a URL';
  if (/[#@]/.test(s)) return 'carries a hashtag or handle';
  if (/\p{Extended_Pictographic}/u.test(s)) return 'carries an emoji';
  const words = s.split(/\s+/).length;
  if (words > maxWords) return `${words} words, over ${maxWords}`;
  // Per format, because the two place shapes are short BY DESIGN — "פרו אחי,
  // פרו" is three words and "אני, אתה, טיסה לפרו?" is four. A blanket floor of
  // five rejected both on every run, which together with the person guard is
  // why neither ever reached a post.
  if (words < minWords) return `${words} words, under ${minWords} - too short to say anything`;
  const unfinished = trailsOff(s);
  if (unfinished) return unfinished;
  const promised = promisesList(s);
  if (promised) return promised;
  if (!allowsPerson && hasPerson(s)) return 'first or second person - the footage is not ours';
  if (isLabel(s)) return 'a label, not a statement - nothing is asserted';
  return null;
}

// The nouns that make a number a LIST LENGTH rather than a measurement.
//
// An allowlist, and it has to be one. Reading any small digit as a count is
// right for "3 טעויות" and wrong for "5 ימים ברומא" — where the 5 is how long
// the trip is and nothing is being enumerated. Durations are conspicuously
// absent — ימים, לילות, שעות, שנים — because that is the family the false
// positive came from.
const LIST_NOUNS =
  /^(טעויות|שגיאות|יעדים|מקומות|דברים|סיבות|טיפים|כללים|שלבים|בעיות|עצות|ערים)$/;

/**
 * Does this line promise a list the video cannot deliver?
 *
 * The one guard that came OUT of the beats experiment rather than going back
 * with it. A clip carries a single line held for its whole length, so "3
 * טעויות שישראלים עושים בגאורגיה" is a promise with nothing behind it — and
 * the viewer who stayed for the third mistake is the viewer who scrolls past
 * the next post. That failure is worse than a dull line, and it is the failure
 * the beats existed to prevent.
 *
 * Fires only when the line OPENS on the number, which is what separates a
 * promise from a ranking. "חייב להיות בטופ 3 דברים שעשיתי השבוע" is an
 * owner-approved line whose digit enumerates nothing — it is inside the format,
 * not the subject of it — and a guard that rejects a canonical line is a broken
 * guard, twice recorded in this file.
 */
export function promisesList(line) {
  const m = String(line || '').trim().match(/^(\d{1,2})\s+([א-ת]+)/);
  if (!m) return null;
  return LIST_NOUNS.test(m[2]) ? `promises ${m[1]} ${m[2]} and the clip has one line` : null;
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

  // Heaviest first, because the FIRST usable line is the one that ships — the
  // rest are alternates nobody sees. Weighting only which formats get offered
  // leaves the favoured ones sitting second on the list, which is where the
  // two place formats landed on their first run: both produced exactly what
  // was asked for, and neither was chosen.
  return out.sort((a, b) => (b.weight || 1) - (a.weight || 1));
}

export async function writeHook(clip, { used = new Set(), candidates = 3 } = {}) {
  const cfg = postConfig().clips;
  const maxWords = cfg.hooksMaxWords;

  // The Hebrew country, when the judge was sure enough to name one. Two of the
  // formats are built around it and must not be offered without it — a clip of
  // an unidentifiable forest captioned "יוון אחי, יוון" states something the
  // account cannot know, which is the one thing this pipeline refuses to do.
  const placeHe = clip.vision?.place ? postConfig().places[clip.vision.place.toLowerCase()] || null : null;
  const usable = cfg.formats.filter((f) => !f.needsPlace || placeHe);
  const formats = pickFormats(usable, clip.title, candidates);

  if (!hasApiKey()) return { text: null, error: 'ANTHROPIC_API_KEY is not set', rejected: [] };
  if (!formats.length) return { text: null, error: 'no formats configured in post-config.json', rejected: [] };

  // What is ACTUALLY in the frame, from the vision judge, rather than the
  // uploader's title. This is why a clip of an empty road produced "העובדה
  // שהכביש הזה לא עולה כסף" — the writer was told "pov mountain road cycling
  // adventure" and had no way to know the frame contained no mountain. Given
  // the description it can attach the line to something real.
  const seen = clip.vision?.subject ? `מה רואים בפריים: ${clip.vision.subject}` : null;

  const user = [
    'הסרטון: ' + `"${clip.title}"` + ` - צילום סטוק אנכי, ${clip.duration} שניות.`,
    seen,
    placeHe ? `המדינה, מזוהה בוודאות: ${placeHe}. השתמש בשם הזה בדיוק בתבניות שדורשות מדינה.` : null,
    '',
    'התבניות למלא, שורה אחת לכל אחת:',
    ...formats.map((f) =>
      [
        `- ${f.id} (${f.he}): ${f.desc}`,
        f.examples.length ? `  דוגמאות: ${f.examples.join(' · ')}` : null,
      ]
        .filter(Boolean)
        .join('\n')
    ),
    '',
    used.size
      ? ['שורות שכבר בשימוש בסבב הזה - אל תחזור עליהן:', ...[...used].map((u) => `  ${u}`)].join('\n')
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 2000,
    output_config: { effort: EFFORT, format: { type: 'json_schema', schema: SCHEMA } },
    system: [{ type: 'text', text: systemFor(maxWords), cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
  });

  recordUsage(res.usage, MODEL);
  if (res.stop_reason === 'refusal') return { text: null, error: 'hook writing refused', rejected: [] };

  const raw = res.content.find((b) => b.type === 'text')?.text;
  if (!raw) return { text: null, error: 'hook writing returned no text', rejected: [] };

  // Ranked by the weight of the format each line fills, NOT by the order the
  // model returned them in. Asking in weight order is not enough — the model
  // reorders freely, and the first usable line is the one that ships, so a
  // favoured format that comes back third is a favoured format that never
  // publishes. That is exactly what happened to the two place formats: both
  // produced the right line, both sat in `alternatives`.
  const weightOf = new Map(formats.map((f) => [f.id, f.weight || 1]));
  const allowsPersonBy = new Map(formats.map((f) => [f.id, f.allowsPerson === true]));
  const minWordsBy = new Map(formats.map((f) => [f.id, f.minWords]));
  const lines = (JSON.parse(raw).lines || [])
    .map((l) => ({ format: String(l.format || ''), text: stripDashes(l.text) }))
    .sort((a, b) => (weightOf.get(b.format) || 1) - (weightOf.get(a.format) || 1));

  const rejected = [];
  for (const { format, text } of lines) {
    const allowsPerson = allowsPersonBy.get(format) === true;
    const why = reject(text, { maxWords, minWords: minWordsBy.get(format) ?? 5, allowsPerson });
    if (why) {
      rejected.push(`${text} - ${why}`);
      continue;
    }
    if (used.has(text)) {
      rejected.push(`${text} - already used in this batch`);
      continue;
    }
    // The line may name the clip's country and no other. With no country
    // established it may name none at all — the prompt says so, and a line
    // that ignores it would put a country on the video that the description
    // underneath deliberately refuses to claim.
    const other = namesOtherCountry(text, placeHe);
    if (other) {
      rejected.push(`${text} - names ${other}, the clip is ${placeHe || 'unplaced'}`);
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
