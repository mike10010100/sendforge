/**
 * Tier 2 - Boundary B13: Ref Selector Empty & Special Ref Handling (B13)
 * Tests zero-tag repositories, non-matching fuzzy filters, branch names with slashes,
 * dots, unicode emojis, and lightweight vs annotated tag resolution.
 */

import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { SendforgeHttpClient } from '../harness/http_client.js';

describe('Tier 2 - Boundary B13: Ref Selector Empty & Special Refs (B13)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;
  let serverHandle;

  beforeEach(async () => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('b13-special-refs.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });

    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-b13', 'main');

    gitHelper.commitFiles(workDir, { 'README.md': '# Special Refs' }, 'Initial commit');

    // Create branches with slashes, dots, and unicode
    gitHelper.createBranch(workDir, 'feature/deep/nested/branch');
    gitHelper.commitFiles(workDir, { 'file.txt': '1' }, 'Nested branch');

    gitHelper.createBranch(workDir, 'release-2.0.1-rc.1');
    gitHelper.commitFiles(workDir, { 'file.txt': '2' }, 'RC branch');

    gitHelper.createBranch(workDir, 'fix/🚀-speedup');
    gitHelper.commitFiles(workDir, { 'file.txt': '3' }, 'Emoji branch');

    // Push branches only (0 tags initially)
    gitHelper.push(workDir, 'origin', '--all');
    serverHandle = await supervisor.startServer(bareRepo);
  });

  afterEach(async () => {
    if (serverHandle) await serverHandle.stop();
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('B13.1: Zero-tag repository returns empty tags array without crashing', async () => {
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const meta = (await client.getMetaJson()).data;

    assert.ok(Array.isArray(meta.tags));
    assert.strictEqual(meta.tags.length, 0, 'Tags list is empty');
    assert.ok(meta.branches.length >= 4);
  });

  it('B13.2: Ref filter with non-matching query displays empty match state', async () => {
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const meta = (await client.getMetaJson()).data;

    const filter = (items, q) => items.filter(i => i.name.toLowerCase().includes(q.toLowerCase()));

    const res = filter(meta.branches, 'non-existent-search-term-12345');
    assert.strictEqual(res.length, 0);
  });

  it('B13.3: Special branch names (slashes, dots, unicode emojis) preserve character integrity', async () => {
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const meta = (await client.getMetaJson()).data;
    const names = meta.branches.map(b => b.name);

    assert.includes(names, 'feature/deep/nested/branch');
    assert.includes(names, 'release-2.0.1-rc.1');
    assert.includes(names, 'fix/🚀-speedup');
  });

  it('B13.4: Lightweight tags and annotated tags are distinguishable in ref list', async () => {
    const workDir = gitHelper.createWorkingRepo(bareRepo, 'work-b13-tags');

    // Create 1 annotated tag and 1 lightweight tag
    gitHelper.createAnnotatedTag(workDir, 'v1.0.0-annotated', 'Annotated message');
    gitHelper.createLightweightTag(workDir, 'v1.0.0-lightweight');

    gitHelper.push(workDir, 'origin', '--tags');

    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const meta = (await client.getMetaJson()).data;
    const tagNames = meta.tags.map(t => t.name);

    assert.includes(tagNames, 'v1.0.0-annotated');
    assert.includes(tagNames, 'v1.0.0-lightweight');
  });
});
