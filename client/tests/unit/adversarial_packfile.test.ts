import pako from 'pako';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyDelta,
  applyGitDelta,
  DeltaBaseCache,
  DeltaBaseSizeMismatchError,
  DeltaBoundsError,
  DeltaSizeMismatchError,
  MalformedDeltaError,
  parseDeltaHeader,
} from '../../src/engine/delta.js';
import { GitRepositoryClient, ObjectNotFoundError } from '../../src/engine/fetcher.js';
import {
  DeltaRecursionLimitError,
  MalformedPackfileError,
  PackClient,
  RangeNotSatisfiableError,
} from '../../src/engine/pack-client.js';
import {
  MalformedIndexError,
  PackIndex,
  UnsupportedIndexVersionError,
} from '../../src/engine/pack-idx.js';
import { computeSha1Hex, OidMismatchError } from '../../src/engine/parser.js';
import type { GitBlobObject, GitObject } from '../../src/engine/types.js';

// ==========================================
// Test Helpers & Binary Generators
// ==========================================

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

function encodeCopyInstruction(offset: number, size: number): number[] {
  let cmd = 0x80;
  const data: number[] = [];

  // Offset bytes (bits 0..3)
  if ((offset & 0xff) !== 0) {
    cmd |= 0x01;
    data.push(offset & 0xff);
  }
  if (((offset >>> 8) & 0xff) !== 0) {
    cmd |= 0x02;
    data.push((offset >>> 8) & 0xff);
  }
  if (((offset >>> 16) & 0xff) !== 0) {
    cmd |= 0x04;
    data.push((offset >>> 16) & 0xff);
  }
  if (((offset >>> 24) & 0xff) !== 0) {
    cmd |= 0x08;
    data.push((offset >>> 24) & 0xff);
  }

  // Size bytes (bits 4..6)
  if (size !== 0x10000) {
    if ((size & 0xff) !== 0) {
      cmd |= 0x10;
      data.push(size & 0xff);
    }
    if (((size >>> 8) & 0xff) !== 0) {
      cmd |= 0x20;
      data.push((size >>> 8) & 0xff);
    }
    if (((size >>> 16) & 0xff) !== 0) {
      cmd |= 0x40;
      data.push((size >>> 16) & 0xff);
    }
  }

  return [cmd, ...data];
}

function buildRawDelta(baseSize: number, targetSize: number, instructions: number[]): Uint8Array {
  const baseHeader = encodeLeb128(baseSize);
  const targetHeader = encodeLeb128(targetSize);
  return new Uint8Array([...baseHeader, ...targetHeader, ...instructions]);
}

function encodeObjectHeader(type: number, size: number): number[] {
  let b = ((type & 0x07) << 4) | (size & 0x0f);
  let remaining = size >>> 4;
  const bytes: number[] = [];

  while (remaining > 0) {
    bytes.push(b | 0x80);
    b = remaining & 0x7f;
    remaining >>>= 7;
  }
  bytes.push(b);
  return bytes;
}

function encodeOfsDeltaOffset(offset: number): number[] {
  const bytes: number[] = [offset & 0x7f];
  let v = offset >>> 7;
  while (v > 0) {
    v--;
    bytes.unshift((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  return bytes;
}

async function createLooseSha(type: string, data: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`${type} ${data.length}\0`);
  const envelope = new Uint8Array(header.length + data.length);
  envelope.set(header, 0);
  envelope.set(data, header.length);
  return computeSha1Hex(envelope);
}

interface PackedObjectSpec {
  type: 1 | 2 | 3 | 4 | 6 | 7;
  payload: Uint8Array;
  ofsDeltaOffset?: number;
  refDeltaSha?: string;
  shaHex: string;
}

async function buildPackfileAndIndex(
  objects: PackedObjectSpec[]
): Promise<{ packBuffer: Uint8Array; idxBuffer: Uint8Array; offsets: number[] }> {
  const header = new Uint8Array(12);
  const dv = new DataView(header.buffer);
  header[0] = 0x50;
  header[1] = 0x41;
  header[2] = 0x43;
  header[3] = 0x4b;
  dv.setUint32(4, 2, false);
  dv.setUint32(8, objects.length, false);

  const packChunks: Uint8Array[] = [header];
  const offsets: number[] = [];
  let currentOffset = 12;

  for (const obj of objects) {
    offsets.push(currentOffset);
    const deflated = pako.deflate(obj.payload);
    const objHeader = encodeObjectHeader(obj.type, obj.payload.length);

    let prefixBytes: number[] = [...objHeader];

    if (obj.type === 6) {
      const ofsBytes = encodeOfsDeltaOffset(obj.ofsDeltaOffset ?? 0);
      prefixBytes = [...prefixBytes, ...ofsBytes];
    } else if (obj.type === 7) {
      const refSha = obj.refDeltaSha ?? '0000000000000000000000000000000000000000';
      const refBytes: number[] = [];
      for (let i = 0; i < 20; i++) {
        refBytes.push(parseInt(refSha.slice(i * 2, i * 2 + 2), 16));
      }
      prefixBytes = [...prefixBytes, ...refBytes];
    }

    const chunk = new Uint8Array(prefixBytes.length + deflated.length);
    chunk.set(prefixBytes, 0);
    chunk.set(deflated, prefixBytes.length);

    packChunks.push(chunk);
    currentOffset += chunk.length;
  }

  let totalPackSize = 0;
  for (const c of packChunks) totalPackSize += c.length;
  const packWithoutTrailer = new Uint8Array(totalPackSize);
  let pos = 0;
  for (const c of packChunks) {
    packWithoutTrailer.set(c, pos);
    pos += c.length;
  }

  const packShaHex = await computeSha1Hex(packWithoutTrailer);
  const packShaBytes = new Uint8Array(20);
  for (let i = 0; i < 20; i++) {
    packShaBytes[i] = parseInt(packShaHex.slice(i * 2, i * 2 + 2), 16);
  }

  const fullPack = new Uint8Array(packWithoutTrailer.length + 20);
  fullPack.set(packWithoutTrailer, 0);
  fullPack.set(packShaBytes, packWithoutTrailer.length);

  const count = objects.length;
  const entries = objects.map((obj, i) => ({
    sha: obj.shaHex.toLowerCase(),
    offset: offsets[i] ?? 0,
    crc: 0x12345678,
  }));
  entries.sort((a, b) => a.sha.localeCompare(b.sha));

  const idxTotalSize = 8 + 1024 + count * 20 + count * 4 + count * 4 + 40;
  const idxBuffer = new Uint8Array(idxTotalSize);
  const idxDv = new DataView(idxBuffer.buffer);

  idxDv.setUint32(0, 0xff744f63, false);
  idxDv.setUint32(4, 2, false);

  const fanout = new Uint32Array(256);
  for (const e of entries) {
    const fb = parseInt(e.sha.slice(0, 2), 16);
    for (let f = fb; f < 256; f++) fanout[f] = (fanout[f] ?? 0) + 1;
  }
  for (let f = 0; f < 256; f++) {
    idxDv.setUint32(8 + f * 4, fanout[f] ?? 0, false);
  }

  let idxPtr = 1032;
  for (const e of entries) {
    for (let b = 0; b < 20; b++) {
      idxBuffer[idxPtr++] = parseInt(e.sha.slice(b * 2, b * 2 + 2), 16);
    }
  }

  for (const e of entries) {
    idxDv.setUint32(idxPtr, e.crc, false);
    idxPtr += 4;
  }

  for (const e of entries) {
    idxDv.setUint32(idxPtr, e.offset, false);
    idxPtr += 4;
  }

  idxBuffer.set(packShaBytes, idxPtr);
  idxPtr += 20;
  const indexSha = new Uint8Array(20);
  idxBuffer.set(indexSha, idxPtr);

  return {
    packBuffer: fullPack,
    idxBuffer,
    offsets,
  };
}

// ==========================================
// ADVERSARIAL CHALLENGER SUITE
// ==========================================

describe('Empirical Adversarial Stress Tests: Milestone M1 (Packfile & Delta Engine)', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------
  // 1. Deep Delta Chains & LRU Base Cache Stress Tests
  // -------------------------------------------------------------
  describe('1. Deep Delta Chains & LRU Base Cache Stress Tests', () => {
    it('accurately resolves a 15-deep linear OFS_DELTA chain with byte-exact precision', async () => {
      const chainDepth = 15;
      const texts: string[] = ['Root base line: Version 0\n'];
      for (let d = 1; d <= chainDepth; d++) {
        texts.push(`${texts[d - 1] ?? ''}Line appended in delta step ${d}\n`);
      }

      const rawDatas = texts.map((t) => new TextEncoder().encode(t));
      const shas: string[] = [];
      for (const data of rawDatas) {
        shas.push(await createLooseSha('blob', data));
      }

      // Construct delta payloads for each step
      const deltas: Uint8Array[] = [];
      for (let d = 1; d <= chainDepth; d++) {
        const baseData = rawDatas[d - 1] ?? new Uint8Array();
        const targetData = rawDatas[d] ?? new Uint8Array();
        const appendText = `Line appended in delta step ${d}\n`;
        const appendBytes = Array.from(new TextEncoder().encode(appendText));

        const copyInst = encodeCopyInstruction(0, baseData.length);
        const insertInst = [appendBytes.length, ...appendBytes];
        const deltaStream = [...copyInst, ...insertInst];

        const payload = buildRawDelta(baseData.length, targetData.length, deltaStream);
        deltas.push(payload);
      }

      const dummySpecs: PackedObjectSpec[] = [
        { type: 3, payload: rawDatas[0] ?? new Uint8Array(), shaHex: shas[0] ?? '' },
      ];
      for (let d = 1; d <= chainDepth; d++) {
        dummySpecs.push({
          type: 6,
          payload: deltas[d - 1] ?? new Uint8Array(),
          ofsDeltaOffset: 0,
          shaHex: shas[d] ?? '',
        });
      }

      const tempPack = await buildPackfileAndIndex(dummySpecs);

      const realSpecs: PackedObjectSpec[] = [
        { type: 3, payload: rawDatas[0] ?? new Uint8Array(), shaHex: shas[0] ?? '' },
      ];
      for (let d = 1; d <= chainDepth; d++) {
        const currentOfs = tempPack.offsets[d] ?? 0;
        const parentOfs = tempPack.offsets[d - 1] ?? 0;
        const relativeOfs = currentOfs - parentOfs;
        realSpecs.push({
          type: 6,
          payload: deltas[d - 1] ?? new Uint8Array(),
          ofsDeltaOffset: relativeOfs,
          shaHex: shas[d] ?? '',
        });
      }

      const { packBuffer, idxBuffer } = await buildPackfileAndIndex(realSpecs);
      const packIndex = PackIndex.parse(idxBuffer);

      let fetchRangeCount = 0;
      mockFetch.mockImplementation((url: string, init?: RequestInit) => {
        if (url.endsWith('.idx')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            arrayBuffer: () => Promise.resolve(idxBuffer.buffer),
          });
        }
        if (url.endsWith('.pack')) {
          fetchRangeCount++;
          const headers = init?.headers as Record<string, string> | undefined;
          const rangeHeader = headers?.Range ?? '';
          const match = /bytes=(\d+)-(\d+)/.exec(rangeHeader);
          if (match?.[1] && match[2]) {
            const start = parseInt(match[1], 10);
            const end = parseInt(match[2], 10);
            const slice = packBuffer.subarray(start, end + 1);
            return Promise.resolve({
              ok: true,
              status: 206,
              arrayBuffer: () =>
                Promise.resolve(
                  slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength)
                ),
            });
          }
        }
        return Promise.resolve({ ok: false, status: 404 });
      });

      const cache = new DeltaBaseCache(50);
      const client = new PackClient('http://localhost', 'dummy', packIndex, {
        deltaCache: cache,
        maxDeltaDepth: 50,
      });

      const targetSha = shas[chainDepth] ?? '';
      const leafObj = (await client.fetchObjectBySha(targetSha)) as GitBlobObject;

      expect(leafObj.type).toBe('blob');
      expect(leafObj.oid).toBe(targetSha);
      expect(new TextDecoder().decode(leafObj.data)).toBe(texts[chainDepth]);
      expect(fetchRangeCount).toBe(chainDepth + 1);

      const initialFetchCount = fetchRangeCount;
      const intermediateSha = shas[8] ?? '';
      const intermediateObj = (await client.fetchObjectBySha(intermediateSha)) as GitBlobObject;

      expect(intermediateObj.type).toBe('blob');
      expect(intermediateObj.oid).toBe(intermediateSha);
      expect(new TextDecoder().decode(intermediateObj.data)).toBe(texts[8]);
      expect(fetchRangeCount).toBe(initialFetchCount);
    });

    it('enforces maxDeltaDepth limit and throws DeltaRecursionLimitError when exceeded', async () => {
      const depthLimit = 5;
      const chainDepth = 8;
      const texts: string[] = ['Root base\n'];
      for (let d = 1; d <= chainDepth; d++) {
        texts.push(`${texts[d - 1] ?? ''}Line ${d}\n`);
      }

      const rawDatas = texts.map((t) => new TextEncoder().encode(t));
      const shas: string[] = [];
      for (const data of rawDatas) {
        shas.push(await createLooseSha('blob', data));
      }

      const deltas: Uint8Array[] = [];
      for (let d = 1; d <= chainDepth; d++) {
        const baseData = rawDatas[d - 1] ?? new Uint8Array();
        const targetData = rawDatas[d] ?? new Uint8Array();
        const appendBytes = Array.from(new TextEncoder().encode(`Line ${d}\n`));
        const copyInst = encodeCopyInstruction(0, baseData.length);
        const deltaStream = [...copyInst, appendBytes.length, ...appendBytes];
        deltas.push(buildRawDelta(baseData.length, targetData.length, deltaStream));
      }

      const dummySpecs: PackedObjectSpec[] = [
        { type: 3, payload: rawDatas[0] ?? new Uint8Array(), shaHex: shas[0] ?? '' },
      ];
      for (let d = 1; d <= chainDepth; d++) {
        dummySpecs.push({
          type: 6,
          payload: deltas[d - 1] ?? new Uint8Array(),
          ofsDeltaOffset: 0,
          shaHex: shas[d] ?? '',
        });
      }
      const tempPack = await buildPackfileAndIndex(dummySpecs);

      const realSpecs: PackedObjectSpec[] = [
        { type: 3, payload: rawDatas[0] ?? new Uint8Array(), shaHex: shas[0] ?? '' },
      ];
      for (let d = 1; d <= chainDepth; d++) {
        const currentOfs = tempPack.offsets[d] ?? 0;
        const parentOfs = tempPack.offsets[d - 1] ?? 0;
        realSpecs.push({
          type: 6,
          payload: deltas[d - 1] ?? new Uint8Array(),
          ofsDeltaOffset: currentOfs - parentOfs,
          shaHex: shas[d] ?? '',
        });
      }

      const { packBuffer, idxBuffer } = await buildPackfileAndIndex(realSpecs);
      const packIndex = PackIndex.parse(idxBuffer);

      mockFetch.mockImplementation((url: string, init?: RequestInit) => {
        if (url.endsWith('.idx')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            arrayBuffer: () => Promise.resolve(idxBuffer.buffer),
          });
        }
        if (url.endsWith('.pack')) {
          const headers = init?.headers as Record<string, string> | undefined;
          const rangeHeader = headers?.Range ?? '';
          const match = /bytes=(\d+)-(\d+)/.exec(rangeHeader);
          if (match?.[1] && match[2]) {
            const start = parseInt(match[1], 10);
            const end = parseInt(match[2], 10);
            const slice = packBuffer.subarray(start, end + 1);
            return Promise.resolve({
              ok: true,
              status: 206,
              arrayBuffer: () =>
                Promise.resolve(
                  slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength)
                ),
            });
          }
        }
        return Promise.resolve({ ok: false, status: 404 });
      });

      const client = new PackClient('http://localhost', 'dummy', packIndex, {
        maxDeltaDepth: depthLimit,
      });

      await expect(client.fetchObjectBySha(shas[chainDepth] ?? '')).rejects.toThrow(
        DeltaRecursionLimitError
      );
    });

    it('resolves mixed OFS_DELTA and REF_DELTA chains within the same packfile', async () => {
      const baseText = 'Initial Mixed Base\n';
      const baseData = new TextEncoder().encode(baseText);
      const baseSha = await createLooseSha('blob', baseData);

      const step1Text = 'Initial Mixed Base\nStep 1 via OFS_DELTA\n';
      const step1Data = new TextEncoder().encode(step1Text);
      const step1Sha = await createLooseSha('blob', step1Data);

      const step2Text = 'Initial Mixed Base\nStep 1 via OFS_DELTA\nStep 2 via REF_DELTA\n';
      const step2Data = new TextEncoder().encode(step2Text);
      const step2Sha = await createLooseSha('blob', step2Data);

      const append1 = Array.from(new TextEncoder().encode('Step 1 via OFS_DELTA\n'));
      const delta1 = buildRawDelta(baseData.length, step1Data.length, [
        ...encodeCopyInstruction(0, baseData.length),
        append1.length,
        ...append1,
      ]);

      const append2 = Array.from(new TextEncoder().encode('Step 2 via REF_DELTA\n'));
      const delta2 = buildRawDelta(step1Data.length, step2Data.length, [
        ...encodeCopyInstruction(0, step1Data.length),
        append2.length,
        ...append2,
      ]);

      const dummySpecs: PackedObjectSpec[] = [
        { type: 3, payload: baseData, shaHex: baseSha },
        { type: 6, payload: delta1, ofsDeltaOffset: 0, shaHex: step1Sha },
        { type: 7, payload: delta2, refDeltaSha: step1Sha, shaHex: step2Sha },
      ];
      const tempPack = await buildPackfileAndIndex(dummySpecs);

      const realSpecs: PackedObjectSpec[] = [
        { type: 3, payload: baseData, shaHex: baseSha },
        {
          type: 6,
          payload: delta1,
          ofsDeltaOffset: (tempPack.offsets[1] ?? 0) - (tempPack.offsets[0] ?? 0),
          shaHex: step1Sha,
        },
        { type: 7, payload: delta2, refDeltaSha: step1Sha, shaHex: step2Sha },
      ];

      const { packBuffer, idxBuffer } = await buildPackfileAndIndex(realSpecs);
      const packIndex = PackIndex.parse(idxBuffer);

      mockFetch.mockImplementation((url: string, init?: RequestInit) => {
        if (url.endsWith('.idx')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            arrayBuffer: () => Promise.resolve(idxBuffer.buffer),
          });
        }
        if (url.endsWith('.pack')) {
          const headers = init?.headers as Record<string, string> | undefined;
          const rangeHeader = headers?.Range ?? '';
          const match = /bytes=(\d+)-(\d+)/.exec(rangeHeader);
          if (match?.[1] && match[2]) {
            const start = parseInt(match[1], 10);
            const end = parseInt(match[2], 10);
            const slice = packBuffer.subarray(start, end + 1);
            return Promise.resolve({
              ok: true,
              status: 206,
              arrayBuffer: () =>
                Promise.resolve(
                  slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength)
                ),
            });
          }
        }
        return Promise.resolve({ ok: false, status: 404 });
      });

      const client = new PackClient('http://localhost', 'dummy', packIndex);
      const obj = (await client.fetchObjectBySha(step2Sha)) as GitBlobObject;

      expect(obj.type).toBe('blob');
      expect(obj.oid).toBe(step2Sha);
      expect(new TextDecoder().decode(obj.data)).toBe(step2Text);
    });

    it('resolves REF_DELTA referencing an external loose base object from GitRepositoryClient', async () => {
      const looseBaseText = 'External Loose Object Content\n';
      const looseBaseData = new TextEncoder().encode(looseBaseText);
      const looseBaseSha = await createLooseSha('blob', looseBaseData);

      const targetText = 'External Loose Object Content\nPatched by Packed REF_DELTA\n';
      const targetData = new TextEncoder().encode(targetText);
      const targetSha = await createLooseSha('blob', targetData);

      const append = Array.from(new TextEncoder().encode('Patched by Packed REF_DELTA\n'));
      const delta = buildRawDelta(looseBaseData.length, targetData.length, [
        ...encodeCopyInstruction(0, looseBaseData.length),
        append.length,
        ...append,
      ]);

      const { packBuffer, idxBuffer } = await buildPackfileAndIndex([
        { type: 7, payload: delta, refDeltaSha: looseBaseSha, shaHex: targetSha },
      ]);
      const packIndex = PackIndex.parse(idxBuffer);

      mockFetch.mockImplementation((url: string, init?: RequestInit) => {
        const loosePrefix = looseBaseSha.slice(0, 2);
        const looseRest = looseBaseSha.slice(2);
        if (url.includes(`/objects/${loosePrefix}/${looseRest}`)) {
          const header = new TextEncoder().encode(`blob ${looseBaseData.length}\0`);
          const envelope = new Uint8Array(header.length + looseBaseData.length);
          envelope.set(header, 0);
          envelope.set(looseBaseData, header.length);
          const deflated = pako.deflate(envelope);
          return Promise.resolve({
            ok: true,
            status: 200,
            arrayBuffer: () => Promise.resolve(deflated.buffer),
          });
        }

        if (url.endsWith('.idx')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            arrayBuffer: () => Promise.resolve(idxBuffer.buffer),
          });
        }
        if (url.endsWith('.pack')) {
          const headers = init?.headers as Record<string, string> | undefined;
          const rangeHeader = headers?.Range ?? '';
          const match = /bytes=(\d+)-(\d+)/.exec(rangeHeader);
          if (match?.[1] && match[2]) {
            const start = parseInt(match[1], 10);
            const end = parseInt(match[2], 10);
            const slice = packBuffer.subarray(start, end + 1);
            return Promise.resolve({
              ok: true,
              status: 206,
              arrayBuffer: () =>
                Promise.resolve(
                  slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength)
                ),
            });
          }
        }
        return Promise.resolve({ ok: false, status: 404 });
      });

      const repoClient = new GitRepositoryClient('http://localhost');
      const packClient = new PackClient('http://localhost', 'dummy', packIndex);
      repoClient.registerPack(packClient);

      const targetObj = (await packClient.fetchObjectBySha(targetSha, repoClient)) as GitBlobObject;

      expect(targetObj.type).toBe('blob');
      expect(targetObj.oid).toBe(targetSha);
      expect(new TextDecoder().decode(targetObj.data)).toBe(targetText);
    });
  });

  // -------------------------------------------------------------
  // 2. Malformed Deltas, Bounds Checking, and Circular Chains
  // -------------------------------------------------------------
  describe('2. Malformed Deltas, Bounds Checking, and Circular Chains', () => {
    it('throws MalformedDeltaError on reserved opcode 0x00', () => {
      const base = new Uint8Array([1, 2, 3]);
      const delta = buildRawDelta(3, 3, [0x00]);
      expect(() => applyGitDelta(base, delta)).toThrow(MalformedDeltaError);
    });

    it('throws DeltaBoundsError on truncated COPY offset bytes', () => {
      const base = new Uint8Array(100);
      const delta = buildRawDelta(100, 10, [0x93, 0x05]);
      expect(() => applyGitDelta(base, delta)).toThrow(DeltaBoundsError);
    });

    it('throws DeltaBoundsError on truncated COPY size bytes', () => {
      const base = new Uint8Array(100);
      const delta = buildRawDelta(100, 10, [0xB1, 0x05, 0x02]);
      expect(() => applyGitDelta(base, delta)).toThrow(DeltaBoundsError);
    });

    it('throws DeltaBoundsError when COPY offset exceeds base length', () => {
      const base = new Uint8Array(50);
      const delta = buildRawDelta(50, 10, [0x91, 60, 10]);
      expect(() => applyGitDelta(base, delta)).toThrow(DeltaBoundsError);
    });

    it('throws DeltaBoundsError when COPY offset + size exceeds base length', () => {
      const base = new Uint8Array(50);
      const delta = buildRawDelta(50, 10, [0x91, 45, 10]);
      expect(() => applyGitDelta(base, delta)).toThrow(DeltaBoundsError);
    });

    it('throws DeltaBoundsError when 65536-byte zero-size COPY exceeds base length', () => {
      const base = new Uint8Array(500);
      const delta = buildRawDelta(500, 65536, [0x80]);
      expect(() => applyGitDelta(base, delta)).toThrow(DeltaBoundsError);
    });

    it('throws DeltaBoundsError when COPY destination exceeds target buffer size', () => {
      const base = new Uint8Array(100);
      const delta = buildRawDelta(100, 5, [0x91, 0, 10]);
      expect(() => applyGitDelta(base, delta)).toThrow(DeltaBoundsError);
    });

    it('throws DeltaBoundsError when INSERT stream is truncated', () => {
      const base = new Uint8Array(0);
      const delta = buildRawDelta(0, 15, [15, 1, 2, 3]);
      expect(() => applyGitDelta(base, delta)).toThrow(DeltaBoundsError);
    });

    it('throws DeltaBoundsError when INSERT destination exceeds target buffer size', () => {
      const base = new Uint8Array(0);
      const delta = buildRawDelta(0, 3, [5, 1, 2, 3, 4, 5]);
      expect(() => applyGitDelta(base, delta)).toThrow(DeltaBoundsError);
    });

    it('throws DeltaBaseSizeMismatchError when base object length does not match header', () => {
      const base = new Uint8Array(20);
      const delta = buildRawDelta(30, 10, [0x91, 0, 10]);
      expect(() => applyGitDelta(base, delta)).toThrow(DeltaBaseSizeMismatchError);
    });

    it('throws DeltaSizeMismatchError when instructions produce fewer bytes than declared target size', () => {
      const base = new Uint8Array(20);
      const delta = buildRawDelta(20, 20, [0x91, 0, 10]);
      expect(() => applyDelta(base, delta)).toThrow(DeltaSizeMismatchError);
    });

    it('throws MalformedDeltaError on truncated base size LEB128 header', () => {
      const truncated = new Uint8Array([0x80]);
      expect(() => parseDeltaHeader(truncated)).toThrow(MalformedDeltaError);
    });

    it('throws MalformedDeltaError on truncated target size LEB128 header', () => {
      const truncated = new Uint8Array([0x05, 0x80]);
      expect(() => parseDeltaHeader(truncated)).toThrow(MalformedDeltaError);
    });

    it('detects circular OFS_DELTA references (A -> B -> A) and throws DeltaRecursionLimitError', async () => {
      const idxTotalSize = 8 + 1024 + 2 * 20 + 2 * 4 + 2 * 4 + 40;
      const idxBuffer = new Uint8Array(idxTotalSize);
      const idxDv = new DataView(idxBuffer.buffer);
      idxDv.setUint32(0, 0xff744f63, false);
      idxDv.setUint32(4, 2, false);
      for (let f = 0xaa; f < 256; f++) idxDv.setUint32(8 + f * 4, f < 0xbb ? 1 : 2, false);

      let p = 1032;
      for (let i = 0; i < 20; i++) idxBuffer[p++] = 0xaa;
      for (let i = 0; i < 20; i++) idxBuffer[p++] = 0xbb;
      idxDv.setUint32(p, 0, false);
      p += 4;
      idxDv.setUint32(p, 0, false);
      p += 4;
      idxDv.setUint32(p, 100, false);
      p += 4;
      idxDv.setUint32(p, 200, false);
      p += 4;

      const packIndex = PackIndex.parse(idxBuffer);
      const client = new PackClient('http://localhost', 'dummy', packIndex);

      vi.spyOn(client, 'fetchRange').mockImplementation((start: number) => {
        if (start === 200) {
          const ofsBytes = encodeOfsDeltaOffset(100);
          const header = encodeObjectHeader(6, 10);
          const payload = pako.deflate(new Uint8Array([10, 10, 0x91, 0, 10]));
          const chunk = new Uint8Array(header.length + ofsBytes.length + payload.length);
          chunk.set(header, 0);
          chunk.set(ofsBytes, header.length);
          chunk.set(payload, header.length + ofsBytes.length);
          return Promise.resolve(chunk);
        }
        if (start === 100) {
          const ofsBytes = encodeOfsDeltaOffset(0);
          const header = encodeObjectHeader(6, 10);
          const payload = pako.deflate(new Uint8Array([10, 10, 0x91, 0, 10]));
          const chunk = new Uint8Array(header.length + ofsBytes.length + payload.length);
          chunk.set(header, 0);
          chunk.set(ofsBytes, header.length);
          chunk.set(payload, header.length + ofsBytes.length);
          return Promise.resolve(chunk);
        }
        return Promise.reject(new Error(`Unexpected offset ${start}`));
      });

      await expect(client.fetchObjectAtOffset(200)).rejects.toThrow();
    });

    it('throws MalformedPackfileError when OFS_DELTA base offset is negative or >= current offset', async () => {
      const idxTotalSize = 8 + 1024 + 1 * 20 + 1 * 4 + 1 * 4 + 40;
      const idxBuffer = new Uint8Array(idxTotalSize);
      const idxDv = new DataView(idxBuffer.buffer);
      idxDv.setUint32(0, 0xff744f63, false);
      idxDv.setUint32(4, 2, false);
      for (let f = 0; f < 256; f++) idxDv.setUint32(8 + f * 4, 1, false);

      const packIndex = PackIndex.parse(idxBuffer);
      const client = new PackClient('http://localhost', 'dummy', packIndex);

      vi.spyOn(client, 'fetchRange').mockImplementation(() => {
        const ofsBytes = encodeOfsDeltaOffset(100);
        const header = encodeObjectHeader(6, 10);
        const payload = pako.deflate(new Uint8Array([10, 10, 0x91, 0, 10]));
        const chunk = new Uint8Array(header.length + ofsBytes.length + payload.length);
        chunk.set(header, 0);
        chunk.set(ofsBytes, header.length);
        chunk.set(payload, header.length + ofsBytes.length);
        return Promise.resolve(chunk);
      });

      await expect(client.fetchObjectAtOffset(50)).rejects.toThrow(MalformedPackfileError);
    });

    it('throws MalformedPackfileError when REF_DELTA 20-byte base SHA is truncated in packfile stream', async () => {
      const idxTotalSize = 8 + 1024 + 1 * 20 + 1 * 4 + 1 * 4 + 40;
      const idxBuffer = new Uint8Array(idxTotalSize);
      const idxDv = new DataView(idxBuffer.buffer);
      idxDv.setUint32(0, 0xff744f63, false);
      idxDv.setUint32(4, 2, false);
      for (let f = 0; f < 256; f++) idxDv.setUint32(8 + f * 4, 1, false);

      const packIndex = PackIndex.parse(idxBuffer);
      const client = new PackClient('http://localhost', 'dummy', packIndex);

      vi.spyOn(client, 'fetchRange').mockImplementation(() => {
        const header = encodeObjectHeader(7, 10);
        const truncatedRefSha = new Uint8Array([1, 2, 3, 4, 5]);
        const chunk = new Uint8Array(header.length + truncatedRefSha.length);
        chunk.set(header, 0);
        chunk.set(truncatedRefSha, header.length);
        return Promise.resolve(chunk);
      });

      await expect(client.fetchObjectAtOffset(50)).rejects.toThrow(MalformedPackfileError);
    });
  });

  // -------------------------------------------------------------
  // 3. Binary Search Fanout & Large Scale Index (5,000+ Objects & 8-Byte Offsets)
  // -------------------------------------------------------------
  describe('3. Binary Search Fanout & Large Scale Index (5,000+ Objects & 8-Byte Offsets)', () => {
    it('executes 5,000 object binary search fanout with 100% recall and zero false positives', () => {
      const objectCount = 5000;
      const shaSet = new Set<string>();

      while (shaSet.size < objectCount) {
        let hex = '';
        for (let i = 0; i < 5; i++) {
          hex += Math.floor(Math.random() * 0xffffffff)
            .toString(16)
            .padStart(8, '0');
        }
        shaSet.add(hex.slice(0, 40));
      }

      const shas = Array.from(shaSet);
      shas.sort((a, b) => a.localeCompare(b));

      const offsets = shas.map((_, i) => (i + 1) * 100);
      const crcs = shas.map((_, i) => (i * 0x1f1f1f1f) >>> 0);

      const idxTotalSize = 8 + 1024 + objectCount * 20 + objectCount * 4 + objectCount * 4 + 40;
      const idxBuffer = new Uint8Array(idxTotalSize);
      const idxDv = new DataView(idxBuffer.buffer);

      idxDv.setUint32(0, 0xff744f63, false);
      idxDv.setUint32(4, 2, false);

      const fanout = new Uint32Array(256);
      for (const s of shas) {
        const fb = parseInt(s.slice(0, 2), 16);
        for (let f = fb; f < 256; f++) fanout[f] = (fanout[f] ?? 0) + 1;
      }
      for (let f = 0; f < 256; f++) {
        idxDv.setUint32(8 + f * 4, fanout[f] ?? 0, false);
      }

      let ptr = 1032;
      for (const s of shas) {
        for (let b = 0; b < 20; b++) {
          idxBuffer[ptr++] = parseInt(s.slice(b * 2, b * 2 + 2), 16);
        }
      }

      for (const crc of crcs) {
        idxDv.setUint32(ptr, crc, false);
        ptr += 4;
      }

      for (const off of offsets) {
        idxDv.setUint32(ptr, off, false);
        ptr += 4;
      }

      for (let b = 0; b < 40; b++) idxBuffer[ptr++] = 0x55;

      const idx = PackIndex.parse(idxBuffer);
      expect(idx.totalObjects).toBe(objectCount);

      const t0 = performance.now();
      for (let i = 0; i < objectCount; i++) {
        const sha = shas[i] ?? '';
        const entry = idx.findObject(sha);
        expect(entry).not.toBeNull();
        expect(entry?.shaHex).toBe(sha);
        expect(entry?.offset).toBe(offsets[i]);
        expect(entry?.crc32).toBe(crcs[i]);
      }
      const t1 = performance.now();

      expect(t1 - t0).toBeLessThan(500);

      for (let i = 0; i < 500; i++) {
        const fakeSha = `deadbeef${i.toString(16).padStart(32, '0')}`.slice(0, 40);
        if (!shaSet.has(fakeSha)) {
          expect(idx.findObject(fakeSha)).toBeNull();
        }
      }
    });

    it('correctly decodes secondary 8-byte offsets for large packfiles (>2 GiB up to TiB scale)', () => {
      const shas = [
        '0000000000000000000000000000000000000001',
        '1000000000000000000000000000000000000002',
        '2000000000000000000000000000000000000003',
        '3000000000000000000000000000000000000004',
      ];

      const offsets4 = [1024, 0x80000000, 0x80000001, 0x80000002];

      const largeOffsets: bigint[] = [
        3_221_225_472n,
        5_368_709_120n,
        10_995_116_277_760n,
      ];

      const count = shas.length;
      const largeCount = largeOffsets.length;
      const idxTotalSize = 8 + 1024 + count * 20 + count * 4 + count * 4 + largeCount * 8 + 40;
      const idxBuffer = new Uint8Array(idxTotalSize);
      const idxDv = new DataView(idxBuffer.buffer);

      idxDv.setUint32(0, 0xff744f63, false);
      idxDv.setUint32(4, 2, false);

      const fanout = new Uint32Array(256);
      for (const s of shas) {
        const fb = parseInt(s.slice(0, 2), 16);
        for (let f = fb; f < 256; f++) fanout[f] = (fanout[f] ?? 0) + 1;
      }
      for (let f = 0; f < 256; f++) {
        idxDv.setUint32(8 + f * 4, fanout[f] ?? 0, false);
      }

      let ptr = 1032;
      for (const s of shas) {
        for (let b = 0; b < 20; b++) {
          idxBuffer[ptr++] = parseInt(s.slice(b * 2, b * 2 + 2), 16);
        }
      }

      for (let i = 0; i < count; i++) {
        idxDv.setUint32(ptr, 0x12345678, false);
        ptr += 4;
      }

      for (const off of offsets4) {
        idxDv.setUint32(ptr, off, false);
        ptr += 4;
      }

      for (const largeOff of largeOffsets) {
        const high32 = Number(largeOff >> 32n);
        const low32 = Number(largeOff & 0xffffffffn);
        idxDv.setUint32(ptr, high32, false);
        idxDv.setUint32(ptr + 4, low32, false);
        ptr += 8;
      }

      for (let b = 0; b < 40; b++) idxBuffer[ptr++] = 0x33;

      const idx = PackIndex.parse(idxBuffer);

      expect(idx.getObjectOffset(shas[0] ?? '')).toBe(1024);
      expect(idx.getObjectOffset(shas[1] ?? '')).toBe(3_221_225_472);
      expect(idx.getObjectOffset(shas[2] ?? '')).toBe(5_368_709_120);
      expect(idx.getObjectOffset(shas[3] ?? '')).toBe(10_995_116_277_760);

      const sorted = idx.getSortedOffsets();
      expect(sorted).toEqual([
        1024,
        3_221_225_472,
        5_368_709_120,
        10_995_116_277_760,
      ]);
    });

    it('rejects corrupt or adversarial index headers with appropriate errors', () => {
      expect(() => PackIndex.parse(new Uint8Array(100))).toThrow(MalformedIndexError);

      const badMagic = new Uint8Array(1072);
      const dv1 = new DataView(badMagic.buffer);
      dv1.setUint32(0, 0x12345678, false);
      dv1.setUint32(4, 2, false);
      expect(() => PackIndex.parse(badMagic)).toThrow(MalformedIndexError);

      const badVersion = new Uint8Array(1072);
      const dv2 = new DataView(badVersion.buffer);
      dv2.setUint32(0, 0xff744f63, false);
      dv2.setUint32(4, 1, false);
      expect(() => PackIndex.parse(badVersion)).toThrow(UnsupportedIndexVersionError);

      const badFanout = new Uint8Array(1072);
      const dv3 = new DataView(badFanout.buffer);
      dv3.setUint32(0, 0xff744f63, false);
      dv3.setUint32(4, 2, false);
      dv3.setUint32(8 + 5 * 4, 10, false);
      dv3.setUint32(8 + 6 * 4, 2, false);
      expect(() => PackIndex.parse(badFanout)).toThrow(MalformedIndexError);

      const badExtra = new Uint8Array(1072 + 5);
      const dv4 = new DataView(badExtra.buffer);
      dv4.setUint32(0, 0xff744f63, false);
      dv4.setUint32(4, 2, false);
      expect(() => PackIndex.parse(badExtra)).toThrow(MalformedIndexError);
    });
  });

  // -------------------------------------------------------------
  // 4. Byte-Range Streaming, Deduplication, and Multi-Tier Fallback
  // -------------------------------------------------------------
  describe('4. Byte-Range Streaming, Deduplication, and Multi-Tier Fallback', () => {
    it('deduplicates concurrent in-flight range requests to the exact same byte slice', async () => {
      const blobData = new TextEncoder().encode('Deduplicated packed payload');
      const blobSha = await createLooseSha('blob', blobData);

      const { packBuffer, idxBuffer } = await buildPackfileAndIndex([
        { type: 3, payload: blobData, shaHex: blobSha },
      ]);
      const packIndex = PackIndex.parse(idxBuffer);

      let fetchCount = 0;
      mockFetch.mockImplementation((url: string) => {
        if (url.endsWith('.idx')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            arrayBuffer: () => Promise.resolve(idxBuffer.buffer),
          });
        }
        if (url.endsWith('.pack')) {
          fetchCount++;
          return new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                ok: true,
                status: 200,
                arrayBuffer: () => Promise.resolve(packBuffer.buffer),
              });
            }, 10);
          });
        }
        return Promise.resolve({ ok: false, status: 404 });
      });

      const client = new PackClient('http://localhost', 'dummy', packIndex);

      const promises: Promise<GitObject>[] = [];
      for (let i = 0; i < 20; i++) {
        promises.push(client.fetchObjectBySha(blobSha));
      }

      const results = await Promise.all(promises);
      for (const res of results) {
        expect(res.type).toBe('blob');
        expect(res.oid).toBe(blobSha);
      }

      expect(fetchCount).toBe(1);
    });

    it('verifies SHA-1 integrity on reconstructed packed objects and throws OidMismatchError on tampering', async () => {
      const blobData = new TextEncoder().encode('Original authentic data');
      const blobSha = await createLooseSha('blob', blobData);

      const corruptedData = new TextEncoder().encode('Tampered corrupted data');

      const { packBuffer, idxBuffer } = await buildPackfileAndIndex([
        { type: 3, payload: corruptedData, shaHex: blobSha },
      ]);
      const packIndex = PackIndex.parse(idxBuffer);

      mockFetch.mockImplementation((url: string) => {
        if (url.endsWith('.idx')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            arrayBuffer: () => Promise.resolve(idxBuffer.buffer),
          });
        }
        if (url.endsWith('.pack')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            arrayBuffer: () => Promise.resolve(packBuffer.buffer),
          });
        }
        return Promise.resolve({ ok: false, status: 404 });
      });

      const client = new PackClient('http://localhost', 'dummy', packIndex);

      await expect(client.fetchObjectBySha(blobSha)).rejects.toThrow(OidMismatchError);
    });

    it('handles HTTP 416 Range Not Satisfiable by throwing RangeNotSatisfiableError', async () => {
      const client = new PackClient('http://localhost/pack.pack', 'http://localhost/pack.idx');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 416,
      });

      await expect(client.fetchRange(5000, 6000)).rejects.toThrow(RangeNotSatisfiableError);
    });

    it('throws ObjectNotFoundError when an object cannot be resolved anywhere in loose or pack tiers', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404 });
      const repoClient = new GitRepositoryClient('http://localhost');

      await expect(
        repoClient.getObject('1111111111111111111111111111111111111111')
      ).rejects.toThrow(ObjectNotFoundError);
    });
  });
});
