/**
 * Tier 2 - Boundary B6: Corrupted Zlib Loose Object Handling
 * Verifies robust error handling when loose Git objects have corrupted zlib streams.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { GitParser } from '../harness/git_parser.js';

describe('Tier 2 - Boundary B6: Corrupted Zlib Loose Objects (B6)', () => {
  let gitHelper;
  let bareRepo;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    bareRepo = gitHelper.createBareRepo('b6-corrupt.git');
  });

  afterEach(() => {
    gitHelper.cleanup();
  });

  it('B6.1: Corrupted zlib loose object throws typed decompression error', () => {
    const workDir = gitHelper.createWorkingRepo(bareRepo, 'work-corrupt');
    gitHelper.commitFiles(workDir, { 'file.txt': 'good content' }, 'Commit');
    gitHelper.push(workDir, 'origin', 'main');

    const blobSha = gitHelper.git(workDir, ['rev-parse', 'HEAD:file.txt']);
    gitHelper.corruptLooseObject(bareRepo, blobSha, 'zlib_corrupt');

    const objPath = path.join(bareRepo, 'objects', blobSha.slice(0, 2), blobSha.slice(2));
    const corruptBuf = fs.readFileSync(objPath);

    assert.throws(() => {
      GitParser.inflateLooseObject(corruptBuf, blobSha);
    }, /Zlib decompression failed/i);
  });

  it('B6.2: Truncated object file throws decompression error', () => {
    const workDir = gitHelper.createWorkingRepo(bareRepo, 'work-trunc');
    gitHelper.commitFiles(workDir, { 'trunc.txt': 'longer text content for truncation testing' }, 'Commit');
    gitHelper.push(workDir, 'origin', 'main');

    const blobSha = gitHelper.git(workDir, ['rev-parse', 'HEAD:trunc.txt']);
    gitHelper.corruptLooseObject(bareRepo, blobSha, 'truncate');

    const objPath = path.join(bareRepo, 'objects', blobSha.slice(0, 2), blobSha.slice(2));
    const truncBuf = fs.readFileSync(objPath);

    assert.throws(() => {
      GitParser.inflateLooseObject(truncBuf, blobSha);
    }, /Zlib decompression failed/i);
  });
});
