/**
 * Tier 1 - Feature 26: Git .idx v2 Index Parser (F26 / R1)
 *
 * Validates:
 * 1. Magic header \xFFtOc and version 2 parsing, rejecting invalid versions
 * 2. 256-entry fanout table binary search lookup in O(log N)
 * 3. 20-byte SHA-1 table resolution returning accurate object indices
 * 4. CRC32 checksum table retrieval matching computed IEEE 802.3 CRC32
 * 5. 4-byte offset table resolution for standard offsets (< 2GB)
 * 6. getByteSpan(shaHex, packFileSize) calculating exact [start, end] ranges
 */

import { describe, it, assert, beforeAll, afterAll } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { PackBuilder, PackIndexParser, computeCrc32, GitObjectType } from '../harness/pack_helper.js';
import fs from 'node:fs';
import path from 'node:path';

describe('Tier 1 - Feature 26: Git .idx v2 Index Parser (F26 / R1)', () => {
  let gitHelper;
  let testRepoPath;

  beforeAll(() => {
    gitHelper = new GitRepoHelper();
    testRepoPath = gitHelper.createBareRepo('f26-test-repo.git');
  });

  afterAll(() => {
    gitHelper.cleanup();
  });

  it('T1.26.1: Parse .idx v2 magic header (\\xFFtOc) and version 2, rejecting invalid headers/versions', () => {
    const builder = new PackBuilder();
    builder.addObject(GitObjectType.BLOB, 'Hello, Sendforge v2 Index!');
    const { idxBuffer } = builder.build();

    // Verify magic bytes \xFFtOc
    assert.strictEqual(idxBuffer[0], 0xFF, 'Magic byte 0 should be 0xFF');
    assert.strictEqual(idxBuffer[1], 0x74, 'Magic byte 1 should be 0x74 (t)');
    assert.strictEqual(idxBuffer[2], 0x4F, 'Magic byte 2 should be 0x4F (O)');
    assert.strictEqual(idxBuffer[3], 0x63, 'Magic byte 3 should be 0x63 (c)');

    // Verify version 2
    assert.strictEqual(idxBuffer.readUInt32BE(4), 2, 'Version should be 2');

    // Parse successfully
    const parsed = PackIndexParser.parse(idxBuffer);
    assert.ok(parsed, 'Index should parse successfully');
    assert.strictEqual(parsed.totalObjects, 1, 'Total objects should equal 1');

    // Corrupt magic header and verify rejection
    const badMagicBuf = Buffer.from(idxBuffer);
    badMagicBuf[0] = 0x00;
    assert.throws(() => {
      PackIndexParser.parse(badMagicBuf);
    }, /Invalid \.idx magic header/, 'Should throw on invalid magic header');

    // Corrupt version and verify rejection
    const badVerBuf = Buffer.from(idxBuffer);
    badVerBuf.writeUInt32BE(3, 4); // Version 3
    assert.throws(() => {
      PackIndexParser.parse(badVerBuf);
    }, /Unsupported \.idx version/, 'Should throw on unsupported version');
  });

  it('T1.26.2: 256-entry first-level fanout table parsing and O(log N) binary search lookup', () => {
    const builder = new PackBuilder();
    const shas = [];

    // Create 50 objects with diverse SHA-1 first bytes
    for (let i = 0; i < 50; i++) {
      const sha = builder.addObject(GitObjectType.BLOB, `Synthetic blob payload index #${i} timestamp ${Date.now()}`);
      shas.push(sha);
    }

    const { idxBuffer } = builder.build();
    const parsed = PackIndexParser.parse(idxBuffer);

    assert.strictEqual(parsed.totalObjects, 50, 'Total objects should equal 50');

    // Fanout table must be monotonically non-decreasing and end at totalObjects
    let prev = 0;
    for (let byteVal = 0; byteVal < 256; byteVal++) {
      const count = parsed.data.fanout[byteVal];
      assert.greaterThanOrEqual(count, prev, `Fanout[${byteVal}] must be >= fanout[${byteVal - 1}]`);
      assert.lessThanOrEqual(count, 50, `Fanout[${byteVal}] must be <= totalObjects`);
      prev = count;
    }
    assert.strictEqual(parsed.data.fanout[255], 50, 'Fanout[255] must match totalObjects');

    // Binary search lookup for each SHA
    for (const sha of shas) {
      const entry = parsed.findObject(sha);
      assert.ok(entry, `Object ${sha} must be found via fanout binary search`);
      assert.strictEqual(entry.shaHex, sha, `Entry SHA must match queried SHA`);
    }

    // Non-existent SHA must return null
    const nonExistent = '0000000000000000000000000000000000000000';
    assert.strictEqual(parsed.findObject(nonExistent), null, 'Non-existent SHA must return null');
  });

  it('T1.26.3: 20-byte SHA-1 table lookup returning accurate object index and sorted order', () => {
    const builder = new PackBuilder();
    const rawBlobs = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta'];
    const addedShas = [];

    for (const text of rawBlobs) {
      addedShas.push(builder.addObject(GitObjectType.BLOB, text));
    }

    const { idxBuffer } = builder.build();
    const parsed = PackIndexParser.parse(idxBuffer);

    // Verify SHA-1 table entries are strictly sorted lexicographically
    const extractedShas = [];
    for (let i = 0; i < parsed.totalObjects; i++) {
      const sha = parsed.data.buf.subarray(
        parsed.data.shaTableOffset + i * 20,
        parsed.data.shaTableOffset + (i + 1) * 20
      ).toString('hex');
      extractedShas.push(sha);
    }

    const sortedExpected = [...addedShas].sort();
    assert.deepEqual(extractedShas, sortedExpected, 'SHA table must be strictly sorted lexicographically');
  });

  it('T1.26.4: CRC32 checksum retrieval for packed objects matching computed IEEE 802.3 CRC32', () => {
    const builder = new PackBuilder();
    const sha1 = builder.addObject(GitObjectType.BLOB, 'CRC32 Test Payload 1');
    const sha2 = builder.addObject(GitObjectType.BLOB, 'CRC32 Test Payload 2');

    const { idxBuffer, entries } = builder.build();
    const parsed = PackIndexParser.parse(idxBuffer);

    for (const entry of entries) {
      const found = parsed.findObject(entry.shaHex);
      assert.ok(found, `Entry ${entry.shaHex} must exist`);
      assert.strictEqual(found.crc32, entry.crc32, `CRC32 for ${entry.shaHex} must match built CRC32`);
    }
  });

  it('T1.26.5: 4-byte offset table resolution for standard offsets (< 2GB)', () => {
    const builder = new PackBuilder();
    const sha1 = builder.addObject(GitObjectType.COMMIT, 'tree 0000000000000000000000000000000000000000\nauthor Test <t@t.com> 1234567890 +0000\ncommitter Test <t@t.com> 1234567890 +0000\n\nInitial commit');
    const sha2 = builder.addObject(GitObjectType.BLOB, 'Standard 4-byte offset content');

    const { idxBuffer, entries } = builder.build();
    const parsed = PackIndexParser.parse(idxBuffer);

    for (const entry of entries) {
      const offset = parsed.getObjectOffset(entry.shaHex);
      assert.strictEqual(offset, entry.offset, `Offset for ${entry.shaHex} must match built offset`);
      assert.lessThan(offset, 0x80000000, `Standard offset must be < 2GB`);
    }

    const sortedOffsets = parsed.getSortedOffsets();
    assert.strictEqual(sortedOffsets.length, 2, 'Sorted offsets length must equal total objects');
    assert.strictEqual(sortedOffsets[0], 12, 'First object offset in pack must be 12 (after 12-byte header)');
  });

  it('T1.26.6: Byte span calculation getByteSpan(shaHex, packFileSize) for consecutive packed objects', () => {
    const builder = new PackBuilder();
    const sha1 = builder.addObject(GitObjectType.BLOB, 'Byte span object #1 payload');
    const sha2 = builder.addObject(GitObjectType.BLOB, 'Byte span object #2 payload');
    const sha3 = builder.addObject(GitObjectType.BLOB, 'Byte span object #3 payload');

    const { idxBuffer, packBuffer, entries } = builder.build();
    const parsed = PackIndexParser.parse(idxBuffer);

    const sortedEntries = [...entries].sort((a, b) => a.offset - b.offset);

    // Test intermediate object byte span
    const span1 = parsed.getByteSpan(sortedEntries[0].shaHex, packBuffer.length);
    assert.ok(span1, 'Span 1 must be calculated');
    assert.strictEqual(span1.start, sortedEntries[0].offset);
    assert.strictEqual(span1.end, sortedEntries[1].offset - 1);

    // Test last object byte span (must stop before 20-byte pack trailer)
    const spanLast = parsed.getByteSpan(sortedEntries[2].shaHex, packBuffer.length);
    assert.ok(spanLast, 'Last span must be calculated');
    assert.strictEqual(spanLast.start, sortedEntries[2].offset);
    assert.strictEqual(spanLast.end, packBuffer.length - 21);
  });
});
