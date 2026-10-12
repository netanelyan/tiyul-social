import { getJson } from './http.js';

// Instagram's own numbers on other people's posts, through the official Graph API
// and nothing else: no scraping, no login as any account, no write of any kind.
//
// TWO ENDPOINTS, BOTH READ ONLY, BOTH ON "INSTAGRAM API WITH FACEBOOK LOGIN".
//   Hashtag Search: ig_hashtag_search gives a hashtag's id, {id}/top_media its most
//       popular public posts, with like_count and comments_count. Never the author:
//       Meta does not return `username` on hashtag media.
//   Business Discovery: business_discovery.username(x) on OUR account gives another
//       professional account's follower count and recent posts, with the same two
//       counts. A personal or age-gated account returns nothing.
//
// NOT THE PUBLISHER'S CONNECTION. The bot publishes through "Instagram API with
// Instagram Login" (graph.instagram.com, IG_ACCESS_TOKEN), which Meta built
// without either endpoint. These need a Facebook Login token for a Facebook Page
// linked to the Instagram account, so they get their own pair of variables and
// leave the publisher's alone:
//   IG_DISCOVERY_TOKEN     a Page token (never expires) or a user token
//   IG_DISCOVERY_USER_ID   our Instagram account's id as the Page reports it
// scripts/ig-discovery-token.js makes both.
//
// WHAT EACH NEEDS FROM META. Business Discovery: instagram_basic,
// pages_read_engagement and instagram_manage_insights, which Standard Access
// grants for an account the app's own admin manages. Hashtag Search: the
// "Instagram Public Content Access" feature, which needs App Review and Business
// Verification first; until then Meta refuses it and the watcher says so.
//
// THE 30 A WEEK. Meta allows 30 unique hashtags per account in any 7 days; the
// same hashtag again inside the window is free. Counted in src/trends/instagram.js.

const VERSION = () => process.env.GRAPH_API_VERSION || 'v21.0';
const BASE = () => `https://graph.facebook.com/${VERSION()}`;
const token = (env) => String(env.IG_DISCOVERY_TOKEN || '').trim();
const userId = (env) => String(env.IG_DISCOVERY_USER_ID || '').trim();

export const discoveryConfigured = (env = process.env) => Boolean(token(env) && userId(env));

// Fields asked of each post. `children{...}` because an album has no media_url
// of its own and its first slide is the cover the format is read from; a creator's
// video can also give `thumbnail_url`. Neither nesting was tried against Meta
// before this shipped (no Facebook Login token existed yet), so a call Meta
// refuses for a field (code 100) is asked once more with the plain fields.
const FLAT = 'id,caption,like_count,comments_count,media_type,media_url,permalink,timestamp';
const MEDIA = `${FLAT},children{media_type,media_url}`;
const BD_MEDIA = `${MEDIA},thumbnail_url`;

/** Graph's error code on a failed call, or null. */
export const graphCode = (e) => {
  const c = e?.body?.error?.code;
  return c == null ? null : Number(c);
};

/**
 * Codes that mean the app or token is not allowed this call: no feature, no
 * permission, no App Review. Not worth retrying in the same run.
 *   10   permission denied (the feature is not approved)
 *   200  a permission is missing
 *   3    the app does not have the capability
 *   190  the token is invalid or expired
 */
export const NOT_ALLOWED = new Set([3, 10, 190, 200]);
export const notAllowed = (e) => NOT_ALLOWED.has(graphCode(e)) || (e?.status === 403 && graphCode(e) == null);

/** Meta's throttles (app, user, page, endpoint): they clear by themselves. */
export const limited = (e) => [4, 17, 32, 613].includes(graphCode(e));

/**
 * Business Discovery's answer for a name that is not a professional account (a
 * personal one, a typo): code 110. Only that handle is at fault, not the run.
 */
export const unknownAccount = (e) => graphCode(e) === 110 || e?.code === 'no_account';

async function graph(path, params, { env }) {
  const qs = new URLSearchParams({ ...params, access_token: token(env) });
  return getJson(`${BASE()}/${path}?${qs}`, { timeoutMs: 20_000 });
}

/** One call with the nested fields, and again without them if Meta refuses a field. */
async function withFields(ask, rich, flat) {
  try {
    return await ask(rich);
  } catch (e) {
    if (graphCode(e) !== 100) throw e;
    return ask(flat);
  }
}

// A hidden like count arrives as no field at all, never as a zero to believe.
const count = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

/** A post as the watcher reads it: the counts, its date, a cover image, its link. */
export function toPost(m) {
  const first = m.children?.data?.find((c) => c.media_type === 'IMAGE' && c.media_url);
  const cover = m.media_type === 'IMAGE' ? m.media_url : m.media_type === 'CAROUSEL_ALBUM' ? first?.media_url : m.thumbnail_url;
  return {
    id: String(m.id),
    url: m.permalink || null,
    caption: String(m.caption || '').replace(/\s+/g, ' ').trim(),
    mediaType: m.media_type || null,
    likes: count(m.like_count),
    comments: count(m.comments_count),
    publishedAt: m.timestamp ? new Date(m.timestamp).toISOString() : null,
    cover: cover || null,
  };
}

/** A hashtag's id. This is the call Meta counts against the 30 a week. */
export async function hashtagId(tag, { env = process.env } = {}) {
  const body = await graph('ig_hashtag_search', { user_id: userId(env), q: String(tag).replace(/^#/, '') }, { env });
  return body?.data?.[0]?.id || null;
}

/** The ids of the hashtags this account searched in the last 7 days, by anyone's hand. */
export async function recentHashtags({ env = process.env } = {}) {
  const body = await graph(`${userId(env)}/recently_searched_hashtags`, { limit: '30' }, { env });
  return (body?.data || []).map((h) => String(h.id));
}

/** A hashtag's most popular posts, up to `max` (Meta's page holds at most 50). */
export async function topMedia(id, { env = process.env, max = 25 } = {}) {
  const ask = (fields) => graph(`${id}/top_media`, { user_id: userId(env), fields, limit: String(Math.min(50, max)) }, { env });
  const body = await withFields(ask, MEDIA, FLAT);
  return (body?.data || []).map(toPost);
}

/**
 * Another professional account's follower count and its `max` latest posts.
 * Throws for a handle Meta does not know as a professional account.
 */
export async function businessDiscovery(handle, { env = process.env, max = 25 } = {}) {
  const u = String(handle).replace(/^@/, '').trim();
  const none = (why) => Object.assign(new Error(why), { code: 'no_account' });
  if (!/^[A-Za-z0-9._]{1,30}$/.test(u)) throw none(`not an Instagram username: "${handle}"`);
  const ask = (media) => graph(userId(env), { fields: `business_discovery.username(${u}){username,followers_count,media_count,media.limit(${Math.min(50, max)}){${media}}}` }, { env });
  const body = await withFields(ask, BD_MEDIA, FLAT);
  const bd = body?.business_discovery;
  if (!bd) throw none(`no professional account "${u}"`);
  return {
    username: bd.username || u,
    followers: count(bd.followers_count),
    posts: (bd.media?.data || []).map(toPost),
  };
}
