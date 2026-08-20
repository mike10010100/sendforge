export class MalformedDeltaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedDeltaError';
  }
}

export class DeltaBoundsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeltaBoundsError';
  }
}

export class DeltaBaseSizeMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeltaBaseSizeMismatchError';
  }
}

export class DeltaSizeMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeltaSizeMismatchError';
  }
}

export interface DeltaHeader {
  readonly baseSize: number;
  readonly targetSize: number;
  readonly headerBytes: number;
}

/**
 * Parses the LEB128-encoded source (base) size and target size headers from a delta payload.
 */
export function parseDeltaHeader(delta: Uint8Array): DeltaHeader {
  let ptr = 0;

  // 1. Decode base object size
  let baseSize = 0;
  let shift = 0;
  let b = 0;
  do {
    if (ptr >= delta.length) {
      throw new MalformedDeltaError('Truncated delta header: unexpected EOF reading base size');
    }
    const byte = delta[ptr++];
    if (byte === undefined) {
      throw new MalformedDeltaError('Truncated delta header: undefined byte reading base size');
    }
    b = byte;
    baseSize += (b & 0x7f) * (2 ** shift);
    shift += 7;
  } while ((b & 0x80) !== 0);

  // 2. Decode target object size
  let targetSize = 0;
  shift = 0;
  do {
    if (ptr >= delta.length) {
      throw new MalformedDeltaError('Truncated delta header: unexpected EOF reading target size');
    }
    const byte = delta[ptr++];
    if (byte === undefined) {
      throw new MalformedDeltaError('Truncated delta header: undefined byte reading target size');
    }
    b = byte;
    targetSize += (b & 0x7f) * (2 ** shift);
    shift += 7;
  } while ((b & 0x80) !== 0);

  return {
    baseSize,
    targetSize,
    headerBytes: ptr,
  };
}

/**
 * Applies a Git delta stream to a base object buffer, interpreting COPY and INSERT opcodes.
 */
export function applyGitDelta(baseObject: Uint8Array, deltaPayload: Uint8Array): Uint8Array {
  const header = parseDeltaHeader(deltaPayload);
  if (baseObject.length !== header.baseSize) {
    throw new DeltaBaseSizeMismatchError(
      `Base object size mismatch: delta header expects ${header.baseSize} bytes, got ${baseObject.length}`
    );
  }

  const output = new Uint8Array(header.targetSize);
  let outPtr = 0;
  let ptr = header.headerBytes;
  const deltaLen = deltaPayload.length;

  while (ptr < deltaLen) {
    const cmd = deltaPayload[ptr++];
    if (cmd === undefined) {
      break;
    }

    if ((cmd & 0x80) !== 0) {
      // --- COPY INSTRUCTION ---
      let copyOffset = 0;
      let copySize = 0;

      // Read offset bytes (bits 0..3)
      if ((cmd & 0x01) !== 0) {
        const byte = deltaPayload[ptr++];
        if (byte === undefined) throw new DeltaBoundsError('Truncated COPY offset byte 0');
        copyOffset |= byte;
      }
      if ((cmd & 0x02) !== 0) {
        const byte = deltaPayload[ptr++];
        if (byte === undefined) throw new DeltaBoundsError('Truncated COPY offset byte 1');
        copyOffset |= byte << 8;
      }
      if ((cmd & 0x04) !== 0) {
        const byte = deltaPayload[ptr++];
        if (byte === undefined) throw new DeltaBoundsError('Truncated COPY offset byte 2');
        copyOffset |= byte << 16;
      }
      if ((cmd & 0x08) !== 0) {
        const byte = deltaPayload[ptr++];
        if (byte === undefined) throw new DeltaBoundsError('Truncated COPY offset byte 3');
        copyOffset += byte * 16777216; // 2^24
      }

      // Read size bytes (bits 4..6)
      if ((cmd & 0x10) !== 0) {
        const byte = deltaPayload[ptr++];
        if (byte === undefined) throw new DeltaBoundsError('Truncated COPY size byte 0');
        copySize |= byte;
      }
      if ((cmd & 0x20) !== 0) {
        const byte = deltaPayload[ptr++];
        if (byte === undefined) throw new DeltaBoundsError('Truncated COPY size byte 1');
        copySize |= byte << 8;
      }
      if ((cmd & 0x40) !== 0) {
        const byte = deltaPayload[ptr++];
        if (byte === undefined) throw new DeltaBoundsError('Truncated COPY size byte 2');
        copySize |= byte << 16;
      }

      // Git specification: zero copy size means 65536 (0x10000) bytes
      if (copySize === 0) {
        copySize = 0x10000;
      }

      // Bounds validation
      if (copyOffset < 0 || copyOffset + copySize > baseObject.length) {
        throw new DeltaBoundsError(
          `Delta copy out of bounds: source range [${copyOffset}, ${copyOffset + copySize}) exceeds base buffer length ${baseObject.length}`
        );
      }
      if (outPtr + copySize > header.targetSize) {
        throw new DeltaBoundsError(
          `Delta copy out of bounds: destination [${outPtr}, ${outPtr + copySize}) exceeds target buffer allocation ${header.targetSize}`
        );
      }

      output.set(baseObject.subarray(copyOffset, copyOffset + copySize), outPtr);
      outPtr += copySize;
    } else if (cmd > 0) {
      // --- INSERT INSTRUCTION ---
      const insertSize = cmd; // 1 to 127 literal bytes

      if (ptr + insertSize > deltaLen) {
        throw new DeltaBoundsError(
          `Delta insert out of bounds: stream truncated, requested ${insertSize} bytes at offset ${ptr}, stream length ${deltaLen}`
        );
      }
      if (outPtr + insertSize > header.targetSize) {
        throw new DeltaBoundsError(
          `Delta insert out of bounds: destination [${outPtr}, ${outPtr + insertSize}) exceeds target buffer allocation ${header.targetSize}`
        );
      }

      output.set(deltaPayload.subarray(ptr, ptr + insertSize), outPtr);
      ptr += insertSize;
      outPtr += insertSize;
    } else {
      // --- RESERVED OPCODE 0x00 ---
      throw new MalformedDeltaError('Reserved delta instruction opcode 0x00 encountered');
    }
  }

  if (outPtr !== header.targetSize) {
    throw new DeltaSizeMismatchError(
      `Reconstructed delta size mismatch: expected ${header.targetSize} bytes, produced ${outPtr}`
    );
  }

  return output;
}

/**
 * Compatibility alias for applyGitDelta.
 */
export const applyDelta = applyGitDelta;

/**
 * LRU Base Object Cache with entry count and byte capacity limits.
 */
export class DeltaBaseCache {
  private readonly cache = new Map<string, Uint8Array>();
  public readonly maxEntries: number;
  public readonly maxBytes: number;
  private currentBytes = 0;

  constructor(maxEntries = 200, maxBytes = 50 * 1024 * 1024) {
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
  }

  public get(key: string | number): Uint8Array | undefined {
    const keyStr = String(key);
    const item = this.cache.get(keyStr);
    if (item !== undefined) {
      // Refresh LRU order
      this.cache.delete(keyStr);
      this.cache.set(keyStr, item);
    }
    return item;
  }

  public set(key: string | number, value: Uint8Array): void {
    const keyStr = String(key);
    const existing = this.cache.get(keyStr);
    if (existing !== undefined) {
      this.currentBytes -= existing.length;
      this.cache.delete(keyStr);
    }

    // Evict oldest entries until within entry and byte limits
    while (
      (this.cache.size >= this.maxEntries || this.currentBytes + value.length > this.maxBytes) &&
      this.cache.size > 0
    ) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) break;
      const oldestVal = this.cache.get(oldestKey);
      if (oldestVal !== undefined) {
        this.currentBytes -= oldestVal.length;
      }
      this.cache.delete(oldestKey);
    }

    this.cache.set(keyStr, value);
    this.currentBytes += value.length;
  }

  public clear(): void {
    this.cache.clear();
    this.currentBytes = 0;
  }

  public get size(): number {
    return this.cache.size;
  }

  public get byteSize(): number {
    return this.currentBytes;
  }
}
