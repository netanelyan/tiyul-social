import * as igMetrics from './instagram.js';
import * as ttMetrics from './tiktok.js';
import * as metricsStore from './store.js';

export { metricsStore };
export { weeklyReport, rankBy, window as reportWindow } from './report.js';
export { notePublished, rates, allRows } from './store.js';

// The nightly pass: ask both platforms what the recent posts did.
//
// IT RE-READS RATHER THAN READING ONCE. A post's numbers are still moving a week after
// it went out - most of a TikTok carousel's views arrive after the first day and saves
// keep arriving for longer - so a single reading taken the morning after would rank
// every format by how fast it starts rather than by how well it does. Thirty days is
// the window, and the newest reading replaces the last.
//
// AND IT RECORDS NOTHING IT DID NOT GET. A post whose insights are not published yet
// returns null and is left alone rather than written as zeros, because a stored zero is
// indistinguishable from a post nobody saw - and the report divides by views.

/**
 * One pass. Returns a summary for the log and for the run report.
 *
 * Never throws for one platform being unavailable: the Instagram half works with the
 * token the publisher already holds, and the TikTok half is expected to be blocked -
 * see the note at the top of ./tiktok.js. An outage on one must not cost the other.
 */
export async function collect({ days = 30, limit = 40 } = {}) {
  const out = { instagram: { asked: 0, got: 0, why: null }, tiktok: { asked: 0, got: 0, why: null } };

  // --- Instagram -----------------------------------------------------------
  if (!igMetrics.configured()) {
    out.instagram.why = 'no Instagram token or IG_USER_ID';
  } else {
    const rows = metricsStore.rowsToRefresh('instagram', { days }).slice(0, limit);
    out.instagram.asked = rows.length;
    for (const row of rows) {
      const stats = await igMetrics.statsFor(row.media.instagram);
      if (!stats) continue;
      metricsStore.noteStats(row.id, 'instagram', stats);
      out.instagram.got++;
    }
  }

  // --- TikTok --------------------------------------------------------------
  const gate = ttMetrics.available();
  if (!gate.ok) {
    out.tiktok.why = gate.why;
  } else {
    try {
      // The Display API lists the ACCOUNT's posts rather than answering about one, so
      // this is one call and a join on the id rather than a call per row.
      const { posts } = await ttMetrics.recentPosts({ limit: 20 });
      const byId = new Map(posts.map((p) => [p.postId, p]));
      const rows = metricsStore.rowsToRefresh('tiktok', { days });
      out.tiktok.asked = rows.length;
      for (const row of rows) {
        const got = byId.get(row.media.tiktok);
        if (!got) continue;
        metricsStore.noteStats(row.id, 'tiktok', {
          views: got.views,
          likes: got.likes,
          comments: got.comments,
          shares: got.shares,
          // TikTok's Display API reports no save count, so the field stays null rather
          // than being filled with something adjacent. The report divides by views and
          // a null simply does not rank, which is the honest outcome.
          saved: null,
        });
        out.tiktok.got++;
      }
      if (!posts.length) out.tiktok.why = 'the endpoint returned no posts - see the note in src/metrics/tiktok.js';
    } catch (e) {
      out.tiktok.why = e.message;
    }
  }

  return out;
}

/** The one-line version, for the nightly log and the /status message. */
export const describeCollection = (got) =>
  [
    `אינסטגרם ${got.instagram.got}/${got.instagram.asked}${got.instagram.why ? ` (${got.instagram.why})` : ''}`,
    `טיקטוק ${got.tiktok.got}/${got.tiktok.asked}${got.tiktok.why ? ` (${got.tiktok.why})` : ''}`,
  ].join(' · ');
