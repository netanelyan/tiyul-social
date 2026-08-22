// Pexels — commercial-license stock.
//
// Chosen over the alternatives on licence terms rather than catalogue size.
// The Pexels licence permits commercial use with no attribution required and,
// critically, does not require hotlinking back to their CDN — so the bytes can
// be inlined into the card at render time. Unsplash's API terms require both
// attribution and a download-tracking ping, which is fine but is a running
// obligation rather than a one-off integration.
//
// We record and print the photographer anyway. Not required, but a photograph
// on a published card should say whose it is.

const API = 'https://api.pexels.com/v1/search';

// Instagram cards are 1080x1350 portrait, so ask for portrait crops. A
// landscape photo letterboxed into a 4:5 frame either crops the subject out or
// leaves the composition off-centre behind the scrim.
const ORIENTATION = 'portrait';

// Bigger than the card, so downscaling is what happens rather than upscaling.
const MIN_WIDTH = 1080;

const MAX_BYTES = 8_000_000; // Instagram's own image limit, and a sanity bound

export const configured = () => Boolean(process.env.PEXELS_API_KEY);

/**
 * Find a photograph for a draft.
 *
 * Returns { src, provenance, credit } with `src` as a data URI, or null when
 * nothing suitable came back. Null is a completely ordinary outcome — the
 * caller falls back to a text-led layout, which is a fine card.
 */
export async function search(query, { timeoutMs = 15_000 } = {}) {
  const q = String(query || '').trim();
  if (!q) return null;

  const url = `${API}?${new URLSearchParams({
    query: q,
    orientation: ORIENTATION,
    per_page: '15',
    // Pexels' "large" ordering is by relevance; leaving it default gives better
    // subject matches than sorting by popularity, which drifts toward generic
    // wallpaper shots of anywhere.
  })}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let json;
  try {
    const res = await fetch(url, {
      headers: { Authorization: process.env.PEXELS_API_KEY },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Pexels search failed: HTTP ${res.status}`);
    json = await res.json();
  } finally {
    clearTimeout(timer);
  }

  const photo = (json.photos || []).find((p) => (p.width || 0) >= MIN_WIDTH);
  if (!photo) return null;

  // Prefer the portrait crop Pexels generates; fall back through progressively
  // larger generic sizes.
  const href = photo.src?.portrait || photo.src?.large2x || photo.src?.large || photo.src?.original;
  if (!href) return null;

  const bytes = await download(href, timeoutMs);
  if (!bytes) return null;

  return {
    // Inlined rather than hotlinked. The renderer runs with no network by
    // design (see render/index.js), and a card that silently renders without
    // its background because a CDN blipped is worse than one that fails loudly.
    src: `data:${bytes.type};base64,${bytes.buf.toString('base64')}`,
    provenance: 'stock',
    credit: photo.photographer ? `Pexels / ${photo.photographer}` : 'Pexels',
    sourceUrl: photo.url || null,
    query: q,
  };
}

async function download(href, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(href, { signal: ctrl.signal });
    if (!res.ok) return null;

    const type = res.headers.get('content-type') || 'image/jpeg';
    if (!/^image\/(jpe?g|png|webp)$/i.test(type)) return null;

    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_BYTES) return null;

    return { buf, type };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
