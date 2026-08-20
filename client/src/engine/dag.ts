import type { GitRepositoryClient } from './fetcher.js';
import type { GitCommitObject, GitIdent, GitOid } from './types.js';

export interface CommitSummary {
  readonly oid: GitOid;
  readonly message: string;
  readonly subject: string;
  readonly body: string;
  readonly author: GitIdent;
  readonly committer: GitIdent;
  readonly parents: readonly GitOid[];
  readonly tree: GitOid;
  readonly gpgSig?: string | undefined;
}

export interface MergeBaseOptions {
  readonly maxCommitsToInspect?: number | undefined; // default: 2000
}

/**
 * Converts a full GitCommitObject into a CommitSummary.
 */
export function toCommitSummary(commit: GitCommitObject): CommitSummary {
  const summary: CommitSummary = {
    oid: commit.oid,
    message: commit.message,
    subject: commit.subject,
    body: commit.body,
    author: commit.author,
    committer: commit.committer,
    parents: commit.parents,
    tree: commit.tree,
    ...(commit.gpgSig !== undefined ? { gpgSig: commit.gpgSig } : {}),
  };
  return summary;
}

/**
 * Computes the Lowest Common Ancestor (merge base) between two commit SHAs.
 *
 * Handles:
 * 1. Identical commits (returns commit immediately if valid).
 * 2. Fast-forward branches (target is ancestor of head -> returns target; head is ancestor of target -> returns head).
 * 3. Diverged branches with single or multiple common ancestors.
 * 4. Criss-cross merges by filtering out dominated ancestors and returning the topological LCA.
 * 5. Disjoint/orphan histories without shared ancestors (returns null).
 */
export async function findMergeBase(
  client: GitRepositoryClient,
  headCommitSha: string,
  targetCommitSha: string,
  options?: MergeBaseOptions
): Promise<string | null> {
  const headSha = headCommitSha.trim().toLowerCase();
  const targetSha = targetCommitSha.trim().toLowerCase();
  const maxCommits = options?.maxCommitsToInspect ?? 2000;

  if (!headSha || !targetSha) {
    return null;
  }

  // Fast path: identical commits
  if (headSha === targetSha) {
    try {
      await client.getCommit(headSha);
      return headSha;
    } catch {
      return null;
    }
  }

  const commitCache = new Map<GitOid, GitCommitObject>();

  const getCommitSafe = async (oid: GitOid): Promise<GitCommitObject | null> => {
    const cached = commitCache.get(oid);
    if (cached !== undefined) {
      return cached;
    }
    try {
      const commit = await client.getCommit(oid);
      commitCache.set(oid, commit);
      return commit;
    } catch {
      return null;
    }
  };

  // Verify both commits exist
  const [headCommit, targetCommit] = await Promise.all([
    getCommitSafe(headSha),
    getCommitSafe(targetSha),
  ]);

  if (!headCommit || !targetCommit) {
    return null;
  }

  const visitedHead = new Set<GitOid>([headSha]);
  const visitedTarget = new Set<GitOid>([targetSha]);

  interface QueueItem {
    readonly oid: GitOid;
    readonly timestamp: number;
  }

  const queueHead: QueueItem[] = [{ oid: headSha, timestamp: headCommit.author.timestamp }];
  const queueTarget: QueueItem[] = [{ oid: targetSha, timestamp: targetCommit.author.timestamp }];

  let inspectedCount = 0;

  while ((queueHead.length > 0 || queueTarget.length > 0) && inspectedCount < maxCommits) {
    inspectedCount++;

    // Determine which queue to advance based on newer timestamp
    const headTop = queueHead[0];
    const targetTop = queueTarget[0];

    const advanceHead =
      headTop !== undefined &&
      (targetTop === undefined || headTop.timestamp >= targetTop.timestamp);

    if (advanceHead) {
      queueHead.shift();
      const current = await getCommitSafe(headTop.oid);
      if (current) {
        for (const parentOid of current.parents) {
          const normalized = parentOid.toLowerCase();
          if (!visitedHead.has(normalized)) {
            visitedHead.add(normalized);
            const parentCommit = await getCommitSafe(normalized);
            if (parentCommit) {
              const item: QueueItem = {
                oid: normalized,
                timestamp: parentCommit.author.timestamp,
              };
              // Insert sorted descending by timestamp
              insertSorted(queueHead, item);
            }
          }
        }
      }
    } else if (targetTop !== undefined) {
      queueTarget.shift();
      const current = await getCommitSafe(targetTop.oid);
      if (current) {
        for (const parentOid of current.parents) {
          const normalized = parentOid.toLowerCase();
          if (!visitedTarget.has(normalized)) {
            visitedTarget.add(normalized);
            const parentCommit = await getCommitSafe(normalized);
            if (parentCommit) {
              const item: QueueItem = {
                oid: normalized,
                timestamp: parentCommit.author.timestamp,
              };
              insertSorted(queueTarget, item);
            }
          }
        }
      }
    }
  }

  // Find all common ancestors: visitedHead ∩ visitedTarget
  const commonAncestors = new Set<GitOid>();
  for (const oid of visitedHead) {
    if (visitedTarget.has(oid)) {
      commonAncestors.add(oid);
    }
  }

  if (commonAncestors.size === 0) {
    return null;
  }

  if (commonAncestors.size === 1) {
    const [single] = commonAncestors;
    return single ?? null;
  }

  // Filter out dominated ancestors (ancestors of other common ancestors)
  const dominated = new Set<GitOid>();
  for (const candidate of commonAncestors) {
    const candidateCommit = commitCache.get(candidate);
    if (!candidateCommit) continue;

    const ancestorQueue: GitOid[] = [...candidateCommit.parents];
    const seenAncestors = new Set<GitOid>(candidateCommit.parents);

    while (ancestorQueue.length > 0) {
      const currentOid = ancestorQueue.shift();
      if (!currentOid) continue;

      if (commonAncestors.has(currentOid)) {
        dominated.add(currentOid);
      }

      const currentCommit = commitCache.get(currentOid);
      if (currentCommit) {
        for (const p of currentCommit.parents) {
          const norm = p.toLowerCase();
          if (!seenAncestors.has(norm)) {
            seenAncestors.add(norm);
            ancestorQueue.push(norm);
          }
        }
      }
    }
  }

  const nonDominated: GitOid[] = [];
  for (const candidate of commonAncestors) {
    if (!dominated.has(candidate)) {
      nonDominated.push(candidate);
    }
  }

  if (nonDominated.length === 0) {
    return null;
  }

  if (nonDominated.length === 1) {
    return nonDominated[0] ?? null;
  }

  // If multiple non-dominated common ancestors exist (criss-cross merge),
  // pick the one with the newest commit timestamp (matching git merge-base)
  nonDominated.sort((a, b) => {
    const commitA = commitCache.get(a);
    const commitB = commitCache.get(b);
    const timeA = commitA?.author.timestamp ?? 0;
    const timeB = commitB?.author.timestamp ?? 0;
    if (timeB !== timeA) {
      return timeB - timeA;
    }
    return a.localeCompare(b);
  });

  return nonDominated[0] ?? null;
}

/**
 * Returns the chronological, topologically ordered list of commits reachable from headSha
 * but NOT reachable from mergeBaseSha (i.e. mergeBaseSha..headSha).
 */
export async function getCommitHistoryRange(
  client: GitRepositoryClient,
  mergeBaseSha: string | null,
  headSha: string,
  limit = 100
): Promise<CommitSummary[]> {
  const cleanHead = headSha.trim().toLowerCase();
  if (!cleanHead) {
    return [];
  }

  const cleanMergeBase = mergeBaseSha ? mergeBaseSha.trim().toLowerCase() : null;

  // If merge base is identical to head, range is empty
  if (cleanMergeBase !== null && cleanMergeBase === cleanHead) {
    return [];
  }

  // 1. Collect all commits reachable from mergeBaseSha into excludedSet
  const excludedSet = new Set<GitOid>();
  if (cleanMergeBase !== null) {
    const queue: GitOid[] = [cleanMergeBase];
    excludedSet.add(cleanMergeBase);

    while (queue.length > 0) {
      const currentOid = queue.shift();
      if (!currentOid) continue;

      try {
        const commit = await client.getCommit(currentOid);
        for (const parentOid of commit.parents) {
          const norm = parentOid.toLowerCase();
          if (!excludedSet.has(norm)) {
            excludedSet.add(norm);
            queue.push(norm);
          }
        }
      } catch {
        // Missing commit in base branch stops traversal
      }
    }
  }

  // 2. Traverse backward from headSha, excluding commits in excludedSet
  const results: CommitSummary[] = [];
  const visited = new Set<GitOid>();
  const queue: GitOid[] = [cleanHead];
  visited.add(cleanHead);

  while (queue.length > 0 && results.length < limit) {
    const currentOid = queue.shift();
    if (!currentOid) continue;

    if (excludedSet.has(currentOid)) {
      continue;
    }

    try {
      const commit = await client.getCommit(currentOid);
      results.push(toCommitSummary(commit));

      for (const parentOid of commit.parents) {
        const norm = parentOid.toLowerCase();
        if (!visited.has(norm) && !excludedSet.has(norm)) {
          visited.add(norm);
          queue.push(norm);
        }
      }
    } catch {
      // Missing commit breaks branch traversal
      break;
    }
  }

  // 3. Sort chronologically descending (newest commit first)
  results.sort((a, b) => b.author.timestamp - a.author.timestamp);

  return results;
}

function insertSorted(queue: { oid: GitOid; timestamp: number }[], item: { oid: GitOid; timestamp: number }): void {
  let low = 0;
  let high = queue.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const midItem = queue[mid];
    if (midItem && midItem.timestamp < item.timestamp) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  queue.splice(low, 0, item);
}
