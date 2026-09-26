import { loadEnv } from '../src/env.js';
import { buildClips, clipApprovalMessage, clipShapeArg } from '../src/video/clip.js';
import { closeBrowser } from '../src/render/index.js';

// Build a batch of clips and look at them.
//
//   npm run clip-lab              5 clips to out/clips, nothing sent
//   npm run clip-lab -- 8         eight of them
//   npm run clip-lab -- 2 cuts    two of one shape, skipping the alternation
//   npm run clip-lab -- 1 held    the single-shot shape on its own
//   npm run clip-lab -- 5 send    ...and DM them to STAGING_CHAT_ID
//
// Naming the shape is the point of this script now. The two shapes alternate in
// production, so a change to ONE of them takes two runs to see and the run you
// want is the second — which is how a shape gets tuned by reading the code
// instead of by watching the output.
//
// Deliberately does not stage anything into the approval queue. Nothing here
// can publish, and nothing here is waiting for a decision — this is the step
// where the taste filter and the lines get judged, and a queue full of clips
// you have not seen yet would be the wrong place to do that.

loadEnv();

const args = process.argv.slice(2);
const count = Number(args.find((a) => /^\d+$/.test(a))) || 5;
const shape = clipShapeArg(args.join(' '));
const send = args.includes('send');

const t0 = Date.now();
console.log(`building ${count} clip(s)${shape ? ` · ${shape} only` : ''}…\n`);

const { clips, considered, vetoed, failed, searchErrors, ffmpeg, written, asked, shapes } =
  await buildClips({
    count,
    shapes: shape ? Array.from({ length: count }, () => shape) : null,
  });

console.log(`ffmpeg: ${ffmpeg}`);
console.log(`${considered} clip(s) passed the filter, ${clips.length} built`);
console.log(`asked for ${asked.join(', ')} · got ${shapes.join(', ') || 'nothing'}\n`);

for (const c of clips) {
  console.log(`  ${c.clip.file}`);
  console.log(`     “${c.hook}”${c.hookWritten ? '' : `   ⚠️ pool - ${c.hookNote || 'no line written'}`}`);
  // A cuts clip's shots are the thing being judged, and the labels are what the
  // viewer reads. Printed in play order with the seconds, because "the hook is
  // too long" is a question about the first number in this list.
  if (c.clip.shape === 'cuts') {
    console.log(`     ${c.clip.seconds}s · ${c.clip.cuts.length} cuts · ${c.clip.hookFormat}${c.clip.country ? ` · all in ${c.clip.country}` : ' · several countries'}`);
    for (const [i, cut] of c.clip.cuts.entries()) {
      console.log(`       ${i + 1}. ${i === 0 ? `(hook) ${cut.label}` : cut.label}  ·  Pexels ${cut.pexelsId}`);
    }
  } else {
    console.log(`     ${c.clip.seconds}s · one shot · ${c.clip.title}  ·  score ${c.clip.score}  ·  "${c.clip.query}"`);
  }
  if (c.clip.spot) {
    const s = c.clip.spot;
    console.log(`     text ${s.onDark ? 'light' : 'dark'} @ y=${s.y}  ·  worst contrast ${s.worstContrast}  ·  ${s.agreed}/${s.frames} frames agreed`);
  }
  console.log(`     ${c.tiktokCaption.split('\n')[0]}`);
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
