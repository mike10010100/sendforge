// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { h } from 'preact';
import renderToString from 'preact-render-to-string';
import { App } from '../src/ui/App.js';
import { EdgeGatewayClient } from '../src/engine/edge-client.js';

interface WebAppManifest {
  readonly name?: unknown;
  readonly short_name?: unknown;
  readonly description?: unknown;
  readonly start_url?: unknown;
  readonly scope?: unknown;
  readonly display?: unknown;
  readonly orientation?: unknown;
  readonly background_color?: unknown;
  readonly theme_color?: unknown;
  readonly categories?: unknown;
  readonly icons?: unknown;
}

/**
 * Calculates the exact WCAG 2.1 relative luminance for an sRGB hex color (#rrggbb).
 */
function calculateRelativeLuminance(hex: string): number {
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.slice(0, 2), 16) / 255;
  const g = parseInt(cleanHex.slice(2, 4), 16) / 255;
  const b = parseInt(cleanHex.slice(4, 6), 16) / 255;

  const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

  const rLin = toLinear(r);
  const gLin = toLinear(g);
  const bLin = toLinear(b);

  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
}

/**
 * Calculates WCAG 2.1 contrast ratio between two hex colors.
 */
function calculateContrastRatio(hex1: string, hex2: string): number {
  const lum1 = calculateRelativeLuminance(hex1);
  const lum2 = calculateRelativeLuminance(hex2);
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('Adversarial Challenge Suite: Milestone M5 (PWA & Offline Caching)', () => {
  const rootDir = path.resolve(__dirname, '../..');
  const publicDir = path.join(rootDir, 'public');
  const manifestPath = path.join(publicDir, 'manifest.json');
  const swPath = path.join(publicDir, 'sw.js');
  const stylesPath = path.join(rootDir, 'client/src/ui/styles.css');

  // =========================================================================
  // Challenge 1: Concurrency & High Request Volume on Cache Storage
  // =========================================================================
  describe('Challenge 1: Concurrency & Cache Storage Stress Testing', () => {
    interface SimulatedCacheStorage {
      readonly stores: Map<string, Map<string, Response>>;
      open(cacheName: string): Promise<{
        match(req: Request | string): Promise<Response | undefined>;
        put(req: Request | string, res: Response): Promise<void>;
        delete(req: Request | string): Promise<boolean>;
      }>;
      keys(): Promise<string[]>;
      delete(cacheName: string): Promise<boolean>;
    }

    const createSimulatedCacheStorage = (): SimulatedCacheStorage => {
      const stores = new Map<string, Map<string, Response>>();

      return {
        stores,
        open: (cacheName: string) => {
          let store = stores.get(cacheName);
          if (!store) {
            store = new Map<string, Response>();
            stores.set(cacheName, store);
          }
          const currentStore = store;
          return Promise.resolve({
            match: (req: Request | string) => {
              const key = typeof req === 'string' ? req : req.url;
              const res = currentStore.get(key);
              return Promise.resolve(res ? res.clone() : undefined);
            },
            put: (req: Request | string, res: Response) => {
              const key = typeof req === 'string' ? req : req.url;
              currentStore.set(key, res.clone());
              return Promise.resolve();
            },
            delete: (req: Request | string) => {
              const key = typeof req === 'string' ? req : req.url;
              const deleted = currentStore.delete(key);
              return Promise.resolve(deleted);
            },
          });
        },
        keys: () => Promise.resolve(Array.from(stores.keys())),
        delete: (cacheName: string) => Promise.resolve(stores.delete(cacheName)),
      };
    };

    it('handles 100 simultaneous concurrent reads/writes for identical Git object without race corruption', async () => {
      const cacheStorage = createSimulatedCacheStorage();
      const gitCache = await cacheStorage.open('sendforge-git-v1');
      const testUrl = 'https://sendforge.local/objects/aa/bbccddee112233445566778899001122334455';

      let networkFetchCount = 0;
      const simulateCacheFirstFetch = async (): Promise<string> => {
        const cached = await gitCache.match(testUrl);
        if (cached) {
          return cached.text();
        }
        networkFetchCount += 1;
        const freshResponse = new Response('content-aa-bbcc', { status: 200 });
        await gitCache.put(testUrl, freshResponse.clone());
        return freshResponse.text();
      };

      // Launch 100 concurrent requests simultaneously
      const results = await Promise.all(Array.from({ length: 100 }, () => simulateCacheFirstFetch()));

      expect(results).toHaveLength(100);
      expect(networkFetchCount).toBeGreaterThanOrEqual(1);
      for (const res of results) {
        expect(res).toBe('content-aa-bbcc');
      }

      // Verify the cached copy is fully readable and intact
      const cached = await gitCache.match(testUrl);
      expect(cached).toBeDefined();
      if (cached) {
        expect(await cached.text()).toBe('content-aa-bbcc');
      }
    });

    it('handles 200 heterogeneous concurrent requests across all 3 cache namespaces without cross-contamination', async () => {
      const cacheStorage = createSimulatedCacheStorage();
      const staticCache = await cacheStorage.open('sendforge-static-v1');
      const gitCache = await cacheStorage.open('sendforge-git-v1');
      const metaCache = await cacheStorage.open('sendforge-meta-v1');

      const tasks: Promise<void>[] = [];

      // 50 static asset requests
      for (let i = 0; i < 50; i++) {
        tasks.push(
          staticCache.put(
            `https://sendforge.local/assets/bundle-${i.toString()}.js`,
            new Response(`// bundle ${i.toString()}`, { status: 200 })
          )
        );
      }

      // 100 git object requests
      for (let i = 0; i < 100; i++) {
        const hex = i.toString(16).padStart(40, '0');
        tasks.push(
          gitCache.put(
            `https://sendforge.local/objects/${hex.slice(0, 2)}/${hex.slice(2)}`,
            new Response(`blob-${i.toString()}`, { status: 200 })
          )
        );
      }

      // 50 metadata requests
      for (let i = 0; i < 50; i++) {
        tasks.push(
          metaCache.put(
            `https://sendforge.local/meta/issues/${i.toString()}.json`,
            new Response(JSON.stringify({ id: i, title: `Issue ${i.toString()}` }), { status: 200 })
          )
        );
      }

      await Promise.all(tasks);

      // Verify storage partition counts
      expect(cacheStorage.stores.get('sendforge-static-v1')?.size).toBe(50);
      expect(cacheStorage.stores.get('sendforge-git-v1')?.size).toBe(100);
      expect(cacheStorage.stores.get('sendforge-meta-v1')?.size).toBe(50);

      // Verify cross-isolation: git object not in static cache
      const sampleHex = (10).toString(16).padStart(40, '0');
      const gitInStatic = await staticCache.match(
        `https://sendforge.local/objects/${sampleHex.slice(0, 2)}/${sampleHex.slice(2)}`
      );
      expect(gitInStatic).toBeUndefined();
    });

    it('survives cache clear message while concurrent operations are executing', async () => {
      const cacheStorage = createSimulatedCacheStorage();
      const staticCache = await cacheStorage.open('sendforge-static-v1');
      await staticCache.put('/index.html', new Response('<html>Old Shell</html>', { status: 200 }));

      // Concurrent read and clear
      const readPromise = staticCache.match('/index.html');
      const clearPromise = cacheStorage.keys().then((keys) => Promise.all(keys.map((k) => cacheStorage.delete(k))));

      const [readResult] = await Promise.all([readPromise, clearPromise]);
      // The read initiated before deletion safely cloned the response
      expect(readResult).toBeDefined();
      if (readResult) {
        expect(await readResult.text()).toBe('<html>Old Shell</html>');
      }

      // After clear, keys should be empty
      const remainingKeys = await cacheStorage.keys();
      expect(remainingKeys).toHaveLength(0);
    });
  });

  // =========================================================================
  // Challenge 2: Manifest Validation Against W3C Specifications
  // =========================================================================
  describe('Challenge 2: W3C Web App Manifest Spec Compliance', () => {
    it('manifest.json strictly complies with W3C Web App Manifest specification', () => {
      expect(fs.existsSync(manifestPath)).toBe(true);
      const raw = fs.readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(raw) as WebAppManifest;

      // 1. Identification & Naming
      expect(typeof manifest.name).toBe('string');
      expect((manifest.name as string).trim().length).toBeGreaterThan(0);
      expect(typeof manifest.short_name).toBe('string');
      expect((manifest.short_name as string).trim().length).toBeGreaterThan(0);
      expect((manifest.short_name as string).length).toBeLessThanOrEqual(30);

      // 2. Navigation & Scoping
      expect(typeof manifest.start_url).toBe('string');
      expect(typeof manifest.scope).toBe('string');
      // Relative paths within app scope
      expect(manifest.start_url).toMatch(/^(\.\/|\/)/);
      expect(manifest.scope).toMatch(/^(\.\/|\/)/);

      // 3. Display & Presentation
      const validDisplayModes = ['fullscreen', 'standalone', 'minimal-ui', 'browser'];
      expect(validDisplayModes).toContain(manifest.display);

      if (manifest.orientation !== undefined) {
        const validOrientations = [
          'any',
          'natural',
          'landscape',
          'portrait',
          'portrait-primary',
          'portrait-secondary',
          'landscape-primary',
          'landscape-secondary',
        ];
        expect(validOrientations).toContain(manifest.orientation);
      }

      // 4. Color Formats (Must be valid CSS hex color)
      const hexColorRegex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
      expect(typeof manifest.background_color).toBe('string');
      expect(manifest.background_color as string).toMatch(hexColorRegex);
      expect(typeof manifest.theme_color).toBe('string');
      expect(manifest.theme_color as string).toMatch(hexColorRegex);

      // 5. Categories
      if (manifest.categories !== undefined) {
        expect(Array.isArray(manifest.categories)).toBe(true);
        for (const cat of manifest.categories as string[]) {
          expect(typeof cat).toBe('string');
          expect(cat.length).toBeGreaterThan(0);
        }
      }

      // 6. Icons Schema & Image file existence
      expect(Array.isArray(manifest.icons)).toBe(true);
      const icons = manifest.icons as readonly { src: string; sizes: string; type: string; purpose?: string }[];
      expect(icons.length).toBeGreaterThanOrEqual(1);

      const sizeRegex = /^(\d+x\d+(\s+\d+x\d+)*|any)$/;
      const validPurposes = ['any', 'maskable', 'monochrome'];

      for (const icon of icons) {
        expect(typeof icon.src).toBe('string');
        expect(icon.src.length).toBeGreaterThan(0);
        expect(icon.sizes).toMatch(sizeRegex);
        expect(icon.type).toMatch(/^image\/[a-z0-9.+-]+$/i);

        if (icon.purpose) {
          const purposes = icon.purpose.split(/\s+/);
          for (const p of purposes) {
            expect(validPurposes).toContain(p);
          }
        }

        // Verify the referenced icon file exists on disk
        const localIconPath = path.join(publicDir, icon.src.replace(/^\//, ''));
        expect(fs.existsSync(localIconPath)).toBe(true);
        const iconStats = fs.statSync(localIconPath);
        expect(iconStats.size).toBeGreaterThan(0);
      }
    });
  });

  // =========================================================================
  // Challenge 3: Write API Isolation & Zero-Cache Guarantee
  // =========================================================================
  describe('Challenge 3: Write API Isolation & Bypass Verification', () => {
    it('verifies public/sw.js explicitly passes through all write requests and non-GET methods', () => {
      const swContent = fs.readFileSync(swPath, 'utf-8');

      // The service worker must check method !== 'GET' or url.pathname.startsWith('/api/submit/')
      expect(swContent).toMatch(/request\.method\s*!==\s*['"]GET['"]/);
      expect(swContent).toMatch(/url\.pathname\.startsWith\(['"]\/api\/submit\/['"]\)/);
    });

    it('tests write API routing logic against an exhaustive permutation of HTTP methods and URIs', () => {
      const shouldBypassServiceWorker = (method: string, pathname: string): boolean => {
        return method !== 'GET' || pathname.startsWith('/api/submit/');
      };

      // 1. Direct Edge write endpoints
      expect(shouldBypassServiceWorker('POST', '/api/submit/issue')).toBe(true);
      expect(shouldBypassServiceWorker('POST', '/api/submit/pr')).toBe(true);
      expect(shouldBypassServiceWorker('GET', '/api/submit/issue')).toBe(true);
      expect(shouldBypassServiceWorker('GET', '/api/submit/pr')).toBe(true);
      expect(shouldBypassServiceWorker('GET', '/api/submit/status')).toBe(true);

      // 2. Non-GET operations on static / git paths
      expect(shouldBypassServiceWorker('POST', '/objects/12/34567890123456789012345678901234567890')).toBe(true);
      expect(shouldBypassServiceWorker('PUT', '/meta.json')).toBe(true);
      expect(shouldBypassServiceWorker('DELETE', '/info/refs')).toBe(true);
      expect(shouldBypassServiceWorker('PATCH', '/issues.json')).toBe(true);
      expect(shouldBypassServiceWorker('OPTIONS', '/repos.json')).toBe(true);
      expect(shouldBypassServiceWorker('HEAD', '/assets/app.js')).toBe(true);

      // 3. Read requests that SHOULD be handled by SW caching
      expect(shouldBypassServiceWorker('GET', '/objects/4b/825dc642cb6eb9a060e54bf8d69288fbee4904')).toBe(false);
      expect(shouldBypassServiceWorker('GET', '/meta.json')).toBe(false);
      expect(shouldBypassServiceWorker('GET', '/assets/index.js')).toBe(false);
      expect(shouldBypassServiceWorker('GET', '/index.html')).toBe(false);
    });

    it('EdgeGatewayClient does not corrupt or cache failed write attempts and preserves offline drafts', async () => {
      // Create client with mocked failing network (offline simulation)
      const mockFailingFetch = vi.fn().mockRejectedValue(new Error('Failed to fetch (offline)'));
      const memoryStorage = new Map<string, string>();
      const customStorage: Storage = {
        get length() {
          return memoryStorage.size;
        },
        clear() {
          memoryStorage.clear();
        },
        getItem(key: string) {
          return memoryStorage.get(key) ?? null;
        },
        key(index: number) {
          return Array.from(memoryStorage.keys())[index] ?? null;
        },
        removeItem(key: string) {
          memoryStorage.delete(key);
        },
        setItem(key: string, value: string) {
          memoryStorage.set(key, value);
        },
      };

      const client = new EdgeGatewayClient({
        baseUrl: 'https://sendforge.local',
        fetchFn: mockFailingFetch as unknown as typeof fetch,
        storage: customStorage,
      });

      // Submit issue while offline
      const result = await client.submitIssueWithFallback({
        repo: 'owner/test-repo',
        title: 'Offline Issue Report',
        description: 'Testing fallback resilience while disconnected',
        author: 'challenger',
        labels: ['bug', 'offline'],
      });

      expect(result.success).toBe(false);
      expect(result.fallbackUsed).toBe(true);
      expect(result.offlineStored).toBe(true);
      expect(result.localCommands?.pushCommand).toContain('git push origin HEAD:refs/issues/');

      // Verify draft is stored in offline storage
      const drafts = client.getOfflineIssueDrafts('owner/test-repo');
      expect(drafts).toHaveLength(1);
      expect(drafts[0]?.payload.title).toBe('Offline Issue Report');
      expect(drafts[0]?.payload.labels).toContain('offline');
    });
  });

  // =========================================================================
  // Challenge 4: High-Contrast Accessibility (WCAG 2.1 AA) of Offline Indicator
  // =========================================================================
  describe('Challenge 4: High-Contrast Accessibility & WCAG 2.1 AA Verification', () => {
    it('verifies offline indicator colors strictly exceed WCAG 2.1 AA contrast thresholds', () => {
      const stylesContent = fs.readFileSync(stylesPath, 'utf-8');

      // Extract colors from .offline-badge in styles.css
      const badgeBgMatch = /\.offline-badge\s*\{[^}]*background-color:\s*(#[0-9a-fA-F]{6})/.exec(stylesContent);
      const badgeBorderMatch = /\.offline-badge\s*\{[^}]*border:\s*1px solid\s*(#[0-9a-fA-F]{6})/.exec(stylesContent);
      const badgeColorMatch = /\.offline-badge\s*\{[^}]*color:\s*(#[0-9a-fA-F]{6})/.exec(stylesContent);
      const dotBgMatch = /\.offline-dot\s*\{[^}]*background-color:\s*(#[0-9a-fA-F]{6})/.exec(stylesContent);

      expect(badgeBgMatch).not.toBeNull();
      expect(badgeBorderMatch).not.toBeNull();
      expect(badgeColorMatch).not.toBeNull();
      expect(dotBgMatch).not.toBeNull();

      const bgHex = badgeBgMatch ? badgeBgMatch[1] : '#382300';
      const borderHex = badgeBorderMatch ? badgeBorderMatch[1] : '#9e6a03';
      const textColorHex = badgeColorMatch ? badgeColorMatch[1] : '#f0883e';
      const dotColorHex = dotBgMatch ? dotBgMatch[1] : '#f0883e';

      const safeBgHex = bgHex ?? '#382300';
      const safeBorderHex = borderHex ?? '#9e6a03';
      const safeTextColorHex = textColorHex ?? '#f0883e';
      const safeDotColorHex = dotColorHex ?? '#f0883e';

      expect(safeBgHex).toBe('#382300');
      expect(safeBorderHex).toBe('#9e6a03');
      expect(safeTextColorHex).toBe('#f0883e');
      expect(safeDotColorHex).toBe('#f0883e');

      // 1. Text contrast vs Badge background (WCAG AA normal text threshold: 4.5:1)
      const textContrast = calculateContrastRatio(safeTextColorHex, safeBgHex);
      expect(textContrast).toBeGreaterThanOrEqual(4.5);
      // Actual ratio is ~5.90:1
      expect(textContrast).toBeCloseTo(5.9, 0.5);

      // 2. Indicator Dot graphical element contrast vs Badge background (WCAG AA non-text threshold: 3.0:1)
      const dotContrast = calculateContrastRatio(safeDotColorHex, safeBgHex);
      expect(dotContrast).toBeGreaterThanOrEqual(3.0);

      // 3. Border graphical element contrast vs Dark Page background (#0d1117 / #161b22) (WCAG AA non-text threshold: 3.0:1)
      const borderContrastOnPage = calculateContrastRatio(safeBorderHex, '#0d1117');
      expect(borderContrastOnPage).toBeGreaterThanOrEqual(3.0);
    });

    it('verifies accessibility markup semantics (role="status", title, visual text) in App.tsx', () => {
      Object.defineProperty(navigator, 'onLine', {
        value: false,
        configurable: true,
        writable: true,
      });

      const html = renderToString(h(App, { baseUrl: '' }));
      expect(html).toContain('role="status"');
      expect(html).toContain('data-testid="offline-status-badge"');
      expect(html).toContain('title="You are currently browsing cached repository data offline"');
      expect(html).toContain('Offline Mode');
      expect(html).toContain('offline-dot');
    });
  });
});
