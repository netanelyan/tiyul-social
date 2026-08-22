import { pillarHe } from './pillars.js';
import { LAYOUT_HE } from './render/templates.js';
import { provenanceHe } from './images.js';

// Two different texts, for two different readers.
//
//   approvalMessage() — for you, before anything publishes. Everything you need
//                       to make the call, including the source URL, every time.
//   channelCaption()  — for the channel and for Instagram, after you approve.
//
// Deliberately kept apart: the approval card carries provenance, evidence and
// quota state that have no business in a published post, and the published post
// must never quietly gain something you didn't see.

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/**
 * The caption that actually publishes.
 *
 * The source link goes out with the post too, not only in the approval message —
 * a claim is worth as much as the reader's ability to check it.
 */
export function channelCaption(cand) {
  const brand = process.env.BRAND_NAME || 'טיול+';
  const lines = [clean(cand.headline), '', String(cand.caption || '').trim()];

  if (cand.sourceUrl) lines.push('', `מקור: ${cand.sourceUrl}`);
  if (brand) lines.push('', brand);

  return lines.join('\n').trim();
}

/** Instagram has no clickable links in captions, so the URL is written out plainly. */
export function instagramCaption(cand) {
  const brand = process.env.BRAND_NAME || 'טיול+';
  const parts = [clean(cand.headline), '', String(cand.caption || '').trim()];
  if (cand.sourceUrl) parts.push('', `מקור: ${cand.sourceUrl}`);
  if (brand) parts.push('', brand);
  return parts.join('\n').trim().slice(0, 2200); // IG caption limit
}

/**
 * The staging card.
 *
 * No parse_mode is used for this message anywhere in the bot — a headline or a
 * source URL containing `*`, `_` or a backtick would break Telegram's Markdown
 * parser, and the failure mode there is a message that doesn't send at all.
 * BrickDeal hit exactly this and worked around it with a fallback; not asking
 * for Markdown in the first place is simpler and can't fail.
 */
export function approvalMessage(cand) {
  const lines = [];

  lines.push(`${LAYOUT_HE[cand.layout] || cand.layout} · ${pillarHe(cand.pillar)}`);
  if (cand.tags?.length) lines.push(`תגיות: ${cand.tags.join(', ')}`);
  lines.push('');

  lines.push(clean(cand.headline));
  if (cand.subhead) lines.push(clean(cand.subhead));
  lines.push('');

  if (cand.caption) {
    lines.push(String(cand.caption).trim());
    lines.push('');
  }

  // The rule is "the source URL is always in the approval message" — so it is
  // pushed unconditionally, on its own line, never truncated and never folded
  // into a link label that would hide where it actually points.
  lines.push(`🔗 מקור: ${cand.sourceUrl}`);
  lines.push(`   (${cand.sourceName})`);

  // Which of the three permitted origins this image came from — or that there
  // is no image at all, which for a text-led card is the expected answer.
  lines.push(
    cand.image
      ? `🖼️ תמונה: ${provenanceHe(cand.image.provenance)}${cand.image.credit ? ` · ${cand.image.credit}` : ''}`
      : '🖼️ תמונה: אין — כרטיס טקסט בלבד'
  );

  const n = cand.evidence?.length || 0;
  lines.push(`✅ ${n} ציטוט${n === 1 ? '' : 'ים'} אומת${n === 1 ? '' : 'ו'} מול דף המקור`);

  if (cand.instagramReady === false) {
    lines.push('⚠️ אינסטגרם לא מוגדר — יפורסם לטלגרם בלבד');
  }

  return lines.join('\n');
}

/** Shown after you tap — the card is rewritten in place so a decision is visible. */
export function decidedMessage(statusLine, cand) {
  return `${statusLine}\n\n${approvalMessage(cand)}`;
}

/** The evidence itself, on demand — `/why` shows counts, this shows the quotes. */
export function evidenceReport(cand) {
  if (!cand.evidence?.length) return 'אין ציטוטים שמורים לפריט הזה';
  const lines = cand.evidence.map(
    (e, i) => `${i + 1}. ${e.claim}\n   « ${String(e.quote).slice(0, 300)} »`
  );
  return `📎 הציטוטים מדף המקור:\n${cand.sourceUrl}\n\n${lines.join('\n\n')}`;
}
