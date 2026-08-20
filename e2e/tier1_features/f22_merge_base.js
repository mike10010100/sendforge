/**
 * Tier 1 - Feature 22: In-Browser DAG Merge-Base & LCA Engine (F22 / R2)
 * Tests Lowest Common Ancestor (LCA) resolution, commit history range collection,
 * and 3-way tree diffing across diverse Git DAG topologies.
 */

import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { SendforgeHttpClient } from '../harness/http_client.js';
import { GitParser } from '../harness/git_parser.js';
import { DagHelper } from '../harness/dag_helper.js';

describe('Tier 1 - Feature 22: In-Browser DAG Merge-Base & LCA Engine (F22 / R2)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;
  let serverHandle;
  let workDir;

  beforeEach(async () => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('f22-merge-base.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });
    workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-f22', 'main');
  });

  afterEach(async () => {
    if (serverHandle) await serverHandle.stop();
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('T1.22.1: Simple fork LCA resolution matches branching base commit', async () => {
    const topo = gitHelper.createMergeBaseTopology(workDir, 'simple_fork');
    gitHelper.push(workDir, 'origin', 'main');
    gitHelper.push(workDir, 'origin', 'feature');

    serverHandle = await supervisor.startServer(bareRepo);
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const fetchObject = async (oid) => {
      const res = await client.getLooseObject(oid);
      return GitParser.inflateLooseObject(res.buffer, oid);
    };

    const lca = await DagHelper.findMergeBase(fetchObject, topo.featureTip, topo.mainTip);
    assert.strictEqual(lca, topo.baseSha, 'LCA must match the common base commit');

    // Verify against native Git oracle
    const gitOracle = gitHelper.git(workDir, ['merge-base', topo.featureTip, topo.mainTip]);
    assert.strictEqual(lca, gitOracle, 'In-harness LCA must match native git merge-base oracle');
  });

  it('T1.22.2: Divergent branches with multiple commits resolve correct LCA', async () => {
    const topo = gitHelper.createMergeBaseTopology(workDir, 'divergent');
    gitHelper.push(workDir, 'origin', 'main');
    gitHelper.push(workDir, 'origin', 'feature');

    serverHandle = await supervisor.startServer(bareRepo);
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const fetchObject = async (oid) => {
      const res = await client.getLooseObject(oid);
      return GitParser.inflateLooseObject(res.buffer, oid);
    };

    const lca = await DagHelper.findMergeBase(fetchObject, topo.featureTip, topo.mainTip);
    assert.strictEqual(lca, topo.baseSha);

    const gitOracle = gitHelper.git(workDir, ['merge-base', topo.featureTip, topo.mainTip]);
    assert.strictEqual(lca, gitOracle);
  });

  it('T1.22.3: Fast-forward branch resolves target tip as LCA', async () => {
    const topo = gitHelper.createMergeBaseTopology(workDir, 'fast_forward');
    gitHelper.push(workDir, 'origin', 'main');
    gitHelper.push(workDir, 'origin', 'feature');

    serverHandle = await supervisor.startServer(bareRepo);
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const fetchObject = async (oid) => {
      const res = await client.getLooseObject(oid);
      return GitParser.inflateLooseObject(res.buffer, oid);
    };

    const lca = await DagHelper.findMergeBase(fetchObject, topo.featureTip, topo.mainTip);
    assert.strictEqual(lca, topo.mainTip, 'LCA of fast-forward must be the base branch tip');

    const gitOracle = gitHelper.git(workDir, ['merge-base', topo.featureTip, topo.mainTip]);
    assert.strictEqual(lca, gitOracle);
  });

  it('T1.22.4: Criss-cross merge topology resolves topological LCA', async () => {
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
    assert.ok(lca !== null, 'LCA must not be null for connected criss-cross');
    assert.ok(topo.candidates.includes(lca), `LCA ${lca} must be one of the candidate common ancestors: ${topo.candidates.join(', ')}`);

    const gitOracle = gitHelper.git(workDir, ['merge-base', topo.branchASha, topo.branchBSha]);
    assert.strictEqual(lca, gitOracle);
  });

  it('T1.22.5: Disconnected orphan branches return null merge base', async () => {
    const topo = gitHelper.createMergeBaseTopology(workDir, 'orphan');
    gitHelper.push(workDir, 'origin', 'main');
    gitHelper.push(workDir, 'origin', 'orphan-branch');

    serverHandle = await supervisor.startServer(bareRepo);
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const fetchObject = async (oid) => {
      const res = await client.getLooseObject(oid);
      return GitParser.inflateLooseObject(res.buffer, oid);
    };

    const lca = await DagHelper.findMergeBase(fetchObject, topo.featureTip, topo.mainTip);
    assert.strictEqual(lca, null, 'Disjoint histories must return null merge base');
  });

  it('T1.22.6: Commit history range mergeBase..head returns chronological PR commits', async () => {
    const topo = gitHelper.createMergeBaseTopology(workDir, 'divergent');
    gitHelper.push(workDir, 'origin', 'main');
    gitHelper.push(workDir, 'origin', 'feature');

    serverHandle = await supervisor.startServer(bareRepo);
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const fetchObject = async (oid) => {
      const res = await client.getLooseObject(oid);
      return GitParser.inflateLooseObject(res.buffer, oid);
    };

    const commits = await DagHelper.getCommitHistoryRange(fetchObject, topo.baseSha, topo.featureTip);
    // In divergent topology, feature branch has 3 commits after base (Feat A, Feat B, Feat C)
    assert.strictEqual(commits.length, 3, 'Must return exactly 3 feature branch commits');

    const summaries = commits.map(c => c.summary);
    assert.ok(summaries.includes('Feat A'));
    assert.ok(summaries.includes('Feat B'));
    assert.ok(summaries.includes('Feat C'));

    // Should NOT include main branch advance commits
    assert.ok(!summaries.includes('Main 1'));
    assert.ok(!summaries.includes('Main 2'));
    assert.ok(!summaries.includes('Base commit'));
  });
});
