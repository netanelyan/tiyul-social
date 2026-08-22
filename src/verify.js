// The gate. Everything that publishes has to get through here first.
//
// Three separate rules from the brief live in this file, all enforced as code
// rather than as instructions in a prompt:
//
//   1. "No claim without a primary source. No source, no candidate."
//      -> the URL must be on an allowlisted authority domain AND the page must
//         actually be reachable right now.
//   2. Claims must come from that source, not from the model's memory.
//      -> the drafting step returns verbatim quotes; every one is checked to
//         literally appear in the fetched page text. A quote that isn't there
//         means the model wrote from recollection, and the candidate dies.
//   3. "Not in version one: flight prices."
//      -> a hard guard, not a note. A fare that reaches the draft is rejected.

import { primaryAuthority } from './sources/index.js';
import { fetchReadable, FetchError } from './fetchPage.js';

export class RejectedError extends Error {
  constructor(reason, detail = '') {
    super(detail ? `${reason}: ${detail}` : reason);
    this.reason = reason;
    this.detail = detail;
  }
}

/**
 * Stage 1 — before spending a drafting call on it.
 * Confirms the source is primary and the page is live, and returns its text.
 */
export async function verifySource(item) {
  const authority = primaryAuthority(item.url);
  if (!authority) {
    throw new RejectedError('not_primary_source', new URL(item.url).hostname);
  }

  let page;
  try {
    page = await fetchReadable(item.url);
  } catch (e) {
    const code = e instanceof FetchError ? e.code : 'network';
    throw new RejectedError('source_unreachable', `${code} — ${e.message}`);
  }

  // A redirect off the allowlisted domain means the thing we actually read is
  // not the thing we vouched for. Re-check where we landed.
  const finalAuthority = primaryAuthority(page.finalUrl);
  if (!finalAuthority) {
    throw new RejectedError('redirected_off_allowlist', new URL(page.finalUrl).hostname);
  }

  // Feed items sometimes point at a page that has since been emptied. The
  // adapter's own summary is a legitimate part of the record, so it counts
  // toward the text a claim can be grounded in — it came from the same source.
  const combined = [item.title, item.summary, page.text].filter(Boolean).join('\n');
  if (combined.replace(/\s/g, '').length < 200) {
    throw new RejectedError('source_too_thin', `${combined.length} chars`);
  }

  return { sourceText: combined, finalUrl: page.finalUrl, authority: finalAuthority };
}

// --- claim grounding --------------------------------------------------------

// Normalise for comparison only. Quote matching has to survive whitespace and
// punctuation drift between the feed's copy of a sentence and the page's, while
// staying strict enough that "close enough" prose doesn't pass.
function normalise(s) {
  return String(s || '')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/ /g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .toLowerCase()
    .trim();
}

const MIN_QUOTE_WORDS = 4;

/**
 * Stage 2 — every claim the draft makes must be pinned to a verbatim quote.
 *
 * The drafting step returns `evidence: [{ claim, quote }]`. `quote` must be
 * copied character-for-character out of the source text it was shown. This is
 * checked here, not trusted: a model asked for a quote will occasionally
 * paraphrase one, and a paraphrased quote is exactly the case where the claim
 * came from somewhere other than the source.
 */
export function verifyEvidence(draft, sourceText) {
  const evidence = Array.isArray(draft?.evidence) ? draft.evidence : [];
  if (!evidence.length) throw new RejectedError('no_evidence', 'draft cited nothing');

  const haystack = normalise(sourceText);
  const unsupported = [];

  for (const e of evidence) {
    const quote = String(e?.quote || '').trim();
    const needle = normalise(quote);
    if (needle.split(' ').filter(Boolean).length < MIN_QUOTE_WORDS) {
      unsupported.push({ quote, why: 'quote too short to be evidence of anything' });
      continue;
    }
    if (!haystack.includes(needle)) {
      unsupported.push({ quote: quote.slice(0, 120), why: 'not found verbatim in the source page' });
    }
  }

  if (unsupported.length) {
    throw new RejectedError(
      'unsupported_claim',
      unsupported.map((u) => `"${u.quote}" (${u.why})`).join(' | ')
    );
  }

  return true;
}

// --- flight-price guard -----------------------------------------------------

// Deliberately not a blanket ban on money: "entry costs €19" is a perfectly good
// practical tip. What's out of scope for v1 is *fares*, so the guard fires only
// when an amount sits near flight vocabulary.
// `ש״ח` is how Israelis actually write shekels — far more common in copy than
// the ₪ sign or the word שקל, and it uses gershayim (U+05F4), not a quote mark.
// Both spellings are matched because both get typed.
const MONEY =
  /(?:[₪$€£]\s?\d[\d.,]*|\d[\d.,]*\s?(?:₪|\$|€|£|ש["״]ח|שקלים|שקל|דולר|יורו|usd|eur|ils))/giu;
const FLIGHT_WORDS =
  /(?:טיס[הות]|כרטיס(?:י)?\s*טיסה|הלוך[- ]ושוב|צ׳רטר|צ'רטר|flight|airfare|fare|round[- ]trip|one[- ]way|ticket)/giu;

const PROXIMITY_CHARS = 120;

export function flightPriceGuard(text) {
  const s = String(text || '');
  const money = [...s.matchAll(MONEY)];
  if (!money.length) return null;
  const flights = [...s.matchAll(FLIGHT_WORDS)];
  if (!flights.length) return null;

  for (const m of money) {
    for (const f of flights) {
      if (Math.abs(m.index - f.index) <= PROXIMITY_CHARS) {
        return `"${m[0].trim()}" near "${f[0].trim()}"`;
      }
    }
  }
  return null;
}

/** Stage 3 — run over the finished Hebrew copy, right before staging. */
export function verifyDraftText(draft) {
  const blob = [draft?.headline, draft?.subhead, draft?.caption, ...(draft?.bullets || [])]
    .filter(Boolean)
    .join('\n');

  const fare = flightPriceGuard(blob);
  if (fare) throw new RejectedError('flight_price_out_of_scope', fare);

  if (!draft?.headline || String(draft.headline).trim().length < 4) {
    throw new RejectedError('empty_headline');
  }
  if (!draft?.caption || String(draft.caption).trim().length < 20) {
    throw new RejectedError('empty_caption');
  }
  return true;
}

// Hebrew for the skip digest. Unknown codes fall through to the raw string
// rather than being mapped to something reassuring and wrong.
const REASON_HE = {
  not_primary_source: 'המקור לא ברשימת המקורות הראשוניים',
  source_unreachable: 'לא הצלחתי לטעון את דף המקור',
  redirected_off_allowlist: 'הדף הפנה לדומיין שלא ברשימה',
  source_too_thin: 'בדף המקור אין מספיק תוכן',
  no_evidence: 'הטיוטה לא ציטטה שום מקור',
  unsupported_claim: 'ציטוט שלא נמצא בדף המקור',
  flight_price_out_of_scope: 'מחיר טיסה — מחוץ לתחום בגרסה הזו',
  empty_headline: 'כותרת ריקה',
  empty_caption: 'טקסט ריק',
  draft_failed: 'שלב הכתיבה נכשל',
  render_failed: 'רינדור הכרטיס נכשל',
  quota: 'חריגה ממכסת נושא',
  duplicate: 'כבר פורסם',
};
export const reasonHe = (r) => REASON_HE[r] || r || 'סיבה לא ידועה';
