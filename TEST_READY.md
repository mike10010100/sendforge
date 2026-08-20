# Sendforge Phase 2 E2E Test Suite Ready

The Phase 2 Multi-Tier End-to-End (E2E) Test Suite for Sendforge has been fully designed, implemented, and verified.

## 1. Test Suite Summary

- **Total Test Suites**: 37 suites across 4 tiers
- **Total Executed Tests**: 168 tests
- **Phase 2 Test Suites Added**: 14 suites (50 new dedicated Phase 2 tests)
- **Harness Extensions**: 2 new modules (`archive_validator.js`, `blame_helper.js`)
- **Pass Rate**: 100% (168 / 168 passing, 0 failures, 0 skipped)
- **Execution Time**: ~78 seconds
- **Execution Command**: `./e2e/run_e2e.sh` or `node e2e/runner.js`

---

## 2. Test Inventory by Tier

### Tier 1: Feature Coverage (>=5 tests per Phase 2 feature)
- **R1: Tabbed Ref Selector** (`e2e/tier1_features/f17_tabbed_ref_selector.js`) — 6 tests
  - `T1.17.1`: Dedicated Branches tab and Tags tab partition refs without overlap
  - `T1.17.2`: Instantaneous client-side fuzzy search/filter logic
  - `T1.17.3`: Visual metadata badges (default branch, 7-char short commit hash, tag annotations)
  - `T1.17.4`: Keyboard navigation and accessibility (Escape, Enter, Tab state)
  - `T1.17.5`: Empty search results state and special ref formatting
  - `T1.17.6`: Selecting a ref updates client route while preserving file path

- **R2: In-Browser git blame** (`e2e/tier1_features/f18_in_browser_git_blame.js`) — 7 tests
  - `T1.18.1`: Single-commit root attribution (all lines attributed to initial commit)
  - `T1.18.2`: Multi-commit backward DAG traversal with Myers diff line mapping
  - `T1.18.3`: Unmodified line preservation across multiple commits
  - `T1.18.4`: Blame hunk aggregation (consecutive lines grouped into hunks)
  - `T1.18.5`: Relative age heatmap scale calculation (0.0 oldest to 1.0 newest)
  - `T1.18.6`: Interactive BlameView UI and diff links (`#/commit/{sha}`)
  - `T1.18.7`: BlobView Code/Blame toggle mode state transitions

- **R3: File Permalinks & Line Highlighting** (`e2e/tier1_features/f19_file_permalinks_highlighting.js`) — 6 tests
  - `T1.19.1`: Single line hash parsing (`#L42`) and CSS highlight class application
  - `T1.19.2`: Multi-line range hash parsing (`#L10-L25`) and inclusive highlighting
  - `T1.19.3`: Shift-click multi-line selection algorithm (forward and backward selection)
  - `T1.19.4`: Immutable commit SHA permalink generation
  - `T1.19.5`: Hashchange event listener and deep link auto-scroll target calculation
  - `T1.19.6`: Permalinks work identically in both Code View and Blame View

- **R4: Raw Blob & Snapshot Archive Generation** (`e2e/tier1_features/f20_raw_blob_snapshot_archives.js`) — 6 tests
  - `T1.20.1`: Raw blob content extraction and plain text display
  - `T1.20.2`: Client-side ZIP archive generator creates valid PKWARE ZIP
  - `T1.20.3`: Client-side Tarball generator creates valid POSIX ustar `.tar.gz`
  - `T1.20.4`: Snapshot archive path prefixing matching git archive conventions
  - `T1.20.5`: File mode preservation in archive headers (`0755` vs `0644`)
  - `T1.20.6`: Download trigger filename and MIME type selection

### Tier 2: Boundary & Corner Cases
- **`e2e/tier2_boundaries/b13_ref_selector_empty_and_special_refs.js`** — 4 tests
  - `B13.1`: Zero-tag repository returns empty tags array without crashing
  - `B13.2`: Ref filter with non-matching query displays empty match state
  - `B13.3`: Special branch names (slashes, dots, unicode emojis) preserve character integrity
  - `B13.4`: Lightweight tags and annotated tags distinguishable in ref list

- **`e2e/tier2_boundaries/b14_blame_edge_cases.js`** — 5 tests
  - `B14.1`: Blame on 0-byte empty file returns 0 lines without error
  - `B14.2`: Blame on single-line file across revisions
  - `B14.3`: Blame on file untouched across 20+ commits correctly identifies ancient commit
  - `B14.4`: Blame on multi-parent merge commit traverses first-parent DAG
  - `B14.5`: Binary file blame guard detects binary payload and refuses line diff

- **`e2e/tier2_boundaries/b15_permalink_boundary_cases.js`** — 5 tests
  - `B15.1`: Degenerate single-line ranges (`#L15-L15`) normalize to `#L15`
  - `B15.2`: Inverted line range (`#L50-L10`) normalizes to `start=10, end=50`
  - `B15.3`: Out-of-bounds line numbers are safely clamped to file line count
  - `B15.4`: Malformed and empty hash tokens return null without throwing errors
  - `B15.5`: URL hash preservation during branch/commit ref switching

- **`e2e/tier2_boundaries/b16_archive_generation_corner_cases.js`** — 5 tests
  - `B16.1`: Empty file list produces valid empty ZIP and Tarball
  - `B16.2`: Archive containing 0-byte empty files generates valid entries with CRC=0
  - `B16.3`: Large tree archive with 150+ files parses and validates completely
  - `B16.4`: Pure binary files preserve exact byte-for-byte SHA-256 in archives
  - `B16.5`: POSIX ustar long path (>100 characters) prefix/name splitting compliance

### Tier 3: Cross-Feature Combinations
- **`e2e/tier3_combinations/c06_ref_switch_to_blame_permalink_flow.js`** — 1 test
  - `C6.1`: Full workflow: RefSelector tag switch -> Blame calculation -> Range selection -> Immutable permalink
- **`e2e/tier3_combinations/c07_permalink_load_to_archive_download_flow.js`** — 1 test
  - `C7.1`: Load immutable permalink route, verify line highlighting, and export exact commit snapshot
- **`e2e/tier3_combinations/c08_blame_diff_navigation_and_raw_export.js`** — 1 test
  - `C8.1`: Navigate Blame hunks -> Follow diff link -> Review diff -> Extract raw blob

### Tier 4: Real-World Application Workloads
- **`e2e/tier4_workloads/w05_multibranch_multitag_full_workflow.js`** — 1 test
  - `W5.1`: Complete multi-branch multi-tag session: RefSelector -> Tree -> Blame -> Permalink -> Archive
- **`e2e/tier4_workloads/w06_deep_blame_provenance_validation.js`** — 1 test
  - `W6.1`: In-harness blame matches native `git blame --line-porcelain` 100% line-for-line
- **`e2e/tier4_workloads/w07_snapshot_archive_extraction_validation.js`** — 1 test
  - `W7.1`: In-browser ZIP and Tarball archives extract and match native repo byte-for-byte

---

## 3. How to Run

```bash
# Run entire test suite:
./e2e/run_e2e.sh

# Run specific tier:
node e2e/runner.js --tier 1
node e2e/runner.js --tier 2
node e2e/runner.js --tier 3
node e2e/runner.js --tier 4

# Run with JUnit XML output:
node e2e/runner.js --junit --xml-out test-results/e2e-report.xml
```
