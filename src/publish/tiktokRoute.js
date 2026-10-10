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
import {
  ZernioError,
  publishZernioTikTok,
  describeZernioError,
  isCardLevelZernio,
  isConfigProblemZernio,
  isPlatformLimitZernio,
} from './zernio.js';

// Which door a TikTok post leaves by, and what happens when that door fails.
//
// THE SLATE'S POSTS GO PUBLICLY THROUGH ZERNIO; EVERYTHING ELSE STAYS A DRAFT.
// A candidate the daily slate built carries `tiktokVia: 'zernio'`; clips, decks
// and anything approved one at a time keep today's inbox draft. So turning
// Zernio on changes the slideshows the owner approved in the morning digest and
// nothing else.
//
// THE FALLBACK IS TODAY'S PATH. When Zernio fails for any reason that is not a
// limit (a limit clears by itself, and the post waits for it), the same post goes
// to the TikTok inbox as a draft, exactly as every post did before this file, and
// the publish notice says it fell back and why. A post is never lost to the new
// route, and never posted twice: the fallback runs only after Zernio said no.

/** The zernio route's own ceiling: the lower of TIKTOK_DAILY_CAP and Zernio's 15. */
export const zernioDailyCap = () => Math.min(15, TIKTOK_DAILY_CAP());

export async function publishTikTokRouted(cand, { cfg = postConfig().publish.tiktok, deps = {}, env = process.env } = {}) {
  const viaZernio = cfg.via === 'zernio' && cand.tiktokVia === 'zernio';
  const draft = deps.draft || ((c) => publishTikTok(c, { draft: true }));
  if (!viaZernio) return (deps.legacy || ((c) => publishTikTok(c, { draft: Boolean(c.tiktokDraft) })))(cand);

  const used = (deps.usedLast24h || store.tiktokPostsInLast24h)();
  const cap = (deps.cap || zernioDailyCap)();
  if (used >= cap) {
    throw new ZernioError(`${used} TikTok posts in the last 24 hours, the cap is ${cap}`, { step: 'platform_limit', code: 'zernio_daily_cap' });
  }

  try {
    return await (deps.zernio || publishZernioTikTok)(cand, {
      // A post may carry its own privacy (the first test is SELF_ONLY); otherwise the config's.
      privacy: cand.tiktokPrivacy || cfg.privacy,
      autoAddMusic: cfg.autoAddMusic,
      env,
    });
  } catch (e) {
    if (isPlatformLimitZernio(e) || cfg.fallback !== 'draft') throw e;
    const res = await draft({ ...cand, tiktokDraft: true });
    return {
      ...res,
      fellBack: true,
      notes: [...(res.notes || []), `Zernio נכשל ולכן נשלח כטיוטה לתיבה בטיקטוק: ${e.message}`],
    };
  }
}

/* ---------------------------------------------- the four questions, for both doors */

export const describeTikTokAny = (e) => (e instanceof ZernioError ? describeZernioError(e) : describeTikTokError(e));
export const isCardLevelTikTokAny = (e) => isCardLevelZernio(e) || isCardLevelTikTok(e);
export const isPlatformLimitTikTokAny = (e) => isPlatformLimitZernio(e) || isPlatformLimitTikTok(e);
export const isConfigProblemTikTokAny = (e) => isConfigProblemZernio(e) || isConfigProblemTikTok(e);
