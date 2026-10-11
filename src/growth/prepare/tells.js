import { hasLongDash } from '../../dashes.js';
import { LIMITS } from '../config.js';
import { normHe } from './site.js';

// What gives a draft away as written by a bot, checked in code.
//
// THE OWNER'S LIST, 2026-10-11, from two real drafts: an agency message that
// read like a brochure ("five features in one sentence, joined by a colon"),
// and two comments that opened "נקודה שמתחברת ל..." and read like a guidebook
// paragraph. A prompt can ask a model not to write those things; only a check
// can promise it did not. So every phrase here is refused in code, on every
// draft, and the refusal goes back to the model once with the reasons.
//
// Matching is on normalised Hebrew (no niqqud, no geresh, no punctuation) and
// on whole words with a one-letter prefix allowed, so "ובנוסף" and "שניתן" are
// caught and "מומלצת" by a listing is not mistaken for "מומלץ" in our mouth.
//
// Every problem is an English sentence: the card shows it to the owner, and the
// drafting prompt is in English too.

const PREFIX = '(?:ו|ה|ב|ל|מ|ש|כ|וה|וב|ול|ומ|וש|שה|שב|של|כש)?';

/** A phrase as a regex over normHe() text: whole words, a one-letter prefix allowed. */
const phrase = (p) => new RegExp(`(?:^| )${PREFIX}${normHe(p).split(' ').join(' ')}(?= |$)`);

const group = (label, list) => list.map((p) => ({ label, p, re: phrase(p) }));

// Openers and connectives that mark a text as composed rather than said.
export const CONNECTIVES = group('an AI opener or connective', [
  'נקודה שמתחברת', 'חשוב לציין', 'כדאי לדעת', 'כדאי לזכור', 'שווה לדעת', 'שווה לציין',
  'בנוסף', 'יחד עם זאת', 'ללא ספק', 'מעניין לציין', 'ראוי לציין', 'לסיכום', 'כמו כן',
]);

// Words nobody uses in a WhatsApp message to a stranger.
export const FORMAL = group('a formal word', ['ניתן', 'מומלץ', 'מומלצת', 'מומלצים', 'באפשרותכם', 'באפשרותך', 'על מנת', 'לקוחותיכם', 'הינו', 'הינה', 'אנו']);

// Praise that could be said about any video by anybody.
export const PRAISE = group('generic praise', [
  'סרטון מעולה', 'סרטון מדהים', 'תוכן מדהים', 'תוכן מעולה', 'איזה כיף', 'איזה יופי', 'סרטון מהמם', 'פשוט מדהים',
]);

// @tiyulplus has never travelled. Neither has the site. "I was there" is an
// invented claim on either account, and so is "we tried".
export const FAKE_EXPERIENCE = group('a claim of personal travel experience', [
  'הייתי שם', 'היינו שם', 'היינו', 'ביקרתי', 'ביקרנו', 'טסתי', 'טסנו', 'טיילתי', 'טיילנו', 'נסעתי', 'נסענו',
  'ניסינו', 'ניסיתי', 'עשינו', 'אנחנו עשינו', 'אצלנו בטיול', 'ממה שראיתי', 'כשהייתי', 'כשהיינו', 'אני מכיר את', 'אני מכירה את',
]);

// Netanel is one person. "We built" is a company talking.
export const WE = group('first person plural ("we") about the site', ['בנינו', 'הכנו', 'יצרנו', 'פיתחנו', 'אצלנו', 'הצוות שלנו']);

// Second-person forms that pick a gender. Refused when the person's gender is
// not known, which is the default for every lead now: plural or no address.
export const GENDERED = group('a gendered "you" when the gender is unknown', [
  'אתה', 'תרצה', 'תרצי', 'תגיד', 'תגידי', 'מוזמן', 'מוזמנת', 'תשלח', 'תשלחי', 'תבדוק', 'תבדקי', 'תשמור', 'תשמרי',
  'שמרי', 'תוכל', 'תוכלי', 'בא לך', 'שלך', 'אותך', 'לך', 'עשית', 'צילמת', 'כתבת', 'הראית',
]);
// "ומי שנוסעת": a feminine participle after "מי ש", addressed at the reader. Only
// the ת ending: "מי שרוצה" is the same word for everybody.
const WHO_FEMININE = /(?:^| )ו?מי ש\S+ת(?= |$)/;

// The last sentence summing up, or drawing a moral.
const MORAL = /^(?:בקיצור|בסופו של דבר|בשורה התחתונה|השורה התחתונה|וזה מה ש|זה בדיוק|כי בסוף|ככה ש|אז כן|ובקיצור)/;

const EMOJI = /\p{Extended_Pictographic}/gu;

/** Sentences, the way a reader counts them. A trailing emoji is not one. */
export function sentencesOf(text) {
  return String(text || '')
    .replace(EMOJI, ' ')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => /[\p{L}\p{N}]/u.test(s));
}

/** The text with its one link (or the [קישור] placeholder) taken out, for the checks that are about words. */
const withoutLinks = (text, link) => {
  let t = String(text || '').replace(/\[קישור\]/g, ' ');
  if (link) t = t.split(link).join(' ');
  return t.replace(/https?:\/\/\S+/g, ' ');
};

/** Characters as the limit counts them: a link is LIMITS.linkChars, whatever its length. */
export function lengthOf(text, link = null) {
  const t = String(text || '').trim();
  const links = (t.match(/\[קישור\]/g) || []).length + (link ? t.split(link).length - 1 : 0) + (t.match(/https?:\/\/\S+/g) || []).filter((u) => u !== link).length;
  return withoutLinks(t, link).replace(/\s+/g, ' ').trim().length + links * LIMITS.linkChars;
}

/**
 * Every tell in one draft, as { code, msg }. Empty means it reads like a person.
 *
 * kind:   'comment' | 'reply' | 'message' | 'followup'
 * gender: 'f' | 'm' | 'unknown' (an agency is always addressed in the plural)
 * link:   the one URL a message may carry, when it is already in the text
 */
export function tellsIn(text, { kind = 'comment', gender = 'unknown', link = null } = {}) {
  const out = [];
  const add = (code, msg) => out.push({ code, msg });
  const raw = String(text || '').trim();
  if (!raw) return [{ code: 'empty', msg: 'the draft is empty' }];
  // "הנה דוגמה לאתונה: [קישור]" is how a person hands over a link (the owner's own
  // example does it), so the one colon right before the link is not a tell.
  const words = withoutLinks(raw.replace(/:\s*(?=\[קישור\]|https?:\/\/)/g, ' '), link);
  const norm = normHe(words);

  for (const t of [...CONNECTIVES, ...FORMAL, ...PRAISE, ...WE]) if (t.re.test(norm)) add('phrase', `${t.label}: "${t.p}"`);
  for (const t of FAKE_EXPERIENCE) if (t.re.test(norm)) add('experience', `${t.label}: "${t.p}"`);
  if (gender === 'unknown') {
    for (const t of GENDERED) if (t.re.test(norm)) add('gender', `${t.label}: "${t.p}"`);
    if (WHO_FEMININE.test(norm)) add('gender', 'a feminine "מי ש..." addressed at the reader, with the gender unknown');
  }

  // Structure. A colon in a clock time ("08:00") is not a colon of style, and
  // neither is one after a short lead-in that opens a sentence ("טיפ לארמון
  // המלכותי: להגיע בפתיחה", the owner's own example). The brochure colon comes
  // after a whole clause ("בנינו כלי שמכין ללקוחות מסלול בעברית: מפה, ניווט").
  const colonOf = (s) => {
    const at = s.replace(/\d:\d/g, '').indexOf(':');
    return at >= 0 && s.slice(0, at).trim().split(/\s+/).length > 4;
  };
  if (sentencesOf(words).some(colonOf) || (words.match(/:(?!\d)/g) || []).length > 1) add('structure', 'a colon: say it as a sentence');
  if (/;/.test(words)) add('structure', 'a semicolon');
  if (hasLongDash(raw)) add('structure', 'a long dash');
  if (/!/.test(words)) add('register', 'an exclamation mark');
  const emoji = (raw.match(EMOJI) || []).length;
  if (emoji > 1) add('register', `${emoji} emoji, one at most`);

  const sentences = sentencesOf(words);
  for (const s of sentences) {
    const parts = s.split(/,|\s+ו(?=\S)/).map((p) => p.trim()).filter(Boolean);
    const short = parts.filter((p) => p.split(/\s+/).length <= 4);
    if (s.split(',').length >= 3 && short.length >= 3) {
      add('structure', 'a list of three or more things in one sentence');
      break;
    }
  }
  const last = normHe(sentences[sentences.length - 1] || '');
  if (sentences.length > 1 && MORAL.test(last)) add('structure', 'ends by summing up or drawing a moral');

  // Length, by kind.
  const lim = LIMITS[kind] || LIMITS.message;
  const len = lengthOf(raw, link);
  if (len > lim.max) add('length', `${len} characters, ${lim.target} is the aim and ${lim.max} the most`);
  if (sentences.length > lim.sentences) add('length', `${sentences.length} sentences, ${lim.sentences} at most`);
  if (kind === 'message') {
    const others = (raw.match(/https?:\/\/\S+/g) || []).filter((u) => !link || !u.startsWith(link)).length;
    const links = (raw.match(/\[קישור\]/g) || []).length + (link ? raw.split(link).length - 1 : 0) + others;
    if (links !== 1) add('link', links ? `${links} links, exactly one` : 'no link: the message needs the example link');
  }
  return out;
}
