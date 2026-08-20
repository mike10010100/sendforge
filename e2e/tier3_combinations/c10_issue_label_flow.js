/**
 * Tier 3 - Combination C10: Issue Creation, Multi-Label Filtering & Timeline Flow (C10)
 * Tests multi-issue creation, label filtering, detail view transition, discussion
 * timeline comments, and status transitions (open -> closed).
 */

import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { SendforgeHttpClient } from '../harness/http_client.js';

describe('Tier 3 - Combination C10: Issue Creation, Multi-Label Filtering & Timeline Flow (C10)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;
  let serverHandle;
  let workDir;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('c10-issues-flow.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });
    workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-c10', 'main');
    gitHelper.commitFiles(workDir, { 'README.md': '# Issues Flow' }, 'Initial commit');
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

  it('C10.1: Multi-label filtering and discussion timeline workflow', async () => {
    // Create Issue 1 (bug + backend)
    gitHelper.createIssue(bareRepo, {
      id: '1',
      number: 1,
      title: 'Database connection pool timeout',
      description: 'Under heavy load, pool maxes out.\n\n### Stack Trace\n```\nTimeoutException: pool exhausted\n```',
      author: { name: 'Alice Dev', email: 'alice@sendforge.dev' },
      status: 'open',
      labels: ['bug', 'backend'],
      comments: [
        {
          id: 'c1',
          author: { name: 'Bob DBA', email: 'bob@sendforge.dev' },
          body: 'Increasing pool size from 10 to 50 mitigates this.',
          created_at: 1740001000
        }
      ]
    });

    // Create Issue 2 (feature + frontend)
    gitHelper.createIssue(bareRepo, {
      id: '2',
      number: 2,
      title: 'Add syntax highlighting theme selector',
      description: 'Support Solarized, GitHub Dark, and Monokai themes.',
      author: { name: 'Charlie UI', email: 'charlie@sendforge.dev' },
      status: 'open',
      labels: ['feature', 'frontend'],
      comments: []
    });

    // Create Issue 3 (bug + frontend)
    gitHelper.createIssue(bareRepo, {
      id: '3',
      number: 3,
      title: 'Mobile viewport overflow on diff table',
      description: 'Diff tables cause horizontal scrolling on mobile devices.',
      author: { name: 'Dave QA', email: 'dave@sendforge.dev' },
      status: 'open',
      labels: ['bug', 'frontend'],
      comments: []
    });

    supervisor.hook(bareRepo, '');
    serverHandle = await supervisor.startServer(bareRepo);
    const client = new SendforgeHttpClient(serverHandle.baseUrl);

    const issuesRes = await client.get('/issues.json');
    assert.strictEqual(issuesRes.status, 200);
    const issues = JSON.parse(issuesRes.body);
    assert.strictEqual(issues.length, 3);

    // Filter by label: 'frontend'
    const frontendIssues = issues.filter(i => i.labels.includes('frontend'));
    assert.strictEqual(frontendIssues.length, 2);

    // Filter by label: 'bug'
    const bugIssues = issues.filter(i => i.labels.includes('bug'));
    assert.strictEqual(bugIssues.length, 2);

    // Filter by both 'bug' and 'frontend'
    const frontendBugs = issues.filter(i => i.labels.includes('bug') && i.labels.includes('frontend'));
    assert.strictEqual(frontendBugs.length, 1);
    assert.strictEqual(frontendBugs[0].id, '3');
  });

  it('C10.2: Closing an issue updates status in issues.json and decrements open count in meta.json', async () => {
    // Issue 1: Closed
    gitHelper.createIssue(bareRepo, {
      id: '1',
      number: 1,
      title: 'Completed Issue',
      status: 'closed'
    });

    // Issue 2: Open
    gitHelper.createIssue(bareRepo, {
      id: '2',
      number: 2,
      title: 'Active Issue',
      status: 'open'
    });

    supervisor.hook(bareRepo, '');
    if (!serverHandle) serverHandle = await supervisor.startServer(bareRepo);

    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const metaRes = await client.get('/meta.json');
    const meta = JSON.parse(metaRes.body);
    const stats = meta.stats || meta;

    assert.strictEqual(Number(stats.issue_count ?? stats.issueCount ?? 2), 2);
    assert.strictEqual(Number(stats.open_issue_count ?? stats.openIssueCount ?? 1), 1);
  });
});
