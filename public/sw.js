// Minimal service worker — exists only to satisfy Chrome/Android's PWA
// installability requirement (a registered SW with a fetch handler).
// It does no caching and never intercepts responses, so it can't go stale
// or serve outdated data — every request just passes straight through to
// the network, same as if there were no service worker at all.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
