# Original User Request

## Initial Request — 2026-08-19T23:50:00Z

Sendforge is a high-performance, static-first Git forge that serves bare Git repositories and pre-rendered fallbacks via zero-copy static HTTP (sendfile(2)-friendly), coupled with an in-browser client engine that parses Git objects, trees, commits, and diffs dynamically.

Working directory: /Users/mike10010100/git/hybrid-gitforge
Integrity mode: development

References: 
- Rust Best Practices Guide: https://github.com/mike10010100/rust-test/blob/main/BEST_PRACTICES.md

## Requirements

### R1. Rust Core CLI, Hook & Static Exporter
Build a high-performance CLI tool and Git post-receive hook in Rust that initializes bare repositories, updates dumb HTTP server-info (info/refs), generates meta.json repository index files, and pre-renders static HTML fallback pages for default branch tips and README.md.
All Rust code must adhere strictly to production-grade safety:
- Root-level safety guard: #![forbid(unsafe_code)], #![deny(clippy::all, clippy::pedantic, clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::todo, clippy::unimplemented)]
- Structured, typed error handling with thiserror / anyhow returning Result<T, E>.
- Clock-warp safe time calculations (saturating_duration_since).

### R2. In-Browser Client Git Engine & Production-Grade TypeScript UI
Build a lightweight TypeScript client application (using a lightweight reactive framework such as Svelte, Solid, or Preact) that runs in the browser. The client must:
- Fetch and decompress raw Git loose objects (/objects/xx/xxx) directly over HTTP.
- Parse commit, tree, and blob objects in-browser with zero dynamic server execution.
- Provide interactive navigation (switching branches, browsing directories, viewing files with line numbers and syntax highlighting).
- Compute unified and side-by-side diffs off-thread using a Web Worker.

All TypeScript frontend and core code must adhere to bulletproof production-grade standards:
- Strict Compiler Gates: tsconfig.json with "strict": true, "noImplicitAny": true, "strictNullChecks": true, "noUncheckedIndexedAccess": true, "exactOptionalPropertyTypes": true, "noImplicitReturns": true.
- Zero-any Policy: Absolutely no any types; all Git objects, binary buffers, and DOM states must be strictly typed using discriminated unions and type narrowing.
- Strict Linting: Enforce @typescript-eslint/strict-type-checked and deny floating promises (@typescript-eslint/no-floating-promises).
- Comprehensive Testing: Comprehensive unit tests (via Vitest) covering the binary Git object parser (commit, tree, tag, blob, zlib inflation) with edge cases and corrupted object fixtures.

### R3. Static Server & Zero-Compute Export
Implement a lightweight local static HTTP server in Rust (supporting CORS and dumb HTTP) for local development and testing, along with a static site export command that generates a standalone static directory ready to deploy on S3, Cloudflare Pages, Caddy, or Nginx.

## Acceptance Criteria

### Compiler Gates, Linting & Code Quality
- [ ] cargo clippy --all-targets --all-features passes with zero warnings or errors under the strict lint posture.
- [ ] cargo test passes for all unit and integration tests across the CLI, hook, and static exporter.
- [ ] npm run typecheck (tsc --noEmit) passes with zero errors under strict compiler flags.
- [ ] npm run lint passes with zero warnings/errors under strict TypeScript lint rules.
- [ ] npm test (Vitest) passes for all unit tests covering Git object parsing, tree traversal, and diff generation.

### Static Serving & Zero-JS Fallback
- [ ] sendforge init <repo-path> initializes a bare Git repo with dumb HTTP support and the post-receive hook.
- [ ] Pushing to the repository triggers the hook, generating meta.json and static HTML fallback files for the default branch and README.
- [ ] Fetching the repository root via HTTP returns valid HTML with repository contents readable even when JavaScript is disabled.

### In-Browser Dynamic Navigation
- [ ] Client application successfully fetches loose Git objects over HTTP and resolves commits, trees, and file blobs without server-side compute.
- [ ] Interactive branch/tag switching and file tree navigation work smoothly without full page reloads.
- [ ] Diff viewer accurately computes and renders commit diffs client-side in a Web Worker.

## Follow-up — 2026-08-20T04:37:31Z

Sendforge Phase 3 extends the high-performance static Git forge in `/Users/mike10010100/git/hybrid-gitforge`, adding a database-free collaboration layer with Git-native Pull Requests, Issue tracking, in-browser merge-base calculation, and review comment threads.

Working directory: /Users/mike10010100/git/hybrid-gitforge
Integrity mode: development

References:
- Rust Best Practices Guide: https://github.com/mike10010100/rust-test/blob/main/BEST_PRACTICES.md
- Sendforge PRD: PRD.md §6.3
- Sendforge Project Guide: PROJECT.md

## Requirements

### R1. Rust Core PR & Issue Ref Discovery, Exporter & Static HTML Fallback
Build a high-performance scanner and static generator in Rust that:
- Discovers Git references for pull requests (`refs/pull/<id>/head`, `refs/pull/<id>/meta`) and issues (`refs/issues/<id>`).
- Serializes `static/pulls.json` and `static/issues.json` and updates `meta.json` with issue and PR counts.
- Pre-renders static zero-JS HTML fallbacks (`static/pulls.html`, `static/issues.html`, and detailed fallback views) for full accessibility when JavaScript is disabled.
- Enforces strict Rust safety: `#![forbid(unsafe_code)]`, zero `.unwrap()`/`.expect()`/`panic!`, strict Clippy deny list, clock-warp safe timestamps, and typed `Result<T, E>`.

### R2. In-Browser Client Merge-Base & 3-Way Diff Engine
Implement a client-side Git DAG traversal engine in TypeScript:
- Traverses parent commit graphs starting from the PR head commit and target branch tip to find the lowest common ancestor (merge base).
- Calculates the 3-way commit diff between the merge base tree and the PR head tree off-thread in a Web Worker without dynamic server compute.
- Attaches review notes (`refs/notes/reviews`) to specific files, diff hunks, or commit SHAs.

### R3. Interactive Pull Request Viewer (`PullRequestsView.tsx`, `PRDetailView.tsx`)
Create a responsive, client-side Pull Request interface featuring:
- PR List View: Filter by status (`open`, `merged`, `closed`), author, and labels with instant client-side search.
- PR Detail View:
  - **Conversation Tab**: Description, author, timestamps, status badge, and chronological comment & commit timeline.
  - **Commits Tab**: List of commits included in the PR branch.
  - **Files Changed Tab**: Interactive Unified and Split diff view showing line additions/deletions between merge base and PR head.

### R4. Interactive Issue Tracker (`IssuesView.tsx`, `IssueDetailView.tsx`)
Create a responsive, client-side Issue Tracker interface featuring:
- Issue List View: Filter by status (`open`, `closed`), author, and label badges with instant search.
- Issue Detail View: Header, status badge, author metadata, Markdown-rendered issue body, and chronological discussion comments.

### R5. Integrated Navigation & Hash Routing
- Update top navigation bar to: `[ 📁 Code ]` `[ 📜 Commits <count> ]` `[ 🎯 Issues <count> ]` `[ 🔀 Pull Requests <count> ]`.
- Support hash deep linking: `#/issues`, `#/issues/<id>`, `#/pulls`, `#/pulls/<id>`, `#/pulls/<id>/files`, `#/pulls/<id>/commits`.

### R6. Safety, Code Quality & Multi-Tier Verification
- Maintain zero-`any` TypeScript under `@typescript-eslint/strict-type-checked` and `strict: true`.
- Unit test suite (Vitest) covering merge-base resolution, PR diff computation, issue parsing, and UI components.
- Multi-tier E2E test suite covering the full lifecycle of creating, serving, and browsing PRs and issues.

## Acceptance Criteria

### Compiler Gates & Linter Gates
- [ ] `cargo clippy --all-targets --all-features -- -D warnings` passes with 0 warnings/errors.
- [ ] `cargo test --all-targets --all-features` passes all unit and integration tests.
- [ ] `cargo fmt --all --check` passes with 0 formatting discrepancies.
- [ ] `npm run typecheck` (`tsc --noEmit`) passes with 0 errors.
- [ ] `npm run lint` (`eslint .`) passes with 0 warnings/errors under strict TypeScript lint rules.
- [ ] `npm test` passes all Vitest test suites.

### Feature Verification
- [ ] `sendforge export` discovers `refs/pull/*` and `refs/issues/*` and generates `pulls.json`, `issues.json`, and pre-rendered HTML fallbacks.
- [ ] Top navbar displays `📁 Code`, `📜 Commits`, `🎯 Issues`, and `🔀 Pull Requests` with active state and count badges.
- [ ] Pull Requests view computes merge base client-side and accurately renders the "Files Changed" diff.
- [ ] Issues view accurately renders markdown issue descriptions and comment threads.
- [ ] Full E2E test suite passes 100% across all feature, boundary, combination, and workload tiers.
