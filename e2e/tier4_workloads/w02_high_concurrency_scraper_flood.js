/**
 * Tier 4 - Workload W2: High-Concurrency Zero-JS Scraper Flood
 * Executes 1,000 rapid concurrent GET requests against static endpoints under `sendforge serve`,
 * asserting zero dropped connections, 100% success rate, and fast TTFB latency.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { SendforgeHttpClient } from '../harness/http_client.js';

describe('Tier 4 - Workload W2: High-Concurrency Scraper Flood (W2)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;
  let serverHandle;

  beforeEach(async () => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('w2-scraper.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });

    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work', 'main');
    gitHelper.commitFiles(workDir, {
      'README.md': '# Scraper Flood Benchmark\nHigh concurrency static test.',
      'src/lib.rs': 'pub fn heavy() {}'
    }, 'Init scraper repo');
    gitHelper.push(workDir, 'origin', 'main');

    serverHandle = await supervisor.startServer(bareRepo);
  });

  afterEach(async () => {
    if (serverHandle) await serverHandle.stop();
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('W2.1: Handles 1,000 concurrent zero-JS scraper requests with 0 drops', async () => {
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const endpoints = ['/', '/index.html', '/log.html', '/meta.json', '/info/refs'];

    const totalRequests = 1000;
    const concurrency = 50;

    const results = await client.flood(endpoints, totalRequests, concurrency);

    assert.strictEqual(results.total, totalRequests);
    assert.strictEqual(results.failed, 0, `Scraper flood had ${results.failed} failed requests out of ${totalRequests}`);
    assert.strictEqual(results.successful, totalRequests, '100% of requests must succeed');
    assert.ok(results.avgLatency < 500, `Average latency (${results.avgLatency}ms) should be under 500ms`);
  });
});
