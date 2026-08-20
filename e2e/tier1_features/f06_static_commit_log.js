/**
 * Tier 1 - Feature 6: Static Commit Log Fallback (`log.html`)
 * Tests pre-rendering of recent commit history table in static/log.html
 * for zero-JS clients and search engine crawlers.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { HtmlValidator } from '../harness/html_validator.js';

describe('Tier 1 - Feature 6: Static Commit Log Fallback (F6)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('log-test.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });
  });

  afterEach(() => {
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('T1.6.1: static/log.html renders table with commit hashes, authors, and messages', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work1', 'main');
    const c1 = gitHelper.commitFiles(workDir, { 'a.txt': '1' }, 'Initial feat A');
    const c2 = gitHelper.commitFiles(workDir, { 'b.txt': '2' }, 'Second feat B');
    gitHelper.push(workDir, 'origin', 'main');

    const logPath = path.join(bareRepo, 'static', 'log.html');
    assert.ok(fs.existsSync(logPath), 'static/log.html must exist');

    const html = fs.readFileSync(logPath, 'utf-8');
    const validator = new HtmlValidator(html);
    validator.assertValidDocument();
    validator.assertCommitLogContains(['Initial feat A', 'Second feat B']);
    assert.includes(html, c1.slice(0, 7), 'Must display short sha for c1');
    assert.includes(html, c2.slice(0, 7), 'Must display short sha for c2');
  });

  it('T1.6.2: Commits are listed in reverse chronological order', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work2', 'main');
    gitHelper.commitFiles(workDir, { 'f1.txt': '1' }, 'Commit ALPHA_FIRST');
    gitHelper.commitFiles(workDir, { 'f2.txt': '2' }, 'Commit BETA_SECOND');
    gitHelper.commitFiles(workDir, { 'f3.txt': '3' }, 'Commit GAMMA_THIRD');
    gitHelper.push(workDir, 'origin', 'main');

    const html = fs.readFileSync(path.join(bareRepo, 'static', 'log.html'), 'utf-8');
    const idxAlpha = html.indexOf('ALPHA_FIRST');
    const idxBeta = html.indexOf('BETA_SECOND');
    const idxGamma = html.indexOf('GAMMA_THIRD');

    // GAMMA should appear before BETA, which appears before ALPHA
    assert.ok(idxGamma < idxBeta, 'Latest commit (GAMMA) should appear before BETA');
    assert.ok(idxBeta < idxAlpha, 'Middle commit (BETA) should appear before ALPHA');
  });

  it('T1.6.3: Multi-line commit message subject extraction', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work3', 'main');
    const multiLineMsg = 'Feat: Add complex subsystem\n\nDetailed paragraph explaining architecture and reasons.';
    gitHelper.commitFiles(workDir, { 'subsystem.rs': '// code' }, multiLineMsg);
    gitHelper.push(workDir, 'origin', 'main');

    const html = fs.readFileSync(path.join(bareRepo, 'static', 'log.html'), 'utf-8');
    assert.includes(html, 'Feat: Add complex subsystem');
  });

  it('T1.6.4: Author name and email HTML escaping prevents injection', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work4', 'main');
    gitHelper.commitFiles(workDir, { 'test.txt': 'test' }, 'Malicious author commit', {
      GIT_AUTHOR_NAME: '<script>alert("author")</script>',
      GIT_AUTHOR_EMAIL: 'evil<img src=x onerror=1>@example.com'
    });
    gitHelper.push(workDir, 'origin', 'main');

    const html = fs.readFileSync(path.join(bareRepo, 'static', 'log.html'), 'utf-8');
    const validator = new HtmlValidator(html);
    validator.assertNoXss();
  });

  it('T1.6.5: Empty repository log.html contains clean empty state', () => {
    const emptyRepo = path.join(gitHelper.getRootDir(), 'empty-log.git');
    supervisor.init(emptyRepo, { bare: true });
    supervisor.hook(emptyRepo, '');

    const logPath = path.join(emptyRepo, 'static', 'log.html');
    if (fs.existsSync(logPath)) {
      const html = fs.readFileSync(logPath, 'utf-8');
      const validator = new HtmlValidator(html);
      validator.assertValidDocument();
    }
  });
});
