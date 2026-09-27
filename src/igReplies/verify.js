import { createHmac, timingSafeEqual } from 'node:crypto';

// Is this delivery actually from Meta?
//
// The endpoint is reachable from the internet through Caddy, and everything
// behind it sends a DM to a stranger. Without this check, anybody who learns
// the URL can hand the bot a comment id of their choosing and have the account
// message whoever they like, which is an account ban rather than a bug.
//
// TWO THINGS THAT LOOK LIKE DETAILS AND ARE NOT.
//
// The signature is over the RAW BODY BYTES. JSON.parse followed by
// JSON.stringify produces different bytes for the same document - key order,
// whitespace, unicode escaping - so a handler that parses first and verifies
// second rejects every genuine delivery and cannot be debugged from the
// symptom. The body is read as a Buffer and kept.
//
// And the comparison is constant time. A byte-by-byte === leaks how much of a
// guessed signature was right through how long the comparison took, which is
// enough to forge one given patience. timingSafeEqual throws on a length
// mismatch rather than returning false, so the lengths are checked first.

/** The header Meta sends, and the only one this accepts. */
export const SIG_HEADER = 'x-hub-signature-256';

/**
 * Verify a raw body against the app secret.
 *
 * `raw` must be the bytes as received. Returns true or false and never throws:
 * a malformed header is an unauthenticated request, not an exception, and the
 * caller's answer to both is 403.
 */
export function verifySignature(raw, header, secret) {
  if (!secret || !header) return false;

  const got = String(header).trim();
  if (!got.startsWith('sha256=')) return false;

  let theirs;
  try {
    theirs = Buffer.from(got.slice('sha256='.length), 'hex');
  } catch {
    return false;
  }
  // A hex string of the wrong length, or one with non-hex in it, produces a
  // short buffer rather than an error. Checked before timingSafeEqual, which
  // throws on unequal lengths.
  if (theirs.length !== 32) return false;

  const ours = createHmac('sha256', secret)
    .update(Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), 'utf8'))
    .digest();

  return timingSafeEqual(ours, theirs);
}
