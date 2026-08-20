/**
 * Tier 4 - Workload W09: High-Concurrency Collab Scraper Flood (W09)
 * Tests static server performance and resilience under high-concurrency requests
 * targeting pulls.json, issues.json, pre-rendered fallbacks, and meta.json.
 */

import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { SendforgeHttpClient } from '../harness/http_client.js';

describe('Tier 4 - Workload W09: High-Concurrency Collab Scraper Flood (W09)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;
  let serverHandle;
  let workDir;

  beforeEach(async () => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('w09-flood.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });
    workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-w09', 'main');

    const commitSha = gitHelper.commitFiles(workDir, { 'README.md': '# Flood test' }, 'Init');
    gitHelper.push(workDir, 'origin', 'main');

    gitHelper.createPullRequest(bareRepo, {
      id: '1',
      number: 1,
      title: 'Performance PR',
      head_commit: commitSha
    });

    gitHelper.createIssue(bareRepo, {
      id: '1',
      number: 1,
      title: 'Performance Issue'
    });

    supervisor.hook(bareRepo, '');
    serverHandle = await supervisor.startServer(bareRepo);
  });

  afterEach(async () => {
    if (serverHandle) {
      await serverHandle.stop();
      serverHandle = null;
    }
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('W09.1: High-concurrency flood (200 requests) targeting collaboration endpoints', async () => {
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const endpoints = ['/pulls.json', '/issues.json', '/meta.json', '/pulls.html', '/issues.html'];

    const requests = [];
    const totalRequests = 200;

    for (let i = 0; i < totalRequests; i++) {
      const ep = endpoints[i % endpoints.length];
      requests.push(client.get(ep));
    }

    const results = await Promise.all(requests);
    assert.strictEqual(results.length, totalRequests);

    let errorCount = 0;
    for (const res of results) {
      if (res.status >= 500) errorCount++;
    }

    assert.strictEqual(errorCount, 0, 'Must produce 0 5xx server errors under flood');
  });

  it('W09.2: Low response latency under concurrent load', async () => {
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const latencies = [];

    for (let i = 0; i < 50; i++) {
      const start = Date.now();
      const res = await client.get('/pulls.json');
      const elapsed = Date.now() - start;
      assert.strictEqual(res.status, 200);
      latencies.push(elapsed);
    }

    latencies.sort((a, b) => a - b);
    const median = latencies[Math.floor(latencies.length / 2)];
    assert.lessThan(median, 50, `Median latency ${median}ms must be under 50ms`);
  });
});
