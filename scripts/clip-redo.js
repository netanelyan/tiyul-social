import { loadEnv } from '../src/env.js';
import { postConfig } from '../src/postConfig.js';
import { buildClip } from '../src/video/clip.js';
import { pickFile, titleOf } from '../src/video/pexels.js';
import { judgeThumb } from '../src/video/vision.js';
import { closeBrowser } from '../src/render/index.js';
import { publishTikTok, tiktokConfigured, describeError } from '../src/publish/tiktok.js';
import { targetsForKind } from '../src/publish/targets.js';
import * as store from '../src/store.js';

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

// `stage` hands each rebuilt clip to the approval queue instead of just
// writing a file: it is added to the staging store and sent to Telegram with
// real approve/reject buttons under it.
//
// MUST BE RUN WHERE THE BOT RUNS. The buttons carry a key into data/store.json,
// and a key staged on one machine means nothing to a bot reading another
// machine's store — the tap resolves to an item that is not there.
const toStage = process.argv.includes('stage');

// `place=Switzerland` — the country, decided by you rather than by the judge.
//
// The judge reads one thumbnail and is sometimes wrong about it, and when it is
// wrong the error does not stay in one place: the country it names is what the
// hook writer is told to use, what the pin under the video prints, and what the
// one destination hashtag is generated from. Correcting it clip by clip in
// three files is how a post ends up saying איטליה in the video and שווייץ
// underneath, so it is one flag and it sets all three.
//
// English, exactly as clips.places in post-config.json spells it, because that
// is the key the Hebrew name is looked up under.
// `place=X` and `--place=X` both work. Every other argument is a numeric Pexels
// id with an optional line after it, so the word cannot be mistaken for one —
// and a flag that only works with the dashes nobody typed is a flag that gets
// silently parsed as a clip id, which is exactly what happened the first time
// this was run.
const placeArg = process.argv.slice(2).find((a) => /^-{0,2}place=/.test(a));
const pinnedPlace = placeArg ? placeArg.replace(/^-{0,2}place=/, '').trim() : null;
if (pinnedPlace && !postConfig().places[pinnedPlace.toLowerCase()]) {
  console.error(
    `place=${pinnedPlace} has no Hebrew spelling in post-config.json (clips.places) - ` +
      'add it there first, or the pin and the tag have nothing to print'
  );
  process.exit(1);
}

const pairs = process.argv
  .slice(2)
  .filter((a) => a !== 'draft' && a !== 'stage' && a !== placeArg)
  .map((a) => {
    const at = a.indexOf('=');
    return at === -1 ? { id: a, hook: null } : { id: a.slice(0, at), hook: a.slice(at + 1) };
  });

if (!pairs.length) {
  console.error('usage: npm run clip-redo -- [stage] [draft] [place=Country] <pexelsId>[="the line"] ...');
  process.exit(1);
}

let telegram = null;
if (toStage) {
  const token = process.env.TG_BOT_TOKEN;
  const chat = process.env.STAGING_CHAT_ID;
  if (!token || !chat) {
    console.error('stage needs TG_BOT_TOKEN and STAGING_CHAT_ID');
    process.exit(1);
  }
  const { Telegraf } = await import('telegraf');
  telegram = { api: new Telegraf(token).telegram, chat };
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
    let vision = await judgeThumb(v.image);

    if (pinnedPlace) {
      const was = vision?.place || '';
      vision = { ...(vision || {}), place: pinnedPlace, placeConfidence: 10 };
      // A site belongs to the country it is in. Keeping "Passo Gardena" while
      // moving the country to Switzerland would print a pin that is wrong in a
      // more specific and more embarrassing way than the one being corrected —
      // so the landmark goes with the country that was overruled.
      if (was.toLowerCase() !== pinnedPlace.toLowerCase()) {
        vision.site = '';
        vision.siteHe = '';
      }
      console.log(`   place: ${was || 'unplaced'} → ${pinnedPlace} (yours)`);
    }

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

    const clip = await buildClip(found, {
      hook,
      // The same fields stage() would have put on it. Carried here because a
      // rebuilt clip has to be indistinguishable from one /clip produced —
      // otherwise the publish path sees a candidate it does not recognise.
    });
    clip.publishTargets = targetsForKind('clip');
    clip.tiktokDraft = true;
    clip.overrides = [];
    clip.notes = [];
    console.log(`\n${clip.clip.file}`);
    console.log(`   “${clip.hook}”`);
    console.log(`   ${clip.clip.title}`);
    for (const line of String(clip.tiktokCaption || '(no description)').split('\n')) {
      if (line.trim()) console.log(`   ${line}`);
    }
    if (clip.clip.spot) {
      const s = clip.clip.spot;
      console.log(`   x=${s.x ?? '?'} y=${s.y} · ${s.onDark ? 'light' : 'dark'} · contrast ${s.worstContrast} · on sky ${Math.round((s.onBackground ?? 0) * 100)}%`);
    }

    if (toStage) {
      const { Markup } = await import('telegraf');
      const { sendClipForApproval } = await import('../src/publish/telegram.js');
      const { clipApprovalMessage } = await import('../src/video/clip.js');
      const key = store.addStaging(clip);
      const kb = Markup.inlineKeyboard([
        [Markup.button.callback('✅ אשר ופרסם', `ok:${key}`), Markup.button.callback('❌ דחה', `no:${key}`)],
      ]);
      await sendClipForApproval(telegram.api, telegram.chat, clip, clipApprovalMessage(clip), kb);
      console.log(`   → staged as ${key}, sent to Telegram with buttons`);
    }

    if (toDraft) {
      if (!tiktokConfigured()) {
        console.error('   ✗ TikTok is not configured here - run this on the box that holds the token');
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
