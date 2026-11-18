// Arama motoru: Türkçe karakterlerden bağımsız, yazım hatasına dayanıklı, eş anlamlı kelimeleri tanıyan,
// tamamen cihazda çalışan bir puanlama. Gizli alanlar (şifre, PIN, 2FA) asla dizine girmez.

import { TYPES } from './types.js';

const MAP = { ı: 'i', ş: 's', ğ: 'g', ü: 'u', ö: 'o', ç: 'c', â: 'a', î: 'i', û: 'u' };

export function norm(s) {
  return String(s || '')
    .toLocaleLowerCase('tr')
    .replace(/[ışğüöçâîû]/g, (c) => MAP[c])
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function tokenize(s) {
  const n = norm(s);
  const out = n.split(/[^a-z0-9]+/).filter(Boolean);
  // "Wi-Fi" → "wifi", "e-posta" → "eposta", "turk.net" → "turknet"
  for (const word of n.split(/\s+/)) {
    if (/[a-z0-9][-._'][a-z0-9]/.test(word)) {
      const joined = word.replace(/[^a-z0-9]/g, '');
      if (joined.length >= 3) out.push(joined);
    }
  }
  return out;
}

export function normTag(s) {
  return String(s || '').trim().replace(/^#+/, '').toLocaleLowerCase('tr').replace(/\s+/g, ' ').slice(0, 40);
}

// Birbirini çağıran kelimeler: "internet" yazınca modem/wifi kayıtları da gelir.
const GROUPS = [
  ['internet', 'modem', 'wifi', 'kablosuz', 'router', 'fiber', 'adsl', 'vdsl', 'superonline', 'turknet', 'ttnet', 'telekom', 'millenicom', 'kablonet'],
  ['banka', 'iban', 'havale', 'eft', 'ziraat', 'garanti', 'akbank', 'isbank', 'yapikredi', 'vakifbank', 'halkbank', 'qnb', 'enpara', 'denizbank', 'teb', 'ing', 'papara', 'kuveyt'],
  ['kart', 'kredi', 'banka', 'cvv', 'troy', 'visa', 'mastercard'],
  ['eposta', 'posta', 'mail', 'email', 'gmail', 'outlook', 'hotmail', 'yandex', 'icloud', 'proton'],
  ['telefon', 'hat', 'gsm', 'operator', 'turkcell', 'vodafone', 'telekom', 'sim', 'puk'],
  ['sosyal', 'instagram', 'twitter', 'facebook', 'tiktok', 'linkedin', 'reddit', 'discord', 'snapchat', 'whatsapp', 'telegram', 'youtube'],
  ['oyun', 'steam', 'epic', 'playstation', 'psn', 'xbox', 'riot', 'valorant', 'nintendo', 'ubisoft', 'blizzard', 'battlenet'],
  ['alisveris', 'trendyol', 'hepsiburada', 'amazon', 'n11', 'getir', 'yemeksepeti', 'migros', 'aliexpress', 'temu', 'sahibinden', 'dolap'],
  ['kimlik', 'tc', 'nufus', 'ehliyet', 'pasaport', 'vergi', 'edevlet', 'devlet', 'turkiye'],
  ['arac', 'araba', 'oto', 'ruhsat', 'plaka', 'sigorta', 'kasko', 'muayene', 'hgs', 'ogs'],
  ['fatura', 'elektrik', 'dogalgaz', 'igdas', 'enerjisa', 'aski', 'iski', 'abonelik', 'abone', 'aidat'],
  ['dizi', 'film', 'netflix', 'disney', 'prime', 'spotify', 'exxen', 'blutv', 'tabii', 'muzik', 'abonelik'],
  ['okul', 'universite', 'obs', 'ogrenci', 'eokul', 'edu'],
  ['saglik', 'hastane', 'doktor', 'enabiz', 'eczane', 'mhrs', 'sgk'],
  ['bulut', 'drive', 'dropbox', 'onedrive', 'icloud', 'mega', 'yedek'],
  ['sifre', 'parola', 'password', 'pin', 'kod'],
  ['kripto', 'binance', 'btcturk', 'paribu', 'cuzdan', 'wallet', 'metamask'],
  ['ev', 'konut', 'kira', 'site', 'apartman', 'aidat', 'kombi'],
  ['is', 'sirket', 'ofis', 'maas', 'bordro'],
];

const SYN = new Map();
for (const group of GROUPS) {
  for (const w of group) {
    if (!SYN.has(w)) SYN.set(w, new Set());
    for (const o of group) if (o !== w) SYN.get(w).add(o);
  }
}

// "internet" → grup; "interneti", "bankasi" gibi ekli hâller ve yarım yazılmış "bank" da gruba bağlanır.
function synonymsOf(q) {
  if (SYN.has(q)) return SYN.get(q);
  const out = new Set();
  if (q.length >= 4) {
    for (const [w, set] of SYN) {
      if (w.startsWith(q) || (w.length >= 4 && q.startsWith(w))) {
        out.add(w);
        set.forEach((x) => out.add(x));
      }
    }
  }
  return out;
}

// Benzerlik önerilerinde anlamsız kalan genel kelimeler
const STOP = new Set([
  've', 'ile', 'icin', 'bir', 'bu', 'su', 'da', 'de', 'mi', 'ne', 'ama', 'veya', 'gibi', 'olan', 'cok',
  'the', 'and', 'of', 'com', 'www', 'http', 'https', 'net', 'org', 'tr', 'html', 'login',
  'sifre', 'sifresi', 'sifrem', 'parola', 'hesap', 'hesabi', 'hesabim', 'giris', 'kullanici', 'adi',
  'numara', 'numarasi', 'no', 'kod', 'kodu', 'bilgi', 'bilgileri', 'not', 'notlar', 'yeni', 'eski',
]);

export function buildIndex(records) {
  return records.map((r) => {
    const toks = new Map();
    const add = (text, w) => {
      for (const t of tokenize(text)) if ((toks.get(t) || 0) < w) toks.set(t, w);
    };
    add(r.title, 3);
    for (const tag of r.tags || []) add(tag, 2.5);
    for (const f of r.fields || []) {
      add(f.label, 0.6);
      if (f.kind !== 'secret' && f.kind !== 'totp') add(f.value, 1.6);
    }
    add(r.description, 1.2);
    add(r.notes, 1);
    for (const a of r.attachments || []) add(a.name, 1);
    add((TYPES[r.type] || TYPES.note).words, 0.7);
    return { r, toks: [...toks], full: norm([r.title, ...(r.tags || [])].join(' ')) };
  });
}

// Kısıtlı Damerau-Levenshtein mesafesi; sınırı aşınca erken çıkar.
function distance(a, b, max) {
  const n = a.length;
  const m = b.length;
  if (Math.abs(n - m) > max) return max + 1;
  let prev2 = null;
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[m];
}

function isClose(q, t) {
  const max = q.length >= 7 ? 2 : 1;
  if (distance(q, t, max) <= max) return true;
  // Yazarken: "netlfi" → "netflix"
  return t.length > q.length && distance(q, t.slice(0, q.length), max) <= max;
}

function tokenScore(q, toks) {
  let best = 0;
  for (const [t, w] of toks) {
    let s = 0;
    if (t === q) s = 1;
    else if (t.startsWith(q)) s = q.length === 1 ? 0.4 : 0.85;
    else if (q.length >= 3 && t.includes(q)) s = 0.6;
    else if (q.length >= 4 && isClose(q, t)) s = 0.45;
    if (s * w > best) best = s * w;
  }
  return best;
}

function synonymScore(set, toks) {
  let best = 0;
  for (const [t, w] of toks) {
    if (set.has(t)) {
      if (w > best) best = w;
      continue;
    }
    for (const s of set) {
      if (s.length >= 4 && t.startsWith(s)) {
        if (0.8 * w > best) best = 0.8 * w;
        break;
      }
    }
  }
  return best;
}

export function search(index, query, { limit = 200 } = {}) {
  const qs = tokenize(query);
  if (!qs.length) return { results: [], partial: false };
  const syns = qs.map(synonymsOf);
  const phrase = norm(query).trim();

  const run = (requireAll) => {
    const out = [];
    for (const e of index) {
      let total = 0;
      let hits = 0;
      for (let i = 0; i < qs.length; i++) {
        let s = tokenScore(qs[i], e.toks);
        if (syns[i].size) s = Math.max(s, synonymScore(syns[i], e.toks) * 0.5);
        if (s) { total += s; hits++; } else if (requireAll) { total = 0; break; }
      }
      if (!total) continue;
      if (phrase.length >= 3 && e.full.includes(phrase)) total += 1.5;
      out.push({ r: e.r, score: total * (hits / qs.length) });
    }
    return out;
  };

  let results = run(true);
  let partial = false;
  if (!results.length && qs.length > 1) {
    results = run(false);
    partial = results.length > 0;
  }
  results.sort((a, b) => b.score - a.score || (b.r.updatedAt || 0) - (a.r.updatedAt || 0));
  return { results: results.slice(0, limit), partial };
}

// Bir kayda benzeyen kayıtlar (ortak kelime, etiket ya da eş anlamlı kelime).
export function similar(index, rec, { exclude = new Set(), limit = 4 } = {}) {
  const me = index.find((e) => e.r.id === rec.id);
  if (!me) return [];
  const mine = new Map(me.toks.filter(([t, w]) => w >= 1 && t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t)));
  const syn = new Set();
  for (const t of mine.keys()) for (const s of synonymsOf(t)) if (!mine.has(s)) syn.add(s);
  const myTags = new Set(rec.tags || []);
  const out = [];
  for (const e of index) {
    if (e.r.id === rec.id || exclude.has(e.r.id)) continue;
    let score = 0;
    for (const [t, w] of e.toks) {
      if (mine.has(t) && w >= 1) score += Math.min(mine.get(t), w);
      else if (syn.has(t) && w >= 0.7) score += 0.6 * Math.min(2, w);
    }
    for (const tag of e.r.tags || []) if (myTags.has(tag)) score += 2;
    if (score >= 2) out.push({ r: e.r, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}
