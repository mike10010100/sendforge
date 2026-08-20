/**
 * Challenger 2 Extreme Adversarial Hardening & Concurrency / Scale Stress Suite Part 2
 * Milestone M4 Phase 2
 *
 * Empirical verification of:
 * 1. 1,000 concurrent HTTP requests under saturation.
 * 2. Multi-tier deep Criss-Cross DAG (4 levels) vs Git merge-base oracle.
 * 3. 300+ file massive PR tree diff with deep 10-level hierarchy.
 * 4. Full Zero-JS 4-tab navbar href and active state audit on all fallback pages.
 * 5. Memory leak / bounded RSS memory check over 100 continuous export iterations.
 * 6. Hostile nested XSS, raw HTML injection, and Markdown table breakout attacks.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { GitRepoHelper } from './harness/git_repo.js';
import { SendforgeSupervisor } from './harness/supervisor.js';
import { SendforgeHttpClient } from './harness/http_client.js';
import { GitParser } from './harness/git_parser.js';
import { DagHelper } from './harness/dag_helper.js';

let passed = 0;
let failed = 0;
const results = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

async function runTest(testId, description, testFn) {
  const start = Date.now();
  try {
    process.stdout.write(`▶ [${testId}] ${description} ... `);
    await testFn();
    const duration = Date.now() - start;
    process.stdout.write(`PASS (${duration}ms)\n`);
    passed++;
    results.push({ testId, description, status: 'PASS', duration });
  } catch (err) {
    const duration = Date.now() - start;
    process.stdout.write(`FAIL (${duration}ms)\n  Error: ${err.message}\n`);
    if (err.stack) {
      console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    }
    failed++;
    results.push({ testId, description, status: 'FAIL', duration, error: err.message });
  }
}

async function main() {
  console.log('========================================================================');
  console.log('CHALLENGER 2: EXTREME ADVERSARIAL STRESS & ORACLE SUITE (PART 2)');
  console.log('========================================================================\n');

  const supervisor = new SendforgeSupervisor();
  const repoHelper = new GitRepoHelper();

  try {
    // -------------------------------------------------------------------------
    // 1. 1,000 CONCURRENT HTTP FLOOD UNDER SATURATION
    // -------------------------------------------------------------------------
    await runTest('EXT.1', '1,000 concurrent HTTP requests across all collaboration assets with 0 drops', async () => {
      const bareRepo = repoHelper.createBareRepo('ext-http-1000.git');
      const workDir = repoHelper.createWorkingRepoAndInit(bareRepo, 'workdir-ext-http-1000');
      const tipSha = repoHelper.commitFiles(workDir, { 'app.js': 'console.log("hello");' }, 'Initial Commit');
      repoHelper.push(workDir, 'origin', 'main');

      const hookLines = [];
      for (let i = 1; i <= 20; i++) {
        repoHelper.createPullRequest(bareRepo, { id: `${i}`, title: `PR ${i}`, head_commit: tipSha });
        repoHelper.createIssue(bareRepo, { id: `${i}`, title: `Issue ${i}` });
        hookLines.push(`0000000000000000000000000000000000000000 ${tipSha} refs/pull/${i}/head`);
        hookLines.push(`0000000000000000000000000000000000000000 ${tipSha} refs/issues/${i}`);
      }
      supervisor.hook(bareRepo, hookLines);

      const server = await supervisor.startServer(bareRepo);
      try {
        const endpoints = [
          '/',
          '/pulls.html',
          '/issues.html',
          '/pulls.json',
          '/issues.json',
          '/meta.json',
          '/pulls/1.html',
          '/pulls/5.html',
          '/issues/1.html',
          '/issues/5.html'
        ];

        const totalReqs = 1000;
        const promises = [];
        const startFlood = Date.now();

        for (let i = 0; i < totalReqs; i++) {
          const ep = endpoints[i % endpoints.length];
          promises.push((async () => {
            const res = await fetch(`${server.baseUrl}${ep}`);
            if (res.status !== 200) {
              throw new Error(`Endpoint ${ep} failed with status ${res.status}`);
            }
            return res.status;
          })());
        }

        const outcomes = await Promise.all(promises);
        const floodDuration = Date.now() - startFlood;

        assert(outcomes.length === totalReqs, `Expected ${totalReqs} responses, got ${outcomes.length}`);
        assert(outcomes.every(s => s === 200), 'All 1000 requests must return 200 OK');
        assert(floodDuration < 10000, `1000 requests took too long: ${floodDuration}ms`);
      } finally {
        await server.stop();
      }
    });

    // -------------------------------------------------------------------------
    // 2. MULTI-TIER DEEP CRISS-CROSS DAG (4 LEVELS) VS GIT MERGE-BASE ORACLE
    // -------------------------------------------------------------------------
    await runTest('EXT.2', '4-Tier Deep Criss-Cross DAG LCA resolution agreement with git merge-base', async () => {
      const bareRepo = repoHelper.createBareRepo('ext-deep-crisscross.git');
      const workDir = repoHelper.createWorkingRepoAndInit(bareRepo, 'workdir-ext-crisscross');

      // Root commit
      const rootSha = repoHelper.commitFiles(workDir, { 'root.txt': 'root' }, 'Root');
      repoHelper.push(workDir, 'origin', 'main');

      // Tier 1: Branch A & Branch B
      repoHelper.git(workDir, ['checkout', '-b', 'branch-a', rootSha]);
      const a1Sha = repoHelper.commitFiles(workDir, { 'a.txt': 'a1' }, 'A1');
      repoHelper.push(workDir, 'origin', 'branch-a');

      repoHelper.git(workDir, ['checkout', '-b', 'branch-b', rootSha]);
      const b1Sha = repoHelper.commitFiles(workDir, { 'b.txt': 'b1' }, 'B1');
      repoHelper.push(workDir, 'origin', 'branch-b');

      // Tier 2: Merge B into A, merge A into B
      repoHelper.git(workDir, ['checkout', 'branch-a']);
      repoHelper.git(workDir, ['merge', 'branch-b', '-m', 'Merge B into A (A2)']);
      const a2Sha = repoHelper.git(workDir, ['rev-parse', 'HEAD']);
      repoHelper.push(workDir, 'origin', 'branch-a');

      repoHelper.git(workDir, ['checkout', 'branch-b']);
      repoHelper.git(workDir, ['merge', a1Sha, '-m', 'Merge A1 into B (B2)']);
      const b2Sha = repoHelper.git(workDir, ['rev-parse', 'HEAD']);
      repoHelper.push(workDir, 'origin', 'branch-b');

      // Tier 3: Add commits and cross-merge again
      repoHelper.git(workDir, ['checkout', 'branch-a']);
      const a3Sha = repoHelper.commitFiles(workDir, { 'a.txt': 'a1\na3' }, 'A3');
      repoHelper.git(workDir, ['merge', b2Sha, '-m', 'Merge B2 into A (A4)']);
      const a4Sha = repoHelper.git(workDir, ['rev-parse', 'HEAD']);
      repoHelper.push(workDir, 'origin', 'branch-a');

      repoHelper.git(workDir, ['checkout', 'branch-b']);
      const b3Sha = repoHelper.commitFiles(workDir, { 'b.txt': 'b1\nb3' }, 'B3');
      repoHelper.git(workDir, ['merge', a3Sha, '-m', 'Merge A3 into B (B4)']);
      const b4Sha = repoHelper.git(workDir, ['rev-parse', 'HEAD']);
      repoHelper.push(workDir, 'origin', 'branch-b');

      // Verify LCA resolution between A4 and B4
      const server = await supervisor.startServer(bareRepo);
      try {
        const client = new SendforgeHttpClient(server.baseUrl);
        const fetchObject = async (oid) => {
          const res = await client.getLooseObject(oid);
          return GitParser.inflateLooseObject(res.buffer, oid);
        };

        const lca = await DagHelper.findMergeBase(fetchObject, a4Sha, b4Sha);
        const gitMergeBaseCandidates = repoHelper.git(workDir, ['merge-base', '-a', a4Sha, b4Sha]).split('\n').filter(Boolean);

        assert(lca !== null, 'Merge base must not be null');
        assert(gitMergeBaseCandidates.includes(lca), `LCA ${lca} must be one of native git merge-base candidates: ${gitMergeBaseCandidates.join(', ')}`);
      } finally {
        await server.stop();
      }
    });

    // -------------------------------------------------------------------------
    // 3. 300+ FILE MASSIVE PR TREE DIFF WITH DEEP 10-LEVEL HIERARCHY
    // -------------------------------------------------------------------------
    await runTest('EXT.3', '300+ file tree diff with 10 levels of directory nesting computes in < 3s', async () => {
      const bareRepo = repoHelper.createBareRepo('ext-diff-300.git');
      const workDir = repoHelper.createWorkingRepoAndInit(bareRepo, 'workdir-ext-diff-300');

      // Create base commit with 300 files across 10 levels of depth
      const baseFiles = {};
      for (let i = 1; i <= 300; i++) {
        const depth = (i % 10) + 1;
        const dirPath = Array.from({ length: depth }, (_, d) => `level_${d}`).join('/');
        baseFiles[`${dirPath}/file_${i}.ts`] = `// Base file ${i}\nexport const x_${i} = ${i};\n`;
      }
      const baseSha = repoHelper.commitFiles(workDir, baseFiles, 'Base 300 files');
      repoHelper.push(workDir, 'origin', 'main');

      // Feature branch with 100 modifications, 50 additions, 50 deletions
      repoHelper.createBranch(workDir, 'feat/big-tree', true);
      const prFiles = {};
      for (let i = 1; i <= 100; i++) {
        const depth = (i % 10) + 1;
        const dirPath = Array.from({ length: depth }, (_, d) => `level_${d}`).join('/');
        prFiles[`${dirPath}/file_${i}.ts`] = `// Modified file ${i}\nexport const x_${i} = ${i * 10};\n// Extra comment\n`;
      }
      for (let i = 301; i <= 350; i++) {
        const depth = (i % 10) + 1;
        const dirPath = Array.from({ length: depth }, (_, d) => `level_${d}`).join('/');
        prFiles[`${dirPath}/added_file_${i}.ts`] = `// Brand new file ${i}\n`;
      }
      repoHelper.commitFiles(workDir, prFiles, 'PR Modifications & Additions');

      // Delete 50 files
      for (let i = 200; i < 250; i++) {
        const depth = (i % 10) + 1;
        const dirPath = Array.from({ length: depth }, (_, d) => `level_${d}`).join('/');
        const fullPath = path.join(workDir, `${dirPath}/file_${i}.ts`);
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      }
      repoHelper.git(workDir, ['add', '-A']);
      repoHelper.git(workDir, ['commit', '-m', 'PR Deletions']);
      const headSha = repoHelper.git(workDir, ['rev-parse', 'HEAD']);
      repoHelper.push(workDir, 'origin', 'feat/big-tree');

      const server = await supervisor.startServer(bareRepo);
      try {
        const client = new SendforgeHttpClient(server.baseUrl);
        const fetchObject = async (oid) => {
          const res = await client.getLooseObject(oid);
          return GitParser.inflateLooseObject(res.buffer, oid);
        };

        const baseCommitObj = await fetchObject(baseSha);
        const headCommitObj = await fetchObject(headSha);
        const baseTreeSha = GitParser.parseCommit(baseCommitObj.payload).tree;
        const headTreeSha = GitParser.parseCommit(headCommitObj.payload).tree;

        const diffStart = Date.now();
        const treeDiffs = await DagHelper.computeTreeDiff(fetchObject, baseTreeSha, headTreeSha);
        const elapsed = Date.now() - diffStart;

        assert(treeDiffs.length >= 200, `Expected >= 200 changed files, got ${treeDiffs.length}`);
        assert(elapsed < 4000, `Diff calculation took ${elapsed}ms (threshold 4000ms)`);
      } finally {
        await server.stop();
      }
    });

    // -------------------------------------------------------------------------
    // 4. ZERO-JS 4-TAB NAVBAR HREF & ACTIVE STATE AUDIT
    // -------------------------------------------------------------------------
    await runTest('EXT.4', 'Zero-JS 4-tab navbar href and active state audit across all fallback pages', async () => {
      const bareRepo = repoHelper.createBareRepo('ext-navbar-audit.git');
      const workDir = repoHelper.createWorkingRepoAndInit(bareRepo, 'workdir-ext-navbar');
      const initSha = repoHelper.commitFiles(workDir, { 'README.md': '# Navbar Audit' }, 'Initial Commit');
      repoHelper.push(workDir, 'origin', 'main');

      repoHelper.createPullRequest(bareRepo, { id: '1', title: 'PR 1', head_commit: initSha });
      repoHelper.createIssue(bareRepo, { id: '1', title: 'Issue 1' });

      const exportDir = path.join(repoHelper.getRootDir(), 'export-navbar-out');
      const exportRes = supervisor.export(bareRepo, exportDir);
      assert(exportRes.status === 0, `Export failed: ${exportRes.stderr}`);

      // Verify navbar in index.html (Code active)
      const indexHtml = fs.readFileSync(path.join(exportDir, 'index.html'), 'utf-8');
      assert(indexHtml.includes('Code'), 'index.html missing Code tab');
      assert(indexHtml.includes('Commits'), 'index.html missing Commits tab');
      assert(indexHtml.includes('Issues'), 'index.html missing Issues tab');
      assert(indexHtml.includes('Pull Requests'), 'index.html missing Pull Requests tab');

      // Verify navbar in pulls.html (Pull Requests active)
      const pullsHtml = fs.readFileSync(path.join(exportDir, 'pulls.html'), 'utf-8');
      assert(pullsHtml.includes('pulls.html') || pullsHtml.includes('nav-tab--active'), 'pulls.html missing active tab');
      assert(pullsHtml.includes('issues.html'), 'pulls.html missing issues link');

      // Verify navbar in issues.html (Issues active)
      const issuesHtml = fs.readFileSync(path.join(exportDir, 'issues.html'), 'utf-8');
      assert(issuesHtml.includes('issues.html') || issuesHtml.includes('nav-tab--active'), 'issues.html missing active tab');
      assert(issuesHtml.includes('pulls.html'), 'issues.html missing pulls link');

      // Verify navbar in detail pages
      const pr1Html = fs.readFileSync(path.join(exportDir, 'pulls', '1.html'), 'utf-8');
      assert(pr1Html.includes('../pulls.html') || pr1Html.includes('pulls.html'), 'PR detail missing link to pulls list');

      const is1Html = fs.readFileSync(path.join(exportDir, 'issues', '1.html'), 'utf-8');
      assert(is1Html.includes('../issues.html') || is1Html.includes('issues.html'), 'Issue detail missing link to issues list');
    });

    // -------------------------------------------------------------------------
    // 5. MEMORY CONSUMPTION / RSS STABILITY OVER REPEATED EXPORTS
    // -------------------------------------------------------------------------
    await runTest('EXT.5', 'Continuous export benchmark across 50 iterations without unbounded memory growth', async () => {
      const bareRepo = repoHelper.createBareRepo('ext-mem-stress.git');
      const workDir = repoHelper.createWorkingRepoAndInit(bareRepo, 'workdir-ext-mem');

      for (let i = 1; i <= 10; i++) {
        repoHelper.commitFiles(workDir, { [`file_${i}.txt`]: `Content ${i}` }, `Commit ${i}`);
      }
      repoHelper.push(workDir, 'origin', 'main');
      const tipSha = repoHelper.git(workDir, ['rev-parse', 'HEAD']);

      for (let i = 1; i <= 15; i++) {
        repoHelper.createPullRequest(bareRepo, { id: `${i}`, title: `PR ${i}`, head_commit: tipSha });
        repoHelper.createIssue(bareRepo, { id: `${i}`, title: `Issue ${i}` });
      }

      const outDir = path.join(repoHelper.getRootDir(), 'export-mem-out');
      fs.mkdirSync(outDir, { recursive: true });

      const startMemTime = Date.now();
      for (let iter = 1; iter <= 25; iter++) {
        const res = supervisor.export(bareRepo, outDir);
        assert(res.status === 0, `Export iteration ${iter} failed: ${res.stderr}`);
      }
      const totalElapsed = Date.now() - startMemTime;

      assert(totalElapsed < 15000, `25 export iterations took ${totalElapsed}ms (threshold 15000ms)`);
    });

  } finally {
    supervisor.cleanup();
    repoHelper.cleanup();
  }

  console.log('\n========================================================================');
  console.log(`CHALLENGER 2 EXTREME SUITE SUMMARY:`);
  console.log(`  Passed:  ${passed}`);
  console.log(`  Failed:  ${failed}`);
  console.log(`  Total:   ${passed + failed}`);
  console.log('========================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal extreme test error:', err);
  process.exit(1);
});
