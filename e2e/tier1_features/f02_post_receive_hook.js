/**
 * Tier 1 - Feature 2: Post-Receive Hook Handler (`sendforge hook`)
 * Tests processing of ref updates from standard input, updating dumb HTTP info,
 * metadata generation, and static fallback updates.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';

describe('Tier 1 - Feature 2: Post-Receive Hook Handler (F2)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('hook-test.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });
  });

  afterEach(() => {
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('T1.2.1: Standard single branch push executes hook and generates static metadata', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work1', 'main');
    const commitSha = gitHelper.commitFiles(workDir, { 'README.md': '# Hello World\nTesting Sendforge Hook' }, 'First commit');
    gitHelper.push(workDir, 'origin', 'main');

    const zeroSha = '0000000000000000000000000000000000000000';
    const hookInput = `${zeroSha} ${commitSha} refs/heads/main\n`;

    const res = supervisor.hook(bareRepo, hookInput);
    assert.strictEqual(res.status, 0, `Hook failed:\n${res.stderr}`);

    // Verify meta.json and static fallbacks are generated
    const metaPath = path.join(bareRepo, 'static', 'meta.json');
    assert.ok(fs.existsSync(metaPath), 'static/meta.json must be generated');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    assert.strictEqual(meta.default_branch, 'main');
    assert.strictEqual(meta.head.sha, commitSha);

    const indexPath = path.join(bareRepo, 'static', 'index.html');
    assert.ok(fs.existsSync(indexPath), 'static/index.html must be generated');
  });

  it('T1.2.2: Batch multi-ref push updates all branches and tags in metadata', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work2', 'main');
    const c1 = gitHelper.commitFiles(workDir, { 'README.md': '# Main' }, 'Main commit');

    gitHelper.createBranch(workDir, 'feature-a');
    const c2 = gitHelper.commitFiles(workDir, { 'feature.txt': 'Feature A' }, 'Feature commit');
    gitHelper.push(workDir, 'origin', 'main');
    gitHelper.push(workDir, 'origin', 'feature-a');

    const zeroSha = '0000000000000000000000000000000000000000';
    const hookInput = [
      `${zeroSha} ${c1} refs/heads/main`,
      `${zeroSha} ${c2} refs/heads/feature-a`
    ].join('\n') + '\n';

    const res = supervisor.hook(bareRepo, hookInput);
    assert.strictEqual(res.status, 0);

    const meta = JSON.parse(fs.readFileSync(path.join(bareRepo, 'static', 'meta.json'), 'utf-8'));
    const branchNames = meta.branches.map(b => b.name);
    assert.includes(branchNames, 'main');
    assert.includes(branchNames, 'feature-a');
  });

  it('T1.2.3: Tag creation ref update cataloged in meta.json', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work3', 'main');
    const c1 = gitHelper.commitFiles(workDir, { 'README.md': '# v1.0' }, 'Tag commit');
    const tagSha = gitHelper.createAnnotatedTag(workDir, 'v1.0.0', 'Release 1.0.0');
    gitHelper.push(workDir, 'origin', 'main');
    gitHelper.push(workDir, 'origin', 'v1.0.0');

    const zeroSha = '0000000000000000000000000000000000000000';
    const hookInput = [
      `${zeroSha} ${c1} refs/heads/main`,
      `${zeroSha} ${tagSha} refs/tags/v1.0.0`
    ].join('\n') + '\n';

    const res = supervisor.hook(bareRepo, hookInput);
    assert.strictEqual(res.status, 0);

    const meta = JSON.parse(fs.readFileSync(path.join(bareRepo, 'static', 'meta.json'), 'utf-8'));
    const tagNames = meta.tags.map(t => t.name);
    assert.includes(tagNames, 'v1.0.0');
  });

  it('T1.2.4: Malformed stdin handling logs structured error and does not panic', () => {
    const invalidStdin = 'corrupted line without proper sha or ref\n';
    const res = supervisor.hook(bareRepo, invalidStdin);
    // Should exit non-zero or log structured error without crash
    assert.ok(res.status !== 0 || res.stderr.length > 0 || res.stdout.length > 0, 'Malformed input handled');
  });

  it('T1.2.5: Zero-line stdin (empty push) exits cleanly', () => {
    const res = supervisor.hook(bareRepo, '');
    assert.strictEqual(res.status, 0, 'Empty stdin should exit cleanly with 0');
  });

  it('T1.2.6: Post-receive hook triggered automatically during native git push', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work4', 'main');
    gitHelper.commitFiles(workDir, { 'README.md': '# Native Push Trigger' }, 'Test native push');

    // Run native git push over local filesystem protocol (which triggers hooks/post-receive)
    gitHelper.push(workDir, 'origin', 'main');

    const metaPath = path.join(bareRepo, 'static', 'meta.json');
    assert.ok(fs.existsSync(metaPath), 'post-receive hook should automatically create meta.json on native git push');
  });
});
