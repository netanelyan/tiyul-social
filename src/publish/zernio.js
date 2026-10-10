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

const BASE = (process.env.ZERNIO_BASE || 'https://zernio.com/api/v1').replace(/\/$/, '');

export const zernioConfigured = (env = process.env) => Boolean(String(env.ZERNIO_API_KEY || '').trim());

export class ZernioError extends Error {
  constructor(message, { step, code = null, status = null, category = null } = {}) {
    super(message);
    this.name = 'ZernioError';
    this.step = step;
    this.code = code;
    this.status = status;
    // Zernio's own errorCategory: user_content, auth_expired, platform_error.
    this.category = category;
  }
}

/** One request. `fetchImpl` is the selftest's door; production uses fetch. */
async function call(path, { method = 'GET', body = null, env = process.env, fetchImpl = fetch, step = 'request' } = {}) {
  let res;
  try {
    res = await fetchImpl(`${BASE}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${String(env.ZERNIO_API_KEY || '').trim()}`,
        'content-type': 'application/json',
        accept: 'application/json',
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
 * The connected TikTok account's Zernio id.
 *
 * ZERNIO_TIKTOK_ACCOUNT_ID wins when set; otherwise the one connected, active
 * TikTok account. Two of them is a question for the owner, not a guess.
 */
export async function tiktokAccountId({ env = process.env, fetchImpl } = {}) {
  if (String(env.ZERNIO_TIKTOK_ACCOUNT_ID || '').trim()) return env.ZERNIO_TIKTOK_ACCOUNT_ID.trim();
  const { accounts = [] } = await call('/accounts?platform=tiktok&status=connected', { env, fetchImpl, step: 'accounts' });
  const live = accounts.filter((a) => a.platform === 'tiktok' && a.isActive !== false && !a.needsReconnection);
  if (!live.length) throw new ZernioError('no connected TikTok account in Zernio - connect it in the Zernio dashboard', { step: 'config', code: 'no_account' });
  if (live.length > 1) {
    throw new ZernioError(`${live.length} TikTok accounts in Zernio - set ZERNIO_TIKTOK_ACCOUNT_ID to the one to post to`, { step: 'config', code: 'ambiguous_account' });
  }
  return live[0]._id;
}

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

/** The TikTok half of a Zernio post, as { status, url, postId, error }. */
export function tiktokPart(post) {
  const p = (post?.platforms || []).find((x) => x.platform === 'tiktok') || {};
  const url = p.platformPostUrl || null;
  return {
    status: p.status || post?.status || null,
    url,
    postId: p.platformPostId ? String(p.platformPostId) : postIdFromUrl(url),
    error: p.errorMessage || null,
    category: p.errorCategory || null,
  };
}

export async function getPost(id, { env = process.env, fetchImpl } = {}) {
  const { post } = await call(`/posts/${encodeURIComponent(id)}`, { env, fetchImpl, step: 'status' });
  return post || null;
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
export async function publishZernioTikTok(cand, { privacy, autoAddMusic = true, env = process.env, fetchImpl, pollMs = 5_000, timeoutMs = 180_000, accountId = null } = {}) {
  if (!zernioConfigured(env)) throw new ZernioError('ZERNIO_API_KEY is not set', { step: 'config', code: 'not_configured' });
  const images = cand.deck?.urls?.tiktok || [];
  if (images.length < 2) throw new ZernioError(`a TikTok carousel needs 2 to 35 images, this one has ${images.length}`, { step: 'config', code: 'card_images' });
  if (images.length > 35) throw new ZernioError(`TikTok takes at most 35 images, this one has ${images.length}`, { step: 'config', code: 'card_images' });

  const account = accountId || (await tiktokAccountId({ env, fetchImpl }));
  const created = await call('/posts', { method: 'POST', body: carouselBody(cand, { accountId: account, privacy, autoAddMusic }), env, fetchImpl, step: 'create' });
  const id = created?.post?._id;
  if (!id) throw new ZernioError('Zernio accepted the post but returned no id', { step: 'create', code: 'no_id' });

  let part = tiktokPart(created.post);
  const deadline = Date.now() + timeoutMs;
  while (!['published', 'failed', 'cancelled'].includes(part.status) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    part = tiktokPart(await getPost(id, { env, fetchImpl }));
  }
  if (part.status === 'failed' || part.status === 'cancelled') {
    throw new ZernioError(`TikTok refused the post: ${part.error || part.status}`, { step: 'status', code: part.category || part.status, category: part.category });
  }
  if (part.status !== 'published') {
    throw new ZernioError(`still ${part.status || 'unknown'} after ${Math.round(timeoutMs / 1000)}s - Zernio may still finish it (post ${id})`, { step: 'status', code: 'status_timeout' });
  }

  const notes = [];
  if (!autoAddMusic) notes.push('בלי מוזיקה אוטומטית');
  if (!part.url) notes.push(privacy === 'SELF_ONLY' ? 'פרטי: אין כתובת ציבורית עד שהופכים לציבורי' : 'הכתובת הציבורית תגיע בהמשך');
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
    resolveLater: !part.url,
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
export const isCardLevelZernio = (e) => e instanceof ZernioError && (e.category === 'user_content' || e.code === 'card_images');

export const describeZernioError = (e) => `Zernio${e?.step ? ` (${e.step})` : ''}: ${e?.message || e}`;
