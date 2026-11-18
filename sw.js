// Uygulama dosyalarını önbelleğe alır: internet yokken de Kasa açılır.
// Önce ağdan güncel sürüm denenir, olmazsa önbellek kullanılır. GitHub API'sine dokunmaz.

const CACHE = 'kasa-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/crypto.js',
  './js/db.js',
  './js/gen.js',
  './js/github.js',
  './js/search.js',
  './js/store.js',
  './js/totp.js',
  './js/types.js',
  './js/ui.js',
  './js/util.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await Promise.race([fetch(new Request(url.href, { cache: 'no-cache' })), timeout(5000)]);
      if (res.ok) cache.put(url.origin + url.pathname, res.clone());
      return res;
    } catch {
      const hit = await cache.match(url.origin + url.pathname, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      return Response.error();
    }
  })());
});
