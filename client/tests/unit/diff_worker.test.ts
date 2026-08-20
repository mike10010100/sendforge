import { afterEach, describe, expect, it } from 'vitest';
import {
  buildHunks,
  buildSplitRows,
  computeEditSequence,
  computeFileDiff,
} from '../../src/worker/diff-algo.js';
import { diffClient } from '../../src/worker/diff-client.js';

describe('Web Worker Diff Engine & Myers Algorithm (diff_worker.test.ts)', () => {
  afterEach(() => {
    diffClient.terminate();
  });

  it('computes diffs accurately for newly created files', () => {
    const diff = computeFileDiff(null, 'hello.txt', null, 'Line 1\nLine 2\nLine 3\n');
    expect(diff.additions).toBe(4);
    expect(diff.deletions).toBe(0);
    expect(diff.hunks.length).toBe(1);
    expect(diff.hunks[0]?.header).toBe('@@ -0,0 +1,4 @@');
  });

  it('computes diffs accurately for deleted files', () => {
    const diff = computeFileDiff('goodbye.txt', null, 'Line A\nLine B\n', null);
    expect(diff.additions).toBe(0);
    expect(diff.deletions).toBe(3);
    expect(diff.hunks.length).toBe(1);
    expect(diff.hunks[0]?.header).toBe('@@ -1,3 +0,0 @@');
  });

  it('clusters close edits and separates distant edits based on contextLines', () => {
    const oldLines = [
      'Line 1', 'Line 2', 'Line 3', 'Line 4', 'Line 5',
      'Line 6', 'Line 7', 'Line 8', 'Line 9', 'Line 10',
      'Line 11', 'Line 12', 'Line 13', 'Line 14', 'Line 15', 'Line 16',
    ];
    const newLines = [
      'Line 1 MOD', 'Line 2', 'Line 3', 'Line 4', 'Line 5',
      'Line 6', 'Line 7', 'Line 8', 'Line 9', 'Line 10',
      'Line 11', 'Line 12', 'Line 13', 'Line 14', 'Line 15 MOD', 'Line 16',
    ];

    const ops = computeEditSequence(oldLines, newLines);
    const hunks = buildHunks(ops, 2);

    expect(hunks.length).toBe(2);
    expect(hunks[0]?.lines[0]?.content).toBe('Line 1');
    expect(hunks[1]?.lines[hunks[1].lines.length - 1]?.content).toBe('Line 16');
  });

  it('formats side-by-side split rows with correct left and right line alignment', () => {
    const oldLines = ['Alpha', 'Beta to delete', 'Gamma'];
    const newLines = ['Alpha', 'Beta added', 'Gamma'];

    const ops = computeEditSequence(oldLines, newLines);
    const hunks = buildHunks(ops, 3);
    const splitRows = buildSplitRows(hunks);

    expect(splitRows.length).toBe(3);
    expect(splitRows[0]?.left.type).toBe('context');
    expect(splitRows[0]?.right.type).toBe('context');
    expect(splitRows[1]?.left.type).toBe('delete');
    expect(splitRows[1]?.right.type).toBe('add');
    expect(splitRows[2]?.left.type).toBe('context');
    expect(splitRows[2]?.right.type).toBe('context');
  });

  it('computes batch diffs via DiffClient wrapper seamlessly', async () => {
    const batchItems = [
      {
        oldPath: 'a.txt',
        newPath: 'a.txt',
        oldContent: '1\n2\n3',
        newContent: '1\n2 modified\n3',
        contextLines: 3,
      },
      {
        oldPath: null,
        newPath: 'b.txt',
        oldContent: null,
        newContent: 'fresh file\n',
        contextLines: 3,
      },
    ];

    const diffs = await diffClient.computeBatchDiff(batchItems);
    expect(diffs.length).toBe(2);

    expect(diffs[0]?.newPath).toBe('a.txt');
    expect(diffs[0]?.additions).toBe(1);
    expect(diffs[0]?.deletions).toBe(1);

    expect(diffs[1]?.newPath).toBe('b.txt');
    expect(diffs[1]?.additions).toBe(2);
  });

  it('handles computeDiff single-file method and empty batches', async () => {
    const emptyBatch = await diffClient.computeBatchDiff([]);
    expect(emptyBatch).toEqual([]);

    const single = await diffClient.computeDiff(
      'main.ts',
      'main.ts',
      'const a = 1;',
      'const a = 2;'
    );
    expect(single.additions).toBe(1);
    expect(single.deletions).toBe(1);
    expect(single.hunks.length).toBe(1);
  });

  it('handles identical contents and binary flag in computeFileDiff', () => {
    const identical = computeFileDiff('same.txt', 'same.txt', 'identical text', 'identical text');
    expect(identical.additions).toBe(0);
    expect(identical.deletions).toBe(0);
    expect(identical.hunks).toEqual([]);

    const binary = computeFileDiff('bin.dat', 'bin.dat', 'old', 'new', 3, true);
    expect(binary.isBinary).toBe(true);
    expect(binary.additions).toBe(0);
    expect(binary.deletions).toBe(0);
  });
});
