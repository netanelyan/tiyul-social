import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// What was left over from the per-post approvals when the slate became the only path.
//
// On 12 Oct 2026 the owner ordered one pipeline: the 08:00 digest, then Zernio. The
// cards still waiting for a tap, the approved posts still queued for the drip and
// the deck ideas still waiting to be built belonged to the old flow, and each one
// either moves into the digest (through the slate inbox) or is cancelled.
//
// THE DECISIONS ARE DATA, NOT CODE: data/old-flow.json names each one by its id,
// with the reason, written after reading what was actually waiting on the box. The
// bot applies it once at boot, because only the bot may touch its store (it holds
// data/store.json in memory and saves over any other writer), and renames it so it
// never runs twice. Anything the file does not name, because it arrived between the
// file being written and the restart, gets the default below and is reported the same.
//
//   {
//     "move":   [{ "id", "platforms": ["instagram"], "notBefore": "YYYY-MM-DD", "note" }],
//     "cancel": [{ "id", "why" }],
//     "unlisted": { "notBefore": "YYYY-MM-DD" }
//   }

export const leftoversFile = () =>
  process.env.OLD_FLOW_FILE || fileURLToPath(new URL('../../data/old-flow.json', import.meta.url));

const PLATFORMS = ['tiktok', 'instagram'];

/**
 * Decide every leftover. Pure.
 *
 *   staged     [{ key, cand }]   waiting for an approval tap
 *   queued     [cand]            approved, waiting for the drip
 *   proposals  [{ key, proposal }] deck ideas waiting to be built
 *
 * Returns { moves: [{ from, key, cand, platforms, notBefore, note }],
 *           cancels: [{ from, key, cand, why }] }. Every input lands in exactly one.
 *
 * The defaults, for anything the file does not name: a card nobody approved is
 * cancelled (the slate builds the day's posts itself), an approved post moves into
 * the digest owing what it still owed, and a deck idea is cancelled.
 */
export function planLeftovers({ staged = [], queued = [], proposals = [] }, plan = {}) {
  const move = new Map((plan.move || []).map((m) => [m.id, m]));
  const cancel = new Map((plan.cancel || []).map((c) => [c.id, c]));
  const moves = [];
  const cancels = [];

  const decide = (from, key, cand, owed) => {
    const m = move.get(cand?.id);
    const c = cancel.get(cand?.id);
    if (m) {
      const platforms = (m.platforms?.length ? m.platforms : owed).filter((p) => PLATFORMS.includes(p));
      moves.push({ from, key, cand, platforms, notBefore: m.notBefore || null, note: m.note || null });
    } else if (c) {
      cancels.push({ from, key, cand, why: c.why || 'בוטל' });
    } else if (from === 'queue') {
      const platforms = owed.filter((p) => PLATFORMS.includes(p));
      if (platforms.length) moves.push({ from, key, cand, platforms, notBefore: plan.unlisted?.notBefore || null, note: '↩️ אושר בכרטיס לפני המעבר לתוכנית היומית' });
      else cancels.push({ from, key, cand, why: 'לא נשאר לו יעד' });
    } else {
      cancels.push({ from, key, cand, why: 'כרטיס שלא אושר לפני המעבר לתוכנית היומית' });
    }
  };

  for (const { key, cand } of staged) decide('staging', key, cand, cand?.publishTargets || []);
  for (const cand of queued) decide('queue', cand?.id, cand, cand?.pendingTargets?.length ? cand.pendingTargets : cand?.publishTargets || []);
  for (const { key, proposal } of proposals) {
    cancels.push({ from: 'proposal', key, cand: { id: key, headline: proposal?.idea?.titleHe || key }, why: 'רעיון למצגת, לא פוסט: הרעיונות כבר לא נשלחים לאישור' });
  }
  return { moves, cancels };
}

/** The plan file, or null when there is none. A broken file is an error, not a silent skip. */
export function readLeftoversPlan(file = leftoversFile()) {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** Done: the file is renamed beside its result, so a restart does not run it again. */
export function markLeftoversApplied(result, file = leftoversFile()) {
  const done = file.replace(/\.json$/, '') + `.applied-${new Date().toISOString().slice(0, 10)}.json`;
  renameSync(file, done);
  writeFileSync(done.replace(/\.json$/, '.result.json'), JSON.stringify(result, null, 1));
  return done;
}

/** The Telegram report, one line per post. */
export function leftoversReport({ moved, cancelled, gone }) {
  const name = (x) => `${x.cand?.headline || x.cand?.id || x.id}`;
  const lines = ['🧹 מה שנשאר מהזרימה הישנה (כרטיסים, תור, רעיונות):'];
  if (moved.length) {
    lines.push('', `📥 עבר לתוכנית היומית (${moved.length}):`);
    for (const m of moved) lines.push(`• ${name(m)} · ${m.platforms.join('+')}${m.notBefore ? ` · מ-${m.notBefore}` : ''}`);
  }
  if (cancelled.length) {
    lines.push('', `🗑 בוטל (${cancelled.length}):`);
    for (const c of cancelled) lines.push(`• ${name(c)}: ${c.why}`);
  }
  if (gone.length) {
    lines.push('', `ℹ️ כבר לא חיכה (${gone.length}): ${gone.join(', ')}`);
  }
  return lines.join('\n');
}
