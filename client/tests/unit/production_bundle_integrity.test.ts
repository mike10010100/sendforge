import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { isBinaryPath, computeTreeDiff, computeTreeFullDiff } from '../../src/worker/diff-algo.js';
import type { GitRepositoryClient } from '../../src/engine/fetcher.js';
import type { GitBlobObject, GitCommitObject, GitTreeEntry, GitTreeObject } from '../../src/engine/types.js';

describe('Production Bundle & Architectural Integrity Gates', () => {
  const distDir = resolve(process.cwd(), 'dist');
  const assetsDir = resolve(distDir, 'assets');

  it('verifies production build exists or can be validated for worker recursion', () => {
    if (!existsSync(assetsDir)) {
      // If not yet built in dev run, skip disk check
      return;
    }

    const files = readdirSync(assetsDir);
    const workerFiles = files.filter((f) => f.startsWith('diff.worker-') && f.endsWith('.js'));

    for (const workerFile of workerFiles) {
      const code = readFileSync(resolve(assetsDir, workerFile), 'utf-8');
      // A Web Worker bundle must never attempt to instantiate new Worker(self.location.href) or new Worker(...) without a main window guard
      const hasUnguardedWorkerCreation =
        code.includes('new Worker(self.location.href') ||
        (code.includes('new Worker(') && !code.includes('typeof window'));

      expect(
        hasUnguardedWorkerCreation,
        `Worker bundle ${workerFile} contains an un-guarded worker creation that could cause recursive fork-bombs!`
      ).toBe(false);
    }
  });

  it('guarantees isBinaryPath identifies binary assets and git objects without disk/network I/O', () => {
    expect(isBinaryPath('image.png')).toBe(true);
    expect(isBinaryPath('archive.zip')).toBe(true);
    expect(isBinaryPath('wasm_module.wasm')).toBe(true);
    expect(isBinaryPath('font.woff2')).toBe(true);
    expect(isBinaryPath('public-dist/objects/4e/3405bb529524d3ec5600e0091555d41ddd3722')).toBe(true);
    expect(isBinaryPath('objects/4e/3405bb529524d3ec5600e0091555d41ddd3722')).toBe(true);

    expect(isBinaryPath('src/main.rs')).toBe(false);
    expect(isBinaryPath('client/src/ui/App.tsx')).toBe(false);
    expect(isBinaryPath('README.md')).toBe(false);
    expect(isBinaryPath('Cargo.toml')).toBe(false);
  });

  it('guarantees computeTreeDiff NEVER executes blob fetches during tree diff traversal', async () => {
    let getBlobCallCount = 0;

    const mockClient = {
      getCommit: (sha: string): Promise<GitCommitObject> =>
        Promise.resolve({
          type: 'commit',
          oid: sha,
          size: 200,
          tree: `tree_${sha}`,
          parents: [],
          author: { name: 'Test', email: 'test@example.com', timestamp: 1000, tzOffset: '+0000' },
          committer: { name: 'Test', email: 'test@example.com', timestamp: 1000, tzOffset: '+0000' },
          message: 'Test Commit',
          subject: 'Test Commit',
          body: '',
        }),
      getTree: (oid: string): Promise<GitTreeObject> => {
        // Return a tree with 1,000 files
        const entries: GitTreeEntry[] = [];
        for (let i = 0; i < 1000; i++) {
          entries.push({
            mode: '100644',
            name: `file_${String(i)}.ts`,
            oid: `blob_${oid}_${String(i)}`,
            isTree: false,
            isSubmodule: false,
            isSymlink: false,
          });
        }
        return Promise.resolve({ type: 'tree', oid, size: 5000, entries });
      },
      getBlob: (_oid: string): Promise<GitBlobObject> => {
        getBlobCallCount++;
        return Promise.resolve({
          type: 'blob',
          oid: _oid,
          data: new Uint8Array([104, 101, 108, 108, 111]),
          text: 'hello',
          isBinary: false,
          size: 5,
        });
      },
    } as unknown as GitRepositoryClient;

    const summaries = await computeTreeDiff(mockClient, 'commit_1', 'commit_2');

    expect(summaries.length).toBe(1000);
    // Crucial architectural contract: computeTreeDiff must make ZERO blob network calls
    expect(getBlobCallCount).toBe(0);
  });

  it('throttles concurrent blob fetches in computeTreeFullDiff to prevent network exhaustion', async () => {
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const mockClient = {
      getCommit: (sha: string): Promise<GitCommitObject> =>
        Promise.resolve({
          type: 'commit',
          oid: sha,
          size: 200,
          tree: `tree_${sha}`,
          parents: [],
          author: { name: 'Test', email: 'test@example.com', timestamp: 1000, tzOffset: '+0000' },
          committer: { name: 'Test', email: 'test@example.com', timestamp: 1000, tzOffset: '+0000' },
          message: 'Test',
          subject: 'Test',
          body: '',
        }),
      getTree: (oid: string): Promise<GitTreeObject> => {
        const entries: GitTreeEntry[] = [];
        for (let i = 0; i < 100; i++) {
          entries.push({
            mode: '100644',
            name: `file_${String(i)}.ts`,
            oid: `blob_${oid}_${String(i)}`,
            isTree: false,
            isSubmodule: false,
            isSymlink: false,
          });
        }
        return Promise.resolve({ type: 'tree', oid, size: 500, entries });
      },
      getBlob: async (_oid: string): Promise<GitBlobObject> => {
        currentConcurrent++;
        if (currentConcurrent > maxConcurrent) {
          maxConcurrent = currentConcurrent;
        }
        // Small delay to simulate async network latency
        await new Promise((r) => setTimeout(r, 5));
        currentConcurrent--;
        return {
          type: 'blob',
          oid: _oid,
          data: new Uint8Array([104, 101, 108, 108, 111]),
          text: 'hello',
          isBinary: false,
          size: 5,
        };
      },
    } as unknown as GitRepositoryClient;

    const diffs = await computeTreeFullDiff(mockClient, 'sha_a', 'sha_b');
    expect(diffs.length).toBe(100);
    // Max concurrency must never exceed the safety limit (12)
    expect(maxConcurrent).toBeLessThanOrEqual(12);
  });
});
