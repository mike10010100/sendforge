import pako from 'pako';
import type { GitRepositoryClient } from './fetcher.js';

export interface ArchiveFileEntry {
  readonly path: string;
  readonly data: Uint8Array;
  readonly mode?: number; // e.g. 0o100644 or 0o100755
}

// Precomputed table for IEEE 802.3 CRC-32 (polynomial 0xEDB88320)
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c >>> 0;
}

/**
 * Calculates standard IEEE 802.3 32-bit Cyclic Redundancy Check (CRC-32)
 */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    const tableVal = CRC_TABLE[(crc ^ byte) & 0xff];
    crc = (crc >>> 8) ^ (tableVal ?? 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Encodes an in-memory PKWARE ZIP binary archive with Deflate/Store compression,
 * preserving POSIX file modes and prepending directory prefix.
 */
export function createZipArchive(
  prefix: string,
  files: readonly ArchiveFileEntry[] | ArchiveFileEntry[]
): Uint8Array {
  const parts: Uint8Array[] = [];
  const centralDirectoryHeaders: Uint8Array[] = [];
  let currentOffset = 0;

  const cleanPrefix = prefix
    ? (prefix.endsWith('/') ? prefix.slice(0, -1) : prefix)
    : '';

  const encoder = new TextEncoder();

  for (const file of files) {
    const cleanFilePath = file.path.replace(/^\/+/, '');
    const fullPath = cleanPrefix ? `${cleanPrefix}/${cleanFilePath}` : cleanFilePath;
    const nameBytes = encoder.encode(fullPath);
    const fileData = file.data;
    const fileCrc = crc32(fileData);

    let compMethod = 0;
    let compressedData = fileData;

    if (fileData.length > 0) {
      const deflated = pako.deflateRaw(fileData, { level: 6 });
      if (deflated.length < fileData.length) {
        compMethod = 8; // Deflate
        compressedData = deflated;
      }
    }

    let mode = file.mode ?? 0o100644;
    if (mode < 0o100000) {
      mode |= 0o100000;
    }
    const externalAttributes = (mode << 16) >>> 0;

    // 1. Local File Header (30 bytes + name length)
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer, localHeader.byteOffset, localHeader.byteLength);
    localView.setUint32(0, 0x04034b50, true); // Signature PK\x03\x04
    localView.setUint16(4, 20, true);         // Version needed (2.0)
    localView.setUint16(6, 0, true);          // General purpose bit flag
    localView.setUint16(8, compMethod, true); // Compression method (0 or 8)
    localView.setUint16(10, 0, true);         // Mod time (00:00:00)
    localView.setUint16(12, 0, true);         // Mod date (1980-01-01)
    localView.setUint32(14, fileCrc, true);   // CRC-32
    localView.setUint32(18, compressedData.length, true); // Compressed size
    localView.setUint32(22, fileData.length, true);       // Uncompressed size
    localView.setUint16(26, nameBytes.length, true);      // Filename length
    localView.setUint16(28, 0, true);                     // Extra field length
    localHeader.set(nameBytes, 30);

    parts.push(localHeader);
    parts.push(compressedData);

    // 2. Central Directory Header (46 bytes + name length)
    const cdHeader = new Uint8Array(46 + nameBytes.length);
    const cdView = new DataView(cdHeader.buffer, cdHeader.byteOffset, cdHeader.byteLength);
    cdView.setUint32(0, 0x02014b50, true);               // Signature PK\x01\x02
    cdView.setUint16(4, (3 << 8) | 20, true);            // Version made by: Unix (3) + 2.0 (20)
    cdView.setUint16(6, 20, true);                       // Version needed (2.0)
    cdView.setUint16(8, 0, true);                        // General purpose bit flag
    cdView.setUint16(10, compMethod, true);              // Compression method
    cdView.setUint16(12, 0, true);                       // Mod time
    cdView.setUint16(14, 0, true);                       // Mod date
    cdView.setUint32(16, fileCrc, true);                 // CRC-32
    cdView.setUint32(20, compressedData.length, true);   // Compressed size
    cdView.setUint32(24, fileData.length, true);         // Uncompressed size
    cdView.setUint16(28, nameBytes.length, true);        // Filename length
    cdView.setUint16(30, 0, true);                       // Extra field length
    cdView.setUint16(32, 0, true);                       // File comment length
    cdView.setUint16(34, 0, true);                       // Disk number start
    cdView.setUint16(36, 0, true);                       // Internal file attributes
    cdView.setUint32(38, externalAttributes, true);      // External file attributes
    cdView.setUint32(42, currentOffset, true);           // Relative offset of local header
    cdHeader.set(nameBytes, 46);

    centralDirectoryHeaders.push(cdHeader);
    currentOffset += localHeader.length + compressedData.length;
  }

  const cdOffset = currentOffset;
  let cdSize = 0;
  for (const cd of centralDirectoryHeaders) {
    parts.push(cd);
    cdSize += cd.length;
  }

  // 3. End of Central Directory Record (22 bytes)
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer, eocd.byteOffset, eocd.byteLength);
  eocdView.setUint32(0, 0x06054b50, true);    // Signature PK\x05\x06
  eocdView.setUint16(4, 0, true);             // Number of this disk
  eocdView.setUint16(6, 0, true);             // Disk with start of CD
  eocdView.setUint16(8, files.length, true);  // Entries on this disk
  eocdView.setUint16(10, files.length, true); // Total entries
  eocdView.setUint32(12, cdSize, true);       // Size of CD
  eocdView.setUint32(16, cdOffset, true);     // Offset of CD
  eocdView.setUint16(20, 0, true);            // Comment length
  parts.push(eocd);

  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const p of parts) {
    result.set(p, offset);
    offset += p.length;
  }

  return result;
}

/**
 * Encodes an in-memory POSIX ustar .tar.gz binary archive with gzip compression.
 */
export function createTarGzArchive(
  prefix: string,
  files: readonly ArchiveFileEntry[] | ArchiveFileEntry[]
): Uint8Array {
  const blocks: Uint8Array[] = [];
  const cleanPrefix = prefix
    ? (prefix.endsWith('/') ? prefix.slice(0, -1) : prefix)
    : '';
  const now = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();

  for (const file of files) {
    const cleanFilePath = file.path.replace(/^\/+/, '');
    const fullPath = cleanPrefix ? `${cleanPrefix}/${cleanFilePath}` : cleanFilePath;
    const fileData = file.data;
    let mode = file.mode ?? 0o100644;
    mode = mode & 0o7777;

    const header = new Uint8Array(512);

    // Path name and prefix splitting (POSIX ustar compliance)
    let name = fullPath;
    let pathPrefix = '';
    const fullPathBytes = encoder.encode(fullPath);
    if (fullPathBytes.length > 100) {
      const splitIdx = fullPath.lastIndexOf('/');
      if (splitIdx !== -1 && splitIdx <= 155) {
        pathPrefix = fullPath.slice(0, splitIdx);
        name = fullPath.slice(splitIdx + 1);
      }
    }

    const encodedName = encoder.encode(name);
    header.set(encodedName.subarray(0, 100), 0);

    // Mode: 7 octal digits + space
    const modeStr = mode.toString(8).padStart(7, '0') + ' ';
    header.set(encoder.encode(modeStr).subarray(0, 8), 100);

    // UID: 7 octal digits + space
    const uidStr = (0).toString(8).padStart(7, '0') + ' ';
    header.set(encoder.encode(uidStr).subarray(0, 8), 108);

    // GID: 7 octal digits + space
    const gidStr = (0).toString(8).padStart(7, '0') + ' ';
    header.set(encoder.encode(gidStr).subarray(0, 8), 116);

    // Size: 11 octal digits + space
    const sizeStr = fileData.length.toString(8).padStart(11, '0') + ' ';
    header.set(encoder.encode(sizeStr).subarray(0, 12), 124);

    // Mtime: 11 octal digits + space
    const mtimeStr = now.toString(8).padStart(11, '0') + ' ';
    header.set(encoder.encode(mtimeStr).subarray(0, 12), 136);

    // Checksum placeholder: 8 spaces (0x20)
    for (let i = 148; i < 156; i++) {
      header[i] = 0x20;
    }

    // Typeflag: '0' for normal file
    header[156] = 0x30;

    // Magic: "ustar\0" (6 bytes)
    header.set(encoder.encode('ustar\0'), 257);

    // Version: "00" (2 bytes)
    header.set(encoder.encode('00'), 263);

    // Uname: "sendforge\0" (32 bytes)
    header.set(encoder.encode('sendforge\0'), 265);

    // Gname: "sendforge\0" (32 bytes)
    header.set(encoder.encode('sendforge\0'), 297);

    // Prefix: (155 bytes)
    if (pathPrefix) {
      const encodedPrefix = encoder.encode(pathPrefix);
      header.set(encodedPrefix.subarray(0, 155), 345);
    }

    // Compute checksum
    let sum = 0;
    for (const b of header) {
      sum += b;
    }
    const checksumStr = sum.toString(8).padStart(6, '0') + '\0 ';
    header.set(encoder.encode(checksumStr).subarray(0, 8), 148);

    blocks.push(header);

    // Padded file data
    if (fileData.length > 0) {
      const paddedLength = Math.ceil(fileData.length / 512) * 512;
      const paddedData = new Uint8Array(paddedLength);
      paddedData.set(fileData, 0);
      blocks.push(paddedData);
    }
  }

  // Two 512-byte zero trailer blocks (1024 bytes)
  blocks.push(new Uint8Array(1024));

  const totalTarLen = blocks.reduce((sum, b) => sum + b.length, 0);
  const rawTar = new Uint8Array(totalTarLen);
  let tarOffset = 0;
  for (const b of blocks) {
    rawTar.set(b, tarOffset);
    tarOffset += b.length;
  }

  return pako.gzip(rawTar);
}

/**
 * Triggers a browser download of the provided binary data or Blob.
 */
export function triggerDownload(
  filename: string,
  data: Uint8Array | Blob,
  mimeType = 'application/octet-stream'
): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  const blob = data instanceof Blob ? data : new Blob([data as unknown as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

/**
 * Recursively exports all files under a root tree into a ZIP or TAR.GZ snapshot archive.
 */
export async function exportRepositorySnapshot(
  client: GitRepositoryClient,
  rootTreeOid: string,
  prefix: string,
  format: 'zip' | 'tar.gz',
  onProgress?: (completed: number, total: number) => void
): Promise<Uint8Array> {
  const treeFiles = await client.listAllTreeFiles(rootTreeOid);
  const total = treeFiles.length;

  if (total === 0) {
    onProgress?.(0, 0);
    return format === 'zip'
      ? createZipArchive(prefix, [])
      : createTarGzArchive(prefix, []);
  }

  const entries: ArchiveFileEntry[] = [];

  for (let i = 0; i < total; i++) {
    const item = treeFiles[i];
    if (!item) continue;
    const blob = await client.getBlob(item.entry.oid);

    let mode = 0o100644;
    const parsed = parseInt(item.entry.mode, 8);
    if (!Number.isNaN(parsed) && parsed > 0) {
      mode = parsed;
    }

    entries.push({
      path: item.path,
      data: blob.data,
      mode,
    });

    onProgress?.(i + 1, total);
  }

  if (format === 'zip') {
    return createZipArchive(prefix, entries);
  } else {
    return createTarGzArchive(prefix, entries);
  }
}
