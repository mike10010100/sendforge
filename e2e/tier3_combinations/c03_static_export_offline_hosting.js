/**
 * Tier 3 - Combination C3: Static Site Export & Offline Hosting
 * Tests exporting repository to a standalone directory and serving it
 * using a generic static HTTP server (simulating Cloudflare Pages / S3 / Nginx).
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { SendforgeHttpClient } from '../harness/http_client.js';

describe('Tier 3 - Combination C3: Static Export & Offline Hosting (C3)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;
  let exportedDir;
  let genericServer;
  let genericPort;

  beforeEach(async () => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = path.join(gitHelper.getRootDir(), 'c3-export-src.git');
    exportedDir = path.join(gitHelper.getRootDir(), 'c3-export-dist');

    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work', 'main');
    gitHelper.commitFiles(workDir, {
      'README.md': '# Offline Hosted Sendforge\nZero compute static site.',
      'src/lib.rs': 'pub fn test() {}'
    }, 'Export test commit');
    gitHelper.push(workDir, 'origin', 'main');

    // Run export
    const exportRes = supervisor.export(bareRepo, exportedDir);
    assert.strictEqual(exportRes.status, 0);

    // Spin up generic static server pointing at exported directory
    genericPort = await supervisor.getFreePort();
    genericServer = http.createServer((req, res) => {
      let reqPath = req.url.split('?')[0];
      if (reqPath === '/') reqPath = '/index.html';
      const filePath = path.join(exportedDir, reqPath);

      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const content = fs.readFileSync(filePath);
        if (filePath.endsWith('.html')) res.setHeader('Content-Type', 'text/html; charset=utf-8');
        else if (filePath.endsWith('.json')) res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(content);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    await new Promise(resolve => genericServer.listen(genericPort, '127.0.0.1', resolve));
  });

  afterEach(async () => {
    if (genericServer) {
      await new Promise(resolve => genericServer.close(resolve));
    }
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('C3.1: Exported site functions 100% on a standard static HTTP server', async () => {
    const client = new SendforgeHttpClient(`http://127.0.0.1:${genericPort}`);

    // Verify index.html
    const indexRes = await client.getIndexHtml();
    assert.strictEqual(indexRes.status, 200);
    assert.includes(indexRes.text, 'Offline Hosted Sendforge');

    // Verify meta.json
    const metaRes = await client.get('/meta.json');
    if (metaRes.status === 200) {
      assert.ok(metaRes.json().default_branch === 'main');
    }
  });
});
