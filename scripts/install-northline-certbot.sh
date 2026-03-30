#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  exec sudo -E bash "$0" "$@"
fi

DOMAIN="${1:-northlinegrowthsystems.com}"
WWW_DOMAIN="www.${DOMAIN}"
EMAIL="${2:-${APPROVAL_EMAIL:-${NORTHLINE_SALES_EMAIL:-imonengine@gmail.com}}}"

if [ -z "$EMAIL" ]; then
  echo "Missing notification email. Pass it as the second argument or set APPROVAL_EMAIL/NORTHLINE_SALES_EMAIL."
  exit 1
fi

apt-get update
apt-get install -y certbot python3-certbot-nginx

certbot --nginx \
  --non-interactive \
  --agree-tos \
  --redirect \
  --email "$EMAIL" \
  -d "$DOMAIN" \
  -d "$WWW_DOMAIN"

systemctl reload nginx
echo "Installed TLS certificate for ${DOMAIN} and ${WWW_DOMAIN}."
