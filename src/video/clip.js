import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { findClips } from './pexels.js';
import { burnClip, download, clipOutputDir, ffmpegReady } from './overlay.js';
import { clipHook, postConfig } from '../postConfig.js';
import { writeHook, hasApiKey, namesOtherCountry, trailsOff } from './hooks.js';
import { assertNoUrl } from '../format.js';
import { clipCaption } from '../hashtags.js';
import { targetsForKind } from '../publish/targets.js';

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
 * The line is WRITTEN for this clip, not drawn from a pool. `used` carries the
 * lines already burned into the other clips of this batch so the writer can be
 * told not to repeat itself — a batch of five videos under five variations of
 * one sentence is the template problem wearing a different hat.
 *
 * The pool survives as the fallback for a failed call. That degradation is
 * deliberate and it is the right direction: a slightly repetitive post beats no
 * post, and it is reported rather than hidden so a quietly broken API key does
 * not look like an editorial choice.
 */
export async function buildClip(found, { outDir = clipOutputDir(), hook = null, used = new Set(), keepSource = false } = {}) {
  let line = hook;
  let written = Boolean(hook);
  let hookNote = null;

  if (!line) {
    if (hasApiKey()) {
      try {
        const res = await writeHook(found, { used });
        if (res.text) {
          line = res.text;
          written = true;
          if (res.rejected?.length) hookNote = `${res.rejected.length} candidate(s) rejected`;
        } else {
          hookNote = res.error || 'no usable line';
        }
      } catch (e) {
        hookNote = e.message;
      }
    } else {
      hookNote = 'ANTHROPIC_API_KEY is not set';
    }
  }
  if (!line) line = clipHook();

  // The same guard the captions run. The line is burned into the video, so "no
  // published string carries a domain" has to cover it too — and the cheapest
  // place to find out is before the encode, not after.
  assertNoUrl(line, 'the clip hook');

  // And nothing half-written gets encoded, whoever wrote it.
  //
  // The writer already refuses a line that trails off, so for a /clip batch
  // this can only fire on the fallback pool. It is here for the path the writer
  // does not see: a line pinned by hand in scripts/clip-redo.js, which is
  // copied off a previous run's output and is exactly where a "..." survives a
  // round trip. Burned into the video it costs the whole clip — a re-encode is
  // the cheapest possible remedy and this is the last moment it is still cheap.
  const unfinished = trailsOff(line);
  if (unfinished) throw new Error(`the hook ${unfinished}: "${line}"`);

  // One country per clip, checked here because here is where the two halves
  // meet. The line is burned into the video and the pin is printed underneath
  // it, and they are built from the same fact by different routes — the writer
  // is told the country, the pin reads it off the judge. A post that says
  // "טיסה לאיטליה" over a pin reading שווייץ is wrong in a way no viewer needs
  // any local knowledge to see.
  //
  // The writer's own guard catches this for a written line. This one catches
  // the case it cannot see: a line pinned by hand, which is the whole point of
  // scripts/clip-redo.js and the one path where a human is overruling the
  // judge. If the judge is what is wrong, correct the judge — `place=` — do
  // not publish two answers.
  const placeHe = found.vision?.place
    ? postConfig().places[String(found.vision.place).toLowerCase()] || null
    : null;
  const clash = namesOtherCountry(line, placeHe);
  if (clash) {
    throw new Error(
      `the line names ${clash} and this clip is ${placeHe || 'not placed'} - ` +
        'pass place=<Country> to say the footage is somewhere else'
    );
  }

  const id = clipId(found.id, line);
  const source = join(outDir, `src-${found.id}.mp4`);
  const png = join(outDir, `txt-${id}.png`);
  const file = join(outDir, `clip-${id}.mp4`);

  await download(found.src, source);
  let spot = null;
  let startAt = null;
  let seconds = null;
  try {
    ({ spot, startAt, seconds } = await burnClip(source, {
      text: line,
      outFile: file,
      pngFile: png,
      id,
      duration: found.duration,
    }));
  } finally {
    // The source is 4K and disposable; the finished 1080 clip is what matters.
    // Kept only when something is being debugged, because "the crop is wrong"
    // is impossible to argue about without the original.
    if (!keepSource) rmSync(source, { force: true });
    rmSync(png, { force: true });
  }

  const cfg = postConfig().clips.video;
  const cand = {
    kind: 'clip',
    id,
    hook: line,
    headline: line,
    // Whether the line was written for this clip or came out of the fallback
    // pool. Printed on the approval card, because those are two different
    // products and the difference is invisible in the video.
    hookWritten: written,
    hookNote,
    // The shared vocabulary the rest of the pipeline speaks. A clip has no
    // source article; what it has is a stock library and an uploader, and that
    // is what provenance means here.
    sourceName: `Pexels · ${found.credit || 'unknown'}`,
    sourceUrl: found.page,
    pillar: 'day',
    tags: [],
    createdAt: new Date().toISOString(),
    // Resolved at build time, exactly as a card and a deck resolve theirs, so
    // what you were shown is what was true when you decided. Without these two
    // a staged clip has nowhere to go: the publish step reads publishTargets
    // and finds nothing, and the post is held forever without saying why.
    publishTargets: targetsForKind('clip'),
    // Always a draft. The API has no field for choosing a sound and sound
    // cannot be changed after publishing, so an approved clip lands in the
    // account's TikTok inbox and is finished by hand — the same bargain decks
    // make, for the same reason.
    tiktokDraft: true,
    overrides: [],
    notes: [],
    clip: {
      file,
      // What the encode actually produced rather than what the config asks
      // for. They agree today — every clip is cfg.seconds long — and the
      // fallback is what a clip built before the encoder reported it gets.
      seconds: seconds ?? cfg.seconds,
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
      startAt,
      vision: found.vision || null,
      rank: found.rank ?? null,
      // What the frames measured, kept for the same reason a slide keeps its
      // spot: "the text is in the wrong place" is much easier to argue about
      // with the numbers that put it there than from memory.
      spot: spot
        ? {
            x: Number(spot.x.toFixed(3)),
            y: Number(spot.y.toFixed(3)),
            color: spot.color,
            onDark: spot.onDark,
            contrast: Number(spot.contrast.toFixed(2)),
            worstContrast: Number(spot.spread.worst.toFixed(2)),
            assist: Number(spot.assist.toFixed(2)),
            // How much of the block landed on sky/water rather than on the
            // subject. The number that says whether the line looks placed or
            // dumped — a straddle reads as unprofessional however legible it is.
            onBackground: Number((spot.onBackground ?? 0).toFixed(2)),
            frames: spot.frames,
            agreed: spot.agreed,
          }
        : null,
    },
    card: { file },
  };

  // The description TikTok publishes. Tags only: the line is already burned
  // into the video, and repeating it underneath spends the description on
  // something the viewer read two seconds ago. Checked for a URL like every
  // other published string.
  cand.tiktokCaption = assertNoUrl(clipCaption(cand), 'the clip description');
  cand.channelCaption = cand.tiktokCaption;

  return cand;
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
  // Every line already burned into this batch, so the writer can be told not to
  // repeat itself. Without this each clip is written in isolation and five
  // forest videos come back under five variations of "I wish I was here" —
  // which is the pool problem again, arrived at by a more expensive route.
  const used = new Set();

  for (const f of found) {
    if (built.length >= count) break;
    try {
      const clip = await buildClip(f, { outDir, used });
      used.add(clip.hook);
      built.push(clip);
    } catch (e) {
      failed.push(`${f.title}: ${e.message}`);
    }
  }

  return {
    clips: built,
    considered: total,
    vetoed,
    failed,
    searchErrors: errors,
    ffmpeg: ready.version,
    // How many lines were actually written rather than pulled from the pool.
    // A batch that silently fell back on every clip looks identical to one that
    // did not, and the difference is whether the account repeats itself.
    written: built.filter((c) => c.hookWritten).length,
  };
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
  // What the judge thought, in the two lines it takes to say it.
  //
  // This was the one thing the card did not carry, and its absence cost a
  // batch. A drone shot went out and there was no way to tell from the message
  // whether the judge had seen an aerial and the penalty was too small, or
  // whether it had misread the frame — two different faults with two different
  // fixes, and the card showed neither. `ציון` is the title-keyword score,
  // which orders the queue and decides nothing; `יעד` is the gate that does.
  const v = c.vision || null;
  // אדם בפריים cannot appear on a clip the pipeline built — the judge vetoes
  // it before anything is encoded. It is printed for the one path that skips
  // the judge's verdict: scripts/clip-redo.js, where the footage was chosen by
  // hand. If that word shows up on a card, the clip is the thing the owner
  // prohibited and the redo picked the wrong id.
  const flags = v
    ? [v.aerial && 'רחפן', v.personSubject && '⚠️ אדם בפריים', v.pov && 'גוף ראשון', v.urban && 'עירוני'].filter(Boolean)
    : [];
  return [
    `🎬 קליפ · ${c.seconds}ש׳ · ${c.width}x${c.height}`,
    '',
    `✍️ השורה: ${cand.hook}`,
    cand.hookWritten ? '   (נכתבה לקליפ הזה)' : `   ⚠️ מהמאגר - ${cand.hookNote || 'לא נכתבה שורה'}`,
    '',
    `🏷️ ${cand.tiktokCaption || '(אין תיאור)'}`,
    '',
    `🎥 מקור: ${c.title}`,
    // The Pexels id, printed plainly rather than left to be read out of the
    // URL at the bottom. It is the string you paste into clips.search.denyIds
    // to make sure footage never comes back — which is the whole remedy for a
    // video this account has already posted, because the ledger only knows
    // what the pipeline itself has built.
    //
    // Falling back to the candidate id covers the clips built before
    // `clip.pexelsId` existed, whose candidate id IS the Pexels id. Without it
    // a re-rendered legacy clip prints "Pexels undefined" on the one line whose
    // entire job is to be copied somewhere.
    `   Pexels ${c.pexelsId || cand.id} · ${c.credit || 'ללא שם'} · ציון ${c.score}`,
    v
      ? `   שיפוט: יעד ${v.destination}/10${c.rank != null ? ` · דירוג ${c.rank}` : ''}${flags.length ? ` · ${flags.join(' · ')}` : ''}`
      : '   ⚠️ לא נשפט',
    `   חיפוש: "${c.query}"`,
    c.spot
      ? `   טקסט: ${c.spot.onDark ? 'בהיר' : 'כהה'} · ניגודיות ${c.spot.worstContrast} · ${c.spot.agreed}/${c.spot.frames} פריימים`
      : '   ⚠️ לא נמדד - מיקום ברירת מחדל',
    '',
    `🔗 ${c.page}`,
  ].join('\n');
}
