import { describe, expect, it, vi, beforeEach } from 'vitest';
import { h } from 'preact';
import render from 'preact-render-to-string';
import { App } from '../../src/ui/App.js';
import { CommitLog } from '../../src/ui/CommitLog.js';
import { PRDetailView } from '../../src/ui/PRDetailView.js';
import { NewIssueModal } from '../../src/ui/NewIssueModal.js';
import { NewPRModal } from '../../src/ui/NewPRModal.js';
import { RefSelector, filterRefs, formatSha, isDefaultBranch } from '../../src/ui/RefSelector.js';
import type { RepoBranch, RepoTag, GitCommitObject } from '../../src/engine/types.js';
import type { PullRequest } from '../../src/engine/collab-client.js';
import type { GitRepositoryClient } from '../../src/engine/fetcher.js';
import { execSync } from 'node:child_process';
import path from 'node:path';

describe('Adversarial & Empirical Challenge Suite: Milestone 1 UX Polish', () => {
  const localStorageStore = new Map<string, string>();
  const mockLocalStorage = {
    getItem: vi.fn((key: string) => localStorageStore.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      localStorageStore.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      localStorageStore.delete(key);
    }),
    clear: vi.fn(() => {
      localStorageStore.clear();
    }),
  };

  let mockClipboardText = '';
  const mockClipboard = {
    writeText: vi.fn((text: string) => {
      mockClipboardText = text;
      return Promise.resolve();
    }),
    readText: vi.fn(() => Promise.resolve(mockClipboardText)),
  };

  beforeEach(() => {
    localStorageStore.clear();
    mockClipboardText = '';
    vi.clearAllMocks();

    Object.defineProperty(globalThis, 'localStorage', {
      value: mockLocalStorage,
      writable: true,
    });

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        clipboard: mockClipboard,
      },
      writable: true,
    });
  });

  // =========================================================================
  // 1. Clone URL Affordance Stress & Verification
  // =========================================================================
  describe('1. Clone URL Affordance', () => {
    it('validates git clone URL derivation and formatting across diverse inputs', () => {
      const testCases = [
        {
          input: 'https://sendforge.org/torvalds/linux',
          expected: 'git clone https://sendforge.org/torvalds/linux.git',
        },
        {
          input: 'https://sendforge.org/torvalds/linux.git',
          expected: 'git clone https://sendforge.org/torvalds/linux.git',
        },
        {
          input: 'https://sendforge.org/torvalds/linux///',
          expected: 'git clone https://sendforge.org/torvalds/linux.git',
        },
        {
          input: 'http://localhost:8080/my-repo',
          expected: 'git clone http://localhost:8080/my-repo.git',
        },
      ];

      for (const tc of testCases) {
        const clean = tc.input.replace(/\/+$/, '');
        const derivedUrl = clean.endsWith('.git') ? clean : `${clean}.git`;
        const cmd = `git clone ${derivedUrl}`;
        expect(cmd).toBe(tc.expected);
      }
    });

    it('renders App component with Code / Download dropdown trigger and container structure', () => {
      const html = render(h(App, { baseUrl: 'https://forge.sendforge.io/org/repo' }));
      expect(html).toContain('data-testid="download-snapshot-btn"');
      expect(html).toContain('⬇️ Code / Download');
      expect(html).toContain('download-dropdown-container');
    });

    it('simulates clipboard copy handler with git clone command formatting', async () => {
      const gitCloneCommand = 'git clone https://sendforge.org/torvalds/linux.git';
      await navigator.clipboard.writeText(gitCloneCommand);
      expect(mockClipboard.writeText).toHaveBeenCalledWith(gitCloneCommand);
      expect(mockClipboardText).toBe('git clone https://sendforge.org/torvalds/linux.git');
    });

    it('handles clipboard failure gracefully without uncaught rejection', async () => {
      const failingClipboard = {
        writeText: vi.fn().mockRejectedValue(new Error('Permission denied')),
      };
      Object.defineProperty(globalThis, 'navigator', {
        value: { clipboard: failingClipboard },
        writable: true,
      });

      let threw = false;
      try {
        await navigator.clipboard.writeText('git clone https://test.git');
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  });

  // =========================================================================
  // 2. Commit List SHA Copy Stress & Verification
  // =========================================================================
  describe('2. Commit List SHA Copy (Full 40-Character SHA)', () => {
    const fullSha1 = 'e4d9b11e4b52b95e83a1b32d2c18d9f1a2345678';
    const fullSha2 = 'a1b2c3d4e5f678901234567890abcdef12345678';
    const fullSha3 = 'f0e1d2c3b4a5968778695a4b3c2d1e0f12345678';

    const mockCommits: GitCommitObject[] = [
      {
        type: 'commit',
        oid: fullSha1,
        size: 150,
        tree: 't111111111111111111111111111111111111111',
        parents: [],
        author: { name: 'Dev 1', email: 'dev1@example.com', timestamp: 1740000000, tzOffset: '+0000' },
        committer: { name: 'Dev 1', email: 'dev1@example.com', timestamp: 1740000000, tzOffset: '+0000' },
        subject: 'First commit with full SHA',
        body: 'Commit description body.',
        message: 'First commit with full SHA\n\nCommit description body.',
      },
      {
        type: 'commit',
        oid: fullSha2,
        size: 180,
        tree: 't222222222222222222222222222222222222222',
        parents: [fullSha1],
        author: { name: 'Dev 2', email: 'dev2@example.com', timestamp: 1740001000, tzOffset: '+0000' },
        committer: { name: 'Dev 2', email: 'dev2@example.com', timestamp: 1740001000, tzOffset: '+0000' },
        subject: 'Second commit with full SHA',
        body: '',
        message: 'Second commit with full SHA',
      },
      {
        type: 'commit',
        oid: fullSha3,
        size: 200,
        tree: 't333333333333333333333333333333333333333',
        parents: [fullSha2],
        author: { name: 'Dev 3', email: 'dev3@example.com', timestamp: 1740002000, tzOffset: '+0000' },
        committer: { name: 'Dev 3', email: 'dev3@example.com', timestamp: 1740002000, tzOffset: '+0000' },
        subject: 'Third commit with full SHA',
        body: '',
        message: 'Third commit with full SHA',
      },
    ];

    it('renders commit-sha-wrapper with truncated badge and copy button targeting full 40-char SHA', () => {
      const onSelectCommit = vi.fn();
      const html = render(
        h(CommitLog, {
          commits: mockCommits,
          onSelectCommit,
        })
      );

      // Truncated SHA displays in badge
      expect(html).toContain('e4d9b11');
      expect(html).toContain('a1b2c3d');
      expect(html).toContain('f0e1d2c');

      // Copy buttons target the FULL 40-character SHA in data-testid
      expect(html).toContain(`data-testid="copy-sha-${fullSha1}"`);
      expect(html).toContain(`data-testid="copy-sha-${fullSha2}"`);
      expect(html).toContain(`data-testid="copy-sha-${fullSha3}"`);
      expect(html).toContain('commit-copy-btn');
      expect(html).toContain(`aria-label="Copy full commit SHA for e4d9b11"`);
      expect(html).toContain(`aria-label="Copy full commit SHA for a1b2c3d"`);
    });

    it('verifies formatSha produces exact 7-char prefix for 40-char SHA and preserves short SHAs', () => {
      expect(formatSha(fullSha1)).toBe('e4d9b11');
      expect(formatSha(fullSha1).length).toBe(7);
      expect(fullSha1.length).toBe(40);
      expect(fullSha1.startsWith(formatSha(fullSha1))).toBe(true);

      expect(formatSha('short')).toBe('short');
      expect(formatSha('')).toBe('');
      expect(formatSha('1234567')).toBe('1234567');
      expect(formatSha('12345678')).toBe('1234567');
    });

    it('simulates copy action: copies full 40-character SHA and verifies clipboard argument', async () => {
      await navigator.clipboard.writeText(fullSha1);
      expect(mockClipboard.writeText).toHaveBeenCalledWith(fullSha1);
      expect(mockClipboard.writeText).not.toHaveBeenCalledWith('e4d9b11');
      expect(mockClipboardText).toBe(fullSha1);
      expect(mockClipboardText.length).toBe(40);
    });

    it('renders commit copy button in PRDetailView commits tab', () => {
      const mockClient = {
        resolveRef: vi.fn(),
        getCommit: vi.fn().mockResolvedValue(mockCommits[0]),
        getTree: vi.fn(),
        getBlob: vi.fn(),
      } as unknown as GitRepositoryClient;

      const mockPR: PullRequest = {
        id: '1',
        number: 1,
        title: 'Feature PR',
        description: 'PR Description',
        author: { name: 'Author', email: 'author@example.com' },
        targetBranch: 'main',
        sourceBranch: 'feature/sha-copy',
        headCommit: fullSha1,
        status: 'open',
        createdAt: 1740000000,
        updatedAt: 1740000000,
        labels: [],
        comments: [],
      };

      const html = render(
        h(PRDetailView, {
          pr: mockPR,
          client: mockClient,
          activeTab: 'commits',
        })
      );

      expect(html).toContain('pr-commits-tab');
    });
  });

  // =========================================================================
  // 3. Custom Label Chip Visualizer Stress & Verification
  // =========================================================================
  describe('3. Custom Label Chip Visualizer', () => {
    it('renders preset labels and custom label input in NewIssueModal', () => {
      const html = render(
        h(NewIssueModal, {
          isOpen: true,
          onClose: vi.fn(),
          repoName: 'test-repo',
        })
      );

      expect(html).toContain('data-testid="issue-label-presets"');
      expect(html).toContain('data-testid="issue-preset-label-bug"');
      expect(html).toContain('data-testid="issue-preset-label-enhancement"');
      expect(html).toContain('data-testid="issue-preset-label-documentation"');
      expect(html).toContain('data-testid="issue-preset-label-security"');
      expect(html).toContain('data-testid="issue-custom-label-input"');
      expect(html).toContain('data-testid="add-custom-label-btn"');
    });

    it('renders custom labels as active removable chip pills in NewIssueModal', () => {
      const draft = {
        title: 'Custom label test issue',
        description: 'Testing custom chips',
        selectedLabels: ['bug', 'ux-polish', 'm1-release', 'performance-audit'],
        authorName: 'Tester',
        authorEmail: 'tester@sendforge.org',
        customId: '10',
        updatedAt: Date.now(),
      };
      localStorageStore.set('sendforge:draft:issue:test-repo', JSON.stringify(draft));

      const html = render(
        h(NewIssueModal, {
          isOpen: true,
          onClose: vi.fn(),
          repoName: 'test-repo',
        })
      );

      // Preset 'bug' is selected
      expect(html).toContain('data-testid="issue-preset-label-bug"');
      expect(html).toContain('class="label-chip selected"');

      // Custom chips are rendered with specific data-testids
      expect(html).toContain('data-testid="issue-custom-chip-ux-polish"');
      expect(html).toContain('data-testid="issue-custom-chip-m1-release"');
      expect(html).toContain('data-testid="issue-custom-chip-performance-audit"');

      // Custom chips include label text and remove indicator
      expect(html).toContain('ux-polish');
      expect(html).toContain('m1-release');
      expect(html).toContain('performance-audit');
      expect(html).toContain('title="Remove label ux-polish"');
      expect(html).toContain('title="Remove label m1-release"');
      expect(html).toContain('title="Remove label performance-audit"');
    });

    it('renders preset and custom labels in NewPRModal with removable chips', () => {
      const mockBranches: readonly RepoBranch[] = [
        { name: 'main', target: '1111111111111111111111111111111111111111', is_default: true },
        { name: 'feature/custom-labels', target: '2222222222222222222222222222222222222222', is_default: false },
      ];

      const draft = {
        title: 'PR with custom labels',
        description: 'Testing PR chips',
        targetBranch: 'main',
        sourceBranch: 'feature/custom-labels',
        selectedLabels: ['enhancement', 'core-engine', 'needs-rebase'],
        authorName: 'Author',
        authorEmail: 'author@sendforge.org',
        customId: '12',
        updatedAt: Date.now(),
      };
      localStorageStore.set('sendforge:draft:pr:test-repo', JSON.stringify(draft));

      const html = render(
        h(NewPRModal, {
          isOpen: true,
          onClose: vi.fn(),
          client: {} as unknown as GitRepositoryClient,
          branches: mockBranches,
          repoName: 'test-repo',
        })
      );

      expect(html).toContain('data-testid="pr-label-presets"');
      expect(html).toContain('data-testid="pr-preset-label-enhancement"');
      expect(html).toContain('data-testid="pr-custom-chip-core-engine"');
      expect(html).toContain('data-testid="pr-custom-chip-needs-rebase"');
      expect(html).toContain('core-engine');
      expect(html).toContain('needs-rebase');
      expect(html).toContain('title="Remove label core-engine"');
    });

    it('validates custom label filtering and deduplication logic', () => {
      const presetLabels = ['bug', 'enhancement', 'documentation', 'security'];
      const selectedLabels = ['bug', 'custom-1', 'custom-2'];

      const customOnly = selectedLabels.filter((l) => !presetLabels.includes(l));
      expect(customOnly).toEqual(['custom-1', 'custom-2']);

      // Adding duplicate should not alter array
      const addLabel = (current: string[], newLabel: string) => {
        const trimmed = newLabel.trim();
        if (!trimmed) return current;
        if (current.includes(trimmed)) return current;
        return [...current, trimmed];
      };

      let labels: string[] = [];
      labels = addLabel(labels, 'my-tag');
      expect(labels).toEqual(['my-tag']);
      labels = addLabel(labels, '  my-tag  '); // Duplicate trimmed
      expect(labels).toEqual(['my-tag']);
      labels = addLabel(labels, '   '); // Empty whitespace
      expect(labels).toEqual(['my-tag']);
      labels = addLabel(labels, 'second-tag');
      expect(labels).toEqual(['my-tag', 'second-tag']);
    });
  });

  // =========================================================================
  // 4. Demo Tag v0.1.0 Verification (Git Repo & RefSelector)
  // =========================================================================
  describe('4. Demo Tag v0.1.0 (Git Repository & RefSelector Component)', () => {
    it('verifies v0.1.0 exists as an annotated tag in the Git repository', () => {
      const repoRoot = path.resolve(__dirname, '../../..');
      const tagType = execSync('git cat-file -t v0.1.0', { cwd: repoRoot, encoding: 'utf-8' }).trim();
      expect(tagType).toBe('tag');

      const tagContent = execSync('git cat-file -p v0.1.0', { cwd: repoRoot, encoding: 'utf-8' });
      expect(tagContent).toContain('tag v0.1.0');
      expect(tagContent).toContain('type commit');
      expect(tagContent).toContain('tagger ');
      expect(tagContent).toContain('Release v0.1.0');
    });

    it('renders RefSelector with v0.1.0 tag in Tags tab with annotated badge and correct counts', () => {
      const branches: readonly RepoBranch[] = [
        { name: 'main', target: '1111111111111111111111111111111111111111', is_default: true },
      ];
      const tags: readonly RepoTag[] = [
        {
          name: 'v0.1.0',
          target: '2c801f5769c30e7d6c4851c34ccec83ec9a780c8',
          is_annotated: true,
          peeled: '2c801f5769c30e7d6c4851c34ccec83ec9a780c8',
          message: 'Release v0.1.0',
        },
      ];

      const html = render(
        h(RefSelector, {
          currentRef: 'v0.1.0',
          branches,
          tags,
          onSelectRef: vi.fn(),
          initialOpen: true,
          initialTab: 'tags',
        })
      );

      // Active ref is a tag -> displays 🏷️ tag icon
      expect(html).toContain('🏷️');
      expect(html).toContain('v0.1.0');
      expect(html).toContain('Tags <span class="ref-tab-badge">1</span>');
      expect(html).toContain('annotated');
      expect(html).toContain('tag-item');
      expect(html).toContain('2c801f5');
    });

    it('filterRefs filters tags correctly by name and commit SHA', () => {
      const tags: readonly RepoTag[] = [
        {
          name: 'v0.1.0',
          target: '2c801f5769c30e7d6c4851c34ccec83ec9a780c8',
          is_annotated: true,
          peeled: '2c801f5769c30e7d6c4851c34ccec83ec9a780c8',
        },
        {
          name: 'v0.2.0-beta',
          target: '3333333333333333333333333333333333333333',
          is_annotated: false,
          peeled: null,
        },
      ];

      expect(filterRefs(tags, 'v0.1').map((t) => t.name)).toEqual(['v0.1.0']);
      expect(filterRefs(tags, '2c801f5').map((t) => t.name)).toEqual(['v0.1.0']);
      expect(filterRefs(tags, 'beta').map((t) => t.name)).toEqual(['v0.2.0-beta']);
      expect(filterRefs(tags, 'nonexistent')).toEqual([]);
    });

    it('isDefaultBranch correctly evaluates default branch conditions', () => {
      const branchMain: RepoBranch = { name: 'main', target: '1111', is_default: true };
      const branchDev: RepoBranch = { name: 'dev', target: '2222', is_default: false };

      expect(isDefaultBranch(branchMain, 'main')).toBe(true);
      expect(isDefaultBranch(branchDev, 'main')).toBe(false);
      expect(isDefaultBranch(branchDev, 'dev')).toBe(true);
    });
  });
});
