/**
 * Tier 3 - Combination C1: Full End-to-End Lifecycle Pipeline
 * Tests complete flow from `sendforge init` -> git push -> post-receive hook ->
 * meta.json + static index.html fallbacks -> `sendforge serve` -> client loose object fetch & tree traversal.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { SendforgeHttpClient } from '../harness/http_client.js';
import { GitParser } from '../harness/git_parser.js';
import { HtmlValidator } from '../harness/html_validator.js';

describe('Tier 3 - Workflow C1: Full Lifecycle Pipeline (C1)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;
  let serverHandle;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
  });

  afterEach(async () => {
    if (serverHandle) await serverHandle.stop();
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('C1.1: Complete pipeline from init to serving, zero-JS validation and client object resolution', async () => {
    // 1. sendforge init
    bareRepo = path.join(gitHelper.getRootDir(), 'c1-lifecycle.git');
    const initRes = supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });
    assert.strictEqual(initRes.status, 0);

    // 2. Clone and commit files
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work', 'main');
    const commitSha = gitHelper.commitFiles(workDir, {
      'README.md': '# Full Lifecycle Project\n\nWelcome to Sendforge static forge.',
      'src/main.rs': 'fn main() {\n    println!("Hello Sendforge");\n}\n',
      'docs/index.md': '# Documentation\nDetails here.'
    }, 'Initial project commit');

    // 3. Push to bare repo (triggers post-receive hook)
    gitHelper.push(workDir, 'origin', 'main');

    // 4. Verify static assets exist on disk
    const metaPath = path.join(bareRepo, 'static', 'meta.json');
    assert.ok(fs.existsSync(metaPath), 'meta.json must be generated');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    assert.strictEqual(meta.head.sha, commitSha);

    // 5. Start static server daemon
    serverHandle = await supervisor.startServer(bareRepo);
    const client = new SendforgeHttpClient(serverHandle.baseUrl);

    // 6. Zero-JS Curl check on /
    const htmlRes = await client.getIndexHtml();
    assert.strictEqual(htmlRes.status, 200);
    const validator = new HtmlValidator(htmlRes.text);
    validator.assertValidDocument();
    validator.assertReadmeRendered(['Full Lifecycle Project', 'Welcome to Sendforge']);
    validator.assertFileTreeContains(['README.md', 'src', 'docs']);

    // 7. Client engine simulation: fetch loose commit object over HTTP
    const commitObjRes = await client.getLooseObject(commitSha);
    assert.strictEqual(commitObjRes.status, 200);
    const parsedCommitObj = GitParser.inflateLooseObject(commitObjRes.buffer, commitSha);
    assert.strictEqual(parsedCommitObj.type, 'commit');

    const commitData = GitParser.parseCommit(parsedCommitObj.payload);
    assert.strictEqual(commitData.message, 'Initial project commit');
    assert.ok(commitData.tree);

    // 8. Fetch root tree object over HTTP
    const treeObjRes = await client.getLooseObject(commitData.tree);
    assert.strictEqual(treeObjRes.status, 200);
    const parsedTreeObj = GitParser.inflateLooseObject(treeObjRes.buffer, commitData.tree);
    const treeEntries = GitParser.parseTree(parsedTreeObj.payload);

    const names = treeEntries.map(e => e.name);
    assert.includes(names, 'README.md');
    assert.includes(names, 'src');
    assert.includes(names, 'docs');

    // 9. Fetch blob object over HTTP
    const readmeEntry = treeEntries.find(e => e.name === 'README.md');
    const readmeObjRes = await client.getLooseObject(readmeEntry.oid);
    const parsedReadme = GitParser.inflateLooseObject(readmeObjRes.buffer, readmeEntry.oid);
    const readmeBlob = GitParser.parseBlob(parsedReadme.payload);
    assert.includes(readmeBlob.text, 'Full Lifecycle Project');
  });
});
