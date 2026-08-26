/**
 * Sendforge Progressive Web App (PWA) Service Worker
 * Tiered Cache Architecture:
 * - Immutable Git Objects: Cache-First (sendforge-git-v1)
 * - Repository & Collaboration Metadata: Stale-While-Revalidate (sendforge-meta-v1)
 * - App Shell & Static Assets: Cache-First (sendforge-static-v1)
 * - Navigation: Network-First with cached /index.html fallback
 * - Edge Write API (/api/submit/*): Network-Only
 */

const CACHE_VERSION = 'v1';
const STATIC_CACHE = `sendforge-static-${CACHE_VERSION}`;
const GIT_CACHE = `sendforge-git-${CACHE_VERSION}`;
const META_CACHE = `sendforge-meta-${CACHE_VERSION}`;

const PRECACHE_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/og-card.png',
];

// Regex Matchers
const GIT_OBJECT_REGEX = /\/objects\/([0-9a-f]{2}\/[0-9a-f]{38}|pack\/pack-[0-9a-f]{40}\.(pack|idx)|info\/packs)$/i;
const META_REGEX = /\/(meta\.json|info\/refs|pulls\.json|issues\.json|repos\.json|meta\/(issues|pulls)\/[^/]+\.json)$/i;
const STATIC_ASSET_REGEX = /\.(js|css|png|jpg|jpeg|svg|webp|woff|woff2|ttf|ico)$/i;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(PRECACHE_SHELL).catch(() => {
        // Continue even if some optional precache items fail in dev
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  const activeCaches = [STATIC_CACHE, GIT_CACHE, META_CACHE];
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (!activeCaches.includes(key)) {
            return caches.delete(key);
          }
          return Promise.resolve();
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Non-GET or Write Endpoints: Network-Only
  if (request.method !== 'GET' || url.pathname.startsWith('/api/submit/')) {
    return;
  }

  // 2. Navigation Request: Network-First with /index.html fallback
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((networkRes) => {
          if (networkRes.ok) {
            const clone = networkRes.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
          }
          return networkRes;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const fallback = await caches.match('/index.html');
          return fallback || new Response('Offline - Sendforge Git Forge', {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        })
    );
    return;
  }

  // 3. Immutable Git Objects: Cache-First
  if (GIT_OBJECT_REGEX.test(url.pathname)) {
    event.respondWith(
      caches.open(GIT_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) {
          return cached;
        }
        const networkRes = await fetch(request);
        if (networkRes.ok) {
          cache.put(request, networkRes.clone());
        }
        return networkRes;
      })
    );
    return;
  }

  // 4. Dynamic Repository & Collaboration Metadata: Stale-While-Revalidate (SWR)
  if (META_REGEX.test(url.pathname)) {
    event.respondWith(
      caches.open(META_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const fetchPromise = fetch(request)
          .then((networkRes) => {
            if (networkRes.ok) {
              cache.put(request, networkRes.clone());
            }
            return networkRes;
          })
          .catch(() => cached);

        return cached || fetchPromise;
      })
    );
    return;
  }

  // 5. Static Assets: Cache-First with Network Fallback
  if (STATIC_ASSET_REGEX.test(url.pathname) || url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) {
          return cached;
        }
        const networkRes = await fetch(request);
        if (networkRes.ok) {
          cache.put(request, networkRes.clone());
        }
        return networkRes;
      })
    );
    return;
  }

  // Default: Network with Cache Fallback
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});

// Cache management message listener
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (event.data === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
    );
  }
});
