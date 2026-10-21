/**
 * おきばメモの Service Worker（オフラインで起動できるよう、アプリ本体だけをキャッシュする）。
 * ユーザーのデータ（IndexedDB）には触らない。外部への通信もしない。
 *
 * VERSION は scripts/okiba-sw-version.js がアプリのファイルの内容から生成する。
 * アプリのファイルを変えたら `node scripts/okiba-sw-version.js` を実行すること（CI が --check で検知する）。
 */
const VERSION = 'okiba-25765414';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './core.js',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  // HTTPキャッシュを通さずに取り直す（古い app.js を新しい版のキャッシュに入れないため）
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('okiba-') && k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  if (req.mode === 'navigate') {
    event.respondWith(caches.open(VERSION).then(c => c.match('./index.html')).then(r => r || fetch(req)));
    return;
  }
  event.respondWith(caches.open(VERSION).then(c => c.match(req, { ignoreSearch: true })).then(r => r || fetch(req)));
});
