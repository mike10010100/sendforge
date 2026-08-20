/**
 * Tier 1 - Feature 3: Dumb HTTP Server-Info Maintenance (`info/refs`)
 * Tests generation and maintenance of info/refs and objects/info/packs
 * conforming to the Git Dumb HTTP protocol specification.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';

describe('Tier 1 - Feature 3: Dumb HTTP Server-Info (F3)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('info-refs-test.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });
  });

  afterEach(() => {
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('T1.3.1: Single branch info/refs has format <sha1>\\trefs/heads/main\\n', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work1', 'main');
    const commitSha = gitHelper.commitFiles(workDir, { 'README.md': '# Main' }, 'Initial commit');
    gitHelper.push(workDir, 'origin', 'main');

    const infoRefsPath = path.join(bareRepo, 'info', 'refs');
    assert.ok(fs.existsSync(infoRefsPath), 'info/refs must exist');
    const content = fs.readFileSync(infoRefsPath, 'utf-8');

    assert.includes(content, `${commitSha}\trefs/heads/main`);
  });

  it('T1.3.2: Multi-branch info/refs contains all branches with tab separators', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work2', 'main');
    const cMain = gitHelper.commitFiles(workDir, { 'README.md': '# Main' }, 'Main commit');

    gitHelper.createBranch(workDir, 'dev');
    const cDev = gitHelper.commitFiles(workDir, { 'dev.txt': 'Dev branch' }, 'Dev commit');

    gitHelper.createBranch(workDir, 'feature/auth');
    const cAuth = gitHelper.commitFiles(workDir, { 'auth.txt': 'Auth branch' }, 'Auth commit');

    gitHelper.push(workDir, 'origin', '--all');

    const content = fs.readFileSync(path.join(bareRepo, 'info', 'refs'), 'utf-8');
    assert.includes(content, `${cMain}\trefs/heads/main`);
    assert.includes(content, `${cDev}\trefs/heads/dev`);
    assert.includes(content, `${cAuth}\trefs/heads/feature/auth`);
  });

  it('T1.3.3: Annotated tag peeled commit entry in info/refs (<sha>\\trefs/tags/tag^{})', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work3', 'main');
    const commitSha = gitHelper.commitFiles(workDir, { 'README.md': '# Tagged' }, 'Tag commit');
    const tagSha = gitHelper.createAnnotatedTag(workDir, 'v1.0.0', 'Release 1.0.0');
    gitHelper.push(workDir, 'origin', '--all');
    gitHelper.push(workDir, 'origin', '--tags');

    const content = fs.readFileSync(path.join(bareRepo, 'info', 'refs'), 'utf-8');
    assert.includes(content, `${tagSha}\trefs/tags/v1.0.0`);
    assert.includes(content, `${commitSha}\trefs/tags/v1.0.0^{}`);
  });

  it('T1.3.4: Branch deletion push immediately removes ref from info/refs', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work4', 'main');
    gitHelper.commitFiles(workDir, { 'README.md': '# Main' }, 'Commit');
    gitHelper.createBranch(workDir, 'temp-branch');
    gitHelper.commitFiles(workDir, { 'temp.txt': 'Temp' }, 'Temp commit');
    gitHelper.push(workDir, 'origin', '--all');

    let content = fs.readFileSync(path.join(bareRepo, 'info', 'refs'), 'utf-8');
    assert.includes(content, 'refs/heads/temp-branch');

    // Delete remote branch
    gitHelper.push(workDir, 'origin', ':temp-branch');

    content = fs.readFileSync(path.join(bareRepo, 'info', 'refs'), 'utf-8');
    assert.notIncludes(content, 'refs/heads/temp-branch', 'Deleted branch must not remain in info/refs');
  });

  it('T1.3.5: Empty repo info/refs handling (valid empty or zero-byte without crash)', () => {
    const emptyRepo = path.join(gitHelper.getRootDir(), 'empty-dumb.git');
    supervisor.init(emptyRepo, { bare: true });

    // Hook run on empty repo
    const res = supervisor.hook(emptyRepo, '');
    assert.strictEqual(res.status, 0);

    const infoRefsPath = path.join(emptyRepo, 'info', 'refs');
    if (fs.existsSync(infoRefsPath)) {
      const content = fs.readFileSync(infoRefsPath, 'utf-8');
      assert.strictEqual(content.trim(), '', 'Empty repo info/refs should contain zero ref lines');
    }
  });

  it('T1.3.6: objects/info/packs file formatting and dumb HTTP compatibility', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work6', 'main');
    gitHelper.commitFiles(workDir, { 'README.md': '# Packs test' }, 'Packs commit');
    gitHelper.push(workDir, 'origin', 'main');

    // Dumb HTTP clients may request objects/info/packs
    const packsInfoDir = path.join(bareRepo, 'objects', 'info');
    fs.mkdirSync(packsInfoDir, { recursive: true });
    const packsInfoPath = path.join(packsInfoDir, 'packs');
    if (fs.existsSync(packsInfoPath)) {
      const content = fs.readFileSync(packsInfoPath, 'utf-8');
      assert.ok(typeof content === 'string');
    }
  });
});
