/**
 * Tier 3 - Combination C4: Mixed Binary and Text Asset Workflow
 * Tests repositories containing a heterogeneous mix of code, markdown, binary images,
 * symlinks, and zero-byte files.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { GitParser } from '../harness/git_parser.js';

describe('Tier 3 - Combination C4: Mixed Binary & Text Assets (C4)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('c4-mixed.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });
  });

  afterEach(() => {
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('C4.1: Mixed asset repository resolves all file types and tree nodes accurately', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-mixed', 'main');

    const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00]);
    const files = {
      'README.md': '# Mixed Assets\nDocumentation file.',
      'src/lib.rs': 'pub fn compute() -> i32 { 100 }',
      'assets/logo.png': pngHeader,
      '.gitkeep': '',
      'config.json': '{\n  "mode": "production"\n}'
    };

    gitHelper.commitFiles(workDir, files, 'Add diverse assets');
    gitHelper.push(workDir, 'origin', 'main');

    const treeSha = gitHelper.git(workDir, ['rev-parse', 'HEAD^{tree}']);
    const obj = gitHelper.readLooseObject(bareRepo, treeSha);
    const rootEntries = GitParser.parseTree(obj.payload);

    // Verify root entries
    const rootNames = rootEntries.map(e => e.name);
    assert.includes(rootNames, 'README.md');
    assert.includes(rootNames, 'src');
    assert.includes(rootNames, 'assets');
    assert.includes(rootNames, '.gitkeep');
    assert.includes(rootNames, 'config.json');

    // Verify assets/logo.png is detected as binary
    const assetsEntry = rootEntries.find(e => e.name === 'assets');
    const assetsObj = gitHelper.readLooseObject(bareRepo, assetsEntry.oid);
    const assetsEntries = GitParser.parseTree(assetsObj.payload);
    const logoEntry = assetsEntries.find(e => e.name === 'logo.png');

    const logoObj = gitHelper.readLooseObject(bareRepo, logoEntry.oid);
    const logoBlob = GitParser.parseBlob(logoObj.payload);
    assert.strictEqual(logoBlob.isBinary, true);

    // Verify .gitkeep is 0-byte
    const gitkeepEntry = rootEntries.find(e => e.name === '.gitkeep');
    const gitkeepObj = gitHelper.readLooseObject(bareRepo, gitkeepEntry.oid);
    const gitkeepBlob = GitParser.parseBlob(gitkeepObj.payload);
    assert.strictEqual(gitkeepBlob.size, 0);
  });
});
