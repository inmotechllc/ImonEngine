#!/usr/bin/env bash
set -euo pipefail

ROOT="${APP_ROOT:-/opt/imon-engine}"
BUSINESS_ID="${1:-}"

if [ -z "$BUSINESS_ID" ]; then
  echo "Usage: $0 <business-id>" >&2
  exit 1
fi

COMPOSE_FILE="$ROOT/docker/business-worker/compose.yml"
CONTAINER_NAME="${IMON_ENGINE_WORKER_CONTAINER:-imonengine-${BUSINESS_ID}}"

json_escape() {
  python3 - "$1" <<'PY'
import json, sys
print(json.dumps(sys.argv[1]))
PY
}

export IMON_ENGINE_BUSINESS_ID="$BUSINESS_ID"
export IMON_ENGINE_WORKER_CONTAINER="$CONTAINER_NAME"

compose_ps="$(docker compose -f "$COMPOSE_FILE" ps --format json 2>/dev/null | tr '\n' ' ' || true)"
container_state="$(docker inspect --format '{{.State.Status}}' "$CONTAINER_NAME" 2>/dev/null || true)"

printf '{\n'
printf '  "businessId": "%s",\n' "$BUSINESS_ID"
printf '  "container": "%s",\n' "$CONTAINER_NAME"
printf '  "composePs": %s,\n' "$(json_escape "${compose_ps:-[]}")"
printf '  "containerState": "%s"\n' "$container_state"
printf '}\n'
