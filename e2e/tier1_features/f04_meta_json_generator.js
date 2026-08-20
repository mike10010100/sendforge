/**
 * Tier 1 - Feature 4: Repository Metadata Generator (`meta.json`)
 * Tests schema conformance, branch and tag arrays, commit stats,
 * and timestamp formatting in static/meta.json.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';

describe('Tier 1 - Feature 4: Metadata Generator (F4)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('meta-test.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });
  });

  afterEach(() => {
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('T1.4.1: meta.json strictly conforms to specified JSON schema', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work1', 'main');
    const commitSha = gitHelper.commitFiles(workDir, { 'README.md': '# Schema Test' }, 'Init repo');
    gitHelper.push(workDir, 'origin', 'main');

    const metaPath = path.join(bareRepo, 'static', 'meta.json');
    assert.ok(fs.existsSync(metaPath), 'meta.json must exist');

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

    // Check required fields per PROJECT.md interface contract
    assert.ok(typeof meta.name === 'string', 'meta.name must be string');
    assert.ok(typeof meta.default_branch === 'string', 'meta.default_branch must be string');
    assert.ok(Array.isArray(meta.branches), 'meta.branches must be array');
    assert.ok(Array.isArray(meta.tags), 'meta.tags must be array');
    assert.ok(typeof meta.head === 'object' && meta.head !== null, 'meta.head must be object');
    assert.ok(typeof meta.head.sha === 'string', 'meta.head.sha must be string');
    assert.ok(typeof meta.stats === 'object' && meta.stats !== null, 'meta.stats must be object');
    assert.ok(typeof meta.stats.commit_count === 'number', 'stats.commit_count must be number');
    assert.ok(typeof meta.stats.branch_count === 'number', 'stats.branch_count must be number');
    assert.ok(typeof meta.stats.tag_count === 'number', 'stats.tag_count must be number');
    assert.ok(typeof meta.has_readme === 'boolean', 'meta.has_readme must be boolean');
    assert.ok(typeof meta.updated_at === 'string', 'meta.updated_at must be string');

    // ISO 8601 timestamp validation
    assert.match(meta.updated_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, 'updated_at must be valid ISO 8601');
  });

  it('T1.4.2: Accurate commit stats and branch count reflection', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work2', 'main');
    gitHelper.commitFiles(workDir, { 'file1.txt': '1' }, 'Commit 1');
    gitHelper.commitFiles(workDir, { 'file2.txt': '2' }, 'Commit 2');
    gitHelper.commitFiles(workDir, { 'file3.txt': '3' }, 'Commit 3');

    gitHelper.createBranch(workDir, 'feat-1');
    gitHelper.commitFiles(workDir, { 'feat.txt': 'f' }, 'Commit 4');

    gitHelper.push(workDir, 'origin', '--all');

    const meta = JSON.parse(fs.readFileSync(path.join(bareRepo, 'static', 'meta.json'), 'utf-8'));
    assert.greaterThanOrEqual(meta.stats.commit_count, 3, 'commit count must be at least 3');
    assert.strictEqual(meta.stats.branch_count, 2, 'branch count must be 2');
  });

  it('T1.4.3: Accurate tag pointers and peeled annotation', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work3', 'main');
    gitHelper.commitFiles(workDir, { 'README.md': '# Tag Test' }, 'Tag commit');
    gitHelper.createAnnotatedTag(workDir, 'v1.0.0', 'Release 1.0.0');
    gitHelper.createLightweightTag(workDir, 'v0.9-alpha');
    gitHelper.push(workDir, 'origin', '--all');
    gitHelper.push(workDir, 'origin', '--tags');

    const meta = JSON.parse(fs.readFileSync(path.join(bareRepo, 'static', 'meta.json'), 'utf-8'));
    assert.strictEqual(meta.stats.tag_count, 2);

    const v1Tag = meta.tags.find(t => t.name === 'v1.0.0');
    assert.ok(v1Tag, 'v1.0.0 tag must be present in meta.tags');
    assert.strictEqual(v1Tag.is_annotated, true, 'v1.0.0 is annotated tag');
    assert.ok(v1Tag.peeled !== null, 'Annotated tag must have peeled commit sha');
  });

  it('T1.4.4: Special characters in branch and tag names properly JSON escaped', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work4', 'main');
    gitHelper.commitFiles(workDir, { 'README.md': '# Special' }, 'Special commit');

    const branchName = 'feature/test-123_v1.0@beta';
    gitHelper.createBranch(workDir, branchName);
    gitHelper.push(workDir, 'origin', '--all');

    const metaRaw = fs.readFileSync(path.join(bareRepo, 'static', 'meta.json'), 'utf-8');
    // Ensure it parses cleanly
    const meta = JSON.parse(metaRaw);
    const branchNames = meta.branches.map(b => b.name);
    assert.includes(branchNames, branchName);
  });

  it('T1.4.5: README detection flags (has_readme and readme_filename)', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work5', 'main');
    gitHelper.commitFiles(workDir, { 'README.md': '# Sendforge Docs' }, 'Readme commit');
    gitHelper.push(workDir, 'origin', 'main');

    const meta = JSON.parse(fs.readFileSync(path.join(bareRepo, 'static', 'meta.json'), 'utf-8'));
    assert.strictEqual(meta.has_readme, true);
    assert.strictEqual(meta.readme_filename, 'README.md');
  });

  it('T1.4.6: Empty repository metadata structure when 0 commits exist', () => {
    const emptyRepo = path.join(gitHelper.getRootDir(), 'empty-meta.git');
    supervisor.init(emptyRepo, { bare: true });
    supervisor.hook(emptyRepo, '');

    const metaPath = path.join(emptyRepo, 'static', 'meta.json');
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      assert.strictEqual(meta.stats.commit_count, 0);
      assert.strictEqual(meta.branches.length, 0);
    }
  });
});
