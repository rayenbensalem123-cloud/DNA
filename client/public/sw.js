// Minimal service worker: makes the app installable and keeps the shell available offline.
// It never touches /api (letters and files always come live from the server).
const CACHE = 'bo-shell-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/federation-tunisienne-logo.webp'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api')) return;
  // Pages: network first, fall back to the cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/')));
    return;
  }
  // Static assets (hashed bundles, images): cache first, refreshed in the background.
  event.respondWith(caches.match(req).then((hit) => {
    const fresh = fetch(req).then((res) => { if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone())); return res; }).catch(() => hit);
    return hit || fresh;
  }));
});
