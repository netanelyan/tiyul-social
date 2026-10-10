import { destinationPage, isMobile, SITE, tagged } from '../links.js';
import { checkDraft } from './guards.js';
import { fill } from './templates.js';

// The text the owner copies, assembled at the moment it is shown.
//
// Stored drafts are only the parts a model wrote (the personal line, the
// comments, a customer reply). The rest is the template as it is on disk now,
// filled now, with the gender the toggle says now. So editing a template in
// Settings changes every unsent message at once, and the toggle costs nothing.
//
// An owner's edit beats all of it: once [ערוך] has saved a text, that text is
// what is shown and copied.

/** The field name an edit is stored under, per item. */
export const fieldFor = (lead, what, i = null, postId = null) => {
  if (what === 'comment') return `comment:${postId}:${i}`;
  return what;
};

const messagePost = (lead) =>
  (lead.posts || []).find((p) => p.status === 'commented') || (lead.posts || [])[0] || null;

/** The agency's channel decides utm_medium: WhatsApp, or email. */
export const agencyMedium = (lead) => (lead.whatsapp || isMobile(lead.phone) ? 'whatsapp' : lead.email ? 'email' : 'website');

/** The one link a message may carry, already tagged, or null. */
export function linkFor(lead, what, { state } = {}) {
  if (lead.type === 'creator' && what === 'dm') {
    return lead.trip?.status === 'published' && lead.trip.url ? tagged(lead.trip.url, lead) : null;
  }
  if (lead.type === 'agency' && what === 'message' && lead.agencyDest) {
    return tagged(`${SITE}${lead.agencyDest.path}`, lead, { medium: agencyMedium(lead) });
  }
  if (lead.type === 'customer' && what === 'reply' && lead.dest?.slug) {
    const post = (lead.posts || [])[0];
    if (!post?.asksForRoute) return null;
    return tagged(`${SITE}${destinationPage(state?.site?.itineraries, lead.dest.slug, post.days || 5)}`, lead);
  }
  return null;
}

/**
 * The full text for one item.
 *
 * what: 'dm' | 'followup' | 'message' | 'reply' | 'comment' (with i and postId)
 * Returns { text, link, edited, missing } where `missing` names anything that
 * keeps the text from being sendable (a link the site cannot make yet, a draft
 * that has not been written).
 */
export function compose(lead, what, { templates, settings, state, i = 0, postId = null } = {}) {
  const field = fieldFor(lead, what, i, postId);
  const link = linkFor(lead, what, { state });
  const edited = lead.edits?.[field];
  const missing = [];

  let text = '';
  if (what === 'comment') {
    const post = (lead.posts || []).find((p) => p.id === postId);
    text = post?.drafts?.comments?.[i] || '';
    if (!text) missing.push('התגובה עוד לא נוסחה');
  } else if (what === 'dm') {
    const post = messagePost(lead);
    const d = lead.drafts?.dm || {};
    text = fill(templates.creator, {
      name: d.name,
      dest: post?.dest?.he || lead.dest?.he,
      line: d.line,
      link,
      gift: settings.offers.creator,
      gender: lead.gender,
      demand: Boolean(post?.routeDemand || lead.routeDemand),
    });
    if (!lead.drafts?.dm) missing.push('השורה האישית עוד לא נוסחה');
    if (!link) missing.push(lead.trip?.reason || 'אין עדיין קישור למסלול');
  } else if (what === 'followup') {
    text = fill(templates[lead.type === 'agency' ? 'agency-followup' : 'creator-followup'], { gender: lead.gender });
  } else if (what === 'message') {
    text = fill(templates.agency, { dest: lead.agencyDest?.he, link, gift: settings.offers.agency, gender: lead.gender });
    if (!link) missing.push('עוד לא נבחר מסלול דוגמה');
  } else if (what === 'reply') {
    const reply = lead.drafts?.reply || '';
    if (!reply) missing.push('התגובה עוד לא נוסחה');
    const linkLine = link ? fill(templates['customer-link'], { dest: lead.dest?.he, link, gender: lead.gender }) : '';
    text = [reply, linkLine].filter(Boolean).join('\n\n');
  }

  if (edited != null) return { text: edited, link, edited: true, missing: missing.filter((m) => !/נוסח/.test(m)) };
  return { text, link, edited: false, missing };
}

/**
 * Checks for an owner's edit before it is saved: no URL but ours, no long dash.
 * The number rule is for model output; the owner's own words are theirs.
 */
export function checkEdit(lead, what, text, { state } = {}) {
  const link = linkFor(lead, what, { state });
  const kind = what === 'comment' ? 'comment' : what === 'reply' ? 'reply' : 'message';
  return checkDraft(text, { kind, link, sources: [String(text)] }).filter((p) => !/^מספר/.test(p) && !/ארוך מדי/.test(p));
}
