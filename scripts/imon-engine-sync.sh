#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/imon-engine}"

cd "$APP_ROOT"
npm run dev -- engine-sync
