// Şifreleme katmanı. Her şey tarayıcıda, Web Crypto ile yapılır; dışarıya düz metin çıkmaz.
//
//   Ana şifre ──PBKDF2-SHA256 (600.000 tur)──► KEK ──AES-GCM──► DEK'i sarar
//   Kurtarma anahtarı ──PBKDF2──► KEK₂ ──AES-GCM──► aynı DEK'i sarar
//   DEK (rastgele 256 bit) ──AES-256-GCM──► kasa verisi ve dosyalar
//
// Ana şifre değişince sadece sarmalayan katman yenilenir; veri yeniden şifrelenmez.

const te = new TextEncoder();
const td = new TextDecoder();
const subtle = crypto.subtle;

export const PW_ITERATIONS = 600000;
export const RECOVERY_ITERATIONS = 100000;

export class WrongSecretError extends Error {
  constructor() {
    super('Şifre yanlış');
    this.name = 'WrongSecretError';
  }
}

export const utf8 = (s) => te.encode(s);
export const fromUtf8 = (b) => td.decode(b);

export function toB64(u8) {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) s += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  return btoa(s);
}

export function fromB64(str) {
  const s = atob(String(str).replace(/\s+/g, ''));
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

export function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

// Her şifreli parça amacına bağlanır (ör. bir dosyanın şifreli hali veri yerine kullanılamaz).
const aad = (purpose) => te.encode('kasa/v1/' + purpose);

async function deriveKek(secret, salt, iterations) {
  const base = await subtle.importKey('raw', te.encode(String(secret).normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export function newDataKey() {
  return subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function encryptBytes(key, bytes, purpose) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(purpose) }, key, bytes));
  return { iv: toB64(iv), ct: toB64(ct) };
}

export async function decryptBytes(key, box, purpose) {
  const pt = await subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(box.iv), additionalData: aad(purpose) },
    key,
    fromB64(box.ct),
  );
  return new Uint8Array(pt);
}

// JSON.stringify çağrıdan hemen önce (senkron) çalışır: o anki verinin kopyası şifrelenir.
export function encryptJSON(key, obj, purpose) {
  return encryptBytes(key, utf8(JSON.stringify(obj)), purpose);
}

export async function decryptJSON(key, box, purpose) {
  return JSON.parse(fromUtf8(await decryptBytes(key, box, purpose)));
}

// Dosyalar için ikili biçim: [12 bayt IV][şifreli veri + etiket]
export async function encryptBinary(key, bytes, purpose) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(purpose) }, key, bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}

export async function decryptBinary(key, data, purpose) {
  const pt = await subtle.decrypt(
    { name: 'AES-GCM', iv: data.subarray(0, 12), additionalData: aad(purpose) },
    key,
    data.subarray(12),
  );
  return new Uint8Array(pt);
}

export async function wrapKey(dek, secret, iterations) {
  const salt = randomBytes(16);
  const kek = await deriveKek(secret, salt, iterations);
  const raw = new Uint8Array(await subtle.exportKey('raw', dek));
  const box = await encryptBytes(kek, raw, 'wrap');
  raw.fill(0);
  return { kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toB64(salt) }, ...box };
}

export async function unwrapKey(wrapped, secret) {
  if (!wrapped || !wrapped.kdf || wrapped.kdf.name !== 'PBKDF2') throw new Error('Desteklenmeyen anahtar biçimi');
  const kek = await deriveKek(secret, fromB64(wrapped.kdf.salt), wrapped.kdf.iterations);
  let raw;
  try {
    raw = await decryptBytes(kek, wrapped, 'wrap');
  } catch {
    throw new WrongSecretError();
  }
  const key = await subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  raw.fill(0);
  return key;
}

// Kurtarma anahtarı: 32 karakter = 160 bit, karışmayan harflerle (I, L, O, U yok), 4'lü gruplar.
const RK_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function newRecoveryKey() {
  const b = randomBytes(32);
  let s = '';
  for (let i = 0; i < 32; i++) s += RK_ALPHABET[b[i] & 31];
  return s.match(/.{4}/g).join('-');
}

export function normalizeRecoveryKey(s) {
  return String(s)
    .toUpperCase()
    .replace(/[OÖ]/g, '0')
    .replace(/[IİL]/g, '1')
    .replace(/[^0-9A-Z]/g, '');
}

export function isRecoveryKeyShape(s) {
  const n = normalizeRecoveryKey(s);
  return n.length === 32 && [...n].every((c) => RK_ALPHABET.includes(c));
}
