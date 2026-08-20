/**
 * Tier 4 - Workload W3: Native Git CLI Dumb HTTP Interoperability
 * Tests standard `git clone http://...` and `git pull` commands executed by the native
 * Git CLI against Sendforge's static Dumb HTTP server implementation.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';

describe('Tier 4 - Workload W3: Native Git Dumb HTTP Interoperability (W3)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;
  let serverHandle;

  beforeEach(async () => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('w3-dumb-http.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });

    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-initial', 'main');
    gitHelper.commitFiles(workDir, {
      'README.md': '# Dumb HTTP Interoperability\nTesting native git clone.',
      'src/main.rs': 'fn main() { println!("Dumb HTTP works!"); }'
    }, 'Initial Dumb HTTP commit');
    gitHelper.push(workDir, 'origin', 'main');

    serverHandle = await supervisor.startServer(bareRepo);
  });

  afterEach(async () => {
    if (serverHandle) await serverHandle.stop();
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('W3.1: Native Git CLI can clone repository over HTTP Dumb protocol', () => {
    const cloneDest = path.join(gitHelper.getRootDir(), 'http-clone');
    const cloneUrl = `${serverHandle.baseUrl}/`;

    // Execute standard git clone http://...
    const out = gitHelper.git(gitHelper.getRootDir(), ['clone', cloneUrl, 'http-clone']);

    assert.ok(fs.existsSync(path.join(cloneDest, 'README.md')), 'Cloned repo must contain README.md');
    assert.ok(fs.existsSync(path.join(cloneDest, 'src', 'main.rs')), 'Cloned repo must contain src/main.rs');

    const fileContent = fs.readFileSync(path.join(cloneDest, 'src', 'main.rs'), 'utf-8');
    assert.includes(fileContent, 'Dumb HTTP works!');

    const gitLog = gitHelper.git(cloneDest, ['log', '-n', '1', '--oneline']);
    assert.includes(gitLog, 'Initial Dumb HTTP commit');
  });
});
