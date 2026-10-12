import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { record } from '../clients/budget.js';
import * as graphReal from '../clients/instagramGraph.js';

// Instagram as a source for the watcher, on Instagram's own numbers.
//
// Two ways in, both through the official Graph API (src/clients/instagramGraph.js):
//   HASHTAGS: the top posts of a few Hebrew travel hashtags (trends.instagram.hashtags).
//   CREATORS: the latest posts of the Israeli travel creators the growth desk has
//       found, and any named by hand (trends.instagram.creators), by Business Discovery.
//
// THE SIGNAL IS LIKES AND COMMENTS. Meta gives no view count on hashtag posts, so
// both ways are judged on the same two numbers: a post is kept when its likes plus
// comments reach `minInteractions`. From a creator it must also reach `creatorLift`
// times that creator's own median: every post of theirs clears a floor their
// followers set, and the one that beats the rest is the one whose format worked.
// A like count the owner hid arrives as nothing, and nothing is made up for it.
//
// ONLY POSTS WITH A COVER IMAGE. The format is read off the cover (extract.js): an
// album gives its first image, a photo itself, a creator's video its thumbnail. A
// hashtag video has none (Meta returns no thumbnail there), so it is passed over.
//
// THE 30 HASHTAGS A WEEK. Meta counts unique hashtags per account over 7 days; the
// same one again inside the window is free. The count used is the larger of Meta's
// own (recently_searched_hashtags, which sees searches made anywhere) and this
// watcher's log, and a hashtag that would go past `hashtagsPerWeek` is not asked.
//
// THE DESK'S STORE IS READ AS A FILE, NEVER IMPORTED AND NEVER WRITTEN. The bot may
// not import src/growth/ (its selftest walks the graph), and only the desk's
// process writes growth.json. On the VPS the bot's .env names it with the same
// variable the desk's unit uses: GROWTH_STORE_PATH=/var/lib/tiyul-growth/growth.json.

const DAY = 86_400_000;
const WEEK = 7 * DAY;
// A handle Business Discovery refused (a personal account, a typo) is not asked
// again for this long.
const RETRY_REFUSED_DAYS = 30;

const deskStorePath = (env) => env.GROWTH_STORE_PATH || fileURLToPath(new URL('../../data/growth.json', import.meta.url));

/** Likes plus comments, or null when Meta gave neither. */
export const interactions = (p) => (p.likes == null && p.comments == null ? null : (p.likes || 0) + (p.comments || 0));

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * Instagram handles of the travel creators the growth desk found: its Instagram
 * creators, and any Instagram link on another creator's profile. A creator the
 * owner marked irrelevant, or one on the do-not-contact list, is left out.
 * Returns { handles, note }.
 */
export function deskCreators({ env = process.env, read = readFileSync, exists = existsSync } = {}) {
  const path = deskStorePath(env);
  if (!exists(path)) return { handles: [], note: `אין קובץ של דסק הצמיחה ב-${path} (GROWTH_STORE_PATH), אז אין יוצרים ממנו` };
  let data;
  try {
    data = JSON.parse(read(path, 'utf8'));
  } catch (e) {
    return { handles: [], note: `קובץ דסק הצמיחה לא נקרא (${e.message})` };
  }
  const dnc = data.dnc || {};
  const out = new Set();
  const add = (h) => {
    const u = String(h || '').replace(/^@/, '').replace(/\.$/, '').toLowerCase();
    if (/^[a-z0-9._]{1,30}$/.test(u) && !dnc[`ig:user:${u}`]) out.add(u);
  };
  for (const lead of Object.values(data.leads || {})) {
    if (lead.type !== 'creator' || lead.closed === 'irrelevant') continue;
    if (lead.source === 'instagram') add(lead.handle);
    for (const s of lead.socials || []) add(/instagram\.com\/([A-Za-z0-9._]{1,30})/i.exec(String(s))?.[1]);
  }
  return { handles: [...out], note: null };
}

/** A post the watcher can look at, in the shape find.js hands on. */
const asFound = (p, query) => ({
  platform: 'instagram',
  url: p.url,
  // The caption is the title the copy check compares against; it is never stored.
  title: p.caption,
  description: '',
  thumb: p.cover,
  lang: 'he',
  query,
  signal: 'strong',
  publishedAt: p.publishedAt,
  views: null,
  likes: p.likes,
  comments: p.comments,
});

const usable = (p, cfg, now) =>
  p.url && p.cover && p.publishedAt && now - Date.parse(p.publishedAt) <= cfg.windowDays * DAY && (interactions(p) ?? -1) >= cfg.instagram.minInteractions;

/**
 * The Instagram half of a watcher run. Returns { found, notes }; every call is
 * recorded on the watcher's ledger (at no cost) and every refusal is a note.
 */
export async function findInstagram(cfg, { state, env = process.env, now = Date.now(), deps = {} } = {}) {
  const ig = cfg.instagram || {};
  const graph = { ...graphReal, ...(deps.instagram || {}) };
  const found = [];
  const notes = [];
  if (!(ig.hashtags?.length || ig.creatorsPerRun)) return { found, notes };
  if (!graph.discoveryConfigured(env)) {
    notes.push('אין IG_DISCOVERY_TOKEN: אינסטגרם לא נבדק (צריך חיבור Facebook Login, npm run ig-discovery)');
    return { found, notes };
  }
  const call = async (fn) => {
    try {
      return await fn();
    } finally {
      record(state, 'instagram', { now });
    }
  };
  let skippedVideo = 0;

  /* ---- hashtags ---- */
  if (ig.hashtags?.length) {
    const h = (state.igHashtags ??= { ids: {}, log: [] });
    h.log = h.log.filter((x) => now - Date.parse(x.at) < WEEK);
    const ours = new Set(h.log.map((x) => x.tag));
    const metas = await call(() => graph.recentHashtags({ env })).catch((e) => {
      if (graph.notAllowed(e)) return null;
      notes.push(`אינסטגרם, רשימת ההאשטגים של השבוע: ${e.message}`);
      return null;
    });
    const recent = new Set(metas || []);
    let used = Math.max(ours.size, recent.size);
    let full = 0;
    for (const tag of ig.hashtags) {
      const free = ours.has(tag) || (h.ids[tag] && recent.has(String(h.ids[tag])));
      if (!free && used >= ig.hashtagsPerWeek) {
        full++;
        continue;
      }
      try {
        const id = h.ids[tag] || (await call(() => graph.hashtagId(tag, { env })));
        if (!free) {
          used++;
          h.log.push({ tag, at: new Date(now).toISOString() });
          ours.add(tag);
        }
        if (!id) continue;
        h.ids[tag] = id;
        for (const p of await call(() => graph.topMedia(id, { env, max: ig.perHashtag }))) {
          if (!p.cover && p.mediaType === 'VIDEO') skippedVideo++;
          else if (usable(p, cfg, now)) found.push(asFound(p, `#${tag}`));
        }
      } catch (e) {
        if (graph.notAllowed(e)) {
          notes.push(`חיפוש האשטגים באינסטגרם נדחה (code ${graph.graphCode(e) ?? e.status}): צריך אישור App Review ל-Instagram Public Content Access`);
          break;
        }
        notes.push(`אינסטגרם #${tag}: ${e.message}`);
        if (graph.limited(e)) break;
      }
    }
    if (full) notes.push(`${full} האשטגים לא נבדקו: ${used} מתוך ${ig.hashtagsPerWeek} של השבוע כבר בשימוש`);
  }

  /* ---- creators ---- */
  if (ig.creatorsPerRun) {
    const desk = deskCreators({ env, ...(deps.desk || {}) });
    if (desk.note) notes.push(desk.note);
    const seen = (state.igCreators ??= {});
    const handles = [...new Set([...(ig.creators || []), ...desk.handles])]
      .filter((u) => !(seen[u]?.refused && now - Date.parse(seen[u].at) < RETRY_REFUSED_DAYS * DAY))
      .sort((a, b) => String(seen[a]?.at || '').localeCompare(String(seen[b]?.at || '')))
      .slice(0, ig.creatorsPerRun);
    if (!handles.length && !desk.note) notes.push('אין עדיין יוצרים עם אינסטגרם בדסק הצמיחה או ב-trends.instagram.creators');
    for (const u of handles) {
      try {
        const bd = await call(() => graph.businessDiscovery(u, { env }));
        seen[u] = { at: new Date(now).toISOString(), followers: bd.followers };
        const base = median(bd.posts.map(interactions).filter((n) => n != null));
        for (const p of bd.posts) {
          if (usable(p, cfg, now) && base != null && interactions(p) >= ig.creatorLift * base) found.push(asFound(p, `@${u}`));
        }
      } catch (e) {
        if (graph.unknownAccount(e)) {
          // A personal account, or a name Meta does not know: this handle only.
          seen[u] = { at: new Date(now).toISOString(), refused: e.message.slice(0, 200) };
          notes.push(`אינסטגרם @${u}: לא חשבון מקצועי (${e.message})`);
          continue;
        }
        // Anything else is the token, a throttle or the network, and the next
        // handle would hit it too.
        notes.push(
          graph.notAllowed(e)
            ? `Business Discovery נדחה (code ${graph.graphCode(e) ?? e.status}): לטוקן חסרה הרשאה, ראו npm run ig-discovery -- --check`
            : `Business Discovery: ${e.message}, נעצר לריצה הזו`
        );
        break;
      }
    }
  }

  if (skippedVideo) notes.push(`${skippedVideo} סרטונים מהאשטגים דולגו: אין להם תמונת שער ב-API`);
  return { found, notes };
}
