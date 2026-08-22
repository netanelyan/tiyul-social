// Instagram publishing, through the official Graph API only.
//
// The Content Publishing API is a two-step handshake, and the first step is the
// one that shapes the whole design:
//
//   1. POST /{ig-user-id}/media         with image_url  -> a creation_id
//   2. POST /{ig-user-id}/media_publish with creation_id -> the published post
//
// In step 1 the bytes do NOT travel through our request. We hand Instagram a
// URL and Instagram's servers go and fetch it themselves. That single fact is
// why rendered cards are written into a directory a web server already serves
// (CARD_OUTPUT_DIR) and why CARD_PUBLIC_BASE_URL is not optional for this path:
// a card that only exists on local disk cannot be published, no matter how
// correct everything else is.
//
// No unofficial endpoints, no session cookies, no private mobile API.

const GRAPH = 'https://graph.facebook.com';
const VERSION = process.env.GRAPH_API_VERSION || 'v21.0';

export const instagramConfigured = () =>
  Boolean(process.env.IG_USER_ID && process.env.IG_ACCESS_TOKEN && process.env.CARD_PUBLIC_BASE_URL);

export class InstagramError extends Error {
  constructor(message, { step, code, subcode } = {}) {
    super(message);
    this.step = step;
    this.code = code;
    this.subcode = subcode;
  }
}

async function graph(path, { method = 'GET', params = {}, step } = {}) {
  const token = process.env.IG_ACCESS_TOKEN;
  const url = new URL(`${GRAPH}/${VERSION}/${path}`);
  const body = new URLSearchParams({ ...params, access_token: token });

  let res;
  let json;
  try {
    res =
      method === 'GET'
        ? await fetch(`${url}?${body}`, { method: 'GET' })
        : await fetch(url, {
            method,
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body,
          });
    json = await res.json();
  } catch (e) {
    throw new InstagramError(`network error: ${e.message}`, { step });
  }

  if (!res.ok || json.error) {
    const err = json.error || {};
    throw new InstagramError(err.message || `HTTP ${res.status}`, {
      step,
      code: err.code,
      subcode: err.error_subcode,
    });
  }
  return json;
}

/**
 * How many posts are left in Instagram's rolling 24-hour window.
 *
 * The cap is 25. Worth asking before publishing rather than discovering it as a
 * failure mid-run — at two or three posts a day it should never bind, and if it
 * ever does, that is a signal something is wrong upstream.
 */
export async function remainingQuota() {
  const r = await graph(`${process.env.IG_USER_ID}/content_publishing_limit`, {
    params: { fields: 'quota_usage,config' },
    step: 'quota',
  });
  const row = r.data?.[0];
  if (!row) return null;
  const cap = row.config?.quota_total ?? 25;
  return Math.max(0, cap - (row.quota_usage ?? 0));
}

// Instagram fetches and processes the image asynchronously, so a creation_id is
// not immediately publishable. Publishing too early fails with a generic error;
// polling status_code turns that into an answer we can act on.
async function waitForContainer(creationId, { timeoutMs = 60_000, intervalMs = 3_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const r = await graph(creationId, { params: { fields: 'status_code,status' }, step: 'container_status' });
    if (r.status_code === 'FINISHED') return;
    if (r.status_code === 'ERROR' || r.status_code === 'EXPIRED') {
      throw new InstagramError(`container ${r.status_code}: ${r.status || 'no detail'}`, {
        step: 'container_status',
      });
    }
    if (Date.now() > deadline) {
      throw new InstagramError(`container still ${r.status_code} after ${timeoutMs}ms`, {
        step: 'container_status',
      });
    }
    await new Promise((res) => setTimeout(res, intervalMs));
  }
}

/**
 * Publish one card to Instagram.
 *
 * Refuses up front when it can't work, rather than failing between the two
 * steps — a half-completed publish is the one state with no clean recovery.
 */
export async function publishInstagram(cand) {
  if (!instagramConfigured()) {
    throw new InstagramError(
      'Instagram is not configured (needs IG_USER_ID, IG_ACCESS_TOKEN and CARD_PUBLIC_BASE_URL)',
      { step: 'config' }
    );
  }
  const imageUrl = cand.card?.url;
  if (!imageUrl) {
    throw new InstagramError('no public card URL — Instagram fetches the image itself', { step: 'config' });
  }
  if (!imageUrl.startsWith('https://')) {
    // Instagram will not fetch over plain http; catching it here names the real
    // problem instead of surfacing Graph's generic "media could not be fetched".
    throw new InstagramError(`card URL must be https (got ${imageUrl})`, { step: 'config' });
  }

  const igUser = process.env.IG_USER_ID;

  const created = await graph(`${igUser}/media`, {
    method: 'POST',
    params: { image_url: imageUrl, caption: cand.instagramCaption || '' },
    step: 'create_container',
  });
  if (!created.id) throw new InstagramError('no creation_id returned', { step: 'create_container' });

  await waitForContainer(created.id);

  const published = await graph(`${igUser}/media_publish`, {
    method: 'POST',
    params: { creation_id: created.id },
    step: 'publish',
  });

  return { mediaId: published.id, creationId: created.id, imageUrl };
}
