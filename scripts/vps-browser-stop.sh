#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/imon-engine}"
DISPLAY_NUMBER="${VPS_DISPLAY_NUMBER:-99}"
STATE_DIR="${VPS_TOOLING_STATE_DIR:-$APP_ROOT/runtime/ops/vps-tooling}"
LOG_DIR="$STATE_DIR/browser"
XVFB_PID_FILE="$LOG_DIR/xvfb.pid"
CHROME_PID_FILE="$LOG_DIR/chrome.pid"

stop_pidfile() {
  local pid_file="$1"
  if [ -f "$pid_file" ]; then
    local pid
    pid="$(cat "$pid_file")"
    if [ -n "$pid" ] && kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" || true
    fi
    rm -f "$pid_file"
  fi
}

pkill -f "google-chrome.*${APP_ROOT}/.chrome-profile" >/dev/null 2>&1 || true
pkill -f "Xvfb :${DISPLAY_NUMBER}" >/dev/null 2>&1 || true
stop_pidfile "$CHROME_PID_FILE"
stop_pidfile "$XVFB_PID_FILE"

printf '{\n  "status": "stopped"\n}\n'
