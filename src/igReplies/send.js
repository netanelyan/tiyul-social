import { postConfig } from '../postConfig.js';
import { authMode, currentToken } from '../publish/instagram.js';

// Sending the one DM a comment earns.
//
// Meta calls this a "private reply": an account may answer a comment on its
// own post with exactly one direct message, within seven days of the comment
// being made. It is the only route from a feed post to a tappable link that
// Instagram offers, which is why it exists here at all - a caption cannot
// carry one, a slide cannot carry one, and the bio is a second tap the viewer
// has to decide to make.
//
// WHAT WAS CHECKED AGAINST META'S DOCS ON 2026-09-28, AND WHAT DID NOT AGREE.
//
// The endpoint and the body are consistent across both pages and match what
// the owner specified: POST /<IG_USER_ID>/messages with a `recipient` of
// {comment_id} and a `message` of {text}. The permissions are NOT consistent.
// The Private Replies page lists instagram_business_basic and
// instagram_business_manage_comments; the Messaging API page lists
// instagram_business_basic and instagram_business_manage_messages. They are
// describing the same call.
//
// The reading this code is written to is that all three are needed: messages
// to send, comments to receive the webhook and post the public reply. Asking
// for a permission that turns out to be unnecessary costs a line in the app
// review; missing one fails at runtime with an OAuth error that names a scope
// rather than the thing it was needed for.
//
// ADVANCED ACCESS IS AN OPEN QUESTION AND IT IS DELIBERATELY NOT ANSWERED
// HERE. Meta's rule is that Advanced Access is required when an app "serves
// Instagram professional accounts you don't own or manage". This app serves
// one account, its owner's, which argues Standard is enough - but the people
// being messaged are strangers, and no page found says plainly which side of
// the line that falls. It is checkable in the App Dashboard under App Review
// and it decides whether this works for real commenters or only for people
// with a role on the app. Until somebody looks, this code is correct and may
// be unusable, which is a better state than code written around a guess.

const VER = process.env.IG_API_VERSION || 'v21.0';

export class ReplyError extends Error {
  constructor(message, { step, code, subcode } = {}) {
    super(message);
    this.step = step;
    this.code = code;
    this.subcode = subcode;
  }
}

/** Where a private reply is sent, which is not where a post is published. */
export function messagesEndpoint() {
  if (authMode() === 'facebook') {
    // Facebook Login mode: the PAGE sends the message, not the Instagram user,
    // and it needs a Page token rather than the Instagram one. Supported here
    // because the repo already supports both auth modes for publishing and a
    // half-supported mode is worse than an unsupported one, but untested
    // against a live Page: the account this runs on is in Instagram Login mode.
    const page = process.env.IG_PAGE_ID;
    if (!page) throw new ReplyError('IG_AUTH=facebook needs IG_PAGE_ID', { step: 'config' });
    return `https://graph.facebook.com/${VER}/${page}/messages`;
  }
  const user = process.env.IG_USER_ID;
  if (!user) throw new ReplyError('IG_USER_ID is not set', { step: 'config' });
  return `https://graph.instagram.com/${VER}/${user}/messages`;
}

/**
 * The page link, tagged so the traffic can be told apart.
 *
 * The campaign is the CANDIDATE id rather than the destination, because the
 * question worth answering later is "which post earned this", and two posts
 * about Prague are different posts. Built here rather than in the config for
 * the same reason: a hardcoded link in post-config.json would be one campaign
 * for everything, which is the same as none.
 */
export function linkFor(slug, candidateId, { base = process.env.TIYULPLUS_BASE || 'https://www.tiyulplus.com' } = {}) {
  const cfg = postConfig().igReplies;
  const u = new URL(`${base.replace(/\/$/, '')}/destinations/${encodeURIComponent(slug)}`);
  u.searchParams.set('utm_source', cfg.utmSource);
  u.searchParams.set('utm_medium', cfg.utmMedium);
  if (candidateId) u.searchParams.set('utm_campaign', String(candidateId));
  return u.toString();
}

/** The message itself, with the link in it. */
export function replyText({ destHe, slug, candidateId }) {
  const cfg = postConfig().igReplies;
  return cfg.dmHe.replace(/\{dest\}/g, destHe || '').replace(/\{url\}/g, linkFor(slug, candidateId));
}

/**
 * One private reply.
 *
 * `fetchImpl` is injectable so the selftest can assert the request SHAPE -
 * host, path, headers, body - without a token and without messaging anybody.
 * That is the only part of this a test can hold: whether Meta accepts it is
 * not knowable offline, and a mock that pretended otherwise would be testing
 * its own fixture.
 */
export async function sendPrivateReply(
  { commentId, destHe, slug, candidateId },
  { fetchImpl = fetch, timeoutMs = 15_000 } = {}
) {
  if (!commentId) throw new ReplyError('no comment id', { step: 'args' });
  const token = currentToken();
  if (!token) throw new ReplyError('no Instagram token', { step: 'config' });

  const res = await fetchImpl(messagesEndpoint(), {
    method: 'POST',
    headers: {
      // A Bearer token, not the ?access_token= query parameter the publishing
      // path uses. Both are accepted by Graph, and a token in a query string
      // ends up in access logs and in any proxy in front of this.
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      recipient: { comment_id: String(commentId) },
      message: { text: replyText({ destHe, slug, candidateId }) },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.error) {
    const e = body?.error || {};
    throw new ReplyError(e.message || `HTTP ${res.status}`, {
      step: 'send',
      code: e.code,
      subcode: e.error_subcode,
    });
  }
  return { id: body.message_id || body.id || null };
}

/**
 * The public "we sent it" comment, which is optional and is not the point.
 *
 * It exists so the thread SHOWS that asking works. A comment thread where
 * three people asked and nothing visibly happened teaches the fourth person
 * not to bother, and the DM that did go out is invisible to everybody except
 * the person who got it.
 *
 * Failure here is swallowed by the caller on purpose: the DM is the promise
 * and this is the receipt, and a receipt that did not print is not a reason to
 * report the delivery as failed.
 */
export async function sendPublicReply(commentId, { fetchImpl = fetch, timeoutMs = 15_000 } = {}) {
  const text = postConfig().igReplies.publicReplyHe;
  if (!text) return null;
  const token = currentToken();
  if (!token) throw new ReplyError('no Instagram token', { step: 'config' });

  const host = authMode() === 'facebook' ? 'https://graph.facebook.com' : 'https://graph.instagram.com';
  const res = await fetchImpl(`${host}/${VER}/${encodeURIComponent(commentId)}/replies`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ message: text }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.error) {
    throw new ReplyError(body?.error?.message || `HTTP ${res.status}`, { step: 'public' });
  }
  return { id: body.id || null };
}
