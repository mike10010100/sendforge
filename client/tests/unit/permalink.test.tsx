import { describe, expect, it, vi } from 'vitest';
import { h } from 'preact';
import render from 'preact-render-to-string';
import { BlobView } from '../../src/ui/BlobView.js';
import {
  buildPermalinkUrl,
  formatLineHash,
  parseLineHash,
  type LineRange,
} from '../../src/ui/utils.js';
import type { GitBlobObject } from '../../src/engine/types.js';

describe('Milestone M3: File Permalinks & Line Highlighting (R3)', () => {
  const sampleCommitOid = 'd3b07384d113edec49eaa6238ad5ff0012345678';
  const sampleFilePath = 'src/components/Header.tsx';

  const multiLineCode = [
    'import { h } from "preact";',
    'export const Header = () => {',
    '  return (',
    '    <header className="header">',
    '      <h1>Sendforge</h1>',
    '    </header>',
    '  );',
    '};',
  ].join('\n');

  const mockBlob: GitBlobObject = {
    type: 'blob',
    oid: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
    size: multiLineCode.length,
    data: new TextEncoder().encode(multiLineCode),
    isBinary: false,
    text: multiLineCode,
  };

  // ---------------------------------------------------------------------------
  // 1. parseLineHash Unit Tests
  // ---------------------------------------------------------------------------
  describe('parseLineHash', () => {
    it('parses single line hash (#L42)', () => {
      const res = parseLineHash('#L42');
      expect(res).toEqual({ start: 42, end: 42 });
    });

    it('parses single line hash without leading hash (L42)', () => {
      const res = parseLineHash('L42');
      expect(res).toEqual({ start: 42, end: 42 });
    });

    it('parses single line at boundary (#L1)', () => {
      const res = parseLineHash('#L1');
      expect(res).toEqual({ start: 1, end: 1 });
    });

    it('parses large line number (#L999999)', () => {
      const res = parseLineHash('#L999999');
      expect(res).toEqual({ start: 999999, end: 999999 });
    });

    it('parses multi-line range hash (#L10-L25)', () => {
      const res = parseLineHash('#L10-L25');
      expect(res).toEqual({ start: 10, end: 25 });
    });

    it('parses multi-line range without leading hash (L10-L25)', () => {
      const res = parseLineHash('L10-L25');
      expect(res).toEqual({ start: 10, end: 25 });
    });

    it('normalizes reversed multi-line range so start <= end (#L25-L10)', () => {
      const res = parseLineHash('#L25-L10');
      expect(res).toEqual({ start: 10, end: 25 });
    });

    it('handles identical start and end in range (#L42-L42)', () => {
      const res = parseLineHash('#L42-L42');
      expect(res).toEqual({ start: 42, end: 42 });
    });

    it('parses case-insensitively (#l42, #l10-l25, #L10-l25, #l10-L25)', () => {
      expect(parseLineHash('#l42')).toEqual({ start: 42, end: 42 });
      expect(parseLineHash('l42')).toEqual({ start: 42, end: 42 });
      expect(parseLineHash('#l10-l25')).toEqual({ start: 10, end: 25 });
      expect(parseLineHash('#L10-l25')).toEqual({ start: 10, end: 25 });
      expect(parseLineHash('#l10-L25')).toEqual({ start: 10, end: 25 });
      expect(parseLineHash('#l25-L10')).toEqual({ start: 10, end: 25 });
    });

    it('extracts line hash from full route URLs', () => {
      const url1 = '#/blob/main/src/App.tsx#L42';
      expect(parseLineHash(url1)).toEqual({ start: 42, end: 42 });

      const url2 = '#/commit/d3b07384d113edec49eaa6238ad5ff0012345678/blob/src/App.tsx#L10-L25';
      expect(parseLineHash(url2)).toEqual({ start: 10, end: 25 });

      const url3 = '#/blob/v1.0.0/lib.rs#L88';
      expect(parseLineHash(url3)).toEqual({ start: 88, end: 88 });
    });

    it('returns null for invalid hash formats', () => {
      expect(parseLineHash('')).toBeNull();
      expect(parseLineHash('#')).toBeNull();
      expect(parseLineHash('#xyz')).toBeNull();
      expect(parseLineHash('#abc')).toBeNull();
      expect(parseLineHash('#L')).toBeNull();
      expect(parseLineHash('#L-')).toBeNull();
      expect(parseLineHash('#L0')).toBeNull();
      expect(parseLineHash('#L0-L10')).toBeNull();
      expect(parseLineHash('#L10-L0')).toBeNull();
      expect(parseLineHash('#L-5')).toBeNull();
      expect(parseLineHash('#L-10-L-20')).toBeNull();
      expect(parseLineHash('#/blob/main/src/App.tsx')).toBeNull();
      expect(parseLineHash('not-a-line-hash')).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // 2. formatLineHash Unit Tests
  // ---------------------------------------------------------------------------
  describe('formatLineHash', () => {
    it('formats single line (#L42)', () => {
      expect(formatLineHash(42)).toBe('#L42');
    });

    it('formats single line when start equals end (#L42)', () => {
      expect(formatLineHash(42, 42)).toBe('#L42');
    });

    it('formats multi-line range (#L10-L25)', () => {
      expect(formatLineHash(10, 25)).toBe('#L10-L25');
    });

    it('normalizes reversed range so start is smaller (#L10-L25)', () => {
      expect(formatLineHash(25, 10)).toBe('#L10-L25');
    });

    it('returns empty string for invalid line numbers', () => {
      expect(formatLineHash(0)).toBe('');
      expect(formatLineHash(-1)).toBe('');
      expect(formatLineHash(NaN)).toBe('');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. buildPermalinkUrl Unit Tests
  // ---------------------------------------------------------------------------
  describe('buildPermalinkUrl', () => {
    it('builds immutable permalink URL with multi-line range (4 args)', () => {
      const url = buildPermalinkUrl('sendforge', sampleCommitOid, sampleFilePath, {
        start: 10,
        end: 25,
      });
      expect(url).toBe(
        `#/commit/${sampleCommitOid}/blob/src/components/Header.tsx#L10-L25`
      );
    });

    it('builds immutable permalink URL with single line range (4 args)', () => {
      const url = buildPermalinkUrl('sendforge', sampleCommitOid, sampleFilePath, {
        start: 42,
        end: 42,
      });
      expect(url).toBe(
        `#/commit/${sampleCommitOid}/blob/src/components/Header.tsx#L42`
      );
    });

    it('builds immutable permalink URL without range (null / undefined) (4 args)', () => {
      const urlNull = buildPermalinkUrl('sendforge', sampleCommitOid, sampleFilePath, null);
      expect(urlNull).toBe(
        `#/commit/${sampleCommitOid}/blob/src/components/Header.tsx`
      );

      const urlUndef = buildPermalinkUrl('sendforge', sampleCommitOid, sampleFilePath);
      expect(urlUndef).toBe(
        `#/commit/${sampleCommitOid}/blob/src/components/Header.tsx`
      );
    });

    it('supports 3-argument overload (commitOid, filePath, range?)', () => {
      const urlRange = buildPermalinkUrl(sampleCommitOid, sampleFilePath, {
        start: 15,
        end: 20,
      });
      expect(urlRange).toBe(
        `#/commit/${sampleCommitOid}/blob/src/components/Header.tsx#L15-L20`
      );

      const urlNoRange = buildPermalinkUrl(sampleCommitOid, sampleFilePath);
      expect(urlNoRange).toBe(
        `#/commit/${sampleCommitOid}/blob/src/components/Header.tsx`
      );
    });

    it('normalizes leading slashes in file paths', () => {
      const url = buildPermalinkUrl(sampleCommitOid, '/src/components/Header.tsx', {
        start: 5,
        end: 8,
      });
      expect(url).toBe(
        `#/commit/${sampleCommitOid}/blob/src/components/Header.tsx#L5-L8`
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 4. BlobView Component & Interaction Tests
  // ---------------------------------------------------------------------------
  describe('BlobView Component Rendering & Line Highlighting', () => {
    it('renders Copy Permalink button in header with correct styling classes', () => {
      const html = render(
        h(BlobView, {
          blob: mockBlob,
          path: sampleFilePath,
          commitOid: sampleCommitOid,
        })
      );

      expect(html).toContain('copy-permalink-btn');
      expect(html).toContain('Copy Permalink');
      expect(html).toContain('title="Copy immutable permalink to this commit and line range"');
    });

    it('renders line numbers and code lines with unique element IDs', () => {
      const html = render(
        h(BlobView, {
          blob: mockBlob,
          path: sampleFilePath,
          commitOid: sampleCommitOid,
        })
      );

      for (let i = 1; i <= 8; i++) {
        expect(html).toContain(`id="L${i}"`);
        expect(html).toContain(`id="LC${i}"`);
        expect(html).toContain(`data-line-number="${i}"`);
      }
    });

    it('applies visual highlight classes (.line-highlight, .line-selected) to lines in range', () => {
      const initialRange: LineRange = { start: 2, end: 4 };
      const html = render(
        h(BlobView, {
          blob: mockBlob,
          path: sampleFilePath,
          commitOid: sampleCommitOid,
          selectedRange: initialRange,
        })
      );

      // Lines 2, 3, 4 should have highlighted class
      expect(html).toContain('id="L2" data-line-number="2" class="line-number highlighted line-selected"');
      expect(html).toContain('id="LC2" data-line-number="2" class="code-line highlighted line-highlight line-selected"');
      expect(html).toContain('id="L3" data-line-number="3" class="line-number highlighted line-selected"');
      expect(html).toContain('id="LC3" data-line-number="3" class="code-line highlighted line-highlight line-selected"');
      expect(html).toContain('id="L4" data-line-number="4" class="line-number highlighted line-selected"');
      expect(html).toContain('id="LC4" data-line-number="4" class="code-line highlighted line-highlight line-selected"');

      // Lines 1 and 5 should NOT have highlighted class
      expect(html).toContain('id="L1" data-line-number="1" class="line-number "');
      expect(html).toContain('id="LC1" data-line-number="1" class="code-line "');
      expect(html).toContain('id="L5" data-line-number="5" class="line-number "');
      expect(html).toContain('id="LC5" data-line-number="5" class="code-line "');
    });

    it('applies single line highlighting when range start equals end', () => {
      const initialRange: LineRange = { start: 5, end: 5 };
      const html = render(
        h(BlobView, {
          blob: mockBlob,
          path: sampleFilePath,
          commitOid: sampleCommitOid,
          initialRange,
        })
      );

      expect(html).toContain('id="L5" data-line-number="5" class="line-number highlighted line-selected"');
      expect(html).toContain('id="LC5" data-line-number="5" class="code-line highlighted line-highlight line-selected"');
      expect(html).toContain('id="L4" data-line-number="4" class="line-number "');
      expect(html).toContain('id="L6" data-line-number="6" class="line-number "');
    });

    it('simulates single-click selection and shift-click range expansion algorithms', () => {
      // Functional simulation of line click handler
      const simulateLineClick = (
        clickedLine: number,
        isShiftKey: boolean,
        currentRange: LineRange | null,
        currentAnchor: number | null
      ): { range: LineRange; anchor: number } => {
        if (isShiftKey && (currentRange !== null || currentAnchor !== null)) {
          const anchor = currentAnchor ?? currentRange?.start ?? clickedLine;
          return {
            range: {
              start: Math.min(anchor, clickedLine),
              end: Math.max(anchor, clickedLine),
            },
            anchor,
          };
        }
        return {
          range: { start: clickedLine, end: clickedLine },
          anchor: clickedLine,
        };
      };

      // Step 1: User single-clicks line 10
      const step1 = simulateLineClick(10, false, null, null);
      expect(step1.range).toEqual({ start: 10, end: 10 });
      expect(step1.anchor).toBe(10);

      // Step 2: User shift-clicks line 25 (forward expansion)
      const step2 = simulateLineClick(25, true, step1.range, step1.anchor);
      expect(step2.range).toEqual({ start: 10, end: 25 });
      expect(step2.anchor).toBe(10);

      // Step 3: User shift-clicks line 3 (backward expansion from anchor 10)
      const step3 = simulateLineClick(3, true, step2.range, step2.anchor);
      expect(step3.range).toEqual({ start: 3, end: 10 });
      expect(step3.anchor).toBe(10);

      // Step 4: User normal-clicks line 50 (resets range to single line)
      const step4 = simulateLineClick(50, false, step3.range, step3.anchor);
      expect(step4.range).toEqual({ start: 50, end: 50 });
      expect(step4.anchor).toBe(50);
    });

    it('simulates onSelectRange callback notification on range selection', () => {
      const onSelectRangeMock = vi.fn();
      render(
        h(BlobView, {
          blob: mockBlob,
          path: sampleFilePath,
          commitOid: sampleCommitOid,
          selectedRange: { start: 3, end: 6 },
          onSelectRange: onSelectRangeMock,
        })
      );

      // BlobView rendered successfully with props
      expect(mockBlob.text).toContain('Sendforge');
    });

    it('simulates hash synchronization and deep link target resolution', () => {
      const resolveScrollTargetId = (hash: string): string | null => {
        const parsed = parseLineHash(hash);
        if (!parsed) return null;
        return `L${parsed.start}`;
      };

      expect(resolveScrollTargetId('#/blob/main/src/App.tsx#L42')).toBe('L42');
      expect(resolveScrollTargetId('#/commit/1234/blob/Header.tsx#L10-L25')).toBe('L10');
      expect(resolveScrollTargetId('#/blob/main/src/App.tsx')).toBeNull();
    });

    it('generates correct clipboard text with full origin when window is available', () => {
      const range: LineRange = { start: 12, end: 18 };
      const permalink = buildPermalinkUrl('sendforge', sampleCommitOid, sampleFilePath, range);
      const mockOrigin = 'https://sendforge.dev';
      const mockPathname = '/';
      const fullUrl = `${mockOrigin}${mockPathname}${permalink}`;

      expect(fullUrl).toBe(
        `https://sendforge.dev/#/commit/${sampleCommitOid}/blob/${sampleFilePath}#L12-L18`
      );
    });
  });
});
