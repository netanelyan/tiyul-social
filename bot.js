import { loadEnv } from './src/env.js';
loadEnv();

import { Telegraf, Markup } from 'telegraf';
import * as store from './src/store.js';
import * as notify from './src/notify.js';
import { runOnce, dailyTarget } from './src/pipeline.js';
import { toCandidate, RejectedError } from './src/candidate.js';
import { primaryAuthority, enabledSources, registry } from './src/sources/index.js';
import { approvalMessage, decidedMessage, evidenceReport, channelCaption, instagramCaption } from './src/format.js';
import { renderCard, closeBrowser } from './src/render/index.js';
import { publishTelegram, sendForApproval } from './src/publish/telegram.js';
import { publishInstagram, instagramConfigured, remainingQuota } from './src/publish/instagram.js';
import { imagesEnabled } from './src/images.js';
import { reasonHe } from './src/verify.js';
import { LAYOUT_HE } from './src/render/templates.js';

// Kept from BrickDeal for the same reason it exists there: a third-party
// promise chain we never get a reference to can reject, and Node's default
// since v15 is to kill the process. Catching at the boundary is what actually
// stops a crash loop, since the throw isn't in code we can wrap.
process.on('unhandledRejection', (reason) => {
  console.error('unhandled rejection (kept process alive):', reason?.stack || reason);
});
process.on('uncaughtException', (err) => {
  console.error('uncaught exception (kept process alive):', err?.stack || err);
});

const {
  TG_BOT_TOKEN,
  CHANNEL_ID,
  STAGING_CHAT_ID,
  OWNER_ID,
  POST_INTERVAL_MINUTES = '240',
  RUN_HOUR = '8',
  REJECT_DIGEST_HOURS = '6',
  REJECT_NOTIFY = 'digest', // off | each | digest
  QUIET_ALERT_HOURS = '30',
} = process.env;

if (!TG_BOT_TOKEN || !CHANNEL_ID) {
  console.error('Set TG_BOT_TOKEN and CHANNEL_ID in .env');
  process.exit(1);
}
// Fail closed, exactly as BrickDeal does: with no known owner there is nobody
// to lock the bot to, and this bot can publish. Refusing to start beats
// quietly accepting commands from whoever finds the username.
if (!OWNER_ID) {
  console.error('Set OWNER_ID in .env (your Telegram user id) so the bot only responds to you.');
  process.exit(1);
}
if (!STAGING_CHAT_ID) {
  console.error('Set STAGING_CHAT_ID in .env — nothing publishes without an approval tap, so there must be somewhere to send approvals.');
  process.exit(1);
}

const bot = new Telegraf(TG_BOT_TOKEN);
const staging = STAGING_CHAT_ID;
const intervalMs = Math.max(1, Number(POST_INTERVAL_MINUTES)) * 60_000;

// String comparison sidesteps float-precision edge cases with large Telegram ids.
const isOwner = (ctx) => String(ctx.from?.id) === String(OWNER_ID);

// Registered before every other handler, so nothing below it — message,
// command, or button tap — runs for anyone else.
bot.use(async (ctx, next) => {
  if (isOwner(ctx)) return next();
  console.log(`blocked non-owner update from ${ctx.from?.id ?? 'unknown'} (${ctx.from?.username || 'no username'})`);
  if (ctx.callbackQuery) {
    // Also clears the spinner on their end; a bare return leaves it turning.
    await ctx.answerCbQuery('⛔ not authorized').catch(() => {});
    return;
  }
  await ctx.reply('⛔ not authorized').catch(() => {});
});

// ---------------------------------------------------------------------------
// Staging
// ---------------------------------------------------------------------------

function stagingButtons(key) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ אשר ופרסם', `ok:${key}`), Markup.button.callback('❌ דחה', `no:${key}`)],
    [Markup.button.callback('✏️ ערוך כותרת', `edit:${key}`), Markup.button.callback('📎 ציטוטים', `ev:${key}`)],
  ]);
}

async function stage(cand) {
  const key = store.addStaging(cand);
  await sendForApproval(bot.telegram, staging, cand, approvalMessage(cand), stagingButtons(key));
  lastStagedAt = Date.now();
  return key;
}

// Rewrite the card in place so a decision is visible at a glance and can't be
// double-tapped. Edits whichever of caption/text the message was sent as.
async function markDecided(ctx, statusLine, cand) {
  const isPhoto = Boolean(ctx.callbackQuery?.message?.photo);
  const edit = isPhoto ? ctx.editMessageCaption.bind(ctx) : ctx.editMessageText.bind(ctx);
  await edit(decidedMessage(statusLine, cand)).catch((e) =>
    console.error('approval UX: edit failed:', e.message)
  );
  // A dedicated call — folding reply_markup into the text edit above isn't
  // reliable for actually clearing the keyboard.
  await ctx.editMessageReplyMarkup(undefined).catch(() => {});
}

bot.action(/^ok:(.+)$/, async (ctx) => {
  const key = ctx.match[1];
  const cand = store.takeStaging(key);
  if (!cand) return ctx.answerCbQuery('כבר טופל');
  store.clearPendingEdit(key);
  store.enqueue(cand);
  const pos = store.queueSize();
  await ctx.answerCbQuery(`✅ אושר — ${pos} בתור`);
  await markDecided(ctx, `✅ אושר — ${pos} בתור`, cand);
});

bot.action(/^no:(.+)$/, async (ctx) => {
  const key = ctx.match[1];
  const cand = store.takeStaging(key);
  if (!cand) return ctx.answerCbQuery('כבר טופל');
  store.clearPendingEdit(key);
  await ctx.answerCbQuery('❌ נדחה');
  await markDecided(ctx, '❌ נדחה', cand);
});

bot.action(/^ev:(.+)$/, async (ctx) => {
  const cand = store.getStaging(ctx.match[1]);
  if (!cand) return ctx.answerCbQuery('כבר טופל');
  await ctx.answerCbQuery();
  await notify.send(bot.telegram, staging, evidenceReport(cand));
});

bot.action(/^edit:(.+)$/, async (ctx) => {
  const key = ctx.match[1];
  const cand = store.getStaging(key);
  if (!cand) return ctx.answerCbQuery('כבר טופל');

  const chatId = ctx.chat.id;
  const cardMessageId = ctx.callbackQuery.message.message_id;
  const cardIsPhoto = Boolean(ctx.callbackQuery.message.photo);

  await ctx.answerCbQuery('✏️ שלח כותרת מתוקנת');
  // Freeze the card mid-edit so it can't be approved against text that's about
  // to change underneath it. The item stays in staging throughout.
  await markDecided(ctx, '✏️ ממתין לכותרת מתוקנת...', cand);

  const prompt = await ctx.reply('✏️ שלח כותרת חדשה לכרטיס שלמעלה (בתשובה להודעה הזו)', {
    reply_parameters: { message_id: cardMessageId },
    ...Markup.forceReply(),
  });

  // Keyed by the staged item, never by chat — several cards can be mid-edit at
  // once without one tap stealing another's reply.
  store.setPendingEdit(key, { chatId, promptMessageId: prompt.message_id, cardMessageId, cardIsPhoto });
});

/**
 * Apply an edited headline.
 *
 * Unlike BrickDeal's equivalent, this cannot just swap a line of text: the
 * headline is baked into a rendered JPEG, so the card has to be re-rendered or
 * the image and the caption would disagree — and the image is what publishes.
 */
async function handleEditReply(ctx, key) {
  const pending = store.getPendingEdit(key);
  store.clearPendingEdit(key);
  const cand = store.getStaging(key);
  if (!pending || !cand) return ctx.reply('הפריט הזה כבר לא ממתין לעריכה');

  const newHeadline = (ctx.message.text || ctx.message.caption || '').replace(/\s+/g, ' ').trim();
  if (!newHeadline) {
    store.setPendingEdit(key, pending); // nothing consumed — leave it pending
    return ctx.reply('שלח טקסט (לא תמונה/מדבקה)');
  }

  const updated = { ...cand, headline: newHeadline };
  try {
    updated.card = await renderCard(updated, { id: cand.id, data: cand.data, image: cand.image });
  } catch (e) {
    store.setPendingEdit(key, pending);
    return ctx.reply(`רינדור הכרטיס נכשל: ${e.message}`);
  }
  updated.channelCaption = channelCaption(updated);
  updated.instagramCaption = instagramCaption(updated);
  store.updateStaging(key, updated);

  // The old message carried the old image, so it can't be edited in place —
  // the card is re-sent with fresh buttons instead.
  await sendForApproval(bot.telegram, pending.chatId, updated, approvalMessage(updated), stagingButtons(key));
  await ctx.reply('✏️ הכותרת עודכנה והכרטיס רונדר מחדש — אשר/דחה למעלה');
}

// ---------------------------------------------------------------------------
// Manual submission
// ---------------------------------------------------------------------------

const URL_RE = /https?:\/\/[^\s<>"')]+/gi;

async function ingestUrl(url, ctx) {
  const authority = primaryAuthority(url);
  if (!authority) {
    return ctx.reply(
      `⛔ ${new URL(url).hostname} לא ברשימת המקורות הראשוניים.\n` +
        'אפשר להוסיף אותו ל-sources.json אם הוא באמת מקור ראשוני.'
    );
  }

  await ctx.reply('⏳ בודק את המקור וכותב טיוטה...');
  const item = {
    sourceId: 'manual',
    sourceName: 'הגשה ידנית',
    authority: 'government',
    lang: 'en',
    pillarHints: [],
    title: url,
    summary: '',
    url,
    publishedAt: null,
  };

  try {
    const cand = await toCandidate(item);
    await stage(cand);
    logReject(null);
  } catch (err) {
    const reason = err instanceof RejectedError ? err.reason : 'error';
    const detail = err instanceof RejectedError ? err.detail : err.message;
    await ctx.reply(`❌ נפסל: ${reasonHe(reason)}\n${detail || ''}`.trim());
  }
}

bot.on('message', async (ctx, next) => {
  const replyToId = ctx.message?.reply_to_message?.message_id;
  const editKey = replyToId ? store.findPendingEditByPrompt(replyToId) : null;
  if (editKey) return handleEditReply(ctx, editKey);

  const text = ctx.message?.text || ctx.message?.caption || '';
  const urls = text.match(URL_RE) || [];
  if (!urls.length) return next?.();
  for (const url of urls) await ingestUrl(url, ctx);
});

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

async function publishNext() {
  const cand = store.dequeue();
  if (!cand) return false;

  let tg = null;
  let ig = null;
  let error = null;

  try {
    tg = await publishTelegram(bot.telegram, CHANNEL_ID, cand);
  } catch (e) {
    // Telegram failing is the one that matters — put it back so an outage
    // doesn't silently eat something you already approved.
    console.error('publish: telegram failed:', e.message);
    store.enqueue(cand);
    await notify.send(bot.telegram, staging, notify.publishFailed(cand.headline, 'טלגרם', e.message));
    return false;
  }

  if (instagramConfigured()) {
    try {
      ig = await publishInstagram(cand);
    } catch (e) {
      // Deliberately non-fatal and deliberately NOT a re-queue: the post is
      // already live in the channel, so retrying the whole item would double-post
      // there. Instagram is reported as failed and left for a manual decision.
      console.error('publish: instagram failed:', e.message);
      error = `אינסטגרם נכשל: ${e.message}`;
    }
  }

  store.recordPublished({
    id: cand.id,
    pillar: cand.pillar,
    tags: cand.tags,
    layout: cand.layout,
    telegram: Boolean(tg),
    instagram: Boolean(ig),
  });

  await notify.send(
    bot.telegram,
    staging,
    notify.published({ headline: cand.headline, telegram: Boolean(tg), instagram: Boolean(ig), error })
  );
  return true;
}

// ---------------------------------------------------------------------------
// Gather runs
// ---------------------------------------------------------------------------

let running = false;
let lastRunAt = null;
let lastStagedAt = null;
let lastRunDay = null;
let quietAlertSent = false;

// Rolling record of what the filters rejected, so /why and the digest can show
// the actual items rather than a count.
let rejectLog = [];
let rejectQueue = [];
const REJECT_LOG_MAX = 300;
let activity = [];

function logReject(entry) {
  if (!entry) return;
  const row = { ts: Date.now(), ...entry };
  rejectLog.push(row);
  if (rejectLog.length > REJECT_LOG_MAX) rejectLog.shift();
  if (REJECT_NOTIFY === 'each') {
    notify.send(bot.telegram, staging, notify.rejectSingle(row)).catch(() => {});
  } else if (REJECT_NOTIFY === 'digest') {
    rejectQueue.push(row);
  }
}

async function doRun({ announce = true } = {}) {
  if (running) return null;
  running = true;
  try {
    const summary = await runOnce({
      onStaged: async (cand) => {
        await stage(cand);
        activity.push({ ts: Date.now(), type: 'staged' });
      },
      onRejected: async (r) => {
        logReject(r);
        activity.push({ ts: Date.now(), type: 'rejected', reason: r.reason });
      },
    });
    lastRunAt = Date.now();
    activity.push({ ts: lastRunAt, type: 'run', gathered: summary.gathered });
    if (announce) await notify.send(bot.telegram, staging, notify.runReport(summary));
    return summary;
  } finally {
    running = false;
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

bot.command('run', async (ctx) => {
  if (running) return ctx.reply('⏳ כבר רץ סבב איסוף');
  await ctx.reply(`⏳ מריץ סבב — עד ${dailyTarget()} פריטים`);
  await doRun();
});

bot.command('pending', (ctx) => ctx.reply(`⏳ ${store.stagingSize()} ממתינים לאישור`));
bot.command('queue', (ctx) => ctx.reply(`📦 ${store.queueSize()} בתור לפרסום`));

bot.command('next', async (ctx) => {
  const ok = await publishNext();
  await ctx.reply(ok ? '📤 פורסם הפריט הבא' : 'התור ריק');
});

bot.command('clear_pending', (ctx) => {
  const n = store.clearStaging();
  ctx.reply(`🧹 נוקו ${n} פריטים ממתינים`);
});

bot.command('sources', (ctx) => {
  const { sources } = registry();
  const on = sources.filter((s) => s.enabled).map((s) => `✅ ${s.id} — ${s.name}`);
  const off = sources.filter((s) => !s.enabled).map((s) => `⬜ ${s.id} — ${s.note?.split('.')[0] || 'כבוי'}`);
  ctx.reply(['📚 מקורות', ...on, '', 'כבויים:', ...off].join('\n'));
});

bot.command('mix', (ctx) => ctx.reply(notify.mixReport(store.recentPublished())));

bot.command('why', (ctx) => {
  const arg = Number((ctx.message.text || '').split(' ')[1]);
  const n = Number.isFinite(arg) && arg > 0 ? Math.min(Math.floor(arg), 25) : 10;
  const items = rejectLog.slice(-n).reverse();
  if (!items.length) return ctx.reply('✅ שום דבר לא נפסל לאחרונה');
  ctx.reply(notify.rejectDigest(items, 'האחרונות'));
});

bot.command('status', async (ctx) => {
  const dayAgo = Date.now() - 24 * 3_600_000;
  const recent = activity.filter((a) => a.ts >= dayAgo);
  const rejectedByReason = {};
  for (const r of rejectLog.filter((r) => r.ts >= dayAgo)) {
    rejectedByReason[r.reason] = (rejectedByReason[r.reason] || 0) + 1;
  }
  await ctx.reply(
    notify.statusReport({
      sourceCount: enabledSources().length,
      stagingSize: store.stagingSize(),
      queueSize: store.queueSize(),
      gathered: recent.filter((a) => a.type === 'run').reduce((s, a) => s + (a.gathered || 0), 0),
      staged: recent.filter((a) => a.type === 'staged').length,
      rejected: recent.filter((a) => a.type === 'rejected').length,
      rejectedByReason,
      publishedToday: store.publishedToday(),
      lastRunAgoMs: lastRunAt ? Date.now() - lastRunAt : null,
      postIntervalMinutes: POST_INTERVAL_MINUTES,
      instagram: instagramConfigured(),
    })
  );
});

bot.command('igquota', async (ctx) => {
  if (!instagramConfigured()) return ctx.reply('אינסטגרם לא מוגדר');
  try {
    const left = await remainingQuota();
    ctx.reply(left == null ? 'לא התקבלה מכסה מ-Graph API' : `📸 נותרו ${left} פרסומים ב-24 השעות הקרובות`);
  } catch (e) {
    ctx.reply(`שגיאה: ${e.message}`);
  }
});

bot.command('help', (ctx) =>
  ctx.reply(
    [
      'פקודות:',
      '/run — סבב איסוף עכשיו',
      '/status — סטטוס מלא',
      '/pending /queue /next',
      '/why [n] — מה נפסל ולמה',
      '/mix — תמהיל הנושאים שפורסמו',
      '/sources — רשימת המקורות',
      '/igquota — מכסת אינסטגרם',
      '/clear_pending',
      '',
      'אפשר גם להדביק כתובת של מקור ראשוני והיא תיבדק ותיכתב.',
    ].join('\n')
  )
);

// ---------------------------------------------------------------------------
// Timers
// ---------------------------------------------------------------------------

function tick() {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);

  // One gather a day, at RUN_HOUR local. Guarded by the date rather than by a
  // timer so a restart mid-day doesn't trigger a second run.
  if (day !== lastRunDay && now.getHours() >= Number(RUN_HOUR)) {
    lastRunDay = day;
    doRun().catch((e) => console.error('daily run failed:', e.message));
  }

  if (lastStagedAt) {
    const quiet = (Date.now() - lastStagedAt) / 3_600_000;
    if (quiet > Math.max(1, Number(QUIET_ALERT_HOURS)) && !quietAlertSent) {
      quietAlertSent = true;
      notify.send(bot.telegram, staging, notify.quietAlert(Math.floor(quiet))).catch(() => {});
    } else if (quiet <= Number(QUIET_ALERT_HOURS)) {
      quietAlertSent = false;
    }
  }
}

function sendRejectDigest() {
  if (REJECT_NOTIFY !== 'digest' || !rejectQueue.length) return;
  const items = rejectQueue;
  rejectQueue = [];
  return notify.send(bot.telegram, staging, notify.rejectDigest(items, REJECT_DIGEST_HOURS));
}

// ---------------------------------------------------------------------------

async function main() {
  console.log('starting tiyul+ ...');

  // launch() never resolves during normal operation — it *is* the long-poll
  // loop. Awaiting it queues everything after it behind a promise that only
  // settles at shutdown, which looks exactly like a startup hang. Confirm
  // connectivity with getMe() instead, then fire launch() without awaiting.
  const me = await bot.telegram.getMe();
  bot.botInfo = me;
  bot.launch().catch((e) => {
    console.error('bot polling stopped with an error:', e.message);
    process.exit(1);
  });

  console.log(`bot live (@${me.username})`);
  console.log(`   owner lock: ON (only ${OWNER_ID})`);
  console.log(`   sources: ${enabledSources().length} enabled`);
  console.log(`   instagram: ${instagramConfigured() ? 'configured' : 'NOT configured (telegram only)'}`);
  console.log(`   images: ${imagesEnabled() ? 'a provider is configured' : 'text-led cards only'}`);
  console.log(`   daily run at ${RUN_HOUR}:00 · target ${dailyTarget()} · drip every ${POST_INTERVAL_MINUTES} min`);

  setInterval(() => {
    publishNext().catch((e) => console.error('publish error:', e.message));
  }, intervalMs);

  setInterval(tick, 60_000);
  setInterval(
    () => sendRejectDigest()?.catch?.((e) => console.error('reject digest error:', e.message)),
    Math.max(1, Number(REJECT_DIGEST_HOURS)) * 3_600_000
  );

  await notify.send(
    bot.telegram,
    staging,
    notify.startupPing({
      sourceCount: enabledSources().length,
      queueSize: store.queueSize(),
      stagingSize: store.stagingSize(),
      instagram: instagramConfigured(),
      images: imagesEnabled(),
    })
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

const shutdown = async (sig) => {
  await closeBrowser();
  bot.stop(sig);
};
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
