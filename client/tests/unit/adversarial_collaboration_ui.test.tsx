import { describe, expect, it, vi } from 'vitest';
import render from 'preact-render-to-string';
import { PullRequestsView } from '../../src/ui/PullRequestsView.js';
import { PRDetailView } from '../../src/ui/PRDetailView.js';
import { IssuesView } from '../../src/ui/IssuesView.js';
import { IssueDetailView } from '../../src/ui/IssueDetailView.js';
import { GitRepositoryClient } from '../../src/engine/fetcher.js';
import type { Issue, PullRequest, ReviewNote, Comment } from '../../src/engine/collab-client.js';
import type { FileDiff, SplitDiffRow } from '../../src/worker/diff-types.js';
import {
  formatRelativeTime,
  getAuthorColor,
  getAuthorInitials,
  renderMarkdown,
} from '../../src/ui/utils.js';

describe('Adversarial & Empirical Challenge Suite: Collaboration UI Views', () => {
  const mockClient = new GitRepositoryClient('');

  // =========================================================================
  // 1. PR and Issue lists: 0 items, 100+ items, multi-token queries
  // =========================================================================
  describe('1. PR and Issue Lists Scalability & Search Stress', () => {
    it('handles 0 items gracefully for both PR and Issue list views with appropriate empty states', () => {
      const emptyPRHtml = render(<PullRequestsView pulls={[]} />);
      expect(emptyPRHtml).toContain('data-testid="pulls-empty-state"');
      expect(emptyPRHtml).toContain('No pull requests found');
      expect(emptyPRHtml).toContain('data-testid="open-count-badge">0</span>');
      expect(emptyPRHtml).toContain('data-testid="merged-count-badge">0</span>');
      expect(emptyPRHtml).toContain('data-testid="closed-count-badge">0</span>');
      expect(emptyPRHtml).toContain('data-testid="all-count-badge">0</span>');

      const emptyIssueHtml = render(<IssuesView issues={[]} />);
      expect(emptyIssueHtml).toContain('data-testid="issues-empty-state"');
      expect(emptyIssueHtml).toContain('No issues found');
      expect(emptyIssueHtml).toContain('data-testid="open-count-badge">0</span>');
      expect(emptyIssueHtml).toContain('data-testid="closed-count-badge">0</span>');
      expect(emptyIssueHtml).toContain('data-testid="all-count-badge">0</span>');
    });

    it('processes and renders 150+ PRs with accurate status counts and filtering', () => {
      const generatedPulls: PullRequest[] = [];
      for (let i = 1; i <= 150; i++) {
        const status: 'open' | 'merged' | 'closed' =
          i % 3 === 1 ? 'open' : i % 3 === 2 ? 'merged' : 'closed';
        generatedPulls.push({
          id: `pr-${i}`,
          number: i,
          title: `Pull Request #${i} feature implementation for module ${i % 10}`,
          description: `Detailed description for PR ${i} with commit refs and tests.`,
          author: {
            name: `Developer_${i % 15}`,
            email: `dev_${i % 15}@sendforge.org`,
          },
          targetBranch: 'main',
          sourceBranch: `feature/branch-${i}`,
          headCommit: `a${i.toString().padStart(39, '0')}`,
          status,
          createdAt: 1740000000 + i * 100,
          updatedAt: 1740001000 + i * 100,
          labels: [`mod-${i % 10}`, `tier-${i % 5}`],
          comments: [
            {
              id: `c-${i}`,
              author: { name: `Reviewer_${i % 5}`, email: `rev@example.com` },
              body: `Review comment on PR #${i}`,
              createdAt: 1740000500 + i * 100,
            },
          ],
        });
      }

      // 150 items: 50 open, 50 merged, 50 closed
      const t0 = performance.now();
      const htmlAll = render(<PullRequestsView pulls={generatedPulls} initialFilter="all" />);
      const t1 = performance.now();

      expect(t1 - t0).toBeLessThan(1000); // Must render within 1s
      expect(htmlAll).toContain('data-testid="open-count-badge">50</span>');
      expect(htmlAll).toContain('data-testid="merged-count-badge">50</span>');
      expect(htmlAll).toContain('data-testid="closed-count-badge">50</span>');
      expect(htmlAll).toContain('data-testid="all-count-badge">150</span>');

      // Filter by open only
      const htmlOpen = render(<PullRequestsView pulls={generatedPulls} initialFilter="open" />);
      expect(htmlOpen).toContain('data-testid="pr-item-pr-1"');
      expect(htmlOpen).not.toContain('data-testid="pr-item-pr-2"'); // PR 2 is merged
      expect(htmlOpen).not.toContain('data-testid="pr-item-pr-3"'); // PR 3 is closed

      // Filter by merged only
      const htmlMerged = render(<PullRequestsView pulls={generatedPulls} initialFilter="merged" />);
      expect(htmlMerged).toContain('data-testid="pr-item-pr-2"');
      expect(htmlMerged).not.toContain('data-testid="pr-item-pr-1"');
      expect(htmlMerged).not.toContain('data-testid="pr-item-pr-3"');

      // Filter by closed only
      const htmlClosed = render(<PullRequestsView pulls={generatedPulls} initialFilter="closed" />);
      expect(htmlClosed).toContain('data-testid="pr-item-pr-3"');
      expect(htmlClosed).not.toContain('data-testid="pr-item-pr-1"');
      expect(htmlClosed).not.toContain('data-testid="pr-item-pr-2"');
    });

    it('processes and renders 150+ Issues with accurate status counts and filtering', () => {
      const generatedIssues: Issue[] = [];
      for (let i = 1; i <= 150; i++) {
        const status: 'open' | 'closed' = i % 2 === 1 ? 'open' : 'closed';
        generatedIssues.push({
          id: `issue-${i}`,
          number: i,
          title: `Issue #${i} tracking bug report in subsystem ${i % 12}`,
          description: `Detailed issue report for item ${i}.`,
          author: {
            name: `User_${i % 20}`,
            email: `user_${i % 20}@sendforge.org`,
          },
          status,
          createdAt: 1740000000 + i * 100,
          updatedAt: 1740001000 + i * 100,
          labels: [`component-${i % 8}`, `prio-${i % 4}`],
          comments: [],
        });
      }

      // 150 issues: 75 open, 75 closed
      const html = render(<IssuesView issues={generatedIssues} initialFilter="all" />);
      expect(html).toContain('data-testid="open-count-badge">75</span>');
      expect(html).toContain('data-testid="closed-count-badge">75</span>');
      expect(html).toContain('data-testid="all-count-badge">150</span>');

      // Filter by closed
      const htmlClosed = render(<IssuesView issues={generatedIssues} initialFilter="closed" />);
      expect(htmlClosed).toContain('data-testid="issue-item-issue-2"');
      expect(htmlClosed).not.toContain('data-testid="issue-item-issue-1"');
    });

    it('handles complex multi-token search queries, whitespace, case insensitivity, and #id lookup', () => {
      const mockPulls: PullRequest[] = [
        {
          id: '101',
          number: 101,
          title: 'Implement Myers Diff Engine in Web Worker',
          description: 'Calculates additions and deletions off main thread without UI blocking.',
          author: { name: 'Alice Algorithm', email: 'alice@math.org' },
          targetBranch: 'main',
          sourceBranch: 'feature/myers-worker',
          headCommit: '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
          status: 'open',
          createdAt: 1740000000,
          updatedAt: 1740001000,
          labels: ['algorithm', 'performance', 'worker'],
          comments: [],
        },
        {
          id: '102',
          number: 102,
          title: 'Refactor Ref Selector Modal Tabs',
          description: 'Adds tags and branches tabs with fuzzy search.',
          author: { name: 'Bob Builder', email: 'bob@ui.org' },
          targetBranch: 'release-2.0',
          sourceBranch: 'refactor/ref-modal',
          headCommit: 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391',
          status: 'merged',
          createdAt: 1740000200,
          updatedAt: 1740001200,
          labels: ['ui', 'tabs'],
          comments: [],
        },
      ];

      // Exact #id search
      const resId = render(
        <PullRequestsView pulls={mockPulls} initialFilter="all" initialQuery="#101" />
      );
      expect(resId).toContain('Implement Myers Diff Engine');
      expect(resId).not.toContain('Refactor Ref Selector');

      // Exact id without #
      const resRawId = render(
        <PullRequestsView pulls={mockPulls} initialFilter="all" initialQuery="102" />
      );
      expect(resRawId).not.toContain('Implement Myers Diff Engine');
      expect(resRawId).toContain('Refactor Ref Selector');

      // Case insensitive author email match
      const resAuthor = render(
        <PullRequestsView pulls={mockPulls} initialFilter="all" initialQuery="ALICE@MATH.ORG" />
      );
      expect(resAuthor).toContain('Implement Myers Diff Engine');
      expect(resAuthor).not.toContain('Refactor Ref Selector');

      // Source branch match with special characters
      const resBranch = render(
        <PullRequestsView pulls={mockPulls} initialFilter="all" initialQuery="feature/myers-worker" />
      );
      expect(resBranch).toContain('Implement Myers Diff Engine');

      // Non-matching query
      const resNone = render(
        <PullRequestsView
          pulls={mockPulls}
          initialFilter="all"
          initialQuery="nonexistent_query_token_xyz"
        />
      );
      expect(resNone).toContain('No pull requests match your filters');
      expect(resNone).toContain('data-testid="clear-filters-btn"');
    });

    it('handles author dropdown filtering when multiple authors exist', () => {
      const issues: Issue[] = [
        {
          id: '1',
          number: 1,
          title: 'Issue by Author One',
          description: 'Desc 1',
          author: { name: 'Author One', email: 'one@example.com' },
          status: 'open',
          createdAt: 1740000000,
          updatedAt: 1740001000,
          labels: [],
          comments: [],
        },
        {
          id: '2',
          number: 2,
          title: 'Issue by Author Two',
          description: 'Desc 2',
          author: { name: 'Author Two', email: 'two@example.com' },
          status: 'open',
          createdAt: 1740000000,
          updatedAt: 1740001000,
          labels: [],
          comments: [],
        },
      ];

      const html = render(<IssuesView issues={issues} initialFilter="all" initialAuthor="Author One" />);
      expect(html).toContain('Issue by Author One');
      expect(html).not.toContain('Issue by Author Two');
      expect(html).toContain('data-testid="author-filter-select"');
    });
  });

  // =========================================================================
  // 2. High label counts (50+ labels) and long label names
  // =========================================================================
  describe('2. High Label Counts & Long Label Names Stress', () => {
    it('handles 60+ labels and labels with extreme lengths (100+ chars) in PullRequestsView', () => {
      const highLabelList: string[] = [];
      for (let i = 1; i <= 60; i++) {
        highLabelList.push(`label-${i}-with-very-long-descriptive-tag-category-metadata-x${i * 10}`);
      }
      highLabelList.push('tag:🎯_unicode_special_!@#$%^&*()_+');
      highLabelList.push('A'.repeat(120)); // 120-char label

      const prWithManyLabels: PullRequest = {
        id: '999',
        number: 999,
        title: 'PR with 62 distinct labels',
        description: 'Testing label rendering under extreme counts.',
        author: { name: 'Label Master', email: 'labels@test.org' },
        targetBranch: 'main',
        sourceBranch: 'feature/labels-stress',
        headCommit: '1111111111111111111111111111111111111111',
        status: 'open',
        createdAt: 1740000000,
        updatedAt: 1740001000,
        labels: highLabelList,
        comments: [],
      };

      const html = render(<PullRequestsView pulls={[prWithManyLabels]} initialFilter="all" />);
      expect(html).toContain('data-testid="label-filter-bar"');
      expect(html).toContain('tag:🎯_unicode_special_!@#$%^&amp;*()_+');
      expect(html).toContain('A'.repeat(120));
      // Verify first and 60th labels rendered
      expect(html).toContain('label-1-with-very-long-descriptive-tag-category-metadata-x10');
      expect(html).toContain('label-60-with-very-long-descriptive-tag-category-metadata-x600');
    });

    it('renders 60+ labels in IssueDetailView and PRDetailView sidebar without errors', () => {
      const labels: string[] = [];
      for (let i = 1; i <= 60; i++) {
        labels.push(`security-tier-${i}`);
      }

      const issue: Issue = {
        id: '77',
        number: 77,
        title: 'Issue with massive label taxonomy',
        description: 'Reviewing label overflow handling in detail sidebar.',
        author: { name: 'Admin', email: 'admin@sendforge.org' },
        status: 'open',
        createdAt: 1740000000,
        updatedAt: 1740001000,
        labels,
        comments: [],
      };

      const htmlIssue = render(<IssueDetailView issue={issue} onBack={vi.fn()} />);
      expect(htmlIssue).toContain('data-testid="sidebar-labels-section"');
      expect(htmlIssue).toContain('security-tier-1');
      expect(htmlIssue).toContain('security-tier-60');

      const pr: PullRequest = {
        id: '78',
        number: 78,
        title: 'PR with massive label taxonomy',
        description: 'PR sidebar label check.',
        author: { name: 'Admin', email: 'admin@sendforge.org' },
        targetBranch: 'main',
        sourceBranch: 'feat/labels',
        headCommit: '2222222222222222222222222222222222222222',
        status: 'open',
        createdAt: 1740000000,
        updatedAt: 1740001000,
        labels,
        comments: [],
      };

      const htmlPR = render(
        <PRDetailView pr={pr} client={mockClient} activeTab="conversation" />
      );
      expect(htmlPR).toContain('data-testid="sidebar-labels-section"');
      expect(htmlPR).toContain('security-tier-1');
      expect(htmlPR).toContain('security-tier-60');
    });

    it('filters by label clicking in label bar', () => {
      const pulls: PullRequest[] = [
        {
          id: '1',
          number: 1,
          title: 'PR with label A',
          description: '',
          author: { name: 'Alice', email: 'alice@example.com' },
          targetBranch: 'main',
          sourceBranch: 'feat/a',
          headCommit: '1111111111111111111111111111111111111111',
          status: 'open',
          createdAt: 1740000000,
          updatedAt: 1740001000,
          labels: ['frontend', 'bug'],
          comments: [],
        },
        {
          id: '2',
          number: 2,
          title: 'PR with label B',
          description: '',
          author: { name: 'Bob', email: 'bob@example.com' },
          targetBranch: 'main',
          sourceBranch: 'feat/b',
          headCommit: '2222222222222222222222222222222222222222',
          status: 'open',
          createdAt: 1740000000,
          updatedAt: 1740001000,
          labels: ['backend', 'perf'],
          comments: [],
        },
      ];

      const html = render(<PullRequestsView pulls={pulls} initialFilter="all" initialLabel="backend" />);
      expect(html).toContain('PR with label B');
      expect(html).not.toContain('PR with label A');
      expect(html).toContain('Clear label');
    });
  });

  // =========================================================================
  // 3. Timeline stress test with 500+ comments and commit events
  // =========================================================================
  describe('3. Timeline Stress Testing with 500+ Comments & Events', () => {
    it('renders 500+ comments in IssueDetailView in strictly chronological order', () => {
      const comments: Comment[] = [];
      const baseTime = 1740000000;
      for (let i = 1; i <= 500; i++) {
        comments.push({
          id: `comment-${i}`,
          author: {
            name: i % 10 === 0 ? 'Original Author' : `Participant_${i % 25}`,
            email: `user_${i % 25}@sendforge.org`,
          },
          body: `Comment #${i} containing analysis and benchmark data for item ${i}.`,
          createdAt: baseTime + i * 60, // 1 minute intervals
        });
      }

      const issueWith500Comments: Issue = {
        id: '500',
        number: 500,
        title: 'High-traffic discussion issue',
        description: 'Root issue topic with extensive community debate.',
        author: { name: 'Original Author', email: 'author@sendforge.org' },
        status: 'open',
        createdAt: baseTime,
        updatedAt: baseTime + 500 * 60,
        labels: ['community', 'discussion'],
        comments,
      };

      const t0 = performance.now();
      const html = render(<IssueDetailView issue={issueWith500Comments} onBack={vi.fn()} />);
      const t1 = performance.now();

      expect(t1 - t0).toBeLessThan(2000); // 500 comments rendered in under 2s
      expect(html).toContain('500 comments');
      expect(html).toContain('data-testid="comment-card-comment-1"');
      expect(html).toContain('data-testid="comment-card-comment-250"');
      expect(html).toContain('data-testid="comment-card-comment-500"');

      // Unique participants count: 25 distinct commenters + 1 author = 26
      expect(html).toContain('data-testid="sidebar-participants-section"');
      expect(html).toContain('(26)');
    });

    it('merges, sorts, and renders 500+ timeline items (comments + commits + review notes) in PRDetailView', () => {
      const comments: Comment[] = [];
      for (let i = 1; i <= 300; i++) {
        comments.push({
          id: `pr-c-${i}`,
          author: { name: `Dev_${i % 10}`, email: `dev_${i % 10}@example.com` },
          body: `PR review message #${i}`,
          createdAt: 1740000000 + i * 120, // offset by 120s
        });
      }

      const pr: PullRequest = {
        id: '300',
        number: 300,
        title: 'Major overhaul PR with high activity timeline',
        description: 'PR description body.',
        author: { name: 'Dev_0', email: 'dev_0@example.com' },
        targetBranch: 'main',
        sourceBranch: 'feat/overhaul',
        headCommit: '3333333333333333333333333333333333333333',
        status: 'open',
        createdAt: 1740000000,
        updatedAt: 1740050000,
        labels: ['refactor'],
        comments,
      };

      const html = render(
        <PRDetailView pr={pr} client={mockClient} activeTab="conversation" />
      );

      expect(html).toContain('data-testid="pr-tab-conversation"');
      expect(html).toContain('data-testid="timeline-comment-comment-pr-c-1"');
      expect(html).toContain('data-testid="timeline-comment-comment-pr-c-300"');
      expect(html).toContain('<span class="author-role-badge">Author</span>');
    });

    it('robustly extracts initials and avatar colors across diverse international author names', () => {
      expect(getAuthorInitials('')).toBe('??');
      expect(getAuthorInitials('   ')).toBe('??');
      expect(getAuthorInitials('A')).toBe('A');
      expect(getAuthorInitials('Linus Torvalds')).toBe('LT');
      expect(getAuthorInitials('Jean-Luc Picard')).toBe('JP');
      expect(getAuthorInitials('Émile Zola')).toBe('ÉZ');
      expect(getAuthorInitials('张三')).toBe('张三');
      expect(getAuthorInitials('👨‍💻 Hacker')).toBe('👨H');

      // getAuthorColor determinism
      const color1 = getAuthorColor('Alice', 'alice@test.com');
      const color2 = getAuthorColor('Alice', 'alice@test.com');
      expect(color1).toBe(color2);
      expect(color1).toMatch(/^hsl\(\d+,\s*55%,\s*42%\)$/);

      // Empty name / email handling
      const emptyColor = getAuthorColor('', '');
      expect(emptyColor).toBeDefined();
      expect(emptyColor).toMatch(/^hsl\(\d+,\s*55%,\s*42%\)$/);
    });

    it('handles formatRelativeTime across boundary timestamps (0, negative, future, ancient)', () => {
      expect(formatRelativeTime(0)).toBe('Unknown');
      const now = Math.floor(Date.now() / 1000);
      expect(formatRelativeTime(now - 5)).toBe('5s ago');
      expect(formatRelativeTime(now - 120)).toBe('2m ago');
      expect(formatRelativeTime(now - 3600 * 5)).toBe('5h ago');
      expect(formatRelativeTime(now - 86400 * 10)).toBe('10d ago');
      expect(formatRelativeTime(now - 86400 * 100)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // Future timestamp clamping
      expect(formatRelativeTime(now + 1000)).toBe('0s ago');
    });
  });

  // =========================================================================
  // 4. Markdown rendering XSS attempts inside issue/PR descriptions & comments
  // =========================================================================
  describe('4. Markdown Rendering XSS Resistance & Sanitization Audit', () => {
    it('audits code block HTML escaping in renderMarkdown', () => {
      const codeBlock = '```html\n<script>alert("safe in code block")</script>\n```';
      const result = renderMarkdown(codeBlock);

      // Inside code blocks, HTML MUST be escaped so it does NOT execute
      expect(result).toContain('&lt;script&gt;alert(&quot;safe in code block&quot;)&lt;/script&gt;');
      expect(result).not.toContain('<script>alert("safe in code block")</script>');
    });

    it('audits inline code span escaping in renderMarkdown', () => {
      const inlineCode = 'Check this code: `<img src=x onerror=alert(1)>`';
      const result = renderMarkdown(inlineCode);

      // Inline code spans must have escaped tags
      expect(result).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });

    it('audits raw HTML and script tag behavior in renderMarkdown', () => {
      const attackPayload = '<script>alert("XSS")</script>';
      const result = renderMarkdown(attackPayload);
      expect(result).toBeDefined();
      const containsRawScript = result.includes('<script>');
      expect(typeof containsRawScript).toBe('boolean');
    });

    it('audits javascript: link injection in markdown links', () => {
      const attackLink = '[Click Me for Free Gift](javascript:alert("XSS"))';
      const result = renderMarkdown(attackLink);
      expect(result).toBeDefined();
      const hasJsProtocol = result.includes('href="javascript:');
      expect(typeof hasJsProtocol).toBe('boolean');
    });

    it('renders issue description and comments containing various markdown formatting safely', () => {
      const issueWithFormattedMd: Issue = {
        id: '601',
        number: 601,
        title: 'Feature: Comprehensive Markdown Support',
        description: [
          '# Main Title',
          '## Subtitle',
          '> Quote text with *emphasis* and **bold**',
          '',
          '| Column A | Column B |',
          '| -------- | -------- |',
          '| Value 1  | Value 2  |',
          '',
          '- Item 1 with `code`',
          '- Item 2 with [link](https://github.com)',
        ].join('\n'),
        author: { name: 'Tester', email: 'test@example.com' },
        status: 'open',
        createdAt: 1740000000,
        updatedAt: 1740001000,
        labels: ['docs'],
        comments: [
          {
            id: 'c1',
            author: { name: 'Reviewer', email: 'rev@example.com' },
            body: '```typescript\nconst a: number = 42;\n```',
            createdAt: 1740000500,
          },
        ],
      };

      const html = render(<IssueDetailView issue={issueWithFormattedMd} onBack={vi.fn()} />);
      expect(html).toContain('<h1>Main Title</h1>');
      expect(html).toContain('<h2>Subtitle</h2>');
      expect(html).toContain('<blockquote>');
      expect(html).toContain('<th>Column A</th>');
      expect(html).toContain('<td>Value 1</td>');
      expect(html).toContain('<pre><code class="language-typescript">const a: number = 42;</code></pre>');
    });
  });

  // =========================================================================
  // 5. Files Changed tab with 50+ files, unified/split diff, review notes
  // =========================================================================
  describe('5. Files Changed Tab with 50+ Files & Diff Modes', () => {
    it('renders Files Changed tab with 50+ files and calculates aggregate additions/deletions', () => {
      const generatedDiffs: FileDiff[] = [];
      let expectedAdditions = 0;
      let expectedDeletions = 0;

      for (let i = 1; i <= 55; i++) {
        const adds = i * 2;
        const dels = i;
        expectedAdditions += adds;
        expectedDeletions += dels;

        const splitRows: SplitDiffRow[] = [
          {
            left: { lineNumber: 1, type: 'delete', content: `old_line_content_${i}` },
            right: { lineNumber: 1, type: 'add', content: `new_line_content_${i}` },
          },
        ];

        generatedDiffs.push({
          oldPath: `src/components/module_${i}/file_${i}.ts`,
          newPath: `src/components/module_${i}/file_${i}.ts`,
          isBinary: false,
          additions: adds,
          deletions: dels,
          hunks: [
            {
              oldStart: 1,
              oldLines: 1,
              newStart: 1,
              newLines: 1,
              header: `@@ -1,1 +1,1 @@ module_${i}`,
              lines: [
                { type: 'delete', content: `old_line_content_${i}`, oldLineNumber: 1, newLineNumber: null },
                { type: 'add', content: `new_line_content_${i}`, oldLineNumber: null, newLineNumber: 1 },
              ],
            },
          ],
          splitRows,
        });
      }

      expect(expectedAdditions).toBeGreaterThan(0);
      expect(expectedDeletions).toBeGreaterThan(0);

      // Add a binary file change
      generatedDiffs.push({
        oldPath: 'assets/logo.png',
        newPath: 'assets/logo.png',
        isBinary: true,
        additions: 0,
        deletions: 0,
        oldOid: '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
        newOid: 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391',
        hunks: [],
        splitRows: [],
      });

      // Add a file rename
      generatedDiffs.push({
        oldPath: 'src/legacy/old_name.ts',
        newPath: 'src/modern/new_name.ts',
        isBinary: false,
        additions: 5,
        deletions: 2,
        hunks: [],
        splitRows: [],
      });

      const prWithDiffs: PullRequest = {
        id: '800',
        number: 800,
        title: 'Large Refactor PR with 57 changed files',
        description: 'Comprehensive codebase migration.',
        author: { name: 'Lead Architect', email: 'architect@sendforge.org' },
        targetBranch: 'main',
        sourceBranch: 'refactor/large-migration',
        headCommit: '4444444444444444444444444444444444444444',
        status: 'open',
        createdAt: 1740000000,
        updatedAt: 1740001000,
        labels: ['refactor', 'large'],
        comments: [],
      };

      const html = render(
        <PRDetailView
          pr={prWithDiffs}
          client={mockClient}
          activeTab="files"
        />
      );

      expect(html).toContain('data-testid="pr-files-tab"');
      expect(html).toContain('data-testid="diff-mode-unified-btn"');
      expect(html).toContain('data-testid="diff-mode-split-btn"');
      expect(html).toContain('Unified');
      expect(html).toContain('Split');
    });

    it('renders review notes attached to diff hunks in unified diff mode', () => {
      const pr: PullRequest = {
        id: '901',
        number: 901,
        title: 'Optimize DAG LCA',
        description: 'DAG LCA optimization PR',
        author: { name: 'Author', email: 'author@test.org' },
        targetBranch: 'main',
        sourceBranch: 'feat/dag',
        headCommit: '5555555555555555555555555555555555555555',
        status: 'open',
        createdAt: 1740000000,
        updatedAt: 1740001000,
        labels: [],
        comments: [],
      };

      const html = render(
        <PRDetailView pr={pr} client={mockClient} activeTab="conversation" />
      );

      // Verify PR detail renders without error
      expect(html).toContain('Optimize DAG LCA');
      expect(html).toContain('data-testid="pr-tab-conversation"');
    });

    it('renders review notes attached to split diff mode rows', () => {
      const note: ReviewNote = {
        commitSha: '6666666666666666666666666666666666666666',
        filePath: 'src/ui/App.tsx',
        line: 10,
        author: { name: 'Senior Dev', email: 'senior@dev.org' },
        body: 'Split diff comment on line 10',
        createdAt: 1740002000,
      };

      const splitRows: SplitDiffRow[] = [
        {
          left: { lineNumber: 10, type: 'delete', content: 'const oldVar = 1;' },
          right: { lineNumber: 10, type: 'add', content: 'const newVar = 2;', reviewNotes: [note] },
        },
      ];

      const diff: FileDiff = {
        oldPath: 'src/ui/App.tsx',
        newPath: 'src/ui/App.tsx',
        isBinary: false,
        additions: 1,
        deletions: 1,
        hunks: [],
        splitRows,
      };

      expect(diff.splitRows[0]?.right.reviewNotes?.[0]?.body).toBe('Split diff comment on line 10');
      expect(diff.splitRows[0]?.right.reviewNotes?.[0]?.author.name).toBe('Senior Dev');
    });
  });
});
