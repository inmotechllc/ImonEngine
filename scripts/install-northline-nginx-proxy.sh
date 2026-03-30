#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  exec sudo -E bash "$0" "$@"
fi

DOMAIN="${1:-northlinegrowthsystems.com}"
WWW_DOMAIN="www.${DOMAIN}"
UPSTREAM_HOST="${NORTHLINE_PROXY_UPSTREAM_HOST:-127.0.0.1}"
UPSTREAM_PORT="${NORTHLINE_SITE_PORT:-4181}"
PUBLIC_IP="${IMON_ENGINE_HOST_IP:-${IMON_ENGINE_VPS_HOST:-158.220.99.144}}"
SITE_FILE="/etc/nginx/sites-available/northline-growth-systems.conf"

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
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

ln -sf "$SITE_FILE" /etc/nginx/sites-enabled/northline-growth-systems.conf
nginx -t
systemctl enable --now nginx
systemctl reload nginx
systemctl --no-pager --full status nginx || true
echo "Installed Northline nginx proxy for ${DOMAIN} -> ${UPSTREAM_HOST}:${UPSTREAM_PORT}"
