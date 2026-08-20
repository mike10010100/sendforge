import { describe, it, expect, vi, beforeEach } from 'vitest';
import { h } from 'preact';
import render from 'preact-render-to-string';
import { NewIssueModal } from '../src/ui/NewIssueModal.js';
import { NewPRModal } from '../src/ui/NewPRModal.js';
import { IssuesView } from '../src/ui/IssuesView.js';
import { PullRequestsView } from '../src/ui/PullRequestsView.js';
import type { GitRepositoryClient } from '../src/engine/fetcher.js';
import type { RepoBranch, GitCommitObject } from '../src/engine/types.js';
import type { Issue } from '../src/engine/collab-client.js';

describe('Collaboration Modals & Views Suite (modals.test.ts)', () => {
  // Mock localStorage
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

  beforeEach(() => {
    localStorageStore.clear();
    vi.clearAllMocks();
    Object.defineProperty(globalThis, 'localStorage', {
      value: mockLocalStorage,
      writable: true,
    });
  });

  describe('1. NewIssueModal Component (NewIssueModal.tsx)', () => {
    const mockExistingIssues: readonly Issue[] = [
      {
        id: '1',
        number: 1,
        title: 'Issue 1',
        description: 'Desc 1',
        author: { name: 'Alice', email: 'alice@example.com' },
        status: 'open',
        createdAt: 1740000000,
        updatedAt: 1740000000,
        labels: ['bug'],
        comments: [],
      },
      {
        id: '2',
        number: 2,
        title: 'Issue 2',
        description: 'Desc 2',
        author: { name: 'Bob', email: 'bob@example.com' },
        status: 'closed',
        createdAt: 1740001000,
        updatedAt: 1740001000,
        labels: ['enhancement'],
        comments: [],
      },
    ];

    it('returns null when isOpen={false}', () => {
      const html = render(
        h(NewIssueModal, {
          isOpen: false,
          onClose: vi.fn(),
          repoName: 'test-repo',
        })
      );
      expect(html).toBe('');
    });

    it('renders modal dialog with form elements when isOpen={true}', () => {
      const html = render(
        h(NewIssueModal, {
          isOpen: true,
          onClose: vi.fn(),
          repoName: 'test-repo',
          existingIssues: mockExistingIssues,
        })
      );

      expect(html).toContain('data-testid="new-issue-modal"');
      expect(html).toContain('New Issue');
      expect(html).toContain('#3'); // Next calculated issue number (max 2 + 1 = 3)
      expect(html).toContain('data-testid="new-issue-title-input"');
      expect(html).toContain('data-testid="new-issue-description-input"');
      expect(html).toContain('data-testid="issue-label-presets"');
      expect(html).toContain('data-testid="issue-git-push-command"');
      expect(html).toContain('git push origin HEAD:refs/issues/3');
      expect(html).toContain('data-testid="submit-issue-btn"');
    });

    it('renders preset label chips and custom label input', () => {
      const html = render(
        h(NewIssueModal, {
          isOpen: true,
          onClose: vi.fn(),
          repoName: 'test-repo',
        })
      );

      expect(html).toContain('data-testid="issue-preset-label-bug"');
      expect(html).toContain('data-testid="issue-preset-label-enhancement"');
      expect(html).toContain('data-testid="issue-preset-label-documentation"');
      expect(html).toContain('data-testid="issue-preset-label-security"');
      expect(html).toContain('data-testid="issue-custom-label-input"');
      expect(html).toContain('data-testid="add-custom-label-btn"');
    });

    it('generates correct git push origin HEAD:refs/issues/<id> command', () => {
      const html = render(
        h(NewIssueModal, {
          isOpen: true,
          onClose: vi.fn(),
          repoName: 'my-repo',
          existingIssues: mockExistingIssues,
        })
      );

      expect(html).toContain('git push origin HEAD:refs/issues/3');
      expect(html).toContain('data-testid="copy-issue-command-btn"');
    });

    it('restores draft from localStorage when available', () => {
      const draft = {
        title: 'Drafted issue title',
        description: 'Drafted markdown description with **bold**',
        selectedLabels: ['bug', 'performance'],
        authorName: 'Draft Author',
        authorEmail: 'draft@example.com',
        customId: '42',
        updatedAt: Date.now(),
      };
      localStorageStore.set('sendforge:draft:issue:test-repo', JSON.stringify(draft));

      const html = render(
        h(NewIssueModal, {
          isOpen: true,
          onClose: vi.fn(),
          repoName: 'test-repo',
          existingIssues: mockExistingIssues,
        })
      );

      expect(html).toContain('value="Drafted issue title"');
      expect(html).toContain('value="Draft Author"');
      expect(html).toContain('value="draft@example.com"');
      expect(html).toContain('value="42"');
    });

    it('handles corrupted draft JSON in localStorage gracefully', () => {
      localStorageStore.set('sendforge:draft:issue:test-repo', '{invalid-json');

      const html = render(
        h(NewIssueModal, {
          isOpen: true,
          onClose: vi.fn(),
          repoName: 'test-repo',
          existingIssues: mockExistingIssues,
        })
      );

      expect(html).toContain('data-testid="new-issue-modal"');
      expect(html).toContain('#3');
    });

    it('renders modal with empty existing issues defaulting to #1', () => {
      const html = render(
        h(NewIssueModal, {
          isOpen: true,
          onClose: vi.fn(),
          repoName: 'new-repo',
          existingIssues: [],
        })
      );

      expect(html).toContain('#1');
      expect(html).toContain('git push origin HEAD:refs/issues/1');
    });
  });

  describe('2. NewPRModal Component (NewPRModal.tsx)', () => {
    const mockBranches: readonly RepoBranch[] = [
      { name: 'main', target: '1111111111111111111111111111111111111111', is_default: true },
      { name: 'feature/patch-engine', target: '2222222222222222222222222222222222222222', is_default: false },
    ];

    const mockCommit: GitCommitObject = {
      type: 'commit',
      oid: '2222222222222222222222222222222222222222',
      size: 100,
      tree: 't111111111111111111111111111111111111111',
      parents: ['1111111111111111111111111111111111111111'],
      author: { name: 'Alice Chen', email: 'alice@example.com', timestamp: 1740000000, tzOffset: '+0000' },
      committer: { name: 'Alice Chen', email: 'alice@example.com', timestamp: 1740000000, tzOffset: '+0000' },
      subject: 'Implement format-patch export',
      body: 'Enables RFC 2822 patch export in modal.',
      message: 'Implement format-patch export\n\nEnables RFC 2822 patch export in modal.',
    };

    const mockClient = {
      resolveRef: vi.fn((ref: string) => {
        if (ref === 'main') return Promise.resolve('1111111111111111111111111111111111111111');
        return Promise.resolve('2222222222222222222222222222222222222222');
      }),
      getCommit: vi.fn().mockResolvedValue(mockCommit),
      getTree: vi.fn().mockResolvedValue({ type: 'tree', oid: 'tree1', entries: [] }),
      getBlob: vi.fn(),
    } as unknown as GitRepositoryClient;

    it('returns null when isOpen={false}', () => {
      const html = render(
        h(NewPRModal, {
          isOpen: false,
          onClose: vi.fn(),
          client: mockClient,
          branches: mockBranches,
        })
      );
      expect(html).toBe('');
    });

    it('renders PR modal with branch comparison dropdowns when isOpen={true}', () => {
      const html = render(
        h(NewPRModal, {
          isOpen: true,
          onClose: vi.fn(),
          client: mockClient,
          branches: mockBranches,
          defaultBranch: 'main',
          repoName: 'test-repo',
        })
      );

      expect(html).toContain('data-testid="new-pr-modal"');
      expect(html).toContain('New Pull Request');
      expect(html).toContain('data-testid="pr-branch-compare-bar"');
      expect(html).toContain('data-testid="pr-target-branch-select"');
      expect(html).toContain('data-testid="pr-source-branch-select"');
      expect(html).toContain('data-testid="new-pr-title-input"');
      expect(html).toContain('data-testid="new-pr-description-input"');
      expect(html).toContain('data-testid="pr-push-generator-box"');
      expect(html).toContain('git push origin feature/patch-engine:refs/pull/1/head');
      expect(html).toContain('data-testid="download-patch-btn"');
      expect(html).toContain('data-testid="download-pr-json-btn"');
      expect(html).toContain('data-testid="submit-pr-btn"');
    });

    it('restores PR draft from localStorage when available', () => {
      const draft = {
        title: 'Drafted PR title',
        description: 'Drafted PR description',
        targetBranch: 'main',
        sourceBranch: 'feature/patch-engine',
        authorName: 'PR Author',
        authorEmail: 'author@example.com',
        customId: '5',
        updatedAt: Date.now(),
      };
      localStorageStore.set('sendforge:draft:pr:test-repo', JSON.stringify(draft));

      const html = render(
        h(NewPRModal, {
          isOpen: true,
          onClose: vi.fn(),
          client: mockClient,
          branches: mockBranches,
          repoName: 'test-repo',
        })
      );

      expect(html).toContain('value="Drafted PR title"');
      expect(html).toContain('value="PR Author"');
      expect(html).toContain('value="author@example.com"');
      expect(html).toContain('value="5"');
    });

    it('handles corrupted PR draft JSON gracefully', () => {
      localStorageStore.set('sendforge:draft:pr:test-repo', 'corrupted-data-###');

      const html = render(
        h(NewPRModal, {
          isOpen: true,
          onClose: vi.fn(),
          client: mockClient,
          branches: mockBranches,
          repoName: 'test-repo',
        })
      );

      expect(html).toContain('data-testid="new-pr-modal"');
      expect(html).toContain('#1');
    });
  });

  describe('3. View Integration (IssuesView.tsx & PullRequestsView.tsx)', () => {
    it('renders "New Issue" button in IssuesView when onNewIssue callback is provided', () => {
      const onNewIssue = vi.fn();
      const html = render(
        h(IssuesView, {
          issues: [],
          onNewIssue,
        })
      );

      expect(html).toContain('data-testid="new-issue-btn"');
      expect(html).toContain('New Issue');
    });

    it('does not render "New Issue" button when onNewIssue is not provided', () => {
      const html = render(
        h(IssuesView, {
          issues: [],
        })
      );

      expect(html).not.toContain('data-testid="new-issue-btn"');
    });

    it('renders "New Pull Request" button in PullRequestsView when onNewPull is provided', () => {
      const onNewPull = vi.fn();
      const html = render(
        h(PullRequestsView, {
          pulls: [],
          onNewPull,
        })
      );

      expect(html).toContain('data-testid="new-pr-btn"');
      expect(html).toContain('New Pull Request');
    });

    it('does not render "New Pull Request" button when onNewPull is not provided', () => {
      const html = render(
        h(PullRequestsView, {
          pulls: [],
        })
      );

      expect(html).not.toContain('data-testid="new-pr-btn"');
    });
  });
});
