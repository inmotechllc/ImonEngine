#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$REPO_ROOT/runtime/ops"
LOG_PATH="$LOG_DIR/autopilot-vps.log"

mkdir -p "$LOG_DIR"

{
  printf '[%s] Starting VPS autopilot work unit.\n' "$(date -Iseconds)"
  cd "$REPO_ROOT"
  npm run dev -- autopilot-run-once
  npm run dev -- engine-sync
  npm run dev -- vps-artifacts
  printf '[%s] VPS autopilot work unit finished.\n' "$(date -Iseconds)"
} >>"$LOG_PATH" 2>&1
