// The content pillars, and the quota machinery that keeps any one of them from
// quietly becoming the whole feed.
//
// The brief was explicit that this is general travel for Israeli travellers and
// that kosher/Shabbat is "one occasional thread among many, not the theme —
// I don't want to narrow the audience". A line in the drafting prompt saying
// "don't overdo it" is not a mechanism; a model that has just been handed three
// kosher-adjacent sources will cheerfully produce three kosher posts. So it is
// enforced as an arithmetic cap over a rolling window of what actually
// published, checked before a candidate can be staged.

import { recentPublished } from './store.js';

export const PILLARS = {
  place: {
    he: 'מקום מעניין',
    hint: 'A place worth knowing about — a town, a district, a site, a landscape.',
  },
  fact: {
    he: 'עובדה מפתיעה',
    hint: 'A genuinely surprising, verifiable fact about a place. Not trivia padding.',
  },
  hidden: {
    he: 'פינה נסתרת',
    hint: 'Somewhere real but under-visited, and why it stayed that way.',
  },
  tip: {
    he: 'טיפ מעשי',
    hint: 'Something that changes what a traveller actually does — booking, timing, transport, money.',
  },
  entry: {
    he: 'שינוי כניסה/ויזה',
    hint: 'An entry, visa, permit or border-procedure change, with its effective date.',
  },
  route: {
    he: 'קו חדש מתל אביב',
    hint: 'A new or returning route from TLV, or a schedule change that matters. Never fares.',
  },
  timing: {
    he: 'מתי ללכת',
    hint: 'When to go somewhere and when not to — season, crowds, closures, weather.',
  },
};

export const PILLAR_KEYS = Object.keys(PILLARS);
export const isPillar = (p) => PILLAR_KEYS.includes(p);
export const pillarHe = (p) => PILLARS[p]?.he || p;

// Tags are orthogonal to pillars: any pillar can carry the `kosher` tag (a
// timing post about Yom Kippur closures, a tip about Shabbat transport), which
// is exactly why the cap is on the tag and not on a pillar.
export const TAGS = ['kosher', 'family', 'budget', 'nature', 'city', 'food', 'accessibility'];

// Quotas, as a share of the rolling published window. Deliberately expressed as
// "at most this fraction", never as a target to hit.
const capShare = (name, fallback) => {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : fallback;
};

export const quotaConfig = () => ({
  // Default 0.15 — roughly one post in seven. Present, never dominant.
  kosherMaxShare: capShare('KOSHER_MAX_SHARE', 0.15),
  // No single pillar takes more than this much of the window either, so the
  // feed can't collapse into nothing but visa alerts just because FCDO is the
  // most reliable source.
  pillarMaxShare: capShare('PILLAR_MAX_SHARE', 0.4),
  // Below this many published posts the shares are statistical noise — a cap of
  // 0.15 would block the very first kosher post forever on an empty feed.
  minSampleSize: Math.max(1, Number(process.env.QUOTA_MIN_SAMPLE ?? '8')),
});

/**
 * Would publishing this candidate breach a quota?
 *
 * Returns null when it's fine, or a reason string. The reason is surfaced to
 * you in the skip digest rather than swallowed — BrickDeal's README is blunt
 * about what a silent filter cost, and this filter is opinionated enough that
 * you should be able to see it working and disagree with it.
 */
export function quotaBlock(cand, history = recentPublished()) {
  const { kosherMaxShare, pillarMaxShare, minSampleSize } = quotaConfig();
  if (history.length < minSampleSize) return null;

  const tags = cand.tags || [];
  if (tags.includes('kosher')) {
    const share = history.filter((p) => (p.tags || []).includes('kosher')).length / history.length;
    if (share >= kosherMaxShare) {
      return `kosher share ${(share * 100).toFixed(0)}% >= cap ${(kosherMaxShare * 100).toFixed(0)}%`;
    }
  }

  if (cand.pillar) {
    const share = history.filter((p) => p.pillar === cand.pillar).length / history.length;
    if (share >= pillarMaxShare) {
      return `pillar "${cand.pillar}" share ${(share * 100).toFixed(0)}% >= cap ${(pillarMaxShare * 100).toFixed(0)}%`;
    }
  }

  return null;
}

// Which pillars are currently under-represented — fed to the scorer so the
// daily pick actively spreads out rather than merely avoiding the cap.
export function pillarDeficits(history = recentPublished()) {
  const counts = Object.fromEntries(PILLAR_KEYS.map((k) => [k, 0]));
  for (const p of history) if (counts[p.pillar] !== undefined) counts[p.pillar]++;
  const total = history.length || 1;
  const even = 1 / PILLAR_KEYS.length;
  return Object.fromEntries(PILLAR_KEYS.map((k) => [k, even - counts[k] / total]));
}
