import Anthropic from '@anthropic-ai/sdk';
import { record as recordUsage } from '../usage.js';
import { postConfig } from '../postConfig.js';
import { stripDashes } from '../dashes.js';
import { URL_LIKE } from '../urlLike.js';
import { hasPerson, trailsOff } from './hooks.js';
import { clipPlaceLabel } from '../hashtags.js';

// The second clip shape: several shots, cut, a line on each.
//
// THIS IS THE POST TYPE video/hooks.js PARKED AND BRIEF.md PROMISED.
//
// The beats were built once, guarded, and reverted on sight. The note at the top
// of hooks.js is precise about why, and the reason was never the writing: under
// four changing lines sat ONE stock shot that never cut, so the picture stopped
// being what the line answered and became wallpaper for a caption rewriting
// itself. A slideshow with a video background.
//
// The conclusion recorded there is the one this file acts on: the beats "belong
// to a post type where every line change is a CUT, with new footage under each
// one". So here every line change is a cut, and the held single-shot clip is
// untouched beside it, two shapes, neither replacing the other.
//
// WHAT A BEAT SAYS, AND THE ONE THING THIS DOES NOT BRING BACK.
//
// The parked formats were ADVICE: "3 טעויות שישראלים עושים בגאורגיה", "5 ימים
// ברומא ב-2,000 ₪". Every beat under those is a fact no page published, a price
// nobody quoted, a mistake nobody reported. BRIEF.md counted that cost once for
// the fare ban and counted it honestly. Paying it four more times per video, on
// a format that runs unattended on a timer, is a different and worse bargain
// than the one the owner agreed to.
//
// So a beat here is a LABEL: the place in that shot. It is the one thing about a
// stock clip this pipeline genuinely establishes, the vision judge names it, the
// pin under every clip already prints it, and the country hashtag is generated
// from it. A beat is the same fact a deck slide carries, sourced by exactly the
// mechanism that sources those, and `clipPlaceLabel` is literally the function
// the pin uses so the two can never disagree.
//
// Which leaves the HOOK as the only written line in the video, and therefore the
// only one that can be wrong. It names a count and a theme, and
// `beatCountMismatch` is what stops it promising five places over four cuts -
// the broken promise that cost the beats their first outing, and the one rule
// here that cannot be waived.

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5';
const EFFORT = process.env.CUTS_EFFORT || process.env.HOOKS_EFFORT || 'low';

let client = null;
const getClient = () => (client ??= new Anthropic());
export const hasApiKey = () => Boolean(process.env.ANTHROPIC_API_KEY);

/**
 * Does the hook's own number match how many cuts arrived?
 *
 * Recovered from git (97ec1c1) unchanged in spirit, because it is the guard the
 * whole format rests on. "5 מקומות" over four cuts is a post that breaks its
 * promise in the last two seconds, and a viewer who counted is a viewer who
 * scrolls past the next one. That is worse than a dull hook, which is the
 * lesson BRIEF.md drew from the first seven videos.
 *
 * Only fires when the hook OPENS on a digit, which is what a count looks like.
 * A number later in the line is doing something else, and reading every digit
 * as a count is the false positive that made `promisesList` an allowlist.
 *
 * Returns the reason, or null when they agree.
 */
export function beatCountMismatch(hook, beats) {
  const m = String(hook || '').trim().match(/^(\d{1,2})\s+([א-ת]+)/);
  if (!m) return null;
  const want = Number(m[1]);
  return beats.length === want ? null : `hook promises ${want} ${m[2]}, ${beats.length} cut(s) arrived`;
}

// Written for a video with a specific shape, so the prompt describes the shape
// rather than the mood. The single-line writer's system prompt teaches a meme
// register and nothing about structure, because a held clip has none; here the
// structure IS the post, and the one thing the model must not do is write the
// beats, those are read off the footage and handed to it as a fact.
const SYSTEM = `אתה כותב שורת פתיחה אחת לסרטון טיקטוק אנכי בעברית, לקהל ישראלי צעיר.

מבנה הסרטון, וזה לא ניתן לשינוי:
- {CUTS} קטעי וידאו קצרים, חתך בין כל אחד.
- על כל קטע מודפס שם המקום שבו הוא צולם. השמות האלה כבר נקבעו ואתה מקבל אותם.
- השורה שאתה כותב מודפסת על הקטע הראשון והיא הפתיחה של הפוסט.

השורה שלך עושה דבר אחד: אומרת כמה מקומות באים ומה המשותף להם.

חוקים שאין עליהם ויתור:
- אם יש בשורה מספר בהתחלה, הוא חייב להיות בדיוק {CUTS}. לא יותר ולא פחות.
  הצופה סופר. הבטחה של חמישה מקומות על ארבעה חתכים היא פוסט שנשבר בשנייה
  האחרונה, וזה גרוע יותר משורה משעממת.
- אל תכתוב את שמות המקומות. הם כבר על המסך, בקטעים עצמם.
- אל תטען שום דבר שלא רואים בפריים: לא מחיר, לא עונה, לא ויזה, לא שעות טיסה,
  לא "בלי תיירים". אתה לא יודע את זה ואף עמוד לא פרסם את זה.
- בלי אימוג׳י, האשטג, קריאה לפעולה, שם מותג, קישור.
- בלי גוף ראשון או שני: לא "אני", לא "הייתי", לא "שלי". הצילום הוא סטוק,
  אף אחד מאיתנו לא היה שם.
- השורה נגמרת. משפט שלם, בלי "..." ובלי להיעצר על מילת חיבור.
- עד {MAXWORDS} מילים. עברית פשוטה, בלי קופירייטינג ובלי מטאפורות.

החזר JSON בלבד: שורה אחת לכל תבנית שקיבלת.`;

const systemFor = (cuts, maxWords) =>
  SYSTEM.replace(/\{CUTS\}/g, String(cuts)).replace('{MAXWORDS}', String(maxWords));

// additionalProperties: false on every object is REQUIRED by the structured
// output API, the same 400 the single-line writer's schema note records.
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    lines: {
      type: 'array',
      description: 'One filled opening line per requested format, same order',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          format: { type: 'string', description: 'the id of the format this line fills' },
          text: { type: 'string', description: 'שורת הפתיחה, עברית, נאמנה לתבנית' },
        },
        required: ['format', 'text'],
      },
    },
  },
  required: ['lines'],
};

/**
 * The place label burned onto one cut, or null when the judge could not name it.
 *
 * Null is a hard exclusion rather than a fallback: a cut with no label is a
 * shot of scenery in the middle of a list of places, and the viewer counting
 * against the hook's number will not count it.
 */
export const cutLabel = (clip) => clipPlaceLabel({ clip });

/**
 * Choose the shots for one cut video, in the order they will play.
 *
 * Two rules, and the second is the one that makes this a post rather than a
 * reel of stock:
 *
 *   1. Every shot must be nameable. See cutLabel.
 *   2. No two shots may carry the SAME label. Four cuts of four different
 *      corners of Switzerland all labelled "שווייץ" is a hook promising four
 *      places over one place, which is the count guard's failure arriving by a
 *      route the count guard cannot see, the number matches and the post is
 *      still a lie.
 *
 * Best-ranked first, because `findClips` has already sorted by what the vision
 * judge thought of each frame and there is no second opinion worth having here.
 */
export function pickCuts(clips, { cutsMin, cutsMax } = postConfig().clips.cuts) {
  const taken = new Set();
  const out = [];
  for (const c of clips) {
    if (out.length >= cutsMax) break;
    const label = cutLabel(c);
    if (!label || taken.has(label)) continue;
    taken.add(label);
    out.push({ ...c, label });
  }
  return out.length >= cutsMin ? out : [];
}

/**
 * Is every shot in the same country?
 *
 * Only then may the hook name one. A list drawn from four countries captioned
 * "4 מקומות בשווייץ" is the same broken promise as a miscount, and the writer
 * has no way to know which case it is in unless it is told.
 */
export function oneCountry(cuts) {
  const countries = new Set(cuts.map((c) => String(c.label).split(',').pop().trim()));
  return countries.size === 1 ? [...countries][0] : null;
}

/** Ranked formats, heaviest first, the same weighting the single-line writer uses. */
function pickFormats(all, seed, n) {
  if (!all.length) return [];
  const expanded = all.flatMap((f) => Array(f.weight || 1).fill(f));
  let h = 0;
  for (const ch of String(seed || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const out = [];
  for (let i = 0; i < expanded.length && out.length < Math.min(n, all.length); i++) {
    const f = expanded[(h + i * 7) % expanded.length];
    if (!out.includes(f)) out.push(f);
  }
  return out.sort((a, b) => (b.weight || 1) - (a.weight || 1));
}

/** Everything that disqualifies an opening line, in the order it is cheapest to check. */
function reject(text, { cuts, maxWords, minWords }) {
  const s = String(text || '').trim();
  if (!s) return 'empty';
  if (URL_LIKE.test(s)) return 'carries a URL';
  if (/[#@]/.test(s)) return 'carries a hashtag or handle';
  if (/\p{Extended_Pictographic}/u.test(s)) return 'carries an emoji';
  const words = s.split(/\s+/).length;
  if (words > maxWords) return `${words} words, over ${maxWords}`;
  if (words < minWords) return `${words} words, under ${minWords}`;
  const unfinished = trailsOff(s);
  if (unfinished) return unfinished;
  if (hasPerson(s)) return 'first or second person - the footage is not ours';
  const miscount = beatCountMismatch(s, cuts);
  if (miscount) return miscount;
  return null;
}

/**
 * The opening line for one cut video.
 *
 * `cuts` is the chosen shots, already labelled, because the count and whether
 * they share a country are both inputs to the writing rather than things to
 * check afterwards. Asking for several candidates and taking the first usable
 * one is the same bargain the single-line writer makes: the guards reject
 * roughly one in five, and a second call costs what asking for three up front
 * does.
 */
export async function writeCutsHook(cuts, { candidates = 3, used = new Set() } = {}) {
  const cfg = postConfig().clips.cuts;
  const maxWords = cfg.hookMaxWords;

  if (!hasApiKey()) return { text: null, error: 'ANTHROPIC_API_KEY is not set', rejected: [] };

  const country = oneCountry(cuts);
  const formats = pickFormats(cfg.hookFormats, cuts.map((c) => c.id).join('|'), candidates);
  if (!formats.length) return { text: null, error: 'no cut hook formats configured', rejected: [] };

  const user = [
    `בסרטון ${cuts.length} קטעים. אלה השמות שמודפסים עליהם, בסדר:`,
    ...cuts.map((c, i) => `  ${i + 1}. ${c.label}`),
    '',
    country
      ? `כל הקטעים באותה מדינה: ${country}. מותר לך לנקוב בשם המדינה הזו, ובה בלבד.`
      : 'הקטעים בכמה מדינות שונות. אל תנקוב בשם מדינה בכלל.',
    '',
    'התבניות למלא, שורה אחת לכל אחת:',
    ...formats.map((f) => `- ${f.id} (${f.he}): ${f.desc}`),
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
    system: [
      { type: 'text', text: systemFor(cuts.length, maxWords), cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: user }],
  });

  recordUsage(res.usage, MODEL);
  if (res.stop_reason === 'refusal') return { text: null, error: 'cut hook writing refused', rejected: [] };

  const raw = res.content.find((b) => b.type === 'text')?.text;
  if (!raw) return { text: null, error: 'cut hook writing returned no text', rejected: [] };

  const weightOf = new Map(formats.map((f) => [f.id, f.weight || 1]));
  const minWordsBy = new Map(formats.map((f) => [f.id, f.minWords]));
  const lines = (JSON.parse(raw).lines || [])
    .map((l) => ({ format: String(l.format || ''), text: stripDashes(l.text) }))
    .sort((a, b) => (weightOf.get(b.format) || 1) - (weightOf.get(a.format) || 1));

  const rejected = [];
  for (const { format, text } of lines) {
    const why = reject(text, { cuts, maxWords, minWords: minWordsBy.get(format) ?? 3 });
    if (why) {
      rejected.push(`${text} - ${why}`);
      continue;
    }
    if (used.has(text)) {
      rejected.push(`${text} - already used in this batch`);
      continue;
    }
    return {
      text,
      format,
      country,
      rejected,
      alternatives: lines.filter((l) => l.text !== text).map((l) => `[${l.format}] ${l.text}`),
    };
  }

  return { text: null, error: 'every candidate was rejected', rejected };
}
