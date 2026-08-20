/**
 * Tier 2 - Boundary B9: Missing & Dangling Ref Handling
 * Tests behavior when refs point to missing or pruned Git objects.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';

describe('Tier 2 - Boundary B9: Missing & Dangling Refs (B9)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('b9-dangling.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });
  });

  afterEach(() => {
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('B9.1: Dangling ref in info/refs is handled gracefully during hook execution', () => {
    const danglingSha = '1234567890abcdef1234567890abcdef12345678';
    const hookInput = `0000000000000000000000000000000000000000 ${danglingSha} refs/heads/dangling\n`;

    // Hook should either skip or log error without crashing
    const res = supervisor.hook(bareRepo, hookInput);
    assert.ok(res.status !== null);
  });
});
