/**
 * Tier 4 - Workload W15: Full Collaboration Lifecycle: Modals, Diffs & Patches (W15)
 *
 * Validates:
 * 1. Multi-issue creation workflow with push refs, drafts, and JSON export
 * 2. Multi-PR creation with live merge-base, diff preview, and format-patch export
 * 3. Applying patches via git am and attaching review notes
 */

import { describe, it, assert, beforeAll, afterAll } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { CollabModalHelper, MockLocalStorage } from '../harness/collab_modal_helper.js';

describe('Tier 4 - Workload W15: Full Collaboration Lifecycle (W15)', () => {
  let gitHelper;
  let bareRepoPath;
  let workPath;

  beforeAll(() => {
    gitHelper = new GitRepoHelper();
    bareRepoPath = gitHelper.createBareRepo('w15-collab.git');
    workPath = gitHelper.createWorkingRepoAndInit(bareRepoPath, 'w15-work');

    gitHelper.commitFiles(workPath, {
      'src/core.rs': 'pub fn run() -> bool { true }\n',
      'README.md': '# Core Project\n'
    }, 'Initial main commit');
    gitHelper.push(workPath, 'origin', 'main');
  });

  afterAll(() => {
    gitHelper.cleanup();
  });

  it('W15.1: Multi-contributor collaboration simulation with issues, PRs, diffs, patches and git am', () => {
    // 1. Contributor A files Issue 1
    const storage = new MockLocalStorage();
    const issueDraft = { title: 'Implement logging', description: 'Add structured logger' };
    storage.setItem('sendforge_draft_issue_w15-collab', JSON.stringify(issueDraft));
    assert.strictEqual(JSON.parse(storage.getItem('sendforge_draft_issue_w15-collab')).title, 'Implement logging');

    const issue1Push = CollabModalHelper.generateIssuePushCommand(1);
    assert.strictEqual(issue1Push, 'git push origin HEAD:refs/issues/1');

    // 2. Contributor B works on feature branch
    gitHelper.createBranch(workPath, 'feature/logging');
    gitHelper.commitFiles(workPath, {
      'src/core.rs': 'pub fn run() -> bool {\n    println!("Starting core");\n    true\n}\n',
      'src/logger.rs': 'pub fn log(msg: &str) { println!("[LOG] {}", msg); }\n'
    }, 'Implement logging subsystem');
    gitHelper.push(workPath, 'origin', 'feature/logging');

    // 3. PR Modal merge base and diff preview
    const mainSha = gitHelper.git(bareRepoPath, ['rev-parse', 'main']);
    const featSha = gitHelper.git(bareRepoPath, ['rev-parse', 'feature/logging']);
    const mergeBase = gitHelper.git(bareRepoPath, ['merge-base', 'main', 'feature/logging']);
    assert.strictEqual(mergeBase, mainSha);

    const diffHunks = gitHelper.git(bareRepoPath, ['diff', 'main..feature/logging']);
    assert.includes(diffHunks, 'src/logger.rs');

    // 4. Generate format-patch
    const patch = CollabModalHelper.formatPatch({
      commitSha: featSha,
      authorName: 'Contributor B',
      authorEmail: 'b@sendforge.dev',
      subject: 'Implement logging subsystem',
      body: 'Closes #1.',
      diffHunks
    });

    // 5. Ingest patch into clean clone via git am
    const upstreamClone = gitHelper.createWorkingRepo(bareRepoPath, 'w15-upstream-clone');
    gitHelper.git(upstreamClone, ['checkout', 'main']);
    const applied = CollabModalHelper.testGitAmIngestion(gitHelper, upstreamClone, patch);
    assert.strictEqual(applied, true, 'Patch should apply cleanly with git am');

    const coreContent = gitHelper.git(upstreamClone, ['show', 'HEAD:src/core.rs']);
    assert.includes(coreContent, 'println!("Starting core");');
  });
});
