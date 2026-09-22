import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getBrowser } from '../render/index.js';
import { analyseSlides } from '../render/photo.js';
import { postConfig } from '../postConfig.js';
import { heeboDataUri, assistantDataUri, arimoDataUri, tiktokSansDataUri, escapeHtml } from '../render/theme.js';

const run = promisify(execFile);

// A stock clip becomes a post: trimmed, cropped to 9:16, with one Hebrew line
// burned into it.
//
// THE TEXT IS NOT DRAWN BY FFMPEG, and that is the single most important
// decision in this file. ffmpeg's drawtext has no bidi support: given Hebrew it
// emits the characters in logical order, so every line comes out reversed, and
// it cannot shape or wrap them either. There is no flag for this.
//
// So the line is rendered in Chromium — which does bidi, shaping and wrapping
// correctly and is already running for every card and slide this project
// makes — screenshotted with a transparent background, and composited by ffmpeg
// as an image. That also means the clip overlay inherits the same typography
// vocabulary as the slides: one percentage, a weight, an opacity, a shadow.

/**
 * Where ffmpeg is.
 *
 * PATH first, because that is where it belongs and where a Linux box will have
 * it. The WinGet locations are a fallback for the case this was installed on:
 * WinGet edits the USER path, which existing shells do not see until they
 * restart, so a fresh install is present on disk and absent from PATH for the
 * rest of the session. Resolving it by hand is the difference between "works
 * after you reboot" and "works".
 */
let resolved = null;
export function ffmpegPath() {
  if (resolved) return resolved;
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) return (resolved = process.env.FFMPEG_PATH);

  const local = process.env.LOCALAPPDATA;
  const guesses = [
    local && join(local, 'Microsoft/WinGet/Links/ffmpeg.exe'),
    local && join(local, 'Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.2-full_build/bin/ffmpeg.exe'),
  ].filter(Boolean);
  for (const g of guesses) if (existsSync(g)) return (resolved = g);

  // Not found on disk — fall through to the bare name and let PATH answer.
  // Throwing here would be wrong: on any machine where ffmpeg is installed
  // normally, none of the guesses above exist and PATH is the correct answer.
  return (resolved = 'ffmpeg');
}

/** Is there actually an encoder? Answered by asking it, not by looking for a file. */
export async function ffmpegReady() {
  try {
    const { stdout } = await run(ffmpegPath(), ['-hide_banner', '-version']);
    return { ok: true, version: stdout.split('\n')[0].trim(), path: ffmpegPath() };
  } catch (e) {
    return { ok: false, error: e.message, path: ffmpegPath() };
  }
}

/**
 * Where the line goes and what colour it is — measured, not assumed.
 *
 * The first version hardcoded white, centred, at a fixed height, and it showed:
 * white type on a pale sky, and a line sitting wherever it happened to land
 * regardless of what was behind it. The deck slides solved this a long time ago
 * by measuring the photograph (render/photo.js) and this reuses that work
 * unchanged — the placement geometry comes from the DECK's overlay config, so
 * a clip and a slide put their text in the same place for the same reasons.
 *
 * The one thing a still does not have to deal with: the background MOVES. A
 * spot that is clean sky at the start of the clip can be a bright roofline four
 * seconds later, and measuring a single frame gets that wrong in the most
 * visible way possible — the text is legible exactly until someone watches it.
 *
 * So several frames are measured and the answers are combined pessimistically:
 * the band most frames agree on, the WORST contrast within it, the MAX shadow
 * and wash any frame asked for. The type is therefore sized for the hardest
 * moment in the clip rather than the first one.
 */
export async function measureClip(source, { frames = 5, startAt = null } = {}) {
  const cfg = postConfig().clips.video;
  const ov = postConfig().clips.overlay;
  const { width: w, height: h, seconds, fps } = cfg;
  const from = startAt ?? cfg.startAt;
  const dir = mkdtempSync(join(tmpdir(), 'tiyul-clip-'));

  try {
    // Extracted with the SAME cover-crop the finished clip gets, then scaled
    // down. That is what makes the measurement honest: analyseSlides crops to
    // 9:16 itself, so handing it an uncropped 4:3 source would measure pixels
    // that never reach the screen.
    await run(ffmpegPath(), [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-ss', String(from), '-t', String(seconds), '-i', source,
      '-vf', `${coverFilter(w, h, fps)},fps=${(frames / seconds).toFixed(4)},scale=270:480`,
      '-frames:v', String(frames),
      join(dir, 'f-%02d.jpg'),
    ]);

    const items = [];
    for (let i = 1; i <= frames; i++) {
      const f = join(dir, `f-${String(i).padStart(2, '0')}.jpg`);
      if (!existsSync(f)) continue;
      items.push({
        src: `data:image/jpeg;base64,${readFileSync(f).toString('base64')}`,
        blockH: 0.14,
        blockW: ov.width,
        // The button rail is down the right of a TikTok frame, and a centred
        // line at 84% width runs under it. Excluded anyway, because the rail
        // is drawn over whatever we supply and text beneath it is unread.
        rail: true,
      });
    }
    if (!items.length) return null;

    const spots = (
      await analyseSlides(items, {
        topSafe: 300,
        bottomSafe: 400,
        height: 1920,
        confine: { xs: ov.xs, x: ov.x, width: ov.width, bands: [ov.bands.upper, ov.bands.mid] },
        // Avoid horizons. A clip's line is centred and wide, so it crosses a
        // treeline far more readily than a deck's narrow left-hand caption.
        seam: ov.seamPenalty,
      })
    ).filter(Boolean);
    if (!spots.length) return null;

    // Which band, by vote. A clip whose frames disagree is one where the
    // camera moved across the thing being avoided, and the majority answer is
    // the one that is right for most of the running time.
    const mid = (ov.bands.upper[1] + ov.bands.mid[0]) / 2;
    const upper = spots.filter((s) => s.y < mid);
    const band = upper.length >= spots.length / 2 ? upper : spots.filter((s) => s.y >= mid);
    const chosen = band.length ? band : spots;

    // The worst frame in that band decides everything else. Averaging would
    // produce a treatment that is correct on no single frame of the clip.
    const worst = chosen.reduce((a, b) => (b.contrast < a.contrast ? b : a));
    return {
      ...worst,
      // x comes from the MEASUREMENT now, not from config — the whole point of
      // offering three columns is that the search gets to choose one.
      width: ov.width,
      shadow: Math.max(...chosen.map((s) => s.shadow)),
      assist: Math.max(...chosen.map((s) => s.assist)),
      frames: spots.length,
      agreed: chosen.length,
      spread: {
        best: Math.max(...chosen.map((s) => s.contrast)),
        worst: Math.min(...chosen.map((s) => s.contrast)),
      },
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Which seconds of the source to keep.
 *
 * Scored on frame-to-frame DIFFERENCE, using ffmpeg's own scene detection: a
 * window whose frames barely change is a steady shot, and a window full of
 * large changes is the camera swinging, a cut, or someone's hand over the lens.
 * Steady wins, because a legible line needs a background that stays put for
 * eight seconds — the same reason measureClip takes the worst frame rather
 * than the first.
 *
 * The first second is never offered: on nearly every handheld stock clip it is
 * the camera settling.
 */
export async function pickWindow(source, duration = null) {
  const cfg = postConfig().clips.video;
  const want = cfg.seconds;
  const len = Number(duration) || 0;
  // Nothing to choose between — the clip is barely longer than the cut.
  if (!len || len <= want + 1.5) return cfg.startAt;

  const starts = [];
  for (let t = 1; t + want <= len - 0.2; t += 1.5) starts.push(Number(t.toFixed(2)));
  if (!starts.length) return cfg.startAt;

  let best = starts[0];
  let bestScore = Infinity;
  for (const t of starts) {
    try {
      // select='gt(scene,0.2)' emits a frame each time the picture changes
      // sharply; counting them is a cheap proxy for how unstable the window is.
      const { stderr } = await run(
        ffmpegPath(),
        ['-hide_banner', '-nostats', '-ss', String(t), '-t', String(want), '-i', source,
         '-vf', "select='gt(scene,0.2)',showinfo", '-f', 'null', '-'],
        { maxBuffer: 1 << 24 }
      ).catch((e) => ({ stderr: e.stderr || '' }));
      const cuts = (String(stderr).match(/Parsed_showinfo/g) || []).length;
      if (cuts < bestScore) {
        bestScore = cuts;
        best = t;
      }
      if (cuts === 0) break;
    } catch {
      /* one unscorable window should not cost the choice */
    }
  }
  return best;
}

/**
 * The hook line as a transparent PNG the size of the frame.
 *
 * Set larger than a slide's text, because the two do opposite jobs: a slide's
 * caption labels a photograph that is already the post, while a clip's line IS
 * the post and the footage is its punchline. It has to be legible in the half
 * second before a thumb decides.
 *
 * Everything else — where it sits, what colour it is, how hard the shadow
 * works, whether a wash comes in behind it — is the deck's logic applied to a
 * measurement of this clip's own frames.
 */
/**
 * Which ink this clip is set in.
 *
 * Varied per clip rather than fixed, because "the text is always white" was a
 * real complaint and the highest-performing reference post of the five is
 * cream, not white. Chosen by clip id so it is stable across re-renders of the
 * same clip but different between clips in a batch.
 *
 * Filtered by what the frame can actually carry first. Cream sits at almost
 * the same luminance as a bright sky, so it is offered over a dark frame only —
 * the same rule render/photo.js applies to the deck's accent, and for the same
 * reason: a pale ink on a pale frame is not a colour choice, it is an invisible
 * line.
 */
export function inkFor(id, onDark) {
  const all = postConfig().clips.overlay.colors;
  const usable = all.filter((c) => !c.onDarkOnly || onDark);
  const pool = usable.length ? usable : all.slice(0, 1);
  let n = 0;
  for (const ch of String(id || '')) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return pool[n % pool.length];
}

/**
 * The hook line as a transparent PNG the size of the frame.
 *
 * Centred, bold, upper-middle — read off five real posts rather than inherited
 * from the deck slides. A slide's caption labels a photograph that is already
 * the post, so it is small, light and flush left. A clip's line IS the post and
 * the footage is its punchline, so it is set the way the app's own text tool
 * sets it: centred, heavy, with a stroke.
 *
 * What IS still the deck's is the measurement — which band survives, whether
 * the ink goes light or dark, how hard the shadow works, whether a wash is
 * needed. That logic was built for stills and applies to frames unchanged.
 */
export function overlayHtml(text, { width, height, spot = null, id = '' } = {}) {
  const ov = postConfig().clips.overlay;
  const adapt = postConfig().overlay.adapt;
  const basis = ov.sizeBasis === 'height' ? height : width;
  const size = Math.max(12, Math.round(basis * ov.sizePct));

  // Only reached when ffmpeg could not produce a frame to measure. The upper
  // band, white, which is where four of the five reference posts put it.
  const place = spot || {
    x: ov.x,
    y: (ov.bands.upper[0] + ov.bands.upper[1]) / 2,
    width: ov.width,
    color: '#FFFFFF',
    onDark: true,
    assist: 0,
    shadow: 0,
  };

  const onDark = place.onDark !== false;
  const force = Math.max(0, Math.min(1, place.shadow ?? 0));
  const weight = Math.round(ov.weight + force * adapt.weightBoost);

  // The measured decision decides light-or-dark; the palette decides WHICH
  // light. Over a pale frame the measurement wins outright and the line goes
  // near-black, because no cream survives a bright sky.
  // The palette wins unless the frame is genuinely pale.
  //
  // A deck slide flips to near-black the moment the measurement says the
  // background is bright, because its type is small, light and unstroked and
  // has nothing else to survive on. A clip's line is 56px at weight 700 with a
  // stroke behind it — cream over a bright blue sky is perfectly readable, and
  // it is what the account is supposed to look like. Flipping it to near-black
  // produced a dark line on Lauterbrunnen's sky that the owner immediately
  // called wrong.
  //
  // So the flip is reserved for a frame bright enough that a stroked cream
  // would genuinely disappear, and `darkAbove` is where that line sits. The
  // stroke does the rest.
  const darkAbove = ov.flipToDarkAbove;
  const reallyPale = !onDark && (place.lum ?? 0) >= darkAbove;
  const ink = inkFor(id, true);
  const fill = reallyPale ? '#14110E' : ink.fill;
  const stroke = reallyPale ? 'rgba(255,255,255,0.65)' : ink.stroke;
  // Thickened by the measured shortfall, exactly as the shadow is. This is
  // what lets the line stay yellow over a bright sky instead of flipping to
  // near-black: the fill is the account's colour and the stroke is what makes
  // it survive. Without it, cream on a white cloud is a smudge.
  const strokeW = Math.max(1, Math.round(size * (ov.strokePct + force * ov.strokeBoost)));

  const boost =
    adapt.shadowBoost && force > 0.02
      ? `, 0 2px ${Math.round(10 + force * 16)}px rgba(0,0,0,${(force * 0.6).toFixed(2)})`
      : '';
  const shadow = !reallyPale
    ? `${ov.shadow}${boost}`
    : `0 1px 3px rgba(255,255,255,0.55), 0 2px ${14 + Math.round(force * 12)}px rgba(255,255,255,${(0.4 + force * 0.34).toFixed(2)})`;

  // A guaranteed margin, applied after the search rather than trusted from it —
  // the same guarantee render/deckTemplates.js makes, and the one this file was
  // missing. The placement search may return any of the configured columns, and
  // an off-centre column with a wide block runs straight off the frame: at
  // x=0.72 with width 0.72 the right edge lands at 1166px on a 1080px frame,
  // and the first words of the line are simply not in the video.
  //
  // The block is narrowed first and then pushed inside, so a line that cannot
  // fit where it was placed wraps instead of being cropped.
  const margin = Math.round(width * 0.05);
  const blockW = Math.min(Math.round(place.width * width), width - margin * 2);
  const left = Math.max(margin, Math.min(width - margin - blockW, Math.round(place.x * width - blockW / 2)));
  const top = Math.round(place.y * height);

  // The same soft elliptical wash the slides get, and for the same reason:
  // below about 3.8:1 nothing else is enough. Baked into the PNG so ffmpeg
  // composites text and wash in one pass.
  const strength = place.assist || 0;
  const washed = strength >= 0.06;
  const alpha = Math.min(0.5, 0.18 + strength * 0.34).toFixed(3);
  const tint = reallyPale ? '255,255,255' : '0,0,0';
  const cw = Math.round(blockW * 1.25);
  const ch = Math.round(height * 0.13 * 2.4);

  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>
@font-face { font-family:'TikTok Sans'; src:url('${tiktokSansDataUri()}') format('truetype'); font-weight:100 900; font-display:block; }
@font-face { font-family:'Arimo'; src:url('${arimoDataUri()}') format('truetype'); font-weight:100 900; font-display:block; }
@font-face { font-family:'Assistant'; src:url('${assistantDataUri()}') format('truetype'); font-weight:100 900; font-display:block; }
@font-face { font-family:'Heebo'; src:url('${heeboDataUri()}') format('truetype'); font-weight:100 900; font-display:block; }
* { margin:0; padding:0; box-sizing:border-box; }
/* Transparent all the way down. Playwright's omitBackground only removes the
   default white if nothing else paints over it, so neither html nor body may
   carry a background of its own. */
html, body { width:${width}px; height:${height}px; background:transparent; overflow:hidden; }
/* EXACTLY the deck slides' stack — see the long note in render/deckTemplates.js.
   TikTok Sans first, carrying the glyphs it actually has (digits, a stray Latin
   word) and falling through per glyph for every Hebrew letter, which is what
   the app itself does. Arimo carries the Hebrew. A clip and a slide from this
   account have to be set in the same face or they read as two accounts. */
body { direction:rtl; font-family:'TikTok Sans','Arimo','Assistant','Heebo',sans-serif;
       -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility; }
.assist { position:absolute; border-radius:50%; filter:blur(${Math.round(height * 0.03)}px);
  left:${Math.round(place.x * width - cw / 2)}px; top:${Math.round(place.y * height - ch / 2)}px;
  width:${cw}px; height:${ch}px;
  background:radial-gradient(closest-side, rgba(${tint},${alpha}) 0%, rgba(${tint},${(alpha * 0.55).toFixed(3)}) 55%, rgba(${tint},0) 100%); }
.hook {
  position:absolute;
  top:${top}px;
  left:${left}px;
  width:${blockW}px;
  transform:translateY(-50%);
  text-align:${ov.align};
  font-size:${size}px;
  font-weight:${weight};
  line-height:1.2;
  color:${fill};
  opacity:${ov.opacity};
  /* paint-order puts the stroke BEHIND the fill, so the letterform keeps its
     full weight instead of being eaten from both sides. Without it a 3px
     stroke on a 56px face closes every counter. */
  paint-order:stroke fill;
  -webkit-text-stroke:${strokeW}px ${stroke};
  text-shadow:${shadow};
  text-wrap:balance;
  display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:${ov.maxLines}; overflow:hidden;
}
</style></head><body>${washed ? '<div class="assist"></div>' : ''}<div class="hook">${escapeHtml(text)}</div></body></html>`;
}

/** Render that HTML to a PNG with a real alpha channel. */
export async function renderOverlayPng(text, { width, height, file, spot = null, id = '' }) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    locale: 'he-IL',
  });
  const page = await context.newPage();
  try {
    await page.setContent(overlayHtml(text, { width, height, spot, id }), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const buf = await page.screenshot({ type: 'png', omitBackground: true });
    writeFileSync(file, buf);
    return file;
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * Fill the 9:16 frame from whatever aspect the source happens to be.
 *
 * scale=…:force_original_aspect_ratio=increase then crop is the video
 * equivalent of CSS object-fit: cover — the frame is filled and the overflowing
 * axis is centre-cropped, which is what the slide renderer already does to
 * photographs. Most of these clips are already 9:16 and this is a no-op for
 * them; the ones shot 3:4 would otherwise arrive pillarboxed, and a black bar
 * down each side is the most obvious "this was not filmed for here" signal
 * there is.
 */
const coverFilter = (w, h, fps) =>
  `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=${fps},setsar=1`;

/**
 * One finished post: trimmed, cropped, with the line burned in.
 *
 * `-ss` before `-i` so the seek is done on the input rather than by decoding
 * and discarding — on a 25-second 4K source that is the difference between a
 * second and twenty.
 */
export async function burnClip(source, { text, outFile, pngFile, id = '', duration = null }) {
  const cfg = postConfig().clips.video;
  const { width: w, height: h, seconds, fps, crf, preset, keepAudio } = cfg;

  // WHICH eight seconds. Previously always 0.6 → 8.6 regardless of what was in
  // them, which on a twenty-second clip throws away two thirds of the material
  // unseen and keeps whatever the camera happened to be doing at the start —
  // usually settling. Now the windows are scored and the steadiest one wins.
  const startAt = await pickWindow(source, duration).catch(() => cfg.startAt);

  // Measured second — where the words go and what colour they are are
  // properties of the footage, and both have to be measured on the window that
  // will actually ship rather than on the whole clip.
  const spot = await measureClip(source, { startAt }).catch(() => null);
  await renderOverlayPng(text, { width: w, height: h, file: pngFile, spot, id });

  const args = [
    '-y',
    '-hide_banner',
    '-loglevel', 'error',
    '-ss', String(startAt),
    '-t', String(seconds),
    '-i', source,
    '-i', pngFile,
    '-filter_complex', `[0:v]${coverFilter(w, h, fps)}[v];[v][1:v]overlay=0:0:format=auto[out]`,
    '-map', '[out]',
    // Stock audio is almost always a library music bed that will be replaced by
    // whatever sound is chosen in the TikTok app, so it is dropped by default:
    // shipping a track nobody chose is worse than shipping silence.
    ...(keepAudio ? ['-map', '0:a?', '-c:a', 'aac', '-b:a', '128k'] : ['-an']),
    '-c:v', 'libx264',
    '-profile:v', 'high',
    '-pix_fmt', 'yuv420p',
    '-crf', String(crf),
    '-preset', preset,
    // The index at the front, so the file starts playing before it has finished
    // downloading — which is what every player and every upload path wants.
    '-movflags', '+faststart',
    outFile,
  ];

  await run(ffmpegPath(), args, { maxBuffer: 1 << 24 });
  if (!existsSync(outFile)) throw new Error('ffmpeg reported success but wrote no file');
  return { file: outFile, spot, startAt };
}

/** Pull the source clip down to disk. Pexels serves these straight from its CDN. */
export async function download(url, file, { timeoutMs = 60_000 } = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`download HTTP ${res.status}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

export function clipOutputDir() {
  const dir = process.env.CLIP_OUT_DIR || join(process.cwd(), 'out', 'clips');
  mkdirSync(dir, { recursive: true });
  return dir;
}
