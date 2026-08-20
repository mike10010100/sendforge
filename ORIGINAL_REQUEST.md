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
