import Anthropic from '@anthropic-ai/sdk';
import { record as recordUsage } from '../usage.js';
import { postConfig } from '../postConfig.js';
import { URL_LIKE } from '../format.js';

// The hook and the beats that go on a clip, written per clip.
//
// A line is written for THIS clip rather than drawn from a pool, and that part
// has not changed: a pool is a template with extra steps, twenty lines across a
// hundred posts is the same five sentences five times each, and the footage is
// already interchangeable stock — if the line is a rerun too, there is nothing
// left that is ours. The pool survives as the fallback for a failed call, which
// is the honest thing to degrade to.
//
// WHAT CHANGED, AND WHY
//
// This file used to fill MEME TEMPLATES. It was built from five real posts the
// owner supplied, ranging from 122 likes to 284K:
//
//   284K  "Hiking with your gf has to be top 5 activities oat"
//   229K  "one of the coolest feelings that a human can experience is to feel
//          so small in a world that's so big"
//   130K  "Average supermarket exit in Slovenia"
//   1.5K  "Fuck electrical engineering / go to lake como"
//   122   "דפנה אחי, קיבוץ דפנה"
//
// The observation was correct — none of the top four describes the footage,
// they are a thought the footage happens to answer, and all of them are badly
// written on purpose because polish is what an advertisement has.
//
// It was also the wrong target. Those five posts belong to accounts selling
// nothing, competing in no particular niche, in English. Applied here it
// produced seven videos decaying 672 → 33 views with one follower at the end of
// it (BRIEF.md). A meme template over stock scenery promises the viewer
// nothing, so nobody watches to the end, so the next video starts lower.
//
// So the shapes are now the brief's: a specific problem, a specific number, a
// specific destination, inside the first two seconds. The rule that survives is
// the one that was never really about memes — FILL A FORMAT, do not compose
// freely. A model asked to be interesting writes copy. A model asked to fill
// "<n> טעויות שישראלים עושים ב<מדינה>" writes the post.
//
// AND THE HOOK NOW HAS BEATS UNDER IT.
//
// This is the half that makes the rest honest. "3 טעויות שישראלים עושים
// בגאורגיה" over eight seconds of scenery is a promise the video does not keep,
// and a broken promise costs more than a boring one — the viewer who stayed for
// the answer and did not get it is the viewer who scrolls past the next post.
// So the writer returns the hook AND the two to four lines that deliver it, and
// overlay.js burns each one over its own window.

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5';
const EFFORT = process.env.HOOKS_EFFORT || 'low';

let client = null;
const getClient = () => (client ??= new Anthropic());
export const hasApiKey = () => Boolean(process.env.ANTHROPIC_API_KEY);

// The system prompt deliberately does NOT try to teach taste. Four rounds of
// that failed identically: whatever the register, free composition returns
// clever original sentences — personification, similes, wry turns — and clever
// is the wrong TYPE. So the job given to the model is to fill the format and
// add no ideas of its own. That was true when the formats were memes and it is
// true now that they are promises.
const SYSTEM = `אתה כותב טקסט לסרטון טיקטוק קצר בעברית, לקהל ישראלי שמתכנן חופשה.

כל סרטון הוא שני דברים:
  הוק — שורה אחת שמופיעה בשנייה הראשונה ומבטיחה משהו מסוים.
  ביטים — 2 עד 4 שורות קצרות שמופיעות אחריו ומוסרות בדיוק את מה שהובטח.

זו לא כתיבה יצירתית. התבנית היא המבנה, והתוכן שממלא אותה חייב להיות שימושי
ומדויק. הברקות, מטאפורות והאנשות פוסלות שורה.

הכלל היחיד שאי אפשר להפר: ההוק מבטיח, והביטים מקיימים. אם ההוק אומר
"3 טעויות" — יש בדיוק 3 ביטים וכל אחד הוא טעות. אם ההוק אומר סכום —
הסכומים בביטים מסתכמים אליו בערך. הוק שלא מקוים גרוע מהוק משעמם: הצופה
שנשאר בשביל התשובה ולא קיבל אותה הוא הצופה שגולל מעל הפוסט הבא.

דוגמאות טובות, הוק ואחריו הביטים שלו:

  "3 טעויות שישראלים עושים בגאורגיה"
    · שוכרים רכב רק בשדה התעופה — יקר בהרבה
    · מגיעים באוגוסט, כשכולם שם
    · לא מזמינים מראש ומשלמים כפול

  "5 ימים ברומא ב-2,000 ₪ — ככה"
    · טיסה הלוך ושוב — 700 ₪
    · לינה 4 לילות — 800 ₪
    · אוכל ותחבורה — 500 ₪

  "אל תטוסו לתאילנד לפני שאתם יודעים את זה"
    · העונה הגשומה נמשכת עד נובמבר
    · הדרכון חייב להיות בתוקף חצי שנה
    · המעבר מהאי לאי לוקח יום שלם

ואלה שורות שנפסלות, עם הסיבה:
  "יעדים מדהימים באירופה"                  ← לא מבטיח כלום. אין מספר, אין תנאי, אין בעיה.
  "המקום הזה פשוט קסום"                    ← התפעלות. הצופה כבר רואה את התמונה.
  "אף אחד לא מדבר על השקט הזה"             ← אין מידע. שקט הוא לא סיבה לעצור.
  "טעות אחת שכולם עושים"                   ← מעורפל. איזו טעות, איפה.
  "כדאי להזמין מראש"                       ← נכון וריק. כמה זה חוסך, מתי, איפה.
  "הנוף שם עוצר נשימה"                     ← תיאור של הפוטג׳, לא של מה שהצופה לא יודע.

ההבדל: שורה טובה מוסרת משהו שהצופה לא ידע ויכול להשתמש בו — מספר, עונה,
מסמך, מרחק, שעה, סכום. שורה פסולה מתארת את מה שכבר רואים או מתפעלת ממנו.

מחירים:
- סכומים בשקלים מותרים ורצויים בתבניות שמבקשות אותם.
- סכום חייב להיות סביר ועגול. 1,500 ₪, 2,000 ₪, 700 ₪ — לא 1,847 ₪.
- אל תמציא מחיר לתבנית שלא ביקשה אותו.

גוף ופנייה:
- פנייה לצופה מותרת ורצויה: "אל תטוסו", "אתם", "שלכם", "תבדקו". זה הקול של
  הפורמט הזה.
- אסור לטעון שהיית במקום: "אני שם", "הייתי שם", "האוויר פה", "נשבע לכם".
  הפוטג׳ הוא סטוק ואף אחד מאיתנו לא עמד שם.

חוקים:
- ההוק: עד {MAXWORDS} מילים. ביט: עד {BEATWORDS} מילים. עברית פשוטה.
- בלי אימוג׳י, האשטג, קישור, שם מותג, קריאה לפעולה.
- שם מדינה מותר אך ורק בתבניות שמבקשות אותו במפורש, ורק את השם שניתן לך.
  בכל תבנית אחרת אל תנחש מדינה — לא ידוע איפה צולם.

החזר JSON בלבד: הוק אחד וביטים אחד לכל תבנית שקיבלת.`;

/** The word ceilings are configured, so the prompt is built rather than fixed. */
const systemFor = (maxWords, beatWords) =>
  SYSTEM.replace('{MAXWORDS}', String(maxWords)).replace('{BEATWORDS}', String(beatWords));

// additionalProperties: false on every object is REQUIRED by the structured
// output API, not optional tidiness — it rejects the whole request with a 400
// without it, and the fallback pool catches that silently.
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    lines: {
      type: 'array',
      description: 'One filled hook per requested format, same order',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          format: { type: 'string', description: 'the id of the format this line fills' },
          text: { type: 'string', description: 'ההוק — שורה אחת, עברית, נאמנה לתבנית' },
          beats: {
            type: 'array',
            description: 'השורות שמקיימות את ההוק, לפי הסדר. כל אחת שורה נפרדת בסרטון.',
            items: { type: 'string' },
          },
        },
        required: ['format', 'text', 'beats'],
      },
    },
  },
  required: ['lines'],
};

/**
 * A claim to have BEEN there, which this account cannot make.
 *
 * The strictest rule here and the one that took three rejected rounds to find.
 * The footage is stock: nobody who posts it has stood in that forest. "אני נשבע
 * שהאוויר פה אחר" is therefore a claim about a place the poster has never been,
 * and it reads false in a way viewers feel without being able to name — the
 * same way a stock lifestyle shot reads as an advertisement.
 *
 * SECOND PERSON CAME OFF THIS LIST, and the split is the point.
 *
 * It used to catch אתה and אתם and שלך alongside אני and הייתי, on one rule
 * called "first or second person". That conflated two different things. First
 * person claims PRESENCE — it says the poster was somewhere. Second person is
 * ADDRESS — it speaks to the viewer, from here, and claims nothing about
 * anywhere. The old file already knew this, which is why it had to carve out an
 * `allowsPerson` exemption for the two formats built out of pronouns.
 *
 * The brief's voice is advisory: "אל תטוסו לתאילנד לפני שאתם יודעים את זה" is
 * the shape of four of its five formats. Under the old guard every one of them
 * is rejected on every run, and the exemption would have had to be set on
 * almost every format — at which point the guard catches nothing and is just a
 * field to remember to set.
 *
 * So address is allowed outright and presence stays banned. `allowsPerson`
 * survives for the rare format that genuinely wants "אני", and it now means
 * what it says rather than being the box you tick to get a normal sentence.
 *
 * Matched with prefixes attached, because Hebrew glues them on: שלי, ולי all
 * carry the pronoun and all have to be caught. לי / לנו / אותי are deliberately
 * ABSENT — "למה אף אחד לא סיפר לי על השביל הזה" is an owner-approved line and
 * the first version of this regex would have filtered it.
 */
const PRESENCE = /(^|\s|ו|ש|ב|ל|כ|מ)(אני|אנחנו|שלי|שלנו|אחי|איתי|איתנו|הייתי|היינו|נשבע)($|\s|,|\.|\?)/;

export const hasPerson = (line) => PRESENCE.test(String(line || ''));

// The markers that make a line a STATEMENT rather than a bare label. Kept from
// the previous format because it still catches the failure it was written for —
// "הדולומיטים, איטליה" is a caption of the picture, and the picture is already
// on the screen.
const STATEMENT =
  /(^|\s)(אני|אתה|את|אנחנו|אתם|הם|זה|זו|יש|אין|הייתי|היית|היה|תמיד|אף פעם|פעם|למה|איך|מתי|כמה|לא|רק|סוף סוף|פתאום|כל|שום|מישהו|כשאני|כשאתה|חייב|חייבת|תזכורת|העובדה|הכי|מסתבר|אפשר|עולה|שווה|נחשב|אמור|קיים|קיימת|קיימים|>)($|\s|,)/;

/**
 * Does this line PROMISE something?
 *
 * The check STATEMENT could not make on its own, and the reason a second one
 * exists. Every one of the brief's hooks is a promise, and several of them are
 * grammatically noun phrases — "3 טעויות שישראלים עושים בגאורגיה" asserts
 * nothing and STATEMENT rejects it as a label, which is exactly backwards: the
 * digit is what makes it a promise, and the promise is what makes it a hook.
 *
 * A digit, or one of the words that open a promise without needing one. Both
 * are cheap and neither is clever, which is the correct amount of machinery for
 * a check whose failure mode is "one good line was rejected and the alternate
 * shipped instead".
 */
const PROMISE = /\d|(^|\s)(אל|כולם|האמת|ככה|בלי|לפני|מפספס|מפספסים|שאף|ביקשתי)($|\s|,)/;

export function isLabel(line) {
  const s = String(line || '').trim();
  if (!s) return true;
  if (s.includes('?')) return false;
  return !PROMISE.test(s) && !STATEMENT.test(s);
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
  // Per format, because the shapes are different lengths BY DESIGN. A blanket
  // floor of five used to reject two owner-written formats on every run.
  if (words < minWords) return `${words} words, under ${minWords} — too short to say anything`;
  if (!allowsPerson && hasPerson(s)) return 'claims to have been there — the footage is not ours';
  if (isLabel(s)) return 'a label, not a promise — nothing is offered and nothing is asserted';
  return null;
}

/**
 * One beat, checked.
 *
 * Looser than the hook on two counts and stricter on one. Looser: a beat may be
 * a bare label, because "טיסה הלוך ושוב — 700 ₪" is a line item and a line item
 * is supposed to read like one; and its floor is two words rather than five,
 * for the same reason. Stricter: it still may not claim presence, because the
 * middle of a video is exactly where "כשהייתי שם" slips in unnoticed.
 */
function rejectBeat(text, { maxWords, allowsPerson = false }) {
  const s = String(text || '').trim();
  if (!s) return 'empty';
  if (URL_LIKE.test(s)) return 'carries a URL';
  if (/[#@]/.test(s)) return 'carries a hashtag or handle';
  if (/\p{Extended_Pictographic}/u.test(s)) return 'carries an emoji';
  const words = s.split(/\s+/).length;
  if (words > maxWords) return `${words} words, over ${maxWords}`;
  if (words < 2) return 'one word — not a beat';
  if (!allowsPerson && hasPerson(s)) return 'claims to have been there — the footage is not ours';
  return null;
}

// The nouns that make a number a LIST LENGTH rather than a measurement.
//
// An allowlist, and it has to be one. The first version of the check below read
// any small digit as a count, which is correct for "3 טעויות" and wrong for
// "5 ימים ברומא ב-2,000 ₪" — where the 5 is how long the trip is and the hook
// promises no list at all. It rejected the budget format on every single run,
// which is the exact failure this file already recorded twice: a guard that
// rejects a canonical line is a broken guard.
//
// Durations are conspicuously absent — ימים, לילות, שעות, שנים — because that
// is the family the false positive came from. Adding one here is saying that a
// hook counting them owes the viewer one beat each.
const LIST_NOUNS =
  /^(טעויות|שגיאות|יעדים|מקומות|דברים|סיבות|טיפים|כללים|שלבים|בעיות|עצות|ערים)$/;

/**
 * Does the hook's own number match how many beats arrived?
 *
 * The one check that is about the pair rather than about either line, and the
 * only rule in this file that cannot be waived. "3 טעויות" over two beats is a
 * post that breaks its promise in front of the viewer, and it is worse than a
 * dull post: somebody stayed for the third mistake.
 *
 * Fires only when the digit is immediately followed by a word from LIST_NOUNS,
 * which is what distinguishes "three of these are coming" from "the trip is
 * five days long".
 */
export function beatCountMismatch(hook, beats) {
  const m = String(hook || '').match(/(?:^|\s)(\d)\s+([א-ת]+)/);
  if (!m) return null;
  const want = Number(m[1]);
  if (!want || want > 8 || !LIST_NOUNS.test(m[2])) return null;
  return beats.length === want ? null : `hook promises ${want} ${m[2]}, ${beats.length} beat(s) arrived`;
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
  const { beatsMin, beatsMax, beatMaxWords } = cfg;

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
    'הסרטון: ' + `"${clip.title}"` + ` — צילום סטוק אנכי, ${clip.duration} שניות.`,
    seen,
    placeHe ? `המדינה, מזוהה בוודאות: ${placeHe}. השתמש בשם הזה בדיוק בתבניות שדורשות מדינה.` : null,
    '',
    `התבניות למלא. לכל אחת: הוק אחד, ו-${beatsMin} עד ${beatsMax} ביטים שמקיימים אותו.`,
    ...formats.map((f) =>
      [
        `- ${f.id} (${f.he}): ${f.desc}`,
        f.examples.length ? `  דוגמאות להוק: ${f.examples.join(' · ')}` : null,
        f.beatsAre ? `  הביטים: ${f.beatsAre}` : null,
        f.beatExamples.length ? `  דוגמאות לביטים: ${f.beatExamples.join(' · ')}` : null,
        f.allowsPrice ? '  מחיר בשקלים הוא הנקודה של התבנית הזו — סכום עגול וסביר.' : null,
      ]
        .filter(Boolean)
        .join('\n')
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
    system: [{ type: 'text', text: systemFor(maxWords, beatMaxWords), cache_control: { type: 'ephemeral' } }],
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
    .map((l) => ({
      format: String(l.format || ''),
      text: String(l.text || '').trim(),
      beats: (Array.isArray(l.beats) ? l.beats : []).map((b) => String(b || '').trim()).filter(Boolean),
    }))
    .sort((a, b) => (weightOf.get(b.format) || 1) - (weightOf.get(a.format) || 1));

  const rejected = [];
  for (const { format, text, beats } of lines) {
    const allowsPerson = allowsPersonBy.get(format) === true;
    const why = reject(text, { maxWords, minWords: minWordsBy.get(format) ?? 5, allowsPerson });
    if (why) {
      rejected.push(`${text} — ${why}`);
      continue;
    }
    if (used.has(text)) {
      rejected.push(`${text} — already used in this batch`);
      continue;
    }
    // The line may name the clip's country and no other. With no country
    // established it may name none at all — the prompt says so, and a line
    // that ignores it would put a country on the video that the description
    // underneath deliberately refuses to claim.
    const other = namesOtherCountry(text, placeHe);
    if (other) {
      rejected.push(`${text} — names ${other}, the clip is ${placeHe || 'unplaced'}`);
      continue;
    }

    // Beats are filtered individually and the hook is then judged on what
    // SURVIVED, not on what arrived. A beat that names the wrong country is one
    // bad line; dropping the whole candidate for it would throw away a good
    // hook because its third bullet mentioned Croatia.
    const keptBeats = [];
    for (const b of beats.slice(0, beatsMax)) {
      const bad = rejectBeat(b, { maxWords: beatMaxWords, allowsPerson });
      if (bad) {
        rejected.push(`  ביט: ${b} — ${bad}`);
        continue;
      }
      const wrong = namesOtherCountry(b, placeHe);
      if (wrong) {
        rejected.push(`  ביט: ${b} — names ${wrong}, the clip is ${placeHe || 'unplaced'}`);
        continue;
      }
      keptBeats.push(b);
    }

    if (keptBeats.length < beatsMin) {
      rejected.push(`${text} — ${keptBeats.length} usable beat(s), needs ${beatsMin}`);
      continue;
    }
    // The promise check, last, because it is about the pair and both halves
    // have to have survived for it to mean anything.
    const mismatch = beatCountMismatch(text, keptBeats);
    if (mismatch) {
      rejected.push(`${text} — ${mismatch}`);
      continue;
    }

    return {
      text,
      beats: keptBeats,
      format,
      rejected,
      alternatives: lines.filter((l) => l.text !== text).map((l) => `[${l.format}] ${l.text}`),
    };
  }

  return { text: null, beats: [], error: 'every candidate was rejected', rejected };
}
