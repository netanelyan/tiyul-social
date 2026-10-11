import { record } from '../../clients/budget.js';
import { getJson } from '../../clients/http.js';

// What a comment can react to: the video's full description and the top ten
// comments under it.
//
// THE OWNER'S POINT, 2026-10-11: a comment that shows nobody watched the video
// is a bot's comment. Search gives the title and 160 characters of the
// description; the reaction needs the rest, and the comments are where viewers
// ask what the site can answer and show the tone people use there.
//
// YouTube only, read only, and cheap: videos.list costs one unit for up to 50
// videos, commentThreads.list one unit per video, and only the videos picked
// for today are read (about ten a day). Commenter names are not kept, only the
// text and the like count. Comments turned off is an ordinary empty answer.
//
// TikTok and Instagram posts found through Brave carry their caption only: the
// desk has no allowed way to read their comments, and the draft is told so.
//
// A new file rather than an edit to youtube.js, which the daily-posting branch
// moved to src/clients/.

const BASE = 'https://www.googleapis.com/youtube/v3';
const key = (env) => String(env.YOUTUBE_API_KEY || env.GOOGLE_MAPS_KEY || '').trim();

const plain = (s) =>
  String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** id -> full description, for up to 50 videos a call. */
export async function descriptions(ids, { env = process.env, get = getJson } = {}) {
  const out = new Map();
  const want = [...new Set(ids.filter(Boolean))];
  for (let at = 0; at < want.length; at += 50) {
    const params = new URLSearchParams({ part: 'snippet', id: want.slice(at, at + 50).join(','), key: key(env) });
    const body = await get(`${BASE}/videos?${params}`);
    for (const v of body?.items || []) out.set(v.id, plain(v.snippet?.description).slice(0, 2000));
  }
  return out;
}

/** The top comments under one video, most relevant first: [{ text, likes }]. */
export async function topComments(id, { env = process.env, get = getJson, max = 10 } = {}) {
  const params = new URLSearchParams({ part: 'snippet', videoId: id, order: 'relevance', maxResults: String(max), textFormat: 'plainText', key: key(env) });
  try {
    const body = await get(`${BASE}/commentThreads?${params}`);
    return (body?.items || [])
      .map((t) => t.snippet?.topLevelComment?.snippet)
      .filter(Boolean)
      .map((c) => ({ text: plain(c.textDisplay || c.textOriginal).slice(0, 300), likes: Number(c.likeCount) || 0 }))
      .filter((c) => c.text);
  } catch (e) {
    // Comments turned off answers 403 commentsDisabled: nothing to read, not an error.
    if (e.status === 403 || e.status === 404) return [];
    throw e;
  }
}

/**
 * Fill `description` and `topComments` on today's YouTube posts that lack them.
 * Returns how many were read. Every unit is recorded in the ledger.
 */
export async function fillVideoContext(state, posts, { env = process.env, get = getJson, now = Date.now() } = {}) {
  if (!key(env)) return 0;
  const todo = posts.filter((p) => p.platform === 'youtube' && !p.contextAt);
  if (!todo.length) return 0;
  const desc = await descriptions(todo.map((p) => p.id), { env, get });
  record(state, 'youtube', { units: Math.ceil(todo.length / 50), now });
  for (const p of todo) {
    p.description = desc.get(p.id) || p.description || '';
    p.topComments = await topComments(p.id, { env, get });
    record(state, 'youtube', { units: 1, now });
    p.contextAt = new Date(now).toISOString();
  }
  return todo.length;
}
