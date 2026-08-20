/**
 * In-Harness Archive Validator & Extractor
 * Parses and verifies binary structures of PKWARE ZIP and POSIX ustar .tar.gz
 * archives generated in-browser without external runtime dependencies.
 */

import zlib from 'node:zlib';

export class ArchiveValidator {
  /**
   * Parse and extract a PKWARE ZIP archive buffer
   * Returns: { entries: Array<{ path, size, compressedSize, crc32, data, isDirectory }>, fileMap: { [path]: Buffer } }
   */
  static parseZip(buffer) {
    if (!Buffer.isBuffer(buffer)) {
      buffer = Buffer.from(buffer);
    }

    if (buffer.length < 22) {
      throw new Error(`Buffer too small to be a valid ZIP archive (${buffer.length} bytes)`);
    }

    // Locate End of Central Directory (EOCD) signature: 0x06054b50 (PK\x05\x06)
    let eocdOffset = -1;
    for (let i = buffer.length - 22; i >= 0; i--) {
      if (
        buffer[i] === 0x50 &&
        buffer[i + 1] === 0x4b &&
        buffer[i + 2] === 0x05 &&
        buffer[i + 3] === 0x06
      ) {
        eocdOffset = i;
        break;
      }
    }

    if (eocdOffset === -1) {
      throw new Error('Invalid ZIP archive: End of Central Directory (EOCD) signature not found');
    }

    const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
    const cdSize = buffer.readUInt32LE(eocdOffset + 12);
    const cdOffset = buffer.readUInt32LE(eocdOffset + 16);

    const entries = [];
    const fileMap = {};

    let currentCdOffset = cdOffset;
    for (let i = 0; i < totalEntries; i++) {
      if (currentCdOffset >= buffer.length) {
        throw new Error(`Truncated Central Directory at entry ${i}`);
      }

      const sig = buffer.readUInt32LE(currentCdOffset);
      if (sig !== 0x02014b50) { // PK\x01\x02
        throw new Error(`Invalid Central Directory header signature 0x${sig.toString(16)} at offset ${currentCdOffset}`);
      }

      const compMethod = buffer.readUInt16LE(currentCdOffset + 10);
      const crc32 = buffer.readUInt32LE(currentCdOffset + 16);
      const compSize = buffer.readUInt32LE(currentCdOffset + 20);
      const uncompSize = buffer.readUInt32LE(currentCdOffset + 24);
      const nameLen = buffer.readUInt16LE(currentCdOffset + 28);
      const extraLen = buffer.readUInt16LE(currentCdOffset + 30);
      const commentLen = buffer.readUInt16LE(currentCdOffset + 32);
      const localHeaderOffset = buffer.readUInt32LE(currentCdOffset + 42);

      const nameOffset = currentCdOffset + 46;
      const fileName = buffer.subarray(nameOffset, nameOffset + nameLen).toString('utf-8');

      // Verify local file header at localHeaderOffset
      const localSig = buffer.readUInt32LE(localHeaderOffset);
      if (localSig !== 0x04034b50) { // PK\x03\x04
        throw new Error(`Invalid Local File Header signature at offset ${localHeaderOffset} for ${fileName}`);
      }

      const localNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;

      const compressedData = buffer.subarray(dataOffset, dataOffset + compSize);
      let uncompressedData;

      if (compMethod === 0) {
        // Stored (no compression)
        uncompressedData = compressedData;
      } else if (compMethod === 8) {
        // Deflated (raw inflate without zlib header)
        uncompressedData = zlib.inflateRawSync(compressedData);
      } else {
        throw new Error(`Unsupported ZIP compression method: ${compMethod}`);
      }

      // Verify CRC32
      const computedCrc = this._crc32(uncompressedData);
      if (computedCrc !== crc32) {
        throw new Error(`CRC32 mismatch for ${fileName}: expected ${crc32}, got ${computedCrc}`);
      }

      const isDirectory = fileName.endsWith('/');

      const entry = {
        path: fileName,
        size: uncompSize,
        compressedSize: compSize,
        crc32,
        data: uncompressedData,
        isDirectory
      };

      entries.push(entry);
      if (!isDirectory) {
        fileMap[fileName] = uncompressedData;
      }

      currentCdOffset += 46 + nameLen + extraLen + commentLen;
    }

    return { entries, fileMap };
  }

  /**
   * Parse and extract a POSIX ustar .tar.gz archive buffer
   * Returns: { entries: Array<{ path, size, mode, mtime, data, isDirectory }>, fileMap: { [path]: Buffer } }
   */
  static parseTarGz(buffer) {
    if (!Buffer.isBuffer(buffer)) {
      buffer = Buffer.from(buffer);
    }

    // Step 1: Decompress gzip
    let tarBuffer;
    try {
      tarBuffer = zlib.gunzipSync(buffer);
    } catch (e) {
      throw new Error(`Failed to decompress gzip archive: ${e.message}`);
    }

    // Step 2: Parse 512-byte POSIX ustar blocks
    const entries = [];
    const fileMap = {};
    let offset = 0;

    while (offset + 512 <= tarBuffer.length) {
      const headerBlock = tarBuffer.subarray(offset, offset + 512);

      // Check for zero-block (end of archive indicator)
      let allZeros = true;
      for (let i = 0; i < 512; i++) {
        if (headerBlock[i] !== 0) {
          allZeros = false;
          break;
        }
      }
      if (allZeros) {
        // Two consecutive 512-byte zero blocks signify EOF in POSIX tar
        break;
      }

      // Verify checksum
      const headerChksum = parseInt(headerBlock.subarray(148, 156).toString('utf-8').trim(), 8);
      const computedChksum = this._tarChecksum(headerBlock);
      if (Number.isNaN(headerChksum) || headerChksum !== computedChksum) {
        throw new Error(`Tar checksum mismatch at offset ${offset}: header says ${headerChksum}, computed ${computedChksum}`);
      }

      const rawName = this._nullTerminatedStr(headerBlock.subarray(0, 100));
      const mode = parseInt(this._nullTerminatedStr(headerBlock.subarray(100, 108)).trim(), 8);
      const size = parseInt(this._nullTerminatedStr(headerBlock.subarray(124, 136)).trim(), 8) || 0;
      const mtime = parseInt(this._nullTerminatedStr(headerBlock.subarray(136, 148)).trim(), 8) || 0;
      const typeflag = String.fromCharCode(headerBlock[156] || 0x30);
      const magic = this._nullTerminatedStr(headerBlock.subarray(257, 263));
      const prefix = this._nullTerminatedStr(headerBlock.subarray(345, 500));

      const fullPath = prefix ? `${prefix}/${rawName}` : rawName;
      const isDirectory = typeflag === '5' || fullPath.endsWith('/');

      offset += 512;

      const dataBlocksCount = Math.ceil(size / 512);
      const dataBytes = tarBuffer.subarray(offset, offset + size);
      offset += dataBlocksCount * 512;

      const entry = {
        path: fullPath,
        size,
        mode,
        mtime,
        typeflag,
        magic,
        data: dataBytes,
        isDirectory
      };

      entries.push(entry);
      if (!isDirectory) {
        fileMap[fullPath] = dataBytes;
      }
    }

    return { entries, fileMap };
  }

  static _nullTerminatedStr(buf) {
    const nullIdx = buf.indexOf(0);
    return (nullIdx === -1 ? buf : buf.subarray(0, nullIdx)).toString('utf-8');
  }

  static _tarChecksum(block) {
    let sum = 0;
    for (let i = 0; i < 512; i++) {
      if (i >= 148 && i < 156) {
        // Checksum field treated as 8 spaces (0x20)
        sum += 0x20;
      } else {
        sum += block[i];
      }
    }
    return sum;
  }

  static _crc32(buf) {
    let crc = -1;
    for (let i = 0; i < buf.length; i++) {
      let byte = buf[i];
      crc = crc ^ byte;
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
      }
    }
    return (crc ^ -1) >>> 0;
  }
}
