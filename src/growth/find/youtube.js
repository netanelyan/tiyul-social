import { getJson } from '../http.js';

// YouTube Data API: Hebrew travel Shorts. Off unless Settings turns it on.
//
// Read only: search.list (its own 100-a-day quota since June 2026, one unit a
// call) and channels.list for subscriber counts, which YouTube publishes for
// any channel that does not hide them. Free, quota only.

const BASE = 'https://www.googleapis.com/youtube/v3';
const key = (env) => String(env.YOUTUBE_API_KEY || env.GOOGLE_MAPS_KEY || '').trim();

export const youtubeConfigured = (env = process.env) => Boolean(key(env));

export async function searchShorts(text, { env = process.env, now = Date.now() } = {}) {
  const params = new URLSearchParams({
    part: 'snippet',
    q: text,
    type: 'video',
    videoDuration: 'short',
    relevanceLanguage: 'he',
    regionCode: 'IL',
    maxResults: '15',
    publishedAfter: new Date(now - 30 * 86_400_000).toISOString(),
    key: key(env),
  });
  const body = await getJson(`${BASE}/search?${params}`);
  return (body?.items || [])
    .filter((i) => i.id?.videoId)
    .map((i) => ({
      id: i.id.videoId,
      url: `https://www.youtube.com/shorts/${i.id.videoId}`,
      title: String(i.snippet?.title || ''),
      description: String(i.snippet?.description || ''),
      channelId: i.snippet?.channelId,
      channelTitle: String(i.snippet?.channelTitle || ''),
      publishedAt: i.snippet?.publishedAt || null,
      thumb: i.snippet?.thumbnails?.high?.url || i.snippet?.thumbnails?.default?.url || null,
    }));
}

/** channelId -> { subscribers, handle } for up to 50 channels in one unit. */
export async function channelStats(ids, { env = process.env } = {}) {
  const want = [...new Set(ids)].slice(0, 50);
  if (!want.length) return new Map();
  const params = new URLSearchParams({ part: 'statistics,snippet', id: want.join(','), key: key(env) });
  const body = await getJson(`${BASE}/channels?${params}`);
  return new Map(
    (body?.items || []).map((c) => [
      c.id,
      {
        subscribers: c.statistics?.hiddenSubscriberCount ? null : Number(c.statistics?.subscriberCount) || null,
        handle: String(c.snippet?.customUrl || '').replace(/^@/, '') || null,
      },
    ])
  );
}
