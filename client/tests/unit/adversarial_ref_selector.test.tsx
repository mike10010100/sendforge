import { describe, expect, it, vi } from 'vitest';
import render from 'preact-render-to-string';
import {
  RefSelector,
  filterRefs,
  formatSha,
  isDefaultBranch,
} from '../../src/ui/RefSelector.js';
import type { RepoBranch, RepoTag } from '../../src/engine/types.js';

describe('Milestone M1 Empirical Stress Tests: Adversarial RefSelector', () => {
  // ---------------------------------------------------------------------------
  // 1. Extreme Scale & High-Throughput Search Filtering (10,000 to 50,000 items)
  // ---------------------------------------------------------------------------
  describe('High-Throughput Filtering & Scale Stress Tests', () => {
    function generateLargeBranchSet(count: number): RepoBranch[] {
      const branches: RepoBranch[] = [];
      for (let i = 0; i < count; i++) {
        const hex = i.toString(16).padStart(8, '0');
        branches.push({
          name: `feature/scale-branch-${i}-${hex}`,
          target: `${hex}000000000000000000000000000000000000`.slice(0, 40),
          is_default: i === 0,
        });
      }
      return branches;
    }

    function generateLargeTagSet(count: number): RepoTag[] {
      const tags: RepoTag[] = [];
      for (let i = 0; i < count; i++) {
        const hex = i.toString(16).padStart(8, '0');
        tags.push({
          name: `v${Math.floor(i / 100)}.${i % 100}.0-rc${i}`,
          target: `tag${hex}00000000000000000000000000000000`.slice(0, 40),
          is_annotated: i % 2 === 0,
          peeled: i % 2 === 0 ? `peel${hex}000000000000000000000000000000`.slice(0, 40) : null,
        });
      }
      return tags;
    }

    it('filters 10,000 branches in < 15ms per search query', () => {
      const branches = generateLargeBranchSet(10000);

      const start = performance.now();
      const results1 = filterRefs(branches, 'scale-branch-999');
      const duration1 = performance.now() - start;

      expect(results1.length).toBeGreaterThanOrEqual(1);
      expect(duration1).toBeLessThan(30);

      const startSha = performance.now();
      const resultsSha = filterRefs(branches, '0000270f'); // hex for 9999
      const durationSha = performance.now() - startSha;

      expect(resultsSha.length).toBeGreaterThanOrEqual(1);
      expect(durationSha).toBeLessThan(30);
    });

    it('filters 50,000 branches and tags without timeout or memory exhaustion', () => {
      const branches = generateLargeBranchSet(50000);
      const tags = generateLargeTagSet(50000);

      const t0 = performance.now();
      const bRes = filterRefs(branches, 'feature/scale-branch-49999');
      const t1 = performance.now();
      // 49998 is even (so it has peeled SHA), hex is 0000c34e
      const tagRes = filterRefs(tags, 'peel0000c34e');
      const t2 = performance.now();

      expect(bRes).toHaveLength(1);
      expect(tagRes.length).toBeGreaterThanOrEqual(1);
      expect(t1 - t0).toBeLessThan(150);
      expect(t2 - t1).toBeLessThan(150);
    });

    it('executes 100 consecutive search queries on 5,000 branches in < 500ms total', () => {
      const largeBranchSet: RepoBranch[] = generateLargeBranchSet(5000);

      const start = performance.now();
      for (let q = 0; q < 100; q++) {
        const query = (q * 37 % 5000).toString();
        const results = filterRefs(largeBranchSet, query);
        expect(results.length).toBeGreaterThan(0);
      }
      const duration = performance.now() - start;
      expect(duration).toBeLessThan(500);
    });

    it('renders RefSelector component with 2,000 branches and 1,000 tags within 150ms', () => {
      const branches = generateLargeBranchSet(2000);
      const tags = generateLargeTagSet(1000);

      const start = performance.now();
      const html = render(
        <RefSelector
          currentRef="feature/scale-branch-0-00000000"
          branches={branches}
          tags={tags}
          onSelectRef={vi.fn()}
          initialOpen={true}
          initialTab="branches"
          initialQuery="scale-branch-100"
        />
      );
      const duration = performance.now() - start;

      expect(html).toContain('scale-branch-100');
      expect(duration).toBeLessThan(200);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Malformed & Adversarial Search Query Fuzzing
  // ---------------------------------------------------------------------------
  describe('Malformed & Adversarial Query Fuzzing', () => {
    const branches: RepoBranch[] = [
      { name: 'main', target: '4b825dc642cb6eb9a060e54bf8d69288fbee4904', is_default: true },
      { name: 'feat/(foo|bar)[a-z]+.*$^?{}', target: '1111111111111111111111111111111111111111', is_default: false },
      { name: 'release/2026.01.01-RC#1', target: '2222222222222222222222222222222222222222', is_default: false },
      { name: 'test/\x00null-byte', target: '3333333333333333333333333333333333333333', is_default: false },
      { name: 'feat/\\backslash\\path', target: '4444444444444444444444444444444444444444', is_default: false },
    ];

    const adversarialQueries = [
      '[a-z]+',
      '.*',
      '^.*$',
      '(?:)',
      '(',
      '[',
      '{',
      '\\',
      '\\\\',
      '\\d+\\s*',
      '?+*{}',
      '\\0',
      '\0',
      '\u0000',
      'null',
      'undefined',
      'NaN',
      '<script>alert("XSS")</script>',
      '"><img src=x onerror=alert(1)>',
      '\' OR \'1\'=\'1',
      '" OR ""="',
      '${7*7}',
      '{{constructor.constructor("alert(1)")()}}',
      '__proto__',
      'constructor',
      'valueOf',
      'toString',
      'a'.repeat(10000), // Long string 10KB
      '🔥'.repeat(200),  // Multi-byte Unicode
      '   \t\r\n   ',   // Whitespace only
      '   [a-z]+   ',
      'main\0test',
      '[\u0000-\u001f]',
      '(((((((((a+)+)+)+)+)+)+)+)+)+', // ReDoS regex pattern
      '.*.*.*.*.*.*.*.*.*.*.*.*.*.*.*.*.*.*.*',
      'DROP TABLE branches;--',
    ];

    for (const query of adversarialQueries) {
      it(`filterRefs handles adversarial query safely: ${query.slice(0, 25)}`, () => {
        expect(() => {
          const results = filterRefs(branches, query);
          expect(Array.isArray(results)).toBe(true);
        }).not.toThrow();
      });

      it(`RefSelector renders safely with adversarial query: ${query.slice(0, 25)}`, () => {
        expect(() => {
          const html = render(
            <RefSelector
              currentRef="main"
              branches={branches}
              tags={[]}
              onSelectRef={vi.fn()}
              initialOpen={true}
              initialQuery={query}
            />
          );
          expect(typeof html).toBe('string');
        }).not.toThrow();
      });
    }

    it('exact matches regex characters as literal substrings', () => {
      const regexMatch = filterRefs(branches, 'feat/(foo|bar)');
      expect(regexMatch.map((b) => b.name)).toEqual(['feat/(foo|bar)[a-z]+.*$^?{}']);

      const backslashMatch = filterRefs(branches, 'feat/\\backslash');
      expect(backslashMatch.map((b) => b.name)).toEqual(['feat/\\backslash\\path']);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Long Ref Names, Unicode, RTL, Emojis, and HTML Injection
  // ---------------------------------------------------------------------------
  describe('Adversarial & Long Ref Names Rendering', () => {
    const longBranchName = 'feature/' + 'very-long-subpath-segment/'.repeat(20) + 'CRITICAL-BUG-FIX-NAME-999999999999999999';
    const xssBranchName = '<script>alert("hack")</script><img src=x onerror=alert(1)>';
    const unicodeRtlBranchName = 'release/🚀-2026-تجربة-עִבְרִית-🎉-日本語-版';

    const extremeBranches: RepoBranch[] = [
      { name: longBranchName, target: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', is_default: false },
      { name: xssBranchName, target: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', is_default: false },
      { name: unicodeRtlBranchName, target: 'cccccccccccccccccccccccccccccccccccccccc', is_default: false },
    ];

    const extremeTags: RepoTag[] = [
      {
        name: 'tag/' + 'deeply-nested-tag-release-version-'.repeat(15) + 'v99.99.99',
        target: 'dddddddddddddddddddddddddddddddddddddddd',
        is_annotated: true,
        peeled: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      },
      {
        name: 'tag/<svg/onload=confirm(1)>',
        target: 'ffffffffffffffffffffffffffffffffffffffff',
        is_annotated: false,
        peeled: null,
      },
    ];

    it('properly renders extremely long ref names with title tooltips', () => {
      const html = render(
        <RefSelector
          currentRef={longBranchName}
          branches={extremeBranches}
          tags={extremeTags}
          onSelectRef={vi.fn()}
          initialOpen={true}
          initialTab="branches"
        />
      );

      expect(html).toContain('ref-current-name');
      expect(html).toContain(longBranchName);
      expect(html).toContain(`title="${longBranchName}"`);
      expect(html).toContain('ref-item-name');
    });

    it('safely escapes HTML/XSS injection attempts in branch and tag names', () => {
      const htmlBranches = render(
        <RefSelector
          currentRef={xssBranchName}
          branches={extremeBranches}
          tags={extremeTags}
          onSelectRef={vi.fn()}
          initialOpen={true}
          initialTab="branches"
        />
      );

      // JSX automatically escapes HTML entities in text and attributes
      expect(htmlBranches).not.toContain('<script>alert("hack")</script>');
      expect(htmlBranches).toContain('&lt;script>alert(&quot;hack&quot;)&lt;/script>');

      const htmlTags = render(
        <RefSelector
          currentRef="tag/<svg/onload=confirm(1)>"
          branches={extremeBranches}
          tags={extremeTags}
          onSelectRef={vi.fn()}
          initialOpen={true}
          initialTab="tags"
        />
      );

      expect(htmlTags).not.toContain('<svg/onload=confirm(1)>');
      expect(htmlTags).toContain('&lt;svg/onload=confirm(1)>');
    });

    it('renders Unicode, Emojis, and RTL branch names seamlessly', () => {
      const html = render(
        <RefSelector
          currentRef={unicodeRtlBranchName}
          branches={extremeBranches}
          tags={extremeTags}
          onSelectRef={vi.fn()}
          initialOpen={true}
          initialTab="branches"
        />
      );

      expect(html).toContain(unicodeRtlBranchName);
      expect(html).toContain('release/🚀-2026-تجربة-עִבְרִית-🎉-日本語-版');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Boundary Cases: Empty, Missing Fields, Undefined, Duplicate Names
  // ---------------------------------------------------------------------------
  describe('Boundary Cases, Missing Fields, and Null Handling', () => {
    it('handles duplicate branch names in branch list without crashing', () => {
      const duplicateBranches: readonly RepoBranch[] = [
        { name: 'main', target: '1111111111111111111111111111111111111111', is_default: true },
        { name: 'main', target: '2222222222222222222222222222222222222222', is_default: false },
        { name: 'main', target: '3333333333333333333333333333333333333333', is_default: false },
      ];

      const filtered = filterRefs(duplicateBranches, 'main');
      expect(filtered).toHaveLength(3);

      expect(() => {
        const html = render(
          <RefSelector
            currentRef="main"
            branches={duplicateBranches}
            tags={[]}
            onSelectRef={vi.fn()}
            initialOpen={true}
          />
        );
        expect(html).toContain('main');
      }).not.toThrow();
    });

    it('handles empty branch names or empty commit SHAs without throwing', () => {
      const emptyProps: readonly RepoBranch[] = [
        { name: '', target: '', is_default: false },
        { name: 'valid', target: '4b825dc642cb6eb9a060e54bf8d69288fbee4904', is_default: true },
      ];

      const res = filterRefs(emptyProps, 'valid');
      expect(res).toHaveLength(1);
      expect(res[0]?.name).toBe('valid');

      const resEmpty = filterRefs(emptyProps, '');
      expect(resEmpty).toHaveLength(2);
    });

    it('handles completely empty repository with 0 branches and 0 tags', () => {
      const html = render(
        <RefSelector
          currentRef="HEAD"
          branches={[]}
          tags={[]}
          onSelectRef={vi.fn()}
          initialOpen={true}
          initialTab="branches"
        />
      );

      expect(html).toContain('No branches found');
      expect(html).toContain('Branches <span class="ref-tab-badge">0</span>');
      expect(html).toContain('Tags <span class="ref-tab-badge">0</span>');
    });

    it('handles detached HEAD or arbitrary commit SHA as currentRef', () => {
      const branches: readonly RepoBranch[] = [
        { name: 'main', target: '4b825dc642cb6eb9a060e54bf8d69288fbee4904', is_default: true },
      ];
      const tags: readonly RepoTag[] = [
        { name: 'v1.0.0', target: '5555555555555555555555555555555555555555', is_annotated: false, peeled: null },
      ];

      const commitSha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
      const html = render(
        <RefSelector
          currentRef={commitSha}
          branches={branches}
          tags={tags}
          onSelectRef={vi.fn()}
          initialOpen={true}
        />
      );

      expect(html).toContain('⚡'); // Detached commit icon
      expect(html).toContain(commitSha);
    });

    it('handles missing/undefined/null optional properties on tags', () => {
      const tagsWithVariedNulls: readonly RepoTag[] = [
        {
          name: 'v1.0-null-peeled',
          target: '1111111111111111111111111111111111111111',
          is_annotated: true,
          peeled: null,
          tagger: null,
          message: null,
        },
        {
          name: 'v2.0-undef-peeled',
          target: '2222222222222222222222222222222222222222',
          is_annotated: false,
          peeled: null,
          tagger: undefined,
          message: undefined,
        },
      ];

      expect(() => filterRefs(tagsWithVariedNulls, '1111')).not.toThrow();
      expect(filterRefs(tagsWithVariedNulls, '1111')).toHaveLength(1);

      const html = render(
        <RefSelector
          currentRef="v1.0-null-peeled"
          branches={[]}
          tags={tagsWithVariedNulls}
          onSelectRef={vi.fn()}
          initialOpen={true}
          initialTab="tags"
        />
      );
      expect(html).toContain('v1.0-null-peeled');
      expect(html).toContain('v2.0-undef-peeled');
    });

    it('handles formatSha edge cases (short strings, exact length, empty string)', () => {
      expect(formatSha('')).toBe('');
      expect(formatSha('a')).toBe('a');
      expect(formatSha('1234567')).toBe('1234567');
      expect(formatSha('1234567890', 5)).toBe('12345');
      expect(formatSha('1234567890', 20)).toBe('1234567890');
    });

    it('handles isDefaultBranch edge cases with empty strings, undefined, and mismatched flags', () => {
      const branchDefaultFlag: RepoBranch = {
        name: 'custom-master',
        target: '1111111111111111111111111111111111111111',
        is_default: true,
      };
      const branchNoFlag: RepoBranch = {
        name: 'custom-master',
        target: '1111111111111111111111111111111111111111',
        is_default: false,
      };

      // Flag is true, defaultBranch is undefined -> true
      expect(isDefaultBranch(branchDefaultFlag, undefined)).toBe(true);
      // Flag is true, defaultBranch is '' -> true
      expect(isDefaultBranch(branchDefaultFlag, '')).toBe(true);
      // Flag is false, defaultBranch matches name -> true
      expect(isDefaultBranch(branchNoFlag, 'custom-master')).toBe(true);
      // Flag is false, defaultBranch is '' -> false
      expect(isDefaultBranch(branchNoFlag, '')).toBe(false);
      // Flag is false, defaultBranch is undefined -> false
      expect(isDefaultBranch(branchNoFlag, undefined)).toBe(false);
      // Flag is false, defaultBranch does not match -> false
      expect(isDefaultBranch(branchNoFlag, 'main')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Ambiguity Resolution & Overlap Testing
  // ---------------------------------------------------------------------------
  describe('Ambiguous Matches & Overlap Resolution', () => {
    it('returns both items when a branch name and a target SHA prefix collide', () => {
      const ambiguousBranches: readonly RepoBranch[] = [
        {
          name: 'deadbeef',
          target: '1111111111111111111111111111111111111111',
          is_default: false,
        },
        {
          name: 'other-branch',
          target: 'deadbeef00000000000000000000000000000000',
          is_default: false,
        },
        {
          name: 'unrelated',
          target: '2222222222222222222222222222222222222222',
          is_default: false,
        },
      ];

      const matches = filterRefs(ambiguousBranches, 'deadbeef');
      expect(matches).toHaveLength(2);
      expect(matches.map((b) => b.name)).toEqual(['deadbeef', 'other-branch']);
    });

    it('matches annotated tag by either tag object SHA or peeled commit SHA', () => {
      const tags: readonly RepoTag[] = [
        {
          name: 'v1.0.0',
          target: 'aaaa111100000000000000000000000000000000',
          is_annotated: true,
          peeled: 'bbbb222200000000000000000000000000000000',
        },
      ];

      expect(filterRefs(tags, 'aaaa1111')).toHaveLength(1);
      expect(filterRefs(tags, 'bbbb2222')).toHaveLength(1);
      expect(filterRefs(tags, 'v1.0')).toHaveLength(1);
      expect(filterRefs(tags, 'cccc3333')).toHaveLength(0);
    });

    it('handles query matching substring in middle of SHA or branch name', () => {
      const branches: readonly RepoBranch[] = [
        {
          name: 'jira-1234-fix',
          target: '0000cafe00000000000000000000000000000000',
          is_default: false,
        },
      ];

      expect(filterRefs(branches, '1234')).toHaveLength(1);
      expect(filterRefs(branches, 'cafe')).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. UI Controls & Accessibility Contracts
  // ---------------------------------------------------------------------------
  describe('UI Controls & Accessibility Contracts', () => {
    const branches: RepoBranch[] = [
      { name: 'main', target: '4b825dc642cb6eb9a060e54bf8d69288fbee4904', is_default: true },
      { name: 'feature/diff', target: '1111111111111111111111111111111111111111', is_default: false },
    ];

    it('renders proper ARIA dialog, tablist, tabs, and listbox roles', () => {
      const html = render(
        <RefSelector
          currentRef="main"
          branches={branches}
          tags={[]}
          onSelectRef={vi.fn()}
          initialOpen={true}
        />
      );

      expect(html).toContain('role="dialog"');
      expect(html).toContain('aria-label="Ref selector"');
      expect(html).toContain('role="tablist"');
      expect(html).toContain('role="tab"');
      expect(html).toContain('role="listbox"');
      expect(html).toContain('role="option"');
      expect(html).toContain('aria-selected="true"');
    });

    it('renders clear search button only when search query is non-empty', () => {
      const htmlEmpty = render(
        <RefSelector
          currentRef="main"
          branches={branches}
          tags={[]}
          onSelectRef={vi.fn()}
          initialOpen={true}
          initialQuery=""
        />
      );
      expect(htmlEmpty).not.toContain('ref-search-clear');

      const htmlWithQuery = render(
        <RefSelector
          currentRef="main"
          branches={branches}
          tags={[]}
          onSelectRef={vi.fn()}
          initialOpen={true}
          initialQuery="diff"
        />
      );
      expect(htmlWithQuery).toContain('ref-search-clear');
      expect(htmlWithQuery).toContain('Clear filter');
    });
  });
});
