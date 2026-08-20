/**
 * Tier 4 - Workload W4: Dynamic In-Browser Navigation & Diff Workflow Simulation
 * Simulates complete in-browser SPA workflow: metadata polling, branch switching,
 * tree navigation, blob retrieval, and Web Worker diff calculation.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { SendforgeHttpClient } from '../harness/http_client.js';
import { GitParser } from '../harness/git_parser.js';

describe('Tier 4 - Workload W4: In-Browser Navigation & Diff Workflow (W4)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;
  let serverHandle;

  beforeEach(async () => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('w4-browser-spa.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });

    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-spa', 'main');

    // Commit 1 on main
    const c1 = gitHelper.commitFiles(workDir, {
      'README.md': '# SPA Simulation',
      'src/App.tsx': 'export const App = () => <div>V1</div>;',
      'src/utils/math.ts': 'export const add = (a: number, b: number) => a + b;'
    }, 'Commit 1: Base UI');

    // Create dev branch
    gitHelper.createBranch(workDir, 'dev');
    const c2 = gitHelper.commitFiles(workDir, {
      'src/App.tsx': 'export const App = () => <div>V2 Enhanced</div>;',
      'src/utils/math.ts': 'export const add = (a: number, b: number) => a + b;\nexport const mul = (a: number, b: number) => a * b;'
    }, 'Commit 2: Feature updates');

    gitHelper.push(workDir, 'origin', '--all');
    serverHandle = await supervisor.startServer(bareRepo);
  });

  afterEach(async () => {
    if (serverHandle) await serverHandle.stop();
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('W4.1: Executes complete in-browser client workflow over HTTP', async () => {
    const client = new SendforgeHttpClient(serverHandle.baseUrl);

    // 1. Initial page load: fetch meta.json
    const metaRes = await client.getMetaJson();
    assert.strictEqual(metaRes.status, 200);
    const meta = metaRes.data;
    assert.strictEqual(meta.default_branch, 'main');
    assert.strictEqual(meta.branches.length, 2);

    // 2. User switches to "dev" branch
    const devBranch = meta.branches.find(b => b.name === 'dev');
    assert.ok(devBranch);
    const devTipCommitSha = devBranch.target;

    // 3. Client fetches dev commit loose object
    const commitRes = await client.getLooseObject(devTipCommitSha);
    const commitObj = GitParser.inflateLooseObject(commitRes.buffer, devTipCommitSha);
    const commit = GitParser.parseCommit(commitObj.payload);
    assert.strictEqual(commit.message, 'Commit 2: Feature updates');
    assert.strictEqual(commit.parents.length, 1);
    const parentSha = commit.parents[0];

    // 4. Client navigates into "src" subtree
    const treeRes = await client.getLooseObject(commit.tree);
    const treeObj = GitParser.inflateLooseObject(treeRes.buffer, commit.tree);
    const rootEntries = GitParser.parseTree(treeObj.payload);
    const srcEntry = rootEntries.find(e => e.name === 'src');
    assert.ok(srcEntry);

    const srcTreeRes = await client.getLooseObject(srcEntry.oid);
    const srcTreeObj = GitParser.inflateLooseObject(srcTreeRes.buffer, srcEntry.oid);
    const srcEntries = GitParser.parseTree(srcTreeObj.payload);
    const mathEntry = srcEntries.find(e => e.name === 'utils');
    assert.ok(mathEntry);

    // 5. Client views commit diff: fetch parent commit & parent tree
    const parentCommitRes = await client.getLooseObject(parentSha);
    const parentCommitObj = GitParser.inflateLooseObject(parentCommitRes.buffer, parentSha);
    const parentCommit = GitParser.parseCommit(parentCommitObj.payload);

    // Fetch parent App.tsx blob vs dev App.tsx blob
    const devAppEntry = srcEntries.find(e => e.name === 'App.tsx');
    const devAppRes = await client.getLooseObject(devAppEntry.oid);
    const devAppParsed = GitParser.inflateLooseObject(devAppRes.buffer, devAppEntry.oid);
    const devAppText = GitParser.parseBlob(devAppParsed.payload).text;

    const parentTreeRes = await client.getLooseObject(parentCommit.tree);
    const parentTreeObj = GitParser.inflateLooseObject(parentTreeRes.buffer, parentCommit.tree);
    const parentRootEntries = GitParser.parseTree(parentTreeObj.payload);
    const parentSrcEntry = parentRootEntries.find(e => e.name === 'src');
    const parentSrcRes = await client.getLooseObject(parentSrcEntry.oid);
    const parentSrcObj = GitParser.inflateLooseObject(parentSrcRes.buffer, parentSrcEntry.oid);
    const parentSrcEntries = GitParser.parseTree(parentSrcObj.payload);
    const parentAppEntry = parentSrcEntries.find(e => e.name === 'App.tsx');
    const parentAppRes = await client.getLooseObject(parentAppEntry.oid);
    const parentAppParsed = GitParser.inflateLooseObject(parentAppRes.buffer, parentAppEntry.oid);
    const parentAppText = GitParser.parseBlob(parentAppParsed.payload).text;

    // 6. Worker diff computation
    const diff = GitParser.computeUnifiedDiff(parentAppText, devAppText);
    assert.strictEqual(diff.isIdentical, false);
    assert.strictEqual(diff.stats.additions, 1);
    assert.strictEqual(diff.stats.deletions, 1);
  });
});
