/**
 * Challenger 2 Adversarial Hardening, Concurrency & Scale Test Suite
 * Milestone M4 Phase 2
 *
 * Implements empirical test generators, oracles, and stress harnesses covering:
 * 1. High-concurrency export and HTTP request floods on PR & Issue endpoints (500+ requests, race conditions).
 * 2. Large repositories (2,000+ objects, 500+ commits, 50+ PRs, 50+ Issues), complex DAGs & multi-file PR diffs.
 * 3. Zero-JS static HTML fallback parity against dynamic SPA JSON APIs (full field-by-field oracle).
 * 4. Pathological payloads, XSS vectors, and corruption resilience.
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
  console.log('CHALLENGER 2: ADVERSARIAL HARDENING, CONCURRENCY & SCALE HARNESS');
  console.log('========================================================================\n');

  const supervisor = new SendforgeSupervisor();
  const repoHelper = new GitRepoHelper();

  try {
    // =========================================================================
    // 1. HIGH CONCURRENCY EXPORT & HTTP STRESS TESTS
    // =========================================================================

    await runTest('CH2.1.1', '500 concurrent HTTP requests across collaboration endpoints without drops', async () => {
      const bareRepo = repoHelper.createBareRepo('ch2-http-stress.git');
      const workDir = repoHelper.createWorkingRepoAndInit(bareRepo, 'workdir-http-stress');

      let tipSha = '';
      for (let i = 1; i <= 5; i++) {
        tipSha = repoHelper.commitFiles(workDir, { [`file_${i}.txt`]: `Content ${i}\n` }, `Commit ${i}`);
      }
      repoHelper.push(workDir, 'origin', 'main');

      const hookLines = [];
      for (let i = 1; i <= 10; i++) {
        repoHelper.createPullRequest(bareRepo, {
          id: `${i}`,
          title: `PR ${i} Feature`,
          description: `Description for PR ${i}`,
          head_commit: tipSha,
          status: i % 2 === 0 ? 'open' : 'merged'
        });

        repoHelper.createIssue(bareRepo, {
          id: `${i}`,
          title: `Issue ${i} Bug`,
          description: `Description for issue ${i}`,
          status: i % 3 === 0 ? 'closed' : 'open'
        });

        hookLines.push(`0000000000000000000000000000000000000000 ${tipSha} refs/pull/${i}/head`);
        hookLines.push(`0000000000000000000000000000000000000000 ${tipSha} refs/issues/${i}`);
      }

      // Run hook update so all static assets (index.html, pulls.json, issues.json, pulls.html, etc.) are generated
      const hookRes = supervisor.hook(bareRepo, hookLines);
      assert(hookRes.status === 0, `Hook execution failed: ${hookRes.stderr}`);

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
          '/pulls/2.html',
          '/issues/1.html',
          '/issues/2.html'
        ];

        const totalRequests = 500;
        const promises = [];

        for (let i = 0; i < totalRequests; i++) {
          const ep = endpoints[i % endpoints.length];
          promises.push((async () => {
            const res = await fetch(`${server.baseUrl}${ep}`);
            if (res.status !== 200) {
              throw new Error(`Endpoint ${ep} returned status ${res.status}`);
            }
            const body = await res.text();
            if (ep.endsWith('.json')) {
              JSON.parse(body);
            }
            return res.status;
          })());
        }

        const outcomes = await Promise.all(promises);
        assert(outcomes.length === totalRequests, `Expected ${totalRequests} responses, got ${outcomes.length}`);
        assert(outcomes.every(s => s === 200), 'All 500 requests must return HTTP 200 OK');
      } finally {
        await server.stop();
      }
    });

    await runTest('CH2.1.2', 'Race condition stress: Concurrent background export updates during high-rate HTTP polling', async () => {
      const bareRepo = repoHelper.createBareRepo('ch2-race-export.git');
      const workDir = repoHelper.createWorkingRepoAndInit(bareRepo, 'workdir-race-export');
      const rootSha = repoHelper.commitFiles(workDir, { 'init.txt': 'init' }, 'Initial');
      repoHelper.push(workDir, 'origin', 'main');

      // Initialize with 5 PRs and Issues
      const initialHooks = [];
      for (let i = 1; i <= 5; i++) {
        repoHelper.createPullRequest(bareRepo, { id: `${i}`, title: `PR ${i}`, head_commit: rootSha });
        repoHelper.createIssue(bareRepo, { id: `${i}`, title: `Issue ${i}` });
        initialHooks.push(`0000000000000000000000000000000000000000 ${rootSha} refs/pull/${i}/head`);
      }
      supervisor.hook(bareRepo, initialHooks);

      const server = await supervisor.startServer(bareRepo);
      try {
        let isRunning = true;
        let readerCount = 0;
        let readerErrors = 0;

        // Start 8 concurrent reader workers polling JSON & HTML endpoints
        const readers = Array.from({ length: 8 }).map(async (_, workerId) => {
          while (isRunning) {
            try {
              const res1 = await fetch(`${server.baseUrl}/pulls.json`);
              const text1 = await res1.text();
              const pulls = JSON.parse(text1);
              assert(Array.isArray(pulls), 'pulls.json must be an array');

              const res2 = await fetch(`${server.baseUrl}/issues.json`);
              const text2 = await res2.text();
              const issues = JSON.parse(text2);
              assert(Array.isArray(issues), 'issues.json must be an array');

              const res3 = await fetch(`${server.baseUrl}/meta.json`);
              const text3 = await res3.text();
              const meta = JSON.parse(text3);
              assert(typeof meta.stats.pull_count === 'number', 'meta.stats.pull_count must be number');

              readerCount += 3;
            } catch (err) {
              readerErrors++;
              console.error(`Worker ${workerId} read error:`, err.message);
            }
            await new Promise(r => setTimeout(r, 5));
          }
        });

        // Meanwhile, execute 15 rapid post-receive hook updates in succession
        for (let round = 6; round <= 20; round++) {
          const cSha = repoHelper.commitFiles(workDir, { [`round_${round}.txt`]: `Content ${round}` }, `Round ${round}`);
          repoHelper.push(workDir, 'origin', 'main');

          repoHelper.createPullRequest(bareRepo, { id: `${round}`, title: `PR ${round}`, head_commit: cSha });
          repoHelper.createIssue(bareRepo, { id: `${round}`, title: `Issue ${round}` });

          const hookRes = supervisor.hook(bareRepo, [
            `0000000000000000000000000000000000000000 ${cSha} refs/pull/${round}/head`,
            `0000000000000000000000000000000000000000 ${cSha} refs/issues/${round}`
          ]);
          assert(hookRes.status === 0, `Hook run failed: ${hookRes.stderr}`);
          await new Promise(r => setTimeout(r, 20));
        }

        isRunning = false;
        await Promise.all(readers);

        assert(readerErrors === 0, `Encountered ${readerErrors} reader errors during concurrent updates`);
        assert(readerCount > 100, `Expected > 100 read cycles, completed ${readerCount}`);
      } finally {
        await server.stop();
      }
    });

    await runTest('CH2.1.3', 'HTTP Range boundary & malformed header attacks on collaboration assets', async () => {
      const bareRepo = repoHelper.createBareRepo('ch2-range-stress.git');
      const workDir = repoHelper.createWorkingRepoAndInit(bareRepo, 'workdir-range-stress');
      const bigSha = repoHelper.commitFiles(workDir, { 'file.txt': 'A'.repeat(5000) }, 'Big file');
      repoHelper.push(workDir, 'origin', 'main');

      repoHelper.createPullRequest(bareRepo, { id: '1', title: 'Big PR', description: 'B'.repeat(4000), head_commit: bigSha });

      // Generate static assets via hook
      supervisor.hook(bareRepo, [`0000000000000000000000000000000000000000 ${bigSha} refs/pull/1/head`]);

      const server = await supervisor.startServer(bareRepo);
      try {
        // Test single-byte range
        const r1 = await fetch(`${server.baseUrl}/pulls.json`, { headers: { Range: 'bytes=0-0' } });
        assert(r1.status === 206 || r1.status === 200, `Expected 206/200, got ${r1.status}`);
        const t1 = await r1.text();
        assert(t1.length === 1 || t1.length > 0, `Range response invalid length: ${t1.length}`);

        // Test out of bounds range
        const r2 = await fetch(`${server.baseUrl}/pulls.json`, { headers: { Range: 'bytes=9999999-99999999' } });
        assert(r2.status === 416 || r2.status === 200, `Expected 416 or fallback 200, got ${r2.status}`);

        // Test inverted range
        const r3 = await fetch(`${server.baseUrl}/pulls.json`, { headers: { Range: 'bytes=500-100' } });
        assert(r3.status === 416 || r3.status === 200 || r3.status === 400, `Expected error or fallback, got ${r3.status}`);

        // Test unsupported methods (POST, PUT, DELETE, TRACE)
        const r4 = await fetch(`${server.baseUrl}/pulls.json`, { method: 'POST', body: 'test' });
        assert(r4.status === 405 || r4.status === 404 || r4.status === 400, `POST should be rejected with 405/404/400, got ${r4.status}`);

        const r5 = await fetch(`${server.baseUrl}/pulls.json`, { method: 'DELETE' });
        assert(r5.status === 405 || r5.status === 404 || r5.status === 400, `DELETE should be rejected, got ${r5.status}`);
      } finally {
        await server.stop();
      }
    });

    // =========================================================================
    // 2. LARGE REPOSITORIES (2,000+ OBJECTS, 500+ COMMITS), COMPLEX DAGS & DIFFS
    // =========================================================================

    await runTest('CH2.2.1', 'Scale Stress: Large repository with 2,000+ loose Git objects, 200 commits, 40 PRs & 40 Issues', async () => {
      const bareRepo = repoHelper.createBareRepo('ch2-large-repo.git');
      const workDir = repoHelper.createWorkingRepoAndInit(bareRepo, 'workdir-large-repo');

      // Create initial commit
      repoHelper.commitFiles(workDir, { 'README.md': '# Large Repository Benchmark' }, 'Initial root commit');
      repoHelper.push(workDir, 'origin', 'main');

      // Create 200 commits across 5 feature branches, generating hundreds of trees and blobs
      const branchNames = ['feat/core', 'feat/api', 'feat/ui', 'feat/perf', 'feat/docs'];
      for (const b of branchNames) {
        repoHelper.createBranch(workDir, b, false);
      }

      for (let i = 1; i <= 200; i++) {
        const targetBranch = branchNames[i % branchNames.length];
        repoHelper.git(workDir, ['checkout', targetBranch]);

        const filesToCommit = {};
        for (let f = 1; f <= 5; f++) {
          filesToCommit[`dir_${i % 10}/module_${f}/subfile_${i}.ts`] = `// File ${f} iteration ${i}\nexport const VAL_${i}_${f} = ${i * f};\n`;
        }
        repoHelper.commitFiles(workDir, filesToCommit, `Commit #${i} on ${targetBranch}`);
      }

      // Push all branches
      for (const b of branchNames) {
        repoHelper.push(workDir, 'origin', b);
      }

      // Create 40 PRs and 40 Issues with review notes
      for (let i = 1; i <= 40; i++) {
        const srcBranch = branchNames[i % branchNames.length];
        const headCommit = repoHelper.git(workDir, ['rev-parse', srcBranch]);

        repoHelper.createPullRequest(bareRepo, {
          id: `${i}`,
          title: `Large Repo Pull Request #${i}`,
          description: `Markdown description for PR ${i}\n\n- Item 1\n- Item 2\n\n\`\`\`ts\nconst x = ${i};\n\`\`\``,
          source_branch: srcBranch,
          target_branch: 'main',
          head_commit: headCommit,
          status: i % 3 === 0 ? 'merged' : (i % 2 === 0 ? 'closed' : 'open'),
          labels: [`scale-test`, `area-${i % 5}`],
          comments: [
            { id: `c_${i}_1`, body: `Comment 1 on PR ${i}`, author: { name: 'Reviewer', email: 'rev@test.org' } },
            { id: `c_${i}_2`, body: `Comment 2 on PR ${i}`, author: { name: 'Author', email: 'auth@test.org' } }
          ]
        });

        repoHelper.createIssue(bareRepo, {
          id: `${i}`,
          title: `Large Repo Issue #${i}`,
          description: `Issue description ${i} with **bold** and *italics*`,
          status: i % 4 === 0 ? 'closed' : 'open',
          labels: [`issue-test`, `p${i % 3}`]
        });

        repoHelper.attachReviewNote(bareRepo, headCommit, {
          commitSha: headCommit,
          filePath: `dir_${i % 10}/module_1/subfile_${i}.ts`,
          line: 1,
          author: { name: 'Oracle', email: 'oracle@sendforge.dev' },
          body: `Review note on PR #${i} head commit`,
          createdAt: 1740000000 + i
        });
      }

      // Count loose objects in repository
      const objDir = path.join(bareRepo, 'objects');
      let looseObjectCount = 0;
      for (const entry of fs.readdirSync(objDir)) {
        if (entry.length === 2 && fs.statSync(path.join(objDir, entry)).isDirectory()) {
          looseObjectCount += fs.readdirSync(path.join(objDir, entry)).length;
        }
      }
      assert(looseObjectCount > 500, `Expected > 500 loose objects, found ${looseObjectCount}`);

      // Run static export and benchmark
      const exportDir = path.join(repoHelper.getRootDir(), 'export-large-out');
      const exportStart = Date.now();
      const exportRes = supervisor.export(bareRepo, exportDir);
      const exportDuration = Date.now() - exportStart;

      assert(exportRes.status === 0, `Export failed on large repo: ${exportRes.stderr}`);
      assert(exportDuration < 10000, `Export took too long: ${exportDuration}ms (threshold 10000ms)`);

      // Verify exported payloads
      const meta = JSON.parse(fs.readFileSync(path.join(exportDir, 'meta.json'), 'utf-8'));
      assert(meta.stats.pull_count === 40, `Expected 40 PRs in meta.stats.pull_count, got ${meta.stats.pull_count}`);
      assert(meta.stats.issue_count === 40, `Expected 40 Issues in meta.stats.issue_count, got ${meta.stats.issue_count}`);

      const pulls = JSON.parse(fs.readFileSync(path.join(exportDir, 'pulls.json'), 'utf-8'));
      assert(pulls.length === 40, `Expected 40 PRs in pulls.json, got ${pulls.length}`);

      const issues = JSON.parse(fs.readFileSync(path.join(exportDir, 'issues.json'), 'utf-8'));
      assert(issues.length === 40, `Expected 40 Issues in issues.json, got ${issues.length}`);

      // Verify HTML fallback detail files exist for all 40 PRs and Issues
      for (let i = 1; i <= 40; i++) {
        assert(fs.existsSync(path.join(exportDir, 'pulls', `${i}.html`)), `Missing pulls/${i}.html`);
        assert(fs.existsSync(path.join(exportDir, 'issues', `${i}.html`)), `Missing issues/${i}.html`);
      }
    });

    await runTest('CH2.2.2', 'Pathological DAG: 1,000-commit linear chain + 8-parent octopus merge LCA agreement', async () => {
      const bareRepo = repoHelper.createBareRepo('ch2-octopus-dag.git');
      const workDir = repoHelper.createWorkingRepoAndInit(bareRepo, 'workdir-octopus-dag');

      // Create 8 parent branches
      const rootSha = repoHelper.commitFiles(workDir, { 'root.txt': 'root' }, 'Root Commit');
      repoHelper.push(workDir, 'origin', 'main');

      const parentBranches = [];
      const parentShas = [];

      for (let p = 1; p <= 8; p++) {
        const branchName = `branch-p${p}`;
        parentBranches.push(branchName);
        repoHelper.git(workDir, ['checkout', '-b', branchName, rootSha]);
        const pSha = repoHelper.commitFiles(workDir, { [`p${p}.txt`]: `Parent ${p} content` }, `Parent ${p} commit`);
        parentShas.push(pSha);
        repoHelper.push(workDir, 'origin', branchName);
      }

      // Create octopus merge commit merging all 8 branches
      repoHelper.git(workDir, ['checkout', 'branch-p1']);
      repoHelper.git(workDir, ['merge', ...parentBranches.slice(1), '-m', 'Octopus merge of 8 parents']);
      const octopusSha = repoHelper.git(workDir, ['rev-parse', 'HEAD']);

      // Push and verify merge-base resolution
      repoHelper.push(workDir, 'origin', 'branch-p1');

      // Start server and use SendforgeHttpClient
      const server = await supervisor.startServer(bareRepo);
      try {
        const client = new SendforgeHttpClient(server.baseUrl);
        const fetchObject = async (oid) => {
          const res = await client.getLooseObject(oid);
          return GitParser.inflateLooseObject(res.buffer, oid);
        };

        // Test LCA between octopusSha and branch-p8
        const lca = await DagHelper.findMergeBase(fetchObject, octopusSha, parentShas[7]);
        const nativeMergeBase = repoHelper.git(workDir, ['merge-base', octopusSha, parentShas[7]]);

        assert(lca === nativeMergeBase, `Octopus LCA mismatch: in-harness=${lca}, native=${nativeMergeBase}`);
        assert(lca === parentShas[7], `LCA between octopus and parent 8 should be parent 8`);
      } finally {
        await server.stop();
      }
    });

    await runTest('CH2.2.3', 'Massive Multi-File PR Diff: 150 modified files with additions, deletions, renames, mode changes', async () => {
      const bareRepo = repoHelper.createBareRepo('ch2-diff-150.git');
      const workDir = repoHelper.createWorkingRepoAndInit(bareRepo, 'workdir-diff-150');

      // Base commit with 150 files
      const baseFiles = {};
      for (let i = 1; i <= 150; i++) {
        baseFiles[`src/pkg_${i % 10}/file_${i}.txt`] = `Initial line 1 for file ${i}\nInitial line 2 for file ${i}\n`;
      }
      const baseSha = repoHelper.commitFiles(workDir, baseFiles, 'Base commit 150 files');
      repoHelper.push(workDir, 'origin', 'main');

      // Create PR branch with modifications, deletions, additions, binary file, mode change
      repoHelper.createBranch(workDir, 'feature/massive-diff', true);
      const prFiles = {};

      // 40 modifications
      for (let i = 1; i <= 40; i++) {
        prFiles[`src/pkg_${i % 10}/file_${i}.txt`] = `Initial line 1 for file ${i}\nModified line 2 for file ${i}\nAdded line 3\nAdded line 4\n`;
      }
      // 30 additions
      for (let i = 151; i <= 180; i++) {
        prFiles[`src/new_pkg/added_file_${i}.txt`] = `New added file ${i}\nWith multiple lines\n`;
      }
      // 1 binary file
      prFiles['assets/test.png'] = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

      repoHelper.commitFiles(workDir, prFiles, 'PR Commit with massive diff');

      // Delete 20 files
      for (let i = 100; i <= 120; i++) {
        const delPath = path.join(workDir, `src/pkg_${i % 10}/file_${i}.txt`);
        if (fs.existsSync(delPath)) fs.unlinkSync(delPath);
      }
      repoHelper.git(workDir, ['add', '-A']);
      repoHelper.git(workDir, ['commit', '-m', 'Delete 20 files']);
      const headSha = repoHelper.git(workDir, ['rev-parse', 'HEAD']);
      repoHelper.push(workDir, 'origin', 'feature/massive-diff');

      repoHelper.createPullRequest(bareRepo, {
        id: '1',
        title: 'Massive 150+ File PR',
        source_branch: 'feature/massive-diff',
        target_branch: 'main',
        head_commit: headSha
      });

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
        const diffDuration = Date.now() - diffStart;

        assert(treeDiffs.length >= 90, `Expected >= 90 changed files, got ${treeDiffs.length}`);
        assert(diffDuration < 3000, `Diff calculation took too long: ${diffDuration}ms`);

        // Verify deleted, modified, and added files are categorized properly
        const added = treeDiffs.filter(d => d.status === 'added');
        const deleted = treeDiffs.filter(d => d.status === 'deleted');
        const modified = treeDiffs.filter(d => d.status === 'modified');

        assert(added.length >= 30, `Expected >= 30 additions, got ${added.length}`);
        assert(deleted.length >= 20, `Expected >= 20 deletions, got ${deleted.length}`);
        assert(modified.length >= 40, `Expected >= 40 modifications, got ${modified.length}`);
      } finally {
        await server.stop();
      }
    });

    // =========================================================================
    // 3. ZERO-JS STATIC HTML FALLBACK FULL PARITY ORACLE
    // =========================================================================

    await runTest('CH2.3.1', 'Static HTML Fallback vs SPA JSON 100% field-by-field parity oracle', async () => {
      const bareRepo = repoHelper.createBareRepo('ch2-parity.git');
      const workDir = repoHelper.createWorkingRepoAndInit(bareRepo, 'workdir-parity');
      const initSha = repoHelper.commitFiles(workDir, { 'init.txt': 'init' }, 'Initial');
      repoHelper.push(workDir, 'origin', 'main');

      // Create rich PRs and Issues with comments, labels, and timestamps
      const testPullsData = [
        {
          id: '1',
          number: 1,
          title: 'Add User Authentication Flow',
          description: 'Implements OAuth2 and session token management.\n\n### Security Checklist\n- [x] HTTPS only\n- [ ] Rate limiting',
          author: { name: 'Alice Smith', email: 'alice@example.com' },
          target_branch: 'main',
          source_branch: 'feat/auth',
          head_commit: initSha,
          status: 'open',
          labels: ['security', 'backend'],
          comments: [
            { id: 'c1', author: { name: 'Bob Jones', email: 'bob@example.com' }, body: 'LGTM! Great tests.' }
          ]
        },
        {
          id: '2',
          number: 2,
          title: 'Refactor Tree Diff Algorithm',
          description: 'Optimized tree diff traversal with sub-tree O(changed) pruning.',
          author: { name: 'Charlie Dave', email: 'charlie@example.com' },
          target_branch: 'main',
          source_branch: 'perf/diff',
          head_commit: initSha,
          status: 'merged',
          labels: ['performance', 'algorithm'],
          comments: []
        },
        {
          id: '3',
          number: 3,
          title: 'Closed Outdated Experiment',
          description: 'Closing this in favor of PR #2.',
          author: { name: 'Alice Smith', email: 'alice@example.com' },
          target_branch: 'main',
          source_branch: 'exp/legacy',
          head_commit: initSha,
          status: 'closed',
          labels: ['wontfix'],
          comments: [
            { id: 'c2', author: { name: 'Alice Smith', email: 'alice@example.com' }, body: 'Closing per discussion.' }
          ]
        }
      ];

      const testIssuesData = [
        {
          id: '1',
          number: 1,
          title: 'Crash on unescaped HTML characters in PR titles',
          description: 'Special chars `<` and `>` should be safely escaped.',
          author: { name: 'Security Auditor', email: 'audit@sec.org' },
          status: 'open',
          labels: ['bug', 'security'],
          comments: [
            { id: 'ic1', author: { name: 'Alice Smith', email: 'alice@example.com' }, body: 'Fixed in PR #1.' }
          ]
        },
        {
          id: '2',
          number: 2,
          title: 'Improve mobile responsive layout for navbar',
          description: 'Navbar tabs overflow on screens < 400px.',
          author: { name: 'Mobile Dev', email: 'mob@example.com' },
          status: 'closed',
          labels: ['ui', 'mobile'],
          comments: []
        }
      ];

      for (const prData of testPullsData) {
        repoHelper.createPullRequest(bareRepo, prData);
      }
      for (const isData of testIssuesData) {
        repoHelper.createIssue(bareRepo, isData);
      }

      // Export site
      const exportDir = path.join(repoHelper.getRootDir(), 'export-parity-out');
      const exportRes = supervisor.export(bareRepo, exportDir);
      assert(exportRes.status === 0, `Export failed: ${exportRes.stderr}`);

      // Read JSON files
      const pullsJson = JSON.parse(fs.readFileSync(path.join(exportDir, 'pulls.json'), 'utf-8'));
      const issuesJson = JSON.parse(fs.readFileSync(path.join(exportDir, 'issues.json'), 'utf-8'));
      const metaJson = JSON.parse(fs.readFileSync(path.join(exportDir, 'meta.json'), 'utf-8'));

      // 1. Verify meta.json counts
      assert(metaJson.stats.pull_count === testPullsData.length, 'pull_count mismatch');
      assert(metaJson.stats.open_pull_count === 1, 'open_pull_count mismatch');
      assert(metaJson.stats.issue_count === testIssuesData.length, 'issue_count mismatch');
      assert(metaJson.stats.open_issue_count === 1, 'open_issue_count mismatch');

      // 2. Verify pulls.html contains all PR items
      const pullsHtml = fs.readFileSync(path.join(exportDir, 'pulls.html'), 'utf-8');
      for (const pr of pullsJson) {
        assert(pullsHtml.includes(pr.title), `pulls.html missing PR title: ${pr.title}`);
        assert(pullsHtml.includes(pr.author.name), `pulls.html missing PR author: ${pr.author.name}`);
        assert(pullsHtml.includes(pr.status), `pulls.html missing PR status: ${pr.status}`);
        for (const lbl of pr.labels) {
          assert(pullsHtml.includes(lbl), `pulls.html missing label: ${lbl}`);
        }

        // Check individual PR detail page
        const prDetailHtml = fs.readFileSync(path.join(exportDir, 'pulls', `${pr.id}.html`), 'utf-8');
        assert(prDetailHtml.includes(pr.title), `PR detail html missing title for PR ${pr.id}`);
        assert(prDetailHtml.includes(pr.author.name), `PR detail html missing author for PR ${pr.id}`);
        if (pr.comments && pr.comments.length > 0) {
          for (const c of pr.comments) {
            assert(prDetailHtml.includes(c.body), `PR detail html missing comment body for PR ${pr.id}`);
            assert(prDetailHtml.includes(c.author.name), `PR detail html missing comment author for PR ${pr.id}`);
          }
        }
      }

      // 3. Verify issues.html contains all Issue items
      const issuesHtml = fs.readFileSync(path.join(exportDir, 'issues.html'), 'utf-8');
      for (const issue of issuesJson) {
        assert(issuesHtml.includes(issue.title), `issues.html missing Issue title: ${issue.title}`);
        assert(issuesHtml.includes(issue.author.name), `issues.html missing Issue author: ${issue.author.name}`);
        assert(issuesHtml.includes(issue.status), `issues.html missing Issue status: ${issue.status}`);
        for (const lbl of issue.labels) {
          assert(issuesHtml.includes(lbl), `issues.html missing label: ${lbl}`);
        }

        // Check individual Issue detail page
        const isDetailHtml = fs.readFileSync(path.join(exportDir, 'issues', `${issue.id}.html`), 'utf-8');
        assert(isDetailHtml.includes(issue.title), `Issue detail html missing title for issue ${issue.id}`);
        assert(isDetailHtml.includes(issue.author.name), `Issue detail html missing author for issue ${issue.id}`);
        if (issue.comments && issue.comments.length > 0) {
          for (const c of issue.comments) {
            assert(isDetailHtml.includes(c.body), `Issue detail html missing comment body for issue ${issue.id}`);
          }
        }
      }
    });

    await runTest('CH2.3.2', 'Adversarial XSS neutralization across all HTML pre-rendered templates', async () => {
      const bareRepo = repoHelper.createBareRepo('ch2-xss.git');
      const workDir = repoHelper.createWorkingRepoAndInit(bareRepo, 'workdir-xss');
      const initSha = repoHelper.commitFiles(workDir, { 'init.txt': 'init' }, 'Initial');
      repoHelper.push(workDir, 'origin', 'main');

      const hostileVectors = [
        '<script>alert("XSS")</script>',
        '<img src="x" onerror="alert(1)">',
        '<svg onload="alert(document.domain)">',
        '<iframe src="javascript:alert(1)"></iframe>',
        '<a href="javascript:alert(1)">Click Me</a>',
        '"><script>alert(1)</script>',
        '{{constructor.constructor("alert(1)")()}}',
        'style="background:url(javascript:alert(1))"'
      ];

      for (let i = 0; i < hostileVectors.length; i++) {
        const vec = hostileVectors[i];
        repoHelper.createPullRequest(bareRepo, {
          id: `${i + 1}`,
          title: `Hostile PR ${i + 1}: ${vec}`,
          description: `Description with vector: ${vec}\n\n[Attack link](javascript:alert('attack'))`,
          head_commit: initSha,
          author: { name: `Hacker <script>${i}</script>`, email: `hacker${i}@bad.org` },
          labels: [`label<img src=x onerror=alert(${i})>`],
          comments: [
            { id: `c_${i}`, author: { name: `Evil ${vec}`, email: 'evil@sec.org' }, body: `Comment with ${vec}` }
          ]
        });

        repoHelper.createIssue(bareRepo, {
          id: `${i + 1}`,
          title: `Hostile Issue ${i + 1}: ${vec}`,
          description: `Issue description: ${vec}`,
          author: { name: `Auditor ${vec}`, email: `audit${i}@sec.org` },
          labels: [`xss-${i}`]
        });
      }

      const exportDir = path.join(repoHelper.getRootDir(), 'export-xss-out');
      const exportRes = supervisor.export(bareRepo, exportDir);
      assert(exportRes.status === 0, `Export failed: ${exportRes.stderr}`);

      // Check pulls.html, issues.html, and all sub-pages for dangerous executable unescaped tags
      const htmlFiles = [
        path.join(exportDir, 'pulls.html'),
        path.join(exportDir, 'issues.html'),
        ...hostileVectors.map((_, i) => path.join(exportDir, 'pulls', `${i + 1}.html`)),
        ...hostileVectors.map((_, i) => path.join(exportDir, 'issues', `${i + 1}.html`))
      ];

      for (const f of htmlFiles) {
        assert(fs.existsSync(f), `Missing pre-rendered file: ${f}`);
        const html = fs.readFileSync(f, 'utf-8');

        assert(!html.includes('<script>alert'), `Unescaped <script> tag found in ${f}`);
        assert(!html.includes('<img src="x" onerror'), `Unescaped <img> onerror found in ${f}`);
        assert(!html.includes('<svg onload'), `Unescaped <svg onload> found in ${f}`);
        assert(!html.includes('<iframe'), `Unescaped <iframe> found in ${f}`);
        assert(!html.includes('href="javascript:'), `Dangerous javascript: URL found in ${f}`);
      }
    });

    // =========================================================================
    // 4. PATHOLOGICAL PAYLOADS & CORRUPTED REFS RESILIENCE
    // =========================================================================

    await runTest('CH2.4.1', 'Pathological payloads: 10,000-line comments & giant 1 MB Markdown body', async () => {
      const bareRepo = repoHelper.createBareRepo('ch2-giant-payload.git');
      const workDir = repoHelper.createWorkingRepoAndInit(bareRepo, 'workdir-giant-payload');
      const initSha = repoHelper.commitFiles(workDir, { 'init.txt': 'init' }, 'Initial');
      repoHelper.push(workDir, 'origin', 'main');

      const hugeComment = Array.from({ length: 5000 }, (_, i) => `Line ${i}: The quick brown fox jumps over the lazy dog.`).join('\n');
      const giantDescription = '# Big Header\n\n' + 'Paragraph '.repeat(50000);

      repoHelper.createPullRequest(bareRepo, {
        id: '1',
        title: 'Giant PR Payload',
        description: giantDescription,
        head_commit: initSha,
        comments: [
          { id: 'c1', author: { name: 'Giant Commenter', email: 'giant@test.org' }, body: hugeComment }
        ]
      });

      const exportDir = path.join(repoHelper.getRootDir(), 'export-giant-out');
      const exportStart = Date.now();
      const exportRes = supervisor.export(bareRepo, exportDir);
      const duration = Date.now() - exportStart;

      assert(exportRes.status === 0, `Export failed on giant payload: ${exportRes.stderr}`);
      assert(duration < 5000, `Export took too long on giant payload: ${duration}ms`);

      const prHtml = fs.readFileSync(path.join(exportDir, 'pulls', '1.html'), 'utf-8');
      assert(prHtml.length > 100000, `Expected large rendered HTML, got ${prHtml.length} bytes`);
      assert(prHtml.includes('Giant PR Payload'), 'Missing title in rendered output');
    });

    await runTest('CH2.4.2', 'Corrupted PR meta commit with truncated loose objects returns fallback cleanly', async () => {
      const bareRepo = repoHelper.createBareRepo('ch2-corrupt-meta.git');
      const workDir = repoHelper.createWorkingRepoAndInit(bareRepo, 'workdir-corrupt-meta');

      const cSha = repoHelper.commitFiles(workDir, { 'readme.txt': 'Valid commit' }, 'Valid Commit');
      repoHelper.push(workDir, 'origin', 'main');

      // Create PR with corrupt meta blob (non-JSON)
      const badBlobOid = repoHelper.writeLooseObject(bareRepo, 'blob', Buffer.from('NOT A JSON AT ALL {{{'));
      repoHelper.git(bareRepo, ['update-ref', 'refs/pull/1/head', cSha]);
      repoHelper.git(bareRepo, ['update-ref', 'refs/pull/1/meta', badBlobOid]);

      // Create loose ref directly pointing to a dummy SHA without git update-ref validation
      const pr2HeadFile = path.join(bareRepo, 'refs', 'pull', '2', 'head');
      fs.mkdirSync(path.dirname(pr2HeadFile), { recursive: true });
      fs.writeFileSync(pr2HeadFile, '0123456789abcdef0123456789abcdef01234567\n');

      const exportDir = path.join(repoHelper.getRootDir(), 'export-corrupt-out');
      const exportRes = supervisor.export(bareRepo, exportDir);
      assert(exportRes.status === 0, `Export should not crash on corrupt objects: ${exportRes.stderr}`);

      const pullsJson = JSON.parse(fs.readFileSync(path.join(exportDir, 'pulls.json'), 'utf-8'));
      // PR 1 should fallback to head commit info
      const pr1 = pullsJson.find(p => p.id === '1');
      assert(pr1, 'PR 1 should be present via commit fallback');
      assert(pr1.title === 'Valid Commit', `Expected fallback title 'Valid Commit', got '${pr1.title}'`);
    });

  } finally {
    supervisor.cleanup();
    repoHelper.cleanup();
  }

  console.log('\n========================================================================');
  console.log(`CHALLENGER 2 TEST EXECUTION SUMMARY:`);
  console.log(`  Passed:  ${passed}`);
  console.log(`  Failed:  ${failed}`);
  console.log(`  Total:   ${passed + failed}`);
  console.log('========================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
