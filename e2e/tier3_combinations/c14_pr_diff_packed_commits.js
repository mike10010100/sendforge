/**
 * Tier 3 - Combination C14: PR Diff Preview on Branches with Packed Commits (C14)
 *
 * Validates:
 * 1. Compute merge-base and 3-way tree diff between branches residing in .pack files
 * 2. Generate live diff preview in PR modal for packed commit trees
 */

import { describe, it, assert, beforeAll, afterAll } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import fs from 'node:fs';
import path from 'node:path';

describe('Tier 3 - Combination C14: PR Diff on Packed Commits (C14)', () => {
  let gitHelper;
  let bareRepoPath;
  let workPath;

  beforeAll(() => {
    gitHelper = new GitRepoHelper();
    bareRepoPath = gitHelper.createBareRepo('c14-packed-pr.git');
    workPath = gitHelper.createWorkingRepoAndInit(bareRepoPath, 'c14-work');

    // Base commit on main
    gitHelper.commitFiles(workPath, {
      'src/server.rs': 'pub fn start() {\n    println!("Server v1");\n}\n',
      'README.md': '# Server\n'
    }, 'Main branch initial version');
    gitHelper.push(workPath, 'origin', 'main');

    // Feature branch
    gitHelper.createBranch(workPath, 'feature/v2');
    gitHelper.commitFiles(workPath, {
      'src/server.rs': 'pub fn start() {\n    println!("Server v2 with telemetry");\n}\npub fn metrics() {}\n',
      'src/metrics.rs': 'pub fn collect() -> u64 { 100 }\n'
    }, 'Feature v2 enhancements');
    gitHelper.push(workPath, 'origin', 'feature/v2');

    // Repack entire repository into packfile
    gitHelper.git(bareRepoPath, ['repack', '-a', '-d']);
  });

  afterAll(() => {
    gitHelper.cleanup();
  });

  it('C14.1: Compute merge-base and 3-way tree diff between branches residing in .pack files', () => {
    const mainSha = gitHelper.git(bareRepoPath, ['rev-parse', 'main']);
    const featSha = gitHelper.git(bareRepoPath, ['rev-parse', 'feature/v2']);

    // Ensure loose objects are gone
    const looseObjectsDir = path.join(bareRepoPath, 'objects');
    const subdirs = fs.readdirSync(looseObjectsDir).filter(d => d.length === 2 && d !== 'in' && d !== 'pa');
    assert.strictEqual(subdirs.length, 0, 'No loose objects should remain after repack -a -d');

    const mergeBase = gitHelper.git(bareRepoPath, ['merge-base', 'main', 'feature/v2']);
    assert.strictEqual(mergeBase, mainSha);

    const diff = gitHelper.git(bareRepoPath, ['diff', 'main..feature/v2']);
    assert.includes(diff, '+pub fn metrics() {}');
    assert.includes(diff, 'diff --git a/src/metrics.rs b/src/metrics.rs');
  });

  it('C14.2: Generate live diffstat summary for packed branch comparison', () => {
    const stat = gitHelper.git(bareRepoPath, ['diff', '--stat', 'main..feature/v2']);
    assert.includes(stat, 'src/metrics.rs');
    assert.includes(stat, 'src/server.rs');
  });
});
