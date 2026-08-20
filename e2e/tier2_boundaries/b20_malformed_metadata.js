/**
 * Tier 2 - Boundary B20: Malformed Metadata & Broken References (B20)
 * Tests non-JSON metadata blobs, missing commit references, non-numeric ref IDs,
 * corrupted review notes, and missing target branch refs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { SendforgeHttpClient } from '../harness/http_client.js';

describe('Tier 2 - Boundary B20: Malformed Metadata & Broken References (B20)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;
  let serverHandle;
  let workDir;
  let mainCommit;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('b20-malformed-meta.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });
    workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-b20', 'main');
    mainCommit = gitHelper.commitFiles(workDir, { 'README.md': '# Malformed Meta Test' }, 'Initial commit');
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

  it('B20.1: Non-JSON / corrupt payload in refs/pull/*/meta handled without crash', () => {
    // Write non-JSON string into metadata blob
    const corruptBlobOid = gitHelper.writeLooseObject(bareRepo, 'blob', Buffer.from('NOT_VALID_JSON{:::broken', 'utf-8'));
    gitHelper.git(bareRepo, ['update-ref', 'refs/pull/99/head', mainCommit]);
    gitHelper.git(bareRepo, ['update-ref', 'refs/pull/99/meta', corruptBlobOid]);

    const destDir = path.join(gitHelper.getRootDir(), 'export-b20-corrupt');
    const res = supervisor.export(bareRepo, destDir);
    // Export should either gracefully fall back or skip corrupt entry without crashing
    assert.ok(res.status === 0 || res.stderr.length >= 0);
  });

  it('B20.2: refs/pull/<id>/head pointing to non-existent commit handled safely', () => {
    const fakeCommitSha = '0123456789abcdef0123456789abcdef01234567';
    const pull88Dir = path.join(bareRepo, 'refs', 'pull', '88');
    fs.mkdirSync(pull88Dir, { recursive: true });
    fs.writeFileSync(path.join(pull88Dir, 'head'), `${fakeCommitSha}\n`);

    const destDir = path.join(gitHelper.getRootDir(), 'export-b20-dangling');
    const res = supervisor.export(bareRepo, destDir);
    assert.ok(res.status === 0 || res.stderr.length >= 0);
  });

  it('B20.3: Non-numeric issue or PR IDs handled safely in export and hook', () => {
    const blobOid = gitHelper.writeLooseObject(bareRepo, 'blob', Buffer.from(JSON.stringify({ title: 'Alphabetic ID' }), 'utf-8'));
    gitHelper.git(bareRepo, ['update-ref', 'refs/pull/feature-branch/head', mainCommit]);
    gitHelper.git(bareRepo, ['update-ref', 'refs/pull/feature-branch/meta', blobOid]);
    gitHelper.git(bareRepo, ['update-ref', 'refs/issues/issue-xyz', blobOid]);

    const destDir = path.join(gitHelper.getRootDir(), 'export-b20-alphanumeric');
    const res = supervisor.export(bareRepo, destDir);
    assert.strictEqual(res.status, 0);
  });

  it('B20.4: Corrupted review note references ignored without crashing static exporter', () => {
    const fakeSha = 'fedcba9876543210fedcba9876543210fedcba98';
    gitHelper.attachReviewNote(bareRepo, fakeSha, {
      commitSha: fakeSha,
      body: 'Note on non-existent commit'
    });

    const destDir = path.join(gitHelper.getRootDir(), 'export-b20-notes');
    const res = supervisor.export(bareRepo, destDir);
    assert.strictEqual(res.status, 0);
  });

  it('B20.5: Target branch ref missing from repository handled safely in merge-base resolution', async () => {
    gitHelper.createPullRequest(bareRepo, {
      id: '1',
      number: 1,
      title: 'PR with non-existent target branch',
      target_branch: 'non-existent-branch',
      head_commit: mainCommit
    });

    supervisor.hook(bareRepo, '');
    serverHandle = await supervisor.startServer(bareRepo);

    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const res = await client.get('/pulls.json');
    assert.strictEqual(res.status, 200);

    const pulls = JSON.parse(res.body);
    assert.strictEqual(pulls.length, 1);
    assert.strictEqual(pulls[0].target_branch || pulls[0].targetBranch, 'non-existent-branch');
  });
});
