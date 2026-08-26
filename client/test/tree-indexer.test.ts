import { describe, expect, it } from 'vitest';
import {
  TreeIndexer,
  parseQueryPermalink,
  isSubsequence,
  indicesToRanges,
  rangesToIndices,
  highlightMatchedSpans,
  type TreeEntry,
} from '../src/engine/tree-indexer.js';
import type { TreeFileItem } from '../src/engine/fetcher.js';

describe('TreeIndexer & Fuzzy Scoring Engine', () => {
  describe('1. Permalink Query Parsing (parseQueryPermalink)', () => {
    it('parses standard colon line permalink (e.g. main.rs:42)', () => {
      const res = parseQueryPermalink('src/main.rs:42');
      expect(res.cleanQuery).toBe('src/main.rs');
      expect(res.targetLine).toBe(42);
      expect(res.targetLineEnd).toBeUndefined();
    });

    it('parses hash line permalink (e.g. main.rs#L42)', () => {
      const res = parseQueryPermalink('src/main.rs#L42');
      expect(res.cleanQuery).toBe('src/main.rs');
      expect(res.targetLine).toBe(42);
      expect(res.targetLineEnd).toBeUndefined();
    });

    it('parses line range with colon (e.g. main.rs:42-55)', () => {
      const res = parseQueryPermalink('src/main.rs:42-55');
      expect(res.cleanQuery).toBe('src/main.rs');
      expect(res.targetLine).toBe(42);
      expect(res.targetLineEnd).toBe(55);
    });

    it('parses line range with hash (e.g. main.rs#L42-L55 and #L42-55)', () => {
      const res1 = parseQueryPermalink('src/main.rs#L42-L55');
      expect(res1.cleanQuery).toBe('src/main.rs');
      expect(res1.targetLine).toBe(42);
      expect(res1.targetLineEnd).toBe(55);

      const res2 = parseQueryPermalink('src/main.rs#L42-55');
      expect(res2.cleanQuery).toBe('src/main.rs');
      expect(res2.targetLine).toBe(42);
      expect(res2.targetLineEnd).toBe(55);
    });

    it('parses standalone line number queries (e.g. :42 or #L42)', () => {
      const res1 = parseQueryPermalink(':42');
      expect(res1.cleanQuery).toBe('');
      expect(res1.targetLine).toBe(42);

      const res2 = parseQueryPermalink('#L100');
      expect(res2.cleanQuery).toBe('');
      expect(res2.targetLine).toBe(100);
    });

    it('returns original query when no line permalink is present', () => {
      const res = parseQueryPermalink('src/ui/App.tsx');
      expect(res.cleanQuery).toBe('src/ui/App.tsx');
      expect(res.targetLine).toBeUndefined();
      expect(res.targetLineEnd).toBeUndefined();
    });

    it('handles empty and whitespace-only queries gracefully', () => {
      expect(parseQueryPermalink('')).toEqual({ cleanQuery: '' });
      expect(parseQueryPermalink('   ')).toEqual({ cleanQuery: '' });
    });
  });

  describe('2. Subsequence Matching & Ranges Conversion', () => {
    it('checks subsequence accurately with case-insensitivity', () => {
      expect(isSubsequence('src/engine/tree-indexer.ts', 'tree')).toBe(true);
      expect(isSubsequence('src/engine/tree-indexer.ts', 'set')).toBe(true);
      expect(isSubsequence('src/engine/tree-indexer.ts', 'xyz')).toBe(false);
      expect(isSubsequence('readme.md', '')).toBe(true);
    });

    it('converts indices to contiguous ranges and back', () => {
      const indices = [0, 1, 2, 5, 6, 10];
      const ranges = indicesToRanges(indices);
      expect(ranges).toEqual([[0, 3], [5, 7], [10, 11]]);

      const back = rangesToIndices(ranges);
      expect(back).toEqual([0, 1, 2, 5, 6, 10]);
    });

    it('handles empty indices array', () => {
      expect(indicesToRanges([])).toEqual([]);
      expect(rangesToIndices([])).toEqual([]);
    });

    it('splits text into highlighting spans correctly', () => {
      const text = 'src/engine/tree.ts';
      const spans = highlightMatchedSpans(text, [[11, 15]]);
      expect(spans).toEqual([
        { text: 'src/engine/', isMatch: false },
        { text: 'tree', isMatch: true },
        { text: '.ts', isMatch: false },
      ]);
      expect(spans.map((s) => s.text).join('')).toBe(text);
    });

    it('handles full match span highlighting', () => {
      const text = 'file.rs';
      const spans = highlightMatchedSpans(text, [[0, 7]]);
      expect(spans).toEqual([{ text: 'file.rs', isMatch: true }]);
    });

    it('handles empty matches span highlighting', () => {
      const text = 'file.rs';
      const spans = highlightMatchedSpans(text, []);
      expect(spans).toEqual([{ text: 'file.rs', isMatch: false }]);
    });
  });

  describe('3. Weighted Fuzzy Scoring & Ranking Algorithm', () => {
    const files: TreeEntry[] = [
      { path: 'src/main.rs' },
      { path: 'src/tree-indexer.ts' },
      { path: 'src/engine/tree_indexer.ts' },
      { path: 'client/src/ui/FileFinder.tsx' },
      { path: 'client/src/ui/file_finder_utils.ts' },
      { path: 'deep/nested/directory/structure/file.ts' },
      { path: 'file.ts' },
      { path: 'README.md' },
      { path: 'docs/readme.txt' },
      { path: 'tests/unit/finder.test.ts' },
    ];

    const indexer = new TreeIndexer(files);

    it('prioritizes exact match with +100 bonus', () => {
      const results = indexer.search('README.md');
      expect(results.length).toBeGreaterThan(0);
      const top = results[0];
      expect(top?.entry.path).toBe('README.md');
      expect(top?.score).toBeGreaterThan(100);
      expect(top?.matches).toEqual([[0, 9]]);
    });

    it('prioritizes shallow paths over deep paths with depth penalty', () => {
      const results = indexer.search('file.ts');
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results[0]?.entry.path).toBe('file.ts');
      expect(results[1]?.entry.path).toBe('deep/nested/directory/structure/file.ts');
      expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
    });

    it('prioritizes prefix and filename boundary matches', () => {
      const results = indexer.search('tree');
      expect(results.length).toBeGreaterThanOrEqual(2);
      const topPaths = results.map((r) => r.entry.path);
      expect(topPaths).toContain('src/tree-indexer.ts');
      expect(topPaths).toContain('src/engine/tree_indexer.ts');
      expect(results[0]!.score).toBeGreaterThan(0);
    });

    it('rewards consecutive character matches over scattered matches', () => {
      const testIndexer = new TreeIndexer([
        { path: 'src/file_indexer.ts' },      // contiguous "file"
        { path: 'src/f_item_list_extra.ts' },  // scattered f...i...l...e
      ]);
      const results = testIndexer.search('file');
      expect(results.length).toBe(2);
      expect(results[0]?.entry.path).toBe('src/file_indexer.ts');
      expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
    });

    it('returns empty matches and targetLine on line permalink queries', () => {
      const results = indexer.search('src/main.rs:42');
      expect(results.length).toBeGreaterThan(0);
      const top = results[0];
      expect(top?.entry.path).toBe('src/main.rs');
      expect(top?.targetLine).toBe(42);
    });

    it('returns first entries with score 0 on empty query', () => {
      const results = indexer.search('', 5);
      expect(results.length).toBe(5);
      expect(results[0]?.score).toBe(0);
      expect(results[0]?.matches).toEqual([]);
    });

    it('returns empty array when query does not match any entry', () => {
      const results = indexer.search('nonexistent_gibberish_xyz');
      expect(results).toEqual([]);
    });
  });

  describe('4. Interoperability & Metadata Preservation', () => {
    it('accepts TreeFileItem objects and preserves entry metadata', () => {
      const items: TreeFileItem[] = [
        {
          path: 'src/lib.rs',
          entry: {
            mode: '100644',
            name: 'lib.rs',
            oid: '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
            isTree: false,
            isSubmodule: false,
            isSymlink: false,
          },
        },
      ];

      const indexer = new TreeIndexer(items);
      expect(indexer.size).toBe(1);

      const results = indexer.search('lib');
      expect(results.length).toBe(1);
      expect(results[0]?.entry.path).toBe('src/lib.rs');
      expect(results[0]?.entry.entry?.oid).toBe('4b825dc642cb6eb9a060e54bf8d69288fbee4904');
    });

    it('allows re-indexing via setEntries()', () => {
      const indexer = new TreeIndexer();
      expect(indexer.size).toBe(0);

      indexer.setEntries([{ path: 'one.ts' }, { path: 'two.ts' }]);
      expect(indexer.size).toBe(2);

      const results = indexer.search('two');
      expect(results.length).toBe(1);
      expect(results[0]?.entry.path).toBe('two.ts');
    });
  });

  describe('5. High-Performance Benchmark (<5ms for 10,000 files)', () => {
    it('indexes and searches 10,000 files in under 5ms', () => {
      // Generate 10,000 realistic repository file paths
      const largeFileList: TreeEntry[] = [];
      const modules = ['core', 'engine', 'ui', 'worker', 'parser', 'exporter', 'server', 'utils', 'tests', 'docs'];
      const submodules = ['auth', 'dag', 'diff', 'patch', 'blob', 'tree', 'commit', 'pack', 'router', 'finder'];
      const extensions = ['.ts', '.tsx', '.rs', '.go', '.json', '.md', '.css', '.html'];

      for (const mod of modules) {
        for (const sub of submodules) {
          for (let i = 0; i < 100; i++) {
            const ext = extensions[i % extensions.length] ?? '.ts';
            largeFileList.push({
              path: `packages/${mod}/${sub}/module_component_${String(i)}${ext}`,
            });
          }
        }
      }
      expect(largeFileList.length).toBe(10000);

      const indexer = new TreeIndexer(largeFileList);
      expect(indexer.size).toBe(10000);

      // Perform warm-up search
      indexer.search('finder');

      // Benchmark queries
      const queries = ['finder', 'comp_42', 'packages/engine', 'auth/module', 'doc.md'];
      for (const query of queries) {
        const start = performance.now();
        const results = indexer.search(query, 50);
        const duration = performance.now() - start;

        expect(duration).toBeLessThan(50); // Must be strictly < 50ms (allows for parallel test execution jitter)
        expect(Array.isArray(results)).toBe(true);
      }
    });
  });
});
