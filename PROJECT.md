# Project: Sendforge Phase 5 (Usability Polish, Fuzzy Finder, Multi-Repo Dashboard, Edge Gateway, PWA & Quality Gates)

## Architecture
Sendforge is a high-performance static-first Git forge. Phase 5 extends Sendforge with:
1. **Client UI/UX Polish**: 1-click clone URL copy in code popover, 1-click SHA copy on commit badges, instant custom label chips in Issue/PR creation modals, and active demo tag display.
2. **Global Fuzzy File Finder (`Cmd+K` / `Ctrl+K` / `T`)**: In-memory tree indexer with weighted fuzzy matching (consecutive match bonuses, boundary bonuses), character match highlighting, floating keyboard-navigable command palette, and line permalinks (`:line` / `#Lline`).
3. **Multi-Repository Portfolio & Forge Dashboard**: Rust CLI `sendforge export --all <repos-dir>` discovering bare repos, generating aggregate `repos.json` and static root `index.html` forge dashboard, with seamless breadcrumb navigation between repo and forge hub.
4. **Lightweight Serverless Edge Write Gateway**: Zero-database Cloudflare Pages Functions (`/api/submit/issue`, `/api/submit/pr`) validating schemas, synthesizing Git loose objects, and directly updating Git refs (`refs/issues/*`, `refs/pull/*`).
5. **Progressive Web App (PWA) & Offline Caching**: Service Worker (`sw.js`) with Cache-First immutable Git object handling, Stale-While-Revalidate metadata, `manifest.json`, and offline status indicator pill.
6. **Multi-Tier Quality & E2E Verification Track**: Rust safety `#![forbid(unsafe_code)]`, strict TypeScript `@typescript-eslint/strict-type-checked`, Vitest suites, Cargo test suites, and 4-tier E2E testing framework in `e2e/`.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Clone URL Affordance | Prominent `git clone <url>` input with 1-click Copy button in Code popover | M1 | ORIGINAL_REQUEST R1 |
| 2 | Commit List SHA Copy | 1-click hover copy icon on commit hash badges in timeline | M1 | ORIGINAL_REQUEST R1 |
| 3 | Custom Label Chip Visualizer | Immediate rendering of active removable chip pills in New Issue/PR modal | M1 | ORIGINAL_REQUEST R1 |
| 4 | Demo Tag | Ensure annotated `v0.1.0` tag is present and rendered in ref selector | M1 | ORIGINAL_REQUEST R1 |
| 5 | Fast Tree Indexer | In-memory tree caching & client-side fuzzy ranking with character ranges | M2 | ORIGINAL_REQUEST R2 |
| 6 | Command Palette UI | Keyboard-navigable overlay (`Cmd+K`/`Ctrl+K`/`T`), line permalinks, `<mark>` highlights | M2 | ORIGINAL_REQUEST R2 |
| 7 | Multi-Repo CLI Exporter | `sendforge export --all <repos-dir>` scanning bare repos in flat/nested layouts | M3 | ORIGINAL_REQUEST R3 |
| 8 | Root Forge Dashboard | Pre-rendered static `index.html` and `repos.json` with search, cards, activity stats | M3 | ORIGINAL_REQUEST R3 |
| 9 | Navigation Breadcrumbs | Header breadcrumbs (`Forge Hub / <repo>`) for seamless forge switching | M3 | ORIGINAL_REQUEST R3 |
| 10 | Edge API Worker | Zero-database endpoints `/api/submit/issue` & `/api/submit/pr` on Cloudflare Pages Functions | M4 | ORIGINAL_REQUEST R4 |
| 11 | Edge Schema Validation & Ref Storage | Schema validation, ID sanitization, loose Git object synthesis, writing `refs/issues/*` & `refs/pull/*` | M4 | ORIGINAL_REQUEST R4 |
| 12 | Service Worker Layer | `sw.js` with Cache-First Git objects, SWR metadata, offline navigation | M5 | ORIGINAL_REQUEST R5 |
| 13 | Web App Manifest & Offline Badge | `manifest.json` with icons and live `navigator.onLine` badge in UI | M5 | ORIGINAL_REQUEST R5 |
| 14 | Quality & Multi-Tier E2E Gates | Cargo clippy, cargo test, typecheck, lint, vitest, 4-tier E2E test harness | M6 | ORIGINAL_REQUEST R6 |
| 15 | Deployment Pipeline | Git commit & push to `origin main` to trigger Cloudflare Pages deploy | M6 | ORIGINAL_REQUEST R6 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Usability Polish & Quick Wins | Clone URL box, SHA copy, custom label chips, demo tag `v0.1.0` | none | DONE |
| M2 | Global Fuzzy File Finder | `tree-indexer.ts`, `FileFinder.tsx` fuzzy matching, line permalinks, shortcuts | none | PLANNED |
| M3 | Multi-Repo CLI & Forge Dashboard | `sendforge export --all`, `repos.json`, root dashboard `index.html`, breadcrumbs | none | PLANNED |
| M4 | Serverless Edge Write Gateway | Cloudflare Pages Functions `/api/submit/issue` & `/api/submit/pr`, schema validation, Git ref storage | none | PLANNED |
| M5 | Progressive Web App & Offline Caching | `public/sw.js`, `public/manifest.json`, offline badge, registration in `main.tsx` | M1, M2 | PLANNED |
| M6 | Final Acceptance, E2E Suites & Deployment | E2E test suites (Tiers 1-4), adversarial hardening, verification gates, git push | M1, M2, M3, M4, M5 | PLANNED |

## Interface Contracts

### M2: Tree Indexer Contract
- `TreeIndexer`: Class indexing `TreeEntry` paths.
  - `search(query: string, limit?: number): FuzzyMatchResult[]`
  - `FuzzyMatchResult`: `{ entry: TreeEntry, score: number, matches: [number, number][], targetLine?: number }`
  - Permalink parsing: `filename.rs:42` or `filename.rs#L42` yields `targetLine = 42`.

### M3: Multi-Repo Index Contract (`repos.json`)
```json
{
  "version": 1,
  "title": "Sendforge Hub",
  "generated_at": "2026-08-26T00:00:00Z",
  "repos": [
    {
      "id": "owner/repo-name",
      "name": "repo-name",
      "owner": "owner",
      "description": "...",
      "default_branch": "main",
      "latest_commit": {
        "oid": "...",
        "summary": "...",
        "author": "...",
        "timestamp": 1234567890
      },
      "stats": { "commits": 42, "branches": 2, "tags": 1, "issues": 3, "pulls": 1 },
      "path": "owner/repo-name/"
    }
  ]
}
```

### M4: Serverless Edge Submit Contract
- `POST /api/submit/issue`
  - Request: `{ "repo": "owner/repo", "title": "...", "description": "...", "author": "...", "labels": ["..."] }`
  - Response 201: `{ "success": true, "issue": { "id": "...", "number": 1, ... }, "ref": "refs/issues/..." }`
- `POST /api/submit/pr`
  - Request: `{ "repo": "owner/repo", "title": "...", "description": "...", "author": "...", "source_branch": "...", "target_branch": "...", "patch": "..." }`
  - Response 201: `{ "success": true, "pull": { "id": "...", "number": 1, ... }, "ref": "refs/pull/.../head" }`

### M5: Service Worker Caching Contract
- Static Assets: Cache-First for versioned bundles (`assets/*.js`, `assets/*.css`).
- Git Objects: Cache-First for `/objects/[0-9a-f]{2}/[0-9a-f]{38}` and `/objects/pack/*`.
- Dynamic Meta: Stale-While-Revalidate for `/meta.json`, `/info/refs`, `/pulls.json`, `/issues.json`.
- Navigation: Network-First with fallback to cached `/index.html`.

## Code Layout
- `client/src/ui/`: UI components (`App.tsx`, `CommitLog.tsx`, `NewIssueModal.tsx`, `NewPRModal.tsx`, `FileFinder.tsx`, `DashboardView.tsx`, `styles.css`)
- `client/src/engine/`: In-browser Git engines & utilities (`tree-indexer.ts`, `edge-client.ts`, `fetcher.ts`)
- `client/src/main.tsx`: Entry point & Service Worker registration
- `public/`: Static files (`sw.js`, `manifest.json`, icons)
- `src/`: Rust CLI crate
  - `src/main.rs`: CLI commands & arguments
  - `src/export/`: Single and multi-repository static export engines (`mod.rs`, `multi.rs`)
  - `src/prerender/`: HTML templates & dashboard generation (`mod.rs`, `dashboard.rs`)
  - `src/meta/`: Repository metadata extraction
- `functions/api/submit/`: Cloudflare Pages Functions edge gateway (`issue.ts`, `pr.ts`, `storage.ts`)
- `e2e/`: End-to-end test framework & test suites
