/**
 * Tier 3 - Combination C17: Format-Patch Across Packed Commits with git am Ingestion (C17)
 *
 * Validates:
 * 1. Export multi-commit git format-patch from packed branches and apply cleanly via git am
 * 2. Single-commit format-patch export for OFS-delta packed commit applied via git am
 */

import { describe, it, assert, beforeAll, afterAll } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { CollabModalHelper } from '../harness/collab_modal_helper.js';

describe('Tier 3 - Combination C17: Format-Patch Packed & git am (C17)', () => {
  let gitHelper;
  let bareRepoPath;
  let workPath;

  beforeAll(() => {
    gitHelper = new GitRepoHelper();
    bareRepoPath = gitHelper.createBareRepo('c17-packed-am.git');
    workPath = gitHelper.createWorkingRepoAndInit(bareRepoPath, 'c17-work');

    gitHelper.commitFiles(workPath, {
      'src/math.rs': 'pub fn add(a: i32, b: i32) -> i32 { a + b }\n'
    }, 'Initial math lib');
    gitHelper.push(workPath, 'origin', 'main');

    // Branch 1
    gitHelper.createBranch(workPath, 'patch-series');
    gitHelper.commitFiles(workPath, {
      'src/math.rs': 'pub fn add(a: i32, b: i32) -> i32 { a + b }\npub fn sub(a: i32, b: i32) -> i32 { a - b }\n'
    }, 'Add sub function');

    gitHelper.commitFiles(workPath, {
      'src/math.rs': 'pub fn add(a: i32, b: i32) -> i32 { a + b }\npub fn sub(a: i32, b: i32) -> i32 { a - b }\npub fn mul(a: i32, b: i32) -> i32 { a * b }\n'
    }, 'Add mul function');
    gitHelper.push(workPath, 'origin', 'patch-series');

    // Repack bare repo
    gitHelper.git(bareRepoPath, ['repack', '-a', '-d']);
  });

  afterAll(() => {
    gitHelper.cleanup();
  });

  it('C17.1: Export multi-commit git format-patch from packed branches and apply cleanly via git am', () => {
    // Generate patch series (2 patches)
    const patches = gitHelper.git(workPath, ['format-patch', 'main..patch-series', '--stdout']);
    assert.includes(patches, 'Subject: [PATCH 1/2] Add sub function');
    assert.includes(patches, 'Subject: [PATCH 2/2] Add mul function');

    // Apply to fresh clone of main
    const targetClone = gitHelper.createWorkingRepo(bareRepoPath, 'c17-target-clone');
    gitHelper.git(targetClone, ['checkout', 'main']);

    const applied = CollabModalHelper.testGitAmIngestion(gitHelper, targetClone, patches);
    assert.strictEqual(applied, true, 'Patch series should apply cleanly with git am');

    const fileContent = gitHelper.git(targetClone, ['show', 'HEAD:src/math.rs']);
    assert.includes(fileContent, 'pub fn mul');
    assert.includes(fileContent, 'pub fn sub');
  });

  it('C17.2: Single-commit format-patch export for packed commit applied via git am', () => {
    const singlePatch = gitHelper.git(workPath, ['format-patch', '-1', 'patch-series~1', '--stdout']);
    assert.includes(singlePatch, 'Subject: [PATCH] Add sub function');

    const freshClone = gitHelper.createWorkingRepo(bareRepoPath, 'c17-single-clone');
    gitHelper.git(freshClone, ['checkout', 'main']);

    const applied = CollabModalHelper.testGitAmIngestion(gitHelper, freshClone, singlePatch);
    assert.strictEqual(applied, true);

    const fileContent = gitHelper.git(freshClone, ['show', 'HEAD:src/math.rs']);
    assert.includes(fileContent, 'pub fn sub');
  });
});
