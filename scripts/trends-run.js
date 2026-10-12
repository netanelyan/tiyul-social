import { loadEnv } from '../src/env.js';
loadEnv();

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { postConfig } from '../src/postConfig.js';
import { openTrends } from '../src/trends/store.js';
import { runWatcher, describeRun, recheckCards, promoteCardsToTrials } from '../src/trends/run.js';
import { ensureOwnFormats } from '../src/trends/mix.js';
import { monthSpend } from '../src/clients/budget.js';

// The trend watcher, once, by hand.
//
//   npm run trends                          one run into data/trends.json, then the cards
//   npm run trends -- --build 3             and 3 posts built from the new formats, rendered
//                                           at 9:16 and 4:5 into out/trends-demo
//   npm run trends -- --store <file>        a different store (a demo, a test)
//   npm run trends -- --cards               the cards already kept; no run
//   npm run trends -- --per-run 20          look at more winners than trends.perRun this once
//   npm run trends -- --build 1 --format trend:<id> --dest <slug>   one format, one place
//   npm run trends -- --recheck             judge the kept cards again under today's rules
//                                           (no source is looked at again); no run
//
// Runs whatever trends.on says, because running it is the owner asking. While the
// watcher is on in the bot, the bot owns data/trends.json: run this with --store
// pointing elsewhere, or the two writers save over each other.
//
// The posts are built with the rotation's memory untouched in both directions
// (history: [], remember: false), like every lab, and they go nowhere: no queue,
// no Telegram, no platform.

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] && !args[at + 1].startsWith('--') ? args[at + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const cfg = { ...postConfig().trends, ...(flag('per-run') ? { perRun: Number(flag('per-run')) } : {}) };
const storePath = flag('store') ? path.resolve(flag('store')) : undefined;
const t = openTrends(storePath);
ensureOwnFormats(t.data, postConfig().posts.types, { seedTrials: cfg.seedTrials });

// Views where the platform gives them (YouTube), likes and comments where they are
// the whole signal (Instagram), and a weak signal said as one (TikTok).
const sourceLine = (s) => {
  const when = `${s.lang}${s.publishedAt ? ` · עלה ${s.publishedAt.slice(0, 10)}` : ''}`;
  if (s.views != null) return `${s.platform} · ${s.views.toLocaleString('en-US')} צפיות · ${s.likes ?? '?'} לייקים · ${s.comments ?? '?'} תגובות · ${when}`;
  if (s.likes != null || s.comments != null) return `${s.platform} · ${s.likes ?? '?'} לייקים · ${s.comments ?? '?'} תגובות · ${when}`;
  return `${s.platform} · אות חלש, בלי מספרים · ${when}`;
};

function printCards() {
  const cards = Object.values(t.data.cards);
  console.log(`\n${cards.length} כרטיסי פורמט:`);
  for (const c of cards) {
    console.log('');
    console.log(`  [${c.id}] "${c.hookShapeHe}"`);
    console.log(`    נושא: ${c.topicType} · מראה: ${c.look}${c.dropped ? '' : ` · נבנה כ: ${c.type}`}${c.formatId ? ` · פורמט: ${c.formatId}` : ''}`);
    console.log(`    שקפים: ${c.slideStructure}`);
    console.log(`    כיתוב: ${c.captionStyle}`);
    console.log(`    למה עובד: ${c.why}`);
    console.log(`    מקור: ${c.source.url}`);
    console.log(`           ${sourceLine(c.source)}`);
    for (const s of c.alsoSeen || []) console.log(`    גם: ${s.url} (${sourceLine(s)})`);
    if (c.dropped) console.log(`    ✗ ירד: ${c.dropped}`);
  }
}

async function buildFromFormats(n) {
  const { buildPost } = await import('../src/posts/index.js');
  const { pickDestination } = await import('../src/plan/write.js');
  const { destinationsFor } = await import('../src/posts/types.js');
  const { closeBrowser } = await import('../src/render/index.js');
  const rows = JSON.parse(readFileSync(new URL('../destinations.json', import.meta.url), 'utf8')).destinations;
  const outDir = path.resolve(flag('out', 'out/trends-demo'));
  mkdirSync(outDir, { recursive: true });

  // The watcher's own finds (a card behind them), not our seeded types.
  const only = flag('format');
  const trials = Object.values(t.data.formats).filter((f) => f.kind === 'trial' && f.status === 'active' && f.from && (!only || f.id === only));
  const destKey = flag('dest');
  const destRow = destKey ? rows.find((r) => r.id === destKey || r.siteSlug === destKey || r.he === destKey) : null;
  if (destKey && !destRow) throw new Error(`no destination "${destKey}" in destinations.json`);
  // Different types first, so three posts show three formats rather than one twice.
  const order = [...new Map(trials.map((f) => [f.type, f])).values(), ...trials];
  const tried = new Set();
  const used = [];
  const built = flag('format') && existsSync(path.join(outDir, 'built.json')) ? JSON.parse(readFileSync(path.join(outDir, 'built.json'), 'utf8')).filter((b) => b.format !== only) : [];
  const before = built.length;
  try {
    for (const f of order) {
      if (built.length - before >= n) break;
      if (tried.has(f.id)) continue;
      tried.add(f.id);
      const avoid = [...used];
      const misses = [];
      for (let i = 0; i < 4; i++) {
        const dest = destRow ? (i === 0 ? destRow : null) : pickDestination(avoid, { from: destinationsFor(f.type, rows) });
        if (!dest) break;
        avoid.push(dest.he);
        try {
          const { post, rendered, cand } = await buildPost({
            dest,
            type: f.type,
            hookOverride: f.hook,
            trendFormat: f.id,
            targets: ['tiktok', 'instagram'],
            outDir,
            history: [],
            remember: false,
            onProgress: (x) => console.log(`    ${x}`),
          });
          used.push(dest.he);
          built.push({ format: f.id, card: f.from, type: f.type, dest: dest.he, cover: post.titleHe, slides: post.slides.length, tiktok: (rendered.tiktok || []).map((s) => s.filename), instagram: (rendered.instagram || []).map((s) => s.filename), tiktokCaption: cand.tiktokCaption });
          console.log(`  ✅ ${f.id} (${f.type}) · ${dest.he} · "${post.titleHe}" · ${post.slides.length} שקפים`);
          break;
        } catch (e) {
          misses.push(`${dest.he}: ${e.message}`);
        }
      }
      if (!built.slice(before).some((b) => b.format === f.id)) console.log(`  ✗ ${f.id} (${f.type}) לא נבנה: ${misses.slice(0, 2).join(' | ') || 'אין יעד מתאים'}`);
    }
  } finally {
    await closeBrowser().catch(() => {});
  }
  const at = path.join(outDir, 'built.json');
  writeFileSync(at, `${JSON.stringify(built, null, 2)}\n`);
  console.log(`\n${built.length} פוסטים נבנו. רשימה: ${at}`);
  for (const b of built) {
    console.log(`\n  ${b.dest} · ${b.type} · "${b.cover}"`);
    console.log(`    9:16: ${b.tiktok.length} קבצים, ${b.tiktok[0] || ''}`);
    console.log(`    4:5:  ${b.instagram.length} קבצים, ${b.instagram[0] || ''}`);
  }
}

try {
  if (has('recheck')) {
    const settings = { budgetUsd: cfg.budgetUsd, braveCreditUsd: 0 };
    const gone = await recheckCards(t.data, { settings });
    const started = promoteCardsToTrials(t.data, cfg);
    t.save();
    console.log(`נבדקו מחדש: ${gone.length} ירדו${started.length ? `, ${started.length} נכנסו לניסיון במקומם` : ''}`);
    for (const g of gone) console.log(`  ✗ ${g.id}: ${g.why}`);
  } else if (!has('cards')) {
    console.log(`צייד הפורמטים: ${cfg.queries.he.length} חיפושים בעברית, ${cfg.queries.en.length} באנגלית, ${cfg.tiktokQueries.length} בטיקטוק, ${cfg.instagram.hashtagSearch ? `${cfg.instagram.hashtags.length} האשטגים ו` : ''}עד ${cfg.instagram.creatorsPerRun} יוצרים באינסטגרם · עד ${cfg.perRun} כרטיסים`);
    const run = await runWatcher(cfg, { trends: t.data, onProgress: (x) => console.log(`  ${x}`) });
    t.save();
    console.log(`\n${describeRun(run, t.data)}`);
    for (const r of run.rejected) console.log(`  ✋ ${r.url}: ${r.why}`);
    const spend = monthSpend(t.data, { budgetUsd: cfg.budgetUsd, braveCreditUsd: 0 });
    console.log(`\nהוצאה החודש: $${spend.billable.toFixed(3)} מתוך $${spend.cap}`);
  }
  printCards();
  const n = Number(flag('build', 0));
  if (n > 0) {
    console.log(`\nבונה ${n} פוסטים מהפורמטים החדשים, בשני הגדלים:`);
    await buildFromFormats(n);
    t.save();
  }
  console.log(`\nהמאגר: ${t.path}`);
} catch (e) {
  console.error(`\n❌ ${e.message}`);
  if (has('trace')) console.error(e.stack);
  process.exitCode = 1;
}
