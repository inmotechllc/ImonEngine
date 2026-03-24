#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/imon-engine}"
DISPLAY_NUMBER="${VPS_DISPLAY_NUMBER:-99}"
REMOTE_DEBUG_PORT="${VPS_CHROME_REMOTE_DEBUGGING_PORT:-9222}"
CHROME_PROFILE_DIR="${VPS_CHROME_PROFILE_DIR:-$APP_ROOT/.chrome-profile}"
STATE_DIR="${VPS_TOOLING_STATE_DIR:-$APP_ROOT/runtime/ops/vps-tooling}"
LOG_DIR="$STATE_DIR/browser"
XVFB_LOG="$LOG_DIR/xvfb.log"
CHROME_LOG="$LOG_DIR/chrome.log"
XVFB_PID_FILE="$LOG_DIR/xvfb.pid"
CHROME_PID_FILE="$LOG_DIR/chrome.pid"

mkdir -p "$LOG_DIR" "$CHROME_PROFILE_DIR"

is_running() {
  local pid="$1"
  [ -n "$pid" ] && kill -0 "$pid" >/dev/null 2>&1
}

start_xvfb() {
  local pid=""
  if [ -f "$XVFB_PID_FILE" ]; then
    pid="$(cat "$XVFB_PID_FILE")"
    if is_running "$pid"; then
      return
    fi
  fi

  nohup Xvfb ":${DISPLAY_NUMBER}" -screen 0 1920x1080x24 -ac -nolisten tcp -noreset >>"$XVFB_LOG" 2>&1 &
  echo "$!" >"$XVFB_PID_FILE"
}

start_chrome() {
  local pid=""
  if [ -f "$CHROME_PID_FILE" ]; then
    pid="$(cat "$CHROME_PID_FILE")"
    if is_running "$pid"; then
      return
    fi
  fi

  nohup env DISPLAY=":${DISPLAY_NUMBER}" google-chrome \
    --user-data-dir="$CHROME_PROFILE_DIR" \
    --remote-debugging-address=127.0.0.1 \
    --remote-debugging-port="$REMOTE_DEBUG_PORT" \
    --no-sandbox \
    --disable-setuid-sandbox \
    --no-first-run \
    --no-default-browser-check \
    --disable-background-networking \
    --disable-dev-shm-usage \
    --disable-extensions \
    --disable-sync \
    --disable-gpu \
    --window-size=1920,1080 \
    about:blank >>"$CHROME_LOG" 2>&1 &
  echo "$!" >"$CHROME_PID_FILE"
}

wait_for_devtools() {
  local attempts=0
  until curl -fsS "http://127.0.0.1:${REMOTE_DEBUG_PORT}/json/version" >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 30 ]; then
      return 1
    fi
    sleep 1
  done
}

start_xvfb
start_chrome
wait_for_devtools

printf '{\n'
printf '  "display": ":%s",\n' "$DISPLAY_NUMBER"
printf '  "chromeProfileDir": "%s",\n' "$CHROME_PROFILE_DIR"
printf '  "remoteDebuggingPort": %s,\n' "$REMOTE_DEBUG_PORT"
printf '  "devtoolsUrl": "http://127.0.0.1:%s/json/version"\n' "$REMOTE_DEBUG_PORT"
printf '}\n'
