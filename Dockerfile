# Multi-stage build for Sendforge: Ultra-lean, high-performance static forge

# Stage 1: Build the TypeScript Frontend SPA
FROM node:22-alpine AS frontend-builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY client/ ./client/
COPY tsconfig.json vite.config.ts index.html ./
RUN npm run build

# Stage 2: Build the Rust CLI & Static Server
FROM rust:1.85-alpine AS rust-builder
WORKDIR /app
RUN apk add --no-cache musl-dev
COPY Cargo.toml Cargo.lock ./
COPY src/ ./src/
RUN cargo build --release

# Stage 3: Minimal Production Image (Alpine ~15MB total)
FROM alpine:3.21 AS runner
WORKDIR /app

RUN apk add --no-cache git ca-certificates tzdata \
    && addgroup -S sendforge && adduser -S sendforge -G sendforge \
    && mkdir -p /var/git /var/www/dist \
    && chown -R sendforge:sendforge /var/git /var/www /app

# Copy binary from rust-builder
COPY --from=rust-builder /app/target/release/sendforge /usr/local/bin/sendforge

# Copy built frontend assets from frontend-builder
COPY --from=frontend-builder /app/dist /var/www/dist

USER sendforge

# Default environment variables
ENV SENDFORGE_DIR=/var/git
ENV SENDFORGE_PORT=8080
ENV SENDFORGE_FRONTEND=/var/www/dist

EXPOSE 8080

# Default entrypoint serves the repository directory
CMD ["sh", "-c", "sendforge serve ${SENDFORGE_DIR} --frontend-dist ${SENDFORGE_FRONTEND} --host 0.0.0.0 --port ${SENDFORGE_PORT}"]
