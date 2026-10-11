import { leadChannel } from '../links.js';
import { STAGES } from '../rules.js';

// The Reports page's numbers, from the store alone. Pure.

const TYPES = ['creator', 'agency', 'customer'];

/** type -> stage -> count. A lead counts at its current stage. */
export function stageCounts(leads) {
  const out = Object.fromEntries(TYPES.map((t) => [t, Object.fromEntries(STAGES.map((s) => [s, 0]))]));
  for (const l of leads) if (out[l.type] && l.stage in out[l.type]) out[l.type][l.stage]++;
  return out;
}

/** "Reached at least this stage", which is what a funnel means. */
export function funnel(leads, type) {
  const mine = leads.filter((l) => l.type === type);
  const at = (pred) => mine.filter(pred).length;
  return {
    found: mine.length,
    commented: at((l) => l.warmedAt || ['commented', 'messaged', 'replied', 'yes', 'no', 'using'].includes(l.stage)),
    messaged: at((l) => l.messagedAt),
    replied: at((l) => l.repliedAt),
    yes: at((l) => ['yes', 'using'].includes(l.stage)),
    using: at((l) => l.stage === 'using'),
  };
}

const inWindow = (t, from, to) => {
  const x = Date.parse(t || '');
  return Number.isFinite(x) && x >= from && x < to;
};

/** This week (the last 7 days) against the 7 before, per type, by event time. */
export function weekOverWeek(leads, now = Date.now()) {
  const day = 86_400_000;
  const windows = { thisWeek: [now - 7 * day, now + 1], lastWeek: [now - 14 * day, now - 7 * day] };
  const out = {};
  for (const t of TYPES) {
    const mine = leads.filter((l) => l.type === t);
    out[t] = {};
    for (const [w, [from, to]] of Object.entries(windows)) {
      out[t][w] = {
        found: mine.filter((l) => inWindow(l.foundAt, from, to)).length,
        commented: mine.filter((l) => inWindow(l.warmedAt, from, to)).length,
        messaged: mine.filter((l) => inWindow(l.messagedAt, from, to)).length,
        replied: mine.filter((l) => inWindow(l.repliedAt, from, to)).length,
        yes: mine.filter((l) => l.stage === 'yes' || l.stage === 'using').filter((l) => inWindow(l.decidedAt, from, to)).length,
      };
    }
  }
  return out;
}

/**
 * Messaged, replied, interested and closed as no reply, per channel the message
 * went out on (WhatsApp, Email, Instagram, TikTok...), creators and agencies.
 * Sorted by messaged.
 */
export function byChannel(leads) {
  const rows = new Map();
  for (const l of leads.filter((x) => x.messagedAt && (x.type === 'creator' || x.type === 'agency'))) {
    const channel = leadChannel(l);
    const r = rows.get(channel) || { channel, types: new Set(), messaged: 0, replied: 0, yes: 0, noReply: 0 };
    r.types.add(l.type);
    r.messaged++;
    if (l.repliedAt) r.replied++;
    if (l.stage === 'yes' || l.stage === 'using') r.yes++;
    if (l.closed === 'no-reply') r.noReply++;
    rows.set(channel, r);
  }
  return [...rows.values()].map((r) => ({ ...r, types: [...r.types].sort() })).sort((a, b) => b.messaged - a.messaged || a.channel.localeCompare(b.channel));
}

/**
 * Which queries and hashtags found the leads that went somewhere.
 *
 * Sorted by yes, then replies, then found: the question is which searches to
 * keep paying for, and a query that finds forty leads and no replies is the
 * one to drop.
 */
export function bySearch(leads, type) {
  const rows = new Map();
  for (const l of leads.filter((x) => x.type === type)) {
    const key = l.hashtag || l.query || '(unknown)';
    const r = rows.get(key) || { search: key, kind: l.hashtag ? 'hashtag' : 'query', found: 0, messaged: 0, replied: 0, yes: 0 };
    r.found++;
    if (l.messagedAt || l.stage === 'commented') r.messaged++;
    if (l.repliedAt) r.replied++;
    if (l.stage === 'yes' || l.stage === 'using') r.yes++;
    rows.set(key, r);
  }
  return [...rows.values()].sort((a, b) => b.yes - a.yes || b.replied - a.replied || b.found - a.found);
}
