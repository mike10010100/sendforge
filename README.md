![Sendforge Hero Banner](assets/hero-banner.png)

# 🚀 Sendforge

> **A high-performance, static-first Git forge powered by `sendfile(2)` static serving and in-browser Git resolution.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Rust 100% Safe](https://img.shields.io/badge/Rust-100%25%20Safe%20%7C%20No%20Unsafe-orange.svg)](src/)
[![TypeScript Strict](https://img.shields.io/badge/TypeScript-Strict%20%7C%20Zero%20Any-blue.svg)](client/)
[![Tests Passed](https://img.shields.io/badge/Tests-168%20E2E%20Passed-brightgreen.svg)](e2e/)

---

## 🌟 The Vision

Traditional Git forges (GitHub, GitLab, Gitea, SourceHut) rely on dynamic backend servers that execute heavy Git subprocesses (`git log`, `git cat-file`, `git diff`) and relational database queries on every HTTP request. Under crawler floods and scraper traffic, these backends either buckle or force hostile bot-check interstitials onto users.

**Sendforge** flips this paradigm by decoupling repository storage from application compute:

1. **The Server** is an ultra-fast static file provider (`sendfile(2)`-friendly HTTP / S3 / Cloudflare Pages / Caddy / Nginx) serving bare Git repository objects and lightweight pre-rendered HTML entrypoints.
2. **The Client** runs an in-browser Git engine (via pure TypeScript) that dynamically fetches raw Git objects (`/objects/xx/xxx`) over HTTP and resolves commits, trees, blobs, diffs, and blame on demand.
3. **Zero-JS Fallback:** Default branch file trees and `README.md` are pre-rendered statically to semantic HTML upon every push.

---

## ⚡ Key Features

* **⚡ Sub-Millisecond TTFB:** Static assets served directly from disk/cache with zero dynamic backend compute.
* **🛡️ Bulletproof Safety:**
  * **Rust Core:** Enforces `#![forbid(unsafe_code)]`, strict Clippy deny gates, zero `.unwrap()`/`.expect()`, structured `thiserror` error handling, and clock-warp safe math.
  * **TypeScript Client:** Strict compiler flags (`noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess`), `@typescript-eslint/strict-type-checked`, zero `any` types.
* **🌐 In-Browser Git Engine:**
  * Zlib decompression via streaming / Web APIs.
  * Binary parsing for `commit`, `tree`, `blob`, and annotated `tag` objects with SHA-1 validation.
  * Off-thread diff computation (Myers LCS algorithm) in a dedicated Web Worker.
* **📑 Tabbed Ref Selector:** Dedicated **Branches** and **Tags** tabs with instant real-time fuzzy filtering and short SHA/date badges.
* **🕵️ In-Browser `git blame`:** Client-side line-by-line ancestry tracking with author avatars, commit diff links, and age heatmaps.
* **🔗 Line Permalinks:** Clickable line numbers, multi-line range selection (`#L12-L34`), and copy immutable commit SHA permalinks.
* **📦 Zero-Dependency Archive Generation:** In-browser snapshot `.zip` and `.tar.gz` archive creation directly from Git trees without server CPU.
* **☁️ Free Global Edge Deployment:** Deployable to **Cloudflare Pages**, AWS S3, GitHub Pages, or any static host for $0.

---

## ☁️ 60-Second Free Deployment to Cloudflare Pages

Because Sendforge exports everything into pure static files, you can host your forge globally across 300+ edge locations for **100% free with unlimited bandwidth**:

```bash
# 1. Export the static site
./target/release/sendforge export /path/to/my-repo.git ./my-site --frontend-dist ./dist

# 2. Deploy directly to Cloudflare Pages (Free Tier)
npx wrangler pages deploy ./my-site --project-name my-sendforge
```

Sendforge automatically generates a `_headers` file configuring CORS (`Access-Control-Allow-Origin: *`) and immutable caching headers (`Cache-Control: public, max-age=31536000, immutable`) for all Git objects.

---

## 🚀 Quick Start (Local Server)

### 1. Build Sendforge

```bash
# Build the Rust CLI binary
cargo build --release

# Build the Frontend Client SPA
npm ci
npm run build
```

### 2. Initialize a Repository

```bash
# Initialize a bare Git repository with Sendforge hook
./target/release/sendforge init /tmp/my-project.git
```

### 3. Push Commits

```bash
# Clone and push your first commit
git clone /tmp/my-project.git /tmp/my-work
cd /tmp/my-work
echo "# Hello Sendforge" > README.md
git add README.md
git commit -m "feat: initial commit"
git push origin master
```

### 4. Serve Statically

```bash
# Start the zero-compute static server
./target/release/sendforge serve /tmp/my-project.git --frontend-dist ./dist --port 8080
```

Open `http://localhost:8080` in your browser!

---

## 🧪 Testing & Verification

Sendforge features a rigorous, multi-tier test suite covering every layer:

```bash
# 1. Rust Compiler & Linter Gate
cargo clippy --all-targets --all-features -- -D warnings

# 2. Rust Unit & Integration Tests (37 tests)
cargo test --all-targets --all-features

# 3. TypeScript Typecheck
npm run typecheck

# 4. TypeScript Strict Lint
npm run lint

# 5. TypeScript Unit & Integration Tests (437 tests across 21 suites)
npm test

# 6. Automated Multi-Tier E2E Test Suite (168 tests across 37 suites)
./e2e/run_e2e.sh
```

---

## 📂 Project Architecture

```text
sendforge/
├── src/                      # Rust Core & CLI
│   ├── export/               # Standalone static site exporter with _headers generation
│   ├── prerender/            # Zero-JS HTML & CommonMark README pre-renderer
│   ├── repo/                 # Bare repo initialization, refs, objects, hooks
│   ├── server/               # Zero-compute static HTTP server with CORS/Range support
│   └── main.rs               # CLI entrypoint
├── client/                   # In-Browser TypeScript Git Engine & UI
│   ├── src/
│   │   ├── engine/           # Binary Git object parsers, blame engine, archive builder
│   │   ├── worker/           # Web Worker off-thread Myers diff computation
│   │   ├── ui/               # Preact UI (RefSelector, BlameView, BlobView, TreeView, App)
│   │   └── main.tsx          # Client entrypoint
│   └── tests/                # Vitest unit & integration test suites
├── e2e/                      # Multi-tier opaque-box E2E test harness
├── PRD.md                    # Product Requirements Document
├── DEPLOYMENT.md             # Production & Cloudflare deployment guide
└── PROJECT.md                # Architecture specification & data contracts
```

---

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.
