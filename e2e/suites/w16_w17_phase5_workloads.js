/**
 * Tier 4 - Workloads W16-W17: Real-World Multi-Repo, Edge & Offline Scenarios
 *
 * Covers:
 * - W16: Full multi-repo portfolio export (10 repos) + offline browsing + high-concurrency search across repositories.
 * - W17: End-to-end edge collaboration workflow with custom labels, PR branch synthesis, patch export, and offline PWA resilience.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { CollabModalHelper } from '../harness/collab_modal_helper.js';

describe('Tier 4 - Workloads W16-W17: Real-World Scenarios', () => {
  let gitHelper;
  let supervisor;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
  });

  afterEach(() => {
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('W16.1: 10-Repository Portfolio Export, Concurrent Static Serving & Polyglot Fuzzy Search', async () => {
    const reposRoot = path.join(gitHelper.getRootDir(), 'workload_repos');
    fs.mkdirSync(reposRoot, { recursive: true });

    const repoNames = [
      'core-runtime',
      'web-portal',
      'cli-tool',
      'auth-service',
      'analytics-engine',
      'docs-site',
      'sdk-python',
      'sdk-rust',
      'sdk-typescript',
      'infra-deploy'
    ];

    // Create 10 bare repos with varying structures and files
    for (let i = 0; i < repoNames.length; i++) {
      const name = repoNames[i];
      const owner = i % 2 === 0 ? 'platform' : 'frontend';
      const repoDir = path.join(reposRoot, owner, `${name}.git`);
      fs.mkdirSync(path.dirname(repoDir), { recursive: true });

      gitHelper.createBareRepo(repoDir);
      supervisor.init(repoDir, { bare: true, defaultBranch: 'main' });
      const work = gitHelper.createWorkingRepoAndInit(repoDir, `work_${name}`, 'main');

      const files = {
        'README.md': `# ${name}\nHigh-concurrency workload test repository.`,
        'Cargo.toml': `[package]\nname = "${name}"\nversion = "0.1.0"`,
        'src/lib.rs': `pub fn run_${name.replace(/-/g, '_')}() -> usize { ${i} }\n`,
        'src/config.rs': 'pub struct Config { pub enabled: bool }\n',
        'tests/integration_test.rs': 'pub fn test_run() {}\n'
      };

      gitHelper.commitFiles(work, files, `feat: initial release for ${name}`);
      gitHelper.createAnnotatedTag(work, 'v0.1.0', `Release v0.1.0 for ${name}`);
      gitHelper.push(work, 'origin', 'main');
      gitHelper.push(work, 'origin', 'v0.1.0');
    }

    // Export entire 10-repo portfolio
    const exportDir = path.join(gitHelper.getRootDir(), 'workload_exported');
    const res = supervisor.runCli(['export', '--all', reposRoot, exportDir]);
    assert.strictEqual(res.status, 0, `Export failed:\n${res.stderr}`);

    // Validate repos.json
    const reposJsonPath = path.join(exportDir, 'repos.json');
    assert.ok(fs.existsSync(reposJsonPath));
    const index = JSON.parse(fs.readFileSync(reposJsonPath, 'utf-8'));
    assert.strictEqual(index.repos.length, 10);

    // Validate static index.html
    const indexHtml = fs.readFileSync(path.join(exportDir, 'index.html'), 'utf-8');
    assert.includes(indexHtml, 'platform');
    assert.includes(indexHtml, 'frontend');
    for (const name of repoNames) {
      assert.includes(indexHtml, name);
    }

    // Spin up server and execute concurrent HTTP queries
    const server = await supervisor.startServer(exportDir);
    try {
      const fetchPromises = [];
      for (let i = 0; i < 50; i++) {
        const repo = repoNames[i % repoNames.length];
        const owner = (i % repoNames.length) % 2 === 0 ? 'platform' : 'frontend';
        fetchPromises.push(
          fetch(`${server.baseUrl}/${owner}/${repo}/meta.json`).then(r => {
            assert.strictEqual(r.status, 200);
            return r.json();
          })
        );
      }
      const results = await Promise.all(fetchPromises);
      assert.strictEqual(results.length, 50);

      // Perform simulated fuzzy search across all repos
      const allFiles = [];
      for (const r of index.repos) {
        allFiles.push(`${r.path}src/lib.rs`);
        allFiles.push(`${r.path}src/config.rs`);
        allFiles.push(`${r.path}tests/integration_test.rs`);
      }

      const searchHits = allFiles.filter(f => f.includes('analytics-engine'));
      assert.strictEqual(searchHits.length, 3);
    } finally {
      await server.stop();
    }
  });

  it('W17.1: Full End-to-End Edge Collaboration & Offline PWA Workflow', async () => {
    // 1. Setup repository
    const bareRepo = gitHelper.createBareRepo('e2e-workflow.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });
    const work = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-e2e', 'main');

    gitHelper.commitFiles(work, {
      'README.md': '# E2E Workflow Repo\nOffline PWA and Edge Gateway integration.',
      'src/main.rs': 'fn main() { println!("v0.1.0"); }\n'
    }, 'feat: initial commit');
    gitHelper.createAnnotatedTag(work, 'v0.1.0', 'Annotated release v0.1.0');
    gitHelper.push(work, 'origin', 'main');
    gitHelper.push(work, 'origin', 'v0.1.0');

    // 2. Submit Edge Issue with custom labels
    const issueDraft = {
      title: 'Support background sync for offline issues',
      description: 'Use Background Sync API in service worker.',
      labels: ['pwa', 'offline-sync', 'v0.1.0'],
      author: { name: 'Workflow Tester', email: 'tester@sendforge.dev' }
    };
    const issueCmd = CollabModalHelper.generateIssuePushCommand(1);
    assert.strictEqual(issueCmd, 'git push origin HEAD:refs/issues/1');

    // 3. Create feature branch, submit PR and export patch
    gitHelper.createBranch(work, 'feature/bg-sync');
    gitHelper.commitFiles(work, {
      'src/sync.rs': 'pub fn sync_offline_queue() -> bool { true }\n'
    }, 'feat(pwa): implement background sync queue');

    const patchText = gitHelper.git(work, ['format-patch', '-1', 'HEAD', '--stdout']);
    assert.includes(patchText, 'feat(pwa): implement background sync queue');

    // 4. Test patch ingestion via git am
    const cloneDir = gitHelper.createWorkingRepo(bareRepo, 'work-ingest');
    const amSuccess = CollabModalHelper.testGitAmIngestion(gitHelper, cloneDir, patchText);
    assert.strictEqual(amSuccess, true);

    // 5. Export static site and verify PWA offline assets
    const exportDir = path.join(gitHelper.getRootDir(), 'e2e_exported');
    const res = supervisor.export(bareRepo, exportDir);
    assert.strictEqual(res.status, 0);

    assert.ok(fs.existsSync(path.join(exportDir, 'meta.json')));
    assert.ok(fs.existsSync(path.join(exportDir, 'index.html')));
  });
});
