// Küçük yardımcılar. Arayüz innerHTML kullanmaz: kullanıcı verisi her zaman düz metin olarak eklenir.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const PATHS = {
  search: 'M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14zM20 20l-4-4',
  lock: 'M6 11h12v10H6zM8 11V8a4 4 0 0 1 8 0v3',
  unlock: 'M6 11h12v10H6zM8 11V8a4 4 0 0 1 7.5-2',
  settings: 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
  plus: 'M12 5v14M5 12h14',
  back: 'M15 18l-6-6l6-6',
  eye: 'M2 12s3.5-7 10-7s10 7 10 7s-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z',
  eyeOff: 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.9M6.5 6.5C3.6 8.3 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  check: 'M5 12l5 5L20 7',
  checkCircle: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM8 12l3 3l5-6',
  user: 'M12 4a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM4 21c1-4 4-6 8-6s7 2 8 6',
  note: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5',
  card: 'M3 6h18v12H3zM3 10h18M7 15h4',
  id: 'M3 5h18v14H3zM9 8a2 2 0 1 0 0 4a2 2 0 1 0 0-4zM6 16c.6-1.8 5.4-1.8 6 0M14 10h4M14 14h4',
  wifi: 'M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  clip: 'M21 11l-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7',
  file: 'M6 3h9l4 4v14H6zM14 3v5h5',
  image: 'M3 5h18v14H3zM8.5 8a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3zM21 16l-5-5l-9 8',
  clock: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 7v5l3 2',
  refresh: 'M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4',
  dice: 'M4 4h16v16H4zM8.5 8.5h.01M15.5 15.5h.01M15.5 8.5h.01M8.5 15.5h.01M12 12h.01',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2',
  download: 'M12 4v12M7 11l5 5l5-5M4 20h16',
  upload: 'M12 16V4M7 9l5-5l5 5M4 20h16',
  x: 'M6 6l12 12M18 6L6 18',
  cloud: 'M7 18h10a4 4 0 0 0 .6-8A6 6 0 0 0 6.1 9.6A4.2 4.2 0 0 0 7 18z',
  cloudOff: 'M3 3l18 18M8.5 6.1A6 6 0 0 1 17.6 10a4 4 0 0 1 2.6 6.5M17 18H7a4.2 4.2 0 0 1-.9-8.4',
  tag: 'M3 12V3h9l9 9l-9 9zM7.5 7.5h.01',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9c-4.5-1-8-4-8-9V6z',
  inbox: 'M3 13h5l1 3h6l1-3h5M5.5 5h13L21 13v6H3v-6z',
  vault: 'M4 4h16v16H4zM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6zM12 9V7M12 17v-2M9 12H7M17 12h-2',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6',
  key: 'M8 11a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM10.8 12.2L20 3M16 7l3 3M14 9l2 2',
  logout: 'M15 4h4v16h-4M10 8l-4 4l4 4M6 12h11',
  dot: 'M12 12h.01',
};

export function icon(name, cls = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', ('ic ' + cls).trim());
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', PATHS[name] || PATHS.dot);
  svg.appendChild(p);
  return svg;
}

export function uid() {
  return Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function fmtDate(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleString('tr-TR', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function fmtRel(ms) {
  const d = Date.now() - ms;
  const min = Math.round(d / 60000);
  if (min < 1) return 'az önce';
  if (min < 60) return `${min} dk önce`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} saat önce`;
  const day = Math.round(hr / 24);
  if (day === 1) return 'dün';
  if (day < 7) return `${day} gün önce`;
  return new Date(ms).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}

export function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  const f = (x) => x.toLocaleString('tr-TR', { maximumFractionDigits: 1 });
  if (n < 1024 * 1024) return `${f(n / 1024)} KB`;
  return `${f(n / 1024 / 1024)} MB`;
}

export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name, class: 'offscreen' });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
