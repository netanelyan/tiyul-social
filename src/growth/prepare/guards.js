import { hasLongDash } from '../../dashes.js';
import { URL_LIKE } from '../../urlLike.js';

// What a draft may not contain, checked on everything: model output, and the
// owner's own edits before they are saved.
//
// A refusal, not a repair, except for the long dash, which every writer strips
// before it gets here (stripDashes) and which is still refused here so an edit
// cannot bring one back.
//
// THE NUMBER RULE is the cheap half of "every fact comes from the post or our
// site": a number is the commonest invented fact ("3 ימים", "20 יורו", "שעתיים
// נסיעה") and the easiest to check. Every number in a draft has to appear in
// the text the draft was written from.

// URL_LIKE catches a scheme, www, .com and .co.il. A few more endings a person
// could retype, for the drafts only.
const MORE_DOMAINS = /\b[a-z0-9-]+\.(?:net|org|io|me|ly|app|link|site|info|tv|co)\b/i;

// The comment queue's promise: a real answer, not an advertisement.
const SELLING = /טיול\s*\+|טיולפלוס|tiyul|האתר\s+(?:שלנו|שלי|שבניתי)|באתר\s+שלנו|לינק|קישור|בביו|בפרופיל\s+שלי|בפרטי|תשלחו\s+לי/i;

// The personal line is about THEIR post, which may well say "ask me in DMs";
// only mentions of our site and links are refused there.
const SELLING_LINE = /טיול\s*\+|טיולפלוס|tiyul|האתר\s+(?:שלנו|שלי|שבניתי)|באתר\s+שלנו|לינק|קישור|בביו/i;

// The line sits inside a message signed by נתנאל. It is about the post, never
// about the writer: "and I have been following the series" is an invented claim.
const ABOUT_WRITER = /(?:^|[\s,])(?:ו?אני|עוקב|עוקבת|מחכה|מחכים|צופה)(?=$|[\s,.!?])/;

const LIMITS = { comment: 300, line: 170, reply: 650, message: 1400 };

// First-person travel experience, which the @tiyulplus account does not have.
const FIRST_PERSON = /(?:^|[\s,.(])(?:הייתי|היינו|ביקרתי|ביקרנו|טסתי|טסנו|טיילתי|טיילנו|נסעתי|נסענו|כשהייתי|כשהיינו|אני מכיר|אני מכירה|אנחנו מכירים|ממה שראיתי|אצלנו בטיול)(?=$|[\s,.!?)])/;

const numbersIn = (s) => (String(s).match(/\d+(?:[.,]\d+)?/g) || []).map((n) => n.replace(/,/g, ''));

/**
 * Problems with a draft, as Hebrew sentences. Empty means it may be shown.
 *
 * kind:    'comment' | 'line' | 'reply' | 'message'
 * sources: the texts it was written from (the post, the site context, the template)
 * link:    the one URL allowed in it, or null for none
 */
export function checkDraft(text, { kind, sources = [], link = null } = {}) {
  const out = [];
  const t = String(text || '').trim();
  if (!t) return ['הטיוטה ריקה'];
  if (hasLongDash(t)) out.push('קו מפריד ארוך');

  const withoutLink = link ? t.split(link).join(' ') : t;
  if (URL_LIKE.test(withoutLink) || MORE_DOMAINS.test(withoutLink)) {
    out.push(link ? 'יש כתובת שאינה הקישור שלנו' : 'אין קישורים כאן');
  }

  if (kind === 'comment' || kind === 'line') {
    if ((kind === 'line' ? SELLING_LINE : SELLING).test(t)) out.push('בלי פרסום, בלי לינק ובלי להזכיר את האתר');
    if (/#/.test(t)) out.push('בלי האשטגים');
    if (/@\w/.test(t)) out.push('בלי תיוגים');
  }
  // The account is a site's, so "I was there" is an invented claim.
  if (kind === 'comment' || kind === 'reply') {
    if (FIRST_PERSON.test(t)) out.push('בלי חוויה אישית: החשבון של אתר, לא של מטייל');
  }
  if (kind === 'line') {
    if (ABOUT_WRITER.test(t)) out.push('רק על הפוסט, לא על הכותב');
    if (/[.!?]\s+\S/.test(t)) out.push('משפט אחד בלבד');
    if (/\n/.test(t)) out.push('שורה אחת');
  }
  if (t.length > (LIMITS[kind] || 600)) out.push(`ארוך מדי (${t.length} תווים, עד ${LIMITS[kind]})`);

  const pool = sources.join('\n').replace(/,(?=\d{3}\b)/g, '');
  const numbers = numbersIn(withoutLink).filter((n) => !pool.includes(n));
  if (numbers.length) out.push(`מספר שלא מופיע במקור: ${[...new Set(numbers)].join(', ')}`);

  return out;
}

/** Every URL in a text. For the tests and for the copy guard. */
export const urlsIn = (text) => (String(text || '').match(/https?:\/\/[^\s)]+/g) || []).map((u) => u.replace(/[.,!?]+$/, ''));
