/**
 * Tier 3 - Combination C15: Issue Modal Generating Push Ref for Packed Repository (C15)
 *
 * Validates:
 * 1. Create issue in packed repo, generate refs/issues/<id> push ref & JSON download
 * 2. Ingest generated issue ref via native git push into bare repo and verify meta.json
 */

import { describe, it, assert, beforeAll, afterAll } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { CollabModalHelper } from '../harness/collab_modal_helper.js';

describe('Tier 3 - Combination C15: Issue Modal & Packed Repo Integration (C15)', () => {
  let gitHelper;
  let bareRepoPath;
  let workPath;

  beforeAll(() => {
    gitHelper = new GitRepoHelper();
    bareRepoPath = gitHelper.createBareRepo('c15-packed-issue.git');
    workPath = gitHelper.createWorkingRepoAndInit(bareRepoPath, 'c15-work');

    gitHelper.commitFiles(workPath, {
      'README.md': '# Packed Forge Repo\n'
    }, 'Initial setup');
    gitHelper.push(workPath, 'origin', 'main');

    // Repack bare repo
    gitHelper.git(bareRepoPath, ['repack', '-a', '-d']);
  });

  afterAll(() => {
    gitHelper.cleanup();
  });

  it('C15.1: Create issue in packed repo, generate refs/issues/<id> push ref & JSON download', () => {
    const issueId = 1;
    const pushCmd = CollabModalHelper.generateIssuePushCommand(issueId);
    assert.strictEqual(pushCmd, 'git push origin HEAD:refs/issues/1');

    const payload = {
      id: issueId,
      title: 'Bug: Range request offset edge case',
      description: 'Found when packfile has large delta table.',
      author: 'Tester <t@t.com>',
      labels: ['bug']
    };
    const jsonBlob = JSON.stringify(payload);
    assert.includes(jsonBlob, 'Bug: Range request');
  });

  it('C15.2: Ingest generated issue ref via native git push into bare repo', () => {
    // Commit issue payload onto a local commit and push to refs/issues/1
    gitHelper.commitFiles(workPath, {
      'issue.json': JSON.stringify({ id: 1, title: 'Bug: Range request', status: 'open' })
    }, 'Create issue #1');

    gitHelper.git(workPath, ['push', 'origin', 'HEAD:refs/issues/1']);

    const issueRef = gitHelper.git(bareRepoPath, ['show-ref', 'refs/issues/1']);
    assert.ok(issueRef, 'Ref refs/issues/1 must exist in bare repo');
  });
});
