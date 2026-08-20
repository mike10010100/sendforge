# Project: Sendforge Phase 2

## Architecture
Sendforge Phase 2 enhances the high-performance, client-side static Git forge with advanced navigation, line provenance, immutable permalinks, and zero-server snapshot archive generation.

- **Client Runtime**: Preact 10.26 + TypeScript 5.7 SPA running in modern browsers, bundled with Vite 6.1 (< 35 KB gzipped budget).
- **Git Engine**: Client-side loose object decoder (`/objects/xx/xxx`), in-memory LRU cache, Myers diff engine, and backward commit DAG walker for `git blame`.
- **Archive Engine**: Pure TypeScript zero-dependency binary serializer producing PKWARE ZIP (deflate + CRC32) and POSIX ustar `.tar.gz` (gzip) snapshot archives in-browser.
- **Backend & SSG**: Rust 2021 crate with `#![forbid(unsafe_code)]`, serving static assets, `meta.json`, and loose Git objects with CORS and RFC 7233 byte-range support.

```
┌─────────────────────────────────────────────────────────────────┐
│ Browser Client (Preact SPA)                                    │
│ ┌────────────────┐ ┌────────────────┐ ┌──────────────────────┐  │
│ │ RefSelector.tsx│ │  BlameView.tsx │ │   BlobView.tsx       │  │
│ │ (Tabs/Search)  │ │ (Heatmap/Avatar│ │ (Permalinks/Raw/Zip) │  │
│ └───────┬────────┘ └───────┬────────┘ └──────────┬───────────┘  │
│         │                  │                     │              │
│ ┌───────▼──────────────────▼─────────────────────▼───────────┐  │
│ │ GitRepositoryClient / BlameEngine / ArchiveEngine (TS)     │  │
│ └──────────────────────────┬─────────────────────────────────┘  │
└────────────────────────────┼────────────────────────────────────┘
                             │ Fetch (/objects/xx/xxx, /meta.json)
┌────────────────────────────▼────────────────────────────────────┐
│ Sendforge Static Site / Server (Rust)                           │
│ - meta.json (branches, tags, commits, repos)                    │
│ - /objects/xx/xxx (loose zlib git objects)                      │
│ - SPA bundle & static assets                                    │
└─────────────────────────────────────────────────────────────────┘
```

## Feature Inventory
| # | Feature | Description | Milestone | Source | Status |
|---|---------|-------------|-----------|--------|--------|
| 1 | R1.1 Ref Selector Tabs | Dedicated Branches and Tags tabs in ref switcher popover | M1 | ORIGINAL_REQUEST §R1 | DONE |
| 2 | R1.2 Fuzzy Ref Search | Instant client-side fuzzy search/filter box for branches and tags | M1 | ORIGINAL_REQUEST §R1 | DONE |
| 3 | R1.3 Ref Metadata Badges | Visual badges indicating default branch, commit hash, tag dates | M1 | ORIGINAL_REQUEST §R1 | DONE |
| 4 | R1.4 Ref Selector Accessibility | Popover dismissal on Escape/click-outside and keyboard navigation | M1 | ORIGINAL_REQUEST §R1 | DONE |
| 5 | R2.1 Blame History Traversal | In-browser backward commit chain traversal with blob equality check | M2 | ORIGINAL_REQUEST §R2 | DONE |
| 6 | R2.2 Myers Line Attribution | Line-by-line attribution mapping to commit SHA, author, timestamp | M2 | ORIGINAL_REQUEST §R2 | DONE |
| 7 | R2.3 Interactive BlameView UI | Blame UI with author avatars/names, commit hashes, age heatmap | M2 | ORIGINAL_REQUEST §R2 | DONE |
| 8 | R2.4 Blame Commit Diff Links | Clickable links to committing diff view from blame hunks | M2 | ORIGINAL_REQUEST §R2 | DONE |
| 9 | R2.5 Code / Blame Mode Toggle | Toggle button in BlobView switching between Code and Blame views | M2 | ORIGINAL_REQUEST §R2 | DONE |
| 10 | R3.1 Hash Line Highlighting | URL hash-based line selection (#L42, #L10-L25) with visual highlighting | M3 | ORIGINAL_REQUEST §R3 | DONE |
| 11 | R3.2 Multi-Line Selection | Shift-clicking line numbers to select and highlight ranges | M3 | ORIGINAL_REQUEST §R3 | DONE |
| 12 | R3.3 Immutable Permalinks | Copy permalink button linking to commit SHA + path + line range | M3 | ORIGINAL_REQUEST §R3 | DONE |
| 13 | R3.4 Deep Link Auto-Scroll | Auto-scroll to selected line range on page load and hashchange | M3 | ORIGINAL_REQUEST §R3 | DONE |
| 14 | R4.1 Raw Blob View & Download | Raw button for direct blob viewing and downloading | M4 | ORIGINAL_REQUEST §R4 | DONE |
| 15 | R4.2 Client-Side ZIP Archive | Browser-side .zip snapshot archive generator with deflate/CRC32 | M4 | ORIGINAL_REQUEST §R4 | DONE |
| 16 | R4.3 Client-Side Tarball Archive | Browser-side .tar.gz snapshot archive generator (POSIX ustar + gzip)| M4 | ORIGINAL_REQUEST §R4 | DONE |
| 17 | R4.4 Snapshot Download UI | Download button in UI for downloading repo snapshot as ZIP/Tarball | M4 | ORIGINAL_REQUEST §R4 | DONE |
| 18 | R5.1 Strict Rust Safety | #![forbid(unsafe_code)], zero unwraps/panics, 0 Clippy warnings | M5 | ORIGINAL_REQUEST §R5 | DONE |
| 19 | R5.2 Strict TypeScript Safety | strict: true, zero any, @typescript-eslint/strict-type-checked | M5 | ORIGINAL_REQUEST §R5 | DONE |
| 20 | R5.3 Vitest Unit Test Suite | Comprehensive unit tests for RefSelector, Blame, Permalinks, Archive | M5 | ORIGINAL_REQUEST §R5 | DONE |
| 21 | R5.4 Multi-Tier E2E Verification | 100% pass across E2E test suite with Tier 5 adversarial hardening | M5 | ORIGINAL_REQUEST §R5 | DONE |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Tabbed Ref Selector | `RefSelector.tsx`, types update, fuzzy search, badges, keyboard nav, unit tests | none | DONE |
| M2 | In-Browser git blame & BlameView | `blame.ts`, `BlameView.tsx`, Myers diff attribution, heatmap, toggle in `BlobView.tsx`, unit tests | none | DONE |
| M3 | File Permalinks & Line Highlighting | URL hash parsing, single/shift-click line selection, CSS styles, copy permalink button, auto-scroll, unit tests | none | DONE |
| M4 | Raw File & Snapshot Archive Generation | `archive.ts` (ZIP + TAR.GZ), raw download button, snapshot export UI in `BlobView.tsx` / `App.tsx`, unit tests | none | DONE |
| M5 | Final Milestone: Full E2E & Verification | App.tsx integration, Vitest suite 100% pass, Tiers 1-4 E2E 100% pass, Tier 5 Adversarial Coverage Hardening | M1, M2, M3, M4 | DONE |

## Interface Contracts

### 1. `RefSelector.tsx` ↔ `App.tsx`
```typescript
export interface RefSelectorProps {
  currentRef: string;
  branches: RepoBranch[];
  tags: RepoTag[];
  onSelectRef: (refName: string) => void;
  defaultBranch?: string;
}
```

### 2. `blame.ts` ↔ `BlameView.tsx` / `GitRepositoryClient`
```typescript
export interface BlameLineInfo {
  lineNumber: number;
  commitOid: string;
  authorName: string;
  authorEmail: string;
  timestamp: number;
  summary: string;
}

export interface BlameHunk {
  commitOid: string;
  authorName: string;
  authorEmail: string;
  timestamp: number;
  summary: string;
  startLine: number;
  lineCount: number;
}

export interface BlameResult {
  lines: BlameLineInfo[];
  hunks: BlameHunk[];
  oldestTimestamp: number;
  newestTimestamp: number;
}

export async function computeBlame(
  client: GitRepositoryClient,
  commitOid: string,
  filePath: string,
  onProgress?: (visitedCommits: number) => void
): Promise<BlameResult>;
```

### 3. `archive.ts` ↔ `App.tsx` / `BlobView.tsx`
```typescript
export interface ArchiveFileEntry {
  path: string;
  data: Uint8Array;
  mode?: number; // default: 0o100644 or 0o100755
}

export function createZipArchive(
  prefix: string,
  files: ArchiveFileEntry[]
): Uint8Array;

export function createTarGzArchive(
  prefix: string,
  files: ArchiveFileEntry[]
): Uint8Array;

export function triggerDownload(
  filename: string,
  data: Uint8Array | Blob,
  mimeType: string
): void;
```

### 4. Permalinks & Hash Utils (`utils.ts`)
```typescript
export interface LineRange {
  start: number;
  end: number;
}

export function parseLineHash(hash: string): LineRange | null;
export function formatLineHash(start: number, end?: number): string;
export function buildPermalinkUrl(
  repoName: string,
  commitOid: string,
  filePath: string,
  range?: LineRange
): string;
```

## Code Layout
- `client/src/ui/RefSelector.tsx` — Tabbed Ref Selector popover component (M1 - DONE)
- `client/src/engine/blame.ts` — In-browser backward commit chain blame engine (M2 - DONE)
- `client/src/ui/BlameView.tsx` — Interactive blame view with heatmaps and diff links (M2 - DONE)
- `client/src/ui/utils.ts` — URL hash parsing/formatting and permalink utilities (M3 - DONE)
- `client/src/engine/archive.ts` — Zero-dependency ZIP and POSIX ustar tar.gz binary serializer (M4 - DONE)
- `client/src/ui/BlobView.tsx` — Blob viewer with permalinks, code/blame toggle, raw download, and archive export (M2, M3, M4 - DONE)
- `client/src/ui/App.tsx` — Main application shell integrating RefSelector, routing, and header actions (M1, M4, M5 - DONE)
- `client/src/ui/styles.css` — CSS styles for ref selector popover, blame view, heatmaps, line highlights, and archive export (M1, M2, M3, M4 - DONE)
- `client/tests/unit/` — Unit tests for ref selector, blame, permalinks, and archive generation (M1, M2, M3, M4, M5 - DONE)
- `e2e/` — Multi-tier opaque-box E2E test suite (E2E Testing Track - TEST_READY.md published)
