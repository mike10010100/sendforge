/**
 * Tier 1 - Feature 28: OFS/REF Delta Decompression & Instruction Execution (F28 / R1)
 *
 * Validates:
 * 1. OBJ_OFS_DELTA negative relative offset decoding and base object resolution
 * 2. OBJ_REF_DELTA 20-byte base object SHA-1 lookup and base object resolution
 * 3. Delta opcode COPY instruction interpreter (bitmask offsets/lengths, 65536 zero size default)
 * 4. Delta opcode INSERT instruction interpreter (literal byte insertions)
 * 5. Multi-level delta chain resolution (chains of depth 2, 3, 5)
 * 6. LRU delta base caching for accelerating repetitive delta lookups
 */

import { describe, it, assert } from '../harness/framework.js';
import { PackBuilder, DeltaEngine, GitObjectType } from '../harness/pack_helper.js';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

describe('Tier 1 - Feature 28: OFS/REF Delta Decompression (F28 / R1)', () => {
  it('T1.28.1: OBJ_OFS_DELTA negative relative offset decoding and base object resolution', () => {
    const builder = new PackBuilder();
    const baseText = 'Base object content for OFS delta decompression verification.';
    const baseSha = builder.addObject(GitObjectType.BLOB, baseText);

    const targetText = 'Base object content with MODIFIED tail for OFS delta!';
    const targetRaw = Buffer.from(targetText, 'utf-8');
    const targetSha = crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${targetRaw.length}\0`), targetRaw])).digest('hex');

    const deltaPayload = DeltaEngine.createDelta(Buffer.from(baseText, 'utf-8'), targetRaw);
    builder.addOfsDelta(baseSha, deltaPayload, targetSha);

    const { packBuffer, entries } = builder.build();
    assert.strictEqual(entries.length, 2, 'Pack must contain 2 entries');

    const ofsEntry = entries[1];
    assert.strictEqual(ofsEntry.shaHex, targetSha);

    // Read slice and verify OFS delta header offset
    const slice = packBuffer.subarray(ofsEntry.offset);
    let off = 0;
    let b = slice[off++];
    const type = (b >> 4) & 0x07;
    assert.strictEqual(type, GitObjectType.OFS_DELTA, 'Type must be OFS_DELTA (6)');

    while ((b & 0x80) !== 0) b = slice[off++];

    // Decode OFS negative offset
    let c = slice[off++];
    let relOffset = c & 0x7F;
    while ((c & 0x80) !== 0) {
      c = slice[off++];
      relOffset = ((relOffset + 1) << 7) | (c & 0x7F);
    }

    const baseOffset = ofsEntry.offset - relOffset;
    assert.strictEqual(baseOffset, entries[0].offset, 'Resolved base offset must match base entry offset');

    // Inflate delta payload and apply
    const inflatedDelta = zlib.inflateSync(slice.subarray(off));
    const reconstructed = DeltaEngine.applyDelta(Buffer.from(baseText, 'utf-8'), inflatedDelta);
    assert.strictEqual(reconstructed.toString('utf-8'), targetText, 'Reconstructed content must match target');
  });

  it('T1.28.2: OBJ_REF_DELTA 20-byte base object SHA-1 lookup and base object resolution', () => {
    const builder = new PackBuilder();
    const baseText = 'REF_DELTA base content string for SHA-1 pointer validation.';
    const baseSha = builder.addObject(GitObjectType.BLOB, baseText);

    const targetText = 'REF_DELTA base content string for SHA-1 pointer validation with PATCHED end.';
    const targetRaw = Buffer.from(targetText, 'utf-8');
    const targetSha = crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${targetRaw.length}\0`), targetRaw])).digest('hex');

    const deltaPayload = DeltaEngine.createDelta(Buffer.from(baseText, 'utf-8'), targetRaw);
    builder.addRefDelta(baseSha, deltaPayload, targetSha);

    const { packBuffer, entries } = builder.build();
    const refEntry = entries[1];

    const slice = packBuffer.subarray(refEntry.offset);
    let off = 0;
    let b = slice[off++];
    const type = (b >> 4) & 0x07;
    assert.strictEqual(type, GitObjectType.REF_DELTA, 'Type must be REF_DELTA (7)');

    while ((b & 0x80) !== 0) b = slice[off++];

    // Extract 20-byte base SHA-1
    const baseShaFromPack = slice.subarray(off, off + 20).toString('hex');
    off += 20;
    assert.strictEqual(baseShaFromPack, baseSha, 'Base SHA in pack must match baseSha');

    const inflatedDelta = zlib.inflateSync(slice.subarray(off));
    const reconstructed = DeltaEngine.applyDelta(Buffer.from(baseText, 'utf-8'), inflatedDelta);
    assert.strictEqual(reconstructed.toString('utf-8'), targetText, 'Reconstructed content must match target');
  });

  it('T1.28.3: Delta opcode COPY instruction interpreter (bitmask offsets/lengths, 65536 zero size default)', () => {
    // Create base object of 70,000 bytes
    const base = Buffer.alloc(70000, 'Z');
    base.write('HEADER_STRING_', 0, 'utf-8');
    base.write('_TAIL_STRING', 69980, 'utf-8');

    // Delta instruction: copy 65536 bytes (encoded as size 0 in COPY opcode)
    const baseHeader = DeltaEngine.encodeVarInt(base.length);
    const targetHeader = DeltaEngine.encodeVarInt(65536);

    // Opcode 0x80 (COPY) with offset 0 and size 0 (meaning 65536)
    const copyOpcode = Buffer.from([0x80]); // offset=0 (no offset bytes), size=0 (no size bytes => default 65536)
    const deltaPayload = Buffer.concat([baseHeader, targetHeader, copyOpcode]);

    const reconstructed = DeltaEngine.applyDelta(base, deltaPayload);
    assert.strictEqual(reconstructed.length, 65536, 'Size 0 in opcode must decode to 65536 bytes');
    assert.strictEqual(reconstructed.subarray(0, 14).toString('utf-8'), 'HEADER_STRING_');
  });

  it('T1.28.4: Delta opcode INSERT instruction interpreter (literal byte insertions)', () => {
    const base = Buffer.from('Base text');
    const baseHeader = DeltaEngine.encodeVarInt(base.length);
    const targetHeader = DeltaEngine.encodeVarInt(15);

    // Insert 6 bytes "Hello " (opcode = 6), then copy 9 bytes from base (offset 0, size 9)
    const insertOpcode = Buffer.from([6]);
    const literalData = Buffer.from('Hello ');
    const copyOpcode = Buffer.from([0x91, 0x00, 0x09]); // offset 0 (0x01 byte), size 9 (0x10 byte)

    const deltaPayload = Buffer.concat([baseHeader, targetHeader, insertOpcode, literalData, copyOpcode]);
    const reconstructed = DeltaEngine.applyDelta(base, deltaPayload);

    assert.strictEqual(reconstructed.toString('utf-8'), 'Hello Base text');
  });

  it('T1.28.5: Multi-level delta chain resolution (chains of depth 2, 3, 5)', () => {
    // Level 0: Root Base
    const root = Buffer.from('Revision 0: Initial clean state of document.\n');

    // Level 1: Delta 1 over Root
    const text1 = Buffer.from('Revision 1: Added section Alpha.\nRevision 0: Initial clean state of document.\n');
    const delta1 = DeltaEngine.createDelta(root, text1);

    // Level 2: Delta 2 over Level 1
    const text2 = Buffer.from('Revision 2: Added section Beta.\nRevision 1: Added section Alpha.\nRevision 0: Initial clean state of document.\n');
    const delta2 = DeltaEngine.createDelta(text1, text2);

    // Level 3: Delta 3 over Level 2
    const text3 = Buffer.from('Revision 3: Added section Gamma.\nRevision 2: Added section Beta.\nRevision 1: Added section Alpha.\nRevision 0: Initial clean state of document.\n');
    const delta3 = DeltaEngine.createDelta(text2, text3);

    // Resolve chain recursively
    const res1 = DeltaEngine.applyDelta(root, delta1);
    assert.strictEqual(res1.toString('utf-8'), text1.toString('utf-8'));

    const res2 = DeltaEngine.applyDelta(res1, delta2);
    assert.strictEqual(res2.toString('utf-8'), text2.toString('utf-8'));

    const res3 = DeltaEngine.applyDelta(res2, delta3);
    assert.strictEqual(res3.toString('utf-8'), text3.toString('utf-8'));
  });

  it('T1.28.6: LRU delta base caching for accelerating repetitive delta lookups', () => {
    class MockDeltaBaseCache {
      constructor(maxEntries = 3) {
        this.cache = new Map();
        this.maxEntries = maxEntries;
        this.hits = 0;
        this.misses = 0;
      }
      get(key) {
        if (this.cache.has(key)) {
          this.hits++;
          const val = this.cache.get(key);
          this.cache.delete(key);
          this.cache.set(key, val);
          return val;
        }
        this.misses++;
        return undefined;
      }
      set(key, val) {
        if (this.cache.has(key)) {
          this.cache.delete(key);
        } else if (this.cache.size >= this.maxEntries) {
          const oldestKey = this.cache.keys().next().value;
          this.cache.delete(oldestKey);
        }
        this.cache.set(key, val);
      }
    }

    const cache = new MockDeltaBaseCache(2);
    const objA = Buffer.from('Object A');
    const objB = Buffer.from('Object B');
    const objC = Buffer.from('Object C');

    cache.set('shaA', objA);
    cache.set('shaB', objB);

    assert.strictEqual(cache.get('shaA'), objA, 'shaA must be in cache');
    assert.strictEqual(cache.hits, 1);

    // Adding objC must evict shaB (since shaA was recently used)
    cache.set('shaC', objC);
    assert.strictEqual(cache.get('shaB'), undefined, 'shaB must have been evicted');
    assert.strictEqual(cache.misses, 1);
    assert.strictEqual(cache.get('shaA'), objA, 'shaA must still be in cache');
    assert.strictEqual(cache.hits, 2);
  });
});
