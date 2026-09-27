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

// --- skeletons --------------------------------------------------------------
//
// Nothing here is ever blank while it works, and nothing spins.
//
// The reason to prefer these over a spinner is not taste. A spinner is drawn in
// one spot and says only "wait"; every skeleton below is the SHAPE of the thing
// that is coming, in the place it is coming to, so the page does not jump when
// it lands and a reader can tell a slow queue from an empty one before the
// answer arrives. Those two states used to look identical, and on this site
// they mean opposite things.
//
// `aria-busy` on the container is what carries this to a screen reader. The
// boxes themselves are decorative and are never announced, which is why they
// are plain divs with no text and no role.

const sk = (cls = '') => el('div', { className: `sk ${cls}`.trim() });

/** A stack of grey lines. Uneven by default, because what is coming is prose. */
const skLines = (widths = ['w85', 'w70', 'w55']) => widths.map((w) => sk(`sk-line ${w}`));

/** Monospace output that has not answered yet. */
const skPre = (widths) => el('div', { className: 'sk-pre' }, skLines(widths));

/**
 * Put a skeleton in a box, but only if the box is empty.
 *
 * The guard is the whole point. Every one of these regions is re-read on a
 * twenty second poll, and replacing good content with grey bars each time would
 * make the page strobe on a timer. A skeleton is for not knowing yet, which
 * happens once per region per session.
 */
function skInto(node, build) {
  if (!node || node.dataset.sk === '1' || node.textContent.trim()) return false;
  node.setAttribute('aria-busy', 'true');
  node.dataset.sk = '1';
  node.replaceChildren(build());
  return true;
}

/** The region answered. Drop the busy flag so it stops being announced as loading. */
function skDone(node) {
  if (!node) return;
  node.removeAttribute('aria-busy');
  delete node.dataset.sk;
}

// --- things being built -----------------------------------------------------
//
// THE LONGEST WAIT ON THIS SITE, and until now the one with no feedback at all.
//
// /build is detached on the server: it answers "started" in milliseconds and
// the clip or the deck lands in the pending list minutes later through the
// twenty second poll. So pressing the button flashed one line and left the page
// looking exactly as it did before, for three minutes, which reads as the
// button not having worked. The honest fix is to show the empty chair: a card
// in the list it will arrive in, saying what is coming.
//
// Held in memory only. A reload loses these and that is correct - the build is
// the server's and this is a note about a button this tab pressed, not state.

const BUILD_HE = {
  gather: 'סבב איסוף',
  clip: 'קליפ',
  deck: 'הצעת מצגת',
  trip: 'מסלול',
};

/** How long a placeholder may stand before it is assumed to have failed. */
const BUILD_MAX_MS = 15 * 60_000;

let building = [];

/** The empty chair: a pending card with nothing in it yet. */
function skBuildCard(b) {
  return el('div', { className: 'card item building' }, [
    el('div', { className: 'head' }, [
      el('span', { className: 'kind', textContent: '⏳' }),
      el('span', { className: 'what' }, [el('b', { textContent: BUILD_HE[b.what] || b.what }), ' נבנה עכשיו']),
    ]),
    el('div', { className: 'shots' }, [sk('sk-img')]),
    el('div', {}, skLines(['w70', 'w85'])),
  ]);
}

/**
 * Drop the placeholders whose work has landed.
 *
 * Matched by COUNT rather than by identity, because the server's answer to
 * /build carries no id to match on: it starts a job and says so. So one arrival
 * clears one placeholder, oldest first, and the rest have their marks moved up
 * to account for the item that has already been spoken for.
 *
 * The age cap is the other half. A build that throws server-side never arrives,
 * and a chair left out forever for a guest who is not coming is worse than no
 * chair. Fifteen minutes is longer than the slowest deck observed and short
 * enough to be gone before anybody wonders.
 */
function reapBuilding(have) {
  building.sort((a, b) => a.at - b.at);
  while (building.length && have > building[0].mark) {
    building.shift();
    for (const b of building) b.mark++;
  }
  const cutoff = Date.now() - BUILD_MAX_MS;
  building = building.filter((b) => b.at > cutoff);
}

let state = null;
let busy = false;

/*
  The card whose button was pressed last.

  Recorded here by one delegated listener rather than threaded through the
  eight places that build a button, which also means a button added later gets
  this for free instead of being the one that quietly does not.

  Recording is all this does. `act` is what applies the faded state and what
  takes it off again, so a button that opens a modal rather than mutating
  anything sets this and nothing comes of it.
*/
let pressed = null;
document.addEventListener(
  'click',
  (e) => {
    const btn = e.target instanceof Element ? e.target.closest('button') : null;
    pressed = btn ? btn.closest('.card') : null;
  },
  true
);

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
  // The boot skeleton is dismissed by whichever real state wins, and this is
  // one of the two. Leaving it up behind the login form would show a greyed
  // queue to somebody who is not signed in to see one.
  $('#boot').hidden = true;
  $('#app').hidden = true;
  $('#login').hidden = false;
  state = null;
}

/**
 * Run an action, keeping every button disabled until the state has been reread.
 *
 * `on` is the card the action is about. Approving a post replaces it, so from
 * the moment the button is pressed that card is showing something which is no
 * longer true: it fades and stops taking taps for as long as the server is
 * working. Buttons going flat everywhere already said "busy"; this says WHICH
 * ONE, which on a phone holding six pending cards is the difference between
 * waiting and pressing approve on the wrong one twice.
 */
async function act(label, fn, { on = pressed } = {}) {
  if (busy) return;
  busy = true;
  // Consumed, so the next action cannot inherit the last one's card. A button
  // that opens a modal instead of calling act leaves `pressed` set and nothing
  // else happens, which is why recording and applying are separate steps.
  pressed = null;
  on?.classList.add('working');
  document.querySelectorAll('button').forEach((b) => (b.disabled = true));
  try {
    const res = await fn();
    if (res && res.said) flash(res.said, res.ok === false);
    await refresh();
  } catch (e) {
    flash(`${label}: ${e.message}`, true);
  } finally {
    busy = false;
    // refresh() rebuilds the list, so `on` is usually detached by now and this
    // is a no-op. It matters on the path where it is not: an action that threw
    // leaves the original card in place, and a card left faded and dead after
    // a failure is a card nobody can retry.
    on?.classList.remove('working');
    document.querySelectorAll('button').forEach((b) => (b.disabled = false));
  }
}

// --- rendering -------------------------------------------------------------

const ICON = { deck: '🎞️', clip: '🎬', plan: '🗺️', card: '📰' };

// A media reference is `name.jpg` or `name.jpg?v=<mtime>`. The version is split
// out and sent as its own parameter rather than left in the filename, because
// the server takes the basename of `file` and would go looking for a file called
// "name.jpg?v=1727380000000".
//
// It exists so a re-rendered card cannot show its old picture: the filename is
// derived from the candidate id, so editing a headline writes over the same
// name, and the browser keeps serving what it already has. See mediaName in
// bot.js.
const split = (ref) => {
  const at = String(ref).lastIndexOf('?v=');
  return at < 0 ? { name: String(ref), v: null } : { name: String(ref).slice(0, at), v: String(ref).slice(at + 3) };
};
const media = (ref) => {
  const { name, v } = split(ref);
  return `/api/media?file=${encodeURIComponent(name)}${v ? `&v=${encodeURIComponent(v)}` : ''}`;
};

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

  const gone = (node, ref) => {
    node.replaceWith(el('div', { className: 'missing' }, [
      el('strong', { textContent: '⚠️ הקובץ לא נמצא' }),
      // The bare name. The version token is plumbing and would read as part of
      // the filename somebody is about to go looking for on the box.
      el('span', { textContent: split(ref).name }),
      el('span', { className: 'muted', textContent: 'קבצים ישנים נמחקים אחרי 30 יום' }),
    ]));
  };

  /*
    A placeholder stands in the picture's place until the picture can take it.

    The element is built detached and swapped in on `load`, so the strip is
    never partly drawn: a card with four slides used to lay out four zero-width
    boxes that snapped to full size one at a time as the files arrived, and on
    a phone that walks the buttons underneath out from under your thumb. The
    placeholder is the same 260px box the photograph will be, so the only thing
    that changes on arrival is what is inside it.

    `loading: 'lazy'` is kept. Its own point is that offscreen pictures in a
    long queue are never fetched at all, and those keep their placeholder until
    they are scrolled to, which is the honest thing for the page to show.
  */
  /*
    THE PICTURE GOES INSIDE ITS PLACEHOLDER, which is not the arrangement you
    would reach for first and is the only one that works.

    The obvious version builds the <img> detached, waits for `load`, and swaps
    it in. With `loading="lazy"` that deadlocks: a lazy image outside the
    document is never in any viewport, so the browser never starts the fetch,
    `load` never fires and the placeholder stays up forever. Nesting keeps the
    image in the document where laziness can do its job, clipped by the
    placeholder's own `overflow: hidden` until it has pixels to show.

    On arrival the image takes the placeholder's place in the strip, so the
    shimmer stops and the layout does not move: the slot is already exactly the
    260px box `.shots img` will occupy.
  */
  const slot = () => sk('sk-img');

  if (item.video) {
    const v = el('video', { src: media(item.video), controls: true, playsInline: true, preload: 'metadata' });
    const box2 = slot();
    // A video is ready at metadata. `load` is an image event and never fires
    // for a media element, so waiting on it here would hold the placeholder up
    // for the whole clip.
    v.addEventListener('loadedmetadata', () => box2.replaceWith(v), { once: true });
    v.addEventListener('error', () => gone(box2, item.video), { once: true });
    box2.append(v);
    box.append(box2);
  }
  for (const ref of item.images) {
    const img = el('img', { src: media(ref), loading: 'lazy', alt: '' });
    const box2 = slot();
    img.addEventListener('load', () => box2.replaceWith(img), { once: true });
    img.addEventListener('error', () => gone(box2, ref), { once: true });
    box2.append(img);
    box.append(box2);
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
          // Open first, fill second. The quotes come off disk and are usually
          // instant, but "usually" is what makes the slow case feel broken.
          openModal('ציטוטים', null);
          const res = await api(`/staging/${item.key}/evidence`).catch((e) => ({ said: e.message }));
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

/**
 * The modal, opened with its content or opened waiting for it.
 *
 * `body === null` means "this is still being fetched": the dialog opens
 * immediately with a skeleton in it rather than after the round trip. Opening
 * late is the worse of the two, because the tap appears to have missed and the
 * reader taps again.
 */
function openModal(title, body) {
  $('#modal-title').textContent = title;
  const pre = $('#modal-body');
  if (body === null) {
    pre.setAttribute('aria-busy', 'true');
    pre.replaceChildren(skPre(['w85', 'w70', 'w85', 'w55', 'w40']));
  } else {
    skDone(pre);
    pre.textContent = body;
  }
  if (!$('#modal').open) $('#modal').showModal();
}

function setCount(id, n) {
  const node = $(id);
  node.textContent = n;
  node.dataset.zero = n ? '0' : '1';
}

function draw() {
  if (!state) return;
  $('#who').textContent = state.me;

  // Present only when the lab is what is serving. The real bot never sets it, so
  // this banner appearing on the live site would itself be the bug.
  const lab = $('#lab-banner');
  lab.textContent = state.lab || '';
  lab.hidden = !state.lab;

  const have = state.pending.length + state.proposals.length;
  reapBuilding(have);

  // The tab counts what is here PLUS what is on its way, so the number and the
  // list agree. A badge reading 2 over a list showing three cards, one of them
  // a placeholder, is a page arguing with itself.
  setCount('#c-pending', have + building.length);
  setCount('#c-queue', state.queue.length);
  setCount('#c-held', state.held.length);

  const proposals = $('#proposals');
  proposals.replaceChildren(...state.proposals.map(proposalCard));

  const pending = $('#pending');
  pending.replaceChildren(
    // Newest first, and a thing being built is newer than anything already
    // here: it is the one the reader is waiting on.
    ...building.map(skBuildCard),
    ...(state.pending.length
      ? state.pending.map(pendingCard)
      : state.proposals.length || building.length
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
  // These three shipped with a skeleton inside them (index.html) and have just
  // been written over by the assignments above, so all that is left is to stop
  // announcing them as busy.
  for (const id of ['#status', '#health', '#usage']) skDone($(id));
}

async function refresh() {
  const data = await api('/state');
  if (!data.ok) return flash(data.said || 'לא הצלחתי לקרוא את המצב', true);
  state = data;
  $('#boot').hidden = true;
  $('#login').hidden = true;
  $('#app').hidden = false;
  draw();
  // The log only when its tab is open. It is the largest thing the API returns
  // and it is the one view nobody has open by default.
  if ($('[data-panel="system"]').hidden === false) await drawLog();
}

async function drawLog() {
  const pre = $('#log');
  // Only on the first open. After that the box already holds the last two
  // hundred lines, and greying them out every twenty seconds to fetch a nearly
  // identical list would make the log the most distracting thing on the page.
  skInto(pre, () => skPre(['w85', 'w70', 'w55', 'w85', 'w40', 'w70']));
  const { lines = [] } = await api('/log');
  skDone(pre);
  // An empty log needs to SAY it is empty. Left blank the box reads as still
  // loading, and skInto would agree with that reading and put the skeleton
  // back on the next visit.
  if (!lines.length) {
    pre.replaceChildren(el('span', { className: 'muted', textContent: 'אין שורות בלוג' }));
    return;
  }
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
  const submit = e.target.querySelector('button[type="submit"]');

  // The password check is a hash comparison and is deliberately not instant
  // (src/admin/auth.js). Left alone the form sits there looking untouched for
  // most of a second, which on a phone is long enough to press it twice.
  submit.disabled = true;
  const wait = sk('sk-line w85');
  submit.after(wait);

  const res = await api('/login', {
    method: 'POST',
    body: { name: form.get('name'), password: form.get('password') },
  }).catch((err) => ({ ok: false, said: err.message }));

  wait.remove();
  submit.disabled = false;

  const err = $('#login-error');
  if (!res.ok) {
    err.textContent = res.said || 'לא הצלחתי להיכנס';
    err.hidden = false;
    return;
  }
  err.hidden = true;
  e.target.reset();
  // Straight to the boot skeleton rather than sitting on a filled-in login form
  // while the first /state is fetched. It is the same shell the page opens on,
  // so signing in and reloading look identical from here on.
  $('#login').hidden = true;
  $('#boot').hidden = false;
  await refresh().catch(showLogin);
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
      // Empty means no budget at all, which is a different plan rather than a
      // plan with a budget of zero: the itinerary comes back priced on
      // entrances only, exactly as it did before this field existed.
      body.budget = Number($('#trip-budget').value) || null;
    }
    return act('בנייה', async () => {
      const res = await api('/build', { method: 'POST', body });
      // Only once the server has actually taken the job. A placeholder put up
      // before the call would survive a rejected build as a chair for a guest
      // who was turned away at the door.
      //
      // A shoot gets none: it ends at a Telegram message and never reaches the
      // pending list, so its placeholder would have nothing to clear it and
      // would sit out its full fifteen minutes every time.
      if (res.ok !== false && BUILD_HE[what]) {
        const n = Math.max(1, Number(body.count) || 1);
        for (let i = 0; i < n; i++) {
          building.push({ what, at: Date.now() + i, mark: (state?.pending.length || 0) + (state?.proposals.length || 0) });
        }
        // Onto the tab the work will land on, so the placeholder is not put up
        // behind whichever panel happened to be open.
        document.querySelector('nav button[data-tab="pending"]')?.click();
      }
      return res;
    });
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
