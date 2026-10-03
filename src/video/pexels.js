import { postConfig } from '../postConfig.js';
import { judgeThumb, rankVision } from './vision.js';

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
const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function tasteScore(title, cfg = postConfig().clips.search) {
  const { prefer, reject, spectator, povBonus, spectatorPenalty } = cfg;
  const t = String(title || '').toLowerCase();
  if (!t) return null;
  for (const bad of reject) if (t.includes(bad)) return null;

  // Subject words, counted by POSITION rather than by term.
  //
  // The list has overlapping stems on purpose — "hike" and "hiking" both need
  // to match something — and counting per term scored "hiking" twice for one
  // word. Deduping on where the match STARTS collapses those back to one,
  // which is what a human counting the words in the title would do.
  const hits = new Set();
  for (const good of prefer) {
    const m = new RegExp(`\\b${esc(good)}`, 'gi');
    for (let r; (r = m.exec(t)); ) hits.add(r.index);
  }
  let score = hits.size;

  // A PERSON in the title means a person in the FRAME, which means somebody
  // is standing back filming them.
  //
  // This is the correction that matters, and the old version did not have it at
  // all: the subject words alone rank "woman walking in autumn forest pathway"
  // ABOVE "scenic hike behind a majestic waterfall", because the first one hits
  // four of them. Four words about a forest, describing a shot of a model.
  //
  // Whole words only. "hiker" is a person being filmed and "hiking" is the
  // activity, and a prefix match cannot tell them apart — which is precisely
  // the pair that got through.
  for (const who of spectator) {
    if (new RegExp(`\\b${esc(who)}\\b`, 'i').test(t)) {
      score -= spectatorPenalty;
      break;
    }
  }

  // ...unless the title says the camera IS the person. "POV hiker" is a
  // participant, and the bonus is large enough to outrun one penalty, because
  // an explicit point-of-view marker is the strongest signal in the title.
  if (/\b(pov|first[- ]person|point of view)\b/i.test(t)) score += povBonus;

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

/**
 * The best of each query, then the second best of each, and so on.
 *
 * Exported so the ordering can be asserted without a network call, which is the only
 * way this gets a test: everything around it is a live search.
 */
export function interleaveByQuery(ranked) {
  const byQuery = new Map();
  for (const c of ranked || []) {
    if (!byQuery.has(c.query)) byQuery.set(c.query, []);
    byQuery.get(c.query).push(c);
  }
  const lists = [...byQuery.values()];
  const out = [];
  for (let round = 0; ; round++) {
    let added = 0;
    for (const list of lists) {
      if (list[round]) {
        out.push(list[round]);
        added += 1;
      }
    }
    if (!added) break;
  }
  return out;
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
export async function findClips({ limit = 12, seen = new Set(), pages = null, timeoutMs = 20_000, judge = true, queries = null } = {}) {
  if (!configured()) throw new Error('PEXELS_API_KEY is not set');

  const cfg = postConfig().clips.search;
  // HOW DEEP INTO EACH SEARCH TO GO. A config value now, and the reason it is worth
  // knowing is that raising it was the wrong fix and the measurement said so within
  // a minute: four pages returned FEWER candidates than two, because 44 queries times
  // 4 pages is 176 requests and Pexels rate limits. See the note beside `pages` in
  // src/postConfig.js.
  //
  // THE RAW POOL WAS NEVER THE PROBLEM. Two pages across the query list returns 1,504
  // candidates past the portrait, height and duration gates with the 81 spent clips
  // already excluded. What was starving the reel formats is further down: the queue
  // is sorted by TITLE score and only `visionMaxCandidates` of it is ever judged.
  const depth = pages ?? cfg.pages;
  const out = new Map();
  const errors = [];
  const vetoed = [];

  // NARROWED, OR THE WHOLE LIST. The default is every configured query, which
  // is what a card, a held clip and a cuts clip all want: breadth, so the judge
  // picks the best frames the day happens to offer.
  //
  // A MONTAGE WANTS THE OPPOSITE AND CANNOT BE BUILT WITHOUT IT. It needs six
  // or more shots of ONE place, and spread across twenty-six destinations the
  // shots of any one of them are a fraction of what comes back - measured, on a
  // live run: fourteen judged clips across nine places, the best-covered with
  // two. No amount of raising `limit` fixes that, because the breadth is the
  // thing producing it. So the caller narrows the search instead, and the same
  // vision budget is spent looking at one destination rather than at all of
  // them.
  for (const query of queries?.length ? queries : cfg.queries) {
    for (let page = 1; page <= depth; page++) {
      let videos;
      try {
        videos = await search(query, page, { timeoutMs });
      } catch (e) {
        errors.push(`${query}: ${e.message}`);
        break;
      }

      for (const v of videos) {
        if (out.has(v.id) || seen.has(String(v.id))) continue;
        // Rejected by the owner by eye. Stronger than any score.
        if (cfg.denyIds.includes(String(v.id))) continue;
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

  // Title ranking orders the QUEUE for the judge; it no longer decides
  // anything. Cheapest first: the free string checks above have already thrown
  // out the vetoes, and what survives is offered to the picture.
  const ranked = [...out.values()].sort((a, b) => b.score - a.score || a.duration - b.duration);

  // ONE QUERY AT A TIME, ROUND ROBIN, AND THIS IS THE FIX FOR THE REEL DROUGHT.
  //
  // Ranked by title score alone, the judging budget goes to whichever two or three
  // queries happen to word their titles best. Measured on the live box: 24 judged, 20
  // past the destination gate, 16 labelled - and SIX distinct places, every one of
  // them in Greece. Thirty-eight other queries, including every one added that day,
  // were never looked at, because their clips sat below the Greek ones on a string
  // score. A reel needs three DIFFERENT places, so a judging pass that spends itself
  // inside one country starves it however many candidates the search returned.
  //
  // So the queue is interleaved: the best clip of each query, then the second best of
  // each, and so on. The first 24 judged now span up to 24 destinations instead of
  // two or three, which is the diversity the format is built on. Within a query the
  // order is unchanged, so the title score still decides which clip of a place is
  // offered first - it just no longer decides which PLACES are offered at all.
  //
  // The held and cuts shapes are not harmed by this: they want the best frames the
  // day offers and the best frame of each destination is still at the front. The
  // montage narrows to one query anyway, where interleaving is a no-op.
  const queue = interleaveByQuery(ranked);

  if (!judge) {
    return { clips: queue.slice(0, limit), total: queue.length, vetoed, errors, judged: 0, nowhere: [] };
  }

  const judged = [];
  const nowhere = [];
  let calls = 0;
  for (const c of queue) {
    if (judged.length >= limit || calls >= cfg.visionMaxCandidates) break;
    calls++;
    // The query and the title go WITH the picture. Without them the judge is
    // being asked to recognise a place unaided and names one on about a
    // fifteenth of candidates; with them it is confirming a lead against the
    // frame, which is the question a thumbnail can actually answer. See the note
    // on judgeThumb — the cuts format is built entirely out of these names.
    const vision = await judgeThumb(c.poster, { query: c.query, title: c.title });
    const rank = rankVision(vision, cfg);
    if (rank === null) {
      // Recorded rather than dropped silently. "destination 2" is the single
      // most useful line in a run that came back empty, and it is the number
      // that tells you a query is asking for the wrong thing.
      nowhere.push(
        `${c.title} - ${
          vision
            ? `destination ${vision.destination}${vision.staged ? ', staged' : ''}${
                vision.personSubject ? ', person in front of the camera' : ''
              }`
            : 'not judged'
        }`
      );
      continue;
    }
    judged.push({ ...c, vision, rank });
  }

  judged.sort((a, b) => b.rank - a.rank);
  return { clips: judged, total: queue.length, vetoed, errors, judged: calls, nowhere };
}
