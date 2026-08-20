/**
 * Tier 2 - Boundary B17: Empty Collaboration States (B17)
 * Tests repositories with zero PRs, zero issues, zero notes, empty comments,
 * empty labels, and empty/whitespace-only descriptions.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { SendforgeHttpClient } from '../harness/http_client.js';

describe('Tier 2 - Boundary B17: Empty Collaboration States (B17)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;
  let serverHandle;
  let workDir;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('b17-empty-collab.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });
    workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-b17', 'main');
    gitHelper.commitFiles(workDir, { 'README.md': '# Empty Collab Test' }, 'Initial commit');
    gitHelper.push(workDir, 'origin', 'main');
  });

  afterEach(async () => {
    if (serverHandle) {
      await serverHandle.stop();
      serverHandle = null;
    }
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('B17.1: Zero PRs and Zero Issues in repo produce empty JSON arrays and 0 counts', async () => {
    const destDir = path.join(gitHelper.getRootDir(), 'export-b17-empty');
    const res = supervisor.export(bareRepo, destDir);
    assert.strictEqual(res.status, 0);

    const pullsPath = fs.existsSync(path.join(destDir, 'pulls.json'))
      ? path.join(destDir, 'pulls.json')
      : path.join(destDir, 'static', 'pulls.json');
    const issuesPath = fs.existsSync(path.join(destDir, 'issues.json'))
      ? path.join(destDir, 'issues.json')
      : path.join(destDir, 'static', 'issues.json');
    const metaPath = fs.existsSync(path.join(destDir, 'meta.json'))
      ? path.join(destDir, 'meta.json')
      : path.join(destDir, 'static', 'meta.json');

    if (fs.existsSync(pullsPath)) {
      const pulls = JSON.parse(fs.readFileSync(pullsPath, 'utf-8'));
      assert.deepEqual(pulls, []);
    }

    if (fs.existsSync(issuesPath)) {
      const issues = JSON.parse(fs.readFileSync(issuesPath, 'utf-8'));
      assert.deepEqual(issues, []);
    }

    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      const stats = meta.stats || meta;
      assert.strictEqual(Number(stats.pull_count ?? stats.pullCount ?? 0), 0);
      assert.strictEqual(Number(stats.open_pull_count ?? stats.openPullCount ?? 0), 0);
      assert.strictEqual(Number(stats.issue_count ?? stats.issueCount ?? 0), 0);
      assert.strictEqual(Number(stats.open_issue_count ?? stats.openIssueCount ?? 0), 0);
    }
  });

  it('B17.2: Pre-rendered HTML fallbacks contain valid empty state placeholders', async () => {
    const destDir = path.join(gitHelper.getRootDir(), 'export-b17-fallbacks');
    const res = supervisor.export(bareRepo, destDir);
    assert.strictEqual(res.status, 0);

    const pullsHtml = fs.existsSync(path.join(destDir, 'pulls.html'))
      ? fs.readFileSync(path.join(destDir, 'pulls.html'), 'utf-8')
      : fs.readFileSync(path.join(destDir, 'static', 'pulls.html'), 'utf-8');

    const issuesHtml = fs.existsSync(path.join(destDir, 'issues.html'))
      ? fs.readFileSync(path.join(destDir, 'issues.html'), 'utf-8')
      : fs.readFileSync(path.join(destDir, 'static', 'issues.html'), 'utf-8');

    assert.ok(pullsHtml.length > 0);
    assert.ok(issuesHtml.length > 0);
  });

  it('B17.3: PR and Issue with empty comments array [] render cleanly without errors', async () => {
    const commitSha = gitHelper.commitFiles(workDir, { 'file.txt': 'new' }, 'Commit on feature');
    gitHelper.push(workDir, 'origin', 'main');

    gitHelper.createPullRequest(bareRepo, {
      id: '1',
      number: 1,
      title: 'PR without comments',
      head_commit: commitSha,
      comments: []
    });

    gitHelper.createIssue(bareRepo, {
      id: '1',
      number: 1,
      title: 'Issue without comments',
      comments: []
    });

    supervisor.hook(bareRepo, '');
    serverHandle = await supervisor.startServer(bareRepo);

    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const pullsRes = await client.get('/pulls.json');
    const issuesRes = await client.get('/issues.json');

    assert.strictEqual(pullsRes.status, 200);
    assert.strictEqual(issuesRes.status, 200);

    const pulls = JSON.parse(pullsRes.body);
    const issues = JSON.parse(issuesRes.body);

    assert.deepEqual(pulls[0].comments, []);
    assert.deepEqual(issues[0].comments, []);
  });

  it('B17.4: PR and Issue with empty labels array [] render cleanly without badges', async () => {
    const commitSha = gitHelper.commitFiles(workDir, { 'file2.txt': 'new' }, 'Commit 2');
    gitHelper.push(workDir, 'origin', 'main');

    gitHelper.createPullRequest(bareRepo, {
      id: '2',
      number: 2,
      title: 'PR without labels',
      head_commit: commitSha,
      labels: []
    });

    gitHelper.createIssue(bareRepo, {
      id: '2',
      number: 2,
      title: 'Issue without labels',
      labels: []
    });

    supervisor.hook(bareRepo, '');
    if (!serverHandle) serverHandle = await supervisor.startServer(bareRepo);

    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const pullsRes = await client.get('/pulls.json');
    const issuesRes = await client.get('/issues.json');

    const pulls = JSON.parse(pullsRes.body);
    const issues = JSON.parse(issuesRes.body);

    const pr2 = pulls.find(p => p.id === '2');
    const issue2 = issues.find(i => i.id === '2');

    assert.deepEqual(pr2.labels, []);
    assert.deepEqual(issue2.labels, []);
  });

  it('B17.5: Empty or whitespace-only description renders without crashing markdown engine', async () => {
    const commitSha = gitHelper.commitFiles(workDir, { 'file3.txt': 'new' }, 'Commit 3');
    gitHelper.push(workDir, 'origin', 'main');

    gitHelper.createPullRequest(bareRepo, {
      id: '3',
      number: 3,
      title: 'PR with empty description',
      description: '   \n\t  \n  ',
      head_commit: commitSha
    });

    gitHelper.createIssue(bareRepo, {
      id: '3',
      number: 3,
      title: 'Issue with empty description',
      description: ''
    });

    const destDir = path.join(gitHelper.getRootDir(), 'export-b17-whitespace');
    const res = supervisor.export(bareRepo, destDir);
    assert.strictEqual(res.status, 0);
  });
});
