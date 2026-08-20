/**
 * Tier 2 - Boundary B23: Zero-Byte Files & Single-Byte Blobs in Packfiles (B23 / R1)
 *
 * Validates:
 * 1. Packed empty file (0-byte blob) decoded with size=0 and empty payload
 * 2. Packed 1-byte blob decoded with size=1 and accurate byte value
 * 3. Delta between 0-byte base and non-empty target (pure INSERT opcode)
 * 4. Delta between non-empty base and 0-byte target (0-byte output)
 * 5. Delta reconstruction for large COPY with zero literal inserts
 */

import { describe, it, assert } from '../harness/framework.js';
import { PackBuilder, DeltaEngine, PackIndexParser, GitObjectType } from '../harness/pack_helper.js';
import zlib from 'node:zlib';

describe('Tier 2 - Boundary B23: Empty & Single-Byte Blobs in Packfiles (B23 / R1)', () => {
  it('B23.1: Packed empty file (0-byte blob) decoded with size=0 and empty payload', () => {
    const builder = new PackBuilder();
    const sha = builder.addObject(GitObjectType.BLOB, Buffer.alloc(0));

    const { packBuffer, idxBuffer } = builder.build();
    const parsed = PackIndexParser.parse(idxBuffer);
    const entry = parsed.findObject(sha);
    assert.ok(entry, '0-byte blob must be indexed');

    const slice = packBuffer.subarray(entry.offset);
    let off = 0;
    let b = slice[off++];
    const type = (b >> 4) & 0x07;
    const size = b & 0x0F;

    assert.strictEqual(type, GitObjectType.BLOB);
    assert.strictEqual(size, 0, 'Header size must be 0');

    const decompressed = zlib.inflateSync(slice.subarray(off));
    assert.strictEqual(decompressed.length, 0, 'Decompressed length must be 0');
  });

  it('B23.2: Packed 1-byte blob decoded with size=1 and accurate byte value', () => {
    const builder = new PackBuilder();
    const oneByte = Buffer.from([0x42]); // Character 'B'
    const sha = builder.addObject(GitObjectType.BLOB, oneByte);

    const { packBuffer, idxBuffer } = builder.build();
    const parsed = PackIndexParser.parse(idxBuffer);
    const entry = parsed.findObject(sha);
    assert.ok(entry);

    const slice = packBuffer.subarray(entry.offset);
    let off = 0;
    let b = slice[off++];
    const type = (b >> 4) & 0x07;
    const size = b & 0x0F;

    assert.strictEqual(type, GitObjectType.BLOB);
    assert.strictEqual(size, 1);

    const decompressed = zlib.inflateSync(slice.subarray(off));
    assert.strictEqual(decompressed.length, 1);
    assert.strictEqual(decompressed[0], 0x42);
  });

  it('B23.3: Delta between 0-byte base and non-empty target (pure INSERT opcode)', () => {
    const base = Buffer.alloc(0);
    const target = Buffer.from('Inserted into empty file');

    const delta = DeltaEngine.createDelta(base, target);
    const reconstructed = DeltaEngine.applyDelta(base, delta);

    assert.strictEqual(reconstructed.toString('utf-8'), 'Inserted into empty file');
  });

  it('B23.4: Delta between non-empty base and 0-byte target (0-byte output)', () => {
    const base = Buffer.from('Non-empty content that will be cleared');
    const target = Buffer.alloc(0);

    const delta = DeltaEngine.createDelta(base, target);
    const reconstructed = DeltaEngine.applyDelta(base, delta);

    assert.strictEqual(reconstructed.length, 0, 'Reconstructed target should be 0 bytes');
  });

  it('B23.5: Delta reconstruction for large COPY with zero literal inserts', () => {
    const base = Buffer.alloc(10000, 'K');
    const target = Buffer.alloc(10000, 'K');

    const delta = DeltaEngine.createDelta(base, target);
    const reconstructed = DeltaEngine.applyDelta(base, delta);

    assert.strictEqual(reconstructed.length, 10000);
    assert.deepEqual(reconstructed, base);
  });
});
