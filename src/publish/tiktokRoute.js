import { postConfig } from '../postConfig.js';
import * as store from '../store.js';
import {
  publishTikTok,
  TIKTOK_DAILY_CAP,
  describeError as describeTikTokError,
  isCardLevel as isCardLevelTikTok,
  isPlatformLimit as isPlatformLimitTikTok,
  isConfigProblem as isConfigProblemTikTok,
} from './tiktok.js';
import { publishInstagram, describeError as describeInstagramError, isPlatformLimit as isPlatformLimitInstagram } from './instagram.js';
import {
  ZernioError,
  assertVideoSound,
  publishZernioTikTok,
  publishZernioVideo,
  describeZernioError,
  isCardLevelZernio,
  isConfigProblemZernio,
  isPlatformLimitZernio,
} from './zernio.js';

// Which door a post leaves by, and what happens when that door fails.
//
// ONE PATH, SINCE 12 OCT 2026. Everything reaches here from the daily slate, which
// the owner approves in the 08:00 digest. A clip's Instagram half is a Reel through
// Zernio; Instagram photos and carousels keep the Instagram API they have published
// through for months.
//
// TIKTOK GOES TO THE INBOX AS A DRAFT, SINCE 20 OCT 2026 (`publish.tiktok.via`).
// The owner's call: the sound TikTok attached to Zernio's public posts was bad, and
// in a draft the owner picks the sound in the app before posting. With `via:
// "zernio"` every TikTok post leaves publicly through Zernio instead, a slideshow as
// a photo carousel and a clip as a video. A post an earlier Zernio attempt may have
// made (it carries a Zernio key) still goes back to Zernio, so the lookup by that
// key finds it rather than a draft duplicating it.
//
// ON THE ZERNIO PATH THE INBOX DRAFT IS THE FALLBACK. When Zernio fails for any reason
// that is not a limit (a limit clears by itself, and the post waits for it), the
// same post goes to the TikTok inbox as a draft and the publish notice says it fell
// back and why. A post is never lost to the new route, and never posted twice: the
// fallback runs only after Zernio said no, never while Zernio is still working on
// it (see createAndWait in zernio.js).
//
// AND NEVER WHEN THE POST MAY EXIST. A create call that timed out or failed with
// no clear answer is looked up by its idempotency key first (zernio.js); a post
// found that way is the result, and a lookup that could not run either leaves
// the post to be retried with the same key, not drafted.
//
// A VIDEO WITHOUT SOUND IS NOT A FAILURE TO FALL BACK FROM. The owner's rule is that
// a video goes out only with a voiceover or a track licensed for commercial use, so
// a silent one is refused before Zernio is asked and does not become a draft.

/** The zernio route's own ceiling: the lower of TIKTOK_DAILY_CAP and Zernio's 15. */
export const zernioDailyCap = () => Math.min(15, TIKTOK_DAILY_CAP());

// TikTok's four privacy levels. Anything else (a typo in post-config.json, an
// empty field) posts as SELF_ONLY: a wrong value can hide a post, never publish one.
const PRIVACY_LEVELS = new Set(['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY']);
export const privacyLevel = (value) => (PRIVACY_LEVELS.has(value) ? value : 'SELF_ONLY');

export async function publishTikTokRouted(cand, { cfg = postConfig().publish.tiktok, deps = {}, env = process.env } = {}) {
  const video = cand.kind === 'clip';
  if (video) assertVideoSound(cand);
  const draft = deps.draft || ((c) => publishTikTok(c, { draft: true }));
  // A draft publishes nothing, so the cap below is not charged for one;
  // publishTikTok skips TikTok's own cap for a draft for the same reason.
  if (cfg.via !== 'zernio' && !cand.zernioKeys?.tiktok) return draft({ ...cand, tiktokDraft: true });

  const used = (deps.usedLast24h || store.tiktokPostsInLast24h)();
  const cap = (deps.cap || zernioDailyCap)();
  if (used >= cap) {
    throw new ZernioError(`${used} TikTok posts in the last 24 hours, the cap is ${cap}`, { step: 'platform_limit', code: 'zernio_daily_cap' });
  }

  // A post may carry its own privacy (the first test was SELF_ONLY); otherwise the config's.
  const privacy = privacyLevel(cand.tiktokPrivacy || cfg.privacy);
  try {
    // The key an earlier attempt left when it could not tell whether it had made
    // the post. Sent again, Zernio returns that post if it exists.
    const idempotencyKey = cand.zernioKeys?.tiktok || null;
    return video
      ? await (deps.zernioVideo || publishZernioVideo)(cand, { platform: 'tiktok', privacy, env, idempotencyKey })
      : await (deps.zernio || publishZernioTikTok)(cand, { privacy, autoAddMusic: cfg.autoAddMusic, env, idempotencyKey });
  } catch (e) {
    if (isPlatformLimitZernio(e) || cfg.fallback !== 'draft') throw e;
    // The post may exist (unconfirmed), or Zernio says it does (exists). A draft
    // on top of either is the duplicate this route promises never to make.
    if (e.unconfirmed || e.exists) throw e;
    const res = await draft({ ...cand, tiktokDraft: true });
    return {
      ...res,
      fellBack: true,
      notes: [...(res.notes || []), `Zernio נכשל ולכן נשלח כטיוטה לתיבה בטיקטוק: ${e.message}`],
    };
  }
}

/**
 * Instagram: a clip is a Reel through Zernio, anything else the Instagram API.
 *
 * No fallback for the Reel. Instagram has no draft to fall back to, and the
 * ordinary retry in bot.js is the right answer to a failure Zernio reported.
 */
export async function publishInstagramRouted(cand, { deps = {}, env = process.env } = {}) {
  if (cand.kind !== 'clip') return (deps.graph || publishInstagram)(cand);
  assertVideoSound(cand);
  return (deps.zernioVideo || publishZernioVideo)(cand, { platform: 'instagram', env, idempotencyKey: cand.zernioKeys?.instagram || null });
}

/* ---------------------------------------------- the four questions, for every door */

export const describeTikTokAny = (e) => (e instanceof ZernioError ? describeZernioError(e) : describeTikTokError(e));
export const isCardLevelTikTokAny = (e) => isCardLevelZernio(e) || isCardLevelTikTok(e);
export const isPlatformLimitTikTokAny = (e) => isPlatformLimitZernio(e) || isPlatformLimitTikTok(e);
export const isConfigProblemTikTokAny = (e) => isConfigProblemZernio(e) || isConfigProblemTikTok(e);

export const describeInstagramAny = (e) => (e instanceof ZernioError ? describeZernioError(e) : describeInstagramError(e));
export const isPlatformLimitInstagramAny = (e) => isPlatformLimitZernio(e) || isPlatformLimitInstagram(e);
