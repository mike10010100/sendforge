# Project: Sendforge Phase 3

## Architecture
Sendforge Phase 3 extends the high-performance static Git forge in `/Users/mike10010100/git/hybrid-gitforge` with a database-free collaboration layer, featuring Git-native Pull Requests, Issue tracking, in-browser DAG merge-base calculation, Web Worker 3-way diffing, review notes integration, and zero-JS static HTML fallback pre-rendering.

- **Rust Core & Static Exporter (`sendforge`)**:
  - `#![forbid(unsafe_code)]` with zero `.unwrap()`/`.expect()`/`panic!` and strict Clippy deny rules.
  - Scans Git repository refs for `refs/pull/<id>/head`, `refs/pull/<id>/meta`, `refs/issues/<id>`, and `refs/notes/reviews`.
  - Serializes `static/pulls.json`, `static/issues.json`, and updates `meta.json` with open/total counts.
  - Pre-renders static zero-JS HTML fallback views (`static/pulls.html`, `static/issues.html`, detail pages) with sanitized Markdown rendering and 4-tab top navigation.
- **Client DAG & 3-Way Diff Engine (TypeScript)**:
  - In-browser DAG traversal (`dag.ts`) finding Lowest Common Ancestor (LCA / merge-base) between PR head commit and target branch tip.
  - Off-thread Web Worker (`diff.worker.ts`, `diff-algo.ts`) computing 3-way tree diffs without server compute.
  - Collaboration client (`collab-client.ts`) loading PR/Issue payloads and attaching `refs/notes/reviews` review comment threads to diff hunks/lines/commits.
- **Interactive UI & Hash Router (Preact SPA)**:
  - Top Navigation Bar: `[ 📁 Code ]` `[ 📜 Commits <count> ]` `[ 🎯 Issues <count> ]` `[ 🔀 Pull Requests <count> ]` with active states and dynamic count badges.
  - Pull Request Viewer (`PullRequestsView.tsx`, `PRDetailView.tsx`): List filtering/search, Conversation tab (markdown body + chronological timeline), Commits tab, Files Changed tab (interactive Unified/Split diffs with inline review comments).
  - Issue Tracker (`IssuesView.tsx`, `IssueDetailView.tsx`): List filtering/search, markdown body rendering, discussion comments timeline.
  - Hash Routing (`router.ts`): Deep linking for `#/issues`, `#/issues/<id>`, `#/pulls`, `#/pulls/<id>`, `#/pulls/<id>/files`, `#/pulls/<id>/commits`.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Browser Client (Preact SPA)                                                            │
│ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌──────────────┐ ┌─────────────┐ │
│ │  App.tsx Nav  │ │PullRequestsView│ │ PRDetailView │ │  IssuesView  │ │IssueDetail  │ │
│ │ (4 Tabs+Count)│ │ (Filter/Search)│ │(Conv/Comm/Diff)││ (Filter/Search│ │ (Md/Timeline│ │
│ └───────┬───────┘ └───────┬───────┘ └───────┬───────┘ └───────┬──────┘ └──────┬──────┘ │
│         │                 │                 │                 │               │        │
│ ┌───────▼─────────────────▼─────────────────▼─────────────────▼───────────────▼──────┐ │
│ │ Router (Hash Deep Links) / CollabClient (Notes & Metadata Integration)             │ │
│ └─────────────────────────┬───────────────────────────────────┬──────────────────────┘ │
│                           │                                   │                        │
│ ┌─────────────────────────▼──────────────┐ ┌──────────────────▼──────────────────────┐ │
│ │ DAG Traversal Engine (dag.ts)          │ │ Web Worker 3-Way Diff Engine            │ │
│ │ - In-Browser LCA Merge-Base Resolution │ │ - Tree Diff (Base vs Head) + Split Diff │ │
│ └─────────────────────────┬──────────────┘ └──────────────────┬──────────────────────┘ │
│                           │                                   │                        │
│ ┌─────────────────────────▼───────────────────────────────────▼──────────────────────┐ │
│ │ GitRepositoryClient (LRU Object Cache & Loose Git Object Fetcher)                  │ │
│ └─────────────────────────┬──────────────────────────────────────────────────────────┘ │
└───────────────────────────┼────────────────────────────────────────────────────────────┘
                            │ Fetch (/objects/xx/xxx, /pulls.json, /issues.json, /meta.json)
┌───────────────────────────▼────────────────────────────────────────────────────────────┐
│ Sendforge Static Site / Server (Rust Core & Static Exporter)                           │
│ - Discover refs/pull/*, refs/issues/*, refs/notes/reviews                              │
│ - Serializes static/pulls.json, static/issues.json, meta.json                          │
│ - Pre-renders zero-JS static HTML fallbacks (pulls.html, issues.html, detail views)  │
│ - Strict Safety: #![forbid(unsafe_code)], 0 unwrap/expect/panic, clock-warp safe       │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

## Feature Inventory
| # | Feature | Description | Milestone | Source | Status |
|---|---------|-------------|-----------|--------|--------|
| 1 | F01: Git Collaboration Ref Discovery | Discover `refs/pull/<id>/head`, `refs/pull/<id>/meta`, `refs/issues/<id>`, `refs/notes/reviews` in `src/repo/refs.rs` | M1 | ORIGINAL_REQUEST §R1 | DONE |
| 2 | F02: Collaboration Data Subsystem | Rust parser subsystem in `src/collab/` for PRs, Issues, Notes with JSON schema and Git commit fallback | M1 | ORIGINAL_REQUEST §R1 | DONE |
| 3 | F03: Metadata & Stats Count Extension | Extend `RepoStats` and `meta.json` with `issue_count`, `open_issue_count`, `pull_count`, `open_pull_count` | M1 | ORIGINAL_REQUEST §R1 | DONE |
| 4 | F04: JSON Exporter Serialization | Serialize `static/pulls.json` and `static/issues.json` during export and hook runs | M1 | ORIGINAL_REQUEST §R1 | DONE |
| 5 | F05: Static Zero-JS HTML Fallback | Pre-render `static/pulls.html`, `static/issues.html`, detail views with sanitized Markdown and 4-tab nav | M1 | ORIGINAL_REQUEST §R1 | DONE |
| 6 | F06: Strict Rust Safety & Quality | `#![forbid(unsafe_code)]`, zero unwrap/expect/panic, strict Clippy deny list, clock-warp safe timestamps | M1 | ORIGINAL_REQUEST §R1 | DONE |
| 7 | F07: In-Browser DAG LCA Merge-Base | Client-side DAG traversal (`dag.ts`) to compute Lowest Common Ancestor (merge base) between PR head & target branch | M2 | ORIGINAL_REQUEST §R2 | DONE |
| 8 | F08: PR Commit Range Resolution | Traverse and collect all commits in `mergeBase..head` for PR commit list | M2 | ORIGINAL_REQUEST §R2 | DONE |
| 9 | F09: Off-Thread Web Worker 3-Way Diff | Offload tree diffing and Myers hunk diffing to Web Worker without blocking UI | M2 | ORIGINAL_REQUEST §R2 | DONE |
| 10 | F10: Review Notes Inline Integration | Load and attach `refs/notes/reviews` comments to diff hunks, files, or commit SHAs | M2 | ORIGINAL_REQUEST §R2 | DONE |
| 11 | F11: Interactive PR List View | `PullRequestsView.tsx` with open/merged/closed status filters, author filter, label badges, instant search | M3 | ORIGINAL_REQUEST §R3 | DONE |
| 12 | F12: PR Detail Header & Meta | `PRDetailView.tsx` header with status badge, author metadata, timestamps, branch pills | M3 | ORIGINAL_REQUEST §R3 | DONE |
| 13 | F13: PR Detail Conversation Tab | Render PR description with markdown, chronological timeline of comments and commits | M3 | ORIGINAL_REQUEST §R3 | DONE |
| 14 | F14: PR Detail Commits Tab | Render list of commits in PR with author/date info and diff navigation links | M3 | ORIGINAL_REQUEST §R3 | DONE |
| 15 | F15: PR Detail Files Changed Tab | Interactive Unified & Split diff views with file selector, additions/deletions stats, inline review notes | M3 | ORIGINAL_REQUEST §R3 | DONE |
| 16 | F16: Interactive Issue List View | `IssuesView.tsx` with open/closed status filters, author filter, label badges, instant search | M3 | ORIGINAL_REQUEST §R4 | DONE |
| 17 | F17: Issue Detail View Header & Meta | `IssueDetailView.tsx` header with status badge, author metadata, timestamps, label chips | M3 | ORIGINAL_REQUEST §R4 | DONE |
| 18 | F18: Issue Detail Discussion Tab | Render Markdown-rendered issue description and chronological comment timeline | M3 | ORIGINAL_REQUEST §R4 | DONE |
| 19 | F19: Integrated 4-Tab Top Navbar | Update top navbar in `App.tsx` to `Code`, `Commits <count>`, `Issues <count>`, `Pull Requests <count>` with active states | M3 | ORIGINAL_REQUEST §R5 | DONE |
| 20 | F20: Deep-Link Hash Routing | Robust hash router in `router.ts` for `#/issues`, `#/issues/<id>`, `#/pulls`, `#/pulls/<id>`, `#/pulls/<id>/files`, `#/pulls/<id>/commits` | M3 | ORIGINAL_REQUEST §R5 | DONE |
| 21 | F21: Strict TypeScript Zero-Any Safety | `strict: true`, `@typescript-eslint/strict-type-checked`, zero `any`, strict null checks | M2, M3 | ORIGINAL_REQUEST §R6 | DONE |
| 22 | F22: Vitest Comprehensive Unit Tests | Unit test suites for DAG LCA, 3-way diff, collab client, router, PR views, and Issue views | M2, M3 | ORIGINAL_REQUEST §R6 | DONE |
| 23 | F23: Multi-Tier E2E Test Suite | 4-tier opaque-box E2E test suite (Tiers 1-4) covering full collaboration lifecycle | M4 | ORIGINAL_REQUEST §R6 | DONE |
| 24 | F24: Adversarial Coverage Hardening | Tier 5 white-box stress testing of complex DAGs, large diffs, malformed refs, zero-JS fallbacks | M4 | ORIGINAL_REQUEST §R6 | DONE |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Rust Core PR & Issue Ref Discovery, Exporter & Static HTML Fallback | `src/repo/refs.rs`, `src/collab/` (`models.rs`, `pulls.rs`, `issues.rs`, `notes.rs`), `src/meta/mod.rs`, `src/prerender/mod.rs`, `src/hook/mod.rs`, `src/export/mod.rs`, unit/integration tests in `tests/` | none | DONE |
| M2 | In-Browser Client Merge-Base & 3-Way Diff Engine | `client/src/engine/dag.ts`, `client/src/engine/collab-client.ts`, `client/src/worker/diff-algo.ts`, `client/src/worker/diff.worker.ts`, `client/src/worker/diff-client.ts`, unit tests in `client/tests/` | none | DONE |
| M3 | Interactive Collaboration UI Views & Deep-Link Hash Routing | `client/src/ui/router.ts`, `client/src/ui/App.tsx`, `client/src/ui/PullRequestsView.tsx`, `client/src/ui/PRDetailView.tsx`, `client/src/ui/IssuesView.tsx`, `client/src/ui/IssueDetailView.tsx`, `client/src/ui/styles.css`, UI unit tests | M1, M2 | DONE |
| M4 | Final Milestone: Multi-Tier E2E Test Pass & Adversarial Coverage Hardening | Dual Track integration: Pass 100% E2E test suite (Tiers 1-4), then Tier 5 Adversarial Coverage Hardening with Challenger | M1, M2, M3 | DONE |

## Interface Contracts

### 1. Rust Collaboration Data Models & JSON Schemas
`static/pulls.json`:
```json
[
  {
    "id": "1",
    "number": 1,
    "title": "Add feature X",
    "description": "Markdown body...",
    "author": { "name": "Alice", "email": "alice@example.com" },
    "target_branch": "main",
    "source_branch": "feature/x",
    "head_commit": "a1b2c3d4...",
    "status": "open",
    "created_at": 1740000000,
    "updated_at": 1740000000,
    "labels": ["feature", "ui"],
    "comments": [
      {
        "id": "c1",
        "author": { "name": "Bob", "email": "bob@example.com" },
        "body": "Looks great!",
        "created_at": 1740001000
      }
    ]
  }
]
```

`static/issues.json`:
```json
[
  {
    "id": "1",
    "number": 1,
    "title": "Bug in diff rendering",
    "description": "Markdown body...",
    "author": { "name": "Charlie", "email": "charlie@example.com" },
    "status": "open",
    "created_at": 1740000000,
    "updated_at": 1740000000,
    "labels": ["bug"],
    "comments": []
  }
]
```

### 2. TypeScript Collaboration Types (`client/src/engine/collab-client.ts`)
```typescript
export type PullRequestStatus = 'open' | 'merged' | 'closed';
export type IssueStatus = 'open' | 'closed';

export interface Author {
  name: string;
  email: string;
}

export interface Comment {
  id: string;
  author: Author;
  body: string;
  createdAt: number;
}

export interface PullRequest {
  id: string;
  number: number;
  title: string;
  description: string;
  author: Author;
  targetBranch: string;
  sourceBranch: string;
  headCommit: string;
  status: PullRequestStatus;
  createdAt: number;
  updatedAt: number;
  labels: string[];
  comments: Comment[];
}

export interface Issue {
  id: string;
  number: number;
  title: string;
  description: string;
  author: Author;
  status: IssueStatus;
  createdAt: number;
  updatedAt: number;
  labels: string[];
  comments: Comment[];
}

export interface ReviewNote {
  commitSha: string;
  filePath?: string;
  line?: number;
  author: Author;
  body: string;
  createdAt: number;
}
```

### 3. DAG Traversal & Merge Base Contract (`client/src/engine/dag.ts`)
```typescript
export async function findMergeBase(
  client: GitRepositoryClient,
  headCommitSha: string,
  targetCommitSha: string
): Promise<string | null>;

export async function getCommitHistoryRange(
  client: GitRepositoryClient,
  mergeBaseSha: string,
  headSha: string
): Promise<CommitSummary[]>;
```

### 4. Hash Router AST Contract (`client/src/ui/router.ts`)
```typescript
export type Route =
  | { type: 'code'; ref?: string; path?: string; lineRange?: LineRange }
  | { type: 'commits'; ref?: string }
  | { type: 'commit'; sha: string }
  | { type: 'issues' }
  | { type: 'issue'; id: string }
  | { type: 'pulls' }
  | { type: 'pull'; id: string; tab?: 'conversation' | 'commits' | 'files' };

export function parseRoute(hash: string): Route;
export function formatRoute(route: Route): string;
```

## Code Layout
- `src/repo/refs.rs` — Extended Git ref scanner discovering `refs/pull/*`, `refs/issues/*`, `refs/notes/reviews` (M1)
- `src/collab/` — Collaboration data models, JSON metadata parsers, Git commit fallbacks (M1)
  - `src/collab/models.rs`
  - `src/collab/pulls.rs`
  - `src/collab/issues.rs`
  - `src/collab/notes.rs`
- `src/meta/mod.rs` — Extended `RepoStats` with PR and Issue counters (M1)
- `src/prerender/mod.rs` — Pre-renders `pulls.html`, `issues.html`, detail views, 4-tab top nav (M1)
- `src/hook/mod.rs` & `src/export/mod.rs` — Serialization of `pulls.json`, `issues.json`, and static HTML generation (M1)
- `client/src/engine/dag.ts` — In-browser Git DAG traversal and Lowest Common Ancestor (LCA) merge-base engine (M2)
- `client/src/engine/collab-client.ts` — Collaboration data fetcher, review notes binder (M2)
- `client/src/worker/diff-algo.ts`, `diff.worker.ts`, `diff-client.ts` — Web Worker 3-way Myers diff engine (M2)
- `client/src/ui/router.ts` — Hash routing and deep linking parser/formatter (M3)
- `client/src/ui/App.tsx` — Main application shell with 4-tab top navigation bar and count badges (M3)
- `client/src/ui/PullRequestsView.tsx` — Pull Request list view with filters and search (M3)
- `client/src/ui/PRDetailView.tsx` — Pull Request detail view with Conversation, Commits, and Files Changed tabs (M3)
- `client/src/ui/IssuesView.tsx` — Issue list view with filters and search (M3)
- `client/src/ui/IssueDetailView.tsx` — Issue detail view with markdown rendering and timeline (M3)
- `client/src/ui/styles.css` — CSS styling for collaboration views, badges, diff views, and timelines (M3)
- `tests/` — Rust integration tests for ref discovery, metadata serialization, and pre-rendered HTML fallbacks (M1)
- `client/tests/` — Vitest unit tests for DAG LCA, 3-way diff, collab client, router, and UI components (M2, M3)
- `e2e/` — 4-Tier E2E test suite and harness (M4 / E2E Track)
