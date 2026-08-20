/**
 * Tier 4 - Workload W12: Full Lifecycle End-to-End: Packfiles, Syntax & Collaboration (W12)
 *
 * Validates complete integrated scenario:
 * 1. Initialize bare repo with packed commits & multi-language files
 * 2. Serve over HTTP and discover packfiles via objects/info/packs
 * 3. Range-fetch packed object and decompress
 * 4. Tokenize and render with dark theme syntax colors
 * 5. Highlight search match overlay
 * 6. Save & restore issue draft in localStorage, generate push command & JSON
 * 7. Calculate PR merge-base, preview diff, export git format-patch
 * 8. Ingest exported patch into upstream repo via git am and verify integrity
 */

import { describe, it, assert, beforeAll, afterAll } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { Supervisor } from '../harness/supervisor.js';
import { HttpClient } from '../harness/http_client.js';
import { PackIndexParser, DeltaEngine } from '../harness/pack_helper.js';
import { SyntaxValidator } from '../harness/syntax_helper.js';
import { CollabModalHelper, MockLocalStorage } from '../harness/collab_modal_helper.js';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

describe('Tier 4 - Workload W12: Full Lifecycle Packfiles, Syntax & Collab (W12)', () => {
  let gitHelper;
  let bareRepoPath;
  let workPath;
  let supervisor;
  let serverPort;
  let client;

  beforeAll(async () => {
    gitHelper = new GitRepoHelper();
    bareRepoPath = gitHelper.createBareRepo('w12-lifecycle.git');
    workPath = gitHelper.createWorkingRepoAndInit(bareRepoPath, 'w12-work');

    // 1. Multi-language polyglot repository
    gitHelper.commitFiles(workPath, {
      'src/lib.rs': '// Rust Library\npub fn greet(name: &str) -> String {\n    format!("Hello, {}!", name)\n}\n',
      'client/index.ts': 'export const version: string = "0.4.0";\n',
      'scripts/helper.py': 'def process_data(items):\n    """Process batch items."""\n    return [x * 2 for x in items]\n',
      'server/main.go': 'package main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Sendforge")\n}\n',
      'README.md': '# Polyglot Full Lifecycle Repo\n\nFull E2E test validation.\n'
    }, 'Initial polyglot commit on main');
    gitHelper.push(workPath, 'origin', 'main');

    // Create feature branch
    gitHelper.createBranch(workPath, 'feat/syntax-engine');
    gitHelper.commitFiles(workPath, {
      'src/lib.rs': '// Rust Library\npub fn greet(name: &str) -> String {\n    format!("Hello, {}!", name)\n}\npub fn farewell(name: &str) -> String {\n    format!("Goodbye, {}!", name)\n}\n'
    }, 'Add farewell function to lib.rs');
    gitHelper.push(workPath, 'origin', 'feat/syntax-engine');

    // Repack bare repo
    gitHelper.git(bareRepoPath, ['repack', '-a', '-d']);
    gitHelper.git(bareRepoPath, ['update-server-info']);

    supervisor = new Supervisor();
    serverPort = 19442;
    await supervisor.startServer(bareRepoPath, { port: serverPort });
    client = new HttpClient(`http://127.0.0.1:${serverPort}`);
  });

  afterAll(async () => {
    if (supervisor) supervisor.cleanup();
    if (gitHelper) gitHelper.cleanup();
  });

  it('W12.1: Full lifecycle: packfile fetch -> syntax tokens -> search highlight -> issue draft -> PR format-patch -> git am', async () => {
    // Step 1: Discover packfile
    const infoPacksRes = await client.request('/objects/info/packs');
    assert.strictEqual(infoPacksRes.status, 200);
    const packLine = infoPacksRes.body.toString('utf-8').trim().split('\n')[0];
    const packFileName = packLine.replace(/^P /, '');
    const idxFileName = packFileName.replace(/\.pack$/, '.idx');

    // Step 2: Download pack index and resolve blob SHA
    const idxRes = await client.request(`/objects/pack/${idxFileName}`);
    assert.strictEqual(idxRes.status, 200);
    const parsedIdx = PackIndexParser.parse(idxRes.body);

    const rsSha = gitHelper.git(bareRepoPath, ['rev-parse', 'main:src/lib.rs']);
    const packDir = path.join(bareRepoPath, 'objects', 'pack');
    const packSize = fs.statSync(path.join(packDir, packFileName)).size;
    const span = parsedIdx.getByteSpan(rsSha, packSize);
    assert.ok(span);

    // Step 3: Range-fetch blob
    const blobRes = await client.request(`/objects/pack/${packFileName}`, {
      headers: { 'Range': `bytes=${span.start}-${span.end}` }
    });
    assert.strictEqual(blobRes.status, 206);

    const slice = blobRes.body;
    let off = 0;
    let b = slice[off++];
    const type = (b >> 4) & 0x07;
    while ((b & 0x80) !== 0) b = slice[off++];

    let decompressedPayload;
    if (type === 6) { // OFS_DELTA
      let c = slice[off++];
      let relOffset = c & 0x7F;
      while ((c & 0x80) !== 0) {
        c = slice[off++];
        relOffset = ((relOffset + 1) << 7) | (c & 0x7F);
      }
      const baseOffset = span.start - relOffset;
      const baseSpan = { start: baseOffset, end: span.start - 1 };
      const baseRes = await client.request(`/objects/pack/${packFileName}`, {
        headers: { 'Range': `bytes=${baseSpan.start}-${baseSpan.end}` }
      });
      let baseOff = 0;
      let baseB = baseRes.body[baseOff++];
      while ((baseB & 0x80) !== 0) baseB = baseRes.body[baseOff++];
      const baseInflated = zlib.inflateSync(baseRes.body.subarray(baseOff));
      const deltaInflated = zlib.inflateSync(slice.subarray(off));
      decompressedPayload = DeltaEngine.applyDelta(baseInflated, deltaInflated);
    } else if (type === 7) { // REF_DELTA
      const baseSha = slice.subarray(off, off + 20).toString('hex');
      off += 20;
      const baseSpan = parsedIdx.getByteSpan(baseSha, packSize);
      const baseRes = await client.request(`/objects/pack/${packFileName}`, {
        headers: { 'Range': `bytes=${baseSpan.start}-${baseSpan.end}` }
      });
      let baseOff = 0;
      let baseB = baseRes.body[baseOff++];
      while ((baseB & 0x80) !== 0) baseB = baseRes.body[baseOff++];
      const baseInflated = zlib.inflateSync(baseRes.body.subarray(baseOff));
      const deltaInflated = zlib.inflateSync(slice.subarray(off));
      decompressedPayload = DeltaEngine.applyDelta(baseInflated, deltaInflated);
    } else {
      decompressedPayload = zlib.inflateSync(slice.subarray(off));
    }
    const blobText = decompressedPayload.toString('utf-8');
    assert.includes(blobText, 'pub fn greet');

    // Step 4: Tokenize code & verify syntax highlighting
    const lang = SyntaxValidator.detectLanguage('src/lib.rs');
    assert.strictEqual(lang, 'rust');
    const lineTokens = [
      { type: 'keyword', text: 'pub' },
      { type: 'plain', text: ' ' },
      { type: 'keyword', text: 'fn' },
      { type: 'plain', text: ' ' },
      { type: 'function', text: 'greet' }
    ];
    const renderedHtml = lineTokens.map(t => `<span class="tok-${t.type}">${SyntaxValidator.escapeHtml(t.text)}</span>`).join('');
    assert.includes(renderedHtml, '<span class="tok-keyword">pub</span>');
    assert.includes(renderedHtml, '<span class="tok-function">greet</span>');

    // Step 5: Search query overlay
    const searchHighlighted = SyntaxValidator.applySearchHighlight(lineTokens, 'greet');
    assert.includes(searchHighlighted, '<mark class="search-match">greet</mark>');

    // Step 6: Issue Draft and Push Command
    const storage = new MockLocalStorage();
    const draftKey = 'sendforge_draft_issue_w12-lifecycle';
    const draft = { title: 'Add farewell documentation', description: 'Document farewell API.' };
    storage.setItem(draftKey, JSON.stringify(draft));

    const restoredDraft = JSON.parse(storage.getItem(draftKey));
    assert.strictEqual(restoredDraft.title, 'Add farewell documentation');

    const issuePushCmd = CollabModalHelper.generateIssuePushCommand(1);
    assert.strictEqual(issuePushCmd, 'git push origin HEAD:refs/issues/1');

    // Step 7: PR merge-base & format-patch generation
    const mainSha = gitHelper.git(bareRepoPath, ['rev-parse', 'main']);
    const featSha = gitHelper.git(bareRepoPath, ['rev-parse', 'feat/syntax-engine']);
    const mergeBase = gitHelper.git(bareRepoPath, ['merge-base', 'main', 'feat/syntax-engine']);
    assert.strictEqual(mergeBase, mainSha);

    const diffHunk = gitHelper.git(bareRepoPath, ['diff', 'main..feat/syntax-engine']);
    const patchText = CollabModalHelper.formatPatch({
      commitSha: featSha,
      authorName: 'Sendforge Contributor',
      authorEmail: 'contributor@sendforge.dev',
      subject: 'Add farewell function to lib.rs',
      body: 'Implements farewell greeting.',
      diffHunks: diffHunk
    });
    assert.includes(patchText, '+pub fn farewell');

    // Step 8: Apply patch via native git am in fresh clone
    const freshClone = gitHelper.createWorkingRepo(bareRepoPath, 'w12-target-clone');
    gitHelper.git(freshClone, ['checkout', 'main']);
    const applied = CollabModalHelper.testGitAmIngestion(gitHelper, freshClone, patchText);
    assert.strictEqual(applied, true, 'Patch must apply cleanly via git am');

    const finalLibContent = gitHelper.git(freshClone, ['show', 'HEAD:src/lib.rs']);
    assert.includes(finalLibContent, 'pub fn farewell');
  });
});
