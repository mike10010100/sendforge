# Product Requirements Document (PRD)
## Project: Sendforge (`sendforge`)
**Status:** Approved  
**Version:** 0.1.0  
**Target Milestone:** MVP Release  

---

## 1. Executive Summary & Vision

**Sendforge** is a modern, high-performance, static-first Git forge named in homage to the Linux `sendfile(2)` syscall. It is architected from the ground up to eliminate dynamic backend compute bottlenecks, shrug off scraper and bot floods, and deliver sub-millisecond TTFB page loads.

By decoupling repository storage from application compute:
1. **The Server** acts as an ultra-fast static file provider (`sendfile(2)`-friendly HTTP / object storage / CDN) serving bare Git repository objects, packfiles, and lightweight pre-rendered HTML entrypoints.
2. **The Client** runs an in-browser Git engine (via TypeScript / WebAssembly) that dynamically fetches and resolves Git objects, trees, commits, and diffs on demand.
3. **Collaboration Data** (issues, patches, code reviews) is stored natively inside Git references or static manifests, enabling full offline and static-first operation without a traditional relational database backend.

---

## 2. Problem Statement & Motivation

Traditional Git forges (GitHub, GitLab, Gitea, SourceHut) rely on dynamic backend servers that execute heavy Git subprocesses (`git log`, `git cat-file`, `git diff`) and relational database queries on every HTTP request. 

### Key Pain Points:
1. **Vulnerability to Scraper & Bot Floods:** AI web crawlers and scrapers hammer dynamic endpoints, forcing forges to implement hostile anti-bot mechanisms (e.g., 10–90 second Proof-of-Work browser checks) or face degraded performance.
2. **Infrastructure Costs:** Running dynamic forges with database clusters and Git worker processes requires substantial memory and CPU overhead even for low-traffic personal or team repositories.
3. **All-or-Nothing Tradeoff:** Current alternatives force developers to choose between dynamic, resource-heavy platforms (Gitea/Forgejo) or primitive, non-interactive static generators (`stagit`).

---

## 3. Target Audience & Use Cases

* **Self-Hosters & Indie Hackers:** Developers who want a clean, self-hosted forge on cheap VPS instances, static hosts (Cloudflare Pages / S3 / R2), or home servers without maintaining Postgres/Redis.
* **Open Source Projects & Communities:** Projects seeking a public web presence that is immune to scraper-induced slowdowns and requires zero server-side maintenance.
* **Archival & Mirroring:** Long-term, immutable code archives with high read traffic and zero compute costs.

---

## 4. Architectural Overview

```mermaid
flowchart TD
    subgraph Git Committer
        GC[git push over SSH / HTTP] -->|Push Ref Updates| Hook[post-receive hook]
    end

    subgraph Sendforge Static Server / Webroot
        Hook -->|1. Generate index & tip HTML| SSG[Sendforge Exporter]
        Hook -->|2. Expose / uncompress loose objects| Webroot[Bare Repo & Static Webroot]
        SSG --> Webroot
        Webroot --> HTTP[Static HTTP Server / sendfile / Caddy / Nginx / S3]
    end

    subgraph Browser / Visitor
        Browser[User Web Browser] -->|GET /<repo>/| HTTP
        HTTP -->|Pre-rendered Zero-JS HTML| Browser
        Browser -->|GET /<repo>.git/objects/xx/xxx| HTTP
        Browser -->|Client-Side Git Parser & Diff Worker| UI[Sendforge SPA / Tree / Commits / Diffs / Blame]
    end
```

---

## 5. System Architecture & Data Model

### 5.1 Storage Layer (Bare Git Webroot)
* Repositories live in a static directory structure:
  ```text
  /srv/git/
  └── <owner>/
      └── <repo>.git/
          ├── HEAD
          ├── config
          ├── refs/
          ├── info/
          │   └── refs                       # Dumb HTTP server-info
          ├── objects/
          │   ├── [0-9a-f]{2}/[0-9a-f]{38}   # Loose objects (CORS enabled)
          │   └── pack/                      # Packfiles & indices
          └── static/                        # Pre-rendered static landing pages
              ├── index.html                 # Default branch tree & README fallback
              ├── log.html                   # Recent commits summary fallback
              └── meta.json                  # Repo metadata, branches, tags, stats
  ```
* A Git `post-receive` hook automatically:
  1. Updates dumb HTTP `info/refs` (via `git update-server-info`).
  2. Generates pre-rendered HTML for the default branch tip and README.
  3. Emits `meta.json` containing branch heads, tag pointers, and repository statistics.

### 5.2 Client-Side Git Engine (Browser)
* **Core Engine:** Pure TypeScript / WebAssembly Git reader capable of reading loose objects and packfile byte-ranges directly via `fetch()` requests.
* **Capabilities:**
  * Resolve commit hashes, trees, subtrees, and blobs.
  * Compute side-by-side and unified diffs client-side using Web Workers.
  * Dynamic syntax highlighting (via lightweight client highlighter).
  * Fast client-side fuzzy file finder (`Ctrl+K` / `T`).

### 5.3 Collaboration Layer (Issues & Pull Requests)
* **Storage:** Issues and pull requests are stored as structured Git refs (adopting or bridging `git-bug` and `refs/pull/*` patches).
* **Read-Model:** Fully static JSON export rendered during `post-receive` or resolved live from Git refs by the client engine.
* **Write-Model (Phase 2):**
  * Submissions via Git CLI (`git push`, `git bug push`).
  * Optional lightweight webhook / serverless gateway for browser submissions.

---

## 6. Functional Requirements

### 6.1 Phase 1: MVP (Code & History Browser)
- [ ] **Repository Listing & Discovery:** Static dashboard listing available repositories, descriptions, and last updated timestamps.
- [ ] **Pre-rendered Landing Pages:** Fast, zero-JS view of repository root, file tree, and rendered `README.md`.
- [ ] **In-Browser Repository Navigation:**
  - Branch and tag switching without full-page reloads.
  - Interactive file tree navigation and blob viewer with syntax highlighting and line numbers.
  - Commit history timeline with author metadata, commit messages, and signatures.
  - Interactive commit diff viewer (unified and split diffs).
- [ ] **Git Push Integration:** Minimal `post-receive` hook script that updates static metadata and generates static entry points.
- [ ] **Static Deployment Support:** Ability to export the entire static webroot to run from any static host (S3, Cloudflare Pages, Caddy, Nginx).

### 6.2 Phase 2: Enhanced Navigation & Diagnostics
- [ ] **In-Browser `git blame`:** Client-side blame calculation tracing line origins.
- [ ] **Fuzzy File Search:** Fast keyboard-driven file search (`Ctrl+K` / `T`).
- [ ] **Raw Blob Download & Archive Generation:** Client-side ZIP/tarball generation from Git tree objects.

### 6.3 Phase 3: Git-Native Issues & Discussions
- [ ] **`git-bug` / Git-Ref Issue Viewer:** Client-side rendering of issue threads, labels, and status.
- [ ] **Patch / Pull Request Viewer:** Review patchsets submitted as Git refs with inline comments.

---

## 7. Non-Functional Requirements

| Metric | Target |
| :--- | :--- |
| **Time to First Byte (TTFB)** | < 15ms (served purely as static assets) |
| **Server CPU on Scrape Flood** | < 5% CPU under heavy concurrent scraping |
| **Zero-JS Accessibility** | Core README and file tree viewable with JavaScript disabled |
| **Client Bundle Size** | < 80 KB gzipped for the core reader UI |
| **Deployment Complexity** | Single binary or lightweight static script + static web server |

---

## 8. Technology Stack Choices

* **Backend / CLI / Hook Tooling:** Go (single binary for generating static entrypoints, repo initialization, and running a minimal static file server).
* **Frontend UI:** TypeScript + modern reactive UI with progressive enhancement.
* **Client-Side Git Parser:** Custom minimal Git loose-object parser in TypeScript + Web Workers for off-main-thread diffing.
* **Styling:** Clean, minimalist CSS / Tailwind, responsive on mobile and desktop.

---

## 9. Next Steps & Execution Roadmap

1. **Sprint 1: Core Hook & Static Metadata Generator (`sendforge cli`)**
   - Implement repository scanner and `post-receive` hook that outputs `meta.json` and static HTML fallback.
2. **Sprint 2: Client-Side Object Fetcher & Parser (`sendforge-core`)**
   - Implement browser TypeScript client that fetches `/objects/xx/xxx` loose objects, parses `tree`, `commit`, and `blob` objects with zlib decompression.
3. **Sprint 3: Web UI & Diffing Engine (`sendforge-ui`)**
   - Build file tree viewer, syntax highlighter, and client-side diff generator.
4. **Sprint 4: End-to-End Packaging & Demo**
   - Provide single-binary setup for serving local bare repos with instant live browser interface.
