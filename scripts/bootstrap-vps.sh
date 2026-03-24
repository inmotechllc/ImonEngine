#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/imon-engine}"
NODE_MAJOR="${NODE_MAJOR:-24}"

apt-get update
apt-get install -y curl ca-certificates git cron
curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
apt-get install -y nodejs
systemctl enable --now cron || service cron start || true

mkdir -p "$APP_ROOT"
cd "$APP_ROOT"

if [ ! -f package.json ]; then
  echo "Copy or clone the repository into $APP_ROOT before bootstrapping."
  exit 1
fi

npm ci

if [ ! -f .env ]; then
  cp .env.example .env
fi

npm run dev -- vps-artifacts
bash scripts/bootstrap-vps-tools.sh
npm run build
npm run dev -- bootstrap
npm run dev -- engine-sync
