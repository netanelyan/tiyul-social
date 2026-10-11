import { normHe } from './site.js';

// Learning from what the owner actually sends.
//
// [Copy & open] tells the desk which variant was copied and the exact text that
// went to the clipboard, after any edit made in the desk. [Sent] or
// [Commented] then turns that into one record in state.sentLog: the draft as it
// was written, the text that was sent, and whether they differ. An edit made
// inside WhatsApp or TikTok after pasting is invisible to the desk, so the card
// has an optional box for the final text, and when it is filled that is what
// is recorded.
//
// Two things read the log. The next drafts of the same kind get the owner's
// last ten sent texts as examples (draft.js, as "style only"). And Reports
// shows a weekly diff of what the owner usually changes: which variant they
// pick, how much shorter they make it, and the words they cut and add most.

export const FEW_SHOT = 10;

const DAY = 86_400_000;

/** The kind a sent text is logged under, from the item that was acted on. */
export const kindOf = (lead, what) =>
  what === 'comment' ? 'comment' : lead.type === 'customer' ? 'reply' : what === 'followup' ? 'followup' : lead.type === 'agency' ? 'agency' : 'creator';

/** Remember what was copied, until it is marked sent. */
export function noteCopied(lead, { what, postId = null, variant = null, text, draft = null, at = Date.now() }) {
  const key = what === 'comment' ? `comment:${postId}` : what;
  (lead.copied ??= {})[key] = { text: String(text || ''), variant, draft: draft == null ? null : String(draft), at: new Date(at).toISOString() };
}

/**
 * Write the log record for a sent or commented item.
 *
 * `final` is the text the owner says they really sent, when they changed it
 * after pasting. Returns the record, or null when nothing was copied first
 * (the owner sent something the desk never saw).
 */
export function recordSent(state, lead, { what, postId = null, final = null, at = Date.now() }) {
  const key = what === 'comment' ? `comment:${postId}` : what;
  const c = lead.copied?.[key];
  if (!c && !final) return null;
  const sent = String(final || c?.text || '').trim();
  const draft = String(c?.draft ?? c?.text ?? '').trim();
  const rec = {
    at: new Date(at).toISOString(),
    kind: kindOf(lead, what),
    leadId: lead.id,
    postId,
    variant: c?.variant ?? null,
    draft,
    sent,
    edited: Boolean(draft) && flatten(draft) !== flatten(sent),
  };
  (state.sentLog ??= []).push(rec);
  if (lead.copied) delete lead.copied[key];
  return rec;
}

const flatten = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** The owner's last `n` sent texts of one kind, newest first. Never another kind's. */
export function examplesFor(state, kind, n = FEW_SHOT) {
  return (state.sentLog || [])
    .filter((r) => r.kind === kind && r.sent)
    .slice(-n)
    .reverse()
    .map((r) => r.sent);
}

const words = (s) => normHe(String(s || '').replace(/https?:\/\/\S+/g, ' ')).split(' ').filter((w) => w.length >= 2);

/** Words and two-word phrases in `a` that `b` does not have, counted. */
function missing(a, b) {
  const have = new Set([...words(b), ...pairs(words(b))]);
  const out = new Map();
  for (const w of [...words(a), ...pairs(words(a))]) if (!have.has(w)) out.set(w, (out.get(w) || 0) + 1);
  return out;
}
const pairs = (ws) => ws.slice(1).map((w, i) => `${ws[i]} ${w}`);

const top = (maps, n = 8) => {
  const all = new Map();
  for (const m of maps) for (const [k, v] of m) all.set(k, (all.get(k) || 0) + v);
  return [...all.entries()]
    .filter(([, v]) => v >= 2 || all.size <= n)
    .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
    .slice(0, n)
    .map(([phrase, count]) => ({ phrase, count }));
};

/**
 * What the owner changed in the last seven days, computed in code.
 *
 * { total, edited, byKind, variants: { 0: n, 1: n, 2: n }, avgLengthChange,
 *   removed: [{ phrase, count }], added: [...], pairs: [{ kind, draft, sent }] }
 */
export function weeklyEdits(state, now = Date.now()) {
  const week = (state.sentLog || []).filter((r) => now - Date.parse(r.at) <= 7 * DAY);
  const edited = week.filter((r) => r.edited);
  const byKind = {};
  const variants = {};
  for (const r of week) {
    byKind[r.kind] = (byKind[r.kind] || 0) + 1;
    if (Number.isInteger(r.variant)) variants[r.variant] = (variants[r.variant] || 0) + 1;
  }
  const deltas = edited.map((r) => r.sent.length - r.draft.length);
  return {
    total: week.length,
    edited: edited.length,
    byKind,
    variants,
    avgLengthChange: deltas.length ? Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length) : 0,
    removed: top(edited.map((r) => missing(r.draft, r.sent))),
    added: top(edited.map((r) => missing(r.sent, r.draft))),
    pairs: edited.slice(-5).reverse().map((r) => ({ kind: r.kind, draft: r.draft, sent: r.sent })),
  };
}
