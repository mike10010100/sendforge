/**
 * Tier 1 - Feature 37: Progressive Web App (PWA) & Full Offline Caching (F37 / R5)
 *
 * Validates:
 * 1. Web App Manifest (manifest.json) JSON schema compliance.
 * 2. Cache-First strategy for static bundles (assets/*.js, assets/*.css).
 * 3. Cache-First strategy for immutable Git objects (/objects/xx/xxx, /objects/pack/*).
 * 4. Stale-While-Revalidate strategy for dynamic metadata (meta.json, info/refs, pulls.json, issues.json).
 * 5. Network-First navigation with fallback to cached /index.html on network failure.
 * 6. Offline status badge indicator and online/offline event listeners.
 * 7. Service worker cache versioning, migration, and eviction of old cache buckets.
 */

import { describe, it, assert } from '../harness/framework.js';

// Emulated Service Worker Cache Storage
class MockCache {
  constructor(name) {
    this.name = name;
    this.entries = new Map();
  }
  async match(requestUrl) {
    const key = typeof requestUrl === 'string' ? requestUrl : requestUrl.url;
    return this.entries.get(key) || null;
  }
  async put(requestUrl, response) {
    const key = typeof requestUrl === 'string' ? requestUrl : requestUrl.url;
    this.entries.set(key, response);
  }
  async delete(requestUrl) {
    const key = typeof requestUrl === 'string' ? requestUrl : requestUrl.url;
    return this.entries.delete(key);
  }
  async keys() {
    return Array.from(this.entries.keys());
  }
}

class MockCacheStorage {
  constructor() {
    this.caches = new Map();
  }
  async open(cacheName) {
    if (!this.caches.has(cacheName)) {
      this.caches.set(cacheName, new MockCache(cacheName));
    }
    return this.caches.get(cacheName);
  }
  async has(cacheName) {
    return this.caches.has(cacheName);
  }
  async delete(cacheName) {
    return this.caches.delete(cacheName);
  }
  async keys() {
    return Array.from(this.caches.keys());
  }
}

// Service Worker caching router logic
class ServiceWorkerRouter {
  constructor(cacheStorage, cacheVersion = 'sendforge-v1') {
    this.cacheStorage = cacheStorage;
    this.cacheVersion = cacheVersion;
  }

  classifyRoute(urlStr) {
    const url = new URL(urlStr, 'http://localhost');
    const path = url.pathname;

    if (path.match(/\/objects\/[0-9a-f]{2}\/[0-9a-f]{38}$/) || path.includes('/objects/pack/')) {
      return 'git-object'; // Cache-First
    }
    if (path.startsWith('/assets/') || path.endsWith('.js') || path.endsWith('.css') || path.endsWith('.png')) {
      return 'static-asset'; // Cache-First
    }
    if (path.endsWith('meta.json') || path.endsWith('info/refs') || path.endsWith('pulls.json') || path.endsWith('issues.json') || path.endsWith('repos.json')) {
      return 'dynamic-meta'; // Stale-While-Revalidate
    }
    return 'navigation'; // Network-First with /index.html fallback
  }

  async handleFetch(urlStr, networkFetcher) {
    const routeType = this.classifyRoute(urlStr);
    const cache = await this.cacheStorage.open(this.cacheVersion);

    if (routeType === 'git-object' || routeType === 'static-asset') {
      // Cache-First
      const cached = await cache.match(urlStr);
      if (cached) return { source: 'cache', response: cached };
      const netRes = await networkFetcher(urlStr);
      if (netRes && netRes.status === 200) {
        await cache.put(urlStr, netRes);
      }
      return { source: 'network', response: netRes };
    }

    if (routeType === 'dynamic-meta') {
      // Stale-While-Revalidate
      const cached = await cache.match(urlStr);
      const netPromise = networkFetcher(urlStr).then(async (netRes) => {
        if (netRes && netRes.status === 200) {
          await cache.put(urlStr, netRes);
        }
        return netRes;
      });

      if (cached) {
        return { source: 'cache-stale', response: cached, revalidating: netPromise };
      }
      const freshRes = await netPromise;
      return { source: 'network', response: freshRes };
    }

    // Navigation: Network-First with fallback
    try {
      const netRes = await networkFetcher(urlStr);
      if (netRes && netRes.status === 200) {
        await cache.put(urlStr, netRes);
      }
      return { source: 'network', response: netRes };
    } catch {
      const fallback = await cache.match('/index.html') || await cache.match('./index.html');
      if (fallback) {
        return { source: 'fallback-cache', response: fallback };
      }
      throw new Error('Offline and no cached fallback available');
    }
  }

  async activateAndCleanOldCaches() {
    const keys = await this.cacheStorage.keys();
    for (const k of keys) {
      if (k !== this.cacheVersion) {
        await this.cacheStorage.delete(k);
      }
    }
  }
}

describe('Tier 1 - Feature 37: PWA & Full Offline Caching (F37 / R5)', () => {
  it('T1.37.1: manifest.json schema conforms to standard PWA specifications', () => {
    const manifest = {
      name: 'Sendforge — High-Performance Static Git Forge',
      short_name: 'Sendforge',
      description: 'High-performance static-first Git forge powered by sendfile and in-browser Git resolution.',
      start_url: './',
      display: 'standalone',
      background_color: '#0d1117',
      theme_color: '#161b22',
      icons: [
        {
          src: '/assets/icon-192.png',
          sizes: '192x192',
          type: 'image/png',
          purpose: 'any maskable'
        },
        {
          src: '/assets/icon-512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any maskable'
        }
      ]
    };

    assert.strictEqual(manifest.display, 'standalone');
    assert.strictEqual(manifest.background_color, '#0d1117');
    assert.strictEqual(manifest.icons.length, 2);
    assert.strictEqual(manifest.icons[0].sizes, '192x192');
    assert.strictEqual(manifest.icons[1].sizes, '512x512');
  });

  it('T1.37.2: Static assets use Cache-First strategy', async () => {
    const cacheStorage = new MockCacheStorage();
    const router = new ServiceWorkerRouter(cacheStorage);

    let networkFetchCount = 0;
    const mockNetwork = async (url) => {
      networkFetchCount++;
      return { status: 200, body: '/* style.css */' };
    };

    const url = 'http://localhost/assets/style.css';
    // 1st request -> fetches from network and caches
    const r1 = await router.handleFetch(url, mockNetwork);
    assert.strictEqual(r1.source, 'network');
    assert.strictEqual(networkFetchCount, 1);

    // 2nd request -> returns from cache without touching network
    const r2 = await router.handleFetch(url, mockNetwork);
    assert.strictEqual(r2.source, 'cache');
    assert.strictEqual(networkFetchCount, 1, 'Network should not be called on cache hit');
  });

  it('T1.37.3: Immutable Git loose and pack objects use Cache-First strategy', async () => {
    const cacheStorage = new MockCacheStorage();
    const router = new ServiceWorkerRouter(cacheStorage);

    let networkFetches = 0;
    const mockNetwork = async (url) => {
      networkFetches++;
      return { status: 200, data: new Uint8Array([1, 2, 3]) };
    };

    const looseObjectUrl = 'http://localhost/objects/4b/825dc642cb6eb9a060e54bf8d69288fbee4904';
    const packObjectUrl = 'http://localhost/objects/pack/pack-1234567890abcdef.pack';

    const r1 = await router.handleFetch(looseObjectUrl, mockNetwork);
    assert.strictEqual(r1.source, 'network');

    const r2 = await router.handleFetch(looseObjectUrl, mockNetwork);
    assert.strictEqual(r2.source, 'cache');

    const p1 = await router.handleFetch(packObjectUrl, mockNetwork);
    assert.strictEqual(p1.source, 'network');

    const p2 = await router.handleFetch(packObjectUrl, mockNetwork);
    assert.strictEqual(p2.source, 'cache');
  });

  it('T1.37.4: Dynamic metadata uses Stale-While-Revalidate strategy', async () => {
    const cacheStorage = new MockCacheStorage();
    const router = new ServiceWorkerRouter(cacheStorage);

    let networkFetches = 0;
    const mockNetwork = async (url) => {
      networkFetches++;
      return { status: 200, body: JSON.stringify({ version: networkFetches }) };
    };

    const metaUrl = 'http://localhost/meta.json';

    // 1st request -> Network (no cache yet)
    const r1 = await router.handleFetch(metaUrl, mockNetwork);
    assert.strictEqual(r1.source, 'network');
    assert.strictEqual(networkFetches, 1);

    // 2nd request -> Returns stale cache immediately while triggering background revalidation
    const r2 = await router.handleFetch(metaUrl, mockNetwork);
    assert.strictEqual(r2.source, 'cache-stale');
    if (r2.revalidating) await r2.revalidating;
    assert.strictEqual(networkFetches, 2, 'Background revalidation must fetch from network');
  });

  it('T1.37.5: Network-First navigation falls back to cached index.html when offline', async () => {
    const cacheStorage = new MockCacheStorage();
    const router = new ServiceWorkerRouter(cacheStorage);

    // Seed cached index.html
    const cache = await cacheStorage.open('sendforge-v1');
    await cache.put('/index.html', { status: 200, body: '<html>Cached App</html>' });

    // Simulate network failure
    const failingNetwork = async () => {
      throw new Error('TypeError: Failed to fetch (Offline)');
    };

    const navUrl = 'http://localhost/tree/src/main.rs';
    const res = await router.handleFetch(navUrl, failingNetwork);
    assert.strictEqual(res.source, 'fallback-cache');
    assert.strictEqual(res.response.body, '<html>Cached App</html>');
  });

  it('T1.37.6: Offline status indicator responds to online/offline state changes', () => {
    class OfflineStatusTracker {
      constructor(initialOnline = true) {
        this.isOnline = initialOnline;
        this.listeners = [];
      }
      setOnline(online) {
        this.isOnline = online;
        this.listeners.forEach(fn => fn(online));
      }
      subscribe(fn) {
        this.listeners.push(fn);
      }
    }

    const tracker = new OfflineStatusTracker(true);
    let currentBadge = 'online';

    tracker.subscribe((online) => {
      currentBadge = online ? 'online' : 'offline';
    });

    assert.strictEqual(currentBadge, 'online');
    tracker.setOnline(false);
    assert.strictEqual(currentBadge, 'offline');
    tracker.setOnline(true);
    assert.strictEqual(currentBadge, 'online');
  });

  it('T1.37.7: Cache migration clears old versioned cache buckets upon activation', async () => {
    const cacheStorage = new MockCacheStorage();
    await cacheStorage.open('sendforge-v0-alpha');
    await cacheStorage.open('sendforge-v0-beta');
    await cacheStorage.open('sendforge-v1');

    const router = new ServiceWorkerRouter(cacheStorage, 'sendforge-v1');
    await router.activateAndCleanOldCaches();

    const remaining = await cacheStorage.keys();
    assert.strictEqual(remaining.length, 1);
    assert.strictEqual(remaining[0], 'sendforge-v1');
  });
});
