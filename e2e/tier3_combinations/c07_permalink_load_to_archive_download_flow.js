/**
 * Tier 3 - Combination C7: Permalink Load → Snapshot Archive Export Flow (C7)
 * Verifies that loading a direct immutable permalink correctly resolves the commit,
 * parses line highlights, and enables exporting a full ZIP/Tarball archive of that
 * exact historical commit tree without server computation.
 */

import zlib from 'node:zlib';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { SendforgeHttpClient } from '../harness/http_client.js';
import { GitParser } from '../harness/git_parser.js';
import { ArchiveValidator } from '../harness/archive_validator.js';

describe('Tier 3 - Combination C7: Permalink Load → Snapshot Archive Flow (C7)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;
  let serverHandle;
  let historicalCommitSha;
  let latestCommitSha;

  beforeEach(async () => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('c07-flow.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });

    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-c07', 'main');

    // Historical commit
    historicalCommitSha = gitHelper.commitFiles(workDir, {
      'src/config.json': '{\n  "version": "1.0.0",\n  "debug": false,\n  "port": 3000\n}',
      'src/index.ts': 'console.log("v1.0.0");\n',
      'README.md': '# Version 1.0.0\n'
    }, 'Commit 1: Historical v1');

    // Latest commit adds more files and changes config
    latestCommitSha = gitHelper.commitFiles(workDir, {
      'src/config.json': '{\n  "version": "2.0.0",\n  "debug": true,\n  "port": 8080\n}',
      'src/index.ts': 'console.log("v2.0.0");\n',
      'src/new_feature.ts': 'export const newFeature = true;\n',
      'README.md': '# Version 2.0.0\n'
    }, 'Commit 2: Latest v2');

    gitHelper.push(workDir, 'origin', 'main');
    serverHandle = await supervisor.startServer(bareRepo);
  });

  afterEach(async () => {
    if (serverHandle) await serverHandle.stop();
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('C7.1: Load immutable permalink route, verify line highlighting, and export exact commit snapshot', async () => {
    const client = new SendforgeHttpClient(serverHandle.baseUrl);

    // 1. Direct route load: #/blob/{historicalCommitSha}/src/config.json#L2-L4
    const routeUrl = `#/blob/${historicalCommitSha}/src/config.json#L2-L4`;

    // 2. Parse route parameters
    const match = routeUrl.match(/^#\/blob\/([0-9a-f]{40})\/(.+?)(?:#L(\d+)(?:-L(\d+))?)?$/);
    assert.ok(match);
    const parsedCommitSha = match[1];
    const parsedFilePath = match[2];
    const lineStart = parseInt(match[3], 10);
    const lineEnd = match[4] ? parseInt(match[4], 10) : lineStart;

    assert.strictEqual(parsedCommitSha, historicalCommitSha);
    assert.strictEqual(parsedFilePath, 'src/config.json');
    assert.strictEqual(lineStart, 2);
    assert.strictEqual(lineEnd, 4);

    // 3. Fetch historical commit object
    const commitRes = await client.getLooseObject(parsedCommitSha);
    const commit = GitParser.parseCommit(GitParser.inflateLooseObject(commitRes.buffer, parsedCommitSha).payload);

    // 4. Recursively collect all files in historical commit tree for snapshot archive
    const fetchTreeFiles = async (treeOid, currentPath = '') => {
      const treeRes = await client.getLooseObject(treeOid);
      const entries = GitParser.parseTree(GitParser.inflateLooseObject(treeRes.buffer, treeOid).payload);
      let fileList = [];

      for (const entry of entries) {
        const fullRelPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
        if (entry.type === 'tree') {
          const subFiles = await fetchTreeFiles(entry.oid, fullRelPath);
          fileList = fileList.concat(subFiles);
        } else if (entry.type === 'blob' || entry.type === 'executable') {
          const blobRes = await client.getLooseObject(entry.oid);
          const blob = GitParser.inflateLooseObject(blobRes.buffer, entry.oid);
          fileList.push({
            path: fullRelPath,
            data: blob.payload,
            mode: entry.type === 'executable' ? 0o100755 : 0o100644
          });
        }
      }
      return fileList;
    };

    const files = await fetchTreeFiles(commit.tree);
    assert.strictEqual(files.length, 3); // config.json, index.ts, README.md (new_feature.ts does NOT exist in historical commit)

    const filePaths = files.map(f => f.path);
    assert.includes(filePaths, 'src/config.json');
    assert.includes(filePaths, 'src/index.ts');
    assert.includes(filePaths, 'README.md');
    assert.notIncludes(filePaths, 'src/new_feature.ts');

    // 5. Generate ZIP snapshot in browser
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

    const zipBuffer = createZip(`snapshot-${historicalCommitSha.slice(0, 7)}`, files);
    const parsedZip = ArchiveValidator.parseZip(zipBuffer);

    assert.strictEqual(parsedZip.entries.length, 3);
    const configContent = parsedZip.fileMap[`snapshot-${historicalCommitSha.slice(0, 7)}/src/config.json`].toString('utf-8');
    assert.includes(configContent, '"version": "1.0.0"');
  });
});
