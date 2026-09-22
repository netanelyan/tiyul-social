import { postConfig } from '../postConfig.js';

// Pexels video search.
//
// The photo twin of this lives in src/images/pexels.js and the licence note
// there applies unchanged: commercial use, no attribution required, no
// hotlinking obligation, so the bytes can be pulled down and re-encoded. We
// record the uploader anyway, for the same reason we record a photographer.
//
// What is different here is the FILTER, and it is most of the file.
//
// A stock photo search returns photographs of a place. A stock video search
// returns two quite different genres wearing the same keywords: people doing
// things outdoors, and models being filmed outdoors. The second one is
// enormous, it ranks well for every travel term, and it is instantly
// recognisable as an advertisement — which is the thing this whole format
// exists to stop looking like.
//
// The rule that separates them is not "people" and not "beaches". It is
// whether the camera is a PARTICIPANT or a SPECTATOR. A POV bike ride down a
// forest trail, a hike behind a waterfall, a dog in a creek: somebody is doing
// the thing and the lens is along for it. "Serene woman walking along ocean
// shoreline" is a person being looked at. Both are legal, free and 4K; only one
// of them can carry a first-person line.

const API = 'https://api.pexels.com/videos/search';

export const configured = () => Boolean(process.env.PEXELS_API_KEY);

/** The title Pexels gives a clip, recovered from its page slug. */
export const titleOf = (v) =>
  String(v?.url || '')
    .split('/video/')[1]
    ?.replace(/-\d+\/?$/, '')
    .replace(/-/g, ' ')
    .trim() || '';

/**
 * How much this clip looks like someone doing something, and not like a shoot.
 *
 * Returns null for a hard veto so the caller can tell "scored badly" from
 * "refused" — they are different facts and only one of them is worth logging.
 *
 * The veto is checked FIRST and is absolute. A bikini clip that happens to say
 * "trail" in its title would otherwise accumulate enough preferred words to
 * come back, which is exactly the failure the list was written to prevent.
 */
export function tasteScore(title, { prefer, reject } = postConfig().clips.search) {
  const t = String(title || '').toLowerCase();
  if (!t) return null;
  for (const bad of reject) if (t.includes(bad)) return null;

  let score = 0;
  for (const good of prefer) {
    // Word-boundary, so "path" does not match "pathetic" and — the one that
    // actually bit — "hike" does not match nothing while "hiking" matches.
    if (new RegExp(`\\b${good.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(t)) score++;
  }
  return score;
}

/** The file to download: the smallest rendition that is still at least 1080 wide. */
export function pickFile(v, { minWidth = 1080 } = {}) {
  const files = (v.video_files || [])
    .filter((f) => f.file_type === 'video/mp4' && f.width && f.height && f.link)
    .sort((a, b) => a.width - b.width);
  // Smallest-that-qualifies rather than largest available: a 4K source is
  // 40MB to download and gets scaled to 1080 wide in the very next step, so
  // the extra pixels are paid for and then thrown away.
  return files.find((f) => f.width >= minWidth) || files[files.length - 1] || null;
}

async function search(query, page, { timeoutMs }) {
  const url = `${API}?${new URLSearchParams({
    query,
    orientation: 'portrait',
    per_page: '24',
    page: String(page),
  })}`;
  const res = await fetch(url, {
    headers: { authorization: process.env.PEXELS_API_KEY },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`pexels videos HTTP ${res.status}`);
  return (await res.json()).videos || [];
}

/**
 * Candidate clips, best first, across every configured query.
 *
 * `seen` is the set of Pexels ids already used — passed in rather than read
 * here, because "have we posted this" is the store's question and this module
 * has no business knowing where the answer is kept.
 *
 * Errors on one query are swallowed and reported in `errors`. One search term
 * that Pexels rate-limits should not cost the other eleven, for the same reason
 * one unreachable destination does not stop the climate rotation.
 */
export async function findClips({ limit = 12, seen = new Set(), pages = 2, timeoutMs = 20_000 } = {}) {
  if (!configured()) throw new Error('PEXELS_API_KEY is not set');

  const cfg = postConfig().clips.search;
  const out = new Map();
  const errors = [];
  const vetoed = [];

  for (const query of cfg.queries) {
    for (let page = 1; page <= pages; page++) {
      let videos;
      try {
        videos = await search(query, page, { timeoutMs });
      } catch (e) {
        errors.push(`${query}: ${e.message}`);
        break;
      }

      for (const v of videos) {
        if (out.has(v.id) || seen.has(String(v.id))) continue;
        if (!(v.height > v.width)) continue;
        if (v.height < cfg.minHeight) continue;
        if (v.duration < cfg.minDuration || v.duration > cfg.maxDuration) continue;

        const title = titleOf(v);
        const score = tasteScore(title, cfg);
        if (score === null) {
          vetoed.push(title);
          continue;
        }
        if (score < cfg.minScore) continue;

        const file = pickFile(v);
        if (!file) continue;

        out.set(v.id, {
          id: String(v.id),
          title,
          query,
          score,
          duration: v.duration,
          width: v.width,
          height: v.height,
          src: file.link,
          srcWidth: file.width,
          srcHeight: file.height,
          poster: v.image,
          credit: v.user?.name || null,
          creditUrl: v.user?.url || null,
          page: v.url,
          provenance: 'pexels',
        });
      }
    }
  }

  const clips = [...out.values()].sort((a, b) => b.score - a.score || a.duration - b.duration);
  return { clips: clips.slice(0, limit), total: clips.length, vetoed, errors };
}
