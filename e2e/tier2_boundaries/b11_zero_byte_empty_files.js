/**
 * Tier 2 - Boundary B11: 0-Byte Empty Files
 * Tests handling of empty files (Git OID e69de29bb2d1d6434b8b29ae775ad8c2e48c5391).
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { GitParser } from '../harness/git_parser.js';

describe('Tier 2 - Boundary B11: 0-Byte Empty Files (B11)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('b11-empty-file.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });
  });

  afterEach(() => {
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('B11.1: 0-byte file committed and parsed as empty non-binary text blob', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-empty-file', 'main');
    gitHelper.commitFiles(workDir, {
      '.gitkeep': '',
      'EMPTY': ''
    }, 'Add empty files');
    gitHelper.push(workDir, 'origin', 'main');

    const emptySha = gitHelper.git(workDir, ['rev-parse', 'HEAD:EMPTY']);
    assert.strictEqual(emptySha, 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');

    const obj = gitHelper.readLooseObject(bareRepo, emptySha);
    const parsed = GitParser.parseBlob(obj.payload);

    assert.strictEqual(parsed.isBinary, false);
    assert.strictEqual(parsed.size, 0);
    assert.strictEqual(parsed.text, '');
    assert.strictEqual(parsed.lines.length, 0);
  });
});
