import { BudgetError } from '../clients/budget.js';
import { ClaudeError } from './claude.js';
import { growthPort, mergeSettings } from './config.js';
import { runDiscovery } from './find/index.js';
import { fillVideoContext } from './find/videoContext.js';
import { channelOf, openTarget } from './links.js';
import { checkEdit, draftsFor } from './prepare/compose.js';
import { draftItem, DraftError } from './prepare/draft.js';
import { prepareToday } from './prepare/index.js';
import { examplesFor, noteCopied, recordSent } from './prepare/learn.js';
import { withdrawClosed, withdrawRoute } from './prepare/publish.js';
import { cityFor, siteContext } from './prepare/site.js';
import { readTemplates, saveTemplate, TemplateError } from './prepare/templates.js';
import { campaignClicks } from './report/ga4.js';
import { applyAction, closeSilent, ilDate, ilHour, pickToday, RuleError } from './rules.js';
import { openStore } from './store.js';
import { listen } from './web/server.js';

// The running desk: the store, the server, the daily timer, and what each
// button does.
//
// Only imported by main.js, and only after the switch said on. Nothing in this
// folder runs, and nothing opens data/growth.json, while the desk is off.

const EXPECTED = [RuleError, TemplateError, BudgetError, DraftError, ClaudeError];

/** What the server calls. Kept apart from listen() so the selftest can drive it. */
export function createOps({ store, env = process.env, clock = () => Date.now(), deps = {} }) {
  const run = deps.runDiscovery || runDiscovery;
  const prepare = deps.prepareToday || prepareToday;
  const draft = deps.draftItem || draftItem;
  const withdraw = { route: deps.withdrawRoute || withdrawRoute, closed: deps.withdrawClosed || withdrawClosed };
  let running = null;
  let lastError = null;

  const settings = () => mergeSettings(store.data.settings);
  const context = () => ({ state: store.data, settings: settings(), templates: readTemplates(), now: clock(), env });

  const today = () => {
    const day = pickToday(store.data, settings(), clock());
    store.save();
    return day;
  };

  const start = (trigger) => {
    if (running) return false;
    running = (async () => {
      try {
        await run({ store, settings: settings(), trigger, env, now: clock() });
        await prepare({ store, settings: settings(), env, now: clock() });
        lastError = null;
      } catch (e) {
        lastError = e.message;
        console.error(`[growth] run failed: ${e.stack || e.message}`);
      } finally {
        running = null;
      }
    })();
    return true;
  };

  const status = () => ({ running: Boolean(running), lastRun: store.data.runs[0] || null, lastError });

  /**
   * The daily timer. One run a day at or after runHour, unless a run (of either
   * kind) already happened today; otherwise just top up today's drafts, which
   * is how a DM that became due at midnight gets written.
   */
  const tick = async () => {
    if (running) return;
    const now = clock();
    // Any closed lead whose page is still up (a withdrawal the site did not
    // answer) is taken down first: a closed lead never keeps a live route.
    // Silent through the follow-up for `followupDays`: closed as no reply, and its
    // page comes down in the withdrawal just below.
    if (closeSilent(store.data, { now, followupDays: settings().followupDays }).length) store.save();
    if (await withdraw.closed(store.data, { env, now })) store.save();
    const ranToday = store.data.runs.some((r) => ilDate(r.at) === ilDate(now));
    if (!ranToday && ilHour(now) >= settings().runHour) {
      start('daily');
      return;
    }
    await prepare({ store, settings: settings(), env, now });
  };

  const whatOf = (field) => String(field).split(':')[0];

  async function redraft(lead, body) {
    const s = settings();
    const state = store.data;
    const site = async (slug) => siteContext(await cityFor(slug).catch(() => null));
    if (body.what === 'comment') {
      const post = lead.posts.find((p) => p.id === body.postId);
      if (!post) throw new RuleError('no-post', 'That video is not on this lead.');
      await (deps.fillVideoContext || fillVideoContext)(state, [post], { env, now: clock() }).catch(() => 0);
      post.drafts = await draft('comment', { state, settings: s, lead, post, site: await site(post.dest?.slug || lead.dest?.slug), examples: examplesFor(state, 'comment') });
      for (const key of Object.keys(lead.edits || {})) if (key.startsWith(`comment:${post.id}:`)) delete lead.edits[key];
      delete post.draftError;
    } else if (body.what === 'dm') {
      const post = lead.posts.find((p) => p.status === 'commented') || lead.posts[0];
      lead.drafts = { ...lead.drafts, dm: await draft('creator', { state, settings: s, lead, post, site: await site(lead.dest?.slug), extra: { route: lead.route, offer: s.offers.creator }, examples: examplesFor(state, 'creator') }) };
      for (const key of Object.keys(lead.edits || {})) if (key.startsWith('dm:')) delete lead.edits[key];
    } else if (body.what === 'message') {
      const ex = lead.example;
      lead.drafts = {
        ...lead.drafts,
        message: await draft('agency', { state, settings: s, lead, site: await site(ex?.slug), extra: { route: ex?.kind === 'route' ? lead.route : null, exampleHe: ex?.he }, examples: examplesFor(state, 'agency') }),
      };
      for (const key of Object.keys(lead.edits || {})) if (key.startsWith('message:')) delete lead.edits[key];
    } else if (body.what === 'reply') {
      lead.drafts = { ...lead.drafts, reply: await draft('reply', { state, settings: s, lead, post: lead.posts[0], site: await site(lead.dest?.slug), examples: examplesFor(state, 'reply') }) };
      for (const key of Object.keys(lead.edits || {})) if (key.startsWith('reply:')) delete lead.edits[key];
    } else {
      throw new RuleError('bad', 'There is nothing to redraft here.');
    }
    delete lead.draftError;
  }

  function cleanSettings(input) {
    const s = mergeSettings(input);
    const bad = [];
    for (const [k, v] of Object.entries(s.caps)) if (!Number.isInteger(v) || v < 0 || v > 50) bad.push(`The ${k} cap is between 0 and 50`);
    if (!(s.budgetUsd >= 0 && s.budgetUsd <= 1000)) bad.push('The budget is between $0 and $1,000');
    if (!(s.braveCreditUsd >= 0 && s.braveCreditUsd <= 100)) bad.push('The Brave credit is between $0 and $100');
    if (!(Number.isInteger(s.publishPerDay) && s.publishPerDay >= 0 && s.publishPerDay <= 20)) bad.push('Route pages a day are between 0 and 20, the site\'s own limit');
    if (!(Number.isInteger(s.runHour) && s.runHour >= 0 && s.runHour <= 23)) bad.push('The run hour is between 0 and 23');
    if (!(s.warmupDays >= 1)) bad.push('At least one day from the comment to the message');
    if (!(s.followupDays >= 1)) bad.push('At least one day before the follow-up');
    if (!(s.followers.min < s.followers.max)) bad.push('The follower minimum is below the maximum');
    for (const m of Object.values(s.models)) if (!/^claude-[a-z0-9.-]+$/.test(m)) bad.push(`Not a model name: ${m}`);
    if (!['low', 'medium', 'high', 'xhigh', 'max'].includes(s.effort)) bad.push('Effort is low, medium, high, xhigh or max');
    if (!s.tiktokQueries.every((q) => q.includes('{dest}'))) bad.push('Every TikTok search needs {dest}');
    const ytPerDay = s.youtubeDestinationsPerDay * s.tiktokQueries.length + s.hashtagsPerDay;
    if (!(Number.isInteger(s.youtubeDestinationsPerDay) && s.youtubeDestinationsPerDay >= 0 && ytPerDay <= 100)) {
      bad.push(`YouTube allows 100 searches a day, and these settings ask for ${ytPerDay}`);
    }
    if (bad.length) throw new RuleError('bad', `${bad.join('. ')}.`);
    return s;
  }

  /** The text a variant was drafted as, for the sent log. */
  const draftText = (lead, what, i, postId) => draftsFor(lead, what, postId)?.variants?.[i]?.text ?? null;

  async function post(path, body) {
    try {
      if (path === '/api/run') return start('button') ? { ok: true } : { error: 'Already looking.' };

      let m = /^\/api\/lead\/(.+)\/(action|redraft|copied)$/.exec(path);
      if (m) {
        const lead = store.data.leads[m[1]];
        if (!lead) return { error: 'That lead is not in the desk.' };
        if (m[2] === 'redraft') {
          await redraft(lead, body);
          store.save();
          return { ok: true };
        }
        if (m[2] === 'copied') {
          const i = Number.isInteger(body.variant) ? body.variant : null;
          noteCopied(lead, { what: body.what, postId: body.postId || null, variant: i, text: body.text, draft: i == null ? null : draftText(lead, body.what, i, body.postId), at: clock() });
          store.save();
          return { ok: true };
        }
        if (body.action === 'edit') {
          const problems = checkEdit(lead, whatOf(body.field), body.text, { state: store.data });
          if (problems.length) return { error: `${problems.join('. ')}.` };
        }
        // Which text the button was about, for the sent log: the first message
        // or the follow-up, the comment on one video, or a reply.
        const firstSend = body.action === 'sent' && !lead.messagedAt;
        const what = body.action === 'commented' ? (lead.type === 'customer' ? 'reply' : 'comment') : firstSend ? (lead.type === 'agency' ? 'message' : 'dm') : 'followup';
        // The channel the first message went out on, for Reports: where the card opened it.
        const channel = firstSend ? channelOf(openTarget(lead, what)) : null;
        const effects = applyAction(store.data, lead, body.action, body, { now: clock(), settings: settings() });
        if (channel) lead.channel = channel;
        if (body.action === 'sent' || body.action === 'commented') {
          recordSent(store.data, lead, { what, postId: body.postId || null, final: body.final || null, at: clock() });
        }
        if (effects.withdraw && lead.trip) lead.trip = await withdraw.route(lead, { env, now: clock() });
        store.save();
        return { ok: true };
      }

      if (path === '/api/settings') {
        store.data.settings = body.reset ? {} : cleanSettings(body.settings || {});
        store.save();
        return { ok: true };
      }

      if (path === '/api/templates') {
        saveTemplate(String(body.name || ''), String(body.text || ''));
        return { ok: true };
      }

      return { error: 'Unknown request.' };
    } catch (e) {
      if (EXPECTED.some((E) => e instanceof E)) return { error: e.message };
      throw e;
    }
  }

  return { context, today, status, post, tick, start, ga4: () => campaignClicks({ env }), idle: () => running || Promise.resolve() };
}

/** Start the desk: bind the port first, then open the store, then the timer. */
export async function startDesk({ env = process.env } = {}) {
  const port = growthPort({ env });
  // Bound BEFORE the store is opened: a second desk finds the port taken and
  // exits here, without becoming a second writer of data/growth.json.
  const holder = {};
  const proxy = new Proxy({}, { get: (_, key) => (...args) => holder.ops[key](...args) });
  let bound;
  try {
    bound = await listen({ ops: proxy, port, env });
  } catch (e) {
    if (e.code === 'EADDRINUSE') {
      console.error(`Port ${port} is taken. Is the desk already running? Open http://127.0.0.1:${port}`);
      process.exit(1);
    }
    throw e;
  }
  holder.ops = createOps({ store: openStore(), env });
  console.log(`Growth desk: http://127.0.0.1:${bound.port}${env.GROWTH_PUBLIC_HOST ? ` (public at https://${env.GROWTH_PUBLIC_HOST})` : ''}`);

  const tick = () => holder.ops.tick().catch((e) => console.error(`[growth] ${e.message}`));
  tick();
  setInterval(tick, 15 * 60_000).unref?.();
  return bound;
}
