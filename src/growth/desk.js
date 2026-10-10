import { BudgetError } from '../clients/budget.js';
import { growthPort, mergeSettings } from './config.js';
import { runDiscovery } from './find/index.js';
import { checkEdit } from './prepare/compose.js';
import { draftComments, draftCreatorLine, draftCustomerReply, DraftError } from './prepare/draft.js';
import { prepareToday } from './prepare/index.js';
import { withdrawClosed, withdrawRoute } from './prepare/publish.js';
import { cityFor, siteContext } from './prepare/site.js';
import { readTemplates, saveTemplate, TemplateError } from './prepare/templates.js';
import { campaignClicks } from './report/ga4.js';
import { applyAction, ilDate, ilHour, pickToday, RuleError } from './rules.js';
import { openStore } from './store.js';
import { listen } from './web/server.js';

// The running desk: the store, the server, the daily timer, and what each
// button does.
//
// Only imported by main.js, and only after the switch said on. Nothing in this
// folder runs, and nothing opens data/growth.json, while the desk is off.

const EXPECTED = [RuleError, TemplateError, BudgetError, DraftError];

/** What the server calls. Kept apart from listen() so the selftest can drive it. */
export function createOps({ store, env = process.env, clock = () => Date.now(), deps = {} }) {
  const run = deps.runDiscovery || runDiscovery;
  const prepare = deps.prepareToday || prepareToday;
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
   * is how a DM that became due at midnight gets its line written.
   */
  const tick = async () => {
    if (running) return;
    const now = clock();
    // Any closed lead whose page is still up (a withdrawal the site did not
    // answer) is taken down first: a closed lead never keeps a live route.
    if (await withdraw.closed(store.data, { env, now })) store.save();
    const ranToday = store.data.runs.some((r) => ilDate(r.at) === ilDate(now));
    if (!ranToday && ilHour(now) >= settings().runHour) {
      start('daily');
      return;
    }
    await prepare({ store, settings: settings(), env, now });
  };

  const whatOf = (field) => (String(field).startsWith('comment:') ? 'comment' : field);

  async function redraft(lead, body) {
    const s = settings();
    const state = store.data;
    const contextFor = async (slug) => siteContext(await cityFor(slug).catch(() => null));
    if (body.what === 'comment') {
      const post = lead.posts.find((p) => p.id === body.postId);
      if (!post) throw new RuleError('no-post', 'הסרטון לא נמצא');
      const context = await contextFor(post.dest?.slug || lead.dest?.slug);
      post.drafts = { ...post.drafts, comments: await draftComments({ state, settings: s, lead, post, context }), at: new Date(clock()).toISOString() };
      for (const key of Object.keys(lead.edits || {})) if (key.startsWith(`comment:${post.id}:`)) delete lead.edits[key];
      delete post.draftError;
    } else if (body.what === 'dm') {
      const post = lead.posts.find((p) => p.status === 'commented') || lead.posts[0];
      lead.drafts = { ...lead.drafts, dm: await draftCreatorLine({ state, settings: s, lead, post }) };
      if (lead.edits) delete lead.edits.dm;
    } else if (body.what === 'reply') {
      lead.drafts = { ...lead.drafts, reply: await draftCustomerReply({ state, settings: s, lead, post: lead.posts[0], context: await contextFor(lead.dest?.slug) }) };
      if (lead.edits) delete lead.edits.reply;
    } else {
      throw new RuleError('bad', 'אין מה לנסח מחדש כאן');
    }
    delete lead.draftError;
  }

  function cleanSettings(input) {
    const s = mergeSettings(input);
    const bad = [];
    for (const [k, v] of Object.entries(s.caps)) if (!Number.isInteger(v) || v < 0 || v > 50) bad.push(`מכסה (${k}) בין 0 ל-50`);
    if (!(s.budgetUsd >= 0 && s.budgetUsd <= 1000)) bad.push('תקציב בין 0 ל-1000');
    if (!(s.braveCreditUsd >= 0 && s.braveCreditUsd <= 100)) bad.push('קרדיט Brave בין 0 ל-100');
    if (!(Number.isInteger(s.runHour) && s.runHour >= 0 && s.runHour <= 23)) bad.push('שעה בין 0 ל-23');
    if (!(s.warmupDays >= 1)) bad.push('לפחות יום אחד מתגובה להודעה');
    if (!(s.followupDays >= 1)) bad.push('לפחות יום אחד עד תזכורת');
    if (!(s.followers.min < s.followers.max)) bad.push('מינימום עוקבים קטן מהמקסימום');
    for (const m of Object.values(s.models)) if (!/^claude-[a-z0-9.-]+$/.test(m)) bad.push(`שם מודל לא תקין: ${m}`);
    if (!s.tiktokQueries.every((q) => q.includes('{dest}'))) bad.push('כל חיפוש בטיקטוק צריך {dest}');
    const ytPerDay = s.youtubeDestinationsPerDay * s.tiktokQueries.length + s.hashtagsPerDay;
    if (!(Number.isInteger(s.youtubeDestinationsPerDay) && s.youtubeDestinationsPerDay >= 0 && ytPerDay <= 100)) {
      bad.push(`יוטיוב נותן 100 חיפושים ביום, וההגדרות מבקשות ${ytPerDay}`);
    }
    if (bad.length) throw new RuleError('bad', bad.join('. '));
    return s;
  }

  async function post(path, body) {
    try {
      if (path === '/api/run') return start('button') ? { ok: true } : { error: 'כבר מחפש' };

      let m = /^\/api\/lead\/(.+)\/(action|redraft)$/.exec(path);
      if (m) {
        const lead = store.data.leads[m[1]];
        if (!lead) return { error: 'הליד לא נמצא' };
        if (m[2] === 'redraft') {
          await redraft(lead, body);
          store.save();
          return { ok: true };
        }
        if (body.action === 'edit') {
          const problems = checkEdit(lead, whatOf(body.field), body.text, { state: store.data });
          if (problems.length) return { error: problems.join('. ') };
        }
        const effects = applyAction(store.data, lead, body.action, body, { now: clock(), settings: settings() });
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

      return { error: 'לא מוכר' };
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
    bound = await listen({ ops: proxy, port });
  } catch (e) {
    if (e.code === 'EADDRINUSE') {
      console.error(`Port ${port} is taken. Is the desk already running? Open http://127.0.0.1:${port}`);
      process.exit(1);
    }
    throw e;
  }
  holder.ops = createOps({ store: openStore(), env });
  console.log(`Growth desk: http://127.0.0.1:${bound.port}`);

  const tick = () => holder.ops.tick().catch((e) => console.error(`[growth] ${e.message}`));
  tick();
  setInterval(tick, 15 * 60_000).unref?.();
  return bound;
}
