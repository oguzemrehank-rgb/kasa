// Ortak arayüz parçaları: bildirim, pencere, onay, kopyalama, ayarlar.

import { h, icon } from './util.js';

export const prefs = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('kasa.' + key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem('kasa.' + key, JSON.stringify(value)); } catch { /* özel pencere */ }
  },
};

export function iconBtn(name, label, onclick, cls = '') {
  return h('button', { class: ('icon-btn ' + cls).trim(), type: 'button', 'aria-label': label, title: label, onclick }, icon(name));
}

export function toast(msg, kind = '') {
  // Açık bir pencere varsa bildirim onun üstünde görünsün diye içine eklenir.
  const host = document.querySelector('dialog[open]') || document.body;
  let wrap = host.querySelector(':scope > .toasts');
  if (!wrap) {
    wrap = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    host.appendChild(wrap);
  }
  const t = h('div', { class: ('toast ' + kind).trim(), text: msg });
  wrap.appendChild(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 250);
  }, kind === 'error' ? 4500 : 2600);
}

export function modal({ title, body, actions = [], cls = '' }) {
  const dlg = h('dialog', { class: ('modal ' + cls).trim() });
  let closed = false;
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  const close = (value) => {
    if (closed) return;
    closed = true;
    try { dlg.close(); } catch { /* zaten kapalı */ }
    dlg.remove();
    resolveDone(value);
  };
  dlg._close = close;
  const head = h('div', { class: 'modal-head' },
    h('h2', { text: title }),
    iconBtn('x', 'Kapat', () => close(null)));
  const foot = actions.length
    ? h('div', { class: 'modal-foot' }, actions.map((a) =>
      h('button', {
        class: ('btn ' + (a.cls || '')).trim(),
        type: 'button',
        onclick: () => (a.onclick ? a.onclick(close) : close(a.value)),
      }, a.icon ? icon(a.icon) : null, a.label)))
    : null;
  dlg.append(head, h('div', { class: 'modal-body' }, body));
  if (foot) dlg.append(foot);
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(null); });
  document.body.appendChild(dlg);
  dlg.showModal();
  return { el: dlg, close, done };
}

export function closeDialogs() {
  document.querySelectorAll('dialog').forEach((d) => (d._close ? d._close(null) : d.remove()));
}

export function confirmBox(message, { title = 'Emin misin?', ok = 'Evet', cancel = 'Vazgeç', danger = false } = {}) {
  const m = modal({
    title,
    body: h('p', { class: 'pre', text: message }),
    actions: [
      { label: cancel, cls: 'ghost', value: false },
      { label: ok, cls: danger ? 'danger solid' : 'primary', value: true },
    ],
  });
  return m.done.then((v) => v === true);
}

export function promptBox({ title, message = '', label = '', type = 'text', ok = 'Tamam', placeholder = '', mono = false }) {
  const input = h('input', {
    class: 'input' + (mono ? ' mono' : ''), type, placeholder,
    autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off',
  });
  let m;
  const submit = () => m.close(input.value);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
  });
  m = modal({
    title,
    body: [
      message ? h('p', { class: 'muted pre', text: message }) : null,
      label ? h('label', { class: 'lbl', text: label }) : null,
      input,
    ],
    actions: [
      { label: 'Vazgeç', cls: 'ghost', value: null },
      { label: ok, cls: 'primary', onclick: submit },
    ],
  });
  setTimeout(() => input.focus(), 40);
  return m.done.then((v) => v || null);
}

let clipTimer = 0;
export async function copyText(text, { secret = false, what = 'Kopyalandı' } = {}) {
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    const ta = h('textarea', { class: 'offscreen' });
    ta.value = text;
    (document.querySelector('dialog[open]') || document.body).appendChild(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch { /* desteklenmiyor */ }
    ta.remove();
  }
  if (!ok) return toast('Kopyalanamadı', 'error');
  const sec = Number(prefs.get('clip', 30));
  if (secret && sec > 0) {
    clearTimeout(clipTimer);
    clipTimer = setTimeout(() => { navigator.clipboard?.writeText('').catch(() => {}); }, sec * 1000);
    toast(`${what} · ${sec} sn sonra panodan silinecek`);
  } else {
    toast(what);
  }
}

export async function busy(btn, fn, text = 'Lütfen bekle…') {
  const old = [...btn.childNodes];
  btn.disabled = true;
  btn.replaceChildren(h('span', { class: 'spinner' }), text);
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    btn.replaceChildren(...old);
  }
}
