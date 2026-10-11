import { sendableNow } from '../schedule.js';
import { israelDate } from './plan.js';

// The slate's state, and the one rule that matters most: nothing posts without
// approval. Pure functions over a plain object the store keeps.
//
//   {
//     date, builtAt, approved, approvedBy, approvedAt, auto,
//     items: [{ n, key, cand, template, formatId, formatKind, note, tiktokAt, instagramAt, skipped,
//               tiktok: { status, ... }, instagram: { status, ... } }],
//     warnings: [], dropped: []
//   }
//
// A platform's status is 'planned' until the slate is approved, then 'approved',
// then 'published' or 'failed'; 'none' where the item has no slot on it.

export const STATUS_HE = { planned: 'ממתין לאישור', approved: 'מאושר', published: 'פורסם', failed: 'נכשל', none: '', skipped: 'דולג', expired: 'פג' };

export function newSlate({ date, items, autoApprove = false, warnings = [], dropped = [], now = Date.now() }) {
  const slate = {
    date,
    builtAt: new Date(now).toISOString(),
    approved: false,
    approvedBy: null,
    approvedAt: null,
    auto: Boolean(autoApprove),
    items: items.map((it, i) => ({
      n: i + 1,
      key: it.key,
      cand: it.cand,
      template: it.template,
      // The trend format it was built from, which recentFormatPicks reads back to
      // keep the 70/30 split; and a line for the digest (an inbox post says why it is there).
      formatId: it.formatId || null,
      formatKind: it.formatKind || null,
      note: it.note || null,
      tiktokAt: it.tiktokAt ? new Date(it.tiktokAt).toISOString() : null,
      instagramAt: it.instagramAt ? new Date(it.instagramAt).toISOString() : null,
      skipped: false,
      tiktok: { status: it.tiktokAt ? 'planned' : 'none' },
      instagram: { status: it.instagramAt ? 'planned' : 'none' },
    })),
    warnings,
    dropped,
  };
  return autoApprove ? approveAll(slate, { by: 'autoApprove', now }) : slate;
}

/** The one tap. Every item not skipped becomes approved on every platform it has. */
export function approveAll(slate, { by = 'telegram', now = Date.now() } = {}) {
  slate.approved = true;
  slate.approvedBy = by;
  slate.approvedAt = new Date(now).toISOString();
  for (const it of slate.items) {
    if (it.skipped) continue;
    for (const p of ['tiktok', 'instagram']) if (it[p].status === 'planned') it[p].status = 'approved';
  }
  return slate;
}

/** Skip one item, before or after the approval. Already-published halves stay published. */
export function skipItem(slate, n) {
  const it = slate.items.find((x) => x.n === Number(n));
  if (!it) return { ok: false, said: `אין פריט ${n} בתוכנית של היום` };
  it.skipped = true;
  for (const p of ['tiktok', 'instagram']) if (['planned', 'approved'].includes(it[p].status)) it[p].status = 'skipped';
  return { ok: true, said: `פריט ${n} דולג` };
}

/**
 * What should publish now: approved halves whose time has come, on the slate's
 * own day, at a moment the schedule allows. Never anything 'planned': an
 * unapproved slate publishes nothing, whatever the clock says.
 */
export function dueItems(slate, now = Date.now()) {
  if (!slate?.approved) return [];
  if (israelDate(now) !== slate.date) return [];
  if (!sendableNow(new Date(now)).ok) return [];
  const out = [];
  for (const it of slate.items) {
    if (it.skipped) continue;
    for (const p of ['tiktok', 'instagram']) {
      const at = it[`${p}At`];
      if (it[p].status === 'approved' && at && Date.parse(at) <= now) out.push({ item: it, platform: p });
    }
  }
  // One at a time, the earliest first: two due together are an approval that
  // came late, and posting them in the same minute is what the gap exists to stop.
  out.sort((a, b) => Date.parse(a.item[`${a.platform}At`]) - Date.parse(b.item[`${b.platform}At`]));
  return out.slice(0, 1);
}

export function markOutcome(slate, n, platform, outcome) {
  const it = slate.items.find((x) => x.n === Number(n));
  if (!it) return;
  it[platform] = { ...it[platform], ...outcome };
}

/** At the end of the slate's day, whatever never got approved or never went out is marked so. */
export function expire(slate, now = Date.now()) {
  if (israelDate(now) === slate.date) return slate;
  for (const it of slate.items) for (const p of ['tiktok', 'instagram']) if (['planned', 'approved'].includes(it[p].status)) it[p].status = 'expired';
  return slate;
}
