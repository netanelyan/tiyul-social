import { spawn } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ffmpegPath, clipOutputDir, download, measureClip, pickWindow } from './overlay.js';
import { getBrowser } from '../render/index.js';
import { assistantDataUri, escapeHtml } from '../render/theme.js';
import { postConfig } from '../postConfig.js';
import { pickTrack } from './tracks.js';
import { findClips } from './pexels.js';
import { clipPlaceLabel } from '../hashtags.js';
import { targetsForKind } from '../publish/targets.js';
import { captionFollow } from '../hashtags.js';
import { planGemsReel, buildHiddenGemsClip } from './hiddenGems.js';

// THE COUNTED POSTCARD REEL: a hook, then four places, each one a moving shot.
//
// THE REFERENCE, which the owner described as "perfect other than the hook": seventeen
// seconds, four destinations, one clip each held about four seconds. The first frames
// carry a counted line and nothing else; once it clears, each shot carries the place's
// name and country in small type. No boxes, no panel, no outline - a shadow and that is
// all.
//
// THREE THINGS THIS GOT WRONG BEFORE, all reported together:
//
//   IT WAS NOT A CLIP. The first version was a slow zoom on a still photograph, on the
//   reasoning that a geotagged Commons file is provably of the place while stock video
//   is not. The reasoning was sound and the result was a slideshow: "not a zoomed in
//   picture, but a clip instead". Footage moves, and the movement is most of why the
//   reference holds a viewer for seventeen seconds.
//
//   THE TYPE WAS SET IN A SERIF. Frank Ruhl is the right face for the camera-roll
//   cover, which is a title over a photograph. This is a caption burned into a video,
//   and the app's own captions are a grotesque - "font is not the same font we use on
//   tiktok". Assistant, like every other burned line in this project.
//
//   THE HOOK AND THE FIRST LABEL SHARED A FRAME. They stacked, which is two messages
//   in the half second a viewer decides on. "first hook, then the places."
//
// HOW IT NAMES A PLACE HONESTLY NOW. Not by trusting the search. The clip is judged by
// the same vision call the `cuts` shape has always used, and the label printed is the
// judge's own answer - `clipPlaceLabel` - which is dropped entirely unless the judge was
// confident. So the reel does not claim "this is Santorini because we searched for
// Santorini"; it says what somebody looking at the frame was sure of, and a clip nobody
// could place does not get into the reel at all.

/** How long each place is held, and how long the hook's own shot runs. */
const HOLD_SECONDS = 4;
const HOOK_SECONDS = 3;

/**
 * One postcard reel from already-judged clips.
 *
 * `shots` is [{ src, duration, labelHe }] - the file, its length, and the line to burn
 * on it. `hookHe` opens the reel alone.
 */
export async function buildPostcardClip(shots, { hookHe, hookClip = null, id = 'postcard', outDir = clipOutputDir(), track = null } = {}) {
  const places = (shots || []).filter((s) => s?.src && s?.labelHe).slice(0, 6);
  if (places.length < 3) throw new Error(`a postcard reel needs three placed clips (got ${places.length})`);

  // THE HOOK GETS ITS OWN SHOT.
  //
  // It used to ride the first place's clip - hook for the opening 2.6 seconds, then that
  // place's name for the rest - so the first destination was on screen while the reel was
  // still introducing itself, and it got less of its own time than the other three. The
  // owner: "hook should be a different clip than the first one."
  //
  // The hook clip carries NO LABEL, which is why it can be a clip the vision judge could
  // not place: a shot that makes no claim about where it is needs no evidence for one.
  // That also means the reel spends its placed clips on places rather than on its title.
  const picked = hookClip?.src ? [{ ...hookClip, labelHe: null, hook: true }, ...places] : places;

  const cfg = postConfig().clips.video;
  const { width: w, height: h, fps, crf, preset } = cfg;
  const file = path.join(outDir, `clip-${id}.mp4`);

  const files = [];
  const pngs = [];

  try {
    // The footage, and where in each clip to start. pickWindow finds the part of a stock
    // clip worth showing, which is rarely the first four seconds - those are usually the
    // camera settling.
    // The hook holds for less than a place does. It carries one line and the viewer has
    // read it; a place is the thing they are actually being shown.
    const holdOf = (shot) => (shot.hook ? HOOK_SECONDS : HOLD_SECONDS);

    const starts = [];
    for (const [i, shot] of picked.entries()) {
      const local = path.join(outDir, `clip-${id}-src-${i}.mp4`);
      await download(shot.src, local);
      files.push(local);
      starts.push(await pickWindow(local, shot.duration).catch(() => cfg.startAt || 0));
    }

    // Where each shot begins on the timeline, which is no longer i * HOLD now that the
    // shots are different lengths.
    const at = [];
    let clock = 0;
    for (const shot of picked) {
      at.push(clock);
      clock += holdOf(shot);
    }

    // THE TYPE, MEASURED AGAINST THE FRAME IT LANDS ON. measureClip samples the actual
    // window being used, so a label over a bright sky gets more help than one over a
    // forest - the same bargain every slide in this project makes.
    const spots = [];
    for (const [i, local] of files.entries()) {
      spots.push(await measureClip(local, { startAt: starts[i], seconds: holdOf(picked[i]) }).catch(() => null));
    }

    for (const [i, shot] of picked.entries()) {
      const png = path.join(outDir, `clip-${id}-txt-${i}.png`);
      const text = shot.hook ? hookHe : shot.labelHe;
      await renderPostcardPng({ text, hook: Boolean(shot.hook), width: w, height: h, file: png, spot: spots[i] });
      // Each line is on screen for exactly its own shot. The hook clears when its clip
      // does, so nothing overlaps and no place shares a frame with the title.
      pngs.push({ file: png, from: at[i], to: at[i] + holdOf(shot) });
    }

    const chosen = track ? { file: track } : pickTrack(new Set());
    const bed = chosen?.file || null;
    const seconds = clock;

    const args = ['-y', '-hide_banner', '-loglevel', 'error'];
    for (const [i, local] of files.entries()) {
      args.push('-ss', String(starts[i]), '-t', String(holdOf(picked[i])), '-i', local);
    }
    for (const p of pngs) args.push('-i', p.file);
    if (bed) args.push('-i', bed);

    const n = files.length;
    const steps = [];
    for (let i = 0; i < n; i++) {
      // Fill the 9:16 frame from whatever the stock clip happens to be, exactly as
      // burnCuts does: cover, then centre-crop. A pillarboxed shot is the loudest
      // "this was not filmed for here" signal there is.
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

    args.push('-filter_complex', steps.join(';'), '-map', '[vout]');
    if (bed) args.push('-map', `${n + pngs.length}:a`, '-shortest', '-c:a', 'aac', '-b:a', '128k');
    args.push('-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-pix_fmt', 'yuv420p', '-r', String(fps), '-t', String(seconds), file);

    await run(ffmpegPath(), args);
    return { file, seconds, shots: places.length, audio: Boolean(bed) };
  } finally {
    for (const p of pngs) rmSync(p.file, { force: true });
    for (const f of files) rmSync(f, { force: true });
  }
}

/**
 * One burned line, as a transparent PNG.
 *
 * NO BOX, NO BACKDROP BLUR, AND NO SHADOW SHAPED LIKE EITHER. The first version drew a
 * soft radial behind the words to lift them off the footage; at the sizes involved it
 * read as a grey smudge following the text around - "text has a strange shadow
 * underneath it, which seems to be added unprofessionaly". It is exactly right: a scrim
 * sized to a text block is a box with soft edges, and a box is what every reference this
 * account is modelled on does without.
 *
 * What replaces it is what the references actually use: a tight drop shadow on the
 * letterforms themselves, and - only when the footage genuinely cannot carry white type
 * - a gradient running off the TOP of the frame. A gradient to a frame edge has no shape
 * to notice, which is the whole reason the slides use one too.
 */
export async function renderPostcardPng({ text, hook = false, width, height, file, spot = null }) {
  const browser = await getBrowser();
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, locale: 'he-IL' });
  const page = await context.newPage();
  try {
    await page.setContent(postcardOverlayHtml({ text, hook, width, height, spot }), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    writeFileSync(file, await page.screenshot({ type: 'png', omitBackground: true }));
    return file;
  } finally {
    await context.close().catch(() => {});
  }
}

export function postcardOverlayHtml({ text, hook = false, width, height, spot = null }) {
  // The hook is the one line that has to stop a thumb, so it is set larger. The labels
  // are captions and stay small, which is what keeps the footage the subject.
  const px = Math.round(width * (hook ? 0.058 : 0.042));

  // How much the footage needs. `spot.contrast` is the ink against the block measured on
  // the real frames, and the threshold is deliberately generous: on MOVING pictures the
  // background under a word changes every frame, so a line that measures comfortably on
  // the sampled frames can still flicker in and out of legibility across four seconds.
  // A still only has to survive one background; this has to survive 120.
  //
  // An unmeasured clip gets the help too, for the same reason an unmeasured slide does -
  // not knowing is the risky case, not the safe one.
  const contrast = Number(spot?.contrast);
  const a = !Number.isFinite(contrast)
    ? 0.26
    : contrast < 6 ? Math.min(0.5, (6 - contrast) / 7 + 0.16) : 0;

  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>
@font-face { font-family: 'Assistant'; src: url(${assistantDataUri()}) format('truetype'); font-weight: 200 800; font-display: block; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: ${width}px; height: ${height}px; background: transparent; overflow: hidden; }
body { position: relative; -webkit-font-smoothing: antialiased; }
/* Only when the footage cannot carry the type, and anchored to the frame edge so there
   is no shape to see. Never a panel behind the words. */
${a ? `.lift { position:absolute; inset-inline:0; top:0; height:${Math.round(height * 0.46)}px;
        background:linear-gradient(180deg, rgba(6,8,12,${a.toFixed(2)}) 0%, rgba(6,8,12,${(a * 0.5).toFixed(2)}) 48%, rgba(6,8,12,0) 100%); }` : ''}
/* Upper third, centred, exactly where the reference puts it - clear of the search bar
   at the top and of the caption and button rail at the bottom. */
.line { position:absolute; top:${Math.round(height * 0.2)}px; inset-inline:${Math.round(width * 0.1)}px;
        font-family:'Assistant', sans-serif; font-weight:${hook ? 800 : 700}; font-size:${px}px;
        line-height:1.26; color:#fff; text-align:center; text-wrap:balance;
        /* A tight shadow for the edge of each letter and one wider pass to lift the
           block off a busy frame. Two passes, both soft: a hard offset reads as a
           1990s word processor and a blur this size reads as depth. */
        text-shadow: 0 2px 6px rgba(0,0,0,.55), 0 0 ${Math.round(px * 0.7)}px rgba(0,0,0,.4); }
</style></head><body>
${a ? '<div class="lift"></div>' : ''}
<div class="line">${escapeHtml(text)}</div>
</body></html>`;
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
 * One postcard reel, as an approvable candidate.
 *
 * THE PLACES ARE WHAT THE JUDGE COULD NAME, not what we went looking for. findClips
 * searches the configured destination queries and puts every candidate past the vision
 * call the `cuts` shape has always used; `clipPlaceLabel` prints the judge's answer and
 * returns null unless it was confident. A clip nobody could place is simply not in the
 * reel.
 *
 * ONE SHOT PER PLACE. Four angles on one city is four shots of the same city, which is
 * what the Prague version was and why it "will not get numbers".
 */
export async function buildPostcardCandidate({ outDir = clipOutputDir(), shots = 4, seen = new Set() } = {}) {
  // findClips returns a report, not an array: { clips, vetoed, nowhere, ... }. The
  // vetoed and nowhere lists are what make a failure explainable, so they are carried
  // into the error below rather than thrown away.
  const found = await findClips({ limit: 24, seen, judge: true });
  const placed = [];
  const places = new Set();

  const spare = [];
  for (const c of found.clips || []) {
    const labelHe = clipPlaceLabel({ vision: c.vision });
    const key = String(c.vision?.place || '').toLowerCase();

    // THE SPARES ARE THE CLIPS THAT COULD NOT BE PLACED, and they are useful rather than
    // waste. The hook's shot carries no place name, so it needs no evidence for one -
    // which makes a beautiful clip nobody could identify exactly right for it, and keeps
    // every placed clip for an actual place.
    if (!labelHe || !key) {
      spare.push(c);
      continue;
    }
    if (places.has(key)) {
      spare.push(c);
      continue;
    }
    if (placed.length >= shots) {
      spare.push(c);
      continue;
    }
    places.add(key);
    // The judge's verdict and its rank travel with the shot, because the retention
    // timeline this format now shares orders on both: `beauty` reads the destination
    // score and `strongestFirst` reads the rank. Without them a postcard reel gets no
    // ordering and only the open loops that can be measured off the label.
    placed.push({
      src: c.src,
      duration: c.duration,
      labelHe,
      id: c.id,
      credit: c.credit,
      page: c.page,
      rank: c.rank ?? null,
      vision: c.vision || null,
    });
  }

  if (placed.length < 3) {
    throw new Error(
      `only ${placed.length} clip(s) of ${(found.clips || []).length} could be placed confidently, and a postcard reel needs 3` +
        (found.nowhere?.length ? ` - ${found.nowhere.slice(0, 3).join('; ')}` : '')
    );
  }

  const n = placed.length;
  // Counted, and naming no destination - the reel is several of them. See the note on
  // the hook in the previous version: filling a {dest} slot from the first clip produced
  // a line that was false about three quarters of its own content.
  const COUNTED = [
    `${n} יעדים ששווים את הטיסה`,
    `${n} יעדים לרשימה של השנה הבאה`,
    `${n} יעדים שאנשים לא חושבים עליהם מספיק`,
  ];
  const hookHe = COUNTED[Math.abs(placed.reduce((a, p) => a + p.id.charCodeAt(0), 0)) % COUNTED.length];

  // findClips returns best-first, so the first spare is the best-looking clip that is
  // not carrying a place. If every clip was placed, the hook borrows the LAST of them
  // rather than going without - a reel whose title shares a frame with its first
  // destination is the thing this exists to stop.
  const hookClip = spare[0] || placed[placed.length - 1] || null;

  const id = `pc${Math.abs(placed.reduce((a, p) => (a * 31 + Number(p.id)) | 0, 7)).toString(16).slice(0, 10)}`;

  // THE SAME RETENTION TIMELINE THE GEMS REEL USES, AND IT IS THIS FORMAT'S PROBLEM
  // TOO. The post the analytics describe - 559 views, 3.1 seconds of watch time, 0
  // comments - opened on `3 יעדים שאנשים לא חושבים עליהם מספיק`, which is the third
  // line of the COUNTED pool above. HOOK_SECONDS here is 3, the same place the average
  // view ended. Leaving this format on the old timeline would mean fixing the reel
  // that is 50% of the rotation and leaving the one that is 15% doing the thing the
  // numbers were measured on.
  //
  // DELEGATED RATHER THAN DUPLICATED. The two formats now differ in exactly one way,
  // which is where the line comes from: this one draws from a pool of three counted
  // sentences, the other generates and scores ten. So the line is handed to
  // planGemsReel and everything after it - the open loop, the ordering, the counter,
  // the question, the timeline and the quality gate - is the same code. A second copy
  // would be a second place for the timing to drift, which is the argument the gems
  // module already makes about the renderer.
  const gems = postConfig().gems;
  let built;
  let plan = null;
  let openLoop = null;
  let questionHe = null;
  // Named `ordered` and not `shots`, because this function already has a parameter
  // called `shots` and it means how MANY to use rather than which.
  let ordered = placed;

  if (gems.retention.on) {
    const planned = await planGemsReel(placed, { gems, hookText: hookHe, rand: Math.random });
    if (planned.error) throw new Error(planned.error);
    if (!planned.check.ok) {
      // No retry here, unlike the gems reel: the hook is a fixed pool line rather than
      // a generated one, so a second attempt would redraw the same sentence and fail
      // the same way. The reasons are reported and the format falls back to its own
      // timeline, which is the behaviour it had yesterday and is not a regression.
      console.log(`postcard: retention plan refused - ${planned.check.problems.join('; ')}`);
      built = await buildPostcardClip(placed, { hookHe, hookClip, id, outDir });
    } else {
      ({ plan, openLoop, questionHe } = planned);
      ordered = planned.shots;
      built = await buildHiddenGemsClip(ordered, {
        hookHe,
        openLoopHe: openLoop?.he || null,
        questionHe,
        plan,
        hookClip,
        id,
        outDir,
        cfg: gems,
      });
    }
  } else {
    built = await buildPostcardClip(placed, { hookHe, hookClip, id, outDir });
  }

  return {
    kind: 'clip',
    id,
    hook: [hookHe, openLoop?.he].filter(Boolean).join(' · '),
    hookLine: hookHe,
    headline: [hookHe, openLoop?.he].filter(Boolean).join(' · '),
    hookWritten: false,
    hookNote: 'postcard: counted, and the places are what the vision judge could name',
    sourceName: `Pexels · ${[...new Set(placed.map((p) => p.credit).filter(Boolean))].join(', ') || 'unknown'}`,
    sourceUrl: placed[0].page,
    pillar: 'day',
    tags: [],
    createdAt: new Date().toISOString(),
    publishTargets: targetsForKind('clip'),
    tiktokDraft: true,
    overrides: [],
    notes: [],
    place: ordered.map((p) => p.labelHe).join(' · '),
    clip: {
      shape: 'postcard',
      file: built.file,
      audio: built.audio,
      seconds: built.seconds,
      follow: captionFollow(),
      followAt: null,
      width: postConfig().clips.video.width,
      height: postConfig().clips.video.height,
      postcardPlaces: ordered.map((p) => p.labelHe),
      // The same retention fields the gems reel records, under the same names, so the
      // report can compare the two formats on the numbers that matter rather than on
      // whichever fields each one happened to invent.
      places: ordered.map((p) => p.labelHe),
      openLoop: openLoop?.he || null,
      openLoopId: openLoop?.id || null,
      orderBy: openLoop?.orderBy || null,
      questionHe,
      counter: built.counter ?? null,
      firstCutAt: built.firstCutAt ?? null,
      hookFullUntil: built.hookFullUntil ?? null,
      holds: built.holds ?? null,
      looped: built.looped ?? null,
      loopDistance: built.loopDistance ?? null,
      // The hook's clip is spent like any other, or it comes back tomorrow as somebody
      // else's shot.
      pexelsIds: [...new Set([...ordered.map((p) => p.id), hookClip?.id].filter(Boolean).map(String))],
    },
  };
}

/** The approval card for a postcard reel. */
export function postcardApprovalMessage(cand) {
  const c = cand.clip;
  const lines = [
    `🖼️ גלויות · ${c.seconds} שניות · ${c.postcardPlaces.length} יעדים${c.looped ? ` · לופ ${c.looped}` : ''}`,
    '',
    c.hookLine || cand.hook,
  ];
  if (c.openLoop) lines.push(`   ↳ ${c.openLoop}`);
  lines.push(
    '',
    c.postcardPlaces
      .map((n, i) => `${c.counter ? `${i + 1}/${c.postcardPlaces.length}` : `${i + 1}.`} ${n}${i === c.postcardPlaces.length - 1 && c.openLoop ? '  ← הבטחה' : ''}`)
      .join('\n')
  );
  // The same retention line the gems card prints, because the owner is comparing the
  // two formats and a card that showed the numbers for one of them would make the
  // comparison harder rather than easier.
  if (c.firstCutAt != null) {
    lines.push('', `⏱️ חיתוך ראשון ${c.firstCutAt}ש׳ · פתיח גדול עד ${c.hookFullUntil}ש׳ ואז כותרת`);
  }
  if (c.questionHe) lines.push(`💬 בסוף ובכיתוב: ${c.questionHe}`);
  return lines.join('\n');
}
