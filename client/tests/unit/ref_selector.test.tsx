import { describe, expect, it, vi } from 'vitest';
import render from 'preact-render-to-string';
import {
  RefSelector,
  filterRefs,
  formatSha,
  isDefaultBranch,
} from '../../src/ui/RefSelector.js';
import type { RepoBranch, RepoTag } from '../../src/engine/types.js';

describe('Milestone M1: Tabbed Ref Selector Unit Tests', () => {
  const mockBranches: readonly RepoBranch[] = [
    { name: 'main', target: '4b825dc642cb6eb9a060e54bf8d69288fbee4904', is_default: true },
    { name: 'develop', target: '1111111111111111111111111111111111111111', is_default: false },
    { name: 'feature/login', target: '2222222222222222222222222222222222222222', is_default: false },
    { name: 'feature/diff-view', target: '3333333333333333333333333333333333333333', is_default: false },
    { name: 'bugfix/issue-42', target: '4444444444444444444444444444444444444444', is_default: false },
  ];

  const mockTags: readonly RepoTag[] = [
    {
      name: 'v1.0.0',
      target: '5555555555555555555555555555555555555555',
      is_annotated: true,
      peeled: '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
    },
    {
      name: 'v1.1.0-beta.1',
      target: '6666666666666666666666666666666666666666',
      is_annotated: true,
      peeled: '1111111111111111111111111111111111111111',
    },
    {
      name: 'v2.0.0-lightweight',
      target: '7777777777777777777777777777777777777777',
      is_annotated: false,
      peeled: null,
    },
  ];

  // ---------------------------------------------------------------------------
  // 1. Pure Helper Functions
  // ---------------------------------------------------------------------------
  describe('Pure Helper Functions', () => {
    it('filterRefs matches branch names case-insensitively', () => {
      const results1 = filterRefs(mockBranches, 'feat');
      expect(results1.map((b) => b.name)).toEqual(['feature/login', 'feature/diff-view']);

      const results2 = filterRefs(mockBranches, 'DEVELOP');
      expect(results2.map((b) => b.name)).toEqual(['develop']);

      const results3 = filterRefs(mockBranches, 'MAIN');
      expect(results3.map((b) => b.name)).toEqual(['main']);
    });

    it('filterRefs matches commit SHA prefixes (7-char and 40-char)', () => {
      const resultsShort = filterRefs(mockBranches, '4b825dc');
      expect(resultsShort.map((b) => b.name)).toEqual(['main']);

      const resultsFull = filterRefs(mockBranches, '1111111111111111111111111111111111111111');
      expect(resultsFull.map((b) => b.name)).toEqual(['develop']);
    });

    it('filterRefs matches peeled commit SHA on annotated tags', () => {
      // v1.0.0 has peeled commit 4b825dc642cb6eb9a060e54bf8d69288fbee4904
      const results = filterRefs(mockTags, '4b825dc');
      expect(results.map((t) => t.name)).toEqual(['v1.0.0']);

      // v2.0.0-lightweight has target 7777777
      const resultsLight = filterRefs(mockTags, '7777777');
      expect(resultsLight.map((t) => t.name)).toEqual(['v2.0.0-lightweight']);
    });

    it('filterRefs trims whitespace and handles empty query', () => {
      expect(filterRefs(mockBranches, '')).toHaveLength(5);
      expect(filterRefs(mockBranches, '   ')).toHaveLength(5);
      expect(filterRefs(mockBranches, '  main  ').map((b) => b.name)).toEqual(['main']);
    });

    it('filterRefs handles regex special characters safely without throwing', () => {
      expect(() => filterRefs(mockBranches, 'feat[(')).not.toThrow();
      expect(() => filterRefs(mockBranches, '.*')).not.toThrow();
      expect(() => filterRefs(mockBranches, '(test)')).not.toThrow();
      expect(() => filterRefs(mockBranches, 'a+b*c')).not.toThrow();
      expect(filterRefs(mockTags, 'v1.1.0').map((t) => t.name)).toEqual(['v1.1.0-beta.1']);
    });

    it('isDefaultBranch correctly evaluates default branch conditions', () => {
      const b0 = mockBranches[0];
      const b1 = mockBranches[1];
      if (b0 && b1) {
        expect(isDefaultBranch(b0, 'main')).toBe(true);
        expect(isDefaultBranch(b1, 'main')).toBe(false);
        // Explicit override
        expect(isDefaultBranch(b1, 'develop')).toBe(true);
      }
    });

    it('formatSha formats 40-character commit SHA to default 7 characters and custom lengths', () => {
      expect(formatSha('4b825dc642cb6eb9a060e54bf8d69288fbee4904')).toBe('4b825dc');
      expect(formatSha('4b825dc642cb6eb9a060e54bf8d69288fbee4904', 10)).toBe('4b825dc642');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Popover Trigger Button & Closed State
  // ---------------------------------------------------------------------------
  describe('Popover Trigger Button & Closed State', () => {
    it('renders trigger button displaying current branch name and branch icon', () => {
      const html = render(
        <RefSelector
          currentRef="main"
          branches={mockBranches}
          tags={mockTags}
          onSelectRef={vi.fn()}
        />
      );

      expect(html).toContain('main');
      expect(html).toContain('🌿');
      expect(html).toContain('ref-selector-trigger');
      expect(html).toContain('aria-haspopup="dialog"');
      expect(html).toContain('aria-expanded="false"');
    });

    it('renders trigger button displaying current tag name and tag icon', () => {
      const html = render(
        <RefSelector
          currentRef="v1.0.0"
          branches={mockBranches}
          tags={mockTags}
          onSelectRef={vi.fn()}
        />
      );

      expect(html).toContain('v1.0.0');
      expect(html).toContain('🏷️');
    });

    it('renders default branch badge in trigger button when currentRef is default', () => {
      const html = render(
        <RefSelector
          currentRef="main"
          branches={mockBranches}
          tags={mockTags}
          onSelectRef={vi.fn()}
        />
      );

      expect(html).toContain('default');
      expect(html).toContain('badge-default');
    });

    it('renders closed popover without dialog dropdown content', () => {
      const html = render(
        <RefSelector
          currentRef="main"
          branches={mockBranches}
          tags={mockTags}
          onSelectRef={vi.fn()}
          initialOpen={false}
        />
      );

      expect(html).not.toContain('ref-selector-popover');
      expect(html).not.toContain('ref-search-input');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Popover Open & Tab Navigation
  // ---------------------------------------------------------------------------
  describe('Popover Open & Tab Navigation', () => {
    it('renders popover dialog with search input and tabs when open', () => {
      const html = render(
        <RefSelector
          currentRef="main"
          branches={mockBranches}
          tags={mockTags}
          onSelectRef={vi.fn()}
          initialOpen={true}
        />
      );

      expect(html).toContain('ref-selector-popover');
      expect(html).toContain('ref-search-input');
      expect(html).toContain('Branches');
      expect(html).toContain('Tags');
      expect(html).toContain('aria-expanded="true"');
    });

    it('displays accurate count badges on Branches and Tags tabs', () => {
      const html = render(
        <RefSelector
          currentRef="main"
          branches={mockBranches}
          tags={mockTags}
          onSelectRef={vi.fn()}
          initialOpen={true}
        />
      );

      expect(html).toContain('5'); // 5 branches
      expect(html).toContain('3'); // 3 tags
    });

    it('highlights active tab correctly', () => {
      const htmlBranches = render(
        <RefSelector
          currentRef="main"
          branches={mockBranches}
          tags={mockTags}
          onSelectRef={vi.fn()}
          initialOpen={true}
          initialTab="branches"
        />
      );

      expect(htmlBranches).toContain('tab-branches');
      expect(htmlBranches).toContain('active');

      const htmlTags = render(
        <RefSelector
          currentRef="main"
          branches={mockBranches}
          tags={mockTags}
          onSelectRef={vi.fn()}
          initialOpen={true}
          initialTab="tags"
        />
      );

      expect(htmlTags).toContain('tab-tags');
      expect(htmlTags).toContain('active');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Panel Content Rendering (Branches vs Tags)
  // ---------------------------------------------------------------------------
  describe('Panel Content Rendering', () => {
    it('renders Branches panel with all branch names and short SHAs', () => {
      const html = render(
        <RefSelector
          currentRef="main"
          branches={mockBranches}
          tags={mockTags}
          onSelectRef={vi.fn()}
          initialOpen={true}
          initialTab="branches"
        />
      );

      expect(html).toContain('main');
      expect(html).toContain('develop');
      expect(html).toContain('feature/login');
      expect(html).toContain('feature/diff-view');
      expect(html).toContain('bugfix/issue-42');
      expect(html).toContain('4b825dc');
      expect(html).toContain('1111111');
    });

    it('renders Tags panel with all tag names and metadata badges', () => {
      const html = render(
        <RefSelector
          currentRef="main"
          branches={mockBranches}
          tags={mockTags}
          onSelectRef={vi.fn()}
          initialOpen={true}
          initialTab="tags"
        />
      );

      expect(html).toContain('v1.0.0');
      expect(html).toContain('v1.1.0-beta.1');
      expect(html).toContain('v2.0.0-lightweight');
      expect(html).toContain('annotated');
      expect(html).toContain('lightweight');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Search Filtering & Empty States
  // ---------------------------------------------------------------------------
  describe('Search Filtering & Empty States', () => {
    it('filters branch list by name query', () => {
      const html = render(
        <RefSelector
          currentRef="main"
          branches={mockBranches}
          tags={mockTags}
          onSelectRef={vi.fn()}
          initialOpen={true}
          initialTab="branches"
          initialQuery="login"
        />
      );

      expect(html).toContain('feature/login');
      expect(html).not.toContain('feature/diff-view');
      expect(html).not.toContain('develop');
    });

    it('filters tag list by name query', () => {
      const html = render(
        <RefSelector
          currentRef="main"
          branches={mockBranches}
          tags={mockTags}
          onSelectRef={vi.fn()}
          initialOpen={true}
          initialTab="tags"
          initialQuery="beta"
        />
      );

      expect(html).toContain('v1.1.0-beta.1');
      expect(html).not.toContain('v1.0.0');
      expect(html).not.toContain('v2.0.0-lightweight');
    });

    it('filters refs by commit SHA query', () => {
      const html = render(
        <RefSelector
          currentRef="main"
          branches={mockBranches}
          tags={mockTags}
          onSelectRef={vi.fn()}
          initialOpen={true}
          initialTab="branches"
          initialQuery="4b825dc"
        />
      );

      expect(html).toContain('main');
      expect(html).not.toContain('develop');
      expect(html).not.toContain('feature/login');
    });

    it('renders empty state message when branch search returns no results', () => {
      const html = render(
        <RefSelector
          currentRef="main"
          branches={mockBranches}
          tags={mockTags}
          onSelectRef={vi.fn()}
          initialOpen={true}
          initialTab="branches"
          initialQuery="nonexistent-branch-name"
        />
      );

      expect(html).toContain('No branches found');
      expect(html).toContain('nonexistent-branch-name');
    });

    it('renders empty state message when tag search returns no results', () => {
      const html = render(
        <RefSelector
          currentRef="main"
          branches={mockBranches}
          tags={mockTags}
          onSelectRef={vi.fn()}
          initialOpen={true}
          initialTab="tags"
          initialQuery="nonexistent-tag-name"
        />
      );

      expect(html).toContain('No tags found');
      expect(html).toContain('nonexistent-tag-name');
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Badges & Selected Item Indicator
  // ---------------------------------------------------------------------------
  describe('Badges & Selection Indicators', () => {
    it('renders default branch badge only on default branch', () => {
      const html = render(
        <RefSelector
          currentRef="main"
          branches={mockBranches}
          tags={mockTags}
          onSelectRef={vi.fn()}
          initialOpen={true}
          initialTab="branches"
        />
      );

      expect(html).toContain('badge-default');
      expect(html).toContain('default');
    });

    it('renders selected checkmark indicator on current active ref', () => {
      const html = render(
        <RefSelector
          currentRef="develop"
          branches={mockBranches}
          tags={mockTags}
          onSelectRef={vi.fn()}
          initialOpen={true}
          initialTab="branches"
        />
      );

      expect(html).toContain('ref-item branch-item selected');
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Edge Cases & Zero-Data Scenarios
  // ---------------------------------------------------------------------------
  describe('Edge Cases & Stress Scenarios', () => {
    it('handles repository with 0 tags gracefully', () => {
      const html = render(
        <RefSelector
          currentRef="main"
          branches={mockBranches}
          tags={[]}
          onSelectRef={vi.fn()}
          initialOpen={true}
          initialTab="tags"
        />
      );

      expect(html).toContain('0'); // 0 tags count badge
      expect(html).toContain('No tags found');
    });

    it('handles single branch repository without tags', () => {
      const singleBranch: readonly RepoBranch[] = [
        { name: 'main', target: '4b825dc642cb6eb9a060e54bf8d69288fbee4904', is_default: true },
      ];

      const html = render(
        <RefSelector
          currentRef="main"
          branches={singleBranch}
          tags={[]}
          onSelectRef={vi.fn()}
          initialOpen={true}
          initialTab="branches"
        />
      );

      expect(html).toContain('main');
      expect(html).toContain('default');
    });

    it('handles deeply nested branch names and special characters without error', () => {
      const complexBranches: readonly RepoBranch[] = [
        {
          name: 'user/feat/sub-path/JIRA-999_fix-now.v2.1',
          target: '9999999999999999999999999999999999999999',
          is_default: false,
        },
        {
          name: 'release/🚀-launch-build',
          target: '8888888888888888888888888888888888888888',
          is_default: false,
        },
      ];

      const html = render(
        <RefSelector
          currentRef="user/feat/sub-path/JIRA-999_fix-now.v2.1"
          branches={complexBranches}
          tags={[]}
          onSelectRef={vi.fn()}
          initialOpen={true}
        />
      );

      expect(html).toContain('user/feat/sub-path/JIRA-999_fix-now.v2.1');
      expect(html).toContain('release/🚀-launch-build');
    });

    it('auto-activates tags tab when currentRef matches a tag name', () => {
      const html = render(
        <RefSelector
          currentRef="v1.0.0"
          branches={mockBranches}
          tags={mockTags}
          onSelectRef={vi.fn()}
          initialOpen={true}
        />
      );

      expect(html).toContain('tab-tags ref-tab-btn active');
      expect(html).toContain('v1.0.0');
      expect(html).toContain('annotated');
    });
  });
});
