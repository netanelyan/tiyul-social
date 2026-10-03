import { rmSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ffmpegPath, clipOutputDir, download, measureClip, pickWindow } from './overlay.js';
import { renderPostcardPng } from './postcard.js';
import { postConfig } from '../postConfig.js';
import { pickTrack, trackOffset } from './tracks.js';
import { findClips } from './pexels.js';
import { clipPlaceLabel, gemsCaption } from '../hashtags.js';
import { targetsForKind } from '../publish/targets.js';
import { assertNoUrl } from '../format.js';
import { writeGemHook } from '../hooks/gems.js';
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
export function fitHolds(count, cfg = postConfig().gems) {
  const hook = cfg.hookSeconds;
  const { min: lo, max: hi } = cfg.holdSeconds;
  const target = cfg.targetSeconds;
  const mid = (target.min + target.max) / 2;

  let n = Math.max(1, count);
  let dropped = 0;
  let hold = 0;

  for (;;) {
    hold = Math.min(hi, Math.max(lo, (mid - hook) / n));
    const total = hook + n * hold;
    // Over the ceiling even at the floor hold: this many shots cannot be shown in
    // this many seconds, so one of them does not get shown.
    if (total > target.max && n > 1 && hook + n * lo > target.max) {
      n -= 1;
      dropped += 1;
      continue;
    }
    if (total > target.max) hold = (target.max - hook) / n;
    break;
  }

  const round = (x) => Math.round(x * 10) / 10;
  const holds = Array.from({ length: n }, () => round(hold));
  return { holds, seconds: round(hook + holds.reduce((a, b) => a + b, 0)), dropped };
}

/**
 * One reel from already-judged clips.
 *
 * `shots` is [{ src, duration, labelHe }] in the order they should appear. `hookClip`
 * carries the hook and no label, which is what lets it be a clip nobody could place.
 */
export async function buildHiddenGemsClip(
  shots,
  { hookHe, hookClip = null, id = 'gems', outDir = clipOutputDir(), track = null, cfg = null } = {}
) {
  const gems = cfg || postConfig().gems;
  const places = (shots || []).filter((s) => s?.src && s?.labelHe).slice(0, gems.shots.max);
  if (places.length < gems.shots.min) {
    throw new Error(`a hidden gems reel needs ${gems.shots.min} placed clips (got ${places.length})`);
  }

  const fit = fitHolds(places.length, gems);
  const kept = places.slice(0, fit.holds.length);

  // THE TIMELINE. The hook's own shot, then a shot per place, then optionally the
  // opening shot again for a fraction of a second.
  //
  // THE LOOP IS A CUT BACK, NOT A CROSS FADE, and that is a deliberate limit. An
  // xfade would mean a second filter chain inside a graph that is proven and that
  // every other shape here shares; a tail of the opening shot concatenated like any
  // other segment reaches the same end, which is that the last frame a viewer sees
  // is the first frame they saw. On a loop that reads as deliberate.
  const timeline = [];
  if (hookClip?.src) timeline.push({ ...hookClip, labelHe: null, hook: true, hold: gems.hookSeconds });
  for (const [i, place] of kept.entries()) timeline.push({ ...place, hold: fit.holds[i] });
  if (gems.loop && gems.loopSeconds > 0 && hookClip?.src) {
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

    // The type, measured against the frames it actually lands on, exactly as the
    // postcard does: a label over a bright sky gets less help than one over a
    // forest, and an unmeasured clip gets the help because not knowing is the risky
    // case rather than the safe one.
    const spots = [];
    for (const [i, local] of files.entries()) {
      spots.push(await measureClip(local, { startAt: starts[i], seconds: timeline[i].hold }).catch(() => null));
    }

    for (const [i, shot] of timeline.entries()) {
      const text = shot.hook ? hookHe : shot.labelHe;
      // The loop tail carries nothing. It is the opening frame coming back, and a
      // line on it would be a fifth message in the last half second.
      if (!text) continue;
      const png = path.join(outDir, `clip-${id}-txt-${i}.png`);
      await renderPostcardPng({ text, hook: Boolean(shot.hook), width: w, height: h, file: png, spot: spots[i] });
      pngs.push({ file: png, from: at[i], to: at[i] + shot.hold });
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
      dropped: fit.dropped,
      holdSeconds: fit.holds[0] ?? null,
      looped: Boolean(gems.loop && gems.loopSeconds > 0 && hookClip?.src),
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
    // A COUNTRY-ONLY LABEL IS DROPPED WHEN A NAMED SITE IN IT IS ALREADY ON THE REEL.
    // "יוון" beside "סנטוריני, יוון" is two shots of one country where one of them
    // admits it does not know where it is, which reads as a gap rather than as a
    // second destination. The other way round is fine: a named site is always more
    // specific than the bare country already shown.
    const bare = !labelHe.includes(',');
    if (bare && [...places].some((p) => p.endsWith(`, ${labelHe}`))) {
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

  // The hook is written AFTER the shots are chosen, because the count in it is a
  // promise about them. Written before, it would be a number the reel then has to
  // match, which is the wrong way round and is how a hook comes to over-promise.
  const fit = fitHolds(placed.length, gems);
  const shots = placed.slice(0, fit.holds.length);
  const hook = await writeGemHook({
    format: 'hidden_gems_video',
    deliverable: shots.length,
    write,
    rand,
    // Never the line the last reel opened on. `avoid` is handed in rather than read
    // inside the generator, for the same reason buildPost hands its history in: a lab
    // run must be able to ignore the account's memory and must not write to it.
    avoid: avoid == null ? gemHookHistory().slice(0, postConfig().gems.hooks.memory) : avoid,
    vars: {
      n: shots.length,
      placeList: shots.map((s) => s.labelHe),
    },
  });

  if (!hook.text) throw new Error(`no usable hook: ${hook.error || 'every candidate was rejected'}`);

  const hookClip = spare[0] || shots[0] || null;
  const id = `hg${Math.abs(shots.reduce((a, p) => (a * 31 + Number(p.id)) | 0, 7)).toString(16).slice(0, 10)}`;
  const built = await buildHiddenGemsClip(shots, { hookHe: hook.text, hookClip, id, outDir, cfg: gems });

  const cand = {
    kind: 'clip',
    id,
    hook: hook.text,
    headline: hook.text,
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
      file: built.file,
      audio: built.audio,
      track: built.track,
      seconds: built.seconds,
      holdSeconds: built.holdSeconds,
      looped: built.looped,
      dropped: built.dropped,
      follow: null,
      followAt: null,
      width: postConfig().clips.video.width,
      height: postConfig().clips.video.height,
      places: shots.map((p) => p.labelHe),
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
    `💎 ג׳מים · ${c.seconds} שניות · ${c.places.length} מקומות${c.looped ? ' · לופ' : ''}`,
    '',
    cand.hook,
    `   ${c.hookCategory || '?'}${c.hookTemplate ? `/${c.hookTemplate}` : ''}${c.hookScore ? ` · ${c.hookScore.total.toFixed(2)}` : ''}${cand.hookWritten ? ' · נכתב' : ''}`,
    '',
    c.places.map((n, i) => `${i + 1}. ${n}`).join('\n'),
  ];

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
