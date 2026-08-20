/**
 * Tier 4 - Workload W13: High-Concurrency Byte-Range Packfile Resolution (W13)
 *
 * Validates:
 * 1. 50 concurrent byte-range HTTP requests fetching packed objects with 0 failures
 */

import { describe, it, assert, beforeAll, afterAll } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { Supervisor } from '../harness/supervisor.js';
import { HttpClient } from '../harness/http_client.js';
import { PackIndexParser } from '../harness/pack_helper.js';
import fs from 'node:fs';
import path from 'node:path';

describe('Tier 4 - Workload W13: High-Concurrency Packfile Fetching (W13)', () => {
  let gitHelper;
  let bareRepoPath;
  let supervisor;
  let serverPort;
  let client;

  beforeAll(async () => {
    gitHelper = new GitRepoHelper();
    bareRepoPath = gitHelper.createBareRepo('w13-concurrency.git');
    const work = gitHelper.createWorkingRepoAndInit(bareRepoPath, 'w13-work');

    const files = {};
    for (let i = 0; i < 20; i++) {
      files[`src/file_${i}.txt`] = `Content for file ${i} with payload padding.`;
    }
    gitHelper.commitFiles(work, files, 'Add 20 packed files');
    gitHelper.push(work, 'origin', 'main');

    gitHelper.git(bareRepoPath, ['repack', '-a', '-d']);
    gitHelper.git(bareRepoPath, ['update-server-info']);

    supervisor = new Supervisor();
    serverPort = 19443;
    await supervisor.startServer(bareRepoPath, { port: serverPort });
    client = new HttpClient(`http://127.0.0.1:${serverPort}`);
  });

  afterAll(async () => {
    if (supervisor) supervisor.cleanup();
    if (gitHelper) gitHelper.cleanup();
  });

  it('W13.1: 50 concurrent byte-range requests fetching packed objects simultaneously', async () => {
    const packDir = path.join(bareRepoPath, 'objects', 'pack');
    const idxName = fs.readdirSync(packDir).find(f => f.endsWith('.idx'));
    const packName = fs.readdirSync(packDir).find(f => f.endsWith('.pack'));
    const packSize = fs.statSync(path.join(packDir, packName)).size;

    const idxBuf = fs.readFileSync(path.join(packDir, idxName));
    const parsedIdx = PackIndexParser.parse(idxBuf);
    const sortedOffsets = parsedIdx.getSortedOffsets();

    // Spawn 50 concurrent requests
    const promises = [];
    for (let i = 0; i < 50; i++) {
      const targetOff = sortedOffsets[i % sortedOffsets.length];
      const endOff = Math.min(targetOff + 100, packSize - 1);

      promises.push(
        client.request(`/objects/pack/${packName}`, {
          headers: { 'Range': `bytes=${targetOff}-${endOff}` }
        })
      );
    }

    const results = await Promise.all(promises);
    for (const res of results) {
      assert.strictEqual(res.status, 206, 'Each range request must return HTTP 206');
      assert.greaterThan(res.body.length, 0, 'Each range response must have payload');
    }
  });
});
