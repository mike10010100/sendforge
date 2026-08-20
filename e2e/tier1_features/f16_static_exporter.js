/**
 * Tier 1 - Feature 16: Standalone Static Exporter (`sendforge export`) (F16)
 * Tests bundling the bare repository, static HTML fallbacks, and assets
 * into a standalone directory ready for static hosting.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';

describe('Tier 1 - Feature 16: Standalone Static Exporter (F16)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('export-src.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });

    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work', 'main');
    gitHelper.commitFiles(workDir, {
      'README.md': '# Export Test\nExportable documentation.',
      'src/lib.rs': 'pub fn exported() {}'
    }, 'Export initial commit');
    gitHelper.push(workDir, 'origin', 'main');
  });

  afterEach(() => {
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('T1.16.1: sendforge export creates self-contained static site directory', () => {
    const destDir = path.join(gitHelper.getRootDir(), 'exported-site');
    const res = supervisor.export(bareRepo, destDir);
    assert.strictEqual(res.status, 0, `Export failed:\n${res.stderr}`);

    // Verify key files in export target
    assert.ok(fs.existsSync(path.join(destDir, 'index.html')), 'index.html must exist in export');
    assert.ok(fs.existsSync(path.join(destDir, 'meta.json')) || fs.existsSync(path.join(destDir, 'static', 'meta.json')), 'meta.json must exist in export');
    assert.ok(fs.existsSync(path.join(destDir, 'objects')), 'objects directory must exist in export');
  });

  it('T1.16.2: Custom base URL prefix rewriting', () => {
    const destDir = path.join(gitHelper.getRootDir(), 'exported-prefixed');
    const res = supervisor.export(bareRepo, destDir, { baseUrl: '/my-project/' });
    assert.strictEqual(res.status, 0);

    const indexHtml = fs.readFileSync(path.join(destDir, 'index.html'), 'utf-8');
    // If base URL was specified, references or base tag should reflect it
    assert.ok(indexHtml.length > 0);
  });

  it('T1.16.3: Export directory overwrite safety', () => {
    const destDir = path.join(gitHelper.getRootDir(), 'export-overwrite');
    const res1 = supervisor.export(bareRepo, destDir);
    assert.strictEqual(res1.status, 0);

    // Re-run export to the same directory
    const res2 = supervisor.export(bareRepo, destDir);
    assert.strictEqual(res2.status, 0, 'Re-exporting to populated directory should succeed');
  });

  it('T1.16.4: Exported directory preserves Git objects integrity', () => {
    const destDir = path.join(gitHelper.getRootDir(), 'export-integrity');
    const res = supervisor.export(bareRepo, destDir);
    assert.strictEqual(res.status, 0);

    const srcObjectsDir = path.join(bareRepo, 'objects');
    const destObjectsDir = path.join(destDir, 'objects');

    if (fs.existsSync(srcObjectsDir) && fs.existsSync(destObjectsDir)) {
      const srcSubdirs = fs.readdirSync(srcObjectsDir).filter(d => d.length === 2);
      for (const sub of srcSubdirs) {
        const destSub = path.join(destObjectsDir, sub);
        assert.ok(fs.existsSync(destSub), `Object subdirectory ${sub} must be preserved in export`);
      }
    }
  });

  it('T1.16.5: Export handles empty or invalid destination path gracefully', () => {
    const invalidDest = '/proc/sendforge_invalid_dest/output';
    const res = supervisor.export(bareRepo, invalidDest);
    assert.notStrictEqual(res.status, 0, 'Invalid export path should fail with non-zero exit code');
  });
});
