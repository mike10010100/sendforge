import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitRepositoryClient } from '../../src/engine/fetcher.js';
import {
  attachReviewNotes,
  computeTreeDiff,
  computeTreeFullDiff,
} from '../../src/worker/diff-algo.js';
import type { ReviewNote } from '../../src/worker/diff-types.js';
import { createCompressedGitObject, createTreePayload } from '../fixtures.js';

function createMockRepoClient(objects: Map<string, Uint8Array>): GitRepositoryClient {
  const client = new GitRepositoryClient('https://mock.sendforge.internal');
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

describe('Tree Diffing & Review Notes Engine (tree_diff.test.ts)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('handles identical commit SHAs (no diff)', async () => {
    const objects = new Map<string, Uint8Array>();
    const client = createMockRepoClient(objects);

    const diffs = await computeTreeDiff(client, '1111111111111111111111111111111111111111', '1111111111111111111111111111111111111111');
    expect(diffs).toEqual([]);
  });

  it('detects added, deleted, and modified files in tree hierarchy', async () => {
    const objects = new Map<string, Uint8Array>();

    // Blobs
    const blobA = createCompressedGitObject('blob', 'Hello World\n');
    const blobA2 = createCompressedGitObject('blob', 'Hello World Modified\n');
    const blobB = createCompressedGitObject('blob', 'File B to delete\n');
    const blobC = createCompressedGitObject('blob', 'File C added\n');

    objects.set(blobA.oid, blobA.compressed);
    objects.set(blobA2.oid, blobA2.compressed);
    objects.set(blobB.oid, blobB.compressed);
    objects.set(blobC.oid, blobC.compressed);

    // Base Tree: fileA (100644), fileB (100644)
    const baseTreePayload = createTreePayload([
      { mode: '100644', name: 'fileA.txt', oid: blobA.oid },
      { mode: '100644', name: 'fileB.txt', oid: blobB.oid },
    ]);
    const baseTree = createCompressedGitObject('tree', baseTreePayload);
    objects.set(baseTree.oid, baseTree.compressed);

    // Head Tree: fileA (100644, blobA2), fileC (100644, blobC)
    const headTreePayload = createTreePayload([
      { mode: '100644', name: 'fileA.txt', oid: blobA2.oid },
      { mode: '100644', name: 'fileC.txt', oid: blobC.oid },
    ]);
    const headTree = createCompressedGitObject('tree', headTreePayload);
    objects.set(headTree.oid, headTree.compressed);

    // Commits
    const baseCommitPayload = `tree ${baseTree.oid}\nauthor Alice <alice@example.com> 1000 +0000\ncommitter Alice <alice@example.com> 1000 +0000\n\nBase commit\n`;
    const baseCommit = createCompressedGitObject('commit', baseCommitPayload);
    objects.set(baseCommit.oid, baseCommit.compressed);

    const headCommitPayload = `tree ${headTree.oid}\nparent ${baseCommit.oid}\nauthor Bob <bob@example.com> 2000 +0000\ncommitter Bob <bob@example.com> 2000 +0000\n\nHead commit\n`;
    const headCommit = createCompressedGitObject('commit', headCommitPayload);
    objects.set(headCommit.oid, headCommit.compressed);

    const client = createMockRepoClient(objects);

    const summaries = await computeTreeDiff(client, baseCommit.oid, headCommit.oid);
    expect(summaries.length).toBe(3);

    const modified = summaries.find((s) => s.newPath === 'fileA.txt');
    expect(modified?.status).toBe('modified');
    expect(modified?.oldOid).toBe(blobA.oid);
    expect(modified?.newOid).toBe(blobA2.oid);

    const deleted = summaries.find((s) => s.oldPath === 'fileB.txt');
    expect(deleted?.status).toBe('deleted');
    expect(deleted?.oldOid).toBe(blobB.oid);
    expect(deleted?.newPath).toBeNull();

    const added = summaries.find((s) => s.newPath === 'fileC.txt');
    expect(added?.status).toBe('added');
    expect(added?.newOid).toBe(blobC.oid);
    expect(added?.oldPath).toBeNull();
  });

  it('detects mode changes without content modifications', async () => {
    const objects = new Map<string, Uint8Array>();
    const scriptBlob = createCompressedGitObject('blob', '#!/bin/sh\necho "test"\n');
    objects.set(scriptBlob.oid, scriptBlob.compressed);

    // Base tree: 100644 script.sh
    const baseTreePayload = createTreePayload([
      { mode: '100644', name: 'script.sh', oid: scriptBlob.oid },
    ]);
    const baseTree = createCompressedGitObject('tree', baseTreePayload);
    objects.set(baseTree.oid, baseTree.compressed);

    // Head tree: 100755 script.sh (same blob OID, mode changed to executable)
    const headTreePayload = createTreePayload([
      { mode: '100755', name: 'script.sh', oid: scriptBlob.oid },
    ]);
    const headTree = createCompressedGitObject('tree', headTreePayload);
    objects.set(headTree.oid, headTree.compressed);

    const baseCommit = createCompressedGitObject('commit', `tree ${baseTree.oid}\nauthor Alice <alice@ex.com> 1000 +0000\ncommitter Alice <alice@ex.com> 1000 +0000\n\nInit\n`);
    const headCommit = createCompressedGitObject('commit', `tree ${headTree.oid}\nauthor Bob <bob@ex.com> 2000 +0000\ncommitter Bob <bob@ex.com> 2000 +0000\n\nChmod\n`);
    objects.set(baseCommit.oid, baseCommit.compressed);
    objects.set(headCommit.oid, headCommit.compressed);

    const client = createMockRepoClient(objects);
    const summaries = await computeTreeDiff(client, baseCommit.oid, headCommit.oid);

    expect(summaries.length).toBe(1);
    expect(summaries[0]?.status).toBe('modified');
    expect(summaries[0]?.modeChanged).toBe(true);
    expect(summaries[0]?.oldMode).toBe('100644');
    expect(summaries[0]?.newMode).toBe('100755');
  });

  it('handles binary file differences and skips Myers diffing', async () => {
    const objects = new Map<string, Uint8Array>();
    const bin1 = createCompressedGitObject('blob', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    const bin2 = createCompressedGitObject('blob', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x02]));
    objects.set(bin1.oid, bin1.compressed);
    objects.set(bin2.oid, bin2.compressed);

    const baseTree = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'logo.png', oid: bin1.oid }]));
    const headTree = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'logo.png', oid: bin2.oid }]));
    objects.set(baseTree.oid, baseTree.compressed);
    objects.set(headTree.oid, headTree.compressed);

    const baseCommit = createCompressedGitObject('commit', `tree ${baseTree.oid}\nauthor Alice <a@ex.com> 1000 +0000\ncommitter Alice <a@ex.com> 1000 +0000\n\nBase\n`);
    const headCommit = createCompressedGitObject('commit', `tree ${headTree.oid}\nauthor Bob <b@ex.com> 2000 +0000\ncommitter Bob <b@ex.com> 2000 +0000\n\nHead\n`);
    objects.set(baseCommit.oid, baseCommit.compressed);
    objects.set(headCommit.oid, headCommit.compressed);

    const client = createMockRepoClient(objects);
    const fullDiffs = await computeTreeFullDiff(client, baseCommit.oid, headCommit.oid);

    expect(fullDiffs.length).toBe(1);
    expect(fullDiffs[0]?.isBinary).toBe(true);
    expect(fullDiffs[0]?.hunks).toEqual([]);
    expect(fullDiffs[0]?.additions).toBe(0);
    expect(fullDiffs[0]?.deletions).toBe(0);
  });

  it('correctly attaches review notes to file diffs and specific diff lines', () => {
    const fileDiffs = [
      {
        newPath: 'src/main.ts',
        oldPath: 'src/main.ts',
        isBinary: false,
        additions: 1,
        deletions: 1,
        hunks: [
          {
            oldStart: 1,
            oldLines: 2,
            newStart: 1,
            newLines: 2,
            header: '@@ -1,2 +1,2 @@',
            lines: [
              { type: 'delete' as const, content: 'const x = 1;', oldLineNumber: 1, newLineNumber: null },
              { type: 'add' as const, content: 'const x = 2;', oldLineNumber: null, newLineNumber: 1 },
              { type: 'context' as const, content: 'console.log(x);', oldLineNumber: 2, newLineNumber: 2 },
            ],
          },
        ],
        splitRows: [
          {
            left: { lineNumber: 1, content: 'const x = 1;', type: 'delete' as const },
            right: { lineNumber: 1, content: 'const x = 2;', type: 'add' as const },
          },
        ],
      },
    ];

    const notes: ReviewNote[] = [
      {
        commitSha: 'a1b2c3d4e5f67890123456789012345678901234',
        filePath: 'src/main.ts',
        line: 1,
        author: { name: 'Reviewer', email: 'rev@example.com' },
        body: 'Consider making this a constant instead of var',
        createdAt: 1740000000,
      },
      {
        commitSha: 'a1b2c3d4e5f67890123456789012345678901234',
        filePath: 'src/main.ts',
        author: { name: 'Reviewer', email: 'rev@example.com' },
        body: 'Overall file looks clean',
        createdAt: 1740000000,
      },
    ];

    const attached = attachReviewNotes(fileDiffs, notes);
    expect(attached.length).toBe(1);

    const first = attached[0];
    expect(first?.reviewNotes?.length).toBe(2);

    const hunkLine = first?.hunks[0]?.lines.find((l) => l.type === 'add');
    expect(hunkLine?.reviewNotes?.length).toBe(1);
    expect(hunkLine?.reviewNotes?.[0]?.body).toContain('constant');

    const splitRight = first?.splitRows[0]?.right;
    expect(splitRight?.reviewNotes?.length).toBe(1);
  });

  it('handles nested directory trees and skips identical subtrees', async () => {
    const objects = new Map<string, Uint8Array>();

    const docBlob = createCompressedGitObject('blob', 'Documentation\n');
    const srcBlob1 = createCompressedGitObject('blob', 'console.log(1)\n');
    const srcBlob2 = createCompressedGitObject('blob', 'console.log(2)\n');

    objects.set(docBlob.oid, docBlob.compressed);
    objects.set(srcBlob1.oid, srcBlob1.compressed);
    objects.set(srcBlob2.oid, srcBlob2.compressed);

    // Subtree docs/ is identical in both base and head
    const docsTree = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'README.md', oid: docBlob.oid }]));
    objects.set(docsTree.oid, docsTree.compressed);

    // Subtree src/ changes
    const srcTree1 = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'index.ts', oid: srcBlob1.oid }]));
    const srcTree2 = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'index.ts', oid: srcBlob2.oid }]));
    objects.set(srcTree1.oid, srcTree1.compressed);
    objects.set(srcTree2.oid, srcTree2.compressed);

    // Root trees
    const rootTree1 = createCompressedGitObject('tree', createTreePayload([
      { mode: '040000', name: 'docs', oid: docsTree.oid },
      { mode: '040000', name: 'src', oid: srcTree1.oid },
    ]));
    const rootTree2 = createCompressedGitObject('tree', createTreePayload([
      { mode: '040000', name: 'docs', oid: docsTree.oid },
      { mode: '040000', name: 'src', oid: srcTree2.oid },
    ]));
    objects.set(rootTree1.oid, rootTree1.compressed);
    objects.set(rootTree2.oid, rootTree2.compressed);

    const c1 = createCompressedGitObject('commit', `tree ${rootTree1.oid}\nauthor A <a@ex.com> 1000 +0000\ncommitter A <a@ex.com> 1000 +0000\n\nC1\n`);
    const c2 = createCompressedGitObject('commit', `tree ${rootTree2.oid}\nauthor B <b@ex.com> 2000 +0000\ncommitter B <b@ex.com> 2000 +0000\n\nC2\n`);
    objects.set(c1.oid, c1.compressed);
    objects.set(c2.oid, c2.compressed);

    const client = createMockRepoClient(objects);
    const diffs = await computeTreeDiff(client, c1.oid, c2.oid);

    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.newPath).toBe('src/index.ts');
    expect(diffs[0]?.status).toBe('modified');
  });
});
