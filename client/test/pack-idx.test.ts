import { describe, expect, it } from 'vitest';
import {
  MalformedIndexError,
  PackIndex,
  UnsupportedIndexVersionError,
} from '../src/engine/pack-idx.js';

/**
 * Builds a valid binary Git .idx v2 buffer with arbitrary entries.
 */
function createMockIndexV2(options: {
  shas: string[]; // 40-char hex strings
  offsets: number[];
  crcs?: number[];
  largeOffsets?: bigint[];
  packSha?: string;
  indexSha?: string;
  magic?: number;
  version?: number;
  corruptFanout?: boolean;
}): Uint8Array {
  const count = options.shas.length;
  const largeOffsets = options.largeOffsets ?? [];
  const largeCount = largeOffsets.length;

  // Header: 4 bytes magic + 4 bytes version = 8 bytes
  // Fanout: 256 * 4 = 1024 bytes
  // SHA table: count * 20 bytes
  // CRC table: count * 4 bytes
  // Offset4 table: count * 4 bytes
  // Offset8 table: largeCount * 8 bytes
  // Trailer: 20 bytes pack SHA + 20 bytes idx SHA = 40 bytes
  const totalSize = 8 + 1024 + count * 20 + count * 4 + count * 4 + largeCount * 8 + 40;
  const buffer = new Uint8Array(totalSize);
  const dataView = new DataView(buffer.buffer);

  // 1. Header
  const magic = options.magic ?? 0xff744f63;
  const version = options.version ?? 2;
  dataView.setUint32(0, magic, false);
  dataView.setUint32(4, version, false);

  // 2. Sort SHAs and correlate with offsets and CRCs
  const entries: { sha: string; offset: number; crc: number }[] = [];
  for (let i = 0; i < count; i++) {
    const sha = options.shas[i]!.toLowerCase();
    const offset = options.offsets[i] ?? 0;
    const crc = options.crcs?.[i] ?? 0x12345678;
    entries.push({ sha, offset, crc });
  }

  entries.sort((a, b) => a.sha.localeCompare(b.sha));

  // 3. Fanout table
  const fanout = new Uint32Array(256);
  for (const entry of entries) {
    const firstByte = parseInt(entry.sha.slice(0, 2), 16);
    for (let f = firstByte; f < 256; f++) {
      fanout[f] = (fanout[f] ?? 0) + 1;
    }
  }

  if (options.corruptFanout) {
    fanout[10] = 999;
    fanout[11] = 1; // Non-monotonic
  }

  for (let f = 0; f < 256; f++) {
    dataView.setUint32(8 + f * 4, fanout[f]!, false);
  }

  // 4. SHA-1 Table
  let ptr = 1032;
  for (const entry of entries) {
    for (let b = 0; b < 20; b++) {
      buffer[ptr++] = parseInt(entry.sha.slice(b * 2, b * 2 + 2), 16);
    }
  }

  // 5. CRC-32 Table
  for (const entry of entries) {
    dataView.setUint32(ptr, entry.crc, false);
    ptr += 4;
  }

  // 6. 4-Byte Offset Table
  for (const entry of entries) {
    dataView.setUint32(ptr, entry.offset, false);
    ptr += 4;
  }

  // 7. 8-Byte Large Offset Table
  for (const largeOff of largeOffsets) {
    const high32 = Number(largeOff >> 32n);
    const low32 = Number(largeOff & 0xffffffffn);
    dataView.setUint32(ptr, high32, false);
    dataView.setUint32(ptr + 4, low32, false);
    ptr += 8;
  }

  // 8. Trailer Checksums
  const packSha = options.packSha ?? '1111111111111111111111111111111111111111';
  for (let b = 0; b < 20; b++) {
    buffer[ptr++] = parseInt(packSha.slice(b * 2, b * 2 + 2), 16);
  }
  const indexSha = options.indexSha ?? '2222222222222222222222222222222222222222';
  for (let b = 0; b < 20; b++) {
    buffer[ptr++] = parseInt(indexSha.slice(b * 2, b * 2 + 2), 16);
  }

  return buffer;
}

describe('PackIndex (.idx v2) Parser', () => {
  it('parses valid .idx v2 header, fanout, and object count', () => {
    const shas = [
      '0123456789abcdef0123456789abcdef01234567',
      '89abcdef0123456789abcdef0123456789abcdef',
      'fedcba9876543210fedcba9876543210fedcba98',
    ];
    const offsets = [12, 500, 1200];
    const buffer = createMockIndexV2({ shas, offsets });

    const idx = PackIndex.parse(buffer);
    expect(idx.totalObjects).toBe(3);
    expect(idx.getObjectCount()).toBe(3);
    expect(idx.getPackChecksum()).toBe('1111111111111111111111111111111111111111');
    expect(idx.getIndexChecksum()).toBe('2222222222222222222222222222222222222222');
  });

  it('throws MalformedIndexError on buffer too short (<1072 bytes)', () => {
    const shortBuffer = new Uint8Array(500);
    expect(() => PackIndex.parse(shortBuffer)).toThrow(MalformedIndexError);
  });

  it('throws MalformedIndexError on invalid magic number', () => {
    const buffer = createMockIndexV2({
      shas: ['0123456789abcdef0123456789abcdef01234567'],
      offsets: [100],
      magic: 0x12345678,
    });
    expect(() => PackIndex.parse(buffer)).toThrow(MalformedIndexError);
  });

  it('throws UnsupportedIndexVersionError on non-v2 index version', () => {
    const buffer = createMockIndexV2({
      shas: ['0123456789abcdef0123456789abcdef01234567'],
      offsets: [100],
      version: 1,
    });
    expect(() => PackIndex.parse(buffer)).toThrow(UnsupportedIndexVersionError);
  });

  it('throws MalformedIndexError on non-monotonic fanout table', () => {
    const buffer = createMockIndexV2({
      shas: ['0123456789abcdef0123456789abcdef01234567'],
      offsets: [100],
      corruptFanout: true,
    });
    expect(() => PackIndex.parse(buffer)).toThrow(MalformedIndexError);
  });

  it('throws MalformedIndexError if trailing large offsets are not multiple of 8', () => {
    const valid = createMockIndexV2({
      shas: ['0123456789abcdef0123456789abcdef01234567'],
      offsets: [100],
    });
    // Append 3 extra bytes (not multiple of 8)
    const corrupted = new Uint8Array(valid.length + 3);
    corrupted.set(valid);
    expect(() => PackIndex.parse(corrupted)).toThrow(MalformedIndexError);
  });

  describe('Object Search & Fanout Binary Search', () => {
    const shas = [
      '00112233445566778899aabbccddeeff00112233',
      '00aabbccddeeff00112233445566778899aabbcc',
      '0a1b2c3d4e5f00112233445566778899aabbccdd',
      '7f00000000000000000000000000000000000001',
      '8000000000000000000000000000000000000002',
      'feffffffffffffffffffffffffffffffffffffff',
      'ffffffffffffffffffffffffffffffffffffffff',
    ];
    const offsets = [12, 150, 300, 5000, 12000, 95000, 150000];
    const crcs = [0x11111111, 0x22222222, 0x33333333, 0x44444444, 0x55555555, 0x66666666, 0x77777777];

    it('finds existing objects across all fanout buckets including lowest (0x00) and highest (0xFF)', () => {
      const buffer = createMockIndexV2({ shas, offsets, crcs });
      const idx = PackIndex.parse(buffer);

      for (let i = 0; i < shas.length; i++) {
        const sha = shas[i]!;
        const found = idx.findObject(sha);
        expect(found).not.toBeNull();
        expect(found?.shaHex).toBe(sha);
        expect(found?.offset).toBe(offsets[i]);
        expect(found?.crc32).toBe(crcs[i]);
        expect(idx.getObjectOffset(sha)).toBe(offsets[i]);
      }
    });

    it('handles case-insensitive SHA queries and whitespace trimming', () => {
      const buffer = createMockIndexV2({ shas, offsets, crcs });
      const idx = PackIndex.parse(buffer);

      const upperSha = '  00112233445566778899AABBCCDDEEFF00112233  ';
      const found = idx.findObject(upperSha);
      expect(found).not.toBeNull();
      expect(found?.shaHex).toBe('00112233445566778899aabbccddeeff00112233');
      expect(found?.offset).toBe(12);
    });

    it('returns null cleanly for non-existent objects', () => {
      const buffer = createMockIndexV2({ shas, offsets, crcs });
      const idx = PackIndex.parse(buffer);

      // Bucket with 0 items (e.g. 0x01)
      expect(idx.findObject('0100000000000000000000000000000000000000')).toBeNull();
      expect(idx.getObjectOffset('0100000000000000000000000000000000000000')).toBeNull();

      // Bucket with items but different SHA
      expect(idx.findObject('0099999999999999999999999999999999999999')).toBeNull();

      // Invalid SHA inputs
      expect(idx.findObject('invalid-sha')).toBeNull();
      expect(idx.findObject('')).toBeNull();
      expect(idx.findObject('12345')).toBeNull();
    });
  });

  describe('4-Byte and 8-Byte Large Offset Table', () => {
    it('decodes secondary 8-byte offsets for offsets >= 2 GiB with bit 31 set', () => {
      const shas = [
        '1000000000000000000000000000000000000000',
        '2000000000000000000000000000000000000000',
        '3000000000000000000000000000000000000000',
      ];
      // Entry 0: direct 4-byte offset 100
      // Entry 1: MSB set (0x80000000), points to large offset 0
      // Entry 2: MSB set (0x80000001), points to large offset 1
      const offsets = [100, 0x80000000, 0x80000001];
      const largeOffsets = [
        3_000_000_000n, // ~2.79 GiB
        10_995_116_277_760n, // 10 TiB
      ];

      const buffer = createMockIndexV2({ shas, offsets, largeOffsets });
      const idx = PackIndex.parse(buffer);

      expect(idx.getObjectOffset(shas[0]!)).toBe(100);
      expect(idx.getObjectOffset(shas[1]!)).toBe(3_000_000_000);
      expect(idx.getObjectOffset(shas[2]!)).toBe(10_995_116_277_760);
    });

    it('throws MalformedIndexError when large offset index is out of bounds', () => {
      const shas = ['1000000000000000000000000000000000000000'];
      const offsets = [0x80000005]; // index 5, but 0 large offsets exist
      const buffer = createMockIndexV2({ shas, offsets, largeOffsets: [] });
      const idx = PackIndex.parse(buffer);

      expect(() => idx.findObject(shas[0]!)).toThrow(MalformedIndexError);
    });
  });

  describe('Offset Sorting & Byte Span Calculations', () => {
    const shaA = 'a' + '0'.repeat(38) + '1'; // 40 chars
    const shaB = 'b' + '0'.repeat(38) + '2'; // 40 chars
    const shaC = 'c' + '0'.repeat(38) + '3'; // 40 chars
    const shas = [shaC, shaA, shaB];
    // Offsets are not in SHA order:
    // shaA -> offset 1000
    // shaB -> offset 12
    // shaC -> offset 500
    const offsets = [500, 1000, 12];

    it('getSortedOffsets returns all offsets sorted in ascending numerical order', () => {
      const buffer = createMockIndexV2({ shas, offsets });
      const idx = PackIndex.parse(buffer);

      const sorted = idx.getSortedOffsets();
      expect(sorted).toEqual([12, 500, 1000]);
    });

    it('calculates exact byte span [offset, nextOffset - 1] for intermediate objects', () => {
      const buffer = createMockIndexV2({ shas, offsets });
      const idx = PackIndex.parse(buffer);

      // Object at offset 12 (shaB) next offset is 500
      const spanB = idx.getByteSpan(shaB);
      expect(spanB).toEqual({ start: 12, end: 499 });

      // Object at offset 500 (shaC) next offset is 1000
      const spanC = idx.getByteSpan(shaC);
      expect(spanC).toEqual({ start: 500, end: 999 });
    });

    it('calculates byte span for the last object in packfile with and without packFileSize', () => {
      const buffer = createMockIndexV2({ shas, offsets });
      const idx = PackIndex.parse(buffer);

      // Object at offset 1000 (shaA) is the last object
      // With packFileSize = 2000: last byte is packFileSize - 21 = 1979
      const spanAWithPackSize = idx.getByteSpan(shaA, 2000);
      expect(spanAWithPackSize).toEqual({ start: 1000, end: 1979 });

      // Without packFileSize: defaults to offset + 65535
      const spanAWithoutPackSize = idx.getByteSpan(shaA);
      expect(spanAWithoutPackSize).toEqual({ start: 1000, end: 1000 + 65535 });
    });

    it('returns ObjectRange descriptor with CRC32', () => {
      const crcs = [0xaaaaaaaa, 0xbbbbbbbb, 0xcccccccc];
      const buffer = createMockIndexV2({ shas, offsets, crcs });
      const idx = PackIndex.parse(buffer);

      const range = idx.findObjectRange(shaB);
      expect(range).not.toBeNull();
      expect(range?.start).toBe(12);
      expect(range?.end).toBe(499);
      expect(range?.offset).toBe(12);
      expect(range?.endOffset).toBe(499);
      expect(range?.crc32).toBe(0xcccccccc);
    });
  });
});
