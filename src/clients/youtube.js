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

/** The public contacts a channel description lists. */
export function contactsIn(description) {
  const d = String(description || '');
  const socials = [];
  const add = (url) => {
    if (!socials.includes(url)) socials.push(url);
  };
  for (const m of d.matchAll(/(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9._]{2,30})/gi)) {
    if (!/^(p|reel|reels|explore|stories)$/i.test(m[1])) add(`https://www.instagram.com/${m[1].replace(/\.$/, '')}/`);
  }
  for (const m of d.matchAll(/(?:https?:\/\/)?(?:www\.)?tiktok\.com\/@([A-Za-z0-9._]{2,30})/gi)) add(`https://www.tiktok.com/@${m[1].replace(/\.$/, '')}`);
  const email = /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/.exec(d)?.[1] || null;
  return { socials: socials.slice(0, 4), email };
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
