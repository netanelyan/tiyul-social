import path from 'node:path';
import { spawn } from 'node:child_process';
import { ffmpegPath, clipOutputDir } from './overlay.js';
import { postConfig } from '../postConfig.js';

// THE SAME SLIDESHOW, AS ONE VERTICAL VIDEO FILE.
//
// OFF BY DEFAULT, AND THE REASON IS A FINDING THIS PROJECT ALREADY PAID FOR.
//
// The brief asks for a video rendering variant of the list-style formats so the same
// content can be posted as a short video, which is a reasonable thing to want: the
// account's videos run at 3.8 to 6.1% likes per view and its slideshows at 0.5 to
// 2.5%, and the obvious move is to put the slideshows out as videos.
//
// The obvious move is also the one src/video/postcard.js records failing. Its first
// version was a slow zoom over a still photograph, chosen because a geotagged file is
// provably of the place while stock video is not, and the owner's verdict was "not a
// zoomed in picture, but a clip instead". A pan over a still is a slideshow in an mp4
// container, and a viewer can tell. So this is not a way to turn a slideshow into the
// format that wins; it is a way to put a slideshow on the surface that favours video,
// which is a different and smaller claim.
//
// It is here because it is cheap and it is testable: the slides are already rendered,
// so this costs one ffmpeg pass and no API calls, and `/reel` plus the metrics rows
// will answer the question within a fortnight. Turn it on in post-config.json.
//
// WHAT IT DELIBERATELY DOES NOT DO. No transitions, no music, no text animation. The
// slides are a finished design that was measured for legibility at a known size, and
// every one of those would be a second designer arguing with the first.

/**
 * One mp4 from a post's already-rendered slides.
 *
 * `files` are the JPEGs renderPost wrote, in slide order, at the TikTok geometry.
 * They are already 1080x1920 (or 1080x1440 at the phone frame), so there is nothing
 * to crop: the scale and pad below exist for the second case and are a no-op for the
 * first.
 *
 * THE ZOOM IS PER SLIDE AND IT ALTERNATES DIRECTION. A reel of five slides all
 * drifting the same way reads as one long pan; alternating in and out reads as a cut
 * between shots, which is what the eye is looking for. `zoompan` is given the hold in
 * frames, so a slide held for two seconds at 30fps gets exactly 60 frames of travel.
 */
export async function buildSlideReel(files, { id = 'reel', outDir = clipOutputDir(), cfg = null } = {}) {
  const video = postConfig().clips.video;
  const conf = cfg || postConfig().posts.video;
  const list = (files || []).filter(Boolean);
  if (!list.length) throw new Error('a slide reel needs at least one rendered slide');

  // THE COVER IS HELD LONGER THAN THE REST, which is the one thing this format can
  // borrow from the gems reel without pretending to be it: the first slide is the
  // hook and a viewer needs time to read it, and every slide after it is a line they
  // can take in at a glance.
  const holds = list.map((_, i) => (i === 0 ? conf.coverSeconds : conf.holdSeconds));

  // Trimmed to the ceiling from the END, because the cover and the first items are
  // what a viewer sees and the tail of a twenty-one slide list is not worth going
  // over the length for. Said in the return value so the caller can report it.
  let total = holds.reduce((a, b) => a + b, 0);
  let dropped = 0;
  while (total > conf.maxSeconds && holds.length > 2) {
    total -= holds.pop();
    list.pop();
    dropped += 1;
  }

  const { width: w, height: h, fps, crf, preset } = video;
  const file = path.join(outDir, `clip-${id}.mp4`);

  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  for (const [i, src] of list.entries()) args.push('-loop', '1', '-t', String(holds[i]), '-i', src);

  const steps = [];
  for (let i = 0; i < list.length; i++) {
    const frames = Math.max(1, Math.round(holds[i] * fps));
    // In on the even slides, out on the odd ones. The range is deliberately small:
    // 4% over two seconds is a drift somebody feels rather than sees, and anything
    // larger starts cropping a layout that was composed to the edge of the frame.
    const z = conf.zoom > 0
      ? i % 2 === 0
        ? `zoompan=z='min(zoom+${(conf.zoom / frames).toFixed(5)},${(1 + conf.zoom).toFixed(3)})':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${w}x${h}:fps=${fps}`
        : `zoompan=z='if(eq(on,0),${(1 + conf.zoom).toFixed(3)},max(zoom-${(conf.zoom / frames).toFixed(5)},1))':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${w}x${h}:fps=${fps}`
      : `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,fps=${fps}`;
    steps.push(
      `[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},${z},setsar=1[v${i}]`
    );
  }
  steps.push(`${list.map((_, i) => `[v${i}]`).join('')}concat=n=${list.length}:v=1:a=0[vout]`);

  args.push(
    '-filter_complex', steps.join(';'),
    '-map', '[vout]',
    '-c:v', 'libx264',
    '-preset', preset,
    '-crf', String(crf),
    '-pix_fmt', 'yuv420p',
    '-r', String(fps),
    '-t', String(total),
    file
  );

  await run(ffmpegPath(), args);
  return { file, seconds: total, slides: list.length, dropped };
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

/** Which post types may be posted as a reel, from the config. */
export const reelable = (type) => postConfig().posts.video.types.includes(String(type || ''));
