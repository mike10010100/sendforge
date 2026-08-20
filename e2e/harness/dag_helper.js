/**
 * Reference In-Harness DAG Traversal & Merge Base Helper
 * Used by E2E tests to cross-verify in-browser Lowest Common Ancestor (LCA)
 * calculation, commit history ranges (base..head), and 3-way tree diffing.
 */

import { GitParser } from './git_parser.js';

export class DagHelper {
  /**
   * Traverse DAG backwards from two commit SHAs and find the Lowest Common Ancestor (LCA).
   * fetchObject: async (oid) => { type, payload, ... }
   */
  static async findMergeBase(fetchObject, commitA, commitB) {
    if (!commitA || !commitB) return null;
    if (commitA === commitB) return commitA;

    const commitCache = new Map();

    const getCommit = async (oid) => {
      if (!oid) return null;
      if (commitCache.has(oid)) return commitCache.get(oid);
      try {
        const obj = await fetchObject(oid);
        if (obj.type !== 'commit') return null;
        const parsed = GitParser.parseCommit(obj.payload);
        commitCache.set(oid, parsed);
        return parsed;
      } catch (e) {
        return null;
      }
    };

    const getCommitsBatch = async (oids) => {
      const unique = Array.from(new Set(oids.filter(oid => oid && !commitCache.has(oid))));
      if (unique.length > 0) {
        await Promise.all(unique.map(oid => getCommit(oid)));
      }
      return oids.map(oid => commitCache.get(oid) || null);
    };

    // 2-way concurrent BFS
    const visitedA = new Set();
    const visitedB = new Set();
    let queueA = [commitA];
    let queueB = [commitB];
    const commonAncestors = new Set();

    while ((queueA.length > 0 || queueB.length > 0) && commonAncestors.size === 0) {
      if (queueA.length > 0) {
        const currentBatchA = queueA.filter(sha => !visitedA.has(sha));
        queueA = [];
        for (const sha of currentBatchA) visitedA.add(sha);

        await getCommitsBatch(currentBatchA);

        const nextA = [];
        for (const sha of currentBatchA) {
          if (visitedB.has(sha)) {
            commonAncestors.add(sha);
          }
          const commit = commitCache.get(sha);
          if (commit && commit.parents) {
            for (const p of commit.parents) {
              if (!visitedA.has(p)) nextA.push(p);
            }
          }
        }
        queueA = nextA;
      }

      if (queueB.length > 0) {
        const currentBatchB = queueB.filter(sha => !visitedB.has(sha));
        queueB = [];
        for (const sha of currentBatchB) visitedB.add(sha);

        await getCommitsBatch(currentBatchB);

        const nextB = [];
        for (const sha of currentBatchB) {
          if (visitedA.has(sha)) {
            commonAncestors.add(sha);
          }
          const commit = commitCache.get(sha);
          if (commit && commit.parents) {
            for (const p of commit.parents) {
              if (!visitedB.has(p)) nextB.push(p);
            }
          }
        }
        queueB = nextB;
      }
    }

    if (commonAncestors.size === 0) return null;
    return Array.from(commonAncestors)[0];
  }

  /**
   * Traverse commit history between mergeBase and head (inclusive of head, exclusive of mergeBase).
   * Returns commits in reverse chronological order (newest first).
   */
  static async getCommitHistoryRange(fetchObject, mergeBaseSha, headSha) {
    if (!headSha) return [];
    if (mergeBaseSha === headSha) return [];

    const commitCache = new Map();
    const getCommit = async (oid) => {
      if (commitCache.has(oid)) return commitCache.get(oid);
      try {
        const obj = await fetchObject(oid);
        if (obj.type !== 'commit') return null;
        const parsed = GitParser.parseCommit(obj.payload);
        commitCache.set(oid, parsed);
        return parsed;
      } catch (e) {
        return null;
      }
    };

    const stopSet = new Set();
    if (mergeBaseSha) {
      stopSet.add(mergeBaseSha);
    }

    const result = [];
    let queue = [headSha];
    const visited = new Set();

    while (queue.length > 0) {
      const currentBatch = queue.filter(sha => !visited.has(sha) && !stopSet.has(sha));
      queue = [];
      if (currentBatch.length === 0) break;

      for (const sha of currentBatch) visited.add(sha);

      await Promise.all(currentBatch.map(sha => getCommit(sha)));

      for (const sha of currentBatch) {
        const commit = commitCache.get(sha);
        if (!commit) continue;

        result.push({
          sha,
          tree: commit.tree,
          parents: commit.parents,
          author: commit.author,
          committer: commit.committer,
          message: commit.message,
          summary: commit.message.split('\n')[0] || ''
        });

        if (commit.parents) {
          for (const parent of commit.parents) {
            if (!visited.has(parent) && !stopSet.has(parent)) {
              queue.push(parent);
            }
          }
        }
      }
    }

    result.sort((a, b) => (b.author?.timestamp || 0) - (a.author?.timestamp || 0));
    return result;
  }

  /**
   * Recursively diff two Git tree objects
   * Returns list of file changes: { path, status: 'added' | 'deleted' | 'modified', oldOid, newOid, mode }
   */
  static async computeTreeDiff(fetchObject, oldTreeSha, newTreeSha, prefix = '') {
    const changes = [];

    const getTreeEntries = async (treeSha) => {
      if (!treeSha) return new Map();
      try {
        const obj = await fetchObject(treeSha);
        const entries = GitParser.parseTree(obj.payload);
        const map = new Map();
        for (const entry of entries) {
          map.set(entry.name, entry);
        }
        return map;
      } catch (e) {
        return new Map();
      }
    };

    const oldEntries = await getTreeEntries(oldTreeSha);
    const newEntries = await getTreeEntries(newTreeSha);

    const allNames = new Set([...oldEntries.keys(), ...newEntries.keys()]);

    for (const name of allNames) {
      const oldEntry = oldEntries.get(name);
      const newEntry = newEntries.get(name);
      const fullPath = prefix ? `${prefix}/${name}` : name;

      if (!oldEntry && newEntry) {
        if (newEntry.type === 'tree') {
          const subChanges = await this.computeTreeDiff(fetchObject, null, newEntry.oid, fullPath);
          changes.push(...subChanges);
        } else {
          changes.push({
            path: fullPath,
            status: 'added',
            oldOid: null,
            newOid: newEntry.oid,
            mode: newEntry.mode,
            type: newEntry.type
          });
        }
      } else if (oldEntry && !newEntry) {
        if (oldEntry.type === 'tree') {
          const subChanges = await this.computeTreeDiff(fetchObject, oldEntry.oid, null, fullPath);
          changes.push(...subChanges);
        } else {
          changes.push({
            path: fullPath,
            status: 'deleted',
            oldOid: oldEntry.oid,
            newOid: null,
            mode: oldEntry.mode,
            type: oldEntry.type
          });
        }
      } else if (oldEntry && newEntry) {
        if (oldEntry.oid !== newEntry.oid) {
          if (oldEntry.type === 'tree' && newEntry.type === 'tree') {
            const subChanges = await this.computeTreeDiff(fetchObject, oldEntry.oid, newEntry.oid, fullPath);
            changes.push(...subChanges);
          } else {
            changes.push({
              path: fullPath,
              status: 'modified',
              oldOid: oldEntry.oid,
              newOid: newEntry.oid,
              mode: newEntry.mode,
              type: newEntry.type
            });
          }
        }
      }
    }

    return changes;
  }
}
