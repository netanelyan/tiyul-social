import { braveConfigured, instagramPost, instagramProfile } from '../../clients/brave.js';
import { guard, marginal, record } from '../../clients/budget.js';

// A YouTube creator's Instagram, looked up when their channel and Short list no
// Instagram and no business email (the owner, 2026-10-14). YouTube has no
// direct messages, and 7 of the first 8 YouTube creators listed neither.
//
// ONE BRAVE SEARCH, ONLY FOR A CREATOR ON TODAY: their YouTube handle on
// instagram.com, once. Nothing is fetched from Instagram itself; the evidence
// is what the search engine indexed, a profile's title and snippet, which carry
// its name ("Dana Cohen (@dana.trips) • Instagram photos and videos") and often
// its bio.
//
// A HANDLE MATCH ALONE IS NOT TRUSTED (the owner's rule): the profile must have
// the same handle, dots and underscores aside, AND either the creator's name or
// a link to their YouTube channel. Anything else is not taken. A profile that
// passes is still only found by search: the card says so, links it, and has a
// [Not them] button that drops it (rules.js 'ig-wrong').

const DAY = 86_400_000;

/** A handle without the characters people move around: "dana_trips" and "dana.trips" are one. */
const flatHandle = (h) => String(h || '').toLowerCase().replace(/^@/, '').replace(/[._-]/g, '');

/** Instagram handles are Latin letters, digits, dots and underscores; a Hebrew YouTube handle has none to search for. */
const latinHandle = (h) => /^[A-Za-z0-9._-]{2,30}$/.test(String(h || ''));

/** Letters and digits only, lower case, single-spaced: "Dana Cohen ✈️ | Travel" is "dana cohen travel". */
export const nameKey = (s) =>
  String(s || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Is it the same name? Equal, or every word of the shorter one, in order, in
 * the longer ("Touring Tom" in "Touring Tom Israel"), with at least four
 * letters to it, so "Tom" alone matches nothing.
 */
export function namesMatch(a, b) {
  const x = nameKey(a);
  const y = nameKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.replace(/ /g, '').length < 4) return false;
  return ` ${long} `.includes(` ${short} `);
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Does this text link the creator's own YouTube channel? */
export function linksYoutube(text, lead) {
  const t = String(text || '');
  if (lead.handle && new RegExp(`youtube\\.com/@${escRe(lead.handle)}(?![A-Za-z0-9._-])`, 'i').test(t)) return true;
  return Boolean(lead.channelId && new RegExp(`youtube\\.com/channel/${escRe(lead.channelId)}(?![A-Za-z0-9_-])`, 'i').test(t));
}

/** The name before "(@handle)" in a profile's title or snippet: "Dana Cohen (@dana.trips) • Instagram" is "Dana Cohen". */
export function nameBefore(text, handle) {
  const s = String(text || '');
  const at = s.toLowerCase().indexOf(`(@${String(handle).toLowerCase()})`);
  if (at < 0) return null;
  let before = s.slice(0, at).split('\n').pop();
  for (const sep of ['•', '|', ':', ' - ', 'from ']) {
    const i = before.lastIndexOf(sep);
    if (i >= 0) before = before.slice(i + sep.length);
  }
  before = before.trim();
  return before && before.length <= 60 ? before : null;
}

/** The Instagram accounts in a set of search results, one per handle: { handle, url, names, text }. */
export function profilesIn(results) {
  const out = new Map();
  for (const r of results || []) {
    const handle = instagramProfile(r.url) || instagramPost(r)?.handle || null;
    if (!handle) continue;
    const key = handle.toLowerCase();
    const p = out.get(key) || { handle, url: `https://www.instagram.com/${handle}/`, names: [], text: '' };
    const text = [r.title, r.description, ...(r.extra || [])].filter(Boolean).join('\n');
    p.text += `${p.text ? '\n' : ''}${text}`;
    const name = nameBefore(text, handle);
    if (name && !p.names.includes(name)) p.names.push(name);
    out.set(key, p);
  }
  return [...out.values()];
}

/** Is this Instagram account the creator? { ok, why }. */
export function judgeProfile(lead, p) {
  if (flatHandle(p.handle) !== flatHandle(lead.handle)) return { ok: false, why: 'a different handle' };
  if (linksYoutube(p.text, lead)) return { ok: true, why: 'the same handle, and its bio links their YouTube channel' };
  const name = p.names.find((n) => namesMatch(n, lead.name));
  if (name) return { ok: true, why: `the same handle, and its name matches (${name})` };
  return { ok: false, why: 'the same handle, but neither the name nor a link to their YouTube matches' };
}

/** Is this creator's Instagram to be looked up now? Once, and again a day after a search that failed. */
export function lookupDue(lead, now = Date.now()) {
  if (lead.type !== 'creator' || lead.source !== 'youtube' || lead.closed || lead.messagedAt) return false;
  if ((lead.socials || []).some((s) => /instagram\.com/.test(s)) || lead.email) return false;
  if (!latinHandle(lead.handle)) return false;
  const l = lead.igLookup;
  return !l || (l.status === 'error' && now - Date.parse(l.at || 0) > DAY);
}

/**
 * Look the creator's Instagram up, if it is due, and keep the verdict on the
 * lead as `igLookup`: { status: 'found' | 'rejected' | 'none' | 'error', at,
 * query, url, handle, name, why }. Returns it.
 */
export async function lookupInstagram({ state, settings, lead, now = Date.now(), brave, env = process.env }) {
  if (!lookupDue(lead, now) || !braveConfigured(env)) return lead.igLookup || null;
  guard(state, settings, 'brave', marginal(state, settings, 'brave', now), now);
  const at = new Date(now).toISOString();
  const query = `"${lead.handle}"`;
  let results;
  try {
    results = await brave(query, 'instagram.com', { env, count: 10, freshness: '' });
  } catch (e) {
    lead.igLookup = { status: 'error', at, query, error: e.message };
    return lead.igLookup;
  } finally {
    record(state, 'brave', { now });
  }
  const judged = profilesIn(results).map((p) => ({ p, j: judgeProfile(lead, p) }));
  const hit = judged.find((x) => x.j.ok);
  const near = judged.find((x) => x.j.why !== 'a different handle');
  lead.igLookup = hit
    ? { status: 'found', at, query, url: hit.p.url, handle: hit.p.handle, name: hit.p.names[0] || null, why: hit.j.why }
    : near
      ? { status: 'rejected', at, query, url: near.p.url, handle: near.p.handle, why: near.j.why }
      : { status: 'none', at, query, why: 'no Instagram account with their handle in the results' };
  (lead.history ??= []).push({ at, what: `Instagram search: ${lead.igLookup.status}${lead.igLookup.handle ? ` (@${lead.igLookup.handle})` : ''}` });
  return lead.igLookup;
}
