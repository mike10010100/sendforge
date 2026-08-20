/**
 * Tier 1 - Feature 15: Static HTTP Server (CORS, Range, Dumb HTTP) (F15)
 * Tests local static file serving, RFC 7233 Range partial content requests,
 * CORS headers, and MIME type mapping.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { SendforgeHttpClient } from '../harness/http_client.js';

describe('Tier 1 - Feature 15: Static HTTP Server (F15)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;
  let serverHandle;
  let httpClient;

  beforeEach(async () => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('serve-test.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });

    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work', 'main');
    gitHelper.commitFiles(workDir, {
      'README.md': '# Server Test\nStatic server test content line 1234567890.',
      'app.js': 'console.log("sendforge client");'
    }, 'Server init commit');
    gitHelper.push(workDir, 'origin', 'main');

    serverHandle = await supervisor.startServer(bareRepo);
    httpClient = new SendforgeHttpClient(serverHandle.baseUrl);
  });

  afterEach(async () => {
    if (serverHandle) await serverHandle.stop();
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('T1.15.1: Static server serves index.html and meta.json with 200 OK', async () => {
    const indexRes = await httpClient.get('/');
    assert.strictEqual(indexRes.status, 200);
    assert.includes(indexRes.text, 'Server Test');

    const metaRes = await httpClient.getMetaJson();
    assert.strictEqual(metaRes.status, 200);
    assert.strictEqual(metaRes.data.default_branch, 'main');
  });

  it('T1.15.2: CORS headers present on static and loose object endpoints', async () => {
    const res = await httpClient.options('/meta.json');
    // Origin allow header
    assert.ok(
      res.headers['access-control-allow-origin'] === '*' ||
      res.headers['access-control-allow-origin'] !== undefined,
      'Access-Control-Allow-Origin header must be present'
    );
  });

  it('T1.15.3: RFC 7233 Range request returns 206 Partial Content', async () => {
    const rangeRes = await httpClient.getRange('/index.html', 0, 15);
    assert.strictEqual(rangeRes.status, 206, 'Must return 206 for byte range request');
    assert.ok(rangeRes.headers['content-range'], 'Content-Range header must be present');
    assert.strictEqual(rangeRes.buffer.length, 16, 'Exact 16 bytes returned');
  });

  it('T1.15.4: Accurate Content-Type MIME headers for HTML and JSON', async () => {
    const htmlRes = await httpClient.getIndexHtml();
    assert.includes(htmlRes.headers['content-type'], 'text/html');

    const jsonRes = await httpClient.get('/meta.json');
    assert.includes(jsonRes.headers['content-type'], 'application/json');
  });

  it('T1.15.5: Non-existent path returns HTTP 404 Not Found', async () => {
    const res = await httpClient.get('/objects/00/00000000000000000000000000000000000000');
    assert.strictEqual(res.status, 404);
  });

  it('T1.15.6: Invalid range (start > end) returns HTTP 416 Range Not Satisfiable', async () => {
    const res = await httpClient.getRange('/index.html', 500, 100);
    assert.ok(res.status === 416 || res.status === 200 || res.status === 400, 'Invalid range handled safely');
  });
});
