# Kasa

Şifrelerin, hesap bilgilerin ve unutmaman gereken her şey için kişisel, şifreli kasa.
Telefonda ve bilgisayarda açılır, internet yokken de çalışır.

- **Uçtan uca şifreli:** Bilgiler cihazında, ana şifrenle şifrelenir. GitHub'a sadece okunamayan, şifreli hali gider.
- **İki aşamalı kayıt:** Yeni bilgi önce **Onay bekleyen** listesine düşer. Açıklamasını yazıp onayladığında **Kasa**'ya geçer.
- **Akıllı arama:** Türkçe karakter ve yazım hatası fark etmez ("sifre" = "şifre", "netlfix" → Netflix). İlişkili kelimeleri de tanır ("internet" → modem, Wi-Fi, Superonline).
- **İlişkilendirme:** Her kayıtta "Benzer olabilir" önerileri çıkar, istediğin kayıtları birbirine bağlayabilirsin.
- **2 adımlı doğrulama kodları**, **dosya/fotoğraf ekleme**, **şifre üretici**, **şifreli yedek**, **değişiklik geçmişi**.

---

## Kurulum (bir kere, yaklaşık 10 dakika)

### 1. GitHub'da iki depo aç

| Depo adı | Görünürlük | Ne için |
|---|---|---|
| `kasa` | **Public** | Sitenin kodu (içinde hiçbir sır yok) |
| `kasa-veri` | **Private** | Şifreli verilerin. Açarken "Add a README file" kutusunu işaretle. |

> Ücretsiz GitHub planında site (GitHub Pages) sadece public depodan yayınlanabilir. Bu sorun değil: kod herkese açık, veriler ayrı ve gizli depoda, üstelik şifreli.

### 2. Kodu `kasa` deposuna yükle

`kasa` deposunu aç → **Add file → Upload files** → bu klasörün **içindekileri** (`index.html`, `sw.js`, `manifest.webmanifest`, `README.md`, `css`, `js`, `icons`, `tools` klasörleri) sürükleyip bırak → **Commit changes**.

### 3. Siteyi yayına al

`kasa` deposu → **Settings → Pages** → *Build and deployment* altında
**Source:** Deploy from a branch, **Branch:** `main` ve `/ (root)` → **Save**.

1-2 dakika sonra sitenin adresi hazır olur: `https://KULLANICI-ADIN.github.io/kasa/`

### 4. Erişim anahtarı (token) oluştur

1. [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new) sayfasını aç (Fine-grained token).
2. **Token name:** `kasa-bilgisayar`. **Expiration:** en uzun süre.
3. **Repository access:** *Only select repositories* → sadece `kasa-veri`.
4. **Permissions → Repository permissions → Contents:** *Read and write*.
5. **Generate token**, çıkan kodu kopyala.

> Her cihaz için ayrı token aç (`kasa-bilgisayar`, `kasa-telefon`). Telefon kaybolursa sadece onun token'ını iptal edersin.

### 5. Kasayı oluştur (bilgisayarda)

Siteyi aç → **Yeni kasa oluştur** → GitHub kullanıcı adın, `kasa-veri`, token → **ana şifre** belirle.

Sonra ekrana gelen **kurtarma anahtarını kâğıda yaz.** Ana şifreni unutursan kasayı sadece bununla açabilirsin.

### 6. Telefona kur (Android)

1. Chrome'da sitenin adresini aç → sağ üstteki **⋮** → **Uygulamayı yükle** (ya da *Ana ekrana ekle*).
2. Ana ekrandaki **Kasa** simgesinden aç → **Başka cihazda oluşturduğum kasaya bağlan**.
3. Kullanıcı adın, `kasa-veri` ve telefon için açtığın token'ı gir, sonra ana şifreni yaz.

---

## Güvenlik

- Ana şifre ve kurtarma anahtarı hiçbir yere gönderilmez. **İkisini birden kaybedersen veriler kurtarılamaz.** Bunu kimse (GitHub dahil) sıfırlayamaz.
- Şifreleme: AES-256-GCM. Anahtar, ana şifreden PBKDF2-SHA256 ile 600.000 turda türetilir. Dosyalar da aynı anahtarla ayrı ayrı şifrelenir.
- Veri deposu herkese açıksa (public) kurulum reddedilir.
- Token, cihazda o cihaza özel bir anahtarla şifreli saklanır ve sadece `kasa-veri` deposuna erişebilir. Cihaz kaybolursa: GitHub → Settings → Developer settings → Fine-grained tokens → o token → **Revoke**.
- Kasa 5 dakika kullanılmazsa kilitlenir. Kopyalanan şifre 30 saniye sonra panodan silinir. İkisi de Ayarlar'dan değiştirilebilir.
- Uygulama dışarıdan hiçbir kod ya da kütüphane yüklemez (Content-Security-Policy ile de engellenir).
- Bu kişisel bir projedir, bağımsız bir güvenlik denetiminden geçmemiştir.

## Kullanım ipuçları

- **Hızlı ekleme:** Sağ alttaki **+** ile ekle, ayrıntıları sonra onaylarken yaz.
- **Etiketler:** `#ev`, `#banka`, `#abonelik` gibi etiketler listede filtre olarak çıkar.
- **2FA kodu:** Sitenin verdiği anahtarı (ya da `otpauth://` bağlantısını) yapıştır. Android'de QR kodun fotoğrafını da seçebilirsin.
- **Geçmiş:** Her düzenlemede eski hali saklanır (son 15 sürüm) ve geri dönülebilir. Ayrıca GitHub'da her değişiklik ayrı bir commit olarak durur.
- **Yedek:** Ayarlar → *Şifreli yedek indir*. Ayda bir alıp bilgisayarında saklaman iyi olur.
- **Çöp kutusu:** Silinen kayıtlar Ayarlar → Çöp kutusu'nda bekler. Oradan geri alabilir ya da kalıcı olarak silebilirsin.

## Yerelde denemek

Bilgisayarında [Node.js](https://nodejs.org) varsa:

```powershell
node tools/serve.mjs
```

Sonra tarayıcıda `http://localhost:8765/?demo` adresini aç. Deneme modu GitHub'a bağlanmaz, her şey sadece o tarayıcıda durur. Ayarlar'daki *Örnek kayıtlar ekle* düğmesiyle örnek kayıtlar ekleyebilirsin.

## Dosyalar

| Dosya | Görevi |
|---|---|
| `js/crypto.js` | Şifreleme, anahtar türetme, kurtarma anahtarı |
| `js/store.js` | Kayıtlar, kilit, GitHub ile eşitleme ve birleştirme, yedek |
| `js/github.js` | GitHub API'si (ve deneme modunun yerel deposu) |
| `js/search.js` | Arama motoru ve "benzer olabilir" önerileri |
| `js/totp.js` | 2 adımlı doğrulama kodları |
| `js/gen.js` | Şifre üretici ve şifre gücü ölçer |
| `js/app.js` | Tüm ekranlar |
| `sw.js` | İnternetsiz çalışma (önbellek) |

## Sonraki aşamalar

- **Aşama 2:** Cihazda çalışan küçük bir model ile anlam tabanlı arama ve daha iyi ilişkilendirme.
- **Aşama 3:** Bilgisayarda Ollama (Jarvis'in kullandığı gemma4) ile soru-cevap ve onay bekleyen kayıtlar için açıklama taslağı.
