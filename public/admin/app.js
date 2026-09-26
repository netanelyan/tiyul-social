'use strict';

// The admin site's client.
//
// Plain JavaScript against the JSON API in src/admin/server.js. No framework, for
// the reason index.html gives: this project's deploy is `git pull && pm2 restart`
// and a build step would make the admin panel the one thing that cannot be fixed
// from a phone at the moment something else is already broken.
//
// THE SERVER DECIDES WHAT IS LEGAL, ALWAYS. Every button here is drawn from a
// flag the server sent (`canRetitle`, `privacy`, `draft`) rather than from the
// page's own idea of what a kind supports. A page that offers a button the server
// refuses is a page that looks broken, and the rules live in one place already —
// stagingButtons in bot.js, which is what those flags are computed from.
//
// EVERY MUTATION REFRESHES FROM THE SERVER rather than patching the DOM. The
// other channel is Telegram and it is being used at the same time, so the page's
// own copy of the state is stale the moment anybody taps a button in the chat.
// Re-reading is a few kilobytes and it cannot be wrong.

const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, kids = []) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const k of [].concat(kids)) node.append(k);
  return node;
};

let state = null;
let busy = false;

// --- talking to the server --------------------------------------------------

async function api(path, { method = 'GET', body = null } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      // The CSRF check in the server. A cross-site form post cannot set a custom
      // header, which is what makes this worth the one line.
      ...(method === 'GET' ? {} : { 'x-tiyul-admin': '1', 'content-type': 'application/json' }),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = { ok: false, said: `${res.status} ${res.statusText}` };
  }
  // A session that expired mid-use is the normal case after a few days, not an
  // error to show: the page goes back to the login form rather than reporting a
  // 401 the reader can do nothing with.
  if (res.status === 401) {
    showLogin();
    throw new Error(data.said || 'not signed in');
  }
  return data;
}

// --- chrome ----------------------------------------------------------------

function flash(text, bad = false) {
  const node = $('#flash');
  node.textContent = text;
  node.hidden = !text;
  node.dataset.bad = bad ? '1' : '0';
  if (text) clearTimeout(flash.timer), (flash.timer = setTimeout(() => (node.hidden = true), 8000));
}

function showLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
  state = null;
}

/** Run an action, keeping every button disabled until the state has been reread. */
async function act(label, fn) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('button').forEach((b) => (b.disabled = true));
  try {
    const res = await fn();
    if (res && res.said) flash(res.said, res.ok === false);
    await refresh();
  } catch (e) {
    flash(`${label}: ${e.message}`, true);
  } finally {
    busy = false;
    document.querySelectorAll('button').forEach((b) => (b.disabled = false));
  }
}

// --- rendering -------------------------------------------------------------

const ICON = { deck: '🎞️', clip: '🎬', plan: '🗺️', card: '📰' };
const media = (name) => `/api/media?file=${encodeURIComponent(name)}`;

/**
 * The pictures or the video, whichever this item has.
 *
 * A MISSING FILE SAYS SO. This is not a hypothetical: DEPLOY.md prunes rendered
 * cards older than thirty days, and a post can sit in the queue longer than that
 * — so the file behind a queued item genuinely does disappear. Left alone, the
 * browser draws a broken-image icon or a black video player with no controls,
 * which reads as "the site is broken" rather than "this post can no longer be
 * published as it stands", and those need different things done about them.
 */
function shots(item) {
  if (!item.video && !item.images.length) return null;
  const box = el('div', { className: 'shots' });

  const gone = (node, name) => {
    node.replaceWith(el('div', { className: 'missing' }, [
      el('strong', { textContent: '⚠️ הקובץ לא נמצא' }),
      el('span', { textContent: name }),
      el('span', { className: 'muted', textContent: 'קבצים ישנים נמחקים אחרי 30 יום' }),
    ]));
  };

  if (item.video) {
    const v = el('video', { src: media(item.video), controls: true, playsInline: true, preload: 'metadata' });
    v.addEventListener('error', () => gone(v, item.video));
    box.append(v);
  }
  for (const name of item.images) {
    const img = el('img', { src: media(name), loading: 'lazy', alt: '' });
    img.addEventListener('error', () => gone(img, name));
    box.append(img);
  }
  return box;
}

function pendingCard(item) {
  const head = el('div', { className: 'head' }, [
    el('span', { className: 'kind', textContent: ICON[item.kind] || ICON.card }),
    el('span', { className: 'title', textContent: item.headline || '(ללא כותרת)' }),
  ]);
  for (const t of item.targets) head.append(el('span', { className: 'tag', textContent: t }));
  if (item.draft && item.targets.includes('tiktok')) head.append(el('span', { className: 'tag', textContent: 'טיוטה' }));

  const actions = el('div', { className: 'row-actions' }, [
    el('button', {
      className: 'ok',
      textContent: '✅ אשר ופרסם',
      onclick: () => act('אישור', () => api(`/staging/${item.key}/approve`, { method: 'POST' })),
    }),
    el('button', {
      className: 'danger',
      textContent: '❌ דחה',
      onclick: () => {
        // The only confirm on the page. Rejecting is the one action here with
        // nothing behind it — an approved post can be unqueued, a rejected one is
        // gone — and it sits next to approve on a phone.
        if (confirm(`לדחות את "${item.headline}"?`)) {
          act('דחייה', () => api(`/staging/${item.key}/reject`, { method: 'POST' }));
        }
      },
    }),
  ]);

  if (item.privacy) {
    actions.append(
      el('button', {
        textContent: `🔒 ${item.privacy}`,
        onclick: () => act('פרטיות', () => api(`/staging/${item.key}/privacy`, { method: 'POST' })),
      })
    );
  }
  if (item.canRetitle) {
    actions.append(
      el('button', {
        textContent: '✏️ כותרת',
        onclick: async () => {
          const headline = prompt('כותרת חדשה:', item.headline);
          if (headline == null || !headline.trim()) return;
          await act('כותרת', () => api(`/staging/${item.key}/headline`, { method: 'POST', body: { headline } }));
        },
      })
    );
  }
  if (item.canSeeEvidence) {
    actions.append(
      el('button', {
        textContent: '📎 ציטוטים',
        onclick: async () => {
          const res = await api(`/staging/${item.key}/evidence`);
          openModal('ציטוטים', res.text || res.said || 'אין');
        },
      })
    );
  }

  const card = el('div', { className: 'card item' }, [head]);
  const pics = shots(item);
  if (pics) card.append(pics);
  card.append(el('pre', { textContent: item.text }), actions);
  return card;
}

function proposalCard(p) {
  const build = (targets, label) =>
    el('button', {
      className: 'go',
      textContent: label,
      onclick: () => act('בנייה', () => api(`/proposals/${p.key}/build`, { method: 'POST', body: { targets } })),
    });
  return el('div', { className: 'card item' }, [
    el('div', { className: 'head' }, [
      el('span', { className: 'kind', textContent: '💡' }),
      el('span', { className: 'title', textContent: p.title || 'הצעה' }),
      el('span', { className: 'tag', textContent: 'הצעה, עוד לא נבנתה' }),
    ]),
    el('pre', { textContent: p.text }),
    el('div', { className: 'row-actions' }, [
      build(['instagram'], 'אינסטגרם'),
      build(['tiktok'], 'טיקטוק'),
      build(['instagram', 'tiktok'], 'שניהם'),
      el('button', {
        className: 'danger',
        textContent: '❌ דחה',
        onclick: () => act('דחייה', () => api(`/proposals/${p.key}/reject`, { method: 'POST' })),
      }),
    ]),
  ]);
}

function queueCard(item) {
  const head = el('div', { className: 'head' }, [
    el('span', { className: 'kind', textContent: ICON[item.kind] || ICON.card }),
    el('span', { className: 'title', textContent: `${item.n}. ${item.headline}` }),
  ]);
  for (const t of item.targets) head.append(el('span', { className: 'tag', textContent: t }));

  const actions = el('div', { className: 'row-actions' }, [
    el('button', {
      className: 'go',
      textContent: '📤 פרסם עכשיו',
      onclick: () => act('פרסום', () => api('/queue/publish', { method: 'POST', body: { n: item.n } })),
    }),
  ]);
  // Offered on anything TikTok will take, including a post whose draft has
  // already gone: re-sending after the file was redrawn is what the button is
  // most useful for. The server is what decides, by kind — see draftQueued.
  actions.append(
    el('button', {
      textContent: '🎵 טיוטה לטיקטוק',
      onclick: () => act('טיוטה', () => api('/queue/draft', { method: 'POST', body: { n: item.n } })),
    })
  );

  const card = el('div', { className: 'card item' }, [head]);
  const pics = shots(item);
  if (pics) card.append(pics);
  card.append(actions);
  return card;
}

function bars(budgets) {
  // Defaulted rather than trusted. Every one of these is present from the real
  // bot, and the page must not be the thing that breaks when a budget is turned
  // off or a field is added — draw() renders everything in one pass, so a throw
  // here blanks the tabs below it too.
  const zero = { today: 0, perDay: 0, waiting: 0, max: 0 };
  const b = {
    cards: zero, decks: zero, clips: zero,
    shoots: { ...zero, window: '', now: null },
    clipShapes: [],
    ...(budgets || {}),
  };
  const box = el('div', { className: 'bars' });
  const row = (label, now, max, extra = '') => {
    if (!max) return;
    const pct = Math.min(100, Math.round((now / max) * 100));
    // `dataset` is read-only, so it is set through it rather than assigned over
    // it. Object.assign onto the element with a `dataset` key throws — and it
    // threw here, inside draw(), which took the whole system tab down with it and
    // turned every action's success message into an error message.
    const fill = el('i', { style: `width:${pct}%` });
    if (now >= max) fill.dataset.full = '1';
    box.append(
      el('div', { className: 'bar-row' }, [
        el('div', { className: 'label' }, [
          el('span', { textContent: label }),
          el('span', { textContent: `${now}/${max}${extra}` }),
        ]),
        el('div', { className: 'bar' }, [fill]),
      ])
    );
  };

  row('📰 כרטיסים היום', b.cards.today, b.cards.perDay);
  row('🃏 מצגות היום', b.decks.today, b.decks.perDay);
  // The backlog caps, which are the answer to "why is nothing being suggested"
  // and are invisible everywhere else. A full one stays shut until somebody
  // decides, not until time passes — see the note at /status in bot.js.
  row('🃏 הצעות ממתינות להחלטה', b.decks.waiting, b.decks.max, b.decks.waiting >= b.decks.max ? ' · חסום' : '');
  row('🎬 קליפים היום', b.clips.today, b.clips.perDay);
  row('🎬 קליפים ממתינים להחלטה', b.clips.waiting, b.clips.max, b.clips.waiting >= b.clips.max ? ' · חסום' : '');
  row('🎥 תדריכים היום', b.shoots.today, b.shoots.perDay);

  const notes = el('p', { className: 'muted' });
  notes.append(`חלון תדריכים: ${b.shoots.window} · ${b.shoots.now?.ok ? 'אפשר עכשיו' : b.shoots.now?.why || ''}`);
  if (b.clipShapes?.length) {
    notes.append(el('br'), `צורות הקליפים האחרונות: ${b.clipShapes.join(' ← ')}`);
  }

  return el('div', {}, [el('h2', { textContent: 'תקציבים' }), box, notes]);
}

function openModal(title, body) {
  $('#modal-title').textContent = title;
  $('#modal-body').textContent = body;
  $('#modal').showModal();
}

function setCount(id, n) {
  const node = $(id);
  node.textContent = n;
  node.dataset.zero = n ? '0' : '1';
}

function draw() {
  if (!state) return;
  $('#who').textContent = state.me;

  setCount('#c-pending', state.pending.length + state.proposals.length);
  setCount('#c-queue', state.queue.length);
  setCount('#c-held', state.held.length);

  const proposals = $('#proposals');
  proposals.replaceChildren(...state.proposals.map(proposalCard));

  const pending = $('#pending');
  pending.replaceChildren(
    ...(state.pending.length
      ? state.pending.map(pendingCard)
      : state.proposals.length
        ? []
        : [el('p', { className: 'empty', textContent: '✅ אין ממתינים' })])
  );

  $('#queue').replaceChildren(
    ...(state.queue.length
      ? state.queue.map(queueCard)
      : [el('p', { className: 'empty', textContent: '📦 התור ריק' })])
  );

  $('#held').replaceChildren(
    ...(state.held.length
      ? state.held.map((h) =>
          el('div', { className: 'card item' }, [
            el('div', { className: 'head' }, [
              el('span', { className: 'kind', textContent: ICON[h.kind] || ICON.card }),
              el('span', { className: 'title', textContent: `${h.n}. ${h.headline}` }),
              el('span', { className: 'tag', textContent: `חסר: ${h.missingHe}` }),
            ]),
            ...(h.error ? [el('pre', { textContent: h.error })] : []),
          ])
        )
      : [el('p', { className: 'empty', textContent: '✅ אין פוסטים מוחזקים' })])
  );

  $('#budgets').replaceChildren(bars(state.budgets));
  $('#status').textContent = state.status;
  $('#health').textContent = state.health;
  $('#usage').textContent = state.usage;
}

async function refresh() {
  const data = await api('/state');
  if (!data.ok) return flash(data.said || 'לא הצלחתי לקרוא את המצב', true);
  state = data;
  $('#login').hidden = true;
  $('#app').hidden = false;
  draw();
  // The log only when its tab is open. It is the largest thing the API returns
  // and it is the one view nobody has open by default.
  if ($('[data-panel="system"]').hidden === false) await drawLog();
}

async function drawLog() {
  const { lines = [] } = await api('/log');
  const pre = $('#log');
  pre.replaceChildren(
    ...lines.slice(-200).map((l) =>
      el('span', {
        className: l.level === 'error' ? 'e' : '',
        textContent: `${new Date(l.at).toLocaleTimeString('he-IL')}  ${l.text}\n`,
      })
    )
  );
  pre.scrollTop = pre.scrollHeight;
}

// --- wiring ----------------------------------------------------------------

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const res = await api('/login', {
    method: 'POST',
    body: { name: form.get('name'), password: form.get('password') },
  }).catch((err) => ({ ok: false, said: err.message }));
  const err = $('#login-error');
  if (!res.ok) {
    err.textContent = res.said || 'לא הצלחתי להיכנס';
    err.hidden = false;
    return;
  }
  err.hidden = true;
  e.target.reset();
  await refresh();
});

$('#logout').addEventListener('click', () =>
  api('/logout', { method: 'POST' }).then(showLogin, showLogin)
);
$('#refresh').addEventListener('click', () => act('רענון', async () => ({})));
$('#modal-close').addEventListener('click', () => $('#modal').close());

for (const tab of document.querySelectorAll('nav button')) {
  tab.addEventListener('click', async () => {
    document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b === tab));
    document.querySelectorAll('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== tab.dataset.tab));
    if (tab.dataset.tab === 'system') await drawLog();
  });
}

for (const btn of document.querySelectorAll('[data-act]')) {
  btn.addEventListener('click', () => {
    const what = btn.dataset.act;
    if (what === 'publish-next') return act('פרסום', () => api('/queue/publish', { method: 'POST', body: {} }));
    if (what === 'retry') return act('retry', () => api('/held/retry', { method: 'POST' }));
    if (what === 'clear-held') {
      if (!confirm('לוותר על כל הפוסטים המוחזקים? מה שכבר פורסם נשאר.')) return;
      return act('ניקוי', () => api('/held/clear', { method: 'POST' }));
    }
  });
}

for (const btn of document.querySelectorAll('[data-build]')) {
  btn.addEventListener('click', () => {
    const what = btn.dataset.build;
    const body = { what };
    if (what === 'clip') {
      body.count = Number($('#clip-count').value) || 1;
      body.shape = $('#clip-shape').value;
    }
    if (what === 'deck') body.count = Number($('#deck-count').value) || 1;
    if (what === 'shoot') body.count = Number($('#shoot-count').value) || 1;
    if (what === 'trip') {
      body.dest = $('#trip-dest').value.trim();
      body.days = Number($('#trip-days').value) || null;
    }
    return act('בנייה', () => api('/build', { method: 'POST', body }));
  });
}

/*
  Polled, not pushed.

  A decision made in Telegram has to show up here, and the honest options are a
  WebSocket or a poll. A poll of a few kilobytes every twenty seconds costs
  nothing on a queue this size and has no reconnection logic to get wrong; a
  socket would be the more elegant answer to a problem this does not have.

  Paused while the tab is hidden, because a phone left open on this page overnight
  should not be waking the process every twenty seconds to say nothing changed.
*/
setInterval(() => {
  if (document.hidden || busy || !state) return;
  refresh().catch(() => {});
}, 20_000);

// A session cookie may already be valid, so the first thing to try is the state
// rather than the login form: landing on a password box you do not need is a
// worse start than a page that is simply already open.
refresh().catch(showLogin);
