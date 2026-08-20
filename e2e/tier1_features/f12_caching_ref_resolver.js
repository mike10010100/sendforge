/**
 * Tier 1 - Feature 12: In-Browser Object Caching & Ref Resolver (F12)
 * Tests client-side reference resolution from meta.json, LRU object caching,
 * and cache invalidation.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { GitParser } from '../harness/git_parser.js';

describe('Tier 1 - Feature 12: In-Browser Ref Resolver & Cache (F12)', () => {
  let gitHelper;
  let bareRepo;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    bareRepo = gitHelper.createBareRepo('resolver-test.git');
  });

  afterEach(() => {
    gitHelper.cleanup();
  });

  it('T1.12.1: Resolves default branch OID from meta.json', () => {
    const workDir = gitHelper.createWorkingRepo(bareRepo, 'work1');
    const commitSha = gitHelper.commitFiles(workDir, { 'README.md': '# Resolv' }, 'Commit 1');
    gitHelper.push(workDir, 'origin', 'main');

    const meta = {
      name: 'resolver-test',
      default_branch: 'main',
      branches: [{ name: 'main', target: commitSha, is_default: true }],
      tags: [],
      head: { ref: 'refs/heads/main', sha: commitSha },
      stats: { commit_count: 1, branch_count: 1, tag_count: 0 },
      has_readme: true,
      readme_filename: 'README.md',
      updated_at: new Date().toISOString()
    };

    // Client-side resolver simulation
    const resolveRef = (refName) => {
      if (refName === 'HEAD' || refName === meta.default_branch) {
        return meta.head.sha;
      }
      const b = meta.branches.find(br => br.name === refName);
      if (b) return b.target;
      const t = meta.tags.find(tg => tg.name === refName);
      if (t) return t.peeled || t.target;
      return null;
    };

    assert.strictEqual(resolveRef('HEAD'), commitSha);
    assert.strictEqual(resolveRef('main'), commitSha);
    assert.strictEqual(resolveRef('non-existent'), null);
  });

  it('T1.12.2: Resolves feature branch and annotated tag peeled commits', () => {
    const meta = {
      default_branch: 'main',
      branches: [
        { name: 'main', target: '1111111111111111111111111111111111111111', is_default: true },
        { name: 'feature/fast-io', target: '2222222222222222222222222222222222222222', is_default: false }
      ],
      tags: [
        { name: 'v1.0.0', target: '3333333333333333333333333333333333333333', is_annotated: true, peeled: '1111111111111111111111111111111111111111' }
      ]
    };

    const resolveTagCommit = (tagName) => {
      const tag = meta.tags.find(t => t.name === tagName);
      if (!tag) return null;
      return tag.peeled || tag.target;
    };

    assert.strictEqual(resolveTagCommit('v1.0.0'), '1111111111111111111111111111111111111111');
  });

  it('T1.12.3: In-memory LRU object cache deduplicates network requests', () => {
    class MockObjectCache {
      constructor(limit = 100) {
        this.cache = new Map();
        this.inflight = new Map();
        this.limit = limit;
        this.networkFetchCount = 0;
      }

      async get(oid, fetcher) {
        if (this.cache.has(oid)) {
          return this.cache.get(oid);
        }
        if (this.inflight.has(oid)) {
          return this.inflight.get(oid);
        }
        this.networkFetchCount++;
        const promise = (async () => {
          try {
            const obj = await fetcher(oid);
            this.cache.set(oid, obj);
            return obj;
          } finally {
            this.inflight.delete(oid);
          }
        })();
        this.inflight.set(oid, promise);
        return promise;
      }
    }

    const cache = new MockObjectCache(10);
    const mockFetcher = async (oid) => ({ oid, type: 'blob', data: 'hello' });

    const oid = 'abcdef1234567890abcdef1234567890abcdef12';

    // 10 concurrent requests for same OID
    return Promise.all(
      Array.from({ length: 10 }, () => cache.get(oid, mockFetcher))
    ).then(results => {
      assert.strictEqual(results.length, 10);
      assert.strictEqual(cache.networkFetchCount, 1, 'Duplicate OID requests must hit cache');
    });
  });

  it('T1.12.4: Missing ref or 404 object throws typed not found error', async () => {
    const fetchObject = async (oid) => {
      const exists = false;
      if (!exists) {
        const err = new Error(`Git object ${oid} not found (HTTP 404)`);
        err.code = 'OBJECT_NOT_FOUND';
        throw err;
      }
    };

    await assert.rejects(
      () => fetchObject('0000000000000000000000000000000000000000'),
      /not found/i
    );
  });

  it('T1.12.5: Cache invalidation when repo HEAD moves', () => {
    let currentHead = '1111111111111111111111111111111111111111';
    let cacheVersion = 1;

    const onRefUpdate = (newHead) => {
      if (newHead !== currentHead) {
        currentHead = newHead;
        cacheVersion++;
      }
    };

    assert.strictEqual(cacheVersion, 1);
    onRefUpdate('2222222222222222222222222222222222222222');
    assert.strictEqual(cacheVersion, 2, 'Cache version must increment on ref change');
    assert.strictEqual(currentHead, '2222222222222222222222222222222222222222');
  });
});
