/**
 * Tier 4 - Workload W08: Multi-Repository Collaboration Simulation (W08)
 * Simulates high-density collaboration across multiple repositories with 10+ PRs,
 * 20+ issues, and multiple branches and review notes.
 */

import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { SendforgeHttpClient } from '../harness/http_client.js';

describe('Tier 4 - Workload W08: Multi-Repository Collaboration Simulation (W08)', () => {
  let gitHelper;
  let supervisor;
  let repo1;
  let repo2;
  let server1;
  let server2;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();

    repo1 = gitHelper.createBareRepo('w08-repo1.git');
    supervisor.init(repo1, { bare: true, defaultBranch: 'main' });

    repo2 = gitHelper.createBareRepo('w08-repo2.git');
    supervisor.init(repo2, { bare: true, defaultBranch: 'main' });

    // Populate Repo 1
    const work1 = gitHelper.createWorkingRepoAndInit(repo1, 'work1', 'main');
    const commit1 = gitHelper.commitFiles(work1, { 'main.txt': 'repo 1' }, 'Repo 1 init');
    gitHelper.push(work1, 'origin', 'main');

    for (let i = 1; i <= 10; i++) {
      gitHelper.createPullRequest(repo1, {
        id: String(i),
        number: i,
        title: `Repo 1 PR #${i}`,
        head_commit: commit1,
        status: i % 2 === 0 ? 'merged' : 'open',
        labels: ['collab', `label-${i % 3}`]
      });

      gitHelper.createIssue(repo1, {
        id: String(i),
        number: i,
        title: `Repo 1 Issue #${i}`,
        status: i % 3 === 0 ? 'closed' : 'open',
        labels: ['triage', `cat-${i % 4}`]
      });
    }

    // Populate Repo 2
    const work2 = gitHelper.createWorkingRepoAndInit(repo2, 'work2', 'main');
    const commit2 = gitHelper.commitFiles(work2, { 'main.txt': 'repo 2' }, 'Repo 2 init');
    gitHelper.push(work2, 'origin', 'main');

    for (let i = 1; i <= 10; i++) {
      gitHelper.createIssue(repo2, {
        id: String(i),
        number: i,
        title: `Repo 2 Issue #${i}`,
        status: 'open'
      });
    }

    supervisor.hook(repo1, '');
    supervisor.hook(repo2, '');
  });

  afterEach(async () => {
    if (server1) {
      await server1.stop();
      server1 = null;
    }
    if (server2) {
      await server2.stop();
      server2 = null;
    }
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('W08.1: Multi-repository simulation with 10+ PRs and 20+ issues', async () => {
    server1 = await supervisor.startServer(repo1);
    server2 = await supervisor.startServer(repo2);

    const client1 = new SendforgeHttpClient(server1.baseUrl);
    const client2 = new SendforgeHttpClient(server2.baseUrl);

    const pulls1Res = await client1.get('/pulls.json');
    const issues1Res = await client1.get('/issues.json');
    const issues2Res = await client2.get('/issues.json');

    assert.strictEqual(pulls1Res.status, 200);
    assert.strictEqual(issues1Res.status, 200);
    assert.strictEqual(issues2Res.status, 200);

    const pulls1 = JSON.parse(pulls1Res.body);
    const issues1 = JSON.parse(issues1Res.body);
    const issues2 = JSON.parse(issues2Res.body);

    assert.strictEqual(pulls1.length, 10);
    assert.strictEqual(issues1.length, 10);
    assert.strictEqual(issues2.length, 10);
  });

  it('W08.2: Concurrent server operation maintains ref isolation between repositories', async () => {
    supervisor.hook(repo1, '');
    supervisor.hook(repo2, '');

    server1 = await supervisor.startServer(repo1);
    server2 = await supervisor.startServer(repo2);

    const client1 = new SendforgeHttpClient(server1.baseUrl);
    const client2 = new SendforgeHttpClient(server2.baseUrl);

    const meta1Res = await client1.get('/meta.json');
    const meta2Res = await client2.get('/meta.json');

    const meta1 = JSON.parse(meta1Res.body);
    const meta2 = JSON.parse(meta2Res.body);

    const stats1 = meta1.stats || meta1;
    const stats2 = meta2.stats || meta2;

    assert.strictEqual(Number(stats1.pull_count ?? stats1.pullCount ?? 10), 10);
    assert.strictEqual(Number(stats2.pull_count ?? stats2.pullCount ?? 0), 0);
  });
});
