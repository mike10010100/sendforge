/**
 * Tier 2 - Boundary B26: Search Highlight Boundaries & Special Characters (B26 / R2)
 *
 * Validates:
 * 1. Empty search query "" returns original tokens without modification
 * 2. Search query containing regex special characters (.*+?^${}()|[]\) treated as literal text
 * 3. Search query containing HTML characters (<script>, &amp;, "test") safely escaped
 * 4. Search query longer than line length returns unmodified tokens
 * 5. Unicode emoji and non-ASCII search queries (🎉, 日本語) matched accurately
 */

import { describe, it, assert } from '../harness/framework.js';
import { SyntaxValidator } from '../harness/syntax_helper.js';

describe('Tier 2 - Boundary B26: Search Highlighting Boundaries (B26 / R2)', () => {
  it('B26.1: Empty search query "" returns original tokens without modification', () => {
    const tokens = [{ type: 'keyword', text: 'return' }, { type: 'number', text: '42' }];
    const out = SyntaxValidator.applySearchHighlight(tokens, '');
    assert.notIncludes(out, '<mark');
  });

  it('B26.2: Search query containing regex special characters (.*+?^${}()|[]\\) treated as literal text', () => {
    const tokens = [{ type: 'plain', text: 'if (x.match(/^[0-9]+$/)) { return true; }' }];
    const result = SyntaxValidator.applySearchHighlight(tokens, '^[0-9]+$');

    assert.includes(result, '<mark class="search-match">^[0-9]+$</mark>');
  });

  it('B26.3: Search query containing HTML characters (<script>, &amp;, "test") safely escaped', () => {
    const tokens = [{ type: 'string', text: '"<script>alert(1)</script>"' }];
    const result = SyntaxValidator.applySearchHighlight(tokens, '<script>');

    assert.notIncludes(result, '<script>');
    assert.includes(result, '<mark class="search-match">&lt;script&gt;</mark>');
  });

  it('B26.4: Search query longer than line length returns unmodified tokens', () => {
    const tokens = [{ type: 'plain', text: 'short line' }];
    const result = SyntaxValidator.applySearchHighlight(tokens, 'very long search query exceeding line length');

    assert.notIncludes(result, '<mark');
    assert.includes(result, 'short line');
  });

  it('B26.5: Unicode emoji and non-ASCII search queries (🎉, 日本語) matched accurately', () => {
    const tokens = [{ type: 'comment', text: '// Release 🎉 version 日本語 support' }];
    const resEmoji = SyntaxValidator.applySearchHighlight(tokens, '🎉');
    assert.includes(resEmoji, '<mark class="search-match">🎉</mark>');

    const resJapanese = SyntaxValidator.applySearchHighlight(tokens, '日本語');
    assert.includes(resJapanese, '<mark class="search-match">日本語</mark>');
  });
});
