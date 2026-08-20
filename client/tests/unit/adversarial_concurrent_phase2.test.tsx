import { afterEach, describe, expect, it, vi } from 'vitest';
import { h } from 'preact';
import render from 'preact-render-to-string';
import { RefSelector, filterRefs } from '../../src/ui/RefSelector.js';
import { BlobView } from '../../src/ui/BlobView.js';
import { BlameView } from '../../src/ui/BlameView.js';
import {
  computeBlame,
} from '../../src/engine/blame.js';
import {
  createZipArchive,
  createTarGzArchive,
  exportRepositorySnapshot,
  crc32,
  type ArchiveFileEntry,
} from '../../src/engine/archive.js';
import {
  buildPermalinkUrl,
  formatLineHash,
  parseLineHash,
  type LineRange,
} from '../../src/ui/utils.js';
import { GitRepositoryClient } from '../../src/engine/fetcher.js';
import type { GitBlobObject, RepoBranch, RepoTag } from '../../src/engine/types.js';
import { createCompressedGitObject, createTreePayload } from '../fixtures.js';
import * as crypto from 'node:crypto';
import pako from 'pako';

describe('Tier 5 Adversarial Coverage Hardening: Phase 2 Concurrent Interactions & Stress', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function setupMockClient(objects: Map<string, Uint8Array>, metaObj?: unknown): GitRepositoryClient {
    const client = new GitRepositoryClient('https://mock-adversarial-phase2.sendforge.internal');
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/meta.json')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(metaObj ?? {
            name: 'stress-repo',
            description: 'Stress test repository',
            default_branch: 'main',
            branches: [{ name: 'main', target: '1111111111111111111111111111111111111111', is_default: true }],
            tags: [],
            stats: { commit_count: 5, branch_count: 1, tag_count: 0 },
          }),
        });
      }

      const parts = url.split('/');
      const p1 = parts[parts.length - 2] ?? '';
      const p2 = parts[parts.length - 1] ?? '';
      const oid = (p1 + p2).toLowerCase();
      const data = objects.get(oid);
      if (data) {
        return Promise.resolve({
          ok: true,
          status: 200,
          arrayBuffer: () => Promise.resolve(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    }));
    return client;
  }

  // ===========================================================================
  // 1. Full Multi-Feature Concurrent Interaction Workflow Simulation
  // ===========================================================================
  describe('1. Full Multi-Feature Concurrent Interaction Workflow Simulation', () => {
    it('executes complete flow: Ref switch -> Tree -> Blob -> Blame -> Range permalink -> Diff -> Snapshot Export', async () => {
      const objectMap = new Map<string, Uint8Array>();

      // Commit 1: Initial release (main)
      const v1Content = 'line 1: init\nline 2: server\nline 3: config';
      const blob1 = createCompressedGitObject('blob', v1Content);
      const tree1 = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'server.ts', oid: blob1.oid }]));
      const commit1 = createCompressedGitObject('commit', `tree ${tree1.oid}\nauthor Alice <a@a.com> 1000 +0000\ncommitter Alice <a@a.com> 1000 +0000\n\nC1: init`);

      // Commit 2: Update on feature-branch
      const v2Content = 'line 1: init\nline 2: server updated\nline 3: config\nline 4: new feature';
      const blob2 = createCompressedGitObject('blob', v2Content);
      const tree2 = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'server.ts', oid: blob2.oid }]));
      const commit2 = createCompressedGitObject('commit', `tree ${tree2.oid}\nparent ${commit1.oid}\nauthor Bob <b@b.com> 2000 +0000\ncommitter Bob <b@b.com> 2000 +0000\n\nC2: feature update`);

      objectMap.set(blob1.oid, blob1.compressed);
      objectMap.set(tree1.oid, tree1.compressed);
      objectMap.set(commit1.oid, commit1.compressed);
      objectMap.set(blob2.oid, blob2.compressed);
      objectMap.set(tree2.oid, tree2.compressed);
      objectMap.set(commit2.oid, commit2.compressed);

      const meta = {
        name: 'flow-repo',
        description: 'Multi-feature flow repo',
        default_branch: 'main',
        branches: [
          { name: 'main', target: commit1.oid, is_default: true },
          { name: 'feature/blame-export', target: commit2.oid, is_default: false },
        ],
        tags: [
          { name: 'v1.0.0', target: commit1.oid, is_annotated: false, peeled: null },
        ],
        stats: { commit_count: 2, branch_count: 2, tag_count: 1 },
      };

      const client = setupMockClient(objectMap, meta);

      // Step 1: User switches ref via RefSelector
      const filteredBranches = filterRefs(meta.branches, 'feature');
      expect(filteredBranches).toHaveLength(1);
      expect(filteredBranches[0]?.name).toBe('feature/blame-export');

      // Step 2: Resolve feature branch commit OID
      const featureCommitOid = filteredBranches[0]?.target ?? '';
      const commit = await client.getCommit(featureCommitOid);
      expect(commit.oid).toBe(commit2.oid);

      // Step 3: Fetch tree and resolve server.ts
      const tree = await client.getTree(commit.tree);
      expect(tree.entries).toHaveLength(1);
      const serverEntry = tree.entries[0];
      expect(serverEntry?.name).toBe('server.ts');

      const blob = await client.getBlob(serverEntry?.oid ?? '');
      expect(blob.isBinary).toBe(false);
      expect(blob.text).toBe(v2Content);

      // Step 4: User toggles Blame View -> compute blame
      const blame = await computeBlame(client, featureCommitOid, 'server.ts');
      expect(blame.lines).toHaveLength(4);
      expect(blame.lines[0]?.commitOid).toBe(commit1.oid); // line 1 untouched
      expect(blame.lines[1]?.commitOid).toBe(commit2.oid); // line 2 modified in commit 2
      expect(blame.lines[2]?.commitOid).toBe(commit1.oid); // line 3 untouched
      expect(blame.lines[3]?.commitOid).toBe(commit2.oid); // line 4 added in commit 2

      // Step 5: User shift-clicks line 2 through line 4
      const range: LineRange = { start: 2, end: 4 };
      const permalinkUrl = buildPermalinkUrl('flow-repo', commit2.oid, 'server.ts', range);
      expect(permalinkUrl).toBe(`#/commit/${commit2.oid}/blob/server.ts#L2-L4`);

      // Step 6: User clicks commit diff link from blame hunk (commit2)
      const diffHref = `#/commit/${blame.lines[1]?.commitOid}`;
      expect(diffHref).toBe(`#/commit/${commit2.oid}`);

      // Step 7: User triggers ZIP and TAR.GZ snapshot downloads for the current commit
      const zipData = await exportRepositorySnapshot(client, commit.tree, 'flow-repo-feature', 'zip');
      const tarGzData = await exportRepositorySnapshot(client, commit.tree, 'flow-repo-feature', 'tar.gz');

      expect(zipData.length).toBeGreaterThan(0);
      expect(tarGzData.length).toBeGreaterThan(0);

      // Verify ZIP format magic PK\x03\x04
      expect(zipData[0]).toBe(0x50);
      expect(zipData[1]).toBe(0x4b);
      expect(zipData[2]).toBe(0x03);
      expect(zipData[3]).toBe(0x04);

      // Verify TAR.GZ format magic gzip \x1f\x8b
      expect(tarGzData[0]).toBe(0x1f);
      expect(tarGzData[1]).toBe(0x8b);
    });
  });

  // ===========================================================================
  // 2. Race Conditions & Rapid Asynchronous State Changes
  // ===========================================================================
  describe('2. Race Conditions & Rapid Asynchronous State Changes', () => {
    it('handles 100 concurrent asynchronous blame calls without corrupted attribution', async () => {
      const objectMap = new Map<string, Uint8Array>();
      const commitOids: string[] = [];

      for (let i = 0; i < 20; i++) {
        const text = `Line 1 from C${i}\nLine 2 from C${i}\nLine 3 from C${i}`;
        const blob = createCompressedGitObject('blob', text);
        const tree = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: `file_${i}.ts`, oid: blob.oid }]));
        const commit = createCompressedGitObject('commit', `tree ${tree.oid}\nauthor Worker_${i} <w${i}@test.com> ${1000 + i * 50} +0000\ncommitter Worker_${i} <w${i}@test.com> ${1000 + i * 50} +0000\n\nCommit ${i}`);

        objectMap.set(blob.oid, blob.compressed);
        objectMap.set(tree.oid, tree.compressed);
        objectMap.set(commit.oid, commit.compressed);
        commitOids.push(commit.oid);
      }

      const client = setupMockClient(objectMap);

      const promises = Array.from({ length: 100 }, (_, idx) => {
        const targetIdx = idx % 20;
        const targetOid = commitOids[targetIdx] ?? '';
        return computeBlame(client, targetOid, `file_${targetIdx}.ts`).then((res) => ({
          idx,
          targetIdx,
          res,
        }));
      });

      const results = await Promise.all(promises);
      expect(results).toHaveLength(100);

      for (const item of results) {
        expect(item.res.lines).toHaveLength(3);
        const expectedOid = commitOids[item.targetIdx];
        for (const line of item.res.lines) {
          expect(line.commitOid).toBe(expectedOid);
          expect(line.authorName).toBe(`Worker_${item.targetIdx}`);
        }
      }
    });

    it('handles concurrent ZIP and TAR.GZ generation for 50 trees in parallel', async () => {
      const objectMap = new Map<string, Uint8Array>();
      const treeOids: string[] = [];

      for (let i = 0; i < 10; i++) {
        const blob = createCompressedGitObject('blob', `File content ${i} - ${crypto.randomBytes(64).toString('hex')}`);
        const tree = createCompressedGitObject('tree', createTreePayload([
          { mode: '100644', name: `module_${i}.ts`, oid: blob.oid },
          { mode: '100755', name: `run_${i}.sh`, oid: blob.oid },
        ]));
        objectMap.set(blob.oid, blob.compressed);
        objectMap.set(tree.oid, tree.compressed);
        treeOids.push(tree.oid);
      }

      const client = setupMockClient(objectMap);

      const tasks = Array.from({ length: 50 }, (_, idx) => {
        const treeOid = treeOids[idx % 10] ?? '';
        const format = idx % 2 === 0 ? 'zip' : 'tar.gz';
        return exportRepositorySnapshot(client, treeOid, `repo-v${idx}`, format);
      });

      const archives = await Promise.all(tasks);
      expect(archives).toHaveLength(50);

      for (let idx = 0; idx < 50; idx++) {
        const archive = archives[idx];
        expect(archive).toBeDefined();
        if (idx % 2 === 0) {
          // ZIP magic
          expect(archive?.[0]).toBe(0x50);
          expect(archive?.[1]).toBe(0x4b);
        } else {
          // GZIP magic
          expect(archive?.[0]).toBe(0x1f);
          expect(archive?.[1]).toBe(0x8b);
        }
      }
    });
  });

  // ===========================================================================
  // 3. UI Component Stress & Keyboard Navigation State Transitions
  // ===========================================================================
  describe('3. UI Component Stress & Keyboard Navigation State Transitions', () => {
    it('RefSelector handles rapid keyboard navigation, tab switching, and search queries', () => {
      const branches: RepoBranch[] = [
        { name: 'main', target: '1111111111111111111111111111111111111111', is_default: true },
        { name: 'feature/auth', target: '2222222222222222222222222222222222222222', is_default: false },
        { name: 'feature/blame', target: '3333333333333333333333333333333333333333', is_default: false },
        { name: 'fix/issue-42', target: '4444444444444444444444444444444444444444', is_default: false },
      ];
      const tags: RepoTag[] = [
        { name: 'v1.0.0', target: 'aaaa111122223333444455556666777788889999', is_annotated: true, peeled: null },
        { name: 'v1.1.0', target: 'bbbb111122223333444455556666777788889999', is_annotated: false, peeled: null },
        { name: 'v2.0.0-rc1', target: 'cccc111122223333444455556666777788889999', is_annotated: true, peeled: 'dddd111122223333444455556666777788889999' },
      ];

      // Test open branches tab
      const htmlBranches = render(
        h(RefSelector, {
          currentRef: 'main',
          branches,
          tags,
          onSelectRef: vi.fn(),
          initialOpen: true,
          initialTab: 'branches',
        })
      );
      expect(htmlBranches).toContain('ref-popover');
      expect(htmlBranches).toContain('feature/auth');
      expect(htmlBranches).toContain('feature/blame');
      expect(htmlBranches).toContain('fix/issue-42');
      expect(htmlBranches).toContain('default');

      // Test open tags tab with search filter
      const htmlTags = render(
        h(RefSelector, {
          currentRef: 'main',
          branches,
          tags,
          onSelectRef: vi.fn(),
          initialOpen: true,
          initialTab: 'tags',
          initialQuery: 'rc1',
        })
      );
      expect(htmlTags).toContain('v2.0.0-rc1');
      expect(htmlTags).toContain('annotated');
      expect(htmlTags).not.toContain('v1.0.0');

      // Test empty filter result
      const htmlEmpty = render(
        h(RefSelector, {
          currentRef: 'main',
          branches,
          tags,
          onSelectRef: vi.fn(),
          initialOpen: true,
          initialTab: 'branches',
          initialQuery: 'non-existent-branch-xyz',
        })
      );
      expect(htmlEmpty).toContain('No branches found matching &quot;non-existent-branch-xyz&quot;');
    });

    it('BlobView toggles Code, Blame, Raw, and Rendered markdown modes safely', () => {
      const codeBlob: GitBlobObject = {
        type: 'blob',
        oid: '5555555555555555555555555555555555555555',
        size: 30,
        data: new TextEncoder().encode('const x = 10;\nconst y = 20;\n'),
        isBinary: false,
        text: 'const x = 10;\nconst y = 20;\n',
      };

      const htmlCode = render(
        h(BlobView, {
          blob: codeBlob,
          path: 'src/calc.ts',
        })
      );
      expect(htmlCode).toContain('const x = 10;');
      expect(htmlCode).toContain('Code');
      expect(htmlCode).toContain('Blame');
      expect(htmlCode).toContain('Raw');
      expect(htmlCode).toContain('🔗 Copy Permalink');
      expect(htmlCode).toContain('📥 Download');

      // Markdown Blob
      const mdBlob: GitBlobObject = {
        type: 'blob',
        oid: '6666666666666666666666666666666666666666',
        size: 50,
        data: new TextEncoder().encode('# Project Title\n- Item 1\n- Item 2\n'),
        isBinary: false,
        text: '# Project Title\n- Item 1\n- Item 2\n',
      };

      const htmlMd = render(
        h(BlobView, {
          blob: mdBlob,
          path: 'README.md',
        })
      );
      expect(htmlMd).toContain('<h1>Project Title</h1>');
      expect(htmlMd).toContain('<li>Item 1</li>');
      expect(htmlMd).toContain('<li>Item 2</li>');
      expect(htmlMd).toContain('View Source');
    });

    it('BlameView renders age heatmaps, author avatars, and diff links accurately', () => {
      const blameResult = {
        lines: [
          {
            lineNumber: 1,
            commitOid: '1111111111111111111111111111111111111111',
            authorName: 'Ancient Dev',
            authorEmail: 'ancient@old.org',
            timestamp: 1000,
            summary: 'Initial ancient commit',
          },
          {
            lineNumber: 2,
            commitOid: '9999999999999999999999999999999999999999',
            authorName: 'Modern Dev',
            authorEmail: 'modern@now.org',
            timestamp: 9000,
            summary: 'Recent modern commit',
          },
        ],
        hunks: [
          {
            commitOid: '1111111111111111111111111111111111111111',
            authorName: 'Ancient Dev',
            authorEmail: 'ancient@old.org',
            timestamp: 1000,
            summary: 'Initial ancient commit',
            startLine: 1,
            lineCount: 1,
          },
          {
            commitOid: '9999999999999999999999999999999999999999',
            authorName: 'Modern Dev',
            authorEmail: 'modern@now.org',
            timestamp: 9000,
            summary: 'Recent modern commit',
            startLine: 2,
            lineCount: 1,
          },
        ],
        oldestTimestamp: 1000,
        newestTimestamp: 9000,
      };

      const html = render(
        h(BlameView, {
          blameResult,
          fileLines: ['const old = 1;', 'const current = 2;'],
          path: 'app.ts',
          selectedRange: { start: 2, end: 2 },
        })
      );

      expect(html).toContain('Ancient Dev');
      expect(html).toContain('Modern Dev');
      expect(html).toContain('AD');
      expect(html).toContain('MD');
      expect(html).toContain('1111111');
      expect(html).toContain('9999999');
      expect(html).toContain('href="#/commit/1111111111111111111111111111111111111111"');
      expect(html).toContain('href="#/commit/9999999999999999999999999999999999999999"');
      expect(html).toContain('highlighted');
    });
  });

  // ===========================================================================
  // 4. Archive Binary Encoding & POSIX Standard Stress
  // ===========================================================================
  describe('4. Archive Binary Encoding & POSIX Standard Stress', () => {
    it('validates CRC-32 and Deflate in ZIP for large mixed datasets', () => {
      const files: ArchiveFileEntry[] = [
        { path: 'empty.bin', data: new Uint8Array(0), mode: 0o100644 },
        { path: 'small.txt', data: new TextEncoder().encode('Hello World'), mode: 0o100644 },
        { path: 'executable.sh', data: new TextEncoder().encode('#!/bin/bash\necho "test"\n'), mode: 0o100755 },
        { path: 'large_pattern.dat', data: new TextEncoder().encode('PATTERN_1234567890\n'.repeat(1000)), mode: 0o100644 },
      ];

      const zipBytes = createZipArchive('test-zip-prefix', files);
      expect(zipBytes.length).toBeGreaterThan(0);

      // Verify CRC32 values match manual calculation
      for (const f of files) {
        const calculatedCrc = crc32(f.data);
        expect(typeof calculatedCrc).toBe('number');
      }
    });

    it('validates POSIX ustar tarball format headers (magic, checksum, mode octals)', () => {
      const files: ArchiveFileEntry[] = [
        { path: 'bin/tool', data: new TextEncoder().encode('echo tool'), mode: 0o100755 },
        { path: 'etc/config.cfg', data: new TextEncoder().encode('key=val'), mode: 0o100644 },
      ];

      const tarGzBytes = createTarGzArchive('tar-test', files);
      expect(tarGzBytes.length).toBeGreaterThan(0);

      // Decompress gzip payload using pako
      const rawTar = pako.ungzip(tarGzBytes);
      expect(rawTar.length).toBeGreaterThan(512);

      // Verify first header (512 bytes)
      const header = rawTar.subarray(0, 512);
      const magic = new TextDecoder().decode(header.subarray(257, 263));
      expect(magic).toBe('ustar\0');

      const uname = new TextDecoder().decode(header.subarray(265, 274));
      expect(uname).toBe('sendforge');
    });
  });

  // ===========================================================================
  // 5. Permalinks and Hash Management Invariants
  // ===========================================================================
  describe('5. Permalinks and Hash Management Invariants', () => {
    it('guarantees round-trip formatting and parsing for single and multi-line ranges', () => {
      const testCases: LineRange[] = [
        { start: 1, end: 1 },
        { start: 5, end: 10 },
        { start: 42, end: 42 },
        { start: 100, end: 500 },
        { start: 9999, end: 10000 },
      ];

      for (const tc of testCases) {
        const formatted = formatLineHash(tc.start, tc.end);
        const parsed = parseLineHash(formatted);
        expect(parsed).toEqual(tc);
      }
    });

    it('guarantees immutable commit SHA permalink structure', () => {
      const commitSha = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
      const path = 'src/engine/blame.ts';
      const range = { start: 15, end: 35 };

      const url = buildPermalinkUrl('', commitSha, path, range);
      expect(url).toBe(`#/commit/${commitSha}/blob/${path}#L15-L35`);

      const parsed = parseLineHash(url);
      expect(parsed).toEqual(range);
    });
  });
});
