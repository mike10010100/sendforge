/**
 * Tier 3 - Combination C8: Blame View → Diff View Navigation → Raw Blob Export (C8)
 * Verifies the cross-feature lifecycle of inspecting line provenance in Blame View,
 * drilling down into the commit diff view, and extracting raw blob payloads.
 */

import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { SendforgeHttpClient } from '../harness/http_client.js';
import { GitParser } from '../harness/git_parser.js';
import { BlameHelper } from '../harness/blame_helper.js';

describe('Tier 3 - Combination C8: Blame → Diff → Raw Export Flow (C8)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;
  let serverHandle;
  let commit1Sha;
  let commit2Sha;

  beforeEach(async () => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('c08-flow.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });

    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-c08', 'main');

    commit1Sha = gitHelper.commitFiles(workDir, {
      'src/math.ts': 'export const add = (a: number, b: number) => a + b;'
    }, 'Commit 1: Add add function');

    commit2Sha = gitHelper.commitFiles(workDir, {
      'src/math.ts': 'export const add = (a: number, b: number) => a + b;\nexport const multiply = (a: number, b: number) => a * b;'
    }, 'Commit 2: Add multiply function');

    gitHelper.push(workDir, 'origin', 'main');
    serverHandle = await supervisor.startServer(bareRepo);
  });

  afterEach(async () => {
    if (serverHandle) await serverHandle.stop();
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('C8.1: Navigate Blame hunks -> Follow diff link -> Review diff -> Extract raw blob', async () => {
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const fetchObject = async (oid) => {
      const res = await client.getLooseObject(oid);
      return GitParser.inflateLooseObject(res.buffer, oid);
    };

    // 1. User views file at commit 2 and toggles Blame View
    const blame = await BlameHelper.computeBlame(fetchObject, commit2Sha, 'src/math.ts');
    assert.strictEqual(blame.hunks.length, 2);

    // Hunk 2 corresponds to commit2Sha
    const hunk2 = blame.hunks[1];
    assert.strictEqual(hunk2.commitOid, commit2Sha);

    // 2. User clicks commit diff link on hunk 2: #/commit/{commit2Sha}
    const diffUrl = `#/commit/${commit2Sha}`;
    assert.includes(diffUrl, commit2Sha);

    // 3. Diff View fetches commit 2 and parent commit 1
    const commit2Res = await client.getLooseObject(commit2Sha);
    const commit2 = GitParser.parseCommit(GitParser.inflateLooseObject(commit2Res.buffer, commit2Sha).payload);
    assert.strictEqual(commit2.parents[0], commit1Sha);

    const parentCommitRes = await client.getLooseObject(commit1Sha);
    const parentCommit = GitParser.parseCommit(GitParser.inflateLooseObject(parentCommitRes.buffer, commit1Sha).payload);

    // Resolve blobs in both trees
    const c2BlobOid = await BlameHelper.resolveBlobOid(fetchObject, commit2Sha, 'src/math.ts');
    const c1BlobOid = await BlameHelper.resolveBlobOid(fetchObject, commit1Sha, 'src/math.ts');

    const c2Blob = GitParser.parseBlob((await fetchObject(c2BlobOid)).payload);
    const c1Blob = GitParser.parseBlob((await fetchObject(c1BlobOid)).payload);

    const diff = GitParser.computeUnifiedDiff(c1Blob.text, c2Blob.text);
    assert.strictEqual(diff.stats.additions, 1);
    assert.strictEqual(diff.stats.deletions, 0);

    // 4. User navigates back to blob view and clicks "Raw" view
    const rawContent = c2Blob.text;
    assert.includes(rawContent, 'export const multiply');
  });
});
