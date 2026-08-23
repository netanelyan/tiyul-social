import { fileURLToPath } from 'node:url';

// Launcher. The tests themselves are in selftest.run.js.
//
// This exists for one reason: ES module imports are hoisted and evaluated
// before any module-level statement in the file that declares them. So setting
// STORE_PATH at the top of a file that also imports src/store.js is too late —
// the store has already resolved its path and read the real data/store.json.
//
// That matters because merely importing the store prunes and rewrites that
// file, and the dedupe tests write to it outright. On the VPS it holds the live
// Instagram token, the publish history and the dedupe record: `npm test` there
// must not touch it.
//
// A dynamic import is the fix. It runs after this line, not before it.
process.env.STORE_PATH ||= fileURLToPath(new URL('../data/.selftest-store.json', import.meta.url));

await import('./selftest.run.js');
