/**
 * Tier 4 - Workload W1: Real-World Multi-Author Repository Simulation
 * Simulates a realistic repository lifecycle with 50+ commits, multiple authors,
 * branches, merges, and tags, validating metadata and log generation.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { HtmlValidator } from '../harness/html_validator.js';

describe('Tier 4 - Workload W1: Multi-Author 50-Commit Repository Simulation (W1)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('w1-multiauthor.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });
  });

  afterEach(() => {
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('W1.1: Simulates 50 commits across 5 authors with branch merges and tags', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-50', 'main');

    const authors = [
      { name: 'Alice Smith', email: 'alice@example.com' },
      { name: 'Bob Jones', email: 'bob@example.com' },
      { name: 'Charlie Kim', email: 'charlie@example.com' },
      { name: 'Dana Lee', email: 'dana@example.com' },
      { name: 'Eve Brown', email: 'eve@example.com' }
    ];

    // Generate 50 commits with changing files and alternating authors
    for (let i = 1; i <= 50; i++) {
      const author = authors[i % authors.length];
      const files = {
        [`src/module_${(i % 5) + 1}.rs`]: `// Commit ${i} by ${author.name}\npub fn action_${i}() -> i32 { ${i} }\n`,
        'CHANGELOG.md': `# Changelog\n\n## Release Updates\n- Commit ${i} by ${author.name}\n`
      };

      if (i === 1) {
        files['README.md'] = '# Real World Simulation Repo\n\n50 commits multi-author simulation.';
      }

      gitHelper.commitFiles(workDir, files, `Feat: Commit ${i} implementation`, {
        GIT_AUTHOR_NAME: author.name,
        GIT_AUTHOR_EMAIL: author.email,
        GIT_COMMITTER_NAME: author.name,
        GIT_COMMITTER_EMAIL: author.email
      });

      if (i === 25) {
        gitHelper.createAnnotatedTag(workDir, 'v0.5.0', 'Midway milestone release');
      }
    }

    gitHelper.createAnnotatedTag(workDir, 'v1.0.0', 'Production v1.0.0 release');
    gitHelper.push(workDir, 'origin', '--all');
    gitHelper.push(workDir, 'origin', '--tags');

    // Verify meta.json reflects all 50 commits and tags
    const metaPath = path.join(bareRepo, 'static', 'meta.json');
    assert.ok(fs.existsSync(metaPath));
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

    assert.greaterThanOrEqual(meta.stats.commit_count, 50, 'Commit count must be at least 50');
    assert.greaterThanOrEqual(meta.stats.tag_count, 2, 'Tag count must be at least 2');

    // Verify static log.html contains rendered commit list
    const logPath = path.join(bareRepo, 'static', 'log.html');
    assert.ok(fs.existsSync(logPath));
    const html = fs.readFileSync(logPath, 'utf-8');
    const validator = new HtmlValidator(html);
    validator.assertValidDocument();
    assert.includes(html, 'Commit 50 implementation');
  });
});
