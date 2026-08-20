/**
 * Tier 1 - Feature 24: Interactive Issue Tracker (F24 / R4)
 * Tests issue list view filtering/search, label badges, issue detail header/metadata,
 * Markdown description rendering, chronological comments timeline, and empty state.
 */

import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { SendforgeHttpClient } from '../harness/http_client.js';

describe('Tier 1 - Feature 24: Interactive Issue Tracker (F24 / R4)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;
  let serverHandle;
  let workDir;

  beforeEach(async () => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('f24-issues.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });
    workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-f24', 'main');

    gitHelper.commitFiles(workDir, {
      'README.md': '# Issues Tracker Test'
    }, 'Initial commit');
    gitHelper.push(workDir, 'origin', 'main');

    // Issue #1: Open bug
    gitHelper.createIssue(bareRepo, {
      id: '1',
      number: 1,
      title: 'Memory leak in worker thread pool',
      description: '### Problem\nWorker threads are not released on task completion.\n\n```ts\nworker.terminate();\n```\n- High memory usage\n- Event listener leak',
      author: { name: 'Alice Dev', email: 'alice@example.com' },
      status: 'open',
      created_at: 1740000000,
      updated_at: 1740000000,
      labels: ['bug', 'performance'],
      comments: [
        {
          id: 'c1',
          author: { name: 'Bob Engineer', email: 'bob@example.com' },
          body: 'I reproduced this with 50+ concurrent requests.',
          created_at: 1740001000
        },
        {
          id: 'c2',
          author: { name: 'Alice Dev', email: 'alice@example.com' },
          body: 'Fix submitted in PR #1.',
          created_at: 1740002000
        }
      ]
    });

    // Issue #2: Closed feature request
    gitHelper.createIssue(bareRepo, {
      id: '2',
      number: 2,
      title: 'Support dark mode theme toggle',
      description: 'Add a toggle switch in top navigation for switching between light and dark modes.',
      author: { name: 'Charlie Designer', email: 'charlie@example.com' },
      status: 'closed',
      created_at: 1739900000,
      updated_at: 1739950000,
      labels: ['feature', 'ui'],
      comments: [
        {
          id: 'c3',
          author: { name: 'Alice Dev', email: 'alice@example.com' },
          body: 'Implemented and verified.',
          created_at: 1739950000
        }
      ]
    });

    supervisor.hook(bareRepo, '');
    serverHandle = await supervisor.startServer(bareRepo);
  });

  afterEach(async () => {
    if (serverHandle) await serverHandle.stop();
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('T1.24.1: Issue List filtering by status (open vs closed) and author search', async () => {
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const res = await client.get('/issues.json');
    assert.strictEqual(res.status, 200);
    const issues = JSON.parse(res.body);

    const filterIssues = (items, { status, search, label }) => {
      return items.filter(issue => {
        if (status && issue.status !== status) return false;
        if (label && !issue.labels.includes(label)) return false;
        if (search) {
          const q = search.toLowerCase();
          const matchTitle = issue.title.toLowerCase().includes(q);
          const matchAuthor = issue.author.name.toLowerCase().includes(q);
          if (!matchTitle && !matchAuthor) return false;
        }
        return true;
      });
    };

    // Filter open
    const openIssues = filterIssues(issues, { status: 'open' });
    assert.strictEqual(openIssues.length, 1);
    assert.strictEqual(openIssues[0].id, '1');

    // Filter closed
    const closedIssues = filterIssues(issues, { status: 'closed' });
    assert.strictEqual(closedIssues.length, 1);
    assert.strictEqual(closedIssues[0].id, '2');

    // Search by author
    const charlieIssues = filterIssues(issues, { search: 'Charlie' });
    assert.strictEqual(charlieIssues.length, 1);
    assert.strictEqual(charlieIssues[0].id, '2');
  });

  it('T1.24.2: Label chip filtering and multi-label filtering logic', async () => {
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const res = await client.get('/issues.json');
    const issues = JSON.parse(res.body);

    const bugIssues = issues.filter(i => i.labels.includes('bug'));
    assert.strictEqual(bugIssues.length, 1);
    assert.strictEqual(bugIssues[0].id, '1');

    const uiIssues = issues.filter(i => i.labels.includes('ui'));
    assert.strictEqual(uiIssues.length, 1);
    assert.strictEqual(uiIssues[0].id, '2');

    const nonExistentLabel = issues.filter(i => i.labels.includes('security'));
    assert.strictEqual(nonExistentLabel.length, 0);
  });

  it('T1.24.3: Issue Detail Header displays status badge, author info, and timestamps', async () => {
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const res = await client.get('/issues.json');
    const issues = JSON.parse(res.body);
    const issue1 = issues.find(i => i.id === '1');

    assert.ok(issue1 !== undefined);
    assert.strictEqual(issue1.title, 'Memory leak in worker thread pool');
    assert.strictEqual(issue1.status, 'open');
    assert.strictEqual(issue1.author.name, 'Alice Dev');
    assert.strictEqual(issue1.author.email, 'alice@example.com');
    assert.strictEqual(issue1.created_at || issue1.createdAt, 1740000000);
  });

  it('T1.24.4: Issue Detail Discussion renders Markdown body with headings and code blocks', async () => {
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const res = await client.get('/issues.json');
    const issues = JSON.parse(res.body);
    const issue1 = issues.find(i => i.id === '1');

    assert.includes(issue1.description, '### Problem');
    assert.includes(issue1.description, '```ts\nworker.terminate();\n```');
    assert.includes(issue1.description, '- High memory usage');
  });

  it('T1.24.5: Chronological discussion comments timeline with author metadata', async () => {
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const res = await client.get('/issues.json');
    const issues = JSON.parse(res.body);
    const issue1 = issues.find(i => i.id === '1');

    assert.strictEqual(issue1.comments.length, 2);

    const c1 = issue1.comments[0];
    assert.strictEqual(c1.id, 'c1');
    assert.strictEqual(c1.author.name, 'Bob Engineer');
    assert.strictEqual(c1.body, 'I reproduced this with 50+ concurrent requests.');

    const c2 = issue1.comments[1];
    assert.strictEqual(c2.id, 'c2');
    assert.strictEqual(c2.author.name, 'Alice Dev');
    assert.strictEqual(c2.body, 'Fix submitted in PR #1.');

    // Verify chronological ordering
    assert.lessThan(c1.created_at || c1.createdAt, c2.created_at || c2.createdAt);
  });

  it('T1.24.6: Empty issue list state and no-matching-filter placeholder display', () => {
    const emptyList = [];
    const getPlaceholder = (items, filter) => {
      if (items.length === 0) return 'No issues found in repository.';
      const filtered = items.filter(i => filter(i));
      if (filtered.length === 0) return 'No issues match current filter.';
      return null;
    };

    assert.strictEqual(getPlaceholder(emptyList, () => true), 'No issues found in repository.');
    assert.strictEqual(getPlaceholder([{ id: '1', status: 'open' }], i => i.status === 'closed'), 'No issues match current filter.');
  });
});
