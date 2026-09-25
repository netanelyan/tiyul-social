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
  // A clip belongs on both platforms, and only ONE of them can be reached from
  // here. See MANUAL_BY_KIND below for the other.
  //
  // The editorial rule did not change and is worth restating, because the list
  // above no longer shows it: a clip should reach Instagram. Every Instagram
  // post this account makes is otherwise a photograph or a carousel, the two
  // formats with the least reach to people who do not already follow it, while
  // the one format built for the surface where non-follower reach lives goes
  // only to the other app. The rule at the top of this file, that posting the
  // same seconds twice makes every account a copy of the others, is about one
  // FEED looking duplicated; a viewer on Instagram cannot see the TikTok copy.
  //
  // WHAT CHANGED IS THE DELIVERY, AND IT CHANGED BECAUSE OF SOUND.
  //
  // The owner chooses the track in each app, by hand, which is the one part of
  // a post this pipeline was never going to do better. TikTok supports that:
  // `post_mode: MEDIA_UPLOAD` hands the video to the account's inbox and the
  // creator finishes it, so TikTok stays a publish target and `tiktokDraft`
  // describes what kind of publish it is.
  //
  // INSTAGRAM HAS NO EQUIVALENT AND THIS IS NOT AN OVERSIGHT AT OUR END. Its
  // Content Publishing API creates a container and then publishes it; there is
  // no draft state, no scheduling, and no hand-off to the app. An unpublished
  // container is not a draft in any sense the owner would recognise, it is a
  // server-side staging object that never appears in the Instagram app and
  // EXPIRES AFTER 24 HOURS. So the only two things this code can do to
  // Instagram are publish a reel immediately or not call it at all, and
  // publishing immediately means publishing whatever audio the file happens to
  // carry, for ever, because a reel's audio cannot be changed after posting.
  //
  // So it does not call it. The Instagram copy is a hand-off, and the publisher
  // being honest that it cannot make it is better than it making a silent one.
  clip: ['tiktok'],
  // An AI-written itinerary, drawn as slides. Both places, like a deck, and for
  // a reason the deck's note does not cover: this is the one kind whose content
  // is worth SAVING rather than watching, and a saved carousel is an Instagram
  // behaviour as much as a TikTok one. Unlike a deck the two sets are the same
  // design at two aspect ratios — there is no photograph to re-treat, so the
  // only thing that changes is how much vertical room the layout has.
  plan: ['instagram', 'tiktok'],
};

/**
 * Where a kind belongs that this program cannot deliver it.
 *
 * Kept here, next to ALLOWED_BY_KIND, rather than as a line in a notification,
 * because it is the same editorial decision and it has to stay visible. Delete
 * it and the knowledge that a clip should reach Instagram disappears from the
 * codebase entirely, and in a month somebody reads targets.js, sees a clip
 * going to TikTok alone, and concludes that was the intent.
 *
 * It is NOT a publish target and must never be added to one. Nothing here is
 * called, nothing here can fail, and nothing here is recorded as published. The
 * only thing it produces is a line in the notification telling you the copy is
 * yours to make, with the file's URL on it.
 */
const MANUAL_BY_KIND = {
  clip: ['instagram'],
};

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
