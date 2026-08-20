# 🚀 Sendforge Production & Deployment Guide

This guide details the deployment architectures for **Sendforge**, ranging from zero-server static hosting to high-throughput VPS setups using `sendfile(2)` and kTLS.

---

## 🏗️ Architecture Options at a Glance

| Deployment Mode | Best For | Infrastructure Required | Maintenance |
| :--- | :--- | :--- | :--- |
| **1. Pure Static Export (Serverless)** | Zero maintenance, global CDN distribution, personal archives | S3, Cloudflare Pages, GitHub Pages | **Zero** (no running process) |
| **2. Single Binary + Caddy/Nginx (VPS)** | Maximum performance, self-hosted team forge, SSH push | 1 cheap VPS ($3-5/mo) | **Minimal** (Systemd service) |
| **3. Docker / Compose** | Isolated containers, Kubernetes, easy updates | Any Docker host | **Low** |

---

## 🌟 Option 1: Pure Serverless / Static Hosting (S3 / Cloudflare R2 / Pages)

Because Sendforge separates repository storage from application compute, you can export your entire forge into pure static files and host them on any CDN or static site provider.

### 1. Export Repository

```bash
# Export the bare repository, pre-rendered fallbacks, and SPA bundle
sendforge export /path/to/my-repo.git ./dist-site --frontend-dist ./dist
```

### 2. Deploy to Cloudflare Pages / AWS S3 / Netlify

* **Cloudflare Pages:**
  ```bash
  npx wrangler pages deploy ./dist-site --project-name my-sendforge
  ```
* **AWS S3 + CloudFront:**
  ```bash
  aws s3 sync ./dist-site s3://my-sendforge-bucket/ --delete
  ```
* **GitHub Pages / Any Webroot:**
  Simply copy the contents of `./dist-site` to your web server's document root.

---

## ⚡ Option 2: Production VPS with Systemd & Caddy (Recommended)

This setup provides live Git pushing over SSH, automated static fallback generation on push, and sub-millisecond static file delivery over HTTPS via Caddy.

### Step 1: Create a Dedicated `git` User

```bash
sudo adduser --system --shell /usr/bin/git-shell --group --disabled-password --home /var/git git
sudo mkdir -p /var/git /var/www/sendforge-dist
```

### Step 2: Install Sendforge

```bash
# Build release binary
cargo build --release
sudo cp target/release/sendforge /usr/local/bin/

# Build and copy frontend assets
npm ci && npm run build
sudo cp -r dist/* /var/www/sendforge-dist/
```

### Step 3: Initialize a Repository with Post-Receive Hook

```bash
sudo -u git sendforge init /var/git/my-project.git
```

Whenever you push to `git@your-server:my-project.git`, the installed `post-receive` hook will automatically:
1. Refresh `info/refs` for Dumb HTTP clones.
2. Update `meta.json`.
3. Pre-render zero-JS `index.html` and `log.html` fallbacks.

### Step 4: Configure Systemd Service

Create `/etc/systemd/system/sendforge.service`:

```ini
[Unit]
Description=Sendforge Static Git Forge
After=network.target

[Service]
Type=simple
User=git
Group=git
ExecStart=/usr/local/bin/sendforge serve /var/git --frontend-dist /var/www/sendforge-dist --host 127.0.0.1 --port 8080
Restart=always
RestartSec=5
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

Enable and start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now sendforge
```

### Step 5: Configure Reverse Proxy with Caddy

Caddy automatically provisions SSL certificates and uses kernel-level static file caching.

Create `/etc/caddy/Caddyfile`:

```caddy
git.yourdomain.com {
    # Proxy requests to Sendforge
    reverse_proxy 127.0.0.1:8080

    # Enable compression & modern TLS
    encode zstd gzip

    # Custom security headers
    header {
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
    }
}
```

Restart Caddy:
```bash
sudo systemctl restart caddy
```

---

## 🐳 Option 3: Docker & Docker Compose

For containerized environments, Sendforge includes an ultra-lean multi-stage Docker build (~15 MB Alpine image).

### 1. Start with Docker Compose

```bash
# Clone the repository
git clone https://github.com/mike10010100/sendforge.git
cd sendforge

# Create repository directory
mkdir -p repositories

# Initialize a test repository
docker compose run --rm sendforge sendforge init /var/git/my-app.git

# Launch Sendforge
docker compose up -d
```

Your forge will be available at `http://localhost:8080`.

---

## 🔒 Hardening & Performance Best Practices

1. **Kernel `sendfile` & Zero-Copy:**
   When serving behind Caddy or Nginx, ensure `sendfile on;` and `tcp_nopush on;` are enabled to utilize direct zero-copy socket transfers from Linux page cache.
2. **CORS Headers:**
   Sendforge automatically emits `Access-Control-Allow-Origin: *` on `/objects/*` and `meta.json` so web clients and browsers can resolve loose Git objects without cross-origin blocks.
3. **Cache-Control Strategies:**
   * `/objects/*`: Immutable objects (`Cache-Control: public, max-age=31536000, immutable`).
   * `meta.json` & `info/refs`: Short or zero cache (`Cache-Control: no-cache`).
