import { computeEditSequence } from '../worker/diff-algo.js';
import type { GitRepositoryClient } from './fetcher.js';
import type { GitBlobObject, GitCommitObject, GitOid } from './types.js';
import {
  calculateAgeFraction,
  calculateHeatmapIntensity,
  formatCommitSummary,
  getAuthorColor,
  getAuthorInitials,
  getHeatmapColor,
} from '../ui/utils.js';

export {
  calculateAgeFraction,
  calculateHeatmapIntensity,
  formatCommitSummary,
  getAuthorColor,
  getAuthorInitials,
  getHeatmapColor,
};

export interface BlameLineInfo {
  readonly lineNumber: number; // 1-indexed line number in current file
  readonly commitOid: GitOid;  // 40-character SHA of last modifying commit
  readonly authorName: string; // Commit author name
  readonly authorEmail: string; // Commit author email
  readonly timestamp: number;  // Unix timestamp in seconds
  readonly summary: string;    // Commit subject line / summary
}

export interface BlameHunk {
  readonly commitOid: GitOid;  // 40-character SHA of committing revision
  readonly authorName: string; // Commit author name
  readonly authorEmail: string; // Commit author email
  readonly timestamp: number;  // Unix timestamp in seconds
  readonly summary: string;    // Commit subject line / summary
  readonly startLine: number;  // 1-indexed starting line number in current file
  readonly lineCount: number;  // Number of contiguous lines in this hunk
}

export interface BlameResult {
  readonly lines: readonly BlameLineInfo[];
  readonly hunks: readonly BlameHunk[];
  readonly oldestTimestamp: number; // Lowest timestamp among attributed lines
  readonly newestTimestamp: number; // Highest timestamp among attributed lines
}

export type BlameProgressCallback = (visitedCommits: number) => void;

/**
 * Groups contiguous lines with the same commit OID into BlameHunk records.
 */
export function groupBlameHunks(lines: readonly BlameLineInfo[]): readonly BlameHunk[] {
  const hunks: BlameHunk[] = [];
  if (lines.length === 0) {
    return hunks;
  }

  const firstLine = lines[0];
  if (!firstLine) {
    return hunks;
  }

  let curHunk: BlameHunk = {
    commitOid: firstLine.commitOid,
    authorName: firstLine.authorName,
    authorEmail: firstLine.authorEmail,
    timestamp: firstLine.timestamp,
    summary: firstLine.summary,
    startLine: firstLine.lineNumber,
    lineCount: 1,
  };

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    if (line.commitOid === curHunk.commitOid) {
      curHunk = {
        commitOid: curHunk.commitOid,
        authorName: curHunk.authorName,
        authorEmail: curHunk.authorEmail,
        timestamp: curHunk.timestamp,
        summary: curHunk.summary,
        startLine: curHunk.startLine,
        lineCount: curHunk.lineCount + 1,
      };
    } else {
      hunks.push(curHunk);
      curHunk = {
        commitOid: line.commitOid,
        authorName: line.authorName,
        authorEmail: line.authorEmail,
        timestamp: line.timestamp,
        summary: line.summary,
        startLine: line.lineNumber,
        lineCount: 1,
      };
    }
  }
  hunks.push(curHunk);

  return hunks;
}

/**
 * Computes line-by-line git blame for a given file at a specific commit revision.
 * Traverses commit parent chains backward (first-parent chain) and uses Myers diff
 * to map lines to their introducing commit.
 */
export async function computeBlame(
  client: GitRepositoryClient,
  commitOid: string,
  filePath: string,
  onProgress?: BlameProgressCallback
): Promise<BlameResult> {
  const cleanPath = filePath.trim().replace(/^\/+|\/+$/g, '');
  if (!cleanPath) {
    throw new Error('File path cannot be empty');
  }


  const startCommit = await client.getCommit(commitOid);
  const startEntry = await client.resolvePathToEntry(startCommit.tree, cleanPath);

  if (!startEntry) {
    throw new Error(`File not found at commit ${commitOid}: ${cleanPath}`);
  }

  if (startEntry.isTree) {
    throw new Error(`Path '${cleanPath}' is a directory, not a blob`);
  }

  const startBlob = await client.getBlob(startEntry.oid);
  if (startBlob.isBinary) {
    throw new Error(`Cannot compute blame for binary file '${cleanPath}'`);
  }

  const startText = startBlob.text ?? '';
  const startLines = startText.length === 0 ? [] : startText.split(/\r?\n/);
  const totalLines = startLines.length;

  if (totalLines === 0) {
    return {
      lines: [],
      hunks: [],
      oldestTimestamp: 0,
      newestTimestamp: 0,
    };
  }

  const finalBlame: (BlameLineInfo | null)[] = new Array<BlameLineInfo | null>(totalLines).fill(null);
  let unattributedCount = totalLines;

  let curCommit: GitCommitObject = startCommit;
  let curBlobOid: GitOid = startEntry.oid;
  let curLines: readonly string[] = startLines;
  let curMapping: (number | undefined)[] = startLines.map((_, i) => i);

  const visitedSet = new Set<GitOid>();
  let visitedCommits = 0;

  while (unattributedCount > 0) {
    if (visitedSet.has(curCommit.oid)) {
      break;
    }
    visitedSet.add(curCommit.oid);

    visitedCommits++;
    if (onProgress) {
      onProgress(visitedCommits);
    }

    const author = curCommit.author;
    const summary = curCommit.subject !== '' ? curCommit.subject : formatCommitSummary(curCommit.message);


    // If root commit reached (no parents), attribute all active lines to this commit
    if (curCommit.parents.length === 0) {
      for (let i = 0; i < curLines.length; i++) {
        const targetIdx = curMapping[i];
        if (targetIdx !== undefined && finalBlame[targetIdx] === null) {
          finalBlame[targetIdx] = {
            lineNumber: targetIdx + 1,
            commitOid: curCommit.oid,
            authorName: author.name,
            authorEmail: author.email,
            timestamp: author.timestamp,
            summary,
          };
          unattributedCount--;
        }
      }
      break;
    }

    const parentOid = curCommit.parents[0];
    if (!parentOid) {
      break;
    }

    let parentCommit: GitCommitObject;
    try {
      parentCommit = await client.getCommit(parentOid);
    } catch {
      // If parent cannot be fetched, attribute remaining lines to current commit
      for (let i = 0; i < curLines.length; i++) {
        const targetIdx = curMapping[i];
        if (targetIdx !== undefined && finalBlame[targetIdx] === null) {
          finalBlame[targetIdx] = {
            lineNumber: targetIdx + 1,
            commitOid: curCommit.oid,
            authorName: author.name,
            authorEmail: author.email,
            timestamp: author.timestamp,
            summary,
          };
          unattributedCount--;
        }
      }
      break;
    }

    let parentEntry = null;
    try {
      parentEntry = await client.resolvePathToEntry(parentCommit.tree, cleanPath);
    } catch {
      parentEntry = null;
    }

    // If file did not exist in parent commit, all active lines were added in curCommit
    if (!parentEntry || parentEntry.isTree) {
      for (let i = 0; i < curLines.length; i++) {
        const targetIdx = curMapping[i];
        if (targetIdx !== undefined && finalBlame[targetIdx] === null) {
          finalBlame[targetIdx] = {
            lineNumber: targetIdx + 1,
            commitOid: curCommit.oid,
            authorName: author.name,
            authorEmail: author.email,
            timestamp: author.timestamp,
            summary,
          };
          unattributedCount--;
        }
      }
      break;
    }

    // Fast path: identical blob in parent commit (skip Myers diff)
    if (parentEntry.oid === curBlobOid) {
      curCommit = parentCommit;
      curBlobOid = parentEntry.oid;
      continue;
    }

    // Diff path: compute Myers diff between parentLines and curLines
    let parentBlob: GitBlobObject;
    try {
      parentBlob = await client.getBlob(parentEntry.oid);
    } catch {
      // If parent blob cannot be fetched, attribute remaining lines to current commit
      for (let i = 0; i < curLines.length; i++) {
        const targetIdx = curMapping[i];
        if (targetIdx !== undefined && finalBlame[targetIdx] === null) {
          finalBlame[targetIdx] = {
            lineNumber: targetIdx + 1,
            commitOid: curCommit.oid,
            authorName: author.name,
            authorEmail: author.email,
            timestamp: author.timestamp,
            summary,
          };
          unattributedCount--;
        }
      }
      break;
    }

    const parentText = parentBlob.text ?? '';
    const parentLines = parentText.length === 0 ? [] : parentText.split(/\r?\n/);

    const ops = computeEditSequence(parentLines, curLines);
    const nextMapping: (number | undefined)[] = new Array<number | undefined>(parentLines.length);

    for (const op of ops) {
      if (op.type === 'context') {
        const parentIdx = op.oldIndex;
        const curIdx = op.newIndex;
        if (parentIdx !== undefined && curIdx !== undefined) {
          const targetIdx = curMapping[curIdx];
          if (targetIdx !== undefined) {
            nextMapping[parentIdx] = targetIdx;
          }
        }
      } else if (op.type === 'add') {
        const curIdx = op.newIndex;
        if (curIdx !== undefined) {
          const targetIdx = curMapping[curIdx];
          if (targetIdx !== undefined && finalBlame[targetIdx] === null) {
            finalBlame[targetIdx] = {
              lineNumber: targetIdx + 1,
              commitOid: curCommit.oid,
              authorName: author.name,
              authorEmail: author.email,
              timestamp: author.timestamp,
              summary,
            };
            unattributedCount--;
          }
        }
      }
    }

    curLines = parentLines;
    curMapping = nextMapping;
    curCommit = parentCommit;
    curBlobOid = parentEntry.oid;
  }

  // Fallback attribution for any unaccounted lines
  const linesResult: BlameLineInfo[] = finalBlame.map((info, idx) => {
    if (info !== null) return info;
    return {
      lineNumber: idx + 1,
      commitOid: curCommit.oid,
      authorName: curCommit.author.name,
      authorEmail: curCommit.author.email,
      timestamp: curCommit.author.timestamp,
      summary: curCommit.subject !== '' ? curCommit.subject : formatCommitSummary(curCommit.message),
    };
  });


  const hunks = groupBlameHunks(linesResult);

  // Calculate timestamp bounds for age heatmap normalization
  let oldestTimestamp = Infinity;
  let newestTimestamp = -Infinity;

  for (const line of linesResult) {
    if (line.timestamp < oldestTimestamp) oldestTimestamp = line.timestamp;
    if (line.timestamp > newestTimestamp) newestTimestamp = line.timestamp;
  }

  if (!Number.isFinite(oldestTimestamp)) oldestTimestamp = 0;
  if (!Number.isFinite(newestTimestamp)) newestTimestamp = 0;

  return {
    lines: linesResult,
    hunks,
    oldestTimestamp,
    newestTimestamp,
  };
}
