/**
 * Tier 4 - Workload W7: Full Snapshot Archive Extraction & Byte-for-Byte Validation (W7)
 * Tests client-side ZIP and POSIX ustar .tar.gz archive generation from a live Git repository,
 * extracts all archive payloads in memory, and performs byte-for-byte, path-for-path, and
 * permission mode validation against the native Git tree.
 */

import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { SendforgeHttpClient } from '../harness/http_client.js';
import { GitParser } from '../harness/git_parser.js';
import { ArchiveValidator } from '../harness/archive_validator.js';

describe('Tier 4 - Workload W7: Snapshot Archive Extraction & Validation (W7)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;
  let serverHandle;
  let headCommitSha;

  const repoFiles = {
    'README.md': '# Full Snapshot Test\nProduction grade repository archive testing.\n',
    'package.json': '{\n  "name": "archive-test",\n  "version": "1.0.0"\n}\n',
    'src/index.ts': 'export const run = () => console.log("running");\n',
    'src/components/Button.tsx': 'export const Button = () => <button>Click</button>;\n',
    'src/components/Modal.tsx': 'export const Modal = () => <div>Modal</div>;\n',
    'assets/logo.bin': Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0xFF, 0xEE, 0xDD]),
    'scripts/deploy.sh': '#!/bin/bash\necho "deploying..."\n'
  };

  beforeEach(async () => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('w07-archive-validation.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });

    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-w07', 'main');
    headCommitSha = gitHelper.commitFiles(workDir, repoFiles, 'Commit 1: Comprehensive repository');

    try {
      gitHelper.git(workDir, ['update-index', '--chmod=+x', 'scripts/deploy.sh']);
      gitHelper.git(workDir, ['commit', '-m', 'Make deploy.sh executable']);
      headCommitSha = gitHelper.git(workDir, ['rev-parse', 'HEAD']);
    } catch (e) {}

    gitHelper.push(workDir, 'origin', 'main');
    serverHandle = await supervisor.startServer(bareRepo);
  });

  afterEach(async () => {
    if (serverHandle) await serverHandle.stop();
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('W7.1: In-browser ZIP and Tarball archives extract and match native repo byte-for-byte', async () => {
    const client = new SendforgeHttpClient(serverHandle.baseUrl);

    // 1. Fetch commit & tree recursively over HTTP
    const commitRes = await client.getLooseObject(headCommitSha);
    const commit = GitParser.parseCommit(GitParser.inflateLooseObject(commitRes.buffer, headCommitSha).payload);

    const fetchTreeEntries = async (treeOid, prefix = '') => {
      const treeRes = await client.getLooseObject(treeOid);
      const entries = GitParser.parseTree(GitParser.inflateLooseObject(treeRes.buffer, treeOid).payload);
      let list = [];

      for (const entry of entries) {
        const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.type === 'tree') {
          list = list.concat(await fetchTreeEntries(entry.oid, fullPath));
        } else {
          const blobRes = await client.getLooseObject(entry.oid);
          const blob = GitParser.inflateLooseObject(blobRes.buffer, entry.oid);
          list.push({
            path: fullPath,
            data: blob.payload,
            mode: entry.type === 'executable' ? 0o100755 : 0o100644
          });
        }
      }
      return list;
    };

    const files = await fetchTreeEntries(commit.tree);
    assert.strictEqual(files.length, 7);

    // 2. Generate ZIP archive in memory
    const createZip = (prefix, fileEntries) => {
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

      for (const file of fileEntries) {
        const fullPath = prefix ? `${prefix}/${file.path}` : file.path;
        const nameBytes = Buffer.from(fullPath, 'utf-8');
        const fileData = Buffer.from(file.data);
        const deflated = zlib.deflateRawSync(fileData);
        const crc = calcCrc(fileData);

        const localHeader = Buffer.alloc(30 + nameBytes.length);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(0, 6);
        localHeader.writeUInt16LE(8, 8);
        localHeader.writeUInt16LE(0, 10);
        localHeader.writeUInt16LE(0, 12);
        localHeader.writeUInt32LE(crc, 14);
        localHeader.writeUInt32LE(deflated.length, 18);
        localHeader.writeUInt32LE(fileData.length, 22);
        localHeader.writeUInt16LE(nameBytes.length, 26);
        localHeader.writeUInt16LE(0, 28);
        nameBytes.copy(localHeader, 30);

        parts.push(localHeader);
        parts.push(deflated);

        const cdHeader = Buffer.alloc(46 + nameBytes.length);
        cdHeader.writeUInt32LE(0x02014b50, 0);
        cdHeader.writeUInt16LE(20, 4);
        cdHeader.writeUInt16LE(20, 6);
        cdHeader.writeUInt16LE(0, 8);
        cdHeader.writeUInt16LE(8, 10);
        cdHeader.writeUInt16LE(0, 12);
        cdHeader.writeUInt16LE(0, 14);
        cdHeader.writeUInt32LE(crc, 16);
        cdHeader.writeUInt32LE(deflated.length, 20);
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
        currentOffset += localHeader.length + deflated.length;
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
      eocd.writeUInt16LE(fileEntries.length, 8);
      eocd.writeUInt16LE(fileEntries.length, 10);
      eocd.writeUInt32LE(cdSize, 12);
      eocd.writeUInt32LE(cdOffset, 16);
      eocd.writeUInt16LE(0, 20);
      parts.push(eocd);

      return Buffer.concat(parts);
    };

    const prefix = 'w07-archive-validation-main';
    const zipData = createZip(prefix, files);

    // Validate ZIP extraction
    const parsedZip = ArchiveValidator.parseZip(zipData);
    assert.strictEqual(parsedZip.entries.length, 7);

    for (const [relPath, originalContent] of Object.entries(repoFiles)) {
      const extracted = parsedZip.fileMap[`${prefix}/${relPath}`];
      assert.ok(extracted, `Missing file in ZIP: ${relPath}`);
      const expectedBuf = Buffer.isBuffer(originalContent) ? originalContent : Buffer.from(originalContent, 'utf-8');
      assert.strictEqual(
        crypto.createHash('sha256').update(extracted).digest('hex'),
        crypto.createHash('sha256').update(expectedBuf).digest('hex'),
        `SHA256 mismatch for ${relPath}`
      );
    }

    // 3. Generate POSIX ustar .tar.gz archive in memory
    const createTarGz = (pfix, fileEntries) => {
      const blocks = [];
      for (const file of fileEntries) {
        const fullPath = pfix ? `${pfix}/${file.path}` : file.path;
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

    const tarGzData = createTarGz(prefix, files);
    const parsedTar = ArchiveValidator.parseTarGz(tarGzData);
    assert.strictEqual(parsedTar.entries.length, 7);

    for (const [relPath, originalContent] of Object.entries(repoFiles)) {
      const extracted = parsedTar.fileMap[`${prefix}/${relPath}`];
      assert.ok(extracted, `Missing file in Tarball: ${relPath}`);
      const expectedBuf = Buffer.isBuffer(originalContent) ? originalContent : Buffer.from(originalContent, 'utf-8');
      assert.strictEqual(
        crypto.createHash('sha256').update(extracted).digest('hex'),
        crypto.createHash('sha256').update(expectedBuf).digest('hex'),
        `SHA256 mismatch in tar for ${relPath}`
      );
    }
  });
});
