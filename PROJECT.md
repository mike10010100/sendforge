# Project: Sendforge Phase 4

## Architecture
Sendforge Phase 4 extends the high-performance client-side Git forge with three major capabilities:
1. **Engine Layer (`client/src/engine/`)**:
   - `pack-idx.ts`: Git `.idx` v2 binary parser with 256-entry fanout binary search ($O(\log N)$), 20-byte SHA-1 table, CRC32 table, and 4-byte/8-byte packfile offset resolution.
   - `delta.ts`: Git delta reconstruction engine handling `OBJ_OFS_DELTA` (negative relative offsets) and `OBJ_REF_DELTA` (base SHA-1 lookup) using an opcode instruction interpreter (COPY bitmask + INSERT literals) and bounded LRU delta base caching.
   - `pack-client.ts`: Byte-range streaming HTTP client issuing RFC 7233 `Range: bytes=start-end` requests to fetch and inflate individual Git objects without downloading full archives.
   - `fetcher.ts`: Fallback object resolution hierarchy: Memory cache -> Loose object `/objects/xx/xxx` -> Packfile index lookup + Range request -> `ObjectNotFoundError`.
   - `patch.ts`: RFC 2822 standard `git format-patch` generator compatible with `git am`.
2. **UI Layer (`client/src/ui/`)**:
   - `syntax.ts`: Zero-dependency, pure TypeScript deterministic tokenizer supporting 60+ programming languages, line-by-line caching (`LineSyntaxCache`), search match overlay, and WCAG 2.1 AA/AAA high-contrast dark theme colors.
   - `BlobView.tsx`: Integrated syntax highlighting, preserved line numbering (`#L...`), line selection, permalinks, and search bar with match highlighting.
   - `NewIssueModal.tsx`: Interactive issue creation modal with live Markdown preview, label chips, author metadata, `git push origin HEAD:refs/issues/<id>` generator, JSON download, and `localStorage` draft saving.
   - `NewPRModal.tsx`: Interactive pull request / patch submission modal with target/source branch selector, live merge-base calculation, diff preview, `git format-patch` export, `git push origin <branch>:refs/pull/<id>/head` generator, and `localStorage` draft recovery.
   - `IssuesView.tsx` & `PullRequestsView.tsx`: Integrated primary action buttons to launch modals.
3. **Verification & Quality Layer**:
   - Strict TypeScript (`strict: true`, zero `any`, `@typescript-eslint/strict-type-checked`).
   - Strict Rust (`#![forbid(unsafe_code)]`, zero `unwrap`/`expect`/`panic!`, `Result<T, E>`).
   - Comprehensive Vitest unit test suites.
   - Dual-track E2E test suites (Tiers 1-4) + Adversarial hardening (Tier 5).

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | .idx v2 Fanout & Binary Search | 256-entry fanout table with binary search lookup in O(log N) | M1 | ORIGINAL_REQUEST §R1 |
| 2 | .idx v2 4-byte & 8-byte Offsets | Read 4-byte offsets and secondary 8-byte offset table for packfiles > 2 GiB | M1 | ORIGINAL_REQUEST §R1 |
| 3 | .idx v2 CRC32 Verification | Read CRC32 checksums for packed objects | M1 | ORIGINAL_REQUEST §R1 |
| 4 | Byte-Range Packfile Fetching | RFC 7233 `Range: bytes=start-end` HTTP requests to fetch packed objects on demand | M1 | ORIGINAL_REQUEST §R1 |
| 5 | Packed Object Header Decoding | Parse variable-length integer header (type bits 6..4, size bits) + zlib inflate | M1 | ORIGINAL_REQUEST §R1 |
| 6 | OBJ_OFS_DELTA Decoding | Decode variable-length negative relative offset and reconstruct base | M1 | ORIGINAL_REQUEST §R1 |
| 7 | OBJ_REF_DELTA Decoding | Read 20-byte base object SHA-1 and reconstruct base | M1 | ORIGINAL_REQUEST §R1 |
| 8 | Delta Opcode Copy/Insert Engine | Interpret Git delta opcodes (COPY bitmask + 65536 zero size, INSERT literal) | M1 | ORIGINAL_REQUEST §R1 |
| 9 | LRU Delta Base Cache | Cache inflated base objects across delta chains with recursion cycle protection | M1 | ORIGINAL_REQUEST §R1 |
| 10 | Unified Fetcher Fallback | Resolve objects: Memory Cache -> Loose Object -> Packfile Range -> Typed Error | M1 | ORIGINAL_REQUEST §R1 |
| 11 | Packfile Discovery | Discover `.git/objects/pack/*.idx` and `objects/info/packs` in `GitRepositoryClient` | M1 | ORIGINAL_REQUEST §R1 |
| 12 | 60+ Language Tokenizer | Pure TypeScript zero-dependency tokenizer supporting 60+ languages across 5 categories | M2 | ORIGINAL_REQUEST §R2 |
| 13 | Multi-line State Machine | Handle multi-line comments, docstrings, template literals, and heredocs via immutable state | M2 | ORIGINAL_REQUEST §R2 |
| 14 | Line Token Caching | O(1) line syntax caching (`LineSyntaxCache`) for 60fps scrolling and fast render | M2 | ORIGINAL_REQUEST §R2 |
| 15 | WCAG 2.1 AA/AAA Dark Theme | Contrast-verified syntax token colors against #0d1117 (all > 4.5:1, up to 14.85:1) | M2 | ORIGINAL_REQUEST §R2 |
| 16 | BlobView Syntax Integration | Render tokenized code in `BlobView.tsx` with preserved line numbers and line selection | M2 | ORIGINAL_REQUEST §R2 |
| 17 | In-File Search Highlight | Overlay search match highlights on tokenized code lines without breaking syntax spans | M2 | ORIGINAL_REQUEST §R2 |
| 18 | New Issue Modal UI | Title, Markdown editor with live preview, labels, and author metadata | M3 | ORIGINAL_REQUEST §R3 |
| 19 | Issue Git Push Generator | Generate `git push origin HEAD:refs/issues/<id>` command with copy button | M3 | ORIGINAL_REQUEST §R3 |
| 20 | Issue JSON Download | Download JSON payload for offline or CLI ingestion | M3 | ORIGINAL_REQUEST §R3 |
| 21 | Issue LocalStorage Drafts | Auto-save and restore issue draft state per repository | M3 | ORIGINAL_REQUEST §R3 |
| 22 | New PR Modal UI | Target and source branch pickers with live merge-base calculation and diff preview | M3 | ORIGINAL_REQUEST §R3 |
| 23 | RFC 2822 git format-patch Export | Generate standard patch files formatted for `git am` / email workflows | M3 | ORIGINAL_REQUEST §R3 |
| 24 | PR Git Push Generator | Generate `git push origin <branch>:refs/pull/<id>/head` command with copy button | M3 | ORIGINAL_REQUEST §R3 |
| 25 | PR LocalStorage Drafts | Auto-save and restore PR draft state per repository | M3 | ORIGINAL_REQUEST §R3 |
| 26 | Toolbar Action Buttons | "New Issue" in `IssuesView.tsx` and "New Pull Request" in `PullRequestsView.tsx` | M3 | ORIGINAL_REQUEST §R3 |
| 27 | Vitest Test Coverage | Unit test suites for pack-idx, delta, pack-client, syntax, patch, and modals | M1, M2, M3 | ORIGINAL_REQUEST §R4 |
| 28 | Quality Gates & Rust Safety | Clippy 0 warnings, Rust tests pass, TypeScript strict 0 errors, ESLint 0 warnings | All | ORIGINAL_REQUEST §R4 |
| 29 | E2E Testing Suite (Tiers 1-4) | Opaque-box requirement-driven test harness and test cases | E2E_Track | ORIGINAL_REQUEST §R4 |
| 30 | Final Acceptance & Adversarial Hardening | 100% E2E test pass + Tier 5 adversarial stress testing | M4 (Final) | ORIGINAL_REQUEST §R4 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| E2E | E2E Testing Track | Independent Opaque-box test suite (Tiers 1-4), TEST_INFRA.md, TEST_READY.md | none | PLANNED |
| M1 | Packfile & Delta Engine | `pack-idx.ts`, `delta.ts`, `pack-client.ts`, `fetcher.ts`, Vitest suites | none | PLANNED |
| M2 | Syntax Highlighting Engine | `syntax.ts`, `styles.css`, `BlobView.tsx`, search highlight, Vitest suites | none | PLANNED |
| M3 | Collaboration Modals & Patch Export | `patch.ts`, `NewIssueModal.tsx`, `NewPRModal.tsx`, `IssuesView.tsx`, `PullRequestsView.tsx`, `App.tsx`, Vitest suites | none | PLANNED |
| M4 | Final Milestone & Hardening | Phase 1 (100% E2E test pass) + Phase 2 (Adversarial Coverage Hardening Tier 5) | E2E, M1, M2, M3 | PLANNED |

## Interface Contracts

### M1: Packfile Engine Contracts
```typescript
// client/src/engine/pack-idx.ts
export interface PackIndexEntry {
  shaHex: string;
  offset: number;
  crc32: number;
}

export class PackIndex {
  static parse(buffer: ArrayBuffer | Uint8Array): PackIndex;
  readonly totalObjects: number;
  findObject(shaHex: string): PackIndexEntry | null;
  getObjectOffset(shaHex: string): number | null;
  getByteSpan(shaHex: string, packFileSize?: number): { start: number; end: number } | null;
  getSortedOffsets(): number[];
}

// client/src/engine/delta.ts
export function applyGitDelta(baseObject: Uint8Array, deltaPayload: Uint8Array): Uint8Array;

export class DeltaBaseCache {
  constructor(maxEntries?: number, maxBytes?: number);
  get(key: string | number): Uint8Array | undefined;
  set(key: string | number, value: Uint8Array): void;
  clear(): void;
}

// client/src/engine/pack-client.ts
export class PackClient {
  constructor(baseUrl: string, packHash: string, index: PackIndex, options?: PackClientOptions);
  fetchObjectBySha(shaHex: string, client?: GitRepositoryClient): Promise<GitObject>;
  fetchObjectAtOffset(offset: number, client?: GitRepositoryClient): Promise<GitObject>;
}
```

### M2: Syntax Engine Contracts
```typescript
// client/src/ui/syntax.ts
export type TokenType =
  | 'keyword'
  | 'type'
  | 'string'
  | 'comment'
  | 'number'
  | 'function'
  | 'operator'
  | 'preprocessor'
  | 'punctuation'
  | 'plain';

export interface Token {
  type: TokenType;
  text: string;
}

export interface MultiLineState {
  inBlockComment?: boolean;
  commentDelimiter?: string;
  inMultiLineString?: boolean;
  stringDelimiter?: string;
  inHeredoc?: boolean;
  heredocDelimiter?: string;
}

export class LineSyntaxCache {
  tokenizeLine(lineText: string, lineIndex: number, language: string): Token[];
  invalidate(): void;
}

export function detectLanguage(pathOrFilename: string): string;
export function tokenizeCode(code: string, language: string): Token[][];
export function renderTokenToHtml(token: Token): string;
export function applySearchHighlightToTokens(tokens: Token[], searchQuery: string): string;
```

### M3: Patch & Collaboration Contracts
```typescript
// client/src/engine/patch.ts
export interface FormatPatchOptions {
  commit: CommitObject;
  parentTreeSha?: string;
  patchIndex?: number;
  totalPatches?: number;
}

export function generateFormatPatch(client: GitRepositoryClient, commitSha: string): Promise<string>;
export function generateFormatPatchRange(client: GitRepositoryClient, baseSha: string, headSha: string): Promise<string>;

// client/src/ui/NewIssueModal.tsx
export interface NewIssueModalProps {
  repoName: string;
  isOpen: boolean;
  onClose: () => void;
  onIssueCreated?: (issue: Issue) => void;
}

// client/src/ui/NewPRModal.tsx
export interface NewPRModalProps {
  repoName: string;
  branches: BranchInfo[];
  client: GitRepositoryClient;
  isOpen: boolean;
  onClose: () => void;
  onPRCreated?: (pr: PullRequest) => void;
}
```

## Code Layout
- `client/src/engine/` - Core Git engine modules (`pack-idx.ts`, `delta.ts`, `pack-client.ts`, `fetcher.ts`, `patch.ts`)
- `client/src/ui/` - React UI components (`syntax.ts`, `BlobView.tsx`, `NewIssueModal.tsx`, `NewPRModal.tsx`, `IssuesView.tsx`, `PullRequestsView.tsx`, `App.tsx`, `styles.css`)
- `client/test/` - Vitest unit test suites (`pack-idx.test.ts`, `delta.test.ts`, `pack-client.test.ts`, `syntax.test.ts`, `patch.test.ts`, `modals.test.ts`)
- `e2e/` - Dual-track E2E verification test suites and runners
- `src/` - Rust static forge core and CLI
