// The desk's only script. Copy, open, and buttons that POST.
//
// Nothing here sends anything anywhere but the desk itself: [העתק ופתח] puts
// the text on the clipboard and opens a tab, and the owner pastes and sends.

// The guard is for the selftest, which loads every .js under src/ in Node to
// prove it parses. In a browser `document` is always there.
if (typeof document !== 'undefined') (() => {
  const token = document.querySelector('meta[name="growth-token"]')?.content || '';
  const toastEl = document.getElementById('toast');
  let toastTimer = null;

  const toast = (msg, bad = false) => {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.className = `show${bad ? ' bad' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.className = ''), bad ? 5000 : 1800);
  };

  async function post(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-growth-token': token },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  const textOf = (sel) => {
    const el = document.querySelector(sel);
    return el ? ('value' in el ? el.value : el.textContent) : '';
  };

  // Synchronous copy first: it runs inside the click, before the new tab takes
  // focus, which is when the async clipboard API tends to refuse.
  function copy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    if (!ok && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => toast('ההעתקה נכשלה', true));
    }
    return true;
  }

  const reload = () => location.reload();

  document.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const d = b.dataset;

    try {
      if (d.copy) {
        copy(textOf(d.copy));
        toast('הועתק');
        return;
      }
      if (d.copyOpen) {
        copy(textOf(d.copyOpen));
        if (d.href) window.open(d.href, '_blank', 'noopener');
        toast('הועתק. הדבק ושלח בעצמך');
        return;
      }
      if (d.confirm && !b.classList.contains('armed')) {
        b.classList.add('armed');
        b.dataset.label = b.textContent;
        b.textContent = d.confirm;
        setTimeout(() => {
          b.classList.remove('armed');
          b.textContent = b.dataset.label;
        }, 4000);
        return;
      }
      if (d.act) {
        b.disabled = true;
        await post(`/api/lead/${encodeURIComponent(d.lead)}/action`, { action: d.act, postId: d.post || null, gender: d.gender || null, field: d.field || null });
        reload();
        return;
      }
      if (d.edit) {
        const ta = document.querySelector(d.edit);
        if (!ta) return;
        if (ta.readOnly) {
          ta.readOnly = false;
          ta.classList.add('editing');
          ta.focus();
          b.textContent = 'שמור';
          return;
        }
        await post(`/api/lead/${encodeURIComponent(d.lead)}/action`, { action: 'edit', field: d.field, text: ta.value });
        reload();
        return;
      }
      if (d.redraft) {
        b.disabled = true;
        b.textContent = 'מנסח...';
        await post(`/api/lead/${encodeURIComponent(d.lead)}/redraft`, { what: d.redraft, postId: d.post || null });
        reload();
        return;
      }
      if (d.saveTemplate) {
        await post('/api/templates', { name: d.saveTemplate, text: textOf(`#tpl-${d.saveTemplate}`) });
        toast('התבנית נשמרה');
        setTimeout(reload, 600);
        return;
      }
      if (d.resetSettings) {
        if (!b.classList.contains('armed')) {
          b.classList.add('armed');
          b.textContent = 'בטוח? לחץ שוב';
          return;
        }
        await post('/api/settings', { reset: true });
        reload();
        return;
      }
      if (b.id === 'run') {
        b.disabled = true;
        b.textContent = 'מחפש...';
        await post('/api/run', {});
        poll();
      }
    } catch (err) {
      b.disabled = false;
      toast(err.message, true);
    }
  });

  // Settings: every named field, as JSON. Dotted names become nested objects;
  // a textarea marked data-lines becomes a list, one entry per line.
  const form = document.getElementById('settings');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const out = {};
      for (const el of form.elements) {
        if (!el.name) continue;
        let v;
        if (el.type === 'checkbox') v = el.checked;
        else if (el.type === 'number') v = Number(el.value);
        else if (el.dataset.lines) v = el.value.split('\n').map((s) => s.trim()).filter(Boolean);
        else v = el.value.trim();
        const path = el.name.split('.');
        let o = out;
        while (path.length > 1) {
          const key = path.shift();
          o = o[key] ??= {};
        }
        o[path[0]] = v;
      }
      try {
        await post('/api/settings', { settings: out });
        toast('נשמר');
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  // While a run is going, check every few seconds and reload when it ends.
  async function poll() {
    try {
      const s = await fetch('/api/status').then((r) => r.json());
      if (s.running) return setTimeout(poll, 3000);
      reload();
    } catch {
      setTimeout(poll, 5000);
    }
  }
  if (document.querySelector('#run[data-running]')) poll();
})();
