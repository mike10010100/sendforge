/**
 * Tier 2 - Boundary B19: Large Diffs & Complex File Operations (B19)
 * Tests PRs with 50+ files, large payloads, binary assets, mode changes,
 * and zero-change tree diffs.
 */

import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { SendforgeHttpClient } from '../harness/http_client.js';
import { GitParser } from '../harness/git_parser.js';
import { DagHelper } from '../harness/dag_helper.js';

describe('Tier 2 - Boundary B19: Large Diffs & Complex File Operations (B19)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;
  let serverHandle;
  let workDir;
  let baseSha;

  beforeEach(async () => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('b19-large-diffs.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });
    workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-b19', 'main');

    // Base commit with 5 initial files
    const initialFiles = {};
    for (let i = 1; i <= 5; i++) {
      initialFiles[`file_${i}.txt`] = `Initial content for file ${i}\nLine 2`;
    }
    baseSha = gitHelper.commitFiles(workDir, initialFiles, 'Base commit');
    gitHelper.push(workDir, 'origin', 'main');
  });

  afterEach(async () => {
    if (serverHandle) {
      await serverHandle.stop();
      serverHandle = null;
    }
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('B19.1: PR with 50+ modified files generates complete tree diff list', async () => {
    gitHelper.createBranch(workDir, 'feature-50-files', true);
    const manyFiles = {};
    for (let i = 1; i <= 55; i++) {
      manyFiles[`file_${i}.txt`] = `Modified content for file ${i}\nLine 2 modified\nLine 3 added`;
    }
    const prHeadSha = gitHelper.commitFiles(workDir, manyFiles, 'Modify 55 files');
    gitHelper.push(workDir, 'origin', 'feature-50-files');

    serverHandle = await supervisor.startServer(bareRepo);
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const fetchObject = async (oid) => {
      const res = await client.getLooseObject(oid);
      return GitParser.inflateLooseObject(res.buffer, oid);
    };

    const baseCommit = GitParser.parseCommit((await fetchObject(baseSha)).payload);
    const headCommit = GitParser.parseCommit((await fetchObject(prHeadSha)).payload);

    const diffs = await DagHelper.computeTreeDiff(fetchObject, baseCommit.tree, headCommit.tree);
    assert.strictEqual(diffs.length, 55, 'Must accurately detect all 55 file changes');
  });

  it('B19.2: Large text diff computes line additions and deletions accurately', () => {
    // Generate old text (1000 lines) and new text (1200 lines with modifications)
    const oldLines = [];
    for (let i = 1; i <= 1000; i++) oldLines.push(`Row ${i}: original text content`);
    const oldText = oldLines.join('\n');

    const newLines = [];
    for (let i = 1; i <= 1000; i++) {
      if (i % 10 === 0) {
        newLines.push(`Row ${i}: MODIFIED text content`);
      } else {
        newLines.push(`Row ${i}: original text content`);
      }
    }
    // Append 200 new lines
    for (let i = 1001; i <= 1200; i++) newLines.push(`Row ${i}: newly added text content`);
    const newText = newLines.join('\n');

    const diff = GitParser.computeUnifiedDiff(oldText, newText);
    assert.ok(diff.stats.additions >= 300);
    assert.ok(diff.stats.deletions >= 100);
    assert.strictEqual(diff.isIdentical, false);
  });

  it('B19.3: PR containing binary files (e.g. image blobs) marked as binary diff', () => {
    // Binary buffer with null bytes
    const binBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D]);
    const parsed = GitParser.parseBlob(binBuffer);
    assert.strictEqual(parsed.isBinary, true);
    assert.strictEqual(parsed.lines.length, 0);
  });

  it('B19.4: PR with file mode changes (0644 to 0755) preserves mode flag in tree diff', async () => {
    gitHelper.createBranch(workDir, 'feature-exec', true);
    const scriptPath = 'script.sh';
    const scriptSha = gitHelper.commitFiles(workDir, { [scriptPath]: '#!/bin/sh\necho "test"' }, 'Add script');

    // Chmod +x
    gitHelper.git(workDir, ['update-index', '--chmod=+x', scriptPath]);
    gitHelper.git(workDir, ['commit', '-m', 'Make script executable']);
    const execHeadSha = gitHelper.git(workDir, ['rev-parse', 'HEAD']);
    gitHelper.push(workDir, 'origin', 'feature-exec');

    if (!serverHandle) serverHandle = await supervisor.startServer(bareRepo);
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const fetchObject = async (oid) => {
      const res = await client.getLooseObject(oid);
      return GitParser.inflateLooseObject(res.buffer, oid);
    };

    const headCommit = GitParser.parseCommit((await fetchObject(execHeadSha)).payload);
    const treeObj = await fetchObject(headCommit.tree);
    const treeEntries = GitParser.parseTree(treeObj.payload);

    const scriptEntry = treeEntries.find(e => e.name === 'script.sh');
    assert.ok(scriptEntry !== undefined);
    assert.strictEqual(scriptEntry.mode, '100755');
    assert.strictEqual(scriptEntry.type, 'executable');
  });

  it('B19.5: Zero-change PR (identical tree at head and base) produces empty file changes list', async () => {
    gitHelper.createBranch(workDir, 'feature-no-op', true);
    // Commit with no file changes (empty commit)
    gitHelper.git(workDir, ['commit', '--allow-empty', '-m', 'Empty commit']);
    const noOpHead = gitHelper.git(workDir, ['rev-parse', 'HEAD']);
    gitHelper.push(workDir, 'origin', 'feature-no-op');

    if (!serverHandle) serverHandle = await supervisor.startServer(bareRepo);
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const fetchObject = async (oid) => {
      const res = await client.getLooseObject(oid);
      return GitParser.inflateLooseObject(res.buffer, oid);
    };

    const baseCommit = GitParser.parseCommit((await fetchObject(baseSha)).payload);
    const headCommit = GitParser.parseCommit((await fetchObject(noOpHead)).payload);

    const fileChanges = await DagHelper.computeTreeDiff(fetchObject, baseCommit.tree, headCommit.tree);
    assert.strictEqual(fileChanges.length, 0, 'Identical trees must produce 0 file diffs');
  });
});
