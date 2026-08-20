/**
 * Tier 1 - Feature 1: Bare Repository Initialization (`sendforge init`)
 * Tests initialization of bare Git repositories, configuration of dumb HTTP,
 * hook permissions, default branch options, and error handling.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';

describe('Tier 1 - Feature 1: Bare Repo Initialization (F1)', () => {
  let gitHelper;
  let supervisor;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
  });

  afterEach(() => {
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('T1.1.1: Nominal bare init creates all required directories and files', () => {
    const targetDir = path.join(gitHelper.getRootDir(), 'nominal.git');
    const res = supervisor.init(targetDir, { bare: true });

    // Validate CLI exit code
    assert.strictEqual(res.status, 0, `sendforge init exited with ${res.status}:\n${res.stderr}`);

    // Verify core bare repo files
    assert.ok(fs.existsSync(path.join(targetDir, 'HEAD')), 'HEAD must exist');
    assert.ok(fs.existsSync(path.join(targetDir, 'config')), 'config must exist');
    assert.ok(fs.existsSync(path.join(targetDir, 'objects')), 'objects dir must exist');
    assert.ok(fs.existsSync(path.join(targetDir, 'refs')), 'refs dir must exist');
    assert.ok(fs.existsSync(path.join(targetDir, 'refs', 'heads')), 'refs/heads dir must exist');
    assert.ok(fs.existsSync(path.join(targetDir, 'refs', 'tags')), 'refs/tags dir must exist');

    // Verify hook and static directory
    assert.ok(fs.existsSync(path.join(targetDir, 'hooks', 'post-receive')), 'hooks/post-receive must exist');
    assert.ok(fs.existsSync(path.join(targetDir, 'static')), 'static directory must exist');
  });

  it('T1.1.2: Custom default branch configuration (--default-branch trunk)', () => {
    const targetDir = path.join(gitHelper.getRootDir(), 'trunk-repo.git');
    const res = supervisor.init(targetDir, { bare: true, defaultBranch: 'trunk' });
    assert.strictEqual(res.status, 0);

    const headContent = fs.readFileSync(path.join(targetDir, 'HEAD'), 'utf-8');
    assert.includes(headContent, 'ref: refs/heads/trunk', 'HEAD must point to refs/heads/trunk');
  });

  it('T1.1.3: Post-receive hook has executable permissions (0755)', () => {
    const targetDir = path.join(gitHelper.getRootDir(), 'perm-test.git');
    const res = supervisor.init(targetDir, { bare: true });
    assert.strictEqual(res.status, 0);

    const hookPath = path.join(targetDir, 'hooks', 'post-receive');
    assert.ok(fs.existsSync(hookPath), 'hook must exist');
    const stats = fs.statSync(hookPath);
    // Mode should include execute permission (0o111)
    const isExecutable = (stats.mode & 0o111) !== 0;
    assert.ok(isExecutable, `hooks/post-receive must be executable (mode: 0o${stats.mode.toString(8)})`);
  });

  it('T1.1.4: Safe re-initialization of an already initialized bare repository', () => {
    const targetDir = path.join(gitHelper.getRootDir(), 'reinit-test.git');
    const res1 = supervisor.init(targetDir, { bare: true });
    assert.strictEqual(res1.status, 0);

    // Run init a second time on the same directory
    const res2 = supervisor.init(targetDir, { bare: true });
    assert.strictEqual(res2.status, 0, 'Re-initializing existing bare repo should succeed cleanly');

    // Ensure HEAD and hooks are intact
    assert.ok(fs.existsSync(path.join(targetDir, 'HEAD')));
    assert.ok(fs.existsSync(path.join(targetDir, 'hooks', 'post-receive')));
  });

  it('T1.1.5: Error handling on invalid/unwritable target path', () => {
    const invalidPath = '/proc/sendforge_non_existent/unwritable.git';
    const res = supervisor.init(invalidPath, { bare: true });
    assert.notStrictEqual(res.status, 0, 'Initializing unwritable directory should return non-zero exit code');
  });

  it('T1.1.6: Initialized bare repository is valid for native Git CLI clones and pushes', () => {
    const targetDir = path.join(gitHelper.getRootDir(), 'git-interop.git');
    const res = supervisor.init(targetDir, { bare: true, defaultBranch: 'main' });
    assert.strictEqual(res.status, 0);

    // Create a working repo, commit a file, and push to the initialized bare repo
    const workDir = gitHelper.createWorkingRepoAndInit(targetDir, 'workdir', 'main');
    gitHelper.commitFiles(workDir, { 'README.md': '# Interop Test' }, 'Initial commit');
    gitHelper.push(workDir, 'origin', 'main');

    // Check that bare repo received the commit
    const bareHeadSha = gitHelper.git(targetDir, ['rev-parse', 'refs/heads/main']);
    const workHeadSha = gitHelper.git(workDir, ['rev-parse', 'HEAD']);
    assert.strictEqual(bareHeadSha, workHeadSha, 'Bare repo HEAD commit must match pushed commit');
  });
});
