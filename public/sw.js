// Minimal service worker — present only to satisfy PWA install criteria on
// browsers that require one. Deliberately does no caching: this app already
// has its own offline strategy for call logs (an IndexedDB queue, synced when
// back online), and a caching service worker on top of that would risk
// serving stale pages during active development instead of helping anything.
// Every request just falls through to the network as normal.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
