import type { GitOid } from './types.js';

export class MalformedIndexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedIndexError';
  }
}

export class UnsupportedIndexVersionError extends Error {
  constructor(version: number) {
    super(`Unsupported Git packfile index version: ${version} (expected version 2)`);
    this.name = 'UnsupportedIndexVersionError';
  }
}

export interface PackIndexEntry {
  readonly shaHex: string;
  readonly offset: number;
  readonly crc32: number;
}

export interface ObjectRange {
  readonly start: number;
  readonly end: number;
  readonly offset: number;
  readonly endOffset: number;
  readonly crc32: number;
}

const HEX_LOOKUP: readonly string[] = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, '0')
);

/**
 * Git Packfile Index v2 (.idx v2) parser.
 * Provides O(log N) binary search object lookup using 256-entry fanout table,
 * 4-byte and 8-byte offset resolution, CRC32 table, and exact object byte-span calculation.
 */
export class PackIndex {
  private readonly buffer: Uint8Array;
  private readonly dataView: DataView;
  public readonly totalObjects: number;
  private readonly shaTableOffset: number;
  private readonly crcTableOffset: number;
  private readonly offset4TableOffset: number;
  private readonly offset8TableOffset: number;
  private readonly largeOffsetCount: number;
  private sortedOffsets: number[] | null = null;
  private readonly packChecksum: string;
  private readonly indexChecksum: string;

  constructor(buffer: ArrayBuffer | Uint8Array) {
    if (buffer instanceof Uint8Array) {
      this.buffer = buffer;
    } else {
      this.buffer = new Uint8Array(buffer);
    }

    this.dataView = new DataView(
      this.buffer.buffer,
      this.buffer.byteOffset,
      this.buffer.byteLength
    );

    if (this.buffer.length < 1072) {
      throw new MalformedIndexError(
        `Index buffer too short (${this.buffer.length} bytes, minimum is 1072 bytes)`
      );
    }

    // 1. Verify Magic: \xfftOc (0xFF744F63)
    const magic = this.dataView.getUint32(0, false);
    if (magic !== 0xff744f63) {
      throw new MalformedIndexError(
        `Invalid pack index magic: 0x${magic.toString(16)} (expected 0xff744f63)`
      );
    }

    // 2. Verify Version: 2 (0x00000002)
    const version = this.dataView.getUint32(4, false);
    if (version !== 2) {
      throw new UnsupportedIndexVersionError(version);
    }

    // 3. Object Count from fanout[255]
    this.totalObjects = this.dataView.getUint32(8 + 255 * 4, false);

    // Verify fanout table monotonicity
    let prevCount = 0;
    for (let i = 0; i < 256; i++) {
      const count = this.dataView.getUint32(8 + i * 4, false);
      if (count < prevCount) {
        throw new MalformedIndexError(
          `Non-monotonic fanout table at index ${i}: ${count} < ${prevCount}`
        );
      }
      prevCount = count;
    }

    // Table offsets
    this.shaTableOffset = 1032;
    this.crcTableOffset = this.shaTableOffset + this.totalObjects * 20;
    this.offset4TableOffset = this.crcTableOffset + this.totalObjects * 4;
    this.offset8TableOffset = this.offset4TableOffset + this.totalObjects * 4;

    const baseExpectedSize = this.offset8TableOffset + 40;
    if (this.buffer.length < baseExpectedSize) {
      throw new MalformedIndexError(
        `Index buffer truncated: expected at least ${baseExpectedSize} bytes for ${this.totalObjects} objects, got ${this.buffer.length}`
      );
    }

    const extraBytes = this.buffer.length - baseExpectedSize;
    if (extraBytes % 8 !== 0) {
      throw new MalformedIndexError(
        `Invalid 8-byte offset table size: extra ${extraBytes} bytes is not a multiple of 8`
      );
    }

    this.largeOffsetCount = extraBytes / 8;
    const trailerOffset = this.offset8TableOffset + this.largeOffsetCount * 8;

    // Checksums in trailer
    this.packChecksum = this.readHexSha(trailerOffset);
    this.indexChecksum = this.readHexSha(trailerOffset + 20);
  }

  public static parse(buffer: ArrayBuffer | Uint8Array): PackIndex {
    return new PackIndex(buffer);
  }

  public getObjectCount(): number {
    return this.totalObjects;
  }

  public getPackChecksum(): string {
    return this.packChecksum;
  }

  public getIndexChecksum(): string {
    return this.indexChecksum;
  }

  /**
   * Finds an object by 40-character hexadecimal SHA-1 OID using 256-entry fanout binary search.
   */
  public findObject(shaHex: string): PackIndexEntry | null {
    const cleanOid = shaHex.toLowerCase().trim();
    if (cleanOid.length !== 40 || !/^[0-9a-f]{40}$/.test(cleanOid)) {
      return null;
    }

    const firstByte = parseInt(cleanOid.slice(0, 2), 16);
    if (Number.isNaN(firstByte)) {
      return null;
    }

    const low = firstByte === 0 ? 0 : this.dataView.getUint32(8 + (firstByte - 1) * 4, false);
    const high = this.dataView.getUint32(8 + firstByte * 4, false) - 1;

    if (low > high) {
      return null;
    }

    const targetBytes = this.hexToBinarySha(cleanOid);

    let l = low;
    let r = high;
    let foundIdx = -1;

    while (l <= r) {
      const mid = (l + r) >> 1;
      const midShaOffset = this.shaTableOffset + mid * 20;
      const cmp = this.compareSha(midShaOffset, targetBytes);

      if (cmp === 0) {
        foundIdx = mid;
        break;
      } else if (cmp < 0) {
        l = mid + 1;
      } else {
        r = mid - 1;
      }
    }

    if (foundIdx === -1) {
      return null;
    }

    const offset = this.readOffset(foundIdx);
    const crc32 = this.dataView.getUint32(this.crcTableOffset + foundIdx * 4, false);

    return {
      shaHex: cleanOid,
      offset,
      crc32,
    };
  }

  /**
   * Returns the packfile offset for a given object SHA-1, or null if not found.
   */
  public getObjectOffset(shaHex: string): number | null {
    const entry = this.findObject(shaHex);
    return entry !== null ? entry.offset : null;
  }

  /**
   * Returns sorted list of all offsets in ascending numerical order.
   */
  public getSortedOffsets(): number[] {
    if (this.sortedOffsets !== null) {
      return this.sortedOffsets;
    }

    const offsets: number[] = [];
    for (let i = 0; i < this.totalObjects; i++) {
      offsets.push(this.readOffset(i));
    }

    offsets.sort((a, b) => a - b);
    this.sortedOffsets = offsets;
    return offsets;
  }

  /**
   * Computes the exact byte span [start, end] for fetching the compressed object via HTTP Range request.
   */
  public getByteSpan(
    shaHex: string,
    packFileSize?: number
  ): { start: number; end: number } | null {
    const entry = this.findObject(shaHex);
    if (entry === null) {
      return null;
    }

    const sorted = this.getSortedOffsets();
    const offset = entry.offset;

    // Binary search in sorted offsets to find next object offset
    let l = 0;
    let r = sorted.length - 1;
    let idx = -1;

    while (l <= r) {
      const mid = (l + r) >> 1;
      const val = sorted[mid];
      if (val === undefined) break;
      if (val === offset) {
        idx = mid;
        break;
      } else if (val < offset) {
        l = mid + 1;
      } else {
        r = mid - 1;
      }
    }

    let end: number;
    if (idx !== -1 && idx < sorted.length - 1) {
      const nextOffset = sorted[idx + 1];
      end = nextOffset !== undefined ? nextOffset - 1 : offset + 65535;
    } else {
      // Last object in packfile (packfile has 20-byte trailing SHA-1 checksum)
      end = packFileSize !== undefined ? packFileSize - 21 : offset + 65535;
    }

    return {
      start: offset,
      end,
    };
  }

  /**
   * Computes the ObjectRange descriptor with offset, endOffset, and crc32.
   */
  public findObjectRange(shaHex: GitOid, packFileSize?: number): ObjectRange | null {
    const entry = this.findObject(shaHex);
    if (entry === null) {
      return null;
    }

    const span = this.getByteSpan(shaHex, packFileSize);
    if (span === null) {
      return null;
    }

    return {
      start: span.start,
      end: span.end,
      offset: span.start,
      endOffset: span.end,
      crc32: entry.crc32,
    };
  }

  private readOffset(index: number): number {
    const offset4 = this.dataView.getUint32(this.offset4TableOffset + index * 4, false);
    if ((offset4 & 0x80000000) === 0) {
      return offset4;
    }

    const largeIdx = offset4 & 0x7fffffff;
    if (largeIdx >= this.largeOffsetCount) {
      throw new MalformedIndexError(
        `Large offset index ${largeIdx} out of bounds (count: ${this.largeOffsetCount})`
      );
    }

    const largeTableOffset = this.offset8TableOffset + largeIdx * 8;
    const high32 = this.dataView.getUint32(largeTableOffset, false);
    const low32 = this.dataView.getUint32(largeTableOffset + 4, false);

    return high32 * 4294967296 + low32;
  }

  private compareSha(offset: number, target: Uint8Array): number {
    for (let i = 0; i < 20; i++) {
      const a = this.buffer[offset + i];
      const b = target[i];
      if (a === undefined || b === undefined) return 0;
      if (a < b) return -1;
      if (a > b) return 1;
    }
    return 0;
  }

  private readHexSha(offset: number): string {
    let hex = '';
    for (let i = 0; i < 20; i++) {
      const b = this.buffer[offset + i];
      if (b !== undefined) {
        const h = HEX_LOOKUP[b];
        if (h !== undefined) {
          hex += h;
        }
      }
    }
    return hex;
  }

  private hexToBinarySha(hex: string): Uint8Array {
    const bytes = new Uint8Array(20);
    for (let i = 0; i < 20; i++) {
      const byteHex = hex.slice(i * 2, i * 2 + 2);
      bytes[i] = parseInt(byteHex, 16);
    }
    return bytes;
  }
}
