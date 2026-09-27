import Anthropic from '@anthropic-ai/sdk';
import { record as recordUsage } from '../usage.js';
import { modelFor } from '../models.js';
import { postConfig } from '../postConfig.js';
import { stripDashes } from '../dashes.js';
import { URL_LIKE } from '../urlLike.js';
import { hasPerson, trailsOff } from './hooks.js';
import { clipPlaceLabel, clipSiteName } from '../hashtags.js';

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

// Editorial, through the role dial rather than pinned here. This file wrote
// `ANTHROPIC_MODEL || 'claude-opus-5'` directly, which is what modelFor exists
// to replace: the same string in four files is four places to edit when the
// split is retuned, and MODEL_EDITORIAL silently did not reach any of them.
// The resolved model is unchanged - modelFor('editorial') is opus and honours
// ANTHROPIC_MODEL exactly as before.
const MODEL = modelFor('editorial');
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

ושורה שימושית היא לא בהכרח שורה שמעניינת. "4 מקומות באירופה שחייבים לראות"
נכונה, ברורה, ומי שקורא אותה כבר יודע מה יבוא אחריה - ולכן אין סיבה להישאר.
שורה עובדת נוגעת בהרגשה, ויש שלוש שעובדות כאן:

- הפתעה: השורה סותרת את התמונה שיש לצופה בראש. "4 מקומות ביוון שלא נראים כמו
  יוון". מותר רק כשזה נכון לפריימים - זו טענה על איך זה נראה, והחתך מוכיח אותה.
- גילוי: "4 מקומות שאף אחד לא מדבר עליהם". זו דעה, אי אפשר להפריך אותה, ולכן
  היא כן מותרת - בניגוד לכל טענה על מחיר, עונה או כמה תיירים יש שם.
- משהו אישי: מותר רק בתור תגובה, לא בתור עדות. הצילום הוא סטוק ואף אחד מאיתנו
  לא היה שם, אז "הייתי" ו"ראיתי" אסורים, כאן ובכל מקום אחר.

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
- עד {MAXWORDS} מילים, וכמה שפחות. היא נקראת בשנייה אחת על מסך טלפון, לפני
  שהצופה החליט אם להישאר. שורה ארוכה נגמרת אחרי שהוא כבר גלל.
- בלי שבחים כלליים: לא "מדהימים", לא "מרהיבים", לא "עוצרי נשימה", לא "חלומיים".
  זה מה שכל חשבון טיולים כותב וזה לא אומר כלום. התכונה חייבת להיות משהו שרואים
  בפריים ושאפשר לחלוק עליו - אין בהם אף אחד, נראים מצוירים, המים בצבע הזה.
- עברית פשוטה, כמו שמדברים. בלי קופירייטינג ובלי מטאפורות.

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

/** The specific place in one shot, or null when only its country is known. */
export const cutSite = (clip) => clipSiteName(clip?.vision || null);

/**
 * Choose the shots for one cut video, in the order they will play.
 *
 * Three rules, and the last two are what make this a post rather than a reel of
 * stock:
 *
 *   1. Every shot must be nameable. See cutLabel.
 *   2. THE NAME MUST BE A SPECIFIC PLACE, not a country. `clipPlaceLabel` falls
 *      back to the bare country when the judge could not name the site, which is
 *      correct for the pin under a post and wrong burned onto a cut: a list of
 *      countries is a geography lesson, and the owner's note on the first cuts
 *      video was exactly this — "places should be specific, not a whole
 *      country". Off via clips.cuts.labelNeedsSite for a day when nothing else
 *      will build.
 *   3. No two shots may carry the same place. Four cuts of four different
 *      corners of Switzerland all labelled "שווייץ" is a hook promising four
 *      places over one place, which is the count guard's failure arriving by a
 *      route the count guard cannot see: the number matches and the post is
 *      still a lie.
 *
 * Rule 3 is checked on the SITE rather than on the whole label, which is what
 * lets a video be four places in one country. That is not a relaxation, it is
 * the point: deduplicating the label meant "שווייץ" collided with itself, so
 * every cut had to come from a different country, so `oneCountry` never found
 * one, so the hook was never allowed to name it. Four named Swiss valleys under
 * "4 מקומות בשווייץ" is a better post than four countries under "4 מקומות שלא
 * נראים אמיתיים", and it was unreachable by construction.
 *
 * Best-ranked first, because `findClips` has already sorted by what the vision
 * judge thought of each frame and there is no second opinion worth having here.
 */
export function pickCuts(clips, cfg = postConfig().clips.cuts) {
  const { cutsMin, cutsMax, labelNeedsSite } = cfg;
  const taken = new Set();
  const out = [];
  for (const c of clips) {
    if (out.length >= cutsMax) break;
    const label = cutLabel(c);
    if (!label) continue;
    const site = cutSite(c);
    if (labelNeedsSite !== false && !site) continue;
    // The site when there is one, so two shots of the same valley collide even
    // if one of them resolved a country the other did not.
    const key = site || label;
    if (taken.has(key)) continue;
    taken.add(key);
    out.push({ ...c, label, site: site || null });
  }
  return out.length >= cutsMin ? out : [];
}

/**
 * Choose the shots for one MONTAGE, which is the opposite selection to pickCuts.
 *
 * A cuts video is a LIST: several places, a name burned on each, and the hook
 * counting them. Its hard rule is that no two shots may be the same place,
 * because a list that repeats an entry is a miscount a viewer can see.
 *
 * A montage is one PLACE seen many ways: eight or ten shots at a second and a
 * half, one line held over all of them, no labels. So every rule pickCuts has
 * about distinctness inverts. Two shots of the same valley are not a collision
 * here, they are the point, and the selection is not "find me different places"
 * but "find me the place I have the most footage of".
 *
 * GROUPED BY SITE, FALLING BACK TO COUNTRY, and the fallback is doing real work
 * rather than being a courtesy. The vision judge names a specific site on a
 * minority of candidates - that scarcity is what makes a cuts video hard to
 * assemble and is written down in cutsReason. A montage does not need the name
 * burned onto anything: one line names the place once, so "eight shots the
 * judge agreed are in Iceland" is a perfectly good montage where it would be a
 * geography lesson as a cuts video.
 *
 * The site group still wins when it is big enough, because "eight shots of
 * Lauterbrunnen" is a stronger post than "eight shots of Switzerland" and the
 * line can then be about somewhere specific.
 *
 * Returns `{ cuts, place, site }` rather than a bare list: the caller has to
 * tell the hook writer WHICH place this is about, and re-deriving it by reading
 * the shots back is how the line and the footage drift apart.
 */
export function pickMontage(clips, cfg = postConfig().clips.montage) {
  const { cutsMin, cutsMax } = cfg;

  // GROUPED BY THE SEARCH QUERY, NOT BY THE JUDGE'S PER-SHOT VERDICT, and that
  // is the correction that made this shape buildable at all.
  //
  // The first version required every shot to be individually placed, inherited
  // straight from pickCuts. It never assembled once. Measured, on a live run
  // narrowed to a single destination: "meteora greece" returned eleven usable
  // shots and the judge placed THREE of them. That is not a fault - the place
  // fields are gated behind placeMinConfidence precisely so a name only gets
  // printed when the judge is sure, and most frames of a cliff are not
  // identifiable as any particular cliff.
  //
  // But a cuts video BURNS a name onto every shot, and a montage burns none.
  // What it needs is that the shots be the same place, and the strongest
  // evidence of that is not eleven separate recognitions of a rock face: it is
  // that all eleven came back from one search for that place. The judge's own
  // prompt says as much - the search phrase "usually names the place already"
  // and its job is confirming rather than recognising.
  //
  // So the query groups the shots, the judge still vetoes them one by one
  // (destination score, a person in frame, a contradicted country - all applied
  // before these ever reach here), and the NAME comes from whichever shots the
  // judge did place. Three independent confirmations plus the query is a better
  // sourced claim than this pipeline requires anywhere else.
  const byQuery = new Map();
  for (const c of clips) {
    const key = c.query || '';
    if (!byQuery.has(key)) byQuery.set(key, []);
    byQuery.get(key).push(c);
  }
  const biggest = [...byQuery.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (!biggest || biggest[1].length < cutsMin) return { cuts: [], place: null, site: null };

  const group = biggest[1].slice(0, cutsMax);

  // What the group may be CALLED, from the shots the judge was sure about. A
  // majority rather than the first one: a search for Meteora that returned one
  // frame the judge read as Italy should not name the post Italy.
  const tally = (of) => {
    const counts = new Map();
    for (const c of group) {
      const v = of(c);
      if (v) counts.set(v, (counts.get(v) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || null;
  };

  const country = tally((c) => (cutLabel(c) ? String(cutLabel(c)).split(',').pop().trim() : null));
  // A site is named only when MORE THAN ONE shot agreed on it. One recognition
  // out of twelve is a guess, and unlike the country it would put a specific
  // valley's name on footage from all over a region.
  const site = tally((c) => cutSite(c));
  const namedSite = site && site[1] > 1 ? site[0] : null;

  // ONE SHOT REPRESENTS THE GROUP, and it is returned whole rather than
  // assembled.
  //
  // The first version built a synthetic verdict: the tallied site written into
  // `vision.site`, the lead shot's spelling left in `vision.siteHe`. Those two
  // fields are an English name and its Hebrew transliteration, and crossing
  // them put TWO DIFFERENT PLACES on one post - the approval card read "גשר
  // קרל, צ׳כיה" off one field while the published caption read "קתדרלת סנט
  // ויטוס, צ׳כיה" off the other, on the same Prague montage.
  //
  // So nothing is assembled. The representative is a real shot whose reading
  // won the tally, its `vision` travels intact, and every existing reader -
  // clipPlaceLabel for the pin, clipSiteName for the spelling,
  // clipDestinationTag for the hashtag - works on it unchanged. The only edit
  // is blanking the site when the group did not agree on one, which is the same
  // edit buildCutClip already makes for the same reason.
  const rep =
    (namedSite ? group.find((c) => cutSite(c) === namedSite) : null) ||
    (country ? group.find((c) => cutLabel(c) && String(cutLabel(c)).split(',').pop().trim() === country[0]) : null) ||
    null;

  return {
    cuts: group,
    // The candidate's `clip.vision`, ready to use. Null when the judge placed
    // nothing in the group, which downstream already handles: no pin, and the
    // country hashtag slot falls back to the niche pool.
    vision: rep ? (namedSite ? rep.vision : { ...rep.vision, site: '', siteHe: '' }) : null,
    site: namedSite,
    // How much of the group the judge actually placed, so the caller can say so
    // on the approval card. A montage named from two shots out of twelve is
    // weaker evidence than one named from ten, and only this function knows.
    placed: country ? country[1] : 0,
  };
}

/**
 * Why a montage could not be built from these shots.
 *
 * Different numbers from cutsReason and deliberately so: this shape fails for
 * the opposite reason. A cuts video fails when the shots are all the same
 * place; a montage fails when they are all DIFFERENT places, which is a search
 * spread across twenty-six queries doing exactly what it was asked to do.
 */
export function montageReason(clips, cfg = postConfig().clips.montage) {
  const counts = new Map();
  for (const c of clips) counts.set(c.query || '?', (counts.get(c.query || '?') || 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return (
    `need ${cfg.cutsMin} usable shots from one search - ` +
    `${clips.length} survived the judge, ` +
    `the best-covered query is ${best ? `"${best[0]}" with ${best[1]}` : 'none'}` +
    // The fix, named, because it is a one-line config change and the message is
    // where somebody will be standing when they need to know it.
    `. Raise clips.search.visionMaxCandidates or lower montage.cutsMin.`
  );
}

/**
 * Why a cuts clip could not be built from these shots.
 *
 * Three numbers, because they are three different fixes. Nothing judged at all
 * is a search problem; placed but unsited is `placeMinConfidence` or a query
 * pointed at generic scenery; enough sites but too few DISTINCT ones is a batch
 * that found the same valley four times. "found 3" said none of that.
 */
export function cutsReason(clips, cfg = postConfig().clips.cuts) {
  const placed = clips.filter((c) => cutLabel(c));
  const sited = placed.filter((c) => cutSite(c));
  const distinct = new Set(sited.map((c) => cutSite(c))).size;
  return (
    `need ${cfg.cutsMin} shots with different specific places - ` +
    `${clips.length} available, ${placed.length} placed, ${sited.length} with a named site, ${distinct} distinct`
  );
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

// Generic praise, which is the register the owner called "not that good" on the
// first cuts video. Matched on the STEM so every inflection is covered, and kept
// as a guard rather than left to the prompt for the reason every other rule here
// is: the prompt is a request, and this one is asked of a model whose training
// data is full of exactly these words.
//
// It is a small list on purpose. The failure is not the adjectives, it is a line
// that says nothing about the footage - and a long denylist starts rejecting
// lines that happen to contain a word rather than lines that are empty.
const BLAND = /מדהים|מרהיב|עוצר[יית]? ?נשימה|חלומי|מושל[םמ]|גן עדן/;

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
  const bland = s.match(BLAND);
  if (bland) return `generic praise ("${bland[0]}") - the trait has to be visible in the frame`;
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
  // A format built around the country name is unfillable on a mixed cut: the
  // user turn tells the writer not to name a country at all, so offering it
  // there spends a candidate on a line that cannot be written. The same rule
  // `needsPlace` applies to the held clip's formats, for the same reason.
  const pool = country ? cfg.hookFormats : cfg.hookFormats.filter((f) => !f.needsCountry);
  const formats = pickFormats(pool, cuts.map((c) => c.id).join('|'), candidates);
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
