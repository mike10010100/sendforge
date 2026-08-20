# E2E Test Infra: Sendforge

## Test Philosophy
- Opaque-box, requirement-driven testing. No reliance on implementation internals.
- Verification mechanism follows progressive testability: tests test against CLI, HTTP endpoints, static files, and browser runtime assertions.
- Methodology: 4-Tier Structured Testing (Category-Partition, Boundary Value Analysis, Pairwise Combinations, Real-World Workloads).

## Feature Inventory & Test Coverage Goals
| # | Feature | Source (Requirement) | Tier 1 (Min 5) | Tier 2 (Boundaries) | Tier 3 (Combos) |
|---|---------|----------------------|:--------------:|:-------------------:|:---------------:|
| 1 | Bare Repo Initialization (`sendforge init`) | ORIGINAL_REQUEST §R1 | 5 | 3 | ✓ |
| 2 | Post-Receive Hook Handler (`sendforge hook`) | ORIGINAL_REQUEST §R1 | 5 | 3 | ✓ |
| 3 | Dumb HTTP Server-Info (`info/refs`) | ORIGINAL_REQUEST §R1 | 5 | 2 | ✓ |
| 4 | Metadata Generator (`meta.json`) | ORIGINAL_REQUEST §R1 | 5 | 3 | ✓ |
| 5 | Static HTML Fallback Generator (`index.html`) | ORIGINAL_REQUEST §R1 | 5 | 3 | ✓ |
| 6 | Static Commit Log Fallback (`log.html`) | ORIGINAL_REQUEST §R1 | 5 | 2 | ✓ |
| 7 | CommonMark README Renderer | ORIGINAL_REQUEST §R1 | 5 | 3 | ✓ |
| 8 | Zlib Loose Object Decompression | ORIGINAL_REQUEST §R2 | 5 | 3 | ✓ |
| 9 | Binary Tree Object Parser | ORIGINAL_REQUEST §R2 | 5 | 3 | ✓ |
| 10 | Text Commit & Tag Parser | ORIGINAL_REQUEST §R2 | 5 | 3 | ✓ |
| 11 | Blob Reader & Text/Binary Detection | ORIGINAL_REQUEST §R2 | 5 | 3 | ✓ |
| 12 | In-Browser Object Caching & Ref Resolver | ORIGINAL_REQUEST §R2 | 5 | 2 | ✓ |
| 13 | Web Worker Diffing (Unified & Split) | ORIGINAL_REQUEST §R2 | 5 | 3 | ✓ |
| 14 | In-Browser Reactive UI & File Navigation | ORIGINAL_REQUEST §R2 | 5 | 2 | ✓ |
| 15 | Static HTTP Server (`sendforge serve`, CORS, Range) | ORIGINAL_REQUEST §R3 | 5 | 3 | ✓ |
| 16 | Standalone Static Exporter (`sendforge export`) | ORIGINAL_REQUEST §R3 | 5 | 2 | ✓ |

## Test Architecture
- **E2E Test Runner**: Standalone runner script/executable executing test scenarios against compiled `sendforge` binaries and frontend artifacts.
- **Directory Layout**:
  - `e2e/harness/`: Test harness, process supervisor (launches `sendforge serve`, temp Git repos), HTTP client, assertion helpers.
  - `e2e/tier1_features/`: 80+ isolated tests (>=5 tests for each of the 16 features).
  - `e2e/tier2_boundaries/`: 12+ boundary tests (empty repo, 50+ nested paths, unicode/emoji filenames, 10MB file, corrupted zlib, clock-warp, octopus merge, etc.).
  - `e2e/tier3_combinations/`: Multi-step cross-feature lifecycle workflows.
  - `e2e/tier4_workloads/`: Real-world 50-commit repos, zero-JS scraper flood simulation, native Git CLI dumb HTTP fetch, browser DOM navigation validation.

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|----------|--------------------|------------|
| 1 | Full 50-Commit Multi-Author Repo Lifecycle | F1-F16 | High |
| 2 | High-Concurrency Zero-JS Scraper Flood (1000 requests) | F1, F3, F4, F5, F6, F15 | High |
| 3 | Native Git CLI Dumb HTTP Interoperability (`git clone http://...`) | F1, F3, F15 | Medium |
| 4 | Dynamic In-Browser Navigation & Diff Workflow Simulation | F4, F8-F14, F15 | High |

## Coverage Thresholds
- **Tier 1**: ≥80 test cases (≥5 per feature across 16 features)
- **Tier 2**: ≥12 boundary and corner case test suites
- **Tier 3**: ≥5 complete cross-feature lifecycle workflows
- **Tier 4**: ≥4 realistic end-to-end application workloads
- **Total Minimum Test Cases**: >100 automated test assertions
