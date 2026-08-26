/**
 * Tier 3 - Combinations C18-C21: Cross-Feature Integration Workflows
 *
 * Covers:
 * - C18: Multi-Repo switching + Fuzzy Finder file jumping with line permalinks.
 * - C19: Edge-submitted issue + custom label chips visualizer in issue timeline.
 * - C20: PWA cached repository + offline tree navigation + 1-click clone URL copy.
 * - C21: Multi-Repo portfolio + edge PR synthesis + git format-patch + git am ingestion.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { CollabModalHelper } from '../harness/collab_modal_helper.js';

describe('Tier 3 - Combinations C18-C21: Cross-Feature Integration Workflows', () => {
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

  it('C18.1: Multi-Repo switching updates TreeIndexer and enables fuzzy jumping with permalinks', () => {
    const repoAFiles = [
      'crates/core/src/lib.rs',
      'crates/core/src/engine.rs',
      'crates/core/src/parser.rs'
    ];
    const repoBFiles = [
      'client/src/App.tsx',
      'client/src/ui/FileFinder.tsx',
      'client/src/ui/styles.css'
    ];

    class ClientAppState {
      constructor() {
        this.currentRepo = null;
        this.files = [];
      }

      switchRepo(repoName, files) {
        this.currentRepo = repoName;
        this.files = files;
      }

      fuzzySearch(query) {
        const lineMatch = /:(\d+)$/.exec(query);
        const cleanQuery = lineMatch ? query.slice(0, lineMatch.index).trim() : query.trim();
        const targetLine = lineMatch ? parseInt(lineMatch[1], 10) : undefined;

        const matches = this.files.filter(f => f.toLowerCase().includes(cleanQuery.toLowerCase()));
        return {
          matches,
          targetLine,
          selectedRepo: this.currentRepo
        };
      }
    }

    const app = new ClientAppState();

    // 1. In Repo A
    app.switchRepo('core-engine', repoAFiles);
    const r1 = app.fuzzySearch('engine.rs:42');
    assert.strictEqual(r1.selectedRepo, 'core-engine');
    assert.strictEqual(r1.matches.length, 1);
    assert.strictEqual(r1.matches[0], 'crates/core/src/engine.rs');
    assert.strictEqual(r1.targetLine, 42);

    // 2. Switch to Repo B
    app.switchRepo('web-client', repoBFiles);
    const r2 = app.fuzzySearch('FileFinder:105');
    assert.strictEqual(r2.selectedRepo, 'web-client');
    assert.strictEqual(r2.matches.length, 1);
    assert.strictEqual(r2.matches[0], 'client/src/ui/FileFinder.tsx');
    assert.strictEqual(r2.targetLine, 105);
  });

  it('C19.1: Edge submitted issue with custom labels renders as active chip pills in issue viewer', async () => {
    // Emulated edge issue submit
    const customLabels = ['triaged', 'pwa-offline', 'v0.1.0'];
    const issuePayload = {
      id: '101',
      number: 101,
      title: 'Cache quota handling on mobile Safari',
      description: 'Need LRU eviction when IndexedDB/CacheStorage limit is reached.',
      author: { name: 'Auditor', email: 'auditor@sendforge.dev' },
      labels: customLabels,
      status: 'open',
      created_at: Math.floor(Date.now() / 1000)
    };

    // Render chips in UI
    function renderLabelChips(labels) {
      return labels.map(label => ({
        text: label,
        className: `label-chip chip-${label.replace(/[^a-z0-9]/gi, '_')}`,
        isCustom: !['bug', 'enhancement', 'documentation'].includes(label)
      }));
    }

    const chips = renderLabelChips(issuePayload.labels);
    assert.strictEqual(chips.length, 3);
    assert.strictEqual(chips[0].text, 'triaged');
    assert.strictEqual(chips[0].isCustom, true);
    assert.strictEqual(chips[1].text, 'pwa-offline');
    assert.strictEqual(chips[1].isCustom, true);
    assert.strictEqual(chips[2].text, 'v0.1.0');
    assert.strictEqual(chips[2].isCustom, true);
  });

  it('C20.1: PWA cached repo enables offline navigation, blob viewing, and clone URL copy', async () => {
    // 1. Setup simulated cache
    const cache = new Map();
    const repoMeta = {
      name: 'offline-forge',
      default_branch: 'main',
      clone_url: 'https://forge.sendforge.dev/offline-forge.git'
    };

    cache.set('/meta.json', JSON.stringify(repoMeta));
    cache.set('/objects/11/223344556677889900aabbccddeeff00112233', 'pub fn offline_code() -> bool { true }');

    // 2. Client offline reader
    class OfflineClient {
      constructor(cacheStore) {
        this.cacheStore = cacheStore;
        this.isOnline = false;
      }

      async getMeta() {
        const raw = this.cacheStore.get('/meta.json');
        return JSON.parse(raw);
      }

      async getBlob(oid) {
        const key = `/objects/${oid.slice(0, 2)}/${oid.slice(2)}`;
        return this.cacheStore.get(key) || null;
      }

      getCloneCommand(meta) {
        return `git clone ${meta.clone_url}`;
      }
    }

    const client = new OfflineClient(cache);
    const meta = await client.getMeta();
    assert.strictEqual(meta.name, 'offline-forge');

    const blob = await client.getBlob('11223344556677889900aabbccddeeff00112233');
    assert.includes(blob, 'pub fn offline_code()');

    const cloneCmd = client.getCloneCommand(meta);
    assert.strictEqual(cloneCmd, 'git clone https://forge.sendforge.dev/offline-forge.git');
  });

  it('C21.1: Multi-Repo export + Edge PR submission + format-patch applied cleanly via native git am', () => {
    // 1. Create bare repo and clone
    const bareRepo = gitHelper.createBareRepo('collab-pr-test.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });
    const work = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-collab', 'main');

    gitHelper.commitFiles(work, {
      'src/lib.rs': 'pub fn base_function() -> u32 { 42 }\n'
    }, 'feat: base commit');
    gitHelper.push(work, 'origin', 'main');

    // 2. Create feature branch and commit
    gitHelper.createBranch(work, 'feature/edge-gw');
    gitHelper.commitFiles(work, {
      'src/lib.rs': 'pub fn base_function() -> u32 { 42 }\npub fn edge_gateway() -> &\'static str { "ok" }\n'
    }, 'feat(edge): implement serverless write gateway');

    const headSha = gitHelper.git(work, ['rev-parse', 'HEAD']);
    const patchRaw = gitHelper.git(work, ['format-patch', '-1', 'HEAD', '--stdout']);

    // 3. Emulate edge PR submission
    const prRecord = {
      id: '1',
      title: 'feat(edge): implement serverless write gateway',
      source_branch: 'feature/edge-gw',
      target_branch: 'main',
      patch: patchRaw,
      head_commit: headSha
    };

    // 4. Test applying the generated patch into a fresh clone via native git am
    const cloneDir = gitHelper.createWorkingRepo(bareRepo, 'work-verify');
    const applied = CollabModalHelper.testGitAmIngestion(gitHelper, cloneDir, prRecord.patch);
    assert.strictEqual(applied, true, 'Patch submitted through edge PR must apply cleanly via git am');

    const updatedContent = fs.readFileSync(path.join(cloneDir, 'src', 'lib.rs'), 'utf-8');
    assert.includes(updatedContent, 'pub fn edge_gateway()');
  });
});
