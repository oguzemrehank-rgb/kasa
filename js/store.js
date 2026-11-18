// Kasa durumu: kilit, kayıtlar, cihazdaki şifreli kopya ve GitHub ile eşitleme.

import * as C from './crypto.js';
import * as db from './db.js';
import { GitHubRepo, DemoRepo, ConflictError, NetworkError, AuthError, NotFoundError } from './github.js';
import { uid } from './util.js';

export const DEMO = new URLSearchParams(location.search).has('demo');
db.init(DEMO ? 'kasa-demo' : 'kasa');

const VAULT = 'vault.json';
const FILES = 'files/';
export const MAX_FILE = 20 * 1024 * 1024;
const HISTORY_MAX = 15;
const CONTENT_KEYS = ['title', 'fields', 'notes', 'description', 'tags'];

const S = {
  conn: null, // { owner, repo, demo, token: şifreli }
  env: null, // GitHub'daki vault.json'un içeriği (şifreli zarf)
  sha: null, // zarfın GitHub'daki sürümü
  pending: false, // GitHub'a gönderilmemiş değişiklik var mı
  repo: null,
  dek: null, // veri anahtarı (sadece kilit açıkken bellekte)
  data: null, // çözülmüş veri { v, records }
  rev: 0,
  sealedRev: 0,
  persistedRev: 0,
  status: 'idle',
  statusMsg: '',
};

const listeners = new Set();
export function on(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(type) {
  for (const fn of listeners) {
    try { fn(type); } catch (e) { console.error(e); }
  }
}
function setStatus(status, msg = '') {
  S.status = status;
  S.statusMsg = msg;
  emit('status');
}

export const state = () => ({ status: S.status, msg: S.statusMsg, pending: S.pending });
export const hasVault = () => !!(S.conn && S.env);
export const isUnlocked = () => !!S.dek;
export const hasRepo = () => !!S.repo;
export const connection = () => (S.conn ? { owner: S.conn.owner, repo: S.conn.repo, demo: !!S.conn.demo } : null);

// ---- Cihaz anahtarı: GitHub token'ını bu cihazda şifreli tutar (dışa aktarılamaz anahtar) ----

async function deviceKey() {
  let key = await db.get('deviceKey');
  if (!key) {
    key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await db.set('deviceKey', key);
  }
  return key;
}
const sealToken = async (token) => C.encryptJSON(await deviceKey(), token, 'token');
const openToken = async (box) => C.decryptJSON(await deviceKey(), box, 'token');

function makeRepo(owner, repo, token) {
  return DEMO ? new DemoRepo() : new GitHubRepo(owner, repo, token);
}

function checkEnv(env) {
  if (!env || env.format !== 'kasa' || !env.keys || !env.data) throw new Error('Bu bir Kasa dosyası değil.');
  if (env.version > 1) throw new Error('Bu kasa daha yeni bir sürümle oluşturulmuş. Sayfayı yenile.');
}

function unwrapEnv(env, secret, mode) {
  return mode === 'recovery'
    ? C.unwrapKey(env.keys.recovery, C.normalizeRecoveryKey(secret))
    : C.unwrapKey(env.keys.password, secret);
}

// ---- Başlatma ----

export async function init() {
  S.conn = (await db.get('conn')) || null;
  const cached = await db.get('vault');
  if (cached) {
    S.env = cached.env;
    S.sha = cached.sha;
    S.pending = !!cached.pending;
  }
  if (S.conn) {
    try {
      const token = S.conn.token ? await openToken(S.conn.token) : null;
      S.repo = makeRepo(S.conn.owner, S.conn.repo, token);
    } catch {
      S.repo = null; // token çözülemedi: ayarlardan yeniden girilmeli
    }
  }
}

async function persist() {
  await db.set('vault', { env: S.env, sha: S.sha, pending: S.pending });
  S.persistedRev = S.sealedRev;
}

// Bellekteki veriyi şifreleyip zarfa koyar. Bu sırada veri değişirse tekrar dener.
async function seal() {
  for (;;) {
    const rev = S.rev;
    const box = await C.encryptJSON(S.dek, S.data, 'data');
    if (rev === S.rev) {
      S.env.data = box;
      S.sealedRev = rev;
      return;
    }
  }
}

function afterUnlock() {
  setStatus(S.pending ? 'pending' : 'saved');
  navigator.storage?.persist?.().catch(() => {});
  sync();
}

// ---- Kurulum ----

export async function checkRepo(owner, repo, token) {
  const r = makeRepo(owner, repo, token);
  let info;
  try {
    info = await r.info();
  } catch (e) {
    if (e instanceof NotFoundError) {
      throw new Error(`"${owner}/${repo}" deposu bulunamadı ya da token'ın bu depoya erişimi yok.`);
    }
    throw e;
  }
  if (!info.private) {
    throw new Error('Bu depo herkese açık (public). Kasa verisi için deponun gizli (private) olması şart. GitHub\'da depo ayarlarından gizli yap.');
  }
  const existing = await r.read(VAULT);
  return { repoObj: r, existing };
}

export async function createVault({ owner, repo, token, repoObj }, password) {
  const dek = await C.newDataKey();
  const recovery = C.newRecoveryKey();
  const now = Date.now();
  const data = { v: 1, records: {} };
  const env = {
    format: 'kasa',
    version: 1,
    createdAt: now,
    updatedAt: now,
    keys: {
      password: await C.wrapKey(dek, password, C.PW_ITERATIONS),
      recovery: await C.wrapKey(dek, C.normalizeRecoveryKey(recovery), C.RECOVERY_ITERATIONS),
      updatedAt: now,
    },
    data: await C.encryptJSON(dek, data, 'data'),
  };
  const sha = await repoObj.write(VAULT, C.utf8(JSON.stringify(env)), null, 'Kasa oluşturuldu');
  S.conn = { owner, repo, demo: DEMO, token: token ? await sealToken(token) : null };
  Object.assign(S, { env, sha, pending: false, repo: repoObj, dek, data, rev: 0, sealedRev: 0 });
  await db.set('conn', S.conn);
  await persist();
  afterUnlock();
  return recovery;
}

export async function connectVault({ owner, repo, token, repoObj, existing }, secret, mode = 'password') {
  const env = JSON.parse(C.fromUtf8(existing.bytes));
  checkEnv(env);
  const dek = await unwrapEnv(env, secret, mode);
  const data = await C.decryptJSON(dek, env.data, 'data');
  S.conn = { owner, repo, demo: DEMO, token: token ? await sealToken(token) : null };
  Object.assign(S, { env, sha: existing.sha, pending: false, repo: repoObj, dek, data, rev: 0, sealedRev: 0 });
  await db.set('conn', S.conn);
  await persist();
  afterUnlock();
}

// ---- Kilit ----

export async function unlock(secret, mode = 'password') {
  const tried = S.env.keys;
  let dek;
  try {
    dek = await unwrapEnv(S.env, secret, mode);
  } catch (e) {
    if (!(e instanceof C.WrongSecretError)) throw e;
    // Ana şifre başka bir cihazda değiştirilmiş olabilir: güncel anahtarlarla bir kez daha dene.
    let keys = S.env.keys !== tried ? S.env.keys : null;
    if (!keys && S.repo) {
      try {
        const remote = await S.repo.read(VAULT);
        if (remote) {
          const renv = JSON.parse(C.fromUtf8(remote.bytes));
          checkEnv(renv);
          if (JSON.stringify(renv.keys) !== JSON.stringify(tried)) keys = renv.keys;
        }
      } catch { /* çevrimdışı */ }
    }
    if (!keys) throw e;
    dek = await unwrapEnv({ keys }, secret, mode);
    S.env.keys = keys;
    await persist();
  }
  S.data = await C.decryptJSON(dek, S.env.data, 'data');
  S.data.records ||= {};
  S.dek = dek;
  S.rev = S.sealedRev = S.persistedRev = 0;
  afterUnlock();
}

export async function lock() {
  if (!S.dek) return;
  try {
    if (S.persistedRev !== S.rev) {
      await seal();
      await persist();
    }
  } catch (e) {
    console.error(e);
  }
  S.dek = null;
  S.data = null;
  fileCache.clear();
  emit('lock');
  // Gönderilmemiş değişiklik varsa kilitledikten sonra da gönder (zarf zaten şifreli).
  if (S.pending && S.repo) {
    try {
      S.sha = await S.repo.write(VAULT, C.utf8(JSON.stringify(S.env)), S.sha, 'Kasa güncellendi');
      S.pending = false;
      await persist();
    } catch { /* bir sonraki açılışta denenir */ }
  }
}

// ---- Eşitleme ----

let syncPromise = null;
let syncAgain = false;

export function sync() {
  if (!S.repo || !S.dek) return Promise.resolve();
  if (syncPromise) {
    syncAgain = true;
    return syncPromise;
  }
  syncPromise = (async () => {
    do {
      syncAgain = false;
      if (!(await syncOnce())) break;
    } while (syncAgain);
  })().finally(() => {
    syncPromise = null;
  });
  return syncPromise;
}

async function syncOnce() {
  setStatus('syncing');
  try {
    for (let i = 0; i < 4; i++) {
      await pull();
      if (!S.dek) return false;
      if (!S.pending) break;
      try {
        await push();
        break;
      } catch (e) {
        if (!(e instanceof ConflictError) || i === 3) throw e; // çakışma: önce güncel hali çek, birleştir
      }
    }
    setStatus(S.pending ? 'pending' : 'saved');
    return true;
  } catch (e) {
    if (!S.dek) return false;
    if (e instanceof NetworkError) setStatus('offline', 'İnternet yok. Değişiklikler bu cihazda saklandı, bağlantı gelince gönderilecek.');
    else if (e instanceof AuthError) setStatus('auth', e.message);
    else setStatus('error', e.message || String(e));
    console.warn('Eşitleme hatası:', e);
    return false;
  }
}

function mergeRecords(local, remote) {
  const out = { ...remote };
  for (const [id, r] of Object.entries(local)) {
    const o = remote[id];
    if (!o || (r.updatedAt || 0) > (o.updatedAt || 0)) out[id] = r;
  }
  return out;
}

async function pull() {
  const remote = await S.repo.read(VAULT);
  if (!S.dek) return;
  if (!remote) {
    // GitHub'daki dosya silinmiş ya da depo boşaltılmış: elimizdeki kopyayla yeniden oluştur.
    S.sha = null;
    S.pending = true;
    return;
  }
  if (remote.sha === S.sha) return;
  const env = JSON.parse(C.fromUtf8(remote.bytes));
  checkEnv(env);
  let rdata;
  try {
    rdata = await C.decryptJSON(S.dek, env.data, 'data');
  } catch {
    throw new Error("GitHub'daki kasa bu kasanın anahtarıyla açılamadı.");
  }
  if (!S.dek) return;
  rdata.records ||= {};
  if (S.pending) {
    S.data.records = mergeRecords(S.data.records, rdata.records);
    if ((env.keys.updatedAt || 0) > (S.env.keys.updatedAt || 0)) S.env.keys = env.keys;
    S.sha = remote.sha;
    S.rev++;
    await seal();
    S.env.updatedAt = Date.now();
  } else {
    S.env = env;
    S.data = rdata;
    S.sha = remote.sha;
    S.rev++;
    S.sealedRev = S.rev;
  }
  await persist();
  emit('data');
}

async function push() {
  if (S.dek && S.sealedRev !== S.rev) await seal();
  const rev = S.sealedRev;
  S.sha = await S.repo.write(VAULT, C.utf8(JSON.stringify(S.env)), S.sha, 'Kasa güncellendi');
  if (rev === S.rev) S.pending = false;
  await persist();
}

let saveTimer = 0;
function commit() {
  S.rev++;
  S.pending = true;
  emit('data');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      if (!S.dek) return;
      await seal();
      S.env.updatedAt = Date.now();
      await persist();
      sync();
    } catch (e) {
      setStatus('error', e.message);
    }
  }, 60);
}

// ---- Kayıtlar ----

const now = () => Date.now();

export const all = () => (S.data ? Object.values(S.data.records) : []);
export const live = () => all().filter((r) => !r.deleted);
export const trash = () => all().filter((r) => r.deleted && !r.purged);
export const get = (id) => (S.data && S.data.records[id]) || null;

export function create(type, fields) {
  const t = now();
  const r = {
    id: uid(), type, stage: 'A', title: '', fields: [], notes: '', description: '', tags: [],
    links: [], attachments: [], history: [], createdAt: t, updatedAt: t, ...fields,
  };
  S.data.records[r.id] = r;
  commit();
  return r;
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function update(id, changes, { keepHistory = true } = {}) {
  const r = get(id);
  if (!r) return;
  if (!Object.keys(changes).some((k) => !same(changes[k], r[k]))) return; // değişiklik yok
  if (keepHistory && CONTENT_KEYS.some((k) => k in changes && !same(changes[k], r[k]))) {
    const snap = { at: r.updatedAt };
    for (const k of CONTENT_KEYS) snap[k] = structuredClone(r[k]);
    r.history = [snap, ...(r.history || [])].slice(0, HISTORY_MAX);
  }
  Object.assign(r, changes, { updatedAt: now() });
  commit();
}

export function approve(id, { description, tags }) {
  update(id, { stage: 'B', approvedAt: now(), description, tags }, { keepHistory: false });
}

export function remove(id) {
  const r = get(id);
  if (!r) return;
  Object.assign(r, { deleted: true, deletedAt: now(), updatedAt: now() });
  commit();
}

export function restore(id) {
  const r = get(id);
  if (!r) return;
  r.deleted = false;
  delete r.deletedAt;
  r.updatedAt = now();
  commit();
}

export async function purge(id) {
  const r = get(id);
  if (!r) return;
  if ((r.attachments || []).length) needRepo();
  for (const a of r.attachments || []) await S.repo.remove(FILES + a.id + '.bin', 'Dosya silindi');
  // Kaydın kimliği "silindi" işaretiyle kalır; böylece başka cihazdan geri gelmez.
  S.data.records[id] = { id, deleted: true, purged: true, updatedAt: now() };
  for (const o of live()) {
    if (o.links && o.links.includes(id)) {
      o.links = o.links.filter((x) => x !== id);
      o.updatedAt = now();
    }
  }
  commit();
}

export function link(a, b) {
  const ra = get(a);
  const rb = get(b);
  if (!ra || !rb || a === b) return;
  const t = now();
  ra.links ||= [];
  rb.links ||= [];
  if (!ra.links.includes(b)) { ra.links = [...ra.links, b]; ra.updatedAt = t; }
  if (!rb.links.includes(a)) { rb.links = [...rb.links, a]; rb.updatedAt = t; }
  commit();
}

export function unlink(a, b) {
  const t = now();
  for (const [x, y] of [[a, b], [b, a]]) {
    const r = get(x);
    if (r && r.links && r.links.includes(y)) {
      r.links = r.links.filter((v) => v !== y);
      r.updatedAt = t;
    }
  }
  commit();
}

// ---- Dosyalar (her biri ayrı şifreli dosya olarak GitHub'da) ----

const fileCache = new Map();

function needRepo() {
  if (!S.repo) throw new Error('GitHub bağlantısı yok. Ayarlardan token\'ı güncelle.');
}

export async function addFile(id, file) {
  needRepo();
  if (file.size > MAX_FILE) throw new Error(`"${file.name}" çok büyük (en fazla 20 MB).`);
  const attId = uid();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const enc = await C.encryptBinary(S.dek, bytes, 'file/' + attId);
  await S.repo.write(FILES + attId + '.bin', enc, null, 'Dosya eklendi');
  const r = get(id);
  if (!r) return;
  r.attachments = [
    ...(r.attachments || []),
    { id: attId, name: file.name, type: file.type || '', size: file.size, addedAt: now() },
  ];
  r.updatedAt = now();
  fileCache.set(attId, new Blob([bytes], { type: file.type || 'application/octet-stream' }));
  commit();
}

export async function readFile(att) {
  if (fileCache.has(att.id)) return fileCache.get(att.id);
  needRepo();
  const f = await S.repo.read(FILES + att.id + '.bin');
  if (!f) throw new Error("Dosya GitHub'da bulunamadı.");
  const bytes = await C.decryptBinary(S.dek, f.bytes, 'file/' + att.id);
  const blob = new Blob([bytes], { type: att.type || 'application/octet-stream' });
  fileCache.set(att.id, blob);
  return blob;
}

export async function removeFile(id, attId) {
  needRepo();
  await S.repo.remove(FILES + attId + '.bin', 'Dosya silindi');
  const r = get(id);
  if (!r) return;
  r.attachments = (r.attachments || []).filter((a) => a.id !== attId);
  r.updatedAt = now();
  fileCache.delete(attId);
  commit();
}

// ---- Güvenlik ayarları ----

export async function verifyPassword(pw) {
  await C.unwrapKey(S.env.keys.password, pw);
}

export async function changePassword(next) {
  const password = await C.wrapKey(S.dek, next, C.PW_ITERATIONS);
  S.env.keys = { ...S.env.keys, password, updatedAt: now() };
  S.rev++;
  S.pending = true;
  await seal();
  await persist();
  sync();
}

export async function newRecoveryKey() {
  const rk = C.newRecoveryKey();
  const recovery = await C.wrapKey(S.dek, C.normalizeRecoveryKey(rk), C.RECOVERY_ITERATIONS);
  S.env.keys = { ...S.env.keys, recovery, updatedAt: now() };
  S.rev++;
  S.pending = true;
  await seal();
  await persist();
  sync();
  return rk;
}

export async function updateToken(token) {
  const r = makeRepo(S.conn.owner, S.conn.repo, token);
  try {
    await r.info();
  } catch (e) {
    if (e instanceof NotFoundError) throw new Error('Bu token ile depoya erişilemiyor. Token\'ın kasa-veri deposuna erişimi olduğundan emin ol.');
    throw e;
  }
  S.conn = { ...S.conn, token: await sealToken(token) };
  await db.set('conn', S.conn);
  S.repo = r;
  sync();
}

export async function forgetDevice() {
  S.dek = null;
  S.data = null;
  await db.clear();
}

// ---- Yedek ----

export async function exportBackup(withFiles) {
  if (S.sealedRev !== S.rev) await seal();
  const out = {
    format: 'kasa-yedek', version: 1, createdAt: now(),
    source: S.conn ? `${S.conn.owner}/${S.conn.repo}` : '', vault: S.env, files: {},
  };
  if (withFiles) {
    for (const r of live()) {
      for (const a of r.attachments || []) {
        needRepo();
        const f = await S.repo.read(FILES + a.id + '.bin');
        if (f) out.files[a.id] = C.toB64(f.bytes);
      }
    }
  }
  return new Blob([JSON.stringify(out)], { type: 'application/json' });
}

export async function importBackup(obj, askSecret) {
  if (!obj || obj.format !== 'kasa-yedek' || !obj.vault) throw new Error('Bu dosya bir Kasa yedeği değil.');
  checkEnv(obj.vault);
  let key = S.dek;
  let data;
  try {
    data = await C.decryptJSON(key, obj.vault.data, 'data');
  } catch {
    const secret = await askSecret();
    if (!secret) return null;
    try {
      key = await C.unwrapKey(obj.vault.keys.password, secret);
    } catch {
      key = await C.unwrapKey(obj.vault.keys.recovery, C.normalizeRecoveryKey(secret));
    }
    data = await C.decryptJSON(key, obj.vault.data, 'data');
  }
  let files = 0;
  for (const [attId, b64] of Object.entries(obj.files || {})) {
    needRepo();
    let bytes = C.fromB64(b64);
    if (key !== S.dek) {
      bytes = await C.encryptBinary(S.dek, await C.decryptBinary(key, bytes, 'file/' + attId), 'file/' + attId);
    }
    try {
      await S.repo.write(FILES + attId + '.bin', bytes, null, 'Yedekten dosya geri yüklendi');
      files++;
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e; // dosya zaten var
    }
  }
  let added = 0;
  let updated = 0;
  for (const [id, r] of Object.entries(data.records || {})) {
    const cur = S.data.records[id];
    if (!cur) { S.data.records[id] = r; added++; }
    else if ((r.updatedAt || 0) > (cur.updatedAt || 0)) { S.data.records[id] = r; updated++; }
  }
  if (added || updated) commit();
  return { added, updated, files };
}
