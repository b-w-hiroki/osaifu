// オフライン対応用のキャッシュ（アプリシェルのみ）
const CACHE = 'osaifu-v18';
const ASSETS = ['./', 'index.html', 'app.html', 'news.html', 'news.css', 'news-data.js', 'news-page.js', 'terms.html', 'privacy.html', 'styles.css', 'app.js', 'ads.js', 'analytics.js', 'sister-apps.js', 'sync.js', 'config.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/apple-touch-icon.png'];

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

// ネットワーク優先・失敗時はキャッシュ
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request)),
  );
});

// 通知タップでアプリを開く
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((list) => {
      const c = list[0];
      return c ? c.focus() : self.clients.openWindow('./app.html');
    }),
  );
});
