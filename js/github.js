// GitHub deposunu dosya deposu olarak kullanır (REST "contents" API'si).
// Sadece şifreli baytlar gönderilir. Her kayıt bir commit olur, yani GitHub geçmişi ayrıca yedek görevi görür.

import { toB64, fromB64 } from './crypto.js';
import * as db from './db.js';

export class NetworkError extends Error { name = 'NetworkError'; }
export class AuthError extends Error { name = 'AuthError'; }
export class NotFoundError extends Error { name = 'NotFoundError'; }
export class ConflictError extends Error { name = 'ConflictError'; }

const API = 'https://api.github.com';

export class GitHubRepo {
  constructor(owner, repo, token) {
    this.owner = owner;
    this.repo = repo;
    this.token = token;
    this.base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  }

  async request(method, path, body) {
    let res;
    try {
      res = await fetch(API + path, {
        method,
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new NetworkError('İnternet bağlantısı yok');
    }
    if (res.ok) return res.status === 204 ? null : res.json();

    let msg = '';
    try { msg = (await res.json()).message || ''; } catch { /* gövde yok */ }
    if (res.status === 401) throw new AuthError('GitHub erişim anahtarı (token) geçersiz ya da süresi dolmuş.');
    if (res.status === 404) throw new NotFoundError(msg || 'Bulunamadı');
    if (res.status === 409) throw new ConflictError(msg || 'Çakışma');
    if (res.status === 422 && method === 'PUT' && /sha/i.test(msg)) throw new ConflictError(msg);
    if (res.status === 429 || res.headers.get('x-ratelimit-remaining') === '0') {
      throw new Error('GitHub istek sınırına ulaşıldı. Biraz sonra tekrar dene.');
    }
    if (res.status === 403) {
      throw new AuthError("Token'ın bu depoya yazma izni yok. Token ayarlarında Contents: Read and write seçili olmalı.");
    }
    throw new Error(`GitHub hatası (${res.status}) ${msg}`.trim());
  }

  contentPath(path) {
    return `${this.base}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
  }

  info() {
    return this.request('GET', this.base);
  }

  async read(path) {
    let meta;
    try {
      meta = await this.request('GET', this.contentPath(path));
    } catch (e) {
      if (e instanceof NotFoundError) return null; // dosya yok ya da depo boş
      throw e;
    }
    if (Array.isArray(meta)) throw new Error(`${path} bir klasör`);
    let b64 = meta.encoding === 'base64' ? meta.content : '';
    // 1 MB üstü dosyalarda içerik gelmez; blob API'si 100 MB'a kadar verir.
    if (!b64) b64 = (await this.request('GET', `${this.base}/git/blobs/${meta.sha}`)).content;
    return { sha: meta.sha, bytes: fromB64(b64) };
  }

  async write(path, bytes, sha, message) {
    const res = await this.request('PUT', this.contentPath(path), {
      message,
      content: toB64(bytes),
      ...(sha ? { sha } : {}),
    });
    return res.content.sha;
  }

  async remove(path, message) {
    let meta;
    try {
      meta = await this.request('GET', this.contentPath(path));
    } catch (e) {
      if (e instanceof NotFoundError) return;
      throw e;
    }
    await this.request('DELETE', this.contentPath(path), { message, sha: meta.sha });
  }
}

// Yerel deneme modu (?demo): GitHub yerine bu cihazdaki IndexedDB'yi "uzak depo" gibi kullanır.
export class DemoRepo {
  constructor() {
    this.owner = 'demo';
    this.repo = 'kasa-veri';
  }

  wait() {
    return new Promise((r) => setTimeout(r, 120));
  }

  async info() {
    await this.wait();
    return { private: true, full_name: 'demo/kasa-veri' };
  }

  async read(path) {
    await this.wait();
    const v = await db.get('remote:' + path);
    return v ? { sha: v.sha, bytes: v.bytes } : null;
  }

  async write(path, bytes, sha) {
    await this.wait();
    const cur = await db.get('remote:' + path);
    if ((cur ? cur.sha : null) !== (sha || null)) throw new ConflictError('Çakışma');
    const next = crypto.randomUUID();
    await db.set('remote:' + path, { sha: next, bytes });
    return next;
  }

  async remove(path) {
    await this.wait();
    await db.del('remote:' + path);
  }
}
