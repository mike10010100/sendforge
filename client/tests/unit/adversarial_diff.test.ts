import { describe, expect, it } from 'vitest';
import { computeFileDiff } from '../../src/worker/diff-algo.js';
import { diffClient } from '../../src/worker/diff-client.js';

describe('Adversarial & Stress Tests: Diff Algorithm & Web Worker', () => {
  it('handles completely identical large files (1,000 lines) with 0 diff hunks', () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `Line ${i}: function test_${i}() { return ${i}; }`);
    const content = lines.join('\n');

    const diff = computeFileDiff('large.ts', 'large.ts', content, content);
    expect(diff.additions).toBe(0);
    expect(diff.deletions).toBe(0);
    expect(diff.hunks).toEqual([]);
    expect(diff.splitRows).toEqual([]);
    expect(diff.isBinary).toBe(false);
  });

  it('handles massive file additions (5,000 lines)', () => {
    const lines = Array.from({ length: 5000 }, (_, i) => `// Added line ${i}`);
    const newContent = lines.join('\n');

    const start = performance.now();
    const diff = computeFileDiff(null, 'massive_new.ts', null, newContent);
    const duration = performance.now() - start;

    expect(diff.additions).toBe(5000);
    expect(diff.deletions).toBe(0);
    expect(diff.hunks.length).toBe(1);
    expect(diff.hunks[0]?.newLines).toBe(5000);
    expect(diff.splitRows.length).toBe(5000);
    expect(duration).toBeLessThan(1000); // Must be fast
  });

  it('handles massive file deletions (5,000 lines)', () => {
    const lines = Array.from({ length: 5000 }, (_, i) => `// Deleted line ${i}`);
    const oldContent = lines.join('\n');

    const start = performance.now();
    const diff = computeFileDiff('massive_old.ts', null, oldContent, null);
    const duration = performance.now() - start;

    expect(diff.additions).toBe(0);
    expect(diff.deletions).toBe(5000);
    expect(diff.hunks.length).toBe(1);
    expect(diff.hunks[0]?.oldLines).toBe(5000);
    expect(diff.splitRows.length).toBe(5000);
    expect(duration).toBeLessThan(1000);
  });

  it('handles prefix and suffix matching on large files with modifications in the middle', () => {
    const prefix = Array.from({ length: 500 }, (_, i) => `// Prefix line ${i}`);
    const suffix = Array.from({ length: 500 }, (_, i) => `// Suffix line ${i}`);

    const oldMiddle = ['const a = 1;', 'const b = 2;'];
    const newMiddle = ['const a = 100;', 'const b = 200;', 'const c = 300;'];

    const oldText = [...prefix, ...oldMiddle, ...suffix].join('\n');
    const newText = [...prefix, ...newMiddle, ...suffix].join('\n');

    const diff = computeFileDiff('app.ts', 'app.ts', oldText, newText, 3);
    expect(diff.additions).toBe(3);
    expect(diff.deletions).toBe(2);
    expect(diff.hunks.length).toBe(1);

    const hunk = diff.hunks[0];
    expect(hunk).toBeDefined();
    // Context lines before and after middle
    expect(hunk?.lines.some((l) => l.type === 'delete')).toBe(true);
    expect(hunk?.lines.some((l) => l.type === 'add')).toBe(true);
    expect(hunk?.lines.some((l) => l.type === 'context')).toBe(true);
  });

  it('handles mixed CRLF and LF line endings gracefully', () => {
    const oldText = 'line1\r\nline2\r\nline3\r\n';
    const newText = 'line1\nline2 modified\nline3\n';

    const diff = computeFileDiff('crlf.txt', 'crlf.txt', oldText, newText);
    expect(diff.additions).toBe(1);
    expect(diff.deletions).toBe(1);
  });

  it('handles extreme line lengths (minified code / 50,000 char line)', () => {
    const longLine1 = 'a'.repeat(50000);
    const longLine2 = 'a'.repeat(49999) + 'b';

    const diff = computeFileDiff('bundle.min.js', 'bundle.min.js', longLine1, longLine2);
    expect(diff.additions).toBe(1);
    expect(diff.deletions).toBe(1);
    expect(diff.hunks.length).toBe(1);
  });

  it('handles Unicode, emojis, and RTL text differences', () => {
    const oldText = '🦀 Rust is fast\n🚀 Launch\nשלום עולם';
    const newText = '🦀 Rust is fast and safe\n🛸 UFO\nשלום עולם ומלואו';

    const diff = computeFileDiff('unicode.txt', 'unicode.txt', oldText, newText);
    expect(diff.additions).toBe(3);
    expect(diff.deletions).toBe(3);
    expect(diff.hunks.length).toBe(1);
  });

  it('handles concurrent diff requests through DiffClient without race conditions', async () => {
    const tasks = Array.from({ length: 20 }, (_, i) => {
      const oldT = `file ${i} version 1`;
      const newT = `file ${i} version 2`;
      return diffClient.computeDiff(`file_${i}.txt`, `file_${i}.txt`, oldT, newT);
    });

    const results = await Promise.all(tasks);
    expect(results.length).toBe(20);
    for (let i = 0; i < 20; i++) {
      const res = results[i];
      expect(res?.oldPath).toBe(`file_${i}.txt`);
      expect(res?.additions).toBe(1);
      expect(res?.deletions).toBe(1);
    }
  });
});
