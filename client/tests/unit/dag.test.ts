import { afterEach, describe, expect, it, vi } from 'vitest';
import { findMergeBase, getCommitHistoryRange } from '../../src/engine/dag.js';
import { GitRepositoryClient } from '../../src/engine/fetcher.js';
import { createCompressedGitObject } from '../fixtures.js';

describe('Milestone M2: In-Browser Client Merge-Base & DAG Traversal Engine (dag.ts)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function setupMockClient(objects: Map<string, Uint8Array>): GitRepositoryClient {
    const client = new GitRepositoryClient('');
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      const parts = url.split('/');
      const p1 = parts[parts.length - 2] ?? '';
      const p2 = parts[parts.length - 1] ?? '';
      const oid = (p1 + p2).toLowerCase();
      const data = objects.get(oid);
      if (data) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/x-git-loose-object' }),
          arrayBuffer: () => Promise.resolve(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    }));
    return client;
  }

  // Helper to build authentic Git commit envelopes
  function buildCommit(
    parents: string[],
    subject: string,
    timestamp: number,
    treeOid = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
  ): { readonly compressed: Uint8Array; readonly oid: string; readonly uncompressed: Uint8Array } {
    const lines = [
      `tree ${treeOid}`,
      ...parents.map((p) => `parent ${p}`),
      `author Dev <dev@example.com> ${timestamp} +0000`,
      `committer Dev <dev@example.com> ${timestamp} +0000`,
      '',
      subject,
    ];
    return createCompressedGitObject('commit', lines.join('\n'));
  }

  describe('findMergeBase', () => {
    it('Scenario 1: Identical commits fast-path (commitA === commitB)', async () => {
      const c1 = buildCommit([], 'Initial commit', 1000);
      const objects = new Map<string, Uint8Array>([[c1.oid, c1.compressed]]);
      const client = setupMockClient(objects);

      const mergeBase = await findMergeBase(client, c1.oid, c1.oid);
      expect(mergeBase).toBe(c1.oid);
    });

    it('Scenario 2: Fast-forward linear history (target is ancestor of head)', async () => {
      // C1 -> C2 -> C3 (head: C3, target: C1 -> merge-base is C1)
      const c1 = buildCommit([], 'C1', 1000);
      const c2 = buildCommit([c1.oid], 'C2', 2000);
      const c3 = buildCommit([c2.oid], 'C3', 3000);

      const objects = new Map<string, Uint8Array>([
        [c1.oid, c1.compressed],
        [c2.oid, c2.compressed],
        [c3.oid, c3.compressed],
      ]);
      const client = setupMockClient(objects);

      const mergeBase = await findMergeBase(client, c3.oid, c1.oid);
      expect(mergeBase).toBe(c1.oid);

      // Symmetrical test: head is ancestor of target
      const reverseMergeBase = await findMergeBase(client, c1.oid, c3.oid);
      expect(reverseMergeBase).toBe(c1.oid);
    });

    it('Scenario 3: Diverged branches with common root ancestor', async () => {
      //        C2 (main / target)
      //       /
      //     C1 (root)
      //       \
      //        C3 -> C4 (feature / head)
      const c1 = buildCommit([], 'C1 Root', 1000);
      const c2 = buildCommit([c1.oid], 'C2 Main', 2000);
      const c3 = buildCommit([c1.oid], 'C3 Feature', 2500);
      const c4 = buildCommit([c3.oid], 'C4 Feature', 3000);

      const objects = new Map<string, Uint8Array>([
        [c1.oid, c1.compressed],
        [c2.oid, c2.compressed],
        [c3.oid, c3.compressed],
        [c4.oid, c4.compressed],
      ]);
      const client = setupMockClient(objects);

      const mergeBase = await findMergeBase(client, c4.oid, c2.oid);
      expect(mergeBase).toBe(c1.oid);
    });

    it('Scenario 4: Criss-cross merge resolution (dominance filtering)', async () => {
      //       A (root)
      //      / \
      //     B   C
      //     |\ /|
      //     | X |
      //     |/ \|
      //     D   E
      const a = buildCommit([], 'A Root', 1000);
      const b = buildCommit([a.oid], 'B Branch 1', 2000);
      const c = buildCommit([a.oid], 'C Branch 2', 2100);
      const d = buildCommit([b.oid, c.oid], 'D Merge B+C', 3000);
      const e = buildCommit([c.oid, b.oid], 'E Merge C+B', 3100);

      const objects = new Map<string, Uint8Array>([
        [a.oid, a.compressed],
        [b.oid, b.compressed],
        [c.oid, c.compressed],
        [d.oid, d.compressed],
        [e.oid, e.compressed],
      ]);
      const client = setupMockClient(objects);

      const mergeBase = await findMergeBase(client, d.oid, e.oid);
      // Both B and C are common ancestors dominating A.
      // C has newer timestamp (2100 vs 2000), so C is selected.
      expect([b.oid, c.oid]).toContain(mergeBase);
      expect(mergeBase).toBe(c.oid);
    });

    it('Scenario 5: Disjoint / orphan histories without shared ancestors', async () => {
      // Root 1 -> Commit A
      // Root 2 -> Commit B (no connection)
      const r1 = buildCommit([], 'Root 1', 1000);
      const a = buildCommit([r1.oid], 'Commit A', 2000);
      const r2 = buildCommit([], 'Root 2', 1500);
      const b = buildCommit([r2.oid], 'Commit B', 2500);

      const objects = new Map<string, Uint8Array>([
        [r1.oid, r1.compressed],
        [a.oid, a.compressed],
        [r2.oid, r2.compressed],
        [b.oid, b.compressed],
      ]);
      const client = setupMockClient(objects);

      const mergeBase = await findMergeBase(client, a.oid, b.oid);
      expect(mergeBase).toBeNull();
    });

    it('Scenario 6: Missing / corrupted commit gracefully returns null', async () => {
      const c1 = buildCommit([], 'C1', 1000);
      const objects = new Map<string, Uint8Array>([[c1.oid, c1.compressed]]);
      const client = setupMockClient(objects);

      const mergeBase = await findMergeBase(client, c1.oid, '0000000000000000000000000000000000000000');
      expect(mergeBase).toBeNull();
    });
  });

  describe('getCommitHistoryRange', () => {
    it('returns commits reachable from headSha but not mergeBaseSha', async () => {
      // C1 -> C2 (base) -> C3
      //         \-> C4 -> C5 (head)
      const c1 = buildCommit([], 'C1', 1000);
      const c2 = buildCommit([c1.oid], 'C2', 2000);
      const c3 = buildCommit([c2.oid], 'C3', 2500);
      const c4 = buildCommit([c2.oid], 'C4', 3000);
      const c5 = buildCommit([c4.oid], 'C5', 4000);

      const objects = new Map<string, Uint8Array>([
        [c1.oid, c1.compressed],
        [c2.oid, c2.compressed],
        [c3.oid, c3.compressed],
        [c4.oid, c4.compressed],
        [c5.oid, c5.compressed],
      ]);
      const client = setupMockClient(objects);

      const range = await getCommitHistoryRange(client, c2.oid, c5.oid);
      expect(range).toHaveLength(2);
      expect(range[0]?.oid).toBe(c5.oid);
      expect(range[0]?.subject).toBe('C5');
      expect(range[1]?.oid).toBe(c4.oid);
      expect(range[1]?.subject).toBe('C4');
    });

    it('returns empty array when mergeBaseSha equals headSha', async () => {
      const c1 = buildCommit([], 'C1', 1000);
      const objects = new Map<string, Uint8Array>([[c1.oid, c1.compressed]]);
      const client = setupMockClient(objects);

      const range = await getCommitHistoryRange(client, c1.oid, c1.oid);
      expect(range).toEqual([]);
    });

    it('returns all reachable commits when mergeBaseSha is null (orphan branch)', async () => {
      const c1 = buildCommit([], 'C1', 1000);
      const c2 = buildCommit([c1.oid], 'C2', 2000);

      const objects = new Map<string, Uint8Array>([
        [c1.oid, c1.compressed],
        [c2.oid, c2.compressed],
      ]);
      const client = setupMockClient(objects);

      const range = await getCommitHistoryRange(client, null, c2.oid);
      expect(range).toHaveLength(2);
      expect(range[0]?.oid).toBe(c2.oid);
      expect(range[1]?.oid).toBe(c1.oid);
    });

    it('respects limit parameter and handles merge commits with multiple parents', async () => {
      const c1 = buildCommit([], 'C1', 1000);
      const c2a = buildCommit([c1.oid], 'C2a', 2000);
      const c2b = buildCommit([c1.oid], 'C2b', 2100);
      const c3 = buildCommit([c2a.oid, c2b.oid], 'C3 Merge', 3000);

      const objects = new Map<string, Uint8Array>([
        [c1.oid, c1.compressed],
        [c2a.oid, c2a.compressed],
        [c2b.oid, c2b.compressed],
        [c3.oid, c3.compressed],
      ]);
      const client = setupMockClient(objects);

      const fullRange = await getCommitHistoryRange(client, c1.oid, c3.oid);
      expect(fullRange).toHaveLength(3);
      expect(fullRange[0]?.oid).toBe(c3.oid);

      const limitedRange = await getCommitHistoryRange(client, c1.oid, c3.oid, 2);
      expect(limitedRange).toHaveLength(2);
    });
  });
});
