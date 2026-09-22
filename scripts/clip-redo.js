import { loadEnv } from '../src/env.js';
import { buildClip } from '../src/video/clip.js';
import { pickFile, titleOf } from '../src/video/pexels.js';
import { judgeThumb } from '../src/video/vision.js';
import { closeBrowser } from '../src/render/index.js';
import { publishTikTok, tiktokConfigured, describeError } from '../src/publish/tiktok.js';

// Re-render specific clips, with their lines pinned.
//
//   npm run clip-redo -- 35714980="אני, אתה, טיסה לאיטליה?" 31384734="..."
//
// This exists because the normal loop cannot answer "the same clip, but the
// type a little smaller". clip-lab searches, judges and writes a fresh line
// every run, so two runs differ in three variables at once and a styling change
// cannot be seen. Here the footage and the words are fixed and the only thing
// that moves is the render.
//
// Not part of the pipeline and never publishes. It is a comparison tool, which
// is the same reason scripts/font-lab.js exists.

loadEnv();

// `draft` pushes each rebuilt clip to the account's TikTok inbox after it is
// written. Draft mode rather than a direct post, for the reason decks use it:
// the API has no field for choosing a sound, and sound is the one thing that
// cannot be changed after publishing.
const toDraft = process.argv.includes('draft');
const pairs = process.argv.slice(2).filter((a) => a !== 'draft').map((a) => {
  const at = a.indexOf('=');
  return at === -1 ? { id: a, hook: null } : { id: a.slice(0, at), hook: a.slice(at + 1) };
});

if (!pairs.length) {
  console.error('usage: npm run clip-redo -- <pexelsId>[="the line"] ...');
  process.exit(1);
}

const key = process.env.PEXELS_API_KEY;
if (!key) {
  console.error('PEXELS_API_KEY is not set');
  process.exit(1);
}

for (const { id, hook } of pairs) {
  try {
    const res = await fetch(`https://api.pexels.com/videos/videos/${id}`, {
      headers: { authorization: key },
    });
    if (!res.ok) {
      console.error(`${id}: HTTP ${res.status}`);
      continue;
    }
    const v = await res.json();
    const file = pickFile(v);
    if (!file) {
      console.error(`${id}: no usable rendition`);
      continue;
    }

    // Judged anyway, because the place formats need a country and a pinned
    // line does not supply one — and a re-render that silently loses the
    // vision data would not be the same clip in the way that matters.
    const vision = await judgeThumb(v.image);

    const found = {
      id: String(v.id),
      title: titleOf(v),
      query: 'redo',
      score: 0,
      duration: v.duration,
      width: v.width,
      height: v.height,
      src: file.link,
      poster: v.image,
      credit: v.user?.name || null,
      creditUrl: v.user?.url || null,
      page: v.url,
      provenance: 'pexels',
      vision,
    };

    const clip = await buildClip(found, { hook });
    console.log(`\n${clip.clip.file}`);
    console.log(`   “${clip.hook}”`);
    console.log(`   ${clip.clip.title}`);
    if (clip.clip.spot) {
      const s = clip.clip.spot;
      console.log(`   x=${s.x ?? '?'} y=${s.y} · ${s.onDark ? 'light' : 'dark'} · contrast ${s.worstContrast} · on sky ${Math.round((s.onBackground ?? 0) * 100)}%`);
    }

    if (toDraft) {
      if (!tiktokConfigured()) {
        console.error('   ✗ TikTok is not configured here — run this on the box that holds the token');
        continue;
      }
      try {
        const out = await publishTikTok({ ...clip, publishTargets: ['tiktok'], tiktokDraft: true }, { draft: true });
        console.log(`   → TikTok drafts (publish_id ${out.publishId || 'unknown'})`);
      } catch (e) {
        console.error(`   ✗ draft failed: ${describeError(e)}`);
      }
    }
  } catch (e) {
    console.error(`${id}: ${e.message}`);
  }
}

await closeBrowser().catch(() => {});
