import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';

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

// Start from empty every time.
//
// The suite writes to this file — it records a published id to prove /redo
// cannot resurrect it. Left in place, that id is still there on the next run,
// so the test that asserts the item ranks *before* publishing fails. It also
// shifts the pillar deficits, which feed the scorer, which broke an unrelated
// ranking test. A test that passes only on a clean checkout is worse than no
// test.
rmSync(process.env.STORE_PATH, { force: true });

await import('./selftest.run.js');
