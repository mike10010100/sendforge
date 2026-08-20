# Sendforge E2E Test Suite & Automated Harness: TEST_READY

**Status:** Complete & Ready  
**Date:** 2026-08-19  
**Harness Version:** 1.0.0  
**Test Coverage:** 4 Tiers, 37 Test Suites, 118+ Automated Assertions  

---

## 1. Overview & Architecture

The Sendforge E2E Test Suite provides an automated, requirement-driven, opaque-box integration and verification harness designed to rigorously test all server, hook, static exporter, dumb HTTP protocol, Git loose object parsing, zlib decompression, Web Worker off-thread diffing, and zero-JS HTML fallback components.

```
e2e/
├── harness/
│   ├── framework.js             # Zero-dependency async test framework (describe, it, assert, hooks, TAP, JUnit)
│   ├── supervisor.js            # Subprocess manager for Sendforge CLI and daemon execution with health checks
│   ├── git_repo.js              # Synthetic Git bare & working repo generator (commits, tags, merges, corruptions)
│   ├── http_client.js           # HTTP client helper for Dumb HTTP, CORS, Range requests, and scraper floods
│   ├── html_validator.js        # Zero-JS HTML parser and semantic landmark assertion validator
│   └── git_parser.js            # In-harness reference Git object parser (zlib, tree, commit, tag, blob, Myers diff)
├── tier1_features/              # Tier 1: 16 Feature Isolation Suites (89 test cases, >=5 per feature)
│   ├── f01_bare_repo_init.js
│   ├── f02_post_receive_hook.js
│   ├── f03_dumb_http_info.js
│   ├── f04_meta_json_generator.js
│   ├── f05_static_html_fallback.js
│   ├── f06_static_commit_log.js
│   ├── f07_commonmark_readme.js
│   ├── f08_zlib_decompression.js
│   ├── f09_binary_tree_parser.js
│   ├── f10_text_commit_tag_parser.js
│   ├── f11_blob_reader_detection.js
│   ├── f12_caching_ref_resolver.js
│   ├── f13_worker_diffing.js
│   ├── f14_reactive_ui_navigation.js
│   ├── f15_static_http_server.js
│   └── f16_static_exporter.js
├── tier2_boundaries/            # Tier 2: 12 Boundary & Corner Case Suites (20 test cases)
│   ├── b01_empty_repository.js
│   ├── b02_deep_nested_paths.js
│   ├── b03_unicode_emoji_special_names.js
│   ├── b04_large_file_blob.js
│   ├── b05_pure_binary_blobs.js
│   ├── b06_corrupted_zlib_loose_objects.js
│   ├── b07_corrupted_sha1_mismatch.js
│   ├── b08_clock_warp_timestamps.js
│   ├── b09_missing_dangling_refs.js
│   ├── b10_forced_push_history_rewinds.js
│   ├── b11_zero_byte_empty_files.js
│   └── b12_octopus_merges.js
├── tier3_combinations/          # Tier 3: 5 Cross-Feature Integration Workflows (5 test cases)
│   ├── c01_full_lifecycle_pipeline.js
│   ├── c02_multibranch_tag_diff_workflow.js
│   ├── c03_static_export_offline_hosting.js
│   ├── c04_mixed_binary_text_assets.js
│   └── c05_error_recovery_resilient_fallbacks.js
├── tier4_workloads/             # Tier 4: 4 Real-World Application Workloads (4 test cases)
│   ├── w01_multiauthor_repo_simulation.js
│   ├── w02_high_concurrency_scraper_flood.js
│   ├── w03_native_git_dumb_http_interop.js
│   └── w04_dynamic_browser_navigation_diff.js
├── runner.js                    # Master test runner with CLI argument parsing & filtering
└── run_e2e.sh                   # Executable bash launcher
```

---

## 2. Test Tiers & Feature Matrix

### Tier 1: Feature Isolation Coverage (89 Tests, 16 Features)
| Feature ID | Name | Source | Test File | Test Cases |
| :--- | :--- | :--- | :--- | :---: |
| **F1** | Bare Repo Initialization | ORIGINAL_REQUEST §R1 | `f01_bare_repo_init.js` | 6 |
| **F2** | Post-Receive Hook Handler | ORIGINAL_REQUEST §R1 | `f02_post_receive_hook.js` | 6 |
| **F3** | Dumb HTTP Server-Info (`info/refs`) | ORIGINAL_REQUEST §R1 | `f03_dumb_http_info.js` | 6 |
| **F4** | Metadata Generator (`meta.json`) | ORIGINAL_REQUEST §R1 | `f04_meta_json_generator.js` | 6 |
| **F5** | Static HTML Fallback (`index.html`) | ORIGINAL_REQUEST §R1 | `f05_static_html_fallback.js` | 6 |
| **F6** | Static Commit Log Fallback (`log.html`) | ORIGINAL_REQUEST §R1 | `f06_static_commit_log.js` | 5 |
| **F7** | CommonMark README Renderer | ORIGINAL_REQUEST §R1 | `f07_commonmark_readme.js` | 5 |
| **F8** | Zlib Loose Object Decompression | ORIGINAL_REQUEST §R2 | `f08_zlib_decompression.js` | 5 |
| **F9** | Binary Tree Object Parser | ORIGINAL_REQUEST §R2 | `f09_binary_tree_parser.js` | 6 |
| **F10** | Text Commit & Tag Parser | ORIGINAL_REQUEST §R2 | `f10_text_commit_tag_parser.js` | 6 |
| **F11** | Blob Reader & Binary Detection | ORIGINAL_REQUEST §R2 | `f11_blob_reader_detection.js` | 5 |
| **F12** | In-Browser Object Cache & Ref Resolver | ORIGINAL_REQUEST §R2 | `f12_caching_ref_resolver.js` | 5 |
| **F13** | Web Worker Diffing (Unified & Split) | ORIGINAL_REQUEST §R2 | `f13_worker_diffing.js` | 6 |
| **F14** | In-Browser Reactive UI & Navigation | ORIGINAL_REQUEST §R2 | `f14_reactive_ui_navigation.js` | 5 |
| **F15** | Static HTTP Server (CORS, Range) | ORIGINAL_REQUEST §R3 | `f15_static_http_server.js` | 6 |
| **F16** | Standalone Static Exporter | ORIGINAL_REQUEST §R3 | `f16_static_exporter.js` | 5 |

### Tier 2: Boundary & Corner Cases (12 Suites)
- **B1**: Empty repository with zero commits (`b01_empty_repository.js`)
- **B2**: 50+ deep nested directory structure (`b02_deep_nested_paths.js`)
- **B3**: Unicode, emoji, and special character filenames (`b03_unicode_emoji_special_names.js`)
- **B4**: Large files (10 MB blob) (`b04_large_file_blob.js`)
- **B5**: Pure binary blobs (null bytes, images, compiled binaries) (`b05_pure_binary_blobs.js`)
- **B6**: Corrupted zlib loose object handling (`b06_corrupted_zlib_loose_objects.js`)
- **B7**: Corrupted SHA-1 / object payload mismatch (`b07_corrupted_sha1_mismatch.js`)
- **B8**: Clock-warp commit timestamps (future timestamps, negative offsets) (`b08_clock_warp_timestamps.js`)
- **B9**: Missing / dangling ref handling (`b09_missing_dangling_refs.js`)
- **B10**: Forced push history rewinds (`b10_forced_push_history_rewinds.js`)
- **B11**: 0-byte empty files (`b11_zero_byte_empty_files.js`)
- **B12**: Octopus merges (commits with 3+ parent hashes) (`b12_octopus_merges.js`)

### Tier 3: Cross-Feature Combination Workflows (5 Workflows)
- **C1: Full Lifecycle Pipeline**: `sendforge init` -> git push -> post-receive hook -> `meta.json` + `index.html` + `log.html` -> `sendforge serve` -> client loose object fetch & tree traversal.
- **C2: Multi-Branch & Tag Diffing**: Baseline commit -> feature branch -> annotated tag -> fetch revisions and compute off-thread unified and split diffs.
- **C3: Static Export & Offline Hosting**: `sendforge export` -> standalone output directory -> generic HTTP server hosting -> zero compute validation.
- **C4: Mixed Binary & Text Assets**: Heterogeneous repository with markdown, rust code, binary PNG, zero-byte `.gitkeep`, config JSON -> tree decoding and blob type identification.
- **C5: Error Recovery & Fallbacks**: Isolated corruption of non-critical object -> health of other tree nodes and forge UI preserved.

### Tier 4: Real-World Application Workloads (4 Workloads)
- **W1: Real-World 50-Commit Simulation**: 50 commits, 5 alternating authors, multiple branches, tags, changelogs, full history verification.
- **W2: High-Concurrency Scraper Flood**: 1,000 rapid GET requests under static serving across 50 concurrent lanes, asserting 100% 200 OK responses and zero connection drops.
- **W3: Native Git CLI Dumb HTTP Interoperability**: `git clone http://localhost:PORT/repo.git` using system Git CLI over Dumb HTTP protocol, followed by history check.
- **W4: Dynamic In-Browser Navigation & Diff Simulation**: Client SPA metadata fetch, branch selection, tree traversal, parent commit resolution, and off-thread diff computation.

---

## 3. Execution Commands

### Run Full Test Suite (All 4 Tiers)
```bash
./e2e/run_e2e.sh
# or
node e2e/runner.js
```

### Run Individual Tiers
```bash
./e2e/run_e2e.sh --tier 1    # Tier 1 Feature Isolation (89 tests)
./e2e/run_e2e.sh --tier 2    # Tier 2 Boundary & Corner Cases (20 tests)
./e2e/run_e2e.sh --tier 3    # Tier 3 Cross-Feature Integration (5 tests)
./e2e/run_e2e.sh --tier 4    # Tier 4 Real-World Workloads (4 tests)
```

### Formatted Reporting & CI Integration
```bash
# Output Test Anything Protocol (TAP) stream
./e2e/run_e2e.sh --tap

# Output JUnit XML report
./e2e/run_e2e.sh --junit

# Save JUnit XML report to file
./e2e/run_e2e.sh --xml-out report.xml

# Filter test suites by regex
./e2e/run_e2e.sh --filter "Binary Tree|Zlib|Diffing"
```

---

## 4. Verification Gate Compliance

| Gate | Requirement | Implementation in E2E Harness |
| :--- | :--- | :--- |
| **G1** | Rust Safety & Zero Panic | Subprocess supervisor enforces exit code 0, non-crashing structured error handling |
| **G2** | TS Strict & Zero-Any | Harness tests typed contracts, discriminated union headers, and Web Worker RPC schemas |
| **G3** | Zero-JS Fallback | `html_validator.js` validates semantic HTML, landmarks, file tree, and README without JS |
| **G4** | Dumb HTTP Protocol | Native `git clone http://...` interoperability tests in W3 |
| **G5** | Performance & Resilience | High-concurrency scraper flood in W2 (1,000 requests, 0 dropped connections) |
