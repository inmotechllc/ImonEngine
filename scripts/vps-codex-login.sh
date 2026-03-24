#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"$SCRIPT_DIR/vps-browser-start.sh" >/dev/null

if command -v codex >/dev/null 2>&1; then
  DISPLAY="${VPS_DISPLAY_NUMBER:-99}" codex --login
else
  echo "Codex CLI is not installed. Run scripts/bootstrap-vps-tools.sh first." >&2
  exit 1
fi
