/**
 * Tier 2 - Boundary B8: Clock-Warp Commit Timestamps
 * Tests handling of negative timestamps, far-future dates (year 2099),
 * extreme timezone offsets (+1400, -1200) without integer overflow or panics.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { GitParser } from '../harness/git_parser.js';

describe('Tier 2 - Boundary B8: Clock-Warp Timestamps (B8)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('b8-time.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });
  });

  afterEach(() => {
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('B8.1: Future timestamp (year 2099) handled without overflow', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-future', 'main');
    gitHelper.commitFiles(workDir, { 'future.txt': 'from the future' }, 'Future commit', {
      GIT_AUTHOR_DATE: '2099-01-01T00:00:00+00:00',
      GIT_COMMITTER_DATE: '2099-01-01T00:00:00+00:00'
    });
    gitHelper.push(workDir, 'origin', 'main');

    const metaPath = path.join(bareRepo, 'static', 'meta.json');
    assert.ok(fs.existsSync(metaPath));
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    assert.ok(meta.updated_at);
  });

  it('B8.2: Epoch timestamp 0 (1970-01-01) handled without underflow', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-epoch', 'main');
    gitHelper.commitFiles(workDir, { 'epoch.txt': 'at unix epoch' }, 'Epoch commit', {
      GIT_AUTHOR_DATE: '1970-01-01T00:00:00+00:00',
      GIT_COMMITTER_DATE: '1970-01-01T00:00:00+00:00'
    });
    gitHelper.push(workDir, 'origin', 'main');

    const metaPath = path.join(bareRepo, 'static', 'meta.json');
    assert.ok(fs.existsSync(metaPath));
  });

  it('B8.3: Commit parser extracts extreme timezone offsets correctly', () => {
    const syntheticCommit = Buffer.from([
      'tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904',
      'author Time Traveler <traveler@example.com> 4102444800 +1400',
      'committer Time Traveler <traveler@example.com> 4102444800 -1200',
      '',
      'Extreme timezone commit'
    ].join('\n'));

    const parsed = GitParser.parseCommit(syntheticCommit);
    assert.strictEqual(parsed.author.timestamp, 4102444800);
    assert.strictEqual(parsed.author.tz, '+1400');
    assert.strictEqual(parsed.committer.tz, '-1200');
  });
});
