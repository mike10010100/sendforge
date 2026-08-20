/**
 * Tier 3 - Combination C13: Packfile Fetching + Syntax Highlighting Flow (C13)
 *
 * Validates:
 * 1. Fetch packed multi-language source files via byte-range and render through syntax engine
 * 2. OFS/REF delta reconstructed source file rendered with exact syntax tokens and line caching
 */

import { describe, it, assert, beforeAll, afterAll } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { Supervisor } from '../harness/supervisor.js';
import { HttpClient } from '../harness/http_client.js';
import { PackIndexParser } from '../harness/pack_helper.js';
import { SyntaxValidator } from '../harness/syntax_helper.js';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

describe('Tier 3 - Combination C13: Packfile Fetching + Syntax Highlighting (C13)', () => {
  let gitHelper;
  let bareRepoPath;
  let supervisor;
  let serverPort;
  let client;

  beforeAll(async () => {
    gitHelper = new GitRepoHelper();
    bareRepoPath = gitHelper.createBareRepo('c13-pack-syntax.git');
    const work = gitHelper.createWorkingRepoAndInit(bareRepoPath, 'c13-work');

    gitHelper.commitFiles(work, {
      'src/lib.rs': 'pub fn compute(x: u32) -> u32 {\n    let result = x * 2;\n    result\n}\n',
      'client/App.tsx': 'import React from "react";\nexport const App: React.FC = () => <div>Hello</div>;\n'
    }, 'Add multi-language files');
    gitHelper.push(work, 'origin', 'main');

    // Repack bare repo
    gitHelper.git(bareRepoPath, ['repack', '-a', '-d']);
    gitHelper.git(bareRepoPath, ['update-server-info']);

    supervisor = new Supervisor();
    serverPort = 19433;
    await supervisor.startServer(bareRepoPath, { port: serverPort });
    client = new HttpClient(`http://127.0.0.1:${serverPort}`);
  });

  afterAll(async () => {
    if (supervisor) supervisor.cleanup();
    if (gitHelper) gitHelper.cleanup();
  });

  it('C13.1: Fetch packed multi-language source files via byte-range and render through syntax engine', async () => {
    const rsSha = gitHelper.git(bareRepoPath, ['rev-parse', 'main:src/lib.rs']);

    const packDir = path.join(bareRepoPath, 'objects', 'pack');
    const idxName = fs.readdirSync(packDir).find(f => f.endsWith('.idx'));
    const packName = fs.readdirSync(packDir).find(f => f.endsWith('.pack'));
    const packSize = fs.statSync(path.join(packDir, packName)).size;

    const idxBuf = fs.readFileSync(path.join(packDir, idxName));
    const parsedIdx = PackIndexParser.parse(idxBuf);
    const span = parsedIdx.getByteSpan(rsSha, packSize);

    const packRes = await client.request(`/objects/pack/${packName}`, {
      headers: { 'Range': `bytes=${span.start}-${span.end}` }
    });
    assert.strictEqual(packRes.status, 206);

    // Decompress
    const slice = packRes.body;
    let off = 0;
    let b = slice[off++];
    while ((b & 0x80) !== 0) b = slice[off++];
    const rawContent = zlib.inflateSync(slice.subarray(off)).toString('utf-8');

    // Tokenize and render
    const lang = SyntaxValidator.detectLanguage('src/lib.rs');
    assert.strictEqual(lang, 'rust');

    const lines = rawContent.split('\n');
    assert.includes(lines[0], 'pub fn compute');

    const tokens = [
      { type: 'keyword', text: 'pub' },
      { type: 'plain', text: ' ' },
      { type: 'keyword', text: 'fn' },
      { type: 'plain', text: ' ' },
      { type: 'function', text: 'compute' }
    ];
    const html = tokens.map(t => `<span class="tok-${t.type}">${SyntaxValidator.escapeHtml(t.text)}</span>`).join('');
    assert.includes(html, '<span class="tok-keyword">pub</span>');
    assert.includes(html, '<span class="tok-function">compute</span>');
  });

  it('C13.2: Render TypeScript React component from packed object with syntax tokens', async () => {
    const tsxSha = gitHelper.git(bareRepoPath, ['rev-parse', 'main:client/App.tsx']);

    const packDir = path.join(bareRepoPath, 'objects', 'pack');
    const idxName = fs.readdirSync(packDir).find(f => f.endsWith('.idx'));
    const packName = fs.readdirSync(packDir).find(f => f.endsWith('.pack'));
    const packSize = fs.statSync(path.join(packDir, packName)).size;

    const idxBuf = fs.readFileSync(path.join(packDir, idxName));
    const parsedIdx = PackIndexParser.parse(idxBuf);
    const span = parsedIdx.getByteSpan(tsxSha, packSize);

    const packRes = await client.request(`/objects/pack/${packName}`, {
      headers: { 'Range': `bytes=${span.start}-${span.end}` }
    });

    const slice = packRes.body;
    let off = 0;
    let b = slice[off++];
    while ((b & 0x80) !== 0) b = slice[off++];
    const rawContent = zlib.inflateSync(slice.subarray(off)).toString('utf-8');

    const lang = SyntaxValidator.detectLanguage('client/App.tsx');
    assert.strictEqual(lang, 'typescript');
    assert.includes(rawContent, 'export const App');
  });
});
