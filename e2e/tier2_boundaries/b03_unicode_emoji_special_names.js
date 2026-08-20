/**
 * Tier 2 - Boundary B3: Unicode, Emoji, and Special Character Filenames
 * Tests handling of filenames with spaces, emojis, non-ASCII Unicode (Cyrillic, CJK, accents),
 * and special punctuation characters across tree parsing, HTML generation, and JSON.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { GitParser } from '../harness/git_parser.js';

describe('Tier 2 - Boundary B3: Unicode & Emoji Filenames (B3)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;

  beforeEach(() => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('b3-unicode.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });
  });

  afterEach(() => {
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('B3.1: Tree parser and static generator handle emoji, spaces, and multi-byte UTF-8 filenames', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-unicode', 'main');
    const unicodeFiles = {
      ' file with leading and trailing spaces .txt': 'spaces content',
      '🦀_crab_rust.rs': 'fn main() { println!("Ferris!"); }',
      '🚀_launch_mission.ts': 'export const launch = true;',
      'ünicode/файл_cyrillic.txt': 'cyrillic text',
      'chinese_中文_测试.md': '# 中文测试文档',
      'special-!@#$%^&()_+.txt': 'special chars'
    };

    gitHelper.commitFiles(workDir, unicodeFiles, 'Commit with diverse UTF-8 filenames');
    gitHelper.push(workDir, 'origin', 'main');

    const treeSha = gitHelper.git(workDir, ['rev-parse', 'HEAD^{tree}']);
    const obj = gitHelper.readLooseObject(bareRepo, treeSha);
    const entries = GitParser.parseTree(obj.payload);

    const names = entries.map(e => e.name);
    assert.includes(names, ' file with leading and trailing spaces .txt');
    assert.includes(names, '🦀_crab_rust.rs');
    assert.includes(names, '🚀_launch_mission.ts');
    assert.includes(names, 'ünicode');
    assert.includes(names, 'chinese_中文_测试.md');
    assert.includes(names, 'special-!@#$%^&()_+.txt');

    // Check nested directory
    const unicodeDirEntry = entries.find(e => e.name === 'ünicode');
    const subObj = gitHelper.readLooseObject(bareRepo, unicodeDirEntry.oid);
    const subEntries = GitParser.parseTree(subObj.payload);
    assert.strictEqual(subEntries[0].name, 'файл_cyrillic.txt');
  });

  it('B3.2: Static index.html fallback preserves Unicode characters without mojibake', () => {
    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-html-unicode', 'main');
    gitHelper.commitFiles(workDir, {
      'README.md': '# 🚀 Sendforge 世界\n\nSupporting emojis and international glyphs: 🦀, é, ñ, ü, 日, 본.',
      '🦀_ferris.rs': '// rust'
    }, 'Add unicode readme');
    gitHelper.push(workDir, 'origin', 'main');

    const html = fs.readFileSync(path.join(bareRepo, 'static', 'index.html'), 'utf-8');
    assert.includes(html, '🚀 Sendforge 世界');
    assert.includes(html, '🦀_ferris.rs');
    assert.includes(html, 'é, ñ, ü, 日, 본');
  });
});
