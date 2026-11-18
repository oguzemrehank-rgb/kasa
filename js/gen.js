// Şifre üretici ve şifre gücü ölçer.

const FULL = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*-_=+?.:;~',
};
const AMBIGUOUS = 'lIO01';

function randInt(n) {
  const limit = Math.floor(0x100000000 / n) * n; // eşit dağılım için reddetme örneklemesi
  const buf = new Uint32Array(1);
  let x;
  do {
    crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return x % n;
}

export function generate({ length = 20, lower = true, upper = true, digits = true, symbols = true, avoidAmbiguous = true } = {}) {
  const sets = [];
  for (const [k, on] of Object.entries({ lower, upper, digits, symbols })) {
    if (!on) continue;
    let s = FULL[k];
    if (avoidAmbiguous) s = [...s].filter((c) => !AMBIGUOUS.includes(c)).join('');
    sets.push(s);
  }
  if (!sets.length) sets.push(FULL.lower);
  const all = sets.join('');
  const out = sets.map((s) => s[randInt(s.length)]); // seçilen her türden en az bir karakter
  while (out.length < length) out.push(all[randInt(all.length)]);
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.slice(0, Math.max(length, 4)).join('');
}

const COMMON = [
  '123456', '12345678', '123456789', 'password', 'qwerty', '111111', '000000', 'sifre', 'parola', 'abc123',
  'iloveyou', 'galatasaray', 'fenerbahce', 'besiktas', 'trabzonspor', 'asdasd', 'qweasd', '1q2w3e', 'admin',
  'letmein', 'istanbul', 'ankara', 'izmir', 'turkiye', 'askim',
];

export function strength(pw) {
  if (!pw) return { score: 0, bits: 0, label: '' };
  let pool = 0;
  if (/[a-zçğıöşü]/.test(pw)) pool += 29;
  if (/[A-ZÇĞİÖŞÜ]/.test(pw)) pool += 29;
  if (/\d/.test(pw)) pool += 10;
  if (/[^A-Za-z0-9çğıöşüÇĞİÖŞÜ]/.test(pw)) pool += 20;
  const perChar = Math.log2(Math.max(pool, 2));
  let bits = pw.length * perChar;
  const lower = pw.toLocaleLowerCase('tr');
  // Bilinen kelime/dizi neredeyse hiç güç katmaz; uzun bir cümlenin içinde geçmesi ise sorun değil.
  for (const c of COMMON) if (lower.includes(c)) bits -= c.length * perChar - 4;
  if (/^(.)\1+$/.test(pw)) bits = Math.min(bits, 8);
  if (/(.)\1\1/.test(pw)) bits -= 8;
  if (/(0123|1234|2345|3456|4567|5678|6789|abcd|qwer|asdf|zxcv)/i.test(pw)) bits -= 10;
  if (new Set(pw).size < pw.length / 2) bits *= 0.75;
  bits = Math.max(0, Math.round(bits));
  const score = bits < 30 ? 0 : bits < 45 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  return { score, bits, label: ['Çok zayıf', 'Zayıf', 'Orta', 'Güçlü', 'Çok güçlü'][score] };
}
