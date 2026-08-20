/**
 * In-Harness Reference Git Blame Computation Engine
 * Computes line-by-line attribution across commit DAGs backward using Myers/LCS diffing,
 * validates hunk groupings, and calculates relative age heatmap scales.
 */

import { GitParser } from './git_parser.js';

export class BlameHelper {
  /**
   * Resolve a blob OID for a file path starting from a commit OID
   * using an object fetcher function `fetchObject(oid) -> Promise<{ type, payload }>`
   */
  static async resolveBlobOid(fetchObject, commitOid, filePath) {
    const commitObj = await fetchObject(commitOid);
    const commit = GitParser.parseCommit(commitObj.payload);
    const pathParts = filePath.split('/').filter(Boolean);

    let currentTreeOid = commit.tree;
    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i];
      const treeObj = await fetchObject(currentTreeOid);
      const entries = GitParser.parseTree(treeObj.payload);
      const entry = entries.find(e => e.name === part);
      if (!entry) return null;

      if (i === pathParts.length - 1) {
        return entry.oid;
      }
      currentTreeOid = entry.oid;
    }
    return null;
  }

  /**
   * In-harness backward commit DAG blame traversal engine
   * Returns: {
   *   lines: Array<{ lineNumber, commitOid, authorName, authorEmail, timestamp, summary }>,
   *   hunks: Array<{ commitOid, authorName, authorEmail, timestamp, summary, startLine, lineCount }>,
   *   oldestTimestamp: number,
   *   newestTimestamp: number
   * }
   */
  static async computeBlame(fetchObject, startCommitOid, filePath) {
    const initialBlobOid = await this.resolveBlobOid(fetchObject, startCommitOid, filePath);
    if (!initialBlobOid) {
      throw new Error(`File not found at start commit: ${filePath}`);
    }

    const initialBlobObj = await fetchObject(initialBlobOid);
    const initialBlob = GitParser.parseBlob(initialBlobObj.payload);
    if (initialBlob.isBinary) {
      throw new Error(`Cannot blame binary file: ${filePath}`);
    }

    const totalLines = initialBlob.lines.length;
    if (totalLines === 0) {
      return {
        lines: [],
        hunks: [],
        oldestTimestamp: 0,
        newestTimestamp: 0
      };
    }

    // Initialize line attribution mapping
    const attribution = new Array(totalLines).fill(null);
    let unassignedCount = totalLines;

    // Track active line mapping: maps current commit file line indices (0-based) to original line indices
    let activeMapping = Array.from({ length: totalLines }, (_, i) => i);
    let currentCommitOid = startCommitOid;

    while (currentCommitOid && unassignedCount > 0) {
      const commitObj = await fetchObject(currentCommitOid);
      const commit = GitParser.parseCommit(commitObj.payload);
      const currentBlobOid = await this.resolveBlobOid(fetchObject, currentCommitOid, filePath);

      if (!currentBlobOid) {
        // File did not exist at this commit (created in child)
        break;
      }

      const currentBlobParsed = GitParser.parseBlob((await fetchObject(currentBlobOid)).payload);
      const parentCommitOid = commit.parents.length > 0 ? commit.parents[0] : null;

      if (!parentCommitOid) {
        // Root commit: attribute all remaining unassigned active lines to this commit
        for (let i = 0; i < activeMapping.length; i++) {
          const origIdx = activeMapping[i];
          if (origIdx !== null && attribution[origIdx] === null) {
            attribution[origIdx] = {
              lineNumber: origIdx + 1,
              commitOid: currentCommitOid,
              authorName: commit.author?.name || 'Unknown',
              authorEmail: commit.author?.email || '',
              timestamp: commit.author?.timestamp || 0,
              summary: commit.message.split('\n')[0] || ''
            };
            unassignedCount--;
          }
        }
        break;
      }

      const parentBlobOid = await this.resolveBlobOid(fetchObject, parentCommitOid, filePath);

      if (!parentBlobOid) {
        // File created in current commit
        for (let i = 0; i < activeMapping.length; i++) {
          const origIdx = activeMapping[i];
          if (origIdx !== null && attribution[origIdx] === null) {
            attribution[origIdx] = {
              lineNumber: origIdx + 1,
              commitOid: currentCommitOid,
              authorName: commit.author?.name || 'Unknown',
              authorEmail: commit.author?.email || '',
              timestamp: commit.author?.timestamp || 0,
              summary: commit.message.split('\n')[0] || ''
            };
            unassignedCount--;
          }
        }
        break;
      }

      if (parentBlobOid === currentBlobOid) {
        // File unchanged in this commit -> pass all line mappings directly to parent
        currentCommitOid = parentCommitOid;
        continue;
      }

      // Compute line-by-line diff between parentBlob and currentBlob
      const parentBlobParsed = GitParser.parseBlob((await fetchObject(parentBlobOid)).payload);
      const diff = GitParser.computeUnifiedDiff(parentBlobParsed.text, currentBlobParsed.text);

      const nextMapping = new Array(parentBlobParsed.lines.length).fill(null);

      for (const edit of diff.edits) {
        if (edit.type === 'equal') {
          // edit.newLine (1-indexed in current) matches edit.oldLine (1-indexed in parent)
          const currentIdx = edit.newLine - 1;
          const parentIdx = edit.oldLine - 1;
          const origIdx = activeMapping[currentIdx];
          if (origIdx !== null && origIdx !== undefined) {
            nextMapping[parentIdx] = origIdx;
          }
        } else if (edit.type === 'add') {
          // Line was added/modified in currentCommit -> attribute to currentCommit!
          const currentIdx = edit.newLine - 1;
          const origIdx = activeMapping[currentIdx];
          if (origIdx !== null && origIdx !== undefined && attribution[origIdx] === null) {
            attribution[origIdx] = {
              lineNumber: origIdx + 1,
              commitOid: currentCommitOid,
              authorName: commit.author?.name || 'Unknown',
              authorEmail: commit.author?.email || '',
              timestamp: commit.author?.timestamp || 0,
              summary: commit.message.split('\n')[0] || ''
            };
            unassignedCount--;
          }
        }
      }

      activeMapping = nextMapping;
      currentCommitOid = parentCommitOid;
    }

    // Fill any residual lines with start commit
    for (let i = 0; i < totalLines; i++) {
      if (!attribution[i]) {
        attribution[i] = {
          lineNumber: i + 1,
          commitOid: startCommitOid,
          authorName: 'Sendforge Committer',
          authorEmail: 'committer@sendforge.dev',
          timestamp: 0,
          summary: 'Initial revision'
        };
      }
    }

    // Group into hunks
    const hunks = [];
    let currentHunk = null;

    for (const line of attribution) {
      if (!currentHunk || currentHunk.commitOid !== line.commitOid) {
        if (currentHunk) hunks.push(currentHunk);
        currentHunk = {
          commitOid: line.commitOid,
          authorName: line.authorName,
          authorEmail: line.authorEmail,
          timestamp: line.timestamp,
          summary: line.summary,
          startLine: line.lineNumber,
          lineCount: 1
        };
      } else {
        currentHunk.lineCount++;
      }
    }
    if (currentHunk) hunks.push(currentHunk);

    // Calculate timestamps
    const timestamps = attribution.map(l => l.timestamp).filter(t => t > 0);
    const oldestTimestamp = timestamps.length > 0 ? Math.min(...timestamps) : 0;
    const newestTimestamp = timestamps.length > 0 ? Math.max(...timestamps) : 0;

    return {
      lines: attribution,
      hunks,
      oldestTimestamp,
      newestTimestamp
    };
  }

  /**
   * Calculate normalized relative age heatmap value between 0.0 (oldest) and 1.0 (newest)
   */
  static calculateHeatmapIntensity(timestamp, oldestTimestamp, newestTimestamp) {
    if (oldestTimestamp === newestTimestamp || !timestamp) return 0.5;
    const clamped = Math.max(oldestTimestamp, Math.min(newestTimestamp, timestamp));
    return (clamped - oldestTimestamp) / (newestTimestamp - oldestTimestamp);
  }
}
