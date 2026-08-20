# Sendforge Multi-Tier E2E Testing Infrastructure

## 1. Overview & Architecture

The Sendforge Phase 2 End-to-End (E2E) Test Suite is an opaque-box, multi-tier testing framework engineered to validate all features of the static Git forge server and in-browser client. It tests the complete integrated stack—including Rust static file/loose object serving, Git hooks, metadata generation, client-side Loose Object DAG traversal, in-browser `git blame`, file permalinks & hash navigation, and client-side ZIP/tar.gz snapshot archive generation—against native Git reference implementations.

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
│ │ Coverage (F1-20)│ │ & Corner (B1-16)│ │ Workflow (C8)│ │ Workloads │ │
│ └─────────────────┘ └─────────────────┘ └──────────────┘ └───────────┘ │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Employs
┌───────────────────────────────────▼────────────────────────────────────┐
│ Test Harness (`e2e/harness/`)                                          │
│ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────────────┐ │
│ │Supervisor (Rust) │ │GitRepoHelper     │ │HttpClient (HTTP/Range)   │ │
│ └──────────────────┘ └──────────────────┘ └──────────────────────────┘ │
│ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────────────┐ │
│ │GitParser (Loose) │ │ArchiveValidator  │ │BlameValidator            │ │
│ └──────────────────┘ └──────────────────┘ └──────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. The 4-Tier Testing Methodology

The test suite is structured into 4 distinct verification tiers, ensuring total coverage from atomic feature behaviors to high-concurrency real-world workloads.

### Tier 1: Feature Coverage (>=5 Tests per Feature)

Tier 1 validates individual functional requirements against documented specifications. Each Phase 2 requirement (R1, R2, R3, R4) has dedicated test suites with at least 5 comprehensive test cases:

#### R1: Tabbed Ref Selector (`tier1_features/f17_tabbed_ref_selector.js`)
- **T1.17.1 (Tab Separation)**: Dedicated Branches tab and Tags tab partition refs without overlap or cross-contamination.
- **T1.17.2 (Instant Fuzzy Search)**: Substring and subsequence fuzzy search filter dynamically updates the visible list of branches/tags.
- **T1.17.3 (Visual Metadata Badges)**: Renders default branch badge, short 7-character commit SHA badge, and tag date/annotation badges.
- **T1.17.4 (Keyboard Navigation & Accessibility)**: Escape key dismisses popover, Enter selects highlighted ref, arrow keys navigate items.
- **T1.17.5 (Empty Search Results)**: Clean empty state displayed when search query matches no refs.
- **T1.17.6 (Ref Router State Transition)**: Selecting a ref updates client route while preserving file path when available.

#### R2: In-Browser Client-Side git blame (`tier1_features/f18_in_browser_git_blame.js`)
- **T1.18.1 (Single-Commit Attribution)**: Root commit correctly attributes 100% of lines to the initial commit author and SHA.
- **T1.18.2 (Multi-Commit Backward Traversal)**: Myers diff line attribution correctly traces modified lines across multiple parent commits.
- **T1.18.3 (Unmodified Line Preservation)**: Lines untouched in recent commits retain their original author, commit SHA, and timestamp.
- **T1.18.4 (Blame Hunk Aggregation)**: Contiguous lines from the same commit are grouped into distinct blame hunks with author metadata.
- **T1.18.5 (Relative Age Heatmap Scaling)**: Line age heatmap calculates normalized color intensities (0.0 oldest to 1.0 newest) based on commit timestamps.
- **T1.18.6 (Commit Diff Links)**: Blame hunks generate valid navigation links to the committing diff view (`#/commit/{sha}`).
- **T1.18.7 (Code/Blame View Mode Toggle)**: BlobView state switches seamlessly between syntax-highlighted Code View and interactive Blame View.

#### R3: File Permalinks & Line Highlighting (`tier1_features/f19_file_permalinks_highlighting.js`)
- **T1.19.1 (Single Line Hash Parsing & Highlighting)**: URL hash `#L42` highlights line 42 with `.line-highlighted` CSS class.
- **T1.19.2 (Multi-Line Range Hash Parsing)**: URL hash `#L10-L25` parses start/end bounds and highlights all lines in range inclusively.
- **T1.19.3 (Shift-Click Multi-Line Selection)**: Shift-clicking expands or contracts the selected range in both ascending and descending directions.
- **T1.19.4 (Immutable Permalinks Generation)**: Copy permalink button generates permanent URL resolving to immutable commit SHA (`#/blob/{sha}/{path}#L10-L25`).
- **T1.19.5 (Deep Link Auto-Scroll)**: Page load and `hashchange` events trigger auto-scroll calculation targeting the first highlighted line.
- **T1.19.6 (Blame View Permalink Parity)**: Line permalinks and range selections work identically in both Code View and Blame View.

#### R4: Raw Blob & Snapshot Archive Generation (`tier1_features/f20_raw_blob_snapshot_archives.js`)
- **T1.20.1 (Raw Blob View & Download)**: Raw button extracts unformatted blob content with appropriate MIME headers and plain text display.
- **T1.20.2 (Client-Side ZIP Archive Generation)**: Browser-side binary serializer produces valid PKWARE ZIP archives with deflate compression and CRC32 checksums.
- **T1.20.3 (Client-Side Tarball Archive Generation)**: Browser-side binary serializer produces valid POSIX ustar `.tar.gz` archives with 512-byte header blocks, octal checksums, and gzip framing.
- **T1.20.4 (Snapshot Archive Tree Prefixing)**: Snapshot archives include top-level folder prefix (e.g. `{repo}-{branch}/`) matching standard Git archive conventions.
- **T1.20.5 (File Mode Preservation)**: Preserves executable (`0o100755`) and normal (`0o100644`) file modes in archive headers.
- **T1.20.6 (Download Trigger Integration)**: Verifies client download helper triggers browser Blob/URL download with correct file extension.

---

### Tier 2: Boundary & Corner Cases

Tier 2 exposes the system to edge cases, malformed inputs, extreme scales, and pathological Git data structures:

- **B01-B12 (Foundational Boundaries)**: Empty repos, 55-level deep directory nesting, unicode/emoji filenames, 10MB large blobs, binary files, corrupted zlib/SHA-1 objects, clock-warp timestamps, forced pushes, and octopus merges.
- **B13 (Ref Selector Boundaries)**: Zero-tag repositories, non-matching search queries, branch names with slashes/dots/unicode, lightweight vs annotated tag target resolution.
- **B14 (Blame Edge Cases)**: Blame on 0-byte empty files, single-line files, files unchanged across 50 consecutive commits, multi-parent merge commits (first-parent DAG traversal), and binary file blame guards.
- **B15 (Permalink Boundary Cases)**: Degenerate ranges (`#L1-L1`), inverted ranges (`#L50-L10`), out-of-bounds line numbers (`#L99999`), malformed hash tokens (`#L`, `#Lfoo`), and hash preservation across view changes.
- **B16 (Archive Generation Corner Cases)**: Empty repository/tree archives, 0-byte empty file entries, 100+ file large tree archives, raw binary roundtripping, and POSIX ustar path splitting (>100 characters).

---

### Tier 3: Cross-Feature Combinations

Tier 3 verifies integrated user journeys and feature interactions:

- **C01-C05 (Foundational Combinations)**: Full lifecycle pipeline, multi-branch/tag diffing workflows, static export offline hosting, mixed binary/text assets, and error recovery from corrupt objects.
- **C06 (Ref Switch → Blame → Permalink Flow)**: Switch branch/tag via RefSelector → navigate tree to blob → toggle Blame View → select multi-line range → copy immutable permalink.
- **C07 (Permalink Load → Archive Download Flow)**: Open direct immutable permalink (`#/blob/{sha}/file#L10-L20`) → verify line range highlight and commit context → export and validate complete snapshot ZIP/tar.gz of that exact tree.
- **C08 (Blame → Diff Navigation → Raw Export Flow)**: Open Blame View → click commit diff link → inspect commit diff → navigate back → view raw blob → export snapshot archive.

---

### Tier 4: Real-World Application Workloads

Tier 4 tests complete, production-grade workloads against native Git:

- **W01-W04 (Foundational Workloads)**: Multi-author 50-commit repo simulation, 1000-request high concurrency scraper flood, native Git dumb HTTP interop, and dynamic browser navigation.
- **W05 (Multi-Branch, Multi-Tag Real Repo Full Workflow)**: Full simulated user session across a complex repository with 15+ commits, 4 branches, and 3 tags.
- **W06 (Deep Blame Provenance Validation)**: 10-revision file edited by 4 different authors with interleaved line additions, deletions, and edits—compared line-for-line against `git blame`.
- **W07 (Snapshot Archive Extraction & Validation)**: Client-generated ZIP and `.tar.gz` archives extracted in memory and validated byte-for-byte against native `git archive` and working tree checkouts.

---

## 3. Authoritative Test Oracles & Output Derivation

For every test case, expected outputs are derived from authoritative, deterministic sources:

1. **Native Git Reference Engine (Oracle)**:
   - `git blame -p <file>` / `git blame --line-porcelain` provides authoritative line-by-line commit SHA, author, and timestamp mappings.
   - `git archive --format=tar <ref>` / `git archive --format=zip <ref>` provides authoritative archive entry lists, directory prefixes, and file modes.
   - `git rev-parse`, `git ls-tree`, and `git cat-file` provide ground-truth OIDs and tree structures.

2. **Binary Specifications**:
   - **PKWARE ZIP**: End of Central Directory signature (`0x06054b50`), Central Directory Header signature (`0x02014b50`), Local File Header signature (`0x04034b50`), and IEEE 802.3 CRC32 checksums.
   - **POSIX ustar (IEEE Std 1003.1)**: 512-byte blocks, `"ustar\0"` / `"ustar  \0"` magic, 8-byte octal checksums, and proper prefix/name splitting for paths up to 256 characters.
   - **Gzip (RFC 1952)**: Magic bytes `0x1f 0x8b`, Deflate compression method `0x08`, and trailing CRC32/ISIZE.

---

## 4. Test Harness Infrastructure

The test harness in `e2e/harness/` provides zero-dependency test primitives:

- **`framework.js`**: Custom async test runner with `describe`, `it`, `beforeAll`, `afterAll`, `beforeEach`, `afterEach`, robust assertions (`assert.strictEqual`, `assert.deepEqual`, `assert.rejects`, `assert.match`), and multi-format reporting (Console, TAP, JUnit XML).
- **`supervisor.js`**: Spawns and supervises Rust `sendforge` binaries and `sendforge serve` daemon on ephemeral TCP ports with health checking.
- **`git_repo.js`**: Generates synthetic bare Git repositories, working clones, multi-branch DAGs, annotated/lightweight tags, and corrupt loose objects.
- **`http_client.js`**: Issues HTTP/1.1 requests supporting RFC 7233 byte ranges, loose object fetching (`/objects/xx/xxx`), metadata retrieval (`/meta.json`), and load flooding.
- **`git_parser.js`**: In-harness reference parser for loose zlib objects, binary trees, commits, tags, and LCS diffing.
- **`archive_validator.js`**: Specialized binary parser and extractor for validating PKWARE ZIP and POSIX ustar `.tar.gz` structures.
- **`blame_helper.js`**: In-harness DAG walker and Myers line provenance attribution helper.

---

## 5. How to Run the Tests

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
node e2e/runner.js --filter "blame"
node e2e/runner.js --filter "archive"
node e2e/runner.js --filter "permalink"
node e2e/runner.js --filter "ref_selector"
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

## 6. Verification Criteria & Acceptance Gates

The E2E test suite enforces the following acceptance criteria:
1. **100% Pass Rate**: All test suites across Tiers 1 through 4 must pass with 0 failures and 0 unhandled rejections.
2. **Zero Resource Leaks**: All temporary Git repositories, sockets, and daemon processes must be cleanly terminated in `afterEach` / `afterAll` hooks.
3. **No Flakiness**: All tests use ephemeral ports and isolated temporary directories to prevent race conditions during parallel or repeated runs.
4. **Deterministic Oracle Validation**: All outputs are compared against deterministic ground truth from native Git commands or exact binary specification parsers.
