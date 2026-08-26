// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { FileFinder } from '../src/ui/FileFinder.js';
import type { TreeFileItem } from '../src/engine/fetcher.js';

const flushTicks = (ms = 30): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe('Command Palette & FileFinder UI Suite (file-finder.test.ts)', () => {
  let container: HTMLDivElement;

  const sampleFiles: TreeFileItem[] = [
    {
      path: 'src/main.rs',
      entry: {
        mode: '100644',
        name: 'main.rs',
        oid: '1111111111111111111111111111111111111111',
        isTree: false,
        isSubmodule: false,
        isSymlink: false,
      },
    },
    {
      path: 'client/src/ui/App.tsx',
      entry: {
        mode: '100644',
        name: 'App.tsx',
        oid: '2222222222222222222222222222222222222222',
        isTree: false,
        isSubmodule: false,
        isSymlink: false,
      },
    },
    {
      path: 'client/src/engine/tree-indexer.ts',
      entry: {
        mode: '100644',
        name: 'tree-indexer.ts',
        oid: '3333333333333333333333333333333333333333',
        isTree: false,
        isSubmodule: false,
        isSymlink: false,
      },
    },
    {
      path: 'README.md',
      entry: {
        mode: '100644',
        name: 'README.md',
        oid: '4444444444444444444444444444444444444444',
        isTree: false,
        isSubmodule: false,
        isSymlink: false,
      },
    },
    {
      path: 'package.json',
      entry: {
        mode: '100644',
        name: 'package.json',
        oid: '5555555555555555555555555555555555555555',
        isTree: false,
        isSubmodule: false,
        isSymlink: false,
      },
    },
  ];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    vi.clearAllMocks();
  });

  describe('1. Visibility & Initial Rendering', () => {
    it('renders nothing when isOpen is false', () => {
      render(
        h(FileFinder, {
          files: sampleFiles,
          isOpen: false,
          onClose: vi.fn(),
          onSelectFile: vi.fn(),
        }),
        container
      );
      expect(container.innerHTML).toBe('');
    });

    it('renders modal overlay, search input, and file list when isOpen is true', async () => {
      render(
        h(FileFinder, {
          files: sampleFiles,
          isOpen: true,
          onClose: vi.fn(),
          onSelectFile: vi.fn(),
        }),
        container
      );
      await flushTicks();

      const modal = container.querySelector('[data-testid="file-finder-modal"]');
      expect(modal).not.toBeNull();

      const input = container.querySelector<HTMLInputElement>('[data-testid="file-finder-input"]');
      expect(input).not.toBeNull();

      const results = container.querySelectorAll('.finder-item');
      expect(results.length).toBe(sampleFiles.length);

      // Verify footer shortcut badges
      expect(container.textContent).toContain('Navigate');
      expect(container.textContent).toContain('Select');
      expect(container.textContent).toContain('Close');
      expect(container.textContent).toContain('Jump to line');
      expect(container.textContent).toContain('5 files');
    });

    it('renders file icons based on extension', async () => {
      render(
        h(FileFinder, {
          files: sampleFiles,
          isOpen: true,
          onClose: vi.fn(),
          onSelectFile: vi.fn(),
        }),
        container
      );
      await flushTicks();

      const html = container.innerHTML;
      expect(html).toContain('🦀'); // .rs
      expect(html).toContain('⚡'); // .ts / .tsx
      expect(html).toContain('📝'); // .md
      expect(html).toContain('⚙️'); // .json
    });
  });

  describe('2. Search Query & Dynamic Substring Highlighting', () => {
    it('filters results dynamically and highlights matched substrings with mark', async () => {
      render(
        h(FileFinder, {
          files: sampleFiles,
          isOpen: true,
          onClose: vi.fn(),
          onSelectFile: vi.fn(),
        }),
        container
      );
      await flushTicks();

      const input = container.querySelector<HTMLInputElement>('[data-testid="file-finder-input"]');
      expect(input).not.toBeNull();

      if (input) {
        input.value = 'tree';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await flushTicks();
      }

      const results = container.querySelectorAll('.finder-item');
      expect(results.length).toBe(1);
      expect(results[0]?.textContent).toContain('tree-indexer.ts');

      const mark = results[0]?.querySelector('mark.match-highlight');
      expect(mark).not.toBeNull();
      expect(mark?.textContent.toLowerCase()).toBe('tree');

      const countBadge = container.querySelector('[data-testid="file-finder-count"]');
      expect(countBadge?.textContent).toContain('1 match');
    });

    it('displays clear button (✕) when query is non-empty and clears input on click', async () => {
      render(
        h(FileFinder, {
          files: sampleFiles,
          isOpen: true,
          onClose: vi.fn(),
          onSelectFile: vi.fn(),
        }),
        container
      );
      await flushTicks();

      const input = container.querySelector<HTMLInputElement>('[data-testid="file-finder-input"]');
      if (input) {
        input.value = 'app';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await flushTicks();
      }

      const clearBtn = container.querySelector<HTMLButtonElement>('[data-testid="file-finder-clear"]');
      expect(clearBtn).not.toBeNull();

      clearBtn?.click();
      await flushTicks();

      expect(input?.value).toBe('');
      const results = container.querySelectorAll('.finder-item');
      expect(results.length).toBe(sampleFiles.length);
    });

    it('renders empty state when search query matches no files', async () => {
      render(
        h(FileFinder, {
          files: sampleFiles,
          isOpen: true,
          onClose: vi.fn(),
          onSelectFile: vi.fn(),
        }),
        container
      );
      await flushTicks();

      const input = container.querySelector<HTMLInputElement>('[data-testid="file-finder-input"]');
      if (input) {
        input.value = 'nonexistent_file_xyz';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await flushTicks();
      }

      const emptyState = container.querySelector('[data-testid="file-finder-empty"]');
      expect(emptyState).not.toBeNull();
      expect(emptyState?.textContent).toContain('No files matching "nonexistent_file_xyz"');
    });
  });

  describe('3. Line Permalink Handling in Search and Selection', () => {
    it('displays line badge and passes targetLine on selection (e.g. main.rs:42)', async () => {
      const onSelect = vi.fn();
      const onClose = vi.fn();

      render(
        h(FileFinder, {
          files: sampleFiles,
          isOpen: true,
          onClose,
          onSelectFile: onSelect,
        }),
        container
      );
      await flushTicks();

      const input = container.querySelector<HTMLInputElement>('[data-testid="file-finder-input"]');
      if (input) {
        input.value = 'main.rs:42';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await flushTicks();
      }

      const lineBadge = container.querySelector('[data-testid="file-finder-line-badge"]');
      expect(lineBadge).not.toBeNull();
      expect(lineBadge?.textContent).toBe(':42');

      const firstItem = container.querySelector<HTMLLIElement>('[data-testid="file-finder-item-0"]');
      firstItem?.click();
      await flushTicks();

      expect(onSelect).toHaveBeenCalledWith('src/main.rs', 42);
      expect(onClose).toHaveBeenCalled();
    });

    it('handles line ranges (e.g. App.tsx#L10-L25)', async () => {
      const onSelect = vi.fn();
      const onClose = vi.fn();

      render(
        h(FileFinder, {
          files: sampleFiles,
          isOpen: true,
          onClose,
          onSelectFile: onSelect,
        }),
        container
      );
      await flushTicks();

      const input = container.querySelector<HTMLInputElement>('[data-testid="file-finder-input"]');
      if (input) {
        input.value = 'App.tsx#L10-L25';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await flushTicks();
      }

      const lineBadge = container.querySelector('[data-testid="file-finder-line-badge"]');
      expect(lineBadge).not.toBeNull();
      expect(lineBadge?.textContent).toBe(':10-25');

      const firstItem = container.querySelector<HTMLLIElement>('[data-testid="file-finder-item-0"]');
      firstItem?.click();
      await flushTicks();

      expect(onSelect).toHaveBeenCalledWith('client/src/ui/App.tsx', 10);
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('4. Keyboard Navigation (Arrow Keys, Enter, Escape)', () => {
    it('navigates through items with ArrowDown and ArrowUp and selects on Enter', async () => {
      const onSelect = vi.fn();
      const onClose = vi.fn();

      render(
        h(FileFinder, {
          files: sampleFiles,
          isOpen: true,
          onClose,
          onSelectFile: onSelect,
        }),
        container
      );
      await flushTicks();

      const input = container.querySelector<HTMLInputElement>('[data-testid="file-finder-input"]');
      expect(input).not.toBeNull();

      // Initial item 0 is selected
      let items = container.querySelectorAll('.finder-item');
      expect(items[0]?.classList.contains('selected')).toBe(true);

      // Press ArrowDown -> Item 1 is selected
      input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await flushTicks();

      items = container.querySelectorAll('.finder-item');
      expect(items[1]?.classList.contains('selected')).toBe(true);

      // Press ArrowDown -> Item 2 is selected
      input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await flushTicks();

      items = container.querySelectorAll('.finder-item');
      expect(items[2]?.classList.contains('selected')).toBe(true);

      // Press ArrowUp -> Item 1 is selected
      input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      await flushTicks();

      items = container.querySelectorAll('.finder-item');
      expect(items[1]?.classList.contains('selected')).toBe(true);

      // Press Enter -> selects item 1 ('client/src/ui/App.tsx')
      input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await flushTicks();

      expect(onSelect).toHaveBeenCalledWith('client/src/ui/App.tsx', undefined);
      expect(onClose).toHaveBeenCalled();
    });

    it('wraps around to the top when pressing ArrowDown at the end of the list', async () => {
      render(
        h(FileFinder, {
          files: sampleFiles.slice(0, 2),
          isOpen: true,
          onClose: vi.fn(),
          onSelectFile: vi.fn(),
        }),
        container
      );
      await flushTicks();

      const input = container.querySelector<HTMLInputElement>('[data-testid="file-finder-input"]');

      // Move to item 1
      input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await flushTicks();

      let items = container.querySelectorAll('.finder-item');
      expect(items[1]?.classList.contains('selected')).toBe(true);

      // Move past item 1 -> wraps to item 0
      input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await flushTicks();

      items = container.querySelectorAll('.finder-item');
      expect(items[0]?.classList.contains('selected')).toBe(true);
    });

    it('closes modal on Escape key', async () => {
      const onClose = vi.fn();

      render(
        h(FileFinder, {
          files: sampleFiles,
          isOpen: true,
          onClose,
          onSelectFile: vi.fn(),
        }),
        container
      );
      await flushTicks();

      const input = container.querySelector<HTMLInputElement>('[data-testid="file-finder-input"]');
      input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await flushTicks();

      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('5. Backdrop Click Dismissal', () => {
    it('closes modal when clicking overlay backdrop, but not modal content', async () => {
      const onClose = vi.fn();

      render(
        h(FileFinder, {
          files: sampleFiles,
          isOpen: true,
          onClose,
          onSelectFile: vi.fn(),
        }),
        container
      );
      await flushTicks();

      const overlay = container.querySelector<HTMLDivElement>('[data-testid="file-finder-modal"]');
      const content = container.querySelector<HTMLDivElement>('.modal-content');

      // Click content -> does NOT close
      content?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushTicks();
      expect(onClose).not.toHaveBeenCalled();

      // Click overlay backdrop -> DOES close
      overlay?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushTicks();
      expect(onClose).toHaveBeenCalled();
    });
  });
});
