const CACHE_NAME = 'kancolle-expedition-support-v2.0.0';

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

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  const sameOrigin = requestUrl.origin === self.location.origin;

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
