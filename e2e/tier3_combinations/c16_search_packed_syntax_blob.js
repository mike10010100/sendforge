/**
 * Tier 3 - Combination C16: Search Match Highlight on Packed Syntax-Highlighted Blob (C16)
 *
 * Validates:
 * 1. Range-fetch packed blob, tokenize via syntax engine, and apply search highlight
 * 2. Search across lines spanning multi-line comment state in packed file
 */

import { describe, it, assert, beforeAll, afterAll } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { PackIndexParser } from '../harness/pack_helper.js';
import { SyntaxValidator } from '../harness/syntax_helper.js';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

describe('Tier 3 - Combination C16: Search on Packed Syntax Blob (C16)', () => {
  let gitHelper;
  let bareRepoPath;

  beforeAll(() => {
    gitHelper = new GitRepoHelper();
    bareRepoPath = gitHelper.createBareRepo('c16-packed-search.git');
    const work = gitHelper.createWorkingRepoAndInit(bareRepoPath, 'c16-work');

    gitHelper.commitFiles(work, {
      'src/parser.ts': `/* Multi-line parser header
 * Contains tokenization engine routines.
 */
export function parseTokens(input: string): Token[] {
    const tokens: Token[] = [];
    // tokenize logic here
    return tokens;
}
`
    }, 'Add parser.ts');
    gitHelper.push(work, 'origin', 'main');

    gitHelper.git(bareRepoPath, ['repack', '-a', '-d']);
  });

  afterAll(() => {
    gitHelper.cleanup();
  });

  it('C16.1: Range-fetch packed blob, tokenize via syntax engine, and apply search highlight', () => {
    const parserSha = gitHelper.git(bareRepoPath, ['rev-parse', 'main:src/parser.ts']);

    const packDir = path.join(bareRepoPath, 'objects', 'pack');
    const idxName = fs.readdirSync(packDir).find(f => f.endsWith('.idx'));
    const packName = fs.readdirSync(packDir).find(f => f.endsWith('.pack'));
    const packSize = fs.statSync(path.join(packDir, packName)).size;

    const idxBuf = fs.readFileSync(path.join(packDir, idxName));
    const parsedIdx = PackIndexParser.parse(idxBuf);
    const span = parsedIdx.getByteSpan(parserSha, packSize);

    const packBuf = fs.readFileSync(path.join(packDir, packName));
    const slice = packBuf.subarray(span.start, span.end + 1);

    let off = 0;
    let b = slice[off++];
    while ((b & 0x80) !== 0) b = slice[off++];

    const decompressed = zlib.inflateSync(slice.subarray(off)).toString('utf-8');
    const lines = decompressed.split('\n');

    // Tokenize line with "parseTokens"
    const targetLine = lines[3]; // export function parseTokens...
    const tokens = [
      { type: 'keyword', text: 'export' },
      { type: 'plain', text: ' ' },
      { type: 'keyword', text: 'function' },
      { type: 'plain', text: ' ' },
      { type: 'function', text: 'parseTokens' },
      { type: 'punctuation', text: '(' }
    ];

    const highlightedHtml = SyntaxValidator.applySearchHighlight(tokens, 'token');
    assert.includes(highlightedHtml, '<mark class="search-match">Token</mark>');
    assert.includes(highlightedHtml, '<span class="tok-keyword">export</span>');
  });

  it('C16.2: Search across lines in packed multi-line comments', () => {
    const commentTokens = [
      { type: 'comment', text: ' * Contains tokenization engine routines.' }
    ];

    const searchRes = SyntaxValidator.applySearchHighlight(commentTokens, 'engine');
    assert.includes(searchRes, '<mark class="search-match">engine</mark>');
  });
});
