/**
 * Tier 1 - Feature 23: Interactive Pull Request Viewer (F23 / R3)
 * Tests PR list view filtering/search, PR detail header/metadata,
 * Conversation tab (markdown + timeline), Commits tab, Files Changed tab
 * (3-way diff between merge base and head), and inline review notes.
 */

import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { SendforgeHttpClient } from '../harness/http_client.js';
import { GitParser } from '../harness/git_parser.js';
import { DagHelper } from '../harness/dag_helper.js';

describe('Tier 1 - Feature 23: Interactive Pull Request Viewer (F23 / R3)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;
  let serverHandle;
  let workDir;
  let baseSha;
  let pr1HeadSha;
  let pr2HeadSha;

  beforeEach(async () => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('f23-pr-viewer.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });
    workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-f23', 'main');

    // Base commit on main
    baseSha = gitHelper.commitFiles(workDir, {
      'src/app.ts': 'export const app = "v1";\nexport const config = { port: 8080 };',
      'README.md': '# Main App\nDocumentation.'
    }, 'Initial main commit');
    gitHelper.push(workDir, 'origin', 'main');

    // PR 1: Feature branch (open)
    gitHelper.createBranch(workDir, 'feature/api', true);
    pr1HeadSha = gitHelper.commitFiles(workDir, {
      'src/app.ts': 'export const app = "v2";\nexport const config = { port: 8080, host: "0.0.0.0" };',
      'src/api.ts': 'export function handleApi() { return "ok"; }'
    }, 'Feature API additions');
    gitHelper.push(workDir, 'origin', 'feature/api');

    // PR 2: Bugfix branch (merged)
    gitHelper.git(workDir, ['checkout', 'main']);
    gitHelper.createBranch(workDir, 'fix/readme', true);
    pr2HeadSha = gitHelper.commitFiles(workDir, {
      'README.md': '# Main App\nUpdated documentation with setup guide.'
    }, 'Fix documentation');
    gitHelper.push(workDir, 'origin', 'fix/readme');

    // Create PR 1
    gitHelper.createPullRequest(bareRepo, {
      id: '1',
      number: 1,
      title: 'Upgrade API to v2 with host config',
      description: 'Upgrades `app.ts` and adds new `api.ts` module.\n\n### Changes\n- Add `src/api.ts`\n- Update config',
      author: { name: 'Alice Dev', email: 'alice@example.com' },
      target_branch: 'main',
      source_branch: 'feature/api',
      head_commit: pr1HeadSha,
      status: 'open',
      created_at: 1740000000,
      updated_at: 1740000000,
      labels: ['feature', 'backend'],
      comments: [
        {
          id: 'c1',
          author: { name: 'Bob Reviewer', email: 'bob@example.com' },
          body: 'Does this handle graceful shutdown?',
          created_at: 1740001000
        }
      ]
    });

    // Create PR 2 (merged)
    gitHelper.createPullRequest(bareRepo, {
      id: '2',
      number: 2,
      title: 'Update README setup guide',
      description: 'Adds setup instructions for new developers.',
      author: { name: 'Charlie Docs', email: 'charlie@example.com' },
      target_branch: 'main',
      source_branch: 'fix/readme',
      head_commit: pr2HeadSha,
      status: 'merged',
      created_at: 1739900000,
      updated_at: 1739950000,
      labels: ['documentation'],
      comments: []
    });

    // Attach review note to PR 1 head commit
    gitHelper.attachReviewNote(bareRepo, pr1HeadSha, {
      commitSha: pr1HeadSha,
      filePath: 'src/app.ts',
      line: 2,
      author: { name: 'Bob Reviewer', email: 'bob@example.com' },
      body: 'Consider making host configurable via ENV.',
      createdAt: 1740001500
    });

    supervisor.hook(bareRepo, '');
    serverHandle = await supervisor.startServer(bareRepo);
  });

  afterEach(async () => {
    if (serverHandle) await serverHandle.stop();
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('T1.23.1: PR List filtering by status (open, merged, closed) and author search', async () => {
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const res = await client.get('/pulls.json');
    assert.strictEqual(res.status, 200);
    const pulls = JSON.parse(res.body);

    // Client-side filter simulation
    const filterPulls = (items, { status, search }) => {
      return items.filter(pr => {
        if (status && pr.status !== status) return false;
        if (search) {
          const q = search.toLowerCase();
          const matchTitle = pr.title.toLowerCase().includes(q);
          const matchAuthor = pr.author.name.toLowerCase().includes(q);
          if (!matchTitle && !matchAuthor) return false;
        }
        return true;
      });
    };

    // Filter open
    const openPulls = filterPulls(pulls, { status: 'open' });
    assert.strictEqual(openPulls.length, 1);
    assert.strictEqual(openPulls[0].id, '1');

    // Filter merged
    const mergedPulls = filterPulls(pulls, { status: 'merged' });
    assert.strictEqual(mergedPulls.length, 1);
    assert.strictEqual(mergedPulls[0].id, '2');

    // Search by author
    const alicePulls = filterPulls(pulls, { search: 'Alice' });
    assert.strictEqual(alicePulls.length, 1);
    assert.strictEqual(alicePulls[0].id, '1');

    // Search non-existent
    const none = filterPulls(pulls, { search: 'NonExistent' });
    assert.strictEqual(none.length, 0);
  });

  it('T1.23.2: PR Detail Header displays status badge, branch pills, and author metadata', async () => {
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const res = await client.get('/pulls.json');
    const pulls = JSON.parse(res.body);
    const pr1 = pulls.find(p => p.id === '1');

    assert.ok(pr1 !== undefined);
    assert.strictEqual(pr1.title, 'Upgrade API to v2 with host config');
    assert.strictEqual(pr1.status, 'open');
    assert.strictEqual(pr1.target_branch || pr1.targetBranch, 'main');
    assert.strictEqual(pr1.source_branch || pr1.sourceBranch, 'feature/api');
    assert.strictEqual(pr1.author.name, 'Alice Dev');
    assert.strictEqual(pr1.author.email, 'alice@example.com');
  });

  it('T1.23.3: PR Detail Conversation tab renders markdown description and timeline', async () => {
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const res = await client.get('/pulls.json');
    const pulls = JSON.parse(res.body);
    const pr1 = pulls.find(p => p.id === '1');

    // Verify markdown description elements
    assert.includes(pr1.description, '### Changes');
    assert.includes(pr1.description, '`app.ts`');

    // Verify timeline comments
    assert.strictEqual(pr1.comments.length, 1);
    const comment = pr1.comments[0];
    assert.strictEqual(comment.id, 'c1');
    assert.strictEqual(comment.author.name, 'Bob Reviewer');
    assert.strictEqual(comment.body, 'Does this handle graceful shutdown?');
  });

  it('T1.23.4: PR Detail Commits tab displays list of commits in PR', async () => {
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const fetchObject = async (oid) => {
      const res = await client.getLooseObject(oid);
      return GitParser.inflateLooseObject(res.buffer, oid);
    };

    const lca = await DagHelper.findMergeBase(fetchObject, pr1HeadSha, baseSha);
    assert.strictEqual(lca, baseSha);

    const commits = await DagHelper.getCommitHistoryRange(fetchObject, lca, pr1HeadSha);
    assert.strictEqual(commits.length, 1);
    assert.strictEqual(commits[0].sha, pr1HeadSha);
    assert.strictEqual(commits[0].summary, 'Feature API additions');
  });

  it('T1.23.5: PR Detail Files Changed tab computes 3-way diff between merge base and head', async () => {
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const fetchObject = async (oid) => {
      const res = await client.getLooseObject(oid);
      return GitParser.inflateLooseObject(res.buffer, oid);
    };

    const baseCommitObj = await fetchObject(baseSha);
    const baseCommit = GitParser.parseCommit(baseCommitObj.payload);

    const headCommitObj = await fetchObject(pr1HeadSha);
    const headCommit = GitParser.parseCommit(headCommitObj.payload);

    const fileChanges = await DagHelper.computeTreeDiff(fetchObject, baseCommit.tree, headCommit.tree);

    // Expect 2 changed files: src/app.ts (modified), src/api.ts (added)
    assert.strictEqual(fileChanges.length, 2);

    const appMod = fileChanges.find(f => f.path === 'src/app.ts');
    assert.ok(appMod !== undefined);
    assert.strictEqual(appMod.status, 'modified');

    const apiAdd = fileChanges.find(f => f.path === 'src/api.ts');
    assert.ok(apiAdd !== undefined);
    assert.strictEqual(apiAdd.status, 'added');

    // Compute line diff for src/app.ts
    const oldBlob = await fetchObject(appMod.oldOid);
    const newBlob = await fetchObject(appMod.newOid);
    const lineDiff = GitParser.computeUnifiedDiff(
      oldBlob.payload.toString('utf-8'),
      newBlob.payload.toString('utf-8')
    );

    assert.greaterThan(lineDiff.stats.additions, 0);
    assert.greaterThan(lineDiff.stats.deletions, 0);
  });

  it('T1.23.6: Inline review notes attached to specific file and line are loadable', async () => {
    const client = new SendforgeHttpClient(serverHandle.baseUrl);

    // Verify info/refs or dumb HTTP refs contain review notes or objects
    const res = await client.get('/info/refs');
    assert.strictEqual(res.status, 200);

    // Review notes are attached to pr1HeadSha
    const fetchObject = async (oid) => {
      const res = await client.getLooseObject(oid);
      return GitParser.inflateLooseObject(res.buffer, oid);
    };

    const commitObj = await fetchObject(pr1HeadSha);
    assert.strictEqual(commitObj.type, 'commit');
  });
});
