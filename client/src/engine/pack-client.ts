import { applyGitDelta, DeltaBaseCache } from './delta.js';
import type { GitRepositoryClient } from './fetcher.js';
import { inflateZlibSync } from './inflator.js';
import { PackIndex } from './pack-idx.js';
import {
  binaryShaToHex,
  computeSha1Hex,
  hexToBinarySha,
  OidMismatchError,
  parseBlobPayload,
  parseCommitPayload,
  parseTagPayload,
  parseTreePayload,
} from './parser.js';
import type { GitObject, GitObjectType, GitOid } from './types.js';

export class MalformedPackfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedPackfileError';
  }
}

export class RangeNotSatisfiableError extends Error {
  constructor(url: string, start: number, end: number, status: number) {
    super(`HTTP ${status} Range Not Satisfiable for ${url} [bytes=${start}-${end}]`);
    this.name = 'RangeNotSatisfiableError';
  }
}

export class DeltaRecursionLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeltaRecursionLimitError';
  }
}

export interface PackClientOptions {
  readonly deltaCache?: DeltaBaseCache | undefined;
  readonly maxDeltaDepth?: number | undefined;
  readonly packFileSize?: number | undefined;
}

export interface RawGitPayload {
  readonly type: GitObjectType;
  readonly data: Uint8Array;
}

/**
 * HTTP RFC 7233 Byte-Range Git Packfile Client.
 * Fetches and resolves individual packed Git objects via byte-range requests
 * without downloading full packfiles, reconstructing OBJ_OFS_DELTA and OBJ_REF_DELTA
 * delta compression chains on the fly.
 */
export class PackClient {
  public readonly packUrl: string;
  public readonly idxUrl: string;
  public readonly packHash: string;
  private index: PackIndex | null = null;
  public readonly deltaCache: DeltaBaseCache;
  private readonly offsetTypes = new Map<string, GitObjectType>();
  private readonly maxDeltaDepth: number;
  public readonly packFileSize?: number | undefined;
  private readonly inFlightRanges = new Map<string, Promise<Uint8Array>>();

  constructor(
    baseUrlOrPackUrl: string,
    packHashOrIdxUrl: string,
    index?: PackIndex | null,
    options?: PackClientOptions
  ) {
    const cleanBase = baseUrlOrPackUrl.replace(/\/+$/, '');
    const cleanParam2 = packHashOrIdxUrl.trim();

    if (cleanBase.endsWith('.pack')) {
      this.packUrl = cleanBase;
      this.idxUrl = cleanParam2;
      const match = /\/pack-([0-9a-f]{40})\.pack$/i.exec(cleanBase);
      this.packHash = match?.[1]?.toLowerCase() ?? 'unknown';
    } else {
      const hash = cleanParam2.replace(/^pack-/, '').replace(/\.pack$/, '').replace(/\.idx$/, '');
      this.packHash = hash.toLowerCase();
      this.packUrl = `${cleanBase}/objects/pack/pack-${this.packHash}.pack`;
      this.idxUrl = `${cleanBase}/objects/pack/pack-${this.packHash}.idx`;
    }

    this.index = index ?? null;
    this.deltaCache = options?.deltaCache ?? new DeltaBaseCache(200);
    this.maxDeltaDepth = options?.maxDeltaDepth ?? 50;
    this.packFileSize = options?.packFileSize;
  }

  /**
   * Loads and parses the companion .idx v2 file if not already loaded.
   */
  public async loadIndex(): Promise<PackIndex> {
    if (this.index !== null) {
      return this.index;
    }

    const res = await fetch(this.idxUrl);
    if (!res.ok) {
      throw new Error(`Failed to fetch pack index ${this.idxUrl}: HTTP ${res.status}`);
    }

    const buffer = new Uint8Array(await res.arrayBuffer());
    this.index = PackIndex.parse(buffer);
    return this.index;
  }

  /**
   * Checks if an object with given SHA-1 exists in this packfile.
   */
  public async hasObject(shaHex: string): Promise<boolean> {
    const idx = await this.loadIndex();
    return idx.findObject(shaHex) !== null;
  }

  /**
   * Fetches and parses a Git object by 40-character hexadecimal SHA-1 OID.
   */
  public async fetchObjectBySha(shaHex: string, client?: GitRepositoryClient): Promise<GitObject> {
    const cleanSha = shaHex.toLowerCase().trim();
    const idx = await this.loadIndex();
    const range = idx.findObjectRange(cleanSha, this.packFileSize);
    if (range === null) {
      throw new Error(`Object ${cleanSha} not found in pack index ${this.idxUrl}`);
    }

    const raw = await this.resolveObjectAtOffset(
      range.offset,
      range.endOffset,
      new Set<number>(),
      0,
      client
    );

    // Verify SHA-1 integrity
    const envelopeHeader = new TextEncoder().encode(`${raw.type} ${raw.data.length}\0`);
    const envelope = new Uint8Array(envelopeHeader.length + raw.data.length);
    envelope.set(envelopeHeader, 0);
    envelope.set(raw.data, envelopeHeader.length);

    const computedSha = await computeSha1Hex(envelope);
    if (computedSha.toLowerCase() !== cleanSha) {
      throw new OidMismatchError(
        `Pack object SHA-1 mismatch: expected ${cleanSha}, computed ${computedSha}`
      );
    }

    return this.parseTypedObject(raw.type, raw.data, cleanSha);
  }

  /**
   * Fetches and parses a Git object by packfile byte offset.
   */
  public async fetchObjectAtOffset(offset: number, client?: GitRepositoryClient): Promise<GitObject> {
    const idx = await this.loadIndex();
    const sorted = idx.getSortedOffsets();
    const pos = sorted.indexOf(offset);
    const endOffset =
      pos !== -1 && pos < sorted.length - 1
        ? (sorted[pos + 1] ?? offset + 65536) - 1
        : this.packFileSize !== undefined
          ? this.packFileSize - 21
          : offset + 65535;

    const raw = await this.resolveObjectAtOffset(
      offset,
      endOffset,
      new Set<number>(),
      0,
      client
    );

    // Compute SHA-1 from envelope
    const envelopeHeader = new TextEncoder().encode(`${raw.type} ${raw.data.length}\0`);
    const envelope = new Uint8Array(envelopeHeader.length + raw.data.length);
    envelope.set(envelopeHeader, 0);
    envelope.set(raw.data, envelopeHeader.length);

    const computedSha = await computeSha1Hex(envelope);
    return this.parseTypedObject(raw.type, raw.data, computedSha);
  }

  /**
   * Compatibility alias for fetchObjectBySha.
   */
  public async getObject(shaHex: string, client?: GitRepositoryClient): Promise<GitObject> {
    return this.fetchObjectBySha(shaHex, client);
  }

  /**
   * Issues an HTTP RFC 7233 byte-range request with in-flight deduplication.
   */
  public async fetchRange(start: number, end: number): Promise<Uint8Array> {
    const rangeKey = `${start}-${end}`;
    const inFlight = this.inFlightRanges.get(rangeKey);
    if (inFlight !== undefined) {
      return inFlight;
    }

    const promise = (async (): Promise<Uint8Array> => {
      const res = await fetch(this.packUrl, {
        headers: {
          Range: `bytes=${start}-${end}`,
        },
      });

      if (res.status === 206) {
        return new Uint8Array(await res.arrayBuffer());
      }

      if (res.status === 200) {
        // Server ignored Range header and returned full response
        const full = new Uint8Array(await res.arrayBuffer());
        return full.subarray(start, end + 1);
      }

      if (res.status === 416) {
        throw new RangeNotSatisfiableError(this.packUrl, start, end, 416);
      }

      throw new Error(
        `HTTP ${res.status} fetching range ${start}-${end} from ${this.packUrl}`
      );
    })().finally(() => {
      this.inFlightRanges.delete(rangeKey);
    });

    this.inFlightRanges.set(rangeKey, promise);
    return promise;
  }

  private async resolveObjectAtOffset(
    offset: number,
    knownEndOffset: number,
    visitedOffsets: Set<number>,
    depth: number,
    client?: GitRepositoryClient
  ): Promise<RawGitPayload> {
    if (depth > this.maxDeltaDepth) {
      throw new DeltaRecursionLimitError(
        `Delta resolution depth exceeded limit of ${this.maxDeltaDepth} at offset ${offset}`
      );
    }
    if (visitedOffsets.has(offset)) {
      throw new DeltaRecursionLimitError(
        `Circular delta reference detected at offset ${offset}`
      );
    }
    visitedOffsets.add(offset);

    const cacheKey = `${this.packHash}@${offset}`;
    const cached = this.deltaCache.get(cacheKey);
    if (cached !== undefined) {
      const type = this.offsetTypes.get(cacheKey) ?? 'blob';
      return { type, data: cached };
    }

    // Fetch compressed byte chunk
    const chunk = await this.fetchRange(offset, knownEndOffset);
    let ptr = 0;

    if (chunk.length === 0) {
      throw new MalformedPackfileError(`Empty byte chunk returned for offset ${offset}`);
    }

    const byte0 = chunk[ptr++];
    if (byte0 === undefined) {
      throw new MalformedPackfileError(`Missing byte 0 at offset ${offset}`);
    }

    const rawType = (byte0 >> 4) & 0x07;
    let uncompressedSize = byte0 & 0x0f;
    let shift = 4;
    let b = byte0;

    while ((b & 0x80) !== 0) {
      if (ptr >= chunk.length) {
        throw new MalformedPackfileError('Truncated variable-length object header');
      }
      const nextByte = chunk[ptr++];
      if (nextByte === undefined) {
        throw new MalformedPackfileError('Undefined byte reading object header');
      }
      b = nextByte;
      uncompressedSize += (b & 0x7f) * (2 ** shift);
      shift += 7;
    }

    // Base Non-Delta Types: 1=commit, 2=tree, 3=blob, 4=tag
    if (rawType === 1 || rawType === 2 || rawType === 3 || rawType === 4) {
      const typeMap: Record<number, GitObjectType> = {
        1: 'commit',
        2: 'tree',
        3: 'blob',
        4: 'tag',
      };
      const type = typeMap[rawType];
      if (!type) {
        throw new MalformedPackfileError(`Unexpected raw type: ${rawType}`);
      }

      const compressedPayload = chunk.subarray(ptr);
      const payload = inflateZlibSync(compressedPayload);
      if (payload.length !== uncompressedSize) {
        throw new MalformedPackfileError(
          `Inflated object size mismatch: header expects ${uncompressedSize}, inflated ${payload.length}`
        );
      }

      this.deltaCache.set(cacheKey, payload);
      this.offsetTypes.set(cacheKey, type);

      return { type, data: payload };
    }

    // OBJ_OFS_DELTA: Negative relative offset
    if (rawType === 6) {
      if (ptr >= chunk.length) {
        throw new MalformedPackfileError('Truncated OFS_DELTA offset header');
      }

      let c = chunk[ptr++];
      if (c === undefined) {
        throw new MalformedPackfileError('Undefined byte in OFS_DELTA offset');
      }
      let ofs = c & 0x7f;

      while ((c & 0x80) !== 0) {
        if (ptr >= chunk.length) {
          throw new MalformedPackfileError('Truncated multi-byte OFS_DELTA offset');
        }
        const nextC = chunk[ptr++];
        if (nextC === undefined) {
          throw new MalformedPackfileError('Undefined multi-byte OFS_DELTA offset');
        }
        c = nextC;
        ofs = (ofs + 1) * 128 + (c & 0x7f);
      }

      const baseOffset = offset - ofs;
      if (baseOffset <= 0 || baseOffset >= offset) {
        throw new MalformedPackfileError(
          `Invalid OFS_DELTA base offset ${baseOffset} (current offset: ${offset}, delta: ${ofs})`
        );
      }

      const deltaPayload = inflateZlibSync(chunk.subarray(ptr));

      // Resolve base object offset range
      const idx = await this.loadIndex();
      const sorted = idx.getSortedOffsets();
      const baseIdx = sorted.indexOf(baseOffset);
      const baseEnd =
        baseIdx !== -1 && baseIdx < sorted.length - 1
          ? (sorted[baseIdx + 1] ?? baseOffset + 65536) - 1
          : this.packFileSize !== undefined
            ? this.packFileSize - 21
            : baseOffset + 65535;

      const baseObj = await this.resolveObjectAtOffset(
        baseOffset,
        baseEnd,
        new Set(visitedOffsets),
        depth + 1,
        client
      );

      const reconstructed = applyGitDelta(baseObj.data, deltaPayload);
      this.deltaCache.set(cacheKey, reconstructed);
      this.offsetTypes.set(cacheKey, baseObj.type);

      return {
        type: baseObj.type,
        data: reconstructed,
      };
    }

    // OBJ_REF_DELTA: 20-byte base object SHA-1
    if (rawType === 7) {
      if (ptr + 20 > chunk.length) {
        throw new MalformedPackfileError('Truncated REF_DELTA 20-byte base SHA');
      }

      const baseShaBytes = chunk.subarray(ptr, ptr + 20);
      ptr += 20;
      const baseShaHex = binaryShaToHex(baseShaBytes);

      const deltaPayload = inflateZlibSync(chunk.subarray(ptr));

      let baseObj: RawGitPayload | null = null;

      // 1. Try finding base object in the same packfile index
      const idx = await this.loadIndex();
      const baseRange = idx.findObjectRange(baseShaHex, this.packFileSize);
      if (baseRange !== null) {
        baseObj = await this.resolveObjectAtOffset(
          baseRange.offset,
          baseRange.endOffset,
          new Set(visitedOffsets),
          depth + 1,
          client
        );
      } else if (client !== undefined) {
        // 2. Try fetching base object via the repository client
        const fullObj = await client.getObject(baseShaHex);
        const rawData = this.serializeObjectPayload(fullObj);
        baseObj = { type: fullObj.type, data: rawData };
      }

      if (baseObj === null) {
        throw new Error(`REF_DELTA base object ${baseShaHex} not found`);
      }

      const reconstructed = applyGitDelta(baseObj.data, deltaPayload);
      this.deltaCache.set(cacheKey, reconstructed);
      this.offsetTypes.set(cacheKey, baseObj.type);

      return {
        type: baseObj.type,
        data: reconstructed,
      };
    }

    throw new MalformedPackfileError(`Unsupported packed object type: ${rawType}`);
  }

  private parseTypedObject(type: GitObjectType, data: Uint8Array, oid: GitOid): GitObject {
    switch (type) {
      case 'commit':
        return parseCommitPayload(data, oid);
      case 'tree':
        return parseTreePayload(data, oid);
      case 'blob':
        return parseBlobPayload(data, oid);
      case 'tag':
        return parseTagPayload(data, oid);
    }
  }

  private serializeObjectPayload(obj: GitObject): Uint8Array {
    if (obj.type === 'blob') {
      return obj.data;
    }
    if (obj.type === 'commit') {
      let text = `tree ${obj.tree}\n`;
      for (const parent of obj.parents) {
        text += `parent ${parent}\n`;
      }
      text += `author ${obj.author.name} <${obj.author.email}> ${obj.author.timestamp} ${obj.author.tzOffset}\n`;
      text += `committer ${obj.committer.name} <${obj.committer.email}> ${obj.committer.timestamp} ${obj.committer.tzOffset}\n`;
      if (obj.gpgSig !== undefined && obj.gpgSig.length > 0) {
        const sigLines = obj.gpgSig.split('\n');
        text += `gpgsig ${sigLines[0] ?? ''}\n`;
        for (let i = 1; i < sigLines.length; i++) {
          text += ` ${sigLines[i] ?? ''}\n`;
        }
      }
      text += `\n${obj.message}`;
      return new TextEncoder().encode(text);
    }
    if (obj.type === 'tree') {
      // Sort entries canonically: directories treat path as having trailing '/'
      const sortedEntries = [...obj.entries].sort((a, b) => {
        const aKey = a.isTree ? `${a.name}/` : a.name;
        const bKey = b.isTree ? `${b.name}/` : b.name;
        if (aKey < bKey) return -1;
        if (aKey > bKey) return 1;
        return 0;
      });

      const chunks: Uint8Array[] = [];
      let totalLen = 0;
      const encoder = new TextEncoder();

      for (const entry of sortedEntries) {
        const modeStr = entry.mode.startsWith('0') ? entry.mode.slice(1) : entry.mode;
        const headerBytes = encoder.encode(`${modeStr} ${entry.name}\0`);
        const shaBytes = hexToBinarySha(entry.oid);
        const entryBuf = new Uint8Array(headerBytes.length + 20);
        entryBuf.set(headerBytes, 0);
        entryBuf.set(shaBytes, headerBytes.length);
        chunks.push(entryBuf);
        totalLen += entryBuf.length;
      }

      const out = new Uint8Array(totalLen);
      let outOffset = 0;
      for (const chunk of chunks) {
        out.set(chunk, outOffset);
        outOffset += chunk.length;
      }
      return out;
    }

    // obj.type === 'tag'
    let text = `object ${obj.targetOid}\n`;
    text += `type ${obj.targetType}\n`;
    text += `tag ${obj.tagName}\n`;
    if (obj.tagger !== undefined) {
      text += `tagger ${obj.tagger.name} <${obj.tagger.email}> ${obj.tagger.timestamp} ${obj.tagger.tzOffset}\n`;
    }
    if (obj.gpgSig !== undefined && obj.gpgSig.length > 0) {
      const sigLines = obj.gpgSig.split('\n');
      text += `gpgsig ${sigLines[0] ?? ''}\n`;
      for (let i = 1; i < sigLines.length; i++) {
        text += ` ${sigLines[i] ?? ''}\n`;
      }
    }
    text += `\n${obj.message}`;
    return new TextEncoder().encode(text);
  }
}
