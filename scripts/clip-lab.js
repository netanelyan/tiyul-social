import { loadEnv } from '../src/env.js';
import { buildClips, clipApprovalMessage } from '../src/video/clip.js';
import { closeBrowser } from '../src/render/index.js';

// Build a batch of clips and look at them.
//
//   npm run clip-lab            5 clips to out/clips, nothing sent
//   npm run clip-lab -- 8       eight of them
//   npm run clip-lab -- 5 send  ...and DM them to STAGING_CHAT_ID
//
// Deliberately does not stage anything into the approval queue. Nothing here
// can publish, and nothing here is waiting for a decision — this is the step
// where the taste filter and the lines get judged, and a queue full of clips
// you have not seen yet would be the wrong place to do that.

loadEnv();

const count = Number(process.argv[2]) || 5;
const send = process.argv.includes('send');

const t0 = Date.now();
console.log(`building ${count} clip(s)…\n`);

const { clips, considered, vetoed, failed, searchErrors, ffmpeg, written } = await buildClips({ count });

console.log(`ffmpeg: ${ffmpeg}`);
console.log(`${considered} clip(s) passed the filter, ${clips.length} built\n`);

for (const c of clips) {
  console.log(`  ${c.clip.file}`);
  console.log(`     “${c.hook}”${c.hookWritten ? '' : `   ⚠️ pool — ${c.hookNote || 'no line written'}`}`);
  console.log(`     ${c.clip.title}  ·  score ${c.clip.score}  ·  "${c.clip.query}"`);
  if (c.clip.spot) {
    const s = c.clip.spot;
    console.log(`     text ${s.onDark ? 'light' : 'dark'} @ y=${s.y}  ·  worst contrast ${s.worstContrast}  ·  ${s.agreed}/${s.frames} frames agreed`);
  }
  console.log(`     ${c.clip.page}\n`);
}

// Everything the batch threw away, stated. A filter you cannot see is a filter
// you cannot disagree with, and the reject list is the part most likely to be
// wrong in a way only the owner can spot.
if (vetoed.length) {
  console.log(`vetoed by the reject list (${vetoed.length}):`);
  for (const v of vetoed.slice(0, 12)) console.log(`   ✗ ${v}`);
  if (vetoed.length > 12) console.log(`   ✗ …and ${vetoed.length - 12} more`);
  console.log('');
}
if (failed.length) {
  console.log('failed to build:');
  for (const f of failed) console.log(`   ! ${f}`);
  console.log('');
}
if (searchErrors.length) {
  console.log('search errors:');
  for (const e of searchErrors) console.log(`   ! ${e}`);
  console.log('');
}

if (send) {
  const chatId = process.env.STAGING_CHAT_ID;
  const token = process.env.BOT_TOKEN;
  if (!chatId || !token) {
    console.error('set BOT_TOKEN and STAGING_CHAT_ID to send');
  } else {
    const { Telegraf } = await import('telegraf');
    const { sendClipForApproval } = await import('../src/publish/telegram.js');
    const bot = new Telegraf(token);
    for (const c of clips) {
      await sendClipForApproval(bot.telegram, chatId, c, clipApprovalMessage(c), {});
      console.log(`sent ${c.id}`);
    }
  }
}

await closeBrowser().catch(() => {});
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
