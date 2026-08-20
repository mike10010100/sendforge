import pako from 'pako';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeltaBaseCache } from '../src/engine/delta.js';
import { GitRepositoryClient, ObjectNotFoundError } from '../src/engine/fetcher.js';
import {
  DeltaRecursionLimitError,
  MalformedPackfileError,
  PackClient,
  RangeNotSatisfiableError,
} from '../src/engine/pack-client.js';
import { PackIndex } from '../src/engine/pack-idx.js';
import { computeSha1Hex } from '../src/engine/parser.js';
import type {
  GitBlobObject,
  GitCommitObject,
  GitTagObject,
  GitTreeObject,
} from '../src/engine/types.js';

interface PackedObjectInput {
  type: 1 | 2 | 3 | 4 | 6 | 7; // 1=commit, 2=tree, 3=blob, 4=tag, 6=ofs_delta, 7=ref_delta
  payload: Uint8Array;
  ofsDeltaOffset?: number; // for type 6: relative offset to base
  refDeltaSha?: string;    // for type 7: 40-char base SHA
  shaHex: string;          // expected full object SHA-1
}

/**
 * Encodes variable-length packfile object header.
 */
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

/**
 * Encodes variable-length OFS_DELTA negative relative offset.
 */
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

/**
 * Builds a real valid `.pack` and `.idx` pair from packed object inputs.
 */
async function buildTestPackfileAndIndex(
  objects: PackedObjectInput[]
): Promise<{ packBuffer: Uint8Array; idxBuffer: Uint8Array; offsets: number[] }> {
  // 1. Build Packfile Header: 'PACK' (4) + version 2 (4) + count (4)
  const header = new Uint8Array(12);
  const dv = new DataView(header.buffer);
  header[0] = 0x50; // P
  header[1] = 0x41; // A
  header[2] = 0x43; // C
  header[3] = 0x4b; // K
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
      // OFS_DELTA
      const ofsBytes = encodeOfsDeltaOffset(obj.ofsDeltaOffset ?? 0);
      prefixBytes = [...prefixBytes, ...ofsBytes];
    } else if (obj.type === 7) {
      // REF_DELTA
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

  // Pack trailer: 20-byte SHA-1 of all preceding bytes
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

  // 2. Build .idx v2 Buffer
  const count = objects.length;
  const entries = objects.map((obj, i) => ({
    sha: obj.shaHex.toLowerCase(),
    offset: offsets[i]!,
    crc: 0x12345678,
  }));
  entries.sort((a, b) => a.sha.localeCompare(b.sha));

  const idxTotalSize = 8 + 1024 + count * 20 + count * 4 + count * 4 + 40;
  const idxBuffer = new Uint8Array(idxTotalSize);
  const idxDv = new DataView(idxBuffer.buffer);

  // Header: \xfftOc + 2
  idxDv.setUint32(0, 0xff744f63, false);
  idxDv.setUint32(4, 2, false);

  // Fanout
  const fanout = new Uint32Array(256);
  for (const e of entries) {
    const fb = parseInt(e.sha.slice(0, 2), 16);
    for (let f = fb; f < 256; f++) fanout[f] = (fanout[f] ?? 0) + 1;
  }
  for (let f = 0; f < 256; f++) {
    idxDv.setUint32(8 + f * 4, fanout[f]!, false);
  }

  // SHA Table
  let idxPtr = 1032;
  for (const e of entries) {
    for (let b = 0; b < 20; b++) {
      idxBuffer[idxPtr++] = parseInt(e.sha.slice(b * 2, b * 2 + 2), 16);
    }
  }

  // CRC Table
  for (const e of entries) {
    idxDv.setUint32(idxPtr, e.crc, false);
    idxPtr += 4;
  }

  // 4-byte Offset Table
  for (const e of entries) {
    idxDv.setUint32(idxPtr, e.offset, false);
    idxPtr += 4;
  }

  // Trailer
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

/**
 * Creates loose envelope and computes its SHA-1 OID.
 */
async function createLooseSha(type: string, data: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`${type} ${data.length}\0`);
  const envelope = new Uint8Array(header.length + data.length);
  envelope.set(header, 0);
  envelope.set(data, header.length);
  return computeSha1Hex(envelope);
}

describe('PackClient (HTTP RFC 7233 Byte-Range Git Packfile Client)', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches base objects (commit, blob) via HTTP 206 Partial Content', async () => {
    const blobData = new TextEncoder().encode('Hello from packed blob!');
    const blobSha = await createLooseSha('blob', blobData);

    const commitText =
      'tree 0000000000000000000000000000000000000000\nauthor Test User <test@example.com> 1700000000 +0000\ncommitter Test User <test@example.com> 1700000000 +0000\n\nInitial packed commit\n';
    const commitData = new TextEncoder().encode(commitText);
    const commitSha = await createLooseSha('commit', commitData);

    const { packBuffer, idxBuffer } = await buildTestPackfileAndIndex([
      { type: 3, payload: blobData, shaHex: blobSha },
      { type: 1, payload: commitData, shaHex: commitSha },
    ]);

    const packIndex = PackIndex.parse(idxBuffer);

    // Mock fetch for idx and pack range requests
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('.idx')) {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => idxBuffer.buffer,
        };
      }
      if (url.endsWith('.pack')) {
        const rangeHeader = (init?.headers as Record<string, string> | undefined)?.['Range'] ?? '';
        const match = /bytes=(\d+)-(\d+)/.exec(rangeHeader);
        if (match && match[1] && match[2]) {
          const start = parseInt(match[1], 10);
          const end = parseInt(match[2], 10);
          const slice = packBuffer.subarray(start, end + 1);
          return {
            ok: true,
            status: 206,
            arrayBuffer: async () => slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength),
          };
        }
      }
      return { ok: false, status: 404 };
    });

    const client = new PackClient('http://localhost', 'dummy', packIndex, { packFileSize: packBuffer.length });

    // Fetch Blob
    const blob = (await client.fetchObjectBySha(blobSha)) as GitBlobObject;
    expect(blob.type).toBe('blob');
    expect(blob.oid).toBe(blobSha);
    expect(new TextDecoder().decode(blob.data)).toBe('Hello from packed blob!');

    // Fetch Commit
    const commit = (await client.fetchObjectBySha(commitSha)) as GitCommitObject;
    expect(commit.type).toBe('commit');
    expect(commit.oid).toBe(commitSha);
    expect(commit.subject).toBe('Initial packed commit');
    expect(commit.author.name).toBe('Test User');
  });

  it('handles server ignoring Range header (HTTP 200 OK full response) by slicing client-side', async () => {
    const blobData = new TextEncoder().encode('Full 200 fallback content');
    const blobSha = await createLooseSha('blob', blobData);

    const { packBuffer, idxBuffer } = await buildTestPackfileAndIndex([
      { type: 3, payload: blobData, shaHex: blobSha },
    ]);

    const packIndex = PackIndex.parse(idxBuffer);

    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('.idx')) {
        return { ok: true, status: 200, arrayBuffer: async () => idxBuffer.buffer };
      }
      if (url.endsWith('.pack')) {
        // Server ignores Range header and returns status 200 with entire pack
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => packBuffer.buffer,
        };
      }
      return { ok: false, status: 404 };
    });

    const client = new PackClient('http://localhost', 'dummy', packIndex);
    const obj = (await client.fetchObjectBySha(blobSha)) as GitBlobObject;

    expect(obj.type).toBe('blob');
    expect(new TextDecoder().decode(obj.data)).toBe('Full 200 fallback content');
  });

  it('throws RangeNotSatisfiableError when server returns HTTP 416', async () => {
    const client = new PackClient('http://localhost/pack.pack', 'http://localhost/pack.idx');

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 416,
    });

    await expect(client.fetchRange(100, 200)).rejects.toThrow(RangeNotSatisfiableError);
  });

  it('resolves OBJ_OFS_DELTA (Type 6) delta compression chain', async () => {
    // Base object: original file
    const baseText = 'Line 1: Alpha\nLine 2: Beta\nLine 3: Gamma\n';
    const baseData = new TextEncoder().encode(baseText);
    const baseSha = await createLooseSha('blob', baseData);

    // Delta object: modifies Line 2 to "Beta Updated"
    // COPY "Line 1: Alpha\n" (offset 0, size 14) -> 0x91, 0, 14
    // INSERT "Line 2: Beta Updated\n" (size 20) -> 20, ...
    // COPY "Line 3: Gamma\n" (offset 27, size 14) -> 0x91, 27, 14
    const deltaInsert = Array.from(new TextEncoder().encode('Line 2: Beta Updated\n'));
    const targetText = 'Line 1: Alpha\nLine 2: Beta Updated\nLine 3: Gamma\n';
    const targetData = new TextEncoder().encode(targetText);
    const targetSha = await createLooseSha('blob', targetData);

    // Build delta stream
    const deltaInstructions = [
      0x91, 0, 14,
      deltaInsert.length, ...deltaInsert,
      0x91, 27, 14,
    ];
    const deltaPayload = new Uint8Array([
      baseData.length,
      targetData.length,
      ...deltaInstructions,
    ]);

    // Build pack with Base first, then OFS_DELTA second
    // Base is at offset 12. Let's build pack to find exact base offset.
    const tempPack = await buildTestPackfileAndIndex([
      { type: 3, payload: baseData, shaHex: baseSha },
      { type: 6, payload: deltaPayload, ofsDeltaOffset: 0, shaHex: targetSha },
    ]);

    const baseOffset = tempPack.offsets[0]!;
    const deltaOffset = tempPack.offsets[1]!;
    const relativeOfs = deltaOffset - baseOffset;

    const { packBuffer, idxBuffer } = await buildTestPackfileAndIndex([
      { type: 3, payload: baseData, shaHex: baseSha },
      { type: 6, payload: deltaPayload, ofsDeltaOffset: relativeOfs, shaHex: targetSha },
    ]);

    const packIndex = PackIndex.parse(idxBuffer);

    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('.idx')) {
        return { ok: true, status: 200, arrayBuffer: async () => idxBuffer.buffer };
      }
      if (url.endsWith('.pack')) {
        const rangeHeader = (init?.headers as Record<string, string> | undefined)?.['Range'] ?? '';
        const match = /bytes=(\d+)-(\d+)/.exec(rangeHeader);
        if (match && match[1] && match[2]) {
          const start = parseInt(match[1], 10);
          const end = parseInt(match[2], 10);
          const slice = packBuffer.subarray(start, end + 1);
          return {
            ok: true,
            status: 206,
            arrayBuffer: async () => slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength),
          };
        }
      }
      return { ok: false, status: 404 };
    });

    const client = new PackClient('http://localhost', 'dummy', packIndex);
    const reconstructed = (await client.fetchObjectBySha(targetSha)) as GitBlobObject;

    expect(reconstructed.type).toBe('blob');
    expect(reconstructed.oid).toBe(targetSha);
    expect(new TextDecoder().decode(reconstructed.data)).toBe(targetText);
  });

  it('resolves OBJ_REF_DELTA (Type 7) base SHA lookup within packfile', async () => {
    const baseText = 'Hello World from base blob';
    const baseData = new TextEncoder().encode(baseText);
    const baseSha = await createLooseSha('blob', baseData);

    const targetText = 'Hello Wonderful World from base blob';
    const targetData = new TextEncoder().encode(targetText);
    const targetSha = await createLooseSha('blob', targetData);

    // Delta instructions:
    // COPY "Hello " (offset 0, size 6) -> 0x91, 0, 6
    // INSERT "Wonderful " (10) -> 10, ...
    // COPY "World from base blob" (offset 6, size 20) -> 0x91, 6, 20
    const insertBytes = Array.from(new TextEncoder().encode('Wonderful '));
    const deltaInstructions = [
      0x91, 0, 6,
      10, ...insertBytes,
      0x91, 6, 20,
    ];
    const deltaPayload = new Uint8Array([
      baseData.length,
      targetData.length,
      ...deltaInstructions,
    ]);

    const { packBuffer, idxBuffer } = await buildTestPackfileAndIndex([
      { type: 3, payload: baseData, shaHex: baseSha },
      { type: 7, payload: deltaPayload, refDeltaSha: baseSha, shaHex: targetSha },
    ]);

    const packIndex = PackIndex.parse(idxBuffer);

    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('.idx')) {
        return { ok: true, status: 200, arrayBuffer: async () => idxBuffer.buffer };
      }
      if (url.endsWith('.pack')) {
        const rangeHeader = (init?.headers as Record<string, string> | undefined)?.['Range'] ?? '';
        const match = /bytes=(\d+)-(\d+)/.exec(rangeHeader);
        if (match && match[1] && match[2]) {
          const start = parseInt(match[1], 10);
          const end = parseInt(match[2], 10);
          const slice = packBuffer.subarray(start, end + 1);
          return {
            ok: true,
            status: 206,
            arrayBuffer: async () => slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength),
          };
        }
      }
      return { ok: false, status: 404 };
    });

    const client = new PackClient('http://localhost', 'dummy', packIndex);
    const reconstructed = (await client.fetchObjectBySha(targetSha)) as GitBlobObject;

    expect(reconstructed.type).toBe('blob');
    expect(reconstructed.oid).toBe(targetSha);
    expect(new TextDecoder().decode(reconstructed.data)).toBe(targetText);
  });

  it('uses DeltaBaseCache to avoid redundant network requests', async () => {
    const blobData = new TextEncoder().encode('Cached blob content');
    const blobSha = await createLooseSha('blob', blobData);

    const { packBuffer, idxBuffer } = await buildTestPackfileAndIndex([
      { type: 3, payload: blobData, shaHex: blobSha },
    ]);

    const packIndex = PackIndex.parse(idxBuffer);
    const cache = new DeltaBaseCache(10);

    let fetchCount = 0;
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('.idx')) {
        return { ok: true, status: 200, arrayBuffer: async () => idxBuffer.buffer };
      }
      if (url.endsWith('.pack')) {
        fetchCount++;
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => packBuffer.buffer,
        };
      }
      return { ok: false, status: 404 };
    });

    const client = new PackClient('http://localhost', 'dummy', packIndex, { deltaCache: cache });

    await client.fetchObjectBySha(blobSha);
    expect(fetchCount).toBe(1);

    // Second fetch should use cache and not increment fetchCount for offset resolution
    await client.fetchObjectBySha(blobSha);
    expect(fetchCount).toBe(1);
  });

  it('detects invalid OFS_DELTA base offset and throws MalformedPackfileError', async () => {
    const blobData = new TextEncoder().encode('Base blob');
    const blobSha = await createLooseSha('blob', blobData);
    const { idxBuffer } = await buildTestPackfileAndIndex([
      { type: 3, payload: blobData, shaHex: blobSha },
    ]);
    const packIndex = PackIndex.parse(idxBuffer);

    const client = new PackClient('http://localhost', 'dummy', packIndex);

    // Return OFS_DELTA with delta offset 0 (points to self -> baseOffset = offset)
    vi.spyOn(client, 'fetchRange').mockResolvedValue(
      new Uint8Array([0x60, 0x00]) // type 6 (OFS_DELTA), ofs 0
    );

    await expect(client.fetchObjectAtOffset(12)).rejects.toThrow(
      MalformedPackfileError
    );
  });

  it('enforces maximum delta recursion depth limit', async () => {
    const blobData = new TextEncoder().encode('Base blob');
    const blobSha = await createLooseSha('blob', blobData);
    const { idxBuffer } = await buildTestPackfileAndIndex([
      { type: 3, payload: blobData, shaHex: blobSha },
    ]);
    const packIndex = PackIndex.parse(idxBuffer);

    // Client with maxDeltaDepth: 2
    const client = new PackClient('http://localhost', 'dummy', packIndex, { maxDeltaDepth: 2 });

    // Mock fetchRange to return chained OFS_DELTA (offset 100 -> 90 -> 80 -> 70 ...)
    vi.spyOn(client, 'fetchRange').mockImplementation(async (_start: number) => {
      // OFS_DELTA pointing 10 bytes back
      const deltaBytes = encodeOfsDeltaOffset(10);
      const header = encodeObjectHeader(6, 10);
      const payload = pako.deflate(new Uint8Array([10, 10, 0x91, 0, 10]));
      const chunk = new Uint8Array(header.length + deltaBytes.length + payload.length);
      chunk.set(header, 0);
      chunk.set(deltaBytes, header.length);
      chunk.set(payload, header.length + deltaBytes.length);
      return chunk;
    });

    await expect(client.fetchObjectAtOffset(100)).rejects.toThrow(
      DeltaRecursionLimitError
    );
  });

  it('preserves object types (commit, tree, tag, blob) on DeltaBaseCache hit via fetchObjectBySha and fetchObjectAtOffset', async () => {
    // 1. Prepare blob
    const blobData = new TextEncoder().encode('Packed blob for type caching');
    const blobSha = await createLooseSha('blob', blobData);

    // 2. Prepare tree
    const fakeBlobShaBytes = new Uint8Array(20);
    fakeBlobShaBytes.fill(0x42);
    const treeEntryHeader = new TextEncoder().encode('100644 hello.txt\0');
    const treePayload = new Uint8Array(treeEntryHeader.length + 20);
    treePayload.set(treeEntryHeader, 0);
    treePayload.set(fakeBlobShaBytes, treeEntryHeader.length);
    const treeSha = await createLooseSha('tree', treePayload);

    // 3. Prepare commit
    const commitText = `tree ${treeSha}\nauthor Developer <dev@example.com> 1700000000 +0000\ncommitter Developer <dev@example.com> 1700000000 +0000\n\nCommit with tree ref\n`;
    const commitData = new TextEncoder().encode(commitText);
    const commitSha = await createLooseSha('commit', commitData);

    // 4. Prepare tag
    const tagText = `object ${commitSha}\ntype commit\ntag v1.0.0\ntagger Release Engineer <rel@example.com> 1700000000 +0000\n\nRelease v1.0.0\n`;
    const tagData = new TextEncoder().encode(tagText);
    const tagSha = await createLooseSha('tag', tagData);

    const { packBuffer, idxBuffer, offsets } = await buildTestPackfileAndIndex([
      { type: 3, payload: blobData, shaHex: blobSha },
      { type: 2, payload: treePayload, shaHex: treeSha },
      { type: 1, payload: commitData, shaHex: commitSha },
      { type: 4, payload: tagData, shaHex: tagSha },
    ]);

    const packIndex = PackIndex.parse(idxBuffer);
    const cache = new DeltaBaseCache(100);

    let fetchCount = 0;
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('.idx')) {
        return { ok: true, status: 200, arrayBuffer: async () => idxBuffer.buffer };
      }
      if (url.endsWith('.pack')) {
        fetchCount++;
        const rangeHeader = (init?.headers as Record<string, string> | undefined)?.['Range'] ?? '';
        const match = /bytes=(\d+)-(\d+)/.exec(rangeHeader);
        if (match && match[1] && match[2]) {
          const start = parseInt(match[1], 10);
          const end = parseInt(match[2], 10);
          const slice = packBuffer.subarray(start, end + 1);
          return {
            ok: true,
            status: 206,
            arrayBuffer: async () => slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength),
          };
        }
      }
      return { ok: false, status: 404 };
    });

    const client = new PackClient('http://localhost', 'dummy', packIndex, {
      deltaCache: cache,
      packFileSize: packBuffer.length,
    });

    // --- First round: initial fetch (cold cache) ---
    const initialBlob = (await client.fetchObjectBySha(blobSha)) as GitBlobObject;
    const initialTree = (await client.fetchObjectBySha(treeSha)) as GitTreeObject;
    const initialCommit = (await client.fetchObjectBySha(commitSha)) as GitCommitObject;
    const initialTag = (await client.fetchObjectBySha(tagSha)) as GitTagObject;

    expect(initialBlob.type).toBe('blob');
    expect(initialTree.type).toBe('tree');
    expect(initialCommit.type).toBe('commit');
    expect(initialTag.type).toBe('tag');
    expect(initialTree.entries).toHaveLength(1);
    expect(initialTree.entries[0]?.name).toBe('hello.txt');
    expect(initialCommit.tree).toBe(treeSha);
    expect(initialTag.targetOid).toBe(commitSha);

    expect(fetchCount).toBe(4);

    // Verify cache size: 4 objects stored once (not duplicated)
    expect(cache.size).toBe(4);
    expect(cache.byteSize).toBe(
      blobData.length + treePayload.length + commitData.length + tagData.length
    );

    // --- Second round: fetchObjectBySha (cache hit) ---
    const cachedBlob = (await client.fetchObjectBySha(blobSha)) as GitBlobObject;
    const cachedTree = (await client.fetchObjectBySha(treeSha)) as GitTreeObject;
    const cachedCommit = (await client.fetchObjectBySha(commitSha)) as GitCommitObject;
    const cachedTag = (await client.fetchObjectBySha(tagSha)) as GitTagObject;

    expect(cachedBlob.type).toBe('blob');
    expect(cachedTree.type).toBe('tree');
    expect(cachedCommit.type).toBe('commit');
    expect(cachedTag.type).toBe('tag');
    expect(cachedTree.entries).toHaveLength(1);
    expect(cachedCommit.subject).toBe('Commit with tree ref');
    expect(cachedTag.tagName).toBe('v1.0.0');

    // No additional network requests
    expect(fetchCount).toBe(4);

    // --- Third round: fetchObjectAtOffset (cache hit) ---
    const offsetBlob = (await client.fetchObjectAtOffset(offsets[0]!)) as GitBlobObject;
    const offsetTree = (await client.fetchObjectAtOffset(offsets[1]!)) as GitTreeObject;
    const offsetCommit = (await client.fetchObjectAtOffset(offsets[2]!)) as GitCommitObject;
    const offsetTag = (await client.fetchObjectAtOffset(offsets[3]!)) as GitTagObject;

    expect(offsetBlob.type).toBe('blob');
    expect(offsetTree.type).toBe('tree');
    expect(offsetCommit.type).toBe('commit');
    expect(offsetTag.type).toBe('tag');
    expect(offsetTree.entries[0]?.name).toBe('hello.txt');
    expect(offsetCommit.author.email).toBe('dev@example.com');
    expect(offsetTag.tagName).toBe('v1.0.0');

    expect(fetchCount).toBe(4);
  });

  it('resolves OBJ_REF_DELTA against an external Tree object fetched via GitRepositoryClient', async () => {
    // 1. Base Tree object outside the packfile
    const fakeBlobShaBytes1 = new Uint8Array(20);
    fakeBlobShaBytes1.fill(0x11);
    const baseTreeEntry1 = new TextEncoder().encode('100644 alpha.txt\0');
    const baseTreePayload = new Uint8Array(baseTreeEntry1.length + 20);
    baseTreePayload.set(baseTreeEntry1, 0);
    baseTreePayload.set(fakeBlobShaBytes1, baseTreeEntry1.length);
    const baseTreeSha = await createLooseSha('tree', baseTreePayload);

    // 2. Target Tree object: adds a second entry "100644 beta.txt\0[20 bytes]"
    const fakeBlobShaBytes2 = new Uint8Array(20);
    fakeBlobShaBytes2.fill(0x22);
    const targetTreeEntry2 = new TextEncoder().encode('100644 beta.txt\0');
    const targetTreeEntry2Buf = new Uint8Array(targetTreeEntry2.length + 20);
    targetTreeEntry2Buf.set(targetTreeEntry2, 0);
    targetTreeEntry2Buf.set(fakeBlobShaBytes2, targetTreeEntry2.length);

    const targetTreePayload = new Uint8Array(baseTreePayload.length + targetTreeEntry2Buf.length);
    targetTreePayload.set(baseTreePayload, 0);
    targetTreePayload.set(targetTreeEntry2Buf, baseTreePayload.length);
    const targetTreeSha = await createLooseSha('tree', targetTreePayload);

    // Delta: COPY base tree (offset 0, len baseTreePayload.length) + INSERT targetTreeEntry2Buf
    const deltaInstructions = [
      0x91, 0, baseTreePayload.length,
      targetTreeEntry2Buf.length, ...Array.from(targetTreeEntry2Buf),
    ];
    const deltaPayload = new Uint8Array([
      baseTreePayload.length,
      targetTreePayload.length,
      ...deltaInstructions,
    ]);

    // Pack contains only the REF_DELTA pointing to baseTreeSha
    const { packBuffer, idxBuffer } = await buildTestPackfileAndIndex([
      { type: 7, payload: deltaPayload, refDeltaSha: baseTreeSha, shaHex: targetTreeSha },
    ]);

    const packIndex = PackIndex.parse(idxBuffer);

    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      // Loose base tree request
      if (url.includes(`/objects/${baseTreeSha.slice(0, 2)}/${baseTreeSha.slice(2)}`)) {
        const envelopeHeader = new TextEncoder().encode(`tree ${baseTreePayload.length}\0`);
        const envelope = new Uint8Array(envelopeHeader.length + baseTreePayload.length);
        envelope.set(envelopeHeader, 0);
        envelope.set(baseTreePayload, envelopeHeader.length);
        const compressed = pako.deflate(envelope);
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => compressed.buffer,
        };
      }
      if (url.endsWith('.idx')) {
        return { ok: true, status: 200, arrayBuffer: async () => idxBuffer.buffer };
      }
      if (url.endsWith('.pack')) {
        const rangeHeader = (init?.headers as Record<string, string> | undefined)?.['Range'] ?? '';
        const match = /bytes=(\d+)-(\d+)/.exec(rangeHeader);
        if (match && match[1] && match[2]) {
          const start = parseInt(match[1], 10);
          const end = parseInt(match[2], 10);
          const slice = packBuffer.subarray(start, end + 1);
          return {
            ok: true,
            status: 206,
            arrayBuffer: async () => slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength),
          };
        }
      }
      return { ok: false, status: 404 };
    });

    const repoClient = new GitRepositoryClient('http://localhost');
    const packClient = new PackClient('http://localhost', 'dummy', packIndex, { packFileSize: packBuffer.length });
    repoClient.registerPack(packClient);

    const targetTree = (await packClient.fetchObjectBySha(targetTreeSha, repoClient)) as GitTreeObject;
    expect(targetTree.type).toBe('tree');
    expect(targetTree.oid).toBe(targetTreeSha);
    expect(targetTree.entries).toHaveLength(2);
    expect(targetTree.entries.map((e) => e.name)).toEqual(['alpha.txt', 'beta.txt']);
  });

  describe('GitRepositoryClient Multi-Tier Fallback Integration', () => {
    it('falls back to packfile when loose object returns 404', async () => {
      const blobData = new TextEncoder().encode('Packed fallback data');
      const blobSha = await createLooseSha('blob', blobData);

      const { packBuffer, idxBuffer } = await buildTestPackfileAndIndex([
        { type: 3, payload: blobData, shaHex: blobSha },
      ]);

      const packIndex = PackIndex.parse(idxBuffer);
      const packClient = new PackClient('http://localhost', '5fe0c49016260bfa59d50b491195fff975c71c52', packIndex);

      mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
        // Loose object request -> 404 Not Found
        if (url.includes('/objects/') && !url.includes('/pack/')) {
          return { ok: false, status: 404 };
        }
        // Pack index request
        if (url.endsWith('.idx')) {
          return { ok: true, status: 200, arrayBuffer: async () => idxBuffer.buffer };
        }
        // Pack range request
        if (url.endsWith('.pack')) {
          const rangeHeader = (init?.headers as Record<string, string> | undefined)?.['Range'] ?? '';
          const match = /bytes=(\d+)-(\d+)/.exec(rangeHeader);
          if (match && match[1] && match[2]) {
            const start = parseInt(match[1], 10);
            const end = parseInt(match[2], 10);
            const slice = packBuffer.subarray(start, end + 1);
            return {
              ok: true,
              status: 206,
              arrayBuffer: async () => slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength),
            };
          }
        }
        return { ok: false, status: 404 };
      });

      const repoClient = new GitRepositoryClient('http://localhost');
      repoClient.registerPack(packClient);

      const obj = (await repoClient.getObject(blobSha)) as GitBlobObject;
      expect(obj.type).toBe('blob');
      expect(obj.oid).toBe(blobSha);
      expect(new TextDecoder().decode(obj.data)).toBe('Packed fallback data');
    });

    it('throws ObjectNotFoundError when object does not exist in loose or packfiles', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404 });
      const repoClient = new GitRepositoryClient('http://localhost');

      await expect(
        repoClient.getObject('0000000000000000000000000000000000000000')
      ).rejects.toThrow(ObjectNotFoundError);
    });
  });
});
