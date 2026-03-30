#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_PATH="${NORTHLINE_SITE_LOG_PATH:-$REPO_ROOT/runtime/ops/northline-site/server.log}"

mkdir -p "$(dirname "$LOG_PATH")"
cd "$REPO_ROOT"

npm run --silent dev -- build-agency-site >/dev/null
exec /usr/bin/env bash -lc "npm run --silent dev -- northline-site-serve" >>"$LOG_PATH" 2>&1
