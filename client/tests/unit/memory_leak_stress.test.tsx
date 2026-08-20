// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { App } from '../../src/ui/App.js';
import { GitRepositoryClient } from '../../src/engine/fetcher.js';
import type { GitBlobObject, GitCommitObject, GitTreeObject, RepoMeta } from '../../src/engine/types.js';
import { createCompressedGitObject } from '../fixtures.js';

describe('Automated Memory Leak & Heap Stability Stress Harness', () => {
  const sampleMeta: RepoMeta = {
    name: 'leak-test-repo',
    description: 'Memory leak testing repository',
    default_branch: 'main',
    branches: [
      { name: 'main', target: '1111111111111111111111111111111111111111', is_default: true },
      { name: 'feature', target: '2222222222222222222222222222222222222222', is_default: false },
    ],
    tags: [],
    head: { ref: 'refs/heads/main', sha: '1111111111111111111111111111111111111111' },
    stats: { commit_count: 10, branch_count: 2, tag_count: 0 },
    has_readme: true,
    readme_filename: 'README.md',
    updated_at: '2026-08-20T00:00:00Z',
  };

  const sampleCommit: GitCommitObject = {
    type: 'commit',
    oid: '1111111111111111111111111111111111111111',
    tree: '3333333333333333333333333333333333333333',
    size: 200,
    parents: [],
    author: { name: 'Tester', email: 'tester@test.com', timestamp: 1700000000, tzOffset: '+0000' },
    committer: { name: 'Tester', email: 'tester@test.com', timestamp: 1700000000, tzOffset: '+0000' },
    message: 'Initial test commit',
    subject: 'Initial test commit',
    body: '',
  };

  const sampleTree: GitTreeObject = {
    type: 'tree',
    oid: '3333333333333333333333333333333333333333',
    size: 120,
    entries: [
      { mode: '100644', name: 'README.md', oid: '4444444444444444444444444444444444444444', isTree: false, isSubmodule: false, isSymlink: false },
      { mode: '040000', name: 'src', oid: '5555555555555555555555555555555555555555', isTree: true, isSubmodule: false, isSymlink: false },
    ],
  };

  const sampleBlob: GitBlobObject = {
    type: 'blob',
    oid: '4444444444444444444444444444444444444444',
    size: 100,
    data: new Uint8Array(100),
    isBinary: false,
    text: '# Leak Test\n\nTesting memory stability under rapid navigation.\n',
  };

  it('verifies GitRepositoryClient LRU cache adheres to strict maximum capacity without unbounded growth', async () => {
    const client = new GitRepositoryClient('https://example.com/repo.git', 50);

    // Pre-generate 100 compressed git objects
    const objects = new Map<string, Uint8Array>();
    for (let i = 0; i < 100; i++) {
      const obj = createCompressedGitObject('blob', `Content payload ${i}`);
      objects.set(obj.oid, obj.compressed);
    }

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const parts = url.split('/objects/')[1]?.split('/');
      const oid = `${parts?.[0] ?? ''}${parts?.[1] ?? ''}`;
      const data = objects.get(oid);
      if (data) {
        return Promise.resolve({
          ok: true,
          status: 200,
          arrayBuffer: () => Promise.resolve(data.buffer),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    // Fetch all 100 objects through the client
    for (const oid of objects.keys()) {
      await client.getObject(oid);
    }

    const internalCache = (client as unknown as { memoryCache: Map<string, unknown> }).memoryCache;

    // Strict assertion: cache size MUST be strictly capped at maxCacheSize (50)
    expect(internalCache.size).toBe(50);

    vi.unstubAllGlobals();
  });

  it('simulates 100 rapid component mount/unmount and navigation cycles without retaining detached state', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    // Mock global fetch for meta.json, pulls.json, issues.json
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('meta.json')) {
        return Promise.resolve(new Response(JSON.stringify(sampleMeta), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      if (url.includes('pulls.json') || url.includes('issues.json')) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      return Promise.resolve(new Response(new Uint8Array(), { status: 200 }));
    });

    const readmeEntry = sampleTree.entries[0];
    if (!readmeEntry) {
      throw new Error('Missing sample readme entry');
    }

    // Mock GitRepositoryClient methods
    vi.spyOn(GitRepositoryClient.prototype, 'getMeta').mockResolvedValue(sampleMeta);
    vi.spyOn(GitRepositoryClient.prototype, 'resolveRef').mockResolvedValue('1111111111111111111111111111111111111111');
    vi.spyOn(GitRepositoryClient.prototype, 'getCommit').mockResolvedValue(sampleCommit);
    vi.spyOn(GitRepositoryClient.prototype, 'getTree').mockResolvedValue(sampleTree);
    vi.spyOn(GitRepositoryClient.prototype, 'getBlob').mockResolvedValue(sampleBlob);
    vi.spyOn(GitRepositoryClient.prototype, 'listAllTreeFiles').mockResolvedValue([
      { path: 'README.md', entry: readmeEntry },
    ]);
    vi.spyOn(GitRepositoryClient.prototype, 'getCommitHistory').mockResolvedValue([sampleCommit]);

    const baselineHeap = process.memoryUsage().heapUsed;

    // Simulate 100 rapid route transitions and unmounts
    for (let cycle = 0; cycle < 100; cycle++) {
      window.location.hash = cycle % 4 === 0 ? '#/' : cycle % 4 === 1 ? '#/commits' : cycle % 4 === 2 ? '#/issues' : '#/pulls';
      render(h(App, { baseUrl: '' }), container);
      window.dispatchEvent(new Event('hashchange'));

      if (cycle % 10 === 0) {
        // Unmount
        render(null, container);
      }
    }

    // Clean unmount at end
    render(null, container);
    document.body.removeChild(container);

    const finalHeap = process.memoryUsage().heapUsed;
    const deltaBytes = finalHeap - baselineHeap;
    const deltaMb = deltaBytes / (1024 * 1024);

    // Assert that heap delta after 100 cycles is within tight bounds (< 15MB in test runner)
    expect(deltaMb).toBeLessThan(15);
    fetchSpy.mockRestore();
  });
});
