#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/imon-engine}"
STATE_DIR="${VPS_TOOLING_STATE_DIR:-$APP_ROOT/runtime/ops/vps-tooling}"
REMOTE_DESKTOP_DIR="$STATE_DIR/remote-desktop"
DISPLAY_NUMBER="${VPS_DISPLAY_NUMBER:-99}"
VNC_PORT="${VPS_VNC_PORT:-5900}"
NOVNC_PORT="${VPS_NOVNC_PORT:-6080}"

status_for_pid() {
  local pattern="$1"
  if pgrep -f "$pattern" >/dev/null 2>&1; then
    printf 'true'
  else
    printf 'false'
  fi
}

novnc_state="down"
if curl -fsS "http://127.0.0.1:${NOVNC_PORT}/vnc.html" >/dev/null 2>&1; then
  novnc_state="up"
fi

printf '{\n'
printf '  "display": ":%s",\n' "$DISPLAY_NUMBER"
printf '  "x11vncRunning": %s,\n' "$(status_for_pid "x11vnc .*${VNC_PORT}")"
printf '  "noVncRunning": %s,\n' "$(status_for_pid "novnc_proxy.*${NOVNC_PORT}|/usr/share/novnc/utils/novnc_proxy.*${NOVNC_PORT}")"
printf '  "vncPort": %s,\n' "$VNC_PORT"
printf '  "noVncPort": %s,\n' "$NOVNC_PORT"
printf '  "noVncState": "%s",\n' "$novnc_state"
printf '  "passwordFile": "%s"\n' "$REMOTE_DESKTOP_DIR/x11vnc.pass"
printf '}\n'
