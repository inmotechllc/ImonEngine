#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  exec sudo -E bash "$0" "$@"
fi

APP_ROOT="${APP_ROOT:-/opt/imon-engine}"
NODE_MAJOR="${NODE_MAJOR:-24}"
DISPLAY_NUMBER="${VPS_DISPLAY_NUMBER:-99}"
REMOTE_DEBUG_PORT="${VPS_CHROME_REMOTE_DEBUGGING_PORT:-9222}"
CHROME_PROFILE_DIR="${VPS_CHROME_PROFILE_DIR:-$APP_ROOT/.chrome-profile}"
STATE_DIR="${VPS_TOOLING_STATE_DIR:-$APP_ROOT/runtime/ops/vps-tooling}"
WORKSPACES_DIR="${IMON_ENGINE_WORKSPACES_DIR:-$APP_ROOT/workspaces}"
WORKER_TEMPLATE_DIR="$APP_ROOT/docker/business-worker"

log() {
  printf '[bootstrap-vps-tools] %s\n' "$*"
}

ensure_dir() {
  mkdir -p "$1"
}

ensure_base_packages() {
  log "Installing base host packages."
  apt-get update
  apt-get install -y \
    ca-certificates \
    curl \
    dbus-x11 \
    git \
    gnupg \
    jq \
    lsb-release \
    novnc \
    python3-pip \
    python3-pil \
    python3-venv \
    python3-websocket \
    unzip \
    websockify \
    x11-utils \
    xauth \
    x11vnc \
    xvfb \
    xz-utils
}

ensure_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    log "Docker and Compose already available."
  else
    log "Installing Docker Engine and Docker Compose plugin."
    install -m 0755 -d /etc/apt/keyrings
    if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
      curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
      chmod a+r /etc/apt/keyrings/docker.gpg
    fi
    if [ ! -f /etc/apt/sources.list.d/docker.list ]; then
      . /etc/os-release
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
        > /etc/apt/sources.list.d/docker.list
    fi
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi

  systemctl enable --now docker >/dev/null 2>&1 || service docker start >/dev/null 2>&1 || true
  if [ -n "${SUDO_USER:-}" ] && [ "${SUDO_USER:-}" != "root" ]; then
    usermod -aG docker "$SUDO_USER" || true
  fi
}

ensure_chrome() {
  if command -v google-chrome >/dev/null 2>&1; then
    log "Google Chrome already installed."
    return
  fi

  log "Installing Google Chrome stable."
  local tmp_deb="/tmp/google-chrome-stable_current_amd64.deb"
  curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o "$tmp_deb"
  apt-get install -y "$tmp_deb"
  rm -f "$tmp_deb"
}

ensure_playwright() {
  if ! command -v playwright >/dev/null 2>&1; then
    log "Installing Playwright CLI globally."
    npm install -g playwright
  fi

  log "Installing Playwright Chromium and system dependencies."
  playwright install --with-deps chromium
}

ensure_python_automation_deps() {
  log "Installing Python automation dependencies."
  apt-get install -y python3-pil python3-websocket
}

ensure_codex() {
  if command -v codex >/dev/null 2>&1; then
    log "Codex CLI already installed."
    return
  fi

  log "Installing OpenAI Codex CLI globally."
  npm install -g @openai/codex
}

write_worker_template() {
  ensure_dir "$WORKER_TEMPLATE_DIR"

  if [ ! -f "$WORKER_TEMPLATE_DIR/Dockerfile" ]; then
    cat >"$WORKER_TEMPLATE_DIR/Dockerfile" <<'EOF'
FROM node:24-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      bash \
      ca-certificates \
      curl \
      dbus-x11 \
      git \
      gnupg \
      jq \
      python3 \
      python3-pip \
      python3-pil \
      python3-venv \
      python3-websocket \
      unzip \
      x11-utils \
      xauth \
      xvfb \
      xz-utils && \
    rm -rf /var/lib/apt/lists/*

RUN npm install -g @openai/codex playwright && \
    playwright install --with-deps chromium

WORKDIR /workspace
CMD ["sleep", "infinity"]
EOF
  fi

  if [ ! -f "$WORKER_TEMPLATE_DIR/compose.yml" ]; then
    cat >"$WORKER_TEMPLATE_DIR/compose.yml" <<'EOF'
services:
  worker:
    build:
      context: .
      dockerfile: Dockerfile
    image: ${IMON_ENGINE_WORKER_IMAGE:-imonengine-business-worker:latest}
    container_name: ${IMON_ENGINE_WORKER_CONTAINER:-imonengine-business-worker}
    init: true
    stdin_open: true
    tty: true
    user: root
    working_dir: /workspace
    environment:
      HOME: /root
      PLAYWRIGHT_BROWSERS_PATH: /ms-playwright
      IMON_ENGINE_BUSINESS_ID: ${IMON_ENGINE_BUSINESS_ID:-sandbox}
      IMON_ENGINE_BUSINESS_NAME: ${IMON_ENGINE_BUSINESS_NAME:-sandbox}
      IMON_ENGINE_WORKSPACE: /workspace
      IMON_ENGINE_STATE_DIR: /state
      IMON_ENGINE_REPO_DIR: /repo
    volumes:
      - ${IMON_ENGINE_WORKSPACE_HOST:-/opt/imon-engine/workspaces/sandbox}:/workspace
      - ${IMON_ENGINE_STATE_HOST:-/opt/imon-engine/runtime/ops/business-workers/sandbox}:/state
      - ${IMON_ENGINE_REPO_HOST:-/opt/imon-engine}:/repo:ro
    command:
      - bash
      - -lc
      - sleep infinity
EOF
  fi

  if [ ! -f "$WORKER_TEMPLATE_DIR/.dockerignore" ]; then
    cat >"$WORKER_TEMPLATE_DIR/.dockerignore" <<'EOF'
.git
node_modules
runtime
output
workspaces
*.log
EOF
  fi
}

main() {
  ensure_base_packages
  ensure_docker
  ensure_chrome
  ensure_playwright
  ensure_python_automation_deps
  ensure_codex
  ensure_dir "$CHROME_PROFILE_DIR"
  ensure_dir "$STATE_DIR"
  ensure_dir "$WORKSPACES_DIR"
  ensure_dir "$WORKER_TEMPLATE_DIR"
  write_worker_template

  log "Verification commands:"
  log "docker version"
  log "docker compose version"
  log "google-chrome --version"
  log "x11vnc -version"
  log "novnc_proxy --help"
  log "xvfb-run --help"
  log "playwright --version"
  log "codex --version"
  log "Bootstrap complete."
  printf '{\n  "appRoot": "%s",\n  "chromeProfileDir": "%s",\n  "stateDir": "%s",\n  "workspacesDir": "%s",\n  "workerTemplateDir": "%s"\n}\n' \
    "$APP_ROOT" "$CHROME_PROFILE_DIR" "$STATE_DIR" "$WORKSPACES_DIR" "$WORKER_TEMPLATE_DIR"
}

main "$@"
