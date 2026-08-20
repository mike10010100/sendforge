/**
 * Tier 1 - Feature 7: CommonMark README Renderer (F7)
 * Tests faithful and secure rendering of Markdown syntax in repository READMEs
 * including headers, tables, code blocks, and links.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { HtmlValidator } from '../harness/html_validator.js';

describe('Tier 1 - Feature 7: CommonMark README Renderer (F7)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('cmark-test.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });
  });

  afterEach(() => {
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('T1.7.1: Headers, emphasis, blockquotes, and lists render to HTML', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work1', 'main');
    const md = [
      '# Project Heading Level 1',
      '## Subheading Level 2',
      'This is **strong text** and *italicized text*.',
      '> This is a blockquote for notes.',
      '- Item 1',
      '- Item 2',
      '1. Numbered 1',
      '2. Numbered 2'
    ].join('\n\n');

    gitHelper.commitFiles(workDir, { 'README.md': md }, 'Add README');
    gitHelper.push(workDir, 'origin', 'main');

    const html = fs.readFileSync(path.join(bareRepo, 'static', 'index.html'), 'utf-8');
    assert.includes(html, 'Project Heading Level 1');
    assert.includes(html, 'Subheading Level 2');
    assert.includes(html, 'strong text');
    assert.includes(html, 'italicized text');
    assert.includes(html, 'Item 1');
  });

  it('T1.7.2: Fenced code blocks and inline code spans render accurately', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work2', 'main');
    const md = [
      '# Code Block Test',
      'Here is inline `const x = 42;` variable.',
      '```rust',
      'fn calculate_hash(data: &[u8]) -> [u8; 20] {',
      '    // Code block inside markdown',
      '    sha1(data)',
      '}',
      '```'
    ].join('\n');

    gitHelper.commitFiles(workDir, { 'README.md': md }, 'Add code block');
    gitHelper.push(workDir, 'origin', 'main');

    const html = fs.readFileSync(path.join(bareRepo, 'static', 'index.html'), 'utf-8');
    assert.includes(html, 'const x = 42;');
    assert.includes(html, 'fn calculate_hash');
    assert.includes(html, 'sha1(data)');
  });

  it('T1.7.3: CommonMark tables render with table headers and cells', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work3', 'main');
    const md = [
      '# Table Test',
      '| Feature | Status | Priority |',
      '|:---|:---:|---:|',
      '| Loose Objects | Done | High |',
      '| Static Fallback | Done | Critical |'
    ].join('\n');

    gitHelper.commitFiles(workDir, { 'README.md': md }, 'Add table');
    gitHelper.push(workDir, 'origin', 'main');

    const html = fs.readFileSync(path.join(bareRepo, 'static', 'index.html'), 'utf-8');
    assert.includes(html, 'Feature');
    assert.includes(html, 'Status');
    assert.includes(html, 'Loose Objects');
    assert.includes(html, 'Critical');
  });

  it('T1.7.4: Hyperlinks and images format properly', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work4', 'main');
    const md = [
      '# Link Test',
      'Visit the [Official Website](https://sendforge.dev) for documentation.',
      '![Logo](assets/logo.png)'
    ].join('\n');

    gitHelper.commitFiles(workDir, { 'README.md': md }, 'Add links');
    gitHelper.push(workDir, 'origin', 'main');

    const html = fs.readFileSync(path.join(bareRepo, 'static', 'index.html'), 'utf-8');
    assert.includes(html, 'https://sendforge.dev');
    assert.includes(html, 'Official Website');
  });

  it('T1.7.5: HTML tags inside markdown are safely sanitized', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work5', 'main');
    const md = [
      '# Sanitization Test',
      '<script>window.__pwned = true;</script>',
      '<a href="javascript:alert(1)">Click for exploit</a>',
      '<div style="behavior:url(xss.htc)">Style attack</div>'
    ].join('\n');

    gitHelper.commitFiles(workDir, { 'README.md': md }, 'Add malicious markdown');
    gitHelper.push(workDir, 'origin', 'main');

    const html = fs.readFileSync(path.join(bareRepo, 'static', 'index.html'), 'utf-8');
    const validator = new HtmlValidator(html);
    validator.assertNoXss();
  });
});
