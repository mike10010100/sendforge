/**
 * Tier 2 - Boundary B5: Pure Binary Blobs
 * Tests detection and handling of raw binary data (null bytes, images, ELF binaries, WASM).
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { GitParser } from '../harness/git_parser.js';

describe('Tier 2 - Boundary B5: Pure Binary Blobs (B5)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('b5-binary.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });
  });

  afterEach(() => {
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('B5.1: Multi-format binary blobs detected properly', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-binary', 'main');

    // ELF magic header + null bytes
    const elfBinary = Buffer.from([0x7F, 0x45, 0x4C, 0x46, 0x02, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00]);
    // WASM magic header
    const wasmBinary = Buffer.from([0x00, 0x61, 0x73, 0x6D, 0x01, 0x00, 0x00, 0x00]);
    // PNG header
    const pngBinary = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D]);

    gitHelper.commitFiles(workDir, {
      'app': elfBinary,
      'module.wasm': wasmBinary,
      'icon.png': pngBinary
    }, 'Add binary assets');
    gitHelper.push(workDir, 'origin', 'main');

    const checkBinary = (filePath) => {
      const sha = gitHelper.git(workDir, ['rev-parse', `HEAD:${filePath}`]);
      const obj = gitHelper.readLooseObject(bareRepo, sha);
      const parsed = GitParser.parseBlob(obj.payload);
      assert.strictEqual(parsed.isBinary, true, `${filePath} must be detected as binary`);
    };

    checkBinary('app');
    checkBinary('module.wasm');
    checkBinary('icon.png');
  });
});
