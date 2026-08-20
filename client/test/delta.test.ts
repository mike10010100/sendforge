import { describe, expect, it } from 'vitest';
import {
  applyDelta,
  applyGitDelta,
  DeltaBaseCache,
  DeltaBaseSizeMismatchError,
  DeltaBoundsError,
  DeltaSizeMismatchError,
  MalformedDeltaError,
  parseDeltaHeader,
} from '../src/engine/delta.js';

/**
 * Helper to encode variable-length LEB128 integer.
 */
function encodeLeb128(value: number): number[] {
  const bytes: number[] = [];
  let v = value;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v > 0) {
      b |= 0x80;
    }
    bytes.push(b);
  } while (v > 0);
  return bytes;
}

/**
 * Helper to build a delta stream with header and raw instructions.
 */
function buildDelta(baseSize: number, targetSize: number, instructions: number[]): Uint8Array {
  const baseHeader = encodeLeb128(baseSize);
  const targetHeader = encodeLeb128(targetSize);
  const total = [...baseHeader, ...targetHeader, ...instructions];
  return new Uint8Array(total);
}

describe('Git Delta Decompression Engine (delta.ts)', () => {
  describe('Header Parsing', () => {
    it('parses single-byte and multi-byte LEB128 base and target sizes', () => {
      const delta = buildDelta(500, 100000, []);
      const header = parseDeltaHeader(delta);
      expect(header.baseSize).toBe(500);
      expect(header.targetSize).toBe(100000);
      expect(header.headerBytes).toBeGreaterThan(2);
    });

    it('throws MalformedDeltaError on truncated base size header', () => {
      const truncated = new Uint8Array([0x80]); // MSB set, expects continuation byte
      expect(() => parseDeltaHeader(truncated)).toThrow(MalformedDeltaError);
    });

    it('throws MalformedDeltaError on truncated target size header', () => {
      const truncated = new Uint8Array([0x05, 0x80]); // base size 5, target size truncated
      expect(() => parseDeltaHeader(truncated)).toThrow(MalformedDeltaError);
    });
  });

  describe('COPY and INSERT Opcode Execution', () => {
    it('applies INSERT opcodes to create new data from scratch', () => {
      const base = new Uint8Array(0);
      const literal = new TextEncoder().encode('Hello World!');
      const instructions = [literal.length, ...literal]; // cmd = length (INSERT)
      const delta = buildDelta(0, literal.length, instructions);

      const result = applyGitDelta(base, delta);
      expect(new TextDecoder().decode(result)).toBe('Hello World!');
    });

    it('applies COPY opcodes to copy slices from base object', () => {
      const baseText = 'The quick brown fox jumps over the lazy dog.';
      const base = new TextEncoder().encode(baseText);

      // Copy "quick " (offset 4, size 6) + Copy "lazy dog." (offset 35, size 9)
      // COPY opcode 1: cmd = 0x80 | 0x01 | 0x10 = 0x91 (1 offset byte, 1 size byte)
      // COPY opcode 2: cmd = 0x80 | 0x01 | 0x10 = 0x91 (1 offset byte, 1 size byte)
      const instructions = [
        0x91, 4, 6,
        0x91, 35, 9,
      ];
      const targetSize = 6 + 9;
      const delta = buildDelta(base.length, targetSize, instructions);

      const result = applyGitDelta(base, delta);
      expect(new TextDecoder().decode(result)).toBe('quick lazy dog.');
    });

    it('applies interleaved COPY and INSERT opcodes', () => {
      const baseText = 'function add(a, b) { return a + b; }';
      const base = new TextEncoder().encode(baseText);

      // We want to transform to: 'function multiply(a, b) { return a * b; }'
      // 1. COPY 'function ' (offset 0, size 9) -> cmd 0x91, 0, 9
      // 2. INSERT 'multiply' (length 8) -> cmd 8, ...'multiply'
      // 3. COPY '(a, b) { return a ' (offset 12, size 18) -> cmd 0x91, 12, 18
      // 4. INSERT '*' (length 1) -> cmd 1, '*'
      // 5. COPY ' b; }' (offset 31, size 5) -> cmd 0x91, 31, 5
      const insertMult = Array.from(new TextEncoder().encode('multiply'));
      const insertStar = Array.from(new TextEncoder().encode('*'));

      const instructions = [
        0x91, 0, 9,
        8, ...insertMult,
        0x91, 12, 18,
        1, ...insertStar,
        0x91, 31, 5,
      ];

      const expected = 'function multiply(a, b) { return a * b; }';
      const targetBytes = new TextEncoder().encode(expected);
      const delta = buildDelta(base.length, targetBytes.length, instructions);

      const result = applyDelta(base, delta); // test alias applyDelta
      expect(new TextDecoder().decode(result)).toBe(expected);
    });

    it('handles 0-byte target size correctly', () => {
      const base = new TextEncoder().encode('Some existing content');
      const delta = buildDelta(base.length, 0, []);
      const result = applyGitDelta(base, delta);
      expect(result.length).toBe(0);
    });
  });

  describe('COPY Opcode Bitmask Variations & Zero Size Edge Case', () => {
    it('handles multi-byte offset bitmasks (bits 0..3)', () => {
      // Create a 70,000 byte base buffer
      const base = new Uint8Array(70000);
      base[65540] = 0x42;
      base[65541] = 0x43;

      // Copy 2 bytes at offset 65540 (0x10004):
      // Offset bytes: 0x04 (byte 0), 0x00 (byte 1), 0x01 (byte 2) -> mask: 0x01 | 0x04 = 0x05
      // Size: 2 -> mask 0x10
      // cmd = 0x80 | 0x05 | 0x10 = 0x95
      const instructions = [
        0x95,
        0x04, // offset byte 0
        0x01, // offset byte 2 (65536)
        2,    // size byte 0
      ];
      const delta = buildDelta(base.length, 2, instructions);
      const result = applyGitDelta(base, delta);

      expect(result.length).toBe(2);
      expect(result[0]).toBe(0x42);
      expect(result[1]).toBe(0x43);
    });

    it('handles multi-byte size bitmasks (bits 4..6)', () => {
      const base = new Uint8Array(5000);
      for (let i = 0; i < 5000; i++) base[i] = i % 256;

      // Copy 1000 bytes (0x03E8):
      // Size bytes: 0xE8 (byte 0), 0x03 (byte 1) -> mask: 0x10 | 0x20 = 0x30
      // Offset: 0 (mask 0)
      // cmd = 0x80 | 0x30 = 0xB0
      const instructions = [
        0xB0,
        0xE8, // size byte 0
        0x03, // size byte 1
      ];
      const delta = buildDelta(base.length, 1000, instructions);
      const result = applyGitDelta(base, delta);

      expect(result.length).toBe(1000);
      expect(result[0]).toBe(0);
      expect(result[999]).toBe(999 % 256);
    });

    it('interprets size = 0 in COPY instruction as exactly 65536 (0x10000) bytes', () => {
      // Git spec: if size bits are all 0 in COPY opcode, size is 65536
      const base = new Uint8Array(70000);
      for (let i = 0; i < 70000; i++) base[i] = (i * 7) % 251;

      // COPY 65536 bytes from offset 0:
      // cmd = 0x80 (no offset bytes -> offset 0, no size bytes -> size 0 -> 65536)
      const instructions = [0x80];
      const delta = buildDelta(base.length, 65536, instructions);

      const result = applyGitDelta(base, delta);
      expect(result.length).toBe(65536);
      expect(result[0]).toBe(base[0]);
      expect(result[65535]).toBe(base[65535]);
    });
  });

  describe('Strict Error Handling & Boundary Protection', () => {
    it('throws DeltaBaseSizeMismatchError when base object length does not match delta header', () => {
      const base = new Uint8Array(10);
      const delta = buildDelta(20, 10, []);
      expect(() => applyGitDelta(base, delta)).toThrow(DeltaBaseSizeMismatchError);
    });

    it('throws DeltaSizeMismatchError when produced bytes do not match expected target size', () => {
      const base = new Uint8Array(10);
      // Expected target size 20, but delta contains no copy/insert instructions
      const delta = buildDelta(10, 20, []);
      expect(() => applyGitDelta(base, delta)).toThrow(DeltaSizeMismatchError);
    });

    it('throws MalformedDeltaError when reserved opcode 0x00 is encountered', () => {
      const base = new Uint8Array(10);
      const instructions = [0x00];
      const delta = buildDelta(10, 10, instructions);
      expect(() => applyGitDelta(base, delta)).toThrow(MalformedDeltaError);
    });

    it('throws DeltaBoundsError when COPY source range exceeds base buffer', () => {
      const base = new Uint8Array(10);
      // Copy 5 bytes starting at offset 8 (8 + 5 = 13 > 10)
      const instructions = [0x91, 8, 5];
      const delta = buildDelta(10, 5, instructions);
      expect(() => applyGitDelta(base, delta)).toThrow(DeltaBoundsError);
    });

    it('throws DeltaBoundsError when COPY destination exceeds target size', () => {
      const base = new Uint8Array(20);
      // Copy 10 bytes into 5 byte target buffer
      const instructions = [0x91, 0, 10];
      const delta = buildDelta(20, 5, instructions);
      expect(() => applyGitDelta(base, delta)).toThrow(DeltaBoundsError);
    });

    it('throws DeltaBoundsError when INSERT instruction exceeds delta stream', () => {
      const base = new Uint8Array(0);
      // INSERT opcode declares 10 bytes, but only 2 bytes provided
      const instructions = [10, 0x01, 0x02];
      const delta = buildDelta(0, 10, instructions);
      expect(() => applyGitDelta(base, delta)).toThrow(DeltaBoundsError);
    });

    it('throws DeltaBoundsError when INSERT destination exceeds target size', () => {
      const base = new Uint8Array(0);
      // Target is 2 bytes, but INSERT is 5 bytes
      const literal = [1, 2, 3, 4, 5];
      const instructions = [5, ...literal];
      const delta = buildDelta(0, 2, instructions);
      expect(() => applyGitDelta(base, delta)).toThrow(DeltaBoundsError);
    });
  });

  describe('DeltaBaseCache (LRU Cache)', () => {
    it('stores and retrieves cached buffers', () => {
      const cache = new DeltaBaseCache(10);
      const data = new Uint8Array([1, 2, 3, 4]);

      cache.set('key1', data);
      expect(cache.get('key1')).toBe(data);
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('evicts least-recently-used item when maxEntries is exceeded', () => {
      const cache = new DeltaBaseCache(3);
      cache.set('k1', new Uint8Array([1]));
      cache.set('k2', new Uint8Array([2]));
      cache.set('k3', new Uint8Array([3]));

      // Access k1 so k2 becomes the oldest
      cache.get('k1');

      // Insert k4 -> should evict k2
      cache.set('k4', new Uint8Array([4]));

      expect(cache.get('k1')).toBeDefined();
      expect(cache.get('k2')).toBeUndefined();
      expect(cache.get('k3')).toBeDefined();
      expect(cache.get('k4')).toBeDefined();
      expect(cache.size).toBe(3);
    });

    it('evicts oldest items when maxBytes limit is exceeded', () => {
      // 100 bytes max capacity
      const cache = new DeltaBaseCache(100, 100);
      const buf60 = new Uint8Array(60);
      const buf30 = new Uint8Array(30);
      const buf20 = new Uint8Array(20);

      cache.set('a', buf60); // 60 bytes
      cache.set('b', buf30); // 90 bytes total

      // Insert buf20 -> 90 + 20 = 110 > 100, evicts 'a'
      cache.set('c', buf20);

      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBeDefined();
      expect(cache.get('c')).toBeDefined();
      expect(cache.byteSize).toBe(50); // 30 + 20
    });

    it('updates byteSize when overwriting existing key', () => {
      const cache = new DeltaBaseCache(10, 1000);
      cache.set('key', new Uint8Array(50));
      expect(cache.byteSize).toBe(50);

      cache.set('key', new Uint8Array(80));
      expect(cache.byteSize).toBe(80);
      expect(cache.size).toBe(1);
    });

    it('resets size and byteSize on clear()', () => {
      const cache = new DeltaBaseCache(10, 1000);
      cache.set('k1', new Uint8Array(100));
      cache.set('k2', new Uint8Array(200));
      expect(cache.size).toBe(2);
      expect(cache.byteSize).toBe(300);

      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.byteSize).toBe(0);
      expect(cache.get('k1')).toBeUndefined();
    });
  });
});
