/**
 * Tier 2 - Boundary B14: Blame Edge Cases & Pathological Files (B14)
 * Tests 0-byte empty files, single-line files, unchanged files across 50 commits,
 * multi-parent merge commits, and pure binary file blame guards.
 */

import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { SendforgeHttpClient } from '../harness/http_client.js';
import { GitParser } from '../harness/git_parser.js';
import { BlameHelper } from '../harness/blame_helper.js';

describe('Tier 2 - Boundary B14: Blame Edge Cases & Pathological Files (B14)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;
  let serverHandle;
  let emptyFileCommitSha;
  let singleLineCommitSha;
  let ancientCommitSha;
  let latestCommitSha;
  let mergeCommitSha;

  beforeEach(async () => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('b14-blame-edges.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });

    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-b14', 'main');

    // 1. Initial commit with ancient file, empty file, and single line file
    ancientCommitSha = gitHelper.commitFiles(workDir, {
      'ancient.txt': 'ancient line 1\nancient line 2',
      'empty.txt': '',
      'single.txt': 'initial single line',
      'binary.bin': Buffer.from([0x00, 0x01, 0x02, 0x03, 0xFF])
    }, 'Commit 1: Add initial edge files', {
      GIT_AUTHOR_NAME: 'Ancient Author',
      GIT_AUTHOR_EMAIL: 'ancient@example.com'
    });
    emptyFileCommitSha = ancientCommitSha;

    // 2. Commit 2 on single.txt
    singleLineCommitSha = gitHelper.commitFiles(workDir, {
      'single.txt': 'updated single line'
    }, 'Commit 2: Update single line file', {
      GIT_AUTHOR_NAME: 'Single Line Author',
      GIT_AUTHOR_EMAIL: 'single@example.com'
    });

    // 3. Make 20 intermediate commits modifying other files (ancient.txt remains untouched)
    let curSha = singleLineCommitSha;
    for (let i = 1; i <= 20; i++) {
      curSha = gitHelper.commitFiles(workDir, {
        [`other_${i}.txt`]: `content ${i}`
      }, `Intermediate commit ${i}`);
    }

    // 4. Create feature branch and merge back to main to test merge commit blame
    gitHelper.createBranch(workDir, 'feature-merge');
    gitHelper.commitFiles(workDir, { 'merge_feat.txt': 'feature work' }, 'Feature commit');

    gitHelper.git(workDir, ['checkout', 'main']);
    gitHelper.commitFiles(workDir, { 'main_work.txt': 'main work' }, 'Main work commit');

    gitHelper.git(workDir, ['merge', 'feature-merge', '-m', 'Merge feature into main']);
    mergeCommitSha = gitHelper.git(workDir, ['rev-parse', 'HEAD']);
    latestCommitSha = mergeCommitSha;

    gitHelper.push(workDir, 'origin', 'main');
    serverHandle = await supervisor.startServer(bareRepo);
  });

  afterEach(async () => {
    if (serverHandle) await serverHandle.stop();
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('B14.1: Blame on 0-byte empty file returns 0 lines without error', async () => {
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const fetchObject = async (oid) => {
      const res = await client.getLooseObject(oid);
      return GitParser.inflateLooseObject(res.buffer, oid);
    };

    const blame = await BlameHelper.computeBlame(fetchObject, emptyFileCommitSha, 'empty.txt');
    assert.strictEqual(blame.lines.length, 0);
    assert.strictEqual(blame.hunks.length, 0);
  });

  it('B14.2: Blame on single-line file across revisions', async () => {
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const fetchObject = async (oid) => {
      const res = await client.getLooseObject(oid);
      return GitParser.inflateLooseObject(res.buffer, oid);
    };

    const blame = await BlameHelper.computeBlame(fetchObject, singleLineCommitSha, 'single.txt');
    assert.strictEqual(blame.lines.length, 1);
    assert.strictEqual(blame.lines[0].lineNumber, 1);
    assert.strictEqual(blame.lines[0].commitOid, singleLineCommitSha);
    assert.strictEqual(blame.lines[0].authorName, 'Single Line Author');
  });

  it('B14.3: Blame on file untouched across 20+ commits correctly identifies ancient commit', async () => {
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const fetchObject = async (oid) => {
      const res = await client.getLooseObject(oid);
      return GitParser.inflateLooseObject(res.buffer, oid);
    };

    const blame = await BlameHelper.computeBlame(fetchObject, latestCommitSha, 'ancient.txt');
    assert.strictEqual(blame.lines.length, 2);
    assert.strictEqual(blame.lines[0].commitOid, ancientCommitSha);
    assert.strictEqual(blame.lines[1].commitOid, ancientCommitSha);
    assert.strictEqual(blame.lines[0].authorName, 'Ancient Author');
  });

  it('B14.4: Blame on multi-parent merge commit traverses first-parent DAG', async () => {
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const fetchObject = async (oid) => {
      const res = await client.getLooseObject(oid);
      return GitParser.inflateLooseObject(res.buffer, oid);
    };

    const blame = await BlameHelper.computeBlame(fetchObject, mergeCommitSha, 'main_work.txt');
    assert.strictEqual(blame.lines.length, 1);
    assert.strictEqual(blame.lines[0].summary, 'Main work commit');
  });

  it('B14.5: Binary file blame guard detects binary payload and refuses line diff', async () => {
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const fetchObject = async (oid) => {
      const res = await client.getLooseObject(oid);
      return GitParser.inflateLooseObject(res.buffer, oid);
    };

    await assert.rejects(
      async () => BlameHelper.computeBlame(fetchObject, ancientCommitSha, 'binary.bin'),
      /Cannot blame binary file/
    );
  });
});
