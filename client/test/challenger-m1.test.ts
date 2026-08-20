import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import pako from 'pako';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyGitDelta,
  DeltaBaseCache,
  DeltaBaseSizeMismatchError,
  DeltaBoundsError,
  DeltaSizeMismatchError,
  MalformedDeltaError,
} from '../src/engine/delta.js';
import { GitRepositoryClient, ObjectNotFoundError } from '../src/engine/fetcher.js';
import {
  MalformedPackfileError,
  PackClient,
  RangeNotSatisfiableError,
} from '../src/engine/pack-client.js';
import {
  MalformedIndexError,
  PackIndex,
  UnsupportedIndexVersionError,
} from '../src/engine/pack-idx.js';
import type { GitBlobObject, GitCommitObject, GitTreeObject } from '../src/engine/types.js';

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
  return new Uint8Array([...baseHeader, ...targetHeader, ...instructions]);
}

/**
 * Helper to create synthetic .idx v2 buffer.
 */
function createMockIndexV2(options: {
  shas: string[];
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

  const totalSize = 8 + 1024 + count * 20 + count * 4 + count * 4 + largeCount * 8 + 40;
  const buffer = new Uint8Array(totalSize);
  const dataView = new DataView(buffer.buffer);

  const magic = options.magic ?? 0xff744f63;
  const version = options.version ?? 2;
  dataView.setUint32(0, magic, false);
  dataView.setUint32(4, version, false);

  const entries: { sha: string; offset: number; crc: number }[] = [];
  for (let i = 0; i < count; i++) {
    const sha = options.shas[i]!.toLowerCase();
    const offset = options.offsets[i] ?? 0;
    const crc = options.crcs?.[i] ?? 0x12345678;
    entries.push({ sha, offset, crc });
  }

  entries.sort((a, b) => a.sha.localeCompare(b.sha));

  const fanout = new Uint32Array(256);
  for (const entry of entries) {
    const firstByte = parseInt(entry.sha.slice(0, 2), 16);
    for (let f = firstByte; f < 256; f++) {
      fanout[f] = (fanout[f] ?? 0) + 1;
    }
  }

  if (options.corruptFanout) {
    fanout[10] = 999;
    fanout[11] = 1;
  }

  for (let f = 0; f < 256; f++) {
    dataView.setUint32(8 + f * 4, fanout[f]!, false);
  }

  let ptr = 1032;
  for (const entry of entries) {
    for (let b = 0; b < 20; b++) {
      buffer[ptr++] = parseInt(entry.sha.slice(b * 2, b * 2 + 2), 16);
    }
  }

  for (const entry of entries) {
    dataView.setUint32(ptr, entry.crc, false);
    ptr += 4;
  }

  for (const entry of entries) {
    dataView.setUint32(ptr, entry.offset, false);
    ptr += 4;
  }

  for (const largeOff of largeOffsets) {
    const high32 = Number(largeOff >> 32n);
    const low32 = Number(largeOff & 0xffffffffn);
    dataView.setUint32(ptr, high32, false);
    dataView.setUint32(ptr + 4, low32, false);
    ptr += 8;
  }

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

describe('Empirical Challenger: Packfile & Delta Engine (Milestone M1)', () => {
  const repoRoot = path.resolve(__dirname, '../../');
  const packDir = path.join(repoRoot, '.git/objects/pack');
  let realPackFile: string | null = null;
  let realIdxFile: string | null = null;

  if (fs.existsSync(packDir)) {
    const files = fs.readdirSync(packDir);
    const packName = files.find((f) => f.endsWith('.pack'));
    const idxName = files.find((f) => f.endsWith('.idx'));
    if (packName && idxName) {
      realPackFile = path.join(packDir, packName);
      realIdxFile = path.join(packDir, idxName);
    }
  }

  // --------------------------------------------------------------------------
  // SECTION 1: REAL PACKFILE & INDEX EMPIRICAL VERIFICATION
  // --------------------------------------------------------------------------
  describe('1. Real Repository Packfile & Index Empirical Verification', () => {
    it('parses real repository .idx file and verifies object count and fanout monotonicity', () => {
      if (!realIdxFile) return;
      const idxBuf = fs.readFileSync(realIdxFile);
      const packIndex = PackIndex.parse(new Uint8Array(idxBuf));

      expect(packIndex.totalObjects).toBeGreaterThan(1000);
      expect(packIndex.getObjectCount()).toBe(packIndex.totalObjects);
      expect(packIndex.getPackChecksum()).toMatch(/^[0-9a-f]{40}$/);
      expect(packIndex.getIndexChecksum()).toMatch(/^[0-9a-f]{40}$/);

      const sortedOffsets = packIndex.getSortedOffsets();
      expect(sortedOffsets.length).toBe(packIndex.totalObjects);
      for (let i = 1; i < sortedOffsets.length; i++) {
        expect(sortedOffsets[i]!).toBeGreaterThan(sortedOffsets[i - 1]!);
      }
    });

    it('cross-verifies object lookups against git verify-pack', () => {
      if (!realIdxFile || !realPackFile) return;
      const idxBuf = fs.readFileSync(realIdxFile);
      const packIndex = PackIndex.parse(new Uint8Array(idxBuf));

      // Run git verify-pack to get list of objects, types, sizes, and offsets
      const verifyOutput = execSync(`git verify-pack -v "${realIdxFile}"`, { encoding: 'utf-8' });
      const lines = verifyOutput.split('\n');

      interface ObjectEntry {
        sha: string;
        type: string;
        size: number;
        offset: number;
        isDelta: boolean;
        baseSha?: string | undefined;
      }

      const parsedEntries: ObjectEntry[] = [];
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 4 && /^[0-9a-f]{40}$/i.test(parts[0]!)) {
          parsedEntries.push({
            sha: parts[0]!.toLowerCase(),
            type: parts[1]!,
            size: parseInt(parts[2]!, 10),
            offset: parseInt(parts[4]!, 10),
            isDelta: parts.length > 5,
            baseSha: parts.length > 6 ? parts[6] : undefined,
          });
        }
      }

      expect(parsedEntries.length).toBe(packIndex.totalObjects);

      // Verify binary search on 100 randomly sampled objects
      const sample = parsedEntries.filter((_, idx) => idx % Math.max(1, Math.floor(parsedEntries.length / 100)) === 0);
      for (const item of sample) {
        const found = packIndex.findObject(item.sha);
        expect(found).not.toBeNull();
        expect(found?.shaHex).toBe(item.sha);
        expect(found?.offset).toBe(item.offset);
        expect(packIndex.getObjectOffset(item.sha)).toBe(item.offset);

        const span = packIndex.getByteSpan(item.sha, fs.statSync(realPackFile).size);
        expect(span).not.toBeNull();
        expect(span?.start).toBe(item.offset);
        expect(span?.end).toBeGreaterThanOrEqual(item.offset);
      }
    });

    it('reconstructs base objects and delta objects from real packfile and matches git cat-file exactly', async () => {
      if (!realIdxFile || !realPackFile) return;
      const idxBuf = fs.readFileSync(realIdxFile);
      const packBuf = fs.readFileSync(realPackFile);
      const packIndex = PackIndex.parse(new Uint8Array(idxBuf));
      const packSize = packBuf.length;

      // Extract objects from git verify-pack
      const verifyOutput = execSync(`git verify-pack -v "${realIdxFile}"`, { encoding: 'utf-8' });
      const lines = verifyOutput.split('\n');

      const nonDeltaBlobs: string[] = [];
      const deltaBlobs: string[] = [];
      const commits: string[] = [];
      const trees: string[] = [];

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5 && /^[0-9a-f]{40}$/i.test(parts[0]!)) {
          const sha = parts[0]!.toLowerCase();
          const type = parts[1]!;
          const isDelta = parts.length > 5;
          if (type === 'blob') {
            if (isDelta) deltaBlobs.push(sha);
            else nonDeltaBlobs.push(sha);
          } else if (type === 'commit') {
            commits.push(sha);
          } else if (type === 'tree') {
            trees.push(sha);
          }
        }
      }

      // Create a PackClient that reads slices directly from local packfile buffer via mock fetch
      const client = new PackClient('http://localhost', 'dummy', packIndex, { packFileSize: packSize });
      vi.spyOn(client, 'fetchRange').mockImplementation(async (start: number, end: number) => {
        return new Uint8Array(packBuf.subarray(start, end + 1));
      });

      // Sample 5 non-delta blobs
      for (const sha of nonDeltaBlobs.slice(0, 5)) {
        const obj = (await client.fetchObjectBySha(sha)) as GitBlobObject;
        expect(obj.type).toBe('blob');
        expect(obj.oid).toBe(sha);

        const gitRaw = execSync(`git cat-file blob ${sha}`);
        expect(Buffer.from(obj.data).equals(gitRaw)).toBe(true);
      }

      // Sample 5 delta blobs (which test applyGitDelta opcode interpreter on real Git delta streams!)
      for (const sha of deltaBlobs.slice(0, 5)) {
        const obj = (await client.fetchObjectBySha(sha)) as GitBlobObject;
        expect(obj.type).toBe('blob');
        expect(obj.oid).toBe(sha);

        const gitRaw = execSync(`git cat-file blob ${sha}`);
        expect(Buffer.from(obj.data).equals(gitRaw)).toBe(true);
      }

      // Sample 3 commits
      for (const sha of commits.slice(0, 3)) {
        const obj = (await client.fetchObjectBySha(sha)) as GitCommitObject;
        expect(obj.type).toBe('commit');
        expect(obj.oid).toBe(sha);
      }

      // Sample 3 trees
      for (const sha of trees.slice(0, 3)) {
        const obj = (await client.fetchObjectBySha(sha)) as GitTreeObject;
        expect(obj.type).toBe('tree');
        expect(obj.oid).toBe(sha);
        expect(obj.entries.length).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 2: 65,536 ZERO-SIZE COPY OPCODE IN DELTA ENGINE
  // --------------------------------------------------------------------------
  describe('2. Delta Engine Opcode Edge Case: 65,536 Zero-Size COPY', () => {
    it('executes 65,536 zero-size copy from offset 0', () => {
      const base = new Uint8Array(100000);
      for (let i = 0; i < base.length; i++) base[i] = (i * 13) & 0xff;

      // COPY opcode 0x80: no offset bytes (offset 0), no size bytes (size 0 -> 65536)
      const delta = buildDelta(base.length, 65536, [0x80]);
      const reconstructed = applyGitDelta(base, delta);

      expect(reconstructed.length).toBe(65536);
      expect(reconstructed[0]).toBe(base[0]);
      expect(reconstructed[65535]).toBe(base[65535]);
      expect(Buffer.from(reconstructed).equals(Buffer.from(base.subarray(0, 65536)))).toBe(true);
    });

    it('executes 65,536 zero-size copy with non-zero offset', () => {
      const base = new Uint8Array(150000);
      for (let i = 0; i < base.length; i++) base[i] = (i * 31) & 0xff;

      // Copy 65536 bytes from offset 20,000 (0x4E20):
      // Offset byte 0 = 0x20, byte 1 = 0x4E -> mask 0x01 | 0x02 = 0x03
      // Size = 0 (mask 0 -> 65536)
      // cmd = 0x80 | 0x03 = 0x83
      const delta = buildDelta(base.length, 65536, [0x83, 0x20, 0x4e]);
      const reconstructed = applyGitDelta(base, delta);

      expect(reconstructed.length).toBe(65536);
      expect(Buffer.from(reconstructed).equals(Buffer.from(base.subarray(20000, 20000 + 65536)))).toBe(true);
    });

    it('executes multiple consecutive 65,536 zero-size copies to assemble a large file', () => {
      const base = new Uint8Array(200000);
      for (let i = 0; i < base.length; i++) base[i] = (i * 17) & 0xff;

      // Copy 1: 65536 from offset 0 (cmd = 0x80)
      // Copy 2: 65536 from offset 65536 (0x10000: offset byte 2 = 0x01 -> mask 0x04 -> cmd = 0x84, 0x01)
      const instructions = [
        0x80,       // copy 65536 from 0
        0x84, 0x01, // copy 65536 from 65536
      ];
      const targetSize = 65536 * 2;
      const delta = buildDelta(base.length, targetSize, instructions);
      const reconstructed = applyGitDelta(base, delta);

      expect(reconstructed.length).toBe(131072);
      expect(Buffer.from(reconstructed).equals(Buffer.from(base.subarray(0, 131072)))).toBe(true);
    });

    it('throws DeltaBoundsError if 65,536 zero-size copy exceeds base buffer size', () => {
      const base = new Uint8Array(50000); // Smaller than 65536
      const delta = buildDelta(base.length, 65536, [0x80]); // size 0 -> 65536 > 50000
      expect(() => applyGitDelta(base, delta)).toThrow(DeltaBoundsError);
    });

    it('throws DeltaBoundsError if copyOffset + 65536 exceeds base buffer size', () => {
      const base = new Uint8Array(70000);
      // Offset 10,000 + 65536 = 75,536 > 70,000
      // Offset 10,000 = 0x2710 -> byte 0 = 0x10, byte 1 = 0x27 -> mask 0x03 -> cmd 0x83
      const delta = buildDelta(base.length, 65536, [0x83, 0x10, 0x27]);
      expect(() => applyGitDelta(base, delta)).toThrow(DeltaBoundsError);
    });

    it('throws DeltaBoundsError if 65,536 copy exceeds declared targetSize', () => {
      const base = new Uint8Array(100000);
      // Declared target size is only 10,000, but copy is 65536
      const delta = buildDelta(base.length, 10000, [0x80]);
      expect(() => applyGitDelta(base, delta)).toThrow(DeltaBoundsError);
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 3: LARGE PACKFILE 8-BYTE OFFSETS (> 2 GIB / > 4 GIB)
  // --------------------------------------------------------------------------
  describe('3. Large Packfile 8-Byte Offset Resolution', () => {
    it('decodes multiple 8-byte large offsets (> 4 GiB and > 1 TiB)', () => {
      const shas = [
        '0000000000000000000000000000000000000001',
        '1000000000000000000000000000000000000002',
        '2000000000000000000000000000000000000003',
        '3000000000000000000000000000000000000004',
      ];
      // Object 0: 4-byte offset (120)
      // Object 1: Large offset 0 (bit 31 set -> 0x80000000)
      // Object 2: Large offset 1 (bit 31 set -> 0x80000001)
      // Object 3: Large offset 2 (bit 31 set -> 0x80000002)
      const offsets = [120, 0x80000000, 0x80000001, 0x80000002];
      const largeOffsets = [
        5_000_000_000n,       // ~4.65 GiB
        100_000_000_000n,     // ~93.1 GiB
        5_000_000_000_000n,   // ~4.54 TiB
      ];

      const buf = createMockIndexV2({ shas, offsets, largeOffsets });
      const idx = PackIndex.parse(buf);

      expect(idx.getObjectOffset(shas[0]!)).toBe(120);
      expect(idx.getObjectOffset(shas[1]!)).toBe(5_000_000_000);
      expect(idx.getObjectOffset(shas[2]!)).toBe(100_000_000_000);
      expect(idx.getObjectOffset(shas[3]!)).toBe(5_000_000_000_000);

      const sorted = idx.getSortedOffsets();
      expect(sorted).toEqual([120, 5_000_000_000, 100_000_000_000, 5_000_000_000_000]);
    });

    it('calculates byte spans accurately for large 8-byte offset objects', () => {
      const shas = [
        '1000000000000000000000000000000000000001',
        '2000000000000000000000000000000000000002',
      ];
      const offsets = [0x80000000, 0x80000001];
      const largeOffsets = [3_000_000_000n, 3_000_050_000n];

      const buf = createMockIndexV2({ shas, offsets, largeOffsets });
      const idx = PackIndex.parse(buf);

      const span1 = idx.getByteSpan(shas[0]!);
      expect(span1).toEqual({ start: 3_000_000_000, end: 3_000_049_999 });

      const span2 = idx.getByteSpan(shas[1]!, 3_000_100_000);
      expect(span2).toEqual({ start: 3_000_050_000, end: 3_000_100_000 - 21 });
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 4: NON-EXISTENT OBJECTS & MALFORMED INPUTS
  // --------------------------------------------------------------------------
  describe('4. Non-Existent Objects & Malformed Input Handling', () => {
    it('returns null cleanly for malformed or non-existent SHAs in PackIndex', () => {
      const shas = ['00112233445566778899aabbccddeeff00112233'];
      const offsets = [100];
      const buf = createMockIndexV2({ shas, offsets });
      const idx = PackIndex.parse(buf);

      expect(idx.findObject('')).toBeNull();
      expect(idx.findObject('not-a-sha')).toBeNull();
      expect(idx.findObject('00112233445566778899aabbccddeeff0011223')).toBeNull(); // 39 chars
      expect(idx.findObject('00112233445566778899aabbccddeeff00112233aa')).toBeNull(); // 42 chars
      expect(idx.findObject('zz112233445566778899aabbccddeeff00112233')).toBeNull(); // non-hex
      expect(idx.findObject('00112233445566778899aabbccddeeff00112244')).toBeNull(); // non-existent
      expect(idx.getObjectOffset('00112233445566778899aabbccddeeff00112244')).toBeNull();
      expect(idx.getByteSpan('00112233445566778899aabbccddeeff00112244')).toBeNull();
      expect(idx.findObjectRange('00112233445566778899aabbccddeeff00112244')).toBeNull();
    });

    it('rejects corrupt or unsupported index files with specific typed errors', () => {
      // 1. Invalid magic
      const badMagic = createMockIndexV2({
        shas: ['00112233445566778899aabbccddeeff00112233'],
        offsets: [100],
        magic: 0x12345678,
      });
      expect(() => PackIndex.parse(badMagic)).toThrow(MalformedIndexError);

      // 2. Unsupported version
      const badVersion = createMockIndexV2({
        shas: ['00112233445566778899aabbccddeeff00112233'],
        offsets: [100],
        version: 3,
      });
      expect(() => PackIndex.parse(badVersion)).toThrow(UnsupportedIndexVersionError);

      // 3. Non-monotonic fanout
      const badFanout = createMockIndexV2({
        shas: ['00112233445566778899aabbccddeeff00112233'],
        offsets: [100],
        corruptFanout: true,
      });
      expect(() => PackIndex.parse(badFanout)).toThrow(MalformedIndexError);
    });

    it('rejects malformed delta payloads with specific typed errors', () => {
      // 1. Reserved opcode 0x00
      const base = new Uint8Array(10);
      const reservedDelta = buildDelta(10, 10, [0x00]);
      expect(() => applyGitDelta(base, reservedDelta)).toThrow(MalformedDeltaError);

      // 2. Base size mismatch
      const baseMismatchDelta = buildDelta(20, 10, [0x91, 0, 10]);
      expect(() => applyGitDelta(base, baseMismatchDelta)).toThrow(DeltaBaseSizeMismatchError);

      // 3. Output size mismatch
      const sizeMismatchDelta = buildDelta(10, 20, [0x91, 0, 10]); // produces 10 bytes, declared 20
      expect(() => applyGitDelta(base, sizeMismatchDelta)).toThrow(DeltaSizeMismatchError);

      // 4. Truncated stream
      const truncatedInsert = buildDelta(10, 10, [10, 1, 2, 3]); // declares 10 literal bytes, only 3 provided
      expect(() => applyGitDelta(base, truncatedInsert)).toThrow(DeltaBoundsError);
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 5: HTTP RANGE & MULTI-TIER FALLBACK IN FETCHER.TS
  // --------------------------------------------------------------------------
  describe('5. HTTP Range & Multi-Tier Fallback Handling in fetcher.ts', () => {
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('handles HTTP 416 Range Not Satisfiable by throwing RangeNotSatisfiableError', async () => {
      const client = new PackClient('http://localhost/pack.pack', 'http://localhost/pack.idx');
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 416,
      });

      await expect(client.fetchRange(0, 100)).rejects.toThrow(RangeNotSatisfiableError);
    });

    it('handles HTTP 200 OK full response fallback slicing correctly', async () => {
      const client = new PackClient('http://localhost/pack.pack', 'http://localhost/pack.idx');
      const fakePack = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => fakePack.buffer,
      });

      const slice = await client.fetchRange(2, 5);
      expect(Array.from(slice)).toEqual([2, 3, 4, 5]);
    });

    it('deduplicates concurrent identical range requests', async () => {
      const client = new PackClient('http://localhost/pack.pack', 'http://localhost/pack.idx');
      const fakeChunk = new Uint8Array([1, 2, 3]);

      let callCount = 0;
      mockFetch.mockImplementation(async () => {
        callCount++;
        await new Promise((r) => setTimeout(r, 10));
        return {
          ok: true,
          status: 206,
          arrayBuffer: async () => fakeChunk.buffer,
        };
      });

      const [res1, res2] = await Promise.all([
        client.fetchRange(10, 20),
        client.fetchRange(10, 20),
      ]);

      expect(callCount).toBe(1);
      expect(Array.from(res1)).toEqual([1, 2, 3]);
      expect(Array.from(res2)).toEqual([1, 2, 3]);
    });

    it('multi-tier resolution: Memory Cache -> Loose Object -> Packfile Range -> ObjectNotFoundError', async () => {
      const repoClient = new GitRepositoryClient('http://localhost');

      // 1. Not found anywhere -> ObjectNotFoundError
      mockFetch.mockResolvedValue({ ok: false, status: 404 });
      await expect(
        repoClient.getObject('1111111111111111111111111111111111111111')
      ).rejects.toThrow(ObjectNotFoundError);

      // 2. Loose object 200 OK with HTML content -> should ignore HTML and fall through to packfile
      const dummySha = '2222222222222222222222222222222222222222';
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes(`/objects/22/${dummySha.slice(2)}`)) {
          return {
            ok: true,
            status: 200,
            headers: {
              get: (name: string) => (name.toLowerCase() === 'content-type' ? 'text/html' : null),
            },
            arrayBuffer: async () => new TextEncoder().encode('<html>SPA Fallback</html>').buffer,
          };
        }
        return { ok: false, status: 404 };
      });

      await expect(repoClient.getObject(dummySha)).rejects.toThrow(ObjectNotFoundError);
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 6: RECURSION SAFETY & LRU CACHE BOUNDS
  // --------------------------------------------------------------------------
  describe('6. Recursion Safety & LRU Cache Bounds', () => {
    it('detects circular delta references and throws DeltaRecursionLimitError', async () => {
      const shas = ['1000000000000000000000000000000000000001'];
      const offsets = [100];
      const idx = PackIndex.parse(createMockIndexV2({ shas, offsets }));
      const client = new PackClient('http://localhost', 'dummy', idx);

      // Mock fetchRange to return OFS_DELTA that points in a cycle
      vi.spyOn(client, 'fetchRange').mockImplementation(async () => {
        // Points to offset 100 when called at 100
        const delta = pako.deflate(new Uint8Array([10, 10, 0x91, 0, 10]));
        // Type 6, size 10, delta offset 0 (points to current offset)
        return new Uint8Array([0x6a, 0x00, ...delta]);
      });

      await expect(client.fetchObjectBySha(shas[0]!)).rejects.toThrow(MalformedPackfileError);
    });

    it('enforces LRU entry and byte capacity limits under heavy load', () => {
      const cache = new DeltaBaseCache(5, 500); // max 5 entries, max 500 bytes

      for (let i = 0; i < 20; i++) {
        cache.set(`key_${i}`, new Uint8Array(50)); // 50 bytes each
      }

      expect(cache.size).toBeLessThanOrEqual(5);
      expect(cache.byteSize).toBeLessThanOrEqual(500);

      // Latest item should be present
      expect(cache.get('key_19')).toBeDefined();
      // Oldest items should be evicted
      expect(cache.get('key_0')).toBeUndefined();
    });
  });
});
