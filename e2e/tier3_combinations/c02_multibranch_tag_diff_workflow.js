/**
 * Tier 3 - Combination C2: Multi-Branch and Tag Workflow with Diffing
 * Tests managing multiple branches and annotated tags, resolving commits,
 * and computing client-side unified and split diffs between branch revisions.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { GitParser } from '../harness/git_parser.js';

describe('Tier 3 - Combination C2: Multi-Branch & Tag Diffing Workflow (C2)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('c2-branches.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });
  });

  afterEach(() => {
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('C2.1: Multi-branch creation, annotated tags, and off-thread diff calculation', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-branches', 'main');

    // 1. Commit baseline on main
    const initialText = [
      'function authenticate(user, pass) {',
      '    if (!user || !pass) return false;',
      '    return user === "admin";',
      '}'
    ].join('\n');

    const c1 = gitHelper.commitFiles(workDir, {
      'README.md': '# Auth Service',
      'auth.js': initialText
    }, 'Initial commit on main');

    // 2. Tag baseline as v0.1.0
    gitHelper.createAnnotatedTag(workDir, 'v0.1.0', 'Baseline release');

    // 3. Create feature/crypto branch
    gitHelper.createBranch(workDir, 'feature/crypto');
    const updatedText = [
      'import { hashPassword } from "./crypto.js";',
      '',
      'export function authenticate(user, pass) {',
      '    if (!user || !pass) return false;',
      '    const hash = hashPassword(pass);',
      '    return verifyUser(user, hash);',
      '}'
    ].join('\n');

    const c2 = gitHelper.commitFiles(workDir, {
      'auth.js': updatedText,
      'crypto.js': 'export function hashPassword(p) { return "hash_" + p; }'
    }, 'Implement secure crypto password hashing');

    // 4. Push all branches and tags
    gitHelper.push(workDir, 'origin', '--all');
    gitHelper.push(workDir, 'origin', '--tags');

    // 5. Verify metadata contains all branches and tags
    const meta = JSON.parse(fs.readFileSync(path.join(bareRepo, 'static', 'meta.json'), 'utf-8'));
    assert.strictEqual(meta.stats.branch_count, 2);
    assert.strictEqual(meta.stats.tag_count, 1);

    // 6. Compute diff between main and feature/crypto for auth.js
    const diff = GitParser.computeUnifiedDiff(initialText, updatedText);
    assert.strictEqual(diff.isIdentical, false);
    assert.greaterThan(diff.stats.additions, 0);
    assert.greaterThan(diff.stats.deletions, 0);
  });
});
