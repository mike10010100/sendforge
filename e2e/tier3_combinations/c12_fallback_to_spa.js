/**
 * Tier 3 - Combination C12: Static HTML Fallback Parity with Client SPA (C12)
 * Tests parity between pre-rendered zero-JS static HTML fallbacks and dynamic
 * JSON-driven SPA views for Pull Requests and Issues.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';

describe('Tier 3 - Combination C12: Static HTML Fallback Parity with Client SPA (C12)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;
  let workDir;
  let destDir;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('c12-parity.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });
    workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-c12', 'main');

    const commitSha = gitHelper.commitFiles(workDir, { 'index.ts': 'console.log(1);' }, 'Init');
    gitHelper.push(workDir, 'origin', 'main');

    gitHelper.createPullRequest(bareRepo, {
      id: '1',
      number: 1,
      title: 'Parity Test PR',
      description: 'PR Description with **markdown** formatting.',
      author: { name: 'Alice Test', email: 'alice@sendforge.dev' },
      head_commit: commitSha,
      status: 'open',
      comments: [
        {
          id: 'c1',
          author: { name: 'Bob Reviewer', email: 'bob@sendforge.dev' },
          body: 'Review comment body',
          created_at: 1740001000
        }
      ]
    });

    gitHelper.createIssue(bareRepo, {
      id: '1',
      number: 1,
      title: 'Parity Test Issue',
      description: 'Issue Description with `code snippet`.',
      author: { name: 'Charlie QA', email: 'charlie@sendforge.dev' },
      status: 'open',
      comments: [
        {
          id: 'ic1',
          author: { name: 'Dave Support', email: 'dave@sendforge.dev' },
          body: 'Issue discussion note',
          created_at: 1740002000
        }
      ]
    });

    destDir = path.join(gitHelper.getRootDir(), 'export-parity');
    supervisor.export(bareRepo, destDir);
  });

  afterEach(() => {
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('C12.1: Pull Requests static fallback HTML matches pulls.json data payload', () => {
    const pullsJsonPath = fs.existsSync(path.join(destDir, 'pulls.json'))
      ? path.join(destDir, 'pulls.json')
      : path.join(destDir, 'static', 'pulls.json');
    const pullsHtmlPath = fs.existsSync(path.join(destDir, 'pulls.html'))
      ? path.join(destDir, 'pulls.html')
      : path.join(destDir, 'static', 'pulls.html');

    assert.ok(fs.existsSync(pullsJsonPath), 'pulls.json must exist');
    assert.ok(fs.existsSync(pullsHtmlPath), 'pulls.html must exist');

    const pulls = JSON.parse(fs.readFileSync(pullsJsonPath, 'utf-8'));
    const html = fs.readFileSync(pullsHtmlPath, 'utf-8');

    for (const pr of pulls) {
      assert.includes(html, pr.title);
      assert.includes(html, pr.author.name);
    }
  });

  it('C12.2: Issues static fallback HTML matches issues.json data payload', () => {
    const issuesJsonPath = fs.existsSync(path.join(destDir, 'issues.json'))
      ? path.join(destDir, 'issues.json')
      : path.join(destDir, 'static', 'issues.json');
    const issuesHtmlPath = fs.existsSync(path.join(destDir, 'issues.html'))
      ? path.join(destDir, 'issues.html')
      : path.join(destDir, 'static', 'issues.html');

    assert.ok(fs.existsSync(issuesJsonPath), 'issues.json must exist');
    assert.ok(fs.existsSync(issuesHtmlPath), 'issues.html must exist');

    const issues = JSON.parse(fs.readFileSync(issuesJsonPath, 'utf-8'));
    const html = fs.readFileSync(issuesHtmlPath, 'utf-8');

    for (const issue of issues) {
      assert.includes(html, issue.title);
      assert.includes(html, issue.author.name);
    }
  });
});
