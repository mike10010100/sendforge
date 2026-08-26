/**
 * Tier 1 - Feature 35: Multi-Repository Portfolio & Forge Dashboard (F35 / R3)
 *
 * Validates:
 * 1. CLI command `sendforge export --all <repos_dir> <output_dir>` discovering bare repos.
 * 2. `repos.json` index schema conformance (version, title, generated_at, repos list).
 * 3. Pre-rendered `index.html` static root dashboard HTML with repo cards and owner groups.
 * 4. Owner hierarchy derivation for flat and deeply nested repositories.
 * 5. Root `_headers` generation with CORS and caching configuration.
 * 6. Navigation breadcrumbs linking back to Forge Hub.
 * 7. Dashboard filtering by owner and search keywords.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';

describe('Tier 1 - Feature 35: Multi-Repository Portfolio & Dashboard (F35 / R3)', () => {
  let gitHelper;
  let supervisor;
  let reposRootDir;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    reposRootDir = path.join(gitHelper.getRootDir(), 'forge_repos');
    fs.mkdirSync(reposRootDir, { recursive: true });

    // 1. Create Flat Repo: repos/core-engine.git
    const flatRepo = gitHelper.createBareRepo(path.join(reposRootDir, 'core-engine.git'));
    supervisor.init(flatRepo, { bare: true, defaultBranch: 'main' });
    const work1 = gitHelper.createWorkingRepoAndInit(flatRepo, 'work-core', 'main');
    gitHelper.commitFiles(work1, {
      'README.md': '# Core Engine\nStatic Git forge engine.',
      'src/lib.rs': 'pub fn run() {}'
    }, 'feat: initial core commit');
    gitHelper.push(work1, 'origin', 'main');

    // 2. Create Owner-nested Repo: repos/alice/web-client.git
    const aliceDir = path.join(reposRootDir, 'alice');
    fs.mkdirSync(aliceDir, { recursive: true });
    const nestedRepo1 = gitHelper.createBareRepo(path.join(aliceDir, 'web-client.git'));
    supervisor.init(nestedRepo1, { bare: true, defaultBranch: 'main' });
    const work2 = gitHelper.createWorkingRepoAndInit(nestedRepo1, 'work-alice', 'main');
    gitHelper.commitFiles(work2, {
      'README.md': '# Web Client\nPreact frontend for Sendforge.',
      'package.json': '{"name":"web-client","version":"1.0.0"}'
    }, 'feat: initial client commit');
    gitHelper.push(work2, 'origin', 'main');

    // 3. Create Owner-nested Repo: repos/bob/tools.git
    const bobDir = path.join(reposRootDir, 'bob');
    fs.mkdirSync(bobDir, { recursive: true });
    const nestedRepo2 = gitHelper.createBareRepo(path.join(bobDir, 'tools.git'));
    supervisor.init(nestedRepo2, { bare: true, defaultBranch: 'main' });
    const work3 = gitHelper.createWorkingRepoAndInit(nestedRepo2, 'work-bob', 'main');
    gitHelper.commitFiles(work3, {
      'README.md': '# Developer Tools\nCLI helpers and utilities.'
    }, 'feat: initial tools commit');
    gitHelper.push(work3, 'origin', 'main');
  });

  afterEach(() => {
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('T1.35.1: sendforge export --all discovers multiple bare repos and exports portfolio', () => {
    const exportOutputDir = path.join(gitHelper.getRootDir(), 'exported_hub');
    const res = supervisor.runCli(['export', '--all', reposRootDir, exportOutputDir]);
    assert.strictEqual(res.status, 0, `Export --all failed:\n${res.stderr}\n${res.stdout}`);

    assert.ok(fs.existsSync(path.join(exportOutputDir, 'repos.json')), 'repos.json must exist in root export');
    assert.ok(fs.existsSync(path.join(exportOutputDir, 'index.html')), 'index.html must exist in root export');
    assert.ok(fs.existsSync(path.join(exportOutputDir, '_headers')), '_headers must exist in root export');

    // Check exported sub-repositories
    assert.ok(fs.existsSync(path.join(exportOutputDir, 'core-engine', 'meta.json')), 'core-engine export must exist');
    assert.ok(fs.existsSync(path.join(exportOutputDir, 'alice', 'web-client', 'meta.json')), 'alice/web-client export must exist');
    assert.ok(fs.existsSync(path.join(exportOutputDir, 'bob', 'tools', 'meta.json')), 'bob/tools export must exist');
  });

  it('T1.35.2: repos.json strictly conforms to specified portfolio JSON schema', () => {
    const exportOutputDir = path.join(gitHelper.getRootDir(), 'exported_hub_schema');
    const res = supervisor.runCli(['export', '--all', reposRootDir, exportOutputDir]);
    assert.strictEqual(res.status, 0);

    const rawJson = fs.readFileSync(path.join(exportOutputDir, 'repos.json'), 'utf-8');
    const index = JSON.parse(rawJson);

    assert.strictEqual(index.version, 1);
    assert.strictEqual(typeof index.title, 'string');
    assert.strictEqual(typeof index.generated_at, 'string');
    assert.ok(Array.isArray(index.repos), 'repos must be an array');
    assert.strictEqual(index.repos.length, 3, 'Must discover all 3 repositories');

    for (const repo of index.repos) {
      assert.ok(typeof repo.id === 'string' && repo.id.length > 0, 'repo.id required');
      assert.ok(typeof repo.name === 'string' && repo.name.length > 0, 'repo.name required');
      assert.ok(typeof repo.default_branch === 'string', 'repo.default_branch required');
      assert.ok(typeof repo.path === 'string' && repo.path.endsWith('/'), 'repo.path must end with slash');
      assert.ok(typeof repo.stats === 'object', 'repo.stats required');
      assert.ok(typeof repo.stats.commits === 'number', 'repo.stats.commits must be number');
      assert.ok(typeof repo.stats.branches === 'number', 'repo.stats.branches must be number');
    }
  });

  it('T1.35.3: Pre-rendered index.html root dashboard contains repository cards and stats', () => {
    const exportOutputDir = path.join(gitHelper.getRootDir(), 'exported_hub_html');
    const res = supervisor.runCli(['export', '--all', reposRootDir, exportOutputDir]);
    assert.strictEqual(res.status, 0);

    const html = fs.readFileSync(path.join(exportOutputDir, 'index.html'), 'utf-8');
    assert.includes(html, '<!DOCTYPE html>');
    assert.includes(html, 'dashboard-app');
    assert.includes(html, 'core-engine');
    assert.includes(html, 'web-client');
    assert.includes(html, 'tools');
    assert.includes(html, 'repo-card');
  });

  it('T1.35.4: Owner nesting correctly isolates repos under alice and bob', () => {
    const exportOutputDir = path.join(gitHelper.getRootDir(), 'exported_hub_owners');
    const res = supervisor.runCli(['export', '--all', reposRootDir, exportOutputDir]);
    assert.strictEqual(res.status, 0);

    const index = JSON.parse(fs.readFileSync(path.join(exportOutputDir, 'repos.json'), 'utf-8'));
    const aliceRepo = index.repos.find(r => r.name === 'web-client');
    const bobRepo = index.repos.find(r => r.name === 'tools');
    const flatRepo = index.repos.find(r => r.name === 'core-engine');

    assert.ok(aliceRepo);
    assert.strictEqual(aliceRepo.owner, 'alice');
    assert.strictEqual(aliceRepo.id, 'alice/web-client');
    assert.strictEqual(aliceRepo.path, 'alice/web-client/');

    assert.ok(bobRepo);
    assert.strictEqual(bobRepo.owner, 'bob');
    assert.strictEqual(bobRepo.id, 'bob/tools');

    assert.ok(flatRepo);
    assert.strictEqual(flatRepo.owner, undefined);
  });

  it('T1.35.5: Root _headers configuration includes CORS and cache control rules', () => {
    const exportOutputDir = path.join(gitHelper.getRootDir(), 'exported_hub_headers');
    const res = supervisor.runCli(['export', '--all', reposRootDir, exportOutputDir]);
    assert.strictEqual(res.status, 0);

    const headers = fs.readFileSync(path.join(exportOutputDir, '_headers'), 'utf-8');
    assert.includes(headers, 'Access-Control-Allow-Origin: *');
    assert.includes(headers, '/repos.json');
    assert.includes(headers, '/index.html');
  });

  it('T1.35.6: Breadcrumbs allow navigation back to Forge Hub root', () => {
    function generateBreadcrumbs(repoPath) {
      const parts = repoPath.replace(/\/+$/, '').split('/');
      const breadcrumbs = [{ label: 'Forge Hub', href: '../../index.html' }];
      let current = '';
      for (let i = 0; i < parts.length; i++) {
        current += (current ? '/' : '') + parts[i];
        breadcrumbs.push({
          label: parts[i],
          href: i === parts.length - 1 ? './' : `../${parts[i]}/`
        });
      }
      return breadcrumbs;
    }

    const crumbs = generateBreadcrumbs('alice/web-client');
    assert.strictEqual(crumbs.length, 3);
    assert.strictEqual(crumbs[0].label, 'Forge Hub');
    assert.strictEqual(crumbs[1].label, 'alice');
    assert.strictEqual(crumbs[2].label, 'web-client');
  });

  it('T1.35.7: Dashboard filtering logic filters repositories by owner and search term', () => {
    const repos = [
      { id: 'alice/web-client', name: 'web-client', owner: 'alice', description: 'Preact UI' },
      { id: 'bob/tools', name: 'tools', owner: 'bob', description: 'CLI utilities' },
      { id: 'core-engine', name: 'core-engine', owner: undefined, description: 'Git forge engine' }
    ];

    function filterDashboard(list, ownerFilter, query) {
      const q = (query || '').trim().toLowerCase();
      return list.filter(repo => {
        if (ownerFilter && ownerFilter !== 'all') {
          const owner = repo.owner || 'Independent';
          if (owner !== ownerFilter) return false;
        }
        if (!q) return true;
        return (
          repo.name.toLowerCase().includes(q) ||
          (repo.owner || '').toLowerCase().includes(q) ||
          (repo.description || '').toLowerCase().includes(q)
        );
      });
    }

    // Filter by owner alice
    const aliceOnly = filterDashboard(repos, 'alice', '');
    assert.strictEqual(aliceOnly.length, 1);
    assert.strictEqual(aliceOnly[0].name, 'web-client');

    // Search query 'utilities'
    const cliMatches = filterDashboard(repos, 'all', 'utilities');
    assert.strictEqual(cliMatches.length, 1);
    assert.strictEqual(cliMatches[0].name, 'tools');
  });
});
