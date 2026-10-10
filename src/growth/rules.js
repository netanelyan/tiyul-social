// The rules, as pure functions over the state.
//
// Everything the brief calls a hard rule that is about PEOPLE rather than about
// the network lives here: the daily caps, the warm-up gate, one message and one
// follow-up, do-not-contact, and dedupe. Pure on purpose. Each of these is the
// kind of rule that is wrong quietly: a second follow-up looks exactly like a
// first one on the screen, and the only place it can be caught is a test that
// feeds the function a lead that already had one.
//
// A LEAD is a person or a business: a creator, an agency, or a customer. A
// creator carries POSTS (each video found for them), because the comment queue
// is about one video while the DM is about the person:
//
//   {
//     id, type: 'creator' | 'agency' | 'customer', source, foundAt,
//     query, hashtag,                 what found it, for the Reports page
//     name, handle, profileUrl, followers, followersFrom,
//     phone, whatsapp, email, website, socials, address, mapsUrl, kosher,
//     dest: { he, slug } | null,
//     posts: [{ id, platform, url, title, thumb, publishedAt, status, drafts, ... }],
//     score, why: [],
//     gender: 'f' | 'm', genderFrom: 'post' | 'default' | 'owner',
//     stage, closed: null | 'skipped' | 'irrelevant' | 'not-interested' | 'done',
//     warmedAt, followedAt, messagedAt, followupSentAt, repliedAt, decidedAt,
//     route, trip, link, drafts: {}, edits: {}, history: []
//   }

export const STAGES = ['found', 'commented', 'messaged', 'replied', 'yes', 'no', 'using'];

export const STAGE_HE = {
  found: 'נמצא',
  commented: 'הגבתי',
  messaged: 'נשלחה הודעה',
  replied: 'ענו',
  yes: 'מעוניינים',
  no: 'לא מעוניינים',
  using: 'משתמשים',
};

export const TYPE_HE = { creator: 'יוצרים', agency: 'סוכנויות', customer: 'לקוחות' };
export const COLUMNS = ['comment', 'creator', 'agency', 'customer'];
export const COLUMN_HE = { comment: 'תור תגובות', creator: 'יוצרים', agency: 'סוכנויות', customer: 'לקוחות' };

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

/** Has the warm-up happened, on an earlier Israel day by at least `warmupDays`? */
export function dmReady(lead, { now = Date.now(), warmupDays = 1 } = {}) {
  if (lead.type !== 'creator' || lead.closed || lead.messagedAt || !lead.warmedAt) return false;
  return dayDiff(ilDate(lead.warmedAt), ilDate(now)) >= warmupDays;
}

/** Is the one follow-up owed today? */
export function followupDue(lead, { now = Date.now(), followupDays = 4 } = {}) {
  if (lead.closed || !lead.messagedAt || lead.followupSentAt || lead.repliedAt) return false;
  if (lead.stage !== 'messaged') return false;
  return dayDiff(ilDate(lead.messagedAt), ilDate(now)) >= followupDays;
}

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
    return leads
      .filter((l) => l.type === 'creator' && l.stage === 'found' && !l.warmedAt)
      .map((l) => ({ l, p: openPost(l, { now, maxAgeDays: s.maxPostAgeDays }) }))
      .filter((x) => x.p)
      .sort((a, b) => (b.p.score || b.l.score || 0) - (a.p.score || a.l.score || 0))
      .map((x) => `comment:${x.l.id}:${x.p.id}`);
  }
  if (column === 'creator' || column === 'agency') {
    const mine = leads.filter((l) => l.type === column);
    const followups = mine.filter((l) => followupDue(l, { now, followupDays: s.followupDays })).sort(byScore).map((l) => `${column}:${l.id}:followup`);
    const fresh =
      column === 'creator'
        ? mine.filter((l) => dmReady(l, { now, warmupDays: s.warmupDays })).sort(byScore).map((l) => `creator:${l.id}:dm`)
        : mine.filter((l) => l.stage === 'found' && !l.messagedAt).sort(byScore).map((l) => `agency:${l.id}:message`);
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
      if (!post) throw new RuleError('no-post', 'הסרטון לא נמצא');
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
      if (!post) throw new RuleError('no-post', 'הסרטון לא נמצא');
      post.status = 'skipped';
      break;
    }
    case 'irrelevant':
      lead.closed = 'irrelevant';
      addDnc(state, leadKeys(lead), 'irrelevant', now);
      effects.withdraw = true;
      break;

    // ---- the message and its one follow-up
    case 'sent': {
      if (lead.type === 'customer') throw new RuleError('no-dm', 'ללקוחות לא שולחים הודעה, רק תגובה');
      if (lead.closed) throw new RuleError('closed', 'הליד סגור');
      if (!lead.messagedAt) {
        if (lead.type === 'creator' && !dmReady(lead, { now, warmupDays: s.warmupDays ?? 1 })) {
          throw new RuleError('not-warm', 'הודעה ליוצר/ת רק יום אחרי שסימנת שהגבת');
        }
        lead.messagedAt = at;
        lead.stage = 'messaged';
      } else if (followupDue(lead, { now, followupDays: s.followupDays ?? 4 })) {
        lead.followupSentAt = at;
      } else if (lead.followupSentAt) {
        throw new RuleError('done', 'כבר נשלחו הודעה ותזכורת אחת. זהו, לא שולחים עוד');
      } else {
        throw new RuleError('not-due', 'התזכורת עוד לא הגיעה');
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

    // ---- the drafts
    case 'gender':
      if (payload.gender !== 'f' && payload.gender !== 'm') throw new RuleError('bad', 'f או m');
      lead.gender = payload.gender;
      lead.genderFrom = 'owner';
      break;
    case 'edit':
      if (!payload.field) throw new RuleError('bad', 'חסר שדה');
      (lead.edits ??= {})[payload.field] = String(payload.text ?? '');
      break;
    case 'unedit':
      if (lead.edits) delete lead.edits[payload.field];
      break;

    default:
      throw new RuleError('unknown', `פעולה לא מוכרת: ${action}`);
  }

  log(lead, action + (payload.postId ? `:${payload.postId}` : ''), now);
  return effects;
}
