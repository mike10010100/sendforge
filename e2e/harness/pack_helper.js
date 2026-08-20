/**
 * Packfile & Delta Reference Harness
 * Provides full synthetic and native .pack and .idx v2 creation,
 * byte-range parsing, delta instruction encoding/decoding,
 * and O(log N) fanout binary search validation.
 */

import crypto from 'node:crypto';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

// CRC32 table for IEEE 802.3 CRC calculation
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c >>> 0;
}

export function computeCrc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

export const GitObjectType = {
  COMMIT: 1,
  TREE: 2,
  BLOB: 3,
  TAG: 4,
  OFS_DELTA: 6,
  REF_DELTA: 7
};

export class DeltaEngine {
  /**
   * Decode variable-length integer (LEB128-like) for delta header
   */
  static readVarInt(buffer, offsetRef) {
    let size = 0;
    let shift = 0;
    let byte;
    do {
      if (offsetRef.offset >= buffer.length) {
        throw new Error('Truncated delta header: unexpected end of stream');
      }
      byte = buffer[offsetRef.offset++];
      size |= (byte & 0x7F) << shift;
      shift += 7;
    } while ((byte & 0x80) !== 0);
    return size;
  }

  /**
   * Encode integer as LEB128
   */
  static encodeVarInt(num) {
    const bytes = [];
    let n = num;
    while (n > 0x7F) {
      bytes.push((n & 0x7F) | 0x80);
      n >>>= 7;
    }
    bytes.push(n & 0x7F);
    return Buffer.from(bytes);
  }

  /**
   * Interpret Git delta stream against base object
   */
  static applyDelta(baseObject, deltaPayload) {
    const offsetRef = { offset: 0 };
    const baseSize = this.readVarInt(deltaPayload, offsetRef);
    const targetSize = this.readVarInt(deltaPayload, offsetRef);

    if (baseObject.length !== baseSize) {
      throw new Error(`Delta base size mismatch: expected ${baseSize}, got ${baseObject.length}`);
    }

    const chunks = [];
    let totalTargetBytes = 0;

    while (offsetRef.offset < deltaPayload.length) {
      const opcode = deltaPayload[offsetRef.offset++];

      if (opcode === 0) {
        throw new Error('Invalid delta opcode: 0x00 is reserved');
      }

      if ((opcode & 0x80) !== 0) {
        // COPY instruction: copies bytes from base object
        let copyOffset = 0;
        if (opcode & 0x01) copyOffset |= deltaPayload[offsetRef.offset++];
        if (opcode & 0x02) copyOffset |= (deltaPayload[offsetRef.offset++] << 8);
        if (opcode & 0x04) copyOffset |= (deltaPayload[offsetRef.offset++] << 16);
        if (opcode & 0x08) copyOffset |= ((deltaPayload[offsetRef.offset++] << 24) >>> 0);

        let copySize = 0;
        if (opcode & 0x10) copySize |= deltaPayload[offsetRef.offset++];
        if (opcode & 0x20) copySize |= (deltaPayload[offsetRef.offset++] << 8);
        if (opcode & 0x40) copySize |= (deltaPayload[offsetRef.offset++] << 16);

        if (copySize === 0) {
          copySize = 0x10000; // 65536 bytes
        }

        if (copyOffset + copySize > baseObject.length) {
          throw new Error(`Delta COPY out of bounds: offset ${copyOffset} + size ${copySize} > base length ${baseObject.length}`);
        }

        chunks.push(baseObject.subarray(copyOffset, copyOffset + copySize));
        totalTargetBytes += copySize;
      } else {
        // INSERT instruction: literal bytes from delta stream
        const insertSize = opcode;
        if (offsetRef.offset + insertSize > deltaPayload.length) {
          throw new Error(`Delta INSERT truncated: requires ${insertSize} bytes, only ${deltaPayload.length - offsetRef.offset} available`);
        }

        chunks.push(deltaPayload.subarray(offsetRef.offset, offsetRef.offset + insertSize));
        offsetRef.offset += insertSize;
        totalTargetBytes += insertSize;
      }
    }

    if (totalTargetBytes !== targetSize) {
      throw new Error(`Delta reconstructed size mismatch: expected ${targetSize}, reconstructed ${totalTargetBytes}`);
    }

    return Buffer.concat(chunks);
  }

  /**
   * Generate a simple Git delta payload from base to target
   */
  static createDelta(baseObject, targetObject) {
    const baseHeader = this.encodeVarInt(baseObject.length);
    const targetHeader = this.encodeVarInt(targetObject.length);
    const instructions = [];

    // Simple diffing algorithm: find common prefix and suffix, insert middle
    let prefixLen = 0;
    while (prefixLen < baseObject.length && prefixLen < targetObject.length && baseObject[prefixLen] === targetObject[prefixLen]) {
      prefixLen++;
    }

    let suffixLen = 0;
    while (suffixLen < (baseObject.length - prefixLen) &&
           suffixLen < (targetObject.length - prefixLen) &&
           baseObject[baseObject.length - 1 - suffixLen] === targetObject[targetObject.length - 1 - suffixLen]) {
      suffixLen++;
    }

    // 1. Copy prefix if present
    if (prefixLen > 0) {
      let remaining = prefixLen;
      let off = 0;
      while (remaining > 0) {
        const chunk = Math.min(remaining, 0x10000);
        instructions.push(this.encodeCopyOpcode(off, chunk));
        off += chunk;
        remaining -= chunk;
      }
    }

    // 2. Insert middle from target
    const middleTargetLen = targetObject.length - prefixLen - suffixLen;
    if (middleTargetLen > 0) {
      let off = prefixLen;
      let remaining = middleTargetLen;
      while (remaining > 0) {
        const chunk = Math.min(remaining, 127);
        instructions.push(Buffer.from([chunk]));
        instructions.push(targetObject.subarray(off, off + chunk));
        off += chunk;
        remaining -= chunk;
      }
    }

    // 3. Copy suffix if present
    if (suffixLen > 0) {
      const baseSuffixStart = baseObject.length - suffixLen;
      let remaining = suffixLen;
      let off = baseSuffixStart;
      while (remaining > 0) {
        const chunk = Math.min(remaining, 0x10000);
        instructions.push(this.encodeCopyOpcode(off, chunk));
        off += chunk;
        remaining -= chunk;
      }
    }

    return Buffer.concat([baseHeader, targetHeader, ...instructions]);
  }

  static encodeCopyOpcode(offset, size) {
    let opcode = 0x80;
    const bytes = [];

    if (offset & 0xFF) { opcode |= 0x01; bytes.push(offset & 0xFF); }
    if (offset & 0xFF00) { opcode |= 0x02; bytes.push((offset >> 8) & 0xFF); }
    if (offset & 0xFF0000) { opcode |= 0x04; bytes.push((offset >> 16) & 0xFF); }
    if (offset & 0xFF000000) { opcode |= 0x08; bytes.push((offset >>> 24) & 0xFF); }

    const encodedSize = size === 0x10000 ? 0 : size;
    if (encodedSize & 0xFF) { opcode |= 0x10; bytes.push(encodedSize & 0xFF); }
    if (encodedSize & 0xFF00) { opcode |= 0x20; bytes.push((encodedSize >> 8) & 0xFF); }
    if (encodedSize & 0xFF0000) { opcode |= 0x40; bytes.push((encodedSize >> 16) & 0xFF); }

    return Buffer.concat([Buffer.from([opcode]), Buffer.from(bytes)]);
  }
}

export class PackBuilder {
  constructor() {
    this.objects = [];
  }

  /**
   * Add a non-delta Git object (COMMIT, TREE, BLOB, TAG)
   */
  addObject(type, payload, shaHex = null) {
    const rawPayload = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf-8');
    const typeName = Object.keys(GitObjectType).find(k => GitObjectType[k] === type).toLowerCase();
    const fullObj = Buffer.concat([Buffer.from(`${typeName} ${rawPayload.length}\0`), rawPayload]);
    const computedSha = shaHex || crypto.createHash('sha1').update(fullObj).digest('hex');

    this.objects.push({
      type,
      payload: rawPayload,
      shaHex: computedSha,
      isDelta: false
    });
    return computedSha;
  }

  /**
   * Add an OFS_DELTA object
   */
  addOfsDelta(baseShaHex, deltaPayload, targetShaHex) {
    this.objects.push({
      type: GitObjectType.OFS_DELTA,
      baseShaHex,
      payload: Buffer.isBuffer(deltaPayload) ? deltaPayload : Buffer.from(deltaPayload),
      shaHex: targetShaHex,
      isDelta: true,
      deltaType: 'ofs'
    });
    return targetShaHex;
  }

  /**
   * Add a REF_DELTA object
   */
  addRefDelta(baseShaHex, deltaPayload, targetShaHex) {
    this.objects.push({
      type: GitObjectType.REF_DELTA,
      baseShaHex,
      payload: Buffer.isBuffer(deltaPayload) ? deltaPayload : Buffer.from(deltaPayload),
      shaHex: targetShaHex,
      isDelta: true,
      deltaType: 'ref'
    });
    return targetShaHex;
  }

  /**
   * Build .pack file buffer and .idx v2 buffer
   * Returns { packBuffer, idxBuffer, packSha, idxSha, offsets }
   */
  build(options = {}) {
    const force8ByteOffset = options.force8ByteOffset || false;
    const packChunks = [];

    // 1. Pack Header: 'PACK', version 2, numObjects
    const packHeader = Buffer.alloc(12);
    packHeader.write('PACK', 0, 4, 'ascii');
    packHeader.writeUInt32BE(2, 4);
    packHeader.writeUInt32BE(this.objects.length, 8);
    packChunks.push(packHeader);

    let currentOffset = 12;
    const entries = [];

    for (const obj of this.objects) {
      const objOffset = currentOffset;
      const headerBytes = [];
      const uncompressedSize = obj.payload.length;

      // Pack Object Header (type and variable size)
      let firstByte = ((obj.type & 0x07) << 4) | (uncompressedSize & 0x0F);
      let sizeRemaining = uncompressedSize >>> 4;

      if (sizeRemaining > 0) {
        firstByte |= 0x80;
        headerBytes.push(firstByte);
        while (sizeRemaining > 0) {
          let b = sizeRemaining & 0x7F;
          sizeRemaining >>>= 7;
          if (sizeRemaining > 0) {
            b |= 0x80;
          }
          headerBytes.push(b);
        }
      } else {
        headerBytes.push(firstByte);
      }

      const headerBuf = Buffer.from(headerBytes);
      const deltaHeaders = [];

      if (obj.type === GitObjectType.OFS_DELTA) {
        // Compute negative relative offset to base object
        const baseEntry = entries.find(e => e.shaHex === obj.baseShaHex);
        if (!baseEntry) {
          throw new Error(`OFS_DELTA base object ${obj.baseShaHex} not found in pack`);
        }
        const relOffset = objOffset - baseEntry.offset;
        if (relOffset <= 0) {
          throw new Error('OFS_DELTA base must appear earlier in pack');
        }

        // Variable length encoding for OFS_DELTA negative offset
        const ofsBytes = [];
        let val = relOffset;
        ofsBytes.push(val & 0x7F);
        val >>>= 7;
        while (val > 0) {
          val -= 1;
          ofsBytes.unshift((val & 0x7F) | 0x80);
          val >>>= 7;
        }
        deltaHeaders.push(Buffer.from(ofsBytes));
      } else if (obj.type === GitObjectType.REF_DELTA) {
        deltaHeaders.push(Buffer.from(obj.baseShaHex, 'hex'));
      }

      const compressedPayload = zlib.deflateSync(obj.payload);
      const fullObjSlice = Buffer.concat([headerBuf, ...deltaHeaders, compressedPayload]);
      const crc32 = computeCrc32(fullObjSlice);

      packChunks.push(fullObjSlice);
      currentOffset += fullObjSlice.length;

      entries.push({
        shaHex: obj.shaHex,
        offset: objOffset,
        crc32,
        size: fullObjSlice.length
      });
    }

    // Pack Trailer: SHA-1 of all pack content
    const packBody = Buffer.concat(packChunks);
    const packSha = crypto.createHash('sha1').update(packBody).digest();
    const packBuffer = Buffer.concat([packBody, packSha]);

    // 2. Build .idx v2 Buffer
    const idxBuffer = this.buildIdxV2(entries, packSha, force8ByteOffset);
    const idxSha = idxBuffer.subarray(idxBuffer.length - 20);

    return {
      packBuffer,
      idxBuffer,
      packShaHex: packSha.toString('hex'),
      idxShaHex: idxSha.toString('hex'),
      entries
    };
  }

  buildIdxV2(entries, packSha, force8ByteOffset = false) {
    // Sort entries lexicographically by SHA-1
    const sorted = [...entries].sort((a, b) => a.shaHex.localeCompare(b.shaHex));
    const N = sorted.length;

    // 1. Magic header + Version (8 bytes)
    const header = Buffer.alloc(8);
    header[0] = 0xFF;
    header[1] = 0x74; // 't'
    header[2] = 0x4F; // 'O'
    header[3] = 0x63; // 'c'
    header.writeUInt32BE(2, 4); // Version 2

    // 2. Fanout Table (256 * 4 = 1024 bytes)
    const fanout = Buffer.alloc(1024);
    let count = 0;
    let entryIdx = 0;
    for (let byteVal = 0; byteVal < 256; byteVal++) {
      while (entryIdx < N && parseInt(sorted[entryIdx].shaHex.slice(0, 2), 16) <= byteVal) {
        count++;
        entryIdx++;
      }
      fanout.writeUInt32BE(count, byteVal * 4);
    }

    // 3. SHA-1 Table (N * 20 bytes)
    const shaTable = Buffer.alloc(N * 20);
    for (let i = 0; i < N; i++) {
      Buffer.from(sorted[i].shaHex, 'hex').copy(shaTable, i * 20);
    }

    // 4. CRC32 Table (N * 4 bytes)
    const crcTable = Buffer.alloc(N * 4);
    for (let i = 0; i < N; i++) {
      crcTable.writeUInt32BE(sorted[i].crc32, i * 4);
    }

    // 5. 4-byte Offset Table (N * 4 bytes) & 8-byte Secondary Table
    const offsetTable = Buffer.alloc(N * 4);
    const secondaryOffsets = [];

    for (let i = 0; i < N; i++) {
      const off = sorted[i].offset;
      if (off >= 0x80000000 || force8ByteOffset) {
        // High bit set, index into secondary table
        const secIndex = secondaryOffsets.length;
        secondaryOffsets.push(BigInt(off));
        offsetTable.writeUInt32BE((0x80000000 | secIndex) >>> 0, i * 4);
      } else {
        offsetTable.writeUInt32BE(off, i * 4);
      }
    }

    // Secondary 8-byte Offset Table
    const secTable = Buffer.alloc(secondaryOffsets.length * 8);
    for (let i = 0; i < secondaryOffsets.length; i++) {
      secTable.writeBigUInt64BE(secondaryOffsets[i], i * 8);
    }

    // Packfile SHA-1 trailer (20 bytes)
    const packShaTrailer = packSha;

    const idxBody = Buffer.concat([
      header,
      fanout,
      shaTable,
      crcTable,
      offsetTable,
      secTable,
      packShaTrailer
    ]);

    // Index Checksum (20 bytes)
    const idxSha = crypto.createHash('sha1').update(idxBody).digest();
    return Buffer.concat([idxBody, idxSha]);
  }
}

export class PackIndexParser {
  static parse(buffer) {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

    if (buf.length < 1024 + 8 + 40) {
      throw new Error('.idx file too small');
    }

    // Magic verification
    if (buf[0] !== 0xFF || buf[1] !== 0x74 || buf[2] !== 0x4F || buf[3] !== 0x63) {
      throw new Error('Invalid .idx magic header');
    }

    const version = buf.readUInt32BE(4);
    if (version !== 2) {
      throw new Error(`Unsupported .idx version: ${version}`);
    }

    // 256 fanout table
    const fanout = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      fanout[i] = buf.readUInt32BE(8 + i * 4);
    }
    const totalObjects = fanout[255];

    let offset = 8 + 1024;
    // SHA table
    const shaTableOffset = offset;
    offset += totalObjects * 20;

    // CRC table
    const crcTableOffset = offset;
    offset += totalObjects * 4;

    // 4-byte offset table
    const offsetTableOffset = offset;
    offset += totalObjects * 4;

    // 8-byte offset table
    const secTableOffset = offset;
    const remainingBeforeTrailers = buf.length - 40 - offset;
    const secCount = Math.floor(remainingBeforeTrailers / 8);

    const packSha = buf.subarray(buf.length - 40, buf.length - 20).toString('hex');
    const idxSha = buf.subarray(buf.length - 20).toString('hex');

    return new PackIndexInstance({
      buf,
      totalObjects,
      fanout,
      shaTableOffset,
      crcTableOffset,
      offsetTableOffset,
      secTableOffset,
      packSha,
      idxSha
    });
  }
}

class PackIndexInstance {
  constructor(data) {
    this.data = data;
    this.totalObjects = data.totalObjects;
    this.packSha = data.packSha;
    this.idxSha = data.idxSha;
  }

  findObject(shaHex) {
    const targetSha = shaHex.toLowerCase();
    const firstByte = parseInt(targetSha.slice(0, 2), 16);
    const low = firstByte === 0 ? 0 : this.data.fanout[firstByte - 1];
    const high = this.data.fanout[firstByte];

    // Binary search within [low, high)
    let left = low;
    let right = high - 1;

    while (left <= right) {
      const mid = (left + right) >>> 1;
      const curSha = this.data.buf.subarray(
        this.data.shaTableOffset + mid * 20,
        this.data.shaTableOffset + (mid + 1) * 20
      ).toString('hex');

      if (curSha === targetSha) {
        const crc32 = this.data.buf.readUInt32BE(this.data.crcTableOffset + mid * 4);
        let objOffset = this.data.buf.readUInt32BE(this.data.offsetTableOffset + mid * 4);

        if ((objOffset & 0x80000000) !== 0) {
          const secIndex = objOffset & 0x7FFFFFFF;
          if (this.data.secTableOffset + (secIndex + 1) * 8 > this.data.buf.length - 40) {
            throw new Error(`Out of bounds 8-byte secondary offset index: ${secIndex}`);
          }
          const bigOff = this.data.buf.readBigUInt64BE(this.data.secTableOffset + secIndex * 8);
          objOffset = Number(bigOff);
        }

        return {
          shaHex: curSha,
          offset: objOffset,
          crc32
        };
      } else if (curSha < targetSha) {
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }

    return null;
  }

  getObjectOffset(shaHex) {
    const entry = this.findObject(shaHex);
    return entry ? entry.offset : null;
  }

  getSortedOffsets() {
    const offsets = [];
    for (let i = 0; i < this.totalObjects; i++) {
      let off = this.data.buf.readUInt32BE(this.data.offsetTableOffset + i * 4);
      if ((off & 0x80000000) !== 0) {
        const secIndex = off & 0x7FFFFFFF;
        if (this.data.secTableOffset + (secIndex + 1) * 8 <= this.data.buf.length - 40) {
          off = Number(this.data.buf.readBigUInt64BE(this.data.secTableOffset + secIndex * 8));
        }
      }
      offsets.push(off);
    }
    return offsets.sort((a, b) => a - b);
  }

  getByteSpan(shaHex, packFileSize = null) {
    const entry = this.findObject(shaHex);
    if (!entry) return null;

    const sorted = this.getSortedOffsets();
    const idx = sorted.indexOf(entry.offset);
    if (idx === -1) return null;

    const start = entry.offset;
    let end;
    if (idx < sorted.length - 1) {
      end = sorted[idx + 1] - 1;
    } else if (packFileSize !== null) {
      end = packFileSize - 21; // exclude 20-byte pack trailer
    } else {
      end = start + 65536; // fallback chunk
    }

    return { start, end };
  }
}
