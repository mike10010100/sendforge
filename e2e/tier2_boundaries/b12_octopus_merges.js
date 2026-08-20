/**
 * Tier 2 - Boundary B12: Octopus Merges (3+ Parent Commits)
 * Tests parsing and static fallback generation for Git merge commits with 3 or more parents.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { GitParser } from '../harness/git_parser.js';

describe('Tier 2 - Boundary B12: Octopus Merges (3+ Parent Hashes) (B12)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('b12-octopus.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });
  });

  afterEach(() => {
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('B12.1: Creates and parses an octopus merge commit with 3 parent hashes', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-octopus', 'main');
    const cBase = gitHelper.commitFiles(workDir, { 'base.txt': 'base' }, 'Base commit');

    // Branch 1
    gitHelper.createBranch(workDir, 'feat-1');
    const c1 = gitHelper.commitFiles(workDir, { 'f1.txt': 'feat 1' }, 'Feat 1');

    // Branch 2
    gitHelper.git(workDir, ['checkout', 'main']);
    gitHelper.createBranch(workDir, 'feat-2');
    const c2 = gitHelper.commitFiles(workDir, { 'f2.txt': 'feat 2' }, 'Feat 2');

    // Branch 3
    gitHelper.git(workDir, ['checkout', 'main']);
    gitHelper.createBranch(workDir, 'feat-3');
    const c3 = gitHelper.commitFiles(workDir, { 'f3.txt': 'feat 3' }, 'Feat 3');

    // Octopus merge into main
    const mergeSha = gitHelper.createOctopusMerge(workDir, 'main', ['feat-1', 'feat-2', 'feat-3'], 'Merge 3 feature branches');
    gitHelper.push(workDir, 'origin', 'main');

    const obj = gitHelper.readLooseObject(bareRepo, mergeSha);
    assert.strictEqual(obj.type, 'commit');

    const parsed = GitParser.parseCommit(obj.payload);
    assert.strictEqual(parsed.parents.length, 3, 'Octopus merge commit must have 3 parents');
    assert.includes(parsed.parents, c1);
    assert.includes(parsed.parents, c2);
    assert.includes(parsed.parents, c3);

    // Verify static log.html generated
    const logHtml = fs.readFileSync(path.join(bareRepo, 'static', 'log.html'), 'utf-8');
    assert.includes(logHtml, 'Merge 3 feature branches');
  });
});
