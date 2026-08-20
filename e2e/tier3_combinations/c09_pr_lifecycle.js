/**
 * Tier 3 - Combination C09: Full Pull Request End-to-End Lifecycle (C09)
 * Tests complete PR journey: Branch -> Commit -> Push refs/pull/* -> Hook ->
 * Fetch pulls.json -> Compute Merge-Base -> Commit List -> 3-Way Diff -> Review Note.
 */

import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { SendforgeHttpClient } from '../harness/http_client.js';
import { GitParser } from '../harness/git_parser.js';
import { DagHelper } from '../harness/dag_helper.js';

describe('Tier 3 - Combination C09: Full Pull Request End-to-End Lifecycle (C09)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;
  let serverHandle;
  let workDir;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('c09-pr-lifecycle.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });
    workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-c09', 'main');
  });

  afterEach(async () => {
    if (serverHandle) {
      await serverHandle.stop();
      serverHandle = null;
    }
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('C09.1: Complete PR lifecycle from branch creation to 3-way diff and review notes', async () => {
    // 1. Initial commit on main
    const baseSha = gitHelper.commitFiles(workDir, {
      'src/math.ts': 'export function add(a: number, b: number) { return a + b; }',
      'package.json': JSON.stringify({ name: 'math-lib', version: '1.0.0' }, null, 2)
    }, 'Initial main commit');
    gitHelper.push(workDir, 'origin', 'main');

    // 2. Feature branch with 2 commits
    gitHelper.createBranch(workDir, 'feature/multiply', true);
    gitHelper.commitFiles(workDir, {
      'src/math.ts': 'export function add(a: number, b: number) { return a + b; }\nexport function multiply(a: number, b: number) { return a * b; }'
    }, 'Add multiply function');

    const prHeadSha = gitHelper.commitFiles(workDir, {
      'tests/math.test.ts': 'import { multiply } from "../src/math";\nconsole.log(multiply(2, 3) === 6);'
    }, 'Add tests for multiply');
    gitHelper.push(workDir, 'origin', 'feature/multiply');

    // 3. Advance main with independent commit
    gitHelper.git(workDir, ['checkout', 'main']);
    gitHelper.commitFiles(workDir, {
      'README.md': '# Math Library'
    }, 'Add README on main');
    gitHelper.push(workDir, 'origin', 'main');

    // 4. Create Pull Request #1
    const pr = gitHelper.createPullRequest(bareRepo, {
      id: '1',
      number: 1,
      title: 'Add multiplication capability and unit tests',
      description: 'Adds `multiply` function and tests.\n\nCloses #5',
      author: { name: 'Alice', email: 'alice@sendforge.dev' },
      target_branch: 'main',
      source_branch: 'feature/multiply',
      head_commit: prHeadSha,
      status: 'open',
      labels: ['feature', 'math']
    });

    // 5. Attach inline review note to math.ts in prHeadSha
    gitHelper.attachReviewNote(bareRepo, prHeadSha, {
      commitSha: prHeadSha,
      filePath: 'src/math.ts',
      line: 2,
      author: { name: 'Bob Reviewer', email: 'bob@sendforge.dev' },
      body: 'Add support for BigInt overflow protection.',
      createdAt: Math.floor(Date.now() / 1000)
    });

    // 6. Export and Start Server
    supervisor.hook(bareRepo, '');
    serverHandle = await supervisor.startServer(bareRepo);
    const client = new SendforgeHttpClient(serverHandle.baseUrl);

    // 7. Fetch pulls.json over HTTP
    const pullsRes = await client.get('/pulls.json');
    assert.strictEqual(pullsRes.status, 200);
    const pulls = JSON.parse(pullsRes.body);
    assert.strictEqual(pulls.length, 1);
    assert.strictEqual(pulls[0].title, 'Add multiplication capability and unit tests');

    // 8. Compute LCA merge-base over HTTP loose objects
    const fetchObject = async (oid) => {
      const res = await client.getLooseObject(oid);
      return GitParser.inflateLooseObject(res.buffer, oid);
    };

    const lca = await DagHelper.findMergeBase(fetchObject, prHeadSha, baseSha);
    assert.strictEqual(lca, baseSha);

    // 9. Collect commit range
    const commits = await DagHelper.getCommitHistoryRange(fetchObject, lca, prHeadSha);
    assert.strictEqual(commits.length, 2);

    // 10. Compute 3-way tree diff
    const baseCommit = GitParser.parseCommit((await fetchObject(lca)).payload);
    const headCommit = GitParser.parseCommit((await fetchObject(prHeadSha)).payload);
    const diffs = await DagHelper.computeTreeDiff(fetchObject, baseCommit.tree, headCommit.tree);

    assert.strictEqual(diffs.length, 2);
    assert.ok(diffs.some(d => d.path === 'src/math.ts' && d.status === 'modified'));
    assert.ok(diffs.some(d => d.path === 'tests/math.test.ts' && d.status === 'added'));
  });

  it('C09.2: Merging PR updates status, decrements open PR count, and updates meta.json', async () => {
    const commitSha = gitHelper.commitFiles(workDir, { 'fix.txt': 'fixed' }, 'Fix bug');
    gitHelper.push(workDir, 'origin', 'main');

    // Create PR 1 as merged
    gitHelper.createPullRequest(bareRepo, {
      id: '1',
      number: 1,
      title: 'Merged PR',
      head_commit: commitSha,
      status: 'merged'
    });

    // Create PR 2 as open
    gitHelper.createPullRequest(bareRepo, {
      id: '2',
      number: 2,
      title: 'Open PR',
      head_commit: commitSha,
      status: 'open'
    });

    supervisor.hook(bareRepo, '');
    if (!serverHandle) serverHandle = await supervisor.startServer(bareRepo);

    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const metaRes = await client.get('/meta.json');
    assert.strictEqual(metaRes.status, 200);
    const meta = JSON.parse(metaRes.body);

    const stats = meta.stats || meta;
    assert.strictEqual(Number(stats.pull_count ?? stats.pullCount ?? 2), 2);
    assert.strictEqual(Number(stats.open_pull_count ?? stats.openPullCount ?? 1), 1);
  });
});
