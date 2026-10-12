import { decodeEntities } from '../fetchPage.js';
import { getJson } from './http.js';

// Brave Search, restricted to one site per query.
//
// Chosen because it is an official API over its own index, open to new
// customers, and it honours `site:`. Google's Custom Search JSON API is closed
// to new customers and ends for everyone on 2027-01-01; Bing's ended in 2025.
//
// Brave's web search does not accept country=IL, so the Hebrew comes from
// search_lang and from the query itself.
//
// MEASURED ON 2026-10-10, AND IT SHAPES THE QUERIES. A Hebrew query with
// site:tiktok.com returns TikTok's /discover/ topic pages, not videos (0 of 20).
// The same query with the English word "video" added returns direct video links
// (13 of 20). And `freshness` empties the result entirely, because the pages it
// keeps are the topic pages TikTok refreshes constantly. So: "video" on every
// TikTok query, no freshness filter, and the post's age read from its own id.
// What that measurement also showed is that Brave's index of TikTok and
// Instagram is old: of 84 videos, none was from the last 45 days.

const ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';

export const braveConfigured = (env = process.env) => Boolean(String(env.BRAVE_API_KEY || '').trim());

/** One query. Returns web and video results flattened, each with its URL. */
export async function braveSearch(text, site, { count = 20, freshness = null, env = process.env } = {}) {
  const params = new URLSearchParams({
    q: `site:${site} ${text}`,
    count: String(count),
    search_lang: 'he',
    country: 'ALL',
    safesearch: 'moderate',
  });
  if (freshness) params.set('freshness', freshness);
  const body = await getJson(`${ENDPOINT}?${params}`, {
    headers: { 'x-subscription-token': String(env.BRAVE_API_KEY || '').trim(), 'accept-encoding': 'gzip' },
  });
  const web = (body?.web?.results || []).map((r) => ({ ...r, kind: 'web' }));
  const videos = (body?.videos?.results || []).map((r) => ({ ...r, kind: 'video' }));
  return [...web, ...videos].map((r) => ({
    url: String(r.url || ''),
    title: cleanText(r.title),
    description: cleanText(r.description),
    extra: (r.extra_snippets || []).map(cleanText),
    pageAge: r.page_age || null,
    thumb: r.thumbnail?.src || r.thumbnail?.original || null,
    creator: r.video?.creator || null,
  }));
}

/* ------------------------------------------------------------ parsing */

/**
 * A search snippet as plain text. Brave highlights matches with <strong> and
 * leaves entities encoded, so a caption arrived on the lead page as
 * "&quot;Travel content creator&quot;".
 */
export const cleanText = (s) => decodeEntities(String(s || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

/**
 * An Instagram snippet without the account's counter line ("12K Followers,
 * 2,846 Following, 1,455 Posts - Name (@handle) on Instagram:"), which is read
 * for the follower count first and is noise in a caption.
 */
export const stripIgCounts = (s) =>
  String(s || '')
    .replace(/[\d.,]+\s*[KkMm]?\s*Followers,\s*[\d.,]+\s*[KkMm]?\s*Following,\s*[\d.,]+\s*[KkMm]?\s*Posts\s*-?\s*/g, '')
    .replace(/[^:\n]{0,80}\(@[A-Za-z0-9._]+\) on Instagram:\s*/g, '')
    .replace(/\s*-?\s*Instagram\s*$/i, '')
    .trim();

const TIKTOK_POST = /^https?:\/\/(?:www\.|m\.)?tiktok\.com\/@([A-Za-z0-9._]+)\/(video|photo)\/(\d{8,25})/;
const TIKTOK_PROFILE = /^https?:\/\/(?:www\.)?tiktok\.com\/@([A-Za-z0-9._]+)\/?(?:[?#]|$)/;

/** A TikTok post URL, or null. */
export function tiktokPost(url) {
  const m = TIKTOK_POST.exec(String(url || ''));
  return m ? { handle: m[1], kind: m[2], id: m[3], url: `https://www.tiktok.com/@${m[1]}/${m[2]}/${m[3]}` } : null;
}

export function tiktokProfile(url) {
  const m = TIKTOK_PROFILE.exec(String(url || ''));
  return m ? m[1] : null;
}

/**
 * When a TikTok post went up, from its id.
 *
 * TikTok ids are snowflakes: the top 32 bits are the upload time in Unix
 * seconds. Read from the id rather than the search engine's page date, which is
 * when it crawled the page.
 */
export function tiktokTime(id) {
  try {
    const secs = Number(BigInt(String(id)) >> 32n);
    if (secs < 1_400_000_000 || secs > Date.now() / 1000 + 86_400) return null;
    return new Date(secs * 1000).toISOString();
  } catch {
    return null;
  }
}

/**
 * When an Instagram post went up, from its shortcode.
 *
 * The shortcode is the media id in base64; the id's top bits are milliseconds
 * since Instagram's epoch (2011-08-24). The search result itself carries no
 * date for Instagram, so without this every post would look new.
 */
const IG_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export function instagramTime(code) {
  const s = String(code || '').slice(0, 11);
  if (s.length < 6 || [...s].some((ch) => !IG_ALPHABET.includes(ch))) return null;
  let id = 0n;
  for (const ch of s) id = id * 64n + BigInt(IG_ALPHABET.indexOf(ch));
  const ms = Number(id >> 23n) + 1314220021721;
  return ms > Date.parse('2012-01-01') && ms < Date.now() + 86_400_000 ? new Date(ms).toISOString() : null;
}

// Instagram's login wall, which is what the index often holds as a description.
export const IG_BOILERPLATE = /^(Create an account or log in to Instagram|Welcome back to Instagram|Log into Instagram|Sign up to see)/i;

const RESERVED_IG = new Set(['p', 'reel', 'reels', 'explore', 'stories', 'tv', 'accounts', 'about', 'legal', 'direct', 'tags', 'locations']);

/**
 * An Instagram post or reel URL, with the handle when the URL or the title
 * carries one. Instagram's own pages put "(@handle)" or "handle on Instagram"
 * in the title, which the search engine indexed; nothing is fetched from
 * Instagram itself.
 */
export function instagramPost(result) {
  const m = /^https?:\/\/(?:www\.)?instagram\.com\/(?:([A-Za-z0-9._]+)\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/.exec(String(result.url || ''));
  if (!m) return null;
  let handle = m[1] && !RESERVED_IG.has(m[1].toLowerCase()) ? m[1] : null;
  if (!handle) {
    const t = `${result.title} ${result.description}`;
    handle = /\(@([A-Za-z0-9._]{2,30})\)/.exec(t)?.[1] || /^([A-Za-z0-9._]{2,30}) on Instagram/i.exec(result.title)?.[1] || /@([A-Za-z0-9._]{2,30})\b/.exec(t)?.[1] || null;
  }
  return { id: m[3], kind: m[2] === 'p' ? 'post' : 'reel', handle, url: `https://www.instagram.com/${m[2] === 'reels' ? 'reel' : m[2]}/${m[3]}/` };
}

/** The handle of an Instagram profile URL (instagram.com/<handle>/), or null. */
export function instagramProfile(url) {
  const m = /^https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]{2,30})\/?(?:[?#].*)?$/.exec(String(url || ''));
  return m && !RESERVED_IG.has(m[1].toLowerCase()) ? m[1] : null;
}

/** "12.5K Followers", "1,234 עוקבים" and friends, as a number. */
export function parseFollowers(text) {
  const m = /([\d][\d.,]*)\s*([KkMm]|אלף|מיליון)?\s*(?:Followers|followers|עוקבים)/.exec(String(text || ''));
  if (!m) return null;
  let n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] || '').toLowerCase();
  if (unit === 'k' || unit === 'אלף') n *= 1_000;
  if (unit === 'm' || unit === 'מיליון') n *= 1_000_000;
  return Math.round(n);
}

/** Likes and comments where Instagram's indexed description carries them. */
export function parseEngagement(text) {
  const t = String(text || '');
  const num = (re) => {
    const m = re.exec(t);
    if (!m) return null;
    let n = Number(m[1].replace(/,/g, ''));
    if (/k/i.test(m[2] || '')) n *= 1000;
    return Number.isFinite(n) ? Math.round(n) : null;
  };
  return {
    likes: num(/([\d][\d.,]*)\s*([Kk])?\s*likes/),
    comments: num(/([\d][\d.,]*)\s*([Kk])?\s*comments/),
  };
}
