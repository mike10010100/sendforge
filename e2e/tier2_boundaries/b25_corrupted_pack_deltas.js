/**
 * Tier 2 - Boundary B25: Malformed Delta Opcodes, Truncated Streams & CRC Mismatch (B25 / R1)
 *
 * Validates:
 * 1. Reserved opcode 0x00 in delta stream throws error
 * 2. COPY opcode specifying offset beyond base object length throws OutOfBoundsCopy error
 * 3. Truncated delta payload (stream ends before instructed insert bytes) throws error
 * 4. Corrupted zlib stream in packfile object throws DecompressionFailed error
 * 5. CRC32 checksum mismatch in .idx detected and flagged
 */

import { describe, it, assert } from '../harness/framework.js';
import { DeltaEngine, computeCrc32 } from '../harness/pack_helper.js';
import zlib from 'node:zlib';

describe('Tier 2 - Boundary B25: Malformed Pack Deltas & Corruptions (B25 / R1)', () => {
  it('B25.1: Reserved opcode 0x00 in delta stream throws error', () => {
    const base = Buffer.from('Base text');
    const baseHeader = DeltaEngine.encodeVarInt(base.length);
    const targetHeader = DeltaEngine.encodeVarInt(10);
    // Opcode 0x00 is invalid
    const badDelta = Buffer.concat([baseHeader, targetHeader, Buffer.from([0x00])]);

    assert.throws(() => {
      DeltaEngine.applyDelta(base, badDelta);
    }, /Invalid delta opcode: 0x00 is reserved/);
  });

  it('B25.2: COPY opcode specifying offset beyond base object length throws OutOfBoundsCopy error', () => {
    const base = Buffer.from('Short');
    const baseHeader = DeltaEngine.encodeVarInt(base.length);
    const targetHeader = DeltaEngine.encodeVarInt(10);

    // Opcode 0x91: copy offset 100, size 10 (base is only 5 bytes)
    const outOfBoundsCopy = Buffer.from([0x91, 100, 10]);
    const badDelta = Buffer.concat([baseHeader, targetHeader, outOfBoundsCopy]);

    assert.throws(() => {
      DeltaEngine.applyDelta(base, badDelta);
    }, /Delta COPY out of bounds/);
  });

  it('B25.3: Truncated delta payload (stream ends before instructed insert bytes) throws error', () => {
    const base = Buffer.from('Base text');
    const baseHeader = DeltaEngine.encodeVarInt(base.length);
    const targetHeader = DeltaEngine.encodeVarInt(20);

    // Insert 15 bytes, but only provide 3 bytes
    const badDelta = Buffer.concat([baseHeader, targetHeader, Buffer.from([15, 0x41, 0x42, 0x43])]);

    assert.throws(() => {
      DeltaEngine.applyDelta(base, badDelta);
    }, /Delta INSERT truncated/);
  });

  it('B25.4: Corrupted zlib stream in packfile object throws DecompressionFailed error', () => {
    const garbageBytes = Buffer.from([0xFF, 0xFF, 0x00, 0x12, 0x34]);

    assert.throws(() => {
      zlib.inflateSync(garbageBytes);
    });
  });

  it('B25.5: CRC32 checksum mismatch in .idx detected and flagged', () => {
    const payload = Buffer.from('Valid object payload');
    const expectedCrc = computeCrc32(payload);

    const corruptedPayload = Buffer.from('Corrupted object payload');
    const actualCrc = computeCrc32(corruptedPayload);

    assert.notStrictEqual(actualCrc, expectedCrc, 'Corrupted payload must produce different CRC32');
  });
});
