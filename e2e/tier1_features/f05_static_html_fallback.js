/**
 * Tier 1 - Feature 5: Static HTML Fallback Generator (`index.html`)
 * Tests generation of zero-JS pre-rendered HTML fallback pages containing
 * the repository root file tree, rendered README, and semantic landmarks.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { HtmlValidator } from '../harness/html_validator.js';

describe('Tier 1 - Feature 5: Static HTML Fallback Generator (F5)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('fallback-test.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });
  });

  afterEach(() => {
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('T1.5.1: static/index.html is generated containing root directory file tree', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work1', 'main');
    gitHelper.commitFiles(workDir, {
      'README.md': '# Static Fallback Test',
      'src/main.rs': 'fn main() {}',
      'Cargo.toml': '[package]\nname = "test"'
    }, 'Add files');
    gitHelper.push(workDir, 'origin', 'main');

    const indexPath = path.join(bareRepo, 'static', 'index.html');
    assert.ok(fs.existsSync(indexPath), 'static/index.html must exist');

    const html = fs.readFileSync(indexPath, 'utf-8');
    const validator = new HtmlValidator(html);
    validator.assertValidDocument();
    validator.assertFileTreeContains(['README.md', 'src', 'Cargo.toml']);
  });

  it('T1.5.2: Pre-rendered CommonMark README section present in index.html', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work2', 'main');
    const readmeContent = '# Welcome to Sendforge\n\nThis is a **high-performance** static Git forge.';
    gitHelper.commitFiles(workDir, { 'README.md': readmeContent }, 'Add readme');
    gitHelper.push(workDir, 'origin', 'main');

    const html = fs.readFileSync(path.join(bareRepo, 'static', 'index.html'), 'utf-8');
    const validator = new HtmlValidator(html);
    validator.assertReadmeRendered(['Welcome to Sendforge', 'high-performance']);
  });

  it('T1.5.3: Missing README fallback renders file tree cleanly without broken elements', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work3', 'main');
    gitHelper.commitFiles(workDir, {
      'lib.rs': 'pub fn test() {}',
      'util.rs': 'pub fn util() {}'
    }, 'No readme commit');
    gitHelper.push(workDir, 'origin', 'main');

    const html = fs.readFileSync(path.join(bareRepo, 'static', 'index.html'), 'utf-8');
    const validator = new HtmlValidator(html);
    validator.assertValidDocument();
    validator.assertFileTreeContains(['lib.rs', 'util.rs']);
  });

  it('T1.5.4: XSS payload in README.md is properly sanitized or escaped in static HTML', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work4', 'main');
    const dangerousReadme = '# XSS Test\n\n<script>alert("xss")</script>\n<img src="x" onerror="alert(1)">';
    gitHelper.commitFiles(workDir, { 'README.md': dangerousReadme }, 'XSS commit');
    gitHelper.push(workDir, 'origin', 'main');

    const html = fs.readFileSync(path.join(bareRepo, 'static', 'index.html'), 'utf-8');
    const validator = new HtmlValidator(html);
    validator.assertNoXss();
  });

  it('T1.5.5: Semantic HTML landmarks (nav, main, header, article)', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work5', 'main');
    gitHelper.commitFiles(workDir, { 'README.md': '# Semantic Test' }, 'Commit');
    gitHelper.push(workDir, 'origin', 'main');

    const html = fs.readFileSync(path.join(bareRepo, 'static', 'index.html'), 'utf-8');
    const validator = new HtmlValidator(html);
    validator.assertSemanticLandmarks();
  });

  it('T1.5.6: Zero-JS accessibility - full HTML is readable without script execution', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work6', 'main');
    gitHelper.commitFiles(workDir, {
      'README.md': '# Zero JS Mode\nAll essential content is statically baked in.',
      'build.sh': '#!/bin/bash'
    }, 'Zero JS commit');
    gitHelper.push(workDir, 'origin', 'main');

    const html = fs.readFileSync(path.join(bareRepo, 'static', 'index.html'), 'utf-8');
    assert.includes(html, 'Zero JS Mode');
    assert.includes(html, 'build.sh');
  });
});
