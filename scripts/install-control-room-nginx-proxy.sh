#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  exec sudo -E bash "$0" "$@"
fi

DOMAIN="${1:-imonengine.com}"
WWW_DOMAIN="www.${DOMAIN}"
UPSTREAM_HOST="${CONTROL_ROOM_PROXY_UPSTREAM_HOST:-127.0.0.1}"
UPSTREAM_PORT="${CONTROL_ROOM_PROXY_UPSTREAM_PORT:-${CONTROL_ROOM_PORT:-4177}}"
PUBLIC_IP="${IMON_ENGINE_HOST_IP:-${IMON_ENGINE_VPS_HOST:-158.220.99.144}}"
SITE_FILE="/etc/nginx/sites-available/imon-engine-control-room.conf"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"

set_env_value() {
  local key="$1"
  local value="$2"
  python3 - "$ENV_FILE" "$key" "$value" <<'PY'
from pathlib import Path
import sys

env_path = Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]
env_path.parent.mkdir(parents=True, exist_ok=True)
lines = []
if env_path.exists():
    lines = env_path.read_text(encoding="utf-8").splitlines()
replaced = False
for index, line in enumerate(lines):
    if line.startswith(f"{key}="):
        lines[index] = f"{key}={value}"
        replaced = True
        break
if not replaced:
    lines.append(f"{key}={value}")
env_path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
PY
}

if [ ! -f "$ENV_FILE" ] && [ -f "$REPO_ROOT/.env.example" ]; then
  cp "$REPO_ROOT/.env.example" "$ENV_FILE"
fi

set_env_value CONTROL_ROOM_PUBLIC_URL "https://${DOMAIN}"

apt-get update
apt-get install -y nginx

cat >"$SITE_FILE" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} ${WWW_DOMAIN} ${PUBLIC_IP};

    location / {
        proxy_pass http://${UPSTREAM_HOST}:${UPSTREAM_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-Port \$server_port;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 3600;
        proxy_send_timeout 3600;
        proxy_buffering off;
    }
}
EOF

ln -sf "$SITE_FILE" /etc/nginx/sites-enabled/imon-engine-control-room.conf
nginx -t
systemctl enable --now nginx
systemctl reload nginx
systemctl --no-pager --full status nginx || true
echo "Installed control-room nginx proxy for ${DOMAIN} -> ${UPSTREAM_HOST}:${UPSTREAM_PORT}"
echo "Set CONTROL_ROOM_PUBLIC_URL=https://${DOMAIN} in ${ENV_FILE}"