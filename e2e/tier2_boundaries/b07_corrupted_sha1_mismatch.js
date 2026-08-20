/**
 * Tier 2 - Boundary B7: Corrupted SHA-1 Checksum Mismatch
 * Tests rejection of loose objects whose decompressed content does not match
 * the filename hash.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { GitParser } from '../harness/git_parser.js';

describe('Tier 2 - Boundary B7: Corrupted SHA-1 Mismatch (B7)', () => {
  let gitHelper;
  let bareRepo;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    bareRepo = gitHelper.createBareRepo('b7-mismatch.git');
  });

  afterEach(() => {
    gitHelper.cleanup();
  });

  it('B7.1: Detects modified payload under original SHA-1 filename', () => {
    const workDir = gitHelper.createWorkingRepo(bareRepo, 'work-mismatch');
    gitHelper.commitFiles(workDir, { 'secure.txt': 'original content 12345' }, 'Commit');
    gitHelper.push(workDir, 'origin', 'main');

    const blobSha = gitHelper.git(workDir, ['rev-parse', 'HEAD:secure.txt']);
    gitHelper.corruptLooseObject(bareRepo, blobSha, 'sha1_mismatch');

    const objPath = path.join(bareRepo, 'objects', blobSha.slice(0, 2), blobSha.slice(2));
    const modifiedBuf = fs.readFileSync(objPath);

    assert.throws(() => {
      GitParser.inflateLooseObject(modifiedBuf, blobSha);
    }, /checksum mismatch/i);
  });
});
