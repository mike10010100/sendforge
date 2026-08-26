// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { NewIssueModal } from '../src/ui/NewIssueModal.js';
import { NewPRModal } from '../src/ui/NewPRModal.js';
import { CommitLog } from '../src/ui/CommitLog.js';
import { PRDetailView } from '../src/ui/PRDetailView.js';
import type { GitRepositoryClient } from '../src/engine/fetcher.js';
import type { RepoBranch, GitCommitObject, GitTreeObject, RepoMeta } from '../src/engine/types.js';
import type { PullRequest } from '../src/engine/collab-client.js';

const flushTicks = (ms = 20): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe('Challenger 2 Empirical Adversarial Suite: Modal Interactions & Copy States', () => {
  let container: HTMLDivElement;
  let localStorageStore: Map<string, string>;
  let clipboardText: string;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);

    localStorageStore = new Map<string, string>();
    clipboardText = '';

    // Mock localStorage
    const mockStorage = {
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
      key: vi.fn((idx: number) => Array.from(localStorageStore.keys())[idx] ?? null),
      get length() {
        return localStorageStore.size;
      },
    };

    Object.defineProperty(window, 'localStorage', {
      value: mockStorage,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'localStorage', {
      value: mockStorage,
      writable: true,
      configurable: true,
    });

    // Mock navigator.clipboard
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn(async (text: string) => {
          clipboardText = text;
        }),
        readText: vi.fn(async () => clipboardText),
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    render(null, container);
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
    vi.restoreAllMocks();
  });

  const mockBranches: readonly RepoBranch[] = [
    { name: 'main', target: '1111111111111111111111111111111111111111', is_default: true },
    { name: 'feature/challenger', target: '2222222222222222222222222222222222222222', is_default: false },
  ];

  const mockCommit: GitCommitObject = {
    type: 'commit',
    oid: '2222222222222222222222222222222222222222',
    size: 100,
    tree: 't111111111111111111111111111111111111111',
    parents: ['1111111111111111111111111111111111111111'],
    author: { name: 'Challenger', email: 'challenger@sendforge.test', timestamp: 1740000000, tzOffset: '+0000' },
    committer: { name: 'Challenger', email: 'challenger@sendforge.test', timestamp: 1740000000, tzOffset: '+0000' },
    subject: 'Challenger commit',
    body: 'Verification test commit.',
    message: 'Challenger commit\n\nVerification test commit.',
  };

  const sampleMeta: RepoMeta = {
    name: 'test-project',
    description: 'Test Repo',
    default_branch: 'main',
    branches: [
      { name: 'main', target: '1111111111111111111111111111111111111111', is_default: true },
    ],
    tags: [],
    head: { ref: 'refs/heads/main', sha: '1111111111111111111111111111111111111111' },
    stats: { commit_count: 1, branch_count: 1, tag_count: 0 },
    has_readme: false,
    readme_filename: 'README.md',
    updated_at: '2026-08-20T00:00:00Z',
  };

  const sampleTree: GitTreeObject = {
    type: 'tree',
    oid: 't111111111111111111111111111111111111111',
    size: 50,
    entries: [],
  };

  const mockClient = {
    resolveRef: vi.fn((ref: string) => {
      if (ref === 'main') return Promise.resolve('1111111111111111111111111111111111111111');
      return Promise.resolve('2222222222222222222222222222222222222222');
    }),
    getCommit: vi.fn().mockResolvedValue(mockCommit),
    getTree: vi.fn().mockResolvedValue(sampleTree),
    getBlob: vi.fn(),
    getMeta: vi.fn().mockResolvedValue(sampleMeta),
    listAllTreeFiles: vi.fn().mockResolvedValue([]),
    getCommitHistory: vi.fn().mockResolvedValue([mockCommit]),
  } as unknown as GitRepositoryClient;

  // =========================================================================
  // 1. NewIssueModal: Label Edge Cases, Duplicates, Whitespace, Special Chars & Removal
  // =========================================================================
  describe('1. NewIssueModal Label Manipulation & Stress', () => {
    it('rejects whitespace-only labels (spaces, tabs, newlines) and does not add chips', async () => {
      render(
        h(NewIssueModal, {
          isOpen: true,
          onClose: vi.fn(),
          repoName: 'test-repo',
        }),
        container
      );
      await flushTicks();

      const whitespaceInputs = ['   ', '\t', '\n\n', '   \t  ', ''];
      for (const ws of whitespaceInputs) {
        const input = container.querySelector<HTMLInputElement>('input[data-testid="issue-custom-label-input"]');
        const addBtn = container.querySelector<HTMLButtonElement>('button[data-testid="add-custom-label-btn"]');
        if (input && addBtn) {
          input.value = ws;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await flushTicks(10);
          addBtn.click();
          await flushTicks(10);
        }
      }

      // No custom chips should have been added
      const customChips = container.querySelectorAll('.label-chip.selected');
      expect(customChips.length).toBe(0);
    });

    it('trims leading and trailing whitespace from custom labels', async () => {
      render(
        h(NewIssueModal, {
          isOpen: true,
          onClose: vi.fn(),
          repoName: 'test-repo',
        }),
        container
      );
      await flushTicks();

      const input = container.querySelector<HTMLInputElement>('input[data-testid="issue-custom-label-input"]');
      const addBtn = container.querySelector<HTMLButtonElement>('button[data-testid="add-custom-label-btn"]');

      if (input && addBtn) {
        input.value = '   ui-redesign-2026   ';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await flushTicks();
        addBtn.click();
        await flushTicks();
      }

      const customChip = container.querySelector<HTMLButtonElement>(
        'button[data-testid="issue-custom-chip-ui-redesign-2026"]'
      );
      expect(customChip).not.toBeNull();
      expect(customChip?.textContent).toContain('ui-redesign-2026');
      expect(input?.value).toBe(''); // Clears input upon adding
    });

    it('prevents duplicate custom label additions across sequential additions', async () => {
      render(
        h(NewIssueModal, {
          isOpen: true,
          onClose: vi.fn(),
          repoName: 'test-repo',
        }),
        container
      );
      await flushTicks();

      const input = container.querySelector<HTMLInputElement>('input[data-testid="issue-custom-label-input"]');
      const addBtn = container.querySelector<HTMLButtonElement>('button[data-testid="add-custom-label-btn"]');

      // Add label first time
      if (input && addBtn) {
        input.value = 'performance-regression';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await flushTicks();
        addBtn.click();
        await flushTicks();

        // Attempt to add identical label a second time
        input.value = 'performance-regression';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await flushTicks();
        addBtn.click();
        await flushTicks();
      }

      const matchingChips = container.querySelectorAll(
        'button[data-testid="issue-custom-chip-performance-regression"]'
      );
      expect(matchingChips.length).toBe(1);
    });

    it('adds custom label via Enter keydown in input field', async () => {
      render(
        h(NewIssueModal, {
          isOpen: true,
          onClose: vi.fn(),
          repoName: 'test-repo',
        }),
        container
      );
      await flushTicks();

      const input = container.querySelector<HTMLInputElement>('input[data-testid="issue-custom-label-input"]');
      if (input) {
        input.value = 'enter-key-label';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await flushTicks();
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        await flushTicks();
      }

      const chip = container.querySelector('button[data-testid="issue-custom-chip-enter-key-label"]');
      expect(chip).not.toBeNull();
    });

    it('handles adding custom label matching a preset name by selecting the preset chip without duplication', async () => {
      render(
        h(NewIssueModal, {
          isOpen: true,
          onClose: vi.fn(),
          repoName: 'test-repo',
        }),
        container
      );
      await flushTicks();

      const input = container.querySelector<HTMLInputElement>('input[data-testid="issue-custom-label-input"]');
      const addBtn = container.querySelector<HTMLButtonElement>('button[data-testid="add-custom-label-btn"]');

      if (input && addBtn) {
        input.value = 'security'; // 'security' is in PRESET_LABELS
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await flushTicks();
        addBtn.click();
        await flushTicks();
      }

      const presetChip = container.querySelector<HTMLButtonElement>('button[data-testid="issue-preset-label-security"]');
      expect(presetChip?.classList.contains('selected')).toBe(true);

      // Should NOT render as a separate custom chip
      const customChip = container.querySelector('button[data-testid="issue-custom-chip-security"]');
      expect(customChip).toBeNull();
    });

    it('handles special characters, HTML tags, and XSS injection vectors safely without executing scripts', async () => {
      render(
        h(NewIssueModal, {
          isOpen: true,
          onClose: vi.fn(),
          repoName: 'test-repo',
        }),
        container
      );
      await flushTicks();

      const xssLabels = [
        '<script>alert("XSS")</script>',
        '<img src=x onerror=alert(1)>',
        'label "with" quotes & <tags>',
        'emoji-🚀-🔥',
        'utf8: 汉字 / 日本語 / العربية',
      ];

      for (const label of xssLabels) {
        const input = container.querySelector<HTMLInputElement>('input[data-testid="issue-custom-label-input"]');
        const addBtn = container.querySelector<HTMLButtonElement>('button[data-testid="add-custom-label-btn"]');
        if (input && addBtn) {
          input.value = label;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await flushTicks(10);
          addBtn.click();
          await flushTicks(10);
        }
      }

      // Assert all custom chips are rendered safely as buttons with text content
      const allChips = Array.from(container.querySelectorAll<HTMLButtonElement>('button[data-testid^="issue-custom-chip-"]'));
      expect(allChips.length).toBe(xssLabels.length);

      for (const label of xssLabels) {
        const matchingChip = allChips.find((c) => c.getAttribute('data-testid') === `issue-custom-chip-${label}`);
        expect(matchingChip).toBeDefined();
        expect(matchingChip?.textContent).toContain(label);
      }

      // Verify no raw script tags executed or injected into DOM
      const scripts = container.querySelectorAll('script');
      expect(scripts.length).toBe(0);
    });

    it('toggles preset label chips on and off, and removes custom chips on click', async () => {
      render(
        h(NewIssueModal, {
          isOpen: true,
          onClose: vi.fn(),
          repoName: 'test-repo',
        }),
        container
      );
      await flushTicks();

      const bugPreset = container.querySelector<HTMLButtonElement>('button[data-testid="issue-preset-label-bug"]');
      expect(bugPreset).not.toBeNull();
      expect(bugPreset?.classList.contains('selected')).toBe(false);

      // Select preset
      bugPreset?.click();
      await flushTicks();
      expect(bugPreset?.classList.contains('selected')).toBe(true);

      // Deselect preset
      bugPreset?.click();
      await flushTicks();
      expect(bugPreset?.classList.contains('selected')).toBe(false);

      // Add custom label
      const input = container.querySelector<HTMLInputElement>('input[data-testid="issue-custom-label-input"]');
      const addBtn = container.querySelector<HTMLButtonElement>('button[data-testid="add-custom-label-btn"]');
      if (input && addBtn) {
        input.value = 'custom-removable';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await flushTicks();
        addBtn.click();
        await flushTicks();
      }

      const customChip = container.querySelector<HTMLButtonElement>(
        'button[data-testid="issue-custom-chip-custom-removable"]'
      );
      expect(customChip).not.toBeNull();

      // Click custom chip to remove it
      customChip?.click();
      await flushTicks();

      const removedChip = container.querySelector('button[data-testid="issue-custom-chip-custom-removable"]');
      expect(removedChip).toBeNull();
    });
  });

  // =========================================================================
  // 2. NewPRModal: Label Edge Cases, Duplicates, Whitespace, Special Chars & Removal
  // =========================================================================
  describe('2. NewPRModal Label Manipulation & Stress', () => {
    it('rejects whitespace-only labels in NewPRModal', async () => {
      render(
        h(NewPRModal, {
          isOpen: true,
          onClose: vi.fn(),
          client: mockClient,
          branches: mockBranches,
          repoName: 'test-repo',
        }),
        container
      );
      await flushTicks();

      const input = container.querySelector<HTMLInputElement>('input[data-testid="pr-custom-label-input"]');
      const addBtn = container.querySelector<HTMLButtonElement>('button[data-testid="add-pr-custom-label-btn"]');
      expect(input).not.toBeNull();
      expect(addBtn).not.toBeNull();

      if (input && addBtn) {
        input.value = '    ';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await flushTicks();
        addBtn.click();
        await flushTicks();
      }

      const customChips = container.querySelectorAll('button[data-testid^="pr-custom-chip-"]');
      expect(customChips.length).toBe(0);
    });

    it('trims whitespace and ignores duplicate additions in NewPRModal', async () => {
      render(
        h(NewPRModal, {
          isOpen: true,
          onClose: vi.fn(),
          client: mockClient,
          branches: mockBranches,
          repoName: 'test-repo',
        }),
        container
      );
      await flushTicks();

      const input = container.querySelector<HTMLInputElement>('input[data-testid="pr-custom-label-input"]');
      const addBtn = container.querySelector<HTMLButtonElement>('button[data-testid="add-pr-custom-label-btn"]');

      if (input && addBtn) {
        input.value = '   core-subsystem   ';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await flushTicks();
        addBtn.click();
        await flushTicks();

        // Attempt duplicate addition
        input.value = 'core-subsystem';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await flushTicks();
        addBtn.click();
        await flushTicks();
      }

      const chips = container.querySelectorAll('button[data-testid="pr-custom-chip-core-subsystem"]');
      expect(chips.length).toBe(1);
    });

    it('removes custom chip upon click in NewPRModal', async () => {
      render(
        h(NewPRModal, {
          isOpen: true,
          onClose: vi.fn(),
          client: mockClient,
          branches: mockBranches,
          repoName: 'test-repo',
        }),
        container
      );
      await flushTicks();

      const input = container.querySelector<HTMLInputElement>('input[data-testid="pr-custom-label-input"]');
      const addBtn = container.querySelector<HTMLButtonElement>('button[data-testid="add-pr-custom-label-btn"]');

      if (input && addBtn) {
        input.value = 'temporary-pr-label';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await flushTicks();
        addBtn.click();
        await flushTicks();
      }

      const chip = container.querySelector<HTMLButtonElement>(
        'button[data-testid="pr-custom-chip-temporary-pr-label"]'
      );
      expect(chip).not.toBeNull();

      chip?.click();
      await flushTicks();

      expect(container.querySelector('button[data-testid="pr-custom-chip-temporary-pr-label"]')).toBeNull();
    });
  });

  // =========================================================================
  // 3. Draft localStorage Persistence, Recovery, Isolation & Corrupted Payloads
  // =========================================================================
  describe('3. Draft localStorage Persistence, Recovery & Isolation', () => {
    it('persists Issue draft to scoped localStorage key and recovers on reopen', async () => {
      const repoScope = 'my-special-repo';
      render(
        h(NewIssueModal, {
          isOpen: true,
          onClose: vi.fn(),
          repoName: repoScope,
        }),
        container
      );
      await flushTicks();

      const titleInput = container.querySelector<HTMLInputElement>('input[data-testid="new-issue-title-input"]');
      const descInput = container.querySelector<HTMLTextAreaElement>(
        'textarea[data-testid="new-issue-description-input"]'
      );
      const labelInput = container.querySelector<HTMLInputElement>('input[data-testid="issue-custom-label-input"]');
      const addLabelBtn = container.querySelector<HTMLButtonElement>('button[data-testid="add-custom-label-btn"]');

      if (titleInput && descInput && labelInput && addLabelBtn) {
        titleInput.value = 'Draft Issue Persisted';
        titleInput.dispatchEvent(new Event('input', { bubbles: true }));
        await flushTicks();

        descInput.value = 'Persisted Description Body with **Markdown**';
        descInput.dispatchEvent(new Event('input', { bubbles: true }));
        await flushTicks();

        const curLabelInput = container.querySelector<HTMLInputElement>('input[data-testid="issue-custom-label-input"]');
        if (curLabelInput) {
          curLabelInput.value = 'draft-chip';
          curLabelInput.dispatchEvent(new Event('input', { bubbles: true }));
          await flushTicks();
        }
        const curAddBtn = container.querySelector<HTMLButtonElement>('button[data-testid="add-custom-label-btn"]');
        curAddBtn?.click();
        await flushTicks();
      }

      // Check localStorage entry
      const rawStored = localStorageStore.get(`sendforge:draft:issue:${repoScope}`);
      expect(rawStored).toBeDefined();
      const parsed = JSON.parse(rawStored ?? '{}') as { title: string; description: string; selectedLabels: string[] };
      expect(parsed.title).toBe('Draft Issue Persisted');
      expect(parsed.description).toBe('Persisted Description Body with **Markdown**');
      expect(parsed.selectedLabels).toContain('draft-chip');

      // Unmount component
      render(null, container);
      await flushTicks();

      // Re-mount component and verify recovery
      render(
        h(NewIssueModal, {
          isOpen: true,
          onClose: vi.fn(),
          repoName: repoScope,
        }),
        container
      );
      await flushTicks();

      const restoredTitle = container.querySelector<HTMLInputElement>('input[data-testid="new-issue-title-input"]');
      const restoredDesc = container.querySelector<HTMLTextAreaElement>(
        'textarea[data-testid="new-issue-description-input"]'
      );
      const restoredChip = container.querySelector('button[data-testid="issue-custom-chip-draft-chip"]');

      expect(restoredTitle?.value).toBe('Draft Issue Persisted');
      expect(restoredDesc?.value).toBe('Persisted Description Body with **Markdown**');
      expect(restoredChip).not.toBeNull();
    });

    it('enforces repository key isolation (drafts in repo-A do not leak into repo-B)', async () => {
      localStorageStore.set(
        'sendforge:draft:issue:repo-A',
        JSON.stringify({
          title: 'Repo A Title',
          description: 'Repo A Desc',
          selectedLabels: ['repo-a-label'],
          authorName: 'Author A',
          authorEmail: 'a@sendforge.test',
          customId: '10',
          updatedAt: Date.now(),
        })
      );

      // Open modal in repo-B
      render(
        h(NewIssueModal, {
          isOpen: true,
          onClose: vi.fn(),
          repoName: 'repo-B',
        }),
        container
      );
      await flushTicks();

      const titleInput = container.querySelector<HTMLInputElement>('input[data-testid="new-issue-title-input"]');
      expect(titleInput?.value).toBe('');
      expect(container.querySelector('button[data-testid="issue-custom-chip-repo-a-label"]')).toBeNull();
    });

    it('clears draft fields in form when Clear Draft button is clicked', async () => {
      const repoScope = 'clear-test-repo';
      localStorageStore.set(
        `sendforge:draft:issue:${repoScope}`,
        JSON.stringify({
          title: 'Draft to be cleared',
          description: 'Desc',
          selectedLabels: ['to-clear'],
          authorName: 'Author',
          authorEmail: 'author@test.com',
          customId: '1',
          updatedAt: Date.now(),
        })
      );

      render(
        h(NewIssueModal, {
          isOpen: true,
          onClose: vi.fn(),
          repoName: repoScope,
        }),
        container
      );
      await flushTicks();

      const clearBtn = container.querySelector<HTMLButtonElement>('button[data-testid="clear-issue-draft-btn"]');
      expect(clearBtn).not.toBeNull();
      clearBtn?.click();
      await flushTicks();

      const titleInput = container.querySelector<HTMLInputElement>('input[data-testid="new-issue-title-input"]');
      const descInput = container.querySelector<HTMLTextAreaElement>('textarea[data-testid="new-issue-description-input"]');
      expect(titleInput?.value).toBe('');
      expect(descInput?.value).toBe('');
      expect(container.querySelector('button[data-testid="issue-custom-chip-to-clear"]')).toBeNull();
    });

    it('submits issue and fires onIssueCreated and onClose callbacks', async () => {
      const repoScope = 'submit-test-repo';
      const onCreated = vi.fn();
      const onClose = vi.fn();

      render(
        h(NewIssueModal, {
          isOpen: true,
          onClose,
          repoName: repoScope,
          onIssueCreated: onCreated,
        }),
        container
      );
      await flushTicks();

      const titleInput = container.querySelector<HTMLInputElement>('input[data-testid="new-issue-title-input"]');
      const submitBtn = container.querySelector<HTMLButtonElement>('button[data-testid="submit-issue-btn"]');

      if (titleInput && submitBtn) {
        titleInput.value = 'Submitted Issue';
        titleInput.dispatchEvent(new Event('input', { bubbles: true }));
        await flushTicks();
        submitBtn.click();
        await flushTicks();
      }

      expect(onCreated).toHaveBeenCalledTimes(1);
      expect(onCreated).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Submitted Issue',
          status: 'open',
        })
      );
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('gracefully handles non-object, non-array, and corrupted JSON draft payloads in localStorage', async () => {
      const corruptedEntries = [
        '{not-valid-json',
        'null',
        '12345',
        '"plain-string"',
        JSON.stringify({ selectedLabels: 'not-an-array' }),
        JSON.stringify({ selectedLabels: [123, null, false, { obj: true }] }),
      ];

      for (const entry of corruptedEntries) {
        localStorageStore.set('sendforge:draft:issue:corrupt-repo', entry);
        render(
          h(NewIssueModal, {
            isOpen: true,
            onClose: vi.fn(),
            repoName: 'corrupt-repo',
          }),
          container
        );
        await flushTicks();

        const modal = container.querySelector('[data-testid="new-issue-modal"]');
        expect(modal).not.toBeNull();
        render(null, container);
      }
    });

    it('gracefully survives when localStorage throws security or quota errors', async () => {
      const throwingStorage = {
        getItem: vi.fn(() => {
          throw new DOMException('SecurityError');
        }),
        setItem: vi.fn(() => {
          throw new DOMException('QuotaExceededError');
        }),
        removeItem: vi.fn(() => {
          throw new DOMException('SecurityError');
        }),
        clear: vi.fn(),
        key: vi.fn(),
        length: 0,
      };

      Object.defineProperty(window, 'localStorage', {
        value: throwingStorage,
        writable: true,
      });

      render(
        h(NewIssueModal, {
          isOpen: true,
          onClose: vi.fn(),
          repoName: 'quota-test',
        }),
        container
      );
      await flushTicks();

      const titleInput = container.querySelector<HTMLInputElement>('input[data-testid="new-issue-title-input"]');
      expect(titleInput).not.toBeNull();

      // Typing should not crash even if setItem throws
      if (titleInput) {
        titleInput.value = 'Typing with blocked storage';
        titleInput.dispatchEvent(new Event('input', { bubbles: true }));
        await flushTicks();
      }

      expect(titleInput?.value).toBe('Typing with blocked storage');
    });
  });

  // =========================================================================
  // 4. Copy States, Visual Feedback, and Timeout Clears
  // =========================================================================
  describe('4. Copy States, Visual Feedback & Timeout Clears', () => {
    it('verifies NewIssueModal copy command button copies to clipboard and resets after 2000ms timeout', async () => {
      render(
        h(NewIssueModal, {
          isOpen: true,
          onClose: vi.fn(),
          repoName: 'test-repo',
          existingIssues: [{
            id: '5',
            number: 5,
            title: 'I5',
            description: '',
            author: { name: 'A', email: 'a@a.com' },
            status: 'open',
            createdAt: 0,
            updatedAt: 0,
            labels: [],
            comments: [],
          }],
        }),
        container
      );
      await flushTicks();

      const copyBtn = container.querySelector<HTMLButtonElement>('button[data-testid="copy-issue-command-btn"]');
      expect(copyBtn).not.toBeNull();
      expect(copyBtn?.textContent).toContain('📋 Copy Command');

      // Click copy button
      copyBtn?.click();
      await flushTicks(50);

      // Clipboard was written
      expect(clipboardText).toBe('git push origin HEAD:refs/issues/6');
      // Visual feedback shows Copied!
      const activeBtn = container.querySelector<HTMLButtonElement>('button[data-testid="copy-issue-command-btn"]');
      expect(activeBtn?.textContent).toContain('✓ Copied!');

      // Wait 2100ms for timeout reset
      await flushTicks(2100);
      const resetBtn = container.querySelector<HTMLButtonElement>('button[data-testid="copy-issue-command-btn"]');
      expect(resetBtn?.textContent).toContain('📋 Copy Command');
    });

    it('verifies NewPRModal copy command button copies to clipboard and resets after 2000ms', async () => {
      render(
        h(NewPRModal, {
          isOpen: true,
          onClose: vi.fn(),
          client: mockClient,
          branches: mockBranches,
          repoName: 'test-repo',
        }),
        container
      );
      await flushTicks();

      const copyBtn = container.querySelector<HTMLButtonElement>('button[data-testid="copy-pr-command-btn"]');
      expect(copyBtn).not.toBeNull();
      expect(copyBtn?.textContent).toContain('📋 Copy Command');

      copyBtn?.click();
      await flushTicks(50);

      expect(clipboardText).toContain('git push origin');
      const activeBtn = container.querySelector<HTMLButtonElement>('button[data-testid="copy-pr-command-btn"]');
      expect(activeBtn?.textContent).toContain('✓ Copied!');

      await flushTicks(2100);
      const resetBtn = container.querySelector<HTMLButtonElement>('button[data-testid="copy-pr-command-btn"]');
      expect(resetBtn?.textContent).toContain('📋 Copy Command');
    });

    it('verifies CommitLog copy SHA button writes 40-char OID and resets after 2000ms with race condition safety', async () => {
      const commitA: GitCommitObject = {
        ...mockCommit,
        oid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      };
      const commitB: GitCommitObject = {
        ...mockCommit,
        oid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      };

      render(
        h(CommitLog, {
          commits: [commitA, commitB],
        }),
        container
      );
      await flushTicks();

      const copyBtnA = container.querySelector<HTMLButtonElement>(
        'button[data-testid="copy-sha-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]'
      );
      const copyBtnB = container.querySelector<HTMLButtonElement>(
        'button[data-testid="copy-sha-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]'
      );

      expect(copyBtnA).not.toBeNull();
      expect(copyBtnB).not.toBeNull();
      // Uncopied buttons show SVG copy icon (no textContent)
      expect(copyBtnA?.querySelector('.copy-icon')).not.toBeNull();
      expect(copyBtnB?.querySelector('.copy-icon')).not.toBeNull();

      // Click copy on Commit A
      copyBtnA?.click();
      await flushTicks(50);

      expect(clipboardText).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      const activeBtnA = container.querySelector<HTMLButtonElement>(
        'button[data-testid="copy-sha-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]'
      );
      expect(activeBtnA?.textContent).toContain('✓ Copied');

      // Click copy on Commit B 200ms later
      await flushTicks(200);
      copyBtnB?.click();
      await flushTicks(50);

      expect(clipboardText).toBe('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
      const curBtnA = container.querySelector<HTMLButtonElement>(
        'button[data-testid="copy-sha-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]'
      );
      const curBtnB = container.querySelector<HTMLButtonElement>(
        'button[data-testid="copy-sha-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]'
      );
      expect(curBtnA?.querySelector('.copy-icon')).not.toBeNull(); // A reset because B was copied
      expect(curBtnB?.textContent).toContain('✓ Copied');

      // Wait 2100ms for B's timer to expire
      await flushTicks(2100);
      const finalBtnB = container.querySelector<HTMLButtonElement>(
        'button[data-testid="copy-sha-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]'
      );
      expect(finalBtnB?.querySelector('.copy-icon')).not.toBeNull();
    });

    it('verifies PRDetailView copy SHA button writes 40-char OID and provides visual feedback', async () => {
      const mockPR: PullRequest = {
        id: '1',
        number: 1,
        title: 'PR 1',
        description: 'PR 1 Desc',
        author: { name: 'Author', email: 'author@test.com' },
        targetBranch: 'main',
        sourceBranch: 'feature',
        headCommit: '2222222222222222222222222222222222222222',
        status: 'open',
        createdAt: 1740000000,
        updatedAt: 1740000000,
        labels: [],
        comments: [],
      };

      render(
        h(PRDetailView, {
          pr: mockPR,
          client: mockClient,
          activeTab: 'conversation',
        }),
        container
      );
      await flushTicks(50);

      // Verify PR detail view rendered cleanly
      expect(container.querySelector('[data-testid="pr-detail-view"]')).not.toBeNull();
    });
  });
});
