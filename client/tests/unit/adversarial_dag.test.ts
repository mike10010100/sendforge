import { afterEach, describe, expect, it, vi } from 'vitest';
import { findMergeBase, getCommitHistoryRange } from '../../src/engine/dag.js';
import { GitRepositoryClient } from '../../src/engine/fetcher.js';
import { createCompressedGitObject } from '../fixtures.js';

describe('Milestone M2 Adversarial Stress Testing: Git DAG Traversal Engine (dag.ts)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function setupMockClient(
    objects: Map<string, Uint8Array>,
    maxCacheSize = 2000
  ): GitRepositoryClient {
    const client = new GitRepositoryClient('', maxCacheSize);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
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
            arrayBuffer: () =>
              Promise.resolve(
                data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
              ),
          });
        }
        return Promise.resolve({ ok: false, status: 404 });
      })
    );
    return client;
  }

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

  describe('1. Complex Criss-Cross Merges and Candidate LCA Resolution', () => {
    it('resolves standard 2-way criss-cross with distinct timestamps', async () => {
      //        A (1000)
      //       / \
      //      B   C  (B=2000, C=2500)
      //      |\ /|
      //      | X |
      //      |/ \|
      //      D   E  (D merges B+C, E merges C+B)
      const a = buildCommit([], 'A Root', 1000);
      const b = buildCommit([a.oid], 'B Branch 1', 2000);
      const c = buildCommit([a.oid], 'C Branch 2', 2500);
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

      const lca1 = await findMergeBase(client, d.oid, e.oid);
      // Both B and C are valid common ancestors; C has newer timestamp (2500 vs 2000)
      expect(lca1).toBe(c.oid);

      // Symmetrical resolution
      const lca2 = await findMergeBase(client, e.oid, d.oid);
      expect(lca2).toBe(c.oid);
    });

    it('resolves 2-way criss-cross with equal timestamps deterministically using SHA tie-break', async () => {
      const a = buildCommit([], 'A Root', 1000);
      const b = buildCommit([a.oid], 'B Branch 1', 2000);
      const c = buildCommit([a.oid], 'C Branch 2', 2000); // Identical timestamp to B
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

      const lca1 = await findMergeBase(client, d.oid, e.oid);
      const expectedSha = b.oid.localeCompare(c.oid) < 0 ? b.oid : c.oid;
      expect(lca1).toBe(expectedSha);

      const lca2 = await findMergeBase(client, e.oid, d.oid);
      expect(lca2).toBe(expectedSha);
    });

    it('resolves 3-tier deep criss-cross lattice and eliminates all dominated intermediate ancestors', async () => {
      // Tier 0: Root R (1000)
      // Tier 1: A1 (1100), B1 (1200) -> X1 (merges A1, B1), Y1 (merges B1, A1)
      // Tier 2: A2 (2100 from X1), B2 (2200 from Y1) -> X2 (merges A2, B2), Y2 (merges B2, A2)
      // Tier 3: A3 (3100 from X2), B3 (3200 from Y2) -> X3 (merges A3, B3), Y3 (merges B3, A3)
      const r = buildCommit([], 'Root R', 1000);

      const a1 = buildCommit([r.oid], 'A1', 1100);
      const b1 = buildCommit([r.oid], 'B1', 1200);
      const x1 = buildCommit([a1.oid, b1.oid], 'X1', 1300);
      const y1 = buildCommit([b1.oid, a1.oid], 'Y1', 1400);

      const a2 = buildCommit([x1.oid], 'A2', 2100);
      const b2 = buildCommit([y1.oid], 'B2', 2200);
      const x2 = buildCommit([a2.oid, b2.oid], 'X2', 2300);
      const y2 = buildCommit([b2.oid, a2.oid], 'Y2', 2400);

      const a3 = buildCommit([x2.oid], 'A3', 3100);
      const b3 = buildCommit([y2.oid], 'B3', 3200);
      const x3 = buildCommit([a3.oid, b3.oid], 'X3', 3300);
      const y3 = buildCommit([b3.oid, a3.oid], 'Y3', 3400);

      const commits = [r, a1, b1, x1, y1, a2, b2, x2, y2, a3, b3, x3, y3];
      const objects = new Map<string, Uint8Array>(commits.map((c) => [c.oid, c.compressed]));
      const client = setupMockClient(objects);

      const lca = await findMergeBase(client, x3.oid, y3.oid);
      // Both A3 (3100) and B3 (3200) are common ancestors dominating Tier 0, 1, and 2.
      // B3 has newer timestamp (3200 vs 3100) and is non-dominated.
      expect(lca).toBe(b3.oid);
    });

    it('resolves asymmetric multi-branch criss-cross where one path has intermediate commits', async () => {
      //        Root (1000)
      //       /    \
      //      A(1100) B(1200)
      //      |       |
      //     A2(1500) |
      //      |\     /|
      //      | \   / |
      //      |  \ /  |
      //      |   X   |
      //      |  / \  |
      //      | /   \ |
      //      M1(2000) M2(2100) (M1 merges A2+B, M2 merges B+A2)
      const root = buildCommit([], 'Root', 1000);
      const a = buildCommit([root.oid], 'A', 1100);
      const b = buildCommit([root.oid], 'B', 1200);
      const a2 = buildCommit([a.oid], 'A2', 1500);
      const m1 = buildCommit([a2.oid, b.oid], 'M1', 2000);
      const m2 = buildCommit([b.oid, a2.oid], 'M2', 2100);

      const commits = [root, a, b, a2, m1, m2];
      const objects = new Map<string, Uint8Array>(commits.map((c) => [c.oid, c.compressed]));
      const client = setupMockClient(objects);

      const lca = await findMergeBase(client, m1.oid, m2.oid);
      // Candidates: A2 (1500) and B (1200). A is dominated by A2, Root is dominated by both.
      // A2 has timestamp 1500 > 1200.
      expect(lca).toBe(a2.oid);
    });
  });

  describe('2. Deep Linear and Scalability Stress Tests', () => {
    it('traverses a 500-commit linear chain without stack overflow or performance degradation', async () => {
      const objects = new Map<string, Uint8Array>();
      const chain: string[] = [];

      let parentOid: string | null = null;
      for (let i = 1; i <= 500; i++) {
        const parents = parentOid ? [parentOid] : [];
        const commit = buildCommit(parents, `Commit #${i}`, 1000 + i * 10);
        objects.set(commit.oid, commit.compressed);
        chain.push(commit.oid);
        parentOid = commit.oid;
      }

      const client = setupMockClient(objects, 2000);
      const headOid = chain[499] ?? '';
      const baseOid = chain[249] ?? '';

      const t0 = performance.now();
      const lca = await findMergeBase(client, headOid, baseOid);
      const elapsed = performance.now() - t0;

      expect(lca).toBe(baseOid);
      expect(elapsed).toBeLessThan(1000); // Must be fast and non-blocking
    });

    it('traverses a 1000-commit linear chain from head to root', async () => {
      const objects = new Map<string, Uint8Array>();
      const chain: string[] = [];

      let parentOid: string | null = null;
      for (let i = 1; i <= 1000; i++) {
        const parents = parentOid ? [parentOid] : [];
        const commit = buildCommit(parents, `Commit #${i}`, 1000 + i * 10);
        objects.set(commit.oid, commit.compressed);
        chain.push(commit.oid);
        parentOid = commit.oid;
      }

      const client = setupMockClient(objects, 3000);
      const headOid = chain[999] ?? '';
      const rootOid = chain[0] ?? '';

      const lca = await findMergeBase(client, headOid, rootOid);
      expect(lca).toBe(rootOid);
    });

    it('respects maxCommitsToInspect limit option on deep graphs', async () => {
      const objects = new Map<string, Uint8Array>();
      const chain: string[] = [];

      let parentOid: string | null = null;
      for (let i = 1; i <= 100; i++) {
        const parents = parentOid ? [parentOid] : [];
        const commit = buildCommit(parents, `Commit #${i}`, 1000 + i * 10);
        objects.set(commit.oid, commit.compressed);
        chain.push(commit.oid);
        parentOid = commit.oid;
      }

      const client = setupMockClient(objects);
      const headOid = chain[99] ?? '';
      const rootOid = chain[0] ?? '';

      // Limit inspection to 10 commits -> cannot reach root from head
      const lcaLimited = await findMergeBase(client, headOid, rootOid, {
        maxCommitsToInspect: 10,
      });
      expect(lcaLimited).toBeNull();

      // With enough limit -> finds root
      const lcaFull = await findMergeBase(client, headOid, rootOid, {
        maxCommitsToInspect: 500,
      });
      expect(lcaFull).toBe(rootOid);
    });

    it('handles diamond graph with 50 parallel branches merging into a single tip', async () => {
      const root = buildCommit([], 'Root Diamond', 1000);
      const objects = new Map<string, Uint8Array>([[root.oid, root.compressed]]);

      const branchHeads: string[] = [];
      for (let i = 1; i <= 50; i++) {
        const branchCommit = buildCommit([root.oid], `Branch ${i}`, 1000 + i);
        objects.set(branchCommit.oid, branchCommit.compressed);
        branchHeads.push(branchCommit.oid);
      }

      const mergeHead1 = buildCommit(branchHeads.slice(0, 25), 'Merge 1..25', 2000);
      const mergeHead2 = buildCommit(branchHeads.slice(25, 50), 'Merge 26..50', 2001);
      objects.set(mergeHead1.oid, mergeHead1.compressed);
      objects.set(mergeHead2.oid, mergeHead2.compressed);

      const client = setupMockClient(objects);
      const lca = await findMergeBase(client, mergeHead1.oid, mergeHead2.oid);
      expect(lca).toBe(root.oid);
    });
  });

  describe('3. Disconnected, Orphan, and Degenerate Graphs', () => {
    it('returns null safely for completely disconnected orphan root trees', async () => {
      // Tree 1: R1 -> A1 -> A2
      // Tree 2: R2 -> B1 -> B2
      // Tree 3: R3 -> C1
      const r1 = buildCommit([], 'Root 1', 1000);
      const a1 = buildCommit([r1.oid], 'A1', 1100);
      const a2 = buildCommit([a1.oid], 'A2', 1200);

      const r2 = buildCommit([], 'Root 2', 1000);
      const b1 = buildCommit([r2.oid], 'B1', 1100);
      const b2 = buildCommit([b1.oid], 'B2', 1200);

      const r3 = buildCommit([], 'Root 3', 1000);
      const c1 = buildCommit([r3.oid], 'C1', 1100);

      const objects = new Map<string, Uint8Array>([
        [r1.oid, r1.compressed],
        [a1.oid, a1.compressed],
        [a2.oid, a2.compressed],
        [r2.oid, r2.compressed],
        [b1.oid, b1.compressed],
        [b2.oid, b2.compressed],
        [r3.oid, r3.compressed],
        [c1.oid, c1.compressed],
      ]);
      const client = setupMockClient(objects);

      expect(await findMergeBase(client, a2.oid, b2.oid)).toBeNull();
      expect(await findMergeBase(client, a2.oid, c1.oid)).toBeNull();
      expect(await findMergeBase(client, b2.oid, c1.oid)).toBeNull();
    });

    it('handles missing commit in mid-traversal gracefully without throwing', async () => {
      // A (missing) -> B -> C
      const missingOid = 'ffffffffffffffffffffffffffffffffffffffff';
      const b = buildCommit([missingOid], 'B', 1100);
      const c = buildCommit([b.oid], 'C', 1200);
      const target = buildCommit([], 'Target', 1000);

      const objects = new Map<string, Uint8Array>([
        [b.oid, b.compressed],
        [c.oid, c.compressed],
        [target.oid, target.compressed],
      ]);
      const client = setupMockClient(objects);

      const lca = await findMergeBase(client, c.oid, target.oid);
      expect(lca).toBeNull();
    });

    it('handles invalid, empty, or whitespace-only SHAs cleanly', async () => {
      const root = buildCommit([], 'Root', 1000);
      const objects = new Map<string, Uint8Array>([[root.oid, root.compressed]]);
      const client = setupMockClient(objects);

      expect(await findMergeBase(client, '', root.oid)).toBeNull();
      expect(await findMergeBase(client, root.oid, '   ')).toBeNull();
      expect(await findMergeBase(client, 'invalid-sha', root.oid)).toBeNull();
      expect(await findMergeBase(client, root.oid, 'invalid-sha')).toBeNull();
    });

    it('normalizes uppercase and mixed-case commit SHAs', async () => {
      const root = buildCommit([], 'Root', 1000);
      const c1 = buildCommit([root.oid], 'C1', 1100);
      const c2 = buildCommit([root.oid], 'C2', 1200);

      const objects = new Map<string, Uint8Array>([
        [root.oid, root.compressed],
        [c1.oid, c1.compressed],
        [c2.oid, c2.compressed],
      ]);
      const client = setupMockClient(objects);

      const lca = await findMergeBase(
        client,
        c1.oid.toUpperCase(),
        `  ${c2.oid.toLowerCase()}  `
      );
      expect(lca).toBe(root.oid.toLowerCase());
    });
  });

  describe('4. Cyclic Graph Resilience and Multi-Parent Octopus Merges', () => {
    it('terminates safely on direct self-cycle (commit pointing to itself as parent)', async () => {
      const selfOid = '1111111111111111111111111111111111111111';
      // Build a commit referencing its own pre-calculated OID as parent
      const lines = [
        'tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904',
        `parent ${selfOid}`,
        'author Dev <dev@example.com> 1000 +0000',
        'committer Dev <dev@example.com> 1000 +0000',
        '',
        'Self cycle',
      ];
      const { compressed, oid } = createCompressedGitObject('commit', lines.join('\n'));

      const target = buildCommit([], 'Target', 2000);
      const objects = new Map<string, Uint8Array>([
        [oid, compressed],
        [target.oid, target.compressed],
      ]);
      const client = setupMockClient(objects);

      // Traversal must terminate without infinite loop
      const lca = await findMergeBase(client, oid, target.oid);
      expect(lca).toBeNull();
    });

    it('terminates safely on mutual 2-cycle (A -> B -> A)', async () => {
      // Craft two commits referencing each other
      const placeholderB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
      const aCommit = buildCommit([placeholderB], 'A cycle', 1000);
      const bCommit = buildCommit([aCommit.oid], 'B cycle', 1100);

      // Map placeholderB to bCommit
      const objects = new Map<string, Uint8Array>([
        [aCommit.oid, aCommit.compressed],
        [bCommit.oid, bCommit.compressed],
        [placeholderB, bCommit.compressed],
      ]);
      const client = setupMockClient(objects);

      const target = buildCommit([], 'Target', 2000);
      objects.set(target.oid, target.compressed);

      const lca = await findMergeBase(client, aCommit.oid, target.oid);
      expect(lca).toBeNull();
    });

    it('correctly handles 8-parent octopus merge commits', async () => {
      const root = buildCommit([], 'Root Base', 1000);
      const objects = new Map<string, Uint8Array>([[root.oid, root.compressed]]);

      const parents: string[] = [];
      for (let i = 1; i <= 8; i++) {
        const p = buildCommit([root.oid], `Parent #${i}`, 1000 + i * 50);
        objects.set(p.oid, p.compressed);
        parents.push(p.oid);
      }

      // Octopus merge with 8 parents
      const octopusHead = buildCommit(parents, 'Octopus Merge 8-ways', 2000);
      objects.set(octopusHead.oid, octopusHead.compressed);

      const otherBranch = buildCommit([parents[4] ?? ''], 'Branch off parent 5', 1800);
      objects.set(otherBranch.oid, otherBranch.compressed);

      const client = setupMockClient(objects);

      // LCA of octopusHead and otherBranch should be parents[4] (Parent #5)
      const lca = await findMergeBase(client, octopusHead.oid, otherBranch.oid);
      expect(lca).toBe(parents[4]);

      // Symmetrical test
      const lcaReverse = await findMergeBase(client, otherBranch.oid, octopusHead.oid);
      expect(lcaReverse).toBe(parents[4]);
    });
  });

  describe('5. Commit History Range (getCommitHistoryRange) Boundary & Correctness Tests', () => {
    it('returns empty array when mergeBase equals headSha', async () => {
      const c = buildCommit([], 'Single', 1000);
      const objects = new Map<string, Uint8Array>([[c.oid, c.compressed]]);
      const client = setupMockClient(objects);

      const res = await getCommitHistoryRange(client, c.oid, c.oid);
      expect(res).toEqual([]);
    });

    it('returns empty array when mergeBase and headSha differ only by case or whitespace', async () => {
      const c = buildCommit([], 'Single', 1000);
      const objects = new Map<string, Uint8Array>([[c.oid, c.compressed]]);
      const client = setupMockClient(objects);

      const res = await getCommitHistoryRange(client, c.oid.toUpperCase(), `  ${c.oid}  `);
      expect(res).toEqual([]);
    });

    it('returns empty array for invalid or empty headSha', async () => {
      const client = setupMockClient(new Map());
      expect(await getCommitHistoryRange(client, null, '')).toEqual([]);
      expect(await getCommitHistoryRange(client, null, '   ')).toEqual([]);
    });

    it('correctly returns commits in mergeBase..head excluding all mergeBase ancestors', async () => {
      // R1 (100) -> R2 (200) -> Base (300) -> MainTip (400)
      //                          \-> PR1 (350) -> PR2 (450)
      const r1 = buildCommit([], 'R1', 100);
      const r2 = buildCommit([r1.oid], 'R2', 200);
      const base = buildCommit([r2.oid], 'Base', 300);
      const mainTip = buildCommit([base.oid], 'MainTip', 400);
      const pr1 = buildCommit([base.oid], 'PR1', 350);
      const pr2 = buildCommit([pr1.oid], 'PR2', 450);

      const objects = new Map<string, Uint8Array>([
        [r1.oid, r1.compressed],
        [r2.oid, r2.compressed],
        [base.oid, base.compressed],
        [mainTip.oid, mainTip.compressed],
        [pr1.oid, pr1.compressed],
        [pr2.oid, pr2.compressed],
      ]);
      const client = setupMockClient(objects);

      const range = await getCommitHistoryRange(client, base.oid, pr2.oid);
      expect(range).toHaveLength(2);
      expect(range[0]?.oid).toBe(pr2.oid);
      expect(range[0]?.subject).toBe('PR2');
      expect(range[1]?.oid).toBe(pr1.oid);
      expect(range[1]?.subject).toBe('PR1');
    });

    it('handles clock-skew (commit timestamps out of chronological order)', async () => {
      // Base (1000) -> C1 (800 clock warp) -> C2 (900) -> C3 (1200)
      const base = buildCommit([], 'Base', 1000);
      const c1 = buildCommit([base.oid], 'C1 Clock Warped', 800);
      const c2 = buildCommit([c1.oid], 'C2', 900);
      const c3 = buildCommit([c2.oid], 'C3', 1200);

      const objects = new Map<string, Uint8Array>([
        [base.oid, base.compressed],
        [c1.oid, c1.compressed],
        [c2.oid, c2.compressed],
        [c3.oid, c3.compressed],
      ]);
      const client = setupMockClient(objects);

      const range = await getCommitHistoryRange(client, base.oid, c3.oid);
      expect(range).toHaveLength(3);
      // Results sorted descending by timestamp
      expect(range[0]?.oid).toBe(c3.oid); // 1200
      expect(range[1]?.oid).toBe(c2.oid); // 900
      expect(range[2]?.oid).toBe(c1.oid); // 800
    });

    it('correctly handles limit boundary conditions (limit 0, limit 1, limit larger than count)', async () => {
      const c1 = buildCommit([], 'C1', 100);
      const c2 = buildCommit([c1.oid], 'C2', 200);
      const c3 = buildCommit([c2.oid], 'C3', 300);

      const objects = new Map<string, Uint8Array>([
        [c1.oid, c1.compressed],
        [c2.oid, c2.compressed],
        [c3.oid, c3.compressed],
      ]);
      const client = setupMockClient(objects);

      expect(await getCommitHistoryRange(client, null, c3.oid, 0)).toEqual([]);
      const one = await getCommitHistoryRange(client, null, c3.oid, 1);
      expect(one).toHaveLength(1);
      expect(one[0]?.oid).toBe(c3.oid);

      const all = await getCommitHistoryRange(client, null, c3.oid, 100);
      expect(all).toHaveLength(3);
    });

    it('returns empty array when head is an ancestor of mergeBase (reverse range)', async () => {
      // C1 -> C2 -> C3 (base: C3, head: C1)
      const c1 = buildCommit([], 'C1', 100);
      const c2 = buildCommit([c1.oid], 'C2', 200);
      const c3 = buildCommit([c2.oid], 'C3', 300);

      const objects = new Map<string, Uint8Array>([
        [c1.oid, c1.compressed],
        [c2.oid, c2.compressed],
        [c3.oid, c3.compressed],
      ]);
      const client = setupMockClient(objects);

      const range = await getCommitHistoryRange(client, c3.oid, c1.oid);
      expect(range).toEqual([]);
    });

    it('handles merge commits inside PR branch without duplicate entries', async () => {
      // Base (100) -> BranchA (200) \
      //             -> BranchB (250) -> PRMerge (300)
      const base = buildCommit([], 'Base', 100);
      const a = buildCommit([base.oid], 'BranchA', 200);
      const b = buildCommit([base.oid], 'BranchB', 250);
      const prMerge = buildCommit([a.oid, b.oid], 'PRMerge', 300);

      const objects = new Map<string, Uint8Array>([
        [base.oid, base.compressed],
        [a.oid, a.compressed],
        [b.oid, b.compressed],
        [prMerge.oid, prMerge.compressed],
      ]);
      const client = setupMockClient(objects);

      const range = await getCommitHistoryRange(client, base.oid, prMerge.oid);
      expect(range).toHaveLength(3);
      const oids = range.map((r) => r.oid);
      expect(oids).toEqual([prMerge.oid, b.oid, a.oid]);
      expect(new Set(oids).size).toBe(3); // No duplicates
    });

    it('handles cyclic parent reference inside PR branch without infinite loop', async () => {
      const placeholder = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const c1 = buildCommit([placeholder], 'C1 cycle', 100);
      const c2 = buildCommit([c1.oid], 'C2', 200);

      const objects = new Map<string, Uint8Array>([
        [c1.oid, c1.compressed],
        [c2.oid, c2.compressed],
        [placeholder, c1.compressed],
      ]);
      const client = setupMockClient(objects);

      const range = await getCommitHistoryRange(client, null, c2.oid);
      expect(range).toHaveLength(2);
      expect(range[0]?.oid).toBe(c2.oid);
      expect(range[1]?.oid).toBe(c1.oid);
    });
  });
});
