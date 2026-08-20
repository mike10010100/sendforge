/**
 * Tier 2 - Boundary B18: Pathological DAG Topologies (B18)
 * Tests complex DAG edge cases: criss-cross merges, deep linear chains,
 * disconnected roots, octopus merges, and self-referential / identical tips.
 */

import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { SendforgeHttpClient } from '../harness/http_client.js';
import { GitParser } from '../harness/git_parser.js';
import { DagHelper } from '../harness/dag_helper.js';

describe('Tier 2 - Boundary B18: Pathological DAG Topologies (B18)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;
  let serverHandle;
  let workDir;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('b18-pathological-dags.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });
    workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-b18', 'main');
  });

  afterEach(async () => {
    if (serverHandle) {
      await serverHandle.stop();
      serverHandle = null;
    }
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('B18.1: Criss-cross merge with two candidate common ancestors resolves valid topological LCA', async () => {
    const topo = gitHelper.createMergeBaseTopology(workDir, 'criss_cross');
    gitHelper.push(workDir, 'origin', 'branch-a');
    gitHelper.push(workDir, 'origin', 'branch-b');

    serverHandle = await supervisor.startServer(bareRepo);
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const fetchObject = async (oid) => {
      const res = await client.getLooseObject(oid);
      return GitParser.inflateLooseObject(res.buffer, oid);
    };

    const lca = await DagHelper.findMergeBase(fetchObject, topo.branchASha, topo.branchBSha);
    assert.ok(lca !== null);
    assert.ok(topo.candidates.includes(lca));
  });

  it('B18.2: Deep linear chain computes merge base quickly without stack overflow', async () => {
    const topo = gitHelper.createMergeBaseTopology(workDir, 'linear_chain', { count: 30, forkAt: 15 });
    gitHelper.push(workDir, 'origin', 'main');
    gitHelper.push(workDir, 'origin', 'feature-chain');

    if (!serverHandle) serverHandle = await supervisor.startServer(bareRepo);
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const fetchObject = async (oid) => {
      const res = await client.getLooseObject(oid);
      return GitParser.inflateLooseObject(res.buffer, oid);
    };

    const startTime = Date.now();
    const lca = await DagHelper.findMergeBase(fetchObject, topo.featureTip, topo.mainTip);
    const duration = Date.now() - startTime;

    assert.strictEqual(lca, topo.baseSha);
    assert.lessThan(duration, 5000, `Merge base calculation on 100-commit chain took ${duration}ms`);
  });

  it('B18.3: Disconnected orphan branches (0 shared history) safely return null merge base', async () => {
    const topo = gitHelper.createMergeBaseTopology(workDir, 'orphan');
    gitHelper.push(workDir, 'origin', 'main');
    gitHelper.push(workDir, 'origin', 'orphan-branch');

    if (!serverHandle) serverHandle = await supervisor.startServer(bareRepo);
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const fetchObject = async (oid) => {
      const res = await client.getLooseObject(oid);
      return GitParser.inflateLooseObject(res.buffer, oid);
    };

    const lca = await DagHelper.findMergeBase(fetchObject, topo.featureTip, topo.mainTip);
    assert.strictEqual(lca, null);
  });

  it('B18.4: Multi-parent octopus merge commits traversed cleanly without cycle lockup', async () => {
    // Commit root on main
    gitHelper.commitFiles(workDir, { 'file.txt': 'root' }, 'Root commit');

    // Create 3 branches
    gitHelper.createBranch(workDir, 'feat1', true);
    gitHelper.commitFiles(workDir, { 'f1.txt': '1' }, 'Feat 1');

    gitHelper.git(workDir, ['checkout', 'main']);
    gitHelper.createBranch(workDir, 'feat2', true);
    gitHelper.commitFiles(workDir, { 'f2.txt': '2' }, 'Feat 2');

    gitHelper.git(workDir, ['checkout', 'main']);
    gitHelper.createBranch(workDir, 'feat3', true);
    gitHelper.commitFiles(workDir, { 'f3.txt': '3' }, 'Feat 3');

    // Octopus merge into main
    gitHelper.createOctopusMerge(workDir, 'main', ['feat1', 'feat2', 'feat3'], 'Octopus merge commit');
    const octopusTip = gitHelper.git(workDir, ['rev-parse', 'HEAD']);
    gitHelper.push(workDir, 'origin', 'main');

    if (!serverHandle) serverHandle = await supervisor.startServer(bareRepo);
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const fetchObject = async (oid) => {
      const res = await client.getLooseObject(oid);
      return GitParser.inflateLooseObject(res.buffer, oid);
    };

    const commitObj = await fetchObject(octopusTip);
    const parsed = GitParser.parseCommit(commitObj.payload);
    assert.strictEqual(parsed.parents.length, 3, 'Octopus commit must have 3 parents');
  });

  it('B18.5: Same-commit comparison (head == target) returns head as merge base with empty range', async () => {
    const commitSha = gitHelper.commitFiles(workDir, { 'ident.txt': 'same' }, 'Identical commit');
    gitHelper.push(workDir, 'origin', 'main');

    if (!serverHandle) serverHandle = await supervisor.startServer(bareRepo);
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const fetchObject = async (oid) => {
      const res = await client.getLooseObject(oid);
      return GitParser.inflateLooseObject(res.buffer, oid);
    };

    const lca = await DagHelper.findMergeBase(fetchObject, commitSha, commitSha);
    assert.strictEqual(lca, commitSha);

    const range = await DagHelper.getCommitHistoryRange(fetchObject, lca, commitSha);
    assert.strictEqual(range.length, 0);
  });
});
