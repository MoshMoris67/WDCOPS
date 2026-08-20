// Real offline support: caches the app shell as it's visited so previously-opened
// pages keep working with no connection, without ever touching API data.
//
// - Navigation requests: network-first. Try the network, cache a copy of what comes
//   back, and on failure serve the cached copy for that exact URL. Most in-app
//   navigation here is client-side (Next.js Link/router.push), which this service
//   worker never sees at all — so an exact-URL match is rare in practice. What
//   actually saves most offline navigations is the *route shell* fallback: a
//   pathname-only cached copy (any query string), fed either by a real document
//   fetch above or by AppLayout.tsx proactively caching each route it visits while
//   online. Every page here is fully client-rendered — none bake query-specific data
//   (e.g. which debtor id) into their server HTML — so any cached copy of a route
//   hydrates correctly and fetches its real content from IndexedDB/the network
//   itself once running, regardless of which exact query string it was cached under.
//   Only a route that's never been visited at all falls through to the small branded
//   offline fallback page instead of the browser's own generic interstitial.
// - Static assets (/_next/static/*, fonts, icons): cache-first. Hashed/immutable
//   filenames are safe to serve straight from cache, falling back to network (and
//   caching the result) only on a miss.
// - /api/* requests: untouched, network-only, never intercepted. The existing
//   IndexedDB-based offline call-log queue and auth cookies must keep working exactly
//   as they do today — this worker must never cache or rewrite an API response.
//
// Bump CACHE_VERSION on ANY meaningful change to the deployed app, not just this file —
// both caches below are versioned by it and get swept on the next activate. Learned the
// hard way: an early version of this worker left SHELLS_CACHE unversioned on purpose so
// it would "survive redeploys" — but a route's shell is a snapshot of whatever JS/HTML
// was live when it was cached, and surviving a redeploy is exactly what made a stale
// shell (cached from a hard-reload during testing, before a bug was fixed) keep serving
// the old, broken page indefinitely afterwards, even once the live site was current.
// Versioning both together means a redeploy actually invalidates what it should.
// IMPORTANT: src/components/AppLayout.tsx has its own SHELLS_CACHE_NAME constant that
// must be updated to match SHELLS_CACHE below whenever this version changes — it can't
// import from this file (this is a plain static asset, not part of the JS build).
const CACHE_VERSION = 'v2';
const CACHE_NAME = `wellcashops-${CACHE_VERSION}`;
const OFFLINE_URL = '/offline.html';
// Holds one cached document per app route (pathname only, no query string), fed by the
// page itself (see AppLayout.tsx) every time it visits a route while online. This app is
// entirely client-rendered: no page bakes query-specific data (e.g. which debtor id) into
// its server HTML, so any cached copy of a route's shell hydrates fine and fetches the
// real content itself once running — which is what makes it possible to fall back to it
// for a *different* query string on the same route below.
const SHELLS_CACHE = `wellcashops-route-shells-${CACHE_VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(OFFLINE_URL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((name) => name !== CACHE_NAME && name !== SHELLS_CACHE).map((name) => caches.delete(name)))
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
          const exactCopy = response.clone();
          const shellCopy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, exactCopy));
          // Also keep a pathname-only copy as this route's shell — covers a real
          // document load (cold launch, hard refresh) even without the client-side
          // helper in AppLayout.tsx ever running for this route yet.
          caches.open(SHELLS_CACHE).then((cache) => cache.put(new Request(url.pathname), shellCopy));
          return response;
        })
        .catch(async () => {
          // Exact URL (this pathname + this exact query string) seen before.
          const exact = await caches.match(request);
          if (exact) return exact;
          // Same route, different query — e.g. a different debtor id reached by
          // auto-advancing to the next queue entry, or the browser/OS reloading the
          // tab from wherever it happened to be when it was last backgrounded. Client
          // navigations to these routes never hit this service worker at all (Next.js
          // fetches an RSC payload, not a full document), so the exact URL is almost
          // never the one that's cached — but the route's shell (see SHELLS_CACHE
          // above) usually is, from an earlier visit while online.
          const shell = await caches.match(new Request(url.pathname), { ignoreSearch: true });
          if (shell) return shell;
          return caches.match(OFFLINE_URL);
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
