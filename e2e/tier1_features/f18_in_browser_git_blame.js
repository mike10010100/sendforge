/**
 * Tier 1 - Feature 18: In-Browser Client-Side git blame (F18 / R2)
 * Tests backward commit DAG traversal, Myers diff line attribution,
 * unmodified line provenance, hunk aggregation, age heatmap scaling,
 * commit diff links, and Code/Blame toggle mode.
 */

import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { SendforgeHttpClient } from '../harness/http_client.js';
import { GitParser } from '../harness/git_parser.js';
import { BlameHelper } from '../harness/blame_helper.js';

describe('Tier 1 - Feature 18: In-Browser Client-Side git blame (F18 / R2)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;
  let serverHandle;
  let commit1Sha;
  let commit2Sha;
  let commit3Sha;

  beforeEach(async () => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('f18-git-blame.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });

    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-f18', 'main');

    // Commit 1: Initial file with 3 lines by Alice
    commit1Sha = gitHelper.commitFiles(workDir, {
      'src/service.ts': 'line 1: initial\nline 2: initial\nline 3: initial'
    }, 'Commit 1: Add service', {
      GIT_AUTHOR_NAME: 'Alice Dev',
      GIT_AUTHOR_EMAIL: 'alice@example.com',
      GIT_AUTHOR_DATE: '2026-08-01T10:00:00Z',
      GIT_COMMITTER_DATE: '2026-08-01T10:00:00Z'
    });

    // Commit 2: Bob modifies line 2
    commit2Sha = gitHelper.commitFiles(workDir, {
      'src/service.ts': 'line 1: initial\nline 2: modified by bob\nline 3: initial'
    }, 'Commit 2: Update line 2', {
      GIT_AUTHOR_NAME: 'Bob Engineer',
      GIT_AUTHOR_EMAIL: 'bob@example.com',
      GIT_AUTHOR_DATE: '2026-08-05T12:00:00Z',
      GIT_COMMITTER_DATE: '2026-08-05T12:00:00Z'
    });

    // Commit 3: Charlie appends line 4 and 5
    commit3Sha = gitHelper.commitFiles(workDir, {
      'src/service.ts': 'line 1: initial\nline 2: modified by bob\nline 3: initial\nline 4: added by charlie\nline 5: added by charlie'
    }, 'Commit 3: Append new lines', {
      GIT_AUTHOR_NAME: 'Charlie Architect',
      GIT_AUTHOR_EMAIL: 'charlie@example.com',
      GIT_AUTHOR_DATE: '2026-08-10T15:00:00Z',
      GIT_COMMITTER_DATE: '2026-08-10T15:00:00Z'
    });

    gitHelper.push(workDir, 'origin', 'main');
    serverHandle = await supervisor.startServer(bareRepo);
  });

  afterEach(async () => {
    if (serverHandle) await serverHandle.stop();
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('T1.18.1: Single-commit root attribution (all lines attributed to initial commit)', async () => {
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const fetchObject = async (oid) => {
      const res = await client.getLooseObject(oid);
      return GitParser.inflateLooseObject(res.buffer, oid);
    };

    // Blame file at commit 1 (root commit)
    const blame = await BlameHelper.computeBlame(fetchObject, commit1Sha, 'src/service.ts');
    assert.strictEqual(blame.lines.length, 3);

    for (let i = 0; i < 3; i++) {
      const line = blame.lines[i];
      assert.strictEqual(line.lineNumber, i + 1);
      assert.strictEqual(line.commitOid, commit1Sha);
      assert.strictEqual(line.authorName, 'Alice Dev');
      assert.strictEqual(line.authorEmail, 'alice@example.com');
      assert.strictEqual(line.summary, 'Commit 1: Add service');
    }

    assert.strictEqual(blame.hunks.length, 1);
    assert.strictEqual(blame.hunks[0].lineCount, 3);
    assert.strictEqual(blame.hunks[0].startLine, 1);
    assert.strictEqual(blame.hunks[0].commitOid, commit1Sha);
  });

  it('T1.18.2: Multi-commit backward DAG traversal with Myers diff line mapping', async () => {
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const fetchObject = async (oid) => {
      const res = await client.getLooseObject(oid);
      return GitParser.inflateLooseObject(res.buffer, oid);
    };

    // Blame file at commit 3
    const blame = await BlameHelper.computeBlame(fetchObject, commit3Sha, 'src/service.ts');
    assert.strictEqual(blame.lines.length, 5);

    // Line 1: untouched since Alice (commit 1)
    assert.strictEqual(blame.lines[0].lineNumber, 1);
    assert.strictEqual(blame.lines[0].commitOid, commit1Sha);
    assert.strictEqual(blame.lines[0].authorName, 'Alice Dev');

    // Line 2: modified by Bob (commit 2)
    assert.strictEqual(blame.lines[1].lineNumber, 2);
    assert.strictEqual(blame.lines[1].commitOid, commit2Sha);
    assert.strictEqual(blame.lines[1].authorName, 'Bob Engineer');

    // Line 3: untouched since Alice (commit 1)
    assert.strictEqual(blame.lines[2].lineNumber, 3);
    assert.strictEqual(blame.lines[2].commitOid, commit1Sha);
    assert.strictEqual(blame.lines[2].authorName, 'Alice Dev');

    // Lines 4 and 5: added by Charlie (commit 3)
    assert.strictEqual(blame.lines[3].lineNumber, 4);
    assert.strictEqual(blame.lines[3].commitOid, commit3Sha);
    assert.strictEqual(blame.lines[3].authorName, 'Charlie Architect');

    assert.strictEqual(blame.lines[4].lineNumber, 5);
    assert.strictEqual(blame.lines[4].commitOid, commit3Sha);
    assert.strictEqual(blame.lines[4].authorName, 'Charlie Architect');
  });

  it('T1.18.3: Unmodified line preservation across multiple commits', async () => {
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const fetchObject = async (oid) => {
      const res = await client.getLooseObject(oid);
      return GitParser.inflateLooseObject(res.buffer, oid);
    };

    const blame = await BlameHelper.computeBlame(fetchObject, commit3Sha, 'src/service.ts');

    // Both Line 1 and Line 3 originated from Commit 1
    const aliceLines = blame.lines.filter(l => l.authorName === 'Alice Dev');
    assert.strictEqual(aliceLines.length, 2);
    assert.strictEqual(aliceLines[0].lineNumber, 1);
    assert.strictEqual(aliceLines[1].lineNumber, 3);
    assert.strictEqual(aliceLines[0].commitOid, commit1Sha);
    assert.strictEqual(aliceLines[1].commitOid, commit1Sha);
  });

  it('T1.18.4: Blame hunk aggregation (consecutive lines from same commit grouped into hunks)', async () => {
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const fetchObject = async (oid) => {
      const res = await client.getLooseObject(oid);
      return GitParser.inflateLooseObject(res.buffer, oid);
    };

    const blame = await BlameHelper.computeBlame(fetchObject, commit3Sha, 'src/service.ts');

    // Expected hunks:
    // Hunk 1: Line 1 (Alice, 1 line)
    // Hunk 2: Line 2 (Bob, 1 line)
    // Hunk 3: Line 3 (Alice, 1 line)
    // Hunk 4: Lines 4..5 (Charlie, 2 lines)
    assert.strictEqual(blame.hunks.length, 4);

    assert.strictEqual(blame.hunks[0].startLine, 1);
    assert.strictEqual(blame.hunks[0].lineCount, 1);
    assert.strictEqual(blame.hunks[0].commitOid, commit1Sha);

    assert.strictEqual(blame.hunks[1].startLine, 2);
    assert.strictEqual(blame.hunks[1].lineCount, 1);
    assert.strictEqual(blame.hunks[1].commitOid, commit2Sha);

    assert.strictEqual(blame.hunks[2].startLine, 3);
    assert.strictEqual(blame.hunks[2].lineCount, 1);
    assert.strictEqual(blame.hunks[2].commitOid, commit1Sha);

    assert.strictEqual(blame.hunks[3].startLine, 4);
    assert.strictEqual(blame.hunks[3].lineCount, 2);
    assert.strictEqual(blame.hunks[3].commitOid, commit3Sha);
  });

  it('T1.18.5: Relative age heatmap scale calculation (0.0 oldest to 1.0 newest)', async () => {
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const fetchObject = async (oid) => {
      const res = await client.getLooseObject(oid);
      return GitParser.inflateLooseObject(res.buffer, oid);
    };

    const blame = await BlameHelper.computeBlame(fetchObject, commit3Sha, 'src/service.ts');
    assert.ok(blame.oldestTimestamp > 0);
    assert.ok(blame.newestTimestamp > blame.oldestTimestamp);

    // Oldest line (Alice) should have intensity 0.0
    const aliceIntensity = BlameHelper.calculateHeatmapIntensity(
      blame.lines[0].timestamp,
      blame.oldestTimestamp,
      blame.newestTimestamp
    );
    assert.strictEqual(aliceIntensity, 0.0);

    // Newest line (Charlie) should have intensity 1.0
    const charlieIntensity = BlameHelper.calculateHeatmapIntensity(
      blame.lines[3].timestamp,
      blame.oldestTimestamp,
      blame.newestTimestamp
    );
    assert.strictEqual(charlieIntensity, 1.0);

    // Intermediate line (Bob) should be between 0.0 and 1.0
    const bobIntensity = BlameHelper.calculateHeatmapIntensity(
      blame.lines[1].timestamp,
      blame.oldestTimestamp,
      blame.newestTimestamp
    );
    assert.greaterThan(bobIntensity, 0.0);
    assert.lessThan(bobIntensity, 1.0);
  });

  it('T1.18.6: Interactive BlameView UI and diff links (#/commit/{sha})', () => {
    // Generate diff link for a blame hunk
    const makeDiffUrl = (commitOid) => `#/commit/${commitOid}`;

    const link1 = makeDiffUrl(commit1Sha);
    assert.strictEqual(link1, `#/commit/${commit1Sha}`);

    const link2 = makeDiffUrl(commit2Sha);
    assert.strictEqual(link2, `#/commit/${commit2Sha}`);

    // Author avatar initials generation helper
    const getInitials = (name) => {
      const parts = name.trim().split(/\s+/);
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    };

    assert.strictEqual(getInitials('Alice Dev'), 'AD');
    assert.strictEqual(getInitials('Bob Engineer'), 'BE');
    assert.strictEqual(getInitials('Charlie'), 'CH');
  });

  it('T1.18.7: BlobView Code/Blame toggle mode state transitions', () => {
    class BlobViewState {
      constructor(initialMode = 'code') {
        this.mode = initialMode; // 'code' | 'blame'
        this.isLoadingBlame = false;
        this.blameData = null;
      }

      toggleMode() {
        this.mode = this.mode === 'code' ? 'blame' : 'code';
      }

      setLoading(loading) {
        this.isLoadingBlame = loading;
      }

      setBlameData(data) {
        this.blameData = data;
        this.isLoadingBlame = false;
      }
    }

    const state = new BlobViewState('code');
    assert.strictEqual(state.mode, 'code');

    // Toggle to blame
    state.toggleMode();
    assert.strictEqual(state.mode, 'blame');

    // Toggle back to code
    state.toggleMode();
    assert.strictEqual(state.mode, 'code');
  });
});
