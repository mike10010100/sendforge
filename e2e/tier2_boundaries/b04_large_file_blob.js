/**
 * Tier 2 - Boundary B4: Large File Blob Handling (10 MB+)
 * Tests handling, storage, and retrieval of large binary/text blobs
 * without exhausting memory or crashing parsers.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { GitParser } from '../harness/git_parser.js';

describe('Tier 2 - Boundary B4: Large Files (10 MB+ Blob) (B4)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('b4-large.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });
  });

  afterEach(() => {
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('B4.1: Commits, pushes, and inflates a 10 MB file blob', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-large', 'main');
    const sizeBytes = 10 * 1024 * 1024; // 10 MB
    gitHelper.createLargeFile(workDir, 'dataset_10mb.bin', sizeBytes);
    gitHelper.push(workDir, 'origin', 'main');

    const blobSha = gitHelper.git(workDir, ['rev-parse', 'HEAD:dataset_10mb.bin']);
    const obj = gitHelper.readLooseObject(bareRepo, blobSha);

    assert.strictEqual(obj.type, 'blob');
    assert.strictEqual(obj.size, sizeBytes);
    assert.strictEqual(obj.payload.length, sizeBytes);
  });

  it('B4.2: meta.json and static HTML generation complete cleanly with 10 MB blob in repository', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-large-2', 'main');
    const sizeBytes = 10 * 1024 * 1024; // 10 MB
    gitHelper.createLargeFile(workDir, 'dataset_10mb.bin', sizeBytes);
    gitHelper.push(workDir, 'origin', 'main');

    const metaPath = path.join(bareRepo, 'static', 'meta.json');
    assert.ok(fs.existsSync(metaPath), 'meta.json must be generated');

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    assert.greaterThanOrEqual(meta.stats.commit_count, 1);
  });
});
