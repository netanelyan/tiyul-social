import { getJson } from './http.js';
import { cleanText } from './brave.js';

// YouTube Data API: Hebrew travel Shorts.
//
// Read only: search.list (its own 100-a-day quota since June 2026, one unit a
// call) and channels.list for subscriber counts, which YouTube publishes for any
// channel that does not hide them. Free, quota only.
//
// THE FRESH SOURCE. Brave's index of TikTok and Instagram turned out to be
// months to years old (see the measurement in brave.js); search.list answers
// from YouTube itself, so a Short from yesterday is there today.
//
// YOUTUBE HAS NO DIRECT MESSAGES. So the channel's own description is read for
// the public contacts it lists (an Instagram, a TikTok, a business email), and
// the DM goes there. A channel that lists none can still be warmed up with a
// comment; its DM opens the channel page.

const BASE = 'https://www.googleapis.com/youtube/v3';
const key = (env) => String(env.YOUTUBE_API_KEY || env.GOOGLE_MAPS_KEY || '').trim();

export const youtubeConfigured = (env = process.env) => Boolean(key(env));

/**
 * Hebrew letters in a text. relevanceLanguage=he is a preference, not a filter:
 * on 2026-10-10 "טיול לקורפו" returned fifteen Shorts in Russian, English and
 * Italian and not one in Hebrew. Counting letters drops those for free, before
 * any of them costs a sorting call.
 */
export const hebrewLetters = (s) => (String(s || '').match(/[א-ת]/g) || []).length;

export async function searchShorts(text, { env = process.env, now = Date.now(), days = 45 } = {}) {
  const params = new URLSearchParams({
    part: 'snippet',
    q: text,
    type: 'video',
    videoDuration: 'short',
    relevanceLanguage: 'he',
    regionCode: 'IL',
    maxResults: '15',
    publishedAfter: new Date(now - days * 86_400_000).toISOString(),
    key: key(env),
  });
  const body = await getJson(`${BASE}/search?${params}`);
  return (body?.items || [])
    .filter((i) => i.id?.videoId)
    .map((i) => ({
      id: i.id.videoId,
      url: `https://www.youtube.com/shorts/${i.id.videoId}`,
      title: cleanText(i.snippet?.title),
      description: cleanText(i.snippet?.description),
      channelId: i.snippet?.channelId,
      channelTitle: cleanText(i.snippet?.channelTitle),
      publishedAt: i.snippet?.publishedAt || null,
      thumb: i.snippet?.thumbnails?.high?.url || i.snippet?.thumbnails?.default?.url || null,
    }));
}

/**
 * The public contacts a channel or video description lists: Instagram and TikTok
 * links, an Instagram handle named beside the word ("Instagram: @noa.trips",
 * "אינסטגרם - @noa.trips", only with the @), an email, and Linktree pages, which
 * the growth desk reads for the Instagram on them (src/growth/find/igHandles.js).
 */
export function contactsIn(description) {
  const d = String(description || '');
  const socials = [];
  const add = (url) => {
    if (!socials.some((s) => s.toLowerCase() === url.toLowerCase())) socials.push(url);
  };
  for (const m of d.matchAll(/(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9._]{2,30})/gi)) {
    if (!/^(p|reel|reels|explore|stories)$/i.test(m[1])) add(`https://www.instagram.com/${m[1].replace(/\.$/, '')}/`);
  }
  for (const m of d.matchAll(/(?:instagram|insta|אינסטגרם|אינסטה)\s*[:|-]?\s*@([A-Za-z0-9._]{2,30})/gi)) add(`https://www.instagram.com/${m[1].replace(/\.+$/, '')}/`);
  for (const m of d.matchAll(/(?:https?:\/\/)?(?:www\.)?tiktok\.com\/@([A-Za-z0-9._]{2,30})/gi)) add(`https://www.tiktok.com/@${m[1].replace(/\.$/, '')}`);
  const email = /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/.exec(d)?.[1] || null;
  const linktree = [...new Set([...d.matchAll(/(?:https?:\/\/)?(?:www\.)?linktr\.ee\/([A-Za-z0-9._-]{1,50})/gi)].map((m) => `https://linktr.ee/${m[1].replace(/[._-]+$/, '')}`))].slice(0, 2);
  return { socials: socials.slice(0, 4), email, linktree };
}

/** channelId -> { subscribers, handle, socials, email }, up to 50 channels a unit. */
export async function channelStats(ids, { env = process.env } = {}) {
  const want = [...new Set(ids.filter(Boolean))];
  const out = new Map();
  for (let at = 0; at < want.length; at += 50) {
    const params = new URLSearchParams({ part: 'statistics,snippet', id: want.slice(at, at + 50).join(','), key: key(env) });
    const body = await getJson(`${BASE}/channels?${params}`);
    for (const c of body?.items || []) {
      out.set(c.id, {
        subscribers: c.statistics?.hiddenSubscriberCount ? null : Number(c.statistics?.subscriberCount) || null,
        handle: String(c.snippet?.customUrl || '').replace(/^@/, '') || null,
        ...contactsIn(c.snippet?.description),
      });
    }
  }
  return out;
}

/**
 * The most-viewed Shorts for a query in the last `days`, for the trend watcher.
 *
 * Ranked by views rather than relevance, in one language: Hebrew for the
 * audience, English because a format that works for travel slideshows works
 * across languages. The numbers come from videoStats, never from here.
 */
export async function searchTop(text, { env = process.env, now = Date.now(), lang = 'he', days = 30, max = 15, order = 'viewCount' } = {}) {
  const params = new URLSearchParams({
    part: 'snippet',
    q: text,
    type: 'video',
    videoDuration: 'short',
    order: order === 'relevance' ? 'relevance' : 'viewCount',
    relevanceLanguage: lang,
    maxResults: String(Math.min(50, Math.max(1, max))),
    publishedAfter: new Date(now - days * 86_400_000).toISOString(),
    key: key(env),
  });
  if (lang === 'he') params.set('regionCode', 'IL');
  const body = await getJson(`${BASE}/search?${params}`);
  return (body?.items || [])
    .filter((i) => i.id?.videoId)
    .map((i) => ({
      id: i.id.videoId,
      url: `https://www.youtube.com/shorts/${i.id.videoId}`,
      title: cleanText(i.snippet?.title),
      description: cleanText(i.snippet?.description),
      channelTitle: cleanText(i.snippet?.channelTitle),
      publishedAt: i.snippet?.publishedAt || null,
      thumb: i.snippet?.thumbnails?.high?.url || i.snippet?.thumbnails?.default?.url || null,
    }));
}

/**
 * videoId -> the video's own title, description, cover, upload time and numbers.
 * For ids found some other way than search (Brave): videos.list is 1 unit per 50
 * ids from the general quota, not from search's 100 a day.
 */
export async function videoDetails(ids, { env = process.env } = {}) {
  const want = [...new Set(ids.filter(Boolean))];
  const out = new Map();
  for (let at = 0; at < want.length; at += 50) {
    const params = new URLSearchParams({ part: 'snippet,statistics', id: want.slice(at, at + 50).join(','), key: key(env) });
    const body = await getJson(`${BASE}/videos?${params}`);
    for (const v of body?.items || []) {
      const num = (x) => (x == null ? null : Number(x));
      out.set(v.id, {
        id: v.id,
        url: `https://www.youtube.com/shorts/${v.id}`,
        title: cleanText(v.snippet?.title),
        description: cleanText(v.snippet?.description),
        publishedAt: v.snippet?.publishedAt || null,
        thumb: v.snippet?.thumbnails?.high?.url || v.snippet?.thumbnails?.default?.url || null,
        views: num(v.statistics?.viewCount),
        likes: num(v.statistics?.likeCount),
        comments: num(v.statistics?.commentCount),
      });
    }
  }
  return out;
}

/** videoId -> { views, likes, comments }, as YouTube publishes them. 50 ids a unit. */
export async function videoStats(ids, { env = process.env } = {}) {
  const want = [...new Set(ids.filter(Boolean))];
  const out = new Map();
  for (let at = 0; at < want.length; at += 50) {
    const params = new URLSearchParams({ part: 'statistics', id: want.slice(at, at + 50).join(','), key: key(env) });
    const body = await getJson(`${BASE}/videos?${params}`);
    for (const v of body?.items || []) {
      const num = (x) => (x == null ? null : Number(x));
      out.set(v.id, { views: num(v.statistics?.viewCount), likes: num(v.statistics?.likeCount), comments: num(v.statistics?.commentCount) });
    }
  }
  return out;
}
