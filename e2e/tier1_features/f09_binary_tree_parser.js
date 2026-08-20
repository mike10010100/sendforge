/**
 * Tier 1 - Feature 9: Binary Tree Object Parser (F9)
 * Tests parsing of raw binary tree objects with variable-length mode strings,
 * null-terminated filenames, and 20-byte SHA-1 binary digests.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { GitParser } from '../harness/git_parser.js';

describe('Tier 1 - Feature 9: Binary Tree Object Parser (F9)', () => {
  let gitHelper;
  let bareRepo;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    bareRepo = gitHelper.createBareRepo('tree-parser-test.git');
  });

  afterEach(() => {
    gitHelper.cleanup();
  });

  it('T1.9.1: Mixed directory tree contains file blobs and subtrees with 40-hex OIDs', () => {
    const workDir = gitHelper.createWorkingRepo(bareRepo, 'work1');
    gitHelper.commitFiles(workDir, {
      'README.md': '# Root Readme',
      'src/lib.rs': 'pub fn hello() {}',
      'docs/guide.md': '# Guide'
    }, 'Tree commit');
    gitHelper.push(workDir, 'origin', 'main');

    const treeSha = gitHelper.git(workDir, ['rev-parse', 'HEAD^{tree}']);
    const obj = gitHelper.readLooseObject(bareRepo, treeSha);
    assert.strictEqual(obj.type, 'tree');

    const entries = GitParser.parseTree(obj.payload);
    assert.strictEqual(entries.length, 3);

    const names = entries.map(e => e.name);
    assert.includes(names, 'README.md');
    assert.includes(names, 'src');
    assert.includes(names, 'docs');

    const srcEntry = entries.find(e => e.name === 'src');
    assert.strictEqual(srcEntry.type, 'tree');
    assert.strictEqual(srcEntry.oid.length, 40);
  });

  it('T1.9.2: Executable file mode (100755) identification', () => {
    const workDir = gitHelper.createWorkingRepo(bareRepo, 'work2');
    gitHelper.commitFiles(workDir, { 'script.sh': '#!/bin/bash\necho ok' }, 'Add script');
    // Mark executable in git
    gitHelper.git(workDir, ['update-index', '--chmod=+x', 'script.sh']);
    gitHelper.git(workDir, ['commit', '-m', 'Make executable']);
    gitHelper.push(workDir, 'origin', 'main');

    const treeSha = gitHelper.git(workDir, ['rev-parse', 'HEAD^{tree}']);
    const obj = gitHelper.readLooseObject(bareRepo, treeSha);
    const entries = GitParser.parseTree(obj.payload);

    const scriptEntry = entries.find(e => e.name === 'script.sh');
    assert.ok(scriptEntry);
    assert.strictEqual(scriptEntry.mode, '100755');
    assert.strictEqual(scriptEntry.type, 'executable');
  });

  it('T1.9.3: Symlink file mode (120000) identification', () => {
    const workDir = gitHelper.createWorkingRepo(bareRepo, 'work3');
    fs.writeFileSync(path.join(workDir, 'target.txt'), 'target content');
    // Create symlink
    fs.symlinkSync('target.txt', path.join(workDir, 'symlink.txt'));
    gitHelper.git(workDir, ['add', 'target.txt', 'symlink.txt']);
    gitHelper.git(workDir, ['commit', '-m', 'Add symlink']);
    gitHelper.push(workDir, 'origin', 'main');

    const treeSha = gitHelper.git(workDir, ['rev-parse', 'HEAD^{tree}']);
    const obj = gitHelper.readLooseObject(bareRepo, treeSha);
    const entries = GitParser.parseTree(obj.payload);

    const linkEntry = entries.find(e => e.name === 'symlink.txt');
    assert.ok(linkEntry);
    assert.strictEqual(linkEntry.mode, '120000');
    assert.strictEqual(linkEntry.type, 'symlink');
  });

  it('T1.9.4: Subtree directory mode (040000 / 40000) recursive resolution', () => {
    const workDir = gitHelper.createWorkingRepo(bareRepo, 'work4');
    gitHelper.commitFiles(workDir, {
      'pkg/nested/file.txt': 'nested content'
    }, 'Nested commit');
    gitHelper.push(workDir, 'origin', 'main');

    const rootTreeSha = gitHelper.git(workDir, ['rev-parse', 'HEAD^{tree}']);
    const rootObj = gitHelper.readLooseObject(bareRepo, rootTreeSha);
    const rootEntries = GitParser.parseTree(rootObj.payload);
    const pkgEntry = rootEntries.find(e => e.name === 'pkg');

    // Parse pkg subtree
    const pkgObj = gitHelper.readLooseObject(bareRepo, pkgEntry.oid);
    const pkgEntries = GitParser.parseTree(pkgObj.payload);
    const nestedEntry = pkgEntries.find(e => e.name === 'nested');
    assert.strictEqual(nestedEntry.type, 'tree');

    // Parse nested subtree
    const nestedObj = gitHelper.readLooseObject(bareRepo, nestedEntry.oid);
    const nestedEntries = GitParser.parseTree(nestedObj.payload);
    const fileEntry = nestedEntries.find(e => e.name === 'file.txt');
    assert.strictEqual(fileEntry.type, 'blob');
  });

  it('T1.9.5: Large tree containing 150+ file entries parses accurately', () => {
    const workDir = gitHelper.createWorkingRepo(bareRepo, 'work5');
    const files = {};
    for (let i = 1; i <= 150; i++) {
      files[`file_${String(i).padStart(3, '0')}.txt`] = `Content for file ${i}`;
    }
    gitHelper.commitFiles(workDir, files, 'Add 150 files');
    gitHelper.push(workDir, 'origin', 'main');

    const treeSha = gitHelper.git(workDir, ['rev-parse', 'HEAD^{tree}']);
    const obj = gitHelper.readLooseObject(bareRepo, treeSha);
    const entries = GitParser.parseTree(obj.payload);

    assert.strictEqual(entries.length, 150);
    assert.strictEqual(entries[0].name, 'file_001.txt');
    assert.strictEqual(entries[149].name, 'file_150.txt');
  });

  it('T1.9.6: Truncated binary tree buffer throws parse error safely', () => {
    // Mode and name with truncated 20-byte OID (only 10 bytes)
    const malformed = Buffer.concat([
      Buffer.from('100644 bad_file.txt\0'),
      Buffer.alloc(10, 0xAA)
    ]);

    assert.throws(() => {
      GitParser.parseTree(malformed);
    }, /truncated/i);
  });
});
