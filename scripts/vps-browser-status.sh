#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/imon-engine}"
DISPLAY_NUMBER="${VPS_DISPLAY_NUMBER:-99}"
REMOTE_DEBUG_PORT="${VPS_CHROME_REMOTE_DEBUGGING_PORT:-9222}"
CHROME_PROFILE_DIR="${VPS_CHROME_PROFILE_DIR:-$APP_ROOT/.chrome-profile}"

status_for_pid() {
  local pattern="$1"
  if pgrep -f "$pattern" >/dev/null 2>&1; then
    printf 'true'
  else
    printf 'false'
  fi
}

devtools_state="down"
if curl -fsS "http://127.0.0.1:${REMOTE_DEBUG_PORT}/json/version" >/dev/null 2>&1; then
  devtools_state="up"
fi

chrome_version=""
if command -v google-chrome >/dev/null 2>&1; then
  chrome_version="$(google-chrome --version 2>/dev/null | head -n 1 || true)"
fi

printf '{\n'
printf '  "display": ":%s",\n' "$DISPLAY_NUMBER"
printf '  "chromeProfileDir": "%s",\n' "$CHROME_PROFILE_DIR"
printf '  "xvfbRunning": %s,\n' "$(status_for_pid "Xvfb :${DISPLAY_NUMBER}")"
printf '  "chromeRunning": %s,\n' "$(status_for_pid "google-chrome.*${CHROME_PROFILE_DIR}")"
printf '  "devtoolsState": "%s",\n' "$devtools_state"
printf '  "chromeVersion": "%s"\n' "$chrome_version"
printf '}\n'
