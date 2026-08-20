# Sendforge Multi-Tier E2E Testing Infrastructure (Phase 4)

## 1. Overview & Architecture

The Sendforge Phase 4 End-to-End (E2E) Test Suite is an opaque-box, multi-tier testing framework engineered to validate all features of the static Git forge server and in-browser client. It tests the complete integrated stack—including HTTP RFC 7233 Byte-Range Packfile (`.pack` / `.idx` v2) reading, OFS/REF delta reconstruction, 50+ language zero-dependency syntax tokenization, search match highlighting, interactive Issue and Pull Request creation modals, `git push` command generation, and standard RFC 2822 `git format-patch` export compatible with `git am`—against native Git reference implementations.

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
│ │ Coverage (F1-32)│ │ & Corner (B1-27)│ │ Workflow(C17)│ │ Workloads │ │
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
│ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────────────┐ │
│ │ArchiveValidator  │ │HtmlValidator     │ │PackHelper (Idx/Delta)    │ │
│ └──────────────────┘ └──────────────────┘ └──────────────────────────┘ │
│ ┌──────────────────┐ ┌──────────────────┐                              │
│ │SyntaxValidator   │ │CollabModalHelper │                              │
│ └──────────────────┘ └──────────────────┘                              │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Comprehensive Feature Inventory (F01–F32)

| # | Feature | Description | Milestone | Suite Path | Status |
|---|---------|-------------|-----------|------------|--------|
| 1 | F01: Bare Repository Initialization | Bare repository structure and default branch config | M1 | `e2e/tier1_features/f01_bare_repo_init.js` | VERIFIED |
| 2 | F02: Post-Receive Hook Script | Incremental metadata update on git push | M1 | `e2e/tier1_features/f02_post_receive_hook.js` | VERIFIED |
| 3 | F03: Dumb HTTP Info/Refs | `info/refs` and `objects/info/packs` generation | M1 | `e2e/tier1_features/f03_dumb_http_info.js` | VERIFIED |
| 4 | F04: Meta JSON Generator | Repository stats, branch/tag counts, readme flags | M1 | `e2e/tier1_features/f04_meta_json_generator.js` | VERIFIED |
| 5 | F05: Static HTML Fallback | Zero-JS root directory tree and sanitized CommonMark | M1 | `e2e/tier1_features/f05_static_html_fallback.js` | VERIFIED |
| 6 | F06: Static Commit Log View | Pre-rendered commit list with author, date, and commit link | M1 | `e2e/tier1_features/f06_static_commit_log.js` | VERIFIED |
| 7 | F07: CommonMark README Parser | Pre-render markdown README with headings, lists, tables | M1 | `e2e/tier1_features/f07_commonmark_readme.js` | VERIFIED |
| 8 | F08: Zlib Decompression | Inflate raw Git loose objects and verify SHA-1 | M1 | `e2e/tier1_features/f08_zlib_decompression.js` | VERIFIED |
| 9 | F09: Binary Tree Parser | Parse Git binary tree objects and decode file modes/paths | M1 | `e2e/tier1_features/f09_binary_tree_parser.js` | VERIFIED |
| 10 | F10: Text Commit/Tag Parser | Parse author, committer, GPG signatures, annotated tags | M1 | `e2e/tier1_features/f10_text_commit_tag_parser.js` | VERIFIED |
| 11 | F11: Blob Reader & MIME Detection | Binary vs text detection and UTF-8 decode | M1 | `e2e/tier1_features/f11_blob_reader_detection.js` | VERIFIED |
| 12 | F12: Caching Ref Resolver | In-memory ref cache and packed-refs fallback | M1 | `e2e/tier1_features/f12_caching_ref_resolver.js` | VERIFIED |
| 13 | F13: Web Worker Myers Diffing | Offload tree diffing and Myers hunk generation | M1 | `e2e/tier1_features/f13_worker_diffing.js` | VERIFIED |
| 14 | F14: Reactive UI Navigation | Client SPA state navigation and URL synchronization | M1 | `e2e/tier1_features/f14_reactive_ui_navigation.js` | VERIFIED |
| 15 | F15: Static HTTP Server Daemon | Static file server with RFC 7233 byte-range support | M1 | `e2e/tier1_features/f15_static_http_server.js` | VERIFIED |
| 16 | F16: Standalone Static Exporter | Self-contained static site directory exporter | M1 | `e2e/tier1_features/f16_static_exporter.js` | VERIFIED |
| 17 | F17: Tabbed Ref Selector | Dedicated branches/tags tabs, fuzzy filter, badges | Phase 2 | `e2e/tier1_features/f17_tabbed_ref_selector.js` | VERIFIED |
| 18 | F18: In-Browser git blame | Reverse DAG line provenance attribution | Phase 2 | `e2e/tier1_features/f18_in_browser_git_blame.js` | VERIFIED |
| 19 | F19: File Permalinks & Line Highlights | `#L42` and `#L10-L25` selection and immutable links | Phase 2 | `e2e/tier1_features/f19_file_permalinks_highlighting.js` | VERIFIED |
| 20 | F20: Snapshot Archive Generation | In-browser PKWARE ZIP and POSIX ustar `.tar.gz` | Phase 2 | `e2e/tier1_features/f20_raw_blob_snapshot_archives.js` | VERIFIED |
| 21 | F21: Collaboration Ref Discovery | Export `refs/pull/*`, `refs/issues/*`, `refs/notes/*` | Phase 3 | `e2e/tier1_features/f21_collab_export.js` | VERIFIED |
| 22 | F22: In-Browser DAG Merge-Base (LCA) | Lowest Common Ancestor DAG calculation | Phase 3 | `e2e/tier1_features/f22_merge_base.js` | VERIFIED |
| 23 | F23: Interactive Pull Request Viewer | PR list, conversation tab, commits, 3-way diff | Phase 3 | `e2e/tier1_features/f23_pr_viewer.js` | VERIFIED |
| 24 | F24: Interactive Issue Tracker | Issue list, labels, conversation timeline | Phase 3 | `e2e/tier1_features/f24_issues_tracker.js` | VERIFIED |
| 25 | F25: 4-Tab Top Navbar & Hash Router | Code, Commits, Issues, Pull Requests navigation | Phase 3 | `e2e/tier1_features/f25_nav_routing.js` | VERIFIED |
| 26 | F26: Git .idx v2 Binary Parser | Fanout binary search, 20-byte SHA-1 table, CRC32, 4/8-byte offsets | Phase 4 | `e2e/tier1_features/f26_pack_idx_v2.js` | VERIFIED |
| 27 | F27: Byte-Range Packfile Fetcher | RFC 7233 range requests, object header decoding, inflate | Phase 4 | `e2e/tier1_features/f27_pack_byte_range.js` | VERIFIED |
| 28 | F28: OFS/REF Delta Decompression | Variable negative offsets, REF SHA-1, opcode COPY/INSERT | Phase 4 | `e2e/tier1_features/f28_delta_decompression.js` | VERIFIED |
| 29 | F29: 50+ Language Syntax Highlighter | Zero-dependency lexical tokenizer, multi-line state, WCAG AA colors | Phase 4 | `e2e/tier1_features/f29_syntax_highlighting.js` | VERIFIED |
| 30 | F30: In-File Search Highlight Overlay | Search highlight overlay with token span preservation & HTML escape | Phase 4 | `e2e/tier1_features/f30_search_highlighting.js` | VERIFIED |
| 31 | F31: Interactive Issue Modal & Export | Issue modal, git push ref generator, JSON download, drafts | Phase 4 | `e2e/tier1_features/f31_issue_modal_generator.js` | VERIFIED |
| 32 | F32: PR Modal & git format-patch | Branch selector, merge-base diff, git format-patch, git am verify | Phase 4 | `e2e/tier1_features/f32_pr_modal_format_patch.js` | VERIFIED |

---

## 3. The 4-Tier Testing Methodology

The Sendforge E2E test suite adheres to a strict 4-Tier verification hierarchy:

### Tier 1: Category-Partition Feature Coverage (>=5 Tests per Feature)
Validates individual functional requirements in strict isolation against documented specifications and interface contracts. Every feature in the inventory (F01–F32) has at least 5 independent, automated test cases.

#### Phase 4 Feature Suites:
- **Feature 26: Git `.idx` v2 Index Parser (`tier1_features/f26_pack_idx_v2.js`)** — 6 tests:
  - `T1.26.1`: Header verification (magic `\xFFtOc` and version 2), rejecting invalid headers/versions.
  - `T1.26.2`: 256-entry first-level fanout table parsing and $O(\log N)$ binary search lookup.
  - `T1.26.3`: 20-byte SHA-1 table lookup returning accurate object index for all objects in index.
  - `T1.26.4`: CRC32 checksum retrieval for packed objects matching computed IEEE 802.3 CRC32.
  - `T1.26.5`: 4-byte offset table resolution for standard offsets (< 2GB) and offset ordering.
  - `T1.26.6`: Byte span calculation `getByteSpan(shaHex, packFileSize)` for consecutive packed objects.

- **Feature 27: Byte-Range Packfile Fetching (`tier1_features/f27_pack_byte_range.js`)** — 6 tests:
  - `T1.27.1`: Byte-range HTTP RFC 7233 request fetches only target object slice from packfile.
  - `T1.27.2`: Variable-length object header decoding for standard object types (commit, tree, blob, tag).
  - `T1.27.3`: Object payload zlib decompression and uncompressed size validation.
  - `T1.27.4`: Direct retrieval of packed blobs, trees, and commits matching native Git objects.
  - `T1.27.5`: Fallback hierarchy in fetcher: Memory cache -> Loose object -> Packfile range -> 404 error.
  - `T1.27.6`: Discovery of packfiles via `objects/info/packs` and `.git/objects/pack/*.idx`.

- **Feature 28: OFS/REF Delta Decompression (`tier1_features/f28_delta_decompression.js`)** — 6 tests:
  - `T1.28.1`: `OBJ_OFS_DELTA` negative relative offset decoding and base object resolution.
  - `T1.28.2`: `OBJ_REF_DELTA` 20-byte base object SHA-1 lookup and base object resolution.
  - `T1.28.3`: Delta opcode COPY instruction interpreter (bitmask offsets/lengths, 65536 zero size default).
  - `T1.28.4`: Delta opcode INSERT instruction interpreter (literal byte insertions).
  - `T1.28.5`: Multi-level delta chain resolution (chains of length 2, 3, 5).
  - `T1.28.6`: LRU delta base caching for accelerating repetitive delta lookups.

- **Feature 29: Modular Syntax Highlighting Engine (`tier1_features/f29_syntax_highlighting.js`)** — 7 tests:
  - `T1.29.1`: Deterministic language detection by file path/extension across 50+ languages.
  - `T1.29.2`: Lexical tokenization of keywords, types, strings, comments, numbers, operators, punctuation.
  - `T1.29.3`: Multi-line state machine for block comments (`/* ... */`) across line boundaries.
  - `T1.29.4`: Multi-line state machine for docstrings (`""" ... """`) and template literals (`` `...` ``).
  - `T1.29.5`: Line-by-line syntax caching (`LineSyntaxCache`) and cache invalidation.
  - `T1.29.6`: WCAG 2.1 AA/AAA dark theme contrast ratio compliance (> 4.5:1 against `#0d1117`).
  - `T1.29.7`: HTML rendering of tokenized lines preserving exact whitespace and indentation.

- **Feature 30: In-File Search Highlight Overlay (`tier1_features/f30_search_highlighting.js`)** — 6 tests:
  - `T1.30.1`: Overlays `<mark class="search-match">` on matching tokens while preserving token syntax spans.
  - `T1.30.2`: Case-insensitive search query matching.
  - `T1.30.3`: Multiple search matches within a single line and within a single token.
  - `T1.30.4`: Search matches spanning across adjacent token boundaries.
  - `T1.30.5`: HTML entity escaping (`<`, `>`, `&`, `"`, `'`) inside match highlights and surrounding text.
  - `T1.30.6`: Empty or whitespace-only search query returns un-highlighted syntax HTML.

- **Feature 31: Interactive Issue Modal & Export (`tier1_features/f31_issue_modal_generator.js`)** — 6 tests:
  - `T1.31.1`: Modal UI state: title input, markdown description editor with live preview, label chips, author.
  - `T1.31.2`: Push command generation: `git push origin HEAD:refs/issues/<id>` with one-click copy format.
  - `T1.31.3`: JSON export generation: valid JSON payload with title, description, author, labels, timestamp.
  - `T1.31.4`: LocalStorage draft auto-saving and recovery per repository (`sendforge_draft_issue_<repo>`).
  - `T1.31.5`: Draft discard/clearing upon successful issue creation.
  - `T1.31.6`: Modal validation and submit button enabling only with non-empty title.

- **Feature 32: PR Modal & git format-patch Export (`tier1_features/f32_pr_modal_format_patch.js`)** — 6 tests:
  - `T1.32.1`: Modal UI state: target vs source branch selector with merge-base calculation.
  - `T1.32.2`: Live 3-way tree and file diff preview between target branch and source branch.
  - `T1.32.3`: Push command generation: `git push origin <branch>:refs/pull/<id>/head`.
  - `T1.32.4`: RFC 2822 standard `git format-patch` export (`From <hash>`, `From:`, `Date:`, `Subject: [PATCH]`, `---`, diffstat, diff hunks).
  - `T1.32.5`: Native `git am` ingestion test verifying exported patch applies cleanly to Git repository.
  - `T1.32.6`: LocalStorage draft auto-saving and recovery for PR state.

---

### Tier 2: Boundary Value Analysis & Corner Cases (>=5 Tests per Boundary)
Exhaustively stresses boundary conditions, degenerate states, pathological inputs, and extreme limits.

#### Phase 4 Boundary Suites:
- **Boundary 21: Deep Delta Chains & Cycle Detection (`tier2_boundaries/b21_deep_delta_chains.js`)** — 5 tests:
  - `B21.1`: Deep delta chain (depth 10) resolves accurately to original uncompressed base.
  - `B21.2`: Deep delta chain (depth 25) resolves within performance threshold without stack overflow.
  - `B21.3`: Circular delta reference detection (A -> B -> A) safely detected and rejected.
  - `B21.4`: Self-referential delta (A -> A) detected and rejected.
  - `B21.5`: Missing delta base object SHA-1 gracefully surfaces typed error.

- **Boundary 22: Packfiles > 2GB & 8-Byte Offsets (`tier2_boundaries/b22_packfile_large_offsets.js`)** — 5 tests:
  - `B22.1`: 8-byte secondary offset table indexing when MSB bit (0x80000000) is set in 4-byte offset table.
  - `B22.2`: Offset at exact 2 GiB boundary (0x80000000) correctly resolved via 8-byte table.
  - `B22.3`: Large 64-bit offsets (5 GiB, 10 GiB) encoded and decoded without precision loss.
  - `B22.4`: Out-of-bounds 8-byte table index triggers structured error.
  - `B22.5`: Sorted offset list properly handles mix of 4-byte and 8-byte offsets.

- **Boundary 23: Empty & Single-Byte Blobs in Packfiles (`tier2_boundaries/b23_empty_and_single_byte_blobs.js`)** — 5 tests:
  - `B23.1`: Packed empty file (0-byte blob) decoded with size=0 and empty payload.
  - `B23.2`: Packed 1-byte blob decoded with size=1 and accurate byte value.
  - `B23.3`: Delta between 0-byte base and non-empty target (pure INSERT opcode).
  - `B23.4`: Delta between non-empty base and 0-byte target (0-byte output).
  - `B23.5`: Delta reconstruction for large COPY with zero literal inserts.

- **Boundary 24: Syntax Corner Cases & Exotic Inputs (`tier2_boundaries/b24_syntax_corner_cases.js`)** — 5 tests:
  - `B24.1`: Unknown file extension or extensionless file defaults safely to plain text.
  - `B24.2`: Unclosed block comment (`/*` with no `*/`) tokenized gracefully to end of file.
  - `B24.3`: Unclosed string literal (`"hello...` with no closing quote) tokenized safely.
  - `B24.4`: Mixed line endings (`\r\n`, `\n`, `\r`) tokenized without extra blank tokens.
  - `B24.5`: Extremely long single line (10,000+ characters) tokenized without crash or lag.

- **Boundary 25: Malformed Pack Deltas & Corruptions (`tier2_boundaries/b25_corrupted_pack_deltas.js`)** — 5 tests:
  - `B25.1`: Reserved opcode 0x00 in delta stream throws error.
  - `B25.2`: COPY opcode specifying offset beyond base object length throws OutOfBoundsCopy error.
  - `B25.3`: Truncated delta payload (stream ends before instructed insert bytes) throws error.
  - `B25.4`: Corrupted zlib stream in packfile object throws DecompressionFailed error.
  - `B25.5`: CRC32 checksum mismatch in `.idx` detected and flagged.

- **Boundary 26: Search Highlighting Boundaries (`tier2_boundaries/b26_search_highlight_boundaries.js`)** — 5 tests:
  - `B26.1`: Empty search query `""` returns original tokens without modification.
  - `B26.2`: Search query containing regex special characters (`.*+?^${}()|[]\`) treated as literal text.
  - `B26.3`: Search query containing HTML characters (`<script>`, `&amp;`, `"test"`) safely escaped in output.
  - `B26.4`: Search query longer than line length returns unmodified tokens.
  - `B26.5`: Unicode emoji and non-ASCII search queries (`🎉`, `日本語`) matched accurately.

- **Boundary 27: Collaboration Modal Boundary Cases (`tier2_boundaries/b27_collab_modal_boundaries.js`)** — 5 tests:
  - `B27.1`: Branch names with slashes and special characters safely formatted in push commands.
  - `B27.2`: Large PR diff (100+ files) formatted into patch without truncation.
  - `B27.3`: PR with zero commits between branches (identical SHA) disables format-patch export.
  - `B27.4`: LocalStorage quota exceedance handled gracefully without crashing modal UI.
  - `B27.5`: Commit messages with multi-paragraph bodies and markdown preserved in format-patch.

---

### Tier 3: Cross-Feature Integration / Pairwise Combinations
Validates seamless interaction between disparate subsystems.

#### Phase 4 Combination Suites:
- **Combination 13: Packfile Fetching + Syntax Highlighting (`tier3_combinations/c13_pack_fetch_syntax_highlight.js`)** — 2 tests:
  - `C13.1`: Fetch packed multi-language source files via byte-range and render through syntax engine.
  - `C13.2`: Render TypeScript React component from packed object with syntax tokens.

- **Combination 14: PR Diff on Packed Commits (`tier3_combinations/c14_pr_diff_packed_commits.js`)** — 2 tests:
  - `C14.1`: Compute merge-base and 3-way tree diff between branches residing in `.pack` files.
  - `C14.2`: Generate live diffstat summary for packed branch comparison.

- **Combination 15: Issue Modal & Packed Repo Integration (`tier3_combinations/c15_issue_modal_packed_repo.js`)** — 2 tests:
  - `C15.1`: Create issue in packed repository, verify generated `refs/issues/<id>` push command and JSON download.
  - `C15.2`: Ingest generated issue ref via native git push into bare repo.

- **Combination 16: Search on Packed Syntax Blob (`tier3_combinations/c16_search_packed_syntax_blob.js`)** — 2 tests:
  - `C16.1`: Range-fetch packed blob, tokenize via syntax engine, and apply search highlight.
  - `C16.2`: Search across lines in packed multi-line comments.

- **Combination 17: Format-Patch Packed & git am (`tier3_combinations/c17_format_patch_packed_git_am.js`)** — 2 tests:
  - `C17.1`: Export multi-commit `git format-patch` from packed branches and apply cleanly via `git am`.
  - `C17.2`: Single-commit format-patch export for packed commit applied via `git am`.

---

### Tier 4: Real-World Workloads & High-Concurrency Application Scenarios
Simulates realistic end-user developer journeys and high-concurrency traffic floods.

#### Phase 4 Workload Suites:
- **Workload 12: Full Lifecycle Packfiles, Syntax & Collab (`tier4_workloads/w12_full_lifecycle_pack_syntax_collab.js`)** — 1 test:
  - `W12.1`: Full lifecycle: packfile fetch -> syntax tokens -> search highlight -> issue draft -> PR format-patch -> `git am` ingestion.

- **Workload 13: High-Concurrency Packfile Fetching (`tier4_workloads/w13_high_concurrency_pack_fetching.js`)** — 1 test:
  - `W13.1`: 50 concurrent byte-range requests fetching packed objects simultaneously under load with 0 failures.

- **Workload 14: Polyglot Syntax Browsing (`tier4_workloads/w14_polyglot_repo_syntax_browsing.js`)** — 1 test:
  - `W14.1`: Rapid sequential browsing of 30+ files across 20+ distinct languages with tokenizer state machine continuity.

- **Workload 15: Full Collaboration Lifecycle (`tier4_workloads/w15_full_collab_modal_workflow.js`)** — 1 test:
  - `W15.1`: Multi-contributor collaboration simulation with issues, PRs, diffs, patches, and `git am` ingestion.

---

## 4. Test Execution & Invocation Guide

### Running the Full E2E Test Suite
```bash
./e2e/run_e2e.sh
# or
node e2e/runner.js
```

### Running Specific Tiers
```bash
node e2e/runner.js --tier 1
node e2e/runner.js --tier 2
node e2e/runner.js --tier 3
node e2e/runner.js --tier 4
```

### Filtering by Feature or Name
```bash
node e2e/runner.js --filter "Feature 26"
node e2e/runner.js --filter "Pack"
```

### Generating Reports (Console / TAP / JUnit XML)
```bash
node e2e/runner.js --format tap
node e2e/runner.js --format junit --xml-out test-results.xml
```
