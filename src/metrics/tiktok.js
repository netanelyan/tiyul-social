import * as store from '../store.js';
import { SCOPES } from '../publish/tiktok.js';

// What a post did on TikTok, and the two reasons it probably cannot be answered.
//
// THIS MODULE IS HONEST ABOUT NOT WORKING RATHER THAN QUIETLY RETURNING NOTHING, which
// is the whole point of it existing in this shape. The brief asked for TikTok numbers
// "if our app can get that scope", and to "say so plainly if it doesn't". Two things
// stand in the way and only one of them can be fixed by asking:
//
//   1. THE SCOPE IS NOT GRANTED. The Display API's video list needs `video.list`, and
//      the connection this project holds was authorised for `user.info.basic`,
//      `video.publish` and `video.upload` - see SCOPES in src/publish/tiktok.js. A
//      token does not gain a scope by refreshing; the app has to request it in the
//      developer portal and the account has to reauthorise. That is a decision and a
//      round trip, not a code change.
//
//   2. AND THE ENDPOINT IS ABOUT VIDEOS. Every TikTok post this pipeline makes is a
//      PHOTO carousel, and TikTok's Display API documents `/v2/video/list/` as
//      returning videos. Photo posts are a distinct content type there and are not
//      documented as included. So even with the scope granted, the likely answer for
//      this account is an empty list - which would look exactly like an account that
//      has posted nothing.
//
// Because of (2), `available()` returning false is the EXPECTED state and the weekly
// report says so in words rather than printing a TikTok section full of dashes. The
// client below is written and ready: if the scope is granted and the endpoint does
// return photo posts, this starts working without another change, and if it returns an
// empty list for an account that has published, `probe()` says that too.
//
// WHAT THIS MEANS FOR THE MEASUREMENT PLAN. Instagram carries the whole of section 7
// for now. That is a real limitation and it is worth stating where the weights are
// read: the aspect-ratio test and the post-type ranking will be decided on Instagram
// numbers, and TikTok - which is where these posts are actually aimed - will be read by
// hand in the app until one of the two blockers above moves.

const API = 'https://open.tiktokapis.com/v2';

/** The scope the video list needs, which is not among the ones this app asked for. */
export const LIST_SCOPE = 'video.list';

export class TikTokMetricsError extends Error {
  constructor(message, { step } = {}) {
    super(message);
    this.name = 'TikTokMetricsError';
    this.step = step;
  }
}

/** Is the scope actually on the token in hand? */
export function hasListScope() {
  const granted = new Set(
    String(store.getTikTokToken()?.scope || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
  return granted.has(LIST_SCOPE);
}

/**
 * Whether TikTok numbers can be collected at all, and what is missing when they cannot.
 *
 * Returns `{ ok, why }` rather than a boolean, because the report prints the reason.
 * "TikTok: no data" is a line somebody reads as a bad week; "TikTok: the video.list
 * scope was never granted, and photo posts are not documented as returned by it" is a
 * line somebody can act on.
 */
export function available() {
  if (!store.getTikTokToken()?.token) return { ok: false, why: 'the account is not connected - npm run tiktok-token' };
  if (!hasListScope()) {
    return {
      ok: false,
      why:
        `the ${LIST_SCOPE} scope was never granted (the connection holds ${SCOPES.join(', ')}), ` +
        'and it cannot be added by refreshing - the app has to request it and the account has to reauthorise',
    };
  }
  return { ok: true, why: null };
}

async function call(path, body, { timeoutMs = 20_000 } = {}) {
  const token = store.getTikTokToken()?.token;
  if (!token) throw new TikTokMetricsError('not connected', { step: 'auth' });
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await res.json().catch(() => ({}));
  const err = json?.error;
  if (!res.ok || (err && err.code && err.code !== 'ok')) {
    throw new TikTokMetricsError(`${err?.message || `HTTP ${res.status}`}${err?.code ? ` (${err.code})` : ''}`, {
      step: 'list',
    });
  }
  return json?.data || {};
}

/**
 * The account's recent posts, as far as the Display API will describe them.
 *
 * `like_count`, `comment_count`, `share_count` and `view_count` are the four fields the
 * ranking needs, and they are the four the endpoint documents.
 */
export async function recentPosts({ limit = 20, cursor = null } = {}) {
  const gate = available();
  if (!gate.ok) throw new TikTokMetricsError(gate.why, { step: 'scope' });

  const fields = ['id', 'create_time', 'title', 'like_count', 'comment_count', 'share_count', 'view_count'];
  const data = await call(`/video/list/?fields=${fields.join(',')}`, {
    max_count: Math.max(1, Math.min(20, limit)),
    ...(cursor ? { cursor } : {}),
  });

  return {
    posts: (data.videos || []).map((v) => ({
      postId: String(v.id),
      at: v.create_time ? new Date(v.create_time * 1000).toISOString() : null,
      title: v.title || '',
      likes: Number(v.like_count) || 0,
      comments: Number(v.comment_count) || 0,
      shares: Number(v.share_count) || 0,
      views: Number(v.view_count) || 0,
    })),
    cursor: data.cursor || null,
    more: Boolean(data.has_more),
  };
}

/**
 * Does the endpoint return this account's photo posts?
 *
 * THE QUESTION NOTHING ELSE CAN ANSWER FROM HERE, and the reason it is a function
 * rather than a comment. The documentation says the endpoint lists videos; whether a
 * photo carousel appears in it is an empirical question about an account that has
 * published some, and this project's account has. So the day the scope is granted, this
 * answers it in one call - and until then it says which of the two blockers is in the
 * way rather than leaving somebody to guess.
 */
export async function probe() {
  const gate = available();
  if (!gate.ok) return { ok: false, why: gate.why, photos: null };
  try {
    const { posts } = await recentPosts({ limit: 20 });
    // Every TikTok post this pipeline makes is a carousel, so an account that has
    // published through it and gets an empty list has its answer.
    return {
      ok: true,
      photos: posts.length > 0,
      count: posts.length,
      why: posts.length
        ? null
        : 'the endpoint answered with no posts at all - consistent with photo carousels not being returned by a video list',
    };
  } catch (e) {
    return { ok: false, why: e.message, photos: null };
  }
}
