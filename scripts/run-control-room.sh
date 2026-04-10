#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

read_env_file_value() {
	local file_path="$1"
	local key="$2"

	python3 - "$file_path" "$key" <<'PY'
from pathlib import Path
import sys

env_path = Path(sys.argv[1])
key = sys.argv[2]
if not env_path.exists():
		raise SystemExit(0)

for raw_line in env_path.read_text(encoding="utf-8").splitlines():
		line = raw_line.strip()
		if not line or line.startswith("#") or "=" not in line:
				continue
		current_key, value = line.split("=", 1)
		if current_key.strip() != key:
				continue
		normalized = value.strip()
		if normalized:
				print(normalized)
		break
PY
}

read_effective_env_value() {
	local key="$1"
	local existing_value="${!key:-}"
	if [ -n "$existing_value" ]; then
		printf '%s\n' "$existing_value"
		return
	fi

	local file_value
	file_value="$(read_env_file_value "$REPO_ROOT/.env" "$key")"
	if [ -n "$file_value" ]; then
		printf '%s\n' "$file_value"
		return
	fi

	read_env_file_value "$REPO_ROOT/.env.example" "$key"
}

LOG_PATH="$(read_effective_env_value CONTROL_ROOM_SERVICE_LOG_PATH)"
LOG_PATH="${LOG_PATH:-$REPO_ROOT/runtime/ops/control-room/server.log}"

password_hash="$(read_effective_env_value CONTROL_ROOM_PASSWORD_HASH)"
if [ -z "$password_hash" ]; then
	fallback_password="$(read_effective_env_value IMON_ENGINE_HOST_PASSWORD)"
	if [ -z "$fallback_password" ]; then
		fallback_password="$(read_effective_env_value IMON_ENGINE_VPS_PASSWORD)"
	fi

	if [ -z "$fallback_password" ]; then
		echo "CONTROL_ROOM_PASSWORD_HASH is missing and no fallback password was found in $REPO_ROOT/.env or .env.example." >&2
		echo "Set CONTROL_ROOM_PASSWORD_HASH directly or provide IMON_ENGINE_HOST_PASSWORD / IMON_ENGINE_VPS_PASSWORD before starting the control room." >&2
		exit 1
	fi

	password_hash="$(cd "$REPO_ROOT" && npm run --silent start -- control-room-password-hash --password "$fallback_password")"
fi

export CONTROL_ROOM_PASSWORD_HASH="$password_hash"
export CONTROL_ROOM_SERVICE_LOG_PATH="$LOG_PATH"

mkdir -p "$(dirname "$LOG_PATH")"
cd "$REPO_ROOT"

exec /usr/bin/env bash -lc "npm run start -- control-room-serve" >>"$LOG_PATH" 2>&1

