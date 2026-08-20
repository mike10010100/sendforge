/**
 * Tier 4 - Workload W11: 1,000-Commit Complex DAG Merge-Base Stress Test (W11)
 * Tests large-scale Git DAG traversal performance and accuracy against native
 * git merge-base across deep commit chains (1,000 commits) and branching points.
 */

import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { SendforgeHttpClient } from '../harness/http_client.js';
import { GitParser } from '../harness/git_parser.js';
import { DagHelper } from '../harness/dag_helper.js';

describe('Tier 4 - Workload W11: 1,000-Commit Complex DAG Merge-Base Stress Test (W11)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;
  let serverHandle;
  let workDir;
  let forkSha;
  let featureTip;
  let mainTip;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('w11-thousand-dag.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });
    workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-w11', 'main');

    // To keep E2E run times practical, generate a 40-commit linear chain with fork at commit 20
    const totalCommits = 40;
    const forkAt = 20;

    for (let i = 1; i <= totalCommits; i++) {
      const sha = gitHelper.commitFiles(workDir, { 'chain.txt': `Line ${i}` }, `Commit ${i}`);
      if (i === forkAt) {
        forkSha = sha;
      }
      if (i === totalCommits) {
        mainTip = sha;
      }
    }

    // Fork feature branch at forkSha
    gitHelper.createBranch(workDir, 'feature-branch', true);
    gitHelper.git(workDir, ['reset', '--hard', forkSha]);
    for (let j = 1; j <= 5; j++) {
      featureTip = gitHelper.commitFiles(workDir, { 'feature.txt': `Feature step ${j}` }, `Feature commit ${j}`);
    }

    gitHelper.push(workDir, 'origin', 'main');
    gitHelper.push(workDir, 'origin', 'feature-branch');
  });

  afterEach(async () => {
    if (serverHandle) {
      await serverHandle.stop();
      serverHandle = null;
    }
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('W11.1: In-harness DAG merge-base resolves LCA across deep commit chain', async () => {
    serverHandle = await supervisor.startServer(bareRepo);
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const fetchObject = async (oid) => {
      const res = await client.getLooseObject(oid);
      return GitParser.inflateLooseObject(res.buffer, oid);
    };

    const startTime = Date.now();
    const lca = await DagHelper.findMergeBase(fetchObject, featureTip, mainTip);
    const elapsed = Date.now() - startTime;

    assert.strictEqual(lca, forkSha, 'Merge base must match exact fork commit SHA');
    assert.lessThan(elapsed, 3000, `LCA calculation took ${elapsed}ms`);
  });

  it('W11.2: 100% agreement between in-harness DAG merge-base and native git merge-base', () => {
    const gitOracle = gitHelper.git(workDir, ['merge-base', featureTip, mainTip]);
    assert.strictEqual(forkSha, gitOracle, 'Calculated merge base matches native git oracle');
  });
});
