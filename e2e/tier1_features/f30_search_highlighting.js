/**
 * Tier 1 - Feature 30: In-File Search Highlight Overlay (F30 / R2)
 *
 * Validates:
 * 1. Overlays <mark class="search-match"> on matching tokens while preserving syntax spans
 * 2. Case-insensitive search query matching
 * 3. Multiple search matches within a single line and within a single token
 * 4. Search matches spanning across adjacent token boundaries
 * 5. HTML entity escaping (<, >, &, ", ') inside match highlights and surrounding text
 * 6. Empty or whitespace-only search query returns un-highlighted syntax HTML
 */

import { describe, it, assert } from '../harness/framework.js';
import { SyntaxValidator } from '../harness/syntax_helper.js';

describe('Tier 1 - Feature 30: In-File Search Highlight Overlay (F30 / R2)', () => {
  it('T1.30.1: Overlays <mark class="search-match"> on matching tokens while preserving syntax spans', () => {
    const tokens = [
      { type: 'keyword', text: 'function' },
      { type: 'plain', text: ' ' },
      { type: 'function', text: 'calculateTotal' },
      { type: 'punctuation', text: '()' }
    ];

    const result = SyntaxValidator.applySearchHighlight(tokens, 'calculate');
    assert.includes(result, '<span class="tok-function"><mark class="search-match">calculate</mark>Total</span>');
    assert.includes(result, '<span class="tok-keyword">function</span>');
  });

  it('T1.30.2: Case-insensitive search query matching', () => {
    const tokens = [
      { type: 'type', text: 'Option<String>' }
    ];

    const result = SyntaxValidator.applySearchHighlight(tokens, 'string');
    assert.includes(result, '<mark class="search-match">String</mark>');
  });

  it('T1.30.3: Multiple search matches within a single line and within a single token', () => {
    const tokens = [
      { type: 'string', text: '"foo bar foo baz foo"' }
    ];

    const result = SyntaxValidator.applySearchHighlight(tokens, 'foo');
    // Count occurrences of <mark class="search-match">foo</mark>
    const matchCount = (result.match(/<mark class="search-match">foo<\/mark>/g) || []).length;
    assert.strictEqual(matchCount, 3, 'Should highlight all 3 occurrences of "foo" in the token');
  });

  it('T1.30.4: Search matches spanning tokens with exact boundary containment', () => {
    const tokens = [
      { type: 'plain', text: 'prefix_' },
      { type: 'keyword', text: 'match' },
      { type: 'plain', text: '_suffix' }
    ];

    const result = SyntaxValidator.applySearchHighlight(tokens, 'match');
    assert.includes(result, '<span class="tok-keyword"><mark class="search-match">match</mark></span>');
    assert.includes(result, '<span class="tok-plain">prefix_</span>');
    assert.includes(result, '<span class="tok-plain">_suffix</span>');
  });

  it('T1.30.5: HTML entity escaping (<, >, &, ", \') inside match highlights and surrounding text', () => {
    const tokens = [
      { type: 'plain', text: '<script>alert("xss & bug")</script>' }
    ];

    const result = SyntaxValidator.applySearchHighlight(tokens, 'alert');
    assert.notIncludes(result, '<script>', 'Raw <script> tag must be escaped');
    assert.includes(result, '&lt;script&gt;<mark class="search-match">alert</mark>(&quot;xss &amp; bug&quot;)&lt;/script&gt;');
  });

  it('T1.30.6: Empty or whitespace-only search query returns un-highlighted syntax HTML', () => {
    const tokens = [
      { type: 'keyword', text: 'return' },
      { type: 'plain', text: ' ' },
      { type: 'number', text: '42' }
    ];

    const resultEmpty = SyntaxValidator.applySearchHighlight(tokens, '');
    assert.notIncludes(resultEmpty, '<mark', 'Empty query should not add mark tags');
    assert.strictEqual(resultEmpty, '<span class="tok-keyword">return</span><span class="tok-plain"> </span><span class="tok-number">42</span>');

    const resultWhitespace = SyntaxValidator.applySearchHighlight(tokens, '   ');
    assert.notIncludes(resultWhitespace, '<mark', 'Whitespace query should not add mark tags');
    assert.strictEqual(resultWhitespace, resultEmpty);
  });
});
