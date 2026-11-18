// Kasa arayüzü: kurulum, kilit ekranı, liste, kayıt detayı, düzenleme, ayarlar.

import { h, icon, uid, fmtDate, fmtRel, fmtSize, download } from './util.js';
import { toast, modal, closeDialogs, confirmBox, promptBox, copyText, iconBtn, busy, prefs } from './ui.js';
import * as store from './store.js';
import { TYPES, KINDS, typeOf, subtitle, safeUrl } from './types.js';
import { buildIndex, search, similar, normTag } from './search.js';
import { generate, strength } from './gen.js';
import { parseOtp, totpCode, secondsLeft } from './totp.js';
import { WrongSecretError, isRecoveryKeyShape } from './crypto.js';

const VERSION = '1.0.0';
const app = document.getElementById('app');
const ui = { tab: 'B', query: '', tag: null, setup: null, unlockMode: 'password', mainScroll: 0 };
let view = { name: '', refresh: null, guard: false };
let cleanup = [];
let index = null;

const idx = () => index || (index = buildIndex(store.live()));

store.on((ev) => {
  if (ev === 'data') {
    index = null;
    scheduleRefresh();
  } else if (ev === 'status') {
    paintSync();
  } else if (ev === 'lock') {
    route();
  }
});

// ---------------------------------------------------------------- yönlendirme

function go(path, replace = false, extra = {}) {
  if (view.name === 'main') ui.mainScroll = window.scrollY;
  const url = '#/' + path;
  if (replace) history.replaceState({ ...(history.state || {}), ...extra }, '', url);
  else history.pushState({ kasa: true, ...extra }, '', url);
  route();
}

function goBack() {
  if (history.state && history.state.kasa) history.back();
  else go('', true);
}

window.addEventListener('popstate', () => {
  closeDialogs();
  route();
});

function runCleanup() {
  for (const f of cleanup.splice(0)) {
    try { f(); } catch { /* yok say */ }
  }
}

function route() {
  runCleanup();
  if (ui.setup && ui.setup.step === 'recovery') return viewSetup();
  if (!store.hasVault()) return viewSetup();
  if (!store.isUnlocked()) return viewLock();
  const [a, b, c] = location.hash.replace(/^#\/?/, '').split('/');
  if (!a) return viewMain();
  if (a === 'r' && b) return viewDetail(b);
  if (a === 'edit' && b) return viewEdit(b, null);
  if (a === 'new' && b) return viewEdit(null, b);
  if (a === 'settings' && b === 'password') return viewPassword(c === 'forced');
  if (a === 'settings') return viewSettings();
  if (a === 'trash') return viewTrash();
  return viewMain();
}

function mount(name, el, { refresh = null, guard = false, scroll = true } = {}) {
  view = { name, refresh, guard };
  app.replaceChildren(el);
  if (scroll) window.scrollTo(0, name === 'main' ? ui.mainScroll : 0);
}

let refreshQueued = false;
function scheduleRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(() => {
    refreshQueued = false;
    if (!view.refresh || !store.isUnlocked() || document.querySelector('dialog[open]')) return;
    const a = document.activeElement;
    if (view.guard && a && app.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
    view.refresh();
  });
}

// ---------------------------------------------------------------- ortak parçalar

function logo(size = '') {
  return h('span', { class: ('logo ' + size).trim() }, icon('lock'));
}

function topbar({ title = '', back = false, onBack = null, actions = [], brand = false }) {
  return h('header', { class: 'topbar' }, h('div', { class: 'bar' },
    back ? iconBtn('back', 'Geri', onBack || goBack) : null,
    brand
      ? h('div', { class: 'brand' }, logo('sm'), h('span', { text: 'Kasa' }), store.DEMO ? h('span', { class: 'pill pill-demo', text: 'DEMO' }) : null)
      : h('h1', { class: 'top-title', text: title }),
    h('div', { class: 'top-actions' }, actions)));
}

function card(title, ...body) {
  return h('section', { class: 'card' }, title ? h('h2', { class: 'card-title', text: title }) : null, body);
}

function empty(ic, title, text) {
  return h('div', { class: 'empty' }, icon(ic, 'lg'), h('h3', { text: title }), h('p', { text }));
}

const SYNC = {
  idle: ['', 'cloud'],
  syncing: ['Eşitleniyor', 'refresh'],
  saved: ['Kaydedildi', 'cloud'],
  pending: ['Gönderilecek', 'cloud'],
  offline: ['Çevrimdışı', 'cloudOff'],
  auth: ['Token sorunu', 'cloudOff'],
  error: ['Eşitleme hatası', 'cloudOff'],
};

function syncPill() {
  const el = h('button', { class: 'sync', id: 'sync', type: 'button', onclick: onSyncClick });
  paintSync(el);
  return el;
}

function paintSync(el = document.getElementById('sync')) {
  if (!el) return;
  const st = store.state();
  const [text, ic] = SYNC[st.status] || SYNC.idle;
  el.className = 'sync s-' + st.status;
  el.title = st.msg || text;
  el.setAttribute('aria-label', 'Eşitleme durumu: ' + text);
  el.replaceChildren(icon(ic, 'sm'), h('span', { text }));
}

function onSyncClick() {
  const st = store.state();
  if (st.status === 'auth') {
    toast(st.msg, 'error');
    return go('settings');
  }
  if (st.msg && (st.status === 'error' || st.status === 'offline')) toast(st.msg, st.status === 'error' ? 'error' : '');
  store.sync();
}

function secretInput(props = {}) {
  const input = h('input', {
    class: 'input mono', type: 'password', autocomplete: 'new-password', spellcheck: 'false', autocapitalize: 'off', ...props,
  });
  const eye = iconBtn('eye', 'Göster', () => show(input.type === 'password'));
  function show(on) {
    input.type = on ? 'text' : 'password';
    eye.replaceChildren(icon(on ? 'eyeOff' : 'eye'));
    eye.setAttribute('aria-label', on ? 'Gizle' : 'Göster');
  }
  return { input, eye, show, wrap: h('div', { class: 'input-wrap' }, input, eye) };
}

function strengthMeter() {
  const bar = h('span');
  const label = h('span', { class: 'meter-label' });
  const el = h('div', {}, h('div', { class: 'meter' }, bar), label);
  return {
    el,
    set(pw) {
      const s = strength(pw);
      bar.className = 'm' + s.score;
      bar.style.width = pw ? `${(s.score + 1) * 20}%` : '0';
      label.textContent = pw ? `Güç: ${s.label}` : '';
      return s;
    },
  };
}

function ensureTagList() {
  let dl = document.getElementById('tag-list');
  if (!dl) {
    dl = h('datalist', { id: 'tag-list' });
    document.body.appendChild(dl);
  }
  const tags = new Set();
  for (const r of store.live()) for (const t of r.tags || []) tags.add(t);
  dl.replaceChildren(...[...tags].sort((a, b) => a.localeCompare(b, 'tr')).map((t) => h('option', { value: t })));
}

function tagEditor(initial) {
  let tags = [...(initial || [])];
  const chips = h('span', { class: 'tag-chips' });
  const input = h('input', {
    class: 'tag-in', placeholder: 'etiket yaz, Enter', list: 'tag-list', autocapitalize: 'off', enterkeyhint: 'enter', 'aria-label': 'Etiket ekle',
  });
  const wrap = h('div', { class: 'tags-ed', onclick: (e) => { if (e.target === wrap) input.focus(); } }, chips, input);
  function add(raw) {
    for (const part of String(raw).split(',')) {
      const t = normTag(part);
      if (t && !tags.includes(t)) tags.push(t);
    }
  }
  function take() {
    if (input.value.trim()) {
      add(input.value);
      input.value = '';
      paint();
    }
  }
  function paint() {
    chips.replaceChildren(...tags.map((t) => h('span', { class: 'tag' }, '#' + t,
      h('button', { type: 'button', 'aria-label': `${t} etiketini kaldır`, onclick: () => { tags = tags.filter((x) => x !== t); paint(); } }, icon('x', 'sm')))));
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      take();
    } else if (e.key === 'Backspace' && !input.value && tags.length) {
      tags.pop();
      paint();
    }
  });
  input.addEventListener('input', () => { if (input.value.includes(',')) take(); });
  input.addEventListener('blur', take);
  paint();
  ensureTagList();
  return { el: wrap, get: () => { take(); return [...tags]; } };
}

function itemIcon(r, cls = '') {
  return h('span', { class: `item-ic t-${r.type} ${cls}`.trim() }, icon(typeOf(r).icon, cls === 'sm' ? 'sm' : ''));
}

function itemRow(r, showStage) {
  const sub = subtitle(r);
  return h('button', { class: 'item', type: 'button', onclick: () => go('r/' + r.id) },
    itemIcon(r),
    h('span', { class: 'item-main' },
      h('span', { class: 'item-title', text: r.title || '(başlıksız)' }),
      sub ? h('span', { class: 'item-sub', text: sub }) : null),
    h('span', { class: 'item-meta' },
      showStage && r.stage === 'A' ? h('span', { class: 'pill pill-a', text: 'Onay bekliyor' }) : null,
      !showStage && r.stage === 'A' ? h('span', { class: 'small', text: fmtRel(r.createdAt) }) : null,
      (r.fields || []).some((f) => f.kind === 'totp' && f.value) ? icon('clock', 'sm') : null,
      (r.attachments || []).length ? icon('clip', 'sm') : null));
}

function miniRow(o, action) {
  return h('div', { class: 'mini' },
    h('button', { class: 'mini-main', type: 'button', onclick: () => go('r/' + o.id) },
      itemIcon(o, 'sm'),
      h('span', { class: 'mini-title', text: o.title || '(başlıksız)' }),
      o.stage === 'A' ? h('span', { class: 'pill pill-a', text: 'Onay bekliyor' }) : null),
    action);
}

// ---------------------------------------------------------------- kurulum

function viewSetup() {
  const s = ui.setup || (ui.setup = {
    step: 'welcome', mode: 'new', owner: store.DEMO ? 'demo' : '', repo: 'kasa-veri', token: '',
  });
  const steps = { welcome: setupWelcome, connect: setupConnect, password: setupPassword, recovery: setupRecovery, join: setupJoin };
  mount('setup', h('main', { class: 'page narrow' }, (steps[s.step] || setupWelcome)(s)));
}

function setStep(step) {
  ui.setup.step = step;
  viewSetup();
}

function setupWelcome(s) {
  return [
    h('div', { class: 'hero' }, logo('xl'),
      h('h1', { class: 'hero-title', text: 'Kasa' }),
      h('p', { class: 'lead', text: 'Şifrelerin ve unutmaman gereken bilgilerin için kişisel, şifreli kasa.' })),
    store.DEMO ? h('div', { class: 'banner warn' }, icon('spark'), h('span', { text: 'Deneme modu: veriler sadece bu tarayıcıda durur, GitHub kullanılmaz.' })) : null,
    h('div', { class: 'stack' },
      h('button', { class: 'btn primary block', onclick: () => { s.mode = 'new'; setStep('connect'); } }, icon('plus'), 'Yeni kasa oluştur'),
      h('button', { class: 'btn block', onclick: () => { s.mode = 'join'; setStep('connect'); } }, icon('link'), 'Başka cihazda oluşturduğum kasaya bağlan')),
    h('ul', { class: 'facts' },
      h('li', {}, icon('shield', 'sm'), 'Bilgilerin bu cihazda ana şifrenle şifrelenir. GitHub\'a sadece okunamayan, şifreli hali gider.'),
      h('li', {}, icon('inbox', 'sm'), 'Yeni bilgiler önce “Onay bekleyen”e düşer; açıklamasını yazıp onayladığında kasaya geçer.'),
      h('li', {}, icon('search', 'sm'), 'Akıllı arama: Türkçe karakter, yazım hatası ve ilişkili kelimeleri tanır.')),
  ];
}

function setupConnect(s) {
  const owner = h('input', { class: 'input', value: s.owner, placeholder: 'GitHub kullanıcı adın', autocapitalize: 'off', spellcheck: 'false', autocomplete: 'off' });
  const repo = h('input', { class: 'input', value: s.repo, placeholder: 'kasa-veri', autocapitalize: 'off', spellcheck: 'false', autocomplete: 'off' });
  const token = secretInput({ value: s.token, placeholder: 'github_pat_…', autocomplete: 'off' });
  const err = h('p', { class: 'error', role: 'alert' });
  const btn = h('button', { class: 'btn primary block', onclick: next }, 'Devam', icon('back', 'flip'));

  async function next() {
    s.owner = owner.value.trim();
    s.repo = repo.value.trim();
    s.token = token.input.value.trim();
    err.textContent = '';
    if (!store.DEMO && (!s.owner || !s.repo || !s.token)) {
      err.textContent = 'Üç alanı da doldurmalısın.';
      return;
    }
    await busy(btn, async () => {
      try {
        const { repoObj, existing } = await store.checkRepo(s.owner, s.repo, s.token);
        if (s.mode === 'new' && existing) {
          err.textContent = 'Bu depoda zaten bir kasa var. Geri dönüp “Başka cihazda oluşturduğum kasaya bağlan”ı seç.';
          return;
        }
        if (s.mode === 'join' && !existing) {
          err.textContent = 'Bu depoda kasa bulunamadı. Önce “Yeni kasa oluştur” ile kurmalısın.';
          return;
        }
        s.repoObj = repoObj;
        s.existing = existing;
        setStep(s.mode === 'new' ? 'password' : 'join');
      } catch (e) {
        err.textContent = e.message;
      }
    }, 'Bağlantı kontrol ediliyor…');
  }

  return [
    topbar({ back: true, onBack: () => setStep('welcome'), title: 'GitHub bağlantısı' }),
    h('p', { class: 'lead', text: s.mode === 'new'
      ? 'Şifreli veriler senin gizli (private) GitHub deponda duracak.'
      : 'Kasanın durduğu gizli depoyu ve bu cihaz için bir token gir.' }),
    store.DEMO
      ? h('div', { class: 'banner warn' }, icon('spark'), h('span', { text: 'Deneme modunda token gerekmez, “Devam”a bas.' }))
      : [
        h('label', { class: 'lbl', text: 'GitHub kullanıcı adı' }), owner,
        h('label', { class: 'lbl', text: 'Veri deposu (gizli)' }), repo,
        h('label', { class: 'lbl', text: 'Erişim anahtarı (token)' }), token.wrap,
        h('details', { class: 'help' },
          h('summary', { text: 'Token nasıl alınır?' }),
          h('ol', {},
            h('li', {}, 'GitHub\'da ', h('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener noreferrer', text: 'yeni token sayfasını' }), ' aç (Fine-grained token).'),
            h('li', { text: 'Token name: "kasa", Expiration: en uzun süreyi seç.' }),
            h('li', { text: 'Repository access → Only select repositories → sadece "kasa-veri".' }),
            h('li', { text: 'Permissions → Repository permissions → Contents: "Read and write".' }),
            h('li', { text: '"Generate token"a bas, çıkan kodu kopyalayıp buraya yapıştır.' }))),
      ],
    err,
    btn,
  ];
}

function setupPassword(s) {
  const pw1 = secretInput({ placeholder: 'Ana şifre', autocomplete: 'new-password' });
  const pw2 = secretInput({ placeholder: 'Ana şifre (tekrar)', autocomplete: 'new-password' });
  const meter = strengthMeter();
  pw1.input.addEventListener('input', () => meter.set(pw1.input.value));
  const err = h('p', { class: 'error', role: 'alert' });
  const btn = h('button', { class: 'btn primary block', onclick: create }, icon('lock'), 'Kasayı oluştur');

  async function create() {
    const a = pw1.input.value;
    err.textContent = '';
    if (a.length < 10) { err.textContent = 'Ana şifre en az 10 karakter olmalı.'; return; }
    if (meter.set(a).score < 2) { err.textContent = 'Bu şifre çok tahmin edilebilir. Birkaç kelimeden oluşan uzun bir cümle dene.'; return; }
    if (a !== pw2.input.value) { err.textContent = 'İki şifre birbirini tutmuyor.'; return; }
    await busy(btn, async () => {
      try {
        s.recovery = await store.createVault({ owner: s.owner, repo: s.repo, token: s.token, repoObj: s.repoObj }, a);
        s.token = '';
        setStep('recovery');
      } catch (e) {
        err.textContent = e.message;
      }
    }, 'Kasa oluşturuluyor…');
  }

  return [
    topbar({ back: true, onBack: () => setStep('connect'), title: 'Ana şifre' }),
    h('div', { class: 'banner warn' }, icon('key'), h('span', { text: 'Bu şifreyi unutursan kasayı sadece kurtarma anahtarıyla açabilirsin. Şifreni kimse (GitHub dahil) sıfırlayamaz.' })),
    h('label', { class: 'lbl', text: 'Ana şifre' }), pw1.wrap, meter.el,
    h('label', { class: 'lbl', text: 'Ana şifre (tekrar)' }), pw2.wrap,
    h('p', { class: 'hint', text: 'İpucu: sadece senin bildiğin, 4-5 kelimelik bir cümle hem güçlü hem kolay hatırlanır.' }),
    err,
    btn,
  ];
}

function recoveryBlock(rk) {
  const groups = rk.split('-');
  return [
    h('div', { class: 'rk mono', 'aria-label': rk },
      h('div', { text: groups.slice(0, 4).join('-') }),
      h('div', { text: groups.slice(4).join('-') })),
    h('div', { class: 'row center' },
      h('button', { class: 'btn sm', onclick: () => copyText(rk, { secret: true, what: 'Kurtarma anahtarı kopyalandı' }) }, icon('copy', 'sm'), 'Kopyala')),
  ];
}

function setupRecovery(s) {
  const ok = h('input', { type: 'checkbox' });
  const btn = h('button', { class: 'btn primary block', disabled: true, onclick: () => {
    ui.setup = null;
    history.replaceState(null, '', '#/');
    route();
  } }, 'Kasayı aç');
  ok.addEventListener('change', () => { btn.disabled = !ok.checked; });
  return [
    h('div', { class: 'hero compact' }, icon('key', 'lg accent'), h('h1', { class: 'hero-title', text: 'Kurtarma anahtarın' })),
    h('p', { class: 'lead', text: 'Ana şifreni unutursan kasanı sadece bu anahtarla açabilirsin. Kâğıda yaz ve güvenli bir yerde sakla. Ekran görüntüsü olarak telefonda tutma.' }),
    recoveryBlock(s.recovery),
    h('label', { class: 'check big' }, ok, 'Kurtarma anahtarını kâğıda yazdım'),
    btn,
  ];
}

function setupJoin(s) {
  let mode = 'password';
  const input = secretInput({ placeholder: 'Ana şifre', autocomplete: 'current-password' });
  const label = h('label', { class: 'lbl', text: 'O kasanın ana şifresi' });
  const err = h('p', { class: 'error', role: 'alert' });
  const btn = h('button', { class: 'btn primary block', onclick: submit }, icon('unlock'), 'Bağlan ve aç');
  const toggle = h('button', { class: 'linkbtn', type: 'button', onclick: () => {
    mode = mode === 'password' ? 'recovery' : 'password';
    label.textContent = mode === 'password' ? 'O kasanın ana şifresi' : 'Kurtarma anahtarı';
    input.input.placeholder = mode === 'password' ? 'Ana şifre' : 'XXXX-XXXX-XXXX-…';
    toggle.textContent = mode === 'password' ? 'Ana şifreyi unuttum: kurtarma anahtarıyla aç' : 'Ana şifreyle aç';
    input.input.value = '';
    input.input.focus();
  } }, 'Ana şifreyi unuttum: kurtarma anahtarıyla aç');
  input.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  async function submit() {
    if (!input.input.value) return input.input.focus();
    err.textContent = '';
    await busy(btn, async () => {
      try {
        await store.connectVault({ owner: s.owner, repo: s.repo, token: s.token, repoObj: s.repoObj, existing: s.existing }, input.input.value, mode);
        ui.setup = null;
        if (mode === 'recovery') go('settings/password/forced', true);
        else { history.replaceState(null, '', '#/'); route(); }
      } catch (e) {
        err.textContent = e instanceof WrongSecretError ? (mode === 'password' ? 'Şifre yanlış.' : 'Kurtarma anahtarı yanlış.') : e.message;
      }
    }, 'Kasa açılıyor…');
  }

  return [
    topbar({ back: true, onBack: () => setStep('connect'), title: 'Kasaya bağlan' }),
    h('p', { class: 'lead', text: 'Kasa bulundu. Açmak için ana şifreni gir.' }),
    label, input.wrap, err, btn,
    h('div', { class: 'center' }, toggle),
  ];
}

// ---------------------------------------------------------------- kilit ekranı

function viewLock() {
  const mode = ui.unlockMode;
  const field = secretInput({
    placeholder: mode === 'recovery' ? 'XXXX-XXXX-XXXX-…' : 'Ana şifre',
    autocomplete: mode === 'recovery' ? 'off' : 'current-password',
  });
  const err = h('p', { class: 'error', role: 'alert' });
  const btn = h('button', { class: 'btn primary block', onclick: submit }, icon('unlock'), 'Kilidi aç');
  field.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  async function submit() {
    const secret = field.input.value;
    if (!secret) return field.input.focus();
    if (mode === 'recovery' && !isRecoveryKeyShape(secret)) {
      err.textContent = 'Kurtarma anahtarı 32 karakter olmalı (XXXX-XXXX-… biçiminde).';
      return;
    }
    err.textContent = '';
    await busy(btn, async () => {
      try {
        await store.unlock(secret, mode);
        field.input.value = '';
        if (mode === 'recovery') {
          ui.unlockMode = 'password';
          go('settings/password/forced', true);
        } else {
          route();
        }
      } catch (e) {
        err.textContent = e instanceof WrongSecretError
          ? (mode === 'recovery' ? 'Kurtarma anahtarı yanlış.' : 'Şifre yanlış.')
          : (e.message || 'Kasa açılamadı.');
        field.input.select();
      }
    }, 'Açılıyor…');
  }

  const conn = store.connection();
  const page = h('main', { class: 'page narrow' },
    h('div', { class: 'hero' }, logo('xl'),
      h('h1', { class: 'hero-title', text: 'Kasa kilitli' }),
      h('p', { class: 'lead', text: mode === 'recovery' ? 'Kurtarma anahtarını gir.' : 'Devam etmek için ana şifreni gir.' })),
    field.wrap, err, btn,
    h('div', { class: 'center' },
      h('button', { class: 'linkbtn', type: 'button', onclick: () => { ui.unlockMode = mode === 'recovery' ? 'password' : 'recovery'; viewLock(); } },
        mode === 'recovery' ? 'Ana şifreyle aç' : 'Ana şifreyi unuttum: kurtarma anahtarıyla aç')),
    conn ? h('p', { class: 'foot-note', text: conn.demo ? 'Deneme modu (veriler sadece bu tarayıcıda)' : `GitHub: ${conn.owner}/${conn.repo}` }) : null);
  mount('lock', page);
  setTimeout(() => field.input.focus(), 60);
}

// ---------------------------------------------------------------- ana liste

function viewMain() {
  const searchIn = h('input', {
    class: 'search', type: 'search', value: ui.query, placeholder: 'Ara: internet, banka, netflix…',
    autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search', 'aria-label': 'Kasada ara',
  });
  const clearBtn = iconBtn('x', 'Aramayı temizle', () => {
    ui.query = '';
    searchIn.value = '';
    paint();
    searchIn.focus();
  });
  searchIn.addEventListener('input', () => {
    ui.query = searchIn.value;
    paint();
  });
  searchIn.addEventListener('keydown', (e) => { if (e.key === 'Escape') clearBtn.click(); });

  const tabsEl = h('div', { class: 'tabs', role: 'tablist' });
  const chipsEl = h('div', { class: 'chips' });
  const infoEl = h('div', { class: 'list-info' });
  const listEl = h('div', { class: 'list' });

  function tabBtn(key, label, n) {
    const on = ui.tab === key;
    return h('button', {
      class: 'tab' + (on ? ' on' : ''), type: 'button', role: 'tab', 'aria-selected': String(on),
      onclick: () => { ui.tab = key; ui.tag = null; paint(); },
    }, icon(key === 'A' ? 'inbox' : 'vault', 'sm'), label, h('span', { class: 'count' + (key === 'A' && n ? ' warn' : ''), text: n }));
  }

  function paint() {
    const recs = store.live();
    const A = recs.filter((r) => r.stage === 'A');
    const B = recs.filter((r) => r.stage !== 'A');
    clearBtn.hidden = !ui.query;
    const q = ui.query.trim();

    if (q) {
      tabsEl.hidden = true;
      chipsEl.hidden = true;
      const { results, partial } = search(idx(), q);
      infoEl.textContent = results.length ? `${results.length} sonuç${partial ? ' · tüm kelimeleri içeren yok, yakın sonuçlar' : ''}` : '';
      listEl.replaceChildren(...(results.length
        ? results.map((x) => itemRow(x.r, true))
        : [empty('search', 'Sonuç bulunamadı', 'Başka bir kelime dene. Yazım hataları ve Türkçe karakterler sorun değil.')]));
      return;
    }

    tabsEl.hidden = false;
    tabsEl.replaceChildren(tabBtn('B', 'Kasa', B.length), tabBtn('A', 'Onay bekleyen', A.length));
    const pool = ui.tab === 'A' ? A : B;
    const counts = new Map();
    for (const r of pool) for (const t of r.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
    if (ui.tag && !counts.has(ui.tag)) ui.tag = null;
    const tags = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'tr'));
    chipsEl.hidden = !tags.length;
    chipsEl.replaceChildren(...tags.map(([t, n]) => h('button', {
      class: 'chip' + (ui.tag === t ? ' on' : ''), type: 'button',
      onclick: () => { ui.tag = ui.tag === t ? null : t; paint(); },
    }, '#' + t, h('span', { class: 'chip-n', text: n }))));

    let list = ui.tag ? pool.filter((r) => (r.tags || []).includes(ui.tag)) : pool;
    list = ui.tab === 'A'
      ? list.sort((a, b) => b.createdAt - a.createdAt)
      : list.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'tr'));
    infoEl.textContent = '';
    listEl.replaceChildren(...(list.length ? list.map((r) => itemRow(r, false)) : [ui.tab === 'A'
      ? empty('inbox', 'Onay bekleyen kayıt yok', 'Yeni eklediğin bilgiler önce buraya düşer. Açıklamasını yazıp onayladığında kasaya geçer.')
      : empty('vault', 'Kasan henüz boş', 'Sağ alttaki + ile ilk bilgini ekle. Önce “Onay bekleyen”e düşer, onayladığında burada görünür.')]));
  }

  const page = h('div', { class: 'shell' },
    topbar({
      brand: true,
      actions: [
        syncPill(),
        iconBtn('dice', 'Şifre üret', () => openGenerator(null)),
        iconBtn('settings', 'Ayarlar', () => go('settings')),
        iconBtn('lock', 'Kilitle', doLock),
      ],
    }),
    h('main', { class: 'page' },
      h('div', { class: 'search-wrap' }, icon('search'), searchIn, clearBtn),
      tabsEl, chipsEl, infoEl, listEl),
    h('button', { class: 'fab', type: 'button', 'aria-label': 'Yeni kayıt', title: 'Yeni kayıt', onclick: openNewSheet }, icon('plus')));
  paint();
  mount('main', page, { refresh: paint });
}

function openNewSheet() {
  let m;
  const grid = h('div', { class: 'type-grid' }, Object.entries(TYPES).map(([key, t]) =>
    h('button', { class: 'type-btn', type: 'button', onclick: () => { m.close(); go('new/' + key); } },
      h('span', { class: `item-ic t-${key}` }, icon(t.icon)), t.label)));
  m = modal({ title: 'Ne eklemek istiyorsun?', body: grid, cls: 'sheet' });
}

// ---------------------------------------------------------------- kayıt detayı

function viewDetail(id, isRefresh = false) {
  runCleanup();
  const r = store.get(id);
  if (!r || r.deleted) {
    if (!isRefresh) toast('Kayıt bulunamadı');
    return go('', true);
  }
  const T = typeOf(r);
  const parts = [];

  parts.push(h('div', { class: 'detail-head' },
    itemIcon(r, 'lg'),
    h('div', { class: 'dh-main' },
      h('h1', { class: 'dh-title', text: r.title || '(başlıksız)' }),
      h('div', { class: 'row small muted' }, T.label,
        r.stage === 'A' ? h('span', { class: 'pill pill-a', text: 'Onay bekliyor' }) : h('span', { class: 'pill pill-b', text: 'Kasada' })))));

  if (r.stage === 'A') parts.push(approveCard(r));

  const fields = (r.fields || []).filter((f) => f.value);
  if (fields.length) parts.push(h('section', { class: 'card' }, fields.map((f) => (f.kind === 'totp' ? totpRow(f) : fieldRow(f)))));
  if (r.stage !== 'A' && r.description) parts.push(card('Açıklama', h('p', { class: 'pre', text: r.description })));
  if (r.notes) parts.push(card('Notlar', h('p', { class: 'pre', text: r.notes })));
  if (r.stage !== 'A' && (r.tags || []).length) {
    parts.push(card('Etiketler', h('div', { class: 'chips wrap' }, r.tags.map((t) =>
      h('button', { class: 'chip', type: 'button', onclick: () => { ui.tab = 'B'; ui.tag = t; ui.query = ''; ui.mainScroll = 0; go(''); } }, '#' + t)))));
  }
  parts.push(linksCard(r));
  parts.push(filesCard(r));
  if ((r.history || []).length) parts.push(historyCard(r));

  parts.push(h('p', { class: 'meta' },
    `Eklendi: ${fmtDate(r.createdAt)}`, h('br'),
    `Güncellendi: ${fmtDate(r.updatedAt)}`,
    r.approvedAt ? [h('br'), `Onaylandı: ${fmtDate(r.approvedAt)}`] : null));
  parts.push(h('div', { class: 'row' },
    h('button', { class: 'btn', onclick: () => go('edit/' + r.id, false, { fromDetail: true }) }, icon('edit'), 'Düzenle'),
    h('button', { class: 'btn danger', onclick: async () => {
      const ok = await confirmBox(`“${r.title}” çöp kutusuna taşınsın mı? Ayarlar → Çöp kutusu'ndan geri alabilirsin.`, { ok: 'Çöp kutusuna taşı', danger: true });
      if (!ok) return;
      store.remove(r.id);
      toast('Çöp kutusuna taşındı');
      goBack();
    } }, icon('trash'), 'Sil')));

  const page = h('div', { class: 'shell' },
    topbar({ back: true, title: T.label, actions: [iconBtn('edit', 'Düzenle', () => go('edit/' + r.id, false, { fromDetail: true }))] }),
    h('main', { class: 'page' }, parts));
  mount('detail', page, { refresh: () => viewDetail(id, true), guard: true, scroll: !isRefresh });
}

function approveCard(r) {
  const desc = h('textarea', {
    class: 'input', rows: 3, value: r.description || '',
    placeholder: 'Bu bilgi ne işe yarıyor? Nerede, ne zaman lazım olur? (isteğe bağlı)',
  });
  const tags = tagEditor(r.tags || []);
  const btn = h('button', { class: 'btn primary block', onclick: () => {
    store.approve(r.id, { description: desc.value.trim(), tags: tags.get() });
    toast('Onaylandı · kasaya taşındı');
    goBack();
  } }, icon('checkCircle'), 'Onayla ve kasaya taşı');
  return h('section', { class: 'card approve' },
    h('div', { class: 'approve-head' }, icon('inbox'),
      h('div', {}, h('strong', { text: 'Onay bekliyor' }), h('span', { class: 'small muted', text: `Eklendi: ${fmtRel(r.createdAt)}` }))),
    h('label', { class: 'lbl', text: 'Açıklama' }), desc,
    h('label', { class: 'lbl', text: 'Etiketler' }), tags.el,
    h('div', { class: 'spacer' }), btn);
}

function fieldRow(f) {
  const secret = f.kind === 'secret';
  let shown = !secret;
  const val = h('div', { class: 'f-value' + (secret ? ' mono' : '') });
  const eye = secret ? iconBtn('eye', 'Göster', () => { shown = !shown; paint(); }) : null;
  function paint() {
    val.textContent = shown ? f.value : '••••••••••';
    val.classList.toggle('masked', !shown);
    if (eye) {
      eye.replaceChildren(icon(shown ? 'eyeOff' : 'eye'));
      eye.setAttribute('aria-label', shown ? 'Gizle' : 'Göster');
    }
  }
  paint();
  const url = f.kind === 'url' ? safeUrl(f.value) : null;
  return h('div', { class: 'field' },
    h('div', { class: 'f-main' }, h('div', { class: 'f-label', text: f.label }), val),
    h('div', { class: 'f-actions' },
      eye,
      url ? h('a', { class: 'icon-btn', href: url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Siteyi aç', title: 'Siteyi aç' }, icon('external')) : null,
      iconBtn('copy', 'Kopyala', () => copyText(f.value, { secret, what: `${f.label} kopyalandı` }))));
}

function totpRow(f) {
  const cfg = parseOtp(f.value);
  if (!cfg) {
    return h('div', { class: 'field' }, h('div', { class: 'f-main' },
      h('div', { class: 'f-label', text: f.label }), h('div', { class: 'f-value error', text: 'Geçersiz 2FA anahtarı' })));
  }
  const codeEl = h('div', { class: 'totp-code mono' });
  const secs = h('span');
  const ring = h('span', { class: 'ring' }, secs);
  let code = '';
  let last = -1;
  async function tick() {
    const counter = Math.floor(Date.now() / 1000 / cfg.period);
    if (counter !== last) {
      last = counter;
      code = await totpCode(cfg);
      codeEl.textContent = code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
    }
    const left = secondsLeft(cfg);
    secs.textContent = left;
    ring.style.setProperty('--p', String(left / cfg.period));
    ring.classList.toggle('low', left <= 5);
  }
  tick();
  const timer = setInterval(tick, 1000);
  cleanup.push(() => clearInterval(timer));
  const label = f.label + (cfg.issuer ? ` · ${cfg.issuer}` : '');
  return h('div', { class: 'field' },
    h('div', { class: 'f-main' }, h('div', { class: 'f-label', text: label }), h('div', { class: 'totp' }, codeEl, ring)),
    h('div', { class: 'f-actions' }, iconBtn('copy', 'Kodu kopyala', () => copyText(code, { what: 'Kod kopyalandı' }))));
}

function linksCard(r) {
  const linked = (r.links || []).map(store.get).filter((x) => x && !x.deleted);
  const exclude = new Set([r.id, ...(r.links || [])]);
  const sugg = similar(idx(), r, { exclude, limit: 3 });
  return card('İlişkili kayıtlar',
    linked.length
      ? h('div', { class: 'mini-list' }, linked.map((o) => miniRow(o, iconBtn('x', 'Bağlantıyı kaldır', () => { store.unlink(r.id, o.id); toast('Bağlantı kaldırıldı'); }))))
      : h('p', { class: 'small muted', text: 'Henüz bağlı kayıt yok.' }),
    sugg.length ? [
      h('div', { class: 'sugg-title' }, icon('spark', 'sm'), 'Benzer olabilir'),
      h('div', { class: 'mini-list' }, sugg.map((x) => miniRow(x.r,
        h('button', { class: 'btn sm', type: 'button', onclick: () => { store.link(r.id, x.r.id); toast('Bağlandı'); } }, icon('link', 'sm'), 'Bağla')))),
    ] : null,
    h('button', { class: 'btn sm ghost', onclick: () => pickLink(r) }, icon('plus', 'sm'), 'Bağlantı ekle'));
}

function pickLink(r) {
  const input = h('input', { class: 'input', type: 'search', placeholder: 'Bağlanacak kaydı ara…', autocomplete: 'off' });
  const list = h('div', { class: 'mini-list pick' });
  let m;
  function paint() {
    const exclude = new Set([r.id, ...(r.links || [])]);
    const q = input.value.trim();
    const pool = q
      ? search(idx(), q).results.map((x) => x.r)
      : store.live().sort((a, b) => b.updatedAt - a.updatedAt);
    const items = pool.filter((o) => !exclude.has(o.id)).slice(0, 30);
    list.replaceChildren(...(items.length
      ? items.map((o) => h('button', { class: 'mini-main', type: 'button', onclick: () => { m.close(); store.link(r.id, o.id); toast('Bağlandı'); } },
        itemIcon(o, 'sm'), h('span', { class: 'mini-title', text: o.title || '(başlıksız)' })))
      : [h('p', { class: 'small muted', text: 'Uygun kayıt yok.' })]));
  }
  input.addEventListener('input', paint);
  paint();
  m = modal({ title: 'Bağlantı ekle', body: [input, list] });
  setTimeout(() => input.focus(), 40);
}

function filesCard(r) {
  const atts = r.attachments || [];
  const picker = h('input', { type: 'file', multiple: true, hidden: true });
  picker.addEventListener('change', async () => {
    const files = [...picker.files];
    picker.value = '';
    for (const f of files) {
      toast(`Yükleniyor: ${f.name}`);
      try {
        await store.addFile(r.id, f);
        toast(`Eklendi: ${f.name}`);
      } catch (e) {
        toast(e.message, 'error');
      }
    }
  });
  return card('Dosyalar',
    atts.length
      ? h('div', { class: 'mini-list' }, atts.map((a) => h('div', { class: 'mini' },
        h('button', { class: 'mini-main', type: 'button', onclick: () => openFile(a) },
          icon((a.type || '').startsWith('image/') ? 'image' : 'file', 'sm'),
          h('span', { class: 'mini-title', text: a.name }),
          h('span', { class: 'small muted', text: fmtSize(a.size) })),
        iconBtn('x', 'Dosyayı sil', async () => {
          if (!(await confirmBox(`“${a.name}” kalıcı olarak silinsin mi?`, { ok: 'Sil', danger: true }))) return;
          try {
            await store.removeFile(r.id, a.id);
            toast('Dosya silindi');
          } catch (e) {
            toast(e.message, 'error');
          }
        }))))
      : null,
    h('button', { class: 'btn sm ghost', onclick: () => picker.click() }, icon('clip', 'sm'), 'Dosya ekle'),
    picker,
    h('p', { class: 'small muted', text: 'Fotoğraf, PDF vb. Şifrelenip GitHub\'a yüklenir (en fazla 20 MB). İnternet gerekir.' }));
}

async function openFile(att) {
  let blob;
  try {
    toast('Dosya açılıyor…');
    blob = await store.readFile(att);
  } catch (e) {
    toast(e.message, 'error');
    return;
  }
  const url = URL.createObjectURL(blob);
  const isImg = (att.type || '').startsWith('image/');
  const m = modal({
    title: att.name,
    body: isImg ? h('img', { class: 'preview', src: url, alt: att.name }) : h('p', { class: 'muted', text: `${fmtSize(att.size)} · ${att.type || 'dosya'}` }),
    actions: [
      isImg ? null : { label: 'Aç', cls: 'ghost', icon: 'external', onclick: () => window.open(url, '_blank', 'noopener') },
      { label: 'İndir', cls: 'primary', icon: 'download', onclick: () => download(blob, att.name) },
    ].filter(Boolean),
  });
  m.done.then(() => setTimeout(() => URL.revokeObjectURL(url), 60000));
}

function historyCard(r) {
  return card(`Geçmiş (${r.history.length})`, h('div', { class: 'mini-list' }, r.history.map((v, i) =>
    h('button', { class: 'mini-main', type: 'button', onclick: () => showVersion(r, v) },
      icon('history', 'sm'),
      h('span', { class: 'mini-title', text: fmtDate(v.at) }),
      i === 0 ? h('span', { class: 'small muted', text: 'bir önceki hali' }) : null))));
}

function showVersion(r, v) {
  const fields = (v.fields || []).filter((f) => f.value).map((f) => fieldRow(f.kind === 'totp' ? { ...f, kind: 'secret' } : f));
  modal({
    title: 'Eski sürüm',
    body: [
      h('p', { class: 'small muted', text: `Kaydedildiği an: ${fmtDate(v.at)}` }),
      h('h3', { class: 'v-title', text: v.title }),
      fields.length ? h('div', { class: 'card flat' }, fields) : null,
      v.description ? card('Açıklama', h('p', { class: 'pre', text: v.description })) : null,
      v.notes ? card('Notlar', h('p', { class: 'pre', text: v.notes })) : null,
      (v.tags || []).length ? h('p', { class: 'small muted', text: v.tags.map((t) => '#' + t).join(' ') }) : null,
    ],
    actions: [
      { label: 'Kapat', cls: 'ghost', value: null },
      { label: 'Bu sürüme dön', cls: 'primary', icon: 'undo', onclick: async (close) => {
        close();
        if (!(await confirmBox('Kayıt bu sürüme döndürülsün mü? Şu anki hali de geçmişe eklenir.', { ok: 'Geri dön' }))) return;
        store.update(r.id, {
          title: v.title, fields: structuredClone(v.fields || []), notes: v.notes || '',
          description: v.description || '', tags: [...(v.tags || [])],
        });
        toast('Eski sürüme döndürüldü');
      } },
    ],
  });
}

// ---------------------------------------------------------------- ekleme / düzenleme

function readQr() {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept: 'image/*' });
    inp.addEventListener('change', async () => {
      const file = inp.files && inp.files[0];
      if (!file) return resolve(null);
      try {
        const bmp = await createImageBitmap(file);
        const codes = await new window.BarcodeDetector({ formats: ['qr_code'] }).detect(bmp);
        const hit = codes.find((c) => c.rawValue);
        resolve(hit ? hit.rawValue : '');
      } catch {
        resolve('');
      }
    });
    inp.addEventListener('cancel', () => resolve(null));
    inp.click();
  });
}

function valueEditor(f) {
  if (f.kind === 'secret') {
    const isPassword = /şifre|parola|password/i.test(f.label);
    const meter = isPassword ? strengthMeter() : null;
    const si = secretInput({ value: f.value });
    si.input.addEventListener('input', () => {
      f.value = si.input.value;
      if (meter) meter.set(f.value);
    });
    si.wrap.append(iconBtn('dice', 'Şifre üret', () => openGenerator((pw) => {
      si.input.value = pw;
      f.value = pw;
      si.show(true);
      if (meter) meter.set(pw);
    })));
    if (meter) meter.set(f.value);
    return h('div', {}, si.wrap, meter ? meter.el : null);
  }

  if (f.kind === 'totp') {
    const hint = h('div', { class: 'hint' });
    const input = h('input', {
      class: 'input mono', value: f.value, autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off',
      placeholder: 'Anahtar (JBSW Y3DP …) veya otpauth:// bağlantısı',
    });
    let seq = 0;
    async function check() {
      const my = ++seq;
      if (!f.value) {
        hint.className = 'hint';
        hint.textContent = 'Sitenin 2 adımlı doğrulama kurulumunda verdiği anahtarı yapıştır ya da QR kodun fotoğrafını seç.';
        return;
      }
      const cfg = parseOtp(f.value);
      if (!cfg) {
        hint.className = 'hint bad';
        hint.textContent = 'Geçersiz anahtar.';
        return;
      }
      const code = await totpCode(cfg);
      if (my !== seq) return;
      hint.className = 'hint ok';
      hint.textContent = `Geçerli ✓ Şu anki kod: ${code}${cfg.issuer ? ` (${cfg.issuer})` : ''}`;
    }
    input.addEventListener('input', () => { f.value = input.value.trim(); check(); });
    check();
    const qrBtn = 'BarcodeDetector' in window ? iconBtn('qr', 'QR kod fotoğrafından oku', async () => {
      const v = await readQr();
      if (v) {
        input.value = v;
        f.value = v;
        check();
        toast('QR kod okundu');
      } else if (v === '') {
        toast('Fotoğrafta QR kod bulunamadı', 'error');
      }
    }) : null;
    return h('div', {}, h('div', { class: 'input-wrap' }, input, qrBtn), hint);
  }

  const type = f.kind === 'url' ? 'url' : f.kind === 'email' ? 'email' : 'text';
  const input = h('input', {
    class: 'input', type, value: f.value,
    inputmode: type === 'text' ? null : type,
    autocapitalize: type === 'text' ? 'sentences' : 'off',
    spellcheck: type === 'text' ? null : 'false',
  });
  input.addEventListener('input', () => { f.value = input.value; });
  return input;
}

function fieldEditor(f, T, onRemove) {
  const custom = !T.fields.some(([l, k]) => l === f.label && k === f.kind);
  const body = h('div');
  const repaint = () => body.replaceChildren(valueEditor(f));
  let kindSel = null;
  if (custom) {
    kindSel = h('select', { class: 'input sm select', 'aria-label': 'Alan türü' },
      Object.entries(KINDS).map(([k, l]) => h('option', { value: k, text: l })));
    kindSel.value = f.kind;
    kindSel.addEventListener('change', () => { f.kind = kindSel.value; repaint(); });
  }
  const labelEl = custom
    ? h('input', { class: 'input sm', value: f.label, placeholder: 'Alan adı (ör. Güvenlik sorusu)', 'aria-label': 'Alan adı' })
    : h('span', { class: 'lbl', text: f.label });
  if (custom) labelEl.addEventListener('input', () => { f.label = labelEl.value; });
  repaint();
  return h('div', { class: 'fe' },
    h('div', { class: 'fe-head' }, labelEl, kindSel, iconBtn('x', 'Alanı kaldır', onRemove)),
    body);
}

function viewEdit(id, newType) {
  const existing = id ? store.get(id) : null;
  if (id && (!existing || existing.deleted)) {
    toast('Kayıt bulunamadı');
    return go('', true);
  }
  const type = existing ? existing.type : (TYPES[newType] ? newType : 'note');
  const T = TYPES[type] || TYPES.note;
  const isNew = !existing;

  const fields = existing ? (existing.fields || []).map((f) => ({ ...f })) : [];
  for (const [label, kind] of T.fields) {
    if (!fields.some((f) => f.label === label && f.kind === kind)) fields.push({ id: uid(), label, kind, value: '' });
  }

  const titleIn = h('input', {
    class: 'input big', value: existing ? existing.title : '', maxlength: 200, autocapitalize: 'sentences',
    placeholder: { account: 'ör. Netflix, Gmail, e-Devlet', card: 'ör. Ziraat banka kartı', id: 'ör. Pasaport', wifi: 'ör. Ev Wi-Fi', note: 'ör. Kombi servis bilgileri' }[type] || 'Başlık',
  });
  const notesIn = h('textarea', { class: 'input', rows: type === 'note' ? 8 : 4, value: existing ? existing.notes : '', placeholder: type === 'note' ? 'Notunu yaz…' : 'Ek notlar, güvenlik soruları, yedek kodlar…' });
  const descIn = h('textarea', { class: 'input', rows: 3, value: existing ? existing.description : '', placeholder: 'Bu bilgi ne işe yarıyor? (onaylarken de yazabilirsin)' });
  const tagEd = tagEditor(existing ? existing.tags : []);
  const fieldsBox = h('div');

  function paintFields() {
    fieldsBox.replaceChildren(...fields.map((f) => fieldEditor(f, T, () => {
      fields.splice(fields.indexOf(f), 1);
      paintFields();
    })));
  }
  paintFields();

  const addField = h('button', { class: 'btn sm ghost', type: 'button', onclick: () => {
    fields.push({ id: uid(), label: '', kind: 'text', value: '' });
    paintFields();
    const inp = fieldsBox.lastElementChild && fieldsBox.lastElementChild.querySelector('input');
    if (inp) inp.focus();
  } }, icon('plus', 'sm'), 'Alan ekle');

  function payload() {
    return {
      title: titleIn.value.trim(),
      fields: fields.filter((f) => String(f.value).trim()).map((f) => ({
        id: f.id || uid(),
        label: (f.label || '').trim() || KINDS[f.kind] || 'Alan',
        kind: f.kind,
        value: f.kind === 'secret' ? f.value : String(f.value).trim(),
      })),
      notes: notesIn.value.replace(/\s+$/, ''),
      description: descIn.value.trim(),
      tags: tagEd.get(),
    };
  }
  const initial = JSON.stringify(payload());

  function leave(targetId) {
    if (history.state && history.state.fromDetail) history.back();
    else if (targetId) go('r/' + targetId, true);
    else goBack();
  }

  async function cancel() {
    if (JSON.stringify(payload()) !== initial && !(await confirmBox('Kaydedilmemiş değişiklikler silinecek.', { title: 'Çıkılsın mı?', ok: 'Çık', danger: true }))) return;
    leave(existing ? existing.id : null);
  }

  function save() {
    const p = payload();
    if (!p.title) {
      toast('Başlık gerekli', 'error');
      titleIn.focus();
      return;
    }
    const bad = p.fields.find((f) => f.kind === 'totp' && !parseOtp(f.value));
    if (bad) {
      toast(`“${bad.label}” geçerli bir 2FA anahtarı değil`, 'error');
      return;
    }
    if (existing) {
      store.update(existing.id, p);
      toast('Kaydedildi');
      leave(existing.id);
    } else {
      const r = store.create(type, p);
      toast('Kaydedildi · onay bekleyenlere eklendi');
      go('r/' + r.id, true);
    }
  }

  const fieldsCard = h('section', { class: 'card' }, fieldsBox, addField);
  const page = h('div', { class: 'shell' },
    topbar({ back: true, onBack: cancel, title: isNew ? `Yeni ${T.label.toLocaleLowerCase('tr')}` : 'Düzenle' }),
    h('main', { class: 'page edit' },
      isNew ? h('div', { class: 'banner' }, icon('inbox'), h('span', { text: 'Kaydettiğinde “Onay bekleyen”e düşer. Açıklamasını yazıp onayladığında kasaya geçer.' })) : null,
      h('label', { class: 'lbl', text: 'Başlık' }), titleIn,
      type === 'note' ? [h('label', { class: 'lbl', text: 'Not' }), notesIn] : null,
      h('label', { class: 'lbl', text: 'Bilgiler' }), fieldsCard,
      h('label', { class: 'lbl', text: 'Açıklama' }), descIn,
      type !== 'note' ? [h('label', { class: 'lbl', text: 'Notlar' }), notesIn] : null,
      h('label', { class: 'lbl', text: 'Etiketler' }), tagEd.el,
      h('div', { class: 'bottombar' },
        h('button', { class: 'btn', onclick: cancel }, 'Vazgeç'),
        h('button', { class: 'btn primary', onclick: save }, icon('check'), 'Kaydet'))));
  mount('edit', page);
  if (isNew) setTimeout(() => titleIn.focus(), 80);
}

// ---------------------------------------------------------------- şifre üretici

function openGenerator(onUse) {
  const o = { length: 20, lower: true, upper: true, digits: true, symbols: true, avoidAmbiguous: true, ...prefs.get('gen', {}) };
  let pw = '';
  const out = h('div', { class: 'gen-out mono' });
  const meter = strengthMeter();
  const lenLabel = h('strong');
  const regen = () => {
    pw = generate(o);
    out.textContent = pw;
    meter.set(pw);
    lenLabel.textContent = o.length;
    prefs.set('gen', o);
  };
  const slider = h('input', { type: 'range', min: 8, max: 64, value: o.length, 'aria-label': 'Uzunluk' });
  slider.addEventListener('input', () => { o.length = Number(slider.value); regen(); });
  const opt = (k, label) => {
    const cb = h('input', { type: 'checkbox', checked: o[k] });
    cb.addEventListener('change', () => {
      o[k] = cb.checked;
      if (!['lower', 'upper', 'digits', 'symbols'].some((x) => o[x])) { o.lower = true; }
      regen();
    });
    return h('label', { class: 'check' }, cb, label);
  };
  regen();
  modal({
    title: 'Şifre üret',
    body: [
      out, meter.el,
      h('div', { class: 'row between' }, h('span', { text: 'Uzunluk' }), lenLabel), slider,
      h('div', { class: 'opts' }, opt('upper', 'Büyük harf'), opt('lower', 'Küçük harf'), opt('digits', 'Rakam'), opt('symbols', 'Sembol'), opt('avoidAmbiguous', 'Karışan karakterleri çıkar (l, I, O, 0, 1)')),
    ],
    actions: [
      { label: 'Yenile', cls: 'ghost', icon: 'refresh', onclick: () => regen() },
      { label: 'Kopyala', cls: onUse ? 'ghost' : 'primary', icon: 'copy', onclick: () => copyText(pw, { secret: true, what: 'Şifre kopyalandı' }) },
      onUse ? { label: 'Kullan', cls: 'primary', icon: 'check', onclick: (close) => { onUse(pw); close(); } } : null,
    ].filter(Boolean),
  });
}

// ---------------------------------------------------------------- ayarlar

function viewSettings() {
  const conn = store.connection() || {};
  const st = store.state();
  const live = store.live();
  const trashCount = store.trash().length;

  const select = (key, def, options, label) => {
    const sel = h('select', { class: 'input select', 'aria-label': label }, options.map(([v, t]) => h('option', { value: String(v), text: t })));
    sel.value = String(prefs.get(key, def));
    sel.addEventListener('change', () => { prefs.set(key, Number(sel.value)); toast('Kaydedildi'); });
    return h('div', { class: 'setting' }, h('span', { text: label }), sel);
  };

  const withFiles = h('input', { type: 'checkbox' });
  const restoreIn = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  restoreIn.addEventListener('change', async () => {
    const f = restoreIn.files && restoreIn.files[0];
    restoreIn.value = '';
    if (!f) return;
    let obj;
    try { obj = JSON.parse(await f.text()); } catch { return toast('Dosya okunamadı', 'error'); }
    try {
      const res = await store.importBackup(obj, () => promptBox({
        title: 'Yedeğin şifresi', type: 'password', ok: 'Aç',
        message: 'Bu yedek başka bir ana şifreyle oluşturulmuş. O kasanın ana şifresini ya da kurtarma anahtarını gir.',
      }));
      if (!res) return;
      toast(`${res.added} yeni, ${res.updated} güncellenen kayıt${res.files ? `, ${res.files} dosya` : ''} geri yüklendi`);
    } catch (e) {
      toast(e instanceof WrongSecretError ? 'Şifre yanlış' : e.message, 'error');
    }
  });

  const page = h('div', { class: 'shell' },
    topbar({ back: true, title: 'Ayarlar' }),
    h('main', { class: 'page' },
      card('Eşitleme',
        h('p', { class: 'small muted', text: conn.demo ? 'Deneme modu: veriler sadece bu tarayıcıda.' : `GitHub deposu: ${conn.owner}/${conn.repo}` }),
        h('div', { class: 'row' }, h('span', { text: 'Durum:' }), syncPill()),
        st.msg ? h('p', { class: 'small ' + (st.status === 'error' || st.status === 'auth' ? 'error' : 'muted'), text: st.msg }) : null,
        h('div', { class: 'row' },
          h('button', { class: 'btn sm', onclick: () => store.sync() }, icon('refresh', 'sm'), 'Şimdi eşitle'),
          conn.demo ? null : h('button', { class: 'btn sm', onclick: async () => {
            const t = await promptBox({ title: 'Token\'ı güncelle', type: 'password', placeholder: 'github_pat_…', ok: 'Kaydet', message: 'Süresi dolan ya da değiştirdiğin token\'ı buraya yapıştır. Sadece bu cihazda saklanır.' });
            if (!t) return;
            try {
              await store.updateToken(t.trim());
              toast('Token güncellendi');
              viewSettings();
            } catch (e) {
              toast(e.message, 'error');
            }
          } }, icon('key', 'sm'), 'Token\'ı güncelle'))),

      card('Güvenlik',
        h('div', { class: 'row' },
          h('button', { class: 'btn sm', onclick: () => go('settings/password') }, icon('key', 'sm'), 'Ana şifreyi değiştir'),
          h('button', { class: 'btn sm', onclick: async () => {
            if (!(await confirmBox('Yeni bir kurtarma anahtarı oluşturulacak. Eskisi artık çalışmayacak.', { ok: 'Oluştur' }))) return;
            const rk = await store.newRecoveryKey();
            modal({
              title: 'Yeni kurtarma anahtarın',
              body: [h('p', { class: 'muted', text: 'Kâğıda yaz ve güvenli bir yerde sakla. Eski anahtarı imha et.' }), recoveryBlock(rk)],
              actions: [{ label: 'Yazdım', cls: 'primary', value: true }],
            });
          } }, icon('shield', 'sm'), 'Yeni kurtarma anahtarı')),
        select('autolock', 5, [[1, '1 dakika'], [5, '5 dakika'], [15, '15 dakika'], [30, '30 dakika']], 'Otomatik kilit'),
        select('clip', 30, [[15, '15 saniye'], [30, '30 saniye'], [60, '1 dakika'], [0, 'Kapalı']], 'Kopyalanan şifreyi panodan sil')),

      card('Yedek',
        h('p', { class: 'small muted', text: 'Yedek dosyası da şifrelidir; açmak için ana şifren ya da kurtarma anahtarın gerekir.' }),
        h('label', { class: 'check' }, withFiles, 'Dosyaları da yedeğe ekle (internet gerekir)'),
        h('div', { class: 'row' },
          h('button', { class: 'btn sm', onclick: async (e) => {
            await busy(e.currentTarget, async () => {
              try {
                const blob = await store.exportBackup(withFiles.checked);
                download(blob, `kasa-yedek-${new Date().toISOString().slice(0, 10)}.json`);
                toast('Yedek indirildi');
              } catch (err) {
                toast(err.message, 'error');
              }
            }, 'Hazırlanıyor…');
          } }, icon('download', 'sm'), 'Şifreli yedek indir'),
          h('button', { class: 'btn sm', onclick: () => restoreIn.click() }, icon('upload', 'sm'), 'Yedekten geri yükle'),
          restoreIn)),

      card('Kayıtlar',
        h('p', { class: 'small muted', text: `${live.filter((r) => r.stage !== 'A').length} kayıt kasada, ${live.filter((r) => r.stage === 'A').length} kayıt onay bekliyor.` }),
        h('div', { class: 'row' },
          h('button', { class: 'btn sm', onclick: () => go('trash') }, icon('trash', 'sm'), `Çöp kutusu (${trashCount})`),
          store.DEMO ? h('button', { class: 'btn sm', onclick: () => { seedDemo(); toast('Örnek kayıtlar eklendi'); go('', true); } }, icon('spark', 'sm'), 'Örnek kayıtlar ekle') : null)),

      card('Bu cihaz',
        h('p', { class: 'small muted', text: 'Bu cihazdaki şifreli kopya ve token silinir. GitHub\'daki kasan etkilenmez; tekrar bağlanabilirsin.' }),
        h('button', { class: 'btn sm danger', onclick: async () => {
          const warn = store.state().pending ? '\n\nDİKKAT: GitHub\'a henüz gönderilmemiş değişiklikler var, bunlar kaybolur.' : '';
          if (!(await confirmBox('Bu cihazdaki kasa verisi silinsin mi?' + warn, { ok: 'Cihazdan çık', danger: true }))) return;
          await store.forgetDevice();
          location.replace(location.pathname + location.search);
        } }, icon('logout', 'sm'), 'Bu cihazdan çık')),

      h('p', { class: 'foot-note', text: `Kasa ${VERSION}` })));
  mount('settings', page, { refresh: () => viewSettings(), guard: true, scroll: view.name !== 'settings' });
}

function viewPassword(forced) {
  const cur = secretInput({ placeholder: 'Şu anki ana şifre', autocomplete: 'current-password' });
  const pw1 = secretInput({ placeholder: 'Yeni ana şifre', autocomplete: 'new-password' });
  const pw2 = secretInput({ placeholder: 'Yeni ana şifre (tekrar)', autocomplete: 'new-password' });
  const meter = strengthMeter();
  pw1.input.addEventListener('input', () => meter.set(pw1.input.value));
  const err = h('p', { class: 'error', role: 'alert' });
  const btn = h('button', { class: 'btn primary block', onclick: submit }, icon('key'), 'Şifreyi değiştir');

  async function submit() {
    err.textContent = '';
    const a = pw1.input.value;
    if (a.length < 10) { err.textContent = 'Yeni şifre en az 10 karakter olmalı.'; return; }
    if (meter.set(a).score < 2) { err.textContent = 'Bu şifre çok tahmin edilebilir.'; return; }
    if (a !== pw2.input.value) { err.textContent = 'İki şifre birbirini tutmuyor.'; return; }
    await busy(btn, async () => {
      try {
        if (!forced) await store.verifyPassword(cur.input.value);
        await store.changePassword(a);
        toast('Ana şifre değiştirildi');
        go(forced ? '' : 'settings', true);
      } catch (e) {
        err.textContent = e instanceof WrongSecretError ? 'Şu anki ana şifre yanlış.' : e.message;
      }
    }, 'Değiştiriliyor…');
  }

  const page = h('div', { class: 'shell' },
    topbar({ back: !forced, title: 'Ana şifre' }),
    h('main', { class: 'page narrow' },
      forced ? h('div', { class: 'banner warn' }, icon('key'), h('span', { text: 'Kurtarma anahtarıyla girdin. Şimdi yeni bir ana şifre belirle.' })) : null,
      forced ? null : [h('label', { class: 'lbl', text: 'Şu anki ana şifre' }), cur.wrap],
      h('label', { class: 'lbl', text: 'Yeni ana şifre' }), pw1.wrap, meter.el,
      h('label', { class: 'lbl', text: 'Yeni ana şifre (tekrar)' }), pw2.wrap,
      h('p', { class: 'hint', text: 'Diğer cihazlarında bir sonraki kilit açışta yeni şifreyi kullanırsın.' }),
      err, btn));
  mount('password', page);
}

function viewTrash() {
  const items = store.trash().sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
  const purge = async (r) => {
    try {
      await store.purge(r.id);
    } catch (e) {
      toast(e.message, 'error');
      return false;
    }
    return true;
  };
  const page = h('div', { class: 'shell' },
    topbar({ back: true, title: 'Çöp kutusu' }),
    h('main', { class: 'page' },
      items.length
        ? [
          h('p', { class: 'small muted', text: 'Silinen kayıtlar burada bekler. Kalıcı silinenler geri getirilemez.' }),
          h('div', { class: 'list' }, items.map((r) => h('div', { class: 'item static' },
            itemIcon(r),
            h('span', { class: 'item-main' },
              h('span', { class: 'item-title', text: r.title || '(başlıksız)' }),
              h('span', { class: 'item-sub', text: `Silindi: ${fmtRel(r.deletedAt || r.updatedAt)}` })),
            h('span', { class: 'item-meta' },
              iconBtn('undo', 'Geri al', () => { store.restore(r.id); toast('Geri alındı'); }),
              iconBtn('trash', 'Kalıcı sil', async () => {
                if (!(await confirmBox(`“${r.title}” kalıcı olarak silinsin mi? Bu geri alınamaz.`, { ok: 'Kalıcı sil', danger: true }))) return;
                if (await purge(r)) toast('Kalıcı olarak silindi');
              }))))),
          h('div', { class: 'spacer' }),
          h('button', { class: 'btn danger', onclick: async () => {
            if (!(await confirmBox(`${items.length} kayıt kalıcı olarak silinsin mi? Bu geri alınamaz.`, { ok: 'Hepsini sil', danger: true }))) return;
            for (const r of items) if (!(await purge(r))) return;
            toast('Çöp kutusu boşaltıldı');
          } }, icon('trash'), 'Çöp kutusunu boşalt'),
        ]
        : empty('trash', 'Çöp kutusu boş', 'Sildiğin kayıtlar burada görünür.')));
  mount('trash', page, { refresh: () => viewTrash(), scroll: view.name !== 'trash' });
}

// ---------------------------------------------------------------- deneme verisi (sadece ?demo)

function seedDemo() {
  const F = (label, kind, value) => ({ id: uid(), label, kind, value });
  const add = (type, data, approve) => {
    const r = store.create(type, data);
    if (approve) store.approve(r.id, { description: data.description || '', tags: data.tags || [] });
  };
  add('account', {
    title: 'Netflix', tags: ['dizi', 'abonelik'], description: 'Aile hesabı. Her ayın 5\'inde karttan çekiliyor.',
    fields: [F('E-posta', 'email', 'ornek@posta.com'), F('Şifre', 'secret', 'Deneme-Sifre-123!'), F('Web sitesi', 'url', 'netflix.com')],
  }, true);
  add('account', {
    title: 'Superonline ev interneti', tags: ['ev', 'fatura'], description: 'Arıza için müşteri numarası lazım.',
    fields: [F('Kullanıcı adı', 'text', 'Müşteri no: 1234567'), F('Şifre', 'secret', 'Ornek-Sifre-42'), F('Web sitesi', 'url', 'superonline.net')],
  }, true);
  add('wifi', {
    title: 'Ev Wi-Fi', tags: ['ev'],
    fields: [F('Ağ adı (SSID)', 'text', 'Ev_5G'), F('Şifre', 'secret', 'kedi-masa-yagmur-77'), F('Modem arayüzü', 'url', 'http://192.168.1.1')],
  }, true);
  add('account', {
    title: 'Gmail', tags: ['e-posta'], description: 'Ana e-posta. 2 adımlı doğrulama açık.',
    fields: [F('E-posta', 'email', 'ornek@gmail.com'), F('Şifre', 'secret', 'Baska-Bir-Sifre-9'), F('2FA anahtarı', 'totp', 'JBSWY3DPEHPK3PXP')],
  }, true);
  add('account', {
    title: 'Ziraat Bankası internet şubesi', tags: ['banka'],
    fields: [F('Kullanıcı adı', 'text', 'TC ile giriş'), F('Şifre', 'secret', '135790')],
  }, true);
  add('card', {
    title: 'Banka kartı',
    fields: [F('Kart üzerindeki isim', 'text', 'AD SOYAD'), F('Kart numarası', 'secret', '4111 1111 1111 1111'), F('Son kullanma (AA/YY)', 'text', '08/29'), F('CVV', 'secret', '123')],
  }, false);
  add('id', {
    title: 'Pasaport',
    fields: [F('Belge türü', 'text', 'Pasaport'), F('Belge numarası', 'secret', 'U12345678'), F('Geçerlilik tarihi', 'text', '2031')],
  }, false);
  add('note', { title: 'Kombi servisi', notes: 'Yetkili servis: 0 212 000 00 00\nYıllık bakım: Ekim', tags: ['ev'] }, false);
}

// ---------------------------------------------------------------- kilit, gizlilik, açılış

let lastActive = Date.now();
for (const ev of ['pointerdown', 'keydown', 'touchstart', 'wheel']) {
  window.addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true, capture: true });
}

async function doLock() {
  closeDialogs();
  ui.query = '';
  ui.unlockMode = 'password';
  await store.lock();
}

function checkIdle() {
  const minutes = Number(prefs.get('autolock', 5)) || 5;
  if (store.isUnlocked() && Date.now() - lastActive > minutes * 60000) doLock();
}
setInterval(checkIdle, 10000);

document.addEventListener('visibilitychange', () => {
  // Uygulama değiştiricide içerik görünmesin
  document.body.classList.toggle('veil', document.hidden);
  if (!document.hidden) {
    checkIdle();
    if (store.isUnlocked()) store.sync();
  }
});
window.addEventListener('online', () => { if (store.isUnlocked()) store.sync(); });
setInterval(() => { if (store.isUnlocked() && !document.hidden) store.sync(); }, 120000);

async function boot() {
  if (!window.isSecureContext || !crypto.subtle) {
    app.replaceChildren(h('main', { class: 'page narrow' }, h('p', { class: 'error', text: 'Kasa sadece güvenli bağlantıda (https) çalışır.' })));
    return;
  }
  try {
    await store.init();
  } catch (e) {
    app.replaceChildren(h('main', { class: 'page narrow' }, h('p', { class: 'error', text: 'Başlatılamadı: ' + e.message })));
    return;
  }
  route();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

boot();
