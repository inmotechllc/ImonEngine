#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/imon-engine}"
DISPLAY_NUMBER="${VPS_DISPLAY_NUMBER:-99}"
STATE_DIR="${VPS_TOOLING_STATE_DIR:-$APP_ROOT/runtime/ops/vps-tooling}"
REMOTE_DESKTOP_DIR="$STATE_DIR/remote-desktop"
X11VNC_LOG="$REMOTE_DESKTOP_DIR/x11vnc.log"
NOVNC_LOG="$REMOTE_DESKTOP_DIR/novnc.log"
X11VNC_PID_FILE="$REMOTE_DESKTOP_DIR/x11vnc.pid"
NOVNC_PID_FILE="$REMOTE_DESKTOP_DIR/novnc.pid"
VNC_PASSWORD_FILE="$REMOTE_DESKTOP_DIR/x11vnc.pass"
VNC_PORT="${VPS_VNC_PORT:-5900}"
NOVNC_PORT="${VPS_NOVNC_PORT:-6080}"
VNC_LISTEN_HOST="${VPS_VNC_LISTEN_HOST:-127.0.0.1}"
NOVNC_LISTEN_HOST="${VPS_NOVNC_LISTEN_HOST:-0.0.0.0}"

mkdir -p "$REMOTE_DESKTOP_DIR"

is_running() {
  local pid="${1:-}"
  [ -n "$pid" ] && kill -0 "$pid" >/dev/null 2>&1
}

read_env_file_value() {
  local key="$1"
  local env_file="$APP_ROOT/.env"
  if [ ! -f "$env_file" ]; then
    return 1
  fi
  python3 - "$env_file" "$key" <<'PY'
import sys
from pathlib import Path

env_path = Path(sys.argv[1])
target = sys.argv[2]
for raw_line in env_path.read_text(encoding="utf-8").splitlines():
    line = raw_line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    if key.strip() == target:
        print(value.strip().strip('"').strip("'"))
        raise SystemExit(0)
raise SystemExit(1)
PY
}

resolve_vnc_password() {
  if [ -n "${VPS_VNC_PASSWORD:-}" ]; then
    printf '%s' "$VPS_VNC_PASSWORD"
    return
  fi

  local from_env_file=""
  if from_env_file="$(read_env_file_value VPS_VNC_PASSWORD 2>/dev/null)"; then
    printf '%s' "$from_env_file"
    return
  fi

  if from_env_file="$(read_env_file_value IMON_ENGINE_HOST_PASSWORD 2>/dev/null)"; then
    printf '%s' "$from_env_file"
    return
  fi

  printf '%s' "ImonEngine2026"
}

ensure_vnc_password_file() {
  local password
  password="$(resolve_vnc_password)"
  if [ ! -f "$VNC_PASSWORD_FILE" ]; then
    x11vnc -storepasswd "$password" "$VNC_PASSWORD_FILE" >/dev/null
    chmod 600 "$VNC_PASSWORD_FILE"
  fi
}

resolve_novnc_proxy() {
  if command -v novnc_proxy >/dev/null 2>&1; then
    command -v novnc_proxy
    return
  fi

  local candidates=(
    "/usr/share/novnc/utils/novnc_proxy"
    "/usr/share/novnc/utils/launch.sh"
  )
  local candidate
  for candidate in "${candidates[@]}"; do
    if [ -x "$candidate" ]; then
      printf '%s' "$candidate"
      return
    fi
  done

  echo "noVNC proxy launcher not found. Install the novnc package first." >&2
  exit 1
}

start_x11vnc() {
  local pid=""
  if [ -f "$X11VNC_PID_FILE" ]; then
    pid="$(cat "$X11VNC_PID_FILE")"
    if is_running "$pid"; then
      return
    fi
  fi

  nohup x11vnc \
    -display ":${DISPLAY_NUMBER}" \
    -rfbport "$VNC_PORT" \
    -listen "$VNC_LISTEN_HOST" \
    -rfbauth "$VNC_PASSWORD_FILE" \
    -forever \
    -shared \
    -noxdamage \
    -repeat \
    -xkb >>"$X11VNC_LOG" 2>&1 &
  echo "$!" >"$X11VNC_PID_FILE"
}

start_novnc() {
  local pid=""
  if [ -f "$NOVNC_PID_FILE" ]; then
    pid="$(cat "$NOVNC_PID_FILE")"
    if is_running "$pid"; then
      return
    fi
  fi

  local novnc_proxy
  novnc_proxy="$(resolve_novnc_proxy)"
  nohup "$novnc_proxy" \
    --listen "${NOVNC_LISTEN_HOST}:${NOVNC_PORT}" \
    --vnc "127.0.0.1:${VNC_PORT}" >>"$NOVNC_LOG" 2>&1 &
  echo "$!" >"$NOVNC_PID_FILE"
}

wait_for_http() {
  local url="$1"
  local attempts=0
  until curl -fsS "$url" >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 30 ]; then
      echo "Timed out waiting for ${url}" >&2
      exit 1
    fi
    sleep 1
  done
}

resolve_public_host() {
  if [ -n "${IMON_ENGINE_HOST_IP:-}" ]; then
    printf '%s' "$IMON_ENGINE_HOST_IP"
    return
  fi

  local from_env_file=""
  if from_env_file="$(read_env_file_value IMON_ENGINE_HOST_IP 2>/dev/null)"; then
    printf '%s' "$from_env_file"
    return
  fi

  hostname -I 2>/dev/null | awk '{print $1}'
}

bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/vps-browser-start.sh" >/dev/null
ensure_vnc_password_file
start_x11vnc
start_novnc
wait_for_http "http://127.0.0.1:${NOVNC_PORT}/vnc.html"

public_host="$(resolve_public_host)"

printf '{\n'
printf '  "display": ":%s",\n' "$DISPLAY_NUMBER"
printf '  "chromeProfileDir": "%s",\n' "${VPS_CHROME_PROFILE_DIR:-$APP_ROOT/.chrome-profile}"
printf '  "vncPort": %s,\n' "$VNC_PORT"
printf '  "noVncPort": %s,\n' "$NOVNC_PORT"
printf '  "webUrl": "http://%s:%s/vnc.html?autoconnect=1&resize=scale",\n' "$public_host" "$NOVNC_PORT"
printf '  "passwordHint": "Uses VPS_VNC_PASSWORD when set, otherwise the stored host password fallback."\n'
printf '}\n'
