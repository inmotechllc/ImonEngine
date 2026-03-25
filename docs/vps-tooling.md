# VPS Tooling

The VPS now has a browser and worker layer so ImonEngine can reuse authenticated sessions, isolate new brands, and run Codex/Playwright directly on the server.

## What Bootstrap Installs

- Docker Engine and the Docker Compose plugin
- Google Chrome
- Xvfb for a persistent virtual display
- Playwright CLI plus Chromium dependencies
- Codex CLI
- A reusable Docker worker template for future business containers

Bootstrap entrypoints:

- `scripts/bootstrap-vps.sh`
- `scripts/bootstrap-vps-tools.sh`

## Persistent VPS Browser

Use the VPS browser helpers when a workflow needs a saved Chrome profile or DevTools access on the server:

- Start: `scripts/vps-browser-start.sh`
- Status: `scripts/vps-browser-status.sh`
- Stop: `scripts/vps-browser-stop.sh`
- Full tooling check: `scripts/vps-tooling-status.sh`

## Remote Desktop For The VPS Browser

The browser profile on the VPS now supports a remote desktop layer on top of the same Xvfb display.

- Start: `scripts/vps-remote-desktop-start.sh`
- Status: `scripts/vps-remote-desktop-status.sh`
- Stop: `scripts/vps-remote-desktop-stop.sh`

Default ports:

- VNC backend: `5900` on `127.0.0.1`
- noVNC web UI: `6080`

The noVNC session is wired to the existing Chrome profile, so once you sign into Gumroad, Gmail, or Pinterest there, server-side automation can reuse the same cookies even when your local machine is offline.

For Meta/Facebook, prefer the official Page API path instead of a VPS browser login whenever possible:

- `META_PAGE_ID`
- `META_PAGE_ACCESS_TOKEN`
- optional `META_GRAPH_API_VERSION` override

With those set in `/opt/imon-engine/.env`, `scripts/publish_growth_post.py` can post Facebook Page growth content from the VPS without an authenticated Meta browser session on the server.

Default behavior:

- Xvfb display: `:99`
- Chrome profile dir: `/opt/imon-engine/.chrome-profile`
- Remote DevTools port: `9222`

This lets ImonEngine keep browser cookies and account sessions on the VPS instead of rebuilding them every run.

Because the VPS is now the primary scheduler, Gmail, Gumroad, Pinterest, and any other browser-backed services should stay signed into this server-side Chrome profile instead of depending on a local machine.

## Codex CLI On VPS

Use `scripts/vps-codex-login.sh` after the VPS browser is running. It starts the browser if needed, then opens the Codex authentication flow against the saved Chrome profile so the CLI can be used directly from the server.

## Containerized Business Workers

Each new brand can run inside its own Docker container instead of sharing the root host environment.

Worker template:

- `docker/business-worker/Dockerfile`
- `docker/business-worker/compose.yml`

Helper scripts:

- Start: `scripts/business-worker-start.sh <business-id> "<business-name>"`
- Status: `scripts/business-worker-status.sh <business-id>`
- Stop: `scripts/business-worker-stop.sh <business-id>`

Each worker mounts:

- a writable per-brand workspace under `/opt/imon-engine/workspaces/<business-id>`
- a writable per-brand state directory under `runtime/ops/business-workers/<business-id>`
- the repo itself as read-only under `/repo`

## Operating Rule

- Use the VPS browser when the account session should persist on the server.
- Use the VPS remote desktop when you need to log into the server-side Chrome profile yourself.
- Use a business worker container when a new brand needs isolated dependencies, code, or experimental tooling.
- Keep the local Windows scheduler disabled unless the VPS runner is unavailable.
