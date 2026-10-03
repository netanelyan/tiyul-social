import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { findClips } from './pexels.js';
import { burnClip, burnCuts, burnMontage, download, clipOutputDir, ffmpegReady } from './overlay.js';
import { clipHook, postConfig } from '../postConfig.js';
import { writeHook, hasApiKey, namesOtherCountry, trailsOff } from './hooks.js';
import { pickCuts, cutLabel, cutsReason, writeCutsHook, beatCountMismatch, pickMontage, montageReason } from './cuts.js';
import { pickTrack, audioConfigured } from './tracks.js';
import { assertNoUrl } from '../format.js';
import { clipCaption, captionFollow, clipPlaceLabel } from '../hashtags.js';
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
 * What the frames measured, rounded, for the candidate and the approval card.
 *
 * ONE function because there are two shapes and they were doing it differently.
 * A held clip rounded its numbers inline here; a cuts clip stored the raw object
 * `measureClip` returns, whose worst contrast lives at `spread.worst` — so the
 * card, which prints `spot.worstContrast`, printed "ניגודיות undefined" on every
 * cuts clip ever built. The one line on the card whose job is to tell you whether
 * the text is readable, reading undefined on the shape that has four of them.
 *
 * Kept as numbers rather than strings: `toFixed` returns a string and JSON would
 * then store "7.15" where the held shape stores 7.15, which is the kind of
 * difference that surfaces a year later as a comparison that is always false.
 */
export function spotNote(spot) {
  if (!spot) return null;
  return {
    x: Number(spot.x.toFixed(3)),
    y: Number(spot.y.toFixed(3)),
    color: spot.color,
    onDark: spot.onDark,
    contrast: Number(spot.contrast.toFixed(2)),
    worstContrast: Number(spot.spread.worst.toFixed(2)),
    assist: Number(spot.assist.toFixed(2)),
    // How much of the block landed on sky/water rather than on the subject. The
    // number that says whether the line looks placed or dumped — a straddle
    // reads as unprofessional however legible it is.
    onBackground: Number((spot.onBackground ?? 0).toFixed(2)),
    frames: spot.frames,
    agreed: spot.agreed,
  };
}

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

  // The reason to follow, drawn once and used ONCE: the description closes on
  // it, and the video does not.
  //
  // It was burned into the last two seconds here too. The owner's instruction
  // is that a held clip never changes its text, and the follow frame was the
  // only thing that made it — so it is gone from this shape, deliberately and
  // at a known cost in follows. See the long note above burnClip for the
  // argument; the short version is that a line may change when the PICTURE
  // changes, and on one unbroken shot it never does.
  //
  // Still drawn rather than skipped, because the description carries it on
  // every post and that part is not optional. A cuts clip still closes on one.
  const follow = captionFollow();
  assertNoUrl(follow.lineHe, 'the clip closing line');

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
      // Named rather than left implied by the absence of 'cuts'. The rotation
      // that alternates the two shapes reads this off the last clip built, and
      // "no shape field" has to mean "built before there were two shapes" for
      // the older candidates in staging, not "held".
      shape: 'held',
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
      // The reason to follow this clip's DESCRIPTION closes on. Recorded even
      // though nothing is burned in, because a re-render has to reach the same
      // one — the caption is built from it and a second draw would close the
      // description on a different reason than the stored candidate claims.
      follow,
      // Null, and always null on this shape. Kept as a field rather than
      // dropped so the approval card can tell "a held clip, which never has
      // one" from "a cuts clip whose closing frame went missing", which are
      // different facts and only one of them is a bug.
      followAt: null,
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
      spot: spotNote(spot),
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
  // The same drawn follow the video closes on, so the last frame and the last
  // line of the description are one sentence rather than two.
  cand.tiktokCaption = assertNoUrl(clipCaption(cand, { follow }), 'the clip description');
  cand.instagramCaption = cand.tiktokCaption;
  cand.channelCaption = cand.tiktokCaption;

  return cand;
}

/**
 * Build one MONTAGE from several shots of the same place.
 *
 * THE THIRD SHAPE. Many shots at a second and a half, one line that never
 * changes, no labels on anything. See burnMontage for why this is the two
 * existing shapes' halves swapped, and clips.montage in postConfig for the
 * rhythm.
 *
 * THE LINE IS WRITTEN BY THE HELD SHAPE'S WRITER, and reusing it rather than
 * adding a third prompt is the whole reason this shape was cheap to build. A
 * held clip's hook does exactly this job: one line, about one place, naming it
 * or not. `writeCutsHook` could not be reused because its entire contract is a
 * COUNT that has to match how many labelled shots arrived, and a montage
 * carries no labels and makes no count - a hook promising "5 מקומות" over
 * twelve unlabelled shots of one valley is the broken promise that format
 * exists to avoid, arriving from the other direction.
 *
 * So the writer is told about the best shot of the group, and the place the
 * group agreed on is what the line may name. The fallback pool applies exactly
 * as it does for a held clip: a slightly repetitive post beats no post.
 */
export async function buildMontageClip(found, { outDir = clipOutputDir(), used = new Set(), keepSource = false, tracksUsed = new Set() } = {}) {
  const cfg = postConfig().clips.montage;
  if (!cfg.on) throw new Error('the montage shape is off (clips.montage.on)');

  const { cuts, vision, site, placed } = pickMontage(found, cfg);
  if (!cuts.length) throw new Error(montageReason(found, cfg));

  // ONE derivation of the place, shared by the card and the caption. They read
  // it off the same `vision` through the same function, which is the arrangement
  // that stops them naming two different places on one post.
  const place = clipPlaceLabel({ clip: { vision } });

  // The shot the writer is shown has to be one the judge PLACED, or the line is
  // written about a frame with no country attached and the country guard below
  // has nothing to check it against. Falls back to the best-ranked shot when
  // the judge placed none, which is the same position a held clip is in.
  const lead = cuts.find((c) => c.vision?.place) || cuts[0];

  // Written against the BEST shot of the group, which is cuts[0] because
  // findClips ranked them and pickMontage kept that order. The writer needs one
  // clip to look at and the group has already agreed what it is about.
  let line = null;
  let written = false;
  let hookNote = null;
  if (hasApiKey()) {
    try {
      const res = await writeHook(lead, { used });
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
  if (!line) line = clipHook();

  assertNoUrl(line, 'the montage hook');
  const unfinished = trailsOff(line);
  if (unfinished) throw new Error(`the hook ${unfinished}: "${line}"`);

  // The same country check a held clip makes, and it matters more here: the
  // line is the only text in the video and it is held over twelve shots that
  // all agreed on one place. A line naming a different country is wrong for
  // eighteen seconds rather than eight.
  const placeHe = place ? String(place).split(',').pop().trim() : null;
  const clash = namesOtherCountry(line, placeHe);
  if (clash) {
    throw new Error(`the line names ${clash} and this montage is ${placeHe || 'not placed'}`);
  }

  const id = clipId(cuts.map((c) => c.id).join('+'), line);
  const file = join(outDir, `clip-${id}.mp4`);
  const sources = cuts.map((c) => join(outDir, `src-${c.id}.mp4`));
  // ONE png for the whole video, which is the shape's defining property
  // expressed as a filename. See burnMontage.
  const png = join(outDir, `txt-${id}.png`);
  const track = pickTrack(tracksUsed);
  // Drawn for the description only. A montage never burns one in, for the
  // reason the held shape does not: the text does not change.
  const follow = captionFollow();
  assertNoUrl(follow.lineHe, 'the clip closing line');

  let burned = null;
  try {
    for (const [i, c] of cuts.entries()) await download(c.src, sources[i]);
    burned = await burnMontage(
      cuts.map((c, i) => ({ source: sources[i], duration: c.duration, seconds: cfg.secondsPerCut })),
      { text: line, outFile: file, pngFile: png, id, track }
    );
  } finally {
    if (!keepSource) for (const s of sources) rmSync(s, { force: true });
    rmSync(png, { force: true });
  }

  const video = postConfig().clips.video;
  const cand = {
    kind: 'clip',
    id,
    hook: line,
    headline: line,
    hookWritten: written,
    hookNote,
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
      shape: 'montage',
      file,
      audio: burned.audio,
      seconds: burned.seconds,
      follow,
      // Never. Same as the held shape and for the same reason.
      followAt: null,
      width: video.width,
      height: video.height,
      // What the group agreed on, which is the one fact the line was allowed to
      // use. Kept so a re-render and the approval card can both say it without
      // re-deriving it from the shots.
      montagePlace: place,
      montageSite: site,
      // How many of the shots the judge actually placed. A montage named from
      // two out of twelve is weaker evidence than one named from ten, and the
      // approval card is where that difference has to be visible.
      montagePlaced: placed,
      cuts: cuts.map((c, i) => ({
        pexelsId: c.id,
        title: c.title,
        query: c.query,
        credit: c.credit,
        page: c.page,
        vision: c.vision || null,
        rank: c.rank ?? null,
        startAt: burned.startAts[i] ?? null,
        spot: spotNote(burned.spots[i]),
      })),
      // THE WHOLE GROUP'S reading, not the first shot's. Every shot here agreed
      // on the place - that is what pickMontage selected for - so the pin under
      // the post and the country hashtag are as sourced as they are on a held
      // clip. The site is kept only when the group agreed on one: a montage
      // grouped by country has shots from several valleys and naming one of
      // them would be the error buildCutClip's note describes.
      // THE GROUP'S reading, not one shot's. `place` was tallied across the
      // shots the judge placed, so the pin under the post and the country
      // hashtag rest on a majority rather than on whichever frame sorted
      // first. The site survives only when more than one shot agreed on it,
      // which is pickMontage's rule and the reason a montage of a whole region
      // is not pinned to one valley inside it.
      vision,
      // The combined placement the single line was set against, which is the
      // number that says whether it is legible for the WHOLE video rather than
      // for the shot it happened to be measured on.
      spot: spotNote(burned.spot),
      title: `${place} · ${cuts.length} שוטים`,
      query: cuts[0].query,
      score: cuts[0].score,
      credit: cuts[0].credit,
      page: cuts[0].page,
      provenance: 'pexels',
    },
    card: { file },
  };

  cand.tiktokCaption = assertNoUrl(clipCaption(cand, { follow }), 'the clip description');
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
  if (!cuts.length) throw new Error(cutsReason(found, cfg));

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
  // One more PNG than there are cuts when the clip closes on a reason to follow:
  // the closing frame is a segment like any other, so it needs its own overlay.
  const follow = postConfig().clips.follow.on ? captionFollow() : null;
  if (follow) assertNoUrl(follow.lineHe, 'the clip closing line');
  const pngs = cuts.map((_, i) => join(outDir, `txt-${id}-${i}.png`));
  const followPng = join(outDir, `txt-${id}-follow.png`);

  // ONE bed across the whole video. The cuts are in the picture; audio that
  // changed with them would turn four shots into four posts played in a row.
  const track = pickTrack(tracksUsed);

  let burned = null;
  try {
    for (const [i, c] of cuts.entries()) await download(c.src, sources[i]);
    burned = await burnCuts(
      [
        ...cuts.map((c, i) => ({
          source: sources[i],
          // The hook opens the video and the first shot's own label would collide
          // with it, so cut one carries the hook alone. Every other cut carries
          // its place. The count the hook must match is therefore the number of
          // CUTS, not the number of labels, which is what writeCutsHook is told.
          text: i === 0 ? line : c.label,
          pngFile: pngs[i],
          duration: c.duration,
          // The opening cut is held for its own length. It carries one line and
          // no place, so it is over the moment the line is read; every cut after
          // it has a name to read and a shot to watch move. See burnCuts.
          seconds: i === 0 ? cfg.hookSeconds : cfg.secondsPerCut,
        })),
        // THE CLOSING FRAME, AS ONE MORE CUT.
        //
        // A video has no slide to end on, so the reason to follow gets its own
        // two seconds at the end - the same close a slideshow gets from
        // src/deck/follow.js, arrived at by the only route this shape offers.
        //
        // It borrows the FIRST shot's footage, which is the choice tripDecks
        // makes for the two slides it bolts onto an itinerary and for the same
        // reason: the last cut is what is on screen immediately before, so
        // holding it would read as a line changing over a shot that did not cut,
        // and that is the thing the whole format exists to avoid. Coming back to
        // the opening shot is a bookend, four cuts away from where it was.
        ...(follow
          ? [
              {
                source: sources[0],
                text: follow.lineHe,
                pngFile: followPng,
                duration: cuts[0].duration,
                seconds: postConfig().clips.follow.seconds,
              },
            ]
          : []),
      ],
      { outFile: file, id, track }
    );
  } finally {
    if (!keepSource) for (const s of sources) rmSync(s, { force: true });
    for (const p of pngs) rmSync(p, { force: true });
    rmSync(followPng, { force: true });
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
      // The closing frame, and when it starts. `seconds` already includes it, so
      // the start is the length less the hold - derived once here rather than by
      // every reader of this object.
      follow: follow || null,
      followAt: follow ? Number((burned.seconds - postConfig().clips.follow.seconds).toFixed(3)) : null,
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
        // The specific place on its own, which is what the label is now required
        // to contain. Kept beside the label because "the pin says Switzerland"
        // and "the judge could not name the valley" are the same fault seen from
        // two ends, and only one of them is visible in the label.
        site: c.site ?? null,
        query: c.query,
        credit: c.credit,
        page: c.page,
        vision: c.vision || null,
        rank: c.rank ?? null,
        startAt: burned.startAts[i] ?? null,
        // Through spotNote, like the held shape. Stored raw, the card printed
        // "ניגודיות undefined" on every cut of every cuts clip.
        spot: spotNote(burned.spots[i]),
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
      spot: spotNote(burned.spots[0]),
      title: cuts.map((c) => c.label).join(' · '),
      query: cuts[0].query,
      score: cuts[0].score,
      credit: cuts[0].credit,
      page: cuts[0].page,
      provenance: 'pexels',
    },
    card: { file },
  };

  cand.tiktokCaption = assertNoUrl(clipCaption(cand, { follow }), 'the clip description');
  cand.instagramCaption = cand.tiktokCaption;
  cand.channelCaption = cand.tiktokCaption;

  return cand;
}

/**
 * The shapes to build next, in order.
 *
 * THE TWO SHAPES ALTERNATE, and `after` is what the last clip built was.
 *
 * Not weighted, alternated, for the reason the shoot rotation gives about
 * formats: a weight is a tendency, and a tendency permits a run of five of the
 * same thing, which is well within normal for any weighting and is exactly what
 * produced a feed whose whole idea a viewer had seen by the third post. Two
 * shapes and a strict alternation is the smallest rule that cannot do that.
 *
 * `after` IS WHY THIS IS A FUNCTION. The alternation used to be `i % 2` over the
 * batch index, which is correct for `/clip 4` and silently wrong for the case
 * that actually runs: suggestClip builds ONE clip a day, index 0 every time, so
 * every unattended clip this account has ever made was a cuts clip and the held
 * shape existed only for a hand-typed batch. The owner asked for "1 video with a
 * static text" believing it had been dropped, and it had - not from the code,
 * from the only path that reaches it.
 *
 * Cuts leads on a fresh box because it is the stronger shape: it carries more
 * information and it moves.
 */
export function nextShapes(count, { after = null, cutsOn = true, montageOn = true } = {}) {
  // WHICH SHAPES ARE IN THE ROTATION AT ALL, in a fixed order so the cycle is
  // readable rather than emergent. `held` is always in it: it needs one shot
  // and therefore cannot fail for want of footage, which makes it the floor the
  // other two fall back to.
  //
  // A THIRD SHAPE DOES NOT BREAK THE ARGUMENT THIS FUNCTION WAS WRITTEN ON. The
  // note below is about a strict alternation beating a weighting, because a
  // weighting permits a run of five of the same thing. A strict CYCLE over three
  // keeps that property exactly: the most any shape can appear in a row is once.
  const ring = ['cuts', 'montage', 'held'].filter(
    (s) => (s !== 'cuts' || cutsOn) && (s !== 'montage' || montageOn)
  );
  if (ring.length === 1) return Array.from({ length: count }, () => ring[0]);

  const out = [];
  // Where in the ring the last clip left off. An unknown shape, or one that has
  // since been switched off, starts the cycle from the top - which is what a
  // fresh box and a just-disabled shape both want.
  let i = ring.indexOf(after);
  for (let n = 0; n < count; n++) {
    i = (i + 1) % ring.length;
    out.push(ring[i]);
  }
  return out;
}

/**
 * Which shape a `/clip` argument named, or null to let the rotation decide.
 *
 * `/clip 2` is two clips, whatever comes next; `/clip cuts` names the shape and
 * `/clip 2 held` names both. Named rather than numbered because the shapes are
 * not a scale, and it is what you want on the one occasion you are sitting there
 * watching — a shape has just been changed and you want to see it now rather than
 * wait for the alternation to come round.
 *
 * Here rather than in bot.js because bot.js starts a Telegram bot when it is
 * imported, so nothing in it can be tested except by reading it as text.
 */
const CLIP_SHAPES = {
  cuts: 'cuts',
  חתוך: 'cuts',
  held: 'held',
  בודד: 'held',
  static: 'held',
  montage: 'montage',
  רצף: 'montage',
  'מונטאז׳': 'montage',
  מונטאז: 'montage',
};
export function clipShapeArg(arg) {
  for (const word of String(arg || '').toLowerCase().split(/\s+/)) {
    if (CLIP_SHAPES[word]) return CLIP_SHAPES[word];
  }
  return null;
}

/**
 * Find clips and build a batch of them.
 *
 * Failures are per clip and reported rather than thrown: a Pexels rendition
 * that 404s or a source ffmpeg cannot read should cost that one clip, not the
 * batch. Which one failed and why travels back, because a batch that quietly
 * returns three of five looks identical to a search that only found three.
 *
 * `after` is the shape of the last clip built, for the alternation — see
 * nextShapes. `shapes` overrides it outright, which is what `/clip cuts` and a
 * lab run use.
 */
export async function buildClips({ count = 5, seen = new Set(), outDir = clipOutputDir(), shapes = null, after = null } = {}) {
  const ready = await ffmpegReady();
  if (!ready.ok) throw new Error(`ffmpeg is not usable (${ready.path}): ${ready.error}`);

  const cuts = postConfig().clips.cuts;
  // A cuts clip consumes cutsMax shots where a held clip consumes one, so the
  // search has to be asked for enough for the worst case or the second half of
  // the batch is built from nothing. The x3 was already there for the held
  // shape's own rejection rate; this multiplies the per-item cost, not it.
  // A montage needs montage.cutsMin shots of the SAME place, which is far more
  // demanding of one search than cuts.cutsMax shots of different ones: the
  // queries are spread across twenty-six destinations, so the shots of any one
  // of them are a fraction of what comes back. Asking for the larger of the two
  // costs nothing when the montage is off and is the difference between the
  // shape assembling and never assembling when it is on.
  const montage = postConfig().clips.montage;
  const perItem = Math.max(cuts.on ? cuts.cutsMax : 1, montage.on ? montage.cutsMax : 1);

  // THE SHAPES ARE DECIDED BEFORE THE SEARCH, because one of them needs a
  // different search.
  //
  // This used to be the other way round: search once, then decide. That is
  // right for two of the three shapes and impossible for the montage, which
  // needs six or more shots of ONE place. A broad search across twenty-six
  // destinations cannot supply that at any `limit` - the breadth is what
  // prevents it - so a montage narrows the search to a single destination's
  // queries instead.
  //
  // Spending the SAME budget rather than more, which is the point of deciding
  // first. A montage day runs one targeted search; it does not run the broad
  // one and then a second search on top, which would double the vision bill on
  // a shape that was meant to be free.
  const order = shapes || nextShapes(count, { after, cutsOn: cuts.on, montageOn: montage.on });
  const needsBroad = order.some((s) => s !== 'montage');
  const onlyMontage = !needsBroad && order.length > 0;

  // Which destination a montage is about. One query, chosen at random from the
  // configured list, because nothing here knows better: every query names a
  // place this account already wants to post about, and picking the "best" one
  // would need a search per query to find out.
  const montageQuery = onlyMontage
    ? postConfig().clips.search.queries[Math.floor(Math.random() * postConfig().clips.search.queries.length)]
    : null;

  const { clips: found, total, vetoed, errors, nowhere } = await findClips({
    limit: count * 3 * perItem,
    seen,
    ...(montageQuery ? { queries: [montageQuery], pages: 4 } : {}),
  });

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

  // Shots not yet spent by an earlier clip in this batch. A cuts clip takes
  // four or five off the front, and without removing them the next clip in the
  // same batch would be offered the same footage, the batch-level twin of the
  // ledger bug the store's clipPexelsIds note describes.
  const pool = [...found];
  const spend = (ids) => {
    const gone = new Set(ids.map(String));
    for (let i = pool.length - 1; i >= 0; i--) if (gone.has(String(pool[i].id))) pool.splice(i, 1);
  };

  const one = async (shape) => {
    if (shape === 'cuts') {
      const clip = await buildCutClip(pool, { outDir, used, tracksUsed });
      spend(clip.clip.cuts.map((c) => c.pexelsId));
      return clip;
    }
    // A montage consumes the most footage of the three - up to montage.cutsMax
    // shots, all of one place - so like a cuts clip it is handed the whole pool
    // and spends what it actually took.
    if (shape === 'montage') {
      const clip = await buildMontageClip(pool, { outDir, used, tracksUsed });
      spend(clip.clip.cuts.map((c) => c.pexelsId));
      return clip;
    }
    const f = pool[0];
    const clip = await buildClip(f, { outDir, used, tracksUsed });
    spend([f.id]);
    return clip;
  };

  for (const shape of order) {
    if (built.length >= count || !pool.length) break;
    // The shape asked for, then the one that needs least from the search.
    //
    // A cuts clip needs cutsMin shots the judge could name SPECIFICALLY, and a
    // day where it named three is an ordinary day rather than a fault. Falling
    // through to held costs nothing and keeps the post, where failing keeps
    // nothing at all - and the timer builds one clip a day, so "nothing at all"
    // is the whole day. The reverse fallback does not exist and should not: a
    // held clip fails on its own footage, and cuts would fail on the same.
    // A montage needs the most from the search of the three - montage.cutsMin
    // shots of ONE place - so it falls through furthest. Cuts is tried next
    // rather than held, because a batch with enough named places for a list is
    // a better post than one shot of the best of them.
    const attempts =
      shape === 'cuts' ? ['cuts', 'held'] : shape === 'montage' ? ['montage', 'cuts', 'held'] : ['held'];
    for (const s of attempts) {
      if (!pool.length) break;
      try {
        const clip = await one(s);
        used.add(clip.hook);
        if (clip.clip.audio) tracksUsed.add(clip.clip.audio.name);
        built.push(clip);
        break;
      } catch (e) {
        failed.push(`${s}: ${e.message}`);
        // A failed HELD clip has spent its one candidate and the next iteration
        // must not be handed it again. A failed cuts clip is dropped whole:
        // which of its shots was at fault is not knowable from here, and
        // removing all five would throw away good footage on one bad line.
        if (s === 'held' && pool.length) pool.shift();
      }
    }
  }

  return {
    clips: built,
    considered: total,
    vetoed,
    failed,
    // What was asked for and what came back, which are not the same thing the
    // moment a cuts attempt falls through to held. Both, because "the rotation
    // asked for cuts and the search could not name four places" and "the
    // rotation asked for held" produce the identical batch and are different
    // facts about the account.
    asked: order,
    shapes: built.map((c) => c.clip?.shape || 'held'),
    // Which destination the search was narrowed to, or null for a broad one.
    // Printed by /clip, because "the montage failed" and "the montage was
    // pointed at a query that returned nothing today" are different problems
    // and the query is the one you would act on.
    query: montageQuery,
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
/**
 * The closing line, for an approval card.
 *
 * Printed on every clip, and when there is none it says WHICH none. A
 * two-second end card at the end of an eight-second video is the easiest thing
 * here to miss in a Telegram preview on a phone, and three states that look
 * identical from the outside are not the same:
 *
 *   - a cuts clip closing on a reason to follow, with the second it starts;
 *   - a HELD clip, which never closes on one and is not meant to. The text of a
 *     single-shot clip does not change, by decision — see burnClip — so this
 *     line says that rather than reading as something that failed;
 *   - clips.follow.on switched off, which turns it off for the cuts shape too.
 */
export function followFrameLine(cand) {
  const c = cand.clip || {};
  // Shape first, because "held" is an answer and the absence of a follow frame
  // on one is not a fault to report. Legacy candidates have no shape field and
  // fall through to the general answers below, which is right: a clip built
  // before the shapes were named cannot be classified now.
  if (c.shape === 'held') return `👋 סיום: השורה לא מתחלפת (שוט אחד)${c.follow ? ` · בתיאור: ${c.follow.lineHe}` : ''}`;
  if (!c.follow) return '👋 סיום: אין (clips.follow.on כבוי)';
  if (c.followAt == null) return `👋 סיום: ${c.follow.lineHe}`;
  return `👋 סיום מ-${c.followAt}ש׳: ${c.follow.lineHe}`;
}

export function audioLine(cand) {
  const a = cand.clip?.audio;
  if (!a) return '🎵 הסאונד נבחר באפליקציה';
  // TWO SHAPES OF THE SAME FIELD, and the boolean one is not a mistake to fix at the
  // writer's end. The three shapes here record the whole track entry, because the
  // card has to be able to state the licence of anything it mixed in. The postcard
  // and gems reels record whether there IS a bed, because for them the answer is
  // almost always no and the file is finished in the app.
  //
  // Printed as what it is rather than as `undefined · undefined · undefined`, which
  // is what this line produced for a reel that did carry a track.
  if (a === true) {
    const name = cand.clip?.track;
    return name ? `🎵 ${name}` : '🎵 מוזיקה מעורבת בקובץ';
  }
  return `🎵 ${a.title} · ${a.credit} · ${a.licence}${a.offset ? ` · מ-${a.offset}ש׳` : ''}`;
}

/**
 * What you are shown before deciding, for a MONTAGE.
 *
 * The thing that can go wrong here is not the thing that goes wrong on the
 * other two shapes, so the card leads on it.
 *
 * A held clip risks a bad shot; a cuts clip risks a hook whose count does not
 * match its labels. A montage risks ONE LINE BEING ILLEGIBLE OVER SOME OF THE
 * FOOTAGE. It is set once, against a placement combined pessimistically across
 * every shot (see combineSpots), and it holds for the whole video — so a line
 * measured comfortable on nine shots and marginal on three is a video that goes
 * blank for four and a half seconds in the middle, and nothing in a Telegram
 * preview on a phone would tell you that.
 *
 * So `agreed/shots` is printed large, and the per-shot contrasts under it, worst
 * first. That ordering is the point: the shot most likely to swallow the line is
 * the one you want at the top of the list, not buried at position nine.
 */
export function montageApprovalMessage(cand) {
  const c = cand.clip || {};
  const cuts = c.cuts || [];
  const spot = c.spot;

  // Worst first, which is the opposite of play order and the right order for
  // this question. Play order is in the video; this list is for judging.
  const byRisk = cuts
    .map((cut, i) => ({ ...cut, n: i + 1 }))
    .filter((cut) => cut.spot)
    .sort((a, b) => a.spot.worstContrast - b.spot.worstContrast);

  const lines = [
    `🎬 מונטאז׳ · ${cuts.length} שוטים · ${c.seconds}ש׳ · ${c.width}x${c.height}`,
    // The place, and HOW WELL SOURCED it is. A montage is grouped by the search
    // that found it, so the pin rests on however many of the shots the judge
    // independently placed. Two out of twelve is a weaker claim than ten, and
    // that difference is invisible in the video.
    `📍 ${c.montagePlace || '⚠️ לא זוהה - בלי פין ובלי תגית מדינה'}` +
      (c.montagePlace ? ` · ${c.montagePlaced}/${cuts.length} שוטים אושרו על ידי השיפוט` : '') +
      (c.montagePlace && !c.montageSite ? ' · מדינה בלבד' : ''),
    '',
    `✍️ השורה: ${cand.hook}`,
    cand.hookWritten ? '   (נכתבה לקליפ הזה)' : `   ⚠️ מהמאגר - ${cand.hookNote || 'לא נכתבה שורה'}`,
    '   השורה לא מתחלפת לאורך כל הסרטון',
    '',
    // The one number that decides whether this post works.
    spot
      ? `🔤 טקסט ${spot.onDark ? 'בהיר' : 'כהה'} · ניגודיות גרועה ביותר ${spot.worstContrast} · ${spot.agreed}/${spot.frames} שוטים מסכימים`
      : '🔤 ⚠️ לא נמדד - מיקום ברירת מחדל',
    spot && spot.agreed < spot.frames
      ? `   ⚠️ ${spot.frames - spot.agreed} שוטים נמדדו אחרת - בדקו שהשורה נקראת גם עליהם`
      : null,
    '',
    audioLine(cand),
    '',
    `🏷️ ${cand.tiktokCaption || '(אין תיאור)'}`,
    '',
    '🎞️ השוטים, מהמסוכן לטקסט לבטוח:',
  ].filter((l) => l !== null);

  for (const cut of byRisk.slice(0, 6)) {
    const v = cut.vision || null;
    const flags = v ? [v.aerial && 'רחפן', v.personSubject && '⚠️ אדם בפריים'].filter(Boolean) : [];
    lines.push(
      `   ${cut.n}. ניגודיות ${cut.spot.worstContrast} · Pexels ${cut.pexelsId} · ${cut.credit || 'ללא שם'}` +
        (flags.length ? ` · ${flags.join(' · ')}` : '')
    );
  }
  if (byRisk.length > 6) lines.push(`   ...ועוד ${byRisk.length - 6}`);

  lines.push('', `🔗 ${cuts[0]?.page || c.page || ''}`);
  return lines.join('\n');
}

export function clipApprovalMessage(cand) {
  const c = cand.clip || {};
  if (c.shape === 'cuts') return cutApprovalMessage(cand);
  if (c.shape === 'montage') return montageApprovalMessage(cand);
  // A SHAPE THIS FUNCTION HAS NO CARD FOR SAYS SO, rather than falling through.
  //
  // Three shapes reach here that the card below was never written for: the postcard
  // reel, the narrated guide and the hidden gems reel. All three are several shots
  // from several places, so none of them has the single `vision`, `spot`, `query` or
  // `pexelsId` the held card prints - and the card does print them, as `Pexels
  // undefined`, `⚠️ לא נשפט`, `⚠️ לא נמדד` and `🔗 undefined`.
  //
  // Those warnings are the loudest thing on the message and every one of them is
  // false: the clips WERE judged, which is the only reason the places could be
  // named. Each of these formats sends its own card from bot.js immediately after
  // staging, so what is needed here is the short version and nothing invented.
  if (c.shape && c.shape !== 'held') return multiShotApprovalMessage(cand);
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
    followFrameLine(cand),
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
 * The short card for a multi-shot format that brings its own detail.
 *
 * ONE SHAPE NAME, THE LENGTH, THE PLACES AND THE DESCRIPTION, and deliberately not a
 * judgement line: every one of these formats establishes its places THROUGH the
 * vision judge, so "was it judged" is answered by the fact that the places have
 * names. Nothing here is per-shot, because the format's own card is the next message
 * in the chat and that is where the per-shot view belongs.
 *
 * `places` covers the gems reel, `postcardPlaces` the postcard one, and a format with
 * neither prints the candidate's own `place` string, which every kind sets.
 */
export function multiShotApprovalMessage(cand) {
  const c = cand.clip || {};
  const names = c.places || c.postcardPlaces || (cand.place ? String(cand.place).split(' · ') : []);
  const shapeHe = { postcard: 'גלויות', hidden_gems_video: 'ג׳מים', narrated: 'מדריך' }[c.shape] || c.shape;
  return [
    `🎬 ${shapeHe} · ${c.seconds}ש׳ · ${names.length ? `${names.length} מקומות · ` : ''}${c.width}x${c.height}`,
    '',
    `✍️ הפתיחה: ${cand.hook}`,
    cand.hookWritten ? '   (נכתבה לסרטון הזה)' : `   ${cand.hookNote || 'מתבנית'}`,
    '',
    names.length ? names.map((n, i) => `   ${i + 1}. ${n}`).join('\n') : null,
    names.length ? '' : null,
    audioLine(cand),
    '',
    `🏷️ ${cand.tiktokCaption || '(אין תיאור)'}`,
    c.page || cand.sourceUrl ? `\n🔗 ${c.page || cand.sourceUrl}` : null,
  ]
    .filter((l) => l !== null)
    .join('\n');
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
    followFrameLine(cand),
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
