// The planner's voice, and the three things it is not allowed to be.
//
// THE PROBLEM THIS FILE EXISTS TO SOLVE.
//
// The posts that work are personal. Every one of the six viral references is
// somebody's own photographs with their own opinions on them: "לא משעמם שם?",
// "תפסיקו לטוס רק לרודוס", a restaurant where a toy train brings the drinks. The
// flops are generic facts on designed posters.
//
// And a program cannot be personal, because it has not been anywhere. The
// temptation - the single most likely way this whole change goes wrong - is to
// close that gap with a sentence like "כשהיינו בפראג התחלנו מוקדם". It would read
// beautifully and it would be a lie, and it is the exact thing BRIEF.md's honesty
// rules were written to stop.
//
// THE HONEST VERSION OF PERSONAL IS A PLANNER, NOT A TRAVELLER.
//
// "זה המסלול שהיינו בונים לחבר שטס לפראג" is true: we do build itineraries, that
// is what the site is. "מתחילים מוקדם, העיר העתיקה עמוסה" is true and it is an
// opinion, because the site's own editor wrote that the old town is crowded. The
// voice makes CHOICES - skip this, three nights is enough, book thirty days ahead -
// and every choice traces to a field on a page we publish.
//
// So the first person plural is allowed for PLANNING and refused for EXPERIENCE,
// and that is a distinction a regular expression can actually hold: planning is
// present and conditional, experience is past and located.

import { postConfig } from '../postConfig.js';

export class VoiceError extends Error {
  constructor(message, { reason, where, text } = {}) {
    super(message);
    this.name = 'VoiceError';
    this.reason = reason;
    this.where = where;
    this.text = text;
  }
}

/* -------------------------------------------------------------------------- */
/* 1. no invented experience                                                   */
/* -------------------------------------------------------------------------- */

// Saying we were there.
//
// \b DOES NOT WORK HERE AND THE FIRST VERSION OF THIS GUARD NEVER FIRED ONCE.
//
// JavaScript's \b is defined on ASCII word characters. Hebrew letters are not among
// them, so in `/\bהיינו\b/` the "boundary" is between a space and a Hebrew letter -
// two non-word characters - and there is no boundary there at all. Every pattern in
// the first version tested false against the exact sentences it was written to refuse,
// including "היינו שם בקיץ". The most important guard in this change was dead, and
// silently: nothing failed, so nothing said so.
//
// The replacement is a Unicode letter lookaround, which means what \b was meant to
// mean: not preceded or followed by a letter of any script.
const W = '\\p{L}\\p{N}';
const edge = (body) => new RegExp(`(?<![${W}])(?:ו|ש|כש|וש)?(?:${body})(?![${W}])`, 'u');

// The planner's conditional, WHICH IS THE VOICE THIS WHOLE CHANGE ASKS FOR.
//
// "ככה היינו בונים את זה" is not a claim about a trip - it is what a planner says
// about a plan, it is true, and the prompt names it as the honest version of personal.
// "היינו שם" is a claim about a trip and it is a lie. Both start with the same word.
//
// So the conditional is WHITELISTED by the verb that follows it rather than the
// experience being detected by what follows it. That direction is deliberate: a list of
// planning verbs is short and knowable, and a list of the ways a sentence can name a
// place is neither. Anything not on this list is refused, which is the safe default.
const PLANNER_VERBS =
  'בונים|בונה|עושים|עושה|ממליצים|ממליץ|מוסיפים|מוסיף|מורידים|מוריד|מתחילים|מתחיל|מסיימים|' +
  'בוחרים|בוחר|שמים|משאירים|מדלגים|לוקחים|הולכים|נשארים|מתכננים|משלבים|מחלקים|קובעים|מוותרים';

const FIRST_PERSON_PAST = [
  // A temporal frame is always a claim about a trip, whatever follows it: "כשהיינו
  // בפראג" cannot be conditional, because the conditional has no "when".
  edge('כשהי(?:ינו|יתי)'),
  // היינו / הייתי on its own, unless the planner's conditional follows.
  new RegExp(`(?<![${W}])(?:ו|ש)?הי(?:ינו|יתי)(?![${W}])(?!\\s+(?:${PLANNER_VERBS})(?![${W}]))`, 'u'),
  // A travel verb in the first person past. Spelled out rather than built from stems,
  // because a stem plus an ending matches words that are neither - "נסענו" is a claim
  // and "נסע" inside another word is not.
  edge(
    'טסנו|טסתי|נסענו|נסעתי|חזרנו|חזרתי|הגענו|הגעתי|ביקרנו|ביקרתי|ישנו|ישנתי|אכלנו|אכלתי|' +
      'שתינו|שתיתי|גרנו|גרתי|נשארנו|נשארתי|טיילנו|טיילתי|צילמנו|צילמתי|קנינו|קניתי|' +
      'שילמנו|שילמתי|המתנו|חיכינו|חיכיתי|עברנו|עברתי|ראינו|ראיתי|מצאנו|מצאתי'
  ),
  // "בפעם שהיינו", "בביקור שלנו", "בטיול שלנו" - a possessive on a visit.
  new RegExp(`(?<![${W}])(?:ב|ה)?(?:ביקור|טיול|נסיעה|חופשה)\\s+(?:ש|של)ל?נו(?![${W}])`, 'u'),
  // "מניסיון", "מהניסיון שלנו" - experience offered as the source of the claim.
  edge('מ(?:ה)?ניסיון'),
];

/**
 * Refuse a string that claims we have been somewhere.
 *
 * Runs on EVERY generated line of every new post type, at build time, exactly as
 * assertNoUrl runs on every caption. Not as a review step and not as a lint: a
 * fabricated memory that reaches the approval card has already been written by the
 * pipeline, and the person tapping approve is reading forty lines and will believe
 * one of them.
 */
export function assertNoExperience(text, where = 'this line') {
  const s = String(text || '');
  for (const re of FIRST_PERSON_PAST) {
    const hit = re.exec(s);
    if (hit) {
      throw new VoiceError(
        `${where} claims a trip nobody took (${JSON.stringify(hit[0])}): ${JSON.stringify(s.slice(0, 90))}`,
        { reason: 'invented_experience', where, text: s }
      );
    }
  }
  return text;
}

/** Without throwing, for a caller choosing between candidate lines. */
export const claimsExperience = (text) => FIRST_PERSON_PAST.some((re) => re.test(String(text || '')));

/* -------------------------------------------------------------------------- */
/* 2. no filler                                                                */
/* -------------------------------------------------------------------------- */

// The words that make a line sound like every other travel post.
//
// `fillerAdjective` in src/verify.js already holds cards to a version of this, and
// this is the slideshow's own list because the failure is different: a card's
// filler is an adjective inside a factual claim, and a slide's filler IS the whole
// line. "פראג - קסום" is a slide with nothing on it.
//
// Also here: the em dash, which is banned everywhere in this project, and the
// markdown asterisks that gave away the 9-like flop post.
const FILLER = /מושלם|מושלמת|קסום|קסומה|עוצר נשימה|עוצרת נשימה|חלומי|חלומית|גן עדן|מרהיב ביופיו|פשוט מדהים|חובה לכל/;
const ARTEFACTS = /[—–]|\*\*|^\s*[*#]\s|\{[a-z]+\}/i;

export function assertNoFiller(text, where = 'this line') {
  const s = String(text || '');
  const filler = FILLER.exec(s);
  if (filler) {
    throw new VoiceError(`${where} is filler (${JSON.stringify(filler[0])}): ${JSON.stringify(s.slice(0, 90))}`, {
      reason: 'filler',
      where,
      text: s,
    });
  }
  const artefact = ARTEFACTS.exec(s);
  if (artefact) {
    throw new VoiceError(
      `${where} carries a markup artefact (${JSON.stringify(artefact[0])}): ${JSON.stringify(s.slice(0, 90))}`,
      { reason: 'artefact', where, text: s }
    );
  }
  return text;
}

/* -------------------------------------------------------------------------- */
/* 3. every opinion is a quote                                                 */
/* -------------------------------------------------------------------------- */

/**
 * An opinion, only if the page actually says it.
 *
 * THE RULE THAT MAKES THE OPINIONS SAFE. A post type may state that Prague's old
 * town is crowded, that Sicily is mostly driving, that Bali's south has genuine
 * traffic - and every one of those is a judgement, not a fact, which means a model
 * asked to produce one would produce a plausible judgement rather than ours.
 *
 * So no opinion on any new post type is WRITTEN. Each one is a verbatim substring
 * of a field the site publishes, and this is the assertion. It is the same bargain
 * verifyEvidence strikes on a card - the quote must appear in the fetched page -
 * applied to our own page, which is the one source this project is the publisher of.
 *
 * Whitespace is normalised on both sides before comparing, because a slide's line
 * has been through a template and a JSON round trip, and a line break where the
 * source had a space is not a different claim.
 */
export function quoted(text, source, where = 'this opinion') {
  const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const needle = flat(text);
  if (!needle) return text;
  if (!flat(source).includes(needle)) {
    throw new VoiceError(
      `${where} is not on the page it claims to quote: ${JSON.stringify(needle.slice(0, 90))}`,
      { reason: 'unquoted_opinion', where, text: needle }
    );
  }
  return text;
}

/* -------------------------------------------------------------------------- */
/* all three, on everything                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The gate every generated line goes through.
 *
 * `quote` is the source it must be a substring of, for the lines that are opinions.
 * Omitting it means this line is not an opinion - a place name, a day title, a
 * distance - and only the first two guards run.
 */
export function line(text, { where = 'a line', quote = null } = {}) {
  const s = String(text ?? '').trim();
  if (!s) return s;
  assertNoExperience(s, where);
  assertNoFiller(s, where);
  if (quote != null) quoted(s, quote, where);
  return s;
}

/**
 * Every string on a built post, checked in one pass.
 *
 * Walks the finished object rather than trusting each builder to have called `line`
 * on everything it wrote. Builders are where lines are composed and therefore where
 * a new line gets added without a guard; this runs over the result, so a field
 * somebody adds next year is covered by a check nobody had to remember.
 *
 * `skip` is the keys whose contents are NOT ours: a place's own name, the Latin
 * name a photo search runs on, and the base64 of an image. A place called "הייתי
 * כאן" would otherwise fail the experience check, and a data URI is 1MB of
 * characters to run seven regular expressions over.
 */
const SKIP = new Set(['nameEn', 'src', 'image', 'coverImage', 'shot', 'siteSlug', 'slug', 'url', 'sourceUrl', 'id']);

export function assertPostVoice(post, { where = 'the post' } = {}) {
  const seen = new Set();
  const walk = (node, path) => {
    if (node == null) return;
    if (typeof node === 'string') {
      // Hebrew only. An English field is a query, a slug or a credit, none of which
      // is published prose.
      if (/[֐-׿]/.test(node)) line(node, { where: `${where}.${path}` });
      return;
    }
    if (typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${path}[${i}]`));
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      if (SKIP.has(k)) continue;
      walk(v, path ? `${path}.${k}` : k);
    }
  };
  walk(post, '');
  return post;
}

/* -------------------------------------------------------------------------- */
/* the voice itself                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The hook for a post, from the configured shapes.
 *
 * FILLED, NOT WRITTEN, which is the same decision src/video/hooks.js made for a
 * clip and for the same reason: a filled format is a known sentence with our
 * numbers in it, and a written one is a sentence a model chose. The shapes came off
 * the six posts that worked - a decision named ("{days} ימים ב{dest}, ככה הייתי
 * עושה את זה"), a doubt voiced ("לא משעמם שם?"), a count promised ("{n} דברים
 * לעשות ב{dest}").
 *
 * Returns the entry rather than the string, so the caller can record WHICH shape a
 * post used. That is what section 7's report ranks by, and a hook shape that cannot
 * be named cannot be measured.
 */
export function hookShape(type, { rand = Math.random, avoid = [] } = {}) {
  const shapes = (postConfig().posts.hooks[type] || []).filter((h) => h.he);
  if (!shapes.length) throw new VoiceError(`no hook shapes configured for post type "${type}"`, { reason: 'no_hooks' });
  // Never the same shape as the last post of this type. A hook is the most visible
  // thing about a post and the reference flops were three accounts posting one
  // template.
  const fresh = shapes.filter((h) => !avoid.includes(h.id));
  const pool = fresh.length ? fresh : shapes;
  const total = pool.reduce((s, h) => s + (Number(h.weight) || 1), 0);
  let n = rand() * total;
  for (const h of pool) {
    n -= Number(h.weight) || 1;
    if (n <= 0) return h;
  }
  return pool[pool.length - 1];
}

/** `{dest}`, `{days}`, `{n}` and friends, filled from one object. */
export const fill = (template, vars = {}) =>
  String(template || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] == null ? m : String(vars[k])));

/**
 * The question this post ends on, from the type's own pool.
 *
 * Falls back to the shared `caption.questions`, which is what every other kind of post
 * uses. The fallback is deliberate rather than defensive: a type with no pool of its
 * own is not broken, it just has nothing type-specific to ask yet, and a generic
 * question is better than none - the slide and the caption both want one.
 */
export function questionFor(type, { rand = Math.random } = {}) {
  const cfg = postConfig();
  const own = cfg.posts.questions[type] || [];
  const pool = own.length ? own : cfg.caption.questions;
  return pool.length ? pool[Math.floor(rand() * pool.length)] : null;
}
