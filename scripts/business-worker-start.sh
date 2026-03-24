#!/usr/bin/env bash
set -euo pipefail

ROOT="${APP_ROOT:-/opt/imon-engine}"
BUSINESS_ID="${1:-}"
BUSINESS_NAME="${2:-$BUSINESS_ID}"

if [ -z "$BUSINESS_ID" ]; then
  echo "Usage: $0 <business-id> [business-name]" >&2
  exit 1
fi

WORKSPACE_ROOT="${IMON_ENGINE_WORKSPACES_DIR:-$ROOT/workspaces}"
STATE_ROOT="${IMON_ENGINE_WORKER_STATE_DIR:-$ROOT/runtime/ops/business-workers}"
CONTAINER_NAME="${IMON_ENGINE_WORKER_CONTAINER:-imonengine-${BUSINESS_ID}}"
IMAGE_NAME="${IMON_ENGINE_WORKER_IMAGE:-imonengine-business-worker:latest}"
COMPOSE_FILE="$ROOT/docker/business-worker/compose.yml"
WORKSPACE_DIR="$WORKSPACE_ROOT/$BUSINESS_ID"
STATE_DIR="$STATE_ROOT/$BUSINESS_ID"

mkdir -p "$WORKSPACE_DIR" "$STATE_DIR"

export IMON_ENGINE_BUSINESS_ID="$BUSINESS_ID"
export IMON_ENGINE_BUSINESS_NAME="$BUSINESS_NAME"
export IMON_ENGINE_WORKSPACE_HOST="$WORKSPACE_DIR"
export IMON_ENGINE_STATE_HOST="$STATE_DIR"
export IMON_ENGINE_REPO_HOST="$ROOT"
export IMON_ENGINE_WORKER_CONTAINER="$CONTAINER_NAME"
export IMON_ENGINE_WORKER_IMAGE="$IMAGE_NAME"

docker compose -f "$COMPOSE_FILE" up -d --build

printf '{\n'
printf '  "businessId": "%s",\n' "$BUSINESS_ID"
printf '  "businessName": "%s",\n' "$BUSINESS_NAME"
printf '  "container": "%s",\n' "$CONTAINER_NAME"
printf '  "workspace": "%s",\n' "$WORKSPACE_DIR"
printf '  "stateDir": "%s"\n' "$STATE_DIR"
printf '}\n'
