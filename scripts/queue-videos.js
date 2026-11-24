import { copyFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnv } from '../src/env.js';
import { addToInbox, entryProblem, inboxDir, readInbox } from '../src/slate/inbox.js';

// Finished videos into the daily slate, one a day, in a fixed order.
//
//   npm run queue-videos -- <dir>          queue every <id>.mp4 + <id>.json in dir
//   npm run queue-videos -- <dir> --dry    check them and print the plan, write nothing
//   npm run queue-videos -- <dir> --start=2026-11-25   none of them before that Israel date
//   npm run queue-videos -- --status       how many queued videos are still waiting
//
// WHERE THE VIDEOS COME FROM. They are rendered on a desktop (demos/anim in the
// parent folder: a narrated mascot, music, captions) from scripts whose every
// fact is sourced, and uploaded here as an mp4 with a json beside it holding the
// caption, hashtags and sources. Nothing on this box writes a fact.
//
// WHAT THIS DOES WITH THEM. Copies each mp4 into the card host's folder, which is
// what Zernio pulls a video from, and writes one slate inbox entry per video.
// The slate gives inbox entries the earliest video slot of the day, so with one
// video slot a day the queue posts one a day, oldest first. `addedAt` is spaced
// a second apart per video to keep the order exactly as given.
//
// ORDER. An `order.txt` in the folder (one id per line) wins; otherwise the
// file names, sorted. The dry run prints the order before anything is written.

const VIDEO = { width: 1080, height: 1920 };

/** The inbox entry for one finished video. Pure, apart from the clock. */
export function queueEntry(meta, { file, url, addedAt }) {
  const caption = [meta.caption, (meta.hashtags || []).join(' ')].filter(Boolean).join('\n\n');
  return {
    cand: {
      kind: 'clip',
      id: `queue-${meta.id}`,
      hook: meta.headline,
      headline: meta.headline,
      hookWritten: true,
      hookNote: 'queue: rendered and fact-checked on the desktop, sources in the json',
      sourceName: 'tiyulplus.com',
      sourceUrl: null,
      pillar: 'tips',
      tags: [],
      createdAt: new Date().toISOString(),
      overrides: [],
      notes: [],
      sources: meta.sources || [],
      caption,
      tiktokCaption: caption,
      instagramCaption: caption,
      channelCaption: caption,
      clip: {
        shape: 'queue',
        format: 'queue',
        file,
        url,
        seconds: meta.seconds || null,
        width: VIDEO.width,
        height: VIDEO.height,
        // A narrator speaks over the whole video (with an original music bed
        // under it), which is what the owner's sound rule asks of a video.
        narrated: true,
      },
    },
    platforms: ['tiktok', 'instagram'],
    note: `🎬 מהתור: ${meta.headline}`,
    addedAt,
  };
}

function orderOf(dir) {
  const ids = readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)).sort();
  const orderFile = path.join(dir, 'order.txt');
  if (!existsSync(orderFile)) return ids;
  const wanted = readFileSync(orderFile, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const missing = wanted.filter((id) => !ids.includes(id));
  if (missing.length) throw new Error(`order.txt names videos that are not here: ${missing.join(', ')}`);
  return [...wanted, ...ids.filter((id) => !wanted.includes(id))];
}

function status() {
  const { entries } = readInbox();
  const queued = entries.filter((e) => e.entry.cand?.clip?.format === 'queue');
  console.log(`${queued.length} queued videos waiting in ${inboxDir()}`);
  for (const { entry } of queued) console.log(`  ${entry.cand.id}  ${entry.cand.headline}`);
}

function main() {
  loadEnv();
  const args = process.argv.slice(2);
  if (args.includes('--status')) return status();
  const dry = args.includes('--dry');
  // The slate keeps an entry with `notBefore` for the first slate on or after that date.
  const startArg = args.find((a) => a.startsWith('--start='));
  const notBefore = startArg ? startArg.slice(8) : null;
  if (notBefore && !/^\d{4}-\d{2}-\d{2}$/.test(notBefore)) throw new Error('--start wants an Israel date, YYYY-MM-DD');
  const dir = args.find((a) => !a.startsWith('--'));
  if (!dir) throw new Error('usage: npm run queue-videos -- <dir> [--dry] [--start=YYYY-MM-DD] | --status');

  const outDir = process.env.CARD_OUTPUT_DIR;
  if (!outDir) throw new Error('CARD_OUTPUT_DIR is not set - Zernio pulls videos from the card host');
  const base = String(process.env.CARD_PUBLIC_BASE_URLS || process.env.CARD_PUBLIC_BASE_URL || '').split(',')[0].trim().replace(/\/+$/, '');

  const start = Date.now();
  const plan = orderOf(dir).map((id, i) => {
    const meta = JSON.parse(readFileSync(path.join(dir, `${id}.json`), 'utf8'));
    for (const field of ['headline', 'caption', 'seconds']) {
      if (!meta[field]) throw new Error(`${id}.json has no ${field}`);
    }
    const src = path.join(dir, `${id}.mp4`);
    if (!existsSync(src)) throw new Error(`${id}.json has no ${id}.mp4 beside it`);
    const name = `queue-${id}.mp4`;
    const entry = queueEntry(meta, {
      file: path.join(outDir, name),
      url: `${base}/${encodeURIComponent(name)}`,
      addedAt: new Date(start + i * 1000).toISOString(),
    });
    if (notBefore) entry.notBefore = notBefore;
    const problem = entryProblem(entry);
    if (problem) throw new Error(`${id}: ${problem}`);
    return { id, src, entry };
  });

  for (const [i, p] of plan.entries()) console.log(`${String(i + 1).padStart(2)}. ${p.id}  ${p.entry.cand.headline}  (${p.entry.cand.clip.seconds}s)`);
  if (notBefore) console.log(`none posts before ${notBefore}`);
  if (dry) return console.log('dry run, nothing written');

  for (const p of plan) {
    copyFileSync(p.src, p.entry.cand.clip.file);
    addToInbox(p.entry);
  }
  console.log(`queued ${plan.length} videos into ${inboxDir()}`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('queue-videos.js')) main();
