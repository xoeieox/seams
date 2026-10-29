// Seams Launcher service worker - APP-SHELL CACHE ONLY.
// Freshness-by-hash doctrine: an attribution receipt or export that arrived this session is the
// only thing allowed to claim anything. A cached /api (or /ops, /agent, /health) response would
// render a stale receipt as if it were current - so every dynamic route is left on the network,
// untouched, by the DYNAMIC guard below. This worker never intercepts, caches, or replays it.
// Static app-shell assets only, network-first (always revalidate; the cache answers offline only).
'use strict';

const CACHE = 'seams-shell-v1';
// The complete static cacheable set. If server.mjs serves it as static, it may appear here.
// Nothing under /api, /ops, or /agent may EVER appear here.
const ASSETS = [
  '/',
  '/app.js',
  '/app.css',
  '/launcher-core.mjs',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

// network-only, no-intercept list: anything dynamic. A match means the SW steps aside entirely.
const DYNAMIC = (u) =>
  u.pathname === '/api' || u.pathname.startsWith('/api/') ||
  u.pathname.startsWith('/ops/') || u.pathname.startsWith('/agent/') ||
  u.pathname === '/health';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return; // every write is the network's, always
  const u = new URL(req.url);
  if (u.origin !== self.location.origin || DYNAMIC(u)) return; // step aside: never touch dynamic traffic
  e.respondWith((async () => {
    try {
      const net = await fetch(req); // network-first: fresh bytes when online, never a stale claim
      if (net && net.ok && ASSETS.includes(u.pathname)) {
        const c = await caches.open(CACHE);
        c.put(req, net.clone());
      }
      return net;
    } catch (err) {
      if (ASSETS.includes(u.pathname)) {
        const hit = await caches.match(req);
        if (hit) return hit;
      }
      throw err;
    }
  })());
});
