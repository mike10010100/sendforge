/**
 * Tier 2 - Boundary B15: Permalink & URL Hash Boundary Cases (B15)
 * Tests degenerate single-line ranges (#L1-L1), inverted ranges (#L50-L10),
 * out-of-bounds line numbers, malformed hash formats, and hash preservation.
 */

import { describe, it, assert } from '../harness/framework.js';

describe('Tier 2 - Boundary B15: Permalink & URL Hash Boundary Cases (B15)', () => {
  const parseLineHash = (hash) => {
    if (!hash) return null;
    const match = hash.match(/#L(\d+)(?:-L(\d+))?$/);
    if (!match) return null;
    const start = parseInt(match[1], 10);
    const end = match[2] ? parseInt(match[2], 10) : start;
    if (Number.isNaN(start) || Number.isNaN(end) || start < 1 || end < 1) return null;
    return { start: Math.min(start, end), end: Math.max(start, end) };
  };

  const formatLineHash = (start, end) => {
    if (!start || start < 1) return '';
    if (!end || end === start) return `#L${start}`;
    const min = Math.min(start, end);
    const max = Math.max(start, end);
    return `#L${min}-L${max}`;
  };

  it('B15.1: Degenerate single-line ranges (#L15-L15) normalize to #L15', () => {
    const parsed = parseLineHash('#L15-L15');
    assert.ok(parsed);
    assert.strictEqual(parsed.start, 15);
    assert.strictEqual(parsed.end, 15);

    const formatted = formatLineHash(parsed.start, parsed.end);
    assert.strictEqual(formatted, '#L15');
  });

  it('B15.2: Inverted line range (#L50-L10) normalizes to start=10, end=50', () => {
    const parsed = parseLineHash('#L50-L10');
    assert.ok(parsed);
    assert.strictEqual(parsed.start, 10);
    assert.strictEqual(parsed.end, 50);

    const formatted = formatLineHash(50, 10);
    assert.strictEqual(formatted, '#L10-L50');
  });

  it('B15.3: Out-of-bounds line numbers are safely clamped to file line count', () => {
    const totalLines = 100;
    const range = parseLineHash('#L80-L99999');
    assert.ok(range);

    const clampRange = (r, maxLines) => ({
      start: Math.min(r.start, maxLines),
      end: Math.min(r.end, maxLines)
    });

    const clamped = clampRange(range, totalLines);
    assert.strictEqual(clamped.start, 80);
    assert.strictEqual(clamped.end, 100);
  });

  it('B15.4: Malformed and empty hash tokens return null without throwing errors', () => {
    assert.strictEqual(parseLineHash(''), null);
    assert.strictEqual(parseLineHash('#'), null);
    assert.strictEqual(parseLineHash('#L'), null);
    assert.strictEqual(parseLineHash('#Lfoo'), null);
    assert.strictEqual(parseLineHash('#L-10'), null);
    assert.strictEqual(parseLineHash('#L0'), null);
    assert.strictEqual(parseLineHash('#heading-anchor'), null);
    assert.strictEqual(parseLineHash('#/tree/main/src'), null);
  });

  it('B15.5: URL hash preservation during branch/commit ref switching', () => {
    const switchRefPreservingHash = (currentUrl, newRef) => {
      // currentUrl: #/blob/main/src/App.tsx#L10-L20
      const hashIdx = currentUrl.indexOf('#L');
      const lineHash = hashIdx !== -1 ? currentUrl.slice(hashIdx) : '';
      const baseRoute = hashIdx !== -1 ? currentUrl.slice(0, hashIdx) : currentUrl;

      // Extract parts: #/blob/{ref}/{path}
      const match = baseRoute.match(/^#\/?blob\/([^/]+)\/(.+)$/);
      if (match) {
        const filePath = match[2];
        return `#/blob/${encodeURIComponent(newRef)}/${filePath}${lineHash}`;
      }
      return `#/tree/${encodeURIComponent(newRef)}`;
    };

    const newUrl = switchRefPreservingHash('#/blob/main/src/App.tsx#L10-L20', 'feature/new-ui');
    assert.strictEqual(newUrl, '#/blob/feature%2Fnew-ui/src/App.tsx#L10-L20');
  });
});
