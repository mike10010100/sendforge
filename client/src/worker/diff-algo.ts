import type { GitRepositoryClient } from '../engine/fetcher.js';
import type { GitTreeEntry } from '../engine/types.js';
import { diffClient } from './diff-client.js';
import type {
  DiffBatchItemInput,
  DiffHunk,
  DiffLine,
  FileDiff,
  FileDiffStats,
  FileDiffSummary,
  ReviewNote,
  SplitDiffRow,
} from './diff-types.js';

interface EditOp {
  readonly type: 'context' | 'add' | 'delete';
  readonly oldIndex?: number | undefined; // 0-indexed in oldLines
  readonly newIndex?: number | undefined; // 0-indexed in newLines
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

  const trace: Map<number, number>[] = [];

  let foundD = -1;
  for (let d = 0; d <= max; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1))) {
        x = v.get(k + 1) ?? 0;
      } else {
        x = (v.get(k - 1) ?? 0) + 1;
      }

      let y = x - k;

      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }

      v.set(k, x);

      if (x >= n && y >= m) {
        foundD = d;
        break;
      }
    }
    trace.push(new Map(v));
    if (foundD !== -1) {
      break;
    }
  }

  if (foundD === -1) {
    foundD = trace.length - 1;
  }

  // Backtrack edit script
  let x = n;
  let y = m;
  const script: EditOp[] = [];

  for (let d = foundD; d > 0; d--) {
    const k = x - y;
    const vPrev = trace[d - 1];
    if (!vPrev) break;

    let prevK: number;
    if (k === -d || (k !== d && (vPrev.get(k - 1) ?? -1) < (vPrev.get(k + 1) ?? -1))) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }

    const prevX = vPrev.get(prevK) ?? 0;
    const prevY = prevX - prevK;

    const xStart = prevK === k + 1 ? prevX : prevX + 1;
    const yStart = prevK === k + 1 ? prevY + 1 : prevY;

    // Follow snake backwards from (x, y) to (xStart, yStart)
    while (x > xStart && y > yStart) {
      x--;
      y--;
      script.push({
        type: 'context',
        oldIndex: oldOffset + x,
        newIndex: newOffset + y,
        line: a[x] ?? '',
      });
    }

    // Process edit step from (prevX, prevY) to (xStart, yStart)
    if (prevK === k + 1) {
      // Insertion from b
      script.push({
        type: 'add',
        newIndex: newOffset + prevY,
        line: b[prevY] ?? '',
      });
    } else {
      // Deletion from a
      script.push({
        type: 'delete',
        oldIndex: oldOffset + prevX,
        line: a[prevX] ?? '',
      });
    }

    x = prevX;
    y = prevY;
  }

  // Base case d = 0: any remaining diagonal snake back to (0, 0)
  while (x > 0 && y > 0) {
    x--;
    y--;
    script.push({
      type: 'context',
      oldIndex: oldOffset + x,
      newIndex: newOffset + y,
      line: a[x] ?? '',
    });
  }

  script.reverse();
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

  // Handle newly created file
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

  // Handle deleted file
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

/**
 * Recursively computes the file-level difference between two Git commit trees.
 * Identifies added ('added'), deleted ('deleted'), and modified ('modified') files,
 * including mode changes (e.g. executable bit) and binary vs text detection.
 */
export async function computeTreeDiff(
  client: GitRepositoryClient,
  baseCommitSha: string | null,
  headCommitSha: string | null
): Promise<readonly FileDiffSummary[]> {
  if (baseCommitSha === headCommitSha && baseCommitSha !== null) {
    return [];
  }

  let baseTreeOid: string | null = null;
  if (baseCommitSha && baseCommitSha !== '0000000000000000000000000000000000000000') {
    try {
      const baseCommit = await client.getCommit(baseCommitSha);
      baseTreeOid = baseCommit.tree;
    } catch {
      baseTreeOid = null;
    }
  }

  let headTreeOid: string | null = null;
  if (headCommitSha && headCommitSha !== '0000000000000000000000000000000000000000') {
    try {
      const headCommit = await client.getCommit(headCommitSha);
      headTreeOid = headCommit.tree;
    } catch {
      headTreeOid = null;
    }
  }

  if (baseTreeOid === headTreeOid && baseTreeOid !== null) {
    return [];
  }

  const results: FileDiffSummary[] = [];

  const walk = async (
    bOid: string | null,
    hOid: string | null,
    prefix: string
  ): Promise<void> => {
    if (bOid === hOid && bOid !== null) {
      return;
    }

    const baseTree = bOid ? await client.getTree(bOid) : null;
    const headTree = hOid ? await client.getTree(hOid) : null;

    const baseMap = new Map<string, GitTreeEntry>();
    if (baseTree) {
      for (const entry of baseTree.entries) {
        baseMap.set(entry.name, entry);
      }
    }

    const headMap = new Map<string, GitTreeEntry>();
    if (headTree) {
      for (const entry of headTree.entries) {
        headMap.set(entry.name, entry);
      }
    }

    const allNames = new Set<string>([...baseMap.keys(), ...headMap.keys()]);

    for (const name of allNames) {
      const bEntry = baseMap.get(name);
      const hEntry = headMap.get(name);
      const currentPath = prefix ? `${prefix}/${name}` : name;

      if (!bEntry && hEntry) {
        // Added in head
        if (hEntry.isTree) {
          await walk(null, hEntry.oid, currentPath);
        } else {
          let isBinary = false;
          try {
            const blob = await client.getBlob(hEntry.oid);
            isBinary = blob.isBinary;
          } catch {
            isBinary = false;
          }

          results.push({
            status: 'added',
            oldPath: null,
            newPath: currentPath,
            oldOid: null,
            newOid: hEntry.oid,
            oldMode: null,
            newMode: hEntry.mode,
            isBinary,
          });
        }
      } else if (bEntry && !hEntry) {
        // Deleted in head
        if (bEntry.isTree) {
          await walk(bEntry.oid, null, currentPath);
        } else {
          let isBinary = false;
          try {
            const blob = await client.getBlob(bEntry.oid);
            isBinary = blob.isBinary;
          } catch {
            isBinary = false;
          }

          results.push({
            status: 'deleted',
            oldPath: currentPath,
            newPath: null,
            oldOid: bEntry.oid,
            newOid: null,
            oldMode: bEntry.mode,
            newMode: null,
            isBinary,
          });
        }
      } else if (bEntry && hEntry) {
        // Both exist
        if (bEntry.isTree && hEntry.isTree) {
          if (bEntry.oid !== hEntry.oid) {
            await walk(bEntry.oid, hEntry.oid, currentPath);
          }
        } else if (!bEntry.isTree && !hEntry.isTree) {
          if (bEntry.oid !== hEntry.oid || bEntry.mode !== hEntry.mode) {
            let isBinary = false;
            try {
              const bBlob = await client.getBlob(bEntry.oid);
              const hBlob = await client.getBlob(hEntry.oid);
              isBinary = bBlob.isBinary || hBlob.isBinary;
            } catch {
              isBinary = false;
            }

            const modeChanged = bEntry.mode !== hEntry.mode;
            results.push({
              status: 'modified',
              oldPath: currentPath,
              newPath: currentPath,
              oldOid: bEntry.oid,
              newOid: hEntry.oid,
              oldMode: bEntry.mode,
              newMode: hEntry.mode,
              modeChanged,
              isBinary,
            });
          }
        } else {
          // Type change: directory replaced with file or vice versa
          if (bEntry.isTree) {
            await walk(bEntry.oid, null, currentPath);
          } else {
            let isBinary = false;
            try {
              const blob = await client.getBlob(bEntry.oid);
              isBinary = blob.isBinary;
            } catch {
              isBinary = false;
            }
            results.push({
              status: 'deleted',
              oldPath: currentPath,
              newPath: null,
              oldOid: bEntry.oid,
              newOid: null,
              oldMode: bEntry.mode,
              newMode: null,
              isBinary,
            });
          }

          if (hEntry.isTree) {
            await walk(null, hEntry.oid, currentPath);
          } else {
            let isBinary = false;
            try {
              const blob = await client.getBlob(hEntry.oid);
              isBinary = blob.isBinary;
            } catch {
              isBinary = false;
            }
            results.push({
              status: 'added',
              oldPath: null,
              newPath: currentPath,
              oldOid: null,
              newOid: hEntry.oid,
              oldMode: null,
              newMode: hEntry.mode,
              isBinary,
            });
          }
        }
      }
    }
  };

  await walk(baseTreeOid, headTreeOid, '');
  return results;
}

/**
 * Computes full unified and split diffs for all changed files between two commits.
 */
export async function computeTreeFullDiff(
  client: GitRepositoryClient,
  baseCommitSha: string | null,
  headCommitSha: string | null,
  options?: { readonly contextLines?: number | undefined }
): Promise<readonly FileDiff[]> {
  const summaries = await computeTreeDiff(client, baseCommitSha, headCommitSha);
  if (summaries.length === 0) {
    return [];
  }

  const batchItems: DiffBatchItemInput[] = [];
  const fileDiffs: FileDiff[] = [];

  for (const sum of summaries) {
    if (sum.isBinary) {
      fileDiffs.push({
        status: sum.status,
        oldPath: sum.oldPath,
        newPath: sum.newPath,
        oldOid: sum.oldOid,
        newOid: sum.newOid,
        oldMode: sum.oldMode,
        newMode: sum.newMode,
        ...(sum.modeChanged !== undefined ? { modeChanged: sum.modeChanged } : {}),
        isBinary: true,
        additions: 0,
        deletions: 0,
        hunks: [],
        splitRows: [],
      });
      continue;
    }

    if (sum.oldOid === sum.newOid && sum.modeChanged) {
      // Mode change only, no content diff
      fileDiffs.push({
        status: sum.status,
        oldPath: sum.oldPath,
        newPath: sum.newPath,
        oldOid: sum.oldOid,
        newOid: sum.newOid,
        oldMode: sum.oldMode,
        newMode: sum.newMode,
        modeChanged: true,
        isBinary: false,
        additions: 0,
        deletions: 0,
        hunks: [],
        splitRows: [],
      });
      continue;
    }

    let oldText: string | null = null;
    let newText: string | null = null;

    if (sum.oldOid) {
      try {
        const oldBlob = await client.getBlob(sum.oldOid);
        oldText = oldBlob.text ?? null;
      } catch {
        oldText = null;
      }
    }

    if (sum.newOid) {
      try {
        const newBlob = await client.getBlob(sum.newOid);
        newText = newBlob.text ?? null;
      } catch {
        newText = null;
      }
    }

    batchItems.push({
      oldPath: sum.oldPath,
      newPath: sum.newPath,
      oldOid: sum.oldOid,
      newOid: sum.newOid,
      oldMode: sum.oldMode,
      newMode: sum.newMode,
      status: sum.status,
      ...(sum.modeChanged !== undefined ? { modeChanged: sum.modeChanged } : {}),
      isBinary: false,
      oldContent: oldText,
      newContent: newText,
      ...(options?.contextLines !== undefined ? { contextLines: options.contextLines } : {}),
    });
  }

  if (batchItems.length > 0) {
    const computedDiffs = await diffClient.computeBatchDiff(batchItems, options);
    fileDiffs.push(...computedDiffs);
  }

  fileDiffs.sort((a, b) => {
    const pathA = a.newPath ?? a.oldPath ?? '';
    const pathB = b.newPath ?? b.oldPath ?? '';
    return pathA.localeCompare(pathB);
  });

  return fileDiffs;
}

/**
 * Attaches review notes to their corresponding file diffs, hunks, lines, and split rows.
 */
export function attachReviewNotes(
  fileDiffs: readonly FileDiff[],
  notes: readonly ReviewNote[]
): readonly FileDiff[] {
  if (notes.length === 0 || fileDiffs.length === 0) {
    return fileDiffs;
  }

  return fileDiffs.map((fileDiff) => {
    const filePath = fileDiff.newPath ?? fileDiff.oldPath;
    if (!filePath) {
      return fileDiff;
    }

    const fileNotes = notes.filter((n) => !n.filePath || n.filePath === filePath);
    if (fileNotes.length === 0) {
      return fileDiff;
    }

    // Attach notes to hunks and lines
    const updatedHunks = fileDiff.hunks.map((hunk) => {
      const updatedLines = hunk.lines.map((line) => {
        const matchingNotes = fileNotes.filter((note) => {
          if (note.line === undefined) return false;
          if (line.type === 'add' || line.type === 'context') {
            return note.line === line.newLineNumber;
          }
          return note.line === line.oldLineNumber;
        });

        if (matchingNotes.length === 0) {
          return line;
        }

        return {
          ...line,
          reviewNotes: matchingNotes,
        };
      });

      return {
        ...hunk,
        lines: updatedLines,
      };
    });

    // Attach notes to splitRows
    const updatedSplitRows = fileDiff.splitRows.map((row) => {
      let leftSide = row.left;
      let rightSide = row.right;

      if (leftSide.lineNumber !== null) {
        const leftNotes = fileNotes.filter(
          (note) =>
            note.line === leftSide.lineNumber &&
            (leftSide.type === 'delete' || leftSide.type === 'context')
        );
        if (leftNotes.length > 0) {
          leftSide = { ...leftSide, reviewNotes: leftNotes };
        }
      }

      if (rightSide.lineNumber !== null) {
        const rightNotes = fileNotes.filter(
          (note) =>
            note.line === rightSide.lineNumber &&
            (rightSide.type === 'add' || rightSide.type === 'context')
        );
        if (rightNotes.length > 0) {
          rightSide = { ...rightSide, reviewNotes: rightNotes };
        }
      }

      return {
        left: leftSide,
        right: rightSide,
      };
    });

    return {
      ...fileDiff,
      hunks: updatedHunks,
      splitRows: updatedSplitRows,
      reviewNotes: fileNotes,
    };
  });
}
