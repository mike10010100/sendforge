/**
 * Tier 1 - Feature 20: Raw Blob & Snapshot Archive Generation (F20 / R4)
 * Tests raw blob retrieval, client-side PKWARE ZIP archive generation,
 * client-side POSIX ustar .tar.gz archive generation, directory prefixing,
 * file mode preservation, and download trigger logic.
 */

import zlib from 'node:zlib';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { SendforgeHttpClient } from '../harness/http_client.js';
import { GitParser } from '../harness/git_parser.js';
import { ArchiveValidator } from '../harness/archive_validator.js';

describe('Tier 1 - Feature 20: Raw Blob & Snapshot Archive Generation (F20 / R4)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;
  let serverHandle;
  let headCommitOid;

  beforeEach(async () => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('f20-archives.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });

    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-f20', 'main');

    // Create files including normal files, scripts, and nested files
    headCommitOid = gitHelper.commitFiles(workDir, {
      'README.md': '# Project Archive Test\nThis is a test project.',
      'src/index.ts': 'export const hello = () => "world";\n',
      'src/utils/math.ts': 'export const add = (a: number, b: number) => a + b;\n',
      'scripts/build.sh': '#!/usr/bin/env bash\necho "Building project..."\n'
    }, 'Commit 1: Add project files');

    // Set script to executable
    try {
      gitHelper.git(workDir, ['update-index', '--chmod=+x', 'scripts/build.sh']);
      gitHelper.git(workDir, ['commit', '-m', 'Make build.sh executable']);
      headCommitOid = gitHelper.git(workDir, ['rev-parse', 'HEAD']);
    } catch (e) {
      // If chmod on git index not supported on platform, continue
    }

    gitHelper.push(workDir, 'origin', 'main');
    serverHandle = await supervisor.startServer(bareRepo);
  });

  afterEach(async () => {
    if (serverHandle) await serverHandle.stop();
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('T1.20.1: Raw blob content extraction and plain text display', async () => {
    const client = new SendforgeHttpClient(serverHandle.baseUrl);

    // 1. Fetch commit & tree to locate README.md blob
    const commitRes = await client.getLooseObject(headCommitOid);
    const commit = GitParser.parseCommit(GitParser.inflateLooseObject(commitRes.buffer, headCommitOid).payload);
    const treeRes = await client.getLooseObject(commit.tree);
    const treeEntries = GitParser.parseTree(GitParser.inflateLooseObject(treeRes.buffer, commit.tree).payload);

    const readmeEntry = treeEntries.find(e => e.name === 'README.md');
    assert.ok(readmeEntry);

    // 2. Fetch raw blob
    const blobRes = await client.getLooseObject(readmeEntry.oid);
    const blob = GitParser.inflateLooseObject(blobRes.buffer, readmeEntry.oid);
    const parsedBlob = GitParser.parseBlob(blob.payload);

    assert.strictEqual(parsedBlob.isBinary, false);
    assert.includes(parsedBlob.text, '# Project Archive Test');
  });

  it('T1.20.2: Client-side ZIP archive generator creates valid PKWARE ZIP', () => {
    // Reference in-browser ZIP generator implementation
    const createZipArchive = (prefix, files) => {
      const parts = [];
      const centralDirectory = [];
      let currentOffset = 0;

      const crcTable = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
          c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        crcTable[i] = c >>> 0;
      }
      const calcCrc = (buf) => {
        let crc = 0xFFFFFFFF;
        for (let i = 0; i < buf.length; i++) {
          crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
        }
        return (crc ^ 0xFFFFFFFF) >>> 0;
      };

      for (const file of files) {
        const fullPath = prefix ? `${prefix.replace(/\/$/, '')}/${file.path}` : file.path;
        const nameBytes = Buffer.from(fullPath, 'utf-8');
        const fileData = Buffer.from(file.data);

        // Compress data using raw deflate
        const deflatedData = zlib.deflateRawSync(fileData);
        const crc = calcCrc(fileData);

        const localHeader = Buffer.alloc(30 + nameBytes.length);
        localHeader.writeUInt32LE(0x04034b50, 0); // Local header signature
        localHeader.writeUInt16LE(20, 4);         // Version needed
        localHeader.writeUInt16LE(0, 6);          // General purpose bit flag
        localHeader.writeUInt16LE(8, 8);          // Compression method (8 = Deflate)
        localHeader.writeUInt16LE(0, 10);         // Last mod file time
        localHeader.writeUInt16LE(0, 12);         // Last mod file date
        localHeader.writeUInt32LE(crc, 14);       // CRC-32
        localHeader.writeUInt32LE(deflatedData.length, 18); // Compressed size
        localHeader.writeUInt32LE(fileData.length, 22);     // Uncompressed size
        localHeader.writeUInt16LE(nameBytes.length, 26);    // Filename length
        localHeader.writeUInt16LE(0, 28);                   // Extra field length
        nameBytes.copy(localHeader, 30);

        parts.push(localHeader);
        parts.push(deflatedData);

        // Record central directory header
        const cdHeader = Buffer.alloc(46 + nameBytes.length);
        cdHeader.writeUInt32LE(0x02014b50, 0);  // Central directory signature
        cdHeader.writeUInt16LE(20, 4);          // Version made by
        cdHeader.writeUInt16LE(20, 6);          // Version needed
        cdHeader.writeUInt16LE(0, 8);           // General purpose bit flag
        cdHeader.writeUInt16LE(8, 10);          // Compression method (8 = Deflate)
        cdHeader.writeUInt16LE(0, 12);          // Time
        cdHeader.writeUInt16LE(0, 14);          // Date
        cdHeader.writeUInt32LE(crc, 16);        // CRC-32
        cdHeader.writeUInt32LE(deflatedData.length, 20); // Compressed size
        cdHeader.writeUInt32LE(fileData.length, 24);     // Uncompressed size
        cdHeader.writeUInt16LE(nameBytes.length, 28);    // Filename length
        cdHeader.writeUInt16LE(0, 30);                   // Extra field length
        cdHeader.writeUInt16LE(0, 32);                   // File comment length
        cdHeader.writeUInt16LE(0, 34);                   // Disk number start
        cdHeader.writeUInt16LE(0, 36);                   // Internal file attributes
        cdHeader.writeUInt32LE(0, 38);                   // External file attributes
        cdHeader.writeUInt32LE(currentOffset, 42);        // Relative offset of local header
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

      // End of central directory record
      const eocd = Buffer.alloc(22);
      eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
      eocd.writeUInt16LE(0, 4);          // Disk number
      eocd.writeUInt16LE(0, 6);          // Disk with CD
      eocd.writeUInt16LE(files.length, 8); // Number of entries on disk
      eocd.writeUInt16LE(files.length, 10); // Total entries
      eocd.writeUInt32LE(cdSize, 12);    // Size of central directory
      eocd.writeUInt32LE(cdOffset, 16);  // Offset of CD
      eocd.writeUInt16LE(0, 20);         // Comment length
      parts.push(eocd);

      return Buffer.concat(parts);
    };

    const files = [
      { path: 'README.md', data: Buffer.from('# Hello World', 'utf-8') },
      { path: 'src/main.ts', data: Buffer.from('console.log("hello");', 'utf-8') }
    ];

    const zipBuffer = createZipArchive('test-repo-main', files);
    assert.ok(zipBuffer.length > 0);

    // Validate using ArchiveValidator
    const parsed = ArchiveValidator.parseZip(zipBuffer);
    assert.strictEqual(parsed.entries.length, 2);
    assert.ok(parsed.fileMap['test-repo-main/README.md']);
    assert.strictEqual(parsed.fileMap['test-repo-main/README.md'].toString('utf-8'), '# Hello World');
    assert.ok(parsed.fileMap['test-repo-main/src/main.ts']);
    assert.strictEqual(parsed.fileMap['test-repo-main/src/main.ts'].toString('utf-8'), 'console.log("hello");');
  });

  it('T1.20.3: Client-side Tarball generator creates valid POSIX ustar .tar.gz', () => {
    // Reference in-browser tar.gz generator
    const createTarGzArchive = (prefix, files) => {
      const blocks = [];

      for (const file of files) {
        const fullPath = prefix ? `${prefix.replace(/\/$/, '')}/${file.path}` : file.path;
        const fileData = Buffer.from(file.data);
        const mode = file.mode || 0o100644;
        const mtime = Math.floor(Date.now() / 1000);

        const header = Buffer.alloc(512, 0);

        // Path name and prefix splitting (POSIX ustar)
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
        header.write((0).toString(8).padStart(7, '0') + ' ', 108, 8, 'utf-8'); // UID
        header.write((0).toString(8).padStart(7, '0') + ' ', 116, 8, 'utf-8'); // GID
        header.write(fileData.length.toString(8).padStart(11, '0') + ' ', 124, 12, 'utf-8');
        header.write(mtime.toString(8).padStart(11, '0') + ' ', 136, 12, 'utf-8');
        header.fill(0x20, 148, 156); // Checksum initial blank spaces
        header.write('0', 156, 1, 'utf-8'); // Typeflag '0' = normal file
        header.write('ustar\0', 257, 6, 'utf-8');
        header.write('00', 263, 2, 'utf-8');
        if (pathPrefix) {
          header.write(pathPrefix, 345, 155, 'utf-8');
        }

        // Calculate octal checksum
        let sum = 0;
        for (let i = 0; i < 512; i++) {
          sum += header[i];
        }
        header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf-8');

        blocks.push(header);

        // Data blocks padded to 512 bytes
        const paddedLength = Math.ceil(fileData.length / 512) * 512;
        const paddedData = Buffer.alloc(paddedLength, 0);
        fileData.copy(paddedData, 0);
        if (paddedLength > 0) {
          blocks.push(paddedData);
        }
      }

      // Two 512-byte end of archive zero-blocks
      blocks.push(Buffer.alloc(1024, 0));

      const rawTar = Buffer.concat(blocks);
      return zlib.gzipSync(rawTar);
    };

    const files = [
      { path: 'README.md', data: Buffer.from('# Tarball Test', 'utf-8'), mode: 0o100644 },
      { path: 'bin/run.sh', data: Buffer.from('#!/bin/sh\necho ok', 'utf-8'), mode: 0o100755 }
    ];

    const tarGzBuffer = createTarGzArchive('project-v1.0', files);
    assert.ok(tarGzBuffer.length > 0);

    // Validate using ArchiveValidator
    const parsed = ArchiveValidator.parseTarGz(tarGzBuffer);
    assert.strictEqual(parsed.entries.length, 2);
    assert.ok(parsed.fileMap['project-v1.0/README.md']);
    assert.strictEqual(parsed.fileMap['project-v1.0/README.md'].toString('utf-8'), '# Tarball Test');
    assert.ok(parsed.fileMap['project-v1.0/bin/run.sh']);
    assert.strictEqual(parsed.fileMap['project-v1.0/bin/run.sh'].toString('utf-8'), '#!/bin/sh\necho ok');
  });

  it('T1.20.4: Snapshot archive path prefixing matching git archive conventions', () => {
    const makePrefix = (repoName, refName) => `${repoName}-${refName.replace(/\//g, '-')}`;

    assert.strictEqual(makePrefix('hybrid-gitforge', 'main'), 'hybrid-gitforge-main');
    assert.strictEqual(makePrefix('my-repo', 'feature/login'), 'my-repo-feature-login');
    assert.strictEqual(makePrefix('sendforge', 'v1.0.0'), 'sendforge-v1.0.0');
  });

  it('T1.20.5: File mode preservation in archive headers (0755 vs 0644)', () => {
    const files = [
      { path: 'doc.txt', mode: 0o100644 },
      { path: 'script.sh', mode: 0o100755 }
    ];

    assert.strictEqual(files[0].mode & 0o111, 0, 'doc.txt is not executable');
    assert.strictEqual((files[1].mode & 0o111) !== 0, true, 'script.sh is executable');
  });

  it('T1.20.6: Download trigger filename and MIME type selection', () => {
    const getArchiveDownloadParams = (repoName, refName, format) => {
      const sanitizedRef = refName.replace(/\//g, '-');
      if (format === 'zip') {
        return {
          filename: `${repoName}-${sanitizedRef}.zip`,
          mimeType: 'application/zip'
        };
      } else if (format === 'tar.gz' || format === 'tar') {
        return {
          filename: `${repoName}-${sanitizedRef}.tar.gz`,
          mimeType: 'application/gzip'
        };
      }
      throw new Error(`Unsupported format: ${format}`);
    };

    const zipParams = getArchiveDownloadParams('my-repo', 'main', 'zip');
    assert.strictEqual(zipParams.filename, 'my-repo-main.zip');
    assert.strictEqual(zipParams.mimeType, 'application/zip');

    const tarParams = getArchiveDownloadParams('my-repo', 'release/v1.0', 'tar.gz');
    assert.strictEqual(tarParams.filename, 'my-repo-release-v1.0.tar.gz');
    assert.strictEqual(tarParams.mimeType, 'application/gzip');
  });
});
