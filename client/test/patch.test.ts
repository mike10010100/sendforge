import { describe, it, expect, vi } from 'vitest';
import {
  formatRfc2822Date,
  buildDiffStat,
  formatFileDiffHunks,
  formatSinglePatch,
  generateFormatPatch,
  generateFormatPatchRange,
  generatePatchSeries,
} from '../src/engine/patch.js';
import type { GitRepositoryClient } from '../src/engine/fetcher.js';
import type { GitCommitObject } from '../src/engine/types.js';
import type { FileDiff } from '../src/worker/diff-types.js';

describe('RFC 2822 Patch Engine (patch.ts)', () => {
  describe('formatRfc2822Date', () => {
    it('formats a known Unix timestamp into RFC 2822 format', () => {
      // 1740000000 = Wed, 19 Feb 2025 21:20:00 GMT
      const formatted = formatRfc2822Date(1740000000, '+0000');
      expect(formatted).toMatch(/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} \+0000$/);
      expect(formatted).toContain('2025');
    });

    it('handles custom timezone offsets', () => {
      const formatted = formatRfc2822Date(1740000000, '-0400');
      expect(formatted.endsWith('-0400')).toBe(true);
    });

    it('falls back safely on NaN or invalid timestamps', () => {
      const formatted = formatRfc2822Date(Number.NaN);
      expect(formatted).toBe('Mon, 17 Sep 2001 00:00:00 +0000');
    });
  });

  describe('buildDiffStat', () => {
    it('returns " 0 files changed" for empty diff list', () => {
      expect(buildDiffStat([])).toBe(' 0 files changed');
    });

    it('formats single file diffstat with additions and deletions', () => {
      const fileDiffs: FileDiff[] = [
        {
          oldPath: 'src/main.rs',
          newPath: 'src/main.rs',
          isBinary: false,
          additions: 10,
          deletions: 5,
          hunks: [],
          splitRows: [],
        },
      ];

      const stat = buildDiffStat(fileDiffs);
      expect(stat).toContain('src/main.rs');
      expect(stat).toContain('15 ++++++++++-----');
      expect(stat).toContain('1 file changed, 10 insertions(+), 5 deletions(-)');
    });

    it('formats multiple files diffstat correctly with pluralization', () => {
      const fileDiffs: FileDiff[] = [
        {
          oldPath: 'src/lib.rs',
          newPath: 'src/lib.rs',
          isBinary: false,
          additions: 2,
          deletions: 0,
          hunks: [],
          splitRows: [],
        },
        {
          oldPath: 'README.md',
          newPath: 'README.md',
          isBinary: false,
          additions: 0,
          deletions: 1,
          hunks: [],
          splitRows: [],
        },
      ];

      const stat = buildDiffStat(fileDiffs);
      expect(stat).toContain('src/lib.rs');
      expect(stat).toContain('README.md');
      expect(stat).toContain('2 files changed, 2 insertions(+), 1 deletion(-)');
    });

    it('handles binary files in diffstat', () => {
      const fileDiffs: FileDiff[] = [
        {
          oldPath: 'logo.png',
          newPath: 'logo.png',
          isBinary: true,
          additions: 0,
          deletions: 0,
          hunks: [],
          splitRows: [],
        },
      ];

      const stat = buildDiffStat(fileDiffs);
      expect(stat).toContain('logo.png');
      expect(stat).toContain('Bin');
      expect(stat).toContain('1 file changed, 0 insertions(+)');
    });
  });

  describe('formatFileDiffHunks', () => {
    it('formats added file diff with new file mode and /dev/null old path', () => {
      const diff: FileDiff = {
        status: 'added',
        oldPath: null,
        newPath: 'hello.txt',
        newMode: '100644',
        newOid: '1111111111111111111111111111111111111111',
        isBinary: false,
        additions: 1,
        deletions: 0,
        hunks: [
          {
            oldStart: 0,
            oldLines: 0,
            newStart: 1,
            newLines: 1,
            header: '@@ -0,0 +1,1 @@',
            lines: [{ type: 'add', content: 'Hello World', oldLineNumber: null, newLineNumber: 1 }],
          },
        ],
        splitRows: [],
      };

      const formatted = formatFileDiffHunks(diff);
      expect(formatted).toContain('diff --git a/hello.txt b/hello.txt');
      expect(formatted).toContain('new file mode 100644');
      expect(formatted).toContain('--- /dev/null');
      expect(formatted).toContain('+++ b/hello.txt');
      expect(formatted).toContain('@@ -0,0 +1,1 @@');
      expect(formatted).toContain('+Hello World');
    });

    it('formats deleted file diff with deleted file mode and /dev/null new path', () => {
      const diff: FileDiff = {
        status: 'deleted',
        oldPath: 'old.txt',
        newPath: null,
        oldMode: '100644',
        oldOid: '2222222222222222222222222222222222222222',
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
            lines: [{ type: 'delete', content: 'Goodbye World', oldLineNumber: 1, newLineNumber: null }],
          },
        ],
        splitRows: [],
      };

      const formatted = formatFileDiffHunks(diff);
      expect(formatted).toContain('diff --git a/old.txt b/old.txt');
      expect(formatted).toContain('deleted file mode 100644');
      expect(formatted).toContain('--- a/old.txt');
      expect(formatted).toContain('+++ /dev/null');
      expect(formatted).toContain('@@ -1,1 +0,0 @@');
      expect(formatted).toContain('-Goodbye World');
    });

    it('formats binary file diff header', () => {
      const diff: FileDiff = {
        status: 'modified',
        oldPath: 'image.png',
        newPath: 'image.png',
        isBinary: true,
        additions: 0,
        deletions: 0,
        hunks: [],
        splitRows: [],
      };

      const formatted = formatFileDiffHunks(diff);
      expect(formatted).toContain('diff --git a/image.png b/image.png');
      expect(formatted).toContain('Binary files a/image.png and b/image.png differ');
    });
  });

  describe('formatSinglePatch', () => {
    it('generates standard RFC 2822 git format-patch compatible with git am', () => {
      const commit: GitCommitObject = {
        type: 'commit',
        oid: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        size: 100,
        tree: 't1t2t3t4t5t6t1t2t3t4t5t6t1t2t3t4t5t6t1t2',
        parents: ['p1p2p3p4p5p6p1p2p3p4p5p6p1p2p3p4p5p6p1p2'],
        author: {
          name: 'Alice Chen',
          email: 'alice@example.com',
          timestamp: 1740000000,
          tzOffset: '+0000',
        },
        committer: {
          name: 'Alice Chen',
          email: 'alice@example.com',
          timestamp: 1740000000,
          tzOffset: '+0000',
        },
        subject: 'Fix regression in blame view',
        body: 'Blame view throws when author timestamp is zero.\n\nSigned-off-by: Alice Chen <alice@example.com>',
        message: 'Fix regression in blame view\n\nBlame view throws when author timestamp is zero.\n\nSigned-off-by: Alice Chen <alice@example.com>',
      };

      const fileDiffs: FileDiff[] = [
        {
          status: 'modified',
          oldPath: 'src/blame.ts',
          newPath: 'src/blame.ts',
          oldOid: '1111111111111111111111111111111111111111',
          newOid: '2222222222222222222222222222222222222222',
          oldMode: '100644',
          newMode: '100644',
          isBinary: false,
          additions: 2,
          deletions: 1,
          hunks: [
            {
              oldStart: 10,
              oldLines: 3,
              newStart: 10,
              newLines: 4,
              header: '@@ -10,3 +10,4 @@',
              lines: [
                { type: 'context', content: 'function calculate() {', oldLineNumber: 10, newLineNumber: 10 },
                { type: 'delete', content: '  return timestamp;', oldLineNumber: 11, newLineNumber: null },
                { type: 'add', content: '  if (!timestamp) return 0;', oldLineNumber: null, newLineNumber: 11 },
                { type: 'add', content: '  return timestamp;', oldLineNumber: null, newLineNumber: 12 },
                { type: 'context', content: '}', oldLineNumber: 12, newLineNumber: 13 },
              ],
            },
          ],
          splitRows: [],
        },
      ];

      const patch = formatSinglePatch({
        commit,
        fileDiffs,
        patchIndex: 1,
        totalPatches: 1,
      });

      // Verify From line
      expect(patch).toContain('From a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2 Mon Sep 17 00:00:00 2001');
      // Verify From header
      expect(patch).toContain('From: Alice Chen <alice@example.com>');
      // Verify Subject
      expect(patch).toContain('Subject: [PATCH] Fix regression in blame view');
      // Verify Body
      expect(patch).toContain('Blame view throws when author timestamp is zero.');
      expect(patch).toContain('Signed-off-by: Alice Chen <alice@example.com>');
      // Verify Separator
      expect(patch).toContain('\n---\n');
      // Verify Diffstat
      expect(patch).toContain('src/blame.ts | 3 ++-');
      expect(patch).toContain('1 file changed, 2 insertions(+), 1 deletion(-)');
      // Verify Unified Diff
      expect(patch).toContain('diff --git a/src/blame.ts b/src/blame.ts');
      expect(patch).toContain('@@ -10,3 +10,4 @@');
      expect(patch).toContain('+  if (!timestamp) return 0;');
      // Verify Trailer
      expect(patch).toContain('-- \nSendforge\n');
    });

    it('formats multi-patch subject [PATCH 2/5]', () => {
      const commit: GitCommitObject = {
        type: 'commit',
        oid: 'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3',
        size: 50,
        tree: 't1t2t3t4t5t6t1t2t3t4t5t6t1t2t3t4t5t6t1t2',
        parents: [],
        author: { name: 'Bob', email: 'bob@example.com', timestamp: 1740000000, tzOffset: '+0000' },
        committer: { name: 'Bob', email: 'bob@example.com', timestamp: 1740000000, tzOffset: '+0000' },
        subject: 'Add test suite',
        body: '',
        message: 'Add test suite',
      };

      const patch = formatSinglePatch({
        commit,
        fileDiffs: [],
        patchIndex: 2,
        totalPatches: 5,
        versionTrailer: 'CustomForge 1.0',
      });

      expect(patch).toContain('Subject: [PATCH 2/5] Add test suite');
      expect(patch).toContain('-- \nCustomForge 1.0\n');
    });
  });

  describe('generateFormatPatch & generateFormatPatchRange with mock client', () => {
    const mockCommit: GitCommitObject = {
      type: 'commit',
      oid: 'c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
      size: 80,
      tree: 'tree111111111111111111111111111111111111',
      parents: ['parent1111111111111111111111111111111111'],
      author: { name: 'Dev', email: 'dev@example.com', timestamp: 1740000000, tzOffset: '+0000' },
      committer: { name: 'Dev', email: 'dev@example.com', timestamp: 1740000000, tzOffset: '+0000' },
      subject: 'Feature: new patch engine',
      body: 'Implements RFC 2822 generation.',
      message: 'Feature: new patch engine\n\nImplements RFC 2822 generation.',
    };

    const mockClient = {
      getCommit: vi.fn().mockResolvedValue(mockCommit),
      getTree: vi.fn().mockResolvedValue({ type: 'tree', oid: 'tree1', entries: [] }),
      getBlob: vi.fn(),
    } as unknown as GitRepositoryClient;

    it('generates format patch for a single commit', async () => {
      const patch = await generateFormatPatch(mockClient, mockCommit.oid);
      expect(patch).toContain(`From ${mockCommit.oid} Mon Sep 17 00:00:00 2001`);
      expect(patch).toContain('Subject: [PATCH] Feature: new patch engine');
      expect(patch).toContain('Implements RFC 2822 generation.');
    });

    it('generates patch series items with slugified filenames', async () => {
      const items = await generatePatchSeries(mockClient, 'parent1111111111111111111111111111111111', mockCommit.oid);
      expect(Array.isArray(items)).toBe(true);
      if (items.length > 0) {
        expect(items[0]?.filename).toMatch(/^\d{4}-.*\.patch$/);
        expect(items[0]?.content).toContain('Subject: [PATCH');
      }
    });

    it('returns empty string when base and head are identical in range', async () => {
      const patch = await generateFormatPatchRange(mockClient, mockCommit.oid, mockCommit.oid);
      expect(patch).toBe('');
    });
  });
});
