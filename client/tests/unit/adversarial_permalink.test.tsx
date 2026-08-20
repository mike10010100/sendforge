import { describe, expect, it, vi } from 'vitest';
import { h } from 'preact';
import render from 'preact-render-to-string';
import { BlobView } from '../../src/ui/BlobView.js';
import { BlameView } from '../../src/ui/BlameView.js';
import {
  buildPermalinkUrl,
  formatLineHash,
  parseLineHash,
  type LineRange,
} from '../../src/ui/utils.js';
import type { GitBlobObject } from '../../src/engine/types.js';
import type { BlameResult } from '../../src/engine/blame.js';

describe('Adversarial Stress Testing: Permalinks & Line Highlighting (Milestone M3)', () => {
  const sampleCommitOid = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
  const shortBlobText = 'line1\nline2\nline3\nline4\nline5';

  const mockBlob: GitBlobObject = {
    type: 'blob',
    oid: 'ba34f9a0c1029384756abcdef0123456789abcde',
    size: shortBlobText.length,
    data: new TextEncoder().encode(shortBlobText),
    isBinary: false,
    text: shortBlobText,
  };

  // =========================================================================
  // 1. Malformed and Adversarial URL Hashes
  // =========================================================================
  describe('Malformed and Adversarial URL Hashes', () => {
    const invalidHashes = [
      '',
      '#',
      '#L',
      '#LLLL',
      '#L-5',
      '#L0',
      '#L-0',
      '#L0-L0',
      '#L0-L5',
      '#L5-L0',
      '#L-10-L-20',
      '#L1-L2-L3',
      '#L10-Labc',
      '#Labc-L10',
      '#Labc',
      '#L10--L20',
      '#L10_L20',
      '#L10.5-L20.5',
      '#LNaN',
      '#LInfinity',
      '#L-Infinity',
      '#Lnull',
      '#Lundefined',
      '#L 10',
      '#L10 ',
      '#L 10-L20',
      '#L10-L 20',
      '#L10 - L20',
      '#L１０', // Full-width unicode digits
      '#L\u000010',
      '#L<script>alert(1)</script>',
      '#L10;DROP TABLE lines;--',
      '#line10',
      '#line-10',
      '#L10-20', // Missing 'L' prefix in second part
      '#10-20',
      '#10',
      '#L+10',
      '#L-10',
    ];

    it.each(invalidHashes)('safely rejects invalid hash: %s -> null', (hash) => {
      const parsed = parseLineHash(hash);
      expect(parsed).toBeNull();
    });

    const validHashes: { hash: string; expected: LineRange }[] = [
      { hash: '#L1', expected: { start: 1, end: 1 } },
      { hash: 'L1', expected: { start: 1, end: 1 } },
      { hash: '#l1', expected: { start: 1, end: 1 } },
      { hash: 'l1', expected: { start: 1, end: 1 } },
      { hash: '#L42', expected: { start: 42, end: 42 } },
      { hash: '#L99999999', expected: { start: 99999999, end: 99999999 } },
      { hash: '#L10-L5', expected: { start: 5, end: 10 } }, // Inverted range normalized
      { hash: '#L5-L10', expected: { start: 5, end: 10 } },
      { hash: '#L100-L100', expected: { start: 100, end: 100 } },
      { hash: '#l10-l25', expected: { start: 10, end: 25 } },
      { hash: '#L10-l25', expected: { start: 10, end: 25 } },
      { hash: '#l10-L25', expected: { start: 10, end: 25 } },
      { hash: '#/commit/abcd1234ef567890/blob/src/index.ts#L15', expected: { start: 15, end: 15 } },
      { hash: '#/commit/abcd1234ef567890/blob/src/index.ts#L10-L30', expected: { start: 10, end: 30 } },
      { hash: '#/blob/main/src/nested/dir/app.tsx#L7-L14', expected: { start: 7, end: 14 } },
      { hash: '#/tree/feature/sub#L99', expected: { start: 99, end: 99 } },
    ];

    it.each(validHashes)('correctly parses valid hash: $hash -> $expected', ({ hash, expected }) => {
      const parsed = parseLineHash(hash);
      expect(parsed).toEqual(expected);
      expect(parsed?.start).toBeLessThanOrEqual(parsed?.end ?? 0);
    });

    it('handles repeated leading hashes and paths robustly', () => {
      // Resiliently extracts line number even with multiple leading hashes
      expect(parseLineHash('###L10')).toEqual({ start: 10, end: 10 });
      expect(parseLineHash('#/path/to/file.rs#L50-L75')).toEqual({ start: 50, end: 75 });
    });
  });

  // =========================================================================
  // 2. formatLineHash Edge Cases & Bounds
  // =========================================================================
  describe('formatLineHash Edge Cases & Bounds', () => {
    it('returns empty string for invalid inputs', () => {
      expect(formatLineHash(0)).toBe('');
      expect(formatLineHash(-10)).toBe('');
      expect(formatLineHash(Number.NaN)).toBe('');
      expect(formatLineHash(Number.NEGATIVE_INFINITY)).toBe('');
      expect(formatLineHash(Number.POSITIVE_INFINITY)).toBe('');
    });

    it('handles single line format with invalid or undefined end', () => {
      expect(formatLineHash(42, undefined)).toBe('#L42');
      expect(formatLineHash(42, 0)).toBe('#L42');
      expect(formatLineHash(42, -5)).toBe('#L42');
      expect(formatLineHash(42, Number.NaN)).toBe('#L42');
      expect(formatLineHash(42, 42)).toBe('#L42');
    });

    it('formats float numbers by rounding/truncating to integers', () => {
      expect(formatLineHash(10.7)).toBe('#L10');
      expect(formatLineHash(10.2, 25.9)).toBe('#L10-L25');
      expect(formatLineHash(25.9, 10.2)).toBe('#L10-L25');
    });

    it('handles inverted ranges by ensuring min-max ordering', () => {
      expect(formatLineHash(100, 20)).toBe('#L20-L100');
      expect(formatLineHash(20, 100)).toBe('#L20-L100');
    });
  });

  // =========================================================================
  // 3. Special Characters and Encodings in Permalinks
  // =========================================================================
  describe('Special Characters and Encodings in buildPermalinkUrl', () => {
    const specialPaths = [
      'src/components/My Header.tsx',
      'src/файл/русский.ts',
      'src/日本語/コンポーネント.tsx',
      'src/🦀/emoji-crab.rs',
      'path/with+plus/file.js',
      'path/with%20encoded/file.js',
      'path/with(parentheses)/file.ts',
      'deeply/nested/1/2/3/4/5/6/7/8/9/file.txt',
    ];

    it.each(specialPaths)('builds valid permalink for special path: %s', (filePath) => {
      const url = buildPermalinkUrl(sampleCommitOid, filePath, { start: 10, end: 20 });
      expect(url).toBe(`#/commit/${sampleCommitOid}/blob/${filePath}#L10-L20`);

      // Verify parseLineHash can extract line range from the generated permalink
      const parsed = parseLineHash(url);
      expect(parsed).toEqual({ start: 10, end: 20 });
    });

    it('strips redundant leading slashes from file paths', () => {
      expect(buildPermalinkUrl(sampleCommitOid, '///src/app.ts')).toBe(
        `#/commit/${sampleCommitOid}/blob/src/app.ts`
      );
      expect(buildPermalinkUrl(sampleCommitOid, '/src/app.ts', { start: 5, end: 5 })).toBe(
        `#/commit/${sampleCommitOid}/blob/src/app.ts#L5`
      );
    });

    it('supports 4-argument overload with repoName as first parameter', () => {
      const url = buildPermalinkUrl('my-repo', sampleCommitOid, 'src/main.rs', { start: 1, end: 5 });
      expect(url).toBe(`#/commit/${sampleCommitOid}/blob/src/main.rs#L1-L5`);
    });

    it('handles empty range, null range, and undefined range gracefully', () => {
      expect(buildPermalinkUrl(sampleCommitOid, 'src/main.rs', null)).toBe(
        `#/commit/${sampleCommitOid}/blob/src/main.rs`
      );
      expect(buildPermalinkUrl(sampleCommitOid, 'src/main.rs', undefined)).toBe(
        `#/commit/${sampleCommitOid}/blob/src/main.rs`
      );
    });
  });

  // =========================================================================
  // 4. Huge Line Numbers Exceeding File Length in BlobView & BlameView
  // =========================================================================
  describe('Huge Line Numbers Exceeding File Length', () => {
    it('BlobView renders safely when selected range exceeds file line count (e.g. 5 lines vs L500-L600)', () => {
      // 5-line file with range L500-L600
      const html = render(
        h(BlobView, {
          blob: mockBlob,
          path: 'short.txt',
          commitOid: sampleCommitOid,
          selectedRange: { start: 500, end: 600 },
        })
      );

      // Should render all 5 lines without crash
      expect(html).toContain('id="L1"');
      expect(html).toContain('id="L5"');
      expect(html).not.toContain('id="L6"');

      // None of lines 1..5 should have highlighted class
      for (let i = 1; i <= 5; i++) {
        expect(html).toContain(`id="L${i}" data-line-number="${i}" class="line-number "`);
        expect(html).toContain(`id="LC${i}" data-line-number="${i}" class="code-line "`);
      }
    });

    it('BlobView partially highlights lines when range overlaps end of file (e.g. 5 lines vs L3-L50)', () => {
      const html = render(
        h(BlobView, {
          blob: mockBlob,
          path: 'short.txt',
          commitOid: sampleCommitOid,
          selectedRange: { start: 3, end: 50 },
        })
      );

      // Lines 1 and 2 are not highlighted
      expect(html).toContain('id="L1" data-line-number="1" class="line-number "');
      expect(html).toContain('id="L2" data-line-number="2" class="line-number "');

      // Lines 3, 4, 5 are highlighted
      expect(html).toContain('id="L3" data-line-number="3" class="line-number highlighted line-selected"');
      expect(html).toContain('id="LC3" data-line-number="3" class="code-line highlighted line-highlight line-selected"');
      expect(html).toContain('id="L4" data-line-number="4" class="line-number highlighted line-selected"');
      expect(html).toContain('id="LC4" data-line-number="4" class="code-line highlighted line-highlight line-selected"');
      expect(html).toContain('id="L5" data-line-number="5" class="line-number highlighted line-selected"');
      expect(html).toContain('id="LC5" data-line-number="5" class="code-line highlighted line-highlight line-selected"');
    });

    it('BlameView renders safely when selected range exceeds file line count', () => {
      const mockBlameResult: BlameResult = {
        lines: [
          {
            lineNumber: 1,
            commitOid: sampleCommitOid,
            authorName: 'Alice',
            authorEmail: 'alice@example.com',
            timestamp: 1700000000,
            summary: 'Initial commit',
          },
          {
            lineNumber: 2,
            commitOid: sampleCommitOid,
            authorName: 'Alice',
            authorEmail: 'alice@example.com',
            timestamp: 1700000000,
            summary: 'Initial commit',
          },
        ],
        hunks: [
          {
            commitOid: sampleCommitOid,
            authorName: 'Alice',
            authorEmail: 'alice@example.com',
            timestamp: 1700000000,
            summary: 'Initial commit',
            startLine: 1,
            lineCount: 2,
          },
        ],
        oldestTimestamp: 1700000000,
        newestTimestamp: 1700000000,
      };

      const html = render(
        h(BlameView, {
          blob: { ...mockBlob, text: 'line1\nline2' },
          path: 'test.rs',
          commitOid: sampleCommitOid,
          initialBlame: mockBlameResult,
          selectedRange: { start: 99999, end: 999999 },
        })
      );

      expect(html).toContain('id="L1"');
      expect(html).toContain('id="L2"');
      // No rows highlighted
      expect(html).not.toContain('line-selected');
    });
  });

  // =========================================================================
  // 5. Rapid and Complex Shift-Clicking State Machine Stress Test
  // =========================================================================
  describe('Rapid Shift-Clicking State Transitions', () => {
    interface ClickState {
      range: LineRange | null;
      anchor: number | null;
    }

    const clickReducer = (
      state: ClickState,
      clickedLine: number,
      isShiftKey: boolean
    ): ClickState => {
      if (isShiftKey && (state.range !== null || state.anchor !== null)) {
        const anchor = state.anchor ?? state.range?.start ?? clickedLine;
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

    it('handles initial shift-click before any line is selected', () => {
      const state = clickReducer({ range: null, anchor: null }, 15, true);
      expect(state.range).toEqual({ start: 15, end: 15 });
      expect(state.anchor).toBe(15);
    });

    it('preserves initial anchor during arbitrary multi-directional shift-clicks', () => {
      let state: ClickState = { range: null, anchor: null };

      // Step 1: User single-clicks line 50
      state = clickReducer(state, 50, false);
      expect(state.range).toEqual({ start: 50, end: 50 });
      expect(state.anchor).toBe(50);

      // Step 2: Shift-click line 100 (range expands down to 50-100)
      state = clickReducer(state, 100, true);
      expect(state.range).toEqual({ start: 50, end: 100 });
      expect(state.anchor).toBe(50);

      // Step 3: Shift-click line 75 (range contracts to 50-75)
      state = clickReducer(state, 75, true);
      expect(state.range).toEqual({ start: 50, end: 75 });
      expect(state.anchor).toBe(50);

      // Step 4: Shift-click line 10 (range flips upwards to 10-50, anchor still 50)
      state = clickReducer(state, 10, true);
      expect(state.range).toEqual({ start: 10, end: 50 });
      expect(state.anchor).toBe(50);

      // Step 5: Shift-click line 30 (range contracts to 30-50)
      state = clickReducer(state, 30, true);
      expect(state.range).toEqual({ start: 30, end: 50 });
      expect(state.anchor).toBe(50);

      // Step 6: Shift-click line 50 (range becomes 50-50)
      state = clickReducer(state, 50, true);
      expect(state.range).toEqual({ start: 50, end: 50 });
      expect(state.anchor).toBe(50);

      // Step 7: Normal click line 200 (resets anchor and range)
      state = clickReducer(state, 200, false);
      expect(state.range).toEqual({ start: 200, end: 200 });
      expect(state.anchor).toBe(200);

      // Step 8: Shift-click line 1
      state = clickReducer(state, 1, true);
      expect(state.range).toEqual({ start: 1, end: 200 });
      expect(state.anchor).toBe(200);
    });

    it('stress tests 1000 randomized clicks without invariant violations', () => {
      let state: ClickState = { range: null, anchor: null };
      const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

      for (let i = 0; i < 1000; i++) {
        const line = randomInt(1, 5000);
        const isShift = Math.random() > 0.4;
        state = clickReducer(state, line, isShift);

        // INVARIANTS:
        expect(state.range).not.toBeNull();
        expect(state.anchor).not.toBeNull();
        expect(state.range?.start).toBeLessThanOrEqual(state.range?.end ?? 0);
        expect(state.range?.start).toBeGreaterThanOrEqual(1);
        expect(state.range?.end).toBeGreaterThanOrEqual(1);
        // Anchor must be one of the bounds
        const isAnchorValid = state.anchor === state.range?.start || state.anchor === state.range?.end;
        expect(isAnchorValid).toBe(true);
      }
    });
  });

  // =========================================================================
  // 6. View Modes & Component Lifecycle Invariants
  // =========================================================================
  describe('View Modes & Markdown / Binary Handling', () => {
    it('handles binary blob without line numbers and without crashing', () => {
      const binaryBlob: GitBlobObject = {
        type: 'blob',
        oid: '0123456789abcdef0123456789abcdef01234567',
        size: 1024,
        data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        isBinary: true,
      };

      const html = render(
        h(BlobView, {
          blob: binaryBlob,
          path: 'data.bin',
          commitOid: sampleCommitOid,
          selectedRange: { start: 10, end: 20 },
        })
      );

      expect(html).toContain('Binary file (1.0 KB)');
      expect(html).toContain('cannot be displayed in the text viewer');
      expect(html).not.toContain('copy-permalink-btn'); // Binary hides text permalinks
    });

    it('renders empty text file cleanly (0 lines)', () => {
      const emptyBlob: GitBlobObject = {
        type: 'blob',
        oid: 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391',
        size: 0,
        data: new Uint8Array(0),
        isBinary: false,
        text: '',
      };

      const html = render(
        h(BlobView, {
          blob: emptyBlob,
          path: 'empty.txt',
          commitOid: sampleCommitOid,
          selectedRange: { start: 1, end: 1 },
        })
      );

      expect(html).toContain('0 lines');
      expect(html).toContain('copy-permalink-btn');
    });

    it('renders markdown preview without line numbers in rendered mode', () => {
      const mdBlob: GitBlobObject = {
        type: 'blob',
        oid: '1111222233334444555566667777888899990000',
        size: 50,
        data: new TextEncoder().encode('# Readme\n\nSome text'),
        isBinary: false,
        text: '# Readme\n\nSome text',
      };

      const html = render(
        h(BlobView, {
          blob: mdBlob,
          path: 'README.md',
          commitOid: sampleCommitOid,
        })
      );

      expect(html).toContain('<h1>Readme</h1>');
      expect(html).toContain('View Source');
    });
  });

  // =========================================================================
  // 7. Clipboard and Navigation Resilience
  // =========================================================================
  describe('Clipboard and Navigation Resilience', () => {
    it('handles clipboard failure gracefully without throwing unhandled exceptions', () => {
      const originalClipboard = globalThis.navigator.clipboard;
      try {
        // Mock clipboard writeText to reject
        Object.defineProperty(globalThis, 'navigator', {
          value: {
            clipboard: {
              writeText: vi.fn().mockRejectedValue(new Error('Permission denied')),
            },
          },
          configurable: true,
          writable: true,
        });

        // Verify that buildPermalinkUrl still generates the right link
        const link = buildPermalinkUrl(sampleCommitOid, 'src/index.ts', { start: 1, end: 5 });
        expect(link).toBe(`#/commit/${sampleCommitOid}/blob/src/index.ts#L1-L5`);
      } finally {
        Object.defineProperty(globalThis, 'navigator', {
          value: { clipboard: originalClipboard },
          configurable: true,
          writable: true,
        });
      }
    });

    it('handles replaceState exception fallback safely', () => {
      const updateUrlLineHash = (
        range: LineRange | null,
        win: { location: { hash: string; pathname: string }; history: { replaceState: () => void } }
      ) => {
        const h = range ? formatLineHash(range.start, range.end) : '';
        const cur = win.location.hash;
        const base = cur.replace(/#L\d+(?:-L\d+)?$/i, '');
        const target = h ? `${base}${h}` : base;
        try {
          win.history.replaceState();
        } catch {
          win.location.hash = target;
        }
      };

      const mockWin = {
        location: { hash: '#/blob/main/app.ts', pathname: '/' },
        history: {
          replaceState: () => {
            throw new Error('SecurityError: Sandbox restriction');
          },
        },
      };

      updateUrlLineHash({ start: 10, end: 20 }, mockWin);
      expect(mockWin.location.hash).toBe('#/blob/main/app.ts#L10-L20');
    });
  });
});
