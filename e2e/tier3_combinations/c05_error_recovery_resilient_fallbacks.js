/**
 * Tier 3 - Combination C5: Error Recovery & Resilient Fallbacks
 * Tests graceful degradation when a single object in a repository is corrupted or missing,
 * ensuring other tree nodes and the overall forge UI remain completely operational.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { GitParser } from '../harness/git_parser.js';

describe('Tier 3 - Combination C5: Error Recovery & Resilient Fallbacks (C5)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('c5-resilience.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });
  });

  afterEach(() => {
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('C5.1: Corrupting a single blob does not prevent parsing of tree or remaining healthy blobs', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-resilient', 'main');
    gitHelper.commitFiles(workDir, {
      'healthy.txt': 'Healthy file content',
      'corrupt_me.txt': 'Target for corruption',
      'README.md': '# Resilient Test'
    }, 'Resilience commit');
    gitHelper.push(workDir, 'origin', 'main');

    const corruptSha = gitHelper.git(workDir, ['rev-parse', 'HEAD:corrupt_me.txt']);
    const healthySha = gitHelper.git(workDir, ['rev-parse', 'HEAD:healthy.txt']);

    // Corrupt one object
    gitHelper.corruptLooseObject(bareRepo, corruptSha, 'zlib_corrupt');

    // 1. Root tree object remains intact
    const treeSha = gitHelper.git(workDir, ['rev-parse', 'HEAD^{tree}']);
    const treeObj = gitHelper.readLooseObject(bareRepo, treeSha);
    const entries = GitParser.parseTree(treeObj.payload);
    assert.strictEqual(entries.length, 3);

    // 2. Healthy blob parses without issue
    const healthyObj = gitHelper.readLooseObject(bareRepo, healthySha);
    const healthyParsed = GitParser.parseBlob(healthyObj.payload);
    assert.strictEqual(healthyParsed.text, 'Healthy file content');

    // 3. Corrupted blob throws safely
    const corruptPath = path.join(bareRepo, 'objects', corruptSha.slice(0, 2), corruptSha.slice(2));
    const corruptBuf = fs.readFileSync(corruptPath);
    assert.throws(() => {
      GitParser.inflateLooseObject(corruptBuf, corruptSha);
    }, /Zlib decompression failed/i);
  });
});
