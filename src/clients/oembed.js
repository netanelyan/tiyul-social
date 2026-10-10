import { getJson } from './http.js';

// TikTok's official oEmbed: public, no key. A video's caption (`title`), its
// author's name and handle, and a thumbnail. Nothing else is read from TikTok,
// and in particular no numbers: oEmbed has none, so anything that ranks on it
// (the trend watcher) counts a TikTok post as a weak signal and never as a score.
//
// THE THUMBNAIL URL EXPIRES, signed for about two days. A caller that needs the
// picture later saves it; one that only looks at it now (the watcher reading a
// cover) uses it and lets it go.

export async function oembed(url) {
  const body = await getJson(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, { timeoutMs: 15_000 });
  return {
    title: String(body?.title || '').trim(),
    authorName: String(body?.author_name || '').trim(),
    handle: String(body?.author_unique_id || '').trim() || null,
    authorUrl: body?.author_url || null,
    thumbUrl: body?.thumbnail_url || null,
  };
}
