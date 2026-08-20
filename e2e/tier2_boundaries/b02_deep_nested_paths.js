/**
 * Tier 2 - Boundary B2: 50+ Deep Nested Directory Structure
 * Verifies recursive tree resolution and breadcrumb navigation
 * over deeply nested directory structures (depth > 50).
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { GitParser } from '../harness/git_parser.js';

describe('Tier 2 - Boundary B2: Deep Nested Directory Structure (Depth >= 50)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('b2-deep.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });
  });

  afterEach(() => {
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('B2.1: Creates and parses a 55-level deep directory tree in Git repository', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-deep', 'main');
    const depth = 55;
    gitHelper.createDeepNestedTree(workDir, depth, 'deep_leaf.txt', 'Leaf node at level 55');
    gitHelper.push(workDir, 'origin', 'main');

    // Recursively traverse from root tree down to level 55
    let currentTreeSha = gitHelper.git(workDir, ['rev-parse', 'HEAD^{tree}']);
    for (let level = 1; level <= depth; level++) {
      const obj = gitHelper.readLooseObject(bareRepo, currentTreeSha);
      assert.strictEqual(obj.type, 'tree');
      const entries = GitParser.parseTree(obj.payload);

      const nextLevelName = `level_${level}`;
      const dirEntry = entries.find(e => e.name === nextLevelName);
      assert.ok(dirEntry, `Must find directory ${nextLevelName} at level ${level}`);
      assert.strictEqual(dirEntry.type, 'tree');
      currentTreeSha = dirEntry.oid;
    }

    // Inside level_55 tree, find deep_leaf.txt
    const leafTreeObj = gitHelper.readLooseObject(bareRepo, currentTreeSha);
    const leafEntries = GitParser.parseTree(leafTreeObj.payload);
    const fileEntry = leafEntries.find(e => e.name === 'deep_leaf.txt');
    assert.ok(fileEntry, 'Must find deep_leaf.txt inside level_55');
    assert.strictEqual(fileEntry.type, 'blob');

    const blobObj = gitHelper.readLooseObject(bareRepo, fileEntry.oid);
    const parsedBlob = GitParser.parseBlob(blobObj.payload);
    assert.strictEqual(parsedBlob.text, 'Leaf node at level 55');
  });

  it('B2.2: Post-receive hook executes successfully on 55-level deep tree', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-hook-deep', 'main');
    gitHelper.createDeepNestedTree(workDir, 55, 'leaf.txt', 'hook test');
    gitHelper.push(workDir, 'origin', 'main');

    const metaPath = path.join(bareRepo, 'static', 'meta.json');
    assert.ok(fs.existsSync(metaPath), 'meta.json must be generated without stack overflow');
  });
});
