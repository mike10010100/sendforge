# Original User Request

## Initial Request — 2026-08-20T17:14:55Z

Sendforge Phase 4 extends the high-performance static Git forge in `/Users/mike10010100/git/hybrid-gitforge` with:
1. HTTP RFC 7233 Byte-Range Packfile (`.pack` / `.idx`) Reader & Delta Reconstruction Engine.
2. In-Browser Modular Syntax Highlighting Engine for 50+ Languages.
3. Interactive Issue Creation & Patch / PR Submission Modals with `git format-patch` export and `git push` command generation.

Working directory: /Users/mike10010100/git/hybrid-gitforge
Integrity mode: production-strict

References:
- Rust Best Practices Guide: https://github.com/mike10010100/rust-test/blob/main/BEST_PRACTICES.md
- Sendforge PRD: PRD.md §6.4
- Swarm Plan: /Users/mike10010100/.gemini/antigravity-cli/brain/d896f13f-1b24-4159-bbab-171332a5463b/phase4_teamwork_swarm.md

## Requirements

### R1. HTTP RFC 7233 Byte-Range Git Packfile (`.pack` / `.idx`) Reader & Delta Decompression
- Build a robust in-browser Git `.idx` v2 packfile index parser (`client/src/engine/pack-idx.ts`):
  - 256-entry fanout table binary search.
  - 20-byte SHA-1 lookup table.
  - CRC32 verification table.
  - 4-byte and 8-byte (large packfile) offset decoding.
- Build the Byte-Range Packfile Client (`client/src/engine/pack-client.ts`):
  - Fetch compressed Git objects on demand using HTTP `Range: bytes=offset-end` requests without downloading the entire packfile.
  - Decompress Git type headers (commit, tree, blob, tag, ofs-delta, ref-delta) and payload via pako / Web Streams.
- Build the Delta Reconstruction Engine (`client/src/engine/delta.ts`):
  - Resolves `OBJ_OFS_DELTA` (negative relative byte offsets) and `OBJ_REF_DELTA` (base SHA-1 lookup).
  - Implements the Git delta copy/insert instruction opcode interpreter.
  - Integrates an LRU delta base cache to ensure fast multi-level delta chain resolution.
- Integrate into `GitRepositoryClient` (`client/src/engine/fetcher.ts`):
  - Discover `objects/info/packs` or `.git/objects/pack/*.idx`.
  - Seamless fallback hierarchy: Loose object `/objects/xx/xxx` -> Packfile index lookup + Range request -> Error.

### R2. Modular In-Browser Syntax Highlighting Engine (50+ Languages)
- Implement a zero-dependency, ultra-fast tokenizing syntax highlighter (`client/src/ui/syntax.ts`):
  - Supports 50+ languages: Rust, TypeScript, JavaScript, Python, Go, C/C++, HTML, CSS, JSON, YAML, TOML, Markdown, Shell/Bash, SQL, Diff, Zig, Nix, Ruby, Java, Kotlin, Swift, Lua, PHP, etc.
  - Tokenizes keywords, strings, comments, numbers, types, functions, operators, and preprocessor directives.
  - Line-by-line token caching for zero re-computation on scroll or line range selection.
  - Accessible, high-contrast dark theme colors (WCAG 2.1 AA compliant).
- Integrate seamlessly into `BlobView.tsx` (syntax highlighting for code view, preserved line numbers, and search highlighting).

### R3. Interactive Issue & Pull Request Creation / Patch Submission Modals
- Build "New Issue" Modal / View (`client/src/ui/NewIssueModal.tsx`):
  - Title, description editor with live Markdown preview, label selector, and author metadata.
  - Generates:
    - Ready-to-copy `git push origin HEAD:refs/issues/<id>` command.
    - Downloadable Git commit blob / JSON payload for offline or CLI ingestion.
    - Browser `localStorage` draft saving and restoration.
- Build "New Pull Request" / "Submit Patch" Modal (`client/src/ui/NewPRModal.tsx`):
  - Target vs. source branch picker with live merge-base calculation and diff preview.
  - Generates:
    - Standard `git format-patch` / `.patch` file export ready for `git am` / email workflows.
    - `git push origin <branch>:refs/pull/<id>/head` command generator.
- Integrate "New Issue" button in `IssuesView.tsx` and "New Pull Request" button in `PullRequestsView.tsx`.

### R4. Quality, Safety & Multi-Tier Verification Gates
- Maintain strict Rust safety: `#![forbid(unsafe_code)]`, zero `.unwrap()`/`.expect()`/`panic!`, strict Clippy deny list, typed `Result<T, E>`.
- Maintain strict TypeScript safety: `strict: true`, zero `any`, `@typescript-eslint/strict-type-checked`.
- Extend Vitest unit test suites covering:
  - `.idx` v2 parsing with fanout search.
  - `OBJ_OFS_DELTA` and `OBJ_REF_DELTA` opcode decoding and byte copy reconstruction.
  - Syntax highlighting tokenization across language families.
  - `git format-patch` formatting and patch generation.
  - New issue & PR modal interaction and state transitions.
- Update E2E test suites in `e2e/`.

## Acceptance Criteria
- [ ] `cargo clippy --all-targets --all-features -- -D warnings` passes with 0 warnings.
- [ ] `cargo test --all-targets --all-features` passes all unit and integration tests.
- [ ] `npm run typecheck` (`tsc --noEmit`) passes with 0 errors.
- [ ] `npm run lint` passes with 0 warnings/errors under `@typescript-eslint/strict-type-checked`.
- [ ] `npm test` passes all Vitest test suites (including packfile decoding, delta resolution, syntax highlighting, and patch generation).
- [ ] `./e2e/run_e2e.sh` passes 100%.
- [ ] Git commit and push to `origin main` triggers the verified Cloudflare deployment pipeline successfully.

## Phase 5 Request — 2026-08-26T00:05:18Z

Sendforge is a high-performance, static-first Git forge powered by sendfile(2) static serving and in-browser Git resolution. This task implements high-priority UX polish enhancements from the naive usability audit and delivers the complete Phase 5 feature set (global fuzzy file finder, multi-repository forge hub/dashboard, serverless edge write gateway, and progressive web app offline caching).

Working directory: /Users/mike10010100/git/hybrid-gitforge
Integrity mode: development

References:
- Sendforge PRD: PRD.md §6.5
- Sendforge Usability Audit: /Users/mike10010100/.gemini/antigravity-cli/brain/d896f13f-1b24-4159-bbab-171332a5463b/usability_audit_report.md
- Reference Rust Standards: https://github.com/mike10010100/rust-test/blob/main/BEST_PRACTICES.md

## Requirements

### R1. Usability Audit UX Polish & Quick Wins
- **Clone URL Affordance:** Add a prominent `git clone <url>` input box with a 1-click `Copy` button inside the `⬇️ Code / Download ▾` popover.
- **Commit List SHA Copy:** Add a 1-click hover copy icon on commit hash badges in the commit timeline.
- **Custom Label Chip Visualizer:** In the New Issue / New PR modal, immediately render custom-typed labels as active removable chip pills in the dialog upon pressing Enter or clicking Add.
- **Demo Tag:** Ensure a `v0.1.0` tag is present so the Tags tab in the ref selector displays active tag examples.

### R2. Global Keyboard-Driven Fuzzy File Finder (`Cmd+K` / `Ctrl+K` / `T`)
- **Fast Tree Indexer:** Build an in-memory tree path indexer with client-side fuzzy ranking, score weighting, and matched substring highlighting.
- **Command Palette UI:** Provide a floating, keyboard-navigable command palette overlay (`↑`/`↓`/`Enter`/`Esc`) with instant file jumping and line permalink support.

### R3. Multi-Repository Portfolio & Forge Dashboard
- **Multi-Repo CLI Exporter:** Implement CLI command `sendforge export --all <repos-dir>` scanning multiple bare Git repositories in a directory.
- **Root Forge Dashboard:** Generate a root forge dashboard (`repos.json`, `index.html`) with repository cards, owner groupings, commit activity indicators, and global search/filtering.
- **Navigation Breadcrumbs:** Update the top navigation bar with breadcrumbs supporting seamless switching between repositories and the forge hub.

### R4. Lightweight Serverless Edge Write Gateway (Cloudflare Worker)
- **Edge API Worker:** Implement an optional zero-database edge function endpoint (`/api/submit/issue`, `/api/submit/pr`) for direct web-based issue/PR submissions.
- **Schema Validation & Storage:** Validate payload schemas and write Git refs directly (`refs/issues/*`, `refs/pull/*`) into storage.

### R5. Progressive Web App (PWA) & Full Offline Caching
- **Service Worker Layer:** Implement a Service Worker caching strategy for offline repository browsing, tree navigation, and diff resolution.
- **Web App Manifest:** Provide a Web App Manifest with icons, offline status badge indicator, and background cache synchronization.

### R6. Quality, Safety & Multi-Tier Verification Gates
- **Rust Safety:** Maintain strict Rust safety: `#![forbid(unsafe_code)]`, zero-unwrap/panic/expect, strict Clippy deny list.
- **TypeScript Strictness:** Maintain strict TypeScript safety: `strict: true`, zero `any`, `@typescript-eslint/strict-type-checked`.
- **Test Coverage:** Extend Vitest unit tests, Cargo test suites, and multi-tier E2E tests covering all new features.

## Acceptance Criteria

### Compiler Gates & Linting
- [ ] `cargo clippy --all-targets --all-features -- -D warnings` passes with 0 warnings.
- [ ] `cargo test --all-targets --all-features` passes all unit and integration tests.
- [ ] `npm run typecheck` (`tsc --noEmit`) passes with 0 errors.
- [ ] `npm run lint` passes with 0 warnings/errors under `@typescript-eslint/strict-type-checked`.
- [ ] `npm test` passes all Vitest test suites (including fuzzy finder, multi-repo indexing, PWA caching, and UX fixes).
- [ ] `./e2e/run_e2e.sh` passes 100%.

### Functional Verification
- [ ] Clone URL box in `Code / Download` copies valid `git clone` URL.
- [ ] Custom labels in Issue/PR modal immediately appear as visual chips before submit.
- [ ] `Ctrl+K` / `Cmd+K` opens fuzzy file finder and navigates to selected files.
- [ ] `sendforge export --all` generates a multi-repo forge dashboard with search and activity stats.
- [ ] Service worker caches visited repositories and enables offline navigation.
- [ ] Git commit and push to `origin main` triggers the verified Cloudflare deployment pipeline successfully.

