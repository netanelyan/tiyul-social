import { keyStatus, TEMPLATE_LABELS, TEMPLATE_NAMES } from '../config.js';
import { API_PRICES, monthSpend } from '../budget.js';
import { openTarget } from '../links.js';
import { compose } from '../prepare/compose.js';
import { fill } from '../prepare/templates.js';
import { bySearch, funnel, stageCounts, weekOverWeek } from '../report/stats.js';
import { COLUMN_HE, COLUMNS, dmReady, followupDue, ilDate, itemDone, openPost, parseItem, STAGE_HE, STAGES, TYPE_HE } from '../rules.js';

// Every page, as a function from state to HTML. Server-rendered, Hebrew, RTL.
//
// No framework: five pages of lists and buttons do not need one, and a page
// that is a string can be tested by reading it. Every value that came from
// outside (a caption, a name, a draft) goes through esc(); the selftest renders
// a caption with a script tag in it and checks it comes out as text.

export const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const attr = esc;
const PLATFORM_HE = { tiktok: 'טיקטוק', instagram: 'אינסטגרם', youtube: 'יוטיוב', places: 'גוגל מפות' };
const WHEN = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'long' });
const when = (t) => (t ? WHEN.format(new Date(t)) : '');
const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : String(n));
const ago = (t, now) => {
  const d = Math.floor((now - Date.parse(t)) / 86_400_000);
  if (!Number.isFinite(d)) return '';
  return d <= 0 ? 'היום' : d === 1 ? 'אתמול' : `לפני ${d} ימים`;
};

/* ------------------------------------------------------------ layout */

function layout({ title, active, token, body, state, settings, now }) {
  const spend = monthSpend(state, settings, now);
  const pct = spend.cap ? Math.min(100, Math.round((spend.billable / spend.cap) * 100)) : 100;
  const nav = [
    ['/', 'היום', 'today'],
    ['/leads', 'כל הלידים', 'leads'],
    ['/reports', 'דוחות', 'reports'],
    ['/settings', 'הגדרות', 'settings'],
  ]
    .map(([href, label, key]) => `<a href="${href}"${key === active ? ' class="on" aria-current="page"' : ''}>${label}</a>`)
    .join('');
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="growth-token" content="${attr(token)}">
<title>${esc(title)} · דסק צמיחה</title>
<link rel="stylesheet" href="/static/style.css">
</head>
<body>
<header class="top">
  <a class="brand" href="/">דסק צמיחה <span>טיול+</span></a>
  <nav>${nav}</nav>
  <a class="budget${spend.reached ? ' over' : ''}" href="/reports#budget" title="חיוב החודש אחרי המכסות החינמיות">
    <span>תקציב החודש</span>
    <b>${money(spend.billable)} / ${money(spend.cap)}</b>
    <i style="width:${pct}%"></i>
  </a>
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
    : `<a class="${cls} none" href="${attr(post?.url || '#')}" target="_blank" rel="noopener noreferrer">פתח</a>`;

const whyList = (why = []) => (why.length ? `<ul class="why">${why.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : '');

/** What to call a lead on screen. An Instagram post found by search may have no handle at all. */
export const displayName = (lead) =>
  lead.name || (lead.handle ? `@${lead.handle}` : lead.source === 'instagram' ? 'פוסט באינסטגרם (השם בפוסט)' : lead.id);

function whoLine(lead) {
  const bits = [];
  bits.push(`<a class="name" href="/lead/${encodeURIComponent(lead.id)}">${esc(displayName(lead))}</a>`);
  if (lead.handle && lead.name) bits.push(`<span class="handle">@${esc(lead.handle)}</span>`);
  bits.push(`<span class="src">${esc(PLATFORM_HE[lead.source] || lead.source)}</span>`);
  if (Number.isFinite(lead.followers)) bits.push(`<span>${k(lead.followers)} עוקבים</span>`);
  if (lead.dest?.he) bits.push(`<span class="dest">${esc(lead.dest.he)}</span>`);
  return `<div class="who">${bits.join('')}</div>`;
}

const textBox = (id, text, { rows = 5 } = {}) => `<textarea id="${attr(id)}" class="draft-text" rows="${rows}" readonly>${esc(text)}</textarea>`;

const missingNote = (missing) => (missing?.length ? `<p class="note warn">${missing.map(esc).join('<br>')}</p>` : '');

/* ------------------------------------------------------------ today */

function cardComment(state, key, ctx) {
  const { leadId, what: postId } = parseItem(key);
  const lead = state.leads[leadId];
  const post = lead?.posts.find((p) => p.id === postId);
  if (!lead || !post) return '';
  const done = itemDone(state, key);
  const id = `c-${hash(key)}`;
  const comments = [0, 1].map((i) => ({ i, ...compose(lead, 'comment', { ...ctx, i, postId }) }));
  return `<article class="card${done ? ' done' : ''}" id="${id}">
  <div class="row">${thumb(post)}<div class="meta">${whoLine(lead)}<p class="caption">${esc(post.title)}</p></div></div>
  ${whyList(post.why)}
  ${post.draftError ? `<p class="note warn">הניסוח נכשל: ${esc(post.draftError)}</p>` : ''}
  ${comments
    .map((c) =>
      c.text
        ? `<div class="suggest">${textBox(`${id}-t${c.i}`, c.text, { rows: 3 })}<div class="mini">${button('העתק תגובה', { copy: `#${id}-t${c.i}` })}${c.edited ? '<span class="tag">נערך</span>' : ''}</div></div>`
        : ''
    )
    .join('')}
  ${comments.every((c) => !c.text) && !post.draftError ? '<p class="note">התגובות יוכנו בהרצה הבאה</p>' : ''}
  <div class="actions">${
    done
      ? `<span class="tag ok">${post.status === 'commented' ? 'הגבת' : post.status === 'skipped' ? 'דילגת על הסרטון' : lead.closed ? 'סגור' : 'בוצע'}</span>`
      : [
          button('הגבתי', { act: 'commented', lead: lead.id, post: post.id }, 'primary'),
          button('עקבתי', { act: 'followed', lead: lead.id, post: post.id }, lead.followedAt ? 'on' : ''),
          button('דלג', { act: 'skip-post', lead: lead.id, post: post.id }),
          button('לא רלוונטי', { act: 'irrelevant', lead: lead.id, confirm: 'בטוח? היוצר/ת לא יחזרו לעולם' }, 'quiet'),
        ].join('')
  }<a class="more" href="/lead/${encodeURIComponent(lead.id)}">לעמוד הליד</a></div>
</article>`;
}

function cardMessage(state, key, ctx) {
  const { col, leadId, what } = parseItem(key);
  const lead = state.leads[leadId];
  if (!lead) return '';
  const done = itemDone(state, key);
  const id = `m-${hash(key)}`;
  const c = compose(lead, what, ctx);
  const target = openTarget(lead, what);
  const blocked = c.missing.length > 0 && what !== 'followup';
  const label = what === 'followup' ? 'תזכורת (פעם אחת בלבד)' : col === 'agency' ? 'הודעה לסוכנות' : 'הודעה ליוצר/ת';
  const route = lead.route
    ? `<p class="route">${lead.route.days.length} ימים ב${esc(lead.route.cityName)}, ${lead.route.stops} מקומות${lead.route.matched.length ? `, ${lead.route.matched.length} שהזכירו ראשונים` : ''}${lead.trip?.status === 'published' ? ` · <a href="${attr(lead.trip.url)}" target="_blank" rel="noopener noreferrer">המסלול באתר</a>` : ''}</p>`
    : '';
  const agency =
    col === 'agency'
      ? `<p class="route">${lead.kosher ? '<span class="tag kosher">כשרות</span>' : ''}${esc(lead.address || '')}</p><p class="contact">${contactLine(lead)}</p>`
      : '';
  return `<article class="card${done ? ' done' : ''}" id="${id}">
  <div class="row">${col === 'creator' ? thumb(lead.posts.find((p) => p.status === 'commented') || lead.posts[0]) : ''}<div class="meta">${whoLine(lead)}${route}${agency}</div></div>
  <p class="label">${label}</p>
  ${textBox(`${id}-t`, c.text, { rows: what === 'followup' ? 2 : 6 })}
  ${done ? '' : missingNote(c.missing)}
  ${lead.draftError ? `<p class="note warn">${esc(lead.draftError)}</p>` : ''}
  <div class="actions">${
    done
      ? `<span class="tag ok">${lead.closed ? 'סגור' : what === 'followup' ? 'התזכורת נשלחה' : 'נשלח'}</span>`
      : [
          button('העתק ופתח', { 'copy-open': `#${id}-t`, href: target, disabled: blocked || !target ? 'disabled' : null }, 'primary'),
          button('נשלח', { act: 'sent', lead: lead.id, disabled: blocked ? 'disabled' : null }),
          what === 'followup' ? button('ענו', { act: 'replied', lead: lead.id }) : button('דלג', { act: 'skip', lead: lead.id }),
        ].join('')
  }<a class="more" href="/lead/${encodeURIComponent(lead.id)}">לעמוד הליד</a></div>
</article>`;
}

function cardCustomer(state, key, ctx) {
  const { leadId } = parseItem(key);
  const lead = state.leads[leadId];
  if (!lead) return '';
  const post = lead.posts[0];
  const done = itemDone(state, key);
  const id = `u-${hash(key)}`;
  const c = compose(lead, 'reply', ctx);
  return `<article class="card${done ? ' done' : ''}" id="${id}">
  <div class="row">${thumb(post)}<div class="meta">${whoLine(lead)}<p class="caption">${esc(post?.title)}</p></div></div>
  ${whyList(post?.why)}
  ${c.text ? textBox(`${id}-t`, c.text, { rows: 5 }) : ''}
  ${done ? '' : missingNote(c.missing)}
  ${lead.draftError ? `<p class="note warn">${esc(lead.draftError)}</p>` : ''}
  <div class="actions">${
    done
      ? `<span class="tag ok">${lead.stage === 'commented' ? 'הגבת' : 'סגור'}</span>`
      : [
          button('העתק ופתח', { 'copy-open': `#${id}-t`, href: post?.url, disabled: c.text ? null : 'disabled' }, 'primary'),
          button('הגבתי', { act: 'commented', lead: lead.id }),
          button('דלג', { act: 'skip', lead: lead.id }),
        ].join('')
  }<a class="more" href="/lead/${encodeURIComponent(lead.id)}">לעמוד הליד</a></div>
</article>`;
}

// Each piece in its own <bdi>: a phone number, an email and a domain are
// left-to-right runs, and side by side in a right-to-left line the browser
// reorders them around the separators.
function contactLine(lead) {
  const bits = [];
  if (lead.whatsapp) bits.push(`וואטסאפ <bdi>${esc(lead.whatsapp)}</bdi>`);
  else if (lead.phone) bits.push(`<bdi>${esc(lead.phone)}</bdi>`);
  if (lead.email) bits.push(`<bdi>${esc(lead.email)}</bdi>`);
  if (lead.website) bits.push(`<bdi>${esc(String(lead.website).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</bdi>`);
  return bits.join(' · ');
}

function runBox(state, running, env) {
  const last = state.runs[0];
  const keys = keyStatus(env);
  const warn = [];
  if (!keys.anthropic) warn.push('ANTHROPIC_API_KEY חסר');
  if (!keys.brave) warn.push('BRAVE_API_KEY חסר (טיקטוק ואינסטגרם)');
  if (!keys.places) warn.push('GOOGLE_MAPS_KEY חסר (סוכנויות)');
  const summary = last
    ? `<p>הרצה אחרונה: ${when(last.at)} (${last.trigger === 'daily' ? 'יומית' : 'ידנית'}). ${last.queries} חיפושים, ${last.candidates || 0} פוסטים נבדקו. חדשים: ${last.found.creator} יוצרים, ${last.found.customer} לקוחות, ${last.found.agency} סוכנויות${last.attached ? `, ${last.attached} סרטונים חדשים ליוצרים מוכרים` : ''}.${last.tooOld ? ` ${last.tooOld} פוסטים ישנים מהמגבלה דולגו בלי לבדוק אותם.` : ''}${last.stopped === 'budget' ? ' <b>נעצרה: התקציב נוצל.</b>' : ''}</p>${
        [...(last.skipped || []), ...(last.errors || [])].length ? `<ul class="issues">${[...last.skipped, ...last.errors].slice(0, 6).map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''
      }`
    : '<p>עוד לא הייתה הרצה.</p>';
  return `<section class="runbox">
  <div>${summary}${warn.length ? `<p class="note warn">${warn.map(esc).join(' · ')}</p>` : ''}</div>
  <button type="button" id="run" class="primary big"${running ? ' disabled data-running="1"' : ''}>${running ? 'מחפש...' : 'מצא לידים חדשים'}</button>
</section>`;
}

export function todayPage({ state, settings, token, now = Date.now(), day, templates, running = false, env = process.env }) {
  const ctx = { templates, settings, state };
  const cols = COLUMNS.map((col) => {
    const keys = day[col] || [];
    const open = keys.filter((x) => !itemDone(state, x));
    const doneKeys = keys.filter((x) => itemDone(state, x));
    const render = (x) => (col === 'comment' ? cardComment(state, x, ctx) : col === 'customer' ? cardCustomer(state, x, ctx) : cardMessage(state, x, ctx));
    return `<section class="col" aria-label="${COLUMN_HE[col]}">
  <h2>${COLUMN_HE[col]} <span class="count">${open.length} פתוחים · ${keys.length}/${settings.caps[col]}</span></h2>
  ${open.map(render).join('') || `<p class="empty">${emptyText(col, state, settings, now)}</p>`}
  ${doneKeys.length ? `<details class="donebox"><summary>בוצעו היום (${doneKeys.length})</summary>${doneKeys.map(render).join('')}</details>` : ''}
</section>`;
  }).join('');
  const body = `<div class="pagehead"><h1>היום</h1><span class="date">${DAY.format(new Date(now))}</span></div>
${runBox(state, running, env)}
<div class="columns">${cols}</div>`;
  return layout({ title: 'היום', active: 'today', token, body, state, settings, now });
}

function emptyText(col, state, settings, now) {
  const leads = Object.values(state.leads);
  if (col === 'creator') {
    const warm = leads.filter((l) => l.type === 'creator' && l.warmedAt && !l.messagedAt && !l.closed && !dmReady(l, { now, warmupDays: settings.warmupDays })).length;
    return warm ? `${warm} יוצרים יופיעו כאן מחר, יום אחרי התגובה` : 'הודעה ליוצר/ת מופיעה כאן יום אחרי שסימנת "הגבתי"';
  }
  if (col === 'comment') {
    // Say why, when the reason is known: an empty queue because every post was
    // two years old must not look like an empty queue because nothing was found.
    const last = state.runs[0];
    if (last?.tooOld && !last.candidates) {
      return `כל ${last.tooOld} הפוסטים שהחיפוש מצא היום ישנים מ-${settings.maxPostAgeDays} יום. האינדקס של Brave לטיקטוק ואינסטגרם לא עדכני, אז אין כרגע סרטונים להגיב עליהם`;
    }
    return 'אין כרגע סרטונים חדשים. "מצא לידים חדשים" מחפש עכשיו';
  }
  if (col === 'agency') return 'אין סוכנויות להיום';
  return 'אין שאלות חדשות להיום';
}

/* ------------------------------------------------------------ lead */

/** Where the creator's route stands on the site, in one line. */
function tripNote(trip) {
  if (!trip) return '';
  if (trip.status === 'published') {
    return `<p class="note">פורסם באתר ${when(trip.publishedAt)}: <a href="${attr(trip.url)}" target="_blank" rel="noopener noreferrer"><bdi>${esc(trip.url.replace(/^https:\/\/(www\.)?/, ''))}</bdi></a> · ${trip.stopCount || 0} מקומות${trip.indexable ? '' : ' · לא נכנס לגוגל (פחות מ-8 מקומות)'}${trip.withdrawError ? ` · <span class="warn">ההסרה נכשלה, אנסה שוב: ${esc(trip.withdrawError)}</span>` : ''}</p>`;
  }
  if (trip.status === 'withdrawn') return `<p class="note">המסלול הוסר מהאתר ${when(trip.withdrawnAt)}. הכתובת מחזירה 410.</p>`;
  return `<p class="note warn">${esc(trip.reason || trip.status)}</p>`;
}

export function leadPage({ state, settings, token, now = Date.now(), lead, templates }) {
  const ctx = { templates, settings, state };
  const sections = [];

  // What was found and why.
  const posts = (lead.posts || [])
    .map(
      (p) => `<div class="post">
  ${thumb(p, 'thumb big')}
  <div><p class="caption full">${esc(p.title)}</p>
  <p class="small">${esc(PLATFORM_HE[p.platform] || p.platform)} · ${p.publishedAt ? `פורסם ${ago(p.publishedAt, now)}` : 'תאריך לא ידוע'} · <a href="${attr(p.url)}" target="_blank" rel="noopener noreferrer">פתח את הפוסט</a> · ${esc({ open: 'פתוח', commented: 'הגבת', skipped: 'דילגת' }[p.status] || p.status)}</p>
  ${whyList(p.why)}
  ${p.said || p.dest ? `<p class="small">הפוסט מדבר על: ${esc(p.said || 'לא כתוב')} · הדף שלנו: ${esc(p.dest?.he || 'אין')}</p>` : ''}
  ${p.places?.length ? `<p class="small">מקומות בפוסט: ${p.places.map(esc).join(', ')}</p>` : ''}</div>
</div>`
    )
    .join('');
  sections.push(`<section class="panel"><h2>מה נמצא ולמה</h2>${whyList(lead.why)}${lead.reason ? `<p class="small">המיון: ${esc(lead.reason)}</p>` : ''}${posts}</section>`);

  // Who.
  const facts = [];
  if (lead.profileUrl) facts.push(['פרופיל', `<a href="${attr(lead.profileUrl)}" target="_blank" rel="noopener noreferrer">${esc(lead.profileUrl)}</a>`]);
  if (Number.isFinite(lead.followers)) facts.push(['עוקבים', `${k(lead.followers)}${lead.followersFrom === 'search' ? ' (מתוך תוצאת חיפוש)' : ''}`]);
  if (lead.dest) facts.push(['יעד', esc(lead.dest.he)]);
  if (lead.phone) facts.push(['טלפון', esc(lead.phone)]);
  if (lead.whatsapp) facts.push(['וואטסאפ', esc(lead.whatsapp)]);
  if (lead.email) facts.push(['מייל', esc(lead.email)]);
  if (lead.website) facts.push(['אתר', `<a href="${attr(lead.website)}" target="_blank" rel="noopener noreferrer">${esc(lead.website)}</a>`]);
  for (const s of lead.socials || []) facts.push(['רשת', `<a href="${attr(s)}" target="_blank" rel="noopener noreferrer">${esc(s)}</a>`]);
  if (lead.address) facts.push(['כתובת', esc(lead.address)]);
  if (lead.mapsUrl) facts.push(['מפה', `<a href="${attr(lead.mapsUrl)}" target="_blank" rel="noopener noreferrer">גוגל מפות</a>`]);
  if (lead.kosher) facts.push(['קהל', `שומר כשרות ("${esc(lead.kosher)}")`]);
  facts.push(['נמצא', `${when(lead.foundAt)} · ${esc(lead.searched || '')}`]);
  sections.push(`<section class="panel"><h2>פרטים</h2><dl class="facts">${facts.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl></section>`);

  // The route.
  if (lead.type === 'creator') {
    const r = lead.route;
    sections.push(`<section class="panel"><h2>המסלול</h2>${
      r
        ? `<p>${r.days.length} ימים ב${esc(r.cityName)}, ${r.stops} מקומות מהקטלוג של האתר.${r.matched.length ? ` שמנו ראשונים: ${r.matched.map((m) => esc(m.name)).join(', ')}.` : ''}${r.unmatched.length ? ` לא נמצאו בקטלוג: ${r.unmatched.map(esc).join(', ')}.` : ''}</p>
<ol class="days">${r.days.map((d) => `<li><b>${esc(d.title || '')}</b> ${d.names.map(esc).join(' · ')}</li>`).join('')}</ol>`
        : '<p class="small">המסלול ייבנה כשהיוצר/ת יגיעו לעמודת היוצרים (יום אחרי התגובה).</p>'
    }${tripNote(lead.trip)}</section>`);
  }

  // The prepared material.
  const material = [];
  const toggle = `<div class="toggle" role="group" aria-label="לשון הפנייה">${button('נקבה', { act: 'gender', lead: lead.id, gender: 'f' }, lead.gender === 'f' ? 'on' : '')}${button('זכר', { act: 'gender', lead: lead.id, gender: 'm' }, lead.gender === 'm' ? 'on' : '')}<span class="small">${lead.genderFrom === 'post' ? 'לפי הטקסט בפוסט' : lead.genderFrom === 'owner' ? 'בחרת' : 'ברירת מחדל'}</span></div>`;
  const block = (title, what, extra = {}) => {
    const c = compose(lead, what, { ...ctx, ...extra });
    const tid = `t-${hash(`${what}:${extra.postId || ''}:${extra.i ?? ''}`)}`;
    const field = what === 'comment' ? `comment:${extra.postId}:${extra.i}` : what;
    const target = openTarget(lead, what === 'comment' ? 'comment' : what);
    const canRedraft = ['comment', 'dm', 'reply'].includes(what);
    const blocked = c.missing.length > 0 && !['followup', 'comment'].includes(what);
    return `<div class="block">
  <h3>${title}${c.edited ? ' <span class="tag">נערך</span>' : ''}</h3>
  ${textBox(tid, c.text, { rows: what === 'followup' ? 2 : what === 'comment' ? 3 : 7 })}
  ${missingNote(c.missing)}
  <div class="actions">
    ${what === 'comment' ? button('העתק תגובה', { copy: `#${tid}` }, 'primary') : button('העתק ופתח', { 'copy-open': `#${tid}`, href: target, disabled: blocked || !target ? 'disabled' : null }, 'primary')}
    ${button('ערוך', { edit: `#${tid}`, lead: lead.id, field })}
    ${c.edited ? button('בטל עריכה', { act: 'unedit', lead: lead.id, field }) : ''}
    ${canRedraft ? button('נסח מחדש', { redraft: what, lead: lead.id, post: extra.postId || null }) : ''}
  </div>
</div>`;
  };
  if (lead.type === 'creator') {
    const p = openPost(lead, { now, maxAgeDays: settings.maxPostAgeDays });
    if (p && !lead.warmedAt) {
      material.push(block('תגובה 1 לסרטון', 'comment', { postId: p.id, i: 0 }), block('תגובה 2 לסרטון', 'comment', { postId: p.id, i: 1 }));
    }
    material.push(block('הודעה ליוצר/ת', 'dm'));
    if (lead.messagedAt) material.push(block('תזכורת (פעם אחת)', 'followup'));
  } else if (lead.type === 'agency') {
    material.push(block('הודעה לסוכנות', 'message'));
    if (lead.messagedAt) material.push(block('תזכורת (פעם אחת)', 'followup'));
  } else {
    material.push(block('תגובה לשאלה', 'reply'));
  }
  if (lead.draftError) material.push(`<p class="note warn">${esc(lead.draftError)}</p>`);
  const linkNote = lead.agencyDest ? `<p class="small">מסלול הדוגמה: <a href="https://www.tiyulplus.com${attr(lead.agencyDest.path)}" target="_blank" rel="noopener noreferrer">${esc(lead.agencyDest.he)}</a></p>` : '';
  // Agencies are addressed in the plural ("לכם"), so the toggle has nothing to switch.
  sections.push(`<section class="panel"><h2>החומר המוכן</h2>${lead.type === 'agency' ? '' : toggle}${linkNote}${material.join('')}</section>`);

  // The buttons.
  const acts = [];
  if (lead.type === 'creator' && !lead.warmedAt) {
    const p = openPost(lead, { now, maxAgeDays: settings.maxPostAgeDays });
    if (p) acts.push(button('הגבתי', { act: 'commented', lead: lead.id, post: p.id }, 'primary'), button('עקבתי', { act: 'followed', lead: lead.id, post: p.id }, lead.followedAt ? 'on' : ''), button('דלג על הסרטון', { act: 'skip-post', lead: lead.id, post: p.id }));
    acts.push(button('לא רלוונטי', { act: 'irrelevant', lead: lead.id, confirm: 'בטוח? היוצר/ת לא יחזרו לעולם' }, 'quiet'));
  }
  if (lead.type !== 'customer') {
    if (!lead.messagedAt) {
      const first = lead.type === 'agency' ? 'message' : 'dm';
      const notWarm = lead.type === 'creator' && !dmReady(lead, { now, warmupDays: settings.warmupDays });
      const missing = compose(lead, first, ctx).missing.length > 0;
      acts.push(button('נשלח', { act: 'sent', lead: lead.id, disabled: notWarm || missing, title: notWarm ? 'הודעה ליוצר/ת רק יום אחרי "הגבתי"' : missing ? 'ההודעה עוד לא מוכנה' : null }));
    } else if (followupDue(lead, { now, followupDays: settings.followupDays })) {
      acts.push(button('נשלחה התזכורת', { act: 'sent', lead: lead.id }, 'primary'));
    } else {
      acts.push(button('נשלח', { act: 'sent', lead: lead.id, disabled: true, title: lead.followupSentAt ? 'נשלחו הודעה ותזכורת. זהו.' : 'התזכורת עוד לא הגיעה' }));
    }
  } else {
    acts.push(button('הגבתי', { act: 'commented', lead: lead.id }, 'primary'));
  }
  acts.push(
    button('דלג', { act: 'skip', lead: lead.id }),
    button('ענו', { act: 'replied', lead: lead.id }, lead.repliedAt ? 'on' : ''),
    button('מעוניינים', { act: 'yes', lead: lead.id }, lead.stage === 'yes' ? 'on' : ''),
    button('לא מעוניינים', { act: 'no', lead: lead.id, confirm: 'בטוח? לא נפנה אליהם יותר לעולם' }, 'quiet'),
    button('משתמשים באתר', { act: 'using', lead: lead.id }, lead.stage === 'using' ? 'on' : '')
  );
  const yesNote =
    lead.stage === 'yes' && lead.type !== 'customer'
      ? `<p class="note">ההטבה: ${esc(lead.type === 'agency' ? settings.offers.agency : settings.offers.creator)}. מעניקים ידנית מעמוד הניהול באתר, לפי המייל שלהם.</p>`
      : '';
  const status = [
    `שלב: <b>${STAGE_HE[lead.stage] || lead.stage}</b>`,
    lead.closed ? `סגור (${esc({ skipped: 'דילגת', irrelevant: 'לא רלוונטי', 'not-interested': 'לא מעוניינים', done: 'בוצע' }[lead.closed] || lead.closed)})` : '',
    lead.messagedAt ? `נשלח ${when(lead.messagedAt)}` : '',
    followupDue(lead, { now, followupDays: settings.followupDays }) ? '<b>התזכורת מגיעה היום</b>' : '',
    lead.followupSentAt ? `תזכורת נשלחה ${when(lead.followupSentAt)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  sections.push(`<section class="panel"><h2>פעולות</h2><p>${status}</p><div class="actions wrap">${acts.join('')}</div>${yesNote}</section>`);

  sections.push(`<section class="panel"><h2>היסטוריה</h2><ul class="history">${(lead.history || [])
    .slice()
    .reverse()
    .map((h) => `<li>${when(h.at)} · ${esc(h.what)}</li>`)
    .join('')}</ul></section>`);

  const body = `<div class="pagehead"><h1>${esc(displayName(lead))}</h1><span class="tag">${esc(TYPE_HE[lead.type])}</span><span class="tag">${esc(STAGE_HE[lead.stage])}</span><span class="small">ציון ${lead.score || 0}</span></div>
<div class="leadgrid">${sections.join('')}</div>`;
  return layout({ title: displayName(lead), active: 'leads', token, body, state, settings, now });
}

/* ------------------------------------------------------------ leads table */

export function leadsPage({ state, settings, token, now = Date.now(), query = {} }) {
  const f = {
    type: query.type || '',
    stage: query.stage || '',
    source: query.source || '',
    from: query.from || '',
    to: query.to || '',
  };
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
    `<select name="${name}"><option value="">הכל</option>${opts.map(([v, l]) => `<option value="${attr(v)}"${f[name] === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const form = `<form class="filters" method="get" action="/leads">
  <label>סוג ${sel('type', Object.entries(TYPE_HE))}</label>
  <label>שלב ${sel('stage', STAGES.map((s) => [s, STAGE_HE[s]]))}</label>
  <label>מקור ${sel('source', Object.entries(PLATFORM_HE))}</label>
  <label>מתאריך <input type="date" name="from" value="${attr(f.from)}"></label>
  <label>עד <input type="date" name="to" value="${attr(f.to)}"></label>
  <button type="submit">סנן</button><a href="/leads">נקה</a>
</form>`;
  const table = `<table class="table"><thead><tr><th>שם</th><th>סוג</th><th>מקור</th><th>שלב</th><th>יעד</th><th>ציון</th><th>נמצא</th><th>מה מצא</th></tr></thead><tbody>${rows
    .map(
      (l) => `<tr${l.closed ? ' class="closed"' : ''}><td><a href="/lead/${encodeURIComponent(l.id)}">${esc(displayName(l))}</a></td><td>${esc(TYPE_HE[l.type])}</td><td>${esc(PLATFORM_HE[l.source] || l.source)}</td><td>${esc(STAGE_HE[l.stage])}${l.closed ? ' (סגור)' : ''}</td><td>${esc(l.dest?.he || '')}</td><td>${l.score || 0}</td><td>${esc(ilDate(l.foundAt))}</td><td class="small">${esc(l.hashtag || l.searched || '')}</td></tr>`
    )
    .join('')}</tbody></table>`;
  const body = `<div class="pagehead"><h1>כל הלידים</h1><span class="small">${total} תוצאות${total > 500 ? ', מוצגים 500' : ''}</span></div>${form}${total ? table : '<p class="empty">אין לידים שמתאימים לסינון</p>'}`;
  return layout({ title: 'כל הלידים', active: 'leads', token, body, state, settings, now });
}

/* ------------------------------------------------------------ reports */

export function reportsPage({ state, settings, token, now = Date.now(), ga4 }) {
  const leads = Object.values(state.leads);
  const spend = monthSpend(state, settings, now);
  const counts = stageCounts(leads);
  const wow = weekOverWeek(leads, now);
  const types = ['creator', 'agency', 'customer'];

  const budget = `<section class="panel" id="budget"><h2>תקציב החודש</h2>
<p>חיוב משוער: <b>${money(spend.billable)}</b> מתוך <b>${money(spend.cap)}</b>${spend.reached ? ' · <b class="warn">התקציב נוצל, החיפוש נעצר</b>' : ` · נשארו ${money(spend.left)}`}. מחיר מחירון לפני מכסות חינמיות: ${money(spend.gross)}.</p>
<table class="table"><thead><tr><th>שירות</th><th>קריאות</th><th>מחירון</th><th>לחיוב</th></tr></thead><tbody>${
    Object.entries(spend.rows)
      .map(([api, r]) => `<tr><td>${esc(API_PRICES[api]?.label || api)}</td><td>${r.units}</td><td>${money(r.gross)}</td><td>${money(r.billable)}</td></tr>`)
      .join('') || '<tr><td colspan="4">עוד אין הוצאות החודש</td></tr>'
  }</tbody></table></section>`;

  const perType = types
    .map((t) => {
      const fn = funnel(leads, t);
      const steps = t === 'agency' ? ['found', 'messaged', 'replied', 'yes', 'using'] : t === 'customer' ? ['found', 'commented'] : ['found', 'commented', 'messaged', 'replied', 'yes', 'using'];
      const label = { found: 'נמצאו', commented: 'הגבתי', messaged: 'נשלחה הודעה', replied: 'ענו', yes: 'מעוניינים', using: 'משתמשים' };
      const w = wow[t];
      const searches = bySearch(leads, t).slice(0, 12);
      return `<section class="panel"><h2>${TYPE_HE[t]}</h2>
<div class="funnel">${steps.map((s) => `<div><b>${fn[s]}</b><span>${label[s]}</span></div>`).join('')}</div>
<p class="small">לפי השלב הנוכחי: ${STAGES.filter((s) => counts[t][s]).map((s) => `${STAGE_HE[s]} ${counts[t][s]}`).join(' · ') || 'אין עדיין'}</p>
<h3>השבוע מול שבוע שעבר</h3>
<table class="table"><thead><tr><th></th><th>נמצאו</th><th>הגבתי</th><th>נשלחה הודעה</th><th>ענו</th><th>מעוניינים</th></tr></thead><tbody>
<tr><td>השבוע</td><td>${w.thisWeek.found}</td><td>${w.thisWeek.commented}</td><td>${w.thisWeek.messaged}</td><td>${w.thisWeek.replied}</td><td>${w.thisWeek.yes}</td></tr>
<tr><td>שבוע שעבר</td><td>${w.lastWeek.found}</td><td>${w.lastWeek.commented}</td><td>${w.lastWeek.messaged}</td><td>${w.lastWeek.replied}</td><td>${w.lastWeek.yes}</td></tr>
</tbody></table>
<h3>אילו חיפושים הביאו לידים שהתקדמו</h3>
${
  searches.length
    ? `<table class="table"><thead><tr><th>חיפוש</th><th>נמצאו</th><th>טופלו</th><th>ענו</th><th>מעוניינים</th></tr></thead><tbody>${searches
        .map((r) => `<tr><td>${esc(r.search)}${r.kind === 'hashtag' ? ' <span class="tag">האשטג</span>' : ''}</td><td>${r.found}</td><td>${r.messaged}</td><td>${r.replied}</td><td>${r.yes}</td></tr>`)
        .join('')}</tbody></table>`
    : '<p class="small">אין עדיין</p>'
}</section>`;
    })
    .join('');

  let ga = '';
  if (!ga4?.configured) {
    ga = `<section class="panel"><h2>קליקים לפי utm_campaign</h2><p>GA4 עוד לא מחובר. מה צריך:</p><ul>${(ga4?.missing || []).map((m) => `<li>${esc(m)}</li>`).join('')}</ul><p class="small">גם אחרי החיבור: באתר ההסכמה לעוגיות כבויה כברירת מחדל, אז GA4 סופר רק מבקרים שאישרו. המספרים יהיו נמוכים מהאמת.</p></section>`;
  } else {
    const byCampaign = new Map();
    for (const r of ga4.rows || []) {
      const key = `${r.source}|${r.campaign}`;
      const row = byCampaign.get(key) || { source: r.source, campaign: r.campaign, thisWeek: 0, lastWeek: 0 };
      row[r.range === 'lastWeek' ? 'lastWeek' : 'thisWeek'] += r.sessions;
      byCampaign.set(key, row);
    }
    const nameFor = (campaign) => leads.find((l) => String(l.handle || '').toLowerCase() === campaign)?.name || '';
    ga = `<section class="panel"><h2>קליקים לפי utm_campaign (GA4)</h2>${ga4.error ? `<p class="note warn">${esc(ga4.error)}</p>` : ''}
<table class="table"><thead><tr><th>מקור</th><th>קמפיין</th><th>מי</th><th>השבוע</th><th>שבוע שעבר</th></tr></thead><tbody>${
      [...byCampaign.values()]
        .sort((a, b) => b.thisWeek - a.thisWeek)
        .map((r) => `<tr><td>${esc(TYPE_HE[r.source] || r.source)}</td><td>${esc(r.campaign)}</td><td>${esc(nameFor(r.campaign))}</td><td>${r.thisWeek}</td><td>${r.lastWeek}</td></tr>`)
        .join('') || '<tr><td colspan="5">אין עדיין ביקורים עם התגים שלנו</td></tr>'
    }</tbody></table><p class="small">מבקרים שאישרו עוגיות בלבד (ההסכמה באתר כבויה כברירת מחדל).</p></section>`;
  }

  const body = `<div class="pagehead"><h1>דוחות</h1></div><div class="reports">${budget}${ga}${perType}</div>`;
  return layout({ title: 'דוחות', active: 'reports', token, body, state, settings, now });
}

/* ------------------------------------------------------------ settings */

export function settingsPage({ state, settings, token, now = Date.now(), templates }) {
  const num = (name, label, value, step = 1, hint = '') =>
    `<label class="field"><span>${label}</span><input type="number" name="${name}" value="${attr(value)}" step="${step}" min="0">${hint ? `<small>${hint}</small>` : ''}</label>`;
  const txt = (name, label, value) => `<label class="field"><span>${label}</span><input type="text" name="${name}" value="${attr(value)}"></label>`;
  const lines = (name, label, list, hint = '') =>
    `<label class="field wide"><span>${label}</span><textarea name="${name}" rows="${Math.min(10, Math.max(3, list.length + 1))}" data-lines="1">${esc(list.join('\n'))}</textarea>${hint ? `<small>${hint}</small>` : ''}</label>`;
  const check = (name, label, on) => `<label class="field check"><input type="checkbox" name="${name}"${on ? ' checked' : ''}><span>${label}</span></label>`;

  const form = `<form id="settings" class="settings">
<fieldset><legend>מכסות יומיות</legend>
${num('caps.comment', 'תגובות', settings.caps.comment)}${num('caps.creator', 'יוצרים', settings.caps.creator)}${num('caps.agency', 'סוכנויות', settings.caps.agency)}${num('caps.customer', 'לקוחות', settings.caps.customer)}
</fieldset>
<fieldset><legend>תקציב ותזמון</legend>
${num('budgetUsd', 'תקציב חודשי ($)', settings.budgetUsd, 1, 'החיפוש נעצר כשמגיעים אליו')}
${num('braveCreditUsd', 'קרדיט חודשי של Brave ($)', settings.braveCreditUsd, 1, '0 אם החשבון לא מקבל אותו')}
${num('runHour', 'שעת החיפוש היומי', settings.runHour, 1, 'שעון ישראל, כשהאפליקציה פתוחה')}
${num('warmupDays', 'ימים מתגובה להודעה', settings.warmupDays)}
${num('followupDays', 'ימים עד תזכורת', settings.followupDays)}
</fieldset>
<fieldset><legend>ההטבות</legend>
${txt('offers.creator', 'ליוצרים', settings.offers.creator)}${txt('offers.agency', 'לסוכנויות', settings.offers.agency)}
</fieldset>
<fieldset><legend>סינון</legend>
${num('followers.min', 'מינימום עוקבים', settings.followers.min, 100)}${num('followers.max', 'מקסימום עוקבים', settings.followers.max, 1000)}
${num('maxPostAgeDays', 'גיל פוסט מקסימלי (ימים)', settings.maxPostAgeDays)}${num('maxCustomerAgeDays', 'גיל שאלה מקסימלי (ימים)', settings.maxCustomerAgeDays)}
${lines('skipCountries', 'מדינות שלא מחפשים בהן', settings.skipCountries, 'האתר מתכנן טיולים לחו"ל, אז ישראל כאן כברירת מחדל')}
</fieldset>
<fieldset><legend>חיפוש</legend>
${num('destinationsPerDay', 'יעדים ביום (טיקטוק ואינסטגרם)', settings.destinationsPerDay, 1, 'מתוך destinations.json, ברוטציה')}
${num('youtubeDestinationsPerDay', 'יעדים ביום ביוטיוב', settings.youtubeDestinationsPerDay, 1, '5 חיפושים לכל יעד, מתוך 100 חינם ביום')}
${num('hashtagsPerDay', 'האשטגים ביום', settings.hashtagsPerDay)}
${check('instagram', 'לחפש גם באינסטגרם (דרך Brave)', settings.instagram)}
${check('youtube', 'לחפש גם ביוטיוב (Shorts)', settings.youtube)}
${lines('tiktokQueries', 'חיפושים בטיקטוק', settings.tiktokQueries, '{dest} מוחלף בשם היעד')}
${lines('instagramQueries', 'חיפושים באינסטגרם', settings.instagramQueries)}
${lines('hashtags', 'האשטגים', settings.hashtags)}
${lines('agencyQueries', 'חיפושי סוכנויות', settings.agencyQueries)}
${lines('agencyCities', 'ערים לסוכנויות', settings.agencyCities)}
</fieldset>
<fieldset><legend>מודלים</legend>
${txt('models.draft', 'לניסוח', settings.models.draft)}${txt('models.sort', 'למיון', settings.models.sort)}
</fieldset>
<div class="actions"><button type="submit" class="primary">שמור הגדרות</button><button type="button" data-reset-settings="1" class="quiet">חזרה לברירת המחדל</button></div>
</form>`;

  const sample = { name: 'מאיה', dest: 'אתונה', line: 'אהבתי את הטיפ על העלייה לליקבטוס בשקיעה', link: 'https://www.tiyulplus.com/trips/athens-5-ab12cd34?utm_source=creator&utm_medium=dm&utm_campaign=example', gift: settings.offers.creator, demand: true };
  const tpl = TEMPLATE_NAMES.map((n) => {
    const vars = n.startsWith('agency') ? { ...sample, gift: settings.offers.agency, link: 'https://www.tiyulplus.com/itinerary/athens/5?utm_source=agency&utm_medium=whatsapp&utm_campaign=example.co.il' } : sample;
    return `<div class="tpl">
  <h3>${esc(TEMPLATE_LABELS[n])} <code>${n}.txt</code></h3>
  <textarea id="tpl-${n}" rows="${n.endsWith('followup') || n === 'customer-link' ? 3 : 7}">${esc(templates[n])}</textarea>
  <div class="actions">${button('שמור תבנית', { 'save-template': n })}</div>
  <details><summary>תצוגה מקדימה</summary><p class="preview"><b>נקבה:</b> ${esc(fill(templates[n], { ...vars, gender: 'f' }))}</p><p class="preview"><b>זכר:</b> ${esc(fill(templates[n], { ...vars, gender: 'm' }))}</p></details>
</div>`;
  }).join('');

  const help = `<p class="small">בתבניות: <code>{זכר|נקבה}</code> לפנייה לפי המתג, <code>[שם] [יעד] [שורה אישית אחת על הפוסט] [קישור] [מתנה]</code>, ו-<code>{{אם שואלים: ...}}</code> לחלק שנכנס רק כשבפוסט כתוב ששואלים על המסלול. בלי קו מפריד ארוך ובלי כתובות, הקישור נכנס רק דרך [קישור].</p>`;
  const body = `<div class="pagehead"><h1>הגדרות</h1></div><div class="settingsgrid"><section class="panel">${form}</section><section class="panel"><h2>תבניות הודעה</h2>${help}${tpl}</section></div>`;
  return layout({ title: 'הגדרות', active: 'settings', token, body, state, settings, now });
}

/* ------------------------------------------------------------ misc */

export function notFoundPage({ state, settings, token, now = Date.now() }) {
  return layout({ title: 'לא נמצא', active: '', token, body: '<div class="pagehead"><h1>לא נמצא</h1></div><p><a href="/">חזרה להיום</a></p>', state, settings, now });
}

function hash(s) {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h.toString(36);
}
