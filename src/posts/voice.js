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
/* 2b. a clause has to SAY something                                           */
/* -------------------------------------------------------------------------- */

// Idioms that are grammatically complete and informationally empty.
//
// REPORTED AS: a slide whose entire case for Andalusia was "אנדלוסיה מספקת את הסחורה",
// which the owner correctly called a joke. It passes every guard above it - it is not
// hype, it invents no experience, it is a verbatim quote from our own page - and it
// tells a reader nothing at all about Andalusia. "Delivers the goods" is a verdict
// about a verdict.
//
// This is a different failure from FILLER and needs its own test. FILLER catches
// ADJECTIVES that oversell ("קסום", "עוצר נשימה"); this catches SENTENCES that say
// nothing, which is the shape a summary clause takes when the page had nothing short
// to say and the picker took the shortest thing it could find.
const VACUOUS = /מספק(?:ת|ים)? את הסחורה|שווה את זה|שווה כל רגע|לא מאכזב(?:ת|ים)?|עוש(?:ה|ים) את העבודה|יש בה הכל|יש בו הכל|לא סתם|מדבר(?:ת)? בעד עצמ|חוויה בלתי נשכחת|אין על/;

// What makes a clause carry information: a number, or a concrete travel noun.
//
// Deliberately a VOCABULARY rather than a cleverness. The question being asked is
// "would a reader learn anything from this line", and for a travel slide the honest
// proxy is whether the line names a thing you could go to, a time, or a price. A
// clause about atmosphere with no referent is the one being excluded.
const CONCRETE =
  /\d|חוף|ים|הר|הרים|עיר עתיקה|רובע|שוק|מוזיאון|גן|פארק|טירה|ארמון|כנסיי|מסגד|בית כנסת|מפל|אגם|נהר|מסעד|בר\b|קפה|מלון|רכבת|אוטובוס|מטרו|טיסה|טיסות|שדה התעופה|מחיר|מחירים|זול|יוקר|עונה|קיץ|חורף|אביב|סתיו|גשם|שלג|מעלות|דקות|שעות|ימים|ק"מ|קילומטר|מטר|יין|אוכל|קפה|שופינג|חנויות|כשר|ספא|מעיינות|סקי|צלילה|שייט|טרק|שביל/;

/**
 * Whether a clause says anything a reader could act on.
 *
 * Returns false for the empty idioms above, for anything too short to be a claim, and
 * for anything naming no concrete thing. Used to CHOOSE between clauses rather than to
 * reject a post: a page usually has several things to say and only some of them are
 * worth a slide, so the picker asks this of each and takes the best one that passes.
 */
export function isConcrete(text) {
  const s = String(text || '').trim();
  if (s.length < 12) return false;
  if (VACUOUS.test(s)) return false;
  return CONCRETE.test(s);
}

/**
 * The best clause from a list: the shortest one that actually says something.
 *
 * SHORTEST-THAT-IS-CONCRETE, not shortest. The old picker took the shortest pro on the
 * page because short reads well on a slide, and the shortest clause on a page is very
 * often the one the writer added as a flourish - which is how "מספקת את הסחורה" beat
 * three real sentences about Andalusian cities.
 *
 * Falls back to the longest available when nothing is concrete, because a long real
 * sentence is still better than a short empty one, and returns null for an empty list.
 */
/**
 * A clause that was cut out of a longer sentence, made into a sentence again.
 *
 * Splitting a paragraph on punctuation leaves fragments that begin mid-thought: Batumi's
 * pros came out as "ותשתית כשרות אמיתית - חבילה מלאה לקיץ", which starts with the "and"
 * that joined it to the clause before. On a slide, with nothing before it, a leading
 * conjunction reads as a line that lost its first half - because it did.
 *
 * Only the leading conjunction is touched. Everything else is verbatim, which is the
 * rule these clauses exist under.
 */
export function openClause(text) {
  return String(text || '')
    .trim()
    .replace(/^[ו]?(?:אבל|אולם|אך|וגם|גם)\s+/, '')
    .replace(/^ו(?=[א-ת])/, '')
    .replace(/^[,;:\-–—\s]+/, '')
    .trim();
}

export function bestClause(clauses, { max = 120 } = {}) {
  const all = (clauses || []).map((c) => openClause(c)).filter((c) => c.length > 0);
  if (!all.length) return null;
  const concrete = all.filter((c) => isConcrete(c) && c.length <= max);
  if (concrete.length) return concrete.sort((a, b) => a.length - b.length)[0];
  const fits = all.filter((c) => c.length <= max);
  return (fits.length ? fits : all).sort((a, b) => b.length - a.length)[0];
}

/* -------------------------------------------------------------------------- */
/* 2c. kashrut is a note, never a slide                                        */
/* -------------------------------------------------------------------------- */

// Lines that are ABOUT kashrut rather than lines that happen to mention it.
//
// THE RULE, in the owner's words: "batumi is good for many more people other than just
// people who look for kosher destinations. you cant make a whole slide about kosher,
// only a small note (treat it as a rule)."
//
// WHY IT IS A RULE AND NOT AN EDITORIAL PREFERENCE. The Batumi verdict's "who is this
// for" slide came out carrying exactly one line, and that line was about the Chabad
// house and a meat restaurant. Every word of it was true and sourced. The post it
// produced still said something false: that the reason to consider Batumi is that you
// can eat there. Batumi is a Black Sea resort with an old town and low prices, and a
// slide that leads with kashrut tells a reader who does not keep kosher that this post
// is not for them - which costs the audience the destination deserves and misrepresents
// our own page, where the kashrut note is one paragraph of eight.
//
// So kashrut may appear, and it may not DOMINATE. It is never a slide's title and never
// a slide's only line. That is the whole rule, and it is enforced rather than reviewed
// because it reappears on every destination with a Chabad house whenever the other
// practical paragraphs happen to be thin.
const KOSHER = /כשר|כשרו?ת|בהשגח|מהדרין|גלאט|חב["״׳']?ד|בית חב|ארוחות שבת|מניין|בית כנסת/;

/** Whether a line is about kashrut, as opposed to merely naming a kosher place. */
export const isKosherLine = (text) => KOSHER.test(String(text || ''));

/**
 * Kashrut is a note on this slide, or this slide does not exist.
 *
 * Throws when the TITLE is about kashrut, or when every line on the slide is. Both are
 * the same failure: a slide the reader experiences as "this destination is for people
 * who keep kosher".
 */
export function assertKosherIsANote(slide, where = 'this slide') {
  const title = String(slide?.titleHe || '');
  if (isKosherLine(title)) {
    throw new VoiceError(`${where}: kashrut is a slide title (${JSON.stringify(title.slice(0, 60))})`, {
      reason: 'kosher-headline',
      where,
      text: title,
    });
  }
  const lines = (slide?.lines || []).map((l) => String(l?.text || '')).filter(Boolean);
  if (lines.length && lines.every(isKosherLine)) {
    throw new VoiceError(
      `${where}: every line on this slide is about kashrut (${lines.length} of ${lines.length}) - it needs at least one other reason to go`,
      { reason: 'kosher-only', where, text: lines[0] }
    );
  }
  return slide;
}

/** The same rule over a whole post, so a type cannot slip one past by building elsewhere. */
export function assertKosherAcrossPost(slides, where = 'post') {
  for (const [i, s] of (slides || []).entries()) assertKosherIsANote(s, `${where} slide ${i + 1}`);
  return slides;
}

/* -------------------------------------------------------------------------- */
/* 2d. nothing on a post says the same thing twice                             */
/* -------------------------------------------------------------------------- */

/** For comparison only: case, punctuation and the definite article are not content. */
const stem = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[?!.,:;'"״׳]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * No slide repeats another slide's title, and no line repeats its own slide's title.
 *
 * REPORTED ON THE SPAIN POST: a closing slide titled "אז לאן?" whose only line was "אז
 * לאן אתם טסים?" - "2 times the same thing basically, while many better things can be
 * written there". The same fault turned up on the verdict post the moment it was looked
 * for: a cover reading "בטומי: שווה או לא?" and a closing slide reading "בטומי: שווה או
 * לא?" again.
 *
 * It is worth a rule because the LAST SLIDE is the most valuable one on a post that was
 * watched to the end, and a repeat spends it on nothing. Enforced rather than reviewed,
 * because each builder writes its own closing slide and they will all drift there
 * independently.
 */
export function assertNoEcho(slides, where = 'post') {
  const titles = new Map();
  const lines = new Map();

  for (const [i, s] of (slides || []).entries()) {
    const t = stem(s?.titleHe);

    if (t) {
      const prior = titles.get(t);
      if (prior != null) {
        throw new VoiceError(
          `${where}: slide ${i + 1} repeats slide ${prior + 1}'s title (${JSON.stringify(String(s.titleHe).slice(0, 50))})`,
          { reason: 'echo-title', where, text: s.titleHe }
        );
      }
      titles.set(t, i);
    }

    for (const l of s?.lines || []) {
      const lt = stem(l?.text);
      if (!lt) continue;

      // Containment rather than equality: "אז לאן?" and "אז לאן אתם טסים?" are not the
      // same string and are the same thing said twice, which is the case reported.
      if (t && (lt === t || lt.includes(t) || t.includes(lt)) && Math.min(lt.length, t.length) > 5) {
        throw new VoiceError(
          `${where}: slide ${i + 1} says its own title again in a line (${JSON.stringify(String(l.text).slice(0, 50))})`,
          { reason: 'echo-line', where, text: l.text }
        );
      }

      // THE SAME CLAUSE ON TWO SLIDES. Found by this rule the moment it was written: a
      // Batumi verdict put "טיסה ישירה קצרה" on the pros slide, on the "who is this
      // for" slide and on the closing slide - three of five. Each builder picked the
      // best clause on the page independently, and the best clause on the page is the
      // same clause every time. A post with eight slides and four distinct sentences
      // reads as having run out, which is exactly how it looks.
      //
      // The closing slide is exempt in one direction only: a mark line is the question,
      // and a question that echoes nothing is not what this catches.
      const seen = lines.get(lt);
      if (seen != null && lt.length > 12 && !l.mark) {
        throw new VoiceError(
          `${where}: slide ${i + 1} repeats a line from slide ${seen + 1} (${JSON.stringify(String(l.text).slice(0, 50))})`,
          { reason: 'echo-repeat', where, text: l.text }
        );
      }
      if (!l.mark) lines.set(lt, i);
    }
  }
  return slides;
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
  // AND THE RULES THAT ARE ABOUT A SLIDE RATHER THAN ABOUT A LINE.
  //
  // `walk` above checks every Hebrew string in isolation, which is the right shape for
  // "no invented experience" and "no filler" - those are properties of a sentence. The
  // kashrut rule is not: every line of the Batumi "who is this for" slide was
  // individually fine, and the slide was not. It is a property of the SET, so it is
  // checked where the set is, over whatever the builder produced, for every type.
  assertKosherAcrossPost(post?.slides || [], where);
  assertNoEcho(post?.slides || [], where);
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
  const cfg = postConfig().posts.hooks || {};

  // THE SHARED POOL, PLUS THE TYPE'S OWN.
  //
  // The owner supplies hook templates as hooks rather than as hooks-for-one-format -
  // "10 מקומות לטיול הבא שלכם ב____ (you can use in many formats)" - and copying one
  // into four type lists is how four copies drift apart. `hooks.shared` is written once
  // and every type whose `for` list names it can draw it.
  //
  // A shared hook declares which types it fits rather than being offered to all of
  // them, because the templates are not interchangeable: "{n} מקומות" needs a type that
  // counts places, and a plan post counts days.
  const shared = (cfg.shared || []).filter((h) => h.he && (!h.for || h.for.includes(type)));
  const shapes = [...(cfg[type] || []).filter((h) => h.he), ...shared];
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
