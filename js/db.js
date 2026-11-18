// Cihazdaki küçük anahtar-değer deposu (IndexedDB). Sadece şifreli veri ve ayarlar burada durur.

let dbName = 'kasa';
let dbPromise = null;

export function init(name) {
  dbName = name;
  dbPromise = null;
}

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction('kv', mode);
    const req = fn(t.objectStore('kv'));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const get = (key) => tx('readonly', (s) => s.get(key));
export const set = (key, value) => tx('readwrite', (s) => s.put(value, key));
export const del = (key) => tx('readwrite', (s) => s.delete(key));
export const clear = () => tx('readwrite', (s) => s.clear());
