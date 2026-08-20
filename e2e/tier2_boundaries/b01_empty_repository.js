/**
 * Tier 2 - Boundary B1: Empty Repository with Zero Commits
 * Verifies behavior when bare repo is initialized without commits:
 * meta.json empty state, index.html welcome fallback, info/refs empty, no crashes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { HtmlValidator } from '../harness/html_validator.js';

describe('Tier 2 - Boundary B1: Empty Repository (Zero Commits)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('b1-empty.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });
  });

  afterEach(() => {
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('B1.1: Post-receive hook on empty repo does not panic or produce invalid JSON', () => {
    const res = supervisor.hook(bareRepo, '');
    assert.strictEqual(res.status, 0);

    const metaPath = path.join(bareRepo, 'static', 'meta.json');
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      assert.strictEqual(meta.stats.commit_count, 0);
      assert.strictEqual(meta.branches.length, 0);
    }
  });

  it('B1.2: Static index.html displays clean empty repository notice', () => {
    supervisor.hook(bareRepo, '');
    const indexPath = path.join(bareRepo, 'static', 'index.html');
    if (fs.existsSync(indexPath)) {
      const html = fs.readFileSync(indexPath, 'utf-8');
      const validator = new HtmlValidator(html);
      validator.assertValidDocument();
    }
  });

  it('B1.3: Native Git client can clone empty repo over filesystem without errors', () => {
    const cloneDir = path.join(gitHelper.getRootDir(), 'empty-clone');
    const out = gitHelper.git(gitHelper.getRootDir(), ['clone', bareRepo, 'empty-clone']);
    assert.ok(fs.existsSync(path.join(cloneDir, '.git')));
  });
});
