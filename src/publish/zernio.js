// TikTok photo carousels, posted publicly through Zernio.
//
// WHY A THIRD PARTY AT ALL. Our own TikTok app is unaudited, so TikTok lets it
// post only privately, and its content sharing guidelines say an internal tool
// for posting to your own accounts will not pass the audit. Every TikTok post
// this bot has made is therefore a draft in the account's inbox, finished by
// hand in the app. Zernio's TikTok app posts publicly through the same Content
// Posting API, and for one TikTok and one Instagram account it costs nothing
// (docs.zernio.com/pricing: "Every account, free or paid, includes full API
// access, unlimited posts").
//
// WHAT IT CAN DO TO THE ACCOUNT. Publish, upload, and list our own videos. No
// TikTok scope deletes a post, reads messages or reads comments, and no API here
// can unpublish a TikTok post: a wrong public post comes down by hand. That is
// why nothing reaches this file without the owner's approval.
//
// The shape of the request is copied from docs.zernio.com/platforms/tiktok: the
// carousel's images as `mediaItems`, the caption in `tiktokSettings.description`
// (the 90-character `content` becomes the photo title, with hashtags and URLs
// stripped), TikTok's two consent flags, and `publishNow`, without which Zernio
// schedules the post instead of publishing it.

import { randomUUID } from 'node:crypto';
import { soundOf } from '../video/tracks.js';
import { clipPublicUrl } from './imageHosts.js';

const BASE = (process.env.ZERNIO_BASE || 'https://zernio.com/api/v1').replace(/\/$/, '');

export const zernioConfigured = (env = process.env) => Boolean(String(env.ZERNIO_API_KEY || '').trim());

export class ZernioError extends Error {
  constructor(message, { step, code = null, status = null, category = null, unconfirmed = false, exists = false, idempotencyKey = null } = {}) {
    super(message);
    this.name = 'ZernioError';
    this.step = step;
    this.code = code;
    this.status = status;
    // Zernio's own errorCategory: user_content, auth_expired, platform_error.
    this.category = category;
    // The create call ended without a clear answer and the lookup could not
    // settle it either: the post may exist. Never followed by a draft, and a
    // retry sends `idempotencyKey` again so Zernio returns the post if it does.
    this.unconfirmed = unconfirmed;
    // Zernio says this content is already a post (409 content_duplicate).
    this.exists = exists;
    this.idempotencyKey = idempotencyKey;
  }
}

/** One request. `fetchImpl` is the selftest's door; production uses fetch. */
async function call(path, { method = 'GET', body = null, env = process.env, fetchImpl = fetch, step = 'request', headers = {} } = {}) {
  let res;
  try {
    res = await fetchImpl(`${BASE}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${String(env.ZERNIO_API_KEY || '').trim()}`,
        'content-type': 'application/json',
        accept: 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new ZernioError(`network error: ${e.message}`, { step, code: 'network' });
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = json?.error && typeof json.error === 'object' ? json.error : json;
    throw new ZernioError(err?.message || (typeof json?.error === 'string' ? json.error : `HTTP ${res.status}`), {
      step,
      code: err?.code || err?.type || `http_${res.status}`,
      status: res.status,
    });
  }
  return json;
}

/**
 * The connected account's Zernio id, for 'tiktok' or 'instagram'.
 *
 * ZERNIO_TIKTOK_ACCOUNT_ID or ZERNIO_INSTAGRAM_ACCOUNT_ID wins when set; otherwise
 * the one connected, active account on that platform. Two of them is a question
 * for the owner, not a guess.
 */
export async function accountIdFor(platform, { env = process.env, fetchImpl } = {}) {
  const pinned = String(env[`ZERNIO_${platform.toUpperCase()}_ACCOUNT_ID`] || '').trim();
  if (pinned) return pinned;
  const { accounts = [] } = await call(`/accounts?platform=${platform}&status=connected`, { env, fetchImpl, step: 'accounts' });
  const live = accounts.filter((a) => a.platform === platform && a.isActive !== false && !a.needsReconnection);
  if (!live.length) throw new ZernioError(`no connected ${platform} account in Zernio - connect it in the Zernio dashboard`, { step: 'config', code: 'no_account' });
  if (live.length > 1) {
    throw new ZernioError(`${live.length} ${platform} accounts in Zernio - set ZERNIO_${platform.toUpperCase()}_ACCOUNT_ID to the one to post to`, {
      step: 'config',
      code: 'ambiguous_account',
    });
  }
  return live[0]._id;
}

export const tiktokAccountId = (opts = {}) => accountIdFor('tiktok', opts);

/** The request body for one carousel. Pure, so the tests can read it. */
export function carouselBody(cand, { accountId, privacy, autoAddMusic }) {
  const images = cand.deck?.urls?.tiktok || [];
  return {
    // The same two fields src/publish/tiktok.js sends: the headline as TikTok's
    // 90-character photo title, the TikTok caption as the description. Both were
    // already checked for URLs when the post was built (assertNoUrl).
    content: String(cand.headline || '').slice(0, 90),
    mediaItems: images.map((url) => ({ type: 'image', url })),
    platforms: [{ platform: 'tiktok', accountId }],
    tiktokSettings: {
      privacy_level: privacy,
      allow_comment: true,
      media_type: 'photo',
      photo_cover_index: 0,
      description: String(cand.tiktokCaption || '').slice(0, 4000),
      auto_add_music: Boolean(autoAddMusic),
      // TikTok's legal requirements, sent on every post (docs.zernio.com/platforms/tiktok).
      content_preview_confirmed: true,
      express_consent_given: true,
    },
    publishNow: true,
  };
}

/** The TikTok post id inside a public URL (…/video/<id> or …/photo/<id>), or null. */
export const postIdFromUrl = (url) => /\/(?:video|photo)\/(\d{8,25})/.exec(String(url || ''))?.[1] || null;

/** One platform's half of a Zernio post, as { status, url, postId, error, category }. */
export function platformPart(post, platform) {
  const p = (post?.platforms || []).find((x) => x.platform === platform) || {};
  const url = p.platformPostUrl || null;
  return {
    status: p.status || post?.status || null,
    url,
    postId: p.platformPostId ? String(p.platformPostId) : platform === 'tiktok' ? postIdFromUrl(url) : null,
    error: p.errorMessage || null,
    category: p.errorCategory || null,
  };
}

export const tiktokPart = (post) => platformPart(post, 'tiktok');

/**
 * The id a publish result is recorded under in the metrics row.
 *
 * A Zernio post whose platform has not resolved yet is recorded under Zernio's own
 * id. TikTok first hands back its publish id (p_pub_url~...), which matches nothing,
 * and the video id and URL arrive a minute later; resolveZernioPosts in bot.js only
 * looks up rows that hold a Zernio id, so recording the publish id left the row on it
 * for good (the Lisbon plan post, 12 Oct 2026). Everything else as before: the
 * platform's own post id first.
 */
export function metricsIdFor(res) {
  if (!res) return null;
  if (res.zernioId && !res.url) return String(res.zernioId);
  return res.postId || res.mediaId || res.publishId || res.id || null;
}

export async function getPost(id, { env = process.env, fetchImpl } = {}) {
  const { post } = await call(`/posts/${encodeURIComponent(id)}`, { env, fetchImpl, step: 'status' });
  return post || null;
}

/**
 * Create one Zernio post and wait until the platform has it.
 *
 * When the create call ends without a clear answer, the post is looked up by
 * its idempotency key before anything else happens; see the catch below.
 *
 * A post Zernio accepted and is still working on when the wait runs out is NOT an
 * error: it may well go out, and treating it as a failure is what would post it
 * twice (a retry, or the TikTok draft fallback, on top of the post Zernio still
 * finishes). It comes back `pending`, recorded under Zernio's id, and
 * resolveZernioPosts in bot.js asks again and says if it failed after all.
 */
async function createAndWait(body, platform, { env, fetchImpl, pollMs, timeoutMs, idempotencyKey = null, lookups = 3 }) {
  // One key per post, sent as Zernio's Idempotency-Key and stored on the post's
  // metadata, where a read returns it. A retry that sends the same key gets the
  // original post back instead of a second one; the lookup below finds the post
  // by it when the create call did not say whether it made one.
  const key = idempotencyKey || `zernio-${randomUUID()}`;
  const sent = { ...body, metadata: { ...(body.metadata || {}), idempotencyKey: key } };

  let created;
  try {
    created = await call('/posts', { method: 'POST', body: sent, env, fetchImpl, step: 'create', headers: { 'idempotency-key': key } });
    if (!created?.post?._id) throw new ZernioError('Zernio accepted the post but returned no id', { step: 'create', code: 'no_id' });
  } catch (e) {
    // Zernio's content dedup: this content is already a post. A draft of it
    // would be the duplicate the dedup exists to stop.
    if (e instanceof ZernioError && e.status === 409 && /duplicate/i.test(`${e.code} ${e.message}`)) {
      e.exists = true;
      throw e;
    }
    if (!createUncertain(e)) throw e;

    // No clear answer: a timeout, a dropped connection, a 5xx. The post may
    // well exist, and falling back to a draft now is how a deck became a public
    // post AND a draft. So look for it first, a few times, because a post that
    // is still being saved may not be listed yet.
    let found = null;
    let lookupError = null;
    for (let i = 0; i < lookups && !found; i++) {
      if (i) await new Promise((r) => setTimeout(r, pollMs));
      try {
        found = await findPostByKey(key, { accountId: body.platforms?.[0]?.accountId, env, fetchImpl });
        lookupError = null;
      } catch (le) {
        lookupError = le;
      }
    }
    if (!found && lookupError) {
      throw new ZernioError(`${e.message}; the lookup failed too (${lookupError.message}), so whether the post exists is unknown`, {
        step: 'create',
        code: e.code,
        status: e.status,
        unconfirmed: true,
        idempotencyKey: key,
      });
    }
    // Looked for and not there: nothing was made, and a fallback is safe.
    if (!found) throw e;
    created = { post: found, recovered: true };
  }
  const id = created.post._id;

  let part = platformPart(created.post, platform);
  const deadline = Date.now() + timeoutMs;
  while (!['published', 'failed', 'cancelled'].includes(part.status) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    // The post exists: Zernio gave it an id. A status that could not be read
    // leaves it pending, the same as one the wait ran out on, and never a
    // failure a draft would follow.
    let post;
    try {
      post = await getPost(id, { env, fetchImpl });
    } catch {
      break;
    }
    part = platformPart(post, platform);
  }
  if (part.status === 'failed' || part.status === 'cancelled') {
    const who = platform === 'tiktok' ? 'TikTok' : 'Instagram';
    throw new ZernioError(`${who} refused the post: ${part.error || part.status}`, { step: 'status', code: part.category || part.status, category: part.category });
  }
  return { id, part, pending: part.status !== 'published', key, recovered: Boolean(created.recovered) };
}

/**
 * Whether a create call that failed may still have made the post: no answer,
 * a server error, or Zernio still working on the first request. A clear
 * rejection (a 4xx) made nothing.
 */
export const createUncertain = (e) =>
  e instanceof ZernioError &&
  (e.code === 'network' || e.code === 'no_id' || e.status === 408 || e.status >= 500 || (e.status === 409 && /idempotency/i.test(`${e.code} ${e.message}`)));

/**
 * The post this bot created with `key`, or null. Lists the account's posts from
 * the last two days and matches the key stored on each post's metadata.
 */
export async function findPostByKey(key, { accountId, env = process.env, fetchImpl } = {}) {
  const fromDate = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
  for (let page = 1; page <= 3; page++) {
    const q = new URLSearchParams({ fromDate, limit: '50', page: String(page) });
    if (accountId) q.set('accountId', accountId);
    const json = await call(`/posts?${q}`, { env, fetchImpl, step: 'lookup' });
    const hit = (json?.posts || []).find((p) => p?.metadata?.idempotencyKey === key);
    if (hit) return hit;
    if (page >= (Number(json?.pagination?.pages) || 1) || !(json?.posts || []).length) break;
  }
  return null;
}

/**
 * Publish one carousel to TikTok and wait until TikTok has it.
 *
 * Returns the same shape src/publish/tiktok.js returns, so the publish loop in
 * bot.js reports it the same way: { publishId, postId, url, images, slides,
 * privacy, notes, draft: false, music, status }. The public URL often arrives
 * later (TikTok resolves it asynchronously, and a SELF_ONLY post has none until
 * it is made public); resolveLater says so, and the timer in bot.js asks again.
 */
export async function publishZernioTikTok(cand, { privacy, autoAddMusic = true, env = process.env, fetchImpl, pollMs = 5_000, timeoutMs = 180_000, accountId = null, idempotencyKey = null } = {}) {
  if (!zernioConfigured(env)) throw new ZernioError('ZERNIO_API_KEY is not set', { step: 'config', code: 'not_configured' });
  const images = cand.deck?.urls?.tiktok || [];
  if (images.length < 2) throw new ZernioError(`a TikTok carousel needs 2 to 35 images, this one has ${images.length}`, { step: 'config', code: 'card_images' });
  if (images.length > 35) throw new ZernioError(`TikTok takes at most 35 images, this one has ${images.length}`, { step: 'config', code: 'card_images' });

  const account = accountId || (await tiktokAccountId({ env, fetchImpl }));
  const body = carouselBody(cand, { accountId: account, privacy, autoAddMusic });
  const { id, part, pending, recovered } = await createAndWait(body, 'tiktok', { env, fetchImpl, pollMs, timeoutMs, idempotencyKey });

  const notes = [];
  if (!autoAddMusic) notes.push('בלי מוזיקה אוטומטית');
  if (recovered) notes.push(`הקריאה ל-Zernio לא ענתה, אבל הפוסט נמצא לפי המפתח שלו (${id})`);
  if (pending) notes.push(`Zernio עדיין מעבד את הפוסט (${id}), אבדוק שוב ואגיד אם נכשל`);
  else if (!part.url) notes.push(privacy === 'SELF_ONLY' ? 'פרטי: אין כתובת ציבורית עד שהופכים לציבורי' : 'הכתובת הציבורית תגיע בהמשך');
  return {
    publishId: id,
    zernioId: id,
    postId: part.postId,
    url: part.url,
    images,
    slides: images.length,
    privacy,
    privacySource: 'config',
    notes,
    draft: false,
    music: Boolean(autoAddMusic),
    via: 'zernio',
    status: part.status,
    pending,
    resolveLater: !part.url,
  };
}

/* ------------------------------------------------------------------ videos */

// A clip goes out the same way: one Zernio post per platform, at that platform's
// slot. TikTok takes it as a video post, Instagram as a Reel. `content` is the
// caption on both (2,200 characters); TikTok's `description` and its auto music
// are photo-only fields, which is why a video has to carry its own sound.

/**
 * Refuse a video the owner's sound rule does not let out (soundOf in
 * src/video/tracks.js). Both routes check it BEFORE Zernio and outside any
 * fallback: a silent video is not a post Zernio failed to make, it is a post that
 * must not be made, so it must not reach the TikTok inbox as a draft either.
 */
export function assertVideoSound(cand) {
  const sound = soundOf(cand);
  if (!sound.ok) {
    throw new ZernioError(`not posted: ${sound.why} (a video needs a voiceover or a track licensed for commercial use)`, { step: 'config', code: 'no_sound' });
  }
  return sound;
}

/** The request body for one video, to TikTok or as an Instagram Reel. Pure. */
export function videoBody(cand, { platform, accountId, privacy, videoUrl }) {
  const caption = platform === 'instagram' ? cand.instagramCaption || cand.tiktokCaption : cand.tiktokCaption;
  const body = {
    content: String(caption || '').slice(0, 2200),
    mediaItems: [{ type: 'video', url: videoUrl }],
    platforms: [{ platform, accountId, ...(platform === 'instagram' ? { platformSpecificData: { shareToFeed: true } } : {}) }],
    publishNow: true,
  };
  if (platform === 'tiktok') {
    body.tiktokSettings = {
      privacy_level: privacy,
      allow_comment: true,
      allow_duet: true,
      allow_stitch: true,
      content_preview_confirmed: true,
      express_consent_given: true,
    };
  }
  return body;
}

/**
 * Publish one clip to TikTok or as an Instagram Reel, and wait for it.
 *
 * Longer waits than a carousel's, because both platforms transcode a video
 * before it is live. Returns the carousel's shape, plus `mediaId` for Instagram,
 * which the comment replies and the metrics join key on.
 */
export async function publishZernioVideo(cand, { platform, privacy = 'SELF_ONLY', env = process.env, fetchImpl, pollMs = 10_000, timeoutMs = 600_000, accountId = null, idempotencyKey = null } = {}) {
  if (!zernioConfigured(env)) throw new ZernioError('ZERNIO_API_KEY is not set', { step: 'config', code: 'not_configured' });
  const sound = assertVideoSound(cand);
  const videoUrl = clipPublicUrl(cand, env);
  if (!String(videoUrl || '').startsWith('https://')) {
    throw new ZernioError('the clip has no https URL - Zernio pulls the video by URL', { step: 'config', code: 'no_video_url' });
  }

  const account = accountId || (await accountIdFor(platform, { env, fetchImpl }));
  const body = videoBody(cand, { platform, accountId: account, privacy, videoUrl });
  const { id, part, pending } = await createAndWait(body, platform, { env, fetchImpl, pollMs, timeoutMs, idempotencyKey });

  return {
    publishId: id,
    zernioId: id,
    postId: part.postId,
    mediaId: platform === 'instagram' ? part.postId : null,
    url: part.url,
    videoUrl,
    privacy: platform === 'tiktok' ? privacy : null,
    notes: pending ? [`Zernio עדיין מעבד את הסרטון (${id}), אבדוק שוב ואגיד אם נכשל`] : [],
    draft: false,
    sound: sound.label,
    via: 'zernio',
    status: part.status,
    pending,
    resolveLater: !part.postId,
  };
}

/* ------------------------------------------------------------ classification */

// The same four questions bot.js asks every destination's errors.

/** Refusing everyone right now, and clears by itself: rate limits and TikTok's daily cap. */
export const isPlatformLimitZernio = (e) =>
  e instanceof ZernioError && (e.status === 429 || /rate|limit|spam_risk|too_many/i.test(`${e.code} ${e.message}`) || e.code === 'zernio_daily_cap');

/** Broken until somebody fixes the connection: key, account, expired authorisation. */
export const isConfigProblemZernio = (e) =>
  e instanceof ZernioError &&
  (e.status === 401 || e.status === 403 || e.category === 'auth_expired' || ['not_configured', 'no_account', 'ambiguous_account'].includes(e.code));

/** This post can never go: its images, its content. */
export const isCardLevelZernio = (e) => e instanceof ZernioError && (e.category === 'user_content' || e.code === 'card_images' || e.exists);

export const describeZernioError = (e) => `Zernio${e?.step ? ` (${e.step})` : ''}: ${e?.message || e}`;
