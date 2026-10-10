import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getBytes } from '../../clients/http.js';
export { oembed } from '../../clients/oembed.js';
import { THUMB_DIR } from '../store.js';

// TikTok's official oEmbed, and the thumbnails.
//
// oEmbed is public and needs no key: caption (`title`), author name and handle,
// and a thumbnail. Nothing else is read from TikTok. Follower counts and
// comments are not offered by any official API without the creator's own
// login, so the desk does without them rather than reaching for a scraper.
//
// THE THUMBNAIL URL EXPIRES. It is a signed CDN link good for about two days,
// so the image is downloaded when the post is found and served from disk. A
// lead page opened next week would otherwise show a broken picture for a post
// that is still there.

/** A safe file name for a post's thumbnail. */
export const thumbName = (platform, id) => `${platform}-${String(id).replace(/[^A-Za-z0-9_-]/g, '')}.jpg`;

/**
 * Download a thumbnail to data/growth-thumbs. Returns the file name, or null.
 *
 * Null rather than a throw: a missing picture is a cosmetic loss, and a lead is
 * still worth showing without one.
 */
export async function saveThumb(url, platform, id, dir = THUMB_DIR) {
  if (!url) return null;
  try {
    const { buf } = await getBytes(url, { timeoutMs: 15_000 });
    mkdirSync(dir, { recursive: true });
    const name = thumbName(platform, id);
    writeFileSync(join(dir, name), buf);
    return name;
  } catch {
    return null;
  }
}
