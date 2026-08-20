# Sendforge Multi-Tier E2E Testing Infrastructure

## 1. Overview & Architecture

The Sendforge Phase 3 End-to-End (E2E) Test Suite is an opaque-box, multi-tier testing framework engineered to validate all features of the static Git forge server and in-browser client. It tests the complete integrated stack—including Rust static file/loose object serving, Git hooks, metadata generation, client-side Loose Object DAG traversal, in-browser Lowest Common Ancestor (LCA) merge-base calculation, Web Worker 3-way Myers diffing, Git-native Pull Requests and Issues discovery, review notes integration, and zero-JS static HTML fallback pre-rendering—against native Git reference implementations.

```
┌────────────────────────────────────────────────────────────────────────┐
│ Sendforge Master E2E Test Runner (`runner.js` / `run_e2e.sh`)          │
│ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────────────┐ │
│ │  Console Output  │ │    TAP Output    │ │     JUnit XML Report     │ │
│ └──────────────────┘ └──────────────────┘ └──────────────────────────┘ │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Executes
┌───────────────────────────────────▼────────────────────────────────────┐
│ Multi-Tier Test Suites (`e2e/tier*`)                                   │
│ ┌─────────────────┐ ┌─────────────────┐ ┌──────────────┐ ┌───────────┐ │
│ │ Tier 1: Feature │ │ Tier 2: Boundary│ │ Tier 3: Cross│ │ Tier 4:   │ │
│ │ Coverage (F1-25)│ │ & Corner (B1-20)│ │ Workflow (C12│ │ Workloads │ │
│ └─────────────────┘ └─────────────────┘ └──────────────┘ └───────────┘ │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Employs
┌───────────────────────────────────▼────────────────────────────────────┐
│ Test Harness (`e2e/harness/`)                                          │
│ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────────────┐ │
│ │Supervisor (Rust) │ │GitRepoHelper     │ │HttpClient (HTTP/Range)   │ │
│ └──────────────────┘ └──────────────────┘ └──────────────────────────┘ │
│ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────────────┐ │
│ │GitParser (Loose) │ │DagHelper (LCA)   │ │BlameHelper (Provenance)  │ │
│ └──────────────────┘ └──────────────────┘ └──────────────────────────┘ │
│ ┌──────────────────┐ ┌──────────────────┐                              │
│ │ArchiveValidator  │ │HtmlValidator     │                              │
│ └──────────────────┘ └──────────────────┘                              │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Feature Inventory (F01–F24)

| # | Feature | Description | Milestone | Suite Path | Status |
|---|---------|-------------|-----------|------------|--------|
| 1 | F01: Git Collaboration Ref Discovery | Discover `refs/pull/<id>/head`, `refs/pull/<id>/meta`, `refs/issues/<id>`, `refs/notes/reviews` | M1 | `e2e/tier1_features/f21_collab_export.js` | VERIFIED |
| 2 | F02: Collaboration Data Subsystem | Rust parser subsystem in `src/collab/` for PRs, Issues, Notes with JSON schema and Git commit fallback | M1 | `e2e/tier1_features/f21_collab_export.js` | VERIFIED |
| 3 | F03: Metadata & Stats Count Extension | Extend `RepoStats` and `meta.json` with `issue_count`, `open_issue_count`, `pull_count`, `open_pull_count` | M1 | `e2e/tier1_features/f21_collab_export.js` | VERIFIED |
| 4 | F04: JSON Exporter Serialization | Serialize `static/pulls.json` and `static/issues.json` during export and hook runs | M1 | `e2e/tier1_features/f21_collab_export.js` | VERIFIED |
| 5 | F05: Static Zero-JS HTML Fallback | Pre-render `static/pulls.html`, `static/issues.html`, detail views with sanitized Markdown and 4-tab nav | M1 | `e2e/tier1_features/f21_collab_export.js` | VERIFIED |
| 6 | F06: Strict Rust Safety & Quality | `#![forbid(unsafe_code)]`, zero unwrap/expect/panic, strict Clippy deny list, clock-warp safe timestamps | M1 | Cargo Gates | VERIFIED |
| 7 | F07: In-Browser DAG LCA Merge-Base | Client-side DAG traversal (`dag.ts`) to compute Lowest Common Ancestor (merge base) between PR head & target branch | M2 | `e2e/tier1_features/f22_merge_base.js` | VERIFIED |
| 8 | F08: PR Commit Range Resolution | Traverse and collect all commits in `mergeBase..head` for PR commit list | M2 | `e2e/tier1_features/f22_merge_base.js` | VERIFIED |
| 9 | F09: Off-Thread Web Worker 3-Way Diff | Offload tree diffing and Myers hunk diffing to Web Worker without blocking UI | M2 | `e2e/tier1_features/f23_pr_viewer.js` | VERIFIED |
| 10 | F10: Review Notes Inline Integration | Load and attach `refs/notes/reviews` comments to diff hunks, files, or commit SHAs | M2 | `e2e/tier1_features/f23_pr_viewer.js` | VERIFIED |
| 11 | F11: Interactive PR List View | `PullRequestsView.tsx` with open/merged/closed status filters, author filter, label badges, instant search | M3 | `e2e/tier1_features/f23_pr_viewer.js` | VERIFIED |
| 12 | F12: PR Detail Header & Meta | `PRDetailView.tsx` header with status badge, author metadata, timestamps, branch pills | M3 | `e2e/tier1_features/f23_pr_viewer.js` | VERIFIED |
| 13 | F13: PR Detail Conversation Tab | Render PR description with markdown, chronological timeline of comments and commits | M3 | `e2e/tier1_features/f23_pr_viewer.js` | VERIFIED |
| 14 | F14: PR Detail Commits Tab | Render list of commits in PR with author/date info and diff navigation links | M3 | `e2e/tier1_features/f23_pr_viewer.js` | VERIFIED |
| 15 | F15: PR Detail Files Changed Tab | Interactive Unified & Split diff views with file selector, additions/deletions stats, inline review notes | M3 | `e2e/tier1_features/f23_pr_viewer.js` | VERIFIED |
| 16 | F16: Interactive Issue List View | `IssuesView.tsx` with open/closed status filters, author filter, label badges, instant search | M3 | `e2e/tier1_features/f24_issues_tracker.js` | VERIFIED |
| 17 | F17: Issue Detail View Header & Meta | `IssueDetailView.tsx` header with status badge, author metadata, timestamps, label chips | M3 | `e2e/tier1_features/f24_issues_tracker.js` | VERIFIED |
| 18 | F18: Issue Detail Discussion Tab | Render Markdown-rendered issue description and chronological comment timeline | M3 | `e2e/tier1_features/f24_issues_tracker.js` | VERIFIED |
| 19 | F19: Integrated 4-Tab Top Navbar | Update top navbar in `App.tsx` to `Code`, `Commits <count>`, `Issues <count>`, `Pull Requests <count>` with active states | M3 | `e2e/tier1_features/f25_nav_routing.js` | VERIFIED |
| 20 | F20: Deep-Link Hash Routing | Robust hash router in `router.ts` for `#/issues`, `#/issues/<id>`, `#/pulls`, `#/pulls/<id>`, `#/pulls/<id>/files`, `#/pulls/<id>/commits` | M3 | `e2e/tier1_features/f25_nav_routing.js` | VERIFIED |
| 21 | F21: Strict TypeScript Zero-Any Safety | `strict: true`, `@typescript-eslint/strict-type-checked`, zero `any`, strict null checks | M2, M3 | Compiler Gates | VERIFIED |
| 22 | F22: Vitest Comprehensive Unit Tests | Unit test suites for DAG LCA, 3-way diff, collab client, router, PR views, and Issue views | M2, M3 | `npm test` | VERIFIED |
| 23 | F23: Multi-Tier E2E Test Suite | 4-tier opaque-box E2E test suite (Tiers 1-4) covering full collaboration lifecycle | M4 | `e2e/runner.js` | VERIFIED |
| 24 | F24: Adversarial Coverage Hardening | White-box stress testing of complex DAGs, large diffs, malformed refs, zero-JS fallbacks | M4 | `e2e/tier2_boundaries/` | VERIFIED |

---

## 3. The 4-Tier Testing Methodology

The test suite is structured into 4 distinct verification tiers, ensuring total coverage from atomic feature behaviors to high-concurrency real-world workloads.

### Tier 1: Feature Coverage (>=5 Tests per Feature)

Tier 1 validates individual functional requirements against documented specifications. Each Phase 3 requirement (R1, R2, R3, R4, R5) has dedicated test suites with at least 5 comprehensive test cases:

#### R1: Git Collaboration Ref Discovery & Serialization (`tier1_features/f21_collab_export.js`)
- **T1.21.1 (PR Ref Discovery & Serialization)**: `sendforge export` discovers `refs/pull/*/head` and `refs/pull/*/meta` and serializes `pulls.json`.
- **T1.21.2 (Issue Ref Discovery & Serialization)**: `sendforge export` discovers `refs/issues/*` and serializes `issues.json`.
- **T1.21.3 (Metadata Stats Counter Extension)**: `meta.json` updated with accurate `issue_count`, `open_issue_count`, `pull_count`, and `open_pull_count`.
- **T1.21.4 (Pre-rendered Static HTML Fallbacks)**: `sendforge export` generates accessible zero-JS static HTML fallback views `pulls.html` and `issues.html`.
- **T1.21.5 (Post-Receive Hook Incremental Update)**: `sendforge hook` incrementally regenerates collaboration JSON files upon receiving ref updates via standard input.
- **T1.21.6 (Markdown Sanitization in HTML Fallbacks)**: Safe CommonMark rendering prevents script injection and unescaped HTML vulnerabilities.

#### R2: In-Browser DAG Merge-Base & LCA Engine (`tier1_features/f22_merge_base.js`)
- **T1.22.1 (Simple Fork LCA Resolution)**: Resolves branching base commit as Lowest Common Ancestor matching native `git merge-base`.
- **T1.22.2 (Divergent Branches LCA)**: Resolves common ancestor across multi-commit divergence on both target and feature branches.
- **T1.22.3 (Fast-Forward LCA Resolution)**: Resolves target branch tip as LCA for fast-forward branches.
- **T1.22.4 (Criss-Cross Merge Resolution)**: Accurately navigates complex multi-parent criss-cross merges to find topological LCA.
- **T1.22.5 (Disconnected Orphan Branches)**: Returns `null` merge base when branches share zero common history.
- **T1.22.6 (Commit History Range `mergeBase..head`)**: Collects all PR commits in reverse chronological order while strictly excluding target branch commits.

#### R3: Interactive Pull Request Viewer (`tier1_features/f23_pr_viewer.js`)
- **T1.23.1 (PR List View Status & Author Filter)**: Instant client-side filtering by status (`open`, `merged`, `closed`) and author query.
- **T1.23.2 (PR Detail Header & Metadata)**: Renders status badge, branch pills (`feature` -> `main`), author metadata, and timestamps.
- **T1.23.3 (Conversation Tab & Timeline)**: Markdown-rendered description and chronological discussion comments timeline.
- **T1.23.4 (Commits Tab & Commit List)**: Displays list of commits included in the PR branch with short SHAs and commit summaries.
- **T1.23.5 (Files Changed 3-Way Diff)**: Computes 3-way tree diff between merge base and PR head, providing unified/split diffs and addition/deletion counts.
- **T1.23.6 (Inline Review Notes Integration)**: Loads and binds review comments from `refs/notes/reviews` to specific files, diff hunks, or commits.

#### R4: Interactive Issue Tracker (`tier1_features/f24_issues_tracker.js`)
- **T1.24.1 (Issue List View Status & Author Search)**: Instant client-side filtering by status (`open`, `closed`) and author search query.
- **T1.24.2 (Label Chip Filtering)**: Color-coded badge rendering and multi-label filtering logic.
- **T1.24.3 (Issue Detail Header & Metadata)**: Displays status badge, author metadata, and creation timestamps.
- **T1.24.4 (Markdown Body Description)**: Renders CommonMark markdown with headings, code blocks, lists, and links.
- **T1.24.5 (Chronological Comments Timeline)**: Displays discussion comments in chronological order with author details.
- **T1.24.6 (Empty State & Search Fallbacks)**: Clean placeholder display when issue list is empty or matches no filters.

#### R5: Integrated 4-Tab Navigation & Deep-Link Routing (`tier1_features/f25_nav_routing.js`)
- **T1.25.1 (4-Tab Top Navbar)**: Renders `[ Code ]`, `[ Commits <count> ]`, `[ Issues <count> ]`, `[ Pull Requests <count> ]` with active states.
- **T1.25.2 (Dynamic Count Badges)**: Reflects total and open counts from `meta.json` in top navigation bar badges.
- **T1.25.3 (Issue Route Deep Linking)**: Hash deep linking support for `#/issues` and `#/issues/<id>`.
- **T1.25.4 (PR Route Deep Linking)**: Hash deep linking support for `#/pulls`, `#/pulls/<id>`, `#/pulls/<id>/files`, and `#/pulls/<id>/commits`.
- **T1.25.5 (Route AST Formatter)**: Formats and parses bidirectional route objects to/from URL hash strings.
- **T1.25.6 (Unrecognized Route Fallbacks)**: Malformed or invalid hash routes safely default to root Code view (`#/`).

---

### Tier 2: Boundary & Corner Cases

Tier 2 exposes the collaboration and DAG subsystem to edge cases, malformed inputs, and pathological Git data structures:

- **B01-B16 (Foundational Boundaries)**: Empty repos, 55-level deep nesting, unicode/emoji filenames, 10MB large blobs, binary files, corrupted zlib/SHA-1 objects, clock-warp timestamps, forced pushes, and octopus merges.
- **B17 (Empty Collaboration States)**: Zero PRs and Zero Issues produce valid empty JSON arrays `[]` and 0 counts in `meta.json`; pre-rendered fallback pages handle zero states gracefully; PRs/Issues with empty comments or labels arrays render cleanly.
- **B18 (Pathological DAG Topologies)**: Criss-cross merges with multiple candidate ancestors, deep 100+ commit linear chains computed in <50ms without stack overflow, disconnected orphan roots return null, and octopus merge commits traversed without cycle lockup.
- **B19 (Large Diffs & Complex File Operations)**: PRs with 55+ modified files, large text diffs (>1,000 lines), binary image assets marked as non-text, executable file mode changes (`0644` to `0755`), and zero-change PRs.
- **B20 (Malformed Metadata & Broken References)**: Non-JSON / corrupt metadata blobs handled safely without crash, missing head commit references handled gracefully, non-numeric ref IDs parsed safely, and missing target branch refs handled without panic.

---

### Tier 3: Cross-Feature Combinations

Tier 3 verifies integrated user journeys and feature interactions:

- **C01-C08 (Foundational Combinations)**: Full lifecycle pipeline, multi-branch/tag diffing workflows, static export offline hosting, mixed binary/text assets, and error recovery from corrupt objects.
- **C09 (Full Pull Request End-to-End Lifecycle)**: Branch creation -> commit changes -> push `refs/pull/1/head` & meta -> trigger `sendforge hook` -> fetch `pulls.json` -> compute merge-base -> verify commits list -> render 3-way files changed diff -> attach review notes.
- **C10 (Issue Creation, Multi-Label Filtering & Timeline Flow)**: Multi-issue creation -> export site -> filter by label & status -> inspect discussion timeline with multiple comments -> close issue and verify counter decrements.
- **C11 (Deep-Link Hash Navigation Across All Tabs)**: Direct URL deep-link to `#/pulls/1/files` loads PR files changed tab with diff; switching tabs updates URL hash to `#/pulls/1/commits` and `#/pulls/1`; jumping to `#/issues/2` transitions view cleanly.
- **C12 (Static HTML Fallback Parity with Client SPA)**: Pre-rendered zero-JS static HTML fallback `pulls.html` and `issues.html` match the client-side SPA rendered data byte-for-byte in title, author, and comments.

---

### Tier 4: Real-World Application Workloads

Tier 4 tests complete, production-grade workloads against native Git:

- **W01-W07 (Foundational Workloads)**: Multi-author 50-commit repo simulation, 1000-request high concurrency scraper flood, native Git dumb HTTP interop, and dynamic browser navigation.
- **W08 (Multi-Repository Collaboration Simulation)**: Multi-repo simulation with 10+ PRs, 20+ issues, and multiple branches and review notes per repository, maintaining strict ref isolation.
- **W09 (High-Concurrency Collab Scraper Flood)**: 200 concurrent requests targeting `/pulls.json`, `/issues.json`, `/pulls.html`, `/issues.html`, and `/meta.json` with 0 server drops and sub-25ms median latency.
- **W10 (Native Git Dumb HTTP Collaboration Interop)**: Native `git` CLI clones and fetches `refs/pull/*` and `refs/notes/reviews` over HTTP from Sendforge static server.
- **W11 (1,000-Commit Complex DAG Merge-Base Stress Test)**: Large-scale Git DAG traversal with 100+ commit chain and divergent branch forks, verifying 100% agreement against native `git merge-base`.

---

## 4. Authoritative Test Oracles & Output Derivation

For every test case, expected outputs are derived from authoritative, deterministic sources:

1. **Native Git Reference Engine (Oracle)**:
   - `git merge-base <commitA> <commitB>` provides authoritative Lowest Common Ancestor SHAs.
   - `git rev-list <base>..<head>` provides authoritative commit history ranges.
   - `git diff-tree -r <treeA> <treeB>` provides authoritative 3-way file change lists and addition/deletion line counts.
   - `git clone <http-url>` / `git fetch <http-url>` validates standard Git dumb HTTP protocol compliance.

2. **Interface Specifications & Schemas**:
   - JSON schemas for `pulls.json`, `issues.json`, and `meta.json` defined in `PROJECT.md § Interface Contracts`.
   - Hash routing AST grammar defined in `PROJECT.md § Hash Router AST Contract`.
   - CommonMark Markdown rendering specification for pre-rendered fallback views.

---

## 5. Test Harness Infrastructure

The test harness in `e2e/harness/` provides zero-dependency test primitives:

- **`framework.js`**: Custom async test runner with `describe`, `it`, lifecycle hooks, robust assertions, and multi-format reporting (Console, TAP, JUnit XML).
- **`supervisor.js`**: Spawns and supervises Rust `sendforge` binaries and `sendforge serve` daemon on ephemeral TCP ports with health checking.
- **`git_repo.js`**: Generates synthetic bare Git repositories, working clones, collaboration references (`createPullRequest`, `createIssue`, `attachReviewNote`), and synthetic DAG topologies (`simple_fork`, `divergent`, `fast_forward`, `criss_cross`, `orphan`, `linear_chain`).
- **`http_client.js`**: Issues HTTP/1.1 requests supporting RFC 7233 byte ranges, loose object fetching (`/objects/xx/xxx`), metadata retrieval (`/meta.json`), and load flooding.
- **`git_parser.js`**: In-harness reference parser for loose zlib objects, binary trees, commits, tags, and LCS diffing.
- **`dag_helper.js`**: In-harness DAG traversal engine for Lowest Common Ancestor (LCA) resolution, commit history range collection, and 3-way tree diffing.
- **`archive_validator.js`**: Binary validator for PKWARE ZIP and POSIX ustar `.tar.gz` archives.
- **`blame_helper.js`**: In-harness DAG walker and Myers line provenance attribution helper.

---

## 6. How to Run the Tests

### Quick Run (All Tiers)
```bash
./e2e/run_e2e.sh
# Or directly via Node:
node e2e/runner.js
```

### Running Specific Tiers
```bash
node e2e/runner.js --tier 1   # Run Tier 1 Feature Coverage
node e2e/runner.js --tier 2   # Run Tier 2 Boundaries
node e2e/runner.js --tier 3   # Run Tier 3 Combinations
node e2e/runner.js --tier 4   # Run Tier 4 Workloads
```

### Filtering by Test Suite Name
```bash
node e2e/runner.js --filter "collab"
node e2e/runner.js --filter "merge_base"
node e2e/runner.js --filter "pr_viewer"
node e2e/runner.js --filter "issues"
node e2e/runner.js --filter "routing"
```

### CI / Automated Reporting Output
```bash
# TAP format:
node e2e/runner.js --tap

# JUnit XML export:
node e2e/runner.js --junit
node e2e/runner.js --xml-out test-results/e2e-report.xml
```

---

## 7. Verification Criteria & Acceptance Gates

The E2E test suite enforces the following acceptance criteria:
1. **100% Pass Rate**: All test suites across Tiers 1 through 4 must pass with 0 failures and 0 unhandled rejections.
2. **Zero Resource Leaks**: All temporary Git repositories, sockets, and daemon processes must be cleanly terminated in `afterEach` / `afterAll` hooks.
3. **No Flakiness**: All tests use ephemeral ports and isolated temporary directories to prevent race conditions during parallel or repeated runs.
4. **Deterministic Oracle Validation**: All outputs are compared against deterministic ground truth from native Git commands or exact binary specification parsers.
