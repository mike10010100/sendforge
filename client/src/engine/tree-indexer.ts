import type { GitTreeEntry } from './types.js';
import type { TreeFileItem } from './fetcher.js';

/**
 * Standard tree entry used for indexing and fuzzy search.
 */
export interface TreeEntry {
  readonly path: string;
  readonly entry?: GitTreeEntry | undefined;
}

/**
 * Parsed line permalink components extracted from a query string.
 */
export interface ParsedQueryPermalink {
  readonly cleanQuery: string;
  readonly targetLine?: number | undefined;
  readonly targetLineEnd?: number | undefined;
}

/**
 * Result of a fuzzy match search operation.
 */
export interface FuzzyMatchResult {
  readonly entry: TreeEntry;
  readonly score: number;
  readonly matches: readonly [number, number][];
  readonly targetLine?: number | undefined;
  readonly targetLineEnd?: number | undefined;
}

/**
 * Highlighting span representing a slice of text and its match state.
 */
export interface HighlightSpan {
  readonly text: string;
  readonly isMatch: boolean;
}

/**
 * Internal precomputed metadata for fast tree indexing and scoring.
 */
interface PrecomputedEntry {
  readonly entry: TreeEntry;
  readonly pathLower: string;
  readonly fileNameLower: string;
  readonly fileNameOffset: number;
  readonly segmentCount: number;
  readonly boundaryIndices: Set<number>;
}

/**
 * Boundary character set for word/path boundary bonuses.
 */
const BOUNDARY_CHARS = new Set(['/', '_', '-', '.', '\\', ' ']);

/**
 * Parses line permalinks from query strings.
 * Examples:
 *   - "src/main.rs:42" -> { cleanQuery: "src/main.rs", targetLine: 42 }
 *   - "src/main.rs#L42" -> { cleanQuery: "src/main.rs", targetLine: 42 }
 *   - "src/main.rs#L42-L50" -> { cleanQuery: "src/main.rs", targetLine: 42, targetLineEnd: 50 }
 *   - "src/main.rs:42-50" -> { cleanQuery: "src/main.rs", targetLine: 42, targetLineEnd: 50 }
 *   - ":42" -> { cleanQuery: "", targetLine: 42 }
 */
export function parseQueryPermalink(rawQuery: string): ParsedQueryPermalink {
  const query = rawQuery.trim();
  if (!query) {
    return { cleanQuery: '' };
  }

  // Match line permalink at end of query:
  // 1) #L<start> or #L<start>-L<end> or #L<start>-<end>
  // 2) :<start> or :<start>-<end> or :L<start> or :L<start>-L<end> or :<start>:<end>
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
      targetLineEnd: typeof targetLineEnd === 'number' && Number.isFinite(targetLineEnd) && targetLineEnd > 0 ? targetLineEnd : undefined,
    };
  }

  return { cleanQuery: query };
}

/**
 * Precomputes metadata for an entry to maximize search throughput.
 */
function precomputeEntry(entry: TreeEntry): PrecomputedEntry {
  const path = entry.path;
  const pathLower = path.toLowerCase();
  const lastSlashIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const fileNameOffset = lastSlashIndex >= 0 ? lastSlashIndex + 1 : 0;
  const fileName = path.slice(fileNameOffset);
  const fileNameLower = fileName.toLowerCase();

  let segmentCount = 0;
  for (const ch of path) {
    if (ch === '/' || ch === '\\') {
      segmentCount++;
    }
  }

  const boundaryIndices = new Set<number>();
  boundaryIndices.add(0);
  boundaryIndices.add(fileNameOffset);

  for (let i = 0; i < path.length; i++) {
    const ch = path[i];
    if (ch !== undefined && BOUNDARY_CHARS.has(ch) && i + 1 < path.length) {
      boundaryIndices.add(i + 1);
    }
  }

  return {
    entry,
    pathLower,
    fileNameLower,
    fileNameOffset,
    segmentCount,
    boundaryIndices,
  };
}

/**
 * Ultra-fast sequential subsequence check using SIMD-accelerated indexOf.
 */
export function isSubsequence(textLower: string, queryLower: string, startOffset = 0): boolean {
  const qLen = queryLower.length;
  if (qLen === 0) return true;
  let tIdx = startOffset;

  for (let qIdx = 0; qIdx < qLen; qIdx++) {
    const qChar = queryLower.charAt(qIdx);
    tIdx = textLower.indexOf(qChar, tIdx);
    if (tIdx === -1) {
      return false;
    }
    tIdx++;
  }
  return true;
}

/**
 * Converts a list of 0-indexed positions into half-open `[start, end]` ranges.
 */
export function indicesToRanges(indices: readonly number[]): [number, number][] {
  if (indices.length === 0) return [];
  const sorted = Array.from(new Set(indices)).sort((a, b) => a - b);
  const ranges: [number, number][] = [];

  const first = sorted[0];
  if (first === undefined) return [];

  let start = first;
  let prev = first;

  for (let i = 1; i < sorted.length; i++) {
    const curr = sorted[i];
    if (curr === undefined) continue;
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

/**
 * Converts half-open `[start, end]` ranges into a flat array of 0-indexed positions.
 */
export function rangesToIndices(ranges: readonly (readonly [number, number])[]): number[] {
  const indices: number[] = [];
  for (const [start, end] of ranges) {
    for (let i = start; i < end; i++) {
      indices.push(i);
    }
  }
  return indices;
}

/**
 * Splits text into non-matching and matching spans for visual highlighting.
 */
export function highlightMatchedSpans(
  text: string,
  matches: readonly (readonly [number, number])[]
): HighlightSpan[] {
  if (matches.length === 0 || text.length === 0) {
    return [{ text, isMatch: false }];
  }

  // Normalize and merge overlapping or adjacent ranges
  const sorted = matches
    .map(([s, e]) => [Math.max(0, Math.min(s, text.length)), Math.max(0, Math.min(e, text.length))] as [number, number])
    .filter(([s, e]) => s < e)
    .sort((a, b) => a[0] - b[0]);

  const first = sorted[0];
  if (!first) {
    return [{ text, isMatch: false }];
  }

  const merged: [number, number][] = [];
  let [curStart, curEnd] = first;

  for (let i = 1; i < sorted.length; i++) {
    const pair = sorted[i];
    if (!pair) continue;
    const [s, e] = pair;
    if (s <= curEnd) {
      curEnd = Math.max(curEnd, e);
    } else {
      merged.push([curStart, curEnd]);
      curStart = s;
      curEnd = e;
    }
  }
  merged.push([curStart, curEnd]);

  const spans: HighlightSpan[] = [];
  let cursor = 0;

  for (const [start, end] of merged) {
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

/**
 * Computes contiguous substring match with full scoring and bonuses.
 */
function computeContiguousMatch(
  item: PrecomputedEntry,
  queryLower: string
): { score: number; matches: [number, number][] } | null {
  const { pathLower, fileNameLower, fileNameOffset, segmentCount, boundaryIndices } = item;
  const qLen = queryLower.length;

  // Check if match starts in filename first (prefer filename match)
  let subIndex = -1;
  const fnSubIndex = fileNameLower.indexOf(queryLower);
  if (fnSubIndex !== -1) {
    subIndex = fileNameOffset + fnSubIndex;
  } else {
    subIndex = pathLower.indexOf(queryLower);
  }

  if (subIndex === -1) {
    return null;
  }

  let score = 30; // Contiguous match base bonus

  // Prefix / start of filename bonus (30)
  if (subIndex === 0 || subIndex === fileNameOffset) {
    score += 30;
  }

  // Word / path boundary bonus (25)
  if (boundaryIndices.has(subIndex)) {
    score += 25;
  }

  // Consecutive match bonus (15 per consecutive char)
  score += (qLen - 1) * 15;

  // Exact match bonus (100)
  if (queryLower === pathLower || queryLower === fileNameLower) {
    score += 100;
  }

  // Filename preference bonus
  if (subIndex >= fileNameOffset) {
    score += 10;
  }

  // Path depth penalty (-2 per path segment)
  score -= segmentCount * 2;

  return {
    score,
    matches: [[subIndex, subIndex + qLen]],
  };
}

/**
 * Computes fast boundary-preferring fuzzy match alignment and score without allocations.
 */
function computeFastFuzzyMatch(
  item: PrecomputedEntry,
  queryLower: string
): { score: number; matches: [number, number][] } | null {
  const { pathLower, fileNameLower, fileNameOffset, segmentCount, boundaryIndices } = item;
  const qLen = queryLower.length;

  if (qLen === 0) {
    return { score: 0, matches: [] };
  }

  // Check if query matches inside filename first
  const searchInFilenameOnly = isSubsequence(fileNameLower, queryLower);
  let pIdx = searchInFilenameOnly ? fileNameOffset : 0;

  const matchedIndices: number[] = Array.from<number>({ length: qLen }).fill(0);

  for (let q = 0; q < qLen; q++) {
    const qChar = queryLower.charAt(q);
    const candidate = pathLower.indexOf(qChar, pIdx);
    if (candidate === -1) {
      return null;
    }

    let bestPos = candidate;

    // Check if next boundary occurrence exists nearby without string slicing
    const prevMatch = q > 0 ? matchedIndices[q - 1] : undefined;
    if (prevMatch !== undefined && candidate !== prevMatch + 1 && !boundaryIndices.has(candidate)) {
      const nextP = pathLower.indexOf(qChar, candidate + 1);
      if (nextP !== -1 && (boundaryIndices.has(nextP) || nextP === fileNameOffset)) {
        if (q + 1 === qLen || isSubsequence(pathLower, queryLower.slice(q + 1), nextP + 1)) {
          bestPos = nextP;
        }
      }
    }

    matchedIndices[q] = bestPos;
    pIdx = bestPos + 1;
  }

  // Calculate score
  let score = 0;
  const firstMatch = matchedIndices[0] ?? 0;

  // Prefix / start of filename bonus (30)
  if (firstMatch === 0 || firstMatch === fileNameOffset) {
    score += 30;
  }

  for (let q = 0; q < qLen; q++) {
    const curr = matchedIndices[q] ?? 0;

    // Word / path boundary bonus (25)
    if (boundaryIndices.has(curr)) {
      score += 25;
    }

    // Filename match bonus (2)
    if (curr >= fileNameOffset) {
      score += 2;
    }

    if (q > 0) {
      const prev = matchedIndices[q - 1] ?? 0;
      const gap = curr - prev - 1;
      if (gap === 0) {
        // Consecutive match bonus (15 per consecutive char)
        score += 15;
      } else {
        // Distance penalty (-1 per gap)
        score -= gap;
      }
    }
  }

  // Exact match bonus (100)
  if (queryLower === pathLower || queryLower === fileNameLower) {
    score += 100;
  }

  // Path depth penalty (-2 per path segment)
  score -= segmentCount * 2;

  const ranges = indicesToRanges(matchedIndices);
  return {
    score,
    matches: ranges,
  };
}


/**
 * Fast in-memory tree path indexer and weighted fuzzy ranking engine.
 */
export class TreeIndexer {
  private entries: readonly TreeEntry[] = [];
  private indexedEntries: PrecomputedEntry[] = [];

  constructor(entries: readonly (TreeEntry | TreeFileItem)[] = []) {
    this.setEntries(entries);
  }

  /**
   * Updates or re-indexes repository tree entries.
   */
  public setEntries(entries: readonly (TreeEntry | TreeFileItem)[]): void {
    this.entries = entries.map((e) => ({
      path: e.path,
      entry: 'entry' in e ? e.entry : undefined,
    }));
    this.indexedEntries = this.entries.map((entry) => precomputeEntry(entry));
  }

  /**
   * Returns current indexed entries.
   */
  public getEntries(): readonly TreeEntry[] {
    return this.entries;
  }

  /**
   * Total number of indexed entries.
   */
  public get size(): number {
    return this.entries.length;
  }

  /**
   * Executes a weighted fuzzy ranking search against indexed files.
   *
   * @param rawQuery Search query, optionally containing line permalink e.g. "main.rs:42"
   * @param limit Maximum results to return (default: 50)
   */
  public search(rawQuery: string, limit = 50): FuzzyMatchResult[] {
    const { cleanQuery, targetLine, targetLineEnd } = parseQueryPermalink(rawQuery);
    const query = cleanQuery.trim();

    if (!query) {
      return this.entries.slice(0, limit).map((entry) => ({
        entry,
        score: 0,
        matches: [],
        ...(targetLine !== undefined ? { targetLine } : {}),
        ...(targetLineEnd !== undefined ? { targetLineEnd } : {}),
      }));
    }

    const queryLower = query.toLowerCase();

    const results: FuzzyMatchResult[] = [];

    for (const item of this.indexedEntries) {
      // 1. Try fast contiguous match first
      const contiguous = computeContiguousMatch(item, queryLower);
      if (contiguous !== null) {
        results.push({
          entry: item.entry,
          score: contiguous.score,
          matches: contiguous.matches,
          ...(targetLine !== undefined ? { targetLine } : {}),
          ...(targetLineEnd !== undefined ? { targetLineEnd } : {}),
        });
        continue;
      }

      // 2. Fast subsequence rejection for non-contiguous fuzzy matches
      if (!isSubsequence(item.pathLower, queryLower)) {
        continue;
      }

      // 3. Compute fuzzy match
      const match = computeFastFuzzyMatch(item, queryLower);
      if (match !== null) {
        results.push({
          entry: item.entry,
          score: match.score,
          matches: match.matches,
          ...(targetLine !== undefined ? { targetLine } : {}),
          ...(targetLineEnd !== undefined ? { targetLineEnd } : {}),
        });
      }
    }

    // Sort by score descending, then path length ascending, then alphabetical
    results.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (a.entry.path.length !== b.entry.path.length) {
        return a.entry.path.length - b.entry.path.length;
      }
      return a.entry.path < b.entry.path ? -1 : a.entry.path > b.entry.path ? 1 : 0;
    });

    return results.slice(0, limit);
  }
}
