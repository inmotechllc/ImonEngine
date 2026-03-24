#!/usr/bin/env bash
set -euo pipefail

ROOT="${APP_ROOT:-/opt/imon-engine}"
BUSINESS_ID="${1:-}"

if [ -z "$BUSINESS_ID" ]; then
  echo "Usage: $0 <business-id>" >&2
  exit 1
fi

COMPOSE_FILE="$ROOT/docker/business-worker/compose.yml"
export IMON_ENGINE_BUSINESS_ID="$BUSINESS_ID"
export IMON_ENGINE_WORKER_CONTAINER="${IMON_ENGINE_WORKER_CONTAINER:-imonengine-${BUSINESS_ID}}"

docker compose -f "$COMPOSE_FILE" down --remove-orphans

printf '{\n  "businessId": "%s",\n  "status": "stopped"\n}\n' "$BUSINESS_ID"
