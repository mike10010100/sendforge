import type {
  DiffHunk,
  DiffLine,
  FileDiff,
  FileDiffStats,
  SplitDiffRow,
} from './diff-types.js';

interface EditOp {
  readonly type: 'context' | 'add' | 'delete';
  readonly oldIndex?: number; // 0-indexed in oldLines
  readonly newIndex?: number; // 0-indexed in newLines
  readonly line: string;
}

/**
 * Computes the Longest Common Subsequence / Myers shortest edit script between two string arrays.
 */
export function computeEditSequence(
  oldLines: readonly string[],
  newLines: readonly string[]
): readonly EditOp[] {
  const n = oldLines.length;
  const m = newLines.length;

  if (n === 0 && m === 0) {
    return [];
  }

  if (n === 0) {
    return newLines.map((line, i) => ({
      type: 'add' as const,
      newIndex: i,
      line,
    }));
  }

  if (m === 0) {
    return oldLines.map((line, i) => ({
      type: 'delete' as const,
      oldIndex: i,
      line,
    }));
  }

  // Fast prefix / suffix stripping for performance
  let prefixCount = 0;
  while (
    prefixCount < n &&
    prefixCount < m &&
    oldLines[prefixCount] === newLines[prefixCount]
  ) {
    prefixCount++;
  }

  let suffixCount = 0;
  while (
    suffixCount < n - prefixCount &&
    suffixCount < m - prefixCount &&
    oldLines[n - 1 - suffixCount] === newLines[m - 1 - suffixCount]
  ) {
    suffixCount++;
  }

  const prefixOps: EditOp[] = [];
  for (let i = 0; i < prefixCount; i++) {
    prefixOps.push({
      type: 'context',
      oldIndex: i,
      newIndex: i,
      line: oldLines[i] ?? '',
    });
  }

  const middleOld = oldLines.slice(prefixCount, n - suffixCount);
  const middleNew = newLines.slice(prefixCount, m - suffixCount);

  const middleOps = myersDiffMiddle(middleOld, middleNew, prefixCount, prefixCount);

  const suffixOps: EditOp[] = [];
  for (let i = 0; i < suffixCount; i++) {
    const oldIdx = n - suffixCount + i;
    const newIdx = m - suffixCount + i;
    suffixOps.push({
      type: 'context',
      oldIndex: oldIdx,
      newIndex: newIdx,
      line: oldLines[oldIdx] ?? '',
    });
  }

  return [...prefixOps, ...middleOps, ...suffixOps];
}

/**
 * Standard Myers algorithm for diffing middle slices.
 */
function myersDiffMiddle(
  a: readonly string[],
  b: readonly string[],
  oldOffset: number,
  newOffset: number
): readonly EditOp[] {
  const n = a.length;
  const m = b.length;

  if (n === 0 && m === 0) return [];
  if (n === 0) {
    return b.map((line, i) => ({
      type: 'add' as const,
      newIndex: newOffset + i,
      line,
    }));
  }
  if (m === 0) {
    return a.map((line, i) => ({
      type: 'delete' as const,
      oldIndex: oldOffset + i,
      line,
    }));
  }

  const max = n + m;
  const v = new Map<number, number>();
  v.set(1, 0);

  const trace: (readonly [number, number, number])[][] = [];

  let foundD = -1;
  for (let d = 0; d <= max; d++) {
    const snapshot: [number, number, number][] = [];
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && (v.get(k - 1) ?? 0) < (v.get(k + 1) ?? 0))) {
        x = v.get(k + 1) ?? 0;
      } else {
        x = (v.get(k - 1) ?? 0) + 1;
      }

      let y = x - k;
      snapshot.push([k, x, y]);

      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }

      v.set(k, x);

      if (x >= n && y >= m) {
        foundD = d;
        trace.push(snapshot);
        break;
      }
    }
    if (foundD !== -1) {
      break;
    }
    trace.push(snapshot);
  }

  // Backtrack edit script
  let x = n;
  let y = m;
  const script: EditOp[] = [];

  for (let d = trace.length - 1; d >= 0; d--) {
    const k = x - y;
    let prevK: number;
    if (d === 0) {
      // Base case
      while (x > 0 && y > 0) {
        x--;
        y--;
        script.unshift({
          type: 'context',
          oldIndex: oldOffset + x,
          newIndex: newOffset + y,
          line: a[x] ?? '',
        });
      }
      break;
    }

    const prevSnapshotMap = new Map<number, number>();
    const prevSnapshot = trace[d - 1];
    if (prevSnapshot) {
      for (const [pk, px] of prevSnapshot) {
        prevSnapshotMap.set(pk, px);
      }
    }

    if (k === -d || (k !== d && (prevSnapshotMap.get(k - 1) ?? 0) < (prevSnapshotMap.get(k + 1) ?? 0))) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }

    const prevX = prevSnapshotMap.get(prevK) ?? 0;
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      x--;
      y--;
      script.unshift({
        type: 'context',
        oldIndex: oldOffset + x,
        newIndex: newOffset + y,
        line: a[x] ?? '',
      });
    }

    if (d > 0) {
      if (x === prevX) {
        // Insertion from b
        y--;
        script.unshift({
          type: 'add',
          newIndex: newOffset + y,
          line: b[y] ?? '',
        });
      } else {
        // Deletion from a
        x--;
        script.unshift({
          type: 'delete',
          oldIndex: oldOffset + x,
          line: a[x] ?? '',
        });
      }
    }
  }

  return script;
}

/**
 * Builds unified diff hunks from edit operations.
 */
export function buildHunks(
  ops: readonly EditOp[],
  contextLines = 3
): readonly DiffHunk[] {
  if (ops.length === 0) {
    return [];
  }

  // Check if all ops are context
  const hasChanges = ops.some((op) => op.type !== 'context');
  if (!hasChanges) {
    return [];
  }

  const hunks: DiffHunk[] = [];
  const editIndices: number[] = [];

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op && op.type !== 'context') {
      editIndices.push(i);
    }
  }

  if (editIndices.length === 0) {
    return [];
  }

  // Group edits with context into clusters
  const clusters: { start: number; end: number }[] = [];
  let currentStart = Math.max(0, (editIndices[0] ?? 0) - contextLines);
  let currentEnd = Math.min(ops.length - 1, (editIndices[0] ?? 0) + contextLines);

  for (let i = 1; i < editIndices.length; i++) {
    const idx = editIndices[i] ?? 0;
    const nextStart = Math.max(0, idx - contextLines);
    const nextEnd = Math.min(ops.length - 1, idx + contextLines);

    if (nextStart <= currentEnd + 1) {
      currentEnd = Math.max(currentEnd, nextEnd);
    } else {
      clusters.push({ start: currentStart, end: currentEnd });
      currentStart = nextStart;
      currentEnd = nextEnd;
    }
  }
  clusters.push({ start: currentStart, end: currentEnd });

  for (const cluster of clusters) {
    const hunkOps = ops.slice(cluster.start, cluster.end + 1);
    const diffLines: DiffLine[] = [];

    let oldStart: number | null = null;
    let newStart: number | null = null;
    let oldLinesCount = 0;
    let newLinesCount = 0;

    for (const op of hunkOps) {
      if (op.type === 'context') {
        const oldNum = (op.oldIndex ?? 0) + 1;
        const newNum = (op.newIndex ?? 0) + 1;
        oldStart ??= oldNum;
        newStart ??= newNum;
        oldLinesCount++;
        newLinesCount++;
        diffLines.push({
          type: 'context',
          content: op.line,
          oldLineNumber: oldNum,
          newLineNumber: newNum,
        });
      } else if (op.type === 'delete') {
        const oldNum = (op.oldIndex ?? 0) + 1;
        oldStart ??= oldNum;
        oldLinesCount++;
        diffLines.push({
          type: 'delete',
          content: op.line,
          oldLineNumber: oldNum,
          newLineNumber: null,
        });
      } else {
        const newNum = (op.newIndex ?? 0) + 1;
        newStart ??= newNum;
        newLinesCount++;
        diffLines.push({
          type: 'add',
          content: op.line,
          oldLineNumber: null,
          newLineNumber: newNum,
        });
      }
    }

    const resolvedOldStart = oldStart ?? (diffLines[0]?.oldLineNumber ?? 1);
    const resolvedNewStart = newStart ?? (diffLines[0]?.newLineNumber ?? 1);

    const header = `@@ -${resolvedOldStart},${oldLinesCount} +${resolvedNewStart},${newLinesCount} @@`;

    hunks.push({
      oldStart: resolvedOldStart,
      oldLines: oldLinesCount,
      newStart: resolvedNewStart,
      newLines: newLinesCount,
      header,
      lines: diffLines,
    });
  }

  return hunks;
}

/**
 * Builds side-by-side split rows from hunks.
 */
export function buildSplitRows(hunks: readonly DiffHunk[]): readonly SplitDiffRow[] {
  const rows: SplitDiffRow[] = [];

  for (const hunk of hunks) {
    let i = 0;
    const lines = hunk.lines;

    while (i < lines.length) {
      const line = lines[i];
      if (!line) {
        i++;
        continue;
      }

      if (line.type === 'context') {
        rows.push({
          left: {
            lineNumber: line.oldLineNumber,
            content: line.content,
            type: 'context',
          },
          right: {
            lineNumber: line.newLineNumber,
            content: line.content,
            type: 'context',
          },
        });
        i++;
      } else {
        // Collect consecutive deletes and adds
        const deletes: DiffLine[] = [];
        const adds: DiffLine[] = [];

        while (i < lines.length) {
          const cur = lines[i];
          if (!cur) break;
          if (cur.type === 'delete') {
            deletes.push(cur);
            i++;
          } else if (cur.type === 'add') {
            adds.push(cur);
            i++;
          } else {
            break;
          }
        }

        const maxLen = Math.max(deletes.length, adds.length);
        for (let j = 0; j < maxLen; j++) {
          const del = deletes[j];
          const add = adds[j];

          rows.push({
            left: del
              ? {
                  lineNumber: del.oldLineNumber,
                  content: del.content,
                  type: 'delete',
                }
              : {
                  lineNumber: null,
                  content: null,
                  type: 'empty',
                },
            right: add
              ? {
                  lineNumber: add.newLineNumber,
                  content: add.content,
                  type: 'add',
                }
              : {
                  lineNumber: null,
                  content: null,
                  type: 'empty',
                },
          });
        }
      }
    }
  }

  return rows;
}

/**
 * Computes the full FileDiff between old and new text contents.
 */
export function computeFileDiff(
  oldPath: string | null,
  newPath: string | null,
  oldText: string | null,
  newText: string | null,
  contextLines = 3,
  isBinary = false
): FileDiff {
  if (isBinary) {
    return {
      oldPath,
      newPath,
      isBinary: true,
      additions: 0,
      deletions: 0,
      hunks: [],
      splitRows: [],
    };
  }

  // Handle completely newly created file
  if (oldText === null && newText !== null) {
    const lines = newText.split(/\r?\n/);
    const diffLines: DiffLine[] = lines.map((line, idx) => ({
      type: 'add' as const,
      content: line,
      oldLineNumber: null,
      newLineNumber: idx + 1,
    }));

    const hunk: DiffHunk = {
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: lines.length,
      header: `@@ -0,0 +1,${lines.length} @@`,
      lines: diffLines,
    };

    const splitRows = buildSplitRows([hunk]);

    return {
      oldPath,
      newPath,
      isBinary: false,
      additions: lines.length,
      deletions: 0,
      hunks: [hunk],
      splitRows,
    };
  }

  // Handle completely deleted file
  if (oldText !== null && newText === null) {
    const lines = oldText.split(/\r?\n/);
    const diffLines: DiffLine[] = lines.map((line, idx) => ({
      type: 'delete' as const,
      content: line,
      oldLineNumber: idx + 1,
      newLineNumber: null,
    }));

    const hunk: DiffHunk = {
      oldStart: 1,
      oldLines: lines.length,
      newStart: 0,
      newLines: 0,
      header: `@@ -1,${lines.length} +0,0 @@`,
      lines: diffLines,
    };

    const splitRows = buildSplitRows([hunk]);

    return {
      oldPath,
      newPath,
      isBinary: false,
      additions: 0,
      deletions: lines.length,
      hunks: [hunk],
      splitRows,
    };
  }

  // Both files present
  const oldLines = oldText ? oldText.split(/\r?\n/) : [];
  const newLines = newText ? newText.split(/\r?\n/) : [];

  if (oldText === newText) {
    return {
      oldPath,
      newPath,
      isBinary: false,
      additions: 0,
      deletions: 0,
      hunks: [],
      splitRows: [],
    };
  }

  const ops = computeEditSequence(oldLines, newLines);
  const hunks = buildHunks(ops, contextLines);
  const splitRows = buildSplitRows(hunks);

  let additions = 0;
  let deletions = 0;
  for (const op of ops) {
    if (op.type === 'add') additions++;
    if (op.type === 'delete') deletions++;
  }

  const stats: FileDiffStats = { additions, deletions };

  return {
    oldPath,
    newPath,
    isBinary: false,
    additions: stats.additions,
    deletions: stats.deletions,
    hunks,
    splitRows,
  };
}
