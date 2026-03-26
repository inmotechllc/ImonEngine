#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  exec sudo -E bash "$0" "$@"
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"
UNIT_FILE="/etc/systemd/system/imon-engine-control-room.service"
RUNNER="$REPO_ROOT/scripts/run-control-room.sh"

ensure_env_value() {
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
        if line.split("=", 1)[1] == "":
            lines[index] = f"{key}={value}"
        replaced = True
        break
if not replaced:
    lines.append(f"{key}={value}")
env_path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
PY
}

read_env_value() {
  python3 - "$ENV_FILE" "$1" <<'PY'
from pathlib import Path
import sys

env_path = Path(sys.argv[1])
key = sys.argv[2]
if not env_path.exists():
    raise SystemExit(0)
for line in env_path.read_text(encoding="utf-8").splitlines():
    if line.startswith(f"{key}="):
        print(line.split("=", 1)[1])
        break
PY
}

if [ ! -f "$ENV_FILE" ] && [ -f "$REPO_ROOT/.env.example" ]; then
  cp "$REPO_ROOT/.env.example" "$ENV_FILE"
fi

if [ -z "$(read_env_value CONTROL_ROOM_SESSION_SECRET)" ]; then
  ensure_env_value CONTROL_ROOM_SESSION_SECRET "$(python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
)"
fi

if [ -z "$(read_env_value CONTROL_ROOM_PASSWORD_HASH)" ]; then
  fallback_password="$(read_env_value IMON_ENGINE_HOST_PASSWORD)"
  if [ -z "$fallback_password" ]; then
    fallback_password="$(read_env_value IMON_ENGINE_VPS_PASSWORD)"
  fi
  if [ -z "$fallback_password" ]; then
    echo "CONTROL_ROOM_PASSWORD_HASH is missing and no fallback password was found in $ENV_FILE." >&2
    exit 1
  fi
  control_room_hash="$(cd "$REPO_ROOT" && npm run --silent dev -- control-room-password-hash --password "$fallback_password")"
  ensure_env_value CONTROL_ROOM_PASSWORD_HASH "$control_room_hash"
fi

chmod +x "$RUNNER"
cd "$REPO_ROOT"
npm run build

cat >"$UNIT_FILE" <<EOF
[Unit]
Description=ImonEngine Control Room
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
systemctl enable --now imon-engine-control-room.service
systemctl restart imon-engine-control-room.service
systemctl --no-pager --full status imon-engine-control-room.service || true
echo "Installed control-room service at $UNIT_FILE"

