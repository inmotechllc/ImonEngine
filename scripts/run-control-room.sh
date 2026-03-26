#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_PATH="${CONTROL_ROOM_SERVICE_LOG_PATH:-$REPO_ROOT/runtime/ops/control-room/server.log}"

mkdir -p "$(dirname "$LOG_PATH")"
cd "$REPO_ROOT"

exec /usr/bin/env bash -lc "npm run start -- control-room-serve" >>"$LOG_PATH" 2>&1

