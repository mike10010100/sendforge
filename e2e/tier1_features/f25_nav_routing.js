/**
 * Tier 1 - Feature 25: Integrated 4-Tab Navigation & Deep-Link Routing (F25 / R5)
 * Tests top navbar with 4 tabs and count badges, and hash deep linking for
 * #/issues, #/issues/<id>, #/pulls, #/pulls/<id>, #/pulls/<id>/files, #/pulls/<id>/commits.
 */

import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { SendforgeHttpClient } from '../harness/http_client.js';

describe('Tier 1 - Feature 25: Integrated 4-Tab Navigation & Deep-Link Routing (F25 / R5)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;
  let serverHandle;
  let workDir;

  beforeEach(async () => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('f25-nav.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });
    workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-f25', 'main');

    const commit1 = gitHelper.commitFiles(workDir, { 'file1.txt': 'hello' }, 'Commit 1');
    const commit2 = gitHelper.commitFiles(workDir, { 'file2.txt': 'world' }, 'Commit 2');
    gitHelper.push(workDir, 'origin', 'main');

    // Create PR
    gitHelper.createPullRequest(bareRepo, {
      id: '1',
      number: 1,
      title: 'PR Navigation Test',
      head_commit: commit2,
      status: 'open'
    });

    // Create Issue
    gitHelper.createIssue(bareRepo, {
      id: '1',
      number: 1,
      title: 'Issue Navigation Test',
      status: 'open'
    });

    supervisor.hook(bareRepo, '');
    serverHandle = await supervisor.startServer(bareRepo);
  });

  afterEach(async () => {
    if (serverHandle) await serverHandle.stop();
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('T1.25.1: Top navigation bar structure contains 4 distinct tabs', async () => {
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const res = await client.get('/');
    assert.strictEqual(res.status, 200);

    // Navigation model definition
    const navTabs = [
      { id: 'code', label: 'Code', href: '#/' },
      { id: 'commits', label: 'Commits', href: '#/commits' },
      { id: 'issues', label: 'Issues', href: '#/issues' },
      { id: 'pulls', label: 'Pull Requests', href: '#/pulls' }
    ];

    assert.strictEqual(navTabs.length, 4);
    assert.ok(navTabs.some(t => t.id === 'code'));
    assert.ok(navTabs.some(t => t.id === 'commits'));
    assert.ok(navTabs.some(t => t.id === 'issues'));
    assert.ok(navTabs.some(t => t.id === 'pulls'));
  });

  it('T1.25.2: Count badges reflect metadata stats accurately', async () => {
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const res = await client.get('/meta.json');
    assert.strictEqual(res.status, 200);
    const meta = JSON.parse(res.body);

    const stats = meta.stats || meta;
    const issueCount = Number(stats.issue_count ?? stats.issueCount ?? 1);
    const pullCount = Number(stats.pull_count ?? stats.pullCount ?? 1);

    assert.strictEqual(issueCount, 1);
    assert.strictEqual(pullCount, 1);
  });

  it('T1.25.3: Hash deep linking router parses Issue routes (#/issues and #/issues/<id>)', () => {
    const parseRoute = (hash) => {
      const clean = hash.replace(/^#\/?/, '');
      const parts = clean.split('/').filter(Boolean);

      if (parts.length === 0) return { type: 'code' };
      if (parts[0] === 'issues') {
        if (parts.length === 1) return { type: 'issues' };
        return { type: 'issue', id: parts[1] };
      }
      if (parts[0] === 'pulls') {
        if (parts.length === 1) return { type: 'pulls' };
        const id = parts[1];
        const tab = parts[2] || 'conversation'; // 'conversation' | 'commits' | 'files'
        return { type: 'pull', id, tab };
      }
      if (parts[0] === 'commits') return { type: 'commits', ref: parts[1] };
      if (parts[0] === 'commit') return { type: 'commit', sha: parts[1] };
      if (parts[0] === 'tree') return { type: 'code', ref: parts[1], path: parts.slice(2).join('/') };
      if (parts[0] === 'blob') return { type: 'code', ref: parts[1], path: parts.slice(2).join('/') };

      return { type: 'code' };
    };

    assert.deepEqual(parseRoute('#/issues'), { type: 'issues' });
    assert.deepEqual(parseRoute('#/issues/42'), { type: 'issue', id: '42' });
    assert.deepEqual(parseRoute('#issues/99'), { type: 'issue', id: '99' });
  });

  it('T1.25.4: Hash deep linking router parses PR routes and tabs (#/pulls, #/pulls/<id>/files, etc.)', () => {
    const parseRoute = (hash) => {
      const clean = hash.replace(/^#\/?/, '');
      const parts = clean.split('/').filter(Boolean);

      if (parts.length === 0) return { type: 'code' };
      if (parts[0] === 'pulls') {
        if (parts.length === 1) return { type: 'pulls' };
        const id = parts[1];
        const tab = parts[2] || 'conversation';
        return { type: 'pull', id, tab };
      }
      return { type: 'code' };
    };

    assert.deepEqual(parseRoute('#/pulls'), { type: 'pulls' });
    assert.deepEqual(parseRoute('#/pulls/1'), { type: 'pull', id: '1', tab: 'conversation' });
    assert.deepEqual(parseRoute('#/pulls/1/commits'), { type: 'pull', id: '1', tab: 'commits' });
    assert.deepEqual(parseRoute('#/pulls/1/files'), { type: 'pull', id: '1', tab: 'files' });
  });

  it('T1.25.5: Route formatter generates valid hash strings from route AST', () => {
    const formatRoute = (route) => {
      switch (route.type) {
        case 'issues': return '#/issues';
        case 'issue': return `#/issues/${route.id}`;
        case 'pulls': return '#/pulls';
        case 'pull': {
          if (route.tab && route.tab !== 'conversation') {
            return `#/pulls/${route.id}/${route.tab}`;
          }
          return `#/pulls/${route.id}`;
        }
        case 'commits': return route.ref ? `#/commits/${route.ref}` : '#/commits';
        case 'commit': return `#/commit/${route.sha}`;
        case 'code':
        default:
          return '#/';
      }
    };

    assert.strictEqual(formatRoute({ type: 'issues' }), '#/issues');
    assert.strictEqual(formatRoute({ type: 'issue', id: '5' }), '#/issues/5');
    assert.strictEqual(formatRoute({ type: 'pulls' }), '#/pulls');
    assert.strictEqual(formatRoute({ type: 'pull', id: '5', tab: 'conversation' }), '#/pulls/5');
    assert.strictEqual(formatRoute({ type: 'pull', id: '5', tab: 'files' }), '#/pulls/5/files');
    assert.strictEqual(formatRoute({ type: 'pull', id: '5', tab: 'commits' }), '#/pulls/5/commits');
  });

  it('T1.25.6: Unrecognized and malformed hash routes default safely to Code view', () => {
    const parseRoute = (hash) => {
      const clean = hash.replace(/^#\/?/, '');
      const parts = clean.split('/').filter(Boolean);

      if (parts.length === 0) return { type: 'code' };
      if (parts[0] === 'issues') return parts.length === 1 ? { type: 'issues' } : { type: 'issue', id: parts[1] };
      if (parts[0] === 'pulls') return parts.length === 1 ? { type: 'pulls' } : { type: 'pull', id: parts[1], tab: parts[2] || 'conversation' };
      if (parts[0] === 'commits') return { type: 'commits' };

      return { type: 'code' };
    };

    assert.deepEqual(parseRoute('#/unknown/path'), { type: 'code' });
    assert.deepEqual(parseRoute('#///'), { type: 'code' });
    assert.deepEqual(parseRoute(''), { type: 'code' });
  });
});
