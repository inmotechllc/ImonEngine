#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/imon-engine}"
CRON_FILE="/etc/cron.d/imon-engine"

cat > "$CRON_FILE" <<EOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
# Refresh ImonEngine portfolio state, the Northline autonomy lane, and ClipBaiters review-gated automation.
*/30 * * * * root cd $APP_ROOT && /usr/bin/env bash scripts/imon-engine-sync.sh >> /var/log/imon-engine.log 2>&1
EOF

chmod 644 "$CRON_FILE"
service cron reload || systemctl reload cron || true
