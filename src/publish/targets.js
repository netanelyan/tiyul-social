import { instagramConfigured } from './instagram.js';
import { tiktokConfigured } from './tiktok.js';

// Where an approved post actually goes.
//
// Every destination is optional and independent, which is the point: Telegram
// can be approval-only (no channel at all, posts go to Instagram), Instagram can
// be dark while the channel carries everything, TikTok can be connected long
// before it is audited. What is NOT optional is that there be at least one —
// bot.js refuses to start otherwise, because an approval queue with nowhere to
// publish is a queue that quietly eats everything you approve.

export const TARGET_HE = { telegram: 'טלגרם', instagram: 'אינסטגרם', tiktok: 'טיקטוק' };

/**
 * Where each kind of post is allowed to go.
 *
 * Not a config value, an editorial rule: a news card is written for a feed and
 * a deck is written for a scroll, and posting either one in the other's place
 * is what makes a channel look automated.
 *
 * One destination each, and nothing to Telegram. A card is a feed post and
 * belongs on Instagram; a deck is a vertical scroll and belongs on TikTok. The
 * earlier arrangement sent both kinds to two or three places at once, which
 * made every account a copy of the others — and a follower who sees the same
 * post three times is being given two reasons to unfollow.
 *
 * Telegram keeps its real job. It is where cards are APPROVED, and that path
 * does not go through here at all: approval runs on STAGING_CHAT_ID, publishing
 * on CHANNEL_ID, and only the second one is a destination. Nothing about the
 * DMs you approve in changes because the channel stopped receiving posts.
 */
const ALLOWED_BY_KIND = {
  card: ['instagram'],
  // A deck goes to both, and it is not the same artefact in two places: the
  // TikTok set is drawn to be read over a video player's furniture with no
  // branding on it, the Instagram set is drawn as cards (render/deckInstagram)
  // so a slideshow sits in the grid looking like the account that posted it.
  // Same words, same photographs, two designs. Instagram first, because it is
  // the one that has worked for months.
  deck: ['instagram', 'tiktok'],
  // A clip is PUBLISHED to both: a TikTok video and an Instagram Reel.
  //
  // It was TikTok alone from 5 Oct 2026, with the Instagram copy handed to the
  // owner to post by hand with a sound picked in the app, because no licensed
  // track was declared and a reel published from here would have gone up silent.
  // A reel is still the one Instagram format that reaches people who do not follow
  // the account (85 accounts against 1 to 9 for every photo, on the numbers read
  // that day).
  //
  // 12 OCT 2026, the owner's order: every post goes through the morning digest and
  // out through Zernio, videos included, on TikTok and as Reels, and a video goes
  // out only with a voiceover or a track licensed for commercial use. That rule is
  // enforced at publish now (soundOf in src/video/tracks.js), so the hand-off,
  // which existed only to keep silent reels off the feed, is gone.
  clip: ['instagram', 'tiktok'],
  // An AI-written itinerary, drawn as slides. Both places, like a deck, and for
  // a reason the deck's note does not cover: this is the one kind whose content
  // is worth SAVING rather than watching, and a saved carousel is an Instagram
  // behaviour as much as a TikTok one. Unlike a deck the two sets are the same
  // design at two aspect ratios — there is no photograph to re-treat, so the
  // only thing that changes is how much vertical room the layout has.
  plan: ['instagram', 'tiktok'],
  // The five post types, which are the account's main output now.
  //
  // BOTH PLACES AT THIS LEVEL, AND THEN NARROWED PER TYPE. Whether a POST kind may
  // reach Instagram at all is the editorial decision this table holds; whether a
  // twenty-one-slide list can BE an Instagram carousel is a property of that one
  // format, and it lives beside the format in post-config.json (posts.types[].platforms,
  // read by platformsFor in src/posts/types.js). Folding the second into this table
  // would put a fact about Instagram's ten-image limit in the file that decides
  // editorial routing, where nobody would look for it.
  post: ['instagram', 'tiktok'],
};

/**
 * Where a kind belongs that this program cannot deliver it, so you post it by hand.
 *
 * Empty since 12 Oct 2026, when the one thing ever here, a clip's Instagram copy,
 * started publishing as a Reel through Zernio. Kept as the place such a rule
 * would go. It is NOT a publish target: nothing here is called or recorded as
 * published, it only adds a line to the publish notice.
 */
const MANUAL_BY_KIND = {};

/** Destinations for this kind that you post by hand. Never published to. */
export const manualForKind = (kind = 'card') => [...(MANUAL_BY_KIND[kind] || [])];

/**
 * Where this kind of post is permitted, regardless of what is configured.
 *
 * Separate from targetsForKind() so the editorial rule can be asserted on its
 * own: whether a card may reach TikTok is a decision, and it should not become
 * untestable just because no TikTok token happens to be present.
 */
export const allowedForKind = (kind = 'card') => [...(ALLOWED_BY_KIND[kind] || ALLOWED_BY_KIND.card)];

/** Configured destinations for one kind of post, in publish order. */
export function targetsForKind(kind = 'card', env = process.env) {
  const allowed = allowedForKind(kind);
  return publishTargets(env).filter((t) => allowed.includes(t));
}

/**
 * Every destination that can actually receive something, across all kinds.
 *
 * Not the same as publishTargets(), and the difference is load-bearing now that
 * the editorial rule routes each kind to exactly one place. publishTargets()
 * answers "what is configured", which still counts a Telegram channel — but
 * nothing routes to it any more, so its last-success timestamp stays null
 * forever. Anything watching for a destination that has gone quiet would read
 * that as Telegram being permanently dark and alarm about it every hour.
 *
 * So health, alarms and status read this instead: the union of where each kind
 * is actually allowed to go.
 */
export function liveTargets(env = process.env) {
  return [...new Set(Object.keys(ALLOWED_BY_KIND).flatMap((kind) => targetsForKind(kind, env)))];
}

/** Currently-configured destinations, in publish order. */
export function publishTargets(env = process.env) {
  const targets = [];
  // CHANNEL_ID is what switches Telegram publishing on. Leaving it unset is a
  // supported setup, not a misconfiguration: the bot still DMs you approval
  // cards, it just has no channel to post them to afterwards.
  if (env.CHANNEL_ID) targets.push('telegram');
  if (instagramConfigured()) targets.push('instagram');
  // Last, and for one reason: TikTok is the only destination that needs a
  // decision from you at approval time (the privacy level), so it is the one
  // most likely to be held back while the other two go out.
  if (tiktokConfigured()) targets.push('tiktok');
  return targets;
}

export const targetsHe = (targets) => targets.map((t) => TARGET_HE[t] || t).join(' ו');
