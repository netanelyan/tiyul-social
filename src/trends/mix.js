// Which format each slate slot gets, and what our own numbers say about each.
// Pure functions over the trends store's data.
//
// THE OWNER'S RULES:
//   - a post is scored 72 hours after it went out
//   - TikTok publishes no save count: TikTok scores (shares + likes) per view,
//     Instagram (saves + shares) per view, and no TikTok save is ever made up
//   - 70% of slots go to proven formats, 30% to new formats from the watcher
//   - a format that underperforms 3 times in a row drops out
//
// "Underperforms" is a score under `lossBelow` (0.7) of the platform's own median
// over the window, so a TikTok score is never compared with an Instagram one. Not
// "under the median": an average format is under it half the time, and three
// halves in a row would retire most formats inside a month.

const DAY = 86_400_000;

/** One post's score on one platform, from its stats, or null when it has no views. */
export function postScore(platform, stats, scoring = { tiktok: ['shares', 'likes'], instagram: ['saved', 'shares'] }) {
  const views = Number(stats?.views) || 0;
  if (views <= 0) return null;
  const fields = scoring[platform] || [];
  const sum = fields.reduce((s, f) => s + (Number(stats?.[f]) || 0), 0);
  return sum / views;
}

/**
 * The format a metrics row is credited to: its trend format, or its own post type.
 * Only a slideshow post (kind `post`, or a hand-entered row with no kind) counts
 * toward a type: a deck or a clip whose type happens to share a name does not.
 */
export const formatOf = (shape) =>
  shape?.trendFormat || (shape?.type && (!shape.kind || shape.kind === 'post') ? `type:${shape.type}` : null);

/**
 * Our own post types as formats, created once. A type with a rotation weight is
 * proven, at that weight. A weight-0 type named in `seedTrials` (know, budget:
 * the broad listicle and the day's cost, added for this) starts as a trial and
 * has to earn its place by the same numbers as a format the watcher found.
 */
export function ensureOwnFormats(trends, types = [], { seedTrials = [] } = {}) {
  for (const t of types) {
    const id = `type:${t.id}`;
    if (trends.formats[id]) continue;
    if (Number(t.weight) > 0) {
      trends.formats[id] = { id, kind: 'proven', own: true, type: t.id, hook: null, weight: Number(t.weight), status: 'active', results: [] };
    } else if (seedTrials.includes(t.id)) {
      trends.formats[id] = { id, kind: 'trial', own: true, type: t.id, hook: null, weight: 1, status: 'active', results: [] };
    }
  }
  return trends;
}

/**
 * Credit the numbers of rows at least 72 hours old to their formats, once each.
 * `rows` are src/metrics rows: { id, shape, stats: { tiktok, instagram }, at }.
 */
export function credit(trends, rows, { now = Date.now(), minAgeHours = 72, scoring } = {}) {
  let n = 0;
  for (const row of rows) {
    const fid = formatOf(row.shape);
    if (!fid || !trends.formats[fid]) continue;
    if (now - Date.parse(row.at || 0) < minAgeHours * 3_600_000) continue;
    for (const platform of ['tiktok', 'instagram']) {
      const key = `${row.id}:${platform}`;
      if (trends.credited[key]) continue;
      const score = postScore(platform, row.stats?.[platform], scoring);
      if (score == null) continue;
      trends.formats[fid].results.push({ post: row.id, platform, score, at: new Date(now).toISOString() });
      trends.credited[key] = true;
      n++;
    }
  }
  return n;
}

const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Each result as its score over the platform's median in the window (1 = typical). */
export function normalised(trends, { now = Date.now(), windowDays = 30 } = {}) {
  const since = now - windowDays * DAY;
  const all = Object.values(trends.formats).flatMap((f) => f.results.filter((r) => Date.parse(r.at) >= since));
  const med = {};
  for (const p of ['tiktok', 'instagram']) med[p] = median(all.filter((r) => r.platform === p).map((r) => r.score));
  const out = {};
  for (const f of Object.values(trends.formats)) {
    out[f.id] = f.results.filter((r) => Date.parse(r.at) >= since && med[r.platform]).map((r) => ({ ...r, rel: r.score / med[r.platform] }));
  }
  return out;
}

/**
 * Drop, promote, and bring back. A format whose last `dropAfter` results all sit
 * under `lossBelow` of the median drops out, with the reason kept; a trial with
 * `minPosts` results averaging at or above the median becomes proven. At least
 * `keepProven` proven formats stay active whatever their run, so the slate always
 * has something to build.
 *
 * A dropped format the watcher found stays dropped. One of our own types rests
 * `restDays` and comes back as a trial with a clean record: the type is the
 * account's own and a bad fortnight is not a verdict on it forever, but it has to
 * earn its place again by the same numbers.
 */
export function judge(trends, { now = Date.now(), dropAfter = 3, minPosts = 3, windowDays = 30, keepProven = 2, lossBelow = 0.7, restDays = 14 } = {}) {
  const changes = [];
  for (const f of Object.values(trends.formats)) {
    if (f.own && f.status === 'dropped' && now - Date.parse(f.droppedAt || 0) >= restDays * DAY) {
      Object.assign(f, { status: 'active', kind: 'trial', results: [], returnedAt: new Date(now).toISOString() });
      changes.push({ id: f.id, change: 'returned', why: `חזר לניסיון אחרי ${restDays} ימי מנוחה` });
    }
  }
  const rel = normalised(trends, { now, windowDays });
  for (const f of Object.values(trends.formats)) {
    if (f.status !== 'active') continue;
    const mine = (rel[f.id] || []).slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const lastN = mine.slice(-dropAfter);
    if (lastN.length === dropAfter && lastN.every((r) => r.rel < lossBelow)) {
      const activeProven = Object.values(trends.formats).filter((x) => x.status === 'active' && x.kind === 'proven');
      if (f.kind === 'proven' && activeProven.length <= keepProven) continue;
      f.status = 'dropped';
      f.droppedAt = new Date(now).toISOString();
      f.droppedWhy = `${dropAfter} פעמים ברצף מתחת ל-${Math.round(lossBelow * 100)}% מהחציון (${lastN.map((r) => r.rel.toFixed(2)).join(', ')})`;
      changes.push({ id: f.id, change: 'dropped', why: f.droppedWhy });
      continue;
    }
    if (f.kind === 'trial' && mine.length >= minPosts) {
      const avg = mine.reduce((s, r) => s + r.rel, 0) / mine.length;
      if (avg >= 1) {
        f.kind = 'proven';
        f.promotedAt = new Date(now).toISOString();
        changes.push({ id: f.id, change: 'promoted', why: `ממוצע ${avg.toFixed(2)} מהחציון אחרי ${mine.length} פוסטים` });
      }
    }
  }
  return changes;
}

/**
 * The next slot's format: { formatId, kind, type, hook } or null for "let the
 * ordinary rotation decide".
 *
 * Trial when trials are under their share of `recent` (the last two weeks of slate
 * picks, each { kind, formatId }) and one is active; proven otherwise, weighted by
 * its configured weight times its relative score. Trials take turns: the one
 * offered least lately goes next, since results arrive three days after a post and
 * waiting for them would offer the same trial every slot until then. `avoidType`
 * keeps neighbours apart.
 */
export function pickFormat(trends, { provenShare = 0.7, recent = [], avoidType = null, rand = Math.random, now = Date.now(), windowDays = 30 } = {}) {
  const active = Object.values(trends.formats).filter((f) => f.status === 'active');
  const trials = active.filter((f) => f.kind === 'trial');
  const trialShare = recent.length ? recent.filter((r) => r.kind === 'trial').length / recent.length : 0;
  const pickTrial = trials.length && trialShare < 1 - provenShare;

  const avoid = (list) => {
    const kept = list.filter((f) => f.type !== avoidType);
    return kept.length ? kept : list;
  };

  if (pickTrial) {
    const offered = (f) => recent.filter((r) => r.formatId === f.id).length;
    const f = avoid(trials).sort((a, b) => offered(a) - offered(b) || a.results.length - b.results.length)[0];
    return { formatId: f.id, kind: 'trial', type: f.type, hook: f.hook };
  }

  const rel = normalised(trends, { now, windowDays });
  const proven = avoid(active.filter((f) => f.kind === 'proven'));
  if (!proven.length) return null;
  const weightOf = (f) => {
    const r = rel[f.id] || [];
    const perf = r.length ? Math.min(2, Math.max(0.5, r.reduce((s, x) => s + x.rel, 0) / r.length)) : 1;
    return (f.weight || 1) * perf;
  };
  const total = proven.reduce((s, f) => s + weightOf(f), 0);
  let x = rand() * total;
  for (const f of proven) {
    x -= weightOf(f);
    if (x <= 0) return { formatId: f.id, kind: 'proven', type: f.type, hook: f.hook };
  }
  const f = proven[proven.length - 1];
  return { formatId: f.id, kind: 'proven', type: f.type, hook: f.hook };
}

/**
 * A pickType for the slate builder: each call is one slot, and the slots it has
 * already handed out count toward the 70/30 split, with `recent` (earlier slates'
 * picks as { kind, formatId }, oldest first) before them. No format at all falls back to `fallback()`,
 * the ordinary rotation.
 */
export function formatPicker(trends, { provenShare = 0.7, recent = [], rand = Math.random, now = Date.now(), fallback = () => null, keep = 28 } = {}) {
  const picks = [...recent];
  return (prevType = null) => {
    const p = pickFormat(trends, { provenShare, recent: picks.slice(-keep), avoidType: prevType, rand, now });
    if (!p) return fallback();
    picks.push({ kind: p.kind, formatId: p.formatId });
    return p;
  };
}
