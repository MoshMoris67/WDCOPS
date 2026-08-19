// Real offline support: caches the app shell as it's visited so previously-opened
// pages keep working with no connection, without ever touching API data.
//
// - Navigation requests: network-first. Try the network, cache a copy of what comes
//   back, and on failure serve the cached copy for that exact URL — or, if that route
//   was never visited while online, a small branded offline fallback page instead of
//   the browser's own generic interstitial.
// - Static assets (/_next/static/*, fonts, icons): cache-first. Hashed/immutable
//   filenames are safe to serve straight from cache, falling back to network (and
//   caching the result) only on a miss.
// - /api/* requests: untouched, network-only, never intercepted. The existing
//   IndexedDB-based offline call-log queue and auth cookies must keep working exactly
//   as they do today — this worker must never cache or rewrite an API response.
//
// Bump CACHE_VERSION on meaningful changes here; old-version caches are removed on
// activate so redeploys don't accumulate stale entries forever.
const CACHE_VERSION = 'v1';
const CACHE_NAME = `wellcashops-${CACHE_VERSION}`;
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(OFFLINE_URL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)))
    ).then(() => self.clients.claim())
  );
});

function isApiRequest(url) {
  return url.pathname.startsWith('/api/');
}

function isStaticAsset(url) {
  return url.pathname.startsWith('/_next/static/') || /\.(?:woff2?|ttf|otf|png|jpg|jpeg|svg|ico)$/.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // never intercept POST/PATCH/DELETE — including call-log writes
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isApiRequest(url)) return; // network-only, always — no caching, no interception

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || caches.match(OFFLINE_URL);
        })
    );
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        });
      })
    );
  }
});
