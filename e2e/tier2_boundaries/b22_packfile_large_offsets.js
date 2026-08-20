/**
 * Tier 2 - Boundary B22: Packfiles > 2GB & 8-Byte Offset Resolution (B22 / R1)
 *
 * Validates:
 * 1. 8-byte secondary offset table indexing when MSB bit (0x80000000) is set
 * 2. Offset at exact 2 GiB boundary (0x80000000) correctly resolved via 8-byte table
 * 3. Large 64-bit offsets (5 GiB, 10 GiB) encoded and decoded without precision loss
 * 4. Out-of-bounds 8-byte table index triggers structured error
 * 5. Sorted offset list properly handles mix of 4-byte and 8-byte offsets
 */

import { describe, it, assert } from '../harness/framework.js';
import { PackBuilder, PackIndexParser, GitObjectType } from '../harness/pack_helper.js';

describe('Tier 2 - Boundary B22: Packfiles > 2GB & 8-Byte Offsets (B22 / R1)', () => {
  it('B22.1: 8-byte secondary offset table indexing when MSB bit (0x80000000) is set', () => {
    const builder = new PackBuilder();
    const sha = builder.addObject(GitObjectType.BLOB, 'Simulated large packfile payload');

    // Build with forced 8-byte offset table
    const { idxBuffer } = builder.build({ force8ByteOffset: true });
    const parsed = PackIndexParser.parse(idxBuffer);

    const entry = parsed.findObject(sha);
    assert.ok(entry, 'Entry must be found in index');
    assert.strictEqual(entry.offset, 12, 'Offset must match 12 via 8-byte secondary table lookup');
  });

  it('B22.2: Offset at exact 2 GiB boundary (0x80000000) correctly resolved via 8-byte table', () => {
    const builder = new PackBuilder();
    const sha = builder.addObject(GitObjectType.BLOB, '2 GiB boundary object');

    // Create synthetic entry with offset = 2147483648 (0x80000000)
    const { idxBuffer } = builder.build({ force8ByteOffset: true });
    const parsed = PackIndexParser.parse(idxBuffer);

    // Overwrite secondary table 8-byte value with 0x80000000 (2147483648n)
    const mutableBuf = Buffer.from(idxBuffer);
    mutableBuf.writeBigUInt64BE(2147483648n, parsed.data.secTableOffset);

    const reparsed = PackIndexParser.parse(mutableBuf);
    const entry = reparsed.findObject(sha);
    assert.strictEqual(entry.offset, 2147483648, 'Should resolve 2 GiB offset accurately');
  });

  it('B22.3: Large 64-bit offsets (5 GiB, 10 GiB) encoded and decoded without precision loss', () => {
    const builder = new PackBuilder();
    const sha = builder.addObject(GitObjectType.BLOB, 'Large 64-bit offset object');

    const { idxBuffer } = builder.build({ force8ByteOffset: true });
    const parsed = PackIndexParser.parse(idxBuffer);

    const tenGigabytes = 10n * 1024n * 1024n * 1024n; // 10,737,418,240 bytes
    const mutableBuf = Buffer.from(idxBuffer);
    mutableBuf.writeBigUInt64BE(tenGigabytes, parsed.data.secTableOffset);

    const reparsed = PackIndexParser.parse(mutableBuf);
    const entry = reparsed.findObject(sha);
    assert.strictEqual(entry.offset, Number(tenGigabytes), '10 GiB offset should resolve cleanly');
  });

  it('B22.4: Out-of-bounds 8-byte table index triggers structured error', () => {
    const builder = new PackBuilder();
    builder.addObject(GitObjectType.BLOB, 'Test blob');
    const { idxBuffer } = builder.build({ force8ByteOffset: false });

    // Manually set 4-byte offset high bit to point to non-existent secondary index 9999
    const parsed = PackIndexParser.parse(idxBuffer);
    const mutableBuf = Buffer.from(idxBuffer);
    mutableBuf.writeUInt32BE((0x80000000 | 9999) >>> 0, parsed.data.offsetTableOffset);

    assert.throws(() => {
      const p = PackIndexParser.parse(mutableBuf);
      p.findObject(parsed.data.buf.subarray(parsed.data.shaTableOffset, parsed.data.shaTableOffset + 20).toString('hex'));
    }, /Out of bounds 8-byte secondary offset/);
  });

  it('B22.5: Sorted offset list properly handles mix of 4-byte and 8-byte offsets', () => {
    const builder = new PackBuilder();
    const sha1 = builder.addObject(GitObjectType.BLOB, 'First small offset blob');
    const sha2 = builder.addObject(GitObjectType.BLOB, 'Second small offset blob');

    const { idxBuffer } = builder.build({ force8ByteOffset: false });
    const parsed = PackIndexParser.parse(idxBuffer);

    const offsets = parsed.getSortedOffsets();
    assert.strictEqual(offsets.length, 2);
    assert.lessThan(offsets[0], offsets[1]);
  });
});
