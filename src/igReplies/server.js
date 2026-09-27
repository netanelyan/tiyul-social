import { createServer } from 'node:http';
import { postConfig } from '../postConfig.js';
import * as store from '../store.js';
import { verifySignature, SIG_HEADER } from './verify.js';
import { asksForLink } from './match.js';
import { sendPrivateReply, sendPublicReply } from './send.js';

// The listener Meta posts comments to.
//
// Bound to 127.0.0.1 like src/oauthServer.js and for the same reason: Caddy
// terminates TLS and proxies one path through, so nothing here is exposed to
// the internet except what the reverse proxy chooses to forward. Binding
// 0.0.0.0 would publish an endpoint that sends DMs to strangers on the say-so
// of whoever finds the port.
//
// WHAT THIS HAS TO GET RIGHT, in the order the failures cost.
//
// 1. Verify before doing anything. Covered in ./verify.js.
// 2. Answer 200 FAST, then work. Meta redelivers anything it does not get a
//    prompt acknowledgement for, and the work here includes two HTTP calls to
//    Meta itself. Replying after the work turns every slow send into a second
//    delivery of the same comment.
// 3. Never answer twice. Covered by claiming in the store before sending, in
//    ./store.js - the claim is what makes a redelivery harmless rather than a
//    duplicate DM.
// 4. Never answer ourselves. The account's own public "שלחנו לך בהודעה" reply
//    is a comment on its own post and arrives back through this webhook, so an
//    unguarded version answers its own receipt, then answers the answer.
// 5. Never answer a post it has no record of. A generic reply to a comment on
//    an old post would send somebody a link to a page that post was not about.

const HOST = '127.0.0.1';
const PORT = Number(process.env.IG_WEBHOOK_PORT || 8788);

// A comment is a few hundred bytes. The cap is three orders of magnitude over
// anything real and exists so a body that never ends cannot hold a socket and
// memory open.
const MAX_BODY = 512 * 1024;

let server = null;

/** Read the raw bytes, refusing anything oversized. */
function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** The comment entries in one delivery, flattened, in the order they arrived. */
export function commentsIn(payload) {
  const out = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      if (change?.field !== 'comments') continue;
      const v = change.value || {};
      out.push({
        commentId: v.id || null,
        mediaId: v.media?.id || null,
        userId: v.from?.id || null,
        username: v.from?.username || '',
        text: v.text || '',
        parentId: v.parent_id || null,
      });
    }
  }
  return out.filter((c) => c.commentId && c.mediaId);
}

/**
 * Answer one comment, or explain why not.
 *
 * Returns a short reason string for the log rather than throwing, because
 * every one of these outcomes is ordinary and the loop above must carry on to
 * the next comment either way.
 */
export async function handleComment(c, { now = Date.now(), deps = {} } = {}) {
  const send = deps.sendPrivateReply || sendPrivateReply;
  const public_ = deps.sendPublicReply || sendPublicReply;
  const cfg = postConfig().igReplies;
  if (!cfg.on) return 'replies are off';

  // Our own comments, including our own receipts. `IG_USER_ID` is the account
  // this runs as, so a comment from that id is this program talking.
  if (c.userId && String(c.userId) === String(process.env.IG_USER_ID)) return 'our own comment';

  const post = store.igPost(c.mediaId);
  if (!post) return 'no record of that post';

  const hit = asksForLink(c.text, { destHe: post.destHe, keywords: cfg.keywords });
  if (!hit) return 'did not ask';

  if (store.igReplied(c.commentId, { mediaId: c.mediaId, userId: c.userId })) return 'already answered';

  // The cap is checked after the match so that an hour full of non-matching
  // comments does not count against it, and before the claim so a refusal
  // does not burn the comment's one chance at being answered later.
  if (store.igRepliesLastHour(now) >= cfg.hourlyCap) return `hourly cap (${cfg.hourlyCap}) reached`;

  if (!store.claimIgReply(c.commentId, { mediaId: c.mediaId, userId: c.userId })) return 'claimed by another delivery';

  try {
    await send({ commentId: c.commentId, destHe: post.destHe, slug: post.slug, candidateId: post.candidateId });
  } catch (e) {
    // Only a failure that happened before the request left is safe to undo.
    // Anything else might have been received, and a retry on a received
    // private reply is Meta's 2534014 at best and two DMs at worst.
    if (e.step === 'config' || e.step === 'args') {
      store.releaseIgReply(c.commentId, { mediaId: c.mediaId, userId: c.userId });
    }
    return `send failed: ${e.message}`;
  }

  // The receipt. Its failure is not the delivery's failure.
  await public_(c.commentId).catch(() => {});
  return `replied (${hit.why})`;
}

/**
 * Start listening, or do not start at all.
 *
 * Returns null when either secret is missing, exactly as startAdminServer
 * returns null with no users configured. A webhook that accepts unsigned
 * deliveries because the secret was not set is strictly worse than no webhook:
 * it is an open endpoint that sends direct messages.
 */
export function startIgWebhook({ port = PORT, onLog = console.log } = {}) {
  const secret = process.env.IG_APP_SECRET;
  const verify = process.env.IG_WEBHOOK_VERIFY_TOKEN;
  if (!secret || !verify) {
    onLog('ig webhook: off (needs IG_APP_SECRET and IG_WEBHOOK_VERIFY_TOKEN)');
    return null;
  }

  server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const done = (code, body = '') => {
      res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(body);
    };

    if (url.pathname !== '/ig/webhook') return done(404, 'not found');

    // The handshake. Meta calls this once when the subscription is created and
    // expects the challenge echoed back verbatim, as plain text.
    if (req.method === 'GET') {
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge') || '';
      if (mode === 'subscribe' && token === verify) {
        onLog('ig webhook: handshake ok');
        return done(200, challenge);
      }
      onLog('ig webhook: handshake refused (wrong verify token)');
      return done(403, 'forbidden');
    }

    if (req.method !== 'POST') return done(405, 'method not allowed');

    readBody(req)
      .then(async (raw) => {
        if (!verifySignature(raw, req.headers[SIG_HEADER], secret)) {
          onLog('ig webhook: bad signature');
          return done(403, 'forbidden');
        }

        // ACKNOWLEDGED FIRST. Everything below this line runs after Meta has
        // been told the delivery arrived, which is what stops a slow send
        // becoming a second delivery of the same comment.
        done(200, 'ok');

        let payload;
        try {
          payload = JSON.parse(raw.toString('utf8'));
        } catch {
          return onLog('ig webhook: body was not JSON');
        }

        // In order, and one at a time. Two comments answered concurrently
        // would both read the hourly count before either wrote to it.
        for (const c of commentsIn(payload)) {
          try {
            const why = await handleComment(c);
            onLog(`ig webhook: ${c.username || c.userId} on ${c.mediaId} - ${why}`);
          } catch (e) {
            onLog(`ig webhook: handler threw on ${c.commentId}: ${e.message}`);
          }
        }
      })
      .catch((e) => {
        if (!res.headersSent) done(413, 'too large');
        onLog(`ig webhook: ${e.message}`);
      });
  });

  server.listen(port, HOST, () => onLog(`ig webhook: listening on http://${HOST}:${port}/ig/webhook`));
  server.on('error', (e) => onLog(`ig webhook: ${e.message}`));
  return server;
}

export function stopIgWebhook() {
  server?.close();
  server = null;
}
