import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { findClips } from './pexels.js';
import { burnClip, download, clipOutputDir, ffmpegReady } from './overlay.js';
import { clipHook, postConfig } from '../postConfig.js';
import { assertNoUrl } from '../format.js';

// A stock clip and a Hebrew line become something you can approve.
//
// Deliberately the same shape as a card and a deck candidate — id, kind,
// headline, a file, an approval message — so staging, the queue and the
// approve/decline path work on it without knowing what it is. That is the same
// bargain src/deck/candidate.js made, and it is why a deck could be added to
// this bot without rewriting the bot.
//
// What it does NOT do yet is publish. The TikTok video path is a different
// media_type and a separate piece of work; until that exists, a clip is
// something you look at and judge, which is the whole point of this stage.

/** Stable per Pexels clip + line, so the same pairing cannot be staged twice. */
export const clipId = (pexelsId, hook) =>
  createHash('sha1').update(`${pexelsId}|${hook}`).digest('hex').slice(0, 12);

/**
 * Build one clip from one search result.
 *
 * The hook is chosen here rather than passed in so that a batch gets a
 * different line per clip — drawing once and reusing it would produce five
 * videos of the same sentence, which is the template problem again.
 */
export async function buildClip(found, { outDir = clipOutputDir(), hook = null, keepSource = false } = {}) {
  const line = hook || clipHook();

  // The same guard the captions run. A hook is owner-written text and the rule
  // is about anything we publish, not about captions specifically — and the
  // cheapest place to find out that a line has a domain in it is before the
  // encode, not after.
  assertNoUrl(line, 'the clip hook');

  const id = clipId(found.id, line);
  const source = join(outDir, `src-${found.id}.mp4`);
  const png = join(outDir, `txt-${id}.png`);
  const file = join(outDir, `clip-${id}.mp4`);

  await download(found.src, source);
  try {
    await burnClip(source, { text: line, outFile: file, pngFile: png });
  } finally {
    // The source is 4K and disposable; the finished 1080 clip is what matters.
    // Kept only when something is being debugged, because "the crop is wrong"
    // is impossible to argue about without the original.
    if (!keepSource) rmSync(source, { force: true });
    rmSync(png, { force: true });
  }

  const cfg = postConfig().clips.video;
  return {
    kind: 'clip',
    id,
    hook: line,
    headline: line,
    // The shared vocabulary the rest of the pipeline speaks. A clip has no
    // source article; what it has is a stock library and an uploader, and that
    // is what provenance means here.
    sourceName: `Pexels · ${found.credit || 'unknown'}`,
    sourceUrl: found.page,
    pillar: 'day',
    tags: [],
    createdAt: new Date().toISOString(),
    clip: {
      file,
      seconds: cfg.seconds,
      width: cfg.width,
      height: cfg.height,
      pexelsId: found.id,
      title: found.title,
      query: found.query,
      score: found.score,
      duration: found.duration,
      credit: found.credit,
      creditUrl: found.creditUrl,
      page: found.page,
      provenance: 'pexels',
    },
    card: { file },
  };
}

/**
 * Find clips and build a batch of them.
 *
 * Failures are per clip and reported rather than thrown: a Pexels rendition
 * that 404s or a source ffmpeg cannot read should cost that one clip, not the
 * batch. Which one failed and why travels back, because a batch that quietly
 * returns three of five looks identical to a search that only found three.
 */
export async function buildClips({ count = 5, seen = new Set(), outDir = clipOutputDir() } = {}) {
  const ready = await ffmpegReady();
  if (!ready.ok) throw new Error(`ffmpeg is not usable (${ready.path}): ${ready.error}`);

  const { clips: found, total, vetoed, errors } = await findClips({ limit: count * 3, seen });

  const built = [];
  const failed = [];
  for (const f of found) {
    if (built.length >= count) break;
    try {
      built.push(await buildClip(f, { outDir }));
    } catch (e) {
      failed.push(`${f.title}: ${e.message}`);
    }
  }

  return { clips: built, considered: total, vetoed, failed, searchErrors: errors, ffmpeg: ready.version };
}

/**
 * What you are shown before deciding.
 *
 * Short on purpose. The video is above this message and it answers almost
 * everything; what it cannot tell you is where the footage came from, what the
 * filter thought of it, and which search produced it — and that last one is the
 * field you act on, because a bad clip usually means a bad query rather than a
 * bad ranking.
 */
export function clipApprovalMessage(cand) {
  const c = cand.clip || {};
  return [
    `🎬 קליפ · ${c.seconds}ש׳ · ${c.width}x${c.height}`,
    '',
    `✍️ הטקסט: ${cand.hook}`,
    '',
    `🎥 מקור: ${c.title}`,
    `   Pexels · ${c.credit || 'ללא שם'} · ציון ${c.score}`,
    `   חיפוש: "${c.query}"`,
    '',
    `🔗 ${c.page}`,
  ].join('\n');
}
