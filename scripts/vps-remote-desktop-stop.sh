#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/imon-engine}"
STATE_DIR="${VPS_TOOLING_STATE_DIR:-$APP_ROOT/runtime/ops/vps-tooling}"
REMOTE_DESKTOP_DIR="$STATE_DIR/remote-desktop"
X11VNC_PID_FILE="$REMOTE_DESKTOP_DIR/x11vnc.pid"
NOVNC_PID_FILE="$REMOTE_DESKTOP_DIR/novnc.pid"

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

pkill -f "x11vnc .*${APP_ROOT}/runtime/ops/vps-tooling/remote-desktop/x11vnc.pass" >/dev/null 2>&1 || true
pkill -f "novnc_proxy.*127.0.0.1:${VPS_VNC_PORT:-5900}" >/dev/null 2>&1 || true
pkill -f "/usr/share/novnc/utils/novnc_proxy.*127.0.0.1:${VPS_VNC_PORT:-5900}" >/dev/null 2>&1 || true
stop_pidfile "$NOVNC_PID_FILE"
stop_pidfile "$X11VNC_PID_FILE"

printf '{\n  "status": "stopped"\n}\n'
