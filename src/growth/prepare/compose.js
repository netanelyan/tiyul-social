import { destinationPage, plainLink, SITE } from '../links.js';
import { checkDraft } from './guards.js';
import { routeProblem } from '../rules.js';
import { fill } from './templates.js';

// The text the owner copies, assembled at the moment it is shown.
//
// Stored drafts are what a model wrote: three variants per item, each with the
// skeptical reader's score (draft.js). A message's variant carries the link as
// [קישור], and the link is put in here, now: the route's page once it is
// published, the example page, or the page a customer asked for, as a short
// link when the site makes them and the plain page link until then. The
// follow-ups are templates, filled now.
//
// An owner's edit beats all of it: once [Edit] has saved a text for a variant,
// that text is what is shown and copied.

export const VARIANT_COUNT = 3;

/** The field an edit is stored under, per item and variant. */
export const fieldFor = (lead, what, i = 0, postId = null) => {
  if (what === 'comment') return `comment:${postId}:${i}`;
  if (what === 'followup') return 'followup';
  return `${what}:${i}`;
};

/**
 * The video a creator's first message is about: the one it was drafted from,
 * else the one the owner commented on, else their best-scored video that was
 * not skipped. The route is built from it and the card shows it.
 */
export function messagePost(lead) {
  const posts = lead.posts || [];
  const drafted = lead.drafts?.dm?.postId && posts.find((p) => p.id === lead.drafts.dm.postId);
  if (drafted) return drafted;
  const commented = posts.find((p) => p.status === 'commented');
  if (commented) return commented;
  const usable = posts.filter((p) => p.status !== 'skipped');
  return [...(usable.length ? usable : posts)].sort((a, b) => (b.score || 0) - (a.score || 0))[0] || null;
}

/** The drafts record for an item, in today's shape (old records had no variants). */
export function draftsFor(lead, what, postId = null) {
  if (what === 'comment') {
    const d = (lead.posts || []).find((p) => p.id === postId)?.drafts;
    if (d?.variants) return d;
    // A comment drafted before 2026-10-11: two plain strings, no scores.
    return d?.comments?.length ? { variants: d.comments.map((text) => ({ text, score: null, tells: [] })), legacy: true } : null;
  }
  const d = lead.drafts?.[what];
  return d?.variants ? d : null;
}

/** The page this item links to, in full, or null. */
export function targetFor(lead, what, { state } = {}) {
  if (lead.type === 'creator' && what === 'dm') {
    return lead.trip?.status === 'published' && lead.trip.url ? lead.trip.url : null;
  }
  if (lead.type === 'agency' && what === 'message') {
    if (lead.trip?.status === 'published' && lead.trip.url) return lead.trip.url;
    if (lead.example?.kind === 'route') return null;
    return lead.agencyDest?.path ? `${SITE}${lead.agencyDest.path}` : null;
  }
  if (lead.type === 'customer' && what === 'reply' && lead.dest?.slug) {
    const post = (lead.posts || [])[0];
    if (!post?.asksForRoute) return null;
    return `${SITE}${destinationPage(state?.site?.itineraries, lead.dest.slug, post.days || 5)}`;
  }
  return null;
}

/** The one link a message may carry, as it will be sent: short when the site made one, else plain. */
export function linkFor(lead, what, { state } = {}) {
  const url = targetFor(lead, what, { state });
  if (!url) return null;
  const plain = plainLink(url);
  return lead.links?.[plain]?.short || plain;
}

/** Why an item's link is not there yet, in plain words, or null. */
function linkMissing(lead, what) {
  const t = lead.trip;
  if (t?.status === 'waiting-limit' || t?.status === 'failed' || t?.status === 'no-route') return t.reason;
  if (lead.type === 'creator') return 'The route is not on the site yet.';
  if (lead.type === 'agency' && what === 'message') return lead.example ? 'The example route is not on the site yet.' : 'The example is not chosen yet.';
  return null;
}

/**
 * The full text for one item and variant.
 *
 * what: 'dm' | 'followup' | 'message' | 'reply' | 'comment' (with postId)
 * i:    the variant
 * Returns { text, link, edited, missing, variant, subject } where `missing`
 * names anything that keeps the text from being sendable, `variant` is the
 * stored variant (its score, tells and specific detail) or null, and `subject`
 * is an email's subject line, or ''.
 */
export function compose(lead, what, { templates, settings, state, i = 0, postId = null } = {}) {
  const field = fieldFor(lead, what, i, postId);
  const link = what === 'followup' || what === 'comment' ? null : linkFor(lead, what, { state });
  const edited = lead.edits?.[field];
  const missing = [];
  let variant = null;
  let text = '';

  if (what === 'followup') {
    text = fill(templates[lead.type === 'agency' ? 'agency-followup' : 'creator-followup'], { gender: lead.type === 'agency' ? 'unknown' : lead.gender });
  } else {
    const d = draftsFor(lead, what, postId);
    variant = d?.variants?.[i] || null;
    text = variant?.text || '';
    if (!text) missing.push('Not drafted yet.');
    // An agency's first message waits for its sample route to pass the check
    // (./routeCheck.js); that reason replaces "not on the site yet", which a
    // failed route never will be.
    const route = lead.type === 'agency' && what === 'message' ? routeProblem(lead) : null;
    if (route) missing.push(route);
    if (what === 'dm' || what === 'message') {
      if (!link && !route) missing.push(linkMissing(lead, what) || 'No link yet.');
      text = text.replaceAll('[קישור]', link || '[קישור]');
    }
    if (what === 'reply' && text) {
      const linkLine = link ? fill(templates['customer-link'], { dest: lead.dest?.he, link, gender: lead.gender }) : '';
      text = [text, linkLine].filter(Boolean).join('\n\n');
    }
  }

  const subject = variant?.subject || '';
  if (edited != null) return { text: edited, link, edited: true, missing: missing.filter((m) => m !== 'Not drafted yet.'), variant, subject };
  return { text, link, edited: false, missing, variant, subject };
}

/**
 * Checks for an owner's edit before it is saved: no URL but ours, no long dash.
 * The number rule and the bot tells are for model output; the owner's own
 * words are theirs, and a tell in them is shown as a warning, not refused.
 */
export function checkEdit(lead, what, text, { state } = {}) {
  const link = linkFor(lead, what, { state });
  const kind = what === 'comment' ? 'comment' : what === 'reply' ? 'reply' : 'message';
  return checkDraft(text, { kind, link, sources: [String(text)], tells: false });
}

/** The tells in an owner's edit, as warnings for the card. */
export function editWarnings(lead, what, text, { state } = {}) {
  const link = linkFor(lead, what, { state });
  const kind = what === 'comment' ? 'comment' : what === 'reply' ? 'reply' : what === 'followup' ? 'followup' : 'message';
  return checkDraft(text, { kind, link, sources: [String(text)], gender: lead.type === 'agency' ? 'unknown' : lead.gender }).filter((p) => !/number that is not/.test(p));
}
