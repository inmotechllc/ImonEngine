#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$REPO_ROOT/runtime/ops"
LOG_PATH="$LOG_DIR/autopilot-vps.log"
POD_REFERENCE_DIR="$REPO_ROOT/runtime/ops/pod-businesses/imon-pod-store/style-references/imported"

mkdir -p "$LOG_DIR"

{
  printf '[%s] Starting VPS autopilot work unit.\n' "$(date -Iseconds)"
  cd "$REPO_ROOT"
  if [ -z "$(git status --porcelain --untracked-files=no)" ]; then
    git pull --ff-only origin main || printf '[%s] Skipped git pull because fast-forward update was not available.\n' "$(date -Iseconds)"
  else
    printf '[%s] Skipped git pull because tracked local changes are present.\n' "$(date -Iseconds)"
  fi
  npm run build
  npm run dev -- autopilot-run-once
  npm run dev -- engine-sync
  npm run dev -- northline-autonomy-run --business auto-funding-agency --notify-roadblocks
  npm run dev -- clipbaiters-collect --business clipbaiters-viral-moments
  npm run dev -- clipbaiters-skim --business clipbaiters-viral-moments
  npm run dev -- clipbaiters-autonomy-run --business clipbaiters-viral-moments --all-active-lanes --dry-run
  npm run dev -- clipbaiters-publish --business clipbaiters-viral-moments --all-active-lanes --dry-run
  npm run dev -- clipbaiters-source-creators --business clipbaiters-viral-moments
  npm run dev -- clipbaiters-draft-creator-outreach --business clipbaiters-viral-moments
  npm run dev -- clipbaiters-deals-report --business clipbaiters-viral-moments
  npm run dev -- clipbaiters-monetization-report --business clipbaiters-viral-moments
  if [ -d "$POD_REFERENCE_DIR" ]; then
    npm run dev -- pod-plan --business imon-pod-store --reference-dir "$POD_REFERENCE_DIR" --notify-roadblocks || printf '[%s] Pod plan refresh failed, but Northline and engine sync already ran.\n' "$(date -Iseconds)"
  else
    printf '[%s] Skipped Imonic POD plan because %s is not available yet.\n' "$(date -Iseconds)" "$POD_REFERENCE_DIR"
  fi
  npm run dev -- social-profiles
  npm run dev -- vps-artifacts
  if systemctl list-unit-files imon-engine-control-room.service >/dev/null 2>&1; then
    systemctl restart imon-engine-control-room.service || true
  fi
  printf '[%s] VPS autopilot work unit finished.\n' "$(date -Iseconds)"
} >>"$LOG_PATH" 2>&1
