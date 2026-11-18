// 2 adımlı doğrulama kodları (TOTP, RFC 6238). Google Authenticator ile aynı kodları üretir.

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(s) {
  const clean = String(s).toUpperCase().replace(/[\s=-]/g, '');
  if (!clean || /[^A-Z2-7]/.test(clean)) return null;
  let bits = 0;
  let val = 0;
  const out = [];
  for (const ch of clean) {
    val = ((val << 5) | B32.indexOf(ch)) & 0xffffff;
    bits += 5;
    if (bits >= 8) {
      out.push((val >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

// Düz anahtar ("JBSW Y3DP …") ya da otpauth://totp/... bağlantısı kabul eder.
export function parseOtp(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  const cfg = { secret: s, algorithm: 'SHA-1', digits: 6, period: 30, issuer: '', account: '' };
  if (/^otpauth:/i.test(s)) {
    const m = s.match(/^otpauth:\/\/([^/?#]+)\/([^?#]*)(?:\?([^#]*))?/i);
    if (!m || m[1].toLowerCase() !== 'totp') return null;
    let label = m[2];
    try { label = decodeURIComponent(label); } catch { /* olduğu gibi */ }
    const p = new URLSearchParams(m[3] || '');
    cfg.secret = p.get('secret') || '';
    const alg = (p.get('algorithm') || 'SHA1').toUpperCase().replace('-', '');
    cfg.algorithm = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' }[alg] || 'SHA-1';
    cfg.digits = Number(p.get('digits')) || 6;
    cfg.period = Number(p.get('period')) || 30;
    const i = label.indexOf(':');
    cfg.issuer = p.get('issuer') || (i >= 0 ? label.slice(0, i) : '');
    cfg.account = i >= 0 ? label.slice(i + 1).trim() : label;
  }
  const key = base32Decode(cfg.secret);
  if (!key || key.length < 5) return null;
  if (cfg.digits < 6 || cfg.digits > 8 || cfg.period < 5 || cfg.period > 300) return null;
  cfg.key = key;
  return cfg;
}

export async function totpCode(cfg, time = Date.now()) {
  let counter = Math.floor(time / 1000 / cfg.period);
  const msg = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    msg[i] = counter & 255;
    counter = Math.floor(counter / 256);
  }
  const k = await crypto.subtle.importKey('raw', cfg.key, { name: 'HMAC', hash: cfg.algorithm }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, msg));
  const off = mac[mac.length - 1] & 15;
  const bin = ((mac[off] & 127) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(bin % 10 ** cfg.digits).padStart(cfg.digits, '0');
}

export function secondsLeft(cfg, time = Date.now()) {
  return cfg.period - (Math.floor(time / 1000) % cfg.period);
}
