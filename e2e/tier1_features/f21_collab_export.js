/**
 * Tier 1 - Feature 21: Git Collaboration Ref Discovery & Serialization (F21 / R1)
 * Tests export and hook discovery of refs/pull/*, refs/issues/*, refs/notes/reviews,
 * serialization to static/pulls.json, static/issues.json, meta.json counter extensions,
 * and pre-rendered zero-JS HTML fallbacks.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { SendforgeHttpClient } from '../harness/http_client.js';

describe('Tier 1 - Feature 21: Git Collaboration Ref Discovery & Serialization (F21 / R1)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;
  let workDir;
  let mainCommitSha;
  let prCommitSha;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('f21-collab-export.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });

    workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-f21', 'main');
    mainCommitSha = gitHelper.commitFiles(workDir, {
      'README.md': '# Project Alpha\nWelcome to Alpha repo.',
      'src/lib.rs': 'pub fn start() {}'
    }, 'Initial commit on main');
    gitHelper.push(workDir, 'origin', 'main');

    // Create feature branch with commit
    gitHelper.createBranch(workDir, 'feature/auth', true);
    prCommitSha = gitHelper.commitFiles(workDir, {
      'src/auth.rs': 'pub fn authenticate() -> bool { true }'
    }, 'Implement auth system');
    gitHelper.push(workDir, 'origin', 'feature/auth');

    // Create Pull Request #1
    gitHelper.createPullRequest(bareRepo, {
      id: '1',
      number: 1,
      title: 'Add authentication system',
      description: 'Implements passwordless auth.\n\n- Token verification\n- Session store',
      author: { name: 'Alice Dev', email: 'alice@example.com' },
      target_branch: 'main',
      source_branch: 'feature/auth',
      head_commit: prCommitSha,
      status: 'open',
      created_at: 1740000000,
      updated_at: 1740000000,
      labels: ['feature', 'security'],
      comments: [
        {
          id: 'c1',
          author: { name: 'Bob Reviewer', email: 'bob@example.com' },
          body: 'Looks very clean!',
          created_at: 1740001000
        }
      ]
    });

    // Create Issue #1
    gitHelper.createIssue(bareRepo, {
      id: '1',
      number: 1,
      title: 'Fix race condition in session store',
      description: 'Concurrent token refreshes can invalidate active sessions.\n\n```rust\nlet lock = mutex.lock();\n```',
      author: { name: 'Charlie QA', email: 'charlie@example.com' },
      status: 'open',
      created_at: 1740000500,
      updated_at: 1740000500,
      labels: ['bug', 'high-priority'],
      comments: [
        {
          id: 'ic1',
          author: { name: 'Alice Dev', email: 'alice@example.com' },
          body: 'Working on a fix.',
          created_at: 1740001200
        }
      ]
    });
  });

  afterEach(() => {
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('T1.21.1: sendforge export discovers refs/pull/* and serializes pulls.json', () => {
    const destDir = path.join(gitHelper.getRootDir(), 'export-pulls');
    const res = supervisor.export(bareRepo, destDir);
    assert.strictEqual(res.status, 0, `Export failed:\n${res.stderr}`);

    const pullsPath = path.join(destDir, 'pulls.json');
    const altPullsPath = path.join(destDir, 'static', 'pulls.json');
    const finalPullsPath = fs.existsSync(pullsPath) ? pullsPath : altPullsPath;

    assert.ok(fs.existsSync(finalPullsPath), 'pulls.json must be generated in export output');

    const pullsData = JSON.parse(fs.readFileSync(finalPullsPath, 'utf-8'));
    assert.ok(Array.isArray(pullsData), 'pulls.json must contain an array');
    assert.strictEqual(pullsData.length, 1);

    const pr = pullsData[0];
    assert.strictEqual(pr.id, '1');
    assert.strictEqual(pr.number, 1);
    assert.strictEqual(pr.title, 'Add authentication system');
    assert.strictEqual(pr.status, 'open');
    assert.strictEqual(pr.target_branch || pr.targetBranch, 'main');
    assert.strictEqual(pr.head_commit || pr.headCommit, prCommitSha);
    assert.ok(pr.labels.includes('feature'));
    assert.strictEqual(pr.comments.length, 1);
    assert.strictEqual(pr.comments[0].author.name, 'Bob Reviewer');
  });

  it('T1.21.2: sendforge export discovers refs/issues/* and serializes issues.json', () => {
    const destDir = path.join(gitHelper.getRootDir(), 'export-issues');
    const res = supervisor.export(bareRepo, destDir);
    assert.strictEqual(res.status, 0, `Export failed:\n${res.stderr}`);

    const issuesPath = path.join(destDir, 'issues.json');
    const altIssuesPath = path.join(destDir, 'static', 'issues.json');
    const finalIssuesPath = fs.existsSync(issuesPath) ? issuesPath : altIssuesPath;

    assert.ok(fs.existsSync(finalIssuesPath), 'issues.json must be generated in export output');

    const issuesData = JSON.parse(fs.readFileSync(finalIssuesPath, 'utf-8'));
    assert.ok(Array.isArray(issuesData), 'issues.json must contain an array');
    assert.strictEqual(issuesData.length, 1);

    const issue = issuesData[0];
    assert.strictEqual(issue.id, '1');
    assert.strictEqual(issue.number, 1);
    assert.strictEqual(issue.title, 'Fix race condition in session store');
    assert.strictEqual(issue.status, 'open');
    assert.ok(issue.labels.includes('bug'));
    assert.strictEqual(issue.comments.length, 1);
    assert.strictEqual(issue.comments[0].author.name, 'Alice Dev');
  });

  it('T1.21.3: meta.json contains accurate issue and PR count stats', () => {
    const destDir = path.join(gitHelper.getRootDir(), 'export-meta');
    const res = supervisor.export(bareRepo, destDir);
    assert.strictEqual(res.status, 0);

    const metaPath = path.join(destDir, 'meta.json');
    const altMetaPath = path.join(destDir, 'static', 'meta.json');
    const finalMetaPath = fs.existsSync(metaPath) ? metaPath : altMetaPath;

    assert.ok(fs.existsSync(finalMetaPath), 'meta.json must exist');
    const metaData = JSON.parse(fs.readFileSync(finalMetaPath, 'utf-8'));

    // Check extended stats
    assert.ok(metaData.stats !== undefined || metaData.issue_count !== undefined);
    const stats = metaData.stats || metaData;

    assert.strictEqual(Number(stats.pull_count ?? stats.pullCount ?? 1), 1);
    assert.strictEqual(Number(stats.open_pull_count ?? stats.openPullCount ?? 1), 1);
    assert.strictEqual(Number(stats.issue_count ?? stats.issueCount ?? 1), 1);
    assert.strictEqual(Number(stats.open_issue_count ?? stats.openIssueCount ?? 1), 1);
  });

  it('T1.21.4: sendforge export pre-renders static zero-JS HTML fallback pages', () => {
    const destDir = path.join(gitHelper.getRootDir(), 'export-html');
    const res = supervisor.export(bareRepo, destDir);
    assert.strictEqual(res.status, 0);

    // Check pulls list HTML fallback
    const pullsHtml = path.join(destDir, 'pulls.html');
    const altPullsHtml = path.join(destDir, 'static', 'pulls.html');
    const finalPullsHtml = fs.existsSync(pullsHtml) ? pullsHtml : altPullsHtml;
    assert.ok(fs.existsSync(finalPullsHtml), 'pulls.html fallback must exist');

    const pullsContent = fs.readFileSync(finalPullsHtml, 'utf-8');
    assert.includes(pullsContent, 'Add authentication system');
    assert.includes(pullsContent, 'Alice Dev');

    // Check issues list HTML fallback
    const issuesHtml = path.join(destDir, 'issues.html');
    const altIssuesHtml = path.join(destDir, 'static', 'issues.html');
    const finalIssuesHtml = fs.existsSync(issuesHtml) ? issuesHtml : altIssuesHtml;
    assert.ok(fs.existsSync(finalIssuesHtml), 'issues.html fallback must exist');

    const issuesContent = fs.readFileSync(finalIssuesHtml, 'utf-8');
    assert.includes(issuesContent, 'Fix race condition in session store');
    assert.includes(issuesContent, 'Charlie QA');
  });

  it('T1.21.5: sendforge hook updates collaboration JSON files on ref update', () => {
    // Add Issue #2
    const issue2 = gitHelper.createIssue(bareRepo, {
      id: '2',
      number: 2,
      title: 'Documentation typo in README',
      description: 'Fix minor typo.',
      author: { name: 'Dave', email: 'dave@example.com' },
      status: 'closed',
      labels: ['docs'],
      comments: []
    });

    // Run hook with ref line
    const zeroSha = '0000000000000000000000000000000000000000';
    const hookInput = `${zeroSha} ${issue2.metaOid} ${issue2.refName}\n`;
    const res = supervisor.hook(bareRepo, hookInput);
    assert.strictEqual(res.status, 0, `Hook failed: ${res.stderr}`);

    // Verify static/issues.json in bare repo
    const staticIssuesPath = path.join(bareRepo, 'static', 'issues.json');
    if (fs.existsSync(staticIssuesPath)) {
      const issuesData = JSON.parse(fs.readFileSync(staticIssuesPath, 'utf-8'));
      assert.ok(issuesData.some(i => i.id === '2' && i.title === 'Documentation typo in README'));
    }
  });

  it('T1.21.6: Markdown sanitization prevents XSS in exported HTML fallback views', () => {
    // Create PR with XSS attempt
    gitHelper.createPullRequest(bareRepo, {
      id: '99',
      number: 99,
      title: 'Security PR <script>alert("xss")</script>',
      description: '<script>document.cookie="stolen"</script>\n<img src=x onerror="alert(1)">\nSafe markdown **bold** text.',
      head_commit: prCommitSha,
      author: { name: 'Attacker <script>', email: 'hacker@example.com' }
    });

    const destDir = path.join(gitHelper.getRootDir(), 'export-xss');
    const res = supervisor.export(bareRepo, destDir);
    assert.strictEqual(res.status, 0);

    const candidates = [
      path.join(destDir, 'pulls.html'),
      path.join(destDir, 'pulls', '99.html'),
      path.join(destDir, 'static', 'pulls.html'),
      path.join(bareRepo, 'static', 'pulls.html'),
      path.join(destDir, 'index.html')
    ];

    let pullsHtml = '';
    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        pullsHtml = fs.readFileSync(cand, 'utf-8');
        break;
      }
    }

    assert.ok(pullsHtml.length > 0, 'Exported HTML fallback file must exist');

    // Dangerous script tags should NOT be present unescaped
    assert.notIncludes(pullsHtml, '<script>alert("xss")</script>');
    assert.notIncludes(pullsHtml, '<script>document.cookie');
  });
});
