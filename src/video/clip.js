import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { findClips } from './pexels.js';
import { burnClip, burnCuts, download, clipOutputDir, ffmpegReady } from './overlay.js';
import { clipHook, postConfig } from '../postConfig.js';
import { writeHook, hasApiKey, namesOtherCountry, trailsOff } from './hooks.js';
import { pickCuts, cutLabel, writeCutsHook, beatCountMismatch } from './cuts.js';
import { pickTrack, audioConfigured } from './tracks.js';
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
export async function buildClip(found, { outDir = clipOutputDir(), hook = null, used = new Set(), keepSource = false, tracksUsed = new Set() } = {}) {
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
  let audio = null;
  // The bed. Null when assets/audio/tracks.json names nothing, which is where
  // this project starts and which renders exactly what it rendered before.
  const track = pickTrack(tracksUsed);
  try {
    ({ spot, startAt, seconds, audio } = await burnClip(source, {
      text: line,
      outFile: file,
      pngFile: png,
      id,
      duration: found.duration,
      track,
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
      // What was mixed in, or null for a silent clip. Recorded rather than
      // inferred from the config, because "there was a track configured" and
      // "a track reached this file" are different facts and only the second
      // one is about this post.
      audio,
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

  // The description both platforms publish. The line is already burned into the
  // video, so it is not repeated underneath, that would spend the description
  // on something the viewer read two seconds ago. Checked for a URL like every
  // other published string.
  //
  // ONE text, assigned to three fields, and instagramCaption is the one that
  // used to be missing. A clip was TikTok's alone, so nothing ever read an
  // Instagram caption off it; the moment a clip became a reel that omission
  // stopped being dead weight and became a reel published with no caption at
  // all, which is a reel with no question under it and nothing to answer.
  //
  // The same text on both is right here in a way it is not for a deck. A deck
  // is re-rendered per platform because a carousel has no title field and a
  // TikTok slideshow does; a clip's hook is burned into the frame, so there is
  // no title to move around and nothing left to differ.
  cand.tiktokCaption = assertNoUrl(clipCaption(cand), 'the clip description');
  cand.instagramCaption = cand.tiktokCaption;
  cand.channelCaption = cand.tiktokCaption;

  return cand;
}

/**
 * Build one CUTS clip from several search results.
 *
 * The second shape. Four or five shots, four seconds each, the written hook on
 * the first and a place label on every one, joined with a cut at each line
 * change. See src/video/cuts.js for what a beat is allowed to say and why it is
 * a label rather than the advice the parked formats carried.
 *
 * Deliberately the SAME candidate shape a held clip produces, kind, id, hook,
 * headline, clip.file, one approval message, so staging, the queue, Telegram's
 * video sender, the TikTok video path and the new Instagram reel path all handle
 * it without knowing which shape it is. That is the bargain the top of this file
 * describes, and honouring it is why a whole second post kind was not needed.
 */
export async function buildCutClip(found, { outDir = clipOutputDir(), used = new Set(), keepSource = false, tracksUsed = new Set() } = {}) {
  const cfg = postConfig().clips.cuts;
  if (!cfg.on) throw new Error('the cuts shape is off (clips.cuts.on)');

  const cuts = pickCuts(found, cfg);
  if (!cuts.length) {
    throw new Error(
      `need ${cfg.cutsMin} shots with different named places, found ${
        new Set(found.map((f) => cutLabel(f)).filter(Boolean)).size
      }`
    );
  }

  const res = await writeCutsHook(cuts, { used });
  // NO FALLBACK POOL, and that is the difference from a held clip.
  //
  // A held clip degrades to a pool line because a slightly repetitive post
  // beats no post. Here the opening line has to agree with how many cuts
  // arrived, `beatCountMismatch`, and no pooled line can, because the pool was
  // written without knowing. A pooled hook over five labelled shots is the
  // broken promise this format was built to avoid, so the honest failure is to
  // not build the clip.
  if (!res.text) throw new Error(`no usable opening line: ${res.error || 'every candidate was rejected'}`);
  const line = assertNoUrl(res.text, 'the cut hook');

  const id = clipId(cuts.map((c) => c.id).join('+'), line);
  const file = join(outDir, `clip-${id}.mp4`);
  const sources = cuts.map((c) => join(outDir, `src-${c.id}.mp4`));
  const pngs = cuts.map((_, i) => join(outDir, `txt-${id}-${i}.png`));

  // ONE bed across the whole video. The cuts are in the picture; audio that
  // changed with them would turn four shots into four posts played in a row.
  const track = pickTrack(tracksUsed);

  let burned = null;
  try {
    for (const [i, c] of cuts.entries()) await download(c.src, sources[i]);
    burned = await burnCuts(
      cuts.map((c, i) => ({
        source: sources[i],
        // The hook opens the video and the first shot's own label would collide
        // with it, so cut one carries the hook alone. Every other cut carries
        // its place. The count the hook must match is therefore the number of
        // CUTS, not the number of labels, which is what writeCutsHook is told.
        text: i === 0 ? line : c.label,
        pngFile: pngs[i],
        duration: c.duration,
      })),
      { outFile: file, id, track }
    );
  } finally {
    if (!keepSource) for (const s of sources) rmSync(s, { force: true });
    for (const p of pngs) rmSync(p, { force: true });
  }

  const video = postConfig().clips.video;
  const cand = {
    kind: 'clip',
    id,
    hook: line,
    headline: line,
    hookWritten: true,
    hookNote: res.rejected?.length ? `${res.rejected.length} candidate(s) rejected` : null,
    // The uploaders of every shot, not just the first. A cuts clip owes
    // provenance to four or five people and naming one of them would be worse
    // than naming none.
    sourceName: `Pexels · ${[...new Set(cuts.map((c) => c.credit).filter(Boolean))].join(', ') || 'unknown'}`,
    sourceUrl: cuts[0].page,
    pillar: 'day',
    tags: [],
    createdAt: new Date().toISOString(),
    publishTargets: targetsForKind('clip'),
    tiktokDraft: true,
    overrides: [],
    notes: [],
    clip: {
      shape: 'cuts',
      file,
      audio: burned.audio,
      seconds: burned.seconds,
      width: video.width,
      height: video.height,
      hookFormat: res.format,
      country: res.country,
      // Per shot, in play order: what it is, where it is, who uploaded it and
      // where it came from. The approval card prints all of it, because a cuts
      // clip is the one artefact here where a single bad shot is invisible in a
      // thumbnail and expensive in a post.
      cuts: cuts.map((c, i) => ({
        pexelsId: c.id,
        title: c.title,
        label: c.label,
        query: c.query,
        credit: c.credit,
        page: c.page,
        vision: c.vision || null,
        rank: c.rank ?? null,
        startAt: burned.startAts[i] ?? null,
        spot: burned.spots[i] || null,
      })),
      // THE COUNTRY ONLY, AND ONLY WHEN THERE IS ONE.
      //
      // Two things downstream read `clip.vision` and both turn it into a
      // published claim: `clipPlaceLine` prints the pin under the post, and
      // `clipDestinationTag` spends a hashtag slot on the country. Handing
      // either of them the FIRST shot's reading is wrong on this shape in two
      // different ways, and neither is visible from the code that consumes it.
      //
      // On a clip spanning four countries it pins one of them, which is a post
      // labelled "Iceland" whose second, third and fourth shots are not. And
      // even when every shot IS in one country, the first shot's `site` would
      // pin one named place out of four, which is the same error at a smaller
      // scale: "לאוטרברונן, שווייץ" under a video of four Swiss valleys.
      //
      // So the site is dropped and the country survives only when `oneCountry`
      // established that all of them share it. A mixed cut gets no pin and
      // falls back to the niche pool for its fifth tag, which is exactly what a
      // deck spanning four countries already does. The places are not lost:
      // they are burned onto the shots they belong to, which is the whole
      // format.
      vision: res.country ? { ...cuts[0].vision, site: '', siteHe: '' } : null,
      spot: burned.spots[0] || null,
      title: cuts.map((c) => c.label).join(' · '),
      query: cuts[0].query,
      score: cuts[0].score,
      credit: cuts[0].credit,
      page: cuts[0].page,
      provenance: 'pexels',
    },
    card: { file },
  };

  cand.tiktokCaption = assertNoUrl(clipCaption(cand), 'the clip description');
  cand.instagramCaption = cand.tiktokCaption;
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
 *
 * THE TWO SHAPES ALTERNATE, starting on cuts.
 *
 * Not weighted, alternated, for the reason src/shoot/rotation.js gives about
 * formats: a weight is a tendency, and a tendency permits a run of five of the
 * same thing, which is well within normal for any weighting and is exactly what
 * produced a feed whose whole idea a viewer had seen by the third post. Two
 * shapes and a strict alternation is the smallest rule that cannot do that.
 *
 * Cuts first because it is the stronger one: it carries more information, it
 * moves, and at the default CLIPS_PER_DAY of two a batch of one would otherwise
 * be a held clip every day.
 */
export async function buildClips({ count = 5, seen = new Set(), outDir = clipOutputDir(), shapes = null } = {}) {
  const ready = await ffmpegReady();
  if (!ready.ok) throw new Error(`ffmpeg is not usable (${ready.path}): ${ready.error}`);

  const cuts = postConfig().clips.cuts;
  // A cuts clip consumes cutsMax shots where a held clip consumes one, so the
  // search has to be asked for enough for the worst case or the second half of
  // the batch is built from nothing. The x3 was already there for the held
  // shape's own rejection rate; this multiplies the per-item cost, not it.
  const perItem = cuts.on ? cuts.cutsMax : 1;
  const { clips: found, total, vetoed, errors, nowhere } = await findClips({ limit: count * 3 * perItem, seen });

  const built = [];
  const failed = [];
  // Every line already burned into this batch, so the writer can be told not to
  // repeat itself. Without this each clip is written in isolation and five
  // forest videos come back under five variations of "I wish I was here" —
  // which is the pool problem again, arrived at by a more expensive route.
  const used = new Set();
  // And every bed already spent in it, for the same reason. Two clips of the
  // same batch under the same track is the repetition a viewer scrolling a
  // profile notices first, and it is free to avoid while there is a track left.
  const tracksUsed = new Set();

  // The shapes to build, in order. Overridable so a lab or a test can ask for
  // one shape without reaching into the config.
  const order =
    shapes ||
    Array.from({ length: count }, (_, i) => (cuts.on && i % 2 === 0 ? 'cuts' : 'held'));

  // Shots not yet spent by an earlier clip in this batch. A cuts clip takes
  // four or five off the front, and without removing them the next clip in the
  // same batch would be offered the same footage, the batch-level twin of the
  // ledger bug the store's clipPexelsIds note describes.
  const pool = [...found];
  const spend = (ids) => {
    const gone = new Set(ids.map(String));
    for (let i = pool.length - 1; i >= 0; i--) if (gone.has(String(pool[i].id))) pool.splice(i, 1);
  };

  for (const shape of order) {
    if (built.length >= count || !pool.length) break;
    try {
      if (shape === 'cuts') {
        const clip = await buildCutClip(pool, { outDir, used, tracksUsed });
        used.add(clip.hook);
        if (clip.clip.audio) tracksUsed.add(clip.clip.audio.name);
        spend(clip.clip.cuts.map((c) => c.pexelsId));
        built.push(clip);
      } else {
        const f = pool[0];
        const clip = await buildClip(f, { outDir, used, tracksUsed });
        used.add(clip.hook);
        if (clip.clip.audio) tracksUsed.add(clip.clip.audio.name);
        spend([f.id]);
        built.push(clip);
      }
    } catch (e) {
      failed.push(`${shape}: ${e.message}`);
      // A failed HELD clip has spent its one candidate and the next iteration
      // must not be handed it again. A failed cuts clip is dropped whole: which
      // of its shots was at fault is not knowable from here, and removing all
      // five would throw away good footage on one bad line.
      if (shape === 'held' && pool.length) pool.shift();
    }
  }

  return {
    clips: built,
    considered: total,
    vetoed,
    failed,
    // Which candidates the vision judge turned down and why.
    //
    // findClips has always returned this and buildClips has never passed it on,
    // so bot.js, which destructures `nowhere` and prints it as the reason an
    // empty batch was empty, has been reading undefined and printing nothing.
    // The single most useful line in a run that produced no clips, missing on
    // exactly the runs it was written for.
    //
    // It matters more now: a cuts clip needs cutsMin shots with DIFFERENT named
    // places, so "nothing built" can mean the judge placed nothing, and those
    // are two different fixes to two different queries.
    nowhere,
    searchErrors: errors,
    ffmpeg: ready.version,
    // How many lines were actually written rather than pulled from the pool.
    // A batch that silently fell back on every clip looks identical to one that
    // did not, and the difference is whether the account repeats itself.
    written: built.filter((c) => c.hookWritten).length,
    // How many went out with no bed. Reported for the same reason `written` is:
    // a batch that silently came back silent looks identical to one that did
    // not, and a silent reel is the failure the music bed exists to close.
    silent: built.filter((c) => !c.clip?.audio).length,
    audioConfigured: audioConfigured(),
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
/**
 * The sound line on an approval card.
 *
 * Printed on every clip, including when there is no track, because a silent
 * file and a sounded one are indistinguishable in a Telegram video preview
 * unless you happen to have the volume up, and which one you are looking at
 * changes what you have to do next.
 *
 * NO TRACK IS THE NORMAL CASE AND NOT A WARNING. It said "⚠️ אין פסקול - יעלה
 * אילם לרילס", which was true while a clip published to Instagram unattended:
 * a reel's audio is fixed at upload, so a silent file meant a permanently
 * silent post. Nothing publishes a reel now (see targets.js), so the file
 * being silent is the plan rather than a fault, and a warning against the
 * intended workflow is noise that teaches you to skim the card.
 */
export function audioLine(cand) {
  const a = cand.clip?.audio;
  if (!a) return '🎵 הסאונד נבחר באפליקציה';
  return `🎵 ${a.title} · ${a.credit} · ${a.licence}${a.offset ? ` · מ-${a.offset}ש׳` : ''}`;
}

export function clipApprovalMessage(cand) {
  const c = cand.clip || {};
  if (c.shape === 'cuts') return cutApprovalMessage(cand);
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
    audioLine(cand),
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

/**
 * What you are shown before deciding, for a CUTS clip.
 *
 * Its own message rather than a branch inside the held one, because almost
 * nothing on the card is the same. A held clip has one shot, one judgement and
 * one measured placement; a cuts clip has four or five of each, and the thing
 * you are actually checking is different: not "is this shot any good" but
 * "do these shots belong in one list, and does the opening line match how many
 * there are".
 *
 * So the shots are printed in play order with what is burned on each, which is
 * the only view that answers the question the format can get wrong. The video is
 * above this message and it answers everything else.
 */
export function cutApprovalMessage(cand) {
  const c = cand.clip || {};
  const cuts = c.cuts || [];
  const lines = [
    `🎬 קליפ חתוך · ${cuts.length} קטעים · ${c.seconds}ש׳ · ${c.width}x${c.height}`,
    '',
    `✍️ הפתיחה: ${cand.hook}`,
    // The one rule this format cannot bend, printed as an answer rather than
    // left to be counted off the list below. A viewer counts; so should the card.
    beatCountMismatch(cand.hook, cuts)
      ? `   ⚠️ ${beatCountMismatch(cand.hook, cuts)}`
      : `   (${c.hookFormat || 'תבנית לא ידועה'}${c.country ? ` · כולם ב${c.country}` : ' · כמה מדינות'})`,
    '',
    audioLine(cand),
    '',
    '🎞️ הקטעים, לפי הסדר:',
  ];

  for (const [i, cut] of cuts.entries()) {
    const v = cut.vision || null;
    const flags = v
      ? [v.aerial && 'רחפן', v.personSubject && '⚠️ אדם בפריים', v.pov && 'גוף ראשון'].filter(Boolean)
      : [];
    // The first cut carries the hook, not its own label, see buildCutClip. The
    // card says so rather than printing a label that is not on screen.
    lines.push(`   ${i + 1}. ${i === 0 ? `(הפתיחה) ${cut.label}` : cut.label}`);
    lines.push(
      `      Pexels ${cut.pexelsId} · ${cut.credit || 'ללא שם'}${
        v ? ` · יעד ${v.destination}/10` : ' · לא נשפט'
      }${flags.length ? ` · ${flags.join(' · ')}` : ''}`
    );
    lines.push(
      cut.spot
        ? `      טקסט: ${cut.spot.onDark ? 'בהיר' : 'כהה'} · ניגודיות ${cut.spot.worstContrast}`
        : '      ⚠️ לא נמדד - מיקום ברירת מחדל'
    );
  }

  lines.push('', `🏷️ ${cand.tiktokCaption || '(אין תיאור)'}`);
  lines.push('', `🔗 ${cuts[0]?.page || c.page || ''}`);
  return lines.join('\n');
}
