// The rules, as pure functions over the state.
//
// Everything the brief calls a hard rule that is about PEOPLE rather than about
// the network lives here: the daily caps, one message and one follow-up,
// do-not-contact, and dedupe. Pure on purpose. Each of these is the
// kind of rule that is wrong quietly: a second follow-up looks exactly like a
// first one on the screen, and the only place it can be caught is a test that
// feeds the function a lead that already had one.
//
// A LEAD is a person or a business: a creator, an agency, or a customer. A
// creator carries POSTS (each video found for them), because a comment is about
// one video while the DM is about the person:
//
//   {
//     id, type: 'creator' | 'agency' | 'customer', source, foundAt,
//     query, hashtag,                 what found it, for the Reports page
//     name, handle, profileUrl, followers, followersFrom,
//     phone, whatsapp, email, website, socials, address, mapsUrl, kosher,
//     dest: { he, slug } | null,
//     posts: [{ id, platform, url, title, thumb, publishedAt, status, drafts, ... }],
//     score, why: [],
//     gender: 'f' | 'm' | 'unknown', genderFrom: 'post' | 'default' | 'owner',
//     stage, closed: null | 'skipped' | 'irrelevant' | 'not-interested' | 'done',
//     warmedAt, followedAt, messagedAt, followupSentAt, repliedAt, decidedAt,
//     route, trip, link, drafts: {}, edits: {}, history: []
//   }

import { creatorContact } from './links.js';

export const STAGES = ['found', 'commented', 'messaged', 'replied', 'yes', 'no', 'using'];

/**
 * Why an agency's first message may not go yet because of its sample route, or
 * null when the route passed its check (prepare/routeCheck.js runs it).
 */
export function routeProblem(lead) {
  const c = lead?.routeCheck;
  if (!lead?.example) return null;
  if (!c) return 'The sample route is not checked yet. It is checked on the next pass, before the message is written.';
  if (c.status === 'error') return `The route check could not run: ${c.error}. It runs again on the next pass.`;
  if (c.status === 'fail') return `The sample route failed its check (${c.issues.length} ${c.issues.length === 1 ? 'issue' : 'issues'}), so this message has no send button.`;
  return null;
}

// What the screens call them. The desk's own words are English (the owner's
// brief, 2026-10-11); what goes out to people stays Hebrew.
export const STAGE_LABEL = {
  found: 'Found',
  commented: 'Commented',
  messaged: 'Messaged',
  replied: 'Replied',
  yes: 'Interested',
  no: 'Not interested',
  using: 'Using the site',
};

export const TYPE_LABEL = { creator: 'Creators', agency: 'Agencies', customer: 'People planning trips' };
export const COLUMNS = ['comment', 'creator', 'agency', 'customer'];
export const COLUMN_LABEL = { comment: 'Comments (optional)', creator: 'Creators', agency: 'Agencies', customer: 'Questions' };

const rank = (stage) => STAGES.indexOf(stage);

/* ------------------------------------------------------------------ dates */

// Days are Israel days. A warm-up at 23:50 and a DM "the next day" at 00:10 is
// the next day, because that is what the owner will mean by it.
const IL_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' });
const IL_HOUR = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hourCycle: 'h23' });

export const ilDate = (t = Date.now()) => IL_DATE.format(new Date(t));
export const ilHour = (t = Date.now()) => Number(IL_HOUR.format(new Date(t)));
export const monthKey = (t = Date.now()) => ilDate(t).slice(0, 7);

/** Whole days from date string a to date string b (both YYYY-MM-DD). */
export const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/* ------------------------------------------------------------------ dedupe */

const norm = (s) => String(s || '').trim().toLowerCase();
const digits = (s) => String(s || '').replace(/\D/g, '');

/** The registrable-ish host, for "the same business by its website". */
export function siteKey(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** An Israeli number, as digits with the country code. '' when it is not one. */
export function phoneKey(phone) {
  let d = digits(phone);
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = `972${d.slice(1)}`;
  return d.length >= 11 ? d : '';
}

/**
 * Every key a person or business is known by.
 *
 * Several, because the same agency arrives from Places by its place id today
 * and from a search result by its website next month, and a "not interested"
 * has to hold against both.
 */
export function personKeys(c) {
  const keys = [];
  if (c.platform && c.handle) keys.push(`${c.platform}:user:${norm(c.handle)}`);
  if (c.channelId) keys.push(`yt:channel:${c.channelId}`);
  if (c.placeId) keys.push(`place:${c.placeId}`);
  const p = phoneKey(c.phone);
  if (p) keys.push(`phone:${p}`);
  const w = phoneKey(c.whatsapp);
  if (w && w !== p) keys.push(`phone:${w}`);
  const s = siteKey(c.website);
  if (s) keys.push(`site:${s}`);
  return keys;
}

export const postKey = (platform, id) => `${platform}:post:${id}`;

/** The first key that blocks this candidate, with why, or null. */
export function blockedBy(state, keys) {
  for (const k of keys) {
    if (state.dnc[k]) return { key: k, why: `dnc:${state.dnc[k].why}` };
  }
  return null;
}

/** The lead a key already belongs to, if any. */
export function leadFor(state, keys) {
  for (const k of keys) {
    const id = state.seen[k]?.lead;
    if (id && state.leads[id]) return state.leads[id];
  }
  return null;
}

export function markSeen(state, keys, { at = Date.now(), lead = null, rejected = null } = {}) {
  for (const k of keys) {
    if (!state.seen[k]) state.seen[k] = { at: new Date(at).toISOString(), ...(lead ? { lead } : {}), ...(rejected ? { rejected } : {}) };
    else if (lead && !state.seen[k].lead) state.seen[k].lead = lead;
  }
}

export function addDnc(state, keys, why, at = Date.now()) {
  for (const k of keys) state.dnc[k] ??= { at: new Date(at).toISOString(), why };
}

/** All the keys a stored lead is known by, for do-not-contact. */
export const leadKeys = (lead) =>
  personKeys({
    platform: { tiktok: 'tt', instagram: 'ig', youtube: 'yt' }[lead.source] || null,
    handle: lead.handle,
    channelId: lead.channelId,
    placeId: lead.placeId,
    phone: lead.phone,
    whatsapp: lead.whatsapp,
    website: lead.website,
  });

/* ------------------------------------------------------------------ gates */

/** The post the comment queue would show for this creator, or null. */
export function openPost(lead, { now = Date.now(), maxAgeDays = 45 } = {}) {
  const open = (lead.posts || []).filter((p) => p.status === 'open' && postAgeDays(p, now) <= maxAgeDays);
  open.sort((a, b) => (b.score || 0) - (a.score || 0) || String(b.publishedAt).localeCompare(String(a.publishedAt)));
  return open[0] || null;
}

export function postAgeDays(post, now = Date.now()) {
  const t = Date.parse(post?.publishedAt || '');
  return Number.isFinite(t) ? Math.max(0, (now - t) / 86_400_000) : 0;
}

/**
 * Is a creator's first message owed? From the moment they are found (the owner,
 * 2026-10-14): no comment first and no day's wait. A comment on a TikTok or
 * Instagram video is still offered, as an extra, never a gate.
 */
export function dmReady(lead) {
  return lead.type === 'creator' && !lead.closed && !lead.messagedAt && ['found', 'commented'].includes(lead.stage);
}

/** Is the one follow-up owed today? */
export function followupDue(lead, { now = Date.now(), followupDays = 5 } = {}) {
  if (lead.closed || !lead.messagedAt || lead.followupSentAt || lead.repliedAt) return false;
  if (lead.stage !== 'messaged') return false;
  return dayDiff(ilDate(lead.messagedAt), ilDate(now)) >= followupDays;
}

/**
 * Leads that stayed silent through the one follow-up, closed as "no reply"
 * `followupDays` after it (the owner's rule of 2026-10-11). Returns them.
 */
export function closeSilent(state, { now = Date.now(), followupDays = 5 } = {}) {
  const closed = [];
  for (const lead of Object.values(state.leads || {})) {
    if (lead.closed || !lead.followupSentAt || lead.repliedAt || lead.stage !== 'messaged') continue;
    if (dayDiff(ilDate(lead.followupSentAt), ilDate(now)) < followupDays) continue;
    lead.closed = 'no-reply';
    lead.noReplyAt = new Date(now).toISOString();
    (lead.history ??= []).push({ at: lead.noReplyAt, what: 'closed: no reply after the follow-up' });
    closed.push(lead);
  }
  return closed;
}

/** Messaged leads still waiting on an outcome: no answer yet, or an answer and no decision. */
export const awaitingOutcome = (state) =>
  Object.values(state.leads || {})
    .filter((l) => l.messagedAt && !l.closed && ['messaged', 'replied'].includes(l.stage))
    .sort((a, b) => String(a.messagedAt).localeCompare(String(b.messagedAt)));

/* ------------------------------------------------------------------ today */

const emptyDay = () => ({ comment: [], creator: [], agency: [], customer: [] });

/**
 * What a column could show today, best first, as item keys.
 *
 * An item key names the column, the lead and what is being done:
 *   comment:<lead>:<post>    creator:<lead>:dm | :followup
 *   agency:<lead>:message | :followup      customer:<lead>
 */
export function candidates(state, column, settings, now = Date.now()) {
  const leads = Object.values(state.leads).filter((l) => !l.closed);
  const byScore = (a, b) => (b.score || 0) - (a.score || 0);
  const s = settings;

  if (column === 'comment') {
    // TikTok and Instagram only: a YouTube creator goes straight to the message
    // (the owner, 2026-10-14), and the comment there would be drafted for nobody.
    return leads
      .filter((l) => l.type === 'creator' && l.source !== 'youtube' && l.stage === 'found' && !l.warmedAt)
      .map((l) => ({ l, p: openPost(l, { now, maxAgeDays: s.maxPostAgeDays }) }))
      .filter((x) => x.p)
      .sort((a, b) => (b.p.score || b.l.score || 0) - (a.p.score || a.l.score || 0))
      .map((x) => `comment:${x.l.id}:${x.p.id}`);
  }
  if (column === 'creator' || column === 'agency') {
    const mine = leads.filter((l) => l.type === column);
    const followups = mine.filter((l) => followupDue(l, { now, followupDays: s.followupDays })).sort(byScore).map((l) => `${column}:${l.id}:followup`);
    // A creator with a channel that takes a message comes before one whose
    // YouTube channel lists none, whatever the score: that card can only send
    // the owner to look for an email by hand.
    const reachable = (l) => (creatorContact(l).known ? 1 : 0);
    const fresh =
      column === 'creator'
        ? mine.filter(dmReady).sort((a, b) => reachable(b) - reachable(a) || byScore(a, b)).map((l) => `creator:${l.id}:dm`)
        : // Paused in Settings: only the follow-ups owed to agencies already messaged.
          s.agencyPaused
          ? []
          : // An agency set aside because its route failed the check does not come back (prepare/index.js).
            mine.filter((l) => l.stage === 'found' && !l.messagedAt && !l.routeSetAside).sort(byScore).map((l) => `agency:${l.id}:message`);
    // Follow-ups first: they are owed, and they count inside the cap.
    return [...followups, ...fresh];
  }
  if (column === 'customer') {
    return leads
      .filter((l) => l.type === 'customer' && l.stage === 'found')
      .filter((l) => (l.posts || []).some((p) => p.status === 'open' && postAgeDays(p, now) <= s.maxCustomerAgeDays))
      .sort(byScore)
      .map((l) => `customer:${l.id}`);
  }
  return [];
}

/**
 * The agencies the desk would message next, `caps.agency` of them, best first,
 * as leads: what the column takes once the pause in Settings is lifted. While it
 * is on, the desk makes these ready (prepare/index.js) so their routes can be
 * seen to pass first (the owner, 2026-10-11).
 */
export function nextInLine(state, settings, now = Date.now()) {
  return candidates(state, 'agency', { ...settings, agencyPaused: false }, now)
    .filter((k) => k.endsWith(':message'))
    .slice(0, Math.max(0, Number(settings.caps?.agency) || 0))
    .map((k) => state.leads[parseItem(k).leadId])
    .filter(Boolean);
}

/** Where an agency in line stands on its route, in a few words; `ready` when its route passed both checks. */
export function lineState(lead) {
  const c = lead.routeCheck;
  if (!lead.profile && !lead.example) return { ready: false, words: 'site not read yet' };
  if (!lead.example) return { ready: false, words: 'no example' };
  if (!c) return { ready: false, words: 'route not checked yet' };
  if (c.status === 'pass') return { ready: true, words: `route passed (${lead.example.he || lead.example.slug})` };
  if (c.status === 'error') return { ready: false, words: /quota/i.test(c.error || '') ? 'check waits for Google\'s daily limit (10:00)' : 'check could not run yet' };
  return { ready: false, words: `route failed (${c.issues?.length || 0} issues)` };
}

/**
 * Today's items, within the caps, stable for the day.
 *
 * Once an item is on today's list it stays on it, done or not, and it keeps
 * counting against the cap: the cap is the day's workload, and marking ten
 * comments done must not pull in an eleventh. New leads found later in the day
 * only fill slots that are still empty.
 */
export function pickToday(state, settings, now = Date.now()) {
  const date = ilDate(now);
  const day = (state.daily[date] ??= emptyDay());
  for (const col of COLUMNS) {
    const cap = Math.max(0, Number(settings.caps?.[col]) || 0);
    if (day[col].length >= cap) continue;
    const taken = new Set(day[col]);
    // A lead appears once per column per day, even if it has two items due.
    const leadsTaken = new Set(day[col].map((k) => parseItem(k).leadId));
    for (const key of candidates(state, col, settings, now)) {
      if (day[col].length >= cap) break;
      const { leadId } = parseItem(key);
      if (taken.has(key) || leadsTaken.has(leadId)) continue;
      day[col].push(key);
      taken.add(key);
      leadsTaken.add(leadId);
    }
  }
  return day;
}

/** An item key back into its parts. */
export function parseItem(key) {
  const [col, ...rest] = String(key).split(':');
  if (col === 'customer') return { col, leadId: rest.join(':'), what: 'reply' };
  const what = rest.pop();
  return { col, leadId: rest.join(':'), what };
}

/** Is this item finished (acted on) as far as Today is concerned? */
export function itemDone(state, key) {
  const { col, leadId, what } = parseItem(key);
  const l = state.leads[leadId];
  if (!l) return true;
  if (col === 'comment') {
    const p = (l.posts || []).find((x) => x.id === what);
    return !p || p.status !== 'open' || Boolean(l.closed) || Boolean(l.warmedAt);
  }
  if (what === 'followup') return Boolean(l.followupSentAt || l.repliedAt || l.closed);
  if (what === 'dm' || what === 'message') return Boolean(l.messagedAt || l.closed);
  return Boolean(l.closed) || l.stage !== 'found';
}

/* ------------------------------------------------------------------ actions */

export class RuleError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const log = (lead, what, at) => (lead.history ??= []).push({ at: new Date(at).toISOString(), what });

/**
 * Apply one button press to a lead.
 *
 * Returns `{ withdraw }` when the lead's public route should come down. Throws
 * a RuleError for anything the rules forbid, so the page can say why rather
 * than appear to have done it.
 */
export function applyAction(state, lead, action, payload = {}, { now = Date.now(), settings } = {}) {
  const at = new Date(now).toISOString();
  const effects = { withdraw: false };
  const s = settings || {};

  switch (action) {
    // ---- the comment queue: one video
    case 'commented': {
      if (lead.type === 'customer') {
        lead.stage = 'commented';
        lead.closed = 'done';
        for (const p of lead.posts || []) if (p.status === 'open') p.status = 'commented';
        break;
      }
      const post = (lead.posts || []).find((p) => p.id === payload.postId);
      if (!post) throw new RuleError('no-post', 'That video is not on this lead.');
      post.status = 'commented';
      post.commentedAt = at;
      lead.warmedAt ??= at;
      if (rank(lead.stage) < rank('commented')) lead.stage = 'commented';
      break;
    }
    case 'followed':
      lead.followedAt ??= at;
      break;
    case 'skip-post': {
      // Only this video. The creator stays, and a new video of theirs found
      // later brings them back to the queue.
      const post = (lead.posts || []).find((p) => p.id === payload.postId);
      if (!post) throw new RuleError('no-post', 'That video is not on this lead.');
      post.status = 'skipped';
      break;
    }
    // The Instagram a search found for a YouTube creator is not them (the
    // card's [Not them]). The message was written for it, so it is written
    // again on the next pass for wherever it goes now.
    case 'ig-wrong':
      if (lead.igLookup?.status !== 'found') throw new RuleError('bad', 'This lead has no Instagram found by search.');
      lead.igLookup.wrong = true;
      if (!lead.messagedAt && lead.drafts?.dm) {
        delete lead.drafts.dm;
        for (const key of Object.keys(lead.edits || {})) if (key.startsWith('dm:')) delete lead.edits[key];
      }
      break;
    case 'irrelevant':
      lead.closed = 'irrelevant';
      addDnc(state, leadKeys(lead), 'irrelevant', now);
      effects.withdraw = true;
      break;

    // ---- the message and its one follow-up
    case 'sent': {
      if (lead.type === 'customer') throw new RuleError('no-dm', 'People asking questions get a reply comment, never a message.');
      if (lead.closed) throw new RuleError('closed', 'This lead is closed.');
      if (!lead.messagedAt) {
        // The card offers no send button then; this is the same rule for any other caller.
        if (lead.type === 'agency' && routeProblem(lead)) throw new RuleError('route', routeProblem(lead));
        lead.messagedAt = at;
        lead.stage = 'messaged';
      } else if (followupDue(lead, { now, followupDays: s.followupDays ?? 5 })) {
        lead.followupSentAt = at;
      } else if (lead.followupSentAt) {
        throw new RuleError('done', 'They already had the message and the one follow-up. Nothing more goes to them.');
      } else {
        throw new RuleError('not-due', 'The follow-up is not due yet.');
      }
      break;
    }
    case 'skip':
      lead.closed = 'skipped';
      effects.withdraw = true;
      break;
    case 'replied':
      lead.repliedAt ??= at;
      if (rank(lead.stage) < rank('replied')) lead.stage = 'replied';
      break;
    case 'yes':
      lead.stage = 'yes';
      lead.decidedAt = at;
      lead.repliedAt ??= at;
      break;
    case 'no':
      lead.stage = 'no';
      lead.decidedAt = at;
      lead.closed = 'not-interested';
      addDnc(state, leadKeys(lead), 'not-interested', now);
      effects.withdraw = true;
      break;
    case 'using':
      lead.stage = 'using';
      break;
    // The fourth outcome of a message: they never answered. Closed, not on the
    // do-not-contact list (that is for "not interested"), and the route page
    // comes down like any closed lead's.
    case 'no-reply':
      if (!lead.messagedAt) throw new RuleError('not-messaged', 'Only a lead you messaged can be closed as no reply.');
      if (lead.closed) throw new RuleError('closed', 'This lead is closed.');
      lead.closed = 'no-reply';
      lead.noReplyAt = at;
      effects.withdraw = true;
      break;

    // ---- the drafts
    case 'gender':
      if (!['f', 'm', 'unknown'].includes(payload.gender)) throw new RuleError('bad', 'She, he or unknown.');
      lead.gender = payload.gender;
      lead.genderFrom = 'owner';
      break;
    case 'edit':
      if (!payload.field) throw new RuleError('bad', 'Which text? The field is missing.');
      (lead.edits ??= {})[payload.field] = String(payload.text ?? '');
      break;
    case 'unedit':
      if (lead.edits) delete lead.edits[payload.field];
      break;

    default:
      throw new RuleError('unknown', `Unknown action: ${action}`);
  }

  log(lead, action + (payload.postId ? `:${payload.postId}` : ''), now);
  return effects;
}
