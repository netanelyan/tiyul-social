import { spawn } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ffmpegPath, clipOutputDir, download } from './overlay.js';
import { getBrowser } from '../render/index.js';
import { frankRuhlDataUri, assistantDataUri, escapeHtml } from '../render/theme.js';
import { postConfig } from '../postConfig.js';
import { speak, speechReady, estimateTimings, subtitleLines } from './speech.js';
import { planLegibility } from '../render/legibility.js';
import { targetsForKind } from '../publish/targets.js';
import { captionFollow } from '../hashtags.js';
import { verdictOf, practicalOf, firstClause, seasonLine, listPlaces, loadCity } from '../posts/source.js';

// THE NARRATED GUIDE. A voice over the place, with what it is saying burned on.
//
// THE REFERENCE, supplied by the owner: forty-seven seconds on Lapland. A Hebrew
// voiceover reads a short guide; under it a sequence of real clips cuts every three or
// four seconds; across the middle of the frame the words appear in time with the voice.
// It opens on a title over the first shot - "כל מה שאתם צריכים לדעת על טיול בלפלנד!" -
// and it never shows a presenter. "Someone talking" is the voice, not a face.
//
// WHY THIS IS THE HARDEST FORMAT HERE AND WORTH IT ANYWAY.
//
// Every other format in this project is a still frame with text on it. This one has a
// time axis, and three things have to agree along it: what is being said, what is on
// screen, and what is written. Getting any two right and the third wrong is worse than
// not doing it - subtitles that drift from the voice read as broken in a way a silent
// slide never does.
//
// WHAT THE SCRIPT IS ALLOWED TO SAY, which is the whole honesty question.
//
// A narrator is the most persuasive thing this pipeline can produce and therefore the
// most dangerous. A voice saying "the best time to go is February" is heard as somebody
// who knows, and the viewer has no way to check. So the script is NOT written freely:
// it is assembled from the destination page's own paragraphs, in a fixed order, exactly
// as a verdict post's slides are. See buildScript below - every sentence in it traces
// to a field, and the one sentence that is ours is the closing ask.
//
// There is no "and a model smooths it into prose" step, and the absence is deliberate.
// Smoothing is where a flight time becomes "a quick hop" and a 4.3 rating becomes
// "universally loved". The seams between quoted paragraphs are a small price.

const SHOT_SECONDS = 4;

/**
 * One narrated guide video.
 *
 * Silent when no voice is configured: the same cuts, the same burned-in lines, read
 * rather than heard. That is a real post and it is what runs until a key exists.
 */
export async function buildNarratedVideo(city, { dest, id = 'narrated', outDir = clipOutputDir() } = {}) {
  const cfg = postConfig().clips.video;
  const { width: w, height: h, fps, crf, preset } = cfg;

  const destHe = dest?.he || city.name;
  const script = buildScript(city, destHe);
  if (!script.sentences.length) throw new Error(`the page for ${destHe} has no paragraphs to narrate`);

  const shots = script.shots;
  if (shots.length < 3) throw new Error(`only ${shots.length} photographed places - a narrated video needs 3`);

  const file = path.join(outDir, `clip-${id}.mp4`);
  const voiceFile = path.join(outDir, `clip-${id}-voice.mp3`);

  // THE VOICE FIRST, because its length decides the video's length.
  //
  // The other direction - cut the picture to a fixed length and fit the voice into it -
  // is how a narrated video ends mid-sentence. The script is the content; the pictures
  // are paced to it.
  const spoken = await speak(script.text, { file: voiceFile }).catch((e) => {
    console.error(`narration: ${e.message} - building the silent version`);
    return null;
  });

  const words = spoken?.words?.length ? spoken.words : estimateTimings(script.text, null);
  const lines = subtitleLines(words);
  const seconds = Math.max(8, Math.ceil(words.length ? words[words.length - 1].end + 0.8 : shots.length * SHOT_SECONDS));

  // THE PICTURES, PACED TO THE VOICE. Each shot holds for an equal share of the
  // narration rather than a fixed four seconds, so the last shot does not get clipped
  // and the first does not sit there after the voice has moved on.
  const hold = seconds / shots.length;

  const titleHe = script.titleHe;
  const pngs = [];
  const files = [];

  // Every subtitle line rendered as its own transparent PNG, plus the title card. One
  // Chromium pass per line sounds expensive and is not: they are 1080x1920 screenshots
  // of three words, and a forty-second video has about twenty of them.
  const plans = await planLegibility(
    shots.map((s) => ({ src: s.image.src, box: SUB_BOX, lines: 2, floor: 0 }))
  ).catch(() => shots.map(() => null));

  try {
    for (const [i, shot] of shots.entries()) {
      files.push(await materialise(shot.image.src, path.join(outDir, `clip-${id}-shot-${i}.jpg`)));
    }

    for (const [i, line] of lines.entries()) {
      const png = path.join(outDir, `clip-${id}-sub-${i}.png`);
      // Which shot is on screen when this line is spoken decides how much help the
      // type needs, so the treatment is looked up by time rather than taken from the
      // first shot.
      const onShot = Math.min(shots.length - 1, Math.floor(line.start / hold));
      await renderSubtitlePng({
        text: line.text,
        titleHe: line.start < 2.4 ? titleHe : null,
        width: w,
        height: h,
        file: png,
        plan: plans[onShot] || null,
      });
      pngs.push({ file: png, start: line.start, end: line.end });
    }

    const args = ['-y', '-hide_banner', '-loglevel', 'error'];
    for (const f of files) args.push('-loop', '1', '-t', String(hold.toFixed(3)), '-i', f);
    for (const p of pngs) args.push('-i', p.file);
    if (spoken) args.push('-i', voiceFile);

    const n = shots.length;
    const steps = [];
    for (let i = 0; i < n; i++) {
      const z = i % 2 === 0
        ? `1+(0.10*on/${Math.round(hold * fps)})`
        : `1.10-(0.10*on/${Math.round(hold * fps)})`;
      steps.push(
        `[${i}:v]scale=${Math.round(w * 1.4)}:${Math.round(h * 1.4)}:force_original_aspect_ratio=increase,` +
          `crop=${Math.round(w * 1.3)}:${Math.round(h * 1.3)},` +
          `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.round(hold * fps)}:s=${w}x${h}:fps=${fps},` +
          `setsar=1[v${i}]`
      );
    }
    steps.push(`${Array.from({ length: n }, (_, i) => `[v${i}]`).join('')}concat=n=${n}:v=1:a=0[bg]`);

    // EACH SUBTITLE OVERLAID ONLY WHILE IT IS BEING SPOKEN. `enable` on the overlay
    // filter is what makes this a narrated video rather than a video with a caption:
    // the line appears on the word and leaves with it.
    let chain = 'bg';
    for (const [i, p] of pngs.entries()) {
      const next = i === pngs.length - 1 ? 'vout' : `s${i}`;
      steps.push(
        `[${chain}][${n + i}:v]overlay=0:0:format=auto:enable='between(t,${p.start.toFixed(3)},${p.end.toFixed(3)})'[${next}]`
      );
      chain = next;
    }
    if (!pngs.length) steps.push('[bg]null[vout]');

    args.push('-filter_complex', steps.join(';'), '-map', '[vout]');
    if (spoken) args.push('-map', `${n + pngs.length}:a`, '-c:a', 'aac', '-b:a', '160k');
    args.push('-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-pix_fmt', 'yuv420p', '-r', String(fps), '-t', String(seconds), file);

    await run(ffmpegPath(), args);
  } finally {
    for (const p of pngs) rmSync(p.file, { force: true });
    for (const f of files) rmSync(f, { force: true });
  }

  return {
    file,
    seconds,
    shots: shots.length,
    narrated: Boolean(spoken),
    estimated: !spoken,
    script: script.text,
    lines: lines.length,
    voiceFile: spoken ? voiceFile : null,
  };
}

// Where the subtitle sits, as [x0, y0, x1, y1] of the frame. The reference puts it just
// above centre, which is where a thumb is not and where the platform's own furniture is
// not either.
const SUB_BOX = [0.08, 0.34, 0.92, 0.5];

/**
 * The script, assembled from the page rather than written.
 *
 * FIXED ORDER, because the order is the argument: what it is, how you get there, when
 * to go, what it costs, what to see. That is how a person decides a trip, and it is the
 * same order the verdict post's "who is this for" slide uses.
 *
 * Every sentence is a clause the page already publishes. The only line that is ours is
 * the last one, and it is an ask rather than a claim.
 */
export function buildScript(city, destHe) {
  const verdict = verdictOf(city);
  const practical = practicalOf(city);

  const places = listPlaces(city, { want: 10, needPhoto: false }).filter((p) => p.image?.src);

  const sentences = [];
  const push = (s) => {
    const t = String(s || '').trim().replace(/\s+/g, ' ');
    if (t && !sentences.some((x) => x === t)) sentences.push(t.endsWith('.') ? t : `${t}.`);
  };

  push(bestOf(verdict?.prosHe));
  push(firstClause(practical?.flightsHe, { max: 110 }));
  push(seasonLine(practical));
  push(firstClause(practical?.aroundHe, { max: 110 }));
  // The named places, which is what the pictures are of. Two at most: a list read aloud
  // stops being narration and becomes an index.
  const named = places.slice(0, 2).map((p) => p.name).filter(Boolean);
  if (named.length) push(`כדאי להתחיל מ${named.join(' ומ')}`);
  // One drawback, because a guide that names none is an advertisement - the same
  // reasoning the verdict type is built on.
  push(bestOf(verdict?.consHe));

  return {
    titleHe: `כל מה שצריך לדעת על טיול ל${destHe}`,
    text: [`${destHe}.`, ...sentences, 'המסלול המלא באתר.'].join(' '),
    sentences,
    shots: places.slice(0, 8),
  };
}

const bestOf = (list) => {
  const all = (list || []).map((s) => String(s || '').trim()).filter((s) => s.length > 14 && s.length < 130);
  return all.sort((a, b) => a.length - b.length)[0] || null;
};

/**
 * One subtitle line as a transparent PNG.
 *
 * Set in the same serif the camera-roll cover and the postcard labels use, for the
 * reason given above frankRuhlDataUri in render/theme.js: these formats are one
 * editorial voice and they should not be set in three faces. Larger here than on a
 * postcard, because a subtitle is read at a glance while something else is moving.
 */
export async function renderSubtitlePng({ text, titleHe = null, width, height, file, plan = null }) {
  const browser = await getBrowser();
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, locale: 'he-IL' });
  const page = await context.newPage();
  try {
    await page.setContent(subtitleHtml({ text, titleHe, width, height, plan }), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    writeFileSync(file, await page.screenshot({ type: 'png', omitBackground: true }));
    return file;
  } finally {
    await context.close().catch(() => {});
  }
}

export function subtitleHtml({ text, titleHe = null, width, height, plan = null }) {
  const subPx = Math.round(width * 0.058);
  const titlePx = Math.round(width * 0.062);
  const needed = Number(plan?.alpha);
  const scrim = Number.isFinite(needed) && plan?.measured ? Math.min(0.56, Math.max(0, needed * 0.6)) : 0.22;

  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>
@font-face { font-family: 'FrankRuhl'; src: url(${frankRuhlDataUri()}) format('truetype'); font-weight: 300 900; font-display: block; }
@font-face { font-family: 'Assistant'; src: url(${assistantDataUri()}) format('truetype'); font-weight: 200 800; font-display: block; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: ${width}px; height: ${height}px; background: transparent; overflow: hidden; }
body { position: relative; -webkit-font-smoothing: antialiased; }
/* The title rides the opening shot and leaves with the first subtitle. */
.title { position: absolute; top: ${Math.round(height * 0.14)}px; inset-inline: ${Math.round(width * 0.08)}px;
         font-family: 'FrankRuhl', serif; font-weight: 600; font-size: ${titlePx}px; line-height: 1.22;
         color: #FBEFE4; text-align: center; text-wrap: balance;
         text-shadow: 0 2px 12px rgba(0,0,0,.6), 0 0 ${Math.round(titlePx)}px rgba(0,0,0,.45); }
/* The subtitle, just above centre. Set in the sans rather than the serif: a subtitle is
   read in fragments at speed and a serif's modulation costs legibility at that pace,
   which is the one place in these formats where the sans is the right answer. */
.sub { position: absolute; top: ${Math.round(height * 0.36)}px; inset-inline: ${Math.round(width * 0.08)}px;
       font-family: 'Assistant', sans-serif; font-weight: 700; font-size: ${subPx}px; line-height: 1.26;
       color: #fff; text-align: center; text-wrap: balance; }
.sub span { background: rgba(0,0,0,${scrim.toFixed(2)}); padding: .08em .3em; border-radius: .18em;
            box-decoration-break: clone; -webkit-box-decoration-break: clone;
            text-shadow: 0 2px 8px rgba(0,0,0,.7); }
</style></head><body>
${titleHe ? `<div class="title">${escapeHtml(titleHe)}</div>` : ''}
<div class="sub"><span>${escapeHtml(text)}</span></div>
</body></html>`;
}

async function materialise(src, dest) {
  const s = String(src || '');
  if (s.startsWith('data:')) {
    writeFileSync(dest, Buffer.from(s.slice(s.indexOf(',') + 1), 'base64'));
    return dest;
  }
  if (/^https?:/i.test(s)) {
    await download(s, dest);
    return dest;
  }
  return s;
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

/** One narrated guide, as an approvable candidate. */
export async function buildNarratedCandidate(dest, { outDir = clipOutputDir() } = {}) {
  const slug = dest?.siteSlug || dest?.id;
  const city = await loadCity(slug);
  if (!city) throw new Error(`no page for ${dest?.he || slug} - a narrated guide is built from one`);

  const { fillPostPhotos } = await import('../posts/photos.js');
  const want = listPlaces(city, { want: 10, needPhoto: false }).slice(0, 10);
  await fillPostPhotos(want, { dest: dest?.en || city.name });
  // listPlaces is called again inside buildScript; the photographs are on the place
  // objects by now, so the second call sees them.
  city.places = (city.places || []).map((p) => want.find((x) => x.id === p.id) || p);

  const id = `nr${Math.abs([...slug].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 11)).toString(16).slice(0, 10)}`;
  const built = await buildNarratedVideo(city, { dest, id, outDir });

  return {
    kind: 'clip',
    id,
    hook: `כל מה שצריך לדעת על טיול ל${dest?.he || city.name}`,
    headline: `כל מה שצריך לדעת על טיול ל${dest?.he || city.name}`,
    hookWritten: false,
    hookNote: built.narrated
      ? 'narrated: every sentence is a clause the page publishes, in a fixed order'
      : 'narrated: NO VOICE CONFIGURED - built silent, same cuts and subtitles',
    sourceName: `tiyulplus.com · ${city.name}`,
    sourceUrl: city.url || null,
    pillar: 'day',
    tags: [],
    createdAt: new Date().toISOString(),
    publishTargets: targetsForKind('clip'),
    tiktokDraft: true,
    overrides: [],
    notes: built.narrated ? [] : ['אין קול מוגדר - הסרטון יצא שקט עם הכתוביות'],
    place: city.name,
    siteSlug: slug,
    clip: {
      shape: 'narrated',
      file: built.file,
      audio: built.narrated,
      seconds: built.seconds,
      follow: captionFollow(),
      followAt: null,
      width: postConfig().clips.video.width,
      height: postConfig().clips.video.height,
      script: built.script,
      subtitleLines: built.lines,
      narrated: built.narrated,
    },
  };
}
