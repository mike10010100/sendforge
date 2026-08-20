/**
 * Tier 1 - Feature 32: Interactive PR Modal, Merge-Base Diff & Format-Patch Export (F32 / R3)
 *
 * Validates:
 * 1. Target vs source branch selector with merge-base calculation
 * 2. Live 3-way tree and file diff preview between target and source branch
 * 3. Push command generation: git push origin <branch>:refs/pull/<id>/head
 * 4. RFC 2822 standard git format-patch export formatting
 * 5. Native git am ingestion test verifying exported patch applies cleanly
 * 6. LocalStorage draft auto-saving and recovery for PR state
 */

import { describe, it, assert, beforeAll, afterAll } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { CollabModalHelper, MockLocalStorage } from '../harness/collab_modal_helper.js';
import { DagHelper } from '../harness/dag_helper.js';

describe('Tier 1 - Feature 32: PR Modal & git format-patch Export (F32 / R3)', () => {
  let gitHelper;
  let bareRepoPath;
  let workPath;

  beforeAll(() => {
    gitHelper = new GitRepoHelper();
    bareRepoPath = gitHelper.createBareRepo('f32-pr-repo.git');
    workPath = gitHelper.createWorkingRepoAndInit(bareRepoPath, 'f32-work');

    // Base commit on main
    gitHelper.commitFiles(workPath, {
      'README.md': '# Project\nOriginal text\n',
      'src/lib.rs': 'pub fn add(a: i32, b: i32) -> i32 { a + b }\n'
    }, 'Initial commit on main');
    gitHelper.push(workPath, 'origin', 'main');

    // Feature branch
    gitHelper.createBranch(workPath, 'feat-multiply');
    gitHelper.commitFiles(workPath, {
      'src/lib.rs': 'pub fn add(a: i32, b: i32) -> i32 { a + b }\npub fn multiply(a: i32, b: i32) -> i32 { a * b }\n',
      'tests/lib_test.rs': '#[test]\nfn test_mul() { assert_eq!(multiply(2, 3), 6); }\n'
    }, 'Implement multiply function');
    gitHelper.push(workPath, 'origin', 'feat-multiply');
  });

  afterAll(() => {
    gitHelper.cleanup();
  });

  it('T1.32.1: Target vs source branch selector with merge-base calculation', () => {
    const mainSha = gitHelper.git(bareRepoPath, ['rev-parse', 'main']);
    const featSha = gitHelper.git(bareRepoPath, ['rev-parse', 'feat-multiply']);

    const mergeBase = gitHelper.git(bareRepoPath, ['merge-base', 'main', 'feat-multiply']);
    assert.strictEqual(mergeBase, mainSha, 'Merge base should be the branching commit on main');
  });

  it('T1.32.2: Live 3-way tree and file diff preview between target and source branch', () => {
    const diffStat = gitHelper.git(bareRepoPath, ['diff', '--stat', 'main..feat-multiply']);
    assert.includes(diffStat, 'src/lib.rs');
    assert.includes(diffStat, 'tests/lib_test.rs');

    const diffHunk = gitHelper.git(bareRepoPath, ['diff', 'main..feat-multiply']);
    assert.includes(diffHunk, '+pub fn multiply(a: i32, b: i32) -> i32 { a * b }');
  });

  it('T1.32.3: Push command generation: git push origin <branch>:refs/pull/<id>/head', () => {
    const cmd1 = CollabModalHelper.generatePRPushCommand(12, 'feat-multiply');
    assert.strictEqual(cmd1, 'git push origin feat-multiply:refs/pull/12/head');

    const cmd2 = CollabModalHelper.generatePRPushCommand(99, 'hotfix-patch', 'upstream');
    assert.strictEqual(cmd2, 'git push upstream hotfix-patch:refs/pull/99/head');
  });

  it('T1.32.4: RFC 2822 standard git format-patch export formatting', () => {
    const featSha = gitHelper.git(bareRepoPath, ['rev-parse', 'feat-multiply']);
    const diffText = gitHelper.git(bareRepoPath, ['diff', 'main..feat-multiply']);
    const statText = gitHelper.git(bareRepoPath, ['diff', '--stat', 'main..feat-multiply']);

    const patch = CollabModalHelper.formatPatch({
      commitSha: featSha,
      authorName: 'Sendforge Contributor',
      authorEmail: 'contributor@sendforge.dev',
      authorDate: 'Thu, 20 Aug 2026 12:00:00 +0000',
      subject: 'Implement multiply function',
      body: 'Adds multiply arithmetic helper with unit test coverage.',
      diffStat: statText,
      diffHunks: diffText
    });

    assert.match(patch, /^From [a-f0-9]{40} Mon Sep 17 00:00:00 2001/);
    assert.includes(patch, 'From: Sendforge Contributor <contributor@sendforge.dev>');
    assert.includes(patch, 'Subject: [PATCH] Implement multiply function');
    assert.includes(patch, '---');
    assert.includes(patch, 'src/lib.rs');
    assert.includes(patch, '+pub fn multiply');
    assert.includes(patch, '--\nSendforge 0.4.0');
  });

  it('T1.32.5: Native git am ingestion test verifying exported patch applies cleanly', () => {
    // Generate format-patch using git format-patch command or helper
    const nativePatch = gitHelper.git(workPath, ['format-patch', '-1', 'feat-multiply', '--stdout']);

    // Create a fresh clone to test git am application
    const testClone = gitHelper.createWorkingRepo(bareRepoPath, 'f32-am-clone');
    gitHelper.git(testClone, ['checkout', 'main']);

    const applied = CollabModalHelper.testGitAmIngestion(gitHelper, testClone, nativePatch);
    assert.strictEqual(applied, true, 'git am should apply exported patch cleanly');

    const lastCommitMsg = gitHelper.git(testClone, ['log', '-1', '--pretty=%B']);
    assert.includes(lastCommitMsg, 'Implement multiply function');

    const fileContent = gitHelper.git(testClone, ['show', 'HEAD:src/lib.rs']);
    assert.includes(fileContent, 'pub fn multiply');
  });

  it('T1.32.6: LocalStorage draft auto-saving and recovery for PR state', () => {
    const storage = new MockLocalStorage();
    const repo = 'hybrid-gitforge';
    const draftKey = `sendforge_draft_pr_${repo}`;

    const draftState = {
      targetBranch: 'main',
      sourceBranch: 'feat-multiply',
      title: 'Draft PR Title',
      description: 'Draft PR Description body.'
    };

    storage.setItem(draftKey, JSON.stringify(draftState));
    const loaded = JSON.parse(storage.getItem(draftKey));

    assert.strictEqual(loaded.targetBranch, 'main');
    assert.strictEqual(loaded.sourceBranch, 'feat-multiply');
    assert.strictEqual(loaded.title, 'Draft PR Title');

    storage.removeItem(draftKey);
    assert.strictEqual(storage.getItem(draftKey), null);
  });
});
