#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  exec sudo -E bash "$0" "$@"
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"
UNIT_FILE="/etc/systemd/system/imon-engine-northline-site.service"
RUNNER="$REPO_ROOT/scripts/run-northline-site.sh"

if [ ! -f "$ENV_FILE" ] && [ -f "$REPO_ROOT/.env.example" ]; then
  cp "$REPO_ROOT/.env.example" "$ENV_FILE"
fi

chmod +x "$RUNNER"
cd "$REPO_ROOT"
npm install --no-fund --no-audit
npm run --silent dev -- build-agency-site >/dev/null

cat >"$UNIT_FILE" <<EOF
[Unit]
Description=Northline Growth Systems Proof Page
After=network.target

[Service]
Type=simple
WorkingDirectory=$REPO_ROOT
ExecStart=/usr/bin/env bash $RUNNER
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now imon-engine-northline-site.service
systemctl restart imon-engine-northline-site.service
systemctl --no-pager --full status imon-engine-northline-site.service || true
echo "Installed Northline site service at $UNIT_FILE"
