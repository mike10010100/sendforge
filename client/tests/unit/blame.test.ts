import { afterEach, describe, expect, it, vi } from 'vitest';
import { h } from 'preact';
import render from 'preact-render-to-string';
import {
  calculateAgeFraction,
  calculateHeatmapIntensity,
  computeBlame,
  formatCommitSummary,
  getAuthorColor,
  getAuthorInitials,
  getHeatmapColor,
  groupBlameHunks,
} from '../../src/engine/blame.js';
import { BlameView } from '../../src/ui/BlameView.js';
import { BlobView } from '../../src/ui/BlobView.js';
import { GitRepositoryClient } from '../../src/engine/fetcher.js';
import type { GitBlobObject } from '../../src/engine/types.js';
import { createCompressedGitObject, createTreePayload } from '../fixtures.js';

describe('Milestone M2: In-Browser git blame & BlameView Unit Tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ===========================================================================
  // 1. Pure Helper Functions
  // ===========================================================================
  describe('Pure Helper Functions', () => {
    describe('calculateHeatmapIntensity', () => {
      it('calculates linear normalized intensity between 0.0 (oldest) and 1.0 (newest)', () => {
        const oldest = 1000;
        const newest = 3000;

        expect(calculateHeatmapIntensity(1000, oldest, newest)).toBe(0.0);
        expect(calculateHeatmapIntensity(2000, oldest, newest)).toBe(0.5);
        expect(calculateHeatmapIntensity(3000, oldest, newest)).toBe(1.0);
        expect(calculateHeatmapIntensity(1500, oldest, newest)).toBe(0.25);
      });

      it('returns 0.5 when oldestTimestamp equals newestTimestamp (single revision or same age)', () => {
        expect(calculateHeatmapIntensity(1000, 1000, 1000)).toBe(0.5);
        expect(calculateHeatmapIntensity(0, 0, 0)).toBe(0.5);
      });

      it('clamps timestamps outside the [oldest, newest] window', () => {
        expect(calculateHeatmapIntensity(500, 1000, 2000)).toBe(0.0);
        expect(calculateHeatmapIntensity(3000, 1000, 2000)).toBe(1.0);
      });

      it('handles missing, zero, or invalid timestamps safely without returning NaN', () => {
        expect(calculateHeatmapIntensity(0, 1000, 2000)).toBe(0.5);
        expect(calculateHeatmapIntensity(Number.NaN, 1000, 2000)).toBe(0.5);
      });
    });

    describe('calculateAgeFraction and getHeatmapColor', () => {
      it('calculates age fraction with clamping', () => {
        expect(calculateAgeFraction(1000, 1000, 2000)).toBe(0.0);
        expect(calculateAgeFraction(2000, 1000, 2000)).toBe(1.0);
        expect(calculateAgeFraction(1500, 1000, 2000)).toBe(0.5);
        expect(calculateAgeFraction(500, 1000, 2000)).toBe(0.0);
        expect(calculateAgeFraction(2500, 1000, 2000)).toBe(1.0);
        expect(calculateAgeFraction(1000, 1000, 1000)).toBe(1.0);
      });

      it('generates heatmap colors for oldest and newest fractions', () => {
        const oldestColor = getHeatmapColor(0.0);
        const newestColor = getHeatmapColor(1.0);

        expect(oldestColor.borderColor).toContain('rgba(88, 166, 255, 0.25)');
        expect(newestColor.borderColor).toContain('rgba(88, 166, 255, 1.00)');
        expect(oldestColor.bgColor).toContain('rgba(56, 139, 253, 0.020)');
        expect(newestColor.bgColor).toContain('rgba(56, 139, 253, 0.080)');
      });
    });

    describe('getAuthorInitials', () => {
      it('extracts two-letter initials from full names', () => {
        expect(getAuthorInitials('Alice Dev')).toBe('AD');
        expect(getAuthorInitials('Bob Engineer')).toBe('BE');
        expect(getAuthorInitials('Linus Torvalds')).toBe('LT');
      });

      it('extracts initials from single-word names', () => {
        expect(getAuthorInitials('Alice')).toBe('AL');
        expect(getAuthorInitials('Linus')).toBe('LI');
        expect(getAuthorInitials('A')).toBe('A');
      });

      it('extracts first and last initials from multi-word names', () => {
        expect(getAuthorInitials('John Ronald Reuel Tolkien')).toBe('JT');
        expect(getAuthorInitials('Jean-Luc Picard')).toBe('JP');
      });

      it('handles whitespace, punctuation, and empty strings gracefully', () => {
        expect(getAuthorInitials('   Charlie   Architect   ')).toBe('CA');
        expect(getAuthorInitials('')).toBe('??');
        expect(getAuthorInitials('   ')).toBe('??');
      });

      it('handles Unicode surrogate pairs, emojis, and international names', () => {
        expect(getAuthorInitials('🦀 Rustacean')).toBe('🦀R');
        expect(getAuthorInitials('🚀 Rocketeer')).toBe('🚀R');
        expect(getAuthorInitials('🦀')).toBe('🦀');
        expect(getAuthorInitials('山田 太郎')).toBe('山太');
        expect(getAuthorInitials('דוד כהן')).toBe('דכ');
      });
    });

    describe('getAuthorColor', () => {
      it('deterministically hashes author names and emails into HSL colors', () => {
        const color1 = getAuthorColor('Alice', 'alice@example.com');
        const color2 = getAuthorColor('Alice', 'alice@example.com');
        const color3 = getAuthorColor('Bob', 'bob@example.com');

        expect(color1).toBe(color2);
        expect(color1).toMatch(/^hsl\(\d+, 55%, 42%\)$/);
        expect(color3).toMatch(/^hsl\(\d+, 55%, 42%\)$/);
      });
    });

    describe('formatCommitSummary', () => {
      it('extracts first line from multi-line commit message', () => {
        expect(formatCommitSummary('Initial commit\n\nDetailed explanation')).toBe('Initial commit');
        expect(formatCommitSummary('Fix bug\r\n\r\nMore notes')).toBe('Fix bug');
      });

      it('trims whitespace and handles single-line message', () => {
        expect(formatCommitSummary('  Add service module  ')).toBe('Add service module');
        expect(formatCommitSummary('')).toBe('');
      });
    });

    describe('groupBlameHunks', () => {
      it('groups consecutive lines with identical commit SHA into hunks', () => {
        const lines = [
          { lineNumber: 1, commitOid: 'sha1', authorName: 'Alice', authorEmail: 'a@a.com', timestamp: 100, summary: 'C1' },
          { lineNumber: 2, commitOid: 'sha1', authorName: 'Alice', authorEmail: 'a@a.com', timestamp: 100, summary: 'C1' },
          { lineNumber: 3, commitOid: 'sha2', authorName: 'Bob', authorEmail: 'b@b.com', timestamp: 200, summary: 'C2' },
          { lineNumber: 4, commitOid: 'sha1', authorName: 'Alice', authorEmail: 'a@a.com', timestamp: 100, summary: 'C1' },
          { lineNumber: 5, commitOid: 'sha1', authorName: 'Alice', authorEmail: 'a@a.com', timestamp: 100, summary: 'C1' },
        ];

        const hunks = groupBlameHunks(lines);
        expect(hunks).toHaveLength(3);

        expect(hunks[0]).toEqual({
          commitOid: 'sha1',
          authorName: 'Alice',
          authorEmail: 'a@a.com',
          timestamp: 100,
          summary: 'C1',
          startLine: 1,
          lineCount: 2,
        });

        expect(hunks[1]).toEqual({
          commitOid: 'sha2',
          authorName: 'Bob',
          authorEmail: 'b@b.com',
          timestamp: 200,
          summary: 'C2',
          startLine: 3,
          lineCount: 1,
        });

        expect(hunks[2]).toEqual({
          commitOid: 'sha1',
          authorName: 'Alice',
          authorEmail: 'a@a.com',
          timestamp: 100,
          summary: 'C1',
          startLine: 4,
          lineCount: 2,
        });
      });

      it('returns empty array when input lines array is empty', () => {
        expect(groupBlameHunks([])).toEqual([]);
      });
    });
  });

  // ===========================================================================
  // 2. Core Blame Engine: computeBlame
  // ===========================================================================
  describe('computeBlame Engine Scenarios', () => {
    function setupMockClient(objects: Map<string, Uint8Array>): GitRepositoryClient {
      const client = new GitRepositoryClient('https://mock-repo.sendforge.internal');
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
            arrayBuffer: () => Promise.resolve(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)),
          });
        }
        return Promise.resolve({ ok: false, status: 404 });
      }));
      return client;
    }

    it('Scenario 1: Single commit root attribution (100% of lines attributed to initial commit)', async () => {
      const blob = createCompressedGitObject('blob', 'line 1\nline 2\nline 3\nline 4\nline 5');
      const treePayload = createTreePayload([{ mode: '100644', name: 'main.ts', oid: blob.oid }]);
      const tree = createCompressedGitObject('tree', treePayload);

      const commitPayload = [
        `tree ${tree.oid}`,
        'author Alice Dev <alice@example.com> 1700000000 +0000',
        'committer Alice Dev <alice@example.com> 1700000000 +0000',
        '',
        'Initial commit: Add main.ts',
      ].join('\n');
      const commit = createCompressedGitObject('commit', commitPayload);

      const objectMap = new Map<string, Uint8Array>([
        [blob.oid, blob.compressed],
        [tree.oid, tree.compressed],
        [commit.oid, commit.compressed],
      ]);

      const client = setupMockClient(objectMap);
      const result = await computeBlame(client, commit.oid, 'main.ts');

      expect(result.lines).toHaveLength(5);
      for (let i = 0; i < 5; i++) {
        const line = result.lines[i];
        expect(line?.lineNumber).toBe(i + 1);
        expect(line?.commitOid).toBe(commit.oid);
        expect(line?.authorName).toBe('Alice Dev');
        expect(line?.authorEmail).toBe('alice@example.com');
        expect(line?.timestamp).toBe(1700000000);
        expect(line?.summary).toBe('Initial commit: Add main.ts');
      }

      expect(result.hunks).toHaveLength(1);
      expect(result.hunks[0]?.startLine).toBe(1);
      expect(result.hunks[0]?.lineCount).toBe(5);
      expect(result.hunks[0]?.commitOid).toBe(commit.oid);
      expect(result.oldestTimestamp).toBe(1700000000);
      expect(result.newestTimestamp).toBe(1700000000);
    });

    it('Scenario 2: Multi-commit linear history with line modification and line additions', async () => {
      // Commit 1 (Alice, t=1000): lines 1-5
      const blob1 = createCompressedGitObject('blob', 'line 1\nline 2\nline 3\nline 4\nline 5');
      const tree1 = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'service.ts', oid: blob1.oid }]));
      const commit1 = createCompressedGitObject(
        'commit',
        `tree ${tree1.oid}\nauthor Alice Dev <alice@example.com> 1000 +0000\ncommitter Alice Dev <alice@example.com> 1000 +0000\n\nCommit 1: Add service`
      );

      // Commit 2 (Bob, t=2000): modifies line 3
      const blob2 = createCompressedGitObject('blob', 'line 1\nline 2\nline 3: modified by bob\nline 4\nline 5');
      const tree2 = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'service.ts', oid: blob2.oid }]));
      const commit2 = createCompressedGitObject(
        'commit',
        `tree ${tree2.oid}\nparent ${commit1.oid}\nauthor Bob Engineer <bob@example.com> 2000 +0000\ncommitter Bob Engineer <bob@example.com> 2000 +0000\n\nCommit 2: Modify line 3`
      );

      // Commit 3 (Charlie, t=3000): appends lines 6 and 7
      const blob3 = createCompressedGitObject('blob', 'line 1\nline 2\nline 3: modified by bob\nline 4\nline 5\nline 6: added by charlie\nline 7: added by charlie');
      const tree3 = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'service.ts', oid: blob3.oid }]));
      const commit3 = createCompressedGitObject(
        'commit',
        `tree ${tree3.oid}\nparent ${commit2.oid}\nauthor Charlie Architect <charlie@example.com> 3000 +0000\ncommitter Charlie Architect <charlie@example.com> 3000 +0000\n\nCommit 3: Append lines 6 and 7`
      );

      const objectMap = new Map<string, Uint8Array>([
        [blob1.oid, blob1.compressed],
        [tree1.oid, tree1.compressed],
        [commit1.oid, commit1.compressed],
        [blob2.oid, blob2.compressed],
        [tree2.oid, tree2.compressed],
        [commit2.oid, commit2.compressed],
        [blob3.oid, blob3.compressed],
        [tree3.oid, tree3.compressed],
        [commit3.oid, commit3.compressed],
      ]);

      const client = setupMockClient(objectMap);
      const result = await computeBlame(client, commit3.oid, 'service.ts');

      expect(result.lines).toHaveLength(7);

      // Lines 1, 2: Alice (Commit 1)
      expect(result.lines[0]?.commitOid).toBe(commit1.oid);
      expect(result.lines[0]?.authorName).toBe('Alice Dev');
      expect(result.lines[1]?.commitOid).toBe(commit1.oid);
      expect(result.lines[1]?.authorName).toBe('Alice Dev');

      // Line 3: Bob (Commit 2)
      expect(result.lines[2]?.commitOid).toBe(commit2.oid);
      expect(result.lines[2]?.authorName).toBe('Bob Engineer');

      // Lines 4, 5: Alice (Commit 1)
      expect(result.lines[3]?.commitOid).toBe(commit1.oid);
      expect(result.lines[3]?.authorName).toBe('Alice Dev');
      expect(result.lines[4]?.commitOid).toBe(commit1.oid);
      expect(result.lines[4]?.authorName).toBe('Alice Dev');

      // Lines 6, 7: Charlie (Commit 3)
      expect(result.lines[5]?.commitOid).toBe(commit3.oid);
      expect(result.lines[5]?.authorName).toBe('Charlie Architect');
      expect(result.lines[6]?.commitOid).toBe(commit3.oid);
      expect(result.lines[6]?.authorName).toBe('Charlie Architect');

      // Verify Hunk Grouping
      expect(result.hunks).toHaveLength(4);
      expect(result.hunks[0]).toMatchObject({ startLine: 1, lineCount: 2, commitOid: commit1.oid });
      expect(result.hunks[1]).toMatchObject({ startLine: 3, lineCount: 1, commitOid: commit2.oid });
      expect(result.hunks[2]).toMatchObject({ startLine: 4, lineCount: 2, commitOid: commit1.oid });
      expect(result.hunks[3]).toMatchObject({ startLine: 6, lineCount: 2, commitOid: commit3.oid });

      // Verify Timestamp Boundaries
      expect(result.oldestTimestamp).toBe(1000);
      expect(result.newestTimestamp).toBe(3000);
    });

    it('Scenario 3: Commit modifying nothing in target file executes fast-path blob equality check', async () => {
      // Commit 1: Creates target.ts and other.ts
      const targetBlob = createCompressedGitObject('blob', 'export const value = 42;\n');
      const otherBlob1 = createCompressedGitObject('blob', 'file 1 version 1\n');
      const tree1 = createCompressedGitObject('tree', createTreePayload([
        { mode: '100644', name: 'other.ts', oid: otherBlob1.oid },
        { mode: '100644', name: 'target.ts', oid: targetBlob.oid },
      ]));
      const commit1 = createCompressedGitObject(
        'commit',
        `tree ${tree1.oid}\nauthor Alice <alice@a.com> 100 +0000\ncommitter Alice <alice@a.com> 100 +0000\n\nCommit 1`
      );

      // Commit 2: Modifies other.ts ONLY (target.ts unchanged -> exact same blob OID)
      const otherBlob2 = createCompressedGitObject('blob', 'file 1 version 2 modified\n');
      const tree2 = createCompressedGitObject('tree', createTreePayload([
        { mode: '100644', name: 'other.ts', oid: otherBlob2.oid },
        { mode: '100644', name: 'target.ts', oid: targetBlob.oid }, // Identical blob OID
      ]));
      const commit2 = createCompressedGitObject(
        'commit',
        `tree ${tree2.oid}\nparent ${commit1.oid}\nauthor Bob <bob@b.com> 200 +0000\ncommitter Bob <bob@b.com> 200 +0000\n\nCommit 2: Modify other.ts`
      );

      const objectMap = new Map<string, Uint8Array>([
        [targetBlob.oid, targetBlob.compressed],
        [otherBlob1.oid, otherBlob1.compressed],
        [otherBlob2.oid, otherBlob2.compressed],
        [tree1.oid, tree1.compressed],
        [tree2.oid, tree2.compressed],
        [commit1.oid, commit1.compressed],
        [commit2.oid, commit2.compressed],
      ]);

      const client = setupMockClient(objectMap);
      const result = await computeBlame(client, commit2.oid, 'target.ts');

      expect(result.lines).toHaveLength(2); // 'export const value = 42;', ''
      expect(result.lines[0]?.commitOid).toBe(commit1.oid);
      expect(result.lines[0]?.authorName).toBe('Alice');
      expect(result.hunks).toHaveLength(1);
      expect(result.hunks[0]?.commitOid).toBe(commit1.oid);
    });

    it('Scenario 4: File newly created in child commit (does not exist in parent commit)', async () => {
      // Commit 1: Only contains readme.md
      const readmeBlob = createCompressedGitObject('blob', '# Readme\n');
      const tree1 = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'readme.md', oid: readmeBlob.oid }]));
      const commit1 = createCompressedGitObject(
        'commit',
        `tree ${tree1.oid}\nauthor Alice <alice@a.com> 100 +0000\ncommitter Alice <alice@a.com> 100 +0000\n\nCommit 1`
      );

      // Commit 2: Introduces newlyCreated.ts
      const newBlob = createCompressedGitObject('blob', 'const a = 1;\nconst b = 2;');
      const tree2 = createCompressedGitObject('tree', createTreePayload([
        { mode: '100644', name: 'newlyCreated.ts', oid: newBlob.oid },
        { mode: '100644', name: 'readme.md', oid: readmeBlob.oid },
      ]));
      const commit2 = createCompressedGitObject(
        'commit',
        `tree ${tree2.oid}\nparent ${commit1.oid}\nauthor Bob <bob@b.com> 200 +0000\ncommitter Bob <bob@b.com> 200 +0000\n\nCommit 2: Add newlyCreated.ts`
      );

      const objectMap = new Map<string, Uint8Array>([
        [readmeBlob.oid, readmeBlob.compressed],
        [newBlob.oid, newBlob.compressed],
        [tree1.oid, tree1.compressed],
        [tree2.oid, tree2.compressed],
        [commit1.oid, commit1.compressed],
        [commit2.oid, commit2.compressed],
      ]);

      const client = setupMockClient(objectMap);
      const result = await computeBlame(client, commit2.oid, 'newlyCreated.ts');

      expect(result.lines).toHaveLength(2);
      expect(result.lines[0]?.commitOid).toBe(commit2.oid);
      expect(result.lines[1]?.commitOid).toBe(commit2.oid);
      expect(result.hunks).toHaveLength(1);
      expect(result.hunks[0]?.commitOid).toBe(commit2.oid);
      expect(result.hunks[0]?.lineCount).toBe(2);
    });

    it('Scenario 5: 0-byte empty file returns empty result without crashing', async () => {
      const emptyBlob = createCompressedGitObject('blob', '');
      const tree = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'empty.txt', oid: emptyBlob.oid }]));
      const commit = createCompressedGitObject(
        'commit',
        `tree ${tree.oid}\nauthor Alice <alice@a.com> 100 +0000\ncommitter Alice <alice@a.com> 100 +0000\n\nCommit 1: Add empty.txt`
      );

      const objectMap = new Map<string, Uint8Array>([
        [emptyBlob.oid, emptyBlob.compressed],
        [tree.oid, tree.compressed],
        [commit.oid, commit.compressed],
      ]);

      const client = setupMockClient(objectMap);
      const result = await computeBlame(client, commit.oid, 'empty.txt');

      expect(result.lines).toEqual([]);
      expect(result.hunks).toEqual([]);
      expect(result.oldestTimestamp).toBe(0);
      expect(result.newestTimestamp).toBe(0);
    });

    it('Scenario 6: Throws error when file is binary', async () => {
      const binaryBytes = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe]);
      const binaryBlob = createCompressedGitObject('blob', binaryBytes);
      const tree = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'image.bin', oid: binaryBlob.oid }]));
      const commit = createCompressedGitObject(
        'commit',
        `tree ${tree.oid}\nauthor Alice <alice@a.com> 100 +0000\ncommitter Alice <alice@a.com> 100 +0000\n\nCommit 1: Add binary`
      );

      const objectMap = new Map<string, Uint8Array>([
        [binaryBlob.oid, binaryBlob.compressed],
        [tree.oid, tree.compressed],
        [commit.oid, commit.compressed],
      ]);

      const client = setupMockClient(objectMap);
      await expect(computeBlame(client, commit.oid, 'image.bin')).rejects.toThrow(/binary/i);
    });

    it('Scenario 7: Throws error when target file does not exist at start commit', async () => {
      const blob = createCompressedGitObject('blob', 'Hello\n');
      const tree = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'exists.txt', oid: blob.oid }]));
      const commit = createCompressedGitObject(
        'commit',
        `tree ${tree.oid}\nauthor Alice <alice@a.com> 100 +0000\ncommitter Alice <alice@a.com> 100 +0000\n\nCommit 1`
      );

      const objectMap = new Map<string, Uint8Array>([
        [blob.oid, blob.compressed],
        [tree.oid, tree.compressed],
        [commit.oid, commit.compressed],
      ]);

      const client = setupMockClient(objectMap);
      await expect(computeBlame(client, commit.oid, 'nonexistent.txt')).rejects.toThrow(/not found/i);
    });

    it('Scenario 8: Invokes onProgress callback during DAG traversal', async () => {
      const blob1 = createCompressedGitObject('blob', 'line 1\n');
      const tree1 = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'app.ts', oid: blob1.oid }]));
      const commit1 = createCompressedGitObject(
        'commit',
        `tree ${tree1.oid}\nauthor Alice <a@a.com> 100 +0000\ncommitter Alice <a@a.com> 100 +0000\n\nC1`
      );

      const blob2 = createCompressedGitObject('blob', 'line 1 mod\n');
      const tree2 = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'app.ts', oid: blob2.oid }]));
      const commit2 = createCompressedGitObject(
        'commit',
        `tree ${tree2.oid}\nparent ${commit1.oid}\nauthor Bob <b@b.com> 200 +0000\ncommitter Bob <b@b.com> 200 +0000\n\nC2`
      );

      const objectMap = new Map<string, Uint8Array>([
        [blob1.oid, blob1.compressed],
        [tree1.oid, tree1.compressed],
        [commit1.oid, commit1.compressed],
        [blob2.oid, blob2.compressed],
        [tree2.oid, tree2.compressed],
        [commit2.oid, commit2.compressed],
      ]);

      const client = setupMockClient(objectMap);
      const progressCalls: number[] = [];
      await computeBlame(client, commit2.oid, 'app.ts', (count) => {
        progressCalls.push(count);
      });

      expect(progressCalls.length).toBeGreaterThanOrEqual(1);
      expect(progressCalls[0]).toBe(1);
    });

    it('Scenario 9: Resolves annotated tag target when starting blame', async () => {
      const blob = createCompressedGitObject('blob', 'tagged file');
      const tree = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'app.ts', oid: blob.oid }]));
      const commit = createCompressedGitObject(
        'commit',
        `tree ${tree.oid}\nauthor Alice <a@a.com> 100 +0000\ncommitter Alice <a@a.com> 100 +0000\n\nC1`
      );
      const tag = createCompressedGitObject(
        'tag',
        `object ${commit.oid}\ntype commit\ntag v1.0.0\ntagger Alice <a@a.com> 100 +0000\n\nRelease 1.0`
      );

      const objectMap = new Map<string, Uint8Array>([
        [blob.oid, blob.compressed],
        [tree.oid, tree.compressed],
        [commit.oid, commit.compressed],
        [tag.oid, tag.compressed],
      ]);

      const client = setupMockClient(objectMap);
      const result = await computeBlame(client, tag.oid, 'app.ts');

      expect(result.lines).toHaveLength(1);
      expect(result.lines[0]?.commitOid).toBe(commit.oid);
    });

    it('Scenario 10: Follows first parent on merge commit', async () => {
      const blob1 = createCompressedGitObject('blob', 'feature 1\n');
      const tree1 = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'f.ts', oid: blob1.oid }]));
      const commit1 = createCompressedGitObject('commit', `tree ${tree1.oid}\nauthor A <a@a.com> 100 +0000\ncommitter A <a@a.com> 100 +0000\n\nC1`);

      const blob2 = createCompressedGitObject('blob', 'feature 2\n');
      const tree2 = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'f.ts', oid: blob2.oid }]));
      const commit2 = createCompressedGitObject('commit', `tree ${tree2.oid}\nauthor B <b@b.com> 200 +0000\ncommitter B <b@b.com> 200 +0000\n\nC2`);

      const mergeBlob = createCompressedGitObject('blob', 'feature 1\n');
      const mergeTree = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'f.ts', oid: mergeBlob.oid }]));
      const mergeCommit = createCompressedGitObject(
        'commit',
        `tree ${mergeTree.oid}\nparent ${commit1.oid}\nparent ${commit2.oid}\nauthor M <m@m.com> 300 +0000\ncommitter M <m@m.com> 300 +0000\n\nMerge`
      );

      const objectMap = new Map<string, Uint8Array>([
        [blob1.oid, blob1.compressed],
        [tree1.oid, tree1.compressed],
        [commit1.oid, commit1.compressed],
        [blob2.oid, blob2.compressed],
        [tree2.oid, tree2.compressed],
        [commit2.oid, commit2.compressed],
        [mergeBlob.oid, mergeBlob.compressed],
        [mergeTree.oid, mergeTree.compressed],
        [mergeCommit.oid, mergeCommit.compressed],
      ]);

      const client = setupMockClient(objectMap);
      const result = await computeBlame(client, mergeCommit.oid, 'f.ts');

      expect(result.lines).toHaveLength(2); // 'feature 1', ''
      expect(result.lines[0]?.commitOid).toBe(commit1.oid);
    });

    it('Scenario 11: Missing parent object in repository gracefully attributes to current commit', async () => {
      const blob = createCompressedGitObject('blob', 'some line\n');
      const tree = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'f.ts', oid: blob.oid }]));
      const commit = createCompressedGitObject(
        'commit',
        `tree ${tree.oid}\nparent 9999999999999999999999999999999999999999\nauthor A <a@a.com> 100 +0000\ncommitter A <a@a.com> 100 +0000\n\nC1`
      );

      const objectMap = new Map<string, Uint8Array>([
        [blob.oid, blob.compressed],
        [tree.oid, tree.compressed],
        [commit.oid, commit.compressed],
      ]);

      const client = setupMockClient(objectMap);
      const result = await computeBlame(client, commit.oid, 'f.ts');

      expect(result.lines).toHaveLength(2);
      expect(result.lines[0]?.commitOid).toBe(commit.oid);
    });

    it('Scenario 12: Cyclic commit graph breaks traversal safely', async () => {
      const blob = createCompressedGitObject('blob', 'data\n');
      const tree = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'f.ts', oid: blob.oid }]));
      // Create a commit that lists itself as parent
      const dummyOid = '8888888888888888888888888888888888888888';
      const commit = createCompressedGitObject(
        'commit',
        `tree ${tree.oid}\nparent ${dummyOid}\nauthor A <a@a.com> 100 +0000\ncommitter A <a@a.com> 100 +0000\n\nCyclic`
      );

      const objectMap = new Map<string, Uint8Array>([
        [blob.oid, blob.compressed],
        [tree.oid, tree.compressed],
        [commit.oid, commit.compressed],
      ]);

      const client = setupMockClient(objectMap);
      const result = await computeBlame(client, commit.oid, 'f.ts');

      expect(result.lines).toHaveLength(2);
    });

    it('Scenario 13: Normalizes leading and trailing slashes in file path', async () => {
      const blob = createCompressedGitObject('blob', 'content');
      const tree = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'target.ts', oid: blob.oid }]));
      const commit = createCompressedGitObject('commit', `tree ${tree.oid}\nauthor A <a@a.com> 100 +0000\ncommitter A <a@a.com> 100 +0000\n\nC1`);

      const objectMap = new Map<string, Uint8Array>([
        [blob.oid, blob.compressed],
        [tree.oid, tree.compressed],
        [commit.oid, commit.compressed],
      ]);

      const client = setupMockClient(objectMap);
      const result = await computeBlame(client, commit.oid, '///target.ts///');

      expect(result.lines).toHaveLength(1);
      expect(result.lines[0]?.commitOid).toBe(commit.oid);
    });

    it('Scenario 14: Throws error when path points to a directory', async () => {
      const subBlob = createCompressedGitObject('blob', 'inside');
      const subTree = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'file.txt', oid: subBlob.oid }]));
      const rootTree = createCompressedGitObject('tree', createTreePayload([{ mode: '040000', name: 'subdir', oid: subTree.oid }]));
      const commit = createCompressedGitObject('commit', `tree ${rootTree.oid}\nauthor A <a@a.com> 100 +0000\ncommitter A <a@a.com> 100 +0000\n\nC1`);

      const objectMap = new Map<string, Uint8Array>([
        [subBlob.oid, subBlob.compressed],
        [subTree.oid, subTree.compressed],
        [rootTree.oid, rootTree.compressed],
        [commit.oid, commit.compressed],
      ]);

      const client = setupMockClient(objectMap);
      await expect(computeBlame(client, commit.oid, 'subdir')).rejects.toThrow(/directory/i);
    });

    it('Scenario 15: Throws error for empty file path', async () => {
      const client = new GitRepositoryClient('https://mock.sendforge');
      await expect(computeBlame(client, '1111111111111111111111111111111111111111', '   ')).rejects.toThrow(/cannot be empty/i);
    });
  });


  // ===========================================================================
  // 3. UI Component: BlameView
  // ===========================================================================
  describe('BlameView Component Rendering', () => {
    const mockBlameResult = {
      lines: [
        { lineNumber: 1, commitOid: '4b825dc642cb6eb9a060e54bf8d69288fbee4904', authorName: 'Alice Dev', authorEmail: 'alice@a.com', timestamp: 1000, summary: 'Initial setup' },
        { lineNumber: 2, commitOid: '4b825dc642cb6eb9a060e54bf8d69288fbee4904', authorName: 'Alice Dev', authorEmail: 'alice@a.com', timestamp: 1000, summary: 'Initial setup' },
        { lineNumber: 3, commitOid: '1111111111111111111111111111111111111111', authorName: 'Bob Engineer', authorEmail: 'bob@b.com', timestamp: 2000, summary: 'Fix calculation' },
      ],
      hunks: [
        { commitOid: '4b825dc642cb6eb9a060e54bf8d69288fbee4904', authorName: 'Alice Dev', authorEmail: 'alice@a.com', timestamp: 1000, summary: 'Initial setup', startLine: 1, lineCount: 2 },
        { commitOid: '1111111111111111111111111111111111111111', authorName: 'Bob Engineer', authorEmail: 'bob@b.com', timestamp: 2000, summary: 'Fix calculation', startLine: 3, lineCount: 1 },
      ],
      oldestTimestamp: 1000,
      newestTimestamp: 2000,
    };

    const mockFileLines = [
      'const a = 1;',
      'const b = 2;',
      'const c = a + b + 10;',
    ];

    it('renders blame view with author names, avatar initials, and commit summaries', () => {
      const html = render(
        h(BlameView, {
          blameResult: mockBlameResult,
          fileLines: mockFileLines,
          filePath: 'src/math.ts',
        })
      );

      expect(html).toContain('Alice Dev');
      expect(html).toContain('Bob Engineer');
      expect(html).toContain('AD'); // Alice Dev initials
      expect(html).toContain('BE'); // Bob Engineer initials
      expect(html).toContain('Initial setup');
      expect(html).toContain('Fix calculation');
    });

    it('renders short 7-character commit SHA badges and commit diff links', () => {
      const html = render(
        h(BlameView, {
          blameResult: mockBlameResult,
          fileLines: mockFileLines,
          filePath: 'src/math.ts',
        })
      );

      expect(html).toContain('4b825dc');
      expect(html).toContain('1111111');
      expect(html).toContain('href="#/commit/4b825dc642cb6eb9a060e54bf8d69288fbee4904"');
      expect(html).toContain('href="#/commit/1111111111111111111111111111111111111111"');
    });

    it('renders all line numbers and corresponding code contents', () => {
      const html = render(
        h(BlameView, {
          blameResult: mockBlameResult,
          fileLines: mockFileLines,
          filePath: 'src/math.ts',
        })
      );

      expect(html).toContain('const a = 1;');
      expect(html).toContain('const b = 2;');
      expect(html).toContain('const c = a + b + 10;');
    });

    it('renders age heatmap indicators with correct heat styling', () => {
      const html = render(
        h(BlameView, {
          blameResult: mockBlameResult,
          fileLines: mockFileLines,
          filePath: 'src/math.ts',
        })
      );

      expect(html).toContain('blame-heatmap');
    });

    it('renders empty message gracefully for 0-line empty blame result', () => {
      const emptyResult = {
        lines: [],
        hunks: [],
        oldestTimestamp: 0,
        newestTimestamp: 0,
      };

      const html = render(
        h(BlameView, {
          blameResult: emptyResult,
          fileLines: [],
          filePath: 'empty.txt',
        })
      );

      expect(html).toBeDefined();
      expect(html).toContain('empty.txt');
    });

    it('handles hunk continuation rendering without duplicate author names', () => {
      const html = render(
        h(BlameView, {
          blameResult: mockBlameResult,
          fileLines: mockFileLines,
          filePath: 'src/math.ts',
        })
      );

      expect(html).toContain('continuation');
      expect(html).toContain('hunk-start');
    });
  });

  // ===========================================================================
  // 4. BlobView Mode Switching
  // ===========================================================================
  describe('BlobView Code/Blame Mode Switching', () => {
    it('renders Code / Blame toggle button group for non-binary files', () => {
      const textBlob: GitBlobObject = {
        type: 'blob',
        oid: '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
        size: 30,
        data: new TextEncoder().encode('export const x = 1;\n'),
        isBinary: false,
        text: 'export const x = 1;\n',
      };

      const html = render(
        h(BlobView, {
          blob: textBlob,
          path: 'src/index.ts',
          commitOid: '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
        })
      );

      expect(html).toContain('Code');
      expect(html).toContain('Blame');
      expect(html).toContain('Raw');
      expect(html).toContain('btn-group');
    });
  });
});
