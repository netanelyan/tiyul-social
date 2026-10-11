import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Spending the desk did not do itself, brought into its ledger.
//
// A script run by hand with the desk's keys (scripts/growth-route-check.js, the
// route report of 2026-10-11) spends on the same APIs, and the owner's rule of
// 2026-10-11 is that it counts against the same monthly budget. The script
// cannot write the desk's store: the desk holds it in memory and saves over it
// (store.js). So the script drops a file in this folder, and the desk folds it
// in on its next tick (desk.js):
//
//   - the spend into the ledger (state.spend), month by month, so the budget,
//     the guard and Reports all count it;
//   - the Google answers it paid for into the route check's cache
//     (state.placeChecks), so the desk does not pay for the same places again;
//   - a line in state.ledgerRuns, which Reports lists.
//
// A folded file moves to used/; one that cannot be read moves to rejected/.

export const inboxDir = (storePath) => join(dirname(storePath), 'ledger-inbox');

/** What `after` adds to `before`, per month and API ({ 'YYYY-MM': { api: { units, usd } } }). */
export function spendDelta(before = {}, after = {}) {
  const out = {};
  for (const [month, apis] of Object.entries(after)) {
    for (const [api, row] of Object.entries(apis)) {
      const was = before[month]?.[api] || { units: 0, usd: 0 };
      const units = row.units - was.units;
      const usd = row.usd - was.usd;
      if (units <= 0 && usd <= 0) continue;
      (out[month] ??= {})[api] = { units, usd };
    }
  }
  return out;
}

const total = (spend) => Object.values(spend || {}).reduce((n, apis) => n + Object.values(apis).reduce((m, r) => m + (Number(r.usd) || 0), 0), 0);

/** Drop one run's spend (and the Google answers it paid for) for the desk to fold in. Returns the file. */
export function dropSpend(dir, { source, at = new Date().toISOString(), spend, placeChecks = {}, note = '' }) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${at.replace(/[^0-9TZ]/g, '')}-${String(source).replace(/[^A-Za-z0-9]+/g, '-').slice(0, 40)}.json`);
  writeFileSync(file, JSON.stringify({ kind: 'spend', source, at, note, spend, placeChecks }, null, 1));
  return file;
}

function problem(entry) {
  if (entry?.kind !== 'spend' || !entry.source || !Date.parse(entry.at || '')) return 'not a spend entry (kind, source, at)';
  for (const [month, apis] of Object.entries(entry.spend || {})) {
    if (!/^\d{4}-\d{2}$/.test(month)) return `"${month}" is not a month`;
    for (const r of Object.values(apis)) if (!(r.units >= 0 && r.usd >= 0)) return 'units and usd are numbers of zero or more';
  }
  return null;
}

/**
 * Fold every file in `dir` into `state`. `save` is called once, after folding
 * and before any file moves, so a crash in between leaves the files to fold
 * again rather than spend that was never saved. With `move: false` the files
 * stay where they are (a script counting what is pending before it spends
 * more). Returns the entries folded.
 */
export function foldInbox(state, dir, { move = true, save = null } = {}) {
  if (!dir || !existsSync(dir)) return [];
  const folded = [];
  const moves = [];
  const away = (file, to) => move && moves.push([file, to]);
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    let entry;
    try {
      entry = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    } catch {
      away(file, 'rejected');
      continue;
    }
    if (problem(entry)) {
      away(file, 'rejected');
      continue;
    }
    for (const [month, apis] of Object.entries(entry.spend || {})) {
      for (const [api, r] of Object.entries(apis)) {
        const row = ((state.spend ??= {})[month] ??= {})[api] ??= { units: 0, usd: 0 };
        row.units += Number(r.units) || 0;
        row.usd += Number(r.usd) || 0;
      }
    }
    const cache = (state.placeChecks ??= {});
    for (const [id, hit] of Object.entries(entry.placeChecks || {})) {
      if (!cache[id] || Date.parse(hit.at) > Date.parse(cache[id].at)) cache[id] = hit;
    }
    if (move) (state.ledgerRuns ??= []).unshift({ at: entry.at, source: entry.source, note: entry.note || '', usd: total(entry.spend) });
    away(file, 'used');
    folded.push(entry);
  }
  if (folded.length) save?.();
  for (const [file, to] of moves) {
    mkdirSync(join(dir, to), { recursive: true });
    renameSync(join(dir, file), join(dir, to, file));
  }
  return folded;
}
