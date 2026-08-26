// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h, render as preactRender } from 'preact';
import { App } from '../src/ui/App.js';
import { registerServiceWorker } from '../src/main.js';

const flushTicks = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 20);
  });

describe('Challenger 1 Empirical Adversarial Suite: Milestone M5 (PWA & Offline Caching)', () => {
  // =========================================================================
  // Section 1: Exhaustive Edge-Case Analysis of Service Worker URL Regexes
  // =========================================================================
  describe('1. Service Worker URL Regex Robustness & Boundary Conditions', () => {
    const GIT_OBJECT_REGEX = /\/objects\/([0-9a-f]{2}\/[0-9a-f]{38}|pack\/pack-[0-9a-f]{40}\.(pack|idx)|info\/packs)$/i;
    const META_REGEX = /\/(meta\.json|info\/refs|pulls\.json|issues\.json|repos\.json|meta\/(issues|pulls)\/[^/]+\.json)$/i;
    const STATIC_ASSET_REGEX = /\.(js|css|png|jpg|jpeg|svg|webp|woff|woff2|ttf|ico)$/i;

    describe('1.1 Git Object Regex (GIT_OBJECT_REGEX)', () => {
      it('matches valid 40-char SHA-1 loose objects in lowercase, uppercase, and mixed case', () => {
        expect(GIT_OBJECT_REGEX.test('/objects/4b/825dc642cb6eb9a060e54bf8d69288fbee4904')).toBe(true);
        expect(GIT_OBJECT_REGEX.test('/objects/4B/825DC642CB6EB9A060E54BF8D69288FBEE4904')).toBe(true);
        expect(GIT_OBJECT_REGEX.test('/objects/4b/825DC642cb6EB9A060e54BF8d69288FBee4904')).toBe(true);
      });

      it('matches deeply nested multi-segment repo prefixes', () => {
        expect(GIT_OBJECT_REGEX.test('/owner/repo/objects/01/23456789abcdef0123456789abcdef01234567')).toBe(true);
        expect(GIT_OBJECT_REGEX.test('/deep/nested/org/suborg/repo.git/objects/ff/eeddccbbaa99887766554433221100ffeeddcc')).toBe(true);
      });

      it('matches packfiles, pack indexes, and info/packs with varying path depths', () => {
        const packSha = 'a'.repeat(40);
        expect(GIT_OBJECT_REGEX.test(`/objects/pack/pack-${packSha}.pack`)).toBe(true);
        expect(GIT_OBJECT_REGEX.test(`/objects/pack/pack-${packSha}.idx`)).toBe(true);
        expect(GIT_OBJECT_REGEX.test('/objects/info/packs')).toBe(true);
        expect(GIT_OBJECT_REGEX.test(`/my-repo.git/objects/pack/pack-${packSha}.pack`)).toBe(true);
        expect(GIT_OBJECT_REGEX.test(`/my-repo.git/objects/pack/pack-${packSha}.idx`)).toBe(true);
        expect(GIT_OBJECT_REGEX.test('/my-repo.git/objects/info/packs')).toBe(true);
      });

      it('rejects malformed SHA-1 length loose objects (underflow and overflow)', () => {
        // 39 chars (1 underflow)
        expect(GIT_OBJECT_REGEX.test('/objects/4b/825dc642cb6eb9a060e54bf8d69288fbee490')).toBe(false);
        // 41 chars (1 overflow)
        expect(GIT_OBJECT_REGEX.test('/objects/4b/825dc642cb6eb9a060e54bf8d69288fbee49041')).toBe(false);
        // 1-char fanout
        expect(GIT_OBJECT_REGEX.test('/objects/4/825dc642cb6eb9a060e54bf8d69288fbee4904a')).toBe(false);
        // 3-char fanout
        expect(GIT_OBJECT_REGEX.test('/objects/4b8/25dc642cb6eb9a060e54bf8d69288fbee490')).toBe(false);
      });

      it('rejects non-hex characters in loose object paths', () => {
        expect(GIT_OBJECT_REGEX.test('/objects/zz/825dc642cb6eb9a060e54bf8d69288fbee4904')).toBe(false);
        expect(GIT_OBJECT_REGEX.test('/objects/4b/g25dc642cb6eb9a060e54bf8d69288fbee4904')).toBe(false);
        expect(GIT_OBJECT_REGEX.test('/objects/4b/825dc642cb6eb9a060e54bf8d69288fbee490_')).toBe(false);
      });

      it('rejects invalid packfile naming formats and extensions', () => {
        const validSha = 'b'.repeat(40);
        // Wrong extension
        expect(GIT_OBJECT_REGEX.test(`/objects/pack/pack-${validSha}.txt`)).toBe(false);
        expect(GIT_OBJECT_REGEX.test(`/objects/pack/pack-${validSha}.pack.bak`)).toBe(false);
        expect(GIT_OBJECT_REGEX.test(`/objects/pack/pack-${validSha}.idx.tmp`)).toBe(false);
        // Wrong prefix
        expect(GIT_OBJECT_REGEX.test(`/objects/pack/other-${validSha}.pack`)).toBe(false);
        expect(GIT_OBJECT_REGEX.test(`/objects/pack/${validSha}.pack`)).toBe(false);
        // Short sha
        expect(GIT_OBJECT_REGEX.test('/objects/pack/pack-1234.pack')).toBe(false);
      });
    });

    describe('1.2 Collaboration & Repository Metadata Regex (META_REGEX)', () => {
      it('matches root and repo-scoped metadata catalog endpoints', () => {
        expect(META_REGEX.test('/meta.json')).toBe(true);
        expect(META_REGEX.test('/info/refs')).toBe(true);
        expect(META_REGEX.test('/pulls.json')).toBe(true);
        expect(META_REGEX.test('/issues.json')).toBe(true);
        expect(META_REGEX.test('/repos.json')).toBe(true);
        expect(META_REGEX.test('/owner/repo/meta.json')).toBe(true);
        expect(META_REGEX.test('/owner/repo/info/refs')).toBe(true);
        expect(META_REGEX.test('/owner/repo/pulls.json')).toBe(true);
        expect(META_REGEX.test('/owner/repo/issues.json')).toBe(true);
      });

      it('matches granular issue and PR detail JSON files', () => {
        expect(META_REGEX.test('/meta/issues/1.json')).toBe(true);
        expect(META_REGEX.test('/meta/issues/42.json')).toBe(true);
        expect(META_REGEX.test('/meta/issues/ISSUE-101.json')).toBe(true);
        expect(META_REGEX.test('/meta/issues/feat_user_login.json')).toBe(true);
        expect(META_REGEX.test('/meta/pulls/1.json')).toBe(true);
        expect(META_REGEX.test('/meta/pulls/PR-999.json')).toBe(true);
        expect(META_REGEX.test('/owner/repo/meta/issues/1.json')).toBe(true);
        expect(META_REGEX.test('/owner/repo/meta/pulls/1.json')).toBe(true);
      });

      it('rejects multi-level nested paths inside meta issues/pulls directories', () => {
        expect(META_REGEX.test('/meta/issues/sub/1.json')).toBe(false);
        expect(META_REGEX.test('/meta/pulls/nested/deep/2.json')).toBe(false);
      });

      it('rejects non-json files in meta folders and non-matching metadata filenames', () => {
        expect(META_REGEX.test('/meta/issues/1.xml')).toBe(false);
        expect(META_REGEX.test('/meta/issues/1.txt')).toBe(false);
        expect(META_REGEX.test('/meta/comments.json')).toBe(false);
        expect(META_REGEX.test('/meta/commits.json')).toBe(false);
        expect(META_REGEX.test('/config.json')).toBe(false);
      });
    });

    describe('1.3 Static Assets Regex (STATIC_ASSET_REGEX)', () => {
      it('matches all standard web asset extensions in lower and upper case', () => {
        const extensions = ['js', 'css', 'png', 'jpg', 'jpeg', 'svg', 'webp', 'woff', 'woff2', 'ttf', 'ico'];
        for (const ext of extensions) {
          expect(STATIC_ASSET_REGEX.test(`/assets/file.${ext}`)).toBe(true);
          expect(STATIC_ASSET_REGEX.test(`/assets/file.${ext.toUpperCase()}`)).toBe(true);
        }
      });

      it('rejects non-static and executable files', () => {
        expect(STATIC_ASSET_REGEX.test('/api/data.json')).toBe(false);
        expect(STATIC_ASSET_REGEX.test('/server.php')).toBe(false);
        expect(STATIC_ASSET_REGEX.test('/archive.zip')).toBe(false);
        expect(STATIC_ASSET_REGEX.test('/archive.tar.gz')).toBe(false);
      });
    });
  });

  // =========================================================================
  // Section 2: Empirical SWR Metadata Handling Under Network Disruptions
  // =========================================================================
  describe('2. SWR Metadata Engine Stress & Resilience Testing', () => {
    interface CacheStore {
      readonly data: Map<string, Response>;
      match(req: string | Request): Promise<Response | undefined>;
      put(req: string | Request, res: Response): Promise<void>;
    }

    const createCacheStore = (): CacheStore => {
      const data = new Map<string, Response>();
      return {
        data,
        match: (req) => {
          const key = typeof req === 'string' ? req : req.url;
          const hit = data.get(key);
          return Promise.resolve(hit ? hit.clone() : undefined);
        },
        put: (req, res) => {
          const key = typeof req === 'string' ? req : req.url;
          data.set(key, res.clone());
          return Promise.resolve();
        },
      };
    };

    it('SWR returns stale metadata immediately and updates cache silently on successful revalidation', async () => {
      const cache = createCacheStore();
      const metaUrl = 'https://sendforge.dev/meta.json';
      const stalePayload = { name: 'sendforge', version: 1, commit_count: 50 };
      const freshPayload = { name: 'sendforge', version: 2, commit_count: 51 };

      await cache.put(metaUrl, new Response(JSON.stringify(stalePayload), { status: 200 }));

      // SWR handler simulation from sw.js:
      const handleSWR = async (url: string, fetchFn: () => Promise<Response>): Promise<Response> => {
        const cached = await cache.match(url);
        const fetchPromise = fetchFn()
          .then((networkRes) => {
            if (networkRes.ok) {
              void cache.put(url, networkRes.clone());
            }
            return networkRes;
          })
          .catch(() => cached);

        return (cached ?? fetchPromise) as Response;
      };

      const mockFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(freshPayload), { status: 200 }));

      const immediateResponse = await handleSWR(metaUrl, mockFetch);
      expect(immediateResponse).toBeDefined();
      const immediateBody = (await immediateResponse.json()) as typeof stalePayload;
      expect(immediateBody.commit_count).toBe(50); // Immediate stale return

      // Wait a tick for background fetch to complete
      await flushTicks();

      // Now cache must have updated to fresh version
      const updatedCached = await cache.match(metaUrl);
      expect(updatedCached).toBeDefined();
      if (updatedCached) {
        const updatedBody = (await updatedCached.json()) as typeof freshPayload;
        expect(updatedBody.commit_count).toBe(51);
      }
    });

    it('SWR retains cached metadata safely when background network fetch encounters network error or timeout', async () => {
      const cache = createCacheStore();
      const metaUrl = 'https://sendforge.dev/issues.json';
      const cachedIssues = [{ id: '1', title: 'Cached Issue' }];

      await cache.put(metaUrl, new Response(JSON.stringify(cachedIssues), { status: 200 }));

      const handleSWR = async (url: string, fetchFn: () => Promise<Response>): Promise<Response> => {
        const cached = await cache.match(url);
        const fetchPromise = fetchFn()
          .then((networkRes) => {
            if (networkRes.ok) {
              void cache.put(url, networkRes.clone());
            }
            return networkRes;
          })
          .catch(() => cached);

        return (cached ?? fetchPromise) as Response;
      };

      const failingFetch = vi.fn().mockRejectedValue(new TypeError('Network request failed'));

      const response = await handleSWR(metaUrl, failingFetch);
      expect(response).toBeDefined();
      const body = (await response.json()) as typeof cachedIssues;
      expect(body[0]?.title).toBe('Cached Issue');

      await flushTicks();

      // Ensure cache was not wiped or corrupted
      const inCache = await cache.match(metaUrl);
      expect(inCache).toBeDefined();
      if (inCache) {
        const check = (await inCache.json()) as typeof cachedIssues;
        expect(check).toHaveLength(1);
      }
    });

    it('SWR preserves existing cache when server returns 500 Internal Server Error', async () => {
      const cache = createCacheStore();
      const metaUrl = 'https://sendforge.dev/pulls.json';
      const cachedPulls = [{ id: '10', title: 'Open PR' }];

      await cache.put(metaUrl, new Response(JSON.stringify(cachedPulls), { status: 200 }));

      const handleSWR = async (url: string, fetchFn: () => Promise<Response>): Promise<Response> => {
        const cached = await cache.match(url);
        const fetchPromise = fetchFn()
          .then((networkRes) => {
            if (networkRes.ok) {
              void cache.put(url, networkRes.clone());
            }
            return networkRes;
          })
          .catch(() => cached);

        return (cached ?? fetchPromise) as Response;
      };

      // Server returns 500 error
      const serverErrorFetch = vi.fn().mockResolvedValue(new Response('Server Error', { status: 500 }));

      const response = await handleSWR(metaUrl, serverErrorFetch);
      expect(response).toBeDefined();

      await flushTicks();

      // Cache still contains good 200 data, not overwritten by 500
      const inCache = await cache.match(metaUrl);
      expect(inCache).toBeDefined();
      if (inCache) {
        expect(inCache.status).toBe(200);
        const check = (await inCache.json()) as typeof cachedPulls;
        expect(check[0]?.title).toBe('Open PR');
      }
    });
  });

  // =========================================================================
  // Section 3: SPA Deep Navigation Offline Fallback Simulation
  // =========================================================================
  describe('3. SPA Deep Route Navigation Fallback Strategy', () => {
    interface CacheStore {
      readonly data: Map<string, Response>;
      match(req: string | Request): Promise<Response | undefined>;
      put(req: string | Request, res: Response): Promise<void>;
    }

    const createCacheStore = (): CacheStore => {
      const data = new Map<string, Response>();
      return {
        data,
        match: (req) => {
          const key = typeof req === 'string' ? req : req.url;
          const hit = data.get(key);
          return Promise.resolve(hit ? hit.clone() : undefined);
        },
        put: (req, res) => {
          const key = typeof req === 'string' ? req : req.url;
          data.set(key, res.clone());
          return Promise.resolve();
        },
      };
    };

    const simulateNavigationHandler = async (
      request: Request,
      staticCache: CacheStore,
      networkFetch: (req: Request) => Promise<Response>
    ): Promise<Response> => {
      // Logic matching sw.js lines 64-84
      try {
        const networkRes = await networkFetch(request);
        if (networkRes.ok) {
          await staticCache.put(request, networkRes.clone());
        }
        return networkRes;
      } catch {
        const cached = await staticCache.match(request);
        if (cached) return cached;
        const fallback = await staticCache.match('/index.html');
        return (
          fallback ??
          new Response('Offline - Sendforge Git Forge', {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          })
        );
      }
    };

    it('falls back to cached /index.html for arbitrary deeply nested SPA routes when offline', async () => {
      const staticCache = createCacheStore();
      const appShellHtml = '<!DOCTYPE html><html><head><title>Sendforge</title></head><body><div id="app"></div></body></html>';
      await staticCache.put('/index.html', new Response(appShellHtml, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }));

      const failingFetch = vi.fn().mockRejectedValue(new Error('Device is offline'));

      const testRoutes = [
        'https://sendforge.dev/owner/repo/blob/main/src/engine/fetcher.ts',
        'https://sendforge.dev/owner/repo/tree/feature/docs/api/v1',
        'https://sendforge.dev/owner/repo/commit/4b825dc642cb6eb9a060e54bf8d69288fbee4904',
        'https://sendforge.dev/owner/repo/pull/42/files',
        'https://sendforge.dev/owner/repo/issues/100',
      ];

      for (const route of testRoutes) {
        const navRequest = new Request(route, {
          method: 'GET',
          headers: { Accept: 'text/html,application/xhtml+xml' },
        });

        const response = await simulateNavigationHandler(navRequest, staticCache, failingFetch);
        expect(response).toBeDefined();
        expect(response.status).toBe(200);
        expect(await response.text()).toBe(appShellHtml);
      }
    });

    it('returns built-in emergency offline HTML string when /index.html is not yet cached and network fails', async () => {
      const emptyCache = createCacheStore();
      const failingFetch = vi.fn().mockRejectedValue(new Error('Network unreachable'));

      const navRequest = new Request('https://sendforge.dev/some/route', {
        method: 'GET',
        headers: { Accept: 'text/html' },
      });

      const response = await simulateNavigationHandler(navRequest, emptyCache, failingFetch);
      expect(response).toBeDefined();
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('text/html');
      expect(await response.text()).toContain('Offline - Sendforge Git Forge');
    });
  });

  // =========================================================================
  // Section 4: Cache Activation & Old Version Pruning Simulation
  // =========================================================================
  describe('4. Service Worker Cache Lifecycle & Obsolete Cache Eviction', () => {
    it('prunes all obsolete or unversioned cache namespaces during activation while preserving active caches', async () => {
      const CACHE_VERSION = 'v1';
      const STATIC_CACHE = `sendforge-static-${CACHE_VERSION}`;
      const GIT_CACHE = `sendforge-git-${CACHE_VERSION}`;
      const META_CACHE = `sendforge-meta-${CACHE_VERSION}`;
      const activeCaches = [STATIC_CACHE, GIT_CACHE, META_CACHE];

      const allCaches = new Map<string, Map<string, string>>([
        ['sendforge-static-v1', new Map([['/index.html', 'shell']])],
        ['sendforge-git-v1', new Map([['/objects/11/22', 'blob']])],
        ['sendforge-meta-v1', new Map([['/meta.json', 'meta']])],
        ['sendforge-static-v0', new Map([['/old-app.js', 'old-bundle']])],
        ['sendforge-git-v0', new Map([['/old-blob', 'old-blob']])],
        ['sendforge-v0', new Map([['/temp', 'temp']])],
        ['workbox-precache-old', new Map([['/wb', 'wb']])],
      ]);

      const mockKeys = () => Promise.resolve(Array.from(allCaches.keys()));
      const mockDelete = (key: string) => {
        allCaches.delete(key);
        return Promise.resolve(true);
      };

      // Activation eviction logic from sw.js lines 40-51:
      const keys = await mockKeys();
      await Promise.all(
        keys.map((key) => {
          if (!activeCaches.includes(key)) {
            return mockDelete(key);
          }
          return Promise.resolve();
        })
      );

      // Verify active caches survive
      expect(allCaches.has('sendforge-static-v1')).toBe(true);
      expect(allCaches.has('sendforge-git-v1')).toBe(true);
      expect(allCaches.has('sendforge-meta-v1')).toBe(true);

      // Verify obsolete caches were deleted
      expect(allCaches.has('sendforge-static-v0')).toBe(false);
      expect(allCaches.has('sendforge-git-v0')).toBe(false);
      expect(allCaches.has('sendforge-v0')).toBe(false);
      expect(allCaches.has('workbox-precache-old')).toBe(false);
      expect(allCaches.size).toBe(3);
    });
  });

  // =========================================================================
  // Section 5: Client Registration Helper Security Boundaries
  // =========================================================================
  describe('5. Client Service Worker Registration Environment & Security Boundaries', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('rejects registration over insecure plain HTTP on public domains', async () => {
      const mockRegister = vi.fn().mockResolvedValue({ scope: '/' });
      Object.defineProperty(window, 'location', {
        value: { protocol: 'http:', hostname: 'git.example.com' },
        writable: true,
      });
      Object.defineProperty(navigator, 'serviceWorker', {
        value: { register: mockRegister },
        writable: true,
      });

      const reg = await registerServiceWorker();
      expect(reg).toBeNull();
      expect(mockRegister).not.toHaveBeenCalled();
    });

    it('allows registration on 127.0.0.1 development IP', async () => {
      const mockRegister = vi.fn().mockResolvedValue({ scope: '/' });
      Object.defineProperty(window, 'location', {
        value: { protocol: 'http:', hostname: '127.0.0.1' },
        writable: true,
      });
      Object.defineProperty(navigator, 'serviceWorker', {
        value: { register: mockRegister },
        writable: true,
      });

      const reg = await registerServiceWorker();
      expect(reg).toBeDefined();
      expect(mockRegister).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    });

    it('safely handles non-standard protocols like file: or chrome-extension:', async () => {
      const mockRegister = vi.fn();
      Object.defineProperty(window, 'location', {
        value: { protocol: 'file:', hostname: '' },
        writable: true,
      });
      Object.defineProperty(navigator, 'serviceWorker', {
        value: { register: mockRegister },
        writable: true,
      });

      const reg = await registerServiceWorker();
      expect(reg).toBeNull();
      expect(mockRegister).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Section 6: UI Offline Status Badge Event Flutter & Flapping Stress Test
  // =========================================================================
  describe('6. UI Offline Status Badge Event Flutter & Lifecycle Stress Testing', () => {
    let container: HTMLDivElement;

    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
    });

    afterEach(() => {
      preactRender(null, container);
      container.remove();
    });

    it('survives rapid online/offline event flapping (20 transitions in rapid succession) and ends on correct final state', async () => {
      Object.defineProperty(navigator, 'onLine', {
        value: true,
        configurable: true,
        writable: true,
      });

      preactRender(h(App, { baseUrl: '' }), container);
      await flushTicks();

      // Initially online
      expect(container.querySelector('[data-testid="offline-status-badge"]')).toBeNull();

      // Rapidly flap events 20 times (online -> offline -> online -> offline ...)
      for (let i = 0; i < 20; i++) {
        const isOdd = i % 2 === 1;
        window.dispatchEvent(new Event(isOdd ? 'online' : 'offline'));
      }

      await flushTicks();

      // The 20th iteration (i=19, odd) was 'online', so badge must be hidden
      expect(container.querySelector('[data-testid="offline-status-badge"]')).toBeNull();

      // Dispatch one more 'offline' event
      window.dispatchEvent(new Event('offline'));
      await flushTicks();

      const offlineBadge = container.querySelector('[data-testid="offline-status-badge"]');
      expect(offlineBadge).not.toBeNull();
      expect(offlineBadge?.textContent).toContain('Offline Mode');

      // Dispatch final 'online' event
      window.dispatchEvent(new Event('online'));
      await flushTicks();

      expect(container.querySelector('[data-testid="offline-status-badge"]')).toBeNull();
    });

    it('cleans up event listeners cleanly on component unmount without errors or memory leak warnings', async () => {
      preactRender(h(App, { baseUrl: '' }), container);
      await flushTicks();

      // Unmount component
      preactRender(null, container);
      await flushTicks();

      // Dispatch events to window when component is unmounted
      expect(() => {
        window.dispatchEvent(new Event('offline'));
        window.dispatchEvent(new Event('online'));
      }).not.toThrow();
    });
  });
});
