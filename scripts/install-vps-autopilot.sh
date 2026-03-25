#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNNER="$REPO_ROOT/scripts/run_vps_autopilot.sh"
CRON_FILE="/etc/cron.d/imon-engine-store-autopilot"
LEGACY_CRON_FILE="/etc/cron.d/imon-engine"

chmod +x "$RUNNER"

if [ -f "$LEGACY_CRON_FILE" ]; then
  rm -f "$LEGACY_CRON_FILE"
fi

cat >"$CRON_FILE" <<EOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
15 * * * * root cd "$REPO_ROOT" && "$RUNNER"
EOF

chmod 644 "$CRON_FILE"
service cron reload || systemctl reload cron || true
echo "Installed VPS autopilot cron at $CRON_FILE"
