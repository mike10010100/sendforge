/**
 * Tier 1 - Feature 11: Blob Reader & Text/Binary Detection (F11)
 * Tests binary vs UTF-8 text detection, line splitting, 0-byte blobs,
 * and CRLF/LF line termination handling.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { GitParser } from '../harness/git_parser.js';

describe('Tier 1 - Feature 11: Blob Reader & Text/Binary Detection (F11)', () => {
  let gitHelper;
  let bareRepo;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    bareRepo = gitHelper.createBareRepo('blob-detection-test.git');
  });

  afterEach(() => {
    gitHelper.cleanup();
  });

  it('T1.11.1: UTF-8 text blob decoding with 1-based line indexing', () => {
    const workDir = gitHelper.createWorkingRepo(bareRepo, 'work1');
    const textContent = 'Line 1: Hello\nLine 2: World\nLine 3: Sendforge';
    gitHelper.commitFiles(workDir, { 'sample.txt': textContent }, 'Add text');
    gitHelper.push(workDir, 'origin', 'main');

    const blobSha = gitHelper.git(workDir, ['rev-parse', 'HEAD:sample.txt']);
    const obj = gitHelper.readLooseObject(bareRepo, blobSha);
    assert.strictEqual(obj.type, 'blob');

    const parsed = GitParser.parseBlob(obj.payload);
    assert.strictEqual(parsed.isBinary, false);
    assert.strictEqual(parsed.lineCount, 3);
    assert.strictEqual(parsed.lines[0], 'Line 1: Hello');
    assert.strictEqual(parsed.lines[2], 'Line 3: Sendforge');
  });

  it('T1.11.2: Binary blob detection via null bytes (\\0)', () => {
    const workDir = gitHelper.createWorkingRepo(bareRepo, 'work2');
    const binaryData = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D]); // PNG header with null bytes
    gitHelper.commitFiles(workDir, { 'image.png': binaryData }, 'Add binary');
    gitHelper.push(workDir, 'origin', 'main');

    const blobSha = gitHelper.git(workDir, ['rev-parse', 'HEAD:image.png']);
    const obj = gitHelper.readLooseObject(bareRepo, blobSha);

    const parsed = GitParser.parseBlob(obj.payload);
    assert.strictEqual(parsed.isBinary, true, 'PNG header with null bytes must be detected as binary');
    assert.strictEqual(parsed.size, binaryData.length);
  });

  it('T1.11.3: Zero-byte empty blob (Git OID e69de29bb2d1d6434b8b29ae775ad8c2e48c5391)', () => {
    const workDir = gitHelper.createWorkingRepo(bareRepo, 'work3');
    gitHelper.commitFiles(workDir, { 'empty.txt': '' }, 'Add empty file');
    gitHelper.push(workDir, 'origin', 'main');

    const blobSha = gitHelper.git(workDir, ['rev-parse', 'HEAD:empty.txt']);
    assert.strictEqual(blobSha, 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391', 'Empty blob must match well-known empty tree OID');

    const obj = gitHelper.readLooseObject(bareRepo, blobSha);
    const parsed = GitParser.parseBlob(obj.payload);
    assert.strictEqual(parsed.isBinary, false);
    assert.strictEqual(parsed.size, 0);
    assert.strictEqual(parsed.lines.length, 0);
    assert.strictEqual(parsed.text, '');
  });

  it('T1.11.4: Mixed CRLF and LF line ending normalization', () => {
    const workDir = gitHelper.createWorkingRepo(bareRepo, 'work4');
    const mixedText = 'Line 1\r\nLine 2\nLine 3\r\nLine 4';
    gitHelper.commitFiles(workDir, { 'mixed.txt': mixedText }, 'Mixed endings');
    gitHelper.push(workDir, 'origin', 'main');

    const blobSha = gitHelper.git(workDir, ['rev-parse', 'HEAD:mixed.txt']);
    const obj = gitHelper.readLooseObject(bareRepo, blobSha);
    const parsed = GitParser.parseBlob(obj.payload);

    assert.strictEqual(parsed.isBinary, false);
    assert.strictEqual(parsed.lines.length, 4);
    assert.strictEqual(parsed.lines[0], 'Line 1');
    assert.strictEqual(parsed.lines[1], 'Line 2');
    assert.strictEqual(parsed.lines[2], 'Line 3');
    assert.strictEqual(parsed.lines[3], 'Line 4');
  });

  it('T1.11.5: Multi-megabyte source code blob line counting without memory leak', () => {
    const workDir = gitHelper.createWorkingRepo(bareRepo, 'work5');
    const largeLineArray = [];
    for (let i = 1; i <= 50000; i++) {
      largeLineArray.push(`pub fn function_${i}(val: i32) -> i32 { val + ${i} }`);
    }
    const bigCode = largeLineArray.join('\n');
    gitHelper.commitFiles(workDir, { 'generated.rs': bigCode }, 'Large file commit');
    gitHelper.push(workDir, 'origin', 'main');

    const blobSha = gitHelper.git(workDir, ['rev-parse', 'HEAD:generated.rs']);
    const obj = gitHelper.readLooseObject(bareRepo, blobSha);
    const parsed = GitParser.parseBlob(obj.payload);

    assert.strictEqual(parsed.isBinary, false);
    assert.strictEqual(parsed.lineCount, 50000);
    assert.strictEqual(parsed.lines[0], 'pub fn function_1(val: i32) -> i32 { val + 1 }');
    assert.strictEqual(parsed.lines[49999], 'pub fn function_50000(val: i32) -> i32 { val + 50000 }');
  });
});
