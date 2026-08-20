import { describe, expect, it, vi } from 'vitest';
import {
  GitRepositoryClient,
  ObjectNotFoundError,
  RefNotFoundError,
} from '../../src/engine/fetcher.js';
import { OidMismatchError } from '../../src/engine/parser.js';
import type { RepoMeta } from '../../src/engine/types.js';
import { createCompressedGitObject, createTreePayload } from '../fixtures.js';

describe('Git Repository Client & Fetcher', () => {
  it('fetches loose object, verifies SHA-1, and caches in memory', async () => {
    const textBlob = createCompressedGitObject('blob', 'Hello Sendforge!');
    const client = new GitRepositoryClient('https://example.com/repo.git');

    // Mock fetch
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(textBlob.compressed.buffer),
    });
    vi.stubGlobal('fetch', fetchMock);

    // First call fetches from network
    const obj1 = await client.getObject(textBlob.oid);
    expect(obj1.type).toBe('blob');
    if (obj1.type === 'blob') {
      expect(obj1.text).toBe('Hello Sendforge!');
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second call hits memory cache
    const obj2 = await client.getObject(textBlob.oid);
    expect(obj2).toBe(obj1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it('deduplicates in-flight requests for the same OID', async () => {
    const textBlob = createCompressedGitObject('blob', 'Deduplication test');
    const client = new GitRepositoryClient('https://example.com/repo.git');

    let resolveFetch: (val: unknown) => void = () => undefined;
    const fetchPromise = new Promise((res) => {
      resolveFetch = res;
    });

    const fetchMock = vi.fn().mockImplementation(() =>
      fetchPromise.then(() => ({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(textBlob.compressed.buffer),
      }))
    );
    vi.stubGlobal('fetch', fetchMock);

    // Fire 3 parallel requests for same OID
    const p1 = client.getObject(textBlob.oid);
    const p2 = client.getObject(textBlob.oid);
    const p3 = client.getObject(textBlob.oid);

    resolveFetch(true);

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it('throws ObjectNotFoundError on HTTP 404', async () => {
    const client = new GitRepositoryClient('https://example.com/repo.git');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      })
    );

    await expect(client.getObject('0000000000000000000000000000000000000000')).rejects.toThrow(
      ObjectNotFoundError
    );

    vi.unstubAllGlobals();
  });

  it('throws OidMismatchError if object content does not match OID', async () => {
    const textBlob = createCompressedGitObject('blob', 'Original content');
    const client = new GitRepositoryClient('https://example.com/repo.git');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(textBlob.compressed.buffer),
      })
    );

    // Request with different OID
    const fakeOid = 'ffffffffffffffffffffffffffffffffffffffff';
    await expect(client.getObject(fakeOid)).rejects.toThrow(OidMismatchError);

    vi.unstubAllGlobals();
  });

  it('recursively resolves paths through tree hierarchy', async () => {
    // File blob: src/utils/math.ts
    const mathBlob = createCompressedGitObject('blob', 'export const add = (a, b) => a + b;\n');

    // Subtree: src/utils
    const utilsPayload = createTreePayload([
      { mode: '100644', name: 'math.ts', oid: mathBlob.oid },
    ]);
    const utilsTree = createCompressedGitObject('tree', utilsPayload);

    // Subtree: src
    const srcPayload = createTreePayload([
      { mode: '040000', name: 'utils', oid: utilsTree.oid },
    ]);
    const srcTree = createCompressedGitObject('tree', srcPayload);

    // Root tree
    const rootPayload = createTreePayload([
      { mode: '040000', name: 'src', oid: srcTree.oid },
      { mode: '100644', name: 'README.md', oid: mathBlob.oid },
    ]);
    const rootTree = createCompressedGitObject('tree', rootPayload);

    const objectMap = new Map<string, Uint8Array>([
      [mathBlob.oid, mathBlob.compressed],
      [utilsTree.oid, utilsTree.compressed],
      [srcTree.oid, srcTree.compressed],
      [rootTree.oid, rootTree.compressed],
    ]);

    const client = new GitRepositoryClient('https://example.com/repo.git');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        const parts = url.split('/');
        const p1 = parts[parts.length - 2] ?? '';
        const p2 = parts[parts.length - 1] ?? '';
        const oid = p1 + p2;
        const data = objectMap.get(oid);
        if (data) {
          return Promise.resolve({
            ok: true,
            status: 200,
            arrayBuffer: () => Promise.resolve(data.buffer),
          });
        }
        return Promise.resolve({ ok: false, status: 404 });
      })
    );

    // Test path resolution
    const entry = await client.resolvePathToEntry(rootTree.oid, 'src/utils/math.ts');
    expect(entry).toBeDefined();
    expect(entry?.name).toBe('math.ts');
    expect(entry?.oid).toBe(mathBlob.oid);

    // Test non-existent path
    const nonExistent = await client.resolvePathToEntry(rootTree.oid, 'src/utils/missing.ts');
    expect(nonExistent).toBeNull();

    // Test list all files
    const allFiles = await client.listAllTreeFiles(rootTree.oid);
    expect(allFiles.map((f) => f.path)).toContain('src/utils/math.ts');
    expect(allFiles.map((f) => f.path)).toContain('README.md');

    vi.unstubAllGlobals();
  });

  it('peels annotated tag to underlying commit', async () => {
    const commit = createCompressedGitObject(
      'commit',
      'tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\nauthor A <a@a.com> 123 +0000\ncommitter A <a@a.com> 123 +0000\n\nMsg'
    );

    const tag = createCompressedGitObject(
      'tag',
      `object ${commit.oid}\ntype commit\ntag v1.0.0\n\nRelease notes`
    );

    const objectMap = new Map<string, Uint8Array>([
      [commit.oid, commit.compressed],
      [tag.oid, tag.compressed],
    ]);

    const client = new GitRepositoryClient('https://example.com/repo.git');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        const parts = url.split('/');
        const p1 = parts[parts.length - 2] ?? '';
        const p2 = parts[parts.length - 1] ?? '';
        const oid = p1 + p2;
        const data = objectMap.get(oid);
        if (data) {
          return Promise.resolve({
            ok: true,
            status: 200,
            arrayBuffer: () => Promise.resolve(data.buffer),
          });
        }
        return Promise.resolve({ ok: false, status: 404 });
      })
    );

    const peeled = await client.peelTag(tag.oid);
    expect(peeled.type).toBe('commit');
    expect(peeled.oid).toBe(commit.oid);

    vi.unstubAllGlobals();
  });

  it('resolves refs via meta.json and info/refs', async () => {
    const meta: RepoMeta = {
      name: 'test-repo',
      description: 'A test repository',
      default_branch: 'main',
      branches: [
        { name: 'main', target: '1111111111111111111111111111111111111111', is_default: true },
        { name: 'dev', target: '2222222222222222222222222222222222222222', is_default: false },
      ],
      tags: [
        {
          name: 'v1.0.0',
          target: '3333333333333333333333333333333333333333',
          is_annotated: true,
          peeled: '1111111111111111111111111111111111111111',
        },
      ],
      head: {
        ref: 'refs/heads/main',
        sha: '1111111111111111111111111111111111111111',
      },
      stats: {
        commit_count: 10,
        branch_count: 2,
        tag_count: 1,
      },
      has_readme: true,
      readme_filename: 'README.md',
      updated_at: '2026-08-19T00:00:00Z',
    };

    const client = new GitRepositoryClient('https://example.com/repo.git');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('meta.json')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(meta),
          });
        }
        return Promise.resolve({ ok: false, status: 404 });
      })
    );

    expect(await client.resolveRef('main')).toBe('1111111111111111111111111111111111111111');
    expect(await client.resolveRef('HEAD')).toBe('1111111111111111111111111111111111111111');
    expect(await client.resolveRef('dev')).toBe('2222222222222222222222222222222222222222');
    expect(await client.resolveRef('v1.0.0')).toBe('1111111111111111111111111111111111111111'); // returns peeled commit

    await expect(client.resolveRef('nonexistent-branch')).rejects.toThrow(RefNotFoundError);

    vi.unstubAllGlobals();
  });
});
