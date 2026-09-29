import { readFileSync } from 'node:fs';
import { loadEnv } from './src/env.js';
loadEnv();

import { Telegraf, Markup } from 'telegraf';
import * as store from './src/store.js';
import { usageReport, forKind } from './src/usage.js';
import * as notify from './src/notify.js';
import { runOnce, dailyTarget } from './src/pipeline.js';
import { toCandidate, RejectedError } from './src/candidate.js';
import { primaryAuthority, enabledSources, registry } from './src/sources/index.js';
import { approvalMessage, decidedMessage, evidenceReport, channelCaption, publishedDescriptions } from './src/format.js';
import { sendableNow, windowsHe } from './src/schedule.js';
import { renderCard, closeBrowser, cardOutputDir } from './src/render/index.js';
import { startAdminServer, createLogTap } from './src/admin/server.js';
import { stagedView, queuedView, heldView } from './src/admin/views.js';
import { publishTelegram, publishTelegramDeck, sendForApproval } from './src/publish/telegram.js';
import { proposeIdeas, titleForRequest, reviseIdea, freeformIdea, freeformFromIdea } from './src/deck/ideas.js';
import { pickAngle } from './src/angles.js';
import { postConfig } from './src/postConfig.js';
import { notePublished as noteMetricsPublished, collect as collectMetrics, describeCollection, weeklyReport } from './src/metrics/index.js';
import { clipPublicUrl } from './src/publish/imageHosts.js';
import { buildDeck } from './src/deck/build.js';
import { toDeckCandidate, deckTopic } from './src/deck/candidate.js';
import { placeOverCap } from './src/pillars.js';
import { canonicalKind } from './src/sources/tiyulplus.js';
import { KINDS, isSourcedKind } from './src/sources/places.js';
import { resolveRequest } from './src/deck/request.js';
import { parseTripArgs, BUDGET_MIN, BUDGET_MAX } from './src/plan/budget.js';
import { startIgWebhook } from './src/igReplies/server.js';
import { buildWithFallback, describeAttempt } from './src/deck/attempt.js';
import { buildFreeformDeck } from './src/deck/build.js';
import { searchConfigured, remaining as searchRemaining, dailyBudget as searchBudget } from './src/search.js';
import {
  publishInstagram,
  instagramConfigured,
  remainingQuota,
  refreshToken,
  tokenDaysLeft,
  authMode,
  describeError,
  isPlatformLimit as isPlatformLimitInstagram,
} from './src/publish/instagram.js';
import {
  publishTikTok,
  tiktokConfigured,
  creatorInfo,
  defaultPrivacy,
  nextPrivacy,
  privacyHe,
  refreshTikTokToken,
  tokenHoursLeft as tiktokHoursLeft,
  refreshTokenDaysLeft as tiktokRefreshDaysLeft,
  describeError as describeTikTokError,
  isCardLevel as isCardLevelTikTok,
  isPlatformLimit as isPlatformLimitTikTok,
  isConfigProblem as isConfigProblemTikTok,
  missingScopes as tiktokMissingScopes,
  authorizeUrl,
  SCOPES as TIKTOK_SCOPES,
  TIKTOK_DAILY_CAP,
} from './src/publish/tiktok.js';
import {
  publishTargets,
  targetsForKind,
  liveTargets,
  targetsHe,
  TARGET_HE,
  allowedForKind,
  manualForKind,
} from './src/publish/targets.js';
import { imagesEnabled } from './src/images.js';
import { runOverridden, noteOverride, overrideNotes } from './src/override.js';
import { startOAuthServer, stopOAuthServer } from './src/oauthServer.js';
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
  // SIX HOURS, NOT FOUR. Four spaced the drip to six publishes a day, and with
  // the old budgets, three cards, two decks, Instagram was receiving five
  // image posts a day from an account with single-figure followers. Volume is
  // not penalised on its own, but a run of posts that underperform drags the
  // account-level quality signal that decides how the NEXT one is distributed,
  // so five weak posts a day is a machine for producing that run.
  //
  // Six hours is four publishes a day, which is exactly what the daily budgets
  // below now add up to. That equality is load-bearing rather than tidy: the
  // drip is one queue shared by every kind, so budgets that sum to more than
  // the drip can publish do not post more, they grow a backlog for ever. See
  // the boot check in main().
  POST_INTERVAL_MINUTES = '360',
  RUN_HOUR = '8',
  // Gather repeatedly through the day, not once. Cards should arrive when the
  // news does; the daily cap is what keeps that honest.
  GATHER_EVERY_HOURS = '2',
  // Last hour a gather may start. Nothing should arrive overnight.
  GATHER_UNTIL_HOUR = '22',
  REJECT_DIGEST_HOURS = '6',
  // off | each | digest, and it DEFAULTS TO OFF.
  //
  // A digest every six hours is four messages a day about posts that were
  // filtered out, which is four messages a day about nothing you have to do.
  // The information is not lost and was never only here: /status prints what was
  // rejected today and the reason for each, on demand, which is the right shape
  // for something you consult when the queue looks thin rather than something
  // that interrupts you when it does not.
  REJECT_NOTIFY = 'off',
  QUIET_ALERT_HOURS = '30',
} = process.env;

if (!TG_BOT_TOKEN) {
  console.error('Set TG_BOT_TOKEN in .env');
  process.exit(1);
}
// At least one KIND has to have somewhere to go, or approving something sends
// it nowhere.
//
// Asked per kind rather than globally, which matters now that nothing publishes
// to Telegram. A global check counts CHANNEL_ID as a destination, so a box with
// a channel configured and neither Instagram nor TikTok would start cleanly and
// then silently eat everything approved — which is the exact failure this guard
// was written to prevent, surviving as a check that no longer measures it.
if (!targetsForKind('card').length && !targetsForKind('deck').length) {
  console.error(
    'No publish destination configured. Cards go to Instagram ' +
      '(IG_USER_ID + IG_ACCESS_TOKEN + CARD_PUBLIC_BASE_URL) and decks go to TikTok ' +
      '(npm run tiktok-token, or connect it from the browser). Set up at least one.\n' +
      'CHANNEL_ID no longer counts: Telegram is where you approve posts, not where they publish.'
  );
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
  console.error('Set STAGING_CHAT_ID in .env - nothing publishes without an approval tap, so there must be somewhere to send approvals.');
  process.exit(1);
}

// Telegraf times a handler out at 90 seconds by default, and the timeout does
// not merely abandon the handler: it rejects, the rejection reaches
// bot.launch()'s promise, and the catch there exits the process. So a slow
// command was killing the bot.
//
// Every long command now answers immediately and does its work detached (see
// detach below), which is the actual fix. This raises the ceiling anyway,
// because the next long thing somebody adds should degrade into a late reply
// rather than a restart.
const bot = new Telegraf(TG_BOT_TOKEN, {
  handlerTimeout: Number(process.env.HANDLER_TIMEOUT_MS || 600_000),
});

/**
 * Run something slow without holding the update open.
 *
 * A gather takes minutes and a deck takes longer. Awaiting that inside a
 * command handler is what produced "Promise timed out after 90000
 * milliseconds" followed by a restart — mid-gather, so the run was lost and the
 * approval it was about to send never arrived.
 *
 * Errors are reported to the chat rather than thrown, because there is no
 * longer an update to attach them to by the time they happen.
 */
function detach(label, work, chatId = staging) {
  Promise.resolve()
    .then(work)
    .catch(async (e) => {
      console.error(`${label} failed:`, e?.stack || e);
      await notify.send(bot.telegram, chatId, notify.withDetail(`❌ ${label} נכשל`, e)).catch(() => {});
    });
}

/**
 * The same function, with everything it spends billed to one kind of post.
 *
 * Applied to the JOB rather than at the call sites, and the difference is worth
 * being explicit about: `doRun` is reached from the timer, from /run, from
 * /redo and from the admin site, and `buildProposal` from a button, a slash
 * command and an HTTP request. Wrapping the declaration is the only version of
 * this where a caller added next month cannot arrive without a scope — which
 * matters more than it sounds, because the failure is silent. An unwrapped call
 * does not break, it just quietly files its cost under `other` and makes the
 * readout wrong in the direction nobody checks.
 *
 * Nesting is fine and happens: suggestDeck calls pickIdea and both are billed
 * to decks, so the inner scope sets the value it already had.
 */
const billed = (kind, fn) => (...args) => forKind(kind, () => fn(...args));
const staging = STAGING_CHAT_ID;
const intervalMs = Math.max(1, Number(POST_INTERVAL_MINUTES)) * 60_000;
const gatherIntervalMs = Math.max(0.25, Number(GATHER_EVERY_HOURS)) * 3_600_000;

// Without this, an error thrown anywhere in a handler propagates out of
// Telegraf's update loop, rejects the promise bot.launch() returned, and the
// catch on that call exits the process. So a stale callback query — "query is
// too old", which happens whenever you tap a button on a card from before the
// last restart — was enough to restart the bot, which produced more stale
// buttons. Handled here, they stay what they are: one failed tap.
bot.catch((err, ctx) => {
  console.error(`handler error on ${ctx?.updateType || 'update'}:`, err?.stack || err);
});

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
  await ctx.reply('⛔ אין הרשאה').catch(() => {});
});

// ---------------------------------------------------------------------------
// Staging
// ---------------------------------------------------------------------------

/** One glyph per kind, used everywhere a list of pending items is printed. */
const kindIcon = (kind) =>
  kind === 'deck' ? '🎞️' : kind === 'clip' ? '🎬' : kind === 'plan' ? '🗺️' : kind === 'post' ? '🧭' : '📰';

function stagingButtons(key, cand) {
  const rows = [
    [Markup.button.callback('✅ אשר ופרסם', `ok:${key}`), Markup.button.callback('❌ דחה', `no:${key}`)],
  ];
  // Editing a headline re-renders one card. On a deck it would re-render every
  // slide at both sizes, and the title lives on the cover alone — so a deck is
  // approved or rejected as a whole, and a wrong title is a re-run.
  // A clip carries no quotes — its only claim is the country, and that is
  // printed on the approval message with the confidence it was named at. So
  // there is nothing to show behind an evidence button and nothing to edit: the
  // line is one field and a wrong one is a re-run, exactly like a deck's title.
  //
  // A PLAN carries no quotes either, and for a different reason worth being
  // blunt about: nothing in it was sourced. It is a proposal, not a set of
  // facts, so an evidence button would open on an empty list and imply the
  // opposite. What replaces it is that the approval card prints the whole
  // itinerary — see planApprovalMessage.
  // A POST carries no evidence button either, and for the opposite reason to a plan's:
  // everything quotable on it IS quoted, on the approval card, under "מה שמצוטט מהדף" -
  // so a button would open on a list the card already printed in full.
  if (cand?.kind !== 'clip' && cand?.kind !== 'plan' && cand?.kind !== 'post') {
    rows.push(
      cand?.kind === 'deck'
        ? [Markup.button.callback('📎 ציטוטים', `ev:${key}`)]
        : [Markup.button.callback('✏️ ערוך כותרת', `edit:${key}`), Markup.button.callback('📎 ציטוטים', `ev:${key}`)]
    );
  }
  // Only when there is a real choice to make. With one privacy level available
  // — the unaudited case, where TikTok offers SELF_ONLY and nothing else — a
  // button that cycles back to the same value is a button that lies about
  // having options.
  if (cand?.tiktok?.options?.length > 1) {
    rows.push([
      Markup.button.callback(`🔒 פרטיות: ${privacyHe(cand.tiktok.privacy)}`, `tp:${key}`),
    ]);
  }
  return Markup.inlineKeyboard(rows);
}

/**
 * Ask TikTok who we would be posting as, and which privacy levels it allows.
 *
 * Done at staging rather than at publish time, because the answer has to be on
 * the card you are looking at when you tap approve — that is TikTok's rule for
 * Direct Post and the reason this call exists. A failure here does not block
 * staging: the card still goes out for approval carrying the reason, and the
 * publish attempt is what fails, loudly, with the same message.
 */
async function attachTikTok(cand) {
  if (!cand.publishTargets?.includes('tiktok')) return cand;
  // A draft has no privacy level to show you. TikTok asks you in the app when
  // you post it, so asking creator_info here would spend a call to display a
  // choice that is not yours to make — and the list it returns is the one the
  // file's header warns is a courtesy rather than a guarantee.
  if (cand.tiktokDraft) return cand;
  try {
    const info = await creatorInfo();
    return {
      ...cand,
      tiktok: {
        username: info.username,
        options: info.options,
        privacy: defaultPrivacy(info.options),
      },
    };
  } catch (e) {
    const detail = describeTikTokError(e);
    console.error('tiktok: creator_info failed:', detail);
    return { ...cand, tiktok: { error: detail, options: [] } };
  }
}

async function stage(candidate) {
  const cand = await attachTikTok(candidate);
  const key = store.addStaging(cand);
  try {
    const sent = await sendForApproval(bot.telegram, staging, cand, approvalMessage(cand), stagingButtons(key, cand));
    // WHERE THE CARD LANDED, so a decision made anywhere else can close it.
    //
    // The result of sendForApproval is always the message carrying the BUTTONS —
    // for a deck that is the text under the album, not the album — and without
    // recording it a card approved on the admin site sits in Telegram with live
    // buttons under it forever. Tapping them is safe (takeStaging returns
    // nothing and the tap says "כבר טופל"), but a chat full of cards that look
    // undecided is the same problem /resend was written for, arriving from the
    // other direction.
    // Top-level rather than tucked under `card`, which is the FILE to publish and
    // is read by the publishers. Two unrelated things under one key is how a
    // field gets published by accident.
    store.updateStaging(key, {
      ...cand,
      approvalCard: { chatId: staging, messageId: sent?.message_id ?? null, isPhoto: Boolean(sent?.photo) },
    });
  } catch (e) {
    // A send that fails leaves a post staged and INVISIBLE. It has to be added
    // before the send — the key is what the buttons carry — so the item exists,
    // is counted by /pending, and has no card in the chat to act on. Six of
    // those and the bot looks like it has stopped working while it is in fact
    // waiting for you.
    //
    // The likeliest cause is Telegram refusing a burst: a gather that drafts
    // five cards sends five photos in a row, and 429 is not a rare answer to
    // that. Not worth failing the post over — the post is fine — so it says so
    // and /resend picks it up.
    console.error(`stage: card did not reach you - ${e?.message || e}`);
    await notify
      .send(bot.telegram, staging, `⚠️ פוסט נוצר אבל הכרטיס לא נשלח (${store.stagingSize()} ממתינים) · /resend`)
      .catch(() => {});
    return key;
  }
  // Stamped after the send, so the quiet alarm measures cards that actually
  // arrived — not ones that were built and then failed to reach you.
  store.noteStagedAt();
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

// ---------------------------------------------------------------------------
// The decisions themselves, with no channel in them
// ---------------------------------------------------------------------------
//
// EXTRACTED SO THERE IS ONE OF EACH. These used to live inside the Telegraf
// handlers, tangled with `ctx` — which was fine while Telegram was the only way
// to approve something and became a fork in the road the moment the admin site
// existed. Two copies of "what approving means" is a promise that they drift,
// and the one that drifts is whichever is used less.
//
// So each returns a plain `{ ok, said, cand }` and touches nothing but the
// store. Telling somebody what happened is the caller's job, because who needs
// telling is exactly what differs between a button tap and an HTTP request.
//
// `by` is who did it, and it is carried for one reason: a card that vanishes out
// of the approval chat with no explanation is indistinguishable from a bug. The
// Telegram card says "אושר באתר · name" when the site was what approved it.

function approveStaged(key, { by = null } = {}) {
  const cand = store.takeStaging(key);
  if (!cand) return { ok: false, said: 'כבר טופל' };
  store.clearPendingEdit(key);

  // A draft is a handoff, not a publish, so there is nothing for the drip to
  // pace. It goes to your TikTok inbox now and waits there for you; the
  // interval exists so the FEED does not arrive in bursts, and an inbox is not
  // a feed. Holding a draft in a queue for four hours delays only the moment
  // you could have started working on it.
  //
  // Instagram is a real post and keeps its place in the queue.
  const targets = cand.pendingTargets?.length ? cand.pendingTargets : cand.publishTargets || [];
  const draftNow = Boolean(cand.tiktokDraft) && targets.includes('tiktok');
  const queued = draftNow ? targets.filter((t) => t !== 'tiktok') : targets;

  if (queued.length) store.enqueue({ ...cand, pendingTargets: queued });
  const pos = store.queueSize();
  const said = draftNow
    ? queued.length
      ? `✅ טיוטה לטיקטוק · ${pos} בתור לאינסטגרם`
      : '✅ נשלח לטיוטות בטיקטוק'
    : `✅ אושר - ${pos} בתור`;

  // Detached rather than awaited, so a slow upload cannot leave the caller
  // hanging — a button tap that does not answer inside a few seconds shows
  // Telegram's spinner forever, and an HTTP request that does not answer looks
  // to the browser exactly like a server that has died.
  if (draftNow) {
    detach('טיוטה לטיקטוק', () => publishNext({ ...cand, pendingTargets: ['tiktok'] }), staging);
  }
  return { ok: true, said, cand, by, draftNow };
}

function rejectStaged(key, { by = null } = {}) {
  const cand = store.takeStaging(key);
  if (!cand) return { ok: false, said: 'כבר טופל' };
  store.clearPendingEdit(key);
  // Give the day's quota slot back. A rejected card is not one of "the best two
  // or three a day", and charging the day for it meant rejecting the morning's
  // three ended the day: remaining hit zero, the gather stopped looking, and
  // nothing could publish until tomorrow. offerCeiling() is what stops the
  // refund turning into an endless supply — see tick().
  store.noteRejected(localDay(new Date()));
  return { ok: true, said: '❌ נדחה', cand, by };
}

/**
 * Cycle one staged card's TikTok privacy level.
 *
 * Returns the updated candidate, because whoever asked has a card on screen
 * showing the old value and no way to derive the new one — the cycle order is
 * in nextPrivacy and the options came from TikTok at staging time.
 */
function cyclePrivacy(key) {
  const cand = store.getStaging(key);
  if (!cand) return { ok: false, said: 'כבר טופל' };
  const options = cand.tiktok?.options || [];
  if (options.length < 2) return { ok: false, said: 'אין רמות פרטיות אחרות זמינות' };

  const privacy = nextPrivacy(cand.tiktok.privacy, options);
  const updated = { ...cand, tiktok: { ...cand.tiktok, privacy } };
  store.updateStaging(key, updated);
  return { ok: true, said: `🔒 ${privacyHe(privacy)}`, cand: updated };
}

/**
 * Close a staged card's Telegram message from somewhere that is not Telegram.
 *
 * The bot's own handlers edit through `ctx`, which carries the message. A
 * decision made on the admin site has no ctx, so the ids recorded at staging
 * time are what it edits through — see `approvalCard` in stage().
 *
 * Failures are swallowed to a log line. The decision has already been made and
 * saved; a card that could not be edited is untidy, and throwing here would turn
 * that into an HTTP 500 over an action that in fact succeeded.
 */
async function closeCardElsewhere(cand, statusLine) {
  const at = cand?.approvalCard;
  if (!at?.messageId) return;
  const text = decidedMessage(statusLine, cand);
  try {
    if (at.isPhoto) await bot.telegram.editMessageCaption(at.chatId, at.messageId, undefined, text);
    else await bot.telegram.editMessageText(at.chatId, at.messageId, undefined, text);
  } catch (e) {
    console.error(`admin: could not close the Telegram card - ${e?.message || e}`);
  }
  await bot.telegram.editMessageReplyMarkup(at.chatId, at.messageId, undefined, undefined).catch(() => {});
}

bot.action(/^ok:(.+)$/, async (ctx) => {
  const res = approveStaged(ctx.match[1], { by: 'telegram' });
  if (!res.ok) return ctx.answerCbQuery(res.said);
  await ctx.answerCbQuery(res.said);
  await markDecided(ctx, res.said, res.cand);
});

bot.action(/^no:(.+)$/, async (ctx) => {
  const res = rejectStaged(ctx.match[1], { by: 'telegram' });
  if (!res.ok) return ctx.answerCbQuery(res.said);
  await ctx.answerCbQuery(res.said);
  await markDecided(ctx, res.said, res.cand);
});

bot.action(/^ev:(.+)$/, async (ctx) => {
  const cand = store.getStaging(ctx.match[1]);
  if (!cand) return ctx.answerCbQuery('כבר טופל');
  await ctx.answerCbQuery();
  await notify.send(bot.telegram, staging, evidenceReport(cand));
});

/**
 * Cycle the TikTok privacy level for one staged card.
 *
 * The card is rewritten in place so the level you are about to publish at is
 * always the level printed on the message — a button that changed hidden state
 * would defeat the point of showing it at all.
 */
bot.action(/^tp:(.+)$/, async (ctx) => {
  const key = ctx.match[1];
  const res = cyclePrivacy(key);
  if (!res.ok) return ctx.answerCbQuery(res.said);

  await ctx.answerCbQuery(res.said);
  const isPhoto = Boolean(ctx.callbackQuery?.message?.photo);
  const edit = isPhoto ? ctx.editMessageCaption.bind(ctx) : ctx.editMessageText.bind(ctx);
  await edit(approvalMessage(res.cand), stagingButtons(key, res.cand)).catch((e) =>
    console.error('approval UX: privacy edit failed:', e.message)
  );
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

// --- deck proposals (the text stage, before anything is built) ---------------

bot.action(/^db:(.+):(instagram|tiktok|both)$/, async (ctx) => {
  const key = ctx.match[1];
  const choice = ctx.match[2];
  // Instagram first in the pair, because it is the one that publishes by
  // itself — the approval message previews whichever size comes first, and
  // previewing the crop that needs no further action from you is the useful
  // way round.
  const targets = choice === 'both' ? ['instagram', 'tiktok'] : [choice];
  // Reaching TikTok always means a draft. See the button.
  const draft = targets.includes('tiktok');
  if (!store.getProposal(key)) return ctx.answerCbQuery('כבר טופל');

  // Said at the tap, not after the build. Choosing a destination that is not
  // connected is allowed — the deck is built and held until it is — but
  // learning that after waiting minutes for twelve renders is the wrong order
  // to find it out in.
  const configured = targetsForKind('deck');
  const missing = targets.filter((t) => !configured.includes(t));
  await ctx.answerCbQuery(
    missing.length
      ? `⏳ בונה - ${targetsHe(missing)} עוד לא מחובר, הפוסט ימתין`
      : draft
        ? '⏳ בונה - טיקטוק יחכה לך בטיוטות'
        : '⏳ בונה'
  );
  await ctx.editMessageReplyMarkup(undefined).catch(() => {});

  // Detached for the same reason the command was: a build is minutes of work
  // and holding it inside the handler overran Telegraf's timeout. And wrapped
  // in runOverridden again, because an AsyncLocalStorage context cannot survive
  // the wait for you to tap a button — without this, a deck you asked for by
  // name would be judged by guards the override exists to step over.
  const chatId = ctx.chat.id;
  const messageId = ctx.callbackQuery.message.message_id;
  detach(
    'בניית מצגת',
    () => runOverridden('/deck', () => buildProposal(key, chatId, messageId, targets, draft)),
    chatId
  );
});

bot.action(/^dx:(.+)$/, async (ctx) => {
  const key = ctx.match[1];
  if (!store.getProposal(key)) return ctx.answerCbQuery('כבר טופל');
  store.clearProposal(key);
  await ctx.answerCbQuery('❌ נדחה');
  await ctx.editMessageText(`❌ נדחה\n\n${ctx.callbackQuery.message.text || ''}`).catch(() => {});
  await ctx.editMessageReplyMarkup(undefined).catch(() => {});
});

bot.action(/^dr:(.+)$/, async (ctx) => {
  const key = ctx.match[1];
  if (!store.getProposal(key)) return ctx.answerCbQuery('כבר טופל');

  const proposalMessageId = ctx.callbackQuery.message.message_id;
  await ctx.answerCbQuery('🤖 כתוב מה לשנות');
  const prompt = await ctx.reply('🤖 מה לשנות בהצעה שלמעלה? כתוב בתשובה להודעה הזו', {
    reply_parameters: { message_id: proposalMessageId },
    ...Markup.forceReply(),
  });

  // Same pendingEdit table and the same routing by prompt message id, so two
  // proposals can be mid-revision at once without one reply reaching the other.
  // `kind` is what tells the reply handler which of the two it is holding.
  store.setPendingEdit(key, {
    kind: 'idea',
    chatId: ctx.chat.id,
    promptMessageId: prompt.message_id,
    proposalMessageId,
  });
});

/**
 * Apply an instruction to a proposed deck.
 *
 * The reply is an instruction, not a replacement — "make it autumn", "Osaka
 * instead", "six places" — which is the difference between this and the ✏️
 * button on a card, where what you type IS the new headline.
 *
 * It can only work before the build. Once a deck is rendered its title is baked
 * into the cover JPEG and toDeckCandidate has dropped the photograph that would
 * be needed to draw a new one, so this is the last point at which the words are
 * still words.
 */
async function handleIdeaReply(ctx, key, pending) {
  store.clearPendingEdit(key);
  const proposal = store.getProposal(key);
  if (!proposal) return ctx.reply('ההצעה הזו כבר לא ממתינה');

  const said = (ctx.message.text || ctx.message.caption || '').trim();
  if (!said) {
    store.setPendingEdit(key, pending); // nothing consumed — stay open for a real reply
    return ctx.reply('שלח טקסט (לא תמונה/מדבקה)');
  }

  await ctx.reply('🤖 חושב...');
  const chatId = pending.chatId;
  // Detached: one Opus call, and blocking the update loop on it delays every
  // other button in the chat.
  detach(
    'שינוי הצעה',
    async () => {
      let revised;
      try {
        revised = await reviseIdea(proposal.idea, said);
      } catch (e) {
        // The proposal is untouched and still answerable, so the prompt goes
        // back rather than leaving a dead end — replying again retries.
        store.setPendingEdit(key, pending);
        return bot.telegram.sendMessage(chatId, notify.withDetail('❌ השינוי נכשל', e));
      }
      if (!store.updateProposal(key, { idea: revised })) {
        return bot.telegram.sendMessage(chatId, 'ההצעה הזו כבר לא ממתינה');
      }
      await bot.telegram.sendMessage(chatId, `🤖 עודכן:\n\n${proposalMessage(revised)}`, proposalButtons(key));
    },
    chatId
  );
}

/**
 * Apply an edited headline.
 *
 * Unlike BrickDeal's equivalent, this cannot just swap a line of text: the
 * headline is baked into a rendered JPEG, so the card has to be re-rendered or
 * the image and the caption would disagree — and the image is what publishes.
 */
async function handleEditReply(ctx, key) {
  const pending = store.getPendingEdit(key);
  // Both stages route through the same prompt-id lookup, so this is where they
  // part: an idea is still text and gets revised, a staged card is a rendered
  // JPEG and gets its headline replaced.
  if (pending?.kind === 'idea') return handleIdeaReply(ctx, key, pending);
  store.clearPendingEdit(key);
  const cand = store.getStaging(key);
  if (!pending || !cand) return ctx.reply('הפריט הזה כבר לא ממתין לעריכה');

  const newHeadline = (ctx.message.text || ctx.message.caption || '').replace(/\s+/g, ' ').trim();
  const res = await retitleStaged(key, newHeadline);
  if (!res.ok) {
    store.setPendingEdit(key, pending); // nothing consumed — leave it pending
    return ctx.reply(res.said);
  }

  // The old message carried the old image, so it can't be edited in place —
  // the card is re-sent with fresh buttons instead.
  await resendCard(key, res.cand, pending.chatId);
  await ctx.reply('✏️ הכותרת עודכנה והכרטיס רונדר מחדש - אשר/דחה למעלה');
}

/**
 * Replace one staged card's headline and re-render it.
 *
 * Channel-neutral for the same reason approveStaged is: this is what editing a
 * headline MEANS, and the admin site does it too. What differs is only how the
 * new text arrives — a reply to a forced-reply prompt, or a field in a PUT — and
 * neither of those is a fact about the card.
 *
 * Only a card has a headline to replace. A deck's title lives on its cover and a
 * clip's line is burned into the video, which is why neither offers the button;
 * this refuses them by kind rather than trusting the button to be absent, since
 * an HTTP client can ask for anything.
 */
async function retitleStaged(key, headline) {
  const cand = store.getStaging(key);
  if (!cand) return { ok: false, said: 'הפריט הזה כבר לא ממתין לעריכה' };
  if (cand.kind === 'deck' || cand.kind === 'clip' || cand.kind === 'plan' || cand.kind === 'post') {
    return { ok: false, said: `אין כותרת לעריכה ב${cand.kind} - זה רינדור מחדש` };
  }

  const text = String(headline || '').replace(/\s+/g, ' ').trim();
  if (!text) return { ok: false, said: 'שלח טקסט (לא תמונה/מדבקה)' };

  const updated = { ...cand, headline: text };
  try {
    updated.card = await renderCard(updated, { id: cand.id, data: cand.data, image: cand.image });
  } catch (e) {
    return { ok: false, said: notify.withDetail('❌ רינדור הכרטיס נכשל', e) };
  }
  updated.channelCaption = channelCaption(updated);
  // One draw for both, like the build path. Editing a headline re-draws the
  // question and the ask, which is harmless, the re-rendered card comes back
  // for approval with the new description printed on it.
  const editedDesc = publishedDescriptions(updated);
  updated.instagramCaption = editedDesc.instagram;
  updated.tiktokCaption = editedDesc.tiktok;
  store.updateStaging(key, updated);
  return { ok: true, said: '✏️ הכותרת עודכנה והכרטיס רונדר מחדש', cand: updated };
}

/**
 * Send a staged card's approval message again, and remember where it landed.
 *
 * Shared by the edit path and by /resend, and it exists mainly to keep
 * `approvalCard` honest: a re-sent card is at a NEW message id, and leaving the
 * old one recorded means a later decision made on the site edits a message that
 * has been superseded — so the stale card keeps its live buttons and the current
 * one never gets closed.
 */
async function resendCard(key, cand, chatId = staging) {
  const sent = await sendForApproval(bot.telegram, chatId, cand, approvalMessage(cand), stagingButtons(key, cand));
  store.updateStaging(key, {
    ...cand,
    approvalCard: { chatId, messageId: sent?.message_id ?? null, isPhoto: Boolean(sent?.photo) },
  });
  return sent;
}

// ---------------------------------------------------------------------------
// Manual submission
// ---------------------------------------------------------------------------

const URL_RE = /https?:\/\/[^\s<>"')]+/gi;

const ingestUrl = billed('card', ingestUrlJob);
async function ingestUrlJob(url, ctx) {
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

// How many times a card retries a destination that keeps refusing it before it
// is set aside. Without a cap, a destination down for a day is an endless retry
// loop with an alert every drip tick.
const MAX_PUBLISH_ATTEMPTS = 3;

/**
 * Publish one approved item to every destination it still owes.
 *
 * The old rule was "if anything published, do not retry" — retrying the whole
 * item would duplicate the destination that had already succeeded. True, and it
 * threw away the other half of the post. With Instagram returning "API access
 * blocked", every card reached Telegram, was recorded as published, and the
 * Instagram account went dark for days behind one warning line per post that
 * read as a handled edge case.
 *
 * The unit of retry is the destination, not the item. `pendingTargets` is what
 * this card still owes; a destination that has already published is never in it,
 * so retrying cannot duplicate anything, and a destination that failed is not
 * abandoned just because its neighbour worked.
 */

/**
 * What the published log records about a post, in one place.
 *
 * Written from two call sites — the nothing-owed path and the succeeded path —
 * which had drifted into two copies of the same object literal. They must agree:
 * the quota window and the /deck idea prompt both read these fields back, and a
 * field populated on one path and not the other is a guard that works only on
 * whichever path the post happened to take.
 */
const publishedFacts = (cand) => ({
  id: cand.id,
  pillar: cand.pillar,
  tags: cand.tags,
  layout: cand.layout,
  sourceId: cand.sourceId,
  topic: cand.deck ? deckTopic(cand.deck) : null,
  headline: cand.headline || null,
  // Where the post was about. A deck names its region; a card names it on the
  // trip, which is the field verify.js already insists every card have.
  place: (cand.deck ? cand.deck.where : cand.trip?.where) || null,
  // Which stock video a clip was built from, so the row can answer "have we
  // used this footage". It was read back by /clip long before anything wrote
  // it — see the note in store.recordPublished.
  //
  // Through store.clipPexelsId rather than off `clip.pexelsId` directly, so the
  // clips that predate that field — whose candidate id IS the Pexels id, three
  // of which are in staging right now — record what they were made from too. A
  // published row that says null is a row that cannot stop a repeat, and it is
  // a repeat of something real followers have already been shown.
  pexelsId: store.clipPexelsId(cand),
  // And all of them, because a cuts clip is built from four or five shots and
  // the singular field above can only hold the first. Recording one of five
  // would leave the other four looking unspent to the next batch.
  pexelsIds: store.clipPexelsIds(cand),
  // Which Israeli angle this deck was chosen for, so the next draw can exclude
  // it. Only decks carry one today; everything else records null.
  angle: cand.deck?.idea?.angle || null,
  // So the row does not claim a post that has not been made. A draft reached
  // the inbox; whether it was ever posted happens in the app, where this
  // process cannot see it.
  tiktokDraft: Boolean(cand.tiktokDraft),
});

async function publishNext(item = null) {
  // `item` is a post already taken out of the queue — /post hands one in after
  // pulling it by position. Everything below is identical either way: a post
  // published out of turn is still the same post, with the same destinations,
  // the same guards and the same retry behaviour.
  const cand = item || store.dequeue();
  if (!cand) return false;

  const configured = publishTargets();

  // What this card was BUILT for, not what happens to be configured now.
  //
  // These are different lists and conflating them is what stopped TikTok ever
  // working. A card is editorially barred from TikTok (targets.js), so
  // candidate.js stamps it `['telegram','instagram']` and bot.js never asks
  // creator_info for it — leaving it, correctly, with no privacy level. Reading
  // the global list here then sent that same card to TikTok anyway, where it
  // died on `no privacy level was chosen at approval`. Every card did. The
  // approval message has always promised the opposite ("what you were shown is
  // what was true when you decided") and this is where that promise was kept.
  //
  // `allowedForKind` is applied as well as the stamp, so a candidate queued
  // before the per-kind rule existed is held to it too rather than being
  // grandfathered into a destination it can never satisfy.
  const allowed = allowedForKind(cand.kind);
  const intended = (cand.publishTargets?.length ? cand.publishTargets : configured).filter((t) =>
    allowed.includes(t)
  );

  // On a first attempt this is everything it was built for; on a retry it is
  // only what failed — still filtered, so a stale pendingTargets cannot
  // resurrect a destination the kind does not allow.
  const owed = (cand.pendingTargets?.length ? cand.pendingTargets : intended).filter(
    (t) => configured.includes(t) && allowed.includes(t)
  );

  // Not silent: a card that owed a destination its kind cannot accept is a
  // candidate built under an older rule, and the queue draining quietly is how
  // this went unnoticed for 45 published posts.
  const disallowed = (cand.pendingTargets?.length ? cand.pendingTargets : cand.publishTargets || [])
    .filter((t) => !allowed.includes(t));
  if (disallowed.length) {
    console.log(
      `publish: ${disallowed.join(', ')} dropped for this ${cand.kind || 'card'} - not a destination this kind publishes to`
    );
  }

  // Nothing to do, and two reasons for it that must not be treated alike.
  if (!owed.length) {
    // The kind has no destination configured AT ALL — TikTok not connected yet,
    // Instagram not set up. That is a fact about the install and a temporary
    // one, not a fact about this post, so the post waits for the destination to
    // arrive rather than being consumed by its absence.
    //
    // This became load-bearing the moment each kind got exactly one
    // destination. Before that, "no destination at all" needed two things to be
    // switched off at once and was genuinely an edge case; now an unconnected
    // TikTok means EVERY approved deck lands here, and the branch below would
    // record each one as published and drop it. Silently, at the drip interval,
    // one slideshow at a time.
    if (!targetsForKind(cand.kind).length) {
      // ...UNLESS EVERYTHING LEFT TO DO IS YOURS ANYWAY.
      //
      // A clip publishes to TikTok and is handed to you for Instagram. With
      // TikTok not connected the first half is genuinely waiting for setup, but
      // the second half is not waiting for anything: the mp4 is rendered, it is
      // hosted, and the only step left was always going to be you opening an
      // app. Holding it would mean the hand-off never fires on a box with no
      // TikTok, which is this box, so the feature would have shipped doing
      // nothing.
      //
      // Completed rather than held, and recorded with every destination false,
      // which is the honest row: this program published it nowhere. What the
      // record buys is that the footage is spent and the clip is not offered
      // again, both of which are true the moment you have the file.
      const manual = manualForKind(cand.kind);
      if (manual.length) {
        store.recordPublished(publishedFacts(cand));
        await notify.send(
          bot.telegram,
          staging,
          notify.published({
            headline: cand.headline,
            succeeded: [],
            failed: [],
            drafted: [],
            manual,
            manualUrl: clipPublicUrl(cand),
          })
        );
        const paste = notify.descriptionToPaste(cand);
        if (paste) await notify.send(bot.telegram, staging, paste);
        return true;
      }

      store.hold(cand, allowed, `no destination configured for a ${cand.kind || 'card'} yet`);
      console.log(`publish: holding ${cand.kind || 'card'} - ${allowed.join(', ')} not configured yet`);
      await notify.send(
        bot.telegram,
        staging,
        notify.publishWaitingForSetup(cand.headline, allowed, store.heldCount())
      );
      return false;
    }

    // Otherwise the destination really was reconfigured away while this sat in
    // the queue, and the kind still has somewhere to go in general. Recording it
    // stops it looping forever as a card that owes nothing.
    store.recordPublished(publishedFacts(cand));
    return false;
  }

  // A destination that has failed enough times running is not worth another
  // call per card: it fails, costs quota, and buries the one alert that matters
  // under a copy of itself. Cards that owe only degraded destinations are held.
  const live = owed.filter((t) => !store.isDegraded(t));
  const skipped = owed.filter((t) => store.isDegraded(t));

  // BEFORE anything goes out, not after. A guard that was stepped over during
  // the gather is only worth recording if the sentence arrives while the post
  // can still be stopped — the point of the override is that a repeat is
  // deliberate, and "deliberate" means you read it first.
  //
  // Sent on every attempt rather than once, because a card that was held for a
  // day and then retried publishes at a moment nobody is watching, and the one
  // notice it got scrolled past yesterday.
  // Two sources, and both matter. The candidate carries what was stepped over
  // when it was BUILT (a quota, the dedupe window); the ambient context carries
  // what is being stepped over to publish it RIGHT NOW (the drip interval, via
  // /next). A card built under an override and published on the timer has only
  // the first; one built normally and rushed out by hand has only the second.
  const overrides = [...new Set([...(cand.overrides || []), ...overrideNotes()])];
  if (overrides.length && live.length) {
    await notify.send(bot.telegram, staging, notify.overrideNotice(cand.headline, overrides));
  }

  const done = {};
  const failed = [];
  // Targets this particular card can never reach, as opposed to targets that
  // are having a bad day. See the catch below.
  const abandoned = [];
  // And a third kind: targets that are fine, and are simply not accepting
  // another post yet. A daily cap is neither a broken destination nor a broken
  // card, and treating it as either loses a post that would publish tomorrow.
  const limited = [];

  const publishers = {
    // A slideshow goes to the channel as an album whichever kind made it. Only
    // reached when CHANNEL_ID is set AND the kind's targets include telegram —
    // neither a deck nor a plan routes there today — so this is the branch that
    // keeps a future channel from receiving an itinerary as one cover image.
    telegram: () =>
      cand.kind === 'deck' || cand.kind === 'plan' || cand.kind === 'post'
        ? publishTelegramDeck(bot.telegram, CHANNEL_ID, cand)
        : publishTelegram(bot.telegram, CHANNEL_ID, cand),
    instagram: async () => {
      const res = await publishInstagram(cand);
      // REMEMBERED HERE, AFTER THE PUBLISH SUCCEEDED, because this is the only
      // moment both halves exist: Instagram has just handed back the media id,
      // and the candidate that knows which page the post was about is still in
      // hand. A comment arriving in three days carries neither.
      //
      // Only for a post that HAS a page. A deck sourced from the map or from
      // Wikidata has no `siteSlug`, no row is written, and a comment on it is
      // ignored rather than answered with a link to somewhere it was not about.
      const slug = cand.deck?.siteSlug || null;
      if (res?.mediaId && slug) {
        store.noteIgPost(res.mediaId, {
          slug,
          destHe: cand.deck?.where || '',
          candidateId: cand.id,
        });
      }
      return res;
    },
    tiktok: () => publishTikTok(cand, { draft: Boolean(cand.tiktokDraft) }),
  };
  const errorText = {
    instagram: describeError,
    tiktok: describeTikTokError,
  };
  // Per destination, because only the destination's own client knows which of
  // its error codes mean "this card" rather than "this service".
  const cardLevel = {
    tiktok: isCardLevelTikTok,
  };
  // Same shape, different question: is this destination refusing everyone
  // right now, rather than refusing this card or being broken?
  const platformLimit = {
    tiktok: isPlatformLimitTikTok,
    // Graph throttles clear by themselves. Retried as failures they cost three
    // attempts each and then degrade Instagram, which is the wrong answer to a
    // busy afternoon.
    instagram: isPlatformLimitInstagram,
  };
  // And a fourth: is this destination refusing everything until somebody goes
  // and fixes the connection?
  const configProblem = {
    tiktok: isConfigProblemTikTok,
  };

  for (const target of live) {
    try {
      done[target] = await publishers[target]();
      store.noteTargetOk(target);
      // WHAT THIS POST WAS, RECORDED WITH THE ID THE PLATFORM JUST HANDED BACK.
      //
      // This is the only moment both halves exist. The platform has a media id and the
      // candidate still knows it was a `list` post in the `label` look at 3:4 - and a
      // week later, when the nightly job asks what that media did, neither is derivable
      // from the other. The whole of section 7's report groups by those fields, so a
      // post that publishes without this line is a post whose numbers can never be
      // attributed to a format.
      //
      // Wrapped, because a metrics failure must never look like a failed publish. The
      // post IS live at this point; throwing here would send it down the retry path and
      // publish it twice.
      try {
        const mediaId = done[target]?.mediaId || done[target]?.publishId || done[target]?.id || null;
        if (mediaId && (cand.kind === 'post' || cand.kind === 'deck' || cand.kind === 'plan')) {
          noteMetricsPublished(cand.id, {
            platform: target,
            mediaId,
            shape: {
              kind: cand.kind,
              type: cand.deck?.type || cand.kind,
              look: cand.deck?.look || cand.deck?.style || null,
              hook: cand.deck?.hook || null,
              frame: cand.deck?.frame || null,
              caption: cand.captionShape || null,
              where: cand.deck?.where || null,
            },
          });
        }
      } catch (e) {
        console.error(`metrics: could not record ${cand.id} on ${target} - ${e.message}`);
      }
    } catch (e) {
      const detail = (errorText[target] || ((x) => x.message))(e);
      console.error(`publish: ${target} failed:`, detail);

      // Instagram can refuse a publish it has already carried out — see the note
      // on publishContainer(). When it does, the container id comes back on the
      // error, and it has to survive onto the queued card: it is the only thing
      // the retry can ask "is this already live?" with, and without it the retry
      // posts a second copy of a post that went out fine.
      if (target === 'instagram' && e?.creationId) cand.instagramCreationId = e.creationId;

      // A card this destination can NEVER accept is not an outage, and scoring
      // it as one does real damage.
      //
      // `step: 'config'` is the publisher saying the problem is the card: no
      // privacy level, an image URL that is not https, more than 35 images.
      // Retrying cannot change any of those, and three such cards in a row
      // degraded TikTok — after which perfectly good cards behind them were
      // skipped and held without ever being attempted. That is how six posts
      // staged before TikTok was connected took the whole destination down
      // with them.
      //
      // So the target is dropped for THIS card and for nothing else: the
      // destination keeps its health, the card publishes everywhere it can,
      // and it is reported rather than retried into a hold.
      //
      // Not only what WE refuse before calling out. TikTok decides some of
      // these at its end — an unaudited app asking for a public post is
      // refused at init, and the next card asking for a private one publishes
      // fine, so the destination is healthy and must not be marked otherwise.
      // "Not now" — checked BEFORE the card-level test, because a platform
      // limit arrives as step:'config' from our own preflight and would
      // otherwise be read as a card that can never publish. It can; it just
      // cannot publish yet. The destination keeps its health (nothing is wrong
      // with it), the card keeps its place, and nothing is abandoned.
      if (platformLimit[target]?.(e)) {
        limited.push({ target, message: detail });
        continue;
      }

      if (e?.step === 'config' || cardLevel[target]?.(e)) {
        abandoned.push({ target, message: detail });
        continue;
      }

      // The connection is wrong, and no number of attempts repairs it. Held
      // rather than abandoned — the same deck publishes perfectly once the
      // scope is granted — and the destination is stood down at once instead
      // of after three posts have each spent three calls proving the same
      // thing. `limited` is the right bucket: it means "not now, and not your
      // fault", which is exactly this.
      if (configProblem[target]?.(e)) {
        store.degrade(target, detail);
        limited.push({ target, message: detail });
        continue;
      }

      const health = store.noteTargetFailed(target, detail);
      failed.push({ target, message: detail });
      // The edge, not the state: one escalation per outage rather than one per
      // card. This is the alert that should have arrived on day one.
      if (health.justDegraded) {
        await notify.send(bot.telegram, staging, notify.targetDegraded(target, health, detail));
      }
    }
  }

  const succeeded = live.filter((t) => done[t]);

  if (succeeded.length) {
    store.recordPublished({
      ...publishedFacts(cand),
      telegram: Boolean(done.telegram),
      instagram: Boolean(done.instagram),
      tiktok: Boolean(done.tiktok),
    });
  }

  // Anything a publisher repaired on the way through — a privacy level the
  // account no longer offers, slides trimmed to TikTok's 35 — is reported
  // whether or not the post otherwise succeeded. A post that went out at a
  // different privacy level than the approval card promised is exactly the
  // thing that must not be discoverable only by looking at TikTok.
  const publisherNotes = [];
  for (const target of succeeded) {
    for (const note of done[target]?.notes || []) {
      publisherNotes.push(`   ${targetsHe([target])}: ${note}`);
    }
  }
  if (publisherNotes.length) {
    await notify.send(bot.telegram, staging, ['ℹ️ שינויים בפרסום', cand.headline, ...publisherNotes].join('\n'));
  }

  // Said once, whichever way the card ends up going — it is the only notice
  // that a destination was given up on, and it must not be lost inside a
  // "retrying" or "held" message about a different target.
  if (abandoned.length) {
    await notify.send(bot.telegram, staging, notify.targetAbandoned(cand.headline, abandoned));
  }

  // What this card still owes after this pass. Abandoned targets are NOT owed:
  // nothing about a later attempt would go differently.
  const stillOwed = [...skipped, ...failed.map((f) => f.target), ...limited.map((l) => l.target)];
  if (!stillOwed.length) {
    // A card whose only remaining target was abandoned has nothing to announce
    // as published — saying "📤 פורסם ל" with an empty list reads as a bug.
    if (succeeded.length) {
      // A deck handed to your inbox did not publish, and saying it did is the
      // one wrong thing to say here: you would read "posted" and not open the
      // app, which is the only place the last step can happen.
      // Which of the destinations took a draft rather than a post. Passed
      // through rather than decided here, so a deck that went to both is
      // reported honestly on each: Instagram published, TikTok is waiting.
      const drafted = cand.tiktokDraft && succeeded.includes('tiktok') ? ['tiktok'] : [];
      // And where this post belongs that nothing here can put it. A clip's
      // Instagram half: the API has no draft state, so the copy is yours to
      // make and the message says so with the mp4's own URL on it rather than
      // listing TikTok alone and reading as finished. See targets.js.
      const manual = manualForKind(cand.kind);
      await notify.send(
        bot.telegram,
        staging,
        notify.published({
          headline: cand.headline,
          succeeded,
          failed: [],
          drafted,
          manual,
          manualUrl: manual.length ? clipPublicUrl(cand) : null,
        })
      );

      // And then the description, alone, in a message of its own.
      //
      // Only when there is something to post by hand. Telegram's copy takes a
      // whole message, so this one holds the caption and nothing else: a label
      // or an emoji in front of it is a character that has to be deleted in the
      // Instagram composer every time, and the time it is not deleted is a post
      // that goes out with a glyph in front of its first line.
      //
      // Second rather than first, because the line above is what says whether
      // anything needs doing at all, and it is the one that should be readable
      // at a glance in a chat full of them.
      if (manual.length) {
        const paste = notify.descriptionToPaste(cand);
        if (paste) await notify.send(bot.telegram, staging, paste);
      }
    }
    return true;
  }

  // A pass that only ran into a platform limit has not used an attempt. The
  // three-attempt ceiling exists to stop a card failing forever; a card waiting
  // on a daily quota is not failing, and spending its attempts on the wait
  // would drop it just as the quota came free.
  const onlyLimited = limited.length > 0 && failed.length === 0 && skipped.length === 0;
  const attempts = (cand.publishAttempts || 0) + (onlyLimited ? 0 : 1);
  const retryable = onlyLimited || (skipped.length === 0 && attempts < MAX_PUBLISH_ATTEMPTS);

  if (retryable) {
    store.enqueue({ ...cand, publishAttempts: attempts, pendingTargets: stillOwed });
    if (onlyLimited) {
      await notify.send(
        bot.telegram,
        staging,
        notify.platformLimited(cand.headline, limited, store.tiktokCapFreesAt(), succeeded)
      );
    } else {
      await notify.send(
        bot.telegram,
        staging,
        notify.publishRetrying(cand.headline, failed, attempts, MAX_PUBLISH_ATTEMPTS, succeeded)
      );
    }
  } else {
    // Held, not dropped. While a destination is blocked there is nothing useful
    // to retry against — but there will be, and the backlog should still exist
    // when it comes back. /retry replays it.
    store.hold(cand, stillOwed, failed[0]?.message || 'destination unavailable');
    await notify.send(
      bot.telegram,
      staging,
      notify.publishHeld(cand.headline, stillOwed, succeeded, store.heldCount())
    );
  }
  return succeeded.length > 0;
}

// ---------------------------------------------------------------------------
// Gather runs
// ---------------------------------------------------------------------------

let running = false;
let lastRunAt = null;
let lastRunDay = null;
// Epoch 0, so the first tick after a start gathers immediately rather than
// waiting out a full interval.
let lastGatherAt = 0;
let quietAlertSent = false;
// The fallback anchor for the quiet alarm. An install that has never staged or
// published anything has no timestamp to measure from, and "no timestamp" must
// not read as "not quiet" — that is the state a brand new silence starts in.
const bootedAt = Date.now();

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

// The Instagram Login path issues 60-day tokens. Nothing about their expiry is
// visible until publishing simply starts failing, so this runs on boot and once
// a day; refreshToken() itself decides whether it is actually due.
async function maybeRefreshIgToken() {
  if (!instagramConfigured() || authMode() === 'facebook') return;
  try {
    const r = await refreshToken();
    // Routine housekeeping working is not news. It notified on every successful
    // refresh, which is a message that says "nothing needs you" — and TikTok's
    // identical refresh has always been log-only, so the two destinations were
    // reporting the same event at different volumes.
    if (r.refreshed) console.log(`   instagram: token refreshed, ${Math.round(r.daysLeft)} days left`);
  } catch (e) {
    // The failure still notifies. Left alone, publishing stops in 60 days.
    console.error('instagram: token refresh failed:', e.message);
    await notify.send(
      bot.telegram,
      staging,
      notify.withDetail('🔴 חידוש טוקן אינסטגרם נכשל\nאם לא יחודש, הפרסום יפסיק לעבוד. הרץ npm run ig-token.', e)
    );
  }
}

// TikTok's access token lives about a day, so this is not the same kind of
// housekeeping as Instagram's 60-day one: a bot that only refreshed on a daily
// timer would spend part of every day holding a dead token. The publish path
// refreshes too (see liveToken) — this is the belt to that's braces, and the
// place a failure gets reported while there is still time to act on it.
async function maybeRefreshTikTokToken() {
  if (!tiktokConfigured()) return;
  try {
    const r = await refreshTikTokToken();
    if (r.refreshed) console.log(`   tiktok: token refreshed, ${Math.round(r.hoursLeft)}h left`);
  } catch (e) {
    console.error('tiktok: token refresh failed:', e.message);
    await notify.send(
      bot.telegram,
      staging,
      `🔴 חידוש טוקן טיקטוק נכשל: ${describeTikTokError(e)}
אם לא יחודש, הפרסום לטיקטוק יפסיק לעבוד. הרץ npm run tiktok-token.`
    );
  }

  // The refresh token is the one that cannot be renewed from here. A year is
  // long enough to forget it exists entirely, which is why it is worth saying
  // out loud before it lapses rather than after.
  const days = tiktokRefreshDaysLeft();
  if (days != null && days <= 14) {
    await notify.send(
      bot.telegram,
      staging,
      `🔑 טוקן הרענון של טיקטוק פג בעוד ${days} ימים - הרץ npm run tiktok-token כדי לחדש`
    );
  }
}

/**
 * Ask Instagram whether it is actually reachable, at boot.
 *
 * A read-only quota call, which hits the same Graph endpoint publishing does and
 * fails the same way. Without it the first news of an app-level block arrives at
 * the first publish attempt — which, on a drip of one post every four hours, can
 * be most of a day after the bot came up believing it was fine.
 */
async function probeInstagram() {
  if (!instagramConfigured()) return;
  try {
    await remainingQuota();
    console.log('   instagram: reachable');
  } catch (e) {
    const detail = describeError(e);
    console.error('instagram: unreachable:', detail);
    await notify.send(bot.telegram, staging, notify.targetUnreachableAtBoot('instagram', detail));
  }
}

const doRun = billed('card', doRunJob);
async function doRunJob({ announce = true, target } = {}) {
  if (running) return null;
  running = true;
  try {
    const summary = await runOnce({
      ...(target ? { target } : {}),
      onStaged: async (cand) => {
        await stage(cand);
        // Counted here rather than from the summary, so a card that reached
        // Telegram is what counts against the day — not one that was built and
        // then failed to send.
        store.noteStaged(localDay(new Date()));
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

/**
 * A gather the owner asked for.
 *
 * `/run` is the daily target; `/run 7` is however many you say, and everything
 * in the way of getting there gives way — the topic quotas, the dedupe window,
 * the daily cap itself. Each bypass is collected as it happens and travels on
 * the candidate to the approval card and to Telegram before the post goes out.
 *
 * The bot is not deciding whether the owner may do this. It is making sure the
 * owner knows they did.
 */
bot.command('run', async (ctx) => {
  if (running) return ctx.reply('⏳ כבר רץ סבב איסוף');

  const asked = Number((ctx.message?.text || '').trim().split(/\s+/)[1]);
  const target = Number.isFinite(asked) && asked > 0 ? Math.min(asked, 25) : null;

  await ctx.reply(
    target
      ? `⏳ מריץ סבב - עד ${target} פריטים (עוקף את המכסה היומית ${dailyTarget()})`
      : `⏳ מריץ סבב - עד ${dailyTarget()} פריטים`
  );

  detach(
    'סבב איסוף',
    () => runOverridden('/run', () => doRun(target ? { target } : {})),
    ctx.chat.id
  );
});

// Re-run the same sources from scratch.
//
// /run alone will not do this: every item the previous run touched is marked
// seen, so a change to the layout or the copy rules stays invisible until
// tomorrow's news arrives. This forgets the claims first, which is what you
// want while iterating on how the cards look — and nothing else, so the
// Instagram token and the published log both survive.
bot.command('redo', async (ctx) => {
  if (running) return ctx.reply('⏳ כבר רץ סבב איסוף');
  const cleared = store.clearStaging();
  const forgotten = store.forgetAllSeen();
  await ctx.reply(
    `🔄 שכחתי ${forgotten} פריטים שכבר נראו${cleared ? ` וניקיתי ${cleared} ממתינים` : ''} - מריץ מחדש` +
      `\n(${store.publishedCount()} פוסטים שכבר פורסמו לא יחזרו)`
  );
  detach('סבב איסוף', () => runOverridden('/redo', () => doRun()), ctx.chat.id);
});

// Both queues, because both are waiting on the same thing — a tap from you.
// Counting only the built ones would report "0 pending" at the exact moment
// three proposed decks were sitting unanswered.
bot.command('pending', (ctx) => {
  const rows = store.stagingItems();
  if (!rows.length && !store.proposalSize()) return ctx.reply('✅ אין ממתינים');

  // Listed, not counted. The count and the number of cards in the chat can
  // disagree — a send that failed leaves a staged post with nothing to tap —
  // and a count is the one shape that cannot show you which.
  const lines = rows.map(({ cand }, i) => `${i + 1}. ${kindIcon(cand.kind)} ${cand.headline}`);
  ctx.reply(
    [
      `⏳ ${rows.length} ממתינים לאישור:`,
      ...lines,
      store.proposalSize() ? `💡 ${store.proposalSize()} הצעות ממתינות לבנייה` : null,
      rows.length ? 'אם אין כרטיס בצ׳אט: /resend' : null,
    ]
      .filter(Boolean)
      .join('\n')
  );
});

/**
 * Send the approval cards again.
 *
 * For the case where a post exists and its card does not. Spaced out on
 * purpose: the likeliest reason the first attempt failed is that several went
 * at once and Telegram refused the burst, and resending at the same rate would
 * reproduce exactly that.
 */
bot.command('resend', async (ctx) => {
  const rows = store.stagingItems();
  if (!rows.length) return ctx.reply('אין ממתינים');

  await ctx.reply(`📨 שולח מחדש ${rows.length} כרטיסים...`);
  detach(
    'שליחה מחדש',
    async () => {
      let sent = 0;
      for (const { key, cand } of rows) {
        try {
          // Through resendCard, so the recorded message id follows the card it
          // is on. Sent directly, a re-send left `approvalCard` pointing at the
          // message that failed — and a later decision on the admin site would
          // then close the wrong one and leave this one live.
          await resendCard(key, cand);
          sent += 1;
        } catch (e) {
          console.error(`resend: ${cand.headline} - ${e?.message || e}`);
        }
        // A second and a half between cards. The per-chat burst limit is what
        // is being worked around, and a deck is an album plus a message.
        await new Promise((r) => setTimeout(r, 1500));
      }
      await notify.send(bot.telegram, staging, `📨 ${sent}/${rows.length} נשלחו`);
    },
    ctx.chat.id
  );
});
/**
 * What is waiting, in the order it will go out.
 *
 * It used to answer with a count, which tells you there are four posts and
 * nothing about whether you want all four. The list is numbered because the
 * numbers are what /post takes — printing a list nobody can act on is half a
 * command.
 */
bot.command('queue', (ctx) => {
  const rows = store.queuedItems();
  if (!rows.length) return ctx.reply('📦 התור ריק');

  // Long enough to see the near future, short enough to stay one message. A
  // backlog of thirty is a different problem and /status is where it shows.
  const SHOWN = 12;
  const lines = rows.slice(0, SHOWN).map((c, i) => {
    // What it will ACTUALLY publish to: the pending list filtered by what this
    // kind is allowed. A card queued before the routing rule changed still
    // carries telegram, and printing it promises a destination that will be
    // dropped at publish time.
    const owed = (c.pendingTargets?.length ? c.pendingTargets : c.publishTargets || []).filter((t) =>
      allowedForKind(c.kind).includes(t)
    );
    const where = targetsHe(owed);
    const kind = kindIcon(c.kind);
    // Only when TikTok is still owed. Approval sends the draft immediately and
    // queues the rest, so the remainder is Instagram-only — and calling that
    // "draft" describes a handoff that already happened.
    const draft = c.tiktokDraft && owed.includes('tiktok') ? ' · טיוטה' : '';
    return `${i + 1}. ${kind} ${c.headline}\n   ${where || 'אין יעד'}${draft}`;
  });

  ctx.reply(
    [
      `📦 ${rows.length} בתור לפרסום:`,
      '',
      ...lines,
      rows.length > SHOWN ? `\n…ועוד ${rows.length - SHOWN}` : null,
      '',
      '/post 2 לפרסם אחד מסוים · /next לפרסם את הבא',
    ]
      .filter((l) => l !== null)
      .join('\n')
  );
});

/**
 * Publish one specific queued post, now, out of turn.
 *
 * The same act as /next with a choice attached, so it carries the same
 * disclosure: publishing ahead of the drip steps over POST_INTERVAL_MINUTES,
 * and how far over is worth saying out loud. It adds one of its own — this
 * post jumped the queue, which is a thing you did on purpose and which the
 * posts behind it did not.
 */
/**
 * Publish one queued post now: a chosen one, or simply the next.
 *
 * Both /post and /next, and the admin site's publish button, because they are
 * one act with one disclosure. Publishing ahead of the drip steps over
 * POST_INTERVAL_MINUTES and a chosen post jumps the queue, and both of those are
 * recorded as overrides rather than done quietly — which is the whole reason this
 * runs inside runOverridden.
 *
 * `background` is for the admin site. An Instagram publish is tens of seconds of
 * uploading, and an HTTP request held open that long is indistinguishable from a
 * server that has died — so the site gets an immediate answer and reads the
 * outcome out of the Telegram chat and the log, both of which it shows.
 */
async function publishQueued(n = null, { background = false } = {}) {
  // Taken out BEFORE publishing, so a slow publish cannot have the drip pick
  // the same post up underneath it. If publishing then fails, the post follows
  // the ordinary failure path — held or requeued — exactly as it would have
  // from the drip.
  const item = n == null ? null : store.takeQueuedAt(n);
  if (n != null && !item) return { ok: false, said: `אין פריט ${n} בתור - /queue לרשימה` };

  const sinceLast = store.lastPublishedAt() ? Date.now() - store.lastPublishedAt() : null;
  const run = () =>
    runOverridden(n == null ? '/next' : '/post', async () => {
      if (n != null) noteOverride('סדר התור', `#${n} לפני התור`);
      if (sinceLast !== null && sinceLast < intervalMs) {
        noteOverride('מרווח', `${Math.round(sinceLast / 60_000)}/${POST_INTERVAL_MINUTES} דק׳`);
      }
      return publishNext(item);
    });

  if (background) {
    detach('פרסום', run);
    return { ok: true, said: `⏳ מפרסם${item ? `: ${item.headline}` : ' את הבא'}`, headline: item?.headline || null };
  }
  const ok = await run();
  return {
    ok,
    said: ok ? (n == null ? '📤 פורסם הפריט הבא' : '📤 פורסם') : n == null ? 'התור ריק' : 'לא פורסם - ראו את ההודעה שלמעלה',
    headline: item?.headline || null,
  };
}

bot.command('post', async (ctx) => {
  const arg = (ctx.message.text || '').replace(/^\/post(@\S+)?\s*/, '').trim();
  const n = Number(arg);
  if (!arg || !Number.isInteger(n) || n < 1) {
    return ctx.reply('שימוש: /post 2 - המספר מהרשימה ב-/queue');
  }
  const peek = store.queuedItems()[n - 1];
  if (peek) await ctx.reply(`⏳ מפרסם: ${peek.headline}`);
  const res = await publishQueued(n);
  await ctx.reply(res.said);
});

/**
 * Publish the next queued post now, rather than at the next drip.
 *
 * The drip is POST_INTERVAL_MINUTES apart so the channel does not arrive in
 * bursts. Asking for the next one immediately steps over that, and how far over
 * is worth saying: "posted 10 minutes after the last one instead of 240" is the
 * difference between a deliberate double-post and one you will be surprised by.
 */
bot.command('next', async (ctx) => {
  const res = await publishQueued(null);
  await ctx.reply(res.said);
});

/**
 * Send a queued post to TikTok drafts now, without waiting for the drip.
 *
 * The same act approval performs automatically, available for anything already
 * in the queue — a post approved before this existed, or one whose TikTok half
 * was requeued after a failure. Numbered against /queue, like /post.
 *
 * Only the TikTok half moves. Anything else the post still owes goes back on
 * the queue and keeps its turn, because that half is a real publish and the
 * drip exists for it.
 */
async function draftQueued(n) {
  if (!Number.isInteger(n) || n < 1) return { ok: false, said: 'שימוש: /draft 2 - המספר מהרשימה ב-/queue' };

  const item = store.takeQueuedAt(n);
  if (!item) return { ok: false, said: `אין פריט ${n} בתור - /queue לרשימה` };

  const targets = item.pendingTargets?.length ? item.pendingTargets : item.publishTargets || [];

  // A RE-SEND is allowed, and it is as much the point of this command as the
  // first send is.
  //
  // Approving a deck hands TikTok its draft immediately and leaves only
  // Instagram in the queue, so the tiktok target is spent within a second of
  // the tap. That made a draft unrepeatable: the one case where you most want
  // to send it again is after the file it was made from has been fixed, which
  // is exactly what `npm run redraw` is for, and the answer was "this item is
  // not meant for TikTok" about a deck that had just been sent there.
  //
  // The question is therefore whether this KIND belongs on TikTok, not whether
  // this copy still owes it one. A card does not (targets.js: card is Instagram
  // alone) and is still refused by name.
  //
  // What it cannot do is withdraw the first draft. TikTok downloaded the image
  // when it was delivered, so the old one sits in the inbox until it is deleted
  // in the app, and this puts a second one beside it.
  const belongs = targetsForKind(item.kind).includes('tiktok');
  if (!targets.includes('tiktok') && !belongs) {
    // Put it back exactly as it was. Taking a post out of the queue to tell you
    // it was the wrong one would be a worse answer than the error.
    store.enqueue(item);
    return { ok: false, said: `הפריט הזה לא מיועד לטיקטוק (${targetsHe(targets) || 'אין יעד'})` };
  }
  const again = !targets.includes('tiktok');

  const rest = targets.filter((t) => t !== 'tiktok');
  if (rest.length) store.enqueue({ ...item, pendingTargets: rest });

  detach('טיוטה לטיקטוק', () => publishNext({ ...item, pendingTargets: ['tiktok'] }), staging);
  return {
    ok: true,
    said: again
      ? `⏳ שולח טיוטה נוספת: ${item.headline}\n   מחקו את הקודמת בטיקטוק - היא נשארת עם התמונה הישנה`
      : `⏳ שולח לטיוטות: ${item.headline}`,
    headline: item.headline,
  };
}

bot.command('draft', async (ctx) => {
  const arg = (ctx.message.text || '').replace(/^\/draft(@\S+)?\s*/, '').trim();
  const res = await draftQueued(Number(arg));
  await ctx.reply(res.said);
});

bot.command('held', (ctx) => {
  const rows = store.heldItems();
  if (!rows.length) return ctx.reply('✅ אין פוסטים מוחזקים');
  const lines = rows.map(
    (h, i) => `${i + 1}. ${h.cand.headline}\n   חסר: ${targetsHe(h.targets)}${h.error ? `\n   ${h.error}` : ''}`
  );
  ctx.reply(
    [
      `⏸️ ${rows.length} פוסטים מוחזקים:`,
      '',
      ...lines,
      '',
      '/retry כדי לנסות שוב · /clear_held כדי לוותר עליהם',
    ].join('\n')
  );
});

/**
 * Give up on the held backlog, and un-degrade the destinations it was stuck on.
 *
 * /retry is the "I have fixed it" signal and it assumes the held cards can
 * succeed once the destination is back. Some cannot: a card is frozen at
 * approval with what its destinations said then, and for TikTok that includes
 * the privacy level, which is read once at staging and never again. A card
 * approved while TikTok was unreachable has none, so it fails the instant it
 * is picked up — and /retry re-enqueues it verbatim, so it fails identically
 * every time while re-degrading TikTok behind it.
 *
 * Clearing the degraded flag is itself something only /retry does, so without
 * this there is no way out of that loop: every attempt to un-block the
 * destination drags the unpublishable cards back in with it.
 *
 * What is discarded is only what a destination still OWED. Every target that
 * already published did so before the card was held, so nothing that went out
 * is affected — only the copy that was never going to be made.
 */
function clearHeldNow() {
  const rows = store.heldItems();
  if (!rows.length) return { ok: false, said: '✅ אין פוסטים מוחזקים' };

  const lost = new Set();
  for (const h of rows) for (const t of h.targets) lost.add(t);

  const n = store.clearHeld();
  // The point of the command. Un-degrading is what lets the NEXT post reach
  // the destination, and it is the half that /retry could not deliver on its
  // own here.
  for (const t of liveTargets()) store.clearDegraded(t);

  return {
    ok: true,
    said: [
      `🗑️ ${n} פוסטים מוחזקים נמחקו.`,
      `ויתרנו על: ${targetsHe([...lost])}`,
      'מה שכבר פורסם נשאר. כל היעדים סומנו כתקינים - הפוסט הבא ינסה מחדש.',
    ].join('\n'),
  };
}

bot.command('clear_held', async (ctx) => {
  await ctx.reply(clearHeldNow().said);
});

/**
 * Put every held post back on the queue and un-degrade the destinations that
 * were refusing them.
 *
 * This is the deliberate "I have fixed it" signal. Nothing here retries by
 * itself once a destination is marked degraded, because while Instagram is
 * blocked at the API a retry is a wasted call and a repeated alert — so
 * something has to say the block is gone, and it should be you.
 */
/**
 * The "I have fixed it" signal: everything held goes back on the queue and every
 * destination is marked healthy again.
 *
 * Nothing retries by itself once a destination is degraded, because while
 * Instagram is blocked at the API a retry is a wasted call and a repeated alert.
 * So something has to say the block is gone, and it should be a person — which
 * is now a person in either channel.
 */
async function retryHeldNow({ background = false } = {}) {
  const rows = store.releaseHeld();
  const targets = new Set();
  for (const h of rows) for (const t of h.targets) targets.add(t);
  // Also clear anything degraded but with nothing held behind it.
  for (const t of liveTargets()) targets.add(t);
  for (const t of targets) store.clearDegraded(t);

  for (const h of rows) store.enqueue({ ...h.cand, publishAttempts: 0, pendingTargets: h.targets });

  if (!rows.length) {
    return { ok: true, said: 'אין מה להחזיר לתור. סימנתי את כל היעדים כתקינים - הפרסום הבא ינסה שוב.', released: 0 };
  }
  if (background) {
    detach('פרסום אחרי retry', () => publishNext());
    return { ok: true, said: `🔁 ${rows.length} פוסטים חזרו לתור. מפרסם את הראשון...`, released: rows.length };
  }
  const ok = await publishNext();
  return {
    ok,
    said: `🔁 ${rows.length} פוסטים חזרו לתור.\n${ok ? '📤 עבד' : 'עדיין נכשל - /held לפרטים'}`,
    released: rows.length,
  };
}

bot.command('retry', async (ctx) => {
  const rows = store.heldCount();
  if (rows) await ctx.reply(`🔁 מחזיר ${rows} פוסטים לתור...`);
  const res = await retryHeldNow();
  await ctx.reply(res.said);
});

bot.command('clear_pending', (ctx) => {
  const n = store.clearStaging();
  ctx.reply(`🧹 נוקו ${n} פריטים ממתינים`);
});

/**
 * The registry, with how each feed is actually behaving.
 *
 * `/sources` lists them; `/sources off <id>` and `/sources on <id>` switch one
 * without editing sources.json on the server and restarting. The declaration in
 * the file stays the place a source is turned off FOR GOOD, with its probe
 * result recorded; this is the switch for right now.
 */
bot.command('sources', (ctx) => {
  const { sources } = registry();
  const parts = (ctx.message?.text || '').trim().split(/\s+/);
  const verb = parts[1]?.toLowerCase();
  const id = parts[2];

  if (verb === 'on' || verb === 'off') {
    if (!id) return ctx.reply(`שימוש: /sources ${verb} <id>`);
    const src = sources.find((s) => s.id === id);
    if (!src) return ctx.reply(`אין מקור בשם "${id}" - /sources לרשימה`);
    if (verb === 'on' && !src.enabled) {
      return ctx.reply(
        `"${id}" מוצהר כבוי ב-sources.json ולא ניתן להדליק אותו מכאן.\nהסיבה שנרשמה: ${src.note?.split('.')[0] || '—'}`
      );
    }
    store.setSourceEnabled(id, verb === 'on');
    if (verb === 'on') store.clearSourceDegraded(id);
    return ctx.reply(verb === 'on' ? `✅ "${id}" הודלק` : `⬜ "${id}" כובה (זמנית, עד /sources on ${id})`);
  }

  const mark = (s) => {
    if (store.isSourceOff(s.id)) return '⏸️';
    if (store.isSourceDegradedLatched(s.id)) return '🔴';
    const h = store.sourceHealth(s.id);
    if (h.failures) return '🟡';
    return '✅';
  };

  const on = sources
    .filter((s) => s.enabled)
    .map((s) => {
      const h = store.sourceHealth(s.id);
      const bits = [`${mark(s)} ${s.id}`];
      if (h.lastOkAt) bits.push(`${h.lastItems ?? '?'} פריטים לפני ${notify.humanDuration(Date.now() - h.lastOkAt)}`);
      else if (h.failures) bits.push('עוד לא הצליח');
      if (store.isSourceDegradedLatched(s.id)) {
        const due = store.sourceRecoveryDueAt(s.id);
        bits.push(
          `הושבת אחרי ${h.failures} כשלונות` +
            (due ? `, ניסיון חוזר בעוד ${notify.humanDuration(Math.max(0, due - Date.now()))}` : '')
        );
      } else if (h.failures) {
        bits.push(`${h.failures} כשלונות ברצף`);
      }
      const line = bits.join(' · ');
      return h.lastError && (h.failures || store.isSourceDegradedLatched(s.id))
        ? `${line}\n     ⛔ ${h.lastError.slice(0, 120)}`
        : line;
    });

  const off = sources.filter((s) => !s.enabled).map((s) => `⬜ ${s.id} - ${s.note?.split('.')[0] || 'כבוי'}`);

  ctx.reply(
    [
      `📚 מקורות - ${enabledSources().length} פעילים מתוך ${sources.length} מוצהרים`,
      ...on,
      '',
      'מוצהרים כבויים:',
      ...off,
      '',
      '/sources off <id> · /sources on <id>',
    ].join('\n')
  );
});

bot.command('mix', (ctx) => ctx.reply(notify.mixReport(store.recentPublished())));
bot.command('usage', (ctx) => ctx.reply(usageReport(), { parse_mode: 'Markdown' }));

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
  const day = localDay(new Date());
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
      stagedToday: store.stagedToday(day) - store.rejectedToday(day),
      rejectedToday: store.rejectedToday(day),
      remainingToday: remainingToday(day),
      dailyTarget: dailyTarget(),
      nextGatherInMin: Math.max(0, Math.round((gatherIntervalMs - (Date.now() - lastGatherAt)) / 60000)),
      heldCount: store.heldCount(),
      targetHealth: Object.fromEntries(liveTargets().map((t) => [t, store.targetHealth(t)])),
      targets: liveTargets(),
    })
  );

  // Everything that is NOT a card reports separately, because "why is it only
  // cards" has an answer here that no other line in the status can give, and
  // every one of those answers is a correct timer rather than a broken one.
  //
  // The shoot window may be Shabbat, or it may be 16:00. A deck or a clip may be
  // held by its BACKLOG cap, which is the one that stays shut for days: it is
  // released by tapping approve or reject, not by waiting. Four undecided clips
  // against a ceiling of three is a timer that stopped offering clips a week ago
  // with nothing anywhere saying so, and the fix is a tap.
  //
  // One message for the three of them, not three. The whole point of a status is
  // that it is the place you come to ask.
  const other = [];
  if (SHOOTS_PER_DAY > 0) {
    const when = sendableNow();
    other.push(
      `🎬 תדריכי צילום: ${store.shootsToday()}/${SHOOTS_PER_DAY} היום`,
      `   שעות: ${windowsHe()} (שעון ישראל), לא בשבת`,
      when.ok ? '   ✅ אפשר לשלוח עכשיו' : `   ⏸️ ${when.why}`,
      '   /shoot שולח אחד בלי קשר לשעה'
    );
  }
  const backlogLine = (n, max, how) =>
    n >= max
      ? `   ⏸️ ${n}/${max} ממתינים להחלטה - לא יוצעו חדשים עד שתאשרו או תדחו`
      : `   ✅ ${n}/${max} ממתינים · ${how}`;
  if (DECKS_PER_DAY > 0) {
    other.push(
      `🃏 דקים: ${decksToday}/${DECKS_PER_DAY} היום`,
      backlogLine(store.proposalSize(), DECK_BACKLOG_MAX, '/deck שולח הצעה עכשיו')
    );
  }
  if (CLIPS_PER_DAY > 0) {
    other.push(
      `🎥 קליפים: ${clipsToday}/${CLIPS_PER_DAY} היום`,
      backlogLine(clipsWaiting(), CLIP_BACKLOG_MAX, '/clip בונה אחד עכשיו')
    );
  }
  if (other.length) await ctx.reply(other.join('\n'));
});

bot.command('igquota', async (ctx) => {
  if (!instagramConfigured()) return ctx.reply('אינסטגרם לא מוגדר');
  const health = store.targetHealth('instagram');
  const days = tokenDaysLeft();

  // Everything knowable without asking Instagram anything. Reported first and
  // unconditionally, because the moment the API refuses is exactly the moment
  // you want to know whether the token is the reason — and an earlier version
  // put the token line after the call that throws, so it never printed then.
  const local = [];
  if (days != null) {
    local.push(
      days > 0
        ? `🔑 הטוקן תקף עוד ${days} ימים (מתחדש אוטומטית)`
        : `🔑 הטוקן פג לפני ${Math.abs(days)} ימים - npm run ig-token`
    );
  }
  if (health.lastOkAt) local.push(`✅ פורסם לאחרונה לפני ${notify.humanDuration(Date.now() - health.lastOkAt)}`);
  else local.push('⚪ עוד לא פורסם לאינסטגרם מהמכונה הזו');
  if (health.failures) local.push(`⚠️ ${health.failures} כשלונות ברצף`);

  try {
    const left = await remainingQuota();
    ctx.reply(
      [left == null ? 'לא התקבלה מכסה מ-Graph API' : `📸 נותרו ${left} פרסומים ב-24 השעות הקרובות`, ...local].join('\n')
    );
  } catch (e) {
    // The full diagnostic, not just Graph's sentence. "API access blocked" on
    // its own names a symptom; the code and subcode are what identify it — and
    // a live token printed next to it rules out the first thing you would guess.
    ctx.reply([`🔴 ${describeError(e)}`, '', ...local].join('\n'));
  }
});

/**
 * Build one slideshow.
 *
 * `/deck` lets the model choose what to make; `/deck Prague museum` names it
 * outright, which is what you want when you are testing a change or when the
 * channel needs a specific destination this week.
 *
 * Deliberately on demand rather than on the daily timer. A deck costs an idea
 * call, a search per place and a drafting call per place, and the failure modes
 * (a thin region, an exhausted search budget) are ones you want to read about
 * while you are sitting there, not discover in a digest.
 */
/**
 * Every Pexels video this account has already spent.
 *
 * The store's ledger is the durable answer and would do on its own. The four
 * collections read on top of it are what makes the fix retroactive: a clip
 * staged by scripts/clip-redo.js, a card restored from a backup, anything that
 * put a built candidate somewhere without going through buildClips, is footage
 * that has been seen and is not in the ledger. Cheap to ask — these are all in
 * memory — and the cost of being wrong is being handed the same video twice,
 * which is the complaint.
 *
 * Strings throughout. Pexels ids are numbers in the API and the set is tested
 * against `String(v.id)` in findClips, and a Set of numbers silently matches
 * nothing.
 */
function clipFootageSeen() {
  const seen = store.usedClipIds();
  const add = (cand) => {
    // Clips built before `clip.pexelsId` existed used the Pexels id AS the
    // candidate id. Three of those are in staging, and they are precisely the
    // footage that must not be offered again. store.clipPexelsId knows both
    // shapes and checks the kind, and it is the same function the published log
    // records through — one rule, not a copy per reader.
    // Plural: a cuts clip is several shots and every one of them is footage
    // this account has shown.
    for (const id of store.clipPexelsIds(cand)) seen.add(id);
  };
  for (const { cand } of store.stagingItems()) add(cand);
  for (const cand of store.queuedItems()) add(cand);
  for (const h of store.heldItems()) add(h.cand);
  for (const p of store.recentPublished()) {
    // Rows written before `pexelsIds` existed carry only the singular field.
    for (const id of p.pexelsIds?.length ? p.pexelsIds : p.pexelsId ? [p.pexelsId] : []) {
      seen.add(String(id));
    }
  }
  return seen;
}

/** Spend the footage a finished batch was built from, every shot of every clip. */
const spendClipFootage = (clips) => {
  for (const c of clips) for (const id of store.clipPexelsIds(c)) store.markClipUsed(id);
  // And which SHAPE each one was, in build order, which is what makes the two
  // shapes alternate across days instead of only inside one batch. Recorded here
  // beside the footage because it is the same moment and the same rule: a clip
  // that was built is spent, whatever is done with it next.
  for (const c of clips) store.noteClipShape(c.clip?.shape || 'held');
};

/**
 * `/clip` — build short vertical videos and stage them for approval.
 *
 * `/clip` builds one, `/clip 3` builds three. Each arrives as a playable video
 * in the chat with approve and reject under it, and an approved clip goes to
 * the account's TikTok inbox as a DRAFT rather than as a post: the API has no
 * field for choosing a sound, and sound is the one thing that cannot be changed
 * after publishing. The same bargain decks make, for the same reason.
 *
 * On demand rather than on the timer, like /deck. A batch costs a vision call
 * per candidate, a writing call per clip, and an ffmpeg encode per clip — and
 * the interesting failures (nothing scored above the destination gate, a source
 * that would not decode) are ones to read while sitting here.
 */
bot.command('clip', async (ctx) => {
  const arg = (ctx.message.text || '').replace(/^\/clip(@\S+)?\s*/, '').trim();
  const { clipShapeArg, buildClips } = await import('./src/video/clip.js');
  const { postConfig } = await import('./src/postConfig.js');
  // The number wherever it is in the argument, so `/clip cuts 2` and `/clip 2
  // cuts` mean the same thing. A bare `/clip cuts` is one clip.
  const count = Math.min(5, Math.max(1, Number((arg.match(/\d+/) || [])[0]) || 1));
  const shape = clipShapeArg(arg);

  await ctx.reply(
    `⏳ בונה ${count} קליפ${count === 1 ? '' : 'ים'}${shape ? ` · ${shape === 'cuts' ? 'חתוך' : 'שוט אחד'}` : ''}...`
  );
  detach(
    'קליפים',
    // Billed to clips by hand, because this one is not a wrapped job: /clip
    // reaches buildClips directly rather than through suggestClip. See `billed`.
    () => forKind('clip', async () => {
      const { clips, considered, nowhere, failed, written, asked, shapes: got } = await buildClips({
        count,
        seen: clipFootageSeen(),
        // Named, or the next in the alternation from whatever was built last.
        shapes: shape ? Array.from({ length: count }, () => shape) : null,
        after: store.lastClipShape(),
      });
      // Before they are staged, and before anything can fail. A clip that was
      // built exists — the encode happened and you are about to be shown it —
      // so it is spent whatever the next line does with it.
      spendClipFootage(clips);

      if (!clips.length) {
        // The reason matters and is not guessable from an empty result: "the
        // queries returned nothing" and "everything returned was an anonymous
        // road" are different problems with different fixes.
        const why = nowhere?.length
          ? [`${considered} נבדקו, אף אחד לא עבר את סף היעד:`, ...nowhere.slice(0, 5).map((n) => `   ✗ ${n}`)].join('\n')
          : 'לא נמצאו קליפים מתאימים';
        await notify.send(bot.telegram, ctx.chat.id, `🎬 אין קליפ להציג.
${why}`).catch(() => {});
        return;
      }

      for (const clip of clips) await stage(clip);

      const notes = [];
      if (written < clips.length) notes.push(`⚠️ ${clips.length - written} שורות מהמאגר ולא נכתבו`);
      // A cuts clip that could not be assembled falls through to a single shot,
      // so a "failed" line can sit under a clip that arrived perfectly well. Said
      // plainly, with the reason, because it is the one report that tells you the
      // judge is naming countries and not places — which is a query to fix, not a
      // bug to chase.
      const fellBack = (asked || []).filter((s) => s === 'cuts').length - (got || []).filter((s) => s === 'cuts').length;
      if (fellBack > 0) {
        notes.push(
          `ℹ️ ${fellBack} קליפ${fellBack === 1 ? '' : 'ים'} ירדו מחתוך לשוט אחד - לא נמצאו ${
            postConfig().clips.cuts.cutsMin
          } מקומות ספציפיים שונים`
        );
      }
      const real = (failed || []).filter((f) => !/^cuts: need /.test(f));
      if (real.length) notes.push(`⚠️ ${real.length} נכשלו בבנייה: ${real[0]}`);
      if (notes.length) await notify.send(bot.telegram, ctx.chat.id, notes.join('\n')).catch(() => {});
    }),
    ctx.chat.id
  );
});

/**
 * `/trip` — an AI-written itinerary, as a slideshow.
 *
 * `/trip` picks a destination the feed has not just used, `/trip רומא` names
 * one, and `/trip רומא 5` names the length too. What you name does not have to
 * be in destinations.json and does not have to be in Hebrew: `/trip norway` and
 * `/trip lake como` both resolve, on one cheap model call, to a place the plan
 * can be written for. The argument order is "where, then how long" because that
 * is the order the sentence goes in, and the number
 * is the only part that can be a bare digit — so `/trip 5` is five DAYS
 * somewhere chosen, not five itineraries. That differs from /clip and /deck on
 * purpose: one plan is a post, and five plans is five posts nobody asked to
 * review at once.
 *
 * One model call, one browser, one staged candidate with the whole itinerary
 * printed under the album. An approved plan goes to the TikTok inbox as a draft
 * and to Instagram as a carousel.
 */
const suggestPlan = billed('plan', suggestPlanJob);
async function suggestPlanJob(asked, days, chatId = staging, budgetIls = null) {
  const { writePlan, resolveDestination, pickDestination } = await import('./src/plan/write.js');
  const { toPlanCandidate } = await import('./src/plan/candidate.js');

  // Which destinations the feed has just been about, so the picker can skip
  // them. The same history the deck's repeat notes are counted from, and the
  // resolver gets it too: `/trip norway` is a request for a Norwegian
  // itinerary, and which Norwegian city is the freshness rules' business.
  const recent = store.recentPublished().slice(0, 12).map((p) => p.place);

  // A destination typed by hand is RESOLVED rather than refused. It used to
  // answer "not in destinations.json, add it with the Hebrew spelling",
  // which sent you to edit a JSON file to get a video out of a word the
  // catalogue could already place. See the note in src/plan/write.js.
  const found = asked ? await resolveDestination(asked, { recent }) : null;
  if (asked && !found) {
    await notify.send(bot.telegram, chatId, `❌ לא הצלחתי להבין איזה יעד זה: ${asked}`).catch(() => {});
    return null;
  }
  if (found) console.log(`trip: "${asked}" -> ${found.dest.he} (${found.how})`);

  // THE SITE FIRST, WHEN IT HAS THIS DESTINATION.
  //
  // The destination is chosen before either route runs, by the same weighted,
  // recency-aware picker as before, so what changes here is where the
  // itinerary comes from and not which places this account posts about. The
  // site covers 37 of the 102 rows in destinations.json, so most plans still
  // take the AI route, and a budget is an AI-only request: the site publishes
  // a price band rather than prices, and there is nothing to plan against.
  const { writeSitePlan } = await import('./src/plan/site.js');
  const prefer = postConfig().plans.source.prefer;

  // ONE DESTINATION, CHOSEN ONCE, FOR BOTH ROUTES.
  //
  // The site route needs it up front to know whether there is a page, and if
  // the AI fallback picked its own afterwards then which city you got would
  // depend on which route happened to answer - so a day the site was down
  // would quietly change the subject of the post as well as its source.
  const dest = found?.dest || pickDestination(recent);

  let plan = null;
  if (prefer === 'site' && !budgetIls) {
    plan = await writeSitePlan({ dest, days }).catch((e) => {
      // The site being unreachable is not a reason to refuse a plan: the AI
      // route below is exactly the fallback for it. Logged rather than sent,
      // because it is an infrastructure note and the owner asked for an
      // itinerary.
      console.log(`trip: site route failed (${e.message}), falling back`);
      return null;
    });
    if (plan) console.log(`trip: ${plan.slug} from the site, ${plan.days.length} days`);
  }
  if (plan) {
    const cand = await toPlanCandidate(plan);
    await stage(cand);
    if (plan.dropped?.length) {
      await notify.send(bot.telegram, chatId, `⚠️ ${plan.dropped.length} שורות נפסלו בבנייה`).catch(() => {});
    }
    return cand;
  }

  try {
    plan = await writePlan({ dest, days, budgetIls, recent });
  } catch (e) {
    // A plan that will not fit its budget is a RESULT, not a crash. The
    // planner is told to come back honest and over rather than cheap and
    // false (src/plan/write.js), so this path is reached by the guard working
    // and deserves a sentence somebody can act on: raise the number, cut a
    // day, or pick somewhere nearer.
    if (budgetIls && (e.overBudget || /budget/.test(e.message))) {
      await notify
        .send(
          bot.telegram,
          chatId,
          `❌ ${budgetIls.toLocaleString('en-US')} ₪ לא מספיק ל${found?.dest?.he || 'יעד הזה'} ל-${days || ''} ימים.\n   ${e.message}\n   אפשר להעלות את התקציב, לקצר ביום, או לבחור יעד קרוב יותר.`
        )
        .catch(() => {});
      return null;
    }
    throw e;
  }
  const cand = await toPlanCandidate(plan);
  await stage(cand);

  if (plan.dropped?.length) {
    await notify.send(bot.telegram, chatId, `⚠️ ${plan.dropped.length} שורות נפסלו בבנייה`).catch(() => {});
  }
  return cand;
}

/**
 * One post of the five types, built and staged.
 *
 * THE DESTINATION IS RESOLVED THE SAME WAY /trip RESOLVES ONE, so "/post רומא" and
 * "/post rome" and "/post" all work and the weighted, recency-aware picker decides when
 * nobody said. What differs is everything after: the type, the look, the frame and the
 * caption shape come from the rotation in src/posts/types.js rather than from a fixed
 * format, and every one of the four is recorded so the weekly report can rank by it.
 *
 * `alternatives` is the one thing the rotation cannot decide. An `instead` post needs
 * three destinations in the same region as the one it argues against, and "the same
 * region" is a judgement no field on the page answers - so when the rotation lands on
 * that type unasked, the alternatives are drawn from the catalogue's own country, and
 * when it cannot find three the type is swapped for the next one down.
 */
const suggestPost = billed('post', suggestPostJob);
async function suggestPostJob(asked, { type = null, look = null, frame = null, days = null } = {}, chatId = staging) {
  const { buildPost } = await import('./src/posts/index.js');
  const { resolveDestination, pickDestination } = await import('./src/plan/write.js');

  const recent = store.recentPublished().slice(0, 12).map((p) => p.place);
  const found = asked ? await resolveDestination(asked, { recent }) : null;
  if (asked && !found) {
    await notify.send(bot.telegram, chatId, `❌ לא הצלחתי להבין איזה יעד זה: ${asked}`).catch(() => {});
    return null;
  }
  const dest = found?.dest || pickDestination(recent);

  // A destination with no page on the site cannot carry any of these types - every one
  // of them is built from the page. Said rather than silently swapped: the owner asked
  // for this destination, and choosing a different one without saying so is how a
  // command comes to look like it worked and produce the wrong post.
  if (!dest?.siteSlug && !dest?.id) {
    await notify.send(bot.telegram, chatId, '❌ אין יעד לבנות ממנו').catch(() => {});
    return null;
  }

  // The alternatives for an `instead` post: the catalogue's own rows in the same
  // country that the site actually has a page for.
  const rows = JSON.parse(readFileSync(new URL('./destinations.json', import.meta.url), 'utf8')).destinations;
  const alternatives = rows
    .filter((r) => r.country === dest.country && r.id !== dest.id && r.siteSlug)
    .slice(0, 4);

  const cand = await buildPost({
    dest,
    type,
    look,
    frame,
    days,
    alternatives,
    defaultHe: dest.he,
    regionHe: dest.country,
    targets: targetsForKind('post'),
    onProgress: (text) => console.log(`post: ${text}`),
  }).then((r) => r.cand);

  await stage(cand);
  return cand;
}

/**
 * `/make`, `/make רומא`, `/make list פראג`, `/make plan notes רומא`.
 *
 * NOT `/post`, WHICH IS TAKEN. `/post 2` publishes item 2 from the queue and has meant
 * that since before any of this existed; a second registration of the same name would
 * shadow it, and the command that publishes is not one to break for a naming
 * preference. `/make` also reads correctly beside the others: /deck, /clip and /trip
 * all BUILD something that then waits for a tap, and so does this.
 *
 * Everything before the destination is a modifier and everything after it is the
 * destination, which is what makes all four forms read naturally. A word that is not a
 * known type, look or frame is treated as part of the destination rather than refused -
 * "/make new york" must not fail because "new" is not a look.
 */
bot.command('make', async (ctx) => {
  const arg = (ctx.message.text || '').replace(/^\/make(@\S+)?\s*/, '').trim();
  const words = arg.split(/\s+/).filter(Boolean);

  const cfg = postConfig().posts;
  const types = new Set(cfg.types.map((t) => t.id));
  const looks = new Set(cfg.looks.map((l) => l.id));
  const frames = new Set(cfg.frames.map((f) => f.id));

  let type = null;
  let look = null;
  let frame = null;
  let days = null;
  while (words.length) {
    const w = words[0].toLowerCase();
    if (!type && types.has(w)) type = words.shift().toLowerCase();
    else if (!look && looks.has(w)) look = words.shift().toLowerCase();
    else if (!frame && frames.has(w)) frame = words.shift().toLowerCase();
    else if (!days && /^[1-9]$/.test(w)) days = Number(words.shift());
    else break;
  }
  const asked = words.join(' ').trim();

  await ctx.reply(
    `⏳ ${[type || 'פוסט', look, frame, asked].filter(Boolean).join(' · ')}...`
  );
  detach('פוסט', () => runOverridden('/make', () => suggestPost(asked, { type, look, frame, days }, ctx.chat.id)), ctx.chat.id);
});

/**
 * The weekly report, now.
 *
 * `/report` for the last seven days, `/report 30` for a month. It reads what the
 * collector has already stored rather than fetching, so it is instant and can be asked
 * for as often as you like - and `/report fetch` does a collection pass first, for when
 * something has just published and the numbers are wanted before the next timer.
 */
bot.command('report', async (ctx) => {
  const arg = (ctx.message.text || '').replace(/^\/report(@\S+)?\s*/, '').trim();
  const days = Math.max(1, Math.min(90, Number(arg.match(/\d+/)?.[0]) || 7));

  if (/fetch|רענן/i.test(arg)) {
    await ctx.reply('⏳ מושך מספרים...');
    const got = await collectMetrics().catch((e) => ({ error: e.message }));
    if (got.error) await ctx.reply(`⚠️ ${got.error}`);
    else await ctx.reply(`📥 ${describeCollection(got)}`);
  }

  await ctx.reply(weeklyReport({ days }));
});

bot.command('trip', async (ctx) => {
  const arg = (ctx.message.text || '').replace(/^\/trip(@\S+)?\s*/, '').trim();
  const { asked, days, budgetIls, error } = parseTripArgs(arg);

  // A number that could not be read is said so rather than dropped. The old
  // parser took the last digits as days whatever they were, so "/trip פראג 5
  // 1200" quietly planned a trip to a place called "פראג 5" and threw the
  // budget away - a command that looks like it worked and produced the wrong
  // post, which is the worst of the three possible outcomes.
  if (error) {
    await ctx.reply(`⚠️ ${error}`);
    return;
  }

  await ctx.reply(
    `⏳ מתכנן ${asked || 'יעד'}${days ? ` · ${days} ימים` : ''}${budgetIls ? ` · ${budgetIls.toLocaleString('en-US')} ₪` : ''}...`
  );
  detach('מסלול', () => suggestPlan(asked, days, ctx.chat.id, budgetIls), ctx.chat.id);
});

/**
 * A shot list, now.
 *
 * `/shoot` for one, `/shoot 3` for three, the same convention /clip and /deck
 * already use. Unlike either of them, nothing is built and nothing is staged:
 * a shoot has no publish step because the video does not exist until somebody
 * films it, so this ends at a message rather than at a button.
 *
 * It ignores the posting window on purpose. The window governs the TIMER — when
 * it is worth sending something unasked, because a shot list is acted on within
 * the hour and one that arrives at 03:00 is read at 11:00 with its window shut.
 * Asking for one is not the same as being offered one, which is the same rule
 * /run and /deck already follow for the daily quotas.
 */
bot.command('shoot', async (ctx) => {
  const arg = (ctx.message.text || '').replace(/^\/shoot(@\S+)?\s*/, '').trim();
  const count = Math.min(5, Math.max(1, Number(arg) || 1));

  await ctx.reply(`⏳ מכין ${count} תדריך${count === 1 ? '' : 'ים'}...`);
  detach(
    'תדריכים',
    async () => {
      const sent = await sendShoots(count, ctx.chat.id);
      if (!sent) await notify.send(bot.telegram, ctx.chat.id, '❌ לא הוכן תדריך').catch(() => {});
    },
    ctx.chat.id
  );
});

bot.command('deck', async (ctx) => {
  const arg = (ctx.message.text || '').replace(/^\/deck(@\S+)?\s*/, '').trim();

  // `/deck 5` — five SUGGESTIONS, the same convention /run 7 uses for cards.
  //
  // A bare number cannot be a region, so it is unambiguous, and it is the
  // shape already in the muscle memory. Like /run it steps over the daily
  // budget: DECKS_PER_DAY paces what arrives unasked, and asking is not that.
  // It costs one model call and builds nothing — each idea still waits for its
  // own tap.
  // `/deck free <anything>` — a deck the seven categories cannot express.
  //
  // Opt-in rather than a fallback, because what it produces is a different
  // artefact: names and photographs, no sourced facts. That is the right trade
  // for "northern lights in Norway" and the wrong one for "museums in Prague",
  // and the difference should be something you asked for rather than something
  // the resolver decided when it ran out of categories.
  const free = /^free\s+(.+)$/i.exec(arg);
  if (free) {
    const asked = free[1].trim();
    await ctx.reply(`⏳ ${asked}...`);
    detach(
      'רעיון חופשי',
      () =>
        runOverridden('/deck', async () => {
          const idea = await freeformIdea(asked);
          await proposeDeck(idea, [], ctx.chat.id);
        }),
      ctx.chat.id
    );
    return;
  }

  const wanted = Number(arg);
  if (arg && Number.isInteger(wanted) && wanted > 0) {
    const n = Math.min(wanted, 8);
    await ctx.reply(`⏳ ${n} רעיונות...`);
    detach(
      'רעיונות למצגות',
      () => runOverridden('/deck', () => suggestDecks(n, ctx.chat.id)),
      ctx.chat.id
    );
    return;
  }

  if (!searchConfigured()) {
    await ctx.reply(
      '⚠️ חיפוש לא מוגדר (GOOGLE_CSE_KEY, GOOGLE_CSE_CX) - נשתמש רק בעמוד הראשי של כל מקום, מה שבדרך כלל לא מספיק לעובדות'
    );
  }

  // A deck is minutes of work: an idea call, a search and a drafting call per
  // place, then twelve renders. Held inside the handler it overran Telegraf's
  // timeout and took the process down with it.
  // Owner-triggered, so the guards give way — and a deck asked for by name is
  // the case the override was written for. "Two Dolomites decks back to back"
  // is a legitimate request; it is only a problem if it happens without anyone
  // saying so, which is what the disclosure on the approval card prevents.
  detach(
    'בניית מצגת',
    () => runOverridden('/deck', () => buildAndStageDeck(arg, ctx.chat.id)),
    ctx.chat.id
  );
});

const buildAndStageDeck = billed('deck', buildAndStageDeckJob);
async function buildAndStageDeckJob(arg, chatId) {
  const say = (text) => notify.send(bot.telegram, chatId, text).catch(() => {});

  let idea;
  let alternatives = [];
  try {
    if (arg) {
      // Anything at all: "Prague museum", "mountains Italy", "japan autumn",
      // "הרים בשווייץ". Parsed when it parses and interpreted when it does not,
      // so the command answers with a slideshow rather than with a grammar
      // complaint.
      const req = await resolveRequest(arg);
      alternatives = req.alternatives;
      console.log(`deck: resolving request ${req.where} / ${req.kind}`);
      // A requested deck gets a written cover too. Naming it "Prague · museum"
      // put a filename on the front of a Hebrew slideshow.
      const cover = await titleForRequest({ where: req.where, kind: req.kind, count: req.want }).catch(() => ({
        titleHe: req.titleHe,
      }));
      // `asked` is what YOU typed, kept so the proposal can show it beside what
      // the resolver made of it. A request naming a country is narrowed to the
      // part travellers mean — Austria + trails becomes Tyrol — because a
      // country-wide bounding box returns places that do not belong on one
      // list. That is a defensible rule, and it was invisible: the card showed
      // "Tyrol" with nothing to say where Tyrol had come from.
      //
      // whyNow was the literal English 'asked for directly', which is how an
      // English sentence ended up in the middle of a Hebrew card. Dropped: the
      // asked line says the same thing, in Hebrew, and says something useful.
      // `freeform` is derived from the category here too, and from the same
      // predicate. A deck asked for by name does not go through normaliseIdea,
      // so before this it was the one route that ignored the routing entirely:
      // "/deck mountains Switzerland" went off to source official pages for
      // five summits that do not have any.
      idea = {
        ...cover,
        where: req.where,
        kind: req.kind,
        want: req.want,
        whyNow: null,
        asked: arg,
        freeform: !isSourcedKind(req.kind),
      };
    } else {
      console.log('deck: proposing ideas');
      const picked = await pickIdea();
      if (!picked) return say('❌ לא חזרו רעיונות');
      idea = picked.idea;
      alternatives = picked.alternatives;
    }

    // The idea is now TEXT, and text is where it stops until you say otherwise.
    //
    // Everything below the proposal — sourcing each place, a drafting call per
    // place, twelve renders — takes minutes and real quota, and all of it used
    // to happen before you had seen anything. A deck you did not want cost the
    // whole build and was rejected at the end of it. Now it costs one message.
    return proposeDeck(idea, alternatives, chatId);
  } catch (e) {
    console.error('deck idea failed:', e);
    return say(notify.withDetail('❌ לא הצלחתי להציע מצגת', e));
  }
}

/** The proposal itself: what would be built, and the three ways to answer it. */
/** Did the resolver hand back a different region from the one you named? */
const narrowedFrom = (idea) => {
  const asked = String(idea.asked || '').trim();
  const where = String(idea.where || '').trim().toLowerCase();
  return asked && where && !asked.toLowerCase().includes(where) ? asked : null;
};

function proposalMessage(idea) {
  // `ownWords`, not `freeform`. A deck you described in your own words is what
  // this branch is for — no category, and the request quoted back. Landscape
  // proposals are free-form too now and DO have a category, so they take the
  // ordinary branch below and pick up the no-facts line there. Not `asked`
  // either: a deck requested by name carries that too.
  if (idea.ownWords) {
    return [
      `💡 ${idea.titleHe}`,
      `📍 ${idea.whereEn} · חופשי · ${idea.places.length} מקומות`,
      `🗣 ביקשת "${idea.asked}"`,
      '────────────',
      ...idea.places.map((p, i) => `${i + 1}. ${p.nameHe}${p.noteHe ? ` (${p.noteHe})` : ''}`),
      '',
      '(מצגת חופשית - שמות ותמונות בלבד, בלי שעות, מחירים או עובדות מאומתות)',
    ].join('\n');
  }

  return [
    `💡 ${idea.titleHe}`,
    idea.angleHe,
    `📍 ${idea.where} · ${KINDS[idea.kind]?.he || idea.kind} · ${idea.want} מקומות`,
    // Shown only when the resolver moved. Typing "מסלולים אוסטריה" and being
    // offered Tyrol with no explanation reads as the bot ignoring the request,
    // when it is in fact the documented narrowing doing its job. Suppressed
    // when the request already names the region, where repeating it back costs
    // a line and says nothing.
    narrowedFrom(idea) ? `🗣 ביקשת "${idea.asked}" - צומצם ל-${idea.where}, אזור שמפה יכולה לחפש בו` : null,
    idea.whyNow ? `🗓 ${idea.whyNow}` : null,
    // The content, so the decision here is about the post rather than about a
    // headline. This is the PLAN: the build sources its own places from the
    // site or the map and may not find every one of them, which is why the
    // last line says so rather than letting you discover it at the album.
    idea.places?.length ? '────────────' : null,
    ...(idea.places || []).map((p, i) => `${i + 1}. ${p}`),
    // Two different sentences, because the list means two different things.
    // On a sourced deck it is a plan the build may not be able to keep. On a
    // landscape deck nothing is looked up, so the list IS the slides — and the
    // fact that they will carry no hours and no prices is the thing to know
    // before tapping, not after.
    idea.places?.length
      ? idea.freeform
        ? '\n(שמות ותמונות בלבד - בלי שעות, מחירים או עובדות מאומתות)'
        : '\n(רשימה מתוכננת - הבנייה מאתרת את המקומות בפועל ויכולה להחליף חלק)'
      : null,
  ]
    .filter(Boolean)
    .join('\n');
}

// The destination is chosen here, before anything is built — which is the only
// point at which choosing it saves anything. A deck renders twelve slides
// across two aspect ratios; picking the platform first halves that, and the
// approval card then previews the crop that is actually going out rather than
// the other platform's.
const proposalButtons = (key) =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback('📸 אינסטגרם', `db:${key}:instagram`),
      // TikTok is ALWAYS a draft now. There were two buttons and the direct one
      // had nothing to recommend it: the API cannot name a sound, so a direct
      // post gets whatever TikTok picks and can never be changed afterwards —
      // sound is the one thing not editable after publishing. A draft costs one
      // tap in the app and buys the sound, the cover and the caption. It is
      // also not subject to the audit, which the direct path is.
      Markup.button.callback('🎵 טיקטוק (טיוטה)', `db:${key}:tiktok`),
    ],
    [Markup.button.callback('📸🎵 שניהם', `db:${key}:both`)],
    [Markup.button.callback('🤖 שנה בהוראה', `dr:${key}`), Markup.button.callback('❌ דחה', `dx:${key}`)],
  ]);

/**
 * Ask for ideas and pick the one whose place the feed has least of.
 *
 * Shared by /deck and the daily suggestions, so both get the same reordering
 * and the same fallbacks. It is the cheap half of making a deck — one call, no
 * sourcing, no renders — which is what makes suggesting a few a day reasonable.
 */
const pickIdea = billed('deck', pickIdeaJob);
async function pickIdeaJob() {
  const history = store.recentPublished();

  // ONE ISRAELI ANGLE PER REQUEST, drawn against what recently went out.
  //
  // The angle decides which destination is worth a deck this week; it never
  // becomes a line on a slide, and src/angles.js carries that warning into the
  // prompt. Drawn from the published log rather than held in memory so the
  // exclusion window survives a restart, which on a bot that restarts daily is
  // the difference between a rotation and the same angle every morning.
  const angle = pickAngle(history);

  const ideas = await proposeIdeas({ count: 3, recent: store.recentTitles(), angle });
  if (!ideas.length) return null;

  const fresh = ideas.filter((i) => !placeOverCap(i.where, history));
  const ordered = fresh.length ? [...fresh, ...ideas.filter((i) => !fresh.includes(i))] : ideas;
  if (fresh.length && fresh[0] !== ideas[0]) {
    console.log(`deck: "${ideas[0].where}" is over its share - starting from "${fresh[0].where}" instead`);
  }
  return {
    // Carried on the idea so it reaches the candidate, the approval card and
    // the published row. Without the last of those the next draw cannot
    // exclude it and the rotation is a coin toss.
    idea: { ...ordered[0], angle },
    alternatives: ordered.slice(1).map((i) => ({ where: i.where, kind: i.kind })),
  };
}

/**
 * A few deck ideas a day, unasked, the way cards arrive.
 *
 * Only the IDEA is produced here. Nothing is sourced, drafted or rendered until
 * you tap בנה — which is the whole reason this can run on a timer at all: a
 * suggestion costs one model call, and a deck costs minutes and a search budget.
 *
 * Capped two ways. DECKS_PER_DAY is the day's budget, and a ceiling on
 * unanswered proposals stops a week away from returning fourteen stale ideas —
 * the same reasoning as the daily card cap, which exists because an approval
 * queue you cannot face is a queue you stop reading.
 */
// ONE A DAY, NOT TWO. A deck reaches Instagram as a carousel, and a carousel of
// stock photographs is the format Instagram is least willing to recommend to
// people who do not already follow the account, since April 2026 its
// unoriginal-content rule covers photos and carousels, not only reels, and the
// penalty it carries is exactly "not shown to non-followers". Two a day of the
// weakest format was the largest single share of this account's output. It is
// still worth making; it is not worth making twice a day.
const DECKS_PER_DAY = Math.max(0, Number(process.env.DECKS_PER_DAY ?? '1'));
const DECK_BACKLOG_MAX = Math.max(1, Number(process.env.DECK_BACKLOG_MAX ?? '3'));
let deckDay = null;
let decksToday = 0;
let lastDeckSuggestAt = 0;

/**
 * Clips, on the same daily rhythm as cards and decks.
 *
 * BUILT rather than proposed, which is the one way this differs from a deck. A
 * deck suggestion is a line of text you approve before anything is made,
 * because building one costs minutes and a search budget. A clip cannot be
 * judged that way — "a POV of a mountain pass with a line about flying to
 * Italy" tells you nothing about whether the footage is any good or whether
 * the text landed somewhere legible. So it is built and the finished video
 * arrives with approve and reject under it.
 *
 * The cost of building unasked is real but bounded: the vision judge is capped
 * at visionMaxCandidates thumbnails, then one writing call and one encode per
 * clip. It is a fraction of what a deck spends.
 *
 * Capped the same two ways. CLIPS_PER_DAY is the day's budget, and a ceiling on
 * what is already waiting stops a week away from returning fourteen videos —
 * an approval queue you cannot face is a queue you stop reading.
 *
 * It was THREE A DAY, and the number came from measuring the supply rather than
 * from caution: the 26 destination queries return 1479 unique vertical clips in
 * the allowed duration range, which is well over a year of unique footage at
 * three a day. The catalogue was never the constraint.
 *
 * TWO A DAY NOW, and the reason is that a clip stopped being a TikTok-only
 * artefact. It publishes to Instagram as a reel as well (see targets.js), so
 * three a day went from three TikTok posts to three TikTok posts AND three
 * reels, and the point of slowing the drip was to put LESS on Instagram, not
 * to hold the card and the deck back while the clip quietly took their places.
 *
 * Two is also what makes the budgets add up to the drip. One card, one deck and
 * two clips is four, which is what a six-hour interval publishes in a day.
 */
const CLIPS_PER_DAY = Math.max(0, Number(process.env.CLIPS_PER_DAY ?? '0'));

/**
 * How many of the five post types arrive unasked, a day.
 *
 * THE HIGHEST OF THE FOUR, because this is what the account is now. A deck is the older
 * format these replace, a clip is what runs on the days nobody films (and is paused -
 * see CLIPS_PER_DAY), and a shoot is a shot list rather than a post.
 *
 * Built rather than proposed, so the backlog counts what is STAGED and waiting for a
 * tap. Two posts standing unapproved is a queue somebody has stopped reading, and
 * building a third spends a browser and twenty photographs on something that will join
 * them.
 */
const POSTS_PER_DAY = Math.max(0, Number(process.env.POSTS_PER_DAY ?? '2'));
const POST_BACKLOG_MAX = Math.max(1, Number(process.env.POST_BACKLOG_MAX ?? '2'));
const postsWaiting = () =>
  store.stagingItems().filter(({ cand }) => cand?.kind === 'post').length;
let postsToday = 0;
let postDay = null;
let lastPostSuggestAt = 0;
const CLIP_BACKLOG_MAX = Math.max(1, Number(process.env.CLIP_BACKLOG_MAX ?? '3'));
let clipDay = null;
let clipsToday = 0;
let lastClipSuggestAt = 0;

/**
 * Shot lists per day, and it defaults to ONE.
 *
 * Not because more would be expensive — a plan is one model call, far less than
 * a clip — but because the brief's posting rule is one video a day for at least
 * three weeks without long gaps, and the constraint on that is not how many
 * briefs exist. It is how many videos a person will actually film. A queue of
 * five shot lists a day is a queue you stop opening by Thursday, which is the
 * same failure CLIP_BACKLOG_MAX exists to prevent, arrived at from the other
 * direction.
 *
 * The day's count is read from the store rather than held in a variable here,
 * because unlike clips there is nothing staged to count and a restart would
 * otherwise reset the budget to zero.
 */
const SHOOTS_PER_DAY = Math.max(0, Number(process.env.SHOOTS_PER_DAY ?? '1'));
let lastShootAt = 0;

/** How many clips are already staged and waiting for a decision. */
const clipsWaiting = () => store.stagingItems().filter(({ cand }) => cand?.kind === 'clip').length;

/**
 * One clip, built and staged.
 *
 * Failures are reported rather than thrown: this runs on a timer, and a day
 * where every candidate scored below the destination gate is a normal outcome
 * worth a sentence, not a crash. Which is also the sentence that tells you a
 * query has gone stale.
 */
const suggestClip = billed('clip', suggestClipJob);
async function suggestClipJob() {
  const { buildClips } = await import('./src/video/clip.js');
  const { clips, considered, nowhere, written } = await buildClips({
    count: 1,
    seen: clipFootageSeen(),
    // THE ALTERNATION LIVES OR DIES ON THIS LINE. This builds ONE clip, so the
    // batch index is 0 every day, and the shapes used to be chosen by that index
    // — which made every unattended clip this account ever produced a cuts clip
    // and left the held shape reachable only by typing /clip. See nextShapes.
    after: store.lastClipShape(),
  });
  spendClipFootage(clips);

  if (!clips.length) {
    const why = nowhere?.length
      ? `${considered} נבדקו, אף אחד לא עבר את סף היעד`
      : 'לא נמצאו קליפים מתאימים';
    console.log(`clip: nothing to suggest - ${why}`);
    return;
  }

  for (const clip of clips) await stage(clip);
  if (!written) {
    await notify
      .send(bot.telegram, staging, '⚠️ שורת הקליפ נלקחה מהמאגר ולא נכתבה - בדוק את ANTHROPIC_API_KEY')
      .catch(() => {});
  }
}

/**
 * Shot lists, sent one message each.
 *
 * SEQUENTIAL, and each one is recorded before the next is planned. That is the
 * whole reason this is a loop rather than a Promise.all: every rule the
 * rotation enforces is a question about what went out before — never the same
 * shape twice in a row, the product in at least half, which part of the series
 * is next — and three shoots planned concurrently all read the same history and
 * all answer it the same way. `/shoot 3` would return three demos of Greece.
 *
 * Recorded when SENT rather than when acted on, because nothing here can tell
 * whether it was acted on. A shot list you ignored still used up its slot in
 * the rotation, and that is the right direction: the alternative is the same
 * brief arriving every day until you film it.
 */
const sendShoots = billed('shoot', sendShootsJob);
async function sendShootsJob(n, chatId) {
  const { planShoot } = await import('./src/shoot/plan.js');
  const { shootMessage } = await import('./src/shoot/message.js');

  let sent = 0;
  for (let i = 0; i < n; i++) {
    let shoot;
    try {
      shoot = await planShoot({ history: store.shootHistory() });
    } catch (e) {
      await notify.send(bot.telegram, chatId, `❌ תדריך נכשל: ${e.message}`).catch(() => {});
      // One failed plan should not cost the rest of the batch, for the same
      // reason one failed clip does not: a model refusal on the third of three
      // is not a reason to withhold the two that worked.
      continue;
    }
    await bot.telegram.sendMessage(chatId, shootMessage(shoot));
    store.addShoot(shoot);
    sent += 1;
  }
  return sent;
}

/**
 * N ideas at once, each its own proposal card.
 *
 * One model call for the lot rather than N calls, which is most of why asking
 * for five is reasonable. They are reordered by place share the same way a
 * single suggestion is, so five at once cannot come back as five Kyotos.
 *
 * Each still waits for its own tap: this produces five things to decide about,
 * not five decks.
 */
const suggestDecks = billed('deck', suggestDecksJob);
async function suggestDecksJob(n, chatId) {
  const ideas = await proposeIdeas({ count: n, recent: store.recentTitles() });
  if (!ideas.length) return notify.send(bot.telegram, chatId, '❌ לא חזרו רעיונות');

  const history = store.recentPublished();
  const fresh = ideas.filter((i) => !placeOverCap(i.where, history));
  const ordered = fresh.length ? [...fresh, ...ideas.filter((i) => !fresh.includes(i))] : ideas;

  for (const idea of ordered) {
    // Alternatives are the OTHER ideas — each proposal keeps its own fallbacks
    // for when its region turns out to be thin.
    const alternatives = ordered
      .filter((o) => o !== idea)
      .slice(0, 2)
      .map((o) => ({ where: o.where, kind: o.kind }));
    await proposeDeck(idea, alternatives, chatId);
  }
  return true;
}

const suggestDeck = billed('deck', suggestDeckJob);
async function suggestDeckJob() {
  const picked = await pickIdea();
  if (!picked) {
    console.log('deck: no ideas came back');
    return false;
  }
  await proposeDeck(picked.idea, picked.alternatives, staging);
  return true;
}

async function proposeDeck(idea, alternatives, chatId) {
  const key = store.addProposal({ idea, alternatives, chatId });
  await bot.telegram.sendMessage(chatId, proposalMessage(idea), proposalButtons(key));
  return key;
}

/**
 * Build a proposal that was approved, and stage what comes out.
 *
 * The second half of what used to be one straight-through function. It is
 * reached from a button tap rather than from the command, so it re-enters
 * runOverridden: the override is what lets a deck the owner asked for step over
 * the repeat guards, and an AsyncLocalStorage context does not survive the wait
 * for you to tap a button.
 */
const buildProposal = billed('deck', buildProposalJob);
async function buildProposalJob(key, chatId, messageId = null, targets = ['instagram'], draft = false) {
  const say = (text) => notify.send(bot.telegram, chatId, text).catch(() => {});
  const proposal = store.getProposal(key);
  if (!proposal) return say('ההצעה הזו כבר לא ממתינה');
  const { idea, alternatives = [] } = proposal;
  store.clearProposal(key);

  // Progress rewrites the proposal message instead of sending new ones.
  //
  // A deck takes minutes, and silence looks like a hang — that is why these
  // lines existed at all. But each one was a fresh notification, so watching a
  // deck build meant four buzzes to learn three things you could not act on.
  // Editing one message in place keeps the reassurance and costs one
  // notification, which is what the message already spent.
  const progress = async (text) => {
    console.log(`deck: ${text}`);
    if (!messageId) return;
    await bot.telegram.editMessageText(chatId, messageId, undefined, text).catch(() => {});
  };

  try {
    await progress(`⏳ ${idea.titleHe}\n${idea.freeform ? 'מחפש תמונות' : 'מחפש מקורות'}...`);

    // A free-form deck has no sources to find — its places are already named
    // and it carries no facts — so it goes straight to the photographs. There
    // is no fallback ladder either, because there is no region to fall back to.
    // A free-form idea from /deck free already IS the builder's shape; one from
    // a proposal has to be adapted, because its places were chosen when the
    // idea was and must not be asked for a second time.
    const built = idea.freeform
      ? await buildFreeformDeck(idea.ownWords ? idea : freeformFromIdea(idea), {
          // Rewrites the same message, so a seven-place image hunt reports
          // itself without costing seven notifications.
          onProgress: ({ done, of, name, ok }) =>
            progress(`⏳ ${idea.titleHe}
${done}/${of} · ${ok ? '📷' : '✗'} ${name}`),
        })
      : await buildWithFallback(idea, alternatives, {
          // Said out loud, because a deck takes minutes and silence looks like
          // a hang. "Bernese Alps came back with two slides, trying Valais" is
          // also the most useful thing to know afterwards.
          onAttempt: (attempt, i, why) => {
            if (i > 0) progress(`↩️ ${idea.titleHe}\nלא הסתדר, מנסה ${describeAttempt(attempt)}...`);
          },
        });
    if (!built?.slides?.length) {
      // Still a suggestion rather than a dead end: the request was understood,
      // the region just has nothing mappable in it, and the next thing to try
      // is worth saying out loud.
      const next = alternatives[0];
      return say(
        [
          `😕 לא הצלחתי לבנות מצגת על ${idea.where} / ${KINDS[idea.kind]?.he || idea.kind}`,
          next ? `💡 שווה לנסות: /deck ${next.where} ${next.kind}` : '💡 נסה אזור ממוקד יותר, למשל /deck Dolomites trail',
        ].join('\n')
      );
    }

    // Rendered for the chosen destination only, and staged owing just that one.
    const cand = await toDeckCandidate(built, { targets, tiktokDraft: draft });

    if (store.hasPublished(cand.id)) {
      return say(`⏭️ המצגת הזו כבר פורסמה (${cand.id}) - /deck שוב לרעיון אחר`);
    }

    // The proposal message has done its job. Removing it means the deck arrives
    // as one album and one approval card, with no stale "⏳ building" line left
    // above them contradicting the finished thing underneath.
    if (messageId) await bot.telegram.deleteMessage(chatId, messageId).catch(() => {});
    await stage(cand);

    // No summary message. It said slide count, style and search budget — and
    // the approval card above it already carries the first two in its header,
    // so it was a second notification to repeat what you were already reading.
    // The budget line goes to the log, where a number you check occasionally
    // belongs.
    console.log(
      `deck: staged ${built.slides.length} slides · style ${built.style}` +
        (built.short ? ` · asked for ${idea.want}` : '') +
        (searchConfigured() ? ` · ${searchRemaining()}/${searchBudget()} searches left today` : ' · no search')
    );
  } catch (e) {
    console.error('deck failed:', e);
    // The dropped list is the useful part of a failure here: "nothing had an
    // official page" and "the search budget ran out" look identical otherwise.
    const why = e.deck?.dropped?.length
      ? ['', ...e.deck.dropped.slice(0, 5).map((d) => `   ✗ ${d.place}: ${String(d.why).slice(0, 90)}`)].join('\n')
      : '';
    await say(notify.withDetail(`❌ בניית המצגת נכשלה${why}`, e));
  }
}

/**
 * What a working connection needs, and the two ways to get one.
 *
 * NOT a link. An earlier version of this printed an authorize URL built here,
 * and it could never have worked: the website's callback mints its own `state`,
 * stores it, and checks the one that comes back matches. A link built anywhere
 * else carries a state that callback never issued, so it lands on
 * "הבקשה לא אומתה" every time — which is the callback doing its job.
 *
 * So the bot cannot hand out a browser link. What it can do is say precisely
 * which scopes it needs, because that is the fact that lives on this side: the
 * post mode decides the scope, and the bot is what chooses the post mode.
 */
bot.command('tiktok_connect', (ctx) => {
  const missing = tiktokMissingScopes({ draft: true });
  ctx.reply(
    [
      missing.length
        ? `🔴 החיבור הנוכחי חסר: ${missing.join(', ')}`
        : '✅ החיבור הנוכחי כולל את כל ההרשאות הדרושות',
      '',
      'ההרשאות הדרושות, בדיוק כך:',
      TIKTOK_SCOPES.join(','),
      '',
      'דרך 1 - לתקן את הדף באתר:',
      'ב-/tiktok/connect, הפרמטר scope בקישור ההרשאה צריך להיות המחרוזת שלמעלה.',
      'רק האתר יכול לייצר state שה-callback שלו יקבל, ולכן רק הוא יכול לסיים חיבור בדפדפן.',
      '',
      'דרך 2 - מהטרמינל ב-VPS, עובד עכשיו:',
      'npm run tiktok-token',
      'הסקריפט מדפיס קישור עם ההרשאות הנכונות. פתחו, אשרו, ואז העתיקו את כל',
      'הכתובת מהדפדפן והדביקו בטרמינל. דף ה-callback יראה שגיאת state - זה צפוי,',
      'והקוד עדיין תקף כי הדף לא עשה בו שימוש.',
    ].join('\n'),
    { link_preview_options: { is_disabled: true } }
  );
});

bot.command('tiktok', async (ctx) => {
  if (!tiktokConfigured()) {
    return ctx.reply(
      'טיקטוק לא מחובר.\nהגדר TIKTOK_CLIENT_KEY ו-TIKTOK_CLIENT_SECRET ו-TIKTOK_REDIRECT_URI ב-.env, ואז npm run tiktok-token'
    );
  }

  const health = store.targetHealth('tiktok');
  const hours = tiktokHoursLeft();
  const refreshDays = tiktokRefreshDaysLeft();

  // Everything knowable without asking TikTok anything comes first, for the
  // same reason /igquota does it: when the API refuses, the token state is the
  // first thing you want next to the refusal, not after it.
  const local = [];
  if (hours != null) {
    local.push(
      hours > 0
        ? `🔑 טוקן הגישה תקף עוד ${hours} שעות (מתחדש אוטומטית)`
        : `🔑 טוקן הגישה פג - יתחדש בפרסום הבא, או npm run tiktok-token`
    );
  }
  if (refreshDays != null) local.push(`🔁 טוקן הרענון תקף עוד ${refreshDays} ימים`);

  // The scopes, which nothing reported until a post failed on one. The stored
  // token has carried them all along; they were simply never read back, so a
  // connection that could not publish looked identical to one that could until
  // TikTok said otherwise at init.
  const granted = store.getTikTokToken()?.scope;
  if (granted) {
    local.push(`🔐 הרשאות: ${granted}`);
    // Decks go out as drafts, so video.upload is the one that matters.
    const missing = tiktokMissingScopes({ draft: true });
    if (missing.length) {
      local.push(
        `🔴 חסר: ${missing.join(', ')} - פרסום ייכשל עד חיבור מחדש.`,
        '   רענון טוקן לא מוסיף הרשאות; צריך אישור חדש מול טיקטוק.'
      );
    }
  }
  if (health.lastOkAt) local.push(`✅ פורסם לאחרונה לפני ${notify.humanDuration(Date.now() - health.lastOkAt)}`);
  else local.push('⚪ עוד לא פורסם לטיקטוק מהמכונה הזו');
  if (health.failures) local.push(`⚠️ ${health.failures} כשלונות ברצף`);

  try {
    const info = await creatorInfo();
    const levels = info.options.map(privacyHe).join(', ') || 'לא התקבלו';
    const audit =
      info.options.length === 1 && info.options[0] === 'SELF_ONLY'
        ? '\n⚠️ רק פרסום פרטי זמין - זה מה שאפליקציה לפני אישור (audit) מקבלת'
        : '';
    ctx.reply([`🎵 @${info.username || '?'}`, `🔒 רמות פרטיות זמינות: ${levels}${audit}`, ...local].join('\n'));
  } catch (e) {
    ctx.reply([`🔴 ${describeTikTokError(e)}`, '', ...local].join('\n'));
  }
});

/**
 * Per-destination health, and what is holding anything back.
 *
 * The report that did not exist while TikTok never once published. /status
 * carries a health line, but it is one line among twenty and it reads as
 * healthy whenever *something* went out — which stayed true the whole time,
 * because Telegram and Instagram were fine.
 *
 * Union of the configured destinations and every destination with a stored
 * record, so one that has been switched off while broken still reports rather
 * than vanishing from the list that would have explained it.
 */
bot.command('health', (ctx) => {
  const targets = [...new Set([...liveTargets(), ...store.healthTargets()])];
  const rows = targets.map((target) => ({
    target,
    ...store.targetHealth(target),
    // The stored flag, not the applied one: a destination inside its cooldown
    // and a destination due a probe are different answers to "why is nothing
    // going out", and isDegraded() alone cannot tell them apart.
    degraded: store.isDegradedLatched(target),
    recoveryDueAt: store.recoveryDueAt(target),
  }));

  const extra = [];
  if (tiktokConfigured()) {
    const cap = TIKTOK_DAILY_CAP();
    const used = store.tiktokPostsInLast24h();
    extra.push(`🎵 טיקטוק: ${used}/${cap} פוסטים ב-24 שעות האחרונות`);
    if (used >= cap) {
      const freesAt = store.tiktokCapFreesAt();
      if (freesAt) extra.push(`   המכסה מתפנה בעוד ${notify.humanDuration(Math.max(0, freesAt - Date.now()))}`);
    }
    const hours = tiktokHoursLeft();
    if (hours != null) extra.push(`   🔑 טוקן גישה: ${hours} שעות`);
  }
  if (store.heldCount()) extra.push(`📥 ${store.heldCount()} פוסטים מוחזקים · /held · /retry`);
  if (store.queueSize()) extra.push(`📦 ${store.queueSize()} בתור`);

  ctx.reply(notify.healthReport(rows, extra));
});

bot.command('help', (ctx) =>
  ctx.reply(
    [
      'פקודות:',
      '/run - סבב איסוף עכשיו',
      '/run <מספר> - סבב עם יעד גדול יותר, עוקף מכסות (מדווח מה נעקף)',
      '/redo - שכח מה כבר נראה והרץ שוב (לבדיקת שינויים בעיצוב/נוסח)',
      '/status - סטטוס מלא',
      '/health - בריאות כל יעד בנפרד, והשגיאה האחרונה',
      '/pending - רשימת הממתינים לאישור',
      '/resend - שולח שוב את כרטיסי האישור (אם לא הגיעו)',
      '/queue - מה בתור, לפי הסדר, ממוספר',
      '/next - מפרסם את הבא בתור',
      '/post <מספר> - מפרסם אחד מסוים מהתור, מדלג על הסדר',
      '/draft <מספר> - שולח את החצי של טיקטוק לטיוטות עכשיו',
      '/held - פוסטים מאושרים שממתינים ליעד שנפל',
      '/retry - אחרי שתיקנת: מחזיר אותם לתור',
      '/clear_held - מוותר על המוחזקים ומסמן את היעדים כתקינים',
      '/why [n] - מה נפסל ולמה',
      '/mix - תמהיל הנושאים שפורסמו',
      '/sources - רשימת המקורות',
      '/igquota - מכסת אינסטגרם',
      '/tiktok_connect - קישור חיבור לטיקטוק עם ההרשאות הנכונות',
      '/deck - מציע רעיון למצגת',
      '/deck 5 - חמישה רעיונות בבת אחת (עוקף את המכסה היומית)',
      '/deck Kyoto temple - רעיון על יעד מסוים',
      '/deck free <בקשה> - מצגת חופשית: שמות ותמונות, בלי עובדות מאומתות',
      '/deck <מקום> <קטגוריה> - מצגת מוזמנת, למשל: /deck Prague museum',
      '/tiktok - חיבור טיקטוק, טוקנים ורמות פרטיות',
      '/shoot - תדריך צילום אחד: הוק, ביטים, מה לצלם וכיתוב מוכן',
      '/shoot 3 - שלושה תדריכים',
      '/trip - מסלול שנכתב ב-AI, כמצגת: יעד שלא היה לאחרונה',
      '/trip רומא - מסלול ליעד מסוים',
      '/trip רומא 5 - ולמספר ימים מסוים',
      '/trip פראג 5 1200 - ועם תקציב: הכל כלול, טיסה ולינה ואוכל ותחבורה וכניסות',
      '   השער הוא 600 ₪. מספר קטן ממנו הוא ימים, גדול ממנו הוא תקציב',
      '/clip - קליפ אחד. שלוש צורות מתחלפות בסבב',
      '   חתוך: 4-5 מקומות שונים, שם של מקום על כל אחד',
      '   רצף: 12 שוטים של מקום אחד, 1.5ש׳ כל אחד, שורה אחת שלא מתחלפת',
      '   בודד: שוט אחד, 8ש׳, שורה אחת שלא מתחלפת',
      '/clip 3 - שלושה בבת אחת',
      '/clip cuts · /clip montage · /clip held - לבחור צורה במקום לחכות לתורה',
      '   (גם בעברית: /clip חתוך · /clip רצף · /clip בודד)',
      '/clear_pending',
      '',
      'תדריך צילום לא מתפרסם על ידי הבוט - אתה מצלם ומעלה. /shoot מתעלם משעות',
      'הפעילות; הטיימר לא.',
      '',
      'מסלול AI הוא הצעה, לא עובדות מאומתות: אין ציטוטים מאחוריו והמחירים הם',
      'הערכה. הכרטיס מדפיס את כל המסלול כדי שאפשר יהיה לקרוא לפני שמאשרים.',
      '',
      'אפשר גם להדביק כתובת של מקור ראשוני והיא תיבדק ותיכתב.',
      '',
      ...(adminServer
        ? [
            'אותן החלטות קיימות גם באתר הניהול, ומי שמאשר שם מדווח כאן בשמו.',
            'שני הערוצים עובדים על אותו התור - מה שאושר כאן נעלם שם ולהפך.',
          ]
        : []),
    ].join('\n')
  )
);

// ---------------------------------------------------------------------------
// Timers
// ---------------------------------------------------------------------------

// The local date, not the UTC one. `toISOString()` would roll the day over at
// 03:00 Israel time and hand you a fresh daily quota in the middle of the night.
const localDay = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Hard ceiling on how many cards a day may put in front of you, whatever you do
 * with them.
 *
 * Rejecting a card gives its quota slot back, which is right — a card you turned
 * down is not one of "the best two or three a day", and without the refund three
 * rejections at breakfast guaranteed a day with no posts. But a refund with no
 * ceiling is its own failure: on a day you reject everything, every gather tops
 * the queue back up, and twenty cards a day is exactly how a human gate quietly
 * turns into a rubber stamp.
 */
const offerCeiling = () =>
  Math.max(dailyTarget(), Number(process.env.DAILY_OFFER_CEILING || dailyTarget() * 3));

/**
 * How many more cards today may stage — the smaller of the two limits above.
 *
 * `live` is what is still standing: staged-and-awaiting-you, or approved. Those
 * are the ones that count as today's two or three.
 */
function remainingToday(day) {
  const offered = store.stagedToday(day);
  const live = offered - store.rejectedToday(day);
  return Math.min(dailyTarget() - live, offerCeiling() - offered);
}

/**
 * The alarm that should have caught this and did not.
 *
 * It measured from an in-memory `lastStagedAt` that started as null and was only
 * ever set by a successful staging, behind an `if (lastStagedAt)` guard — so a
 * bot that staged nothing, which is the whole point of the alarm, skipped the
 * check forever, and any restart reset it.
 *
 * It also asked whether anything published, globally. That is the wrong
 * question when there is more than one destination: Telegram publishing every
 * day kept the answer yes while Instagram was blocked at the API and had not
 * published in days. The question is per destination.
 */
function quietCheck() {
  const hours = Math.max(1, Number(QUIET_ALERT_HOURS));
  const limitMs = hours * 3_600_000;

  const stagedAt = store.lastStagedAt();
  const stagedAgo = Date.now() - (stagedAt ?? bootedAt);

  // A destination with no success on record has never worked on this install, so
  // it measures from boot rather than opting out — never-worked is the loudest
  // case, not an exemption.
  // liveTargets, not publishTargets: a configured Telegram channel receives
  // nothing now, so its lastOkAt is null forever and it would be reported dark
  // from boot onwards, every hour, with no way to ever clear it.
  const darkTargets = liveTargets()
    .map((target) => {
      const okAt = store.lastOkAt(target);
      return { target, ago: Date.now() - (okAt ?? bootedAt), ever: okAt != null };
    })
    .filter((t) => t.ago >= limitMs)
    .map((t) => ({ target: t.target, hoursAgo: Math.floor(t.ago / 3_600_000), ever: t.ever }));

  if (stagedAgo < limitMs && !darkTargets.length) {
    quietAlertSent = false;
    return;
  }
  if (quietAlertSent) return;
  quietAlertSent = true;

  notify
    .send(
      bot.telegram,
      staging,
      notify.quietAlert({
        hours,
        stagedHoursAgo: Math.floor(stagedAgo / 3_600_000),
        everStaged: stagedAt != null,
        darkTargets,
        stagingSize: store.stagingSize(),
        queueSize: store.queueSize(),
        heldCount: store.heldCount(),
      })
    )
    .catch(() => {});
}

function tick() {
  const now = new Date();
  const day = localDay(now);
  const hour = now.getHours();

  // Gather through the day rather than once at RUN_HOUR.
  //
  // One pass a day meant a source publishing at 14:00 waited until 11:00 the
  // next morning, and the only way to see it sooner was to type /run. Cards
  // should arrive when the news does; you approve them when you have time.
  //
  // Three things keep that from becoming a firehose:
  //   - a daily cap on what is standing plus a hard ceiling on what is offered
  //     (see remainingToday), so "the best two or three a day" stays true no
  //     matter how many times it looks, and rejecting the morning's three does
  //     not end the day;
  //   - quiet hours, so nothing arrives overnight;
  //   - the gather itself is free, and it costs a drafting call only when
  //     something genuinely new survives ranking.
  const inHours = hour >= Number(RUN_HOUR) && hour < Number(GATHER_UNTIL_HOUR);
  const remaining = remainingToday(day);
  const due = Date.now() - lastGatherAt >= gatherIntervalMs;

  // Deck ideas, on the same rhythm as cards and in the same hours. Only the
  // idea — nothing is built until you tap. Spaced by the gather interval so
  // they arrive through the day rather than three at once at 08:00.
  if (deckDay !== day) {
    deckDay = day;
    decksToday = 0;
  }
  if (
    inHours &&
    DECKS_PER_DAY > 0 &&
    decksToday < DECKS_PER_DAY &&
    store.proposalSize() < DECK_BACKLOG_MAX &&
    Date.now() - lastDeckSuggestAt >= gatherIntervalMs
  ) {
    lastDeckSuggestAt = Date.now();
    decksToday += 1;
    suggestDeck().catch((e) => console.error('deck suggestion failed:', e.message));
  }

  // THE FIVE POST TYPES, on the same rhythm as everything else.
  //
  // This is the account's main output now, so it is the one with the highest daily
  // count and the one the other three are paced around. Built rather than proposed,
  // like a clip: a proposal card for "a plan post about Prague" asks you to decide on
  // something you cannot see, and the whole difficulty with these formats is visual.
  //
  // The rotation picks the type, the look, the frame and the caption shape, and refuses
  // whatever the last few posts used - see src/posts/types.js. Nothing here chooses any
  // of that, which is deliberate: a timer that also made editorial decisions would be
  // two things to reason about at once.
  if (postDay !== day) {
    postDay = day;
    postsToday = 0;
  }
  if (
    inHours &&
    POSTS_PER_DAY > 0 &&
    postsToday < POSTS_PER_DAY &&
    postsWaiting() < POST_BACKLOG_MAX &&
    Date.now() - lastPostSuggestAt >= gatherIntervalMs
  ) {
    lastPostSuggestAt = Date.now();
    postsToday += 1;
    suggestPost(null, {}).catch((e) => console.error('post suggestion failed:', e.message));
  }

  // Clips, same hours and same spacing. Built rather than proposed — see the
  // note at CLIPS_PER_DAY — so the guard counts what is already staged and
  // waiting rather than unanswered proposals.
  if (clipDay !== day) {
    clipDay = day;
    clipsToday = 0;
  }
  if (
    inHours &&
    CLIPS_PER_DAY > 0 &&
    clipsToday < CLIPS_PER_DAY &&
    clipsWaiting() < CLIP_BACKLOG_MAX &&
    Date.now() - lastClipSuggestAt >= gatherIntervalMs
  ) {
    lastClipSuggestAt = Date.now();
    clipsToday += 1;
    suggestClip().catch((e) => console.error('clip suggestion failed:', e.message));
  }

  // Shot lists, and the ONE thing on this timer that is not gated by RUN_HOUR.
  //
  // Everything above runs inside the gather hours, which exist so nothing
  // arrives overnight. A shoot has a stricter requirement and a different one:
  // it is a thing you act on within the hour, so it has to arrive when the
  // audience it is being filmed for is actually on the application — 12:00-14:00
  // and 19:00-22:00 Israel time — and never between Friday evening and Saturday
  // evening, where a post spends its whole first-hour ranking test on nobody.
  //
  // sendableNow() answers both in one call and in Israel's time zone rather
  // than this machine's, which matters on a VPS that is not in Israel. See
  // src/schedule.js.
  if (SHOOTS_PER_DAY > 0 && store.shootsToday() < SHOOTS_PER_DAY && Date.now() - lastShootAt >= gatherIntervalMs) {
    const when = sendableNow();
    if (when.ok) {
      lastShootAt = Date.now();
      sendShoots(1, staging).catch((e) => console.error('shoot failed:', e.message));
    }
  }

  if (inHours && remaining > 0 && due) {
    lastGatherAt = Date.now();
    if (day !== lastRunDay) {
      lastRunDay = day;
      maybeRefreshIgToken().catch(() => {});
      maybeRefreshTikTokToken().catch(() => {});
    }
    // THE TIMER NEVER ANNOUNCES. It used to report the first pass of each day,
    // on the reasoning that the later ones were routine; the first one is
    // routine too. A gather that produced cards announces itself perfectly well
    // by sending the cards, and a gather that produced none is a report saying
    // nothing happened, which is the definition of a message you learn to
    // ignore. /run still reports, because a run you asked for is a question you
    // are waiting on an answer to, and /status answers the same question at any
    // other time.
    doRun({ target: remaining, announce: false }).catch((e) => console.error('gather failed:', e.message));
  }

  quietCheck();
}

function sendRejectDigest() {
  if (REJECT_NOTIFY !== 'digest' || !rejectQueue.length) return;
  const items = rejectQueue;
  rejectQueue = [];
  return notify.send(bot.telegram, staging, notify.rejectDigest(items, REJECT_DIGEST_HOURS));
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The admin site's half of the bridge
// ---------------------------------------------------------------------------
//
// Everything the site can do, as one object handed to the server. The server
// does routing, auth and JSON and knows nothing about posting; this knows nothing
// about HTTP. See the long note at the top of src/admin/server.js for why the two
// live in ONE process rather than two.
//
// Every action here is the SAME function the Telegram handler calls. That is the
// whole point of the extraction above: "approve" cannot come to mean two
// different things, because there is only one of it.
//
// WHAT HAPPENS ON THE SITE IS ANNOUNCED IN TELEGRAM. Not as a courtesy — as the
// only way the two channels can be trusted together. A card that quietly left the
// approval queue is indistinguishable from a bug, and the owner reads Telegram.

const adminOps = {
  mediaDir: () => cardOutputDir(),

  async state() {
    const day = localDay(new Date());
    const dayAgo = Date.now() - 24 * 3_600_000;
    const recent = activity.filter((a) => a.ts >= dayAgo);
    const rejectedByReason = {};
    for (const r of rejectLog.filter((r) => r.ts >= dayAgo)) {
      rejectedByReason[r.reason] = (rejectedByReason[r.reason] || 0) + 1;
    }
    const healthTargets = [...new Set([...liveTargets(), ...store.healthTargets()])];

    return {
      // Called with explicit arguments rather than passed straight to `.map`.
      // Both take an options object last, and `.map` would hand them the index
      // and the array — which happens to be harmless today and is the kind of
      // thing that stops being harmless the moment an option is added.
      pending: store.stagingItems().map((row) => stagedView(row)),
      proposals: store.proposalItems().map(({ key, proposal }) => ({
        key,
        text: proposalMessage(proposal.idea),
        title: proposal.idea?.titleHe || '',
        proposedAt: proposal.proposedAt || null,
      })),
      queue: store.queuedItems().map((c, i) => queuedView(c, i)),
      // The Hebrew is added here because targetsHe lives with the bot's other
      // wording, and views.js is meant to stay free of anything but the shape.
      held: store.heldItems().map((h, i) => ({ ...heldView(h, i), missingHe: targetsHe(h.targets || []) })),
      // The same report /status prints, as text, for the same reason `text` is on
      // a staged card: one rendering, not two.
      status: notify.statusReport({
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
        stagedToday: store.stagedToday(day) - store.rejectedToday(day),
        rejectedToday: store.rejectedToday(day),
        remainingToday: remainingToday(day),
        dailyTarget: dailyTarget(),
        nextGatherInMin: Math.max(0, Math.round((gatherIntervalMs - (Date.now() - lastGatherAt)) / 60000)),
        heldCount: store.heldCount(),
        targetHealth: Object.fromEntries(liveTargets().map((t) => [t, store.targetHealth(t)])),
        targets: liveTargets(),
      }),
      health: notify.healthReport(
        healthTargets.map((target) => ({
          target,
          ...store.targetHealth(target),
          degraded: store.isDegradedLatched(target),
          recoveryDueAt: store.recoveryDueAt(target),
        })),
        []
      ),
      usage: usageReport(),
      // The budgets and the backlog caps, which are the answer to "why is nothing
      // being suggested" and are invisible in every other view.
      budgets: {
        cards: { today: store.stagedToday(day) - store.rejectedToday(day), perDay: dailyTarget() },
        decks: { today: decksToday, perDay: DECKS_PER_DAY, waiting: store.proposalSize(), max: DECK_BACKLOG_MAX },
        clips: { today: clipsToday, perDay: CLIPS_PER_DAY, waiting: clipsWaiting(), max: CLIP_BACKLOG_MAX },
        shoots: { today: store.shootsToday(), perDay: SHOOTS_PER_DAY, window: windowsHe(), now: sendableNow() },
        clipShapes: store.clipShapeHistory().slice(0, 6),
      },
    };
  },

  async evidence(key) {
    const cand = store.getStaging(key);
    if (!cand) return { ok: false, said: 'כבר טופל' };
    return { ok: true, text: evidenceReport(cand) };
  },

  async approve(key, { by }) {
    const res = approveStaged(key, { by });
    if (!res.ok) return res;
    // The Telegram card is closed from here, saying who did it, because a card
    // that vanishes with no explanation reads as a fault. Awaited so a failure to
    // edit is logged before the response goes out, not after.
    await closeCardElsewhere(res.cand, `${res.said} · באתר · ${by}`);
    await notify
      .send(bot.telegram, staging, `🌐 ${by} אישר באתר: ${res.cand.headline}\n${res.said}`)
      .catch(() => {});
    return { ok: true, said: res.said };
  },

  async reject(key, { by }) {
    const res = rejectStaged(key, { by });
    if (!res.ok) return res;
    await closeCardElsewhere(res.cand, `${res.said} · באתר · ${by}`);
    await notify.send(bot.telegram, staging, `🌐 ${by} דחה באתר: ${res.cand.headline}`).catch(() => {});
    return { ok: true, said: res.said };
  },

  async privacy(key) {
    const res = cyclePrivacy(key);
    if (!res.ok) return res;
    // The Telegram card prints the level it will publish at, so it has to be
    // rewritten — with its buttons intact, because the card is still undecided.
    const at = res.cand.approvalCard;
    if (at?.messageId) {
      const text = approvalMessage(res.cand);
      const markup = stagingButtons(key, res.cand);
      const edit = at.isPhoto
        ? bot.telegram.editMessageCaption(at.chatId, at.messageId, undefined, text, markup)
        : bot.telegram.editMessageText(at.chatId, at.messageId, undefined, text, markup);
      await edit.catch((e) => console.error(`admin: privacy edit failed - ${e.message}`));
    }
    return { ok: true, said: res.said, privacy: privacyHe(res.cand.tiktok.privacy) };
  },

  async retitle(key, headline, { by }) {
    const res = await retitleStaged(key, headline);
    if (!res.ok) return res;
    // Re-sent rather than edited: the old message carries the old image. The new
    // message id is recorded by resendCard, which is what keeps a later decision
    // pointing at the card actually on screen.
    await resendCard(key, res.cand).catch((e) => console.error(`admin: resend failed - ${e.message}`));
    await notify
      .send(bot.telegram, staging, `🌐 ${by} שינה כותרת באתר: ${res.cand.headline}`)
      .catch(() => {});
    return { ok: true, said: res.said, item: stagedView({ key, cand: res.cand }) };
  },

  async buildProposal(key, targets, { by }) {
    const proposal = store.getProposal(key);
    if (!proposal) return { ok: false, said: 'ההצעה הזו כבר לא ממתינה' };
    const want = Array.isArray(targets) && targets.length ? targets : ['instagram'];
    const legal = want.filter((t) => t === 'instagram' || t === 'tiktok');
    if (!legal.length) return { ok: false, said: 'יעד לא חוקי' };
    const draft = legal.includes('tiktok');

    await notify
      .send(bot.telegram, staging, `🌐 ${by} אישר בנייה באתר: ${proposal.idea?.titleHe || key}`)
      .catch(() => {});
    // runOverridden for the same reason the button does it: an override does not
    // survive the wait for a decision, and a deck asked for by name must not be
    // judged by the repeat guards it was meant to step over.
    detach('בניית מצגת', () => runOverridden('/deck', () => buildProposal(key, staging, null, legal, draft)));
    return { ok: true, said: `⏳ בונה · ${targetsHe(legal)}` };
  },

  async rejectProposal(key, { by }) {
    if (!store.getProposal(key)) return { ok: false, said: 'ההצעה הזו כבר לא ממתינה' };
    const title = store.getProposal(key)?.idea?.titleHe || key;
    store.clearProposal(key);
    await notify.send(bot.telegram, staging, `🌐 ${by} דחה הצעה באתר: ${title}`).catch(() => {});
    return { ok: true, said: '❌ נדחה' };
  },

  async publish(n, { by }) {
    const res = await publishQueued(n == null ? null : Number(n), { background: true });
    if (res.ok) {
      await notify.send(bot.telegram, staging, `🌐 ${by} פרסם באתר${res.headline ? `: ${res.headline}` : ''}`).catch(() => {});
    }
    return res;
  },

  async draft(n, { by }) {
    const res = await draftQueued(Number(n));
    if (res.ok) {
      await notify.send(bot.telegram, staging, `🌐 ${by} שלח טיוטה באתר: ${res.headline}`).catch(() => {});
    }
    return res;
  },

  async retryHeld({ by }) {
    const res = await retryHeldNow({ background: true });
    await notify.send(bot.telegram, staging, `🌐 ${by} לחץ retry באתר\n${res.said}`).catch(() => {});
    return res;
  },

  async clearHeld({ by }) {
    const res = clearHeldNow();
    if (res.ok) await notify.send(bot.telegram, staging, `🌐 ${by} ניקה מוחזקים באתר\n${res.said}`).catch(() => {});
    return res;
  },

  /**
   * Ask for something to be built.
   *
   * Every one of these is minutes of work and several are money, so they are
   * detached and the answer is "started". The outcome arrives as a staged card in
   * both channels, which is the only report that matters.
   */
  async build(body, { by }) {
    const what = String(body?.what || '').toLowerCase();
    const count = Math.min(5, Math.max(1, Number(body?.count) || 1));

    if (what === 'gather') {
      if (running) return { ok: false, said: '⏳ כבר רץ סבב איסוף' };
      await notify.send(bot.telegram, staging, `🌐 ${by} הריץ איסוף באתר`).catch(() => {});
      detach('סבב איסוף', () => runOverridden('/run', () => doRun({ announce: true })));
      return { ok: true, said: '⏳ מריץ סבב איסוף' };
    }

    if (what === 'clip') {
      const { clipShapeArg, buildClips } = await import('./src/video/clip.js');
      const shape = clipShapeArg(String(body?.shape || ''));
      await notify
        .send(bot.telegram, staging, `🌐 ${by} ביקש ${count} קליפ(ים) באתר${shape ? ` · ${shape}` : ''}`)
        .catch(() => {});
      // Billed by hand for the same reason the /clip command is: this reaches
      // buildClips without going through a wrapped job.
      detach('קליפים', () => forKind('clip', async () => {
        const { clips } = await buildClips({
          count,
          seen: clipFootageSeen(),
          shapes: shape ? Array.from({ length: count }, () => shape) : null,
          after: store.lastClipShape(),
        });
        spendClipFootage(clips);
        if (!clips.length) {
          await notify.send(bot.telegram, staging, '🎬 אין קליפ להציג').catch(() => {});
          return;
        }
        for (const clip of clips) await stage(clip);
      }));
      return { ok: true, said: `⏳ בונה ${count} קליפ(ים)` };
    }

    if (what === 'deck') {
      await notify.send(bot.telegram, staging, `🌐 ${by} ביקש הצעת מצגת באתר`).catch(() => {});
      detach('הצעת מצגת', () => runOverridden('/deck', () => suggestDecks(count, staging)));
      return { ok: true, said: '⏳ מכין הצעה' };
    }

    if (what === 'trip') {
      const asked = String(body?.dest || '').trim();
      const days = body?.days ? Number(body.days) : null;
      // The site has its own field for this rather than reusing the command's
      // parser: a form with a box labelled "תקציב" has nothing to disambiguate,
      // so the 600 ₪ floor that separates days from money in /trip would only
      // be in the way here. The range is still checked, because a typo in a
      // number box is as easy as one in a chat line.
      const asks = Number(body?.budget) || 0;
      const budgetIls = asks >= BUDGET_MIN && asks <= BUDGET_MAX ? Math.round(asks) : null;
      if (asks && !budgetIls) {
        return { ok: false, said: `תקציב חייב להיות בין ${BUDGET_MIN} ל-${BUDGET_MAX.toLocaleString('en-US')} ₪` };
      }
      await notify
        .send(
          bot.telegram,
          staging,
          `🌐 ${by} ביקש מסלול באתר: ${asked || 'יעד כלשהו'}${budgetIls ? ` · ${budgetIls.toLocaleString('en-US')} ₪` : ''}`
        )
        .catch(() => {});
      detach('מסלול', () => runOverridden('/trip', () => suggestPlan(asked, days, staging, budgetIls)));
      return { ok: true, said: `⏳ מתכנן ${asked || 'יעד'}${budgetIls ? ` · ${budgetIls.toLocaleString('en-US')} ₪` : ''}` };
    }

    if (what === 'shoot') {
      await notify.send(bot.telegram, staging, `🌐 ${by} ביקש תדריך צילום באתר`).catch(() => {});
      detach('תדריך צילום', () => sendShoots(count, staging));
      return { ok: true, said: `⏳ שולח ${count} תדריך(ים)` };
    }

    return { ok: false, said: `לא יודע לבנות "${what}"` };
  },
};

// The running admin site, so shutdown can close it. Null when ADMIN_USERS is
// unset, which is how the site stays off.
let adminServer = null;
let logTap = null;

async function main() {
  // BEFORE the first console.log, so the boot lines are in the buffer the admin
  // site shows. Started after them, an admin who cannot read pm2 logs gets a
  // window that begins just past the most informative part of the run — the
  // destinations, the budgets, and any warning about them.
  logTap = createLogTap();
  console.log('starting tiyul+ ...');

  // BEFORE Telegram, deliberately.
  //
  // The site is the second channel, and the moment it is most worth having is
  // the moment the first one is unreachable — a revoked token, a network that
  // cannot see api.telegram.org. Started after getMe, an unreachable Telegram
  // takes the site down with it and there is nowhere left to look at the queue.
  //
  // Everything it announces to Telegram is already `.catch(() => {})`, so an
  // action taken while the chat is unreachable still happens; it just goes
  // unannounced, which is the right direction.
  adminServer = startAdminServer(adminOps, { log: logTap });

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
  // Per kind, because that is now the whole rule and a combined list would be a
  // lie in both directions: it would name Telegram, which receives nothing, and
  // it would not say that a card and a deck go to different places.
  console.log(`   cards to: ${targetsForKind('card').join(' + ') || 'NOWHERE (Instagram not configured)'}`);
  console.log(`   decks to: ${targetsForKind('deck').join(' + ') || 'NOWHERE (TikTok not connected)'}`);
  console.log('   telegram: approval only - nothing publishes to a channel');
  console.log(`   images: ${imagesEnabled() ? 'a provider is configured' : 'text-led cards only'}`);
  // Connecting TikTok from a browser instead of pasting a code into a terminal.
  // In this process rather than a service of its own, so pm2 supervises it and
  // so the token it writes goes through the same store this process holds open.
  startOAuthServer();
  // The Instagram comment listener. Returns null and says so when either
  // secret is missing, exactly as the admin site does with no users: an
  // endpoint that sends direct messages must not come up unauthenticated.
  startIgWebhook();
  console.log(`   daily run at ${RUN_HOUR}:00 · target ${dailyTarget()} · drip every ${POST_INTERVAL_MINUTES} min`);
  console.log(
    `   suggestions per day: ${dailyTarget()} cards · ${POSTS_PER_DAY} posts · ${DECKS_PER_DAY} decks · ${CLIPS_PER_DAY} clips · ${SHOOTS_PER_DAY} shoots`
  );

  // Do the budgets fit down the drip?
  //
  // Every kind that publishes shares ONE queue, drained one post every
  // POST_INTERVAL_MINUTES. So the daily budgets are a production rate and the
  // interval is a drain rate, and if production exceeds drain the difference
  // does not become more posts, it becomes a queue that grows by the
  // difference every day, for ever, publishing steadily staler things.
  //
  // Nothing enforces this and nothing should: a day of /run or /clip
  // deliberately steps over the budgets, and a backlog you asked for is not a
  // misconfiguration. What was missing is that the standing rates could
  // disagree with each other silently, and a drip that is permanently four
  // posts behind looks exactly like a drip that is working. A shoot is not
  // counted: it never publishes.
  {
    // POSTS ARE COUNTED HERE TOO, and leaving them out was the kind of omission this
    // check exists to catch. They are the largest standing budget of the four - two a
    // day against one card and one deck - so a drip that was comfortably ahead of
    // production became exactly level with it the moment they were switched on, and
    // the one line that would have said so was not counting them.
    const perDay = dailyTarget() + POSTS_PER_DAY + DECKS_PER_DAY + CLIPS_PER_DAY;
    const drainPerDay = Math.floor(1440 / Math.max(1, Number(POST_INTERVAL_MINUTES)));
    if (perDay > drainPerDay) {
      console.log(
        `   ⚠️ budgets produce ${perDay}/day and the drip publishes ${drainPerDay}/day - ` +
          `the queue will grow by ${perDay - drainPerDay} a day. Lower a budget or shorten POST_INTERVAL_MINUTES.`
      );
    }
  }
  console.log(`   posts to: ${targetsForKind('post').join(' + ') || 'NOWHERE (nothing connected)'}`);
  console.log(`   clips to: ${targetsForKind('clip').join(' + ') || 'NOWHERE (TikTok not connected)'}`);
  // Said out loud at boot, because "shoots go nowhere" is the single most
  // surprising thing about this queue and the one most likely to be read as a
  // misconfiguration. It is the design: see BRIEF.md.
  console.log(`   shoots to: YOU - a shot list to film by hand, ${windowsHe()} Israel time, not on Shabbat`);

  // Checked at boot rather than discovered at the first clip of the day.
  // Without an encoder the clip half of this bot cannot work at all, and the
  // failure otherwise surfaces hours later as one line in a log nobody is
  // reading — on a box where clips have never run, which is exactly when it
  // happens.
  // Where the sound comes from.
  //
  // Only a warning when the config ASKS for a bed and there is nothing to play.
  // With the bed off, which is the default, a silent render is the intended
  // workflow: nothing publishes a reel, so the sound is chosen by hand in each
  // app and a warning against the plan is noise. See clips.audio in
  // post-config.json for what would bring the bed back.
  if (CLIPS_PER_DAY > 0) {
    const { tracks, audioDir } = await import('./src/video/tracks.js');
    const { postConfig } = await import('./src/postConfig.js');
    const wantsAudio = postConfig().clips.audio.on;
    try {
      const found = tracks();
      if (!wantsAudio) {
        console.log('   audio: no bed mixed in - the sound is chosen by hand in each app');
      } else if (found.length) {
        console.log(`   audio: ${found.length} track(s) declared in ${audioDir()}`);
      } else {
        console.log(
          `   ⚠️ audio: clips.audio.on is true but no tracks are declared in ${audioDir()}/tracks.json`
        );
      }
    } catch (e) {
      // A manifest that names a missing file, or a track with no licence, is a
      // deliberate throw. Reported here rather than at the first clip of the
      // day, which is hours later and in a log nobody is reading.
      console.log(`   ⚠️ audio: ${e.message}`);
    }
  }

  if (CLIPS_PER_DAY > 0) {
    const { ffmpegReady } = await import('./src/video/overlay.js');
    const ff = await ffmpegReady();
    if (ff.ok) {
      console.log(`   ffmpeg: ${ff.version.replace(/^ffmpeg version /, '').split(' ')[0]} (${ff.path})`);
    } else {
      console.error(`   ⚠️ ffmpeg: ${ff.error}`);
      await notify
        .send(bot.telegram, staging, `⚠️ קליפים מושבתים - ${ff.error}`)
        .catch(() => {});
    }
  }

  await maybeRefreshIgToken();
  await maybeRefreshTikTokToken();
  await probeInstagram();

  setInterval(() => {
    publishNext().catch((e) => console.error('publish error:', e.message));
  }, intervalMs);

  setInterval(tick, 60_000);
  setInterval(
    () => sendRejectDigest()?.catch?.((e) => console.error('reject digest error:', e.message)),
    Math.max(1, Number(REJECT_DIGEST_HOURS)) * 3_600_000
  );

  // THE NUMBERS, RE-READ RATHER THAN READ ONCE.
  //
  // A post's figures are still moving a week after it went out: most of a carousel's
  // views arrive after the first day and saves keep arriving for longer. A single
  // reading taken the morning after would rank every format by how fast it starts
  // rather than by how well it does, which is a different question and the wrong one.
  //
  // Hourly rather than nightly, and the interval is the whole reason this is cheap: the
  // collector only asks about posts published in the last thirty days and only writes
  // what it actually got, so a pass on a quiet week is a handful of requests. "Nightly"
  // would also mean a single moment that can be missed by a restart.
  setInterval(() => {
    collectMetrics()
      .then((got) => console.log(`metrics: ${describeCollection(got)}`))
      .catch((e) => console.error('metrics error:', e.message));
  }, Math.max(1, Number(process.env.METRICS_EVERY_HOURS || 6)) * 3_600_000);

  // THE WEEKLY REPORT, on a timer rather than a weekday, because a bot that has been
  // up for three days should send one rather than wait for Sunday. It ranks on saves
  // and shares per view and it never changes a weight - see src/metrics/report.js for
  // why that is a rule and not an omission.
  if (Number(process.env.METRICS_REPORT_DAYS || 7) > 0) {
    setInterval(() => {
      try {
        notify.send(bot.telegram, staging, weeklyReport({ days: 7 })).catch(() => {});
      } catch (e) {
        console.error('metrics report error:', e.message);
      }
    }, Math.max(1, Number(process.env.METRICS_REPORT_DAYS || 7)) * 86_400_000);
  }

  await notify.send(
    bot.telegram,
    staging,
    notify.startupPing({
      sourceCount: enabledSources().length,
      queueSize: store.queueSize(),
      stagingSize: store.stagingSize(),
      targets: liveTargets(),
      images: imagesEnabled(),
    })
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

const shutdown = async (sig) => {
  // Release the port before anything slower. pm2 restart sends SIGTERM and then
  // starts the replacement; a socket still held here greets the new process
  // with EADDRINUSE, and the connect endpoint would be the one thing that did
  // not come back from a routine restart.
  await stopOAuthServer();
  // The admin port, for exactly the same reason and with the same failure: pm2
  // restart sends SIGTERM and starts the replacement immediately, and a socket
  // still held here greets it with EADDRINUSE. The bot would come back and the
  // site would be the one thing that did not.
  if (adminServer) {
    await new Promise((resolve) => adminServer.close(resolve));
    adminServer = null;
  }
  await closeBrowser();
  bot.stop(sig);
};
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
