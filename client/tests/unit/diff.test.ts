import { describe, expect, it } from 'vitest';
import {
  buildHunks,
  buildSplitRows,
  computeEditSequence,
  computeFileDiff,
} from '../../src/worker/diff-algo.js';
import { diffClient } from '../../src/worker/diff-client.js';

describe('Diff Engine & Myers Algorithm', () => {
  it('handles identical files (no changes)', () => {
    const text = 'line 1\nline 2\nline 3';
    const diff = computeFileDiff('foo.txt', 'foo.txt', text, text);

    expect(diff.additions).toBe(0);
    expect(diff.deletions).toBe(0);
    expect(diff.hunks).toEqual([]);
    expect(diff.splitRows).toEqual([]);
    expect(diff.isBinary).toBe(false);
  });

  it('handles newly created file', () => {
    const newText = 'alpha\nbeta\ngamma';
    const diff = computeFileDiff(null, 'new.txt', null, newText);

    expect(diff.oldPath).toBeNull();
    expect(diff.newPath).toBe('new.txt');
    expect(diff.additions).toBe(3);
    expect(diff.deletions).toBe(0);
    expect(diff.hunks.length).toBe(1);

    const hunk = diff.hunks[0];
    expect(hunk?.header).toBe('@@ -0,0 +1,3 @@');
    expect(hunk?.lines.every((l) => l.type === 'add')).toBe(true);

    expect(diff.splitRows.length).toBe(3);
    expect(diff.splitRows.every((r) => r.left.type === 'empty' && r.right.type === 'add')).toBe(true);
  });

  it('handles deleted file', () => {
    const oldText = 'line A\nline B';
    const diff = computeFileDiff('old.txt', null, oldText, null);

    expect(diff.oldPath).toBe('old.txt');
    expect(diff.newPath).toBeNull();
    expect(diff.additions).toBe(0);
    expect(diff.deletions).toBe(2);
    expect(diff.hunks.length).toBe(1);

    const hunk = diff.hunks[0];
    expect(hunk?.header).toBe('@@ -1,2 +0,0 @@');
    expect(hunk?.lines.every((l) => l.type === 'delete')).toBe(true);

    expect(diff.splitRows.length).toBe(2);
    expect(diff.splitRows.every((r) => r.left.type === 'delete' && r.right.type === 'empty')).toBe(true);
  });

  it('computes line additions, deletions, and context hunks', () => {
    const oldLines = ['one', 'two', 'three', 'four', 'five'];
    const newLines = ['one', 'two modified', 'three', 'four', 'five added'];

    const ops = computeEditSequence(oldLines, newLines);
    expect(ops.some((o) => o.type === 'delete')).toBe(true);
    expect(ops.some((o) => o.type === 'add')).toBe(true);

    const hunks = buildHunks(ops, 1);
    expect(hunks.length).toBeGreaterThan(0);

    const splitRows = buildSplitRows(hunks);
    expect(splitRows.length).toBeGreaterThan(0);
  });

  it('correctly reports binary file differences', () => {
    const diff = computeFileDiff('image.png', 'image.png', null, null, 3, true);
    expect(diff.isBinary).toBe(true);
    expect(diff.hunks).toEqual([]);
  });

  it('computes diff via DiffClient wrapper', async () => {
    const oldText = 'function hello() {\n  return 1;\n}\n';
    const newText = 'function hello() {\n  return 2;\n}\n';

    const diff = await diffClient.computeDiff('code.ts', 'code.ts', oldText, newText);

    expect(diff.additions).toBe(1);
    expect(diff.deletions).toBe(1);
    expect(diff.hunks.length).toBe(1);

    const lineTypes = diff.hunks[0]?.lines.map((l) => l.type);
    expect(lineTypes).toContain('delete');
    expect(lineTypes).toContain('add');
    expect(lineTypes).toContain('context');
  });

  it('guarantees every context edit op matches identical lines across tricky middle mutations', () => {
    const oldLines = [
      'Initial line 1',
      'Initial line 2',
      'Initial line 3',
      'Bob replacement line A',
      'Bob replacement line B',
      'Initial line 8',
      'Initial line 9',
      'Initial line 10',
    ];
    const newLines = [
      'Charlie top 1',
      'Charlie top 2',
      'Initial line 1',
      'Initial line 2',
      'Initial line 3',
      'Bob replacement line A',
      'Bob replacement line B',
      'Initial line 8',
      'Initial line 9',
    ];

    const ops = computeEditSequence(oldLines, newLines);

    // Validate that every context op has identical strings in old and new
    for (const op of ops) {
      if (op.type === 'context') {
        expect(op.oldIndex).toBeDefined();
        expect(op.newIndex).toBeDefined();
        if (op.oldIndex !== undefined && op.newIndex !== undefined) {
          expect(oldLines[op.oldIndex]).toBe(newLines[op.newIndex]);
          expect(op.line).toBe(oldLines[op.oldIndex]);
        }
      }
    }

    // Validate edit script reconstructs newLines from oldLines
    const reconstructed: string[] = [];
    for (const op of ops) {
      if (op.type === 'context' || op.type === 'add') {
        reconstructed.push(op.line);
      }
    }
    expect(reconstructed).toEqual(newLines);
  });

  it('handles complete swaps, interleaving, and empty lines accurately', () => {
    const oldLines = ['alpha', 'beta', 'gamma', '', 'delta', 'epsilon'];
    const newLines = ['epsilon', 'delta', '', 'gamma', 'beta', 'alpha'];

    const ops = computeEditSequence(oldLines, newLines);

    for (const op of ops) {
      if (op.type === 'context' && op.oldIndex !== undefined && op.newIndex !== undefined) {
        expect(oldLines[op.oldIndex]).toBe(newLines[op.newIndex]);
      }
    }

    const reconstructed: string[] = [];
    for (const op of ops) {
      if (op.type === 'context' || op.type === 'add') {
        reconstructed.push(op.line);
      }
    }
    expect(reconstructed).toEqual(newLines);
  });
});
