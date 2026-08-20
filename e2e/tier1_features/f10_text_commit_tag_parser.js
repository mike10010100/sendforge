/**
 * Tier 1 - Feature 10: Text Commit & Tag Parser (F10)
 * Tests parsing of raw loose commit headers (tree, parent, author, committer, gpgsig, message)
 * and annotated tag objects.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { GitParser } from '../harness/git_parser.js';

describe('Tier 1 - Feature 10: Text Commit & Tag Parser (F10)', () => {
  let gitHelper;
  let bareRepo;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    bareRepo = gitHelper.createBareRepo('commit-tag-test.git');
  });

  afterEach(() => {
    gitHelper.cleanup();
  });

  it('T1.10.1: Initial root commit with zero parents', () => {
    const workDir = gitHelper.createWorkingRepo(bareRepo, 'work1');
    const commitSha = gitHelper.commitFiles(workDir, { 'README.md': '# Initial' }, 'Initial root commit');
    gitHelper.push(workDir, 'origin', 'main');

    const obj = gitHelper.readLooseObject(bareRepo, commitSha);
    assert.strictEqual(obj.type, 'commit');

    const commit = GitParser.parseCommit(obj.payload);
    assert.strictEqual(commit.parents.length, 0, 'Root commit must have 0 parents');
    assert.ok(commit.tree.length === 40, 'Tree OID must be 40 characters');
    assert.strictEqual(commit.message, 'Initial root commit');
    assert.strictEqual(commit.author.name, 'Sendforge Tester');
    assert.strictEqual(commit.author.email, 'tester@sendforge.dev');
  });

  it('T1.10.2: Standard sequential commit with single parent', () => {
    const workDir = gitHelper.createWorkingRepo(bareRepo, 'work2');
    const c1 = gitHelper.commitFiles(workDir, { 'f1.txt': '1' }, 'Commit 1');
    const c2 = gitHelper.commitFiles(workDir, { 'f2.txt': '2' }, 'Commit 2');
    gitHelper.push(workDir, 'origin', 'main');

    const obj = gitHelper.readLooseObject(bareRepo, c2);
    const commit = GitParser.parseCommit(obj.payload);

    assert.strictEqual(commit.parents.length, 1);
    assert.strictEqual(commit.parents[0], c1);
    assert.strictEqual(commit.message, 'Commit 2');
  });

  it('T1.10.3: Merge commit with two parents', () => {
    const workDir = gitHelper.createWorkingRepo(bareRepo, 'work3');
    const cBase = gitHelper.commitFiles(workDir, { 'base.txt': 'base' }, 'Base commit');

    gitHelper.createBranch(workDir, 'feature-x');
    const cFeat = gitHelper.commitFiles(workDir, { 'feat.txt': 'feat' }, 'Feat commit');

    gitHelper.git(workDir, ['checkout', 'main']);
    const cMain = gitHelper.commitFiles(workDir, { 'main.txt': 'main' }, 'Main commit');

    // Merge feature-x into main
    gitHelper.git(workDir, ['merge', 'feature-x', '-m', 'Merge feature-x into main']);
    const cMerge = gitHelper.git(workDir, ['rev-parse', 'HEAD']);
    gitHelper.push(workDir, 'origin', 'main');

    const obj = gitHelper.readLooseObject(bareRepo, cMerge);
    const commit = GitParser.parseCommit(obj.payload);

    assert.strictEqual(commit.parents.length, 2);
    assert.strictEqual(commit.parents[0], cMain);
    assert.strictEqual(commit.parents[1], cFeat);
  });

  it('T1.10.4: Multi-paragraph commit message with markdown formatting', () => {
    const workDir = gitHelper.createWorkingRepo(bareRepo, 'work4');
    const complexMsg = [
      'Refactor(core): Optimize loose object parsing',
      '',
      'This commit improves throughput by avoiding buffer copies.',
      '',
      'Key changes:',
      '- Use direct byte offsets',
      '- Implement fast path for ASCII paths',
      '',
      'Closes #42'
    ].join('\n');

    const commitSha = gitHelper.commitFiles(workDir, { 'core.rs': '// opt' }, complexMsg);
    gitHelper.push(workDir, 'origin', 'main');

    const obj = gitHelper.readLooseObject(bareRepo, commitSha);
    const commit = GitParser.parseCommit(obj.payload);

    assert.strictEqual(commit.message, complexMsg);
  });

  it('T1.10.5: Annotated tag parser extracts object, type, tag name, and tagger', () => {
    const workDir = gitHelper.createWorkingRepo(bareRepo, 'work5');
    const commitSha = gitHelper.commitFiles(workDir, { 'README.md': '# Release' }, 'Release commit');
    const tagSha = gitHelper.createAnnotatedTag(workDir, 'v2.0.0', 'Release v2.0.0 is ready!');
    gitHelper.push(workDir, 'origin', '--all');
    gitHelper.push(workDir, 'origin', '--tags');

    const obj = gitHelper.readLooseObject(bareRepo, tagSha);
    assert.strictEqual(obj.type, 'tag');

    const tag = GitParser.parseTag(obj.payload);
    assert.strictEqual(tag.object, commitSha);
    assert.strictEqual(tag.targetType, 'commit');
    assert.strictEqual(tag.tag, 'v2.0.0');
    assert.strictEqual(tag.message, 'Release v2.0.0 is ready!');
  });

  it('T1.10.6: GPG signature header extraction in commit payload', () => {
    const syntheticSignedPayload = Buffer.from([
      'tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904',
      'author Alice <alice@example.com> 1700000000 +0000',
      'committer Bob <bob@example.com> 1700000000 +0000',
      'gpgsig -----BEGIN PGP SIGNATURE-----',
      ' iQIzBAABCAAdFiEE...',
      ' =xyz1',
      ' -----END PGP SIGNATURE-----',
      '',
      'Signed commit test'
    ].join('\n'));

    const commit = GitParser.parseCommit(syntheticSignedPayload);
    assert.ok(commit.gpgsig !== null, 'gpgsig must be extracted');
    assert.includes(commit.gpgsig, 'BEGIN PGP SIGNATURE');
    assert.strictEqual(commit.message, 'Signed commit test');
  });
});
