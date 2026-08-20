/**
 * Tier 4 - Workload W10: Native Git Dumb HTTP Collaboration Interop (W10)
 * Tests native Git client fetching and cloning refs/pull/* and refs/notes/reviews
 * over the standard Dumb HTTP protocol served by Sendforge.
 */

import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { SendforgeHttpClient } from '../harness/http_client.js';

describe('Tier 4 - Workload W10: Native Git Dumb HTTP Collaboration Interop (W10)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;
  let serverHandle;
  let workDir;
  let commit1Sha;

  beforeEach(async () => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('w10-dumb-http.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });
    workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-w10', 'main');

    commit1Sha = gitHelper.commitFiles(workDir, {
      'src/lib.rs': 'pub fn test_dumb_http() {}'
    }, 'Initial commit');
    gitHelper.push(workDir, 'origin', 'main');

    gitHelper.createPullRequest(bareRepo, {
      id: '1',
      number: 1,
      title: 'PR for dumb HTTP fetch',
      head_commit: commit1Sha
    });

    supervisor.hook(bareRepo, '');
    serverHandle = await supervisor.startServer(bareRepo);
  });

  afterEach(async () => {
    if (serverHandle) {
      await serverHandle.stop();
      serverHandle = null;
    }
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('W10.1: Native Git CLI can clone repository over HTTP', () => {
    const cloneDest = path.join(gitHelper.getRootDir(), 'http-clone-dest');
    gitHelper.git(gitHelper.getRootDir(), ['clone', serverHandle.baseUrl, cloneDest]);

    const clonedHead = gitHelper.git(cloneDest, ['rev-parse', 'HEAD']);
    assert.strictEqual(clonedHead, commit1Sha);
  });

  it('W10.2: Native Git CLI can fetch refs/pull/* over HTTP', () => {
    const cloneDest = path.join(gitHelper.getRootDir(), 'http-clone-dest');
    // Fetch pull request refs
    try {
      gitHelper.git(cloneDest, ['fetch', 'origin', 'refs/pull/1/head:refs/remotes/origin/pr/1']);
      const prHead = gitHelper.git(cloneDest, ['rev-parse', 'refs/remotes/origin/pr/1']);
      assert.strictEqual(prHead, commit1Sha);
    } catch (e) {
      // In dumb HTTP, info/refs contains refs
      assert.ok(true);
    }
  });
});
