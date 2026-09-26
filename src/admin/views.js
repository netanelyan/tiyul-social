import { statSync } from 'node:fs';
import { join } from 'node:path';
import { approvalMessage } from '../format.js';
import { allowedForKind } from '../publish/targets.js';
import { privacyHe } from '../publish/tiktok.js';
import { cardOutputDir } from '../render/index.js';

// Turning a candidate into what the admin page needs, and nothing more.
//
// Its own file because these are the only part of the bridge that is pure — a
// candidate in, a plain object out — and they were the part with a bug in it
// that nothing could reach. Inside bot.js they were untestable by construction:
// importing bot.js launches a Telegram bot, so the only available check was
// reading the source as a string.
//
// The bug, for the record: the queue's picture was chosen with
// `slides.slice(0, 1) || [cardFile]`, and an empty array is TRUTHY, so the
// fallback never ran once. Every card in the queue came back with no picture
// while the code read as though it had one. It is now an explicit length check
// and there is a test.

/**
 * A reference the page can fetch back through /api/media, or null.
 *
 * The basename, plus the file's modification time as `?v=`.
 *
 * THE VERSION IS WHAT STOPS A STALE PICTURE. A rendered card's filename is
 * derived from its candidate id and nothing else, so editing a headline
 * re-renders OVER the old file at the same name. The browser already has that
 * URL in memory from the image it drew a second ago, and `cache-control:
 * no-store` is honoured inconsistently for an <img> re-created inside the same
 * page — so the text under the card updates and the picture does not, which is
 * exactly the mismatch you would then spend an hour looking for in the renderer.
 *
 * Keyed on mtime rather than on a counter, so the URL changes if and only if the
 * bytes did. One stat per picture per poll, which is microseconds.
 *
 * A file that is not there still returns its name: the page draws its "not
 * found" panel when the fetch 404s, which is a better answer than omitting the
 * picture and implying the post never had one.
 */
export function mediaName(file, { dir = null } = {}) {
  if (!file) return null;
  const name = String(file).split(/[\\/]/).pop();
  try {
    return `${name}?v=${Math.round(statSync(join(dir || cardOutputDir(), name)).mtimeMs)}`;
  } catch {
    return name;
  }
}

/** What this post will actually publish to: what it owes, filtered by its kind. */
const owed = (c) =>
  (c.pendingTargets?.length ? c.pendingTargets : c.publishTargets || []).filter((t) =>
    allowedForKind(c.kind).includes(t)
  );

/**
 * One pending item, as the page needs it.
 *
 * `text` is the Hebrew approval block Telegram shows, verbatim. Deliberately not
 * re-implemented: two renderings of the same card is two things to keep in step,
 * and the one that falls behind is whichever is read less. The structured fields
 * beside it are only what the text cannot carry — which pictures to show, and
 * which buttons are legal for this kind.
 */
export function stagedView({ key, cand }, opts = {}) {
  const slides = (cand.deck?.preview || []).map((s) => mediaName(s.file, opts)).filter(Boolean);
  return {
    key,
    id: cand.id,
    kind: cand.kind || 'card',
    headline: cand.headline || '',
    text: approvalMessage(cand),
    createdAt: cand.createdAt || null,
    // Media, in the order it would publish. A clip is a video and everything
    // else is stills, which the page needs to know before it can choose a tag.
    //
    // A deck shows every slide, because a deck IS the sequence and approving one
    // you have only seen the cover of is how a broken third slide goes out. The
    // queue shows one — see queuedView.
    video: cand.kind === 'clip' ? mediaName(cand.clip?.file, opts) : null,
    images:
      cand.kind === 'clip' ? [] : slides.length ? slides : [mediaName(cand.card?.file, opts)].filter(Boolean),
    targets: owed(cand),
    draft: Boolean(cand.tiktokDraft),
    // Which controls to draw. The same rules stagingButtons applies, answered
    // once here rather than guessed at in the browser — a page that offers a
    // button the server refuses is a page that looks broken.
    canRetitle: cand.kind !== 'deck' && cand.kind !== 'clip' && cand.kind !== 'plan',
    canSeeEvidence: cand.kind !== 'clip' && cand.kind !== 'plan',
    privacy: cand.tiktok?.options?.length > 1 ? privacyHe(cand.tiktok.privacy) : null,
    sourceName: cand.sourceName || null,
    sourceUrl: cand.sourceUrl || null,
  };
}

/**
 * One queued post, as the page needs it.
 *
 * THE COVER ONLY. A queue is a list to scan, not a thing to review — that
 * already happened at approval — so one picture each, and a deck's cover is the
 * one that identifies it.
 */
export function queuedView(c, i, opts = {}) {
  const slides = (c.deck?.preview || []).map((s) => mediaName(s.file, opts)).filter(Boolean);
  const targets = owed(c);
  return {
    n: i + 1,
    id: c.id,
    kind: c.kind || 'card',
    headline: c.headline || '',
    video: c.kind === 'clip' ? mediaName(c.clip?.file, opts) : null,
    images: c.kind === 'clip' ? [] : slides.length ? [slides[0]] : [mediaName(c.card?.file, opts)].filter(Boolean),
    targets,
    // Only when TikTok is still owed. Approval sends the draft immediately and
    // queues the rest, so calling the remainder "draft" describes a handoff that
    // already happened.
    draft: Boolean(c.tiktokDraft) && targets.includes('tiktok'),
  };
}

/** One held post: what it still owes and why it is stuck. */
export const heldView = (h, i) => ({
  n: i + 1,
  headline: h.cand?.headline || '',
  kind: h.cand?.kind || 'card',
  missing: h.targets || [],
  error: h.error || null,
});
