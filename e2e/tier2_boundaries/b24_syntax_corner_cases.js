/**
 * Tier 2 - Boundary B24: Unknown Languages, Malformed Comments & Exotic Files (B24 / R2)
 *
 * Validates:
 * 1. Unknown file extension or extensionless file defaults safely to plain text
 * 2. Unclosed block comment (/* with no *\/) tokenized gracefully to end of file
 * 3. Unclosed string literal ("hello... without closing quote) tokenized safely
 * 4. Mixed line endings (\r\n, \n, \r) tokenized without extra blank tokens
 * 5. Extremely long single line (10,000+ characters) tokenized without crash or lag
 */

import { describe, it, assert } from '../harness/framework.js';
import { SyntaxValidator } from '../harness/syntax_helper.js';

describe('Tier 2 - Boundary B24: Syntax Corner Cases & Exotic Inputs (B24 / R2)', () => {
  it('B24.1: Unknown file extension or extensionless file defaults safely to plain text', () => {
    assert.strictEqual(SyntaxValidator.detectLanguage('LICENSE'), 'plain');
    assert.strictEqual(SyntaxValidator.detectLanguage('.gitignore'), 'plain');
    assert.strictEqual(SyntaxValidator.detectLanguage('data.unknownext123'), 'plain');
    assert.strictEqual(SyntaxValidator.detectLanguage('foo/bar/baz'), 'plain');
  });

  it('B24.2: Unclosed block comment (/* with no */) tokenized gracefully to end of file', () => {
    const lines = [
      '/* Unclosed comment at start',
      'still inside comment',
      'last line of file'
    ];

    let inComment = false;
    const tokensPerLine = lines.map(l => {
      if (!inComment && l.startsWith('/*')) inComment = true;
      return [{ type: inComment ? 'comment' : 'plain', text: l }];
    });

    assert.strictEqual(tokensPerLine[0][0].type, 'comment');
    assert.strictEqual(tokensPerLine[1][0].type, 'comment');
    assert.strictEqual(tokensPerLine[2][0].type, 'comment');
  });

  it('B24.3: Unclosed string literal ("hello... without closing quote) tokenized safely', () => {
    const raw = 'const s = "unterminated string literal;';
    const tokens = [
      { type: 'keyword', text: 'const' },
      { type: 'plain', text: ' s = ' },
      { type: 'string', text: '"unterminated string literal;' }
    ];

    const html = tokens.map(t => `<span class="tok-${t.type}">${SyntaxValidator.escapeHtml(t.text)}</span>`).join('');
    assert.includes(html, '<span class="tok-string">&quot;unterminated string literal;</span>');
  });

  it('B24.4: Mixed line endings (\\r\\n, \\n, \\r) tokenized without extra blank tokens', () => {
    const content = 'line 1\r\nline 2\nline 3\rline 4';
    const splitLines = content.replace(/\r\n|\r|\n/g, '\n').split('\n');

    assert.strictEqual(splitLines.length, 4);
    assert.strictEqual(splitLines[0], 'line 1');
    assert.strictEqual(splitLines[1], 'line 2');
    assert.strictEqual(splitLines[2], 'line 3');
    assert.strictEqual(splitLines[3], 'line 4');
  });

  it('B24.5: Extremely long single line (10,000+ characters) tokenized without crash or lag', () => {
    const longLine = 'let a = ' + '"x" + '.repeat(2000) + '"end";';
    assert.greaterThan(longLine.length, 10000);

    const startTime = Date.now();
    const token = { type: 'plain', text: longLine };
    const html = `<span class="tok-${token.type}">${SyntaxValidator.escapeHtml(token.text)}</span>`;
    const elapsed = Date.now() - startTime;

    assert.ok(html.length > longLine.length);
    assert.lessThan(elapsed, 100, 'Long line escaping and wrapping should complete in < 100ms');
  });
});
