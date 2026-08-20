#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

export SENDFORGE_PROJECT_ROOT="${PROJECT_ROOT}"
export PATH="${PROJECT_ROOT}/target/debug:${PROJECT_ROOT}/target/release:${PATH}"
export SENDFORGE_BIN="${PROJECT_ROOT}/target/debug/sendforge"

# Run Node test runner
exec node "${SCRIPT_DIR}/runner.js" "$@"
