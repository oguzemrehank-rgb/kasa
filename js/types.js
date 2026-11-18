// Kayıt türleri ve hazır alanları. Her kayda istenirse ek alan da eklenebilir.

export const TYPES = {
  account: {
    label: 'Hesap', icon: 'user', words: 'hesap giris uyelik',
    fields: [['Kullanıcı adı', 'text'], ['E-posta', 'email'], ['Şifre', 'secret'], ['Web sitesi', 'url'], ['2FA anahtarı', 'totp']],
  },
  note: { label: 'Not', icon: 'note', words: 'not bilgi', fields: [] },
  card: {
    label: 'Kart', icon: 'card', words: 'kart banka kredi',
    fields: [['Kart üzerindeki isim', 'text'], ['Kart numarası', 'secret'], ['Son kullanma (AA/YY)', 'text'], ['CVV', 'secret'], ['PIN', 'secret'], ['Banka', 'text']],
  },
  id: {
    label: 'Kimlik / Belge', icon: 'id', words: 'kimlik belge evrak',
    fields: [['Belge türü', 'text'], ['Ad soyad', 'text'], ['Belge numarası', 'secret'], ['Veriliş tarihi', 'text'], ['Geçerlilik tarihi', 'text']],
  },
  wifi: {
    label: 'Wi-Fi', icon: 'wifi', words: 'wifi kablosuz internet ag modem',
    fields: [['Ağ adı (SSID)', 'text'], ['Şifre', 'secret'], ['Modem arayüzü', 'url'], ['Modem kullanıcı adı', 'text'], ['Modem şifresi', 'secret']],
  },
};

export const KINDS = { text: 'Metin', secret: 'Gizli', url: 'Bağlantı', email: 'E-posta', totp: '2FA anahtarı' };

export const typeOf = (r) => TYPES[r.type] || TYPES.note;

export function safeUrl(v) {
  let s = String(v || '').trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

function hostOf(v) {
  const u = safeUrl(v);
  try { return u ? new URL(u).host : v; } catch { return v; }
}

// Listede başlığın altında görünecek kısa bilgi (gizli alanlar asla gösterilmez).
export function subtitle(r) {
  for (const f of r.fields || []) if (f.value && (f.kind === 'text' || f.kind === 'email')) return f.value;
  for (const f of r.fields || []) if (f.value && f.kind === 'url') return hostOf(f.value);
  if (r.description) return r.description.split('\n')[0];
  if (r.notes) return r.notes.split('\n')[0];
  return (r.tags || []).map((t) => '#' + t).join(' ');
}
