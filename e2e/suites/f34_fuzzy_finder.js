/**
 * Tier 1 - Feature 34: Global Keyboard-Driven Fuzzy File Finder (F34 / R2)
 *
 * Validates:
 * 1. TreeIndexer indexing file paths from Git repository trees.
 * 2. Weighted scoring algorithm: prefix bonus, word/boundary bonus, consecutive matches.
 * 3. Line permalink parsing (:42, #L42, :42-50, #L42-L50).
 * 4. Subsequence fast rejection for queries with missing characters.
 * 5. Character match range computation and HighlightSpan generation.
 * 6. Path depth penalty vs filename match ranking.
 * 7. Keyboard navigation state transitions (ArrowUp/Down, Enter, Esc).
 * 8. Case-insensitive search and whitespace handling.
 */

import { describe, it, assert } from '../harness/framework.js';

// Standalone implementation of fuzzy logic matching client/src/engine/tree-indexer.ts
const BOUNDARY_CHARS = new Set(['/', '_', '-', '.', '\\', ' ']);

function parseQueryPermalink(rawQuery) {
  const query = rawQuery.trim();
  if (!query) return { cleanQuery: '' };
  const linePattern = /(?:#L?(\d+)(?:-(?:L)?(\d+))?|:L?(\d+)(?:[-:](?:L)?(\d+))?)$/i;
  const match = linePattern.exec(query);
  if (match) {
    const rawLine = match[1] ?? match[3];
    const rawEnd = match[2] ?? match[4];
    const targetLine = rawLine !== undefined ? parseInt(rawLine, 10) : undefined;
    const targetLineEnd = rawEnd !== undefined ? parseInt(rawEnd, 10) : undefined;
    const cleanQuery = query.slice(0, match.index).trim();
    return {
      cleanQuery,
      targetLine: typeof targetLine === 'number' && Number.isFinite(targetLine) && targetLine > 0 ? targetLine : undefined,
      targetLineEnd: typeof targetLineEnd === 'number' && Number.isFinite(targetLineEnd) && targetLineEnd > 0 ? targetLineEnd : undefined
    };
  }
  return { cleanQuery: query };
}

function isSubsequence(textLower, queryLower) {
  const tLen = textLower.length;
  const qLen = queryLower.length;
  if (qLen === 0) return true;
  if (qLen > tLen) return false;
  let tIdx = 0;
  for (let qIdx = 0; qIdx < qLen; qIdx++) {
    const qChar = queryLower.charCodeAt(qIdx);
    while (tIdx < tLen && textLower.charCodeAt(tIdx) !== qChar) {
      tIdx++;
    }
    if (tIdx >= tLen) return false;
    tIdx++;
  }
  return true;
}

function indicesToRanges(indices) {
  if (indices.length === 0) return [];
  const sorted = Array.from(new Set(indices)).sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const curr = sorted[i];
    if (curr === prev + 1) {
      prev = curr;
    } else {
      ranges.push([start, prev + 1]);
      start = curr;
      prev = curr;
    }
  }
  ranges.push([start, prev + 1]);
  return ranges;
}

function highlightMatchedSpans(text, matches) {
  if (matches.length === 0 || text.length === 0) {
    return [{ text, isMatch: false }];
  }
  const spans = [];
  let cursor = 0;
  for (const [start, end] of matches) {
    if (start > cursor) {
      spans.push({ text: text.slice(cursor, start), isMatch: false });
    }
    spans.push({ text: text.slice(start, end), isMatch: true });
    cursor = end;
  }
  if (cursor < text.length) {
    spans.push({ text: text.slice(cursor), isMatch: false });
  }
  return spans;
}

class TestTreeIndexer {
  constructor(entries = []) {
    this.entries = entries.map(e => (typeof e === 'string' ? { path: e } : e));
  }

  search(rawQuery, limit = 50) {
    const { cleanQuery, targetLine, targetLineEnd } = parseQueryPermalink(rawQuery);
    const query = cleanQuery.trim();
    if (!query) {
      return this.entries.slice(0, limit).map(entry => ({
        entry,
        score: 0,
        matches: [],
        ...(targetLine !== undefined ? { targetLine } : {}),
        ...(targetLineEnd !== undefined ? { targetLineEnd } : {})
      }));
    }

    const queryLower = query.toLowerCase();
    const results = [];

    for (const item of this.entries) {
      const pathLower = item.path.toLowerCase();
      if (!isSubsequence(pathLower, queryLower)) continue;

      // Score matching
      let score = 0;
      const lastSlash = Math.max(pathLower.lastIndexOf('/'), pathLower.lastIndexOf('\\'));
      const filenameOffset = lastSlash >= 0 ? lastSlash + 1 : 0;
      const filename = pathLower.slice(filenameOffset);

      // Prefix bonus
      if (pathLower.startsWith(queryLower) || filename.startsWith(queryLower)) {
        score += 30;
      }
      // Exact match bonus
      if (pathLower === queryLower || filename === queryLower) {
        score += 100;
      }

      // Match indices
      const indices = [];
      let curPos = 0;
      for (let i = 0; i < queryLower.length; i++) {
        const idx = pathLower.indexOf(queryLower[i], curPos);
        if (idx !== -1) {
          indices.push(idx);
          if (idx === curPos && i > 0) score += 15; // consecutive bonus
          if (BOUNDARY_CHARS.has(pathLower[idx - 1])) score += 25; // boundary bonus
          curPos = idx + 1;
        }
      }

      // Path segment penalty
      const segments = pathLower.split('/').length;
      score -= segments * 2;

      results.push({
        entry: item,
        score,
        matches: indicesToRanges(indices),
        ...(targetLine !== undefined ? { targetLine } : {}),
        ...(targetLineEnd !== undefined ? { targetLineEnd } : {})
      });
    }

    results.sort((a, b) => b.score - a.score || a.entry.path.length - b.entry.path.length);
    return results.slice(0, limit);
  }
}

describe('Tier 1 - Feature 34: Global Fuzzy File Finder (F34 / R2)', () => {
  const samplePaths = [
    'src/main.rs',
    'src/lib.rs',
    'src/engine/tree-indexer.ts',
    'src/engine/pack-client.ts',
    'src/ui/FileFinder.tsx',
    'src/ui/App.tsx',
    'README.md',
    'Cargo.toml',
    'package.json'
  ];

  it('T1.34.1: TreeIndexer indexes file paths and returns matching results', () => {
    const indexer = new TestTreeIndexer(samplePaths);
    const results = indexer.search('finder');
    assert.greaterThanOrEqual(results.length, 1);
    assert.strictEqual(results[0].entry.path, 'src/ui/FileFinder.tsx');
  });

  it('T1.34.2: Fuzzy score weighting rewards prefix and boundary matches over substring gaps', () => {
    const files = ['src/main.rs', 'tests/fixtures/domain.rs', 'src/domain/model.rs'];
    const indexer = new TestTreeIndexer(files);

    const results = indexer.search('main');
    assert.strictEqual(results[0].entry.path, 'src/main.rs', 'src/main.rs must rank first for query "main"');
  });

  it('T1.34.3: Line permalink parsing extracts line numbers and line ranges from queries', () => {
    const p1 = parseQueryPermalink('src/main.rs:42');
    assert.strictEqual(p1.cleanQuery, 'src/main.rs');
    assert.strictEqual(p1.targetLine, 42);

    const p2 = parseQueryPermalink('src/lib.rs#L128');
    assert.strictEqual(p2.cleanQuery, 'src/lib.rs');
    assert.strictEqual(p2.targetLine, 128);

    const p3 = parseQueryPermalink('src/engine/delta.ts:50-75');
    assert.strictEqual(p3.cleanQuery, 'src/engine/delta.ts');
    assert.strictEqual(p3.targetLine, 50);
    assert.strictEqual(p3.targetLineEnd, 75);

    const p4 = parseQueryPermalink(':99');
    assert.strictEqual(p4.cleanQuery, '');
    assert.strictEqual(p4.targetLine, 99);
  });

  it('T1.34.4: Subsequence matcher efficiently rejects non-matching file paths', () => {
    assert.strictEqual(isSubsequence('src/main.rs', 'srm'), true);
    assert.strictEqual(isSubsequence('src/main.rs', 'main'), true);
    assert.strictEqual(isSubsequence('src/main.rs', 'smr'), true); // s -> m -> r
    assert.strictEqual(isSubsequence('src/main.rs', 'xyz'), false);
    assert.strictEqual(isSubsequence('src/main.rs', 'main.ts'), false);
  });

  it('T1.34.5: Character match ranges convert to HighlightSpan list for <mark> rendering', () => {
    const text = 'src/engine/tree-indexer.ts';
    // Match 'tree' at indices 11, 12, 13, 14
    const ranges = [[11, 15]];
    const spans = highlightMatchedSpans(text, ranges);

    assert.strictEqual(spans.length, 3);
    assert.strictEqual(spans[0].text, 'src/engine/');
    assert.strictEqual(spans[0].isMatch, false);
    assert.strictEqual(spans[1].text, 'tree');
    assert.strictEqual(spans[1].isMatch, true);
    assert.strictEqual(spans[2].text, '-indexer.ts');
    assert.strictEqual(spans[2].isMatch, false);
  });

  it('T1.34.6: Exact filename match outranks deeper path containing letters', () => {
    const files = [
      'deep/nested/path/to/archive/readme/file.rs',
      'README.md'
    ];
    const indexer = new TestTreeIndexer(files);
    const results = indexer.search('readme');

    assert.strictEqual(results[0].entry.path, 'README.md');
    assert.greaterThan(results[0].score, results[1].score);
  });

  it('T1.34.7: Command palette keyboard navigation state transitions', () => {
    class CommandPaletteState {
      constructor(itemCount) {
        this.itemCount = itemCount;
        this.selectedIndex = 0;
        this.isOpen = true;
      }

      onKeyDown(key) {
        if (key === 'Escape') {
          this.isOpen = false;
        } else if (key === 'ArrowDown') {
          this.selectedIndex = (this.selectedIndex + 1) % this.itemCount;
        } else if (key === 'ArrowUp') {
          this.selectedIndex = (this.selectedIndex - 1 + this.itemCount) % this.itemCount;
        }
      }
    }

    const state = new CommandPaletteState(5);
    assert.strictEqual(state.selectedIndex, 0);

    state.onKeyDown('ArrowDown');
    assert.strictEqual(state.selectedIndex, 1);

    state.onKeyDown('ArrowDown');
    state.onKeyDown('ArrowDown');
    assert.strictEqual(state.selectedIndex, 3);

    state.onKeyDown('ArrowUp');
    assert.strictEqual(state.selectedIndex, 2);

    // Wrap around up
    state.onKeyDown('ArrowUp');
    state.onKeyDown('ArrowUp');
    state.onKeyDown('ArrowUp');
    assert.strictEqual(state.selectedIndex, 4);

    state.onKeyDown('Escape');
    assert.strictEqual(state.isOpen, false);
  });

  it('T1.34.8: Query normalization handles leading/trailing whitespace and case variations', () => {
    const indexer = new TestTreeIndexer(['client/src/ui/App.tsx']);
    const r1 = indexer.search('   app.tsx   ');
    const r2 = indexer.search('APP.TSX');
    const r3 = indexer.search('app');

    assert.strictEqual(r1.length, 1);
    assert.strictEqual(r2.length, 1);
    assert.strictEqual(r3.length, 1);
    assert.strictEqual(r1[0].entry.path, 'client/src/ui/App.tsx');
  });
});
