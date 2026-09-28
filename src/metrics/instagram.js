import * as store from '../store.js';

// What a post actually did on Instagram.
//
// RANKED ON SAVES AND SHARES, NOT LIKES, and that is the whole reason this module
// exists rather than a line in a log. The evidence this change was built on is a table
// of saves and shares per like: every post that worked runs at 47 to 95% saves per like
// and 19 to 52% shares, and our own best deck ran at 22% and zero. Likes track how
// pretty a photograph is. Saves track whether somebody is planning a trip, which is the
// only thing this account is for.
//
// SO THE NUMBERS THAT MATTER ARE PER VIEW, NOT PER POST. A post with 40 saves off
// 20,000 views did worse than one with 12 off 400, and ranking by the raw count says
// the opposite. Everything here is stored raw and divided at report time.
//
// WHAT THE TOKEN WE HOLD CAN ACTUALLY ANSWER. Instagram's media insights are available
// on the account's own media with the token the publisher already uses - no new scope,
// no new app review. `saved`, `shares`, `reach` and `views` are all supported on a
// CAROUSEL_ALBUM, which is what every post here is.

const VERSION = process.env.GRAPH_API_VERSION || 'v21.0';
const authMode = () => (process.env.IG_AUTH_MODE || 'facebook').toLowerCase();
const HOST = () => (authMode() === 'facebook' ? 'https://graph.facebook.com' : 'https://graph.instagram.com');

/**
 * The metrics asked for, and why these four.
 *
 * `views` replaced `impressions` for media created after July 2024 and the old name now
 * errors on new media, so it is the one asked for. `reach` is people rather than plays.
 * `saved` and `shares` are the two the whole ranking is built on.
 *
 * `total_interactions` is deliberately NOT here. It is likes plus comments plus saves
 * plus shares in one number, which is precisely the aggregate that hides the
 * distinction this account needs to see.
 */
export const METRICS = ['views', 'reach', 'saved', 'shares', 'likes', 'comments'];

export class MetricsError extends Error {
  constructor(message, { step, mediaId } = {}) {
    super(message);
    this.name = 'MetricsError';
    this.step = step;
    this.mediaId = mediaId;
  }
}

/** Whether this can run at all. The same token the publisher uses. */
export const configured = () => Boolean(store.getIgToken()?.token && process.env.IG_USER_ID);

async function graph(path, params, { timeoutMs = 20_000 } = {}) {
  const token = store.getIgToken()?.token;
  if (!token) throw new MetricsError('no Instagram token', { step: 'auth' });
  const qs = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`${HOST()}/${VERSION}/${path}?${qs}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.error) {
    const e = body?.error || {};
    throw new MetricsError(`${e.message || `HTTP ${res.status}`}${e.code ? ` (code ${e.code})` : ''}`, {
      step: path.includes('insights') ? 'insights' : 'media',
    });
  }
  return body;
}

/**
 * The account's recent media, newest first.
 *
 * Asked for by page rather than all at once: the nightly job only needs what was
 * published since it last ran, and a full history is thousands of rows that will never
 * change again.
 */
export async function recentMedia({ limit = 25 } = {}) {
  const body = await graph(`${process.env.IG_USER_ID}/media`, {
    fields: 'id,media_type,media_product_type,caption,permalink,timestamp',
    limit: String(Math.max(1, Math.min(100, limit))),
  });
  return (body?.data || []).map((m) => ({
    mediaId: String(m.id),
    type: String(m.media_type || ''),
    permalink: m.permalink || null,
    at: m.timestamp || null,
    caption: m.caption || '',
  }));
}

/**
 * The insights for one media item.
 *
 * A METRIC THAT IS NOT SUPPORTED FOR THIS MEDIA TYPE IS AN ERROR, NOT A ZERO, and Meta
 * returns it as an error for the whole request rather than per metric. So an
 * unsupported name would lose every number in the call - which is the failure mode that
 * makes "we have metrics" quietly false. Asked for one at a time would be six requests
 * per post; asked for together with a retry that drops the offender is one request in
 * the ordinary case and two when Meta changes something.
 */
export async function insightsFor(mediaId, { metrics = METRICS } = {}) {
  const ask = async (names) => {
    const body = await graph(`${mediaId}/insights`, { metric: names.join(',') });
    const out = {};
    for (const row of body?.data || []) {
      const value = row?.values?.[0]?.value;
      if (Number.isFinite(Number(value))) out[row.name] = Number(value);
    }
    return out;
  };

  try {
    return await ask(metrics);
  } catch (e) {
    // Name the metric Meta objected to and try again without it, so one deprecated
    // field does not cost the other five.
    const blamed = metrics.filter((m) => String(e.message).includes(m));
    if (!blamed.length || blamed.length === metrics.length) throw e;
    const left = metrics.filter((m) => !blamed.includes(m));
    console.log(`metrics: Instagram refused ${blamed.join(', ')} - asking for the rest`);
    const got = await ask(left);
    return { ...got, _unsupported: blamed };
  }
}

/**
 * Everything the nightly job needs for one media item.
 *
 * Returns null rather than throwing for a media item whose insights are simply not
 * available yet - Meta publishes them some minutes after the post goes live, and a
 * nightly job that ran too soon should come back tomorrow rather than record zeros.
 * A zero recorded is indistinguishable from a post nobody saw.
 */
export async function statsFor(mediaId) {
  try {
    const got = await insightsFor(mediaId);
    if (!Object.keys(got).filter((k) => !k.startsWith('_')).length) return null;
    return {
      views: got.views ?? null,
      reach: got.reach ?? null,
      saved: got.saved ?? null,
      shares: got.shares ?? null,
      likes: got.likes ?? null,
      comments: got.comments ?? null,
      unsupported: got._unsupported || [],
    };
  } catch (e) {
    console.error(`metrics: no Instagram insights for ${mediaId} - ${e.message}`);
    return null;
  }
}
