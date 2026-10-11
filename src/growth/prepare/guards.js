import { hasLongDash } from '../../dashes.js';
import { URL_LIKE } from '../../urlLike.js';
import { tellsIn } from './tells.js';

// What a draft may not contain, checked on everything: model output, and the
// owner's own edits before they are saved.
//
// A refusal, not a repair, except for the long dash, which every writer strips
// before it gets here (stripDashes) and which is still refused here so an edit
// cannot bring one back.
//
// Two layers. This file holds the hard rules that were here from the start (no
// link but ours, no promotion in a comment, no hashtags, no invented numbers);
// tells.js holds what makes a text read as written by a bot, and the length
// limits. checkDraft runs both, so every caller gets one list.
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

const numbersIn = (s) => (String(s).match(/\d+(?:[.,]\d+)?/g) || []).map((n) => n.replace(/,/g, ''));

/**
 * Problems with a draft, as English sentences. Empty means it may be shown.
 *
 * kind:    'comment' | 'reply' | 'message' | 'followup'
 * sources: the texts it was written from (the post, the site context, their site)
 * link:    the one URL allowed in it, or null for none
 * gender:  'f' | 'm' | 'unknown', for the address check
 * tells:   false for the owner's own edits, where the bot tells are warnings only
 */
export function checkDraft(text, { kind, sources = [], link = null, gender = 'unknown', tells = true } = {}) {
  const out = [];
  const t = String(text || '').trim();
  if (!t) return ['the draft is empty'];
  if (hasLongDash(t)) out.push('a long dash');

  const withoutLink = (link ? t.split(link).join(' ') : t).replace(/\[קישור\]/g, ' ');
  if (URL_LIKE.test(withoutLink) || MORE_DOMAINS.test(withoutLink)) {
    out.push(kind === 'message' ? 'a web address that is not our link' : 'no links here');
  }

  if (kind === 'comment' || kind === 'reply') {
    if (SELLING.test(t)) out.push('no promotion, no link and no mention of the site');
    if (/#/.test(t)) out.push('no hashtags');
    if (/@\w/.test(t)) out.push('no tags');
  }

  const pool = sources.join('\n').replace(/,(?=\d{3}\b)/g, '');
  const numbers = numbersIn(withoutLink).filter((n) => !pool.includes(n));
  if (numbers.length) out.push(`a number that is not in the sources: ${[...new Set(numbers)].join(', ')}`);

  if (tells) for (const x of tellsIn(t, { kind, gender, link })) if (!out.includes(x.msg) && x.msg !== 'a long dash') out.push(x.msg);
  return out;
}

/** Every URL in a text. For the tests and for the copy guard. */
export const urlsIn = (text) => (String(text || '').match(/https?:\/\/[^\s)]+/g) || []).map((u) => u.replace(/[.,!?]+$/, ''));
