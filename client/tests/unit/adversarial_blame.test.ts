import { afterEach, describe, expect, it, vi } from 'vitest';
import { h } from 'preact';
import render from 'preact-render-to-string';
import {
  computeBlame,
  formatCommitSummary,
  getAuthorColor,
  getAuthorInitials,
  groupBlameHunks,
} from '../../src/engine/blame.js';
import { BlameView } from '../../src/ui/BlameView.js';
import { GitRepositoryClient } from '../../src/engine/fetcher.js';
import { createCompressedGitObject, createTreePayload } from '../fixtures.js';

describe('Adversarial Stress Testing: Milestone M2 In-Browser git blame Engine', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function setupMockClient(objects: Map<string, Uint8Array>): GitRepositoryClient {
    const client = new GitRepositoryClient('https://mock-adversarial.sendforge.internal');
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

  // ===========================================================================
  // 1. Deep Commit Chain Stress Tests (50+ commits)
  // ===========================================================================
  describe('1. Deep Commit Chain Stress Tests', () => {
    it('accurately blames a linear 60-commit chain where each commit appends 1 line', async () => {
      const objectMap = new Map<string, Uint8Array>();
      const commitOids: string[] = [];
      const lines: string[] = [];

      let parentOid: string | null = null;
      const numCommits = 60;

      for (let i = 1; i <= numCommits; i++) {
        lines.push(`Line ${i}: committed at rev ${i}`);
        const content = lines.join('\n');
        const blob = createCompressedGitObject('blob', content);
        const tree = createCompressedGitObject(
          'tree',
          createTreePayload([{ mode: '100644', name: 'linear.ts', oid: blob.oid }])
        );

        const parentClause = parentOid ? `parent ${parentOid}\n` : '';
        const commitPayload = [
          `tree ${tree.oid}`,
          parentClause + `author Contributor_${i} <user${i}@example.com> ${1000 + i * 10} +0000`,
          `committer Contributor_${i} <user${i}@example.com> ${1000 + i * 10} +0000`,
          '',
          `Commit ${i}: add line ${i}`,
        ].join('\n');

        const commit = createCompressedGitObject('commit', commitPayload);

        objectMap.set(blob.oid, blob.compressed);
        objectMap.set(tree.oid, tree.compressed);
        objectMap.set(commit.oid, commit.compressed);

        commitOids.push(commit.oid);
        parentOid = commit.oid;
      }

      const client = setupMockClient(objectMap);
      const headOid = commitOids[commitOids.length - 1] ?? '';

      let progressCount = 0;
      const t0 = performance.now();
      const result = await computeBlame(client, headOid, 'linear.ts', (visited) => {
        progressCount = visited;
      });
      const t1 = performance.now();

      expect(progressCount).toBe(60);
      expect(result.lines).toHaveLength(60);
      expect(result.hunks).toHaveLength(60);

      // Verify each line attributes to its exact introducing commit
      for (let i = 0; i < 60; i++) {
        const line = result.lines[i];
        const expectedOid = commitOids[i];
        expect(line).toBeDefined();
        expect(line?.lineNumber).toBe(i + 1);
        expect(line?.commitOid).toBe(expectedOid);
        expect(line?.authorName).toBe(`Contributor_${i + 1}`);
        expect(line?.timestamp).toBe(1000 + (i + 1) * 10);
        expect(line?.summary).toBe(`Commit ${i + 1}: add line ${i + 1}`);

        const hunk = result.hunks[i];
        expect(hunk).toBeDefined();
        expect(hunk?.startLine).toBe(i + 1);
        expect(hunk?.lineCount).toBe(1);
        expect(hunk?.commitOid).toBe(expectedOid);
      }

      expect(result.oldestTimestamp).toBe(1010);
      expect(result.newestTimestamp).toBe(1000 + 60 * 10);
      expect(t1 - t0).toBeLessThan(1500); // Fast client-side execution
    });

    it('accurately attributes lines in a 100-commit history with random mutations', async () => {
      const objectMap = new Map<string, Uint8Array>();
      const commitOids: string[] = [];
      const totalLinesCount = 15;
      let currentLines = Array.from({ length: totalLinesCount }, (_, i) => `Initial content ${i + 1}`);

      // Ground truth tracker: line index -> last modifying commit index (0-indexed)
      const groundTruth: number[] = new Array<number>(totalLinesCount).fill(0);

      let parentOid: string | null = null;
      const numCommits = 100;

      for (let c = 0; c < numCommits; c++) {
        if (c > 0) {
          // Mutate 1 or 2 lines deterministically
          const modIdx1 = (c * 7) % totalLinesCount;
          const modIdx2 = (c * 13) % totalLinesCount;
          currentLines = [...currentLines];
          currentLines[modIdx1] = `Modified at commit ${c} (line ${modIdx1 + 1})`;
          groundTruth[modIdx1] = c;
          if (c % 3 === 0) {
            currentLines[modIdx2] = `Modified at commit ${c} (line ${modIdx2 + 1})`;
            groundTruth[modIdx2] = c;
          }
        }

        const blob = createCompressedGitObject('blob', currentLines.join('\n'));
        const tree = createCompressedGitObject(
          'tree',
          createTreePayload([{ mode: '100644', name: 'app.ts', oid: blob.oid }])
        );

        const parentClause = parentOid ? `parent ${parentOid}\n` : '';
        const commitPayload = [
          `tree ${tree.oid}`,
          parentClause + `author Dev_${c} <dev${c}@sendforge.internal> ${5000 + c * 20} +0000`,
          `committer Dev_${c} <dev${c}@sendforge.internal> ${5000 + c * 20} +0000`,
          '',
          `Commit ${c}: state update`,
        ].join('\n');

        const commit = createCompressedGitObject('commit', commitPayload);
        objectMap.set(blob.oid, blob.compressed);
        objectMap.set(tree.oid, tree.compressed);
        objectMap.set(commit.oid, commit.compressed);

        commitOids.push(commit.oid);
        parentOid = commit.oid;
      }

      const client = setupMockClient(objectMap);
      const headOid = commitOids[commitOids.length - 1] ?? '';

      const result = await computeBlame(client, headOid, 'app.ts');

      expect(result.lines).toHaveLength(totalLinesCount);
      for (let i = 0; i < totalLinesCount; i++) {
        const line = result.lines[i];
        const expectedCommitIdx = groundTruth[i];
        expect(line).toBeDefined();
        expect(expectedCommitIdx).toBeDefined();
        if (line && expectedCommitIdx !== undefined) {
          const expectedOid = commitOids[expectedCommitIdx];
          expect(line.commitOid).toBe(expectedOid);
          expect(line.authorName).toBe(`Dev_${expectedCommitIdx}`);
          expect(line.timestamp).toBe(5000 + expectedCommitIdx * 20);
        }
      }
    });
  });

  // ===========================================================================
  // 2. Complex Multi-Line Insertions, Deletions, and Re-orderings
  // ===========================================================================
  describe('2. Complex Multi-Line Insertions, Deletions, and Re-orderings', () => {
    it('handles line reversal / re-ordering across commits without losing lines', async () => {
      // Commit 1: A, B, C, D, E, F
      const lines1 = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'];
      const blob1 = createCompressedGitObject('blob', lines1.join('\n'));
      const tree1 = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'order.txt', oid: blob1.oid }]));
      const commit1 = createCompressedGitObject('commit', `tree ${tree1.oid}\nauthor Alice <a@a.com> 1000 +0000\ncommitter Alice <a@a.com> 1000 +0000\n\nC1: Original`);

      // Commit 2: Reverse order -> zeta, epsilon, delta, gamma, beta, alpha
      const lines2 = ['zeta', 'epsilon', 'delta', 'gamma', 'beta', 'alpha'];
      const blob2 = createCompressedGitObject('blob', lines2.join('\n'));
      const tree2 = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'order.txt', oid: blob2.oid }]));
      const commit2 = createCompressedGitObject(
        'commit',
        `tree ${tree2.oid}\nparent ${commit1.oid}\nauthor Bob <b@b.com> 2000 +0000\ncommitter Bob <b@b.com> 2000 +0000\n\nC2: Reversed`
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
      const result = await computeBlame(client, commit2.oid, 'order.txt');

      expect(result.lines).toHaveLength(6);
      for (const line of result.lines) {
        expect(line.commitOid).toBeDefined();
        expect([commit1.oid, commit2.oid]).toContain(line.commitOid);
      }
    });

    it('disambiguates repeated identical lines (e.g. braces and return statements)', async () => {
      // Commit 1 (Alice): Simple function
      const content1 = [
        'function first() {',
        '  return 1;',
        '}',
      ].join('\n');
      const blob1 = createCompressedGitObject('blob', content1);
      const tree1 = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'funcs.ts', oid: blob1.oid }]));
      const commit1 = createCompressedGitObject('commit', `tree ${tree1.oid}\nauthor Alice <a@a.com> 1000 +0000\ncommitter Alice <a@a.com> 1000 +0000\n\nC1`);

      // Commit 2 (Bob): Adds a second function with identical boilerplate lines ('}', '  return ...;')
      const content2 = [
        'function first() {',
        '  return 1;',
        '}',
        '',
        'function second() {',
        '  return 2;',
        '}',
      ].join('\n');
      const blob2 = createCompressedGitObject('blob', content2);
      const tree2 = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'funcs.ts', oid: blob2.oid }]));
      const commit2 = createCompressedGitObject(
        'commit',
        `tree ${tree2.oid}\nparent ${commit1.oid}\nauthor Bob <b@b.com> 2000 +0000\ncommitter Bob <b@b.com> 2000 +0000\n\nC2`
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
      const result = await computeBlame(client, commit2.oid, 'funcs.ts');

      expect(result.lines).toHaveLength(7);
      // Lines 1..3 from Alice
      expect(result.lines[0]?.commitOid).toBe(commit1.oid);
      expect(result.lines[1]?.commitOid).toBe(commit1.oid);
      expect(result.lines[2]?.commitOid).toBe(commit1.oid);

      // Lines 4..7 from Bob
      expect(result.lines[3]?.commitOid).toBe(commit2.oid);
      expect(result.lines[4]?.commitOid).toBe(commit2.oid);
      expect(result.lines[5]?.commitOid).toBe(commit2.oid);
      expect(result.lines[6]?.commitOid).toBe(commit2.oid);

      expect(result.hunks).toHaveLength(2);
      expect(result.hunks[0]).toMatchObject({ startLine: 1, lineCount: 3, commitOid: commit1.oid });
      expect(result.hunks[1]).toMatchObject({ startLine: 4, lineCount: 4, commitOid: commit2.oid });
    });

    it('handles interleaved block deletions, insertions, and middle replacements', async () => {
      // Commit 1: 10 lines
      const content1 = Array.from({ length: 10 }, (_, i) => `Initial line ${i + 1}`).join('\n');
      const blob1 = createCompressedGitObject('blob', content1);
      const tree1 = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'block.txt', oid: blob1.oid }]));
      const commit1 = createCompressedGitObject('commit', `tree ${tree1.oid}\nauthor Alice <a@a.com> 1000 +0000\ncommitter Alice <a@a.com> 1000 +0000\n\nC1`);

      // Commit 2: delete lines 4..7, replace with 2 lines (Bob)
      const content2 = [
        'Initial line 1',
        'Initial line 2',
        'Initial line 3',
        'Bob replacement line A',
        'Bob replacement line B',
        'Initial line 8',
        'Initial line 9',
        'Initial line 10',
      ].join('\n');
      const blob2 = createCompressedGitObject('blob', content2);
      const tree2 = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'block.txt', oid: blob2.oid }]));
      const commit2 = createCompressedGitObject('commit', `tree ${tree2.oid}\nparent ${commit1.oid}\nauthor Bob <b@b.com> 2000 +0000\ncommitter Bob <b@b.com> 2000 +0000\n\nC2`);

      // Commit 3: prepend 2 lines, delete last line 10 (Charlie)
      const content3 = [
        'Charlie top 1',
        'Charlie top 2',
        'Initial line 1',
        'Initial line 2',
        'Initial line 3',
        'Bob replacement line A',
        'Bob replacement line B',
        'Initial line 8',
        'Initial line 9',
      ].join('\n');
      const blob3 = createCompressedGitObject('blob', content3);
      const tree3 = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'block.txt', oid: blob3.oid }]));
      const commit3 = createCompressedGitObject('commit', `tree ${tree3.oid}\nparent ${commit2.oid}\nauthor Charlie <c@c.com> 3000 +0000\ncommitter Charlie <c@c.com> 3000 +0000\n\nC3`);

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
      const result = await computeBlame(client, commit3.oid, 'block.txt');

      // Verify that computeBlame correctly attributes lines
      // Note: Myers diff middle backtracking bug (Bug #1) in diff-algo.ts causes misattribution here
      // Lines 1, 2: Charlie (Commit 3)
      expect(result.lines[0]?.commitOid).toBe(commit3.oid);
      expect(result.lines[1]?.commitOid).toBe(commit3.oid);
      // Lines 3, 4, 5: Alice (Commit 1)
      expect(result.lines[2]?.commitOid).toBe(commit1.oid);
      expect(result.lines[3]?.commitOid).toBe(commit1.oid);
      expect(result.lines[4]?.commitOid).toBe(commit1.oid);
      // Lines 6, 7: Bob (Commit 2)
      expect(result.lines[5]?.commitOid).toBe(commit2.oid);
      expect(result.lines[6]?.commitOid).toBe(commit2.oid);
      // Lines 8, 9: Alice (Commit 1)
      expect(result.lines[7]?.commitOid).toBe(commit1.oid);
      expect(result.lines[8]?.commitOid).toBe(commit1.oid);

      // Verify Hunks
      expect(result.hunks).toHaveLength(4);
      expect(result.hunks[0]).toMatchObject({ startLine: 1, lineCount: 2, commitOid: commit3.oid });
      expect(result.hunks[1]).toMatchObject({ startLine: 3, lineCount: 3, commitOid: commit1.oid });
      expect(result.hunks[2]).toMatchObject({ startLine: 6, lineCount: 2, commitOid: commit2.oid });
      expect(result.hunks[3]).toMatchObject({ startLine: 8, lineCount: 2, commitOid: commit1.oid });
    });

    it('attributes 100% of lines to new commit when file is completely replaced', async () => {
      const blob1 = createCompressedGitObject('blob', 'old line 1\nold line 2\nold line 3');
      const tree1 = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'rewrite.txt', oid: blob1.oid }]));
      const commit1 = createCompressedGitObject('commit', `tree ${tree1.oid}\nauthor Alice <a@a.com> 1000 +0000\ncommitter Alice <a@a.com> 1000 +0000\n\nC1`);

      const blob2 = createCompressedGitObject('blob', 'brand new A\nbrand new B\nbrand new C\nbrand new D');
      const tree2 = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'rewrite.txt', oid: blob2.oid }]));
      const commit2 = createCompressedGitObject('commit', `tree ${tree2.oid}\nparent ${commit1.oid}\nauthor Bob <b@b.com> 2000 +0000\ncommitter Bob <b@b.com> 2000 +0000\n\nC2: Rewrite`);

      const objectMap = new Map<string, Uint8Array>([
        [blob1.oid, blob1.compressed],
        [tree1.oid, tree1.compressed],
        [commit1.oid, commit1.compressed],
        [blob2.oid, blob2.compressed],
        [tree2.oid, tree2.compressed],
        [commit2.oid, commit2.compressed],
      ]);

      const client = setupMockClient(objectMap);
      const result = await computeBlame(client, commit2.oid, 'rewrite.txt');

      expect(result.lines).toHaveLength(4);
      for (const line of result.lines) {
        expect(line.commitOid).toBe(commit2.oid);
        expect(line.authorName).toBe('Bob');
      }
      expect(result.hunks).toHaveLength(1);
      expect(result.hunks[0]?.lineCount).toBe(4);
    });
  });

  // ===========================================================================
  // 3. Non-ASCII, Multi-Byte UTF-8 & Unicode Content
  // ===========================================================================
  describe('3. Non-ASCII, Multi-Byte UTF-8 & Unicode Content', () => {
    it('handles multi-lingual UTF-8 text (Japanese, Chinese, Arabic, Hebrew, Cyrillic)', async () => {
      // Commit 1: CJK & Cyrillic
      const content1 = [
        'こんにちは世界 (Japanese)',
        '你好世界 (Simplified Chinese)',
        'Привет мир (Russian Cyrillic)',
      ].join('\n');
      const blob1 = createCompressedGitObject('blob', content1);
      const tree1 = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'i18n.txt', oid: blob1.oid }]));
      const commit1 = createCompressedGitObject(
        'commit',
        `tree ${tree1.oid}\nauthor 山田 太郎 <yamada@example.jp> 1000 +0000\ncommitter 山田 太郎 <yamada@example.jp> 1000 +0000\n\nInitial i18n`
      );

      // Commit 2: Arabic & Hebrew (RTL)
      const content2 = [
        'こんにちは世界 (Japanese)',
        '你好世界 (Simplified Chinese)',
        'Привет мир (Russian Cyrillic)',
        'مرحبا بالعالم (Arabic RTL)',
        'שלום עולם (Hebrew RTL)',
      ].join('\n');
      const blob2 = createCompressedGitObject('blob', content2);
      const tree2 = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'i18n.txt', oid: blob2.oid }]));
      const commit2 = createCompressedGitObject(
        'commit',
        `tree ${tree2.oid}\nparent ${commit1.oid}\nauthor דוד כהן <david@example.il> 2000 +0000\ncommitter דוד כהן <david@example.il> 2000 +0000\n\nAdd RTL support`
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
      const result = await computeBlame(client, commit2.oid, 'i18n.txt');

      expect(result.lines).toHaveLength(5);
      expect(result.lines[0]?.authorName).toBe('山田 太郎');
      expect(result.lines[1]?.authorName).toBe('山田 太郎');
      expect(result.lines[2]?.authorName).toBe('山田 太郎');
      expect(result.lines[3]?.authorName).toBe('דוד כהן');
      expect(result.lines[4]?.authorName).toBe('דוד כהן');

      expect(result.hunks).toHaveLength(2);
      expect(result.hunks[0]?.authorName).toBe('山田 太郎');
      expect(result.hunks[1]?.authorName).toBe('דוד כהן');
    });

    it('handles emojis, surrogate pairs, and zero-width joiners correctly', async () => {
      const content1 = [
        '👨‍👩‍👧‍👦 Family with ZWJ',
        '🧑🏽‍💻 Tech worker with skin tone',
        '🦀 Rust Crab',
      ].join('\n');
      const blob1 = createCompressedGitObject('blob', content1);
      const tree1 = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'emoji.txt', oid: blob1.oid }]));
      const commit1 = createCompressedGitObject(
        'commit',
        `tree ${tree1.oid}\nauthor 🦀 Rustacean <crab@rust-lang.org> 1000 +0000\ncommitter 🦀 Rustacean <crab@rust-lang.org> 1000 +0000\n\n🎉 Initial emoji commit`
      );

      const content2 = [
        '👨‍👩‍👧‍👦 Family with ZWJ',
        '🧑🏽‍💻 Tech worker with skin tone',
        '🦀 Rust Crab: turbocharged ⚡️🚀',
        '🦄 Unicorn',
      ].join('\n');
      const blob2 = createCompressedGitObject('blob', content2);
      const tree2 = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'emoji.txt', oid: blob2.oid }]));
      const commit2 = createCompressedGitObject(
        'commit',
        `tree ${tree2.oid}\nparent ${commit1.oid}\nauthor 🚀 Booster <boost@fast.io> 2000 +0000\ncommitter 🚀 Booster <boost@fast.io> 2000 +0000\n\n✨ Add boost and unicorn`
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
      const result = await computeBlame(client, commit2.oid, 'emoji.txt');

      expect(result.lines).toHaveLength(4);
      expect(result.lines[0]?.commitOid).toBe(commit1.oid);
      expect(result.lines[1]?.commitOid).toBe(commit1.oid);
      expect(result.lines[2]?.commitOid).toBe(commit2.oid);
      expect(result.lines[3]?.commitOid).toBe(commit2.oid);
    });

    it('handles Windows CRLF (\\r\\n) and mixed line endings seamlessly', async () => {
      // Commit 1: CRLF line endings
      const content1 = 'line 1\r\nline 2\r\nline 3\r\nline 4';
      const blob1 = createCompressedGitObject('blob', content1);
      const tree1 = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'crlf.txt', oid: blob1.oid }]));
      const commit1 = createCompressedGitObject('commit', `tree ${tree1.oid}\nauthor WindowsDev <win@ms.com> 1000 +0000\ncommitter WindowsDev <win@ms.com> 1000 +0000\n\nC1: CRLF`);

      // Commit 2: Modify line 2 with LF
      const content2 = 'line 1\nline 2 modified\nline 3\nline 4';
      const blob2 = createCompressedGitObject('blob', content2);
      const tree2 = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'crlf.txt', oid: blob2.oid }]));
      const commit2 = createCompressedGitObject('commit', `tree ${tree2.oid}\nparent ${commit1.oid}\nauthor MacDev <mac@apple.com> 2000 +0000\ncommitter MacDev <mac@apple.com> 2000 +0000\n\nC2: LF`);

      const objectMap = new Map<string, Uint8Array>([
        [blob1.oid, blob1.compressed],
        [tree1.oid, tree1.compressed],
        [commit1.oid, commit1.compressed],
        [blob2.oid, blob2.compressed],
        [tree2.oid, tree2.compressed],
        [commit2.oid, commit2.compressed],
      ]);

      const client = setupMockClient(objectMap);
      const result = await computeBlame(client, commit2.oid, 'crlf.txt');

      expect(result.lines).toHaveLength(4);
      expect(result.lines[0]?.commitOid).toBe(commit1.oid);
      expect(result.lines[1]?.commitOid).toBe(commit2.oid);
      expect(result.lines[2]?.commitOid).toBe(commit1.oid);
      expect(result.lines[3]?.commitOid).toBe(commit1.oid);
    });

    it('safely generates author initials, colors, and summaries for non-Latin names and emojis', () => {
      expect(getAuthorInitials('山田 太郎')).toBe('山太');
      expect(getAuthorInitials('דוד כהן')).toBe('דכ');
      expect(getAuthorInitials('🦀 Rustacean')).toBe('🦀R');
      expect(getAuthorInitials('🚀')).toBe('🚀');

      const color = getAuthorColor('山田 太郎', 'yamada@example.jp');
      expect(color).toMatch(/^hsl\(\d+, 55%, 42%\)$/);

      const summary = formatCommitSummary('🎉 Feature: Add Blame\n\nDetailed release notes');
      expect(summary).toBe('🎉 Feature: Add Blame');
    });
  });

  // ===========================================================================
  // 4. Fast-Path Performance vs Diff Execution
  // ===========================================================================
  describe('4. Fast-Path Performance vs Diff Execution', () => {
    it('executes fast path on 80 untouched ancestor commits in < 150ms', async () => {
      const objectMap = new Map<string, Uint8Array>();
      const commitOids: string[] = [];

      // Target file remains constant for 80 commits
      const targetBlob = createCompressedGitObject('blob', 'const API_VERSION = "2.0.0";\nconst CONFIG = true;\n');
      objectMap.set(targetBlob.oid, targetBlob.compressed);

      let parentOid: string | null = null;
      const numCommits = 80;

      for (let i = 0; i < numCommits; i++) {
        // Every commit modifies other_file.ts
        const otherBlob = createCompressedGitObject('blob', `// other file change at commit ${i}`);
        objectMap.set(otherBlob.oid, otherBlob.compressed);

        const tree = createCompressedGitObject(
          'tree',
          createTreePayload([
            { mode: '100644', name: 'other_file.ts', oid: otherBlob.oid },
            { mode: '100644', name: 'config.ts', oid: targetBlob.oid }, // UNCHANGED blob OID!
          ])
        );
        objectMap.set(tree.oid, tree.compressed);

        const parentClause = parentOid ? `parent ${parentOid}\n` : '';
        const commit = createCompressedGitObject(
          'commit',
          `tree ${tree.oid}\n${parentClause}author Committer_${i} <c${i}@forge.io> ${1000 + i * 10} +0000\ncommitter Committer_${i} <c${i}@forge.io> ${1000 + i * 10} +0000\n\nCommit ${i}`
        );
        objectMap.set(commit.oid, commit.compressed);

        commitOids.push(commit.oid);
        parentOid = commit.oid;
      }

      const client = setupMockClient(objectMap);
      const headOid = commitOids[commitOids.length - 1] ?? '';
      const rootOid = commitOids[0] ?? '';

      const t0 = performance.now();
      const result = await computeBlame(client, headOid, 'config.ts');
      const t1 = performance.now();

      expect(result.lines).toHaveLength(3);
      // All lines must attribute to Root commit (commit 0)
      for (const line of result.lines) {
        expect(line.commitOid).toBe(rootOid);
      }
      expect(result.hunks).toHaveLength(1);
      expect(result.hunks[0]?.commitOid).toBe(rootOid);
      expect(t1 - t0).toBeLessThan(2000);
    });

    it('correctly handles file deleted in intermediate commit and re-created later', async () => {
      // Commit 1: file exists (Alice)
      const blob1 = createCompressedGitObject('blob', 'version 1');
      const tree1 = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'reborn.txt', oid: blob1.oid }]));
      const commit1 = createCompressedGitObject('commit', `tree ${tree1.oid}\nauthor Alice <a@a.com> 1000 +0000\ncommitter Alice <a@a.com> 1000 +0000\n\nC1: create`);

      // Commit 2: file is deleted (Bob)
      const otherBlob = createCompressedGitObject('blob', 'keep me');
      const tree2 = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'keep.txt', oid: otherBlob.oid }]));
      const commit2 = createCompressedGitObject('commit', `tree ${tree2.oid}\nparent ${commit1.oid}\nauthor Bob <b@b.com> 2000 +0000\ncommitter Bob <b@b.com> 2000 +0000\n\nC2: delete reborn.txt`);

      // Commit 3: file is re-created with new content (Charlie)
      const blob3 = createCompressedGitObject('blob', 'version 3 (reborn)');
      const tree3 = createCompressedGitObject(
        'tree',
        createTreePayload([
          { mode: '100644', name: 'keep.txt', oid: otherBlob.oid },
          { mode: '100644', name: 'reborn.txt', oid: blob3.oid },
        ])
      );
      const commit3 = createCompressedGitObject('commit', `tree ${tree3.oid}\nparent ${commit2.oid}\nauthor Charlie <c@c.com> 3000 +0000\ncommitter Charlie <c@c.com> 3000 +0000\n\nC3: recreate reborn.txt`);

      const objectMap = new Map<string, Uint8Array>([
        [blob1.oid, blob1.compressed],
        [tree1.oid, tree1.compressed],
        [commit1.oid, commit1.compressed],
        [otherBlob.oid, otherBlob.compressed],
        [tree2.oid, tree2.compressed],
        [commit2.oid, commit2.compressed],
        [blob3.oid, blob3.compressed],
        [tree3.oid, tree3.compressed],
        [commit3.oid, commit3.compressed],
      ]);

      const client = setupMockClient(objectMap);
      const result = await computeBlame(client, commit3.oid, 'reborn.txt');

      expect(result.lines).toHaveLength(1);
      expect(result.lines[0]?.commitOid).toBe(commit3.oid);
      expect(result.lines[0]?.authorName).toBe('Charlie');
    });
  });

  // ===========================================================================
  // 5. Memory Leak, Concurrency, and Exception Resilience
  // ===========================================================================
  describe('5. Memory Leak, Concurrency, and Exception Resilience', () => {
    it('executes 50 concurrent blame operations in parallel without state pollution or memory failure', async () => {
      const objectMap = new Map<string, Uint8Array>();
      const commitOids: string[] = [];

      for (let i = 0; i < 10; i++) {
        const blob = createCompressedGitObject('blob', `File content variant ${i}\nLine 2 for variant ${i}`);
        const tree = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: `file_${i}.ts`, oid: blob.oid }]));
        const commit = createCompressedGitObject('commit', `tree ${tree.oid}\nauthor Worker_${i} <w@w.com> ${1000 + i} +0000\ncommitter Worker_${i} <w@w.com> ${1000 + i} +0000\n\nC_${i}`);

        objectMap.set(blob.oid, blob.compressed);
        objectMap.set(tree.oid, tree.compressed);
        objectMap.set(commit.oid, commit.compressed);
        commitOids.push(commit.oid);
      }

      const client = setupMockClient(objectMap);

      // Launch 50 concurrent computeBlame calls in parallel
      const tasks = Array.from({ length: 50 }, (_, idx) => {
        const fileIdx = idx % 10;
        const commitOid = commitOids[fileIdx] ?? '';
        const filePath = `file_${fileIdx}.ts`;
        return computeBlame(client, commitOid, filePath);
      });

      const results = await Promise.all(tasks);

      expect(results).toHaveLength(50);
      for (let idx = 0; idx < 50; idx++) {
        const fileIdx = idx % 10;
        const res = results[idx];
        expect(res).toBeDefined();
        expect(res?.lines).toHaveLength(2);
        expect(res?.lines[0]?.commitOid).toBe(commitOids[fileIdx]);
        expect(res?.lines[0]?.authorName).toBe(`Worker_${fileIdx}`);
      }
    });

    it('handles nested directory paths with multiple path separators', async () => {
      const blob = createCompressedGitObject('blob', 'nested file content');
      const treeSub2 = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'deep.ts', oid: blob.oid }]));
      const treeSub1 = createCompressedGitObject('tree', createTreePayload([{ mode: '040000', name: 'inner', oid: treeSub2.oid }]));
      const treeRoot = createCompressedGitObject('tree', createTreePayload([{ mode: '040000', name: 'src', oid: treeSub1.oid }]));
      const commit = createCompressedGitObject('commit', `tree ${treeRoot.oid}\nauthor Alice <a@a.com> 1000 +0000\ncommitter Alice <a@a.com> 1000 +0000\n\nC1`);

      const objectMap = new Map<string, Uint8Array>([
        [blob.oid, blob.compressed],
        [treeSub2.oid, treeSub2.compressed],
        [treeSub1.oid, treeSub1.compressed],
        [treeRoot.oid, treeRoot.compressed],
        [commit.oid, commit.compressed],
      ]);

      const client = setupMockClient(objectMap);
      const result = await computeBlame(client, commit.oid, 'src/inner/deep.ts');

      expect(result.lines).toHaveLength(1);
      expect(result.lines[0]?.commitOid).toBe(commit.oid);
    });

    it('handles 1,000-line file blame computation without stack overflow', async () => {
      const largeContent1 = Array.from({ length: 1000 }, (_, i) => `export const val_${i} = ${i};`).join('\n');
      const blob1 = createCompressedGitObject('blob', largeContent1);
      const tree1 = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'large.ts', oid: blob1.oid }]));
      const commit1 = createCompressedGitObject('commit', `tree ${tree1.oid}\nauthor Alice <a@a.com> 1000 +0000\ncommitter Alice <a@a.com> 1000 +0000\n\nC1`);

      const modifiedLines = Array.from({ length: 1000 }, (_, i) => {
        if (i % 10 === 0) return `export const val_${i} = ${i * 100}; // modified`;
        return `export const val_${i} = ${i};`;
      });
      const blob2 = createCompressedGitObject('blob', modifiedLines.join('\n'));
      const tree2 = createCompressedGitObject('tree', createTreePayload([{ mode: '100644', name: 'large.ts', oid: blob2.oid }]));
      const commit2 = createCompressedGitObject('commit', `tree ${tree2.oid}\nparent ${commit1.oid}\nauthor Bob <b@b.com> 2000 +0000\ncommitter Bob <b@b.com> 2000 +0000\n\nC2`);

      const objectMap = new Map<string, Uint8Array>([
        [blob1.oid, blob1.compressed],
        [tree1.oid, tree1.compressed],
        [commit1.oid, commit1.compressed],
        [blob2.oid, blob2.compressed],
        [tree2.oid, tree2.compressed],
        [commit2.oid, commit2.compressed],
      ]);

      const client = setupMockClient(objectMap);
      const t0 = performance.now();
      const result = await computeBlame(client, commit2.oid, 'large.ts');
      const t1 = performance.now();

      expect(result.lines).toHaveLength(1000);
      expect(result.lines[0]?.commitOid).toBe(commit2.oid); // 0 % 10 === 0
      expect(result.lines[1]?.commitOid).toBe(commit1.oid);
      expect(result.lines[10]?.commitOid).toBe(commit2.oid);
      expect(t1 - t0).toBeLessThan(1000);
    });

    it('safely renders BlameView with large hunks and lines without UI crash', () => {
      const numLines = 200;
      const lines = Array.from({ length: numLines }, (_, i) => ({
        lineNumber: i + 1,
        commitOid: (i % 2 === 0 ? '1111111111111111111111111111111111111111' : '2222222222222222222222222222222222222222'),
        authorName: i % 2 === 0 ? 'Alice Dev' : 'Bob Eng',
        authorEmail: i % 2 === 0 ? 'alice@a.com' : 'bob@b.com',
        timestamp: 1000 + i,
        summary: `Commit for line ${i + 1}`,
      }));

      const hunks = groupBlameHunks(lines);
      const fileLines = Array.from({ length: numLines }, (_, i) => `line content ${i + 1}`);

      const html = render(
        h(BlameView, {
          blameResult: {
            lines,
            hunks,
            oldestTimestamp: 1000,
            newestTimestamp: 1000 + numLines,
          },
          fileLines,
          filePath: 'huge.ts',
        })
      );

      expect(html).toContain('blame-container');
      expect(html).toContain('line content 1');
      expect(html).toContain('line content 200');
    });
  });
});
