#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/imon-engine}"
CHROME_PROFILE_DIR="${VPS_CHROME_PROFILE_DIR:-$APP_ROOT/.chrome-profile}"
DISPLAY_NUMBER="${VPS_DISPLAY_NUMBER:-99}"
REMOTE_DEBUG_PORT="${VPS_CHROME_REMOTE_DEBUGGING_PORT:-9222}"

command_output() {
  if command -v "$1" >/dev/null 2>&1; then
    shift
    "$@" 2>/dev/null | head -n 1 || true
  fi
}

json_escape() {
  python3 - "$1" <<'PY'
import json, sys
print(json.dumps(sys.argv[1]))
PY
}

docker_version="$(command_output docker docker version --format '{{.Server.Version}}')"
compose_version="$(command_output docker docker compose version)"
chrome_version="$(command_output google-chrome google-chrome --version)"
playwright_version="$(command_output playwright playwright --version)"
codex_version="$(command_output codex codex --version)"
xvfb_running="false"
if pgrep -f "Xvfb :${DISPLAY_NUMBER}" >/dev/null 2>&1; then
  xvfb_running="true"
fi
chrome_running="false"
if pgrep -f "google-chrome.*${CHROME_PROFILE_DIR}" >/dev/null 2>&1; then
  chrome_running="true"
fi
devtools_state="down"
if curl -fsS "http://127.0.0.1:${REMOTE_DEBUG_PORT}/json/version" >/dev/null 2>&1; then
  devtools_state="up"
fi

printf '{\n'
printf '  "dockerVersion": %s,\n' "$(json_escape "$docker_version")"
printf '  "composeVersion": %s,\n' "$(json_escape "$compose_version")"
printf '  "chromeVersion": %s,\n' "$(json_escape "$chrome_version")"
printf '  "playwrightVersion": %s,\n' "$(json_escape "$playwright_version")"
printf '  "codexVersion": %s,\n' "$(json_escape "$codex_version")"
printf '  "xvfbRunning": %s,\n' "$xvfb_running"
printf '  "chromeRunning": %s,\n' "$chrome_running"
printf '  "devtoolsState": %s\n' "$(json_escape "$devtools_state")"
printf '}\n'
