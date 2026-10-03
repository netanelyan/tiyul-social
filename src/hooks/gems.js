import Anthropic from '@anthropic-ai/sdk';
import { postConfig } from '../postConfig.js';
import { record as recordUsage } from '../usage.js';
import { modelFor } from '../models.js';
import { stripDashes } from '../dashes.js';
import { URL_LIKE } from '../urlLike.js';
import { isLabel, trailsOff, namesOtherCountry } from '../video/hooks.js';
import { dailyCostOf } from '../posts/verdict.js';

// THE HOOK, GENERATED AND THEN SCORED, FOR ANY FORMAT THAT CAN DELIVER IT.
//
// WHY THIS IS A SECOND HOOK MODULE AND NOT AN EDIT TO src/video/hooks.js.
//
// That file writes the line for a clip that holds ONE shot for eight seconds, and
// almost every rule in it follows from that: the line may not promise a list, may
// not name a place the judge could not confirm, may not be a label, because there is
// no second frame to pay any of it off. It also carries the opposite editorial
// instruction, which is that the line must NOT describe the footage - it is a
// thought the footage answers, "על מה אני חושב בשיעור מתמטיקה" over a forest.
//
// This one writes the line for a format whose whole content is a numbered run of
// destinations. Here a count is the delivery rather than a broken promise, naming
// the subject is the point rather than a caption, and the guard that matters is a
// different one: does THIS post contain what the line says it does.
//
// Its own file, and the guards that are genuinely about Hebrew rather than about
// the format are imported from the old one rather than copied. A second copy of
// `trailsOff` would drift, and a line that stops mid phrase is wrong on any format.
//
// WHAT THE NUMBERS ASKED FOR. The account's best post is "3 יעדים שאנשים לא חושבים
// עליהם מספיק", a 12 second reel at a 6.1% like rate. Its two highest-reach posts are
// slideshows at 0.5% and 1.3%, both of which opened on a specific promise. The
// reading taken here, and written into the scorer, is that the promise earned the
// reach and the post failed to pay it off: so a hook is scored on what the post can
// deliver, and `honesty` is a multiplier rather than one term of three.

const MODEL = modelFor('editorial');
const EFFORT = process.env.GEM_HOOKS_EFFORT || 'low';

let client = null;
const getClient = () => (client ??= new Anthropic());
export const hasApiKey = () => Boolean(process.env.ANTHROPIC_API_KEY);

/* -------------------------------------------------------------------------- */
/* the menu                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Every template offered to one format, with its category attached.
 *
 * A category with an empty `formats` list is offered to all of them. That is the
 * permissive direction and it is deliberately NOT the default in the file: every
 * category in post-config.json states its formats, because the whole mechanism
 * exists so that a shape which promises a mistake is never offered to a format made
 * of place labels.
 */
export function templatesFor(format) {
  const want = String(format || '').toLowerCase();
  const out = [];
  for (const cat of postConfig().gems.hooks.categories) {
    if (cat.formats.length && !cat.formats.includes(want)) continue;
    for (const t of cat.templates) {
      if (t.weight <= 0) continue;
      out.push({ ...t, category: cat.id, categoryHe: cat.he, categoryWeight: cat.weight });
    }
  }
  return out;
}

/** The variables a template may ask for, and the ones this post can answer. */
const VARS = ['n', 'alt', 'dest', 'hours', 'days', 'score', 'places'];

/** `{n}` and friends. Same contract as fill() in posts/voice.js: unknown keys stay. */
export const fill = (template, vars = {}) =>
  String(template || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] == null || vars[k] === '' ? m : String(vars[k])));

/** A slot the post could not answer, which is what disqualifies a template. */
export const unfilled = (text) => String(text || '').match(/\{(\w+)\}/g) || [];

/**
 * Can this post fill this template?
 *
 * TWO CHECKS AND THEY CATCH DIFFERENT THINGS. `needs` is the editorial requirement
 * declared in the file: `cheaper` is not a slot in the sentence, it is a fact that
 * has to be true before the sentence may be said. The second is mechanical: a
 * template with a `{dest}` left in it after filling would print a brace on a video.
 */
export function fillable(template, vars = {}) {
  for (const need of template.needs || []) {
    if (!vars[need] && vars[need] !== 0) return false;
  }
  return unfilled(fill(template.he, vars)).length === 0;
}

/* -------------------------------------------------------------------------- */
/* the guards                                                                  */
/* -------------------------------------------------------------------------- */

// PRESENCE, WHICH IS BANNED, AS DISTINCT FROM ADDRESS, WHICH IS NOT.
//
// `hasPerson` in the clip writer is deliberately not reused here, and the reason is
// written in that file: second person went back onto its ban list when the advisory
// formats were parked, with the note that "אל תטוסו לתאילנד לפני שאתם יודעים את זה
// is address, not presence, and banning it rejected every line those formats
// produced. Those formats are parked."
//
// This brief is what unparks them. `במקום סנטוריני, תטוסו לכאן` and `לפני שאתם
// מזמינים לסנטוריני, שתי דקות` are the brief's own example and a post this account
// actually published, and `hasPerson` rejects the second one for the word אתם.
//
// So what is banned here is only the voice of somebody standing in the place. The
// account publishes stock footage and quotes its own pages; it may tell the viewer
// what to do and it may not claim to have been there.
const PRESENCE = /(^|\s|ו|ש|ב|ל|כ|מ)(אני|אנחנו|שלי|שלנו|אחי|איתי|איתנו|הייתי|היינו|נשבע|כשהייתי)($|\s|,|\.|\?|!)/;

export const claimsPresence = (line) => PRESENCE.test(String(line || ''));

// The five Hebrew letters that change shape at the end of a word, folded to their
// medial forms. For COMPARISON only; nothing is ever published from this.
const FINALS = { ף: 'פ', ם: 'מ', ן: 'נ', ך: 'כ', ץ: 'צ' };
const unfinal = (s) => String(s || '').replace(/[ףםןךץ]/g, (c) => FINALS[c]);

// Address: a line spoken TO the viewer. Used only to exempt a line from the label
// check, because an instruction asserts something whether or not it has a pronoun
// in it. The verb pattern is the second person plural future, which is how Hebrew
// gives an instruction: תטוסו, תשמרו, תבחרו.
//
// WITH THE PREFIXES ATTACHED, because Hebrew glues them on and the first version
// did not. `לפני שאתם מזמינים לסנטוריני, שתי דקות` is a post this account published
// and the pronoun in it is שאתם, so a pattern anchored on a space missed it and the
// line was filed as a caption. Same alternation PERSON uses, and for the same reason.
const ADDRESS = /(^|\s|ו|ש|כ|ל|ב|מ|ה)(ת[א-ת]{2,}ו|אתם|אתן|שלכם|לכם|הייתם)($|\s|,|\.|\?|!)/;

/**
 * Why this line cannot be published, or null.
 *
 * `deliverable` is the count the POST can actually show: the number of labelled
 * shots in a reel, the number of drawbacks a verdict post quotes. A counted hook
 * whose number is not that number is the exact failure the 0.5% like rate is,
 * expressed as a line of code rather than as a lesson.
 *
 * `promisesList` from the clip writer is deliberately NOT applied here. It exists
 * because a held clip has one line and no second frame; this format's second frame
 * is the first item of the list.
 */
export function rejectHook(text, { maxWords, minWords, banned = [], deliverable = null, placeHe = null, places = [] } = {}) {
  const s = String(text || '').trim();
  if (!s) return 'empty';
  if (URL_LIKE.test(s)) return 'carries a URL';
  if (/[#@]/.test(s)) return 'carries a hashtag or handle';
  if (/\p{Extended_Pictographic}/u.test(s)) return 'carries an emoji';
  if (/[—–]/.test(s)) return 'carries an em or en dash';
  if (unfilled(s).length) return `has an unfilled slot ${unfilled(s).join(' ')}`;

  const words = s.split(/\s+/).length;
  if (words > maxWords) return `${words} words, over ${maxWords}`;
  if (words < minWords) return `${words} words, under ${minWords}`;

  const unfinished = trailsOff(s);
  if (unfinished) return unfinished;

  // THE BANNED LIST, MATCHED THROUGH THE FINAL LETTERS.
  //
  // Hebrew writes five letters differently at the end of a word, so "מטורף" and
  // "מטורפים" share no substring: the first ends in ף and the second has פ in the
  // middle. A plain includes() therefore catches the singular clickbait word and
  // misses every inflection of it, which is most of how it would actually be
  // written. Both sides are normalised to the medial forms before comparing.
  const plain = unfinal(s);
  for (const word of banned) {
    if (plain.includes(unfinal(word))) return `uses "${word}", which is on the banned list`;
  }

  // First or second person is allowed here where it is address rather than
  // presence, which is the distinction the clip writer's own note argues for:
  // "תטוסו לכאן" and "לטיול הבא שלכם" are spoken to the viewer from here. What
  // stays banned is the voice of somebody standing in the place.
  if (claimsPresence(s)) return 'claims to have been there - the footage is not ours';

  // THE DELIVERY CHECK, AND IT RUNS BEFORE THE LABEL CHECK FOR A REASON.
  //
  // A number at the head of the line is a promise of that many things, and the post
  // has to have that many. That is the failure the 0.5% like rate is.
  const counted = s.match(/^\s*(\d{1,2})\s/);
  if (counted && deliverable != null && Number(counted[1]) !== Number(deliverable)) {
    return `promises ${counted[1]} and the post has ${deliverable}`;
  }

  // `isLabel` IS NOT APPLIED TO A COUNTED LINE, and this is the second time this
  // project has had to write that kind of exemption down.
  //
  // The guard comes from the clip writer, where a line has to assert something
  // because there is no second frame to pay off a promise. Applied here it rejected
  // three lines the owner wrote himself: "3 יעדים לרשימה של השנה הבאה" and "3
  // מקומות לטיול הבא שלכם" are in post-config.json verbatim, and both are noun
  // phrases with no verb in them.
  //
  // They are not labels on this format. The count IS the assertion - it says there
  // are three of these and here they come - and the check above has already
  // confirmed the post has three. A guard that rejects a canonical line is a broken
  // guard, which src/video/hooks.js records twice about its own.
  //
  // An instruction is exempt for the same reason: "במקום סנטוריני, תטוסו לכאן" is
  // the brief's own comparison example and it asserts something by telling somebody
  // to do it. `isLabel` has no verb in its statement list, so it read the whole
  // category as captions.
  //
  // AND SO IS A CURIOSITY GAP, which is the third shape that makes a line a hook
  // here. "הטעות שישראלים עושים בסנטוריני" and "מה שלא כתוב בעמוד של סנטוריני" are
  // noun phrases with no verb and no number, and both promise something the post
  // then delivers. `isLabel` rejected both, partly because its own statement list is
  // anchored on word boundaries that Hebrew's glued prefixes do not produce - שלא
  // and שאתם are invisible to it.
  //
  // So the rule for this family of formats is stated positively: a hook here counts,
  // instructs, or opens a gap. A line that does none of those and that isLabel also
  // calls a label is a bare phrase promising nothing.
  if (!counted && !ADDRESS.test(s) && !GAP.test(s) && isLabel(s)) {
    return 'a label, not a statement - nothing is asserted';
  }

  // A COUNTRY IN THE LINE HAS TO BE TRUE OF EVERY SHOT, which is a stronger rule than
  // the clip writer's and it needs to be.
  //
  // That one takes a single `placeHe` and refuses any other country, because a held
  // clip is one shot in one place. A reel is three to five, and the honest reading of
  // "5 מקומות ביוון" over five shots is that all five are in Greece. The model does
  // get this right - it is handed the labels and it read them - and nothing was
  // checking: a written line naming one country over a reel of three would have been
  // published with the counter-evidence burned onto the shots underneath it.
  //
  // So: one country across the reel means it may be named and no other may be. More
  // than one means none may be, because a counted hook that names a country while
  // showing several is false however carefully it is worded.
  const countries = [...new Set((places || []).map((p) => String(p).split(', ').pop().trim()).filter(Boolean))];
  const only = countries.length === 1 ? countries[0] : null;
  if (only || placeHe) {
    const other = namesOtherCountry(s, only || placeHe);
    if (other) return `names ${other}, and this post is ${only || placeHe}`;
  } else if (countries.length > 1) {
    const named = namesOtherCountry(s, null);
    if (named) return `names ${named}, and this post is ${countries.join(' and ')}`;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* the score                                                                   */
/* -------------------------------------------------------------------------- */

// What makes a line SPECIFIC: a number, a named place, a unit somebody can check.
const HAS_NUMBER = /\d/;
const HAS_UNIT = /(שעות|שעה|ימים|יום|לילות|דקות|קילומטר|ק״מ|₪|שקל|יורו|דולר)/;

// What makes a line CURIOUS: it says something is being missed, or it withholds the
// subject so the only way to find out is to watch. Read off the posts that worked
// rather than invented - "לא חושבים עליהם מספיק" is the 6.1% line.
const GAP = /(לא חושבים|לא מכיר|לא מכירים|לא ידעתם|לא מספרים|לא כתוב|במקום|הטעות|לפני ש|עדיין לא|כמעט אף)/;
const WITHHOLDS = /(ככה|כזה|לכאן|הזה|האלה|וזה למה)/;

// A superlative with no measurement behind it. Penalised rather than banned: "הכי
// יפה" is a judgement this account is allowed to make about a place it has a page
// for, and is a claim about the world when it is about a continent.
//
// NARROWED to the two words that actually make a superlative. The first version
// also matched בעולם, באירופה and בכל, which is a SCOPE rather than a claim: "3
// מקומות באירופה שכמעט אף ישראלי לא מכיר" was scored to exactly 0 for the word
// "באירופה", which deletes a template rather than demoting it. Its dishonesty is
// the "אף ישראלי" half and that is already priced into its declared honesty.
const SUPERLATIVE = /(הכי|ביותר)/;

/**
 * One line, scored on the three things the brief asks for.
 *
 * HONESTY IS A MULTIPLIER, NOT A THIRD OF THE TOTAL, and that is the only
 * interesting decision in this function. A hook that cannot be paid off does not
 * become acceptable by being specific and intriguing: it becomes the 0.5% post,
 * which got more reach than anything else this account has published and almost no
 * likes. As a multiplier, honesty 0 is a score of 0 however well the line reads.
 *
 * The weight term is small and it is there so the owner's grading still moves the
 * ranking. With ten candidates drawn from a pool of eleven templates, nearly every
 * template gets offered on every post, so without this the weights in the file
 * would decide nothing at all.
 */
export function scoreHook(text, { template = null, vars = {}, maxWeight = 1 } = {}) {
  const s = String(text || '').trim();
  const why = [];

  let specificity = 0;
  if (HAS_NUMBER.test(s)) {
    specificity += 0.45;
    why.push('names a number');
  }
  // A place the POST established, not any proper noun: the point of the term is
  // that the viewer can check the claim, and a place we made up is not checkable.
  const named = [vars.dest, vars.alt, ...(Array.isArray(vars.placeList) ? vars.placeList : [])]
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .find((x) => s.includes(x));
  if (named) {
    specificity += 0.3;
    why.push(`names ${named}`);
  }
  if (HAS_UNIT.test(s)) {
    specificity += 0.25;
    why.push('carries a unit');
  }
  specificity = Math.min(1, specificity);

  let curiosity = 0;
  if (GAP.test(s)) {
    curiosity += 0.5;
    why.push('opens a gap');
  }
  if (!named) {
    curiosity += 0.2;
    why.push('withholds the subject');
  }
  if (/^\s*\d/.test(s)) {
    curiosity += 0.3;
    why.push('counted, which is an open loop');
  } else if (WITHHOLDS.test(s)) {
    curiosity += 0.3;
    why.push('points at something off screen');
  }
  curiosity = Math.min(1, curiosity);

  // The template's declared honesty is the starting point, because the reason a
  // shape is unsourceable is editorial rather than textual. A model-written line
  // with no template behind it starts at 1 and is judged only on what it says.
  let honesty = template ? template.honesty : 1;
  if (SUPERLATIVE.test(s) && !named) {
    honesty = Math.max(0, honesty - 0.3);
    why.push('superlative with nothing measured');
  }
  honesty = Math.max(0, Math.min(1, honesty));

  const weight = maxWeight > 0 ? Math.min(1, (template?.weight || 1) / maxWeight) : 0;
  const total = honesty * (0.45 * specificity + 0.35 * curiosity + 0.2 * weight);
  return { specificity, curiosity, honesty, weight, total, why };
}

/* -------------------------------------------------------------------------- */
/* the candidates                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The templates this post can fill, filled, heaviest category first.
 *
 * THE FLOOR AND THE FALLBACK IN ONE. Every line here is a sentence the owner wrote
 * into post-config.json with a number of ours in it, so this is what ships when
 * there is no API key, when the call fails, and when every written candidate is
 * rejected. The model's job is to add variations to this pool, never to replace it.
 */
export function templateCandidates({ format, vars = {}, rand = Math.random } = {}) {
  const offered = templatesFor(format).filter((t) => fillable(t, vars));
  // Shuffled within equal weight, so two posts on the same day with the same
  // numbers do not produce the same ordering and therefore the same tie break.
  return offered
    .map((t) => ({ t, k: rand() }))
    .sort((a, b) => b.t.categoryWeight * b.t.weight - a.t.categoryWeight * a.t.weight || a.k - b.k)
    .map(({ t }) => ({ text: stripDashes(fill(t.he, vars)), template: t, from: 'template' }));
}

const SYSTEM = `אתה כותב שורת פתיחה אחת לסרטון טיולים קצר בעברית, לקהל ישראלי.

זו לא כתיבה יצירתית. אתה ממלא תבניות מוכרות שעבדו, והתוכן חייב להיות פשוט.
כל ניסיון להוסיף הברקה משלך הורס את השורה.

השורה הכי טובה שהחשבון הזה פרסם, מילה במילה:
  "3 יעדים שאנשים לא חושבים עליהם מספיק"
היא עבדה כי היא לא מתפעלת מכלום, היא רק אומרת שמשהו לא מדובר מספיק, והסרטון
עצמו הוא ההוכחה. {COUNT} המקומות בסרטון הם מה שמקיים את ההבטחה.

שתי שורות שקיבלו הרבה צפיות ומעט לייקים:
  "לפני שאתם מזמינים לסנטוריני, שתי דקות"
  "נתנו לטוקיו 4.8, וזה למה"
הבעיה בהן לא הייתה השורה, אלא שהפוסט לא קיים את ההבטחה. לכן:

חוקים:
- עד {MAXWORDS} מילים. משפט שלם שנגמר. בלי "..." ובלי חצי משפט.
- אסור לסיים במילת חיבור או יחס: "של", "את", "עם", "ש", "ו", "כי", "ב", "ל".
- מספר בתחילת השורה הוא הבטחה. אם אתה פותח במספר, הוא חייב להיות {COUNT} בדיוק.
- אסור להבטיח משהו שהסרטון לא מראה: לא טעויות, לא סודות, לא מחירים, לא טיפים.
- בלי מילות קליקבייט: {BANNED}.
- בלי אימוג׳י, האשטג, קישור, שם מותג, קריאה לפעולה.
- בלי גוף ראשון ובלי לטעון שהיית שם. פנייה לצופה מותרת: "תטוסו", "שלכם".
- מדינה או מקום מותר לנקוב רק מהרשימה שתקבל. אל תנחש מקומות אחרים.
- בלי מקף ארוך. פסיק או מקף רגיל בלבד.

החזר JSON בלבד: {COUNTOUT} שורות, כל אחת עם מזהה הקטגוריה שהיא שייכת אליה.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    lines: {
      type: 'array',
      description: 'One line per requested category, same ids',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          category: { type: 'string', description: 'the id of the category this line belongs to' },
          text: { type: 'string', description: 'השורה, עברית, משפט שלם' },
        },
        required: ['category', 'text'],
      },
    },
  },
  required: ['lines'],
};

/**
 * Lines written for THIS post, in the register of the categories offered to it.
 *
 * Returns an array, empty on any failure. Every failure here is survivable because
 * `templateCandidates` is the floor, which is why nothing in this function throws
 * and why the error comes back as a logged line rather than as an exception.
 */
export async function writtenCandidates({ format, vars = {}, deliverable = null, want = 4 } = {}) {
  if (!hasApiKey()) return { lines: [], error: 'ANTHROPIC_API_KEY is not set' };
  const cfg = postConfig().gems.hooks;
  const offered = templatesFor(format).filter((t) => fillable(t, vars));
  if (!offered.length) return { lines: [], error: 'no template fits this post' };

  // The categories, each with the examples that are already known to work. The
  // model is shown the filled templates rather than the raw ones, so it writes in
  // the register of a real sentence about this post rather than of a pattern.
  const byCategory = new Map();
  for (const t of offered) {
    if (!byCategory.has(t.category)) byCategory.set(t.category, { he: t.categoryHe, examples: [] });
    byCategory.get(t.category).examples.push(fill(t.he, vars));
  }

  const places = Array.isArray(vars.placeList) ? vars.placeList : [];
  const user = [
    `הסרטון: ${deliverable ?? places.length} מקומות, כל אחד בשוט נפרד עם השם שלו על המסך.`,
    places.length ? `המקומות, בסדר הזה: ${places.join(' · ')}` : null,
    vars.alt ? `יעד להשוות אליו, מותר לנקוב: ${vars.alt}` : null,
    vars.hours ? `זמן טיסה מישראל, מתוך העמוד שלנו: ${vars.hours} שעות` : null,
    '',
    `החזר ${want} שורות. מותר יותר מאחת מאותה קטגוריה.`,
    '',
    'הקטגוריות והדוגמאות:',
    ...[...byCategory.entries()].map(([id, c]) =>
      `- ${id} (${c.he}): בסגנון של ${c.examples.slice(0, 2).map((e) => `"${e}"`).join(' · ')}`
    ),
    '',
    // THE ONE INSTRUCTION THE FIRST VERSION WAS MISSING, and without it the model is
    // right to do what it did: it was shown the filled templates as the standard and
    // told to add no ideas of its own, so it returned the templates verbatim. The
    // dedupe then dropped its lines in favour of the owner's copies, and the pool
    // that was supposed to hold ten candidates held six.
    //
    // What is wanted is a different WORDING of the same shape, not a different idea.
    'אל תחזור על הדוגמאות מילה במילה. כתוב ניסוח אחר של אותה תבנית: אותו סוג הבטחה,',
    'מילים אחרות. אם אין לך ניסוח אחר שעומד בחוקים, החזר פחות שורות.',
  ]
    .filter((x) => x != null)
    .join('\n');

  const system = SYSTEM.replace(/\{MAXWORDS\}/g, String(cfg.maxWords))
    .replace(/\{COUNT\}/g, String(deliverable ?? places.length))
    .replace(/\{COUNTOUT\}/g, String(Math.max(1, want)))
    .replace(/\{BANNED\}/g, cfg.banned.join(', '));

  try {
    const res = await getClient().messages.create({
      model: MODEL,
      max_tokens: 1500,
      output_config: { effort: EFFORT, format: { type: 'json_schema', schema: SCHEMA } },
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: user }],
    });
    recordUsage(res.usage, MODEL);
    if (res.stop_reason === 'refusal') return { lines: [], error: 'hook writing refused' };
    const raw = res.content.find((b) => b.type === 'text')?.text;
    if (!raw) return { lines: [], error: 'hook writing returned no text' };

    const byId = new Map(offered.map((t) => [t.category, t]));
    return {
      lines: (JSON.parse(raw).lines || [])
        .map((l) => ({
          text: stripDashes(String(l?.text || '').trim()),
          // The model's line is attributed to the category it filled, and it
          // inherits that category's heaviest template for the weight term only.
          // Its honesty is NOT inherited: a written line is judged on what it says.
          template: byId.has(String(l?.category)) ? { ...byId.get(String(l.category)), honesty: 1 } : null,
          category: String(l?.category || '') || null,
          from: 'written',
        }))
        .filter((l) => l.text),
      error: null,
    };
  } catch (e) {
    return { lines: [], error: `hook writing failed: ${e.message}` };
  }
}

/**
 * The hook for one post: ten candidates, scored, the best used and the rest logged.
 *
 * `deliverable` is what the post can actually show and it is the one argument that
 * must not be guessed. `vars` is what the templates may be filled from.
 *
 * Never throws and never returns without a line when any template fits. The hook is
 * the whole first second of the post, so a failure here has to degrade to a weaker
 * line rather than to no post.
 */
export async function writeGemHook({
  format,
  vars = {},
  deliverable = null,
  used = new Set(),
  // WHICH TEMPLATES THE LAST FEW POSTS USED, refused before anything is scored.
  //
  // THE SCORER IS DETERMINISTIC AND THAT IS THE PROBLEM IT CREATES. It ranks ten
  // candidates and ships the best, so the best line wins every single time it is
  // offered: four reels built in one dry run all opened on "N יעדים שאנשים לא חושבים
  // עליהם מספיק", which is the right line and the wrong feed. A pool is a template
  // with extra steps, which src/video/hooks.js says in its first paragraph.
  //
  // Keyed on the template id rather than on the text, because the text carries the
  // shot count and "5 יעדים ש..." and "3 יעדים ש..." are one line twice.
  //
  // Excluded BEFORE the scoring and with a fallback to the full pool, the same two
  // rules drawWeighted follows: a post-scoring filter would let the favourite take
  // the top two places and the exclusion would only move which of them ships.
  avoid = [],
  write = true,
  rand = Math.random,
} = {}) {
  const cfg = postConfig().gems.hooks;
  const placeHe = vars.countryHe || null;

  const templated = templateCandidates({ format, vars, rand });
  const maxWeight = Math.max(1, ...templated.map((c) => c.template?.weight || 1));

  let written = { lines: [], error: null };
  if (write && cfg.on) {
    written = await writtenCandidates({
      format,
      vars,
      deliverable,
      // ENOUGH TO FILL THE POOL TO `candidates`, which the brief puts at ten. The
      // templates supply six on a reel, so the model is asked for the remaining four
      // rather than for a fixed fraction: a format with fewer templates gets more
      // written lines, which is the direction that keeps the pool the same size.
      want: Math.max(1, cfg.candidates - templated.length),
    });
  }

  // DEDUPLICATED BY TEXT, HIGHEST SCORE KEPT, and the first run needed it: the model
  // filled the overlooked category with the exact sentence the template had already
  // produced, so the approval card listed the chosen hook again as its own runner up
  // with a lower score. The scores differed because a written line inherits only the
  // category's weight, not the template's, which is correct and makes the duplicate
  // look like a worse alternative to itself.
  //
  // The written copy is dropped rather than the template one, because a line that is
  // already in post-config.json is a line the owner wrote.
  const byText = new Map();
  for (const cand of [...templated, ...written.lines]) {
    if (!byText.has(cand.text)) byText.set(cand.text, cand);
  }
  // The written lines go first in the pool so they survive the candidate cap, which
  // is the only reason to call the model at all: a pool that is all templates is what
  // `--no-hook` already produces.
  const all = [...byText.values()].sort(
    (a, b) => (a.from === 'written' ? -1 : 0) - (b.from === 'written' ? -1 : 0)
  );

  // The exclusion, with the fallback. A written line has no template id and is never
  // excluded by this: it is a line nothing has used yet by construction.
  const stale = (c) => c.template?.id && avoid.includes(c.template.id);
  const fresh = all.filter((c) => !stale(c));
  const pool = (fresh.length ? fresh : all).slice(0, cfg.candidates);

  const scored = [];
  const rejected = [];
  for (const cand of all.filter((c) => stale(c) && pool.length && fresh.length)) {
    rejected.push({ ...cand, why: `${cand.template.id} was the last reel's hook` });
  }
  for (const cand of pool) {
    const why = rejectHook(cand.text, {
      maxWords: cfg.maxWords,
      minWords: cfg.minWords,
      banned: cfg.banned,
      deliverable,
      placeHe,
      // The labels the reel actually burns on, so a country in the line can be
      // checked against every one of them rather than against nothing.
      places: Array.isArray(vars.placeList) ? vars.placeList : [],
    });
    if (why) {
      rejected.push({ ...cand, why });
      continue;
    }
    if (used.has(cand.text)) {
      rejected.push({ ...cand, why: 'already used' });
      continue;
    }
    scored.push({ ...cand, score: scoreHook(cand.text, { template: cand.template, vars, maxWeight }) });
  }

  scored.sort((a, b) => b.score.total - a.score.total);
  const best = scored[0] || null;

  return {
    text: best?.text || null,
    category: best?.template?.category || best?.category || null,
    templateId: best?.template?.id || null,
    from: best?.from || null,
    score: best?.score || null,
    // EVERY CANDIDATE, KEPT. The brief asks for the rest to be logged, and the
    // approval card prints them: a hook nobody can see the alternatives to is a
    // hook nobody can judge. The rejected ones carry their reason, which is the
    // half that tells you whether the guards are too tight.
    considered: scored.map((c) => ({ text: c.text, from: c.from, category: c.template?.category || c.category, total: c.score.total, why: c.score.why })),
    rejected: rejected.map((c) => ({ text: c.text, from: c.from, why: c.why })),
    error: best ? null : written.error || 'every candidate was rejected',
  };
}

/**
 * Is `cheap` actually cheaper than `dear`, from the two pages' own figures?
 *
 * THE GATE ON THE ONE PRICE TEMPLATE. clips.hooks bans the price comparison shape
 * outright, written after it failed there, and the ban is right for a line nobody
 * can source. This is the version that can be: both pages publish a `dailyCost`
 * with a currency, and the claim is only offered when they share a currency and the
 * gap is large enough to be worth saying.
 *
 * SAME CURRENCY ONLY, and that is not a shortcut. src/plan/site.js refuses to invent
 * an exchange rate, because nobody published one, and "cheaper" computed across two
 * currencies at a rate this program made up is exactly the invented number that rule
 * exists to stop.
 */
export function cheaperThan(cheap, dear, { margin = 0.2 } = {}) {
  // THROUGH dailyCostOf, NOT Number(mid). The first version of this read the figure
  // the way costLine used to, and costLine turned out to have been returning null for
  // every destination in the catalogue for the same reason: the site publishes `mid`
  // as an object split by line item on 21 pages and `midRange` as a pair on 20, and
  // Number() of either is NaN. So the gate on the one price claim in the hook pool
  // would have refused every comparison that was actually true.
  const a = dailyCostOf(cheap);
  const b = dailyCostOf(dear);
  if (!a || !b || a.currency !== b.currency) return false;
  return a.amount <= b.amount * (1 - margin);
}
