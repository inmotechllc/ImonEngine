#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/imon-engine}"
CHROME_PROFILE_DIR="${VPS_CHROME_PROFILE_DIR:-$APP_ROOT/.chrome-profile}"
DISPLAY_NUMBER="${VPS_DISPLAY_NUMBER:-99}"
REMOTE_DEBUG_PORT="${VPS_CHROME_REMOTE_DEBUGGING_PORT:-9222}"
VNC_PORT="${VPS_VNC_PORT:-5900}"
NOVNC_PORT="${VPS_NOVNC_PORT:-6080}"
CONTROL_ROOM_PORT="${CONTROL_ROOM_PORT:-4177}"

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
ffmpeg_version="$(command_output ffmpeg ffmpeg -version)"
yt_dlp_version="$(command_output yt-dlp yt-dlp --version)"
playwright_version="$(command_output playwright playwright --version)"
codex_version="$(command_output codex codex --version)"
whisper_version=""
if command -v python3 >/dev/null 2>&1; then
  whisper_version="$(python3 - <<'PY'
try:
    import whisper
    print(getattr(whisper, "__version__", "installed"))
except Exception:
    print("")
PY
)"
fi
xvfb_running="false"
if pgrep -f "Xvfb :${DISPLAY_NUMBER}" >/dev/null 2>&1; then
  xvfb_running="true"
fi
chrome_running="false"
if pgrep -f "/opt/google/chrome/chrome.*--remote-debugging-port=${REMOTE_DEBUG_PORT}" >/dev/null 2>&1; then
  chrome_running="true"
fi
devtools_state="down"
if curl -fsS "http://127.0.0.1:${REMOTE_DEBUG_PORT}/json/version" >/dev/null 2>&1; then
  devtools_state="up"
fi
remote_desktop_state="down"
if curl -fsS "http://127.0.0.1:${NOVNC_PORT}/vnc.html" >/dev/null 2>&1; then
  remote_desktop_state="up"
fi
control_room_state="down"
if curl -fsS "http://127.0.0.1:${CONTROL_ROOM_PORT}/api/control-room/health" >/dev/null 2>&1; then
  control_room_state="up"
fi
control_room_service="false"
if systemctl is-active --quiet imon-engine-control-room.service; then
  control_room_service="true"
fi
x11vnc_running="false"
if pgrep -f "x11vnc .*${VNC_PORT}" >/dev/null 2>&1; then
  x11vnc_running="true"
fi
novnc_running="false"
if pgrep -f "novnc_proxy.*${NOVNC_PORT}" >/dev/null 2>&1 || pgrep -f "/usr/share/novnc/utils/novnc_proxy.*${NOVNC_PORT}" >/dev/null 2>&1; then
  novnc_running="true"
fi

printf '{\n'
printf '  "dockerVersion": %s,\n' "$(json_escape "$docker_version")"
printf '  "composeVersion": %s,\n' "$(json_escape "$compose_version")"
printf '  "chromeVersion": %s,\n' "$(json_escape "$chrome_version")"
printf '  "ffmpegVersion": %s,\n' "$(json_escape "$ffmpeg_version")"
printf '  "ytDlpVersion": %s,\n' "$(json_escape "$yt_dlp_version")"
printf '  "whisperVersion": %s,\n' "$(json_escape "$whisper_version")"
printf '  "playwrightVersion": %s,\n' "$(json_escape "$playwright_version")"
printf '  "codexVersion": %s,\n' "$(json_escape "$codex_version")"
printf '  "xvfbRunning": %s,\n' "$xvfb_running"
printf '  "chromeRunning": %s,\n' "$chrome_running"
printf '  "devtoolsState": %s,\n' "$(json_escape "$devtools_state")"
printf '  "x11vncRunning": %s,\n' "$x11vnc_running"
printf '  "noVncRunning": %s,\n' "$novnc_running"
printf '  "remoteDesktopState": %s,\n' "$(json_escape "$remote_desktop_state")"
printf '  "controlRoomService": %s,\n' "$control_room_service"
printf '  "controlRoomState": %s\n' "$(json_escape "$control_room_state")"
printf '}\n'
