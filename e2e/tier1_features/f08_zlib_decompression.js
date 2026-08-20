/**
 * Tier 1 - Feature 8: Zlib Loose Object Decompression (F8)
 * Tests in-browser loose Git object fetching and zlib decompression,
 * validating headers, payloads, and SHA-1 checksum matching.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { GitParser } from '../harness/git_parser.js';

describe('Tier 1 - Feature 8: Zlib Loose Object Decompression (F8)', () => {
  let gitHelper;
  let bareRepo;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    bareRepo = gitHelper.createBareRepo('zlib-test.git');
  });

  afterEach(() => {
    gitHelper.cleanup();
  });

  it('T1.8.1: Loose commit object zlib decompression and header extraction', () => {
    const workDir = gitHelper.createWorkingRepo(bareRepo, 'work1');
    const commitSha = gitHelper.commitFiles(workDir, { 'file.txt': 'hello' }, 'Commit message 123');
    gitHelper.push(workDir, 'origin', 'main');

    // Read compressed file directly from disk
    const objPath = path.join(bareRepo, 'objects', commitSha.slice(0, 2), commitSha.slice(2));
    assert.ok(fs.existsSync(objPath), `Object file ${objPath} must exist`);

    const compressed = fs.readFileSync(objPath);
    const parsed = GitParser.inflateLooseObject(compressed, commitSha);

    assert.strictEqual(parsed.type, 'commit');
    assert.greaterThan(parsed.size, 0);
    assert.strictEqual(parsed.oid, commitSha);
  });

  it('T1.8.2: Loose tree object zlib decompression', () => {
    const workDir = gitHelper.createWorkingRepo(bareRepo, 'work2');
    gitHelper.commitFiles(workDir, { 'a.txt': 'a', 'b.txt': 'b' }, 'Tree test');
    gitHelper.push(workDir, 'origin', 'main');

    const treeSha = gitHelper.git(workDir, ['rev-parse', 'HEAD^{tree}']);
    const objPath = path.join(bareRepo, 'objects', treeSha.slice(0, 2), treeSha.slice(2));

    const compressed = fs.readFileSync(objPath);
    const parsed = GitParser.inflateLooseObject(compressed, treeSha);

    assert.strictEqual(parsed.type, 'tree');
    assert.strictEqual(parsed.oid, treeSha);
  });

  it('T1.8.3: Loose blob object zlib decompression', () => {
    const workDir = gitHelper.createWorkingRepo(bareRepo, 'work3');
    const fileContent = 'Sendforge loose blob content with special chars: 🦀 🚀 \nLine 2';
    gitHelper.commitFiles(workDir, { 'sample.txt': fileContent }, 'Blob test');
    gitHelper.push(workDir, 'origin', 'main');

    const blobSha = gitHelper.git(workDir, ['rev-parse', 'HEAD:sample.txt']);
    const objPath = path.join(bareRepo, 'objects', blobSha.slice(0, 2), blobSha.slice(2));

    const compressed = fs.readFileSync(objPath);
    const parsed = GitParser.inflateLooseObject(compressed, blobSha);

    assert.strictEqual(parsed.type, 'blob');
    assert.strictEqual(parsed.payload.toString('utf-8'), fileContent);
  });

  it('T1.8.4: Checksum mismatch throws typed error when payload is altered', () => {
    const workDir = gitHelper.createWorkingRepo(bareRepo, 'work4');
    gitHelper.commitFiles(workDir, { 'test.txt': 'original' }, 'Commit');
    gitHelper.push(workDir, 'origin', 'main');

    const blobSha = gitHelper.git(workDir, ['rev-parse', 'HEAD:test.txt']);
    const objPath = path.join(bareRepo, 'objects', blobSha.slice(0, 2), blobSha.slice(2));
    const compressed = fs.readFileSync(objPath);

    // Expecting a different OID should trigger CHECKSUM_MISMATCH error
    const wrongOid = '1111111111111111111111111111111111111111';
    assert.throws(() => {
      GitParser.inflateLooseObject(compressed, wrongOid);
    }, /checksum mismatch/i);
  });

  it('T1.8.5: Invalid non-zlib header buffer throws decompression error', () => {
    const garbageBuffer = Buffer.from('This is not a zlib compressed Git object payload');
    assert.throws(() => {
      GitParser.inflateLooseObject(garbageBuffer);
    }, /Zlib decompression failed/i);
  });
});
