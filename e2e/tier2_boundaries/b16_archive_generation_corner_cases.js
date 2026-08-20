/**
 * Tier 2 - Boundary B16: Archive Generation Corner Cases (B16)
 * Tests empty repository archives, 0-byte files in archives, 150+ file large trees,
 * raw binary payload roundtripping, and POSIX ustar long path prefix splitting.
 */

import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { describe, it, assert } from '../harness/framework.js';
import { ArchiveValidator } from '../harness/archive_validator.js';

describe('Tier 2 - Boundary B16: Archive Generation Corner Cases (B16)', () => {
  // Reference generators
  const createZip = (prefix, files) => {
    const parts = [];
    const centralDirectory = [];
    let currentOffset = 0;

    const crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[i] = c >>> 0;
    }
    const calcCrc = (buf) => {
      let crc = 0xFFFFFFFF;
      for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
      return (crc ^ 0xFFFFFFFF) >>> 0;
    };

    for (const file of files) {
      const fullPath = prefix ? `${prefix.replace(/\/$/, '')}/${file.path}` : file.path;
      const nameBytes = Buffer.from(fullPath, 'utf-8');
      const fileData = Buffer.from(file.data);
      const deflatedData = zlib.deflateRawSync(fileData);
      const crc = calcCrc(fileData);

      const localHeader = Buffer.alloc(30 + nameBytes.length);
      localHeader.writeUInt32LE(0x04034b50, 0);
      localHeader.writeUInt16LE(20, 4);
      localHeader.writeUInt16LE(0, 6);
      localHeader.writeUInt16LE(8, 8);
      localHeader.writeUInt16LE(0, 10);
      localHeader.writeUInt16LE(0, 12);
      localHeader.writeUInt32LE(crc, 14);
      localHeader.writeUInt32LE(deflatedData.length, 18);
      localHeader.writeUInt32LE(fileData.length, 22);
      localHeader.writeUInt16LE(nameBytes.length, 26);
      localHeader.writeUInt16LE(0, 28);
      nameBytes.copy(localHeader, 30);

      parts.push(localHeader);
      parts.push(deflatedData);

      const cdHeader = Buffer.alloc(46 + nameBytes.length);
      cdHeader.writeUInt32LE(0x02014b50, 0);
      cdHeader.writeUInt16LE(20, 4);
      cdHeader.writeUInt16LE(20, 6);
      cdHeader.writeUInt16LE(0, 8);
      cdHeader.writeUInt16LE(8, 10);
      cdHeader.writeUInt16LE(0, 12);
      cdHeader.writeUInt16LE(0, 14);
      cdHeader.writeUInt32LE(crc, 16);
      cdHeader.writeUInt32LE(deflatedData.length, 20);
      cdHeader.writeUInt32LE(fileData.length, 24);
      cdHeader.writeUInt16LE(nameBytes.length, 28);
      cdHeader.writeUInt16LE(0, 30);
      cdHeader.writeUInt16LE(0, 32);
      cdHeader.writeUInt16LE(0, 34);
      cdHeader.writeUInt16LE(0, 36);
      cdHeader.writeUInt32LE(0, 38);
      cdHeader.writeUInt32LE(currentOffset, 42);
      nameBytes.copy(cdHeader, 46);

      centralDirectory.push(cdHeader);
      currentOffset += localHeader.length + deflatedData.length;
    }

    const cdOffset = currentOffset;
    let cdSize = 0;
    for (const cd of centralDirectory) {
      parts.push(cd);
      cdSize += cd.length;
    }

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(files.length, 8);
    eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(cdOffset, 16);
    eocd.writeUInt16LE(0, 20);
    parts.push(eocd);

    return Buffer.concat(parts);
  };

  const createTarGz = (prefix, files) => {
    const blocks = [];
    for (const file of files) {
      const fullPath = prefix ? `${prefix.replace(/\/$/, '')}/${file.path}` : file.path;
      const fileData = Buffer.from(file.data);
      const mode = file.mode || 0o100644;
      const header = Buffer.alloc(512, 0);

      let name = fullPath;
      let pathPrefix = '';
      if (Buffer.byteLength(fullPath, 'utf-8') > 100) {
        const splitIdx = fullPath.lastIndexOf('/');
        if (splitIdx !== -1 && splitIdx <= 155) {
          pathPrefix = fullPath.slice(0, splitIdx);
          name = fullPath.slice(splitIdx + 1);
        }
      }

      header.write(name, 0, 100, 'utf-8');
      header.write((mode & 0o7777).toString(8).padStart(7, '0') + ' ', 100, 8, 'utf-8');
      header.write((0).toString(8).padStart(7, '0') + ' ', 108, 8, 'utf-8');
      header.write((0).toString(8).padStart(7, '0') + ' ', 116, 8, 'utf-8');
      header.write(fileData.length.toString(8).padStart(11, '0') + ' ', 124, 12, 'utf-8');
      header.write((1724100000).toString(8).padStart(11, '0') + ' ', 136, 12, 'utf-8');
      header.fill(0x20, 148, 156);
      header.write('0', 156, 1, 'utf-8');
      header.write('ustar\0', 257, 6, 'utf-8');
      header.write('00', 263, 2, 'utf-8');
      if (pathPrefix) header.write(pathPrefix, 345, 155, 'utf-8');

      let sum = 0;
      for (let i = 0; i < 512; i++) sum += header[i];
      header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf-8');

      blocks.push(header);
      const paddedLength = Math.ceil(fileData.length / 512) * 512;
      const paddedData = Buffer.alloc(paddedLength, 0);
      fileData.copy(paddedData, 0);
      if (paddedLength > 0) blocks.push(paddedData);
    }
    blocks.push(Buffer.alloc(1024, 0));
    return zlib.gzipSync(Buffer.concat(blocks));
  };

  it('B16.1: Empty file list produces valid empty ZIP and Tarball', () => {
    const emptyZip = createZip('empty-repo', []);
    const parsedZip = ArchiveValidator.parseZip(emptyZip);
    assert.strictEqual(parsedZip.entries.length, 0);

    const emptyTar = createTarGz('empty-repo', []);
    const parsedTar = ArchiveValidator.parseTarGz(emptyTar);
    assert.strictEqual(parsedTar.entries.length, 0);
  });

  it('B16.2: Archive containing 0-byte empty files generates valid entries with CRC=0', () => {
    const files = [
      { path: '.gitkeep', data: Buffer.alloc(0) },
      { path: 'empty.txt', data: Buffer.alloc(0) }
    ];

    const zip = createZip('repo-zero-byte', files);
    const parsedZip = ArchiveValidator.parseZip(zip);
    assert.strictEqual(parsedZip.entries.length, 2);
    assert.strictEqual(parsedZip.entries[0].crc32, 0);
    assert.strictEqual(parsedZip.entries[0].size, 0);

    const tar = createTarGz('repo-zero-byte', files);
    const parsedTar = ArchiveValidator.parseTarGz(tar);
    assert.strictEqual(parsedTar.entries.length, 2);
    assert.strictEqual(parsedTar.entries[0].size, 0);
  });

  it('B16.3: Large tree archive with 150+ files parses and validates completely', () => {
    const files = [];
    for (let i = 1; i <= 150; i++) {
      files.push({
        path: `src/components/module_${i}/Component${i}.tsx`,
        data: Buffer.from(`export const Component${i} = () => <div>${i}</div>;`, 'utf-8')
      });
    }

    const zip = createZip('large-repo', files);
    const parsedZip = ArchiveValidator.parseZip(zip);
    assert.strictEqual(parsedZip.entries.length, 150);

    const tar = createTarGz('large-repo', files);
    const parsedTar = ArchiveValidator.parseTarGz(tar);
    assert.strictEqual(parsedTar.entries.length, 150);
  });

  it('B16.4: Pure binary files preserve exact byte-for-byte SHA-256 in archives', () => {
    const randomBytes = crypto.randomBytes(65536); // 64 KB random binary
    const expectedSha256 = crypto.createHash('sha256').update(randomBytes).digest('hex');

    const files = [
      { path: 'assets/image.png', data: randomBytes }
    ];

    const zip = createZip('binary-repo', files);
    const parsedZip = ArchiveValidator.parseZip(zip);
    const zipData = parsedZip.fileMap['binary-repo/assets/image.png'];
    const zipSha256 = crypto.createHash('sha256').update(zipData).digest('hex');
    assert.strictEqual(zipSha256, expectedSha256);

    const tar = createTarGz('binary-repo', files);
    const parsedTar = ArchiveValidator.parseTarGz(tar);
    const tarData = parsedTar.fileMap['binary-repo/assets/image.png'];
    const tarSha256 = crypto.createHash('sha256').update(tarData).digest('hex');
    assert.strictEqual(tarSha256, expectedSha256);
  });

  it('B16.5: POSIX ustar long path (>100 characters) prefix/name splitting compliance', () => {
    const longPath = 'nested/directory/structure/that/exceeds/one/hundred/characters/in/total/length/to/test/tar/prefix/splitting/file.txt';
    assert.greaterThan(longPath.length, 100);

    const files = [
      { path: longPath, data: Buffer.from('long path content', 'utf-8') }
    ];

    const tar = createTarGz('prefix-test', files);
    const parsed = ArchiveValidator.parseTarGz(tar);
    assert.strictEqual(parsed.entries.length, 1);
    assert.strictEqual(parsed.entries[0].path, `prefix-test/${longPath}`);
    assert.strictEqual(parsed.entries[0].data.toString('utf-8'), 'long path content');
  });
});
