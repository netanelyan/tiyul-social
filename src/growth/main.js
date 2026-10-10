import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../env.js';
import { growthSwitch } from './config.js';

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

export async function main({ env = process.env } = {}) {
  loadEnv();
  const sw = growthSwitch({ env });
  if (!sw.on) {
    console.log(`The growth desk is off: ${sw.why}.`);
    console.log('Turn it on with "growth": { "on": true } in post-config.json, or run it once with GROWTH_ON=1.');
    return { on: false };
  }
  const { startDesk } = await import('./desk.js');
  return { on: true, ...(await startDesk({ env })) };
}

const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
if (process.argv[1] && same(resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
  const { on } = await main();
  if (!on) process.exit(0);
}
