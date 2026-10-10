import { createHash } from 'node:crypto';
import { checkPromise as checkPromiseReal, extractCard as extractCardReal } from './extract.js';
import { findWinners as findWinnersReal } from './find.js';
import { mapCard } from './formats.js';

// One watcher run: find what works, take its format, keep what we can fill.
//
// Twice a week from the bot (post-config trends.days), or by hand with
// `npm run trends`. Every source is looked at once: its url is remembered whether
// the card was kept or refused, so a second run never pays to read it again.
//
// The money stop is the growth desk's: src/clients/budget.js, against the
// watcher's own ledger in data/trends.json and its own cap (trends.budgetUsd).
// Brave's free monthly credit is the growth desk's to count, so here every
// Brave call is billed in full: the watcher can only overstate its spend.

const cardId = (url) => createHash('sha1').update(String(url)).digest('hex').slice(0, 10);

/** A hook shape as compared, so two sources with the same shape make one format. */
const shapeKey = (he) =>
  String(he || '')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export async function runWatcher(cfg, { trends, env = process.env, now = Date.now(), deps = {}, onProgress = () => {} } = {}) {
  const find = deps.findWinners || findWinnersReal;
  const extract = deps.extractCard || extractCardReal;
  const promise = deps.checkPromise || checkPromiseReal;
  const state = trends;
  state.seen ??= {};
  const settings = { budgetUsd: cfg.budgetUsd, braveCreditUsd: 0 };
  const run = { at: new Date(now).toISOString(), found: 0, strong: 0, weak: 0, looked: 0, cards: [], rejected: [], dropped: [], trials: [], waiting: [], notes: [] };

  const { found, notes } = await find(cfg, { state, settings, env, now, deps });
  run.notes.push(...notes);
  run.found = found.length;
  run.strong = found.filter((f) => f.signal === 'strong').length;
  run.weak = run.found - run.strong;

  const fresh = found.filter((f) => !state.seen[f.url]).slice(0, cfg.perRun);
  const byShape = new Map(Object.values(state.cards).map((c) => [shapeKey(c.hookShapeHe), c]));

  for (const item of fresh) {
    run.looked++;
    let got;
    try {
      got = await extract(item, { state, settings, now, deps });
    } catch (e) {
      run.notes.push(`${item.url}: ${e.message}`);
      if (e.code === 'budget') break;
      continue;
    } finally {
      state.seen[item.url] = new Date(now).toISOString();
    }
    if (got.rejected) {
      run.rejected.push({ url: item.url, why: got.rejected });
      continue;
    }

    // The same shape from a second source is more evidence for one format, not a
    // second format.
    const same = byShape.get(shapeKey(got.card.hookShapeHe));
    if (same) {
      same.alsoSeen = [...(same.alsoSeen || []), got.card.source].slice(-10);
      run.cards.push({ id: same.id, again: true });
      continue;
    }

    const id = cardId(item.url);
    const card = { id, ...got.card, foundAt: new Date(now).toISOString() };
    const mapped = mapCard(card);
    if (!mapped.dropped) {
      // The second look, only for what passed the first: does the cover promise
      // only what this builder's slides give? A check that fails drops the card
      // too, since an unchecked promise is the thing this exists to stop.
      try {
        const p = await promise(mapped, { state, settings, now });
        if (!p.delivers) mapped.dropped = `הפתיח מבטיח יותר ממה שפוסט ${mapped.type} נותן: ${p.why}`;
      } catch (e) {
        mapped.dropped = `בדיקת ההבטחה נכשלה (${e.message}), אז הפורמט לא נכנס`;
        if (e.code === 'budget') run.notes.push(e.message);
      }
    }
    if (mapped.dropped) {
      card.dropped = mapped.dropped;
      run.dropped.push({ id, why: mapped.dropped, hook: card.hookShapeHe });
    } else {
      card.type = mapped.type;
      card.hook = mapped.hook;
    }
    state.cards[id] = card;
    byShape.set(shapeKey(card.hookShapeHe), card);
    run.cards.push({ id });
    onProgress(`trends: card ${id} ${card.topicType} ${card.dropped ? 'dropped' : card.type}`);
  }

  run.trials = promoteCardsToTrials(state, cfg, now);
  run.waiting = Object.values(state.cards)
    .filter((c) => c.type && !c.formatId)
    .map((c) => c.id);
  state.runs = [...(state.runs || []), run].slice(-30);
  return run;
}

/**
 * Judge the kept cards again under today's rules, without looking at their
 * sources again: when a check tightens, the formats already in play answer to it.
 * A card that fails now is dropped with the new reason, and its format, if it has
 * one and no results yet, goes with it. A format with results is left to the
 * numbers. Returns [{ id, why }].
 */
export async function recheckCards(state, { now = Date.now(), settings, deps = {} } = {}) {
  const promise = deps.checkPromise || checkPromiseReal;
  const out = [];
  for (const card of Object.values(state.cards)) {
    if (card.dropped || !card.type) continue;
    let why = mapCard(card).dropped || null;
    if (!why) {
      try {
        const p = await promise({ type: card.type, hook: card.hook }, { state, settings, now });
        if (!p.delivers) why = `הפתיח מבטיח יותר ממה שפוסט ${card.type} נותן: ${p.why}`;
      } catch (e) {
        if (e.code === 'budget') break;
        continue;
      }
    }
    if (!why) continue;
    card.dropped = why;
    delete card.type;
    const f = card.formatId && state.formats[card.formatId];
    if (f && f.status === 'active' && !f.results.length) {
      f.status = 'dropped';
      f.droppedAt = new Date(now).toISOString();
      f.droppedWhy = why;
    }
    out.push({ id: card.id, why });
  }
  return out;
}

/**
 * Cards that can be built become trial formats, up to `maxTrials` at once,
 * strongest source first. The rest wait for a trial to finish.
 */
export function promoteCardsToTrials(state, cfg, now = Date.now()) {
  const active = Object.values(state.formats).filter((f) => f.kind === 'trial' && f.status === 'active').length;
  const room = Math.max(0, cfg.maxTrials - active);
  const waiting = Object.values(state.cards)
    .filter((c) => c.type && !c.formatId)
    .sort((a, b) => (b.source?.signal === 'strong') - (a.source?.signal === 'strong') || (b.source?.views || 0) - (a.source?.views || 0));
  const started = [];
  for (const c of waiting.slice(0, room)) {
    const fid = `trend:${c.id}`;
    state.formats[fid] = { id: fid, kind: 'trial', own: false, type: c.type, hook: c.hook, from: c.id, weight: 1, status: 'active', results: [], startedAt: new Date(now).toISOString() };
    c.formatId = fid;
    started.push(fid);
  }
  return started;
}

/** Whether the watcher is due: a configured day, at or after the hour, not run today. */
export function watcherDue(cfg, { now = Date.now(), lastRunAt = null, timeZone = 'Asia/Jerusalem' } = {}) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: 'numeric', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(now))
      .map((p) => [p.type, p.value])
  );
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  if (!cfg.days.includes(day) || Number(parts.hour) < cfg.hour) return false;
  if (!lastRunAt) return true;
  const last = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(lastRunAt));
  return last !== today;
}

/** A run as a few Hebrew lines for Telegram and the script. */
export function describeRun(run, trends) {
  const lines = [
    `🔎 צייד הפורמטים: ${run.found} מועמדים (${run.strong} עם מספרים מיוטיוב, ${run.weak} אות חלש מטיקטוק), נבדקו ${run.looked}`,
  ];
  const kept = run.cards.filter((c) => !c.again).map((c) => trends.cards[c.id]).filter(Boolean);
  for (const c of kept) {
    const when = c.source.publishedAt ? `, ${c.source.publishedAt.slice(0, 10)}` : '';
    const src = c.source.views != null ? `${c.source.platform}, ${c.source.views.toLocaleString('en-US')} צפיות${when}` : `${c.source.platform}, אות חלש בלי מספרים${when}`;
    lines.push(`• "${c.hookShapeHe}" · ${c.topicType} · ${c.look}${c.dropped ? ` · ירד: ${c.dropped}` : ` → ${c.type}`} (${src})`);
  }
  const again = run.cards.filter((c) => c.again).length;
  if (again) lines.push(`↺ ${again} מקורות נוספים לפורמטים שכבר יש`);
  if (run.rejected.length) lines.push(`✋ נדחו ${run.rejected.length}: ${run.rejected.slice(0, 3).map((r) => r.why).join(' | ')}`);
  if (run.trials.length) lines.push(`🧪 התחילו בניסיון: ${run.trials.length}`);
  if (run.waiting.length) lines.push(`⏳ ממתינים לתור: ${run.waiting.length}`);
  for (const n of run.notes.slice(0, 4)) lines.push(`⚠️ ${n}`);
  return lines.join('\n');
}
