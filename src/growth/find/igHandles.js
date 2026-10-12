import { record } from '../../clients/budget.js';
import { getText } from '../../clients/http.js';
import { blockedBy, personKeys } from '../rules.js';

// Instagram handles of Israeli travel creators, for the trend watcher.
//
// A LIST THE DESK KEEPS AND NEVER ACTS ON. Nothing here becomes a lead, a draft or
// a message. The bot's trend watcher reads `igHandles` from growth.json as a file
// (src/trends/instagram.js) and asks Instagram's Business Discovery for their
// latest posts, to learn which formats work. So a handle needs only to belong to
// someone the sorter called a Hebrew travel creator; it does not have to pass the
// lead scoring (followers, age, a destination on our site).
//
// WHERE THEY COME FROM, the owner's three (12 Oct 2026):
//   - a YouTube creator's Instagram, linked or named with an @ beside the word,
//     in the channel's description or in the full description of their Short
//   - the Instagram on the Linktree page those descriptions link to, when they
//     link no Instagram directly (one page each, LINKTREE_PER_RUN a run)
//   - Brave's instagram.com results: the author of a fresh post the sorter called
//     a creator, and the author of a post too old for a lead or of a profile page,
//     sorted for this alone (OLD_PER_RUN a run). Brave's Instagram index is mostly
//     months old, and before this those authors were dropped unread.
// Each handle is judged once: kept in `igHandles`, or set aside in `igNot` with
// the sorter's reason. A handle on the do-not-contact list is never kept.

export const OLD_PER_RUN = 20;
export const LINKTREE_PER_RUN = 10;

const iso = (t) => new Date(t).toISOString();
const RESERVED = /^(p|reel|reels|explore|stories|tv|accounts|about|legal|direct|tags|locations|linktree|linktree_)$/i;

/** A bare, lower-case Instagram handle, or null. */
export const normHandle = (h) => {
  const u = String(h || '').replace(/^@/, '').replace(/\.+$/, '').toLowerCase();
  return /^[a-z0-9._]{2,30}$/.test(u) && !RESERVED.test(u) ? u : null;
};

/** The handle in an instagram.com profile link, or null. */
export const handleFromUrl = (url) => normHandle(/instagram\.com\/([A-Za-z0-9._]{2,30})/i.exec(String(url || ''))?.[1]);

/** Whether the desk has judged this handle already: on the list, set aside, or a person it has seen. */
export const knownHandle = (state, h) => Boolean(state.igHandles?.[h] || state.igNot?.[h] || state.seen?.[`ig:user:${h}`]);

/** Put one handle on the list. True when it is new there. */
export function keepHandle(state, handle, { via, from = null, name = null, now = Date.now() } = {}) {
  const h = normHandle(handle);
  if (!h || knownHandle(state, h) || blockedBy(state, personKeys({ platform: 'ig', handle: h }))) return false;
  (state.igHandles ??= {})[h] = { at: iso(now), via, from, name };
  return true;
}

/**
 * The Instagram on a public Linktree page: the page's own Instagram icon
 * (`"type":"INSTAGRAM"` in the data the page is built from), else its first
 * Instagram link. Linktree's own account is not one.
 */
export function instagramOnLinktree(html) {
  const s = String(html || '');
  const icon = /"type":"INSTAGRAM","url":"([^"]+)"/.exec(s)?.[1];
  const fromIcon = icon && handleFromUrl(icon.replace(/\\u002F/gi, '/').replace(/\\\//g, '/'));
  if (fromIcon) return fromIcon;
  for (const m of s.matchAll(/instagram\.com(?:\\u002F|\\\/|\/)([A-Za-z0-9._]{2,30})/gi)) {
    const h = normHandle(m[1]);
    if (h) return h;
  }
  return null;
}

/** The Instagram handle on a Linktree page, through the one door. */
export async function readLinktree(url, { get = getText } = {}) {
  return instagramOnLinktree(await get(url, { timeoutMs: 12_000 }));
}

/**
 * The handles of this run's candidates the sorter called Hebrew travel creators:
 * an Instagram post's author, a YouTube creator's Instagram links, and the
 * Instagram on their Linktree when they link none directly. `verdicts` are in the
 * order of `cands`.
 */
export async function harvestHandles({ state, cands, verdicts, run, now, deps }) {
  const pages = [];
  cands.forEach((c, i) => {
    const v = verdicts[i];
    if (!v || v.kind !== 'creator' || !v.hebrew) return;
    const meta = { from: c.url, name: c.name || null, now };
    if (c.platform === 'instagram') {
      if (keepHandle(state, c.handle, { ...meta, via: 'brave' })) run.igHandles++;
      return;
    }
    const direct = (c.socials || []).map(handleFromUrl).filter(Boolean);
    for (const h of direct) if (keepHandle(state, h, { ...meta, via: 'youtube' })) run.igHandles++;
    if (direct.length) return;
    for (const url of c.linktree || []) if (!state.linktrees?.[url] && !pages.some((p) => p.url === url)) pages.push({ url, name: meta.name });
  });

  for (const p of pages.slice(0, LINKTREE_PER_RUN)) {
    try {
      const h = await deps.linktree(p.url);
      // Read once, whatever it held: a page without an Instagram is not asked again.
      (state.linktrees ??= {})[p.url] = { at: iso(now), handle: h };
      if (h && keepHandle(state, h, { via: 'linktree', from: p.url, name: p.name, now })) run.igHandles++;
    } catch (e) {
      run.errors.push(`Linktree ${p.url}: ${e.message}`);
    } finally {
      record(state, 'linktree', { now });
    }
  }
}

/**
 * Brave's Instagram finds that cannot be leads (a post too old, a profile page),
 * sorted for their author's handle alone, ten to a call on the cheap model.
 * `old` is a Map of handle -> { handle, url, text }, built by the caller from
 * handles not yet judged.
 */
export async function sortOldInstagram({ state, settings, old, run, now, deps }) {
  const list = [...old.values()].slice(0, OLD_PER_RUN);
  if (!list.length) return;
  const verdicts = await deps.classify(
    list.map((o) => ({ text: o.text, author: o.handle, platform: 'instagram' })),
    { state, settings }
  );
  run.igSorted = list.length;
  list.forEach((o, i) => {
    const v = verdicts[i];
    if (!v) return;
    if (v.kind === 'creator' && v.hebrew) {
      if (keepHandle(state, o.handle, { via: 'brave', from: o.url, now })) run.igHandles++;
    } else {
      (state.igNot ??= {})[o.handle] = { at: iso(now), why: String(v.reason || v.kind).slice(0, 120) };
    }
  });
}
