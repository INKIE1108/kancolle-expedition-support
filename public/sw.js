const CACHE_NAME = 'kancolle-expedition-support-v2.3.0';

function scopeUrl(path) {
  return new URL(path, self.registration.scope).toString();
}

const APP_SHELL = [
  scopeUrl('./'),
  scopeUrl('./index.html'),
  scopeUrl('./manifest.webmanifest'),
  scopeUrl('./icon.svg'),
  scopeUrl('./icon-192.png'),
  scopeUrl('./icon-512.png')
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || '艦これ遠征サポート';
  const options = {
    body: payload.body || '遠征が完了したよ。補給・再出発を確認してね。',
    icon: scopeUrl('./icon-192.png'),
    badge: scopeUrl('./icon-192.png'),
    tag: payload.tag || 'kancolle-expedition',
    data: { url: payload.url || scopeUrl('./') },
    requireInteraction: false
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || scopeUrl('./');

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) client.navigate(targetUrl);
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  const sameOrigin = requestUrl.origin === self.location.origin;

  // APIレスポンスは時刻や通知状態が命なので絶対にキャッシュしない。
  if (sameOrigin && requestUrl.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(scopeUrl('./'), copy));
          return response;
        })
        .catch(() => caches.match(scopeUrl('./')) || caches.match(scopeUrl('./index.html')))
    );
    return;
  }

  if (!sameOrigin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200) return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      });
    })
  );
});
