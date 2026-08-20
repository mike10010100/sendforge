# Project: Sendforge

## Architecture
Sendforge is a high-performance, static-first Git forge decoupling repository storage from application compute:
1. **Server Layer (Rust CLI / Hook / Static Server)**:
   - Initializes bare repositories with dumb HTTP server-info (`info/refs`, `objects/info/packs`).
   - Git `post-receive` hook updates dumb HTTP info, generates `meta.json` repository index, and pre-renders static HTML fallbacks (`index.html`, `log.html`) with zero-JS CommonMark README rendering.
   - Local Static HTTP Server (`sendforge serve`) supports RFC 7233 Range requests, CORS headers, case-insensitive headers, multi-candidate path resolution, and dumb HTTP transport.
   - Static Exporter (`sendforge export`) bundles the bare repo, static fallbacks, and compiled TypeScript frontend into a deployable static directory (ready for S3, Cloudflare Pages, Caddy, Nginx).
   - Strict Rust safety: `#![forbid(unsafe_code)]`, `#![deny(clippy::all, clippy::pedantic, clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::todo, clippy::unimplemented)]`, typed errors with `thiserror`/`anyhow`, clock-warp safe math.
2. **Client Layer (In-Browser TypeScript Git Engine & UI)**:
   - In-browser Git engine fetches raw loose Git objects (`/objects/xx/xxx`) over HTTP and inflates zlib envelopes via `DecompressionStream` / `pako`.
   - Pure TypeScript binary parsers for `commit`, `tree`, `blob`, and `tag` objects with strict discriminated unions and zero-any policy.
   - Off-thread Web Worker diff calculation (Myers/LCS algorithm for unified and side-by-side split diffs).
   - Reactive UI (Preact / TypeScript) providing instant branch/tag switching, interactive tree traversal, syntax-highlighted blob viewing, commit timeline, and fuzzy file search (`Ctrl+K`).
   - Strict TypeScript compiler (`strict: true`, `noImplicitAny: true`, `strictNullChecks: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`), `@typescript-eslint/strict-type-checked`, and comprehensive Vitest test suite.
3. **E2E Testing & Verification**:
   - Automated 4-tier opaque-box test suite (Tiers 1-4) verifying feature isolation, corner cases, cross-feature workflows, and real-world workloads, passing 100% (118/118 tests).

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Bare Repo Initialization | `sendforge init <repo-path>` sets up bare repo with dumb HTTP config & post-receive hook | M1 | ORIGINAL_REQUEST §R1, PRD §5.1 |
| 2 | Post-Receive Hook Handler | `sendforge hook` processes stdin ref updates (`<oldrev> <newrev> <refname>`) | M1 | ORIGINAL_REQUEST §R1, PRD §5.1 |
| 3 | Dumb HTTP Server-Info Update | Updates `info/refs` and `objects/info/packs` with peeled tag annotations | M1 | ORIGINAL_REQUEST §R1, PRD §5.1 |
| 4 | Repository Metadata Generator | Emits `meta.json` with branch heads, tag pointers, commit count, description, timestamps | M1 | ORIGINAL_REQUEST §R1, PRD §5.1 |
| 5 | Static HTML Fallback Generator | Pre-renders `index.html` (tree & rendered README) and `log.html` (commit log) with zero JS | M1 | ORIGINAL_REQUEST §R1, PRD §6.1 |
| 6 | CommonMark README Renderer | Safe markdown-to-HTML rendering via `pulldown-cmark` embedded in static fallback | M1 | ORIGINAL_REQUEST §R1, PRD §6.1 |
| 7 | Rust Safety & Quality Posture | `#![forbid(unsafe_code)]`, strict Clippy deny list, typed `thiserror` errors, clock-warp safety | M1 | ORIGINAL_REQUEST §R1 |
| 8 | Zlib Loose Object Decompression | In-browser inflation of `/objects/xx/xxx` envelopes via `DecompressionStream` / `pako` | M2 | ORIGINAL_REQUEST §R2, PRD §5.2 |
| 9 | Binary Tree Object Parser | Binary scanning of `[mode] [path]\0[20-byte SHA-1]` tree entries and recursive resolution | M2 | ORIGINAL_REQUEST §R2, PRD §5.2 |
| 10 | Text Commit & Tag Parser | Parsing commit headers (`tree`, `parent*`, `author`, `committer`, `gpgsig`) and tag objects | M2 | ORIGINAL_REQUEST §R2, PRD §5.2 |
| 11 | Blob Reader & Syntax Viewer | UTF-8 text vs binary detection, line numbering, and syntax highlighting | M2 | ORIGINAL_REQUEST §R2, PRD §6.1 |
| 12 | In-Browser Ref Resolver & Cache | LRU memory cache, request deduplication, and branch/tag resolution via `meta.json` | M2 | ORIGINAL_REQUEST §R2, PRD §5.2 |
| 13 | Web Worker Off-Thread Diffing | Off-thread diff computation (Myers/LCS) generating unified and side-by-side split diffs | M2 | ORIGINAL_REQUEST §R2, PRD §5.2 |
| 14 | In-Browser Reactive UI & Router | Preact UI for branch/tag switching, tree navigation, commit log timeline, fuzzy search | M2 | ORIGINAL_REQUEST §R2, PRD §6.1 |
| 15 | Strict TypeScript & Linting Gates | Strict `tsconfig.json`, zero-`any` discriminated unions, `@typescript-eslint/strict-type-checked` | M2 | ORIGINAL_REQUEST §R2 |
| 16 | Vitest Unit Test Suite | Comprehensive Vitest suite with fixtures for corrupted objects, empty trees, merge commits | M2 | ORIGINAL_REQUEST §R2 |
| 17 | Local Static HTTP Server | `sendforge serve` with CORS headers, MIME types, dumb HTTP endpoints, RFC 7233 Range support | M3 | ORIGINAL_REQUEST §R3, PRD §5.1 |
| 18 | Standalone Static Exporter | `sendforge export` generating self-contained static directory for S3/Cloudflare/Caddy deployment | M3 | ORIGINAL_REQUEST §R3, PRD §6.1 |
| 19 | E2E Test Harness & Suite (Tiers 1-4) | Automated multi-tier test runner verifying feature isolation, boundaries, combinations, workloads | E2E | ORIGINAL_REQUEST §Acceptance |
| 20 | Full E2E Pass & Adversarial Hardening | 100% pass of Tiers 1-4 E2E test suite + Tier 5 white-box adversarial stress testing | M4 | ORIGINAL_REQUEST §Acceptance |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| E2E | E2E Testing Track | Automated Test Runner & 4-tier E2E Test Suite (Tiers 1-4), creates `TEST_READY.md` | none | DONE |
| M1 | Rust Core CLI, Hook & Exporter | Rust crate `sendforge`: CLI (`init`, `hook`, `update`), dumb HTTP `info/refs`, `meta.json`, zero-JS HTML fallback pre-rendering, safe Rust | none | DONE |
| M2 | TypeScript Git Engine & UI | Frontend package: loose object fetcher, zlib inflator, commit/tree/blob parsers, Web Worker diffing, Preact SPA UI, strict TS/Vitest | none | DONE |
| M3 | Static Server & Static Export | `sendforge serve` (CORS, dumb HTTP, Range requests) and `sendforge export` standalone generator | M1, M2 | DONE |
| M4 | Final E2E Pass & Adversarial Hardening | Phase 1: 100% pass across E2E Tiers 1-4 (118/118); Phase 2: Tier 5 adversarial stress testing | E2E, M1, M2, M3 | DONE |

---

## Interface Contracts

### 1. File Layout in Bare Repository
```text
<repo>.git/
├── HEAD
├── config
├── refs/
│   ├── heads/
│   └── tags/
├── info/
│   └── refs
├── objects/
│   ├── [0-9a-f]{2}/[0-9a-f]{38}
│   └── pack/
└── static/
    ├── meta.json
    ├── index.html
    └── log.html
```

### 2. `meta.json` Schema Contract
```json
{
  "name": "string",
  "description": "string | null",
  "default_branch": "string",
  "branches": [
    { "name": "string", "target": "string (40-hex SHA-1)", "is_default": "boolean" }
  ],
  "tags": [
    { "name": "string", "target": "string (40-hex SHA-1)", "is_annotated": "boolean", "peeled": "string | null" }
  ],
  "head": {
    "ref": "string",
    "sha": "string (40-hex SHA-1)"
  },
  "stats": {
    "commit_count": "number",
    "branch_count": "number",
    "tag_count": "number"
  },
  "has_readme": "boolean",
  "readme_filename": "string | null",
  "updated_at": "string (ISO 8601 UTC)"
}
```

### 3. Web Worker Diff RPC Protocol
- Request:
  ```ts
  type DiffWorkerRequest = {
    id: string;
    type: 'COMPUTE_DIFF';
    oldPath: string;
    newPath: string;
    oldContent: string;
    newContent: string;
    contextLines?: number;
  };
  ```
- Response:
  ```ts
  type DiffWorkerResponse = {
    id: string;
    type: 'DIFF_RESULT';
    oldPath: string;
    newPath: string;
    hunks: DiffHunk[];
    stats: { additions: number; deletions: number };
  } | {
    id: string;
    type: 'DIFF_ERROR';
    error: string;
  };
  ```

---

## Code Layout
```text
/Users/mike10010100/git/hybrid-gitforge/
├── Cargo.toml                    # Workspace Cargo manifest (sendforge CLI & core crate)
├── src/                          # Rust source code
│   ├── main.rs                   # CLI entrypoint (clap subcommands: init, hook, update, export, serve)
│   ├── lib.rs                    # Core library entrypoint with #![forbid(unsafe_code)]
│   ├── error.rs                  # Typed error handling (thiserror)
│   ├── repo/                     # Bare Git repo operations & dumb HTTP info generator
│   ├── hook/                     # Post-receive hook logic & ref update processing
│   ├── meta/                     # meta.json generation and serialization
│   ├── prerender/                # Static HTML fallback generator & CommonMark markdown renderer
│   ├── server/                   # Local static HTTP server (CORS, Range, dumb HTTP, multi-candidate resolution)
│   └── export/                   # Standalone static directory exporter
├── tests/                        # Rust integration tests & adversarial suites
├── package.json                  # Frontend TypeScript workspace
├── tsconfig.json                 # Strict TypeScript configuration
├── eslint.config.js              # Strict TypeScript ESLint configuration
├── vite.config.ts                # Vite build & bundle configuration
├── vitest.config.ts              # Vitest test runner configuration
├── client/                       # Frontend TypeScript application
│   ├── src/
│   │   ├── engine/               # In-browser Git engine (fetcher, inflator, parser, types)
│   │   ├── worker/               # Web Worker off-thread Myers diffing (diff.worker.ts, diff-client.ts)
│   │   ├── ui/                   # Reactive UI components (App, TreeView, BlobView, CommitLog, DiffView, FileFinder)
│   │   └── index.html            # SPA entry template
│   └── tests/                    # Vitest unit test suites & binary fixtures
└── e2e/                          # Automated E2E Test Suite (Tiers 1-4, 118 test cases)
    ├── harness/                  # E2E test runner, supervisor, git repo generator, html validator
    ├── tier1_features/           # Tier 1: 16 Feature isolation test suites (89 test cases)
    ├── tier2_boundaries/         # Tier 2: 12 Boundary & Corner case suites (20 test cases)
    ├── tier3_combinations/       # Tier 3: 5 Cross-feature combination workflows
    └── tier4_workloads/          # Tier 4: 4 Real-world workloads & scraper floods
```
