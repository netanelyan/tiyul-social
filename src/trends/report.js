import { formatOf, postScore } from './mix.js';

// The weekly Telegram report: the top three formats by saves, the new formats on
// trial, the ones dropped and why, and the week's best post with its numbers.
//
// "By saves" is Instagram's number, because TikTok publishes none. Where a format
// has no Instagram saves yet, its TikTok score (shares plus likes per view) is shown
// beside it and labelled as such, never relabelled as saves.

const DAY = 86_400_000;
const pct = (x) => `${(x * 100).toFixed(1)}%`;

export function weeklyTrendsReport(trends, rows, { now = Date.now() } = {}) {
  const since = now - 7 * DAY;
  const lines = ['📊 הפורמטים השבוע', ''];
  const label = (f) => (f.own ? `סוג ${f.type}` : `"${f.hook?.he || f.id}" (${f.type})`);

  // Top 3 by Instagram saves per view, over this week's rows.
  const byFormat = new Map();
  for (const r of rows.filter((x) => Date.parse(x.at || 0) >= since)) {
    const fid = formatOf(r.shape);
    if (!fid) continue;
    const ig = r.stats?.instagram;
    const tt = r.stats?.tiktok;
    const e = byFormat.get(fid) || { saves: 0, igViews: 0, tt: [] };
    if (ig?.views) {
      e.saves += Number(ig.saved) || 0;
      e.igViews += Number(ig.views) || 0;
    }
    const s = postScore('tiktok', tt);
    if (s != null) e.tt.push(s);
    byFormat.set(fid, e);
  }
  const ranked = [...byFormat.entries()]
    .map(([fid, e]) => ({ fid, saveRate: e.igViews ? e.saves / e.igViews : null, tt: e.tt.length ? e.tt.reduce((a, b) => a + b, 0) / e.tt.length : null }))
    .sort((a, b) => (b.saveRate ?? -1) - (a.saveRate ?? -1) || (b.tt ?? -1) - (a.tt ?? -1))
    .slice(0, 3);
  lines.push('🏆 שלושת הפורמטים המובילים בשמירות (אינסטגרם):');
  if (!ranked.length) lines.push('   עוד אין מספרים מהשבוע');
  ranked.forEach((r, i) => {
    const f = trends.formats[r.fid];
    const save = r.saveRate != null ? `${pct(r.saveRate)} שמירות לצפייה` : 'אין עדיין שמירות מאינסטגרם';
    const tt = r.tt != null ? ` · טיקטוק: ${pct(r.tt)} שיתופים ולייקים לצפייה` : '';
    lines.push(`   ${i + 1}. ${f ? label(f) : r.fid}: ${save}${tt}`);
  });

  const trials = Object.values(trends.formats).filter((f) => f.kind === 'trial' && f.status === 'active');
  lines.push('', `🧪 בניסיון (${trials.length}):`);
  for (const f of trials.slice(0, 6)) {
    const card = trends.cards[f.from];
    lines.push(`   ${label(f)} · ${f.results.length} תוצאות${card?.source ? ` · מקור: ${card.source.platform}${card.source.views ? `, ${card.source.views.toLocaleString('en-US')} צפיות` : ', אות חלש בלי מספרים'}` : ''}`);
  }

  const dropped = Object.values(trends.formats).filter((f) => f.status === 'dropped' && Date.parse(f.droppedAt || 0) >= since);
  lines.push('', `🗑 ירדו השבוע (${dropped.length}):`);
  for (const f of dropped) lines.push(`   ${label(f)}: ${f.droppedWhy}`);

  const best = rows
    .filter((x) => Date.parse(x.at || 0) >= since)
    .map((x) => ({ x, views: Math.max(Number(x.stats?.tiktok?.views) || 0, Number(x.stats?.instagram?.views) || 0) }))
    .sort((a, b) => b.views - a.views)[0];
  lines.push('', '⭐ הפוסט הטוב של השבוע:');
  if (!best || !best.views) {
    lines.push('   עוד אין מספרים');
  } else {
    const tt = best.x.stats?.tiktok;
    const ig = best.x.stats?.instagram;
    lines.push(`   ${best.x.shape?.hookText || best.x.id}`);
    if (tt?.views) lines.push(`   טיקטוק: ${tt.views} צפיות, ${tt.likes ?? 0} לייקים, ${tt.shares ?? 0} שיתופים`);
    if (ig?.views) lines.push(`   אינסטגרם: ${ig.views} צפיות, ${ig.saved ?? 0} שמירות, ${ig.shares ?? 0} שיתופים`);
  }
  return lines.join('\n');
}
