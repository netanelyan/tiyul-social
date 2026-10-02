import { spawn } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ffmpegPath, clipOutputDir, download } from './overlay.js';
import { getBrowser } from '../render/index.js';
import { frankRuhlDataUri, escapeHtml } from '../render/theme.js';
import { postConfig } from '../postConfig.js';
import { pickTrack } from './tracks.js';
import { planLegibility } from '../render/legibility.js';
import { hookShape, fill, assertNoExperience, assertNoFiller } from '../posts/voice.js';
import { captionFollow } from '../hashtags.js';
import { targetsForKind } from '../publish/targets.js';

// THE FOURTH CLIP SHAPE: a counted postcard reel.
//
// THE REFERENCE, supplied by the owner as a video that "went well": seventeen seconds,
// four destinations, one gorgeous shot each held for about four seconds with a slow
// drift on it. The first frame carries a counted hook - "4 יעדים שנראים כמו ציור" - and
// each shot after it carries the place's name and country in small warm-cream type,
// placed off-centre on a quiet part of the frame. No boxes, no outline, no music video
// cutting. The type is a caption on a photograph, not a title over it.
//
// WHY THIS SHAPE IS BUILT FROM STILLS AND THE OTHER THREE ARE BUILT FROM VIDEO.
//
// This is the whole design decision and it is an honesty decision, not an aesthetic
// one. The existing three shapes take Pexels stock video, and the comment at the top of
// the `clips` block in post-config.json explains at length why their lines never name a
// location: a stock clip's only evidence of where it was shot is an uploader's title,
// so "מפלים באיסלנד" over a generic waterfall is a place claim with nothing behind it.
// The format sidesteps the problem by never making the claim.
//
// This shape MAKES THE CLAIM. "לאוטרברונן, שווייץ" on the screen is the format - take
// the names off and it is four pretty pictures with no reason to exist. So it cannot be
// built from stock video, and it is built instead from the same Wikimedia Commons
// photographs the five post types use, which are attached to a specific place on our
// own destination pages and carry a credit and a licence. The place claim is then as
// well-sourced as the one on a slide.
//
// WHAT IS LOST, AND WHY IT IS ALMOST NOTHING. A still is not footage. At seventeen
// seconds, in a 9:16 frame, with a slow push across it, the difference between a drone
// shot drifting over a valley and a 4000px photograph of the same valley being panned
// is much smaller than it sounds - this is the Ken Burns effect and it has carried
// documentaries for fifty years. What is genuinely lost is motion IN the scene: water
// does not move. For a format whose subject is "places that look like a painting", a
// still is arguably the honest medium.

/** How long each destination is held, and how far the push travels. */
const HOLD_SECONDS = 4;
const PUSH = 1.12; // the zoom at the end of a shot; 1.0 would be a static image.

/**
 * One counted-postcard clip.
 *
 * `places` is [{ nameHe, countryHe, image: { src } }] - already photographed, already
 * sourced, in the order they should appear. `hookHe` is the counted line over the first
 * shot.
 */
export async function buildPostcardClip(places, { hookHe, id = 'postcard', outDir = clipOutputDir(), track = null } = {}) {
  const shots = (places || []).filter((p) => p?.image?.src && p?.nameHe).slice(0, 6);
  if (shots.length < 3) throw new Error(`a postcard clip needs three photographed places (got ${shots.length})`);

  const cfg = postConfig().clips.video;
  const { width: w, height: h, fps, crf, preset } = cfg;
  const file = path.join(outDir, `clip-${id}.mp4`);

  // THE TYPE, RENDERED IN CHROMIUM AND OVERLAID AS A PNG.
  //
  // Not drawn by ffmpeg. src/video/overlay.js refuses to let ffmpeg draw Hebrew and the
  // reason is in that file: drawtext has no bidi support, so it lays Hebrew out left to
  // right and the line comes out reversed. Every other shape here renders its text in
  // the browser that already renders every slide, and so does this one.
  // THE SAME CONTRAST GATE THE SLIDES USE, because a clip frame is a slide that moves.
  //
  // The type here is deliberately small, thin and un-outlined - that restraint is the
  // format - and restraint over a sunlit square full of pale stone is illegible. So the
  // block's own corner of each photograph is measured and the result decides how much
  // help it gets: nothing over a dark frame, a soft scrim behind the words over a bright
  // one. See src/render/legibility.js; this is the same escalation the label look gets,
  // tuned softer because a hard panel would undo the look.
  const plans = await planLegibility(
    shots.map((shot) => ({ src: shot.image.src, box: BLOCK_BOX, lines: 3, floor: 0 }))
  ).catch(() => shots.map(() => null));

  const pngs = [];
  for (const [i, shot] of shots.entries()) {
    const png = path.join(outDir, `clip-${id}-label-${i}.png`);
    // The hook rides the FIRST shot rather than a title card of its own. A title card
    // is a slide, and a slide at the top of a video is where a viewer leaves; the
    // reference puts its hook over the opening shot and lets the picture do the
    // stopping.
    await renderPostcardPng({
      hookHe: i === 0 ? hookHe : null,
      labelHe: label(shot),
      width: w,
      height: h,
      file: png,
      plan: plans[i] || null,
    });
    pngs.push(png);
  }

  // pickTrack takes the set of track NAMES already used, not an id. Passing the clip
  // id made every clip draw from the full pool as though nothing had been used, which
  // is not wrong so much as it is not the rotation the function exists to provide.
  const chosen = track ? { file: track } : pickTrack(new Set());
  const bed = chosen?.file || null;
  const seconds = shots.length * HOLD_SECONDS;

  // THE PHOTOGRAPHS, ON DISK.
  //
  // `image.src` is whatever the photo ladder produced, and for a Commons photograph
  // that is a DATA URI - the renderer wants one, because an <img> with the bytes inline
  // cannot fail to load halfway through a screenshot. ffmpeg wants a path, and handing
  // it a 400KB base64 string as an input filename fails with ENAMETOOLONG, which is a
  // confusing way to be told the obvious.
  //
  // So anything that is not already a local path is materialised first, and cleaned up
  // in the `finally` below whether or not the render worked.
  const files = [];
  for (const [i, shot] of shots.entries()) {
    files.push(await materialise(shot.image.src, path.join(outDir, `clip-${id}-shot-${i}.jpg`)));
  }

  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  // Each photograph as a looping single-frame input, held for its own span.
  for (const f of files) args.push('-loop', '1', '-t', String(HOLD_SECONDS), '-i', f);
  for (const png of pngs) args.push('-i', png);
  if (bed) args.push('-i', bed);

  const n = shots.length;
  const steps = [];
  for (let i = 0; i < n; i++) {
    // SCALE FIRST, THEN PUSH. zoompan operates on its input resolution, so zooming a
    // 4000px photograph and then scaling produces a different result on every image
    // depending on how big the original happened to be. Scaling to a fixed oversize
    // frame first makes the motion identical for every shot, which is what makes the
    // sequence read as one piece rather than as four clips.
    //
    // The push alternates direction by index. Four shots all drifting the same way is a
    // tic a viewer notices by the third one.
    const zoomIn = i % 2 === 0;
    const z = zoomIn
      ? `1+(${(PUSH - 1).toFixed(3)}*on/${HOLD_SECONDS * fps})`
      : `${PUSH.toFixed(3)}-(${(PUSH - 1).toFixed(3)}*on/${HOLD_SECONDS * fps})`;
    steps.push(
      `[${i}:v]scale=${Math.round(w * 1.4)}:${Math.round(h * 1.4)}:force_original_aspect_ratio=increase,` +
        `crop=${Math.round(w * 1.3)}:${Math.round(h * 1.3)},` +
        `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${HOLD_SECONDS * fps}:s=${w}x${h}:fps=${fps},` +
        `setsar=1[v${i}]`
    );
    // The label over it. The hook's PNG is held for the whole of the first shot, which
    // is the one place the type is allowed to be the subject.
    steps.push(`[v${i}][${n + i}:v]overlay=0:0:format=auto[l${i}]`);
  }

  // Concatenated rather than crossfaded. The reference cuts hard between destinations,
  // and a crossfade between two still photographs reads as a screensaver.
  steps.push(`${Array.from({ length: n }, (_, i) => `[l${i}]`).join('')}concat=n=${n}:v=1:a=0[vout]`);

  args.push('-filter_complex', steps.join(';'), '-map', '[vout]');
  if (bed) args.push('-map', `${2 * n}:a`, '-shortest', '-c:a', 'aac', '-b:a', '128k');
  args.push(
    '-c:v', 'libx264',
    '-preset', preset,
    '-crf', String(crf),
    '-pix_fmt', 'yuv420p',
    '-r', String(fps),
    '-t', String(seconds),
    file
  );

  try {
    await run(ffmpegPath(), args);
  } finally {
    for (const png of pngs) rmSync(png, { force: true });
    for (const f of files) rmSync(f, { force: true });
  }

  return { file, seconds, shots: shots.length, audio: Boolean(bed) };
}

/**
 * A photograph as a file ffmpeg can open.
 *
 * Three cases, because the photo ladder produces all three: a data URI (Commons, the
 * common case), an http URL (stock), and an existing path (a re-render).
 */
async function materialise(src, dest) {
  const s = String(src || '');
  if (s.startsWith('data:')) {
    const comma = s.indexOf(',');
    writeFileSync(dest, Buffer.from(s.slice(comma + 1), 'base64'));
    return dest;
  }
  if (/^https?:/i.test(s)) {
    await download(s, dest);
    return dest;
  }
  return s;
}


/**
 * The type for one postcard shot, as a transparent PNG the size of the frame.
 *
 * ITS OWN RENDERER RATHER THAN renderOverlayPng, and the reason is that the two formats
 * want opposite things. The clip overlay exists for the other three shapes: ONE line, a
 * mundane Israeli moment, set large and centred because the line IS the post and the
 * footage is wallpaper behind it. Reusing it here put a counted hook and a place name
 * into one centred block in a face sized for neither, and the result was a cramped
 * paragraph in the middle of a photograph of Prague.
 *
 * This format is the inverse: the PHOTOGRAPH is the post and the type is a caption on
 * it. So, following the reference the owner supplied:
 *
 *   SMALL. Around 4% of the frame width, which is roughly half what the other shapes
 *   set. Type this size cannot compete with the picture and is not trying to.
 *
 *   WARM CREAM, NOT WHITE, and no outline. A stroke is what a subtitle burner produces.
 *   The reference uses a pale warm tint with a soft shadow, which separates the type
 *   from the picture without drawing a line around every letter.
 *
 *   IN THE UPPER THIRD, flush to one side rather than centred. Centred type over a
 *   landscape reads as a title card; offset reads as a caption somebody placed.
 *
 *   THE SAME SERIF THE CAMERA-ROLL COVER USES. Frank Ruhl Libre - see the note above
 *   frankRuhlDataUri in render/theme.js. The two formats are the same editorial voice
 *   and they should not be set in two faces.
 */
export async function renderPostcardPng({ hookHe, labelHe, width, height, file, plan = null }) {
  const browser = await getBrowser();
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, locale: 'he-IL' });
  const page = await context.newPage();
  try {
    await page.setContent(postcardOverlayHtml({ hookHe, labelHe, width, height, plan }), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const buf = await page.screenshot({ type: 'png', omitBackground: true });
    writeFileSync(file, buf);
    return file;
  } finally {
    await context.close().catch(() => {});
  }
}

// Where the block sits, as [x0, y0, x1, y1] fractions - the same contract TEXT_BOXES
// uses, and the numbers below have to agree with the CSS that follows.
const BLOCK_BOX = [0.18, 0.15, 0.94, 0.34];

export function postcardOverlayHtml({ hookHe = null, labelHe = '', width, height, plan = null }) {
  const hookPx = Math.round(width * 0.052);
  const labelPx = Math.round(width * 0.038);
  // Half of what the gate asked for, floored at nothing and capped well below a panel.
  // See the note on `.block::before` below.
  const needed = Number(plan?.alpha);
  const scrim = Number.isFinite(needed) && plan?.measured ? Math.min(0.5, Math.max(0, needed * 0.5)) : 0;
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>
@font-face { font-family: 'FrankRuhl'; src: url(${frankRuhlDataUri()}) format('truetype'); font-weight: 300 900; font-display: block; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: ${width}px; height: ${height}px; background: transparent; overflow: hidden; }
body { position: relative; font-family: 'FrankRuhl', serif; -webkit-font-smoothing: antialiased; }
/* Upper third, flush to the trailing edge. In an RTL page that is the physical LEFT,
   which is where the reference puts it - and getting this backwards would pin the words
   against the edge the script starts from, which reads as an overflow rather than as a
   placement. */
.block { position: absolute; top: ${Math.round(height * 0.17)}px;
         inset-inline-end: ${Math.round(width * 0.08)}px;
         max-width: ${Math.round(width * 0.74)}px; text-align: end; }
/* THE SCRIM, MEASURED. A soft radial behind the words and nothing else - no panel, no
   rectangle, no visible edge. The alpha is what the gate says this photograph needs,
   halved and capped, because the type also carries two shadows of its own and a scrim
   sized as though it were the only defence would be a grey cloud over the picture. A
   dark frame gets zero and the words simply sit on it, which is the look. */
${scrim ? `.block::before { content: ''; position: absolute; inset: ${-Math.round(height * 0.03)}px ${-Math.round(width * 0.07)}px;
          background: radial-gradient(ellipse at center, rgba(0,0,0,${scrim}) 0%, rgba(0,0,0,${(scrim * 0.5).toFixed(2)}) 52%, rgba(0,0,0,0) 100%);
          z-index: -1; }` : ''}
/* A soft shadow rather than a stroke, and two of them: a tight dark one for the edge of
   each letter and a wide diffuse one to lift the whole block off a busy photograph. One
   alone is not enough over foliage, which is most of what these pictures are. */
.hook { font-size: ${hookPx}px; font-weight: 500; line-height: 1.24; color: #FBEFE4;
        letter-spacing: -0.01em; text-wrap: balance;
        text-shadow: 0 2px 10px rgba(0,0,0,.55), 0 0 ${Math.round(hookPx * 0.9)}px rgba(0,0,0,.4); }
.label { font-size: ${labelPx}px; font-weight: 400; line-height: 1.3; color: #FBEFE4;
         margin-top: ${hookHe ? Math.round(labelPx * 0.7) : 0}px; opacity: .96;
         text-shadow: 0 2px 10px rgba(0,0,0,.55), 0 0 ${Math.round(labelPx * 0.9)}px rgba(0,0,0,.4); }
</style></head><body>
<div class="block">
  ${hookHe ? `<div class="hook">${escapeHtml(hookHe)}</div>` : ''}
  ${labelHe ? `<div class="label">${escapeHtml(labelHe)}</div>` : ''}
</div>
</body></html>`;
}

/** "לאוטרברונן, שווייץ" - the reference's own label shape. */
const label = (shot) => [shot.nameHe, shot.countryHe].filter(Boolean).join(', ');

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => {
      err += d.toString();
    });
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-600)}`))
    );
  });
}

/**
 * One postcard clip, as an approvable candidate.
 *
 * `dest` is a destinations.json row. Everything else comes off that destination's own
 * page: the places, their photographs, their credits.
 *
 * WHY THIS IS ITS OWN KIND RATHER THAN A FOURTH ENTRY IN nextShapes.
 *
 * The three existing shapes are all the same function of the same input - a pool of
 * Pexels results and a written line - and `buildClips` is built around spending that
 * pool. This shape's input is a DESTINATION PAGE. It shares the output format and
 * nothing else: no stock query, no vision call, no footage ledger, and a completely
 * different honesty contract (it names places, which the others may not). Threading a
 * destination through a function whose whole shape is "here is a pool of stock clips,
 * spend it" would make both harder to read for no gain.
 */
export async function buildPostcardCandidate(dest, { outDir = clipOutputDir(), shots = 4 } = {}) {
  const { loadCity, listPlaces, daysOf } = await import('../posts/source.js');
  const { fillPostPhotos } = await import('../posts/photos.js');

  const slug = dest?.siteSlug || dest?.id;
  const city = await loadCity(slug);
  if (!city) throw new Error(`no page for ${dest?.he || slug} - a postcard clip is built from one`);

  // A couple of spares, because a place whose photograph cannot be found is a shot this
  // format does not have - there is no text-only version of a postcard.
  const want = listPlaces(city, { want: shots + 4, needPhoto: false }).slice(0, shots + 4);
  const got = await fillPostPhotos(want, { dest: dest?.en || city.name });
  const picked = want.filter((p) => p.image?.src).slice(0, shots);
  if (picked.length < 3) {
    throw new Error(`only ${picked.length} places in ${city.name} have a photograph, and a postcard clip needs 3`);
  }

  const countryHe = dest?.country || city.countryHe || null;

  // THE HOOK, AND THE SLOTS IT IS ALLOWED TO ASK FOR.
  //
  // The shared pool includes day-counted shapes ("ככה נראים {days} ימים ב{dest}"), and
  // a destination whose page has no itinerary cannot fill `{days}`. Filling it with an
  // empty string produces "ככה נראים ימים בניו יורק" - a sentence with a hole in it,
  // which is what the first version shipped. So a shape is only eligible if every slot
  // it names can be filled, and the draw is retried until one is.
  const span = daysOf(city)?.days?.length || null;
  const vars = { dest: dest?.he || city.name, n: picked.length, ...(span ? { days: span } : {}) };
  const fillable = (shape) => ![...String(shape.he).matchAll(/\{(\w+)\}/g)].some((m) => vars[m[1]] == null);

  let shape = null;
  for (let tries = 0; tries < 12 && !shape; tries++) {
    const candidate = hookShape('roll');
    if (fillable(candidate)) shape = candidate;
  }
  if (!shape) throw new Error(`no hook shape for ${city.name} can be filled from this page (days: ${span ?? 'none'})`);

  const hookHe = fill(shape.he, vars).replace(/\s+/g, ' ').trim();
  assertNoExperience(hookHe, 'postcard hook');
  assertNoFiller(hookHe, 'postcard hook');

  const id = `pc${Math.abs([...`${slug}${picked.length}`].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7)).toString(16).slice(0, 10)}`;

  const built = await buildPostcardClip(
    picked.map((p) => ({ nameHe: p.name, countryHe, image: p.image })),
    { hookHe, id, outDir }
  );

  const follow = captionFollow();
  return {
    kind: 'clip',
    id,
    hook: hookHe,
    headline: hookHe,
    hookWritten: false,
    hookNote: 'postcard: the hook is a counted format filled with the page\'s own place count',
    // WHAT PROVENANCE MEANS FOR THIS SHAPE. Not a stock library and an uploader - the
    // photographs are the ones our own destination page carries, each with its Commons
    // credit, which is the same provenance a slide has.
    sourceName: `tiyulplus.com · ${city.name}`,
    sourceUrl: city.url || null,
    pillar: 'day',
    tags: [],
    createdAt: new Date().toISOString(),
    publishTargets: targetsForKind('clip'),
    tiktokDraft: true,
    overrides: [],
    notes: [],
    place: city.name,
    siteSlug: slug,
    clip: {
      shape: 'postcard',
      file: built.file,
      audio: built.audio,
      seconds: built.seconds,
      follow,
      followAt: null,
      width: postConfig().clips.video.width,
      height: postConfig().clips.video.height,
      postcardPlaces: picked.map((p) => p.name),
      photos: got,
    },
  };
}

/** The approval card for a postcard clip. */
export function postcardApprovalMessage(cand) {
  const c = cand.clip;
  const lines = [
    `🖼️ גלויות · ${cand.place} · ${c.seconds} שניות · ${c.postcardPlaces.length} מקומות`,
    '',
    cand.hook,
    '',
    c.postcardPlaces.map((n, i) => `${i + 1}. ${n}`).join('\n'),
  ];
  return lines.join('\n');
}
