import { rmSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ffmpegPath, clipOutputDir, download, measureClip, pickWindow } from './overlay.js';
import { renderPostcardPng } from './postcard.js';
import { postConfig } from '../postConfig.js';
import { solveHolds } from './fit.js';
import { pickTrack, trackOffset } from './tracks.js';
import { findClips } from './pexels.js';
import { clipPlaceLabel, gemsCaption } from '../hashtags.js';
import { targetsForKind } from '../publish/targets.js';
import { assertNoUrl } from '../format.js';
import { writeGemHook, pickOpenLoop, fill } from '../hooks/gems.js';
import {
  retentionPlan,
  validateRetentionPlan,
  orderForOpenLoop,
  renderRetentionCard,
  frameSignature,
  loopDistance,
} from './retention.js';
import { placesNamedSince, gemHookHistory } from '../store.js';

// THE HIDDEN GEMS REEL: twelve seconds, a curiosity hook, three to five real shots.
//
// THIS IS THE FORMAT THE NUMBERS ASKED FOR, AND THE NUMBERS ARE OUR OWN:
//
//   3 יעדים שאנשים לא חושבים עליהם מספיק   12s video     197 views   12 likes   6.1%
//   4 יעדים שנראים כמו ציור                video        474          18         3.8%
//   לפני שאתם מזמינים לסנטוריני, שתי דקות  slideshow   1993           9         0.5%
//   נתנו לטוקיו 4.8, וזה למה                slideshow    711           9         1.3%
//
// A slideshow out-reaches a reel four to one here and the reel out-likes it twelve to
// one. The reading, written into gems.hooks and into posts.deliver rather than left
// as a conclusion: a specific promise earns the view and only a post that pays the
// promise off earns the like.
//
// HOW THIS DIFFERS FROM THE POSTCARD REEL IT IS BUILT ON, which is the honest answer
// to "why a second module". Three things, and only one of them is cosmetic:
//
//   LENGTH. A postcard holds every shot for four seconds and runs 17 to 19. This
//   fits the holds to a 10 to 15 second target, which is where the reference post
//   sat. fitHolds solves for the hold rather than hardcoding one, because the shot
//   count is whatever the vision judge could place that morning.
//
//   THE HOOK IS GENERATED AND SCORED. The postcard picks one of three counted lines
//   by a hash of the clip ids. This one asks src/hooks/gems.js for ten candidates,
//   scores them on specificity, curiosity and honesty, and keeps the rest on the
//   candidate so the approval card can show what it turned down.
//
//   A PLACE IS NOT NAMED TWICE IN A FORTNIGHT. The brief's rule, and it is about the
//   PLACE rather than the footage: `clipsUsed` already stops the same Pexels file
//   going out twice, and it cannot stop two different files of Lauterbrunnen going
//   out a week apart. See notePlacesNamed in src/store.js.
//
// Everything below the differences is deliberately the same code: the same encode
// settings, the same cover-and-crop fill, the same adaptive text treatment measured
// against the real frames, the same PNG overlay renderer. A second renderer would be
// a second place for the type to drift.

/**
 * How long to hold each shot so the reel lands inside its target length.
 *
 * AIMED AT THE MIDDLE OF THE TARGET, NOT AT EITHER END. The reference post is 12
 * seconds and the configured target is 10 to 15, so aiming at the minimum would
 * make every reel a second shorter than the thing that worked and aiming at the
 * maximum would make a three shot reel 15 seconds of three places.
 *
 * WHEN IT CANNOT FIT, IT DROPS A SHOT RATHER THAN RUNNING LONG. Five shots at the
 * two second floor plus a three second hook is 13 seconds, so this only bites on a
 * configuration with a longer hook or a higher floor. The direction is the one the
 * numbers support: a viewer leaves a long reel, and the brief's own ceiling is 15.
 *
 * Returns `{ holds, seconds, dropped }`. `holds` is one duration per shot handed in,
 * minus the dropped ones, rounded to a tenth of a second because the value reaches
 * an ffmpeg `-t` and a float with sixteen digits in it is a filter graph nobody can
 * read in a log.
 */
export const fitHolds = (count, cfg = postConfig().gems, opts = {}) => solveHolds(count, cfg, opts);

/**
 * One reel from already-judged clips.
 *
 * `shots` is [{ src, duration, labelHe }] in the order they should appear. `hookClip`
 * carries the hook and no label, which is what lets it be a clip nobody could place.
 */
export async function buildHiddenGemsClip(
  shots,
  {
    hookHe,
    openLoopHe = null,
    questionHe = null,
    plan = null,
    hookClip = null,
    id = 'gems',
    outDir = clipOutputDir(),
    track = null,
    cfg = null,
  } = {}
) {
  const gems = cfg || postConfig().gems;
  const r = gems.retention;
  const places = (shots || []).filter((s) => s?.src && s?.labelHe).slice(0, gems.shots.max);
  if (places.length < gems.shots.min) {
    throw new Error(`a hidden gems reel needs ${gems.shots.min} placed clips (got ${places.length})`);
  }

  // The plan is handed in by planGemsReel, which has already checked it. Recomputed
  // here only for the callers that build a reel directly, which is the labs and the
  // tests: the timeline is a pure function of the shots and the config, so computing
  // it twice cannot disagree with itself.
  const shaped =
    plan ||
    retentionPlan({ shots: places, hookHe, openLoopHe, questionHe, cfg: gems });
  const kept = shaped.shots;

  // THE TIMELINE. The hook's own shot, then a shot per place, then optionally the
  // opening shot again for a fraction of a second.
  //
  // THE HOOK SHOT IS STILL ITS OWN SHOT and still carries no label, which is the
  // owner's rule from e64f71c. What changed is its LENGTH: 1.6 seconds instead of 3,
  // so the first cut lands before the three second drop-off rather than on it, and
  // the hook TEXT outlives it - full size until 3.2s, then a header for the rest.
  // See retentionPlan.
  const timeline = [];
  if (hookClip?.src) timeline.push({ ...hookClip, labelHe: null, hook: true, hold: shaped.hookSeconds });
  for (const [i, place] of kept.entries()) timeline.push({ ...place, hold: shaped.holds[i] });
  // `retention.loop: cut` is the old tail. `match` spends no screen time and is the
  // default; see the window selection below.
  const wantsTail = r.on ? r.loop === 'cut' : gems.loop;
  if (wantsTail && gems.loopSeconds > 0 && hookClip?.src) {
    timeline.push({ ...hookClip, labelHe: null, hook: false, tail: true, hold: gems.loopSeconds });
  }

  const video = postConfig().clips.video;
  const { width: w, height: h, fps, crf, preset } = video;
  const file = path.join(outDir, `clip-${id}.mp4`);

  const files = [];
  const pngs = [];

  try {
    const starts = [];
    for (const [i, shot] of timeline.entries()) {
      const local = path.join(outDir, `clip-${id}-src-${i}.mp4`);
      await download(shot.src, local);
      files.push(local);
      // pickWindow finds the part of a stock clip worth showing, which is rarely
      // the opening seconds. The loop tail deliberately does NOT ask: it has to be
      // the same window the reel opened on or it is not a loop, it is a sixth shot.
      starts.push(shot.tail ? starts[0] ?? (video.startAt || 0) : await pickWindow(local, shot.duration).catch(() => video.startAt || 0));
    }

    const at = [];
    let clock = 0;
    for (const shot of timeline) {
      at.push(clock);
      clock += shot.hold;
    }

    // THE SEAMLESS LOOP, CHOSEN RATHER THAN CROSS FADED.
    //
    // A rewatch starts on the first frame of the reel, so the cut a viewer sees on the
    // second lap is the LAST frame against the FIRST. `match` shifts the closing
    // window of the last shot to whichever candidate second looks most like the
    // opening frame - matching colour and the coarse layout of light, which is what
    // the brief asks for and what the eye reads as continuity.
    //
    // IT SPENDS NO SCREEN TIME, which is the whole reason it is the default over the
    // cut-back tail. The closing frame now has a question on it that has to be read,
    // and 0.4 seconds of a 8.6 second reel spent replaying the opening is 5% of the
    // post plus the frame the question needed.
    //
    // A match that is not close enough is simply not applied: a jarring cut dressed up
    // as a loop is worse than an honest one. See loopMaxDistance.
    let loopMatch = null;
    if (r.on && r.loop === 'match' && files.length > 1) {
      const open = await frameSignature(files[0], starts[0]).catch(() => null);
      const lastIdx = files.length - 1;
      if (open) {
        const span = timeline[lastIdx].hold;
        // Three candidate closing seconds inside the shot's own window, which is all
        // the range there is: the window was already chosen by pickWindow for being
        // the part worth showing, so this nudges rather than relocates.
        const options = [0, 0.4, 0.8, 1.2]
          .map((d) => starts[lastIdx] + d)
          .filter((s) => s + span <= starts[lastIdx] + span + 1.4);
        let best = null;
        for (const s of options) {
          const sig = await frameSignature(files[lastIdx], s + span - 0.1).catch(() => null);
          const d = loopDistance(open, sig);
          if (d != null && (!best || d < best.d)) best = { start: s, d };
        }
        if (best && best.d <= r.loopMaxDistance) {
          starts[lastIdx] = best.start;
          loopMatch = { distance: Number(best.d.toFixed(3)), applied: true };
        } else if (best) {
          loopMatch = { distance: Number(best.d.toFixed(3)), applied: false };
        }
      }
    }

    // The type, measured against the frames it actually lands on, exactly as the
    // postcard does: a label over a bright sky gets less help than one over a
    // forest, and an unmeasured clip gets the help because not knowing is the risky
    // case rather than the safe one.
    const spots = [];
    for (const [i, local] of files.entries()) {
      spots.push(await measureClip(local, { startAt: starts[i], seconds: timeline[i].hold }).catch(() => null));
    }

    if (r.on) {
      // ONE PNG PER TEXT STATE, which is what lets four elements share a frame for the
      // price of one overlay. A card holds everything on screen at that moment, so the
      // gradient that lifts it is sized against the frames the whole block lands on
      // rather than against one line's worth of them.
      //
      // Each card is measured against the shot it OVERLAPS. The hook card spans the
      // hook shot and the opening of the first place, and is measured against the hook
      // shot, which is where it spends most of its life and the only frame a viewer is
      // guaranteed to see it on.
      for (const [i, card] of shaped.cards.entries()) {
        const over = timeline.findIndex((_, k) => at[k] <= card.from + 0.01 && card.from < at[k] + timeline[k].hold);
        const png = path.join(outDir, `clip-${id}-card-${i}.png`);
        await renderRetentionCard({ card, width: w, height: h, file: png, spot: spots[over] ?? spots[0] });
        pngs.push({ file: png, from: card.from, to: card.to });
      }
    } else {
      // THE OLD OVERLAY, one line per shot and nothing persistent, reachable by
      // `retention.on: false`. This is what the 3.1 second average was measured on.
      for (const [i, shot] of timeline.entries()) {
        const text = shot.hook ? hookHe : shot.labelHe;
        if (!text) continue;
        const png = path.join(outDir, `clip-${id}-txt-${i}.png`);
        await renderPostcardPng({ text, hook: Boolean(shot.hook), width: w, height: h, file: png, spot: spots[i] });
        pngs.push({ file: png, from: at[i], to: at[i] + shot.hold });
      }
    }

    // SOUND. `app` is the current behaviour and the default: the file goes out
    // silent, the clip lands in TikTok's inbox as a draft and the owner picks the
    // track in the app. `library` mixes a declared track so the post can be
    // promoted, which is the one thing a borrowed sound makes impossible.
    const wantsBed = gems.sound === 'library';
    const chosen = wantsBed ? (track ? { file: track, name: path.basename(track) } : pickTrack(new Set())) : null;
    const bed = chosen?.file || null;
    const audio = postConfig().clips.audio;
    // ROUNDED, because this number is printed. Three plus three holds of 3.2 is
    // 12.600000000000001 in binary floating point, and the approval card read
    // "12.600000000000001 שניות". It also reaches ffmpeg's -t, where the extra
    // digits are noise in a log nobody can scan.
    const seconds = Math.round(clock * 10) / 10;

    const args = ['-y', '-hide_banner', '-loglevel', 'error'];
    for (const [i, local] of files.entries()) {
      args.push('-ss', String(starts[i]), '-t', String(timeline[i].hold), '-i', local);
    }
    for (const p of pngs) args.push('-i', p.file);
    if (bed) args.push('-ss', String(trackOffset(id, audio.maxOffsetSeconds)), '-stream_loop', '-1', '-i', bed);

    const n = files.length;
    const steps = [];
    for (let i = 0; i < n; i++) {
      steps.push(
        `[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=${fps},setsar=1[v${i}]`
      );
    }
    steps.push(`${Array.from({ length: n }, (_, i) => `[v${i}]`).join('')}concat=n=${n}:v=1:a=0[bg]`);

    let chain = 'bg';
    for (const [i, p] of pngs.entries()) {
      const next = i === pngs.length - 1 ? 'vout' : `o${i}`;
      steps.push(
        `[${chain}][${n + i}:v]overlay=0:0:format=auto:enable='between(t,${p.from.toFixed(2)},${p.to.toFixed(2)})'[${next}]`
      );
      chain = next;
    }

    if (bed) {
      steps.push(
        `[${n + pngs.length}:a]volume=${audio.volume},afade=t=in:st=0:d=${audio.fadeInSeconds},` +
          `afade=t=out:st=${Math.max(0, seconds - audio.fadeOutSeconds).toFixed(2)}:d=${audio.fadeOutSeconds}[aout]`
      );
    }

    args.push('-filter_complex', steps.join(';'), '-map', '[vout]');
    if (bed) args.push('-map', '[aout]', '-c:a', 'aac', '-b:a', audio.bitrate);
    args.push(
      '-c:v', 'libx264',
      '-preset', preset,
      '-crf', String(crf),
      '-pix_fmt', 'yuv420p',
      '-r', String(fps),
      '-t', String(seconds),
      file
    );

    await run(ffmpegPath(), args);
    return {
      file,
      seconds,
      shots: kept.length,
      dropped: shaped.dropped,
      holdSeconds: shaped.holds[0] ?? null,
      holds: shaped.holds,
      firstCutAt: shaped.firstCutAt,
      hookFullUntil: shaped.hookFullUntil,
      // What the approval card prints and what the metrics row records: a reel that
      // kept its promises visibly is the thing being tested.
      counter: shaped.counted ? `1..${shaped.holds.length}/${shaped.holds.length}` : null,
      // `cut` is the old tail, `match` is a window chosen to look like the opening,
      // and a match too far apart to be seamless is reported as not applied rather
      // than silently counted as a loop.
      looped: wantsTail ? 'cut' : loopMatch?.applied ? 'match' : null,
      loopDistance: loopMatch?.distance ?? null,
      audio: Boolean(bed),
      track: chosen?.name || null,
    };
  } finally {
    for (const p of pngs) rmSync(p.file, { force: true });
    for (const f of files) rmSync(f, { force: true });
  }
}

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => {
      err += d.toString();
    });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-700)}`))));
  });
}

/**
 * Which clips may carry a place name, newest rules first.
 *
 * THREE FILTERS AND THEY ARE NOT THE SAME FILTER. A clip is unusable as a labelled
 * shot when the judge could not place it (no evidence for the label), when the reel
 * already has that place (four angles on one valley is one place four times, which
 * is what made an earlier Prague reel "not get numbers"), or when a post named that
 * place inside the fortnight (the brief's rule).
 *
 * Everything filtered out becomes a spare, and the spares are useful rather than
 * waste: the hook's shot carries no place name, so it needs no evidence for one.
 */
export function sortShots(clips, { seenPlaces = new Map(), want = 5, floor = 3, strongestLast = true } = {}) {
  const fresh = [];
  const stale = [];
  const spare = [];
  const places = new Set();
  const skipped = [];

  // THE SAME PLACE TWICE IS KEYED ON THE LABEL, NOT ON THE COUNTRY, and this was the
  // single biggest thing wrong with the format.
  //
  // The postcard reel keys its dedupe on `vision.place`, which its comment calls a
  // city and which is in fact the COUNTRY the judge named. Measured on one live
  // search: 17 clips passed the destination gate and 14 could be labelled, as eight
  // separate Dolomites shots, three Vietnamese sites and three Greek ones. Keyed on
  // the country that is three places, barely the minimum, and on an hour when one
  // country dominates it is one or two and the reel cannot be built at all. Five
  // consecutive dry runs failed on exactly that, every one reporting "only 1 of 20
  // could be placed" while sitting on a pool of fourteen labelled clips.
  //
  // Keyed on the label it is six places, which is what the pool actually contained.
  // Santorini and Meteora are two destinations and the brief's own reference post is
  // a list of them; eight angles on the Dolomites is one place eight times, which is
  // the failure the postcard comment is really about and which the label catches
  // properly because the label IS the site.
  //
  // Left alone in postcard.js on purpose. That format is the control the gems reel is
  // measured against, and changing it mid-comparison would make the numbers
  // unreadable. It is written down in docs/hidden-gems-plan.md instead.
  for (const c of clips || []) {
    const labelHe = clipPlaceLabel({ vision: c.vision });
    const country = String(c.vision?.place || '').toLowerCase();
    if (!labelHe || !country) {
      spare.push(c);
      continue;
    }
    const key = labelHe;
    if (places.has(key)) {
      spare.push(c);
      continue;
    }
    places.add(key);
    const shot = { src: c.src, duration: c.duration, labelHe, id: c.id, credit: c.credit, page: c.page, rank: c.rank ?? null };
    // `seenPlaces` may be a Map of label -> when, or a Set with no timestamps. A Set
    // means every entry is equally old, which ranks them all at 0 and is the right
    // reading: without a time the only honest order is the order they arrived in.
    const namedAt = seenPlaces.get?.(labelHe) ?? (seenPlaces.has(labelHe) ? 0 : null);
    if (namedAt == null) fresh.push(shot);
    else stale.push({ ...shot, namedAt });
  }

  // A COUNTRY-ONLY LABEL IS DROPPED WHEN A NAMED SITE IN THAT COUNTRY IS ALSO ON THE
  // REEL, and this runs as a pass over the whole set rather than inside the loop
  // because order decides nothing here and did decide something in the first version.
  //
  // One reel came out as "סנטוריני, יוון · יוון · פושימי אינארי טאישה, יפן": the bare
  // Greek clip arrived first, so there was no Greek site to compare it against yet,
  // and both survived. Two shots of one country where one of them admits it does not
  // know where it is reads as a gap on the reel whichever order they are in.
  //
  // The bare label is kept when it is the only thing from there, which is what the
  // brief's own "גאורגיה" example is.
  const named = new Set([...fresh, ...stale].filter((s) => s.labelHe.includes(',')).map((s) => s.labelHe.split(', ').pop()));
  const redundant = (s) => !s.labelHe.includes(',') && named.has(s.labelHe);
  for (const s of [...fresh, ...stale].filter(redundant)) spare.push(s);
  const keepFresh = fresh.filter((s) => !redundant(s));
  const keepStale = stale.filter((s) => !redundant(s));
  fresh.length = 0;
  fresh.push(...keepFresh);
  stale.length = 0;
  stale.push(...keepStale);

  // THE FORTNIGHT RULE IS A PREFERENCE, AND THIS PROJECT HAS SETTLED THAT TWICE.
  //
  // The brief says not to repeat a destination posted in the last 14 days, and taken
  // as a refusal that is a rule which can stop the lead format being built at all:
  // the reel needs three places a vision judge will commit to, the recognizable pool
  // from the configured searches is perhaps fifty names, and at two reels a day a
  // fortnight reserves a real fraction of it. Measured on a live search, a single
  // morning's pool yields one to five placeable clips - so the reserved names are the
  // difference between a post and nothing on more days than is comfortable.
  //
  // Both precedents in this codebase point the same way. drawWeighted falls back to
  // the full pool when its exclusions empty it, because "refusing to build is a worse
  // answer than repeating the oldest of them". pickTrack falls back to every track,
  // because "returning null and publishing silence to avoid a repeat is the wrong way
  // round". This is the same shape of question and it gets the same answer.
  //
  // So: fresh places first, always. A place named inside the window comes back only
  // to reach the floor, OLDEST FIRST, and it is recorded in `skipped` either way -
  // the ones that were held back when there was no need, and the ones that had to be
  // reused. The approval card prints them, because a repeat the owner cannot see is
  // the one thing worse than a repeat.
  const placed = [...fresh];
  if (placed.length < floor && stale.length) {
    const byAge = [...stale].sort((a, b) => a.namedAt - b.namedAt);
    for (const shot of byAge) {
      if (placed.length >= floor) break;
      placed.push(shot);
      skipped.push(`${shot.labelHe} was named in the last fortnight and is back, to reach ${floor} places`);
    }
  }
  for (const shot of stale) {
    if (!placed.includes(shot)) skipped.push(`${shot.labelHe} was held back, named in the last fortnight`);
  }
  // Whatever is over the ceiling is a spare rather than a shot, which is also what
  // feeds the hook its unlabelled clip.
  const over = placed.slice(want);
  const kept = placed.slice(0, want);

  // findClips returns best first, so reversing puts the best last. The last frame
  // of a twelve second reel is what somebody is looking at while they decide
  // whether to watch it again.
  return { placed: strongestLast ? kept.slice().reverse() : kept, spare: [...spare, ...over], skipped };
}

/**
 * The hook, the open loop, the order of the shots, the question and the timeline.
 *
 * ONE FUNCTION BECAUSE THE FIVE DECISIONS ARE ONE DECISION. The open loop determines
 * the order, the order determines which shot is last, the last shot is what the loop
 * promised, and the hook's count has to match however many shots survived. Drawn
 * separately they would each be right about something and the post would be wrong.
 *
 * ORDER OF OPERATIONS, and each step depends on the one above it:
 *
 *   1. the open loop, from the loops whose measure these shots can actually support
 *   2. the order, so the shot that wins that measure goes last and the strongest of
 *      the rest opens
 *   3. the hook, written knowing how many shots there are
 *   4. the question, drawn once for the screen and the caption both
 *   5. the timeline, and then the gate over all of it
 *
 * No I/O. Returns everything the builder needs plus the check, so a refusal costs a
 * hook call and nothing else.
 */
export async function planGemsReel(
  candidates,
  { gems = null, write = true, rand = Math.random, avoid = [], avoidLoops = [] } = {}
) {
  const cfg = gems || postConfig().gems;
  const r = cfg.retention;

  const openLoop = r.on && r.openLoop ? pickOpenLoop({ shots: candidates, rand, avoid: avoidLoops }) : null;
  const { ordered, last } = r.on
    ? orderForOpenLoop(candidates, { openLoop, strongestFirst: r.strongestFirst })
    : { ordered: candidates, last: candidates[candidates.length - 1] };

  const hook = await writeGemHook({
    format: 'hidden_gems_video',
    deliverable: ordered.length,
    write,
    rand,
    avoid,
    // THE OPEN LOOP IS SCORED WITH THE HOOK RATHER THAN AFTER IT. A line and its
    // second line are one sentence as far as a viewer is concerned, and the "reason
    // to stay" term is about the pair: scoring the first line alone would rank every
    // candidate identically on the one axis this change exists to add.
    openLoopHe: openLoop?.he || null,
    vars: { n: ordered.length, placeList: ordered.map((s) => s.labelHe) },
  });
  if (!hook.text) return { error: `no usable hook: ${hook.error || 'every candidate was rejected'}` };

  // ONE QUESTION, FOR THE SCREEN AND THE CAPTION. Drawn here and handed to both, so
  // the post asks one thing once. Two draws would burn one question onto the last
  // frame and print a different one underneath it, which reads as two people.
  const questions = cfg.caption.questions;
  const questionHe = r.on && r.question && questions.length
    ? fill(questions[Math.floor(rand() * questions.length)], {
        // "1, 2 או 3?" is the easiest comment anybody will ever leave, and the counter
        // on screen has already taught them the numbering.
        choices: ordered.map((_, i) => i + 1).join(', ').replace(/, (\d+)$/, ' או $1'),
        n: ordered.length,
      })
    : null;

  const plan = retentionPlan({
    shots: ordered,
    hookHe: hook.text,
    openLoopHe: openLoop?.he || null,
    questionHe,
    cfg,
  });

  const check = validateRetentionPlan(plan, { cfg, openLoop, lastShot: plan.shots[plan.shots.length - 1] });
  return { hook, openLoop, questionHe, plan, shots: plan.shots, last, check };
}

/**
 * One hidden gems reel, as an approvable candidate.
 *
 * Same shape of return value as every other clip here, which is what makes this an
 * addition rather than a second pipeline: the queue, the drip, the Telegram album
 * and the TikTok publisher all read `cand.clip.file` and none of them changes.
 */
export async function buildHiddenGemsCandidate({
  outDir = clipOutputDir(),
  seen = new Set(),
  days = null,
  write = true,
  // WHICH SEARCHES TO RUN, OR ALL OF THEM, which is the default and what the drip
  // wants: breadth, so the judge picks the best places the morning happens to offer.
  //
  // It is a parameter because of what the dry run found. Five reels built in one
  // sitting, from one pool: the first three took the placeable clips and the last two
  // could not be built at all, with "destination 6" and "person in front of the
  // camera" as the reasons. The queue is ordered by title score, so a second reel is
  // working its way down the same list rather than looking somewhere else.
  //
  // The montage shape already narrows for the opposite reason, needing six shots of
  // ONE place. See the note above the loop in findClips.
  queries = null,
  // Which hook templates to refuse, or null to read the account's own history. The
  // lab passes its own list so a run of five reels varies without the store being
  // touched. See the note beside `avoid` in src/hooks/gems.js for why this exists at
  // all: the scorer is deterministic, so the best line ships every time.
  avoid = null,
  rand = Math.random,
} = {}) {
  const gems = postConfig().gems;
  const found = await findClips({ limit: 24, seen, judge: true, queries });
  // The brief's fortnight, from the config so it can be lowered without a deploy if
  // it starves the format. See placeMemoryDays in src/postConfig.js.
  const seenPlaces = placesNamedSince(days == null ? gems.placeMemoryDays : days);
  const { placed, spare, skipped } = sortShots(found.clips || [], {
    seenPlaces,
    want: gems.shots.max,
    // The floor the fortnight rule may be relaxed to reach, and no further: a reel
    // that can be built from four fresh places is built from four, and the fifth is
    // never a repeat for the sake of a longer reel.
    floor: gems.shots.min,
    strongestLast: gems.strongestLast,
  });

  if (placed.length < gems.shots.min) {
    throw new Error(
      `only ${placed.length} clip(s) of ${(found.clips || []).length} could be placed, and a hidden gems reel needs ${gems.shots.min}` +
        (skipped.length ? ` - ${skipped.slice(0, 3).join('; ')}` : '') +
        (found.nowhere?.length ? ` - ${found.nowhere.slice(0, 2).join('; ')}` : '')
    );
  }

  // HOW MANY SHOTS THE LENGTH ALLOWS, before the hook is written, because the count
  // is a promise about them. Written first, it would be a number the reel then has to
  // match, which is the wrong way round and is how a hook comes to over-promise.
  const r = gems.retention;
  const fit = fitHolds(placed.length, gems, r.on ? { hookSeconds: r.firstCutSeconds } : {});
  const trimmed = placed.slice(0, fit.holds.length);

  // THE WHOLE REEL, PLANNED AND CHECKED BEFORE ANYTHING IS ENCODED, and rebuilt when
  // the check fails. `retries` is one by default: a second pass redraws the open loop
  // and with it the ordering, which is what a failed promise check actually needs,
  // and a third would be three vision passes for one post.
  let attempt = null;
  const refused = [];
  for (let tries = 0; tries <= r.retries; tries++) {
    const next = await planGemsReel(trimmed, {
      gems,
      write,
      rand,
      avoid: avoid == null ? gemHookHistory().slice(0, postConfig().gems.hooks.memory) : avoid,
      // The second attempt refuses the open loop the first one used, so a retry is a
      // different promise rather than the same one failing twice.
      avoidLoops: refused.map((x) => x.openLoop?.id).filter(Boolean),
    });
    if (next.error) throw new Error(next.error);
    if (next.check.ok) {
      attempt = next;
      break;
    }
    refused.push(next);
    console.log(`gems: plan refused (${tries + 1}/${r.retries + 1}) - ${next.check.problems.join('; ')}`);
  }

  if (!attempt) {
    const last = refused[refused.length - 1];
    throw new Error(`the reel failed the retention check: ${last?.check.problems.join('; ') || 'unknown'}`);
  }

  const { hook, openLoop, questionHe, plan, shots } = attempt;
  const hookClip = spare[0] || shots[0] || null;
  const id = `hg${Math.abs(shots.reduce((a, p) => (a * 31 + Number(p.id)) | 0, 7)).toString(16).slice(0, 10)}`;
  const built = await buildHiddenGemsClip(shots, {
    hookHe: hook.text,
    openLoopHe: openLoop?.he || null,
    questionHe,
    plan,
    hookClip,
    id,
    outDir,
    cfg: gems,
  });

  const cand = {
    kind: 'clip',
    id,
    // THE HOOK IS THE TWO LINES TOGETHER, wherever a reader sees it. The open loop is
    // not a decoration on the hook, it is the half that earns the second half of the
    // video, so the approval card, the published ledger and the metrics row all carry
    // the pair. `hookLine` keeps the first line alone for the one reader that wants
    // it, which is the hook memory: the shape is what must not repeat, not the suffix.
    hook: [hook.text, openLoop?.he].filter(Boolean).join(' · '),
    hookLine: hook.text,
    headline: [hook.text, openLoop?.he].filter(Boolean).join(' · '),
    hookWritten: hook.from === 'written',
    hookNote: `hidden gems: ${hook.category || 'uncategorised'}${hook.templateId ? `/${hook.templateId}` : ''}, scored ${hook.score ? hook.score.total.toFixed(2) : '?'} of ${hook.considered.length + hook.rejected.length} candidates`,
    sourceName: `Pexels · ${[...new Set(shots.map((p) => p.credit).filter(Boolean))].join(', ') || 'unknown'}`,
    sourceUrl: shots[0].page,
    pillar: 'day',
    tags: [],
    createdAt: new Date().toISOString(),
    publishTargets: targetsForKind('clip'),
    tiktokDraft: true,
    overrides: [],
    notes: skipped,
    place: shots.map((p) => p.labelHe).join(' · '),
    clip: {
      shape: 'hidden_gems_video',
      format: 'hidden_gems_video',
      hookLine: hook.text,
      file: built.file,
      audio: built.audio,
      track: built.track,
      seconds: built.seconds,
      holdSeconds: built.holdSeconds,
      holds: built.holds,
      looped: built.looped,
      loopDistance: built.loopDistance,
      dropped: built.dropped,
      follow: null,
      followAt: null,
      width: postConfig().clips.video.width,
      height: postConfig().clips.video.height,
      places: shots.map((p) => p.labelHe),
      // EVERYTHING THE RETENTION CHANGE ADDED, recorded on the candidate so the
      // approval card can show it and the metrics row can group by it. These are the
      // fields the next read of the analytics will be about.
      openLoop: openLoop?.he || null,
      openLoopId: openLoop?.id || null,
      orderBy: openLoop?.orderBy || null,
      questionHe,
      counter: built.counter,
      firstCutAt: built.firstCutAt,
      hookFullUntil: built.hookFullUntil,
      // Which shot pays the promise off, and what it scored on the measure. The
      // approval card prints it, because "the last one is the most surprising" is a
      // claim the owner should be able to check in one line.
      payoffHe: attempt.last?.labelHe || null,
      payoffMeasure: attempt.last?.measure ?? null,
      // The refusals, if the first plan did not pass. Logged on the candidate as well
      // as to the console: the console scrolls and the card is what gets read.
      refusedPlans: refused.map((x) => x.check.problems.join('; ')),
      // WHAT THE HOOK WAS AND WHAT IT BEAT, carried onto the candidate so the
      // metrics row can group by category and the approval card can show the
      // alternatives. A hook nobody can see the runners up of is a hook nobody can
      // judge, and the brief asks for the rest to be logged.
      hookCategory: hook.category,
      hookTemplate: hook.templateId,
      hookScore: hook.score,
      hookConsidered: hook.considered,
      hookRejected: hook.rejected,
      pexelsIds: [...new Set([...shots.map((p) => p.id), hookClip?.id].filter(Boolean).map(String))],
    },
  };

  // THE DESCRIPTION, UNDER THE NAME THE PUBLISHER ACTUALLY READS.
  //
  // `src/publish/tiktok.js` sends `cand.tiktokCaption`, and the first version of this
  // function set `cand.caption` instead - a field nothing reads, so the reel would
  // have published with no description at all. Three names for one string, exactly as
  // src/video/clip.js sets them, because the three platforms take the same words and
  // a reader looking for the Instagram copy should not have to know that.
  //
  // assertNoUrl for the reason every other caption has it: the link lives in the bio
  // and the caption says so in words. It throws, which is right - a description with
  // an address in it is a post that has to be edited after it is live.
  const caption = assertNoUrl(gemsCaption(cand, { rand }), 'the hidden gems description');
  cand.caption = caption;
  cand.tiktokCaption = caption;
  cand.instagramCaption = caption;
  cand.channelCaption = caption;
  return cand;
}

/** The approval card. The hook, the places, and what the hook beat. */
export function hiddenGemsApprovalMessage(cand) {
  const c = cand.clip;
  const lines = [
    `💎 ג׳מים · ${c.seconds} שניות · ${c.places.length} מקומות${c.looped ? ` · לופ ${c.looped}` : ''}`,
    '',
    c.openLoop ? `${c.hookLine || cand.hook}` : cand.hook,
    // THE OPEN LOOP ON ITS OWN LINE, because it is the half of the hook this change
    // exists for and the owner is being asked to judge whether the last shot pays it
    // off. A card that printed the two lines as one sentence would hide the question.
    c.openLoop ? `   ↳ ${c.openLoop}` : null,
    `   ${c.hookCategory || '?'}${c.hookTemplate ? `/${c.hookTemplate}` : ''}${c.hookScore ? ` · ${c.hookScore.total.toFixed(2)}` : ''}${cand.hookWritten ? ' · נכתב' : ''}`,
    '',
    // The counter is on the card as well as on the video, numbered the same way, so
    // the shot list reads as what a viewer sees rather than as an internal ordering.
    c.places
      .map((n, i) => `${c.counter ? `${i + 1}/${c.places.length}` : `${i + 1}.`} ${n}${i === c.places.length - 1 && c.openLoop ? '  ← הבטחה' : ''}`)
      .join('\n'),
  ];

  // THE RETENTION FACTS, which are the numbers this format is now judged on. Printed
  // as one line because they are one claim: the viewer is given a reason to stay
  // before three seconds and something to do at the end.
  if (c.firstCutAt != null) {
    lines.push(
      '',
      `⏱️ חיתוך ראשון ${c.firstCutAt}ש׳ · פתיח גדול עד ${c.hookFullUntil}ש׳ ואז כותרת · ${c.holds ? c.holds.join('+') : '?'}`
    );
  }
  if (c.questionHe) lines.push(`💬 בסוף ובכיתוב: ${c.questionHe}`);
  if (c.orderBy) {
    lines.push(
      `🎯 ${c.openLoop} → ${c.payoffHe || '?'}${c.payoffMeasure != null ? ` (${c.orderBy} ${c.payoffMeasure})` : ''}`
    );
  }
  if (c.loopDistance != null) {
    lines.push(`🔁 מרחק לופ ${c.loopDistance}${c.looped === 'match' ? ' · הותאם' : ' · לא נסגר, הושאר כמו שהוא'}`);
  }
  for (const why of c.refusedPlans || []) lines.push(`↺ תוכנית נדחתה: ${why}`);

  const others = (c.hookConsidered || []).slice(1, 4);
  if (others.length) {
    lines.push('', 'מה שלא נבחר:');
    for (const o of others) lines.push(`   ${o.total.toFixed(2)} ${o.text}`);
  }
  if (c.dropped) lines.push('', `${c.dropped} שוטים ירדו כדי להישאר בטווח האורך`);

  // A PLACE THAT CAME BACK INSIDE THE FORTNIGHT IS SAID OUT LOUD, which is the whole
  // bargain that makes the rule a preference rather than a refusal. The same doctrine
  // the owner overrides run on: a bypass is carried out and named, never quiet.
  const reused = (cand.notes || []).filter((n) => /is back/.test(n));
  if (reused.length) {
    lines.push('', `⚠️ ${reused.length} מקומות חוזרים מתוך השבועיים האחרונים, כדי להגיע ל-${c.places.length}:`);
    for (const r of reused) lines.push(`   ${r.split(' was named')[0]}`);
  }

  if (!c.audio) lines.push('', 'ללא סאונד, לבחירה באפליקציה');

  return lines.filter((x) => x != null).join('\n');
}
