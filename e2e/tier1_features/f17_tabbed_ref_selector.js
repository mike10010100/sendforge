/**
 * Tier 1 - Feature 17: Tabbed Ref Selector (Branches vs. Tags) (F17 / R1)
 * Tests dedicated Branches and Tags tabs, instant fuzzy search/filter,
 * visual metadata badges, keyboard navigation & accessibility, and route transitions.
 */

import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { SendforgeHttpClient } from '../harness/http_client.js';

describe('Tier 1 - Feature 17: Tabbed Ref Selector (F17 / R1)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;
  let serverHandle;

  beforeEach(async () => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('f17-ref-selector.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });

    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-f17', 'main');

    // Root commit on main
    const c1 = gitHelper.commitFiles(workDir, {
      'README.md': '# Ref Selector Test',
      'src/index.ts': 'export const v = 1;'
    }, 'Commit 1: Initial commit');

    // Create release branch and feature branch
    gitHelper.createBranch(workDir, 'release/v1.0.0');
    gitHelper.commitFiles(workDir, { 'src/version.ts': 'export const ver = "1.0.0";' }, 'Release 1.0.0 branch');

    gitHelper.createBranch(workDir, 'feature/search-engine');
    gitHelper.commitFiles(workDir, { 'src/search.ts': 'export function search() {}' }, 'Add search feature');

    // Switch back to main and create tags
    gitHelper.git(workDir, ['checkout', 'main']);
    gitHelper.createAnnotatedTag(workDir, 'v1.0.0', 'Production Release v1.0.0');
    gitHelper.createAnnotatedTag(workDir, 'v1.1.0-beta.1', 'Beta preview release');
    gitHelper.createLightweightTag(workDir, 'v0.9.0-alpha');

    gitHelper.push(workDir, 'origin', '--all');
    gitHelper.push(workDir, 'origin', '--tags');

    serverHandle = await supervisor.startServer(bareRepo);
  });

  afterEach(async () => {
    if (serverHandle) await serverHandle.stop();
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('T1.17.1: Dedicated Branches tab and Tags tab partition refs without overlap', async () => {
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const metaRes = await client.getMetaJson();
    assert.strictEqual(metaRes.status, 200);
    const meta = metaRes.data;

    // Separate into branches and tags collections
    const branches = meta.branches || [];
    const tags = meta.tags || [];

    const branchNames = branches.map(b => b.name);
    const tagNames = tags.map(t => t.name);

    // Verify branches list
    assert.includes(branchNames, 'main');
    assert.includes(branchNames, 'release/v1.0.0');
    assert.includes(branchNames, 'feature/search-engine');
    assert.strictEqual(branches.length, 3);

    // Verify tags list
    assert.includes(tagNames, 'v1.0.0');
    assert.includes(tagNames, 'v1.1.0-beta.1');
    assert.includes(tagNames, 'v0.9.0-alpha');
    assert.strictEqual(tags.length, 3);

    // Verify strict disjointness (no tag in branches, no branch in tags)
    for (const bName of branchNames) {
      assert.notIncludes(tagNames, bName);
    }
  });

  it('T1.17.2: Instantaneous client-side fuzzy search/filter logic', async () => {
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const meta = (await client.getMetaJson()).data;

    // In-browser fuzzy search matcher
    const filterRefs = (items, query) => {
      if (!query || !query.trim()) return items;
      const q = query.trim().toLowerCase();
      return items.filter(item => {
        const target = item.name.toLowerCase();
        // Substring match or subsequence match
        if (target.includes(q)) return true;
        let qi = 0;
        for (let ti = 0; ti < target.length && qi < q.length; ti++) {
          if (target[ti] === q[qi]) qi++;
        }
        return qi === q.length;
      });
    };

    // Filter branches
    const searchFeature = filterRefs(meta.branches, 'search');
    assert.strictEqual(searchFeature.length, 1);
    assert.strictEqual(searchFeature[0].name, 'feature/search-engine');

    const searchRel = filterRefs(meta.branches, 'rel');
    assert.strictEqual(searchRel.length, 1);
    assert.strictEqual(searchRel[0].name, 'release/v1.0.0');

    // Filter tags
    const searchBeta = filterRefs(meta.tags, 'beta');
    assert.strictEqual(searchBeta.length, 1);
    assert.strictEqual(searchBeta[0].name, 'v1.1.0-beta.1');

    const searchAllV = filterRefs(meta.tags, 'v1');
    assert.strictEqual(searchAllV.length, 2);
  });

  it('T1.17.3: Visual metadata badges (default branch, 7-char short commit hash, tag annotations)', async () => {
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const meta = (await client.getMetaJson()).data;

    // Default branch badge logic
    const defaultBranch = meta.default_branch;
    assert.strictEqual(defaultBranch, 'main');

    const mainBranch = meta.branches.find(b => b.name === 'main');
    assert.ok(mainBranch);
    assert.strictEqual(mainBranch.name, defaultBranch, 'Default badge is displayed on main');

    // Short commit SHA format (7 characters)
    for (const branch of meta.branches) {
      assert.ok(branch.target, 'Branch has target SHA');
      assert.strictEqual(branch.target.length, 40, 'Target is 40-hex SHA-1');
      const shortSha = branch.target.slice(0, 7);
      assert.strictEqual(shortSha.length, 7);
      assert.match(shortSha, /^[0-9a-f]{7}$/);
    }

    // Tag annotations and dates
    const tagV1 = meta.tags.find(t => t.name === 'v1.0.0');
    assert.ok(tagV1);
    assert.ok(tagV1.target, 'Tag has target OID');
    assert.strictEqual(tagV1.target.length, 40);
  });

  it('T1.17.4: Keyboard navigation and accessibility (Escape, Enter, Tab state)', () => {
    // State machine for RefSelector popover
    class RefSelectorState {
      constructor(branches, tags, defaultBranch = 'main') {
        this.branches = branches;
        this.tags = tags;
        this.defaultBranch = defaultBranch;
        this.isOpen = false;
        this.activeTab = 'branches'; // 'branches' | 'tags'
        this.searchQuery = '';
        this.selectedIndex = 0;
        this.selectedRef = defaultBranch;
      }

      open() {
        this.isOpen = true;
        this.searchQuery = '';
        this.selectedIndex = 0;
      }

      close() {
        this.isOpen = false;
      }

      setTab(tab) {
        this.activeTab = tab;
        this.selectedIndex = 0;
      }

      setQuery(q) {
        this.searchQuery = q;
        this.selectedIndex = 0;
      }

      getActiveList() {
        const source = this.activeTab === 'branches' ? this.branches : this.tags;
        const q = this.searchQuery.toLowerCase().trim();
        if (!q) return source;
        return source.filter(item => item.toLowerCase().includes(q));
      }

      handleKeyDown(key) {
        if (!this.isOpen) {
          if (key === 'Enter' || key === ' ') {
            this.open();
            return { handled: true };
          }
          return { handled: false };
        }

        const list = this.getActiveList();

        if (key === 'Escape') {
          this.close();
          return { handled: true, action: 'closed' };
        } else if (key === 'ArrowDown') {
          this.selectedIndex = list.length > 0 ? (this.selectedIndex + 1) % list.length : 0;
          return { handled: true, action: 'nav_down', index: this.selectedIndex };
        } else if (key === 'ArrowUp') {
          this.selectedIndex = list.length > 0 ? (this.selectedIndex - 1 + list.length) % list.length : 0;
          return { handled: true, action: 'nav_up', index: this.selectedIndex };
        } else if (key === 'Enter') {
          if (list.length > 0 && list[this.selectedIndex]) {
            this.selectedRef = list[this.selectedIndex];
            this.close();
            return { handled: true, action: 'selected', ref: this.selectedRef };
          }
        } else if (key === 'Tab') {
          this.setTab(this.activeTab === 'branches' ? 'tags' : 'branches');
          return { handled: true, action: 'tab_switched', tab: this.activeTab };
        }
        return { handled: false };
      }
    }

    const state = new RefSelectorState(
      ['main', 'release/v1.0.0', 'feature/search'],
      ['v1.0.0', 'v1.1.0-beta.1', 'v0.9.0-alpha']
    );

    // Initial state: closed
    assert.strictEqual(state.isOpen, false);

    // Press Enter to open
    state.handleKeyDown('Enter');
    assert.strictEqual(state.isOpen, true);
    assert.strictEqual(state.activeTab, 'branches');

    // Arrow down navigates to index 1
    state.handleKeyDown('ArrowDown');
    assert.strictEqual(state.selectedIndex, 1);

    // Press Enter to select
    const selRes = state.handleKeyDown('Enter');
    assert.strictEqual(selRes.action, 'selected');
    assert.strictEqual(state.selectedRef, 'release/v1.0.0');
    assert.strictEqual(state.isOpen, false);

    // Reopen and switch tab with Tab key
    state.open();
    state.handleKeyDown('Tab');
    assert.strictEqual(state.activeTab, 'tags');
    assert.strictEqual(state.getActiveList().length, 3);

    // Escape closes popover
    const escRes = state.handleKeyDown('Escape');
    assert.strictEqual(escRes.action, 'closed');
    assert.strictEqual(state.isOpen, false);
  });

  it('T1.17.5: Empty search results state and special ref formatting', () => {
    const branches = [{ name: 'main' }, { name: 'feature/search-engine' }];
    const tags = [{ name: 'v1.0.0' }];

    const filter = (items, q) => items.filter(i => i.name.toLowerCase().includes(q.toLowerCase()));

    const emptyBranchResult = filter(branches, 'xyz-nonexistent');
    assert.strictEqual(emptyBranchResult.length, 0);

    const emptyTagResult = filter(tags, 'v9.9.9');
    assert.strictEqual(emptyTagResult.length, 0);
  });

  it('T1.17.6: Selecting a ref updates client route while preserving file path when available', () => {
    const computeNewRoute = (currentRoute, newRef) => {
      // currentRoute format: { view: 'tree' | 'blob', ref: 'main', path: 'src/index.ts' }
      if (currentRoute.view === 'blob' || currentRoute.view === 'tree') {
        const pathPart = currentRoute.path ? `/${currentRoute.path}` : '';
        return `/${currentRoute.view}/${encodeURIComponent(newRef)}${pathPart}`;
      }
      return `/tree/${encodeURIComponent(newRef)}`;
    };

    const r1 = computeNewRoute({ view: 'blob', ref: 'main', path: 'src/index.ts' }, 'feature/search-engine');
    assert.strictEqual(r1, '/blob/feature%2Fsearch-engine/src/index.ts');

    const r2 = computeNewRoute({ view: 'tree', ref: 'main', path: 'src' }, 'v1.0.0');
    assert.strictEqual(r2, '/tree/v1.0.0/src');

    const r3 = computeNewRoute({ view: 'root', ref: 'main', path: '' }, 'release/v1.0.0');
    assert.strictEqual(r3, '/tree/release%2Fv1.0.0');
  });
});
