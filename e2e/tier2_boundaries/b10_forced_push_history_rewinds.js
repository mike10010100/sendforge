/**
 * Tier 2 - Boundary B10: Forced Push History Rewinds
 * Tests non-fast-forward push rewriting branch history and updating all static metadata.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';

describe('Tier 2 - Boundary B10: Forced Push History Rewinds (B10)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('b10-force.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });
  });

  afterEach(() => {
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('B10.1: Non-fast-forward force push updates HEAD, meta.json, and static fallbacks', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-force', 'main');
    const c1 = gitHelper.commitFiles(workDir, { 'README.md': '# Initial 1' }, 'Commit 1');
    const c2 = gitHelper.commitFiles(workDir, { 'README.md': '# Branch A 2' }, 'Commit 2A');
    gitHelper.push(workDir, 'origin', 'main');

    // Reset back to c1 and make an alternate commit 2B
    gitHelper.git(workDir, ['reset', '--hard', c1]);
    const c2B = gitHelper.commitFiles(workDir, { 'README.md': '# Rewritten History 2B' }, 'Commit 2B');

    // Force push
    gitHelper.push(workDir, 'origin', 'main', ['--force']);

    const meta = JSON.parse(fs.readFileSync(path.join(bareRepo, 'static', 'meta.json'), 'utf-8'));
    assert.strictEqual(meta.head.sha, c2B, 'meta.json head sha must be updated to force-pushed commit');

    const html = fs.readFileSync(path.join(bareRepo, 'static', 'index.html'), 'utf-8');
    assert.includes(html, 'Rewritten History 2B');
  });
});
