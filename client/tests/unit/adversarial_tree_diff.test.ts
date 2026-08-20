import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CollabClient,
  loadReviewNotes,
} from '../../src/engine/collab-client.js';
import { GitRepositoryClient } from '../../src/engine/fetcher.js';
import {
  attachReviewNotes,
  buildHunks,
  buildSplitRows,
  computeEditSequence,
  computeFileDiff,
  computeTreeDiff,
  computeTreeFullDiff,
} from '../../src/worker/diff-algo.js';
import { DiffClient, diffClient } from '../../src/worker/diff-client.js';
import type {
  FileDiff,
  ReviewNote,
} from '../../src/worker/diff-types.js';
import { createCompressedGitObject, createTreePayload } from '../fixtures.js';

interface InstrumentedRepoClient {
  readonly client: GitRepositoryClient;
  readonly objects: Map<string, Uint8Array>;
  readonly fetchLog: string[];
}

function createInstrumentedRepoClient(): InstrumentedRepoClient {
  const objects = new Map<string, Uint8Array>();
  const fetchLog: string[] = [];
  const client = new GitRepositoryClient('https://mock.sendforge.adversarial');

  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      fetchLog.push(url);
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

  return { client, objects, fetchLog };
}

describe('Adversarial & Stress Tests: Tree Diff Engine & Web Worker (Milestone M2)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    diffClient.terminate();
  });

  // =========================================================================
  // 1. Large Tree Diffs & O(changed) Subtree Pruning Stress Tests
  // =========================================================================
  describe('1. Large Tree Diffs & O(changed) Subtree Pruning', () => {
    it('verifies O(changed) pruning on a 500-file repository across 10 subdirectories with 1 changed file', async () => {
      const { client, objects, fetchLog } = createInstrumentedRepoClient();

      // Create 10 subdirectories, each with 50 files (total 500 files)
      const subTreeOidsBase: { name: string; oid: string }[] = [];
      const subTreeOidsHead: { name: string; oid: string }[] = [];

      let modifiedOldBlobOid = '';
      let modifiedNewBlobOid = '';

      for (let d = 0; d < 10; d++) {
        const dirName = `dir_${d}`;
        const baseEntries: { mode: string; name: string; oid: string }[] = [];
        const headEntries: { mode: string; name: string; oid: string }[] = [];

        for (let f = 0; f < 50; f++) {
          const fileName = `file_${f}.txt`;
          const baseContent = `Content for ${dirName}/${fileName}\n`;
          const baseBlob = createCompressedGitObject('blob', baseContent);
          objects.set(baseBlob.oid, baseBlob.compressed);

          if (d === 4 && f === 25) {
            // This is the ONE file modified in head
            const headContent = `Content for ${dirName}/${fileName} MODIFIED\n`;
            const headBlob = createCompressedGitObject('blob', headContent);
            objects.set(headBlob.oid, headBlob.compressed);

            modifiedOldBlobOid = baseBlob.oid;
            modifiedNewBlobOid = headBlob.oid;

            baseEntries.push({ mode: '100644', name: fileName, oid: baseBlob.oid });
            headEntries.push({ mode: '100644', name: fileName, oid: headBlob.oid });
          } else {
            baseEntries.push({ mode: '100644', name: fileName, oid: baseBlob.oid });
            headEntries.push({ mode: '100644', name: fileName, oid: baseBlob.oid });
          }
        }

        const baseSubTreeObj = createCompressedGitObject('tree', createTreePayload(baseEntries));
        objects.set(baseSubTreeObj.oid, baseSubTreeObj.compressed);
        subTreeOidsBase.push({ name: dirName, oid: baseSubTreeObj.oid });

        if (d === 4) {
          const headSubTreeObj = createCompressedGitObject('tree', createTreePayload(headEntries));
          objects.set(headSubTreeObj.oid, headSubTreeObj.compressed);
          subTreeOidsHead.push({ name: dirName, oid: headSubTreeObj.oid });
        } else {
          // Identical subtree OID in head for unchanged dirs
          subTreeOidsHead.push({ name: dirName, oid: baseSubTreeObj.oid });
        }
      }

      // Root trees
      const rootTreeBaseObj = createCompressedGitObject(
        'tree',
        createTreePayload(subTreeOidsBase.map((s) => ({ mode: '040000', name: s.name, oid: s.oid })))
      );
      const rootTreeHeadObj = createCompressedGitObject(
        'tree',
        createTreePayload(subTreeOidsHead.map((s) => ({ mode: '040000', name: s.name, oid: s.oid })))
      );
      objects.set(rootTreeBaseObj.oid, rootTreeBaseObj.compressed);
      objects.set(rootTreeHeadObj.oid, rootTreeHeadObj.compressed);

      // Commits
      const baseCommit = createCompressedGitObject(
        'commit',
        `tree ${rootTreeBaseObj.oid}\nauthor User <u@ex.com> 1000 +0000\ncommitter User <u@ex.com> 1000 +0000\n\nBase Commit\n`
      );
      const headCommit = createCompressedGitObject(
        'commit',
        `tree ${rootTreeHeadObj.oid}\nparent ${baseCommit.oid}\nauthor User <u@ex.com> 2000 +0000\ncommitter User <u@ex.com> 2000 +0000\n\nHead Commit\n`
      );
      objects.set(baseCommit.oid, baseCommit.compressed);
      objects.set(headCommit.oid, headCommit.compressed);

      fetchLog.length = 0; // Reset fetch counter
      const startMs = performance.now();
      const diffs = await computeTreeDiff(client, baseCommit.oid, headCommit.oid);
      const elapsedMs = performance.now() - startMs;

      expect(diffs).toHaveLength(1);
      const changed = diffs[0];
      expect(changed?.status).toBe('modified');
      expect(changed?.newPath).toBe('dir_4/file_25.txt');
      expect(changed?.oldOid).toBe(modifiedOldBlobOid);
      expect(changed?.newOid).toBe(modifiedNewBlobOid);

      // Verify O(changed) pruning:
      // Only base & head commits (2), base & head root trees (2), base & head dir_4 trees (2), and 2 blobs for file_25 were fetched.
      // The other 9 directory subtrees (dir_0..dir_3, dir_5..dir_9) were NEVER fetched or traversed!
      const fetchedOids = new Set(
        fetchLog.map((url) => {
          const parts = url.split('/');
          return ((parts[parts.length - 2] ?? '') + (parts[parts.length - 1] ?? '')).toLowerCase();
        })
      );

      // Total fetched unique objects should be exactly: 2 commits + 4 trees + 2 blobs = 8 objects (out of 500+ objects)
      expect(fetchedOids.size).toBeLessThanOrEqual(8);
      expect(elapsedMs).toBeLessThan(100); // Subtree pruning must be extremely fast (< 100ms)
    });

    it('handles 15 levels of deep nesting with sibling trees without recursing into unchanged siblings', async () => {
      const { client, objects } = createInstrumentedRepoClient();

      // Create a leaf file at depth 15
      const leafBlobOld = createCompressedGitObject('blob', 'Original deep content\n');
      const leafBlobNew = createCompressedGitObject('blob', 'Modified deep content\n');
      objects.set(leafBlobOld.oid, leafBlobOld.compressed);
      objects.set(leafBlobNew.oid, leafBlobNew.compressed);

      // Build chain of 15 trees from bottom up
      let currentBaseOid = leafBlobOld.oid;
      let currentHeadOid = leafBlobNew.oid;

      // Bottom level (15) contains the leaf file
      const baseL15 = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'leaf.txt', oid: currentBaseOid }]));
      const headL15 = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'leaf.txt', oid: currentHeadOid }]));
      objects.set(baseL15.oid, baseL15.compressed);
      objects.set(headL15.oid, headL15.compressed);
      currentBaseOid = baseL15.oid;
      currentHeadOid = headL15.oid;

      // Levels 14 down to 1
      for (let lvl = 14; lvl >= 1; lvl--) {
        // Also add an unchanged sibling directory with 20 files at each level
        const siblingFiles: { mode: string; name: string; oid: string }[] = [];
        for (let i = 0; i < 20; i++) {
          const sibBlob = createCompressedGitObject('blob', `Sibling content lvl ${lvl} file ${i}\n`);
          objects.set(sibBlob.oid, sibBlob.compressed);
          siblingFiles.push({ mode: '100644', name: `sib_${i}.txt`, oid: sibBlob.oid });
        }
        const sibTree = createCompressedGitObject('tree', createTreePayload(siblingFiles));
        objects.set(sibTree.oid, sibTree.compressed);

        const baseLvlTree = createCompressedGitObject(
          'tree',
          createTreePayload([
            { mode: '040000', name: `level_${lvl + 1}`, oid: currentBaseOid },
            { mode: '040000', name: `sibling_${lvl}`, oid: sibTree.oid },
          ])
        );
        const headLvlTree = createCompressedGitObject(
          'tree',
          createTreePayload([
            { mode: '040000', name: `level_${lvl + 1}`, oid: currentHeadOid },
            { mode: '040000', name: `sibling_${lvl}`, oid: sibTree.oid },
          ])
        );
        objects.set(baseLvlTree.oid, baseLvlTree.compressed);
        objects.set(headLvlTree.oid, headLvlTree.compressed);

        currentBaseOid = baseLvlTree.oid;
        currentHeadOid = headLvlTree.oid;
      }

      const baseCommit = createCompressedGitObject('commit', `tree ${currentBaseOid}\nauthor A <a@ex.com> 1000 +0000\ncommitter A <a@ex.com> 1000 +0000\n\nBase\n`);
      const headCommit = createCompressedGitObject('commit', `tree ${currentHeadOid}\nauthor B <b@ex.com> 2000 +0000\ncommitter B <b@ex.com> 2000 +0000\n\nHead\n`);
      objects.set(baseCommit.oid, baseCommit.compressed);
      objects.set(headCommit.oid, headCommit.compressed);

      const diffs = await computeTreeDiff(client, baseCommit.oid, headCommit.oid);
      expect(diffs).toHaveLength(1);
      expect(diffs[0]?.newPath).toBe(
        'level_2/level_3/level_4/level_5/level_6/level_7/level_8/level_9/level_10/level_11/level_12/level_13/level_14/level_15/leaf.txt'
      );
      expect(diffs[0]?.status).toBe('modified');
    });

    it('computes 500 additions when baseCommitSha is null or all files are newly created', async () => {
      const { client, objects } = createInstrumentedRepoClient();

      const entries: { mode: string; name: string; oid: string }[] = [];
      for (let i = 0; i < 500; i++) {
        const blob = createCompressedGitObject('blob', `Initial line ${i}\n`);
        objects.set(blob.oid, blob.compressed);
        entries.push({ mode: '100644', name: `file_${i}.txt`, oid: blob.oid });
      }

      const rootTree = createCompressedGitObject('tree', createTreePayload(entries));
      objects.set(rootTree.oid, rootTree.compressed);

      const headCommit = createCompressedGitObject(
        'commit',
        `tree ${rootTree.oid}\nauthor A <a@ex.com> 1000 +0000\ncommitter A <a@ex.com> 1000 +0000\n\nInitial\n`
      );
      objects.set(headCommit.oid, headCommit.compressed);

      const diffs = await computeTreeDiff(client, null, headCommit.oid);
      expect(diffs).toHaveLength(500);
      expect(diffs.every((d) => d.status === 'added')).toBe(true);
      expect(diffs.every((d) => d.oldPath === null && d.newPath !== null)).toBe(true);
    });

    it('computes 500 deletions when headCommitSha has all files removed', async () => {
      const { client, objects } = createInstrumentedRepoClient();

      const entries: { mode: string; name: string; oid: string }[] = [];
      for (let i = 0; i < 500; i++) {
        const blob = createCompressedGitObject('blob', `Delete line ${i}\n`);
        objects.set(blob.oid, blob.compressed);
        entries.push({ mode: '100644', name: `file_${i}.txt`, oid: blob.oid });
      }

      const baseRootTree = createCompressedGitObject('tree', createTreePayload(entries));
      const emptyHeadTree = createCompressedGitObject('tree', createTreePayload([]));
      objects.set(baseRootTree.oid, baseRootTree.compressed);
      objects.set(emptyHeadTree.oid, emptyHeadTree.compressed);

      const baseCommit = createCompressedGitObject('commit', `tree ${baseRootTree.oid}\nauthor A <a@ex.com> 1000 +0000\ncommitter A <a@ex.com> 1000 +0000\n\nFull\n`);
      const headCommit = createCompressedGitObject('commit', `tree ${emptyHeadTree.oid}\nauthor A <a@ex.com> 2000 +0000\ncommitter A <a@ex.com> 2000 +0000\n\nEmpty\n`);
      objects.set(baseCommit.oid, baseCommit.compressed);
      objects.set(headCommit.oid, headCommit.compressed);

      const diffs = await computeTreeDiff(client, baseCommit.oid, headCommit.oid);
      expect(diffs).toHaveLength(500);
      expect(diffs.every((d) => d.status === 'deleted')).toBe(true);
      expect(diffs.every((d) => d.newPath === null && d.oldPath !== null)).toBe(true);
    });

    it('handles directory-to-file and file-to-directory replacement type changes correctly', async () => {
      const { client, objects } = createInstrumentedRepoClient();

      // Base: dir 'sub' has 3 files; file 'standalone.txt' is a single file
      const subBlob1 = createCompressedGitObject('blob', 'Sub 1\n');
      const subBlob2 = createCompressedGitObject('blob', 'Sub 2\n');
      const standaloneBlob = createCompressedGitObject('blob', 'Standalone file\n');
      objects.set(subBlob1.oid, subBlob1.compressed);
      objects.set(subBlob2.oid, subBlob2.compressed);
      objects.set(standaloneBlob.oid, standaloneBlob.compressed);

      const subTreeBase = createCompressedGitObject('tree', createTreePayload([
        { mode: '100644', name: 'a.txt', oid: subBlob1.oid },
        { mode: '100644', name: 'b.txt', oid: subBlob2.oid },
      ]));
      objects.set(subTreeBase.oid, subTreeBase.compressed);

      const baseRoot = createCompressedGitObject('tree', createTreePayload([
        { mode: '040000', name: 'sub', oid: subTreeBase.oid },
        { mode: '100644', name: 'standalone', oid: standaloneBlob.oid },
      ]));
      objects.set(baseRoot.oid, baseRoot.compressed);

      // Head: 'sub' is replaced by a single file; 'standalone' is replaced by a directory containing 2 files
      const newSubBlob = createCompressedGitObject('blob', 'Now a file\n');
      const newStand1 = createCompressedGitObject('blob', 'Stand 1\n');
      const newStand2 = createCompressedGitObject('blob', 'Stand 2\n');
      objects.set(newSubBlob.oid, newSubBlob.compressed);
      objects.set(newStand1.oid, newStand1.compressed);
      objects.set(newStand2.oid, newStand2.compressed);

      const standaloneTreeHead = createCompressedGitObject('tree', createTreePayload([
        { mode: '100644', name: 'nested1.txt', oid: newStand1.oid },
        { mode: '100644', name: 'nested2.txt', oid: newStand2.oid },
      ]));
      objects.set(standaloneTreeHead.oid, standaloneTreeHead.compressed);

      const headRoot = createCompressedGitObject('tree', createTreePayload([
        { mode: '100644', name: 'sub', oid: newSubBlob.oid },
        { mode: '040000', name: 'standalone', oid: standaloneTreeHead.oid },
      ]));
      objects.set(headRoot.oid, headRoot.compressed);

      const baseCommit = createCompressedGitObject('commit', `tree ${baseRoot.oid}\nauthor A <a@ex.com> 1000 +0000\ncommitter A <a@ex.com> 1000 +0000\n\nBase\n`);
      const headCommit = createCompressedGitObject('commit', `tree ${headRoot.oid}\nauthor B <b@ex.com> 2000 +0000\ncommitter B <b@ex.com> 2000 +0000\n\nHead\n`);
      objects.set(baseCommit.oid, baseCommit.compressed);
      objects.set(headCommit.oid, headCommit.compressed);

      const diffs = await computeTreeDiff(client, baseCommit.oid, headCommit.oid);

      // Old sub/a.txt and sub/b.txt were deleted (2)
      // New sub was added as a file (1)
      // Old standalone was deleted as a file (1)
      // New standalone/nested1.txt and standalone/nested2.txt were added (2)
      // Total diff summaries = 6
      expect(diffs).toHaveLength(6);

      const deletedSubA = diffs.find((d) => d.oldPath === 'sub/a.txt');
      expect(deletedSubA?.status).toBe('deleted');

      const deletedSubB = diffs.find((d) => d.oldPath === 'sub/b.txt');
      expect(deletedSubB?.status).toBe('deleted');

      const addedSub = diffs.find((d) => d.newPath === 'sub');
      expect(addedSub?.status).toBe('added');

      const deletedStand = diffs.find((d) => d.oldPath === 'standalone');
      expect(deletedStand?.status).toBe('deleted');

      const addedStand1 = diffs.find((d) => d.newPath === 'standalone/nested1.txt');
      expect(addedStand1?.status).toBe('added');

      const addedStand2 = diffs.find((d) => d.newPath === 'standalone/nested2.txt');
      expect(addedStand2?.status).toBe('added');
    });
  });

  // =========================================================================
  // 2. File Mode Changes & Binary Diff Handling
  // =========================================================================
  describe('2. File Mode Changes & Binary Diff Handling', () => {
    it('accurately identifies executable bit changes (+x and -x) without content modifications', async () => {
      const { client, objects } = createInstrumentedRepoClient();

      const scriptBlob = createCompressedGitObject('blob', '#!/usr/bin/env bash\necho "Hello"\n');
      objects.set(scriptBlob.oid, scriptBlob.compressed);

      // Base: script.sh is 100644; run.sh is 100755
      const baseTree = createCompressedGitObject('tree', createTreePayload([
        { mode: '100644', name: 'script.sh', oid: scriptBlob.oid },
        { mode: '100755', name: 'run.sh', oid: scriptBlob.oid },
      ]));
      // Head: script.sh is 100755 (chmod +x); run.sh is 100644 (chmod -x)
      const headTree = createCompressedGitObject('tree', createTreePayload([
        { mode: '100755', name: 'script.sh', oid: scriptBlob.oid },
        { mode: '100644', name: 'run.sh', oid: scriptBlob.oid },
      ]));
      objects.set(baseTree.oid, baseTree.compressed);
      objects.set(headTree.oid, headTree.compressed);

      const baseCommit = createCompressedGitObject('commit', `tree ${baseTree.oid}\nauthor A <a@ex.com> 1000 +0000\ncommitter A <a@ex.com> 1000 +0000\n\nC1\n`);
      const headCommit = createCompressedGitObject('commit', `tree ${headTree.oid}\nauthor B <b@ex.com> 2000 +0000\ncommitter B <b@ex.com> 2000 +0000\n\nC2\n`);
      objects.set(baseCommit.oid, baseCommit.compressed);
      objects.set(headCommit.oid, headCommit.compressed);

      const summaries = await computeTreeDiff(client, baseCommit.oid, headCommit.oid);
      expect(summaries).toHaveLength(2);

      const scriptSummary = summaries.find((s) => s.newPath === 'script.sh');
      expect(scriptSummary?.status).toBe('modified');
      expect(scriptSummary?.modeChanged).toBe(true);
      expect(scriptSummary?.oldMode).toBe('100644');
      expect(scriptSummary?.newMode).toBe('100755');
      expect(scriptSummary?.oldOid).toBe(scriptBlob.oid);
      expect(scriptSummary?.newOid).toBe(scriptBlob.oid);

      const runSummary = summaries.find((s) => s.newPath === 'run.sh');
      expect(runSummary?.status).toBe('modified');
      expect(runSummary?.modeChanged).toBe(true);
      expect(runSummary?.oldMode).toBe('100755');
      expect(runSummary?.newMode).toBe('100644');

      // Full diff check: mode changed only -> 0 additions, 0 deletions, empty hunks
      const fullDiffs = await computeTreeFullDiff(client, baseCommit.oid, headCommit.oid);
      expect(fullDiffs).toHaveLength(2);
      expect(fullDiffs.every((fd) => fd.modeChanged === true)).toBe(true);
      expect(fullDiffs.every((fd) => fd.additions === 0 && fd.deletions === 0)).toBe(true);
      expect(fullDiffs.every((fd) => fd.hunks.length === 0)).toBe(true);
    });

    it('accurately handles simultaneous file mode change AND content modification', async () => {
      const { client, objects } = createInstrumentedRepoClient();

      const blob1 = createCompressedGitObject('blob', 'echo 1\n');
      const blob2 = createCompressedGitObject('blob', 'echo 1\necho 2\n');
      objects.set(blob1.oid, blob1.compressed);
      objects.set(blob2.oid, blob2.compressed);

      const baseTree = createCompressedGitObject('tree', createTreePayload([
        { mode: '100644', name: 'tool.sh', oid: blob1.oid },
      ]));
      const headTree = createCompressedGitObject('tree', createTreePayload([
        { mode: '100755', name: 'tool.sh', oid: blob2.oid },
      ]));
      objects.set(baseTree.oid, baseTree.compressed);
      objects.set(headTree.oid, headTree.compressed);

      const baseCommit = createCompressedGitObject('commit', `tree ${baseTree.oid}\nauthor A <a@ex.com> 1000 +0000\ncommitter A <a@ex.com> 1000 +0000\n\nC1\n`);
      const headCommit = createCompressedGitObject('commit', `tree ${headTree.oid}\nauthor B <b@ex.com> 2000 +0000\ncommitter B <b@ex.com> 2000 +0000\n\nC2\n`);
      objects.set(baseCommit.oid, baseCommit.compressed);
      objects.set(headCommit.oid, headCommit.compressed);

      const fullDiffs = await computeTreeFullDiff(client, baseCommit.oid, headCommit.oid);
      expect(fullDiffs).toHaveLength(1);

      const diff = fullDiffs[0];
      expect(diff?.status).toBe('modified');
      expect(diff?.modeChanged).toBe(true);
      expect(diff?.oldMode).toBe('100644');
      expect(diff?.newMode).toBe('100755');
      expect(diff?.additions).toBe(1);
      expect(diff?.deletions).toBe(0);
      expect(diff?.hunks.length).toBe(1);
    });

    it('safely handles symlinks (mode 120000) and submodules (mode 160000)', async () => {
      const { client, objects } = createInstrumentedRepoClient();

      const linkBlob1 = createCompressedGitObject('blob', '../target/file1.ts');
      const linkBlob2 = createCompressedGitObject('blob', '../target/file2.ts');
      objects.set(linkBlob1.oid, linkBlob1.compressed);
      objects.set(linkBlob2.oid, linkBlob2.compressed);

      const baseTree = createCompressedGitObject('tree', createTreePayload([
        { mode: '120000', name: 'symlink.ts', oid: linkBlob1.oid },
        { mode: '160000', name: 'vendor_submodule', oid: '1111111111111111111111111111111111111111' },
      ]));
      const headTree = createCompressedGitObject('tree', createTreePayload([
        { mode: '120000', name: 'symlink.ts', oid: linkBlob2.oid },
        { mode: '160000', name: 'vendor_submodule', oid: '2222222222222222222222222222222222222222' },
      ]));
      objects.set(baseTree.oid, baseTree.compressed);
      objects.set(headTree.oid, headTree.compressed);

      const baseCommit = createCompressedGitObject('commit', `tree ${baseTree.oid}\nauthor A <a@ex.com> 1000 +0000\ncommitter A <a@ex.com> 1000 +0000\n\nC1\n`);
      const headCommit = createCompressedGitObject('commit', `tree ${headTree.oid}\nauthor B <b@ex.com> 2000 +0000\ncommitter B <b@ex.com> 2000 +0000\n\nC2\n`);
      objects.set(baseCommit.oid, baseCommit.compressed);
      objects.set(headCommit.oid, headCommit.compressed);

      const summaries = await computeTreeDiff(client, baseCommit.oid, headCommit.oid);
      expect(summaries).toHaveLength(2);

      const symlink = summaries.find((s) => s.newPath === 'symlink.ts');
      expect(symlink?.status).toBe('modified');
      expect(symlink?.oldMode).toBe('120000');

      const submodule = summaries.find((s) => s.newPath === 'vendor_submodule');
      expect(submodule?.status).toBe('modified');
      expect(submodule?.oldMode).toBe('160000');
    });

    it('handles binary files with embedded null bytes without Myers diffing', async () => {
      const { client, objects } = createInstrumentedRepoClient();

      // Binary buffers with embedded 0x00 bytes
      const rawBin1 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x01, 0x02, 0xff]);
      const rawBin2 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x03, 0x04, 0xff]);
      const binBlob1 = createCompressedGitObject('blob', rawBin1);
      const binBlob2 = createCompressedGitObject('blob', rawBin2);
      objects.set(binBlob1.oid, binBlob1.compressed);
      objects.set(binBlob2.oid, binBlob2.compressed);

      const baseTree = createCompressedGitObject('tree', createTreePayload([
        { mode: '100644', name: 'image.png', oid: binBlob1.oid },
      ]));
      const headTree = createCompressedGitObject('tree', createTreePayload([
        { mode: '100644', name: 'image.png', oid: binBlob2.oid },
      ]));
      objects.set(baseTree.oid, baseTree.compressed);
      objects.set(headTree.oid, headTree.compressed);

      const baseCommit = createCompressedGitObject('commit', `tree ${baseTree.oid}\nauthor A <a@ex.com> 1000 +0000\ncommitter A <a@ex.com> 1000 +0000\n\nC1\n`);
      const headCommit = createCompressedGitObject('commit', `tree ${headTree.oid}\nauthor B <b@ex.com> 2000 +0000\ncommitter B <b@ex.com> 2000 +0000\n\nC2\n`);
      objects.set(baseCommit.oid, baseCommit.compressed);
      objects.set(headCommit.oid, headCommit.compressed);

      const fullDiffs = await computeTreeFullDiff(client, baseCommit.oid, headCommit.oid);
      expect(fullDiffs).toHaveLength(1);

      const binDiff = fullDiffs[0];
      expect(binDiff?.isBinary).toBe(true);
      expect(binDiff?.hunks).toEqual([]);
      expect(binDiff?.splitRows).toEqual([]);
      expect(binDiff?.additions).toBe(0);
      expect(binDiff?.deletions).toBe(0);
    });

    it('handles binary-to-text and text-to-binary transitions correctly', async () => {
      const { client, objects } = createInstrumentedRepoClient();

      const binData = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
      const binBlob = createCompressedGitObject('blob', binData);
      const textBlob = createCompressedGitObject('blob', '<svg><circle/></svg>\n');
      objects.set(binBlob.oid, binBlob.compressed);
      objects.set(textBlob.oid, textBlob.compressed);

      // base: file1 is binary, file2 is text
      const baseTree = createCompressedGitObject('tree', createTreePayload([
        { mode: '100644', name: 'icon.svg', oid: binBlob.oid },
        { mode: '100644', name: 'data.bin', oid: textBlob.oid },
      ]));
      // head: file1 is now text, file2 is now binary
      const headTree = createCompressedGitObject('tree', createTreePayload([
        { mode: '100644', name: 'icon.svg', oid: textBlob.oid },
        { mode: '100644', name: 'data.bin', oid: binBlob.oid },
      ]));
      objects.set(baseTree.oid, baseTree.compressed);
      objects.set(headTree.oid, headTree.compressed);

      const baseCommit = createCompressedGitObject('commit', `tree ${baseTree.oid}\nauthor A <a@ex.com> 1000 +0000\ncommitter A <a@ex.com> 1000 +0000\n\nC1\n`);
      const headCommit = createCompressedGitObject('commit', `tree ${headTree.oid}\nauthor B <b@ex.com> 2000 +0000\ncommitter B <b@ex.com> 2000 +0000\n\nC2\n`);
      objects.set(baseCommit.oid, baseCommit.compressed);
      objects.set(headCommit.oid, headCommit.compressed);

      const fullDiffs = await computeTreeFullDiff(client, baseCommit.oid, headCommit.oid);
      expect(fullDiffs).toHaveLength(2);

      // Both should be marked as binary because either old or new was binary
      expect(fullDiffs.every((fd) => fd.isBinary)).toBe(true);
      expect(fullDiffs.every((fd) => fd.hunks.length === 0)).toBe(true);
    });
  });

  // =========================================================================
  // 3. Malformed Diff Requests, Empty Batches & Failure Resilience
  // =========================================================================
  describe('3. Malformed Diff Requests, Empty Batches & Error Resilience', () => {
    it('handles empty batch diff requests without errors', async () => {
      const results = await diffClient.computeBatchDiff([]);
      expect(results).toEqual([]);
    });

    it('handles null paths, null contents, and empty string diffs safely', () => {
      const d1 = computeFileDiff(null, null, null, null);
      expect(d1.additions).toBe(0);
      expect(d1.deletions).toBe(0);
      expect(d1.hunks).toEqual([]);

      const d2 = computeFileDiff('empty.txt', 'empty.txt', '', '');
      expect(d2.additions).toBe(0);
      expect(d2.deletions).toBe(0);
      expect(d2.hunks).toEqual([]);

      const d3 = computeFileDiff(null, 'new.txt', null, '');
      expect(d3.additions).toBe(1);
      expect(d3.deletions).toBe(0);

      const d4 = computeFileDiff('old.txt', null, '', null);
      expect(d4.additions).toBe(0);
      expect(d4.deletions).toBe(1);
    });

    it('handles extreme contextLines parameters (0, negative, and oversized)', () => {
      const oldText = '1\n2\n3\n4\n5\n6\n7\n8\n9\n10';
      const newText = '1\n2\n3\n4\n5 MOD\n6\n7\n8\n9\n10';

      // 0 context lines: only the modified line
      const ops = computeEditSequence(oldText.split('\n'), newText.split('\n'));
      const hunks0 = buildHunks(ops, 0);
      expect(hunks0.length).toBe(1);
      expect(hunks0[0]?.lines.length).toBe(2); // 1 delete + 1 add, 0 context

      // 1000 context lines: entire file in one hunk
      const hunks1000 = buildHunks(ops, 1000);
      expect(hunks1000.length).toBe(1);
      expect(hunks1000[0]?.lines.length).toBe(11);

      // Verify buildSplitRows handles asymmetric hunk lines
      const splitRows = buildSplitRows(hunks0);
      expect(splitRows.length).toBe(1);
      expect(splitRows[0]?.left.type).toBe('delete');
      expect(splitRows[0]?.right.type).toBe('add');
    });

    it('handles blobs containing invalid UTF-8 byte sequences gracefully without crashing', async () => {
      const { client, objects } = createInstrumentedRepoClient();

      // Invalid UTF-8 sequence (e.g. lone 0xC0 or 0xFF without continuation byte)
      const invalidUtf8Old = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0xc0, 0xaf, 0x0a]);
      const invalidUtf8New = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0xc0, 0xbf, 0x0a]);

      const blob1 = createCompressedGitObject('blob', invalidUtf8Old);
      const blob2 = createCompressedGitObject('blob', invalidUtf8New);
      objects.set(blob1.oid, blob1.compressed);
      objects.set(blob2.oid, blob2.compressed);

      const baseTree = createCompressedGitObject('tree', createTreePayload([
        { mode: '100644', name: 'corrupt.txt', oid: blob1.oid },
      ]));
      const headTree = createCompressedGitObject('tree', createTreePayload([
        { mode: '100644', name: 'corrupt.txt', oid: blob2.oid },
      ]));
      objects.set(baseTree.oid, baseTree.compressed);
      objects.set(headTree.oid, headTree.compressed);

      const baseCommit = createCompressedGitObject('commit', `tree ${baseTree.oid}\nauthor A <a@ex.com> 1000 +0000\ncommitter A <a@ex.com> 1000 +0000\n\nC1\n`);
      const headCommit = createCompressedGitObject('commit', `tree ${headTree.oid}\nauthor B <b@ex.com> 2000 +0000\ncommitter B <b@ex.com> 2000 +0000\n\nC2\n`);
      objects.set(baseCommit.oid, baseCommit.compressed);
      objects.set(headCommit.oid, headCommit.compressed);

      // Should complete without unhandled exception
      const fullDiffs = await computeTreeFullDiff(client, baseCommit.oid, headCommit.oid);
      expect(fullDiffs).toHaveLength(1);
      expect(fullDiffs[0]?.newPath).toBe('corrupt.txt');
    });

    it('gracefully handles missing Git objects (404s) during tree diffing', async () => {
      const { client } = createInstrumentedRepoClient();

      // Commit SHAs that do not exist in the mock client
      const diffs = await computeTreeDiff(
        client,
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      );
      // When tree OIDs cannot be resolved, returns empty diffs safely
      expect(diffs).toEqual([]);
    });

    it('recovers cleanly when Web Worker terminates or receives an error', async () => {
      const localDiffClient = new DiffClient();

      // Simulate termination
      localDiffClient.terminate();

      // Subsequent diffs execute via in-thread fallback safely
      const diff = await localDiffClient.computeDiff('a.ts', 'a.ts', 'const x = 1;', 'const x = 2;');
      expect(diff.additions).toBe(1);
      expect(diff.deletions).toBe(1);
      expect(diff.hunks.length).toBe(1);

      localDiffClient.terminate();
    });
  });

  // =========================================================================
  // 4. Review Notes Binding Across Multiple Files and Lines
  // =========================================================================
  describe('4. Review Notes Binding Across Multiple Files and Lines', () => {
    it('accurately attaches review notes to multi-file diffs across hunks and split rows', () => {
      const fileDiffs: FileDiff[] = [
        {
          oldPath: 'src/fileA.ts',
          newPath: 'src/fileA.ts',
          isBinary: false,
          additions: 1,
          deletions: 1,
          hunks: [
            {
              oldStart: 1,
              oldLines: 3,
              newStart: 1,
              newLines: 3,
              header: '@@ -1,3 +1,3 @@',
              lines: [
                { type: 'context', content: 'import { a } from "./a";', oldLineNumber: 1, newLineNumber: 1 },
                { type: 'delete', content: 'const oldVal = 10;', oldLineNumber: 2, newLineNumber: null },
                { type: 'add', content: 'const newVal = 20;', oldLineNumber: null, newLineNumber: 2 },
                { type: 'context', content: 'export default newVal;', oldLineNumber: 3, newLineNumber: 3 },
              ],
            },
          ],
          splitRows: [
            {
              left: { lineNumber: 1, content: 'import { a } from "./a";', type: 'context' },
              right: { lineNumber: 1, content: 'import { a } from "./a";', type: 'context' },
            },
            {
              left: { lineNumber: 2, content: 'const oldVal = 10;', type: 'delete' },
              right: { lineNumber: 2, content: 'const newVal = 20;', type: 'add' },
            },
            {
              left: { lineNumber: 3, content: 'export default newVal;', type: 'context' },
              right: { lineNumber: 3, content: 'export default newVal;', type: 'context' },
            },
          ],
        },
        {
          oldPath: null,
          newPath: 'src/fileB.ts',
          isBinary: false,
          additions: 2,
          deletions: 0,
          hunks: [
            {
              oldStart: 0,
              oldLines: 0,
              newStart: 1,
              newLines: 2,
              header: '@@ -0,0 +1,2 @@',
              lines: [
                { type: 'add', content: '// New File B', oldLineNumber: null, newLineNumber: 1 },
                { type: 'add', content: 'export const b = 2;', oldLineNumber: null, newLineNumber: 2 },
              ],
            },
          ],
          splitRows: [
            {
              left: { lineNumber: null, content: null, type: 'empty' },
              right: { lineNumber: 1, content: '// New File B', type: 'add' },
            },
            {
              left: { lineNumber: null, content: null, type: 'empty' },
              right: { lineNumber: 2, content: 'export const b = 2;', type: 'add' },
            },
          ],
        },
        {
          oldPath: 'deleted.ts',
          newPath: null,
          isBinary: false,
          additions: 0,
          deletions: 1,
          hunks: [
            {
              oldStart: 1,
              oldLines: 1,
              newStart: 0,
              newLines: 0,
              header: '@@ -1,1 +0,0 @@',
              lines: [
                { type: 'delete', content: '// To be deleted', oldLineNumber: 1, newLineNumber: null },
              ],
            },
          ],
          splitRows: [
            {
              left: { lineNumber: 1, content: '// To be deleted', type: 'delete' },
              right: { lineNumber: null, content: null, type: 'empty' },
            },
          ],
        },
      ];

      const notes: ReviewNote[] = [
        // Note 1: on fileA.ts line 2 (added line)
        {
          commitSha: 'commit123',
          filePath: 'src/fileA.ts',
          line: 2,
          author: { name: 'Alice', email: 'alice@ex.com' },
          body: 'Check variable naming here',
          createdAt: 1700000000,
        },
        // Note 2: on fileA.ts line 1 (context line)
        {
          commitSha: 'commit123',
          filePath: 'src/fileA.ts',
          line: 1,
          author: { name: 'Bob', email: 'bob@ex.com' },
          body: 'Import looks good',
          createdAt: 1700001000,
        },
        // Note 3: global file note on fileA.ts without specific line
        {
          commitSha: 'commit123',
          filePath: 'src/fileA.ts',
          author: { name: 'Charlie', email: 'charlie@ex.com' },
          body: 'Overall fileA structure is fine',
          createdAt: 1700002000,
        },
        // Note 4: on newly created fileB.ts line 2
        {
          commitSha: 'commit123',
          filePath: 'src/fileB.ts',
          line: 2,
          author: { name: 'Alice', email: 'alice@ex.com' },
          body: 'Consider making this a function instead of const',
          createdAt: 1700003000,
        },
        // Note 5: on deleted file deleted.ts line 1
        {
          commitSha: 'commit123',
          filePath: 'deleted.ts',
          line: 1,
          author: { name: 'Bob', email: 'bob@ex.com' },
          body: 'Good deletion',
          createdAt: 1700004000,
        },
      ];

      const attached = attachReviewNotes(fileDiffs, notes);
      expect(attached).toHaveLength(3);

      // Verify fileA
      const fileA = attached[0];
      expect(fileA?.reviewNotes).toHaveLength(3);

      // Check context line 1
      const line1 = fileA?.hunks[0]?.lines[0];
      expect(line1?.reviewNotes).toHaveLength(1);
      expect(line1?.reviewNotes?.[0]?.body).toBe('Import looks good');
      expect(fileA?.splitRows[0]?.left.reviewNotes).toHaveLength(1);
      expect(fileA?.splitRows[0]?.right.reviewNotes).toHaveLength(1);

      // Check add line 2
      const addLine2 = fileA?.hunks[0]?.lines.find((l) => l.type === 'add');
      expect(addLine2?.reviewNotes).toHaveLength(1);
      expect(addLine2?.reviewNotes?.[0]?.body).toBe('Check variable naming here');
      expect(fileA?.splitRows[1]?.right.reviewNotes).toHaveLength(1);

      // Verify fileB (added file)
      const fileB = attached[1];
      expect(fileB?.reviewNotes).toHaveLength(1);
      const fileBLine2 = fileB?.hunks[0]?.lines[1];
      expect(fileBLine2?.reviewNotes).toHaveLength(1);
      expect(fileBLine2?.reviewNotes?.[0]?.body).toContain('function instead of const');
      expect(fileB?.splitRows[1]?.right.reviewNotes).toHaveLength(1);

      // Verify deleted file
      const fileDel = attached[2];
      expect(fileDel?.reviewNotes).toHaveLength(1);
      const delLine = fileDel?.hunks[0]?.lines[0];
      expect(delLine?.reviewNotes).toHaveLength(1);
      expect(delLine?.reviewNotes?.[0]?.body).toBe('Good deletion');
      expect(fileDel?.splitRows[0]?.left.reviewNotes).toHaveLength(1);
    });

    it('loads and parses 2-level fanout review notes from refs/notes/reviews with mixed JSON formats', async () => {
      const { client, objects } = createInstrumentedRepoClient();

      const targetSha = 'a1b2c3d4e5f67890123456789012345678901234';

      // Note 1: JSON array payload
      const notePayloadArray = JSON.stringify([
        {
          file_path: 'src/algo.ts',
          line: 10,
          author: { name: 'Alice', email: 'alice@ex.com' },
          body: 'Note in JSON array',
          created_at: 1700000000,
        },
        {
          file_path: 'src/algo.ts',
          line: 20,
          author: { name: 'Bob', email: 'bob@ex.com' },
          body: 'Second note in array',
          created_at: 1700001000,
        },
      ]);
      const noteBlob = createCompressedGitObject('blob', notePayloadArray);
      objects.set(noteBlob.oid, noteBlob.compressed);

      // 2-level fanout tree: a1/b2/c3d4e5f67890123456789012345678901234
      const level2Tree = createCompressedGitObject('tree', createTreePayload([
        { mode: '100644', name: 'c3d4e5f67890123456789012345678901234', oid: noteBlob.oid },
      ]));
      const level1Tree = createCompressedGitObject('tree', createTreePayload([
        { mode: '040000', name: 'b2', oid: level2Tree.oid },
      ]));
      const rootNotesTree = createCompressedGitObject('tree', createTreePayload([
        { mode: '040000', name: 'a1', oid: level1Tree.oid },
      ]));
      objects.set(level2Tree.oid, level2Tree.compressed);
      objects.set(level1Tree.oid, level1Tree.compressed);
      objects.set(rootNotesTree.oid, rootNotesTree.compressed);

      const notesCommit = createCompressedGitObject(
        'commit',
        `tree ${rootNotesTree.oid}\nauthor NoteSys <sys@ex.com> 1000 +0000\ncommitter NoteSys <sys@ex.com> 1000 +0000\n\nNotes commit\n`
      );
      objects.set(notesCommit.oid, notesCommit.compressed);

      // Mock resolveRef for refs/notes/reviews
      vi.spyOn(client, 'resolveRef').mockImplementation((ref) => {
        if (ref === 'refs/notes/reviews' || ref === 'notes/reviews') {
          return Promise.resolve(notesCommit.oid);
        }
        return Promise.reject(new Error(`Ref ${ref} not found`));
      });

      const notes = await loadReviewNotes(client, targetSha);
      expect(notes).toHaveLength(2);

      expect(notes[0]?.commitSha).toBe(targetSha);
      expect(notes[0]?.filePath).toBe('src/algo.ts');
      expect(notes[0]?.line).toBe(10);
      expect(notes[0]?.body).toBe('Note in JSON array');

      expect(notes[1]?.commitSha).toBe(targetSha);
      expect(notes[1]?.filePath).toBe('src/algo.ts');
      expect(notes[1]?.line).toBe(20);
      expect(notes[1]?.body).toBe('Second note in array');

      // Also test CollabClient integration
      const collab = new CollabClient();
      const clientNotes = await collab.getReviewNotes(client, targetSha);
      expect(clientNotes).toHaveLength(2);
    });
  });
});
