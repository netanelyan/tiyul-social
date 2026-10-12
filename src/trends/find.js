import { braveConfigured, braveSearch, tiktokPost, tiktokTime } from '../clients/brave.js';
import { guard, marginal, record } from '../clients/budget.js';
import { oembed } from '../clients/oembed.js';
import { searchTop, videoDetails, videoStats, youtubeConfigured } from '../clients/youtube.js';
import { findInstagram as findInstagramReal } from './instagram.js';

// Where formats that work right now are found.
//
// YOUTUBE CARRIES THE SIGNAL, WITH REAL NUMBERS. Shorts from the last 30 days, in
// Hebrew and in English, with views, likes and comments from videos.list, kept
// only above the view floor and then ranked by views. Free: search has its own
// 100-a-day quota.
//
// SEARCHED BY RELEVANCE, NOT BY VIEWS. Ordered by views, "3 days in" returned the
// month's most viewed Shorts of any kind: a game, a phone advert, a fidget toy.
// By relevance it returns posts on the topic, and the floor keeps the ones that
// worked. Measured on the first real runs, 10 Oct 2026.
//
// TIKTOK THROUGH BRAVE IS A WEAK SIGNAL AND NOTHING MORE. oEmbed has no numbers,
// so a TikTok post found this way carries `signal: 'weak'` and `views: null`, and
// nothing invents a figure for it. Brave's index of TikTok was also measured at
// months to years old (src/clients/brave.js), so most of what it returns falls
// outside the 30 days and is dropped by its own upload date.
//
// INSTAGRAM CARRIES A SIGNAL TOO, ON LIKES AND COMMENTS (./instagram.js): the
// official Graph API's own counts, so `signal: 'strong'` with `views: null`.
// Views and likes are not one scale, so the strong sources are not ranked against
// each other: each platform is ranked by its own number and they take turns
// (fairOrder), or YouTube's view counts would push every Instagram post past
// `perRun` forever.

const DAY = 86_400_000;

/** A source's own number: views where the platform gives them, else likes plus comments. */
const ownNumber = (s) => s.views ?? (s.likes == null && s.comments == null ? 0 : (s.likes || 0) + (s.comments || 0));

/**
 * Strong sources first, the platforms taking turns, each ranked by its own
 * number; weak ones after, in the order given. `sourceOf` reads the source off
 * an item (a found post is its own source; a card has `.source`).
 */
export function fairOrder(items, sourceOf = (x) => x) {
  const groups = new Map();
  const weak = [];
  for (const it of items) {
    const s = sourceOf(it) || {};
    if (s.signal !== 'strong') weak.push(it);
    else groups.set(s.platform, [...(groups.get(s.platform) || []), it]);
  }
  for (const g of groups.values()) g.sort((a, b) => ownNumber(sourceOf(b)) - ownNumber(sourceOf(a)));
  const out = [];
  for (let i = 0; groups.size && out.length + weak.length < items.length; i++) for (const g of groups.values()) if (g[i]) out.push(g[i]);
  return [...out, ...weak];
}

/** A source's numbers as one Hebrew phrase, naming only what the platform gave. */
export function sourceNumbers(s = {}) {
  const n = (x) => Number(x).toLocaleString('en-US');
  if (s.views != null) return `${n(s.views)} צפיות`;
  const parts = [s.likes != null && `${n(s.likes)} לייקים`, s.comments != null && `${n(s.comments)} תגובות`].filter(Boolean);
  return parts.length ? parts.join(', ') : 'אות חלש בלי מספרים';
}

/** A YouTube video id from a Shorts or watch URL, or null. */
export const youtubeId = (url) => /youtube\.com\/(?:shorts\/|watch\?v=)([\w-]{11})/.exec(String(url || ''))?.[1] || null;

export async function findWinners(cfg, { state, settings, env = process.env, now = Date.now(), deps = {} } = {}) {
  const yt = { search: deps.searchTop || searchTop, stats: deps.videoStats || videoStats, details: deps.videoDetails || videoDetails };
  const brave = deps.brave || braveSearch;
  const ombed = deps.oembed || oembed;
  const found = [];
  const notes = [];

  if (youtubeConfigured(env)) {
    const raw = new Map();
    let quotaOut = false;
    for (const lang of ['he', 'en']) {
      for (const q of cfg.queries?.[lang] || []) {
        if (quotaOut) break;
        try {
          for (const v of await yt.search(q, { env, now, lang, days: cfg.windowDays, order: 'relevance', max: 25 })) if (!raw.has(v.id)) raw.set(v.id, { ...v, lang, query: q });
        } catch (e) {
          notes.push(`YouTube "${q}": ${e.message}`);
          if (e.status === 403 || /quota/i.test(e.message)) quotaOut = true;
          if (e.status === 400) break;
        } finally {
          record(state, 'youtube', { now });
        }
      }
    }

    // SEARCH'S 100 A DAY IS SHARED WITH THE GROWTH DESK, and a day it has run out
    // should not be a day without a watcher. Brave finds videos on the same
    // queries; videos.list, from the general quota, gives each its real numbers
    // and its upload date, so the floor still holds and the signal is still strong.
    //
    // ITS OWN, WIDER WINDOW (fallbackWindowDays, a year). Brave's YouTube index
    // was measured as stale as its TikTok one: on "things to know before
    // traveling to", 2 of 21 results were from the last 30 days. A year-old post
    // with 489K views is still real evidence that a format works; each card keeps
    // its source's upload date, so the report shows how old the evidence is.
    if (quotaOut && braveConfigured(env)) {
      notes.push('מכסת החיפוש של יוטיוב נגמרה להיום: מחפש שורטס דרך Brave, והמספרים מיוטיוב עצמו');
      const viaBrave = new Map();
      for (const lang of ['he', 'en']) {
        for (const q of cfg.queries?.[lang] || []) {
          try {
            guard(state, settings, 'brave', marginal(state, settings, 'brave', now), now);
            for (const r of await brave(q, 'youtube.com', { env })) {
              const id = youtubeId(r.url);
              if (id && !raw.has(id) && !viaBrave.has(id)) viaBrave.set(id, { lang, query: q });
            }
          } catch (e) {
            notes.push(`Brave/YouTube "${q}": ${e.message}`);
            if (e.code === 'budget') break;
          } finally {
            record(state, 'brave', { now });
          }
        }
      }
      const details = viaBrave.size ? await yt.details([...viaBrave.keys()], { env }).catch((e) => (notes.push(`YouTube videos: ${e.message}`), new Map())) : new Map();
      for (const [id, d] of details) {
        if (!d.publishedAt || now - Date.parse(d.publishedAt) > (cfg.fallbackWindowDays || 365) * DAY) continue;
        raw.set(id, { ...d, ...viaBrave.get(id) });
      }
    }
    const stats = raw.size ? await yt.stats([...raw.keys()], { env }).catch((e) => (notes.push(`YouTube stats: ${e.message}`), new Map())) : new Map();
    for (const v of raw.values()) {
      const s = stats.get(v.id);
      if (!s?.views || s.views < (cfg.minViews?.[v.lang] ?? 0)) continue;
      found.push({ platform: 'youtube', url: v.url, title: v.title, description: v.description, thumb: v.thumb, lang: v.lang, query: v.query, signal: 'strong', publishedAt: v.publishedAt || null, ...s });
    }
  } else {
    notes.push('אין YOUTUBE_API_KEY: יוטיוב לא נבדק');
  }

  if (braveConfigured(env)) {
    for (const q of cfg.tiktokQueries || []) {
      try {
        guard(state, settings, 'brave', marginal(state, settings, 'brave', now), now);
        const results = await brave(`${q} video`, 'tiktok.com', { env });
        for (const r of results) {
          const post = tiktokPost(r.url);
          const born = post && tiktokTime(post.id);
          if (!born || now - Date.parse(born) > cfg.windowDays * DAY) continue;
          const o = await ombed(post.url).catch(() => null);
          if (o?.thumbUrl) found.push({ platform: 'tiktok', url: post.url, title: o.title, description: '', thumb: o.thumbUrl, lang: 'he', query: q, signal: 'weak', publishedAt: born, views: null, likes: null, comments: null });
        }
      } catch (e) {
        notes.push(`TikTok "${q}": ${e.message}`);
        if (e.code === 'budget') break;
      } finally {
        record(state, 'brave', { now });
      }
    }
  }

  const ig = await (deps.findInstagram || findInstagramReal)(cfg, { state, env, now, deps });
  found.push(...ig.found);
  notes.push(...ig.notes);

  return { found: fairOrder(found), notes };
}
