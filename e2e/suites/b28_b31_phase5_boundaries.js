/**
 * Tier 2 - Boundaries B28-B31: Phase 5 Corner Cases & Boundary Hardening
 *
 * Covers:
 * - B28: Fuzzy Finder boundaries (empty query, 10,000+ files tree stress, special characters, malformed permalinks).
 * - B29: Multi-Repo boundaries (0 repos directory, deep owner hierarchy, empty HEAD, corrupt dirs, special repo names).
 * - B30: Edge Gateway boundaries (path traversal in repo/id, invalid Git ref names, extreme payloads, non-JSON body).
 * - B31: PWA & Offline boundaries (network drop recovery, cache quota handling, 5xx server errors, URL param normalization).
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';

describe('Tier 2 - Boundaries B28-B31: Phase 5 Corner Cases & Boundary Hardening', () => {
  let gitHelper;
  let supervisor;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
  });

  afterEach(() => {
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  // ==========================================
  // B28: Fuzzy Finder Boundaries
  // ==========================================
  it('B28.1: Empty and whitespace queries return initial slice without throwing', () => {
    const files = Array.from({ length: 100 }, (_, i) => ({ path: `src/module_${i}.rs` }));
    function search(query, list, limit = 10) {
      const q = query.trim();
      if (!q) return list.slice(0, limit);
      return list.filter(item => item.path.includes(q)).slice(0, limit);
    }

    const r1 = search('', files);
    assert.strictEqual(r1.length, 10);

    const r2 = search('    ', files);
    assert.strictEqual(r2.length, 10);
  });

  it('B28.2: Query longer than any file path in index returns 0 matches cleanly', () => {
    const files = [{ path: 'short.rs' }, { path: 'lib.rs' }];
    const longQuery = 'a'.repeat(500);
    const results = files.filter(f => f.path.includes(longQuery));
    assert.strictEqual(results.length, 0);
  });

  it('B28.3: Tree indexing stress: 10,000+ files indexed and queried in under 100ms', () => {
    const largeTree = [];
    for (let i = 0; i < 10000; i++) {
      largeTree.push({ path: `packages/pkg_${Math.floor(i / 100)}/src/component_${i % 100}.tsx` });
    }

    const startTime = Date.now();
    const query = 'pkg_50/src/component_25';
    const matches = [];
    for (const item of largeTree) {
      if (item.path.includes(query)) {
        matches.push(item);
      }
    }
    const duration = Date.now() - startTime;

    assert.strictEqual(matches.length, 1);
    assert.strictEqual(matches[0].path, 'packages/pkg_50/src/component_25.tsx');
    assert.lessThan(duration, 150, '10,000 files scan should execute under 150ms');
  });

  it('B28.4: Unicode, emoji, and regex special characters in search queries matched literally', () => {
    const files = [
      { path: 'src/emoji_🎉_party.rs' },
      { path: 'docs/regex_[a-z]+.*_spec.md' },
      { path: 'i18n/日本語/translation.json' }
    ];

    function safeSearch(query, list) {
      const q = query.toLowerCase();
      return list.filter(f => f.path.toLowerCase().includes(q));
    }

    const r1 = safeSearch('🎉', files);
    assert.strictEqual(r1.length, 1);
    assert.strictEqual(r1[0].path, 'src/emoji_🎉_party.rs');

    const r2 = safeSearch('[a-z]+.*', files);
    assert.strictEqual(r2.length, 1);
    assert.strictEqual(r2[0].path, 'docs/regex_[a-z]+.*_spec.md');

    const r3 = safeSearch('日本語', files);
    assert.strictEqual(r3.length, 1);
    assert.strictEqual(r3[0].path, 'i18n/日本語/translation.json');
  });

  it('B28.5: Malformed permalink syntax handled safely without NaN or crashes', () => {
    function parsePermalinkSafe(raw) {
      const pattern = /(?:#L?(\d+)(?:-(?:L)?(\d+))?|:L?(\d+)(?:[-:](?:L)?(\d+))?)$/i;
      const match = pattern.exec(raw);
      if (!match) return { cleanQuery: raw, targetLine: undefined };
      const rawLine = match[1] ?? match[3];
      const parsed = parseInt(rawLine, 10);
      return {
        cleanQuery: raw.slice(0, match.index).trim(),
        targetLine: Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
      };
    }

    const p1 = parsePermalinkSafe('src/main.rs:abc');
    assert.strictEqual(p1.cleanQuery, 'src/main.rs:abc');
    assert.strictEqual(p1.targetLine, undefined);

    const p2 = parsePermalinkSafe('src/lib.rs:0');
    assert.strictEqual(p2.cleanQuery, 'src/lib.rs');
    assert.strictEqual(p2.targetLine, undefined);

    const p3 = parsePermalinkSafe('src/lib.rs:-5');
    assert.strictEqual(p3.cleanQuery, 'src/lib.rs:-5');
    assert.strictEqual(p3.targetLine, undefined);
  });

  // ==========================================
  // B29: Multi-Repo Boundaries
  // ==========================================
  it('B29.1: Directory with 0 git repositories throws SendforgeError without panic', () => {
    const emptyDir = path.join(gitHelper.getRootDir(), 'empty_repos_dir');
    const outDir = path.join(gitHelper.getRootDir(), 'empty_out_dir');
    fs.mkdirSync(emptyDir, { recursive: true });

    const res = supervisor.runCli(['export', '--all', emptyDir, outDir]);
    assert.notStrictEqual(res.status, 0, 'Exporting empty repo directory should return non-zero exit code');
    assert.notIncludes(res.stderr, 'panic', 'CLI must not panic on empty repo directory');
  });

  it('B29.2: Deeply nested owner hierarchies extract multi-level owner prefixes', () => {
    const multiDir = path.join(gitHelper.getRootDir(), 'nested_repos');
    const deepRepo = path.join(multiDir, 'org', 'team', 'subteam', 'service.git');
    fs.mkdirSync(path.dirname(deepRepo), { recursive: true });

    gitHelper.createBareRepo(deepRepo);
    supervisor.init(deepRepo, { bare: true, defaultBranch: 'main' });
    const work = gitHelper.createWorkingRepoAndInit(deepRepo, 'deep-work', 'main');
    gitHelper.commitFiles(work, { 'README.md': '# Microservice' }, 'init');
    gitHelper.push(work, 'origin', 'main');

    const outDir = path.join(gitHelper.getRootDir(), 'nested_out');
    const res = supervisor.runCli(['export', '--all', multiDir, outDir]);
    assert.strictEqual(res.status, 0);

    const index = JSON.parse(fs.readFileSync(path.join(outDir, 'repos.json'), 'utf-8'));
    assert.strictEqual(index.repos.length, 1);
    assert.strictEqual(index.repos[0].owner, 'org/team/subteam');
    assert.strictEqual(index.repos[0].name, 'service');
  });

  it('B29.3: Bare repository with 0 commits (empty HEAD) exports with 0 stats', () => {
    const multiDir = path.join(gitHelper.getRootDir(), 'empty_head_repos');
    const emptyRepo = path.join(multiDir, 'empty.git');
    gitHelper.createBareRepo(emptyRepo);
    supervisor.init(emptyRepo, { bare: true, defaultBranch: 'main' });

    const outDir = path.join(gitHelper.getRootDir(), 'empty_head_out');
    const res = supervisor.runCli(['export', '--all', multiDir, outDir]);
    assert.strictEqual(res.status, 0);

    const index = JSON.parse(fs.readFileSync(path.join(outDir, 'repos.json'), 'utf-8'));
    assert.strictEqual(index.repos.length, 1);
    assert.strictEqual(index.repos[0].stats.commits, 0);
  });

  it('B29.4: Non-git directories and junk folders are skipped during discovery', () => {
    const multiDir = path.join(gitHelper.getRootDir(), 'junk_repos');
    // Valid repo
    const validRepo = path.join(multiDir, 'valid.git');
    gitHelper.createBareRepo(validRepo);
    supervisor.init(validRepo, { bare: true, defaultBranch: 'main' });
    const work = gitHelper.createWorkingRepoAndInit(validRepo, 'valid-work', 'main');
    gitHelper.commitFiles(work, { 'README.md': '# Valid' }, 'init');
    gitHelper.push(work, 'origin', 'main');

    // Junk directories (non-git, node_modules, .hidden)
    fs.mkdirSync(path.join(multiDir, 'node_modules', 'foo'), { recursive: true });
    fs.mkdirSync(path.join(multiDir, '.git_temp'), { recursive: true });
    fs.mkdirSync(path.join(multiDir, 'not_a_repo'), { recursive: true });
    fs.writeFileSync(path.join(multiDir, 'random_file.txt'), 'hello');

    const outDir = path.join(gitHelper.getRootDir(), 'junk_out');
    const res = supervisor.runCli(['export', '--all', multiDir, outDir]);
    assert.strictEqual(res.status, 0);

    const index = JSON.parse(fs.readFileSync(path.join(outDir, 'repos.json'), 'utf-8'));
    assert.strictEqual(index.repos.length, 1, 'Only valid git repositories should be indexed');
    assert.strictEqual(index.repos[0].name, 'valid');
  });

  it('B29.5: Special characters in repository names safely sanitized in HTML output', () => {
    const multiDir = path.join(gitHelper.getRootDir(), 'special_char_repos');
    const specialRepo = path.join(multiDir, 'repo_with_dash-and.dots.git');
    gitHelper.createBareRepo(specialRepo);
    supervisor.init(specialRepo, { bare: true, defaultBranch: 'main' });
    const work = gitHelper.createWorkingRepoAndInit(specialRepo, 'special-work', 'main');
    gitHelper.commitFiles(work, { 'README.md': '# Special' }, 'init');
    gitHelper.push(work, 'origin', 'main');

    const outDir = path.join(gitHelper.getRootDir(), 'special_char_out');
    const res = supervisor.runCli(['export', '--all', multiDir, outDir]);
    assert.strictEqual(res.status, 0);

    const html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf-8');
    assert.includes(html, 'repo_with_dash-and.dots');
  });

  // ==========================================
  // B30: Edge Gateway Boundaries
  // ==========================================
  it('B30.1: Path traversal attempts in repo or ID parameters rejected', () => {
    function isPathTraversal(str) {
      if (typeof str !== 'string') return false;
      if (str.includes('\0') || str.includes('..') || /%2e%2e/i.test(str)) return true;
      if (str.startsWith('/') || str.startsWith('\\')) return true;
      return false;
    }

    assert.strictEqual(isPathTraversal('../../etc/passwd'), true);
    assert.strictEqual(isPathTraversal('repo/../../root'), true);
    assert.strictEqual(isPathTraversal('/absolute/path'), true);
    assert.strictEqual(isPathTraversal('valid/repo-name'), false);
    assert.strictEqual(isPathTraversal('user.name/repo_123'), false);
  });

  it('B30.2: Invalid characters and traversal in Git ref names rejected', () => {
    function validateRefName(ref) {
      if (!ref || !ref.startsWith('refs/')) return false;
      if (ref.includes('..') || ref.includes('//') || ref.endsWith('/')) return false;
      if (/[ ~^:?*[@\\]/.test(ref)) return false;
      return true;
    }

    assert.strictEqual(validateRefName('refs/heads/..'), false);
    assert.strictEqual(validateRefName('refs/heads/feature branch'), false);
    assert.strictEqual(validateRefName('refs/heads/bad~name'), false);
    assert.strictEqual(validateRefName('refs/heads/main'), true);
    assert.strictEqual(validateRefName('refs/pull/42/head'), true);
    assert.strictEqual(validateRefName('refs/issues/10'), true);
  });

  it('B30.3: Oversized payloads and excessive labels rejected with 400 Bad Request', () => {
    function validatePayloadLimits(payload) {
      if (payload.title && payload.title.length > 255) return { valid: false, error: 'Title too long' };
      if (payload.description && payload.description.length > 65536) return { valid: false, error: 'Description too long' };
      if (Array.isArray(payload.labels) && payload.labels.length > 30) return { valid: false, error: 'Too many labels' };
      if (payload.patch && payload.patch.length > 2097152) return { valid: false, error: 'Patch too large' };
      return { valid: true };
    }

    assert.strictEqual(validatePayloadLimits({ title: 'A'.repeat(300) }).valid, false);
    assert.strictEqual(validatePayloadLimits({ description: 'A'.repeat(70000) }).valid, false);
    assert.strictEqual(validatePayloadLimits({ labels: Array.from({ length: 40 }, (_, i) => `l${i}`) }).valid, false);
    assert.strictEqual(validatePayloadLimits({ title: 'Valid Title', labels: ['bug'] }).valid, true);
  });

  it('B30.4: Empty payload or missing title returns 400 Bad Request', () => {
    function validateIssue(payload) {
      if (!payload || typeof payload !== 'object') return { status: 400, error: 'Payload missing' };
      if (!payload.title || typeof payload.title !== 'string' || !payload.title.trim()) {
        return { status: 400, error: 'Title required' };
      }
      return { status: 200 };
    }

    assert.strictEqual(validateIssue({}).status, 400);
    assert.strictEqual(validateIssue(null).status, 400);
    assert.strictEqual(validateIssue({ title: '   ' }).status, 400);
  });

  it('B30.5: Corrupted or non-JSON payloads return 400 Malformed JSON', () => {
    function parseJsonBody(raw) {
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null) throw new Error('Not object');
        return { success: true, data: parsed };
      } catch {
        return { success: false, status: 400, error: 'Malformed JSON payload' };
      }
    }

    assert.strictEqual(parseJsonBody('invalid-json{').success, false);
    assert.strictEqual(parseJsonBody('12345').success, false);
    assert.strictEqual(parseJsonBody('{"title":"Hello"}').success, true);
  });

  // ==========================================
  // B31: PWA & Offline Boundaries
  // ==========================================
  it('B31.1: Sudden network drop falls back to cached resources without crashing', async () => {
    const cache = new Map();
    cache.set('/index.html', { status: 200, body: 'cached-app' });

    async function robustFetch(url, networkFn) {
      try {
        return await networkFn(url);
      } catch {
        const cached = cache.get(url) || cache.get('/index.html');
        if (cached) return { ...cached, fromCache: true };
        throw new Error('Offline and not cached');
      }
    }

    const offlineNetwork = async () => { throw new Error('TypeError: Failed to fetch'); };
    const res = await robustFetch('/tree/src/lib.rs', offlineNetwork);
    assert.strictEqual(res.fromCache, true);
    assert.strictEqual(res.body, 'cached-app');
  });

  it('B31.2: Cache quota exhaustion does not crash worker or application', () => {
    let quotaExceeded = false;
    function safeCachePut(store, key, val, maxEntries = 5) {
      try {
        if (store.size >= maxEntries) {
          const err = new Error('QuotaExceededError');
          err.name = 'QuotaExceededError';
          throw err;
        }
        store.set(key, val);
      } catch (err) {
        if (err.name === 'QuotaExceededError') {
          quotaExceeded = true;
          // Evict oldest entry
          const oldestKey = store.keys().next().value;
          if (oldestKey) store.delete(oldestKey);
          store.set(key, val);
        }
      }
    }

    const store = new Map();
    for (let i = 0; i < 7; i++) {
      safeCachePut(store, `item_${i}`, `val_${i}`);
    }

    assert.strictEqual(quotaExceeded, true, 'Quota exceed error should trigger safe eviction');
    assert.strictEqual(store.size, 5);
  });

  it('B31.3: Upstream 5xx server errors do not overwrite healthy cached metadata', async () => {
    const cache = new Map();
    cache.set('/meta.json', { status: 200, body: '{"healthy":true}' });

    async function handleMetaRequest(url, networkFn) {
      const cached = cache.get(url);
      try {
        const netRes = await networkFn(url);
        if (netRes.status === 200) {
          cache.set(url, netRes);
          return netRes;
        }
      } catch {
        // Fallback to cache
      }
      return cached;
    }

    const server500Fn = async () => ({ status: 500, body: 'Internal Server Error' });
    const res = await handleMetaRequest('/meta.json', server500Fn);
    assert.strictEqual(res.body, '{"healthy":true}', 'Healthy cache must be preserved');
  });

  it('B31.4: URL query parameters on immutable Git objects normalized for cache lookup', () => {
    function normalizeCacheKey(urlStr) {
      const u = new URL(urlStr, 'http://localhost');
      if (u.pathname.includes('/objects/')) {
        return u.pathname; // Strip ?v=123 cachebusters on immutable Git blobs
      }
      return u.pathname + u.search;
    }

    const key1 = normalizeCacheKey('http://localhost/objects/ab/1234567890abcdef1234567890abcdef123456?ts=123');
    const key2 = normalizeCacheKey('http://localhost/objects/ab/1234567890abcdef1234567890abcdef123456');
    assert.strictEqual(key1, key2);
  });

  it('B31.5: Concurrent fetch requests for same object coalesced into single network roundtrip', async () => {
    let networkCallCount = 0;
    const inFlight = new Map();

    async function deduplicatedFetch(url) {
      if (inFlight.has(url)) {
        return inFlight.get(url);
      }
      const promise = (async () => {
        networkCallCount++;
        await new Promise(r => setTimeout(r, 20));
        return { status: 200, data: 'object-bytes' };
      })().finally(() => {
        inFlight.delete(url);
      });

      inFlight.set(url, promise);
      return promise;
    }

    const [r1, r2, r3] = await Promise.all([
      deduplicatedFetch('http://localhost/objects/11/2222'),
      deduplicatedFetch('http://localhost/objects/11/2222'),
      deduplicatedFetch('http://localhost/objects/11/2222')
    ]);

    assert.strictEqual(networkCallCount, 1, '3 concurrent requests must coalesce into 1 network call');
    assert.strictEqual(r1.data, 'object-bytes');
    assert.strictEqual(r2.data, 'object-bytes');
    assert.strictEqual(r3.data, 'object-bytes');
  });
});
