import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../env.js';
import { growthSwitch } from './config.js';
import { startProblem } from './web/auth.js';

// `npm run growth`.
//
// The switch is checked before anything else in this folder is loaded. With it
// off, the process prints why and exits: no port, no store, no timer. The rest
// of the desk is a dynamic import for exactly that reason; a static one would
// evaluate every module before the first line here ran.
//
// NOTHING HAPPENS ON IMPORT. The selftest loads every module under src/ to
// prove it parses, and "nothing under src/ has a side effect at import" is a
// rule this repo learned the hard way. So main() runs only when this file is
// the program node was started with.

// ONE DESK, ONE LEDGER. When the data moves to the VPS, data/growth.MOVED is
// written beside the old file with the address it moved to, and a desk started
// next to it refuses: two desks would each spend the same monthly cap and keep
// two histories that never meet.
export const MOVED = fileURLToPath(new URL('../../data/growth.MOVED', import.meta.url));

export async function main({ env = process.env, movedFile = MOVED } = {}) {
  loadEnv();
  const sw = growthSwitch({ env });
  if (!sw.on) {
    console.log(`The growth desk is off: ${sw.why}.`);
    console.log('Turn it on with "growth": { "on": true } in post-config.json, or run it once with GROWTH_ON=1.');
    return { on: false };
  }
  if (existsSync(movedFile) && !env.GROWTH_STORE_PATH) {
    console.log(`The growth desk moved: ${readFileSync(movedFile, 'utf8').trim()}`);
    console.log('Open it there. This copy does not start, so the two cannot both spend the budget.');
    return { on: false, moved: true };
  }
  const problem = startProblem(env);
  if (problem) {
    console.error(problem);
    return { on: false, refused: problem };
  }
  const { startDesk } = await import('./desk.js');
  return { on: true, ...(await startDesk({ env })) };
}

const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
if (process.argv[1] && same(resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
  const r = await main();
  // A refusal (a public desk with no password) is a failure systemd should see.
  if (!r.on) process.exit(r.refused ? 1 : 0);
}
