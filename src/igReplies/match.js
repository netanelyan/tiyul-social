// Did this comment ask for the link?
//
// The slide says תגיבו "פראג" and what arrives is פראג, לפראג, "פראג"!!, פְּרָאג,
// פראג 😍, or מסלול. All of those are the same person doing what was asked, and
// a matcher that only accepts the bare word answers about half of them, which
// is worse than not asking: somebody did the thing and got nothing back.
//
// WHAT IT MUST NOT DO IS MATCH LOOSELY. Every match sends a stranger a DM, and
// a DM nobody asked for is a spam report against an account that cannot be
// replaced. So the two rules are deliberately narrow in different directions:
// the destination is matched with Hebrew's attached prefixes allowed, because
// "לפראג" is the word with a preposition glued to it and not a different word;
// the keywords are matched WHOLE, because "לינק" inside a longer word is not
// somebody asking for a link.

/** The single-letter prefixes Hebrew glues to a noun, and the pairs that occur. */
const PREFIX = /^(?:[ולבכמשה]{1,2})/;

// Niqqud, cantillation, and the invisible marks a phone keyboard inserts.
const MARKS = /[֑-ׇ‎‏‪-‮﻿]/g;

/**
 * A comment, reduced to the words in it.
 *
 * Emoji, punctuation and quotes go; Hebrew and Latin letters and digits stay.
 * Everything is lowercased so a Latin destination name matches whatever case
 * it was typed in.
 */
export function words(text) {
  return String(text || '')
    .replace(MARKS, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** The word with any attached Hebrew prefix removed, or the word itself. */
export const stem = (w) => {
  const bare = String(w || '').replace(PREFIX, '');
  // Only when something is left worth matching. Stripping two letters off a
  // three-letter word leaves noise that matches far too much.
  return bare.length >= 2 ? bare : String(w || '');
};

/**
 * Does this comment ask for the link for this post?
 *
 * `destHe` is the destination on the post, and it is the ask printed on the
 * slide. `keywords` are the configured extras. Returns the reason it matched,
 * or null, because the reason is worth logging: a run of keyword matches and
 * no destination matches means the slide's ask is not being read.
 */
export function asksForLink(text, { destHe = '', keywords = [] } = {}) {
  const ws = words(text);
  if (!ws.length) return null;

  // The destination, and every word of it for a two-word name like "לייק
  // קומו". Any one of them matching is enough: somebody typing one word of a
  // two-word city is still answering the ask.
  const target = words(destHe).map(stem).filter((w) => w.length >= 2);
  if (target.length) {
    for (const w of ws) {
      const s = stem(w);
      if (target.includes(s) || target.includes(w)) return { why: 'destination', word: w };
    }
  }

  // Whole words only, and the prefix rule applies to these too: "המסלול" is
  // somebody asking for the itinerary.
  const keys = keywords.map((k) => words(k).map(stem).join(' ')).filter(Boolean);
  for (const w of ws) {
    const s = stem(w);
    if (keys.includes(s) || keys.includes(w)) return { why: 'keyword', word: w };
  }

  return null;
}
