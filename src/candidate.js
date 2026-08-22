import { createHash } from 'node:crypto';
import { verifySource, verifyEvidence, verifyDraftText, RejectedError } from './verify.js';
import { draft as draftPost } from './draft.js';
import { quotaBlock } from './pillars.js';
import { findImage, imagesEnabled } from './images.js';
import { renderCard } from './render/index.js';
import { isPhotoLayout, PHOTO_FALLBACK } from './render/templates.js';
import { channelCaption, instagramCaption } from './format.js';
import { publishTargets } from './publish/targets.js';
import { recordWasted } from './usage.js';

// One source item all the way to a stageable candidate.
//
// The order of the gates is the point. Verification of the source happens
// BEFORE the drafting call, so an unreachable page or a non-primary domain
// costs nothing; evidence checking and the fare guard happen BEFORE rendering,
// so a rejected claim never reaches Chromium; the quota check happens before
// the image lookup and the render, which are the two expensive steps.
//
// The same reordering lesson BrickDeal learned about dedupe applies here in a
// different form: claim the id up front, before the slow calls, so two sources
// carrying the same story seconds apart can't both get drafted and staged.

export { RejectedError };

/** Stable per source URL, so the same story from the same page is one candidate. */
export function candidateId(item) {
  if (item.dedupeId) return item.dedupeId;
  let key;
  try {
    const u = new URL(item.url);
    u.hash = '';
    // Tracking parameters change per referral and would otherwise defeat dedupe.
    for (const p of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid']) {
      u.searchParams.delete(p);
    }
    key = u.toString();
  } catch {
    key = String(item.url);
  }
  return createHash('sha1').update(key).digest('hex').slice(0, 12);
}

/**
 * Build a candidate, or throw RejectedError with a reason you can read.
 *
 * Nothing here is silent: every throw carries a reason code that src/notify.js
 * turns into Hebrew for the skip digest. A filter you cannot see is a filter
 * you cannot disagree with.
 */
export async function toCandidate(item, opts = {}) {
  // Everything from the drafting call onward has already been paid for. If it
  // dies down there the money is spent either way, so it is counted as waste —
  // that number is what tells you whether the pre-draft gates are doing enough.
  try {
    return await build(item, opts);
  } catch (e) {
    if (e?.paidFor) recordWasted();
    throw e;
  }
}

async function build(item, { render = true } = {}) {
  const id = candidateId(item);

  // 1. Primary source, reachable, and still on the allowlist after redirects.
  const { sourceText, finalUrl, authority } = await verifySource(item);

  // 2. Hebrew copy + layout choice + the quotes that back every claim.
  let d;
  try {
    d = await draftPost(item, sourceText, { imagesAvailable: imagesEnabled() });
  } catch (e) {
    throw new RejectedError('draft_failed', e.message);
  }
  // From here down the call is already billed, so every exit is flagged as
  // paid-for on the way out. `not_usable` counts: the model read the page and
  // declined it, which is a correct answer we still paid full price for.
  try {
    return await afterDraft();
  } catch (e) {
    e.paidFor = true;
    throw e;
  }

  async function afterDraft() {
  if (!d.usable) throw new RejectedError('not_usable', d.rejectReason || 'the model declined this source');

  // 3. Every quote must literally appear in the page we fetched, and no fares.
  verifyEvidence(d, sourceText);
  verifyDraftText(d);

  // 4. Topic quotas — checked here rather than at publish time so a blocked
  //    candidate never occupies your attention in the first place.
  const blocked = quotaBlock(d);
  if (blocked) throw new RejectedError('quota', blocked);

  // 5. Image, if any provider is configured. v1 runs with none, so this is null
  //    and the layout choice already assumed as much.
  let image = null;
  if (imagesEnabled() && isPhotoLayout(d.layout)) {
    image = await findImage(d).catch(() => null);
  }
  if (isPhotoLayout(d.layout) && !image?.src) d.layout = PHOTO_FALLBACK;

  const cand = {
    id,
    ...d,
    sourceUrl: finalUrl,
    sourceName: item.sourceName,
    sourceId: item.sourceId,
    authority: authority.suffix,
    publishedAt: item.publishedAt || null,
    data: item.data || null,
    image,
    createdAt: new Date().toISOString(),
    publishTargets: publishTargets(),
  };

  // 6. Render last — it is the only step that costs a browser.
  if (render) {
    let card;
    try {
      card = await renderCard(cand, { id, data: cand.data, image });
    } catch (e) {
      throw new RejectedError('render_failed', e.message);
    }
    cand.card = card;
  }

  cand.channelCaption = channelCaption(cand);
  cand.instagramCaption = instagramCaption(cand);

  return cand;
  }
}
