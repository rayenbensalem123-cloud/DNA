// Minimal service worker: makes the app installable and keeps the shell available offline.
// It never touches /api (letters and files always come live from the server).
const CACHE = 'bo-shell-v2';
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
  // Pages + index/manifest: network first so a new deploy is picked up on the
  // very next reload; fall back to the cached shell only when offline.
  if (req.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/manifest.webmanifest') {
    event.respondWith(fetch(req).then((res) => { caches.open(CACHE).then((c) => c.put('/', res.clone())).catch(() => {}); return res; }).catch(() => caches.match('/')));
    return;
  }
  // Hashed static bundles: stable content, cache first but refreshed in the
  // background (new bundle names arrive with the fresh HTML anyway).
  event.respondWith(caches.match(req).then((hit) => {
    const fresh = fetch(req).then((res) => { if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone())); return res; }).catch(() => hit);
    return hit || fresh;
  }));
});
