import { keyStatus, LIMITS, TEMPLATE_LABELS, TEMPLATE_NAMES } from '../config.js';
import { API_PRICES, monthSpend } from '../../clients/budget.js';
import { creatorContact, leadChannel, openTarget } from '../links.js';
import { compose, draftsFor, editWarnings, messagePost, VARIANT_COUNT } from '../prepare/compose.js';
import { weeklyEdits } from '../prepare/learn.js';
import { fill } from '../prepare/templates.js';
import { CONNECTIVES, FAKE_EXPERIENCE, FORMAL, PRAISE } from '../prepare/tells.js';
import { SITE_FACTS } from '../prepare/voice.js';
import { byChannel, bySearch, funnel, stageCounts, weekOverWeek } from '../report/stats.js';
import { awaitingOutcome, COLUMN_LABEL, COLUMNS, dayDiff, dmReady, followupDue, ilDate, itemDone, lineState, nextInLine, openPost, parseItem, routeProblem, STAGE_LABEL, STAGES, TYPE_LABEL } from '../rules.js';

// Every page, as a function from state to HTML. Server-rendered, English,
// left to right.
//
// THE DESK'S OWN WORDS ARE ENGLISH, WHAT GOES OUT IS HEBREW (the owner's brief,
// 2026-10-11). Every Hebrew value (a draft, a video title, a name, a quote)
// sits in its own right-to-left block (`he()`) or, inline, in a <bdi> (`heIn()`),
// so a Hebrew name in an English sentence does not scramble the punctuation
// around it.
//
// THE COPY IS WRITTEN FOR A PERSON: what to do first, then only the numbers
// that change what to do. Everything the desk counts for itself (queries run,
// posts skipped by the age limit) sits behind a "Details" toggle.
//
// No framework: a page that is a string can be tested by reading it. Every
// value that came from outside goes through esc(); the selftest renders a
// caption with a script tag in it and checks it comes out as text.

export const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const attr = esc;
const PLATFORM = { tiktok: 'TikTok', instagram: 'Instagram', youtube: 'YouTube', places: 'Google Maps' };
const WHEN = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'long' });
const when = (t) => (t ? WHEN.format(new Date(t)) : '');
const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : String(n));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ago = (t, now) => {
  const d = Math.floor((now - Date.parse(t)) / 86_400_000);
  if (!Number.isFinite(d)) return '';
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
};

/** A Hebrew block, right to left. */
const he = (html, tag = 'div', cls = '') => `<${tag} dir="rtl" lang="he" class="he${cls ? ` ${cls}` : ''}">${html}</${tag}>`;
/** A Hebrew run inside an English line. */
const heIn = (text) => `<bdi>${esc(text)}</bdi>`;

/**
 * An English sentence the desk wrote with Hebrew inside it ("They sell מצרים,
 * סין; סיני is in our catalog"), escaped, with every Hebrew run isolated. Without
 * it the browser reorders the English words around the Hebrew ones.
 */
export const mixed = (text) =>
  esc(text).replace(/[֐-׿](?:[֐-׿\s,'"״׳\-]|&quot;|&#39;)*[֐-׿]|[֐-׿]/g, (run) => `<bdi>${run}</bdi>`);

/* ------------------------------------------------------------ layout */

function layout({ title, active, token, body, state, settings, now, loggedIn = false }) {
  const spend = monthSpend(state, settings, now);
  const pct = spend.cap ? Math.min(100, Math.round((spend.billable / spend.cap) * 100)) : 100;
  const nav = [
    ['/', 'Today', 'today'],
    ['/leads', 'All leads', 'leads'],
    ['/reports', 'Reports', 'reports'],
    ['/settings', 'Settings', 'settings'],
  ]
    .map(([href, label, key]) => `<a href="${href}"${key === active ? ' class="on" aria-current="page"' : ''}>${label}</a>`)
    .join('');
  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="growth-token" content="${attr(token)}">
<title>${esc(title)} · Growth desk</title>
<link rel="stylesheet" href="/static/style.css">
</head>
<body>
<header class="top">
  <a class="brand" href="/">Growth desk <span>tiyul+</span></a>
  <nav>${nav}</nav>
  <a class="budget${spend.reached ? ' over' : ''}" href="/reports#budget" title="Billed this month, after the free allowances">
    <span>Spent this month</span>
    <b>${money(spend.billable)} of ${money(spend.cap)}</b>
    <i style="width:${pct}%"></i>
  </a>
  ${loggedIn ? '<button type="button" class="quiet small-btn" data-logout="1">Log out</button>' : ''}
</header>
<main>
${body}
</main>
<div id="toast" role="status" aria-live="polite"></div>
<script src="/static/client.js"></script>
</body>
</html>`;
}

const button = (label, data, cls = '') => {
  const { disabled, title, ...rest } = data;
  const attrs = Object.entries(rest)
    .filter(([, v]) => v != null && v !== false)
    .map(([key, v]) => `data-${key}="${attr(v)}"`)
    .join(' ');
  return `<button type="button" class="${cls}" ${attrs}${disabled ? ' disabled' : ''}${title ? ` title="${attr(title)}"` : ''}>${label}</button>`;
};

const thumb = (post, cls = 'thumb') =>
  post?.thumb
    ? `<a class="${cls}" href="${attr(post.url)}" target="_blank" rel="noopener noreferrer"><img src="/thumb/${attr(post.thumb)}" alt="" loading="lazy"></a>`
    : `<a class="${cls} none" href="${attr(post?.url || '#')}" target="_blank" rel="noopener noreferrer">Open</a>`;

const whyList = (why = []) => (why.length ? `<details class="whybox"><summary>Why this one</summary><ul class="why">${why.map((w) => `<li>${heIn(w)}</li>`).join('')}</ul></details>` : '');

/** What to call a lead on screen. An Instagram post found by search may have no handle at all. */
export const displayName = (lead) => lead.name || (lead.handle ? `@${lead.handle}` : lead.source === 'instagram' ? 'An Instagram post (the name is in the post)' : lead.id);

function whoLine(lead) {
  const bits = [];
  bits.push(`<a class="name" href="/lead/${encodeURIComponent(lead.id)}">${heIn(displayName(lead))}</a>`);
  if (lead.handle && lead.name) bits.push(`<span class="handle">@${esc(lead.handle)}</span>`);
  bits.push(`<span class="src">${esc(PLATFORM[lead.source] || lead.source)}</span>`);
  if (Number.isFinite(lead.followers)) bits.push(`<span>${k(lead.followers)} followers</span>`);
  if (lead.dest?.he) bits.push(`<span class="dest">${heIn(lead.dest.he)}</span>`);
  return `<div class="who">${bits.join('')}</div>`;
}

const textBox = (id, text, { rows = 4 } = {}) => he(`<textarea id="${attr(id)}" class="draft-text" rows="${rows}" readonly>${esc(text)}</textarea>`);

const missingNote = (missing) => (missing?.length ? `<p class="note warn">${missing.map(mixed).join('<br>')}</p>` : '');

const SOURCE_LABEL = { title: 'the title', description: 'the description', comment: 'a viewer\'s comment', site: 'their website', listing: 'their Google listing', question: 'their question' };

/** The reviewer's verdict on one variant, as a badge and a line. */
function scoreLine(v) {
  if (!v) return '';
  if (v.score == null) return '<span class="score s-none">Not reviewed (an older draft)</span>';
  const cls = v.score <= 3 ? 's-good' : v.score <= 6 ? 's-mid' : 's-bad';
  const tells = v.tells?.length ? ` <span class="small">${v.tells.map(mixed).join(', ')}</span>` : '';
  const fixed = v.rewritten ? ` <span class="tag" title="${attr(`Before the reviewer's rewrite (${v.originalScore}/10): ${v.original}`)}">rewritten by the reviewer</span>` : '';
  const fact = v.factProblem ? `<p class="note warn">The reviewer flags a fact: ${mixed(v.factProblem)}</p>` : '';
  return `<span class="score ${cls}">Bot score ${v.score}/10</span>${tells}${fixed}${fact}`;
}

const specificLine = (v) =>
  v?.specific?.quote ? `<p class="small">About: ${heIn(v.specific.quote)} <span>(from ${esc(SOURCE_LABEL[v.specific.source] || v.specific.source)})</span></p>` : '';

/**
 * One variant: the reviewer's score, the text, what it is about, and its own
 * [Copy & open] and [Edit].
 */
function variantBlock({ lead, what, i, postId = null, ctx, idBase, target, blocked, noSend = false, rows = 3 }) {
  const c = compose(lead, what, { ...ctx, i, postId });
  if (!c.text) return '';
  const id = `${idBase}-v${i}`;
  const field = what === 'comment' ? `comment:${postId}:${i}` : what === 'followup' ? 'followup' : `${what}:${i}`;
  const warnings = c.edited ? editWarnings(lead, what, c.text, { state: ctx.state }) : [];
  return `<div class="variant">
  <div class="vhead">${what === 'followup' ? '' : `<b>Option ${i + 1}</b> `}${c.edited ? '<span class="tag">your edit</span>' : scoreLine(c.variant)}</div>
  ${textBox(id, c.text, { rows })}
  ${c.edited ? '' : specificLine(c.variant)}
  ${warnings.length ? `<p class="note warn">Reads like a bot here: ${warnings.map(mixed).join('; ')}</p>` : ''}
  <div class="mini">
    ${noSend ? '' : button('Copy &amp; open', { 'copy-open': `#${id}`, href: target, lead: lead.id, what, post: postId, variant: what === 'followup' ? null : i, disabled: blocked || !target ? 'disabled' : null }, i === 0 ? 'primary' : '')}
    ${button('Edit', { edit: `#${id}`, lead: lead.id, field })}
    ${c.edited ? button('Undo edit', { act: 'unedit', lead: lead.id, field }) : ''}
  </div>
</div>`;
}

/** The variants of one item, best score first (as stored). */
function variants(args) {
  const { lead, what, postId } = args;
  const d = what === 'followup' ? { variants: [{}] } : draftsFor(lead, what, postId);
  const n = Math.min(VARIANT_COUNT, d?.variants?.length || 0);
  return Array.from({ length: n }, (_, i) => variantBlock({ ...args, i })).join('');
}

/** "Changed it after pasting?" and the button that marks it done. */
const finalBox = (idBase) =>
  `<details class="final"><summary>Changed it after pasting?</summary>${he(`<textarea id="${attr(idBase)}-final" class="draft-text" rows="3" placeholder="What you really sent"></textarea>`)}<p class="small">Paste what you really sent, so the next drafts learn from it.</p></details>`;

/* ------------------------------------------------------------ today */

function cardComment(state, key, ctx) {
  const { leadId, what: postId } = parseItem(key);
  const lead = state.leads[leadId];
  const post = lead?.posts.find((p) => p.id === postId);
  if (!lead || !post) return '';
  const done = itemDone(state, key);
  const id = `c-${hash(key)}`;
  const target = openTarget(lead, 'comment');
  const body = variants({ lead, what: 'comment', postId, ctx, idBase: id, target, blocked: false });
  const context = post.platform === 'youtube' ? (post.contextAt ? `read with its description and ${plural((post.topComments || []).length, 'top comment')}` : 'description and comments not read yet') : 'caption only: this platform\'s comments cannot be read';
  return `<article class="card${done ? ' done' : ''}" id="${id}">
  <div class="row">${thumb(post)}<div class="meta">${whoLine(lead)}${he(esc(post.title), 'p', 'caption')}<p class="small">${esc(context)}</p></div></div>
  ${whyList(post.why)}
  ${post.draftError ? `<p class="note warn">Couldn't draft this one: ${mixed(post.draftError)}</p>` : ''}
  ${body || (post.draftError ? '' : '<p class="note">The comments are written on the next pass, within 15 minutes.</p>')}
  ${done ? '' : finalBox(id)}
  <div class="actions">${
    done
      ? `<span class="tag ok">${post.status === 'commented' ? 'Commented' : post.status === 'skipped' ? 'Skipped' : lead.closed ? 'Closed' : 'Done'}</span>`
      : [
          button('Commented', { act: 'commented', lead: lead.id, post: post.id, final: `#${id}-final` }, 'primary'),
          button('Followed', { act: 'followed', lead: lead.id, post: post.id }, lead.followedAt ? 'on' : ''),
          button('Skip', { act: 'skip-post', lead: lead.id, post: post.id, title: 'Skip this video only' }),
          button('Not for us', { act: 'irrelevant', lead: lead.id, confirm: 'Sure? They never come back' }, 'quiet'),
        ].join('')
  }<a class="more" href="/lead/${encodeURIComponent(lead.id)}">Lead page</a></div>
</article>`;
}

/** The route on the card: where it stands on the site, and its days. */
function routeBox(lead) {
  const r = lead.route;
  const t = lead.trip;
  const ex = lead.example;
  const reason = ex?.reason ? `<p class="small">${mixed(ex.reason)}</p>` : '';
  const check = lead.type === 'agency' && ex ? routeCheckBadge(lead.routeCheck) : '';
  if (lead.type === 'agency' && ex?.kind === 'page') {
    return `<div class="routebox"><p><b>Example:</b> our ${heIn(ex.he)} page, <a href="https://www.tiyulplus.com${attr(ex.path)}" target="_blank" rel="noopener noreferrer"><bdi>tiyulplus.com${esc(ex.path)}</bdi></a></p>${reason}${check}</div>`;
  }
  if (!r) return reason ? `<div class="routebox">${reason}</div>` : '';
  const status =
    t?.status === 'published'
      ? `on the site: <a href="${attr(t.url)}" target="_blank" rel="noopener noreferrer"><bdi>${esc(t.url.replace(/^https:\/\/(www\.)?/, ''))}</bdi></a>`
      : t?.reason
        ? `<span class="warn">${esc(t.reason)}</span>`
        : 'not on the site yet';
  const days = r.days.map((d, i) => `<li>${he(`<b>יום ${i + 1}</b>${d.dayTrip ? ' (טיול יום)' : ''} ${d.names.map(esc).join(' · ')}`, 'span')}</li>`).join('');
  const changes = (r.changes || []).length
    ? `<details class="small"><summary>Built from the site's itinerary, with ${plural(r.changes.length, 'change')}</summary><ul>${r.changes.map((x) => `<li>${mixed(x)}</li>`).join('')}</ul></details>`
    : '';
  const refresh = lead.routeRefresh
    ? `<p class="small">A rebuilt route waits to replace this page: ${lead.routeRefresh.check?.status === 'pass' ? `ready, re-sent on the next pass${lead.routeRefresh.error ? ` (the last try failed: ${mixed(lead.routeRefresh.error)})` : ''}` : lead.routeRefresh.check?.status === 'error' ? `its check could not run (${mixed(lead.routeRefresh.check.error)}), tried again within the hour` : `it did not pass its check either (${plural(lead.routeRefresh.check?.issues?.length || 0, 'issue')}), so the page stays as it is`}.</p>`
    : '';
  const aside = lead.routeSetAside ? `<p class="note warn">Set aside ${when(lead.routeSetAside.at)}: the route still failed its check after the rebuild, so it gave its slot on Today back.</p>` : '';
  return `<div class="routebox">
  <p><b>${lead.type === 'agency' ? 'Their example' : 'Their route'}:</b> ${plural(r.days.length, 'day')} in ${heIn(r.cityName)}, ${plural(r.stops, 'stop')}, ${status}</p>
  ${reason}
  ${aside}
  ${check}
  ${refresh}
  <details${lead.type === 'agency' ? ' open' : ''}><summary>The days</summary><ol class="days">${days}</ol></details>
  ${changes}
</div>`;
}

/**
 * The route check on an agency's card (prepare/routeCheck.js): passed, the
 * issues one per line, or why it has not run.
 */
export function routeCheckBadge(c) {
  if (!c) return '<p class="check"><span class="tag">Route check: not run yet</span> It runs on the next pass, before the message is written.</p>';
  if (c.status === 'error') return `<p class="check"><span class="tag bad">Route check: could not run</span> ${mixed(c.error)}. It runs again on the next pass.</p>`;
  const noStatus = (c.stops || []).filter((s) => s.google && !s.status).length;
  if (c.status === 'pass') {
    return `<p class="check"><span class="tag ok">Route check: passed</span> ${plural(c.stopCount, 'stop')} found on Google and open${noStatus ? ` (${noStatus} of them a town or an area, with no opening status)` : ''}, ${plural(c.days, 'full day')}${c.dayTrips ? `, ${plural(c.dayTrips, 'of them a whole day trip', 'of them whole day trips')}` : ''}, no long hops inside a day. Checked ${when(c.checkedAt)}.</p>`;
  }
  return `<div class="check"><p><span class="tag bad">Route check: ${plural(c.issues.length, 'issue')}</span> No send button until the route passes.</p><ul class="issues">${c.issues.map((i) => `<li>${mixed(i)}</li>`).join('')}</ul></div>`;
}

function cardMessage(state, key, ctx) {
  const { col, leadId, what } = parseItem(key);
  const lead = state.leads[leadId];
  if (!lead) return '';
  const done = itemDone(state, key);
  const id = `m-${hash(key)}`;
  const target = openTarget(lead, what);
  const first = compose(lead, what, { ...ctx, i: 0 });
  const blocked = first.missing.filter((m) => m !== 'Not drafted yet.').length > 0 && what !== 'followup';
  // No send button at all, rather than a greyed one, for a route that has not passed.
  const noSend = col === 'agency' && what !== 'followup' && Boolean(routeProblem(lead));
  const label = what === 'followup' ? 'The one follow-up' : col === 'agency' ? 'First message' : 'First message';
  const agency = col === 'agency' ? `<p class="contact">${lead.kosher ? '<span class="tag kosher">kosher audience</span>' : ''}${contactLine(lead)}</p>` : creatorContactLine(lead);
  const body = variants({ lead, what, ctx, idBase: id, target, blocked, noSend, rows: what === 'followup' ? 2 : 5 });
  return `<article class="card${done ? ' done' : ''}" id="${id}">
  <div class="row">${col === 'creator' ? thumb(messagePost(lead)) : ''}<div class="meta">${whoLine(lead)}${agency}</div></div>
  ${what === 'followup' ? '' : routeBox(lead)}
  <p class="label">${label}</p>
  ${done ? '' : missingNote(first.missing.filter((m) => m !== 'Not drafted yet.' || !lead.draftError))}
  ${lead.draftError ? `<p class="note warn">Couldn't draft this one: ${mixed(lead.draftError)}</p>` : ''}
  ${body || (lead.draftError || noSend ? '' : '<p class="note">The message is written on the next pass, within 15 minutes.</p>')}
  ${done || noSend ? '' : finalBox(id)}
  <div class="actions">${
    done
      ? `<span class="tag ok">${lead.closed ? 'Closed' : what === 'followup' ? 'Follow-up sent' : 'Sent'}</span>`
      : [
          noSend ? '' : button('Sent', { act: 'sent', lead: lead.id, final: `#${id}-final`, disabled: blocked ? 'disabled' : null }, 'primary'),
          what === 'followup' ? outcomeBar(lead) : button('Skip', { act: 'skip', lead: lead.id }),
          what === 'followup' ? '' : button('Not for us', { act: 'no', lead: lead.id, confirm: 'Sure? They are never contacted again' }, 'quiet'),
        ].join('')
  }<a class="more" href="/lead/${encodeURIComponent(lead.id)}">Lead page</a></div>
</article>`;
}

function cardCustomer(state, key, ctx) {
  const { leadId } = parseItem(key);
  const lead = state.leads[leadId];
  if (!lead) return '';
  const post = lead.posts[0];
  const done = itemDone(state, key);
  const id = `u-${hash(key)}`;
  const body = variants({ lead, what: 'reply', ctx, idBase: id, target: post?.url, blocked: false, rows: 4 });
  return `<article class="card${done ? ' done' : ''}" id="${id}">
  <div class="row">${thumb(post)}<div class="meta">${whoLine(lead)}${he(esc(post?.title), 'p', 'caption')}</div></div>
  ${whyList(post?.why)}
  ${lead.draftError ? `<p class="note warn">Couldn't draft this one: ${mixed(lead.draftError)}</p>` : ''}
  ${body || (lead.draftError ? '' : '<p class="note">The reply is written on the next pass, within 15 minutes.</p>')}
  ${done ? '' : finalBox(id)}
  <div class="actions">${
    done
      ? `<span class="tag ok">${lead.stage === 'commented' ? 'Replied' : 'Closed'}</span>`
      : [button('Replied', { act: 'commented', lead: lead.id, final: `#${id}-final` }, 'primary'), button('Skip', { act: 'skip', lead: lead.id })].join('')
  }<a class="more" href="/lead/${encodeURIComponent(lead.id)}">Lead page</a></div>
</article>`;
}

/** Where a creator's message goes, inline ("Instagram DM, instagram.com/x"), or null when the desk knows nowhere. */
function creatorWhere(lead) {
  const c = creatorContact(lead);
  if (!c.known) return null;
  if (c.channel === 'Email') return `email, <bdi>${esc(lead.email)}</bdi>`;
  return `${esc(c.channel)} DM, <a href="${attr(c.url)}" target="_blank" rel="noopener noreferrer"><bdi>${esc(c.url.replace(/^https?:\/\/(www\.|m\.)?/, '').replace(/\/$/, ''))}</bdi></a>`;
}

const NO_CONTACT = 'No Instagram, email or TikTok in their channel or video descriptions, and YouTube has no direct messages. [Copy & open] opens their channel\'s About page: YouTube shows a business email there behind "View email address", and the links the desk cannot read.';

/** The line on a creator's card that says where the message goes. */
function creatorContactLine(lead) {
  const where = creatorWhere(lead);
  return where ? `<p class="contact">Goes by ${where}</p>` : `<p class="note">${esc(NO_CONTACT)}</p>`;
}

// Each piece in its own <bdi>: a phone number, an email and a domain are
// left-to-right runs that must not be reordered around Hebrew next to them.
function contactLine(lead) {
  const bits = [];
  if (lead.whatsapp) bits.push(`WhatsApp <bdi>${esc(lead.whatsapp)}</bdi>`);
  else if (lead.phone) bits.push(`<bdi>${esc(lead.phone)}</bdi>`);
  if (lead.email) bits.push(`<bdi>${esc(lead.email)}</bdi>`);
  if (lead.website) bits.push(`<bdi>${esc(String(lead.website).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</bdi>`);
  return bits.join(' · ');
}

/**
 * The summary at the top of Today, written like a person telling the owner
 * what to do: what is ready first, then only the numbers that change it.
 */
export function todaySummary(state, day, settings, now = Date.now()) {
  const open = (col) => (day[col] || []).filter((x) => !itemDone(state, x));
  const ready = (col, what) => open(col).filter((x) => {
    const { leadId, what: w } = parseItem(x);
    const lead = state.leads[leadId];
    if (!lead) return false;
    if (col === 'comment') return Boolean(draftsFor(lead, 'comment', w)?.variants?.length);
    if (col === 'agency' && w !== 'followup' && routeProblem(lead)) return false;
    return w === 'followup' || Boolean(draftsFor(lead, what || w)?.variants?.length);
  });
  const lines = [];
  const cr = ready('creator', 'dm');
  lines.push(cr.length ? `${plural(cr.length, 'creator message')} ready.` : open('creator').length ? `${plural(open('creator').length, 'creator message')} being written.` : 'No new creators today.');
  const ag = ready('agency', 'message');
  const waiting = Object.values(state.leads).filter((l) => l.type === 'agency' && !l.closed && l.stage === 'found' && !l.messagedAt && !l.routeSetAside).length;
  const backlog = waiting >= settings.caps.agency * 5;
  lines.push(
    ag.length
      ? `${plural(ag.length, 'agency message')} ready.${backlog ? ` ${waiting} agencies are still waiting for you, so I didn't look for more.` : ''}`
      : settings.agencyPaused && !open('agency').length
        ? `New agency messages are paused in Settings${waiting ? `; ${waiting} waiting` : ''}.`
        : backlog
        ? `${waiting} agencies are still waiting for you, so I didn't look for more.`
        : open('agency').length
          ? `${plural(open('agency').length, 'agency message')} being written.`
          : 'No agencies to message today.'
  );
  const q = ready('customer');
  if (q.length) lines.push(`${plural(q.length, 'question')} to answer.`);
  // Last: a comment is an extra now, never the way to a creator's message.
  const c = ready('comment');
  if (c.length) lines.push(`${plural(c.length, 'optional comment')} ready.`);
  else if (open('comment').length) lines.push(`${plural(open('comment').length, 'optional comment')} being written.`);
  return lines.join(' ');
}

function runBox(state, day, settings, now, running, env) {
  const last = state.runs[0];
  const keys = keyStatus(env);
  const warn = [];
  if (!keys.anthropic) warn.push('ANTHROPIC_API_KEY is missing, so nothing can be drafted.');
  if (!keys.brave) warn.push('BRAVE_API_KEY is missing (TikTok and Instagram).');
  if (!keys.places) warn.push('GOOGLE_MAPS_KEY is missing (agencies).');
  const spend = monthSpend(state, settings, now);
  if (spend.reached) warn.push(`This month's budget is used up (${money(spend.billable)} of ${money(spend.cap)}). Nothing new is searched or drafted until next month, or until you raise it in Settings.`);
  const details = last
    ? `<details class="details"><summary>Details</summary><p class="small">Last run ${when(last.at)} (${last.trigger === 'daily' ? 'the daily run' : 'you pressed the button'}). ${plural(last.queries, 'search', 'searches')}, ${plural(last.candidates || 0, 'post')} checked. New: ${plural(last.found.creator, 'creator')}, ${plural(last.found.customer, 'question')}, ${plural(last.found.agency, 'agency', 'agencies')}${last.attached ? `, ${plural(last.attached, 'new video')} from creators we know` : ''}.${last.tooOld ? ` ${plural(last.tooOld, 'post')} older than the age limit were not looked at.` : ''}${last.igHandles ? ` ${plural(last.igHandles, 'Instagram handle')} added to the trend watcher's list (${last.igHandlesTotal} in all).` : ''}${last.stopped === 'budget' ? ' It stopped at the budget.' : ''}</p>${
        [...(last.skipped || []), ...(last.errors || [])].length ? `<ul class="issues">${[...(last.skipped || []), ...(last.errors || [])].slice(0, 8).map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''
      }</details>`
    : '<p class="small">The desk has not looked for anything yet. The daily run starts at the hour in Settings, or press the button.</p>';
  return `<section class="runbox">
  <div><p class="summary">${esc(todaySummary(state, day, settings, now))}</p>${warn.length ? `<p class="note warn">${warn.map(esc).join('<br>')}</p>` : ''}${details}</div>
  <button type="button" id="run" class="big"${running ? ' disabled data-running="1"' : ''}>${running ? 'Looking...' : 'Look for new leads'}</button>
</section>`;
}

export function todayPage({ state, settings, token, now = Date.now(), day, templates, running = false, env = process.env, loggedIn }) {
  const ctx = { templates, settings, state };
  const cols = COLUMNS.map((col) => {
    const keys = day[col] || [];
    const open = keys.filter((x) => !itemDone(state, x));
    const doneKeys = keys.filter((x) => itemDone(state, x));
    const render = (x) => (col === 'comment' ? cardComment(state, x, ctx) : col === 'customer' ? cardCustomer(state, x, ctx) : cardMessage(state, x, ctx));
    return `<section class="col" aria-label="${COLUMN_LABEL[col]}">
  <h2>${COLUMN_LABEL[col]} <span class="count">${open.length ? `${open.length} to do` : 'nothing to do'}</span></h2>
  ${open.map(render).join('') || `<p class="empty">${esc(emptyText(col, state, settings, now, day))}</p>`}
  ${col === 'agency' ? setAsideLine(state, now) : ''}
  ${doneKeys.length ? `<details class="donebox"><summary>Done today (${doneKeys.length})</summary>${doneKeys.map(render).join('')}</details>` : ''}
</section>`;
  }).join('');
  const body = `<div class="pagehead"><h1>Today</h1><span class="date">${DAY.format(new Date(now))}</span></div>
${runBox(state, day, settings, now, running, env)}
<div class="columns">${cols}</div>
${waitingPanel(state, day, settings, now)}`;
  return layout({ title: 'Today', active: 'today', token, body, state, settings, now, loggedIn });
}

/** The agencies set aside today because their route failed its check, each linked to its lead page. */
function setAsideLine(state, now) {
  const today = Object.values(state.leads).filter((l) => l.routeSetAside && ilDate(l.routeSetAside.at) === ilDate(now));
  if (!today.length) return '';
  return `<p class="small">Set aside today, their sample route failed its check after the rebuild, and the next agency took the slot: ${today.map((l) => `<a href="/lead/${encodeURIComponent(l.id)}">${heIn(displayName(l))}</a>`).join(', ')}.</p>`;
}

/**
 * The four outcomes of a message, for any lead that was messaged: replied,
 * interested, not interested (closed, never contacted again), no reply (closed).
 */
export function outcomeBar(lead) {
  return [
    button('Replied', { act: 'replied', lead: lead.id }, lead.repliedAt ? 'on' : ''),
    button('Interested', { act: 'yes', lead: lead.id }, ['yes', 'using'].includes(lead.stage) ? 'on' : ''),
    button('Not interested', { act: 'no', lead: lead.id, confirm: 'Sure? Never contacted again' }, lead.closed === 'not-interested' ? 'on' : 'quiet'),
    button('No reply', { act: 'no-reply', lead: lead.id, confirm: 'Sure? Closes, no follow-up' }, lead.closed === 'no-reply' ? 'on' : 'quiet'),
  ].join('');
}

/** Where a messaged lead stands on the follow-up, in a few words. */
function followupLine(lead, settings, now) {
  const days = settings.followupDays;
  const at = (t, n) => ilDate(Date.parse(`${ilDate(t)}T12:00:00Z`) + n * 86_400_000);
  if (lead.repliedAt) return `replied ${when(lead.repliedAt)}`;
  if (lead.followupSentAt) return `follow-up sent ${when(lead.followupSentAt)}; closes as no reply on ${at(lead.followupSentAt, days)} if they stay silent`;
  if (followupDue(lead, { now, followupDays: days })) return 'the follow-up is due today';
  return `the follow-up comes back on Today on ${at(lead.messagedAt, days)} if they don't reply`;
}

/**
 * Every lead you messaged that has no outcome yet, as a card with the four
 * outcomes. One whose follow-up is on today's list is marked there instead.
 */
function waitingPanel(state, day, settings, now) {
  const onToday = new Set([...(day.creator || []), ...(day.agency || [])].filter((k) => k.endsWith(':followup') && !itemDone(state, k)).map((k) => parseItem(k).leadId));
  const leads = awaitingOutcome(state).filter((l) => !onToday.has(l.id));
  if (!leads.length) return '';
  const card = (l) => `<article class="card waiting">
  <div class="meta">${whoLine(l)}<p class="small">${esc(l.type === 'agency' ? 'Agency' : 'Creator')} · ${esc(leadChannel(l))} · messaged ${when(l.messagedAt)}, ${plural(dayDiff(ilDate(l.messagedAt), ilDate(now)), 'day')} ago · ${esc(followupLine(l, settings, now))}</p></div>
  <div class="actions">${outcomeBar(l)}<a class="more" href="/lead/${encodeURIComponent(l.id)}">Lead page</a></div>
</article>`;
  return `<section class="panel" id="waiting"><h2>Waiting for a reply <span class="count">${leads.length}</span></h2>
<p class="small">Everyone you messaged with no outcome yet. Mark what happened; a lead still silent ${plural(settings.followupDays, 'day')} after the one follow-up closes as no reply by itself.</p>
${leads.map(card).join('')}</section>`;
}

/** What an empty column says: what happens next, not how the desk works inside. */
function emptyText(col, state, settings, now, day = {}) {
  const leads = Object.values(state.leads);
  // A column whose day is full says so: "no agencies today" read as none left.
  const cap = Number(settings.caps?.[col]) || 0;
  if ((col === 'agency' || col === 'creator') && cap && (day[col] || []).length >= cap) {
    const waiting = leads.filter((l) => l.type === col && (col === 'creator' ? dmReady(l) : !l.closed && l.stage === 'found' && !l.messagedAt && !l.routeSetAside)).length;
    const what = col === 'agency' ? 'agency message' : 'creator message';
    return `Today's ${plural(cap, what)} are done: ${cap} a day is the cap in Settings. ${waiting ? `${plural(waiting, col === 'agency' ? 'agency' : 'creator', col === 'agency' ? 'agencies' : 'creators')} still waiting; the next ${Math.min(cap, waiting)} come tomorrow, after any follow-ups that are due.` : 'Nobody else is waiting.'}`;
  }
  const next = `The next search is tomorrow at ${String(settings.runHour).padStart(2, '0')}:00, or press "Look for new leads".`;
  if (col === 'creator') return `A creator's message shows up here as soon as a search finds them. ${next}`;
  if (col === 'comment') {
    const last = state.runs[0];
    if (last?.tooOld && !last.candidates) return `Everything today's search found was older than ${settings.maxPostAgeDays} days. The next search is tomorrow at ${String(settings.runHour).padStart(2, '0')}:00.`;
    return `No TikTok or Instagram videos to comment on. YouTube creators go straight to a message. ${next}`;
  }
  if (col === 'agency' && settings.agencyPaused) {
    const waiting = leads.filter((l) => l.type === 'agency' && !l.closed && l.stage === 'found' && !l.messagedAt && !l.routeSetAside).length;
    const line = nextInLine(state, settings, now).map((l) => `${displayName(l)}: ${lineState(l).words}`);
    return `New agency messages are paused in Settings${waiting ? `; ${plural(waiting, 'agency', 'agencies')} waiting` : ''}. Follow-ups to agencies you messaged still come here.${line.length ? ` Next in line, made ready meanwhile: ${line.join(' · ')}.` : ''}`;
  }
  if (col === 'agency') return 'No agencies today. New ones are looked for in the next search.';
  return 'No questions today. New ones are looked for in the next search.';
}

/* ------------------------------------------------------------ lead */

/** Where the route stands on the site, in one line. */
function tripNote(trip) {
  if (!trip) return '';
  if (trip.status === 'published') {
    return `<p class="note">On the site since ${when(trip.publishedAt)}: <a href="${attr(trip.url)}" target="_blank" rel="noopener noreferrer"><bdi>${esc(trip.url.replace(/^https:\/\/(www\.)?/, ''))}</bdi></a> · ${plural(trip.stopCount || 0, 'stop')}${trip.indexable ? '' : ' · not in Google (fewer than 8 stops)'}${trip.withdrawError ? ` · <span class="warn">taking it down failed, trying again: ${esc(trip.withdrawError)}</span>` : ''}</p>`;
  }
  if (trip.status === 'withdrawn') return `<p class="note">Taken down from the site ${when(trip.withdrawnAt)}. The address now answers 410.</p>`;
  return `<p class="note warn">${esc(trip.reason || trip.status)}</p>`;
}

export function leadPage({ state, settings, token, now = Date.now(), lead, templates, loggedIn }) {
  const ctx = { templates, settings, state };
  const sections = [];

  const posts = (lead.posts || [])
    .map(
      (p) => `<div class="post">
  ${thumb(p, 'thumb big')}
  <div>${he(esc(p.title), 'p', 'caption full')}
  <p class="small">${esc(PLATFORM[p.platform] || p.platform)} · ${p.publishedAt ? `posted ${ago(p.publishedAt, now)}` : 'date unknown'} · <a href="${attr(p.url)}" target="_blank" rel="noopener noreferrer">open the post</a> · ${esc({ open: 'open', commented: 'you commented', skipped: 'skipped' }[p.status] || p.status)}</p>
  ${p.description ? `<details><summary>Description</summary>${he(esc(p.description), 'p', 'small')}</details>` : ''}
  ${p.topComments?.length ? `<details><summary>Top comments (${p.topComments.length})</summary><ul class="comments">${p.topComments.map((c) => `<li>${he(esc(c.text), 'span')} <span class="small">${c.likes} likes</span></li>`).join('')}</ul></details>` : ''}
  ${whyList(p.why)}
  ${p.said || p.dest ? `<p class="small">The post is about: ${heIn(p.said || 'not said')} · our page: ${heIn(p.dest?.he || 'none')}</p>` : ''}</div>
</div>`
    )
    .join('');
  if (posts || lead.why?.length) sections.push(`<section class="panel"><h2>What was found, and why</h2>${whyList(lead.why)}${lead.reason ? `<p class="small">The sorter said: ${heIn(lead.reason)}</p>` : ''}${posts}</section>`);

  const facts = [];
  if (lead.profileUrl) facts.push(['Profile', `<a href="${attr(lead.profileUrl)}" target="_blank" rel="noopener noreferrer">${esc(lead.profileUrl)}</a>`]);
  if (lead.type === 'creator') facts.push(['Message goes by', creatorWhere(lead) || 'nowhere the desk found; their channel\'s About page may show an email']);
  if (Number.isFinite(lead.followers)) facts.push(['Followers', `${k(lead.followers)}${lead.followersFrom === 'search' ? ' (from a search result)' : ''}`]);
  if (lead.dest) facts.push(['Destination', heIn(lead.dest.he)]);
  if (lead.phone) facts.push(['Phone', `<bdi>${esc(lead.phone)}</bdi>`]);
  if (lead.whatsapp) facts.push(['WhatsApp', `<bdi>${esc(lead.whatsapp)}</bdi>`]);
  if (lead.email) facts.push(['Email', `<bdi>${esc(lead.email)}</bdi>`]);
  if (lead.website) facts.push(['Website', `<a href="${attr(lead.website)}" target="_blank" rel="noopener noreferrer">${esc(lead.website)}</a>`]);
  for (const s of lead.socials || []) facts.push(['Social', `<a href="${attr(s)}" target="_blank" rel="noopener noreferrer">${esc(s)}</a>`]);
  if (lead.address) facts.push(['Address', heIn(lead.address)]);
  if (lead.mapsUrl) facts.push(['Map', `<a href="${attr(lead.mapsUrl)}" target="_blank" rel="noopener noreferrer">Google Maps</a>`]);
  if (lead.kosher) facts.push(['Audience', `keeps kosher (their site says ${heIn(lead.kosher)})`]);
  if (lead.profile?.destinations?.length) facts.push(['They sell', lead.profile.destinations.map((d) => heIn(d.name)).join(', ')]);
  if (lead.profile?.clientele?.length) facts.push(['Their clients', lead.profile.clientele.map((d) => heIn(d.label)).join(', ')]);
  facts.push(['Found', `${when(lead.foundAt)} · ${heIn(lead.searched || '')}`]);
  sections.push(`<section class="panel"><h2>Details</h2><dl class="facts">${facts.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl></section>`);

  if (lead.type === 'creator' || lead.type === 'agency') {
    const r = lead.route;
    sections.push(`<section class="panel"><h2>${lead.type === 'agency' ? 'The example' : 'The route'}</h2>${
      r || lead.example
        ? `${routeBox(lead)}${r?.matched?.length ? `<p class="small">Put first because the video names them: ${r.matched.map((m) => heIn(m.name)).join(', ')}.</p>` : ''}${r?.unmatched?.length ? `<p class="small">Not in our catalog: ${r.unmatched.map(heIn).join(', ')}.</p>` : ''}`
        : `<p class="small">${lead.type === 'agency' ? 'The example is chosen when the agency is picked for a message.' : 'The route is built when the creator is picked for the Creators column.'}</p>`
    }${tripNote(lead.trip)}</section>`);
  }

  const material = [];
  const toggle = `<div class="toggle" role="group" aria-label="How to address them">${button('She', { act: 'gender', lead: lead.id, gender: 'f' }, lead.gender === 'f' ? 'on' : '')}${button('He', { act: 'gender', lead: lead.id, gender: 'm' }, lead.gender === 'm' ? 'on' : '')}${button('Unknown', { act: 'gender', lead: lead.id, gender: 'unknown' }, lead.gender === 'unknown' || !lead.gender ? 'on' : '')}<span class="small">${lead.genderFrom === 'post' ? 'from the grammar in their post' : lead.genderFrom === 'owner' ? 'you chose' : 'not known, so the drafts use the plural'}. Changing it does not rewrite the drafts; press Redraft.</span></div>`;
  const block = (title, what, extra = {}) => {
    const target = openTarget(lead, what === 'comment' ? 'comment' : what);
    const first = compose(lead, what, { ...ctx, ...extra });
    const blocked = first.missing.filter((m) => m !== 'Not drafted yet.').length > 0 && !['followup', 'comment'].includes(what);
    const noSend = lead.type === 'agency' && what === 'message' && Boolean(routeProblem(lead));
    const canRedraft = ['comment', 'dm', 'message', 'reply'].includes(what);
    return `<div class="block">
  <h3>${title}</h3>
  ${missingNote(first.missing.filter((m) => m !== 'Not drafted yet.'))}
  ${variants({ lead, what, postId: extra.postId || null, ctx, idBase: `t-${hash(`${what}:${extra.postId || ''}`)}`, target, blocked, noSend, rows: what === 'followup' ? 2 : what === 'comment' ? 3 : 5 }) || '<p class="small">Not drafted yet.</p>'}
  ${canRedraft ? `<div class="actions">${button('Redraft', { redraft: what, lead: lead.id, post: extra.postId || null })}</div>` : ''}
</div>`;
  };
  if (lead.type === 'creator') {
    const p = openPost(lead, { now, maxAgeDays: settings.maxPostAgeDays });
    // No comment for a YouTube creator: their message goes first (the owner, 2026-10-14).
    if (p && !lead.warmedAt && lead.source !== 'youtube') material.push(block('Comment on the video (optional)', 'comment', { postId: p.id }));
    material.push(block('First message', 'dm'));
    if (lead.messagedAt) material.push(block('The one follow-up', 'followup'));
  } else if (lead.type === 'agency') {
    material.push(block('First message', 'message'));
    if (lead.messagedAt) material.push(block('The one follow-up', 'followup'));
  } else {
    material.push(block('Reply to their question', 'reply'));
  }
  if (lead.draftError) material.push(`<p class="note warn">Couldn't draft: ${esc(lead.draftError)}</p>`);
  // Agencies are addressed in the plural, so the toggle has nothing to switch.
  sections.push(`<section class="panel"><h2>Ready to send</h2>${lead.type === 'agency' ? '' : toggle}${material.join('')}</section>`);

  const acts = [];
  if (lead.type === 'creator' && !lead.warmedAt && lead.source !== 'youtube') {
    const p = openPost(lead, { now, maxAgeDays: settings.maxPostAgeDays });
    if (p) acts.push(button('Commented', { act: 'commented', lead: lead.id, post: p.id }, 'primary'), button('Followed', { act: 'followed', lead: lead.id, post: p.id }, lead.followedAt ? 'on' : ''), button('Skip this video', { act: 'skip-post', lead: lead.id, post: p.id }));
  }
  if (lead.type !== 'customer') {
    if (!lead.messagedAt) {
      const first = lead.type === 'agency' ? 'message' : 'dm';
      const missing = compose(lead, first, ctx).missing.length > 0;
      if (!(lead.type === 'agency' && routeProblem(lead))) acts.push(button('Sent', { act: 'sent', lead: lead.id, disabled: missing, title: missing ? 'The message is not ready yet' : null }));
    } else if (followupDue(lead, { now, followupDays: settings.followupDays })) {
      acts.push(button('Follow-up sent', { act: 'sent', lead: lead.id }, 'primary'));
    } else {
      acts.push(button('Sent', { act: 'sent', lead: lead.id, disabled: true, title: lead.followupSentAt ? 'They had the message and the follow-up. That is all.' : 'The follow-up is not due yet' }));
    }
  } else {
    acts.push(button('Replied', { act: 'commented', lead: lead.id }, 'primary'));
  }
  acts.push(
    ...(lead.messagedAt
      ? [outcomeBar(lead)]
      : [
          button('Skip', { act: 'skip', lead: lead.id }),
          button('They replied', { act: 'replied', lead: lead.id }, lead.repliedAt ? 'on' : ''),
          button('Interested', { act: 'yes', lead: lead.id }, lead.stage === 'yes' ? 'on' : ''),
          button('Not for us', { act: 'no', lead: lead.id, confirm: 'Sure? They are never contacted again' }, 'quiet'),
        ]),
    button('Using the site', { act: 'using', lead: lead.id }, lead.stage === 'using' ? 'on' : '')
  );
  const yesNote =
    lead.stage === 'yes' && lead.type !== 'customer'
      ? `<p class="note">Their gift: ${heIn(lead.type === 'agency' ? settings.offers.agency : settings.offers.creator)}. Given by hand from the site's admin page, by their email.</p>`
      : '';
  const status = [
    `Stage: <b>${STAGE_LABEL[lead.stage] || lead.stage}</b>`,
    lead.closed ? `closed (${esc({ skipped: 'skipped', irrelevant: 'not for us', 'not-interested': 'not interested', 'no-reply': 'no reply', done: 'done' }[lead.closed] || lead.closed)})` : '',
    lead.messagedAt ? `messaged ${when(lead.messagedAt)}` : '',
    followupDue(lead, { now, followupDays: settings.followupDays }) ? '<b>the follow-up is due today</b>' : '',
    lead.followupSentAt ? `follow-up sent ${when(lead.followupSentAt)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  sections.push(`<section class="panel"><h2>What happened</h2><p>${status}</p><div class="actions wrap">${acts.join('')}</div>${yesNote}</section>`);

  const sent = (state.sentLog || []).filter((r) => r.leadId === lead.id);
  if (sent.length) {
    sections.push(`<section class="panel"><h2>What you sent them</h2>${sent
      .map((r) => `<div class="block"><p class="small">${when(r.at)} · ${esc(r.kind)}${r.edited ? ' · you changed the draft' : ''}</p>${he(esc(r.sent), 'p')}</div>`)
      .join('')}</section>`);
  }

  sections.push(`<section class="panel"><h2>History</h2><ul class="history">${(lead.history || [])
    .slice()
    .reverse()
    .map((h) => `<li>${when(h.at)} · ${esc(h.what)}</li>`)
    .join('')}</ul></section>`);

  const body = `<div class="pagehead"><h1>${heIn(displayName(lead))}</h1><span class="tag">${esc(TYPE_LABEL[lead.type])}</span><span class="tag">${esc(STAGE_LABEL[lead.stage])}</span><span class="small">score ${lead.score || 0}</span></div>
<div class="leadgrid">${sections.join('')}</div>`;
  return layout({ title: displayName(lead), active: 'leads', token, body, state, settings, now, loggedIn });
}

/* ------------------------------------------------------------ leads table */

export function leadsPage({ state, settings, token, now = Date.now(), query = {}, loggedIn }) {
  const f = { type: query.type || '', stage: query.stage || '', source: query.source || '', from: query.from || '', to: query.to || '' };
  let rows = Object.values(state.leads);
  if (f.type) rows = rows.filter((l) => l.type === f.type);
  if (f.stage) rows = rows.filter((l) => l.stage === f.stage);
  if (f.source) rows = rows.filter((l) => l.source === f.source);
  if (f.from) rows = rows.filter((l) => ilDate(l.foundAt) >= f.from);
  if (f.to) rows = rows.filter((l) => ilDate(l.foundAt) <= f.to);
  rows.sort((a, b) => String(b.foundAt).localeCompare(String(a.foundAt)));
  const total = rows.length;
  rows = rows.slice(0, 500);
  const sel = (name, opts) =>
    `<select name="${name}"><option value="">All</option>${opts.map(([v, l]) => `<option value="${attr(v)}"${f[name] === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const form = `<form class="filters" method="get" action="/leads">
  <label>Type ${sel('type', Object.entries(TYPE_LABEL))}</label>
  <label>Stage ${sel('stage', STAGES.map((s) => [s, STAGE_LABEL[s]]))}</label>
  <label>Source ${sel('source', Object.entries(PLATFORM))}</label>
  <label>From <input type="date" name="from" value="${attr(f.from)}"></label>
  <label>To <input type="date" name="to" value="${attr(f.to)}"></label>
  <button type="submit">Filter</button><a href="/leads">Clear</a>
</form>`;
  const table = `<table class="table"><thead><tr><th>Name</th><th>Type</th><th>Source</th><th>Stage</th><th>Destination</th><th>Score</th><th>Found</th><th>Found by</th></tr></thead><tbody>${rows
    .map(
      (l) => `<tr${l.closed ? ' class="closed"' : ''}><td><a href="/lead/${encodeURIComponent(l.id)}">${heIn(displayName(l))}</a></td><td>${esc(TYPE_LABEL[l.type])}</td><td>${esc(PLATFORM[l.source] || l.source)}</td><td>${esc(STAGE_LABEL[l.stage])}${l.closed ? ' (closed)' : ''}</td><td>${heIn(l.dest?.he || '')}</td><td>${l.score || 0}</td><td>${esc(ilDate(l.foundAt))}</td><td class="small">${heIn(l.hashtag || l.searched || '')}</td></tr>`
    )
    .join('')}</tbody></table>`;
  const body = `<div class="pagehead"><h1>All leads</h1><span class="small">${plural(total, 'lead')}${total > 500 ? ', showing 500' : ''}</span></div>${form}${total ? table : '<p class="empty">No leads match these filters. Clear them to see everything.</p>'}`;
  return layout({ title: 'All leads', active: 'leads', token, body, state, settings, now, loggedIn });
}

/* ------------------------------------------------------------ reports */

/** "Your edits this week": what the owner usually changes in the drafts. */
function editsPanel(state, now) {
  const w = weeklyEdits(state, now);
  if (!w.total) return '<section class="panel"><h2>Your edits this week</h2><p class="small">Nothing sent yet this week. Once you mark texts as sent, this shows what you usually change, and the drafts learn from it.</p></section>';
  const picks = Object.entries(w.variants).sort((a, b) => b[1] - a[1]).map(([i, n]) => `option ${Number(i) + 1} ${n}×`).join(', ');
  const phrases = (list) => (list.length ? list.map((p) => `${heIn(p.phrase)} <span class="small">(${p.count}×)</span>`).join(', ') : '<span class="small">nothing yet</span>');
  return `<section class="panel"><h2>Your edits this week</h2>
<p>You sent ${plural(w.total, 'text')} and changed ${w.edited} of them.${w.edited ? ` On average you made them ${Math.abs(w.avgLengthChange)} characters ${w.avgLengthChange <= 0 ? 'shorter' : 'longer'}.` : ''}${picks ? ` You picked ${picks}.` : ''}</p>
<p>You usually cut: ${phrases(w.removed)}</p>
<p>You usually add: ${phrases(w.added)}</p>
${w.pairs.length ? `<details><summary>The last ${w.pairs.length} you changed</summary>${w.pairs.map((p) => `<div class="block"><p class="small">${esc(p.kind)}: the draft</p>${he(esc(p.draft), 'p')}<p class="small">what you sent</p>${he(esc(p.sent), 'p')}</div>`).join('')}</details>` : ''}
</section>`;
}

/** Runs by hand (a route report) whose spend the desk folded into this month's ledger. */
function manualRuns(state, now) {
  const month = ilDate(now).slice(0, 7);
  const runs = (state.ledgerRuns || []).filter((r) => ilDate(r.at).slice(0, 7) === month);
  if (!runs.length) return '';
  return `<p class="small">Included above: ${plural(runs.length, 'run by hand')}, ${runs.map((r) => `${esc(r.source)} on ${esc(ilDate(r.at))}, ${money(r.usd)} list price${r.note ? ` (${esc(r.note)})` : ''}`).join('; ')}.</p>`;
}

export function reportsPage({ state, settings, token, now = Date.now(), ga4, loggedIn }) {
  const leads = Object.values(state.leads);
  const spend = monthSpend(state, settings, now);
  const counts = stageCounts(leads);
  const wow = weekOverWeek(leads, now);
  const types = ['creator', 'agency', 'customer'];
  const LABEL = { found: 'Found', commented: 'Commented', messaged: 'Messaged', replied: 'Replied', yes: 'Interested', using: 'Using' };

  const budget = `<section class="panel" id="budget"><h2>This month's budget</h2>
<p>Billed so far: <b>${money(spend.billable)}</b> of <b>${money(spend.cap)}</b>${spend.reached ? ' · <b class="warn">used up, searching and drafting have stopped</b>' : ` · ${money(spend.left)} left`}. List price before the free allowances: ${money(spend.gross)}.</p>
<table class="table"><thead><tr><th>Service</th><th>Calls</th><th>List price</th><th>Billed</th></tr></thead><tbody>${
    Object.entries(spend.rows)
      .map(([api, r]) => `<tr><td>${esc(API_PRICES[api]?.label || api)}</td><td>${r.units}</td><td>${money(r.gross)}</td><td>${money(r.billable)}</td></tr>`)
      .join('') || '<tr><td colspan="4">Nothing spent yet this month.</td></tr>'
  }</tbody></table>${manualRuns(state, now)}</section>`;

  const channels = byChannel(leads);
  const perChannel = `<section class="panel" id="channels"><h2>Messages by channel</h2>${
    channels.length
      ? `<table class="table"><thead><tr><th>Channel</th><th>Who</th><th>Messaged</th><th>Replied</th><th>Interested</th><th>No reply</th></tr></thead><tbody>${channels
          .map((r) => `<tr><td>${esc(r.channel)}</td><td class="small">${esc(r.types.map((t) => (t === 'agency' ? 'agencies' : 'creators')).join(', '))}</td><td>${r.messaged}</td><td>${r.replied}${r.messaged ? ` <span class="small">(${Math.round((100 * r.replied) / r.messaged)}%)</span>` : ''}</td><td>${r.yes}</td><td>${r.noReply}</td></tr>`)
          .join('')}</tbody></table><p class="small">The channel is where the card opened the message: WhatsApp or email for an agency, the platform for a creator.</p>`
      : '<p class="small">Nobody messaged yet.</p>'
  }</section>`;

  const perType = types
    .map((t) => {
      const fn = funnel(leads, t);
      const steps = t === 'agency' ? ['found', 'messaged', 'replied', 'yes', 'using'] : t === 'customer' ? ['found', 'commented'] : ['found', 'commented', 'messaged', 'replied', 'yes', 'using'];
      const w = wow[t];
      const searches = bySearch(leads, t).slice(0, 12);
      return `<section class="panel"><h2>${TYPE_LABEL[t]}</h2>
<div class="funnel">${steps.map((s) => `<div><b>${fn[s]}</b><span>${LABEL[s]}</span></div>`).join('')}</div>
<p class="small">Where they are now: ${STAGES.filter((s) => counts[t][s]).map((s) => `${STAGE_LABEL[s]} ${counts[t][s]}`).join(' · ') || 'none yet'}</p>
<details><summary>This week against last week</summary>
<table class="table"><thead><tr><th></th><th>Found</th><th>Commented</th><th>Messaged</th><th>Replied</th><th>Interested</th></tr></thead><tbody>
<tr><td>This week</td><td>${w.thisWeek.found}</td><td>${w.thisWeek.commented}</td><td>${w.thisWeek.messaged}</td><td>${w.thisWeek.replied}</td><td>${w.thisWeek.yes}</td></tr>
<tr><td>Last week</td><td>${w.lastWeek.found}</td><td>${w.lastWeek.commented}</td><td>${w.lastWeek.messaged}</td><td>${w.lastWeek.replied}</td><td>${w.lastWeek.yes}</td></tr>
</tbody></table></details>
<details><summary>Which searches brought leads that went somewhere</summary>${
        searches.length
          ? `<table class="table"><thead><tr><th>Search</th><th>Found</th><th>Contacted</th><th>Replied</th><th>Interested</th></tr></thead><tbody>${searches
              .map((r) => `<tr><td>${heIn(r.search)}${r.kind === 'hashtag' ? ' <span class="tag">hashtag</span>' : ''}</td><td>${r.found}</td><td>${r.messaged}</td><td>${r.replied}</td><td>${r.yes}</td></tr>`)
              .join('')}</tbody></table>`
          : '<p class="small">None yet.</p>'
      }</details></section>`;
    })
    .join('');

  let ga = '';
  if (!ga4?.configured) {
    ga = `<section class="panel"><h2>Visits from our links</h2><p>GA4 is not connected yet. What it needs:</p><ul>${(ga4?.missing || []).map((m) => `<li>${esc(m)}</li>`).join('')}</ul><p class="small">Messages now carry plain links without tags (WhatsApp shows a tagged link in full), so until the site makes short links, visits from them show here as untagged.</p></section>`;
  } else {
    const byCampaign = new Map();
    for (const r of ga4.rows || []) {
      const key = `${r.source}|${r.campaign}`;
      const row = byCampaign.get(key) || { source: r.source, campaign: r.campaign, thisWeek: 0, lastWeek: 0 };
      row[r.range === 'lastWeek' ? 'lastWeek' : 'thisWeek'] += r.sessions;
      byCampaign.set(key, row);
    }
    const nameFor = (campaign) => leads.find((l) => String(l.handle || '').toLowerCase() === campaign)?.name || '';
    ga = `<section class="panel"><h2>Visits from our links (GA4)</h2>${ga4.error ? `<p class="note warn">${esc(ga4.error)}</p>` : ''}
<table class="table"><thead><tr><th>Source</th><th>Campaign</th><th>Who</th><th>This week</th><th>Last week</th></tr></thead><tbody>${
      [...byCampaign.values()]
        .sort((a, b) => b.thisWeek - a.thisWeek)
        .map((r) => `<tr><td>${esc(TYPE_LABEL[r.source] || r.source)}</td><td>${esc(r.campaign)}</td><td>${heIn(nameFor(r.campaign))}</td><td>${r.thisWeek}</td><td>${r.lastWeek}</td></tr>`)
        .join('') || '<tr><td colspan="5">No visits with our tags yet.</td></tr>'
    }</tbody></table><p class="small">Only visitors who accepted cookies are counted; consent is off by default on the site.</p></section>`;
  }

  const body = `<div class="pagehead"><h1>Reports</h1></div><div class="reports">${budget}${perChannel}${editsPanel(state, now)}${ga}${perType}</div>`;
  return layout({ title: 'Reports', active: 'reports', token, body, state, settings, now, loggedIn });
}

/* ------------------------------------------------------------ settings */

export function settingsPage({ state, settings, token, now = Date.now(), templates, loggedIn }) {
  const num = (name, label, value, step = 1, hint = '') =>
    `<label class="field"><span>${label}</span><input type="number" name="${name}" value="${attr(value)}" step="${step}" min="0">${hint ? `<small>${hint}</small>` : ''}</label>`;
  const txt = (name, label, value) => `<label class="field"><span>${label}</span><input type="text" name="${name}" value="${attr(value)}"></label>`;
  const lines = (name, label, list, hint = '') =>
    `<label class="field wide"><span>${label}</span><textarea name="${name}" rows="${Math.min(10, Math.max(3, list.length + 1))}" data-lines="1" dir="auto">${esc(list.join('\n'))}</textarea>${hint ? `<small>${hint}</small>` : ''}</label>`;
  const check = (name, label, on) => `<label class="field check"><input type="checkbox" name="${name}"${on ? ' checked' : ''}><span>${label}</span></label>`;

  const form = `<form id="settings" class="settings">
<fieldset><legend>A day's work</legend>
${num('caps.comment', 'Comments', settings.caps.comment)}${num('caps.creator', 'Creator messages', settings.caps.creator)}${num('caps.agency', 'Agency messages', settings.caps.agency)}${num('caps.customer', 'Questions', settings.caps.customer)}
${check('agencyPaused', 'Pause new agency messages (follow-ups to agencies you messaged still come)', settings.agencyPaused)}
${num('publishPerDay', 'New route pages a day', settings.publishPerDay, 1, 'Creators and agencies together. The site takes 20 a day.')}
</fieldset>
<fieldset><legend>Budget and timing</legend>
${num('budgetUsd', 'Monthly budget ($)', settings.budgetUsd, 1, 'Searching and drafting stop when it is reached.')}
${num('braveCreditUsd', 'Brave\'s monthly credit ($)', settings.braveCreditUsd, 1, '0 if the account does not get it.')}
${num('runHour', 'Daily search hour', settings.runHour, 1, 'Israel time.')}
${num('followupDays', 'Days before the follow-up', settings.followupDays)}
</fieldset>
<fieldset><legend>The gifts</legend>
${txt('offers.creator', 'For creators', settings.offers.creator)}${txt('offers.agency', 'For agencies', settings.offers.agency)}
</fieldset>
<fieldset><legend>Who counts</legend>
${num('followers.min', 'Fewest followers', settings.followers.min, 100)}${num('followers.max', 'Most followers', settings.followers.max, 1000)}
${num('maxPostAgeDays', 'Oldest video (days)', settings.maxPostAgeDays)}${num('maxCustomerAgeDays', 'Oldest question (days)', settings.maxCustomerAgeDays)}
${lines('skipCountries', 'Countries we do not look in', settings.skipCountries, 'The site plans trips abroad, so Israel is here by default.')}
</fieldset>
<fieldset><legend>Searching</legend>
${num('destinationsPerDay', 'Destinations a day (TikTok and Instagram)', settings.destinationsPerDay, 1, 'From destinations.json, in turn.')}
${num('youtubeDestinationsPerDay', 'Destinations a day on YouTube', settings.youtubeDestinationsPerDay, 1, 'Five searches each, out of 100 free a day.')}
${num('hashtagsPerDay', 'Hashtags a day', settings.hashtagsPerDay)}
${check('instagram', 'Search Instagram too (through Brave)', settings.instagram)}
${check('youtube', 'Search YouTube Shorts too', settings.youtube)}
${lines('tiktokQueries', 'TikTok searches', settings.tiktokQueries, '{dest} becomes the destination\'s name.')}
${lines('instagramQueries', 'Instagram searches', settings.instagramQueries)}
${lines('hashtags', 'Hashtags', settings.hashtags)}
${lines('agencyQueries', 'Agency searches', settings.agencyQueries)}
${lines('agencyCities', 'Cities to find agencies in', settings.agencyCities)}
</fieldset>
<fieldset><legend>Models</legend>
${txt('models.draft', 'Drafting', settings.models.draft)}${txt('models.review', 'The bot-score review', settings.models.review)}${txt('models.extract', 'Reading agency sites', settings.models.extract)}${txt('models.sort', 'Sorting what was found', settings.models.sort)}
${txt('effort', 'Effort (low, medium, high)', settings.effort)}
</fieldset>
<div class="actions"><button type="submit" class="primary">Save settings</button><button type="button" data-reset-settings="1" class="quiet">Back to the defaults</button></div>
</form>`;

  const sample = { dest: 'אתונה', link: 'https://tiyulplus.com/itinerary/athens/5' };
  const tpl = TEMPLATE_NAMES.map(
    (n) => `<div class="tpl">
  <h3>${esc(TEMPLATE_LABELS[n])} <code>${n}.txt</code></h3>
  ${he(`<textarea id="tpl-${n}" rows="3">${esc(templates[n])}</textarea>`)}
  <div class="actions">${button('Save', { 'save-template': n })}</div>
  <details><summary>Preview</summary>${he(esc(fill(templates[n], sample)), 'p', 'preview')}</details>
</div>`
  ).join('');

  const banned = [...CONNECTIVES, ...FORMAL, ...PRAISE, ...FAKE_EXPERIENCE].map((t) => t.p);
  const voice = `<section class="panel"><h2>How the drafts are written</h2>
<p class="small">Fixed in the code, so the tests cover it. To change it, ask for a code change.</p>
<ul class="small"><li>As Netanel, first person singular, the way he talks on WhatsApp. Short sentences, one idea each.</li><li>One emoji at most, no exclamation marks, no colons or lists of three.</li><li>One specific thing about the person or their video in every draft, quoted from their own words.</li><li>Comments: about ${LIMITS.comment.target} characters, ${LIMITS.comment.sentences} sentences. Replies to questions: about ${LIMITS.reply.target}, ${LIMITS.reply.sentences} sentences. First messages: about ${LIMITS.message.target}, one link.</li><li>The gender only when it is known; otherwise the plural.</li><li>Every draft is scored by a second reader for how much it sounds like a bot, and rewritten at 4 or more.</li></ul>
<p class="small">What the drafts may say the site does:</p><ul class="small">${SITE_FACTS.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
<details><summary>Phrases that are refused (${banned.length})</summary>${he(esc(banned.join(' · ')), 'p', 'small')}</details>
</section>`;

  const body = `<div class="pagehead"><h1>Settings</h1></div><div class="settingsgrid"><section class="panel">${form}</section><div>${voice}<section class="panel"><h2>Follow-ups and the link line</h2><p class="small">Fields: <code>[יעד]</code> the destination, <code>[קישור]</code> the link. No gendered forms (most people's gender is not known), no web addresses, no long dash.</p>${tpl}</section></div></div>`;
  return layout({ title: 'Settings', active: 'settings', token, body, state, settings, now, loggedIn });
}

/* ------------------------------------------------------------ login, misc */

export function loginPage({ error = '' } = {}) {
  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Log in · Growth desk</title>
<link rel="stylesheet" href="/static/style.css">
</head>
<body class="loginpage">
<form class="login panel" method="post" action="/login">
  <h1>Growth desk</h1>
  <label class="field"><span>Password</span><input type="password" name="password" autocomplete="current-password" autofocus required></label>
  ${error ? `<p class="note warn">${esc(error)}</p>` : ''}
  <button type="submit" class="primary">Log in</button>
</form>
</body>
</html>`;
}

export function notFoundPage({ state, settings, token, now = Date.now(), loggedIn }) {
  return layout({ title: 'Not found', active: '', token, body: '<div class="pagehead"><h1>Not found</h1></div><p>That page is not here. <a href="/">Back to Today</a></p>', state, settings, now, loggedIn });
}

function hash(s) {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h.toString(36);
}
