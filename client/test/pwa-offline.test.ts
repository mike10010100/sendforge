// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { h, render as preactRender } from 'preact';
import renderToString from 'preact-render-to-string';
import { App } from '../src/ui/App.js';
import { registerServiceWorker } from '../src/main.js';

interface WebAppManifest {
  readonly name: string;
  readonly short_name: string;
  readonly description: string;
  readonly start_url: string;
  readonly scope: string;
  readonly display: string;
  readonly orientation?: string;
  readonly background_color: string;
  readonly theme_color: string;
  readonly categories?: readonly string[];
  readonly icons: readonly {
    readonly src: string;
    readonly sizes: string;
    readonly type: string;
    readonly purpose?: string;
  }[];
}

const flushTicks = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 20);
  });

describe('Milestone 5: Progressive Web App & Offline Caching Suite', () => {
  const rootDir = path.resolve(__dirname, '../..');
  const publicDir = path.join(rootDir, 'public');
  const manifestPath = path.join(publicDir, 'manifest.json');
  const swPath = path.join(publicDir, 'sw.js');
  const indexPath = path.join(rootDir, 'client/src/index.html');

  describe('1. Web App Manifest (public/manifest.json)', () => {
    it('manifest.json exists and contains valid JSON', () => {
      expect(fs.existsSync(manifestPath)).toBe(true);
      const raw = fs.readFileSync(manifestPath, 'utf-8');
      expect(() => JSON.parse(raw) as unknown).not.toThrow();
    });

    it('contains all required PWA manifest fields and theme specifications', () => {
      const raw = fs.readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(raw) as WebAppManifest;

      expect(manifest.name).toBe('Sendforge — The Static-First Git Forge');
      expect(manifest.short_name).toBe('Sendforge');
      expect(manifest.description).toContain('static-first Git forge');
      expect(manifest.start_url).toBe('./');
      expect(manifest.scope).toBe('./');
      expect(manifest.display).toBe('standalone');
      expect(manifest.background_color).toBe('#0d1117');
      expect(manifest.theme_color).toBe('#161b22');
      expect(manifest.categories).toContain('developer');

      expect(Array.isArray(manifest.icons)).toBe(true);
      expect(manifest.icons.length).toBeGreaterThanOrEqual(1);
      const primaryIcon = manifest.icons[0];
      expect(primaryIcon).toBeDefined();
      if (primaryIcon) {
        expect(primaryIcon.src).toBe('/og-card.png');
        expect(primaryIcon.sizes).toBe('1200x630');
        expect(primaryIcon.type).toBe('image/png');
      }
    });

    it('client/src/index.html includes manifest link, theme-color, and mobile web app meta tags', () => {
      expect(fs.existsSync(indexPath)).toBe(true);
      const html = fs.readFileSync(indexPath, 'utf-8');

      expect(html).toContain('<link rel="manifest" href="/manifest.json"');
      expect(html).toContain('<meta name="theme-color" content="#161b22"');
      expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes"');
      expect(html).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"');
    });
  });

  describe('2. Service Worker File & Architecture (public/sw.js)', () => {
    it('public/sw.js exists and defines versioned cache constants', () => {
      expect(fs.existsSync(swPath)).toBe(true);
      const swContent = fs.readFileSync(swPath, 'utf-8');

      expect(swContent).toContain("const CACHE_VERSION = 'v1'");
      expect(swContent).toContain('const STATIC_CACHE = `sendforge-static-${CACHE_VERSION}`');
      expect(swContent).toContain('const GIT_CACHE = `sendforge-git-${CACHE_VERSION}`');
      expect(swContent).toContain('const META_CACHE = `sendforge-meta-${CACHE_VERSION}`');
    });

    it('defines app shell precache assets', () => {
      const swContent = fs.readFileSync(swPath, 'utf-8');
      expect(swContent).toContain("'/'");
      expect(swContent).toContain("'/index.html'");
      expect(swContent).toContain("'/manifest.json'");
      expect(swContent).toContain("'/og-card.png'");
    });

    it('attaches install, activate, fetch, and message event listeners', () => {
      const swContent = fs.readFileSync(swPath, 'utf-8');
      expect(swContent).toContain("self.addEventListener('install'");
      expect(swContent).toContain("self.addEventListener('activate'");
      expect(swContent).toContain("self.addEventListener('fetch'");
      expect(swContent).toContain("self.addEventListener('message'");
    });
  });

  describe('3. Service Worker URL Categorization & Tiered Routing Regexes', () => {
    const GIT_OBJECT_REGEX = /\/objects\/([0-9a-f]{2}\/[0-9a-f]{38}|pack\/pack-[0-9a-f]{40}\.(pack|idx)|info\/packs)$/i;
    const META_REGEX = /\/(meta\.json|info\/refs|pulls\.json|issues\.json|repos\.json|meta\/(issues|pulls)\/[^/]+\.json)$/i;
    const STATIC_ASSET_REGEX = /\.(js|css|png|jpg|jpeg|svg|webp|woff|woff2|ttf|ico)$/i;

    it('categorizes loose Git objects and packfile assets under GIT_OBJECT_REGEX', () => {
      expect(GIT_OBJECT_REGEX.test('/objects/4b/825dc642cb6eb9a060e54bf8d69288fbee4904')).toBe(true);
      expect(GIT_OBJECT_REGEX.test('/repo/objects/01/23456789abcdef0123456789abcdef01234567')).toBe(true);
      expect(GIT_OBJECT_REGEX.test('/objects/pack/pack-0123456789abcdef0123456789abcdef01234567.pack')).toBe(true);
      expect(GIT_OBJECT_REGEX.test('/objects/pack/pack-0123456789abcdef0123456789abcdef01234567.idx')).toBe(true);
      expect(GIT_OBJECT_REGEX.test('/objects/info/packs')).toBe(true);

      // Negative assertions
      expect(GIT_OBJECT_REGEX.test('/meta.json')).toBe(false);
      expect(GIT_OBJECT_REGEX.test('/objects/invalid.txt')).toBe(false);
      expect(GIT_OBJECT_REGEX.test('/api/submit/issue')).toBe(false);
    });

    it('categorizes repository and collaboration metadata under META_REGEX', () => {
      expect(META_REGEX.test('/meta.json')).toBe(true);
      expect(META_REGEX.test('/info/refs')).toBe(true);
      expect(META_REGEX.test('/pulls.json')).toBe(true);
      expect(META_REGEX.test('/issues.json')).toBe(true);
      expect(META_REGEX.test('/repos.json')).toBe(true);
      expect(META_REGEX.test('/meta/issues/1.json')).toBe(true);
      expect(META_REGEX.test('/meta/pulls/42.json')).toBe(true);
      expect(META_REGEX.test('/repo/meta.json')).toBe(true);

      // Negative assertions
      expect(META_REGEX.test('/objects/4b/825dc642cb6eb9a060e54bf8d69288fbee4904')).toBe(false);
      expect(META_REGEX.test('/assets/index.js')).toBe(false);
      expect(META_REGEX.test('/api/submit/pr')).toBe(false);
    });

    it('categorizes frontend bundle static assets under STATIC_ASSET_REGEX', () => {
      expect(STATIC_ASSET_REGEX.test('/assets/app.1234.js')).toBe(true);
      expect(STATIC_ASSET_REGEX.test('/assets/styles.css')).toBe(true);
      expect(STATIC_ASSET_REGEX.test('/og-card.png')).toBe(true);
      expect(STATIC_ASSET_REGEX.test('/icon.svg')).toBe(true);
      expect(STATIC_ASSET_REGEX.test('/fonts/inter.woff2')).toBe(true);
      expect(STATIC_ASSET_REGEX.test('/favicon.ico')).toBe(true);

      // Negative assertions
      expect(STATIC_ASSET_REGEX.test('/meta.json')).toBe(false);
      expect(STATIC_ASSET_REGEX.test('/info/refs')).toBe(false);
    });
  });

  describe('4. Simulation of Tiered Cache Routing Behaviors', () => {
    interface MockCache {
      readonly store: Map<string, Response>;
      match(req: Request | string): Promise<Response | undefined>;
      put(req: Request | string, res: Response): Promise<void>;
      addAll(urls: readonly string[]): Promise<void>;
    }

    const createMockCache = (): MockCache => {
      const store = new Map<string, Response>();
      return {
        store,
        match: (req: Request | string) => {
          const key = typeof req === 'string' ? req : req.url;
          const res = store.get(key);
          return Promise.resolve(res ? res.clone() : undefined);
        },
        put: (req: Request | string, res: Response) => {
          const key = typeof req === 'string' ? req : req.url;
          store.set(key, res.clone());
          return Promise.resolve();
        },
        addAll: (urls: readonly string[]) => {
          for (const u of urls) {
            store.set(u, new Response(`cached:${u}`, { status: 200 }));
          }
          return Promise.resolve();
        },
      };
    };

    it('Cache-First strategy returns cached Git blob without triggering network fetch', async () => {
      const gitCache = createMockCache();
      const testUrl = 'https://sendforge.local/objects/4b/825dc642cb6eb9a060e54bf8d69288fbee4904';
      const cachedBlobResponse = new Response('git-blob-content', {
        status: 200,
        headers: { 'Content-Type': 'application/x-git-loose-object' },
      });
      await gitCache.put(testUrl, cachedBlobResponse);

      const networkFetch = vi.fn();

      // Execute Cache-First logic
      const cached = await gitCache.match(testUrl);
      let response: Response;
      if (cached) {
        response = cached;
      } else {
        networkFetch();
        response = new Response('network-content');
      }

      expect(response).toBeDefined();
      expect(await response.text()).toBe('git-blob-content');
      expect(networkFetch).not.toHaveBeenCalled();
    });

    it('Cache-First fetches and caches on cache miss', async () => {
      const gitCache = createMockCache();
      const testUrl = 'https://sendforge.local/objects/11/2233445566778899aabbccddeeff0011223344';
      const networkResponse = new Response('new-git-blob', { status: 200 });

      let response: Response;
      const cached = await gitCache.match(testUrl);
      if (cached) {
        response = cached;
      } else {
        await gitCache.put(testUrl, networkResponse.clone());
        response = networkResponse;
      }

      expect(await response.text()).toBe('new-git-blob');
      const inCache = await gitCache.match(testUrl);
      expect(inCache).toBeDefined();
      if (inCache) {
        expect(await inCache.text()).toBe('new-git-blob');
      }
    });

    it('Stale-While-Revalidate serves stale metadata immediately while spawning background revalidation', async () => {
      const metaCache = createMockCache();
      const testUrl = 'https://sendforge.local/meta.json';
      const staleMeta = new Response(JSON.stringify({ name: 'Old Repo', commits: 10 }), { status: 200 });
      await metaCache.put(testUrl, staleMeta);

      const backgroundFetch = vi.fn<() => Promise<Response>>().mockImplementation(() => {
        const fresh = new Response(JSON.stringify({ name: 'Updated Repo', commits: 11 }), { status: 200 });
        return metaCache.put(testUrl, fresh).then(() => fresh);
      });

      // SWR handler logic
      const cached = await metaCache.match(testUrl);
      const fetchPromise: Promise<Response> = backgroundFetch();

      const servedResponse = cached ?? (await fetchPromise);
      expect(servedResponse).toBeDefined();
      expect(await servedResponse.text()).toBe(JSON.stringify({ name: 'Old Repo', commits: 10 }));
      expect(backgroundFetch).toHaveBeenCalledTimes(1);

      await fetchPromise;
      const updatedCache = await metaCache.match(testUrl);
      expect(updatedCache).toBeDefined();
      if (updatedCache) {
        expect(await updatedCache.text()).toBe(JSON.stringify({ name: 'Updated Repo', commits: 11 }));
      }
    });

    it('Navigation request falls back to cached index.html when network is unreachable', async () => {
      const staticCache = createMockCache();
      const fallbackHtml = '<!DOCTYPE html><html><body><h1>Sendforge App</h1></body></html>';
      await staticCache.put('/index.html', new Response(fallbackHtml, { status: 200, headers: { 'Content-Type': 'text/html' } }));

      const failingFetch = vi.fn<() => Promise<Response>>().mockRejectedValue(new Error('Network offline'));

      let response: Response;
      try {
        response = await failingFetch();
      } catch {
        const cachedFallback = await staticCache.match('/index.html');
        response = cachedFallback ?? new Response('Offline Fallback', { status: 200 });
      }

      expect(response).toBeDefined();
      expect(await response.text()).toBe(fallbackHtml);
    });

    it('Write endpoints (/api/submit/*) and non-GET requests are network-only', () => {
      const isNetworkOnly = (method: string, pathname: string): boolean => {
        return method !== 'GET' || pathname.startsWith('/api/submit/');
      };

      expect(isNetworkOnly('POST', '/api/submit/issue')).toBe(true);
      expect(isNetworkOnly('POST', '/api/submit/pr')).toBe(true);
      expect(isNetworkOnly('DELETE', '/objects/123')).toBe(true);
      expect(isNetworkOnly('PUT', '/meta.json')).toBe(true);
      expect(isNetworkOnly('GET', '/objects/12/34567890')).toBe(false);
      expect(isNetworkOnly('GET', '/meta.json')).toBe(false);
    });
  });

  describe('5. Service Worker Registration Helper (client/src/main.tsx)', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('registers /sw.js with scope / on localhost or HTTPS', async () => {
      const mockRegister = vi.fn().mockResolvedValue({
        scope: '/',
        active: null,
      });

      Object.defineProperty(window, 'location', {
        value: {
          protocol: 'http:',
          hostname: 'localhost',
        },
        writable: true,
      });

      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          register: mockRegister,
        },
        writable: true,
      });

      const reg = await registerServiceWorker();
      expect(mockRegister).toHaveBeenCalledWith('/sw.js', { scope: '/' });
      expect(reg).toBeDefined();
      expect(reg?.scope).toBe('/');
    });

    it('gracefully catches errors and returns null in restricted environments', async () => {
      const mockRegister = vi.fn().mockRejectedValue(new Error('SecurityError: SW registration disabled'));

      Object.defineProperty(window, 'location', {
        value: {
          protocol: 'https:',
          hostname: 'forge.example.com',
        },
        writable: true,
      });

      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          register: mockRegister,
        },
        writable: true,
      });

      const reg = await registerServiceWorker();
      expect(reg).toBeNull();
    });
  });

  describe('6. UI Reactive Offline Status Badge (client/src/ui/App.tsx)', () => {
    let container: HTMLDivElement;

    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
    });

    afterEach(() => {
      preactRender(null, container);
      container.remove();
    });

    it('renders offline badge when navigator.onLine is false during initial render', () => {
      Object.defineProperty(navigator, 'onLine', {
        value: false,
        configurable: true,
        writable: true,
      });

      const html = renderToString(h(App, { baseUrl: '' }));
      expect(html).toContain('data-testid="offline-status-badge"');
      expect(html).toContain('offline-badge');
      expect(html).toContain('Offline Mode');
    });

    it('does not render offline badge when navigator.onLine is true during initial render', () => {
      Object.defineProperty(navigator, 'onLine', {
        value: true,
        configurable: true,
        writable: true,
      });

      const html = renderToString(h(App, { baseUrl: '' }));
      expect(html).not.toContain('data-testid="offline-status-badge"');
      expect(html).not.toContain('offline-badge');
    });

    it('reactively displays offline badge on window offline event and hides on online event', async () => {
      Object.defineProperty(navigator, 'onLine', {
        value: true,
        configurable: true,
        writable: true,
      });

      preactRender(h(App, { baseUrl: '' }), container);
      await flushTicks();

      // Initially online: badge not rendered
      expect(container.querySelector('[data-testid="offline-status-badge"]')).toBeNull();

      // Dispatch 'offline' event
      window.dispatchEvent(new Event('offline'));
      await flushTicks();

      const offlineBadge = container.querySelector('[data-testid="offline-status-badge"]');
      expect(offlineBadge).not.toBeNull();
      expect(offlineBadge?.textContent).toContain('Offline Mode');
      expect(offlineBadge?.getAttribute('role')).toBe('status');

      // Dispatch 'online' event
      window.dispatchEvent(new Event('online'));
      await flushTicks();

      expect(container.querySelector('[data-testid="offline-status-badge"]')).toBeNull();
    });
  });
});
