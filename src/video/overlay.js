import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getBrowser } from '../render/index.js';
import { postConfig } from '../postConfig.js';
import { heeboDataUri, assistantDataUri, arimoDataUri, escapeHtml } from '../render/theme.js';

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
 * The hook line as a transparent PNG the size of the frame.
 *
 * Centred by default and set larger than a slide's text, because the two do
 * opposite jobs: a slide's caption labels a photograph that is already the
 * post, while a clip's line IS the post and the footage is its punchline. It
 * has to be legible in the half second before a thumb decides.
 */
export function overlayHtml(text, { width, height } = {}) {
  const ov = postConfig().clips.overlay;
  const basis = ov.sizeBasis === 'height' ? height : width;
  const size = Math.max(12, Math.round(basis * ov.sizePct));
  const align = ov.align;
  // Under direction: rtl, flex-start is the RIGHT edge — the same inversion the
  // slide templates document at alignment().
  const items = align === 'center' ? 'center' : align === 'left' ? 'flex-end' : 'flex-start';

  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>
@font-face { font-family:'Heebo'; src:url('${heeboDataUri()}') format('truetype'); font-weight:100 900; font-display:block; }
@font-face { font-family:'Assistant'; src:url('${assistantDataUri()}') format('truetype'); font-weight:100 900; font-display:block; }
@font-face { font-family:'Arimo'; src:url('${arimoDataUri()}') format('truetype'); font-weight:100 900; font-display:block; }
* { margin:0; padding:0; box-sizing:border-box; }
/* Transparent all the way down. Playwright's omitBackground only removes the
   default white if nothing else paints over it, so neither html nor body may
   carry a background of its own. */
html, body { width:${width}px; height:${height}px; background:transparent; overflow:hidden; }
body { direction:rtl; font-family:'Arimo','Assistant','Heebo',sans-serif;
       -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility; }
.hook {
  position:absolute;
  top:${Math.round(ov.y * height)}px;
  left:50%;
  width:${Math.round(ov.width * width)}px;
  transform:translate(-50%,-50%);
  display:flex; flex-direction:column; align-items:${items};
  text-align:${align};
  font-size:${size}px;
  font-weight:${ov.weight};
  line-height:1.24;
  color:#fff;
  opacity:${ov.opacity};
  text-shadow:${ov.shadow};
  text-wrap:balance;
  display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:${ov.maxLines}; overflow:hidden;
}
</style></head><body><div class="hook">${escapeHtml(text)}</div></body></html>`;
}

/** Render that HTML to a PNG with a real alpha channel. */
export async function renderOverlayPng(text, { width, height, file }) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    locale: 'he-IL',
  });
  const page = await context.newPage();
  try {
    await page.setContent(overlayHtml(text, { width, height }), { waitUntil: 'load' });
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
export async function burnClip(source, { text, outFile, pngFile }) {
  const cfg = postConfig().clips.video;
  const { width: w, height: h, seconds, startAt, fps, crf, preset, keepAudio } = cfg;

  await renderOverlayPng(text, { width: w, height: h, file: pngFile });

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
  return outFile;
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
