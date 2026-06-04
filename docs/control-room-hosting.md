# Control Room Hosting

The control room now has two outputs backed by the same control-plane snapshot:

- a static fallback export at `runtime/ops/control-room/index.html`
- a hosted app served directly from the repo on the VPS
- a local operator app that can proxy the VPS app over an SSH tunnel

The control plane remains the source of truth. The hosted app holds the durable state and execution environment. That hosted app can stay loopback-only for the VPS browser and tunnel flow, or it can sit behind nginx plus TLS on a public domain such as `https://imonengine.com`. The local operator app renders the same control-room view-model locally while sending guided write actions back to the VPS control plane.

## Folder Explorer Model

The UI now renders the org state as a folder-style explorer:

- `engine office`: approvals, office handoffs, roadblocks, and brand orchestrator cards
- `business office`: approvals, handoffs to departments, roadblocks, and department orchestrator cards
- `department workspace`: execution lanes, blockers, artifacts, KPIs, widgets, and recent activity

Engine and business stay in the explorer. Departments open the dedicated execution workspace.

## Scoped Orchestrator Chat

The hosted and local control-room apps now expose a scope-aware chat panel inside the inspector:

- `engine office` -> `Imon Engine Orchestrator`
- `business office` -> `Brand Orchestrator`
- `department workspace` -> `Department Orchestrator`

Behavior rules:

- one durable thread per office
- low-risk summaries and internal config changes execute immediately
- high-impact structural changes such as new business scaffolds require explicit `Apply` or `Dismiss`
- public-facing, customer-facing, financial, compliance, or cross-business write actions route into the task layer instead of mutating directly
- static export remains read-only and shows the latest chat summary only

## Commands

- `npm run dev -- control-room-build`
- `npm run dev -- control-room-serve`
- `npm run dev -- control-room-local`
- `npm run dev -- control-room-health`
- `npm run dev -- control-room-password-hash --password "<value>"`
- `npm run test:control-room-ui`

`office-dashboard` still exists and now uses the same shared snapshot and renderer as the hosted app.

## Environment

- `CONTROL_ROOM_BIND_HOST`
- `CONTROL_ROOM_PORT`
- `CONTROL_ROOM_SESSION_SECRET`
- `CONTROL_ROOM_PASSWORD_HASH`
- `CONTROL_ROOM_SESSION_TTL_HOURS`
- `CONTROL_ROOM_STALE_THRESHOLD_MINUTES`
- `CONTROL_ROOM_SERVICE_LOG_PATH`
- `CONTROL_ROOM_PUBLIC_URL`
- `CONTROL_ROOM_LOCAL_BIND_HOST`
- `CONTROL_ROOM_LOCAL_PORT`
- `CONTROL_ROOM_REMOTE_URL`
- `CONTROL_ROOM_AUTO_TUNNEL`
- `CONTROL_ROOM_TUNNEL_PORT`
- `CONTROL_ROOM_TUNNEL_PYTHON_BIN`

Hosted default behavior:

- bind host: `127.0.0.1`
- port: `4177`
- auth: owner-only password gate with signed httpOnly cookies
- public URL: optional through `CONTROL_ROOM_PUBLIC_URL`
- exposure: VPS browser, SSH tunnel/local app, or a public nginx plus TLS domain
- local app bind host: `127.0.0.1`
- local app port: `4310`
- local tunnel target: `127.0.0.1:4311 -> VPS 127.0.0.1:4177`
- tunnel python default: `python` on Windows, `python3` on non-Windows hosts when `CONTROL_ROOM_TUNNEL_PYTHON_BIN` is blank
- secure cookie behavior: the hosted login cookie automatically adds `Secure` when nginx forwards `X-Forwarded-Proto=https`

## Public HTTPS Access

The domain-hosted path keeps the Node service private on loopback and publishes standard ports through nginx:

1. Keep `CONTROL_ROOM_BIND_HOST=127.0.0.1` and `CONTROL_ROOM_PORT=4177`.
2. Set `CONTROL_ROOM_PUBLIC_URL=https://imonengine.com`.
3. Run `scripts/install-control-room-service.sh` on the VPS.
4. Run `scripts/install-control-room-nginx-proxy.sh imonengine.com` on the VPS.
5. Point the `imonengine.com` DNS A record, and optionally `www.imonengine.com`, at the VPS IP.
6. After DNS resolves to the VPS, run `scripts/install-control-room-certbot.sh imonengine.com`.
7. Open `https://imonengine.com/login` from any device and sign in with the existing control-room password.

The app still stays password-gated. nginx terminates TLS, forwards `X-Forwarded-Proto=https`, and leaves the repo-hosted control-room process bound to `127.0.0.1:4177`.

## Routes

Hosted routes:

- `/login`
- `/logout`
- `/`
- `/engine`
- `/business/:id`
- `/department/:businessId/:departmentId`

JSON routes:

- `/api/control-room/snapshot`
- `/api/control-room/chat/engine`
- `/api/control-room/chat/business/:id`
- `/api/control-room/chat/department/:businessId/:departmentId`
- `/api/control-room/chat/actions/:actionId/apply`
- `/api/control-room/chat/actions/:actionId/dismiss`
- `/api/control-room/business/:id`
- `/api/control-room/department/:businessId/:departmentId`
- `/api/control-room/activity`
- `/api/control-room/approvals`
- `/api/control-room/tasks`
- `/api/control-room/health`
- `/api/control-room/stream`
- `/api/control-room/commands/engine-sync`
- `/api/control-room/commands/activate-business`
- `/api/control-room/commands/pause-business`
- `/api/control-room/commands/route-task`
- `/api/control-room/commands/resolve-approval`

The command routes stay inside the control plane:

- `engine-sync` refreshes the engine, organization, and dashboard artifacts
- `activate-business` and `pause-business` change managed-business stage through `ImonEngineAgent`
- `route-task` injects an operator directive into the task-routing layer with department/position ownership
- `resolve-approval` records supported file-backed approval artifacts, then reruns engine sync so the approval queue and launch blockers refresh immediately
- `chat/*` loads or mutates the durable office-chat thread for the current engine/business/department scope

The app is still intentionally limited. It does not expose generic mutation routes for budgets, payouts, or workflow execution beyond routed operator guidance. Approval actions are restricted to directly supported governance signoffs that already have durable file-backed handlers. Today that means the ClipBaiters rights-policy approval and the ClipBaiters lane-posture approval.

## Validation

UI changes on this surface should be validated with:

- `npm test`
- `npm run build`
- `npm run test:control-room-ui`

`test:control-room-ui` is a browser-based Playwright flow that signs into `control-room-local`, navigates engine -> business -> department through the folder tree, validates worker-card navigation and detail panes, verifies scoped chat flows at each level, checks apply or dismiss behavior for confirmable chat actions, and confirms that operator controls and approval actions still function behind the `Controls` tab. Electron coverage is intentionally out of scope for this phase.

## Local Operator App

Run the local control room with:

- `npm run dev -- control-room-local`
- `scripts/start-local-control-room.ps1`
- `Start-Imon-Control-Room-Local-App.cmd`

That process:

- opens an SSH tunnel to the VPS private control-room port when `CONTROL_ROOM_AUTO_TUNNEL=true`
- skips the SSH tunnel and proxies `http://127.0.0.1:4177` directly when the hosted control room is already running on the same machine
- still starts the local UI and serves the login page even when the tunnel bootstrap fails, so laptop-side tunnel or credential problems surface as an explicit page error instead of a blank browser tab
- signs into the VPS control room with the owner password
- renders the office/dashboard locally
- proxies read endpoints and approved operator commands back to the VPS

Normal operator flow:

1. Start the VPS control room service.
2. Start the local operator app on your machine.
3. Open `http://127.0.0.1:4310/`.
4. Sign in once using the control-room password.
5. Use the local UI for business switching, scoped orchestrator chat, engine sync, activation/pause, routed operator directives, and the supported approval actions surfaced in the `Approval Actions` panel.

When the public domain is live, `https://imonengine.com` is the simplest path from phones, tablets, and other PCs. Keep the SSH tunnel and local operator app as the fallback path when the public domain is unavailable or when you explicitly want loopback-only access.

For the most reliable Windows path to the hosted VPS control room, use:

- `C:\AIWorkspace\Projects\Auto-Funding\Start-Imon-Control-Room.cmd`

That wrapper:

- opens a native `ssh.exe` tunnel to the hosted control-room service in its own PowerShell window
- keeps that PowerShell window tied to the tunnel lifecycle, so closing it also closes the local control-room connection
- reads the VPS host from `IMON_ENGINE_VPS_HOST` or `IMON_ENGINE_HOST_IP` when available and otherwise prompts for it in the PowerShell tunnel window
- lets `ssh.exe` handle any host-key acceptance or VPS password prompt directly in that PowerShell tunnel window instead of requiring the password inside the start script
- reuses an already-running tunnel on `127.0.0.1:4310` when that tunnel is the same hosted-control-room launcher
- stops stale repo-managed listeners on `127.0.0.1:4310` before relaunching the direct tunnel
- fails with a clear error when an unrelated process is occupying `127.0.0.1:4310`
- waits for the hosted control-room login page to come up on `http://127.0.0.1:4310/` before opening the browser
- opens the hosted dashboard in the default browser

When you specifically want the local operator app instead of the direct hosted tunnel, use:

- `C:\AIWorkspace\Projects\Auto-Funding\Start-Imon-Control-Room-Local-App.cmd`

That wrapper keeps the existing `control-room-local` flow available for the local dashboard renderer, proxied office explorer, and local UI regression work.

noVNC remains the fallback path for:

- browser-only sign-ins
- captchas
- account recovery
- any manual steps needed inside the VPS Chrome profile

## VPS Service

Install the hosted control room on the VPS with:

- `scripts/install-control-room-service.sh`

Optional public-domain helpers:

- `scripts/install-control-room-nginx-proxy.sh [domain]`
- `scripts/install-control-room-certbot.sh [domain] [email]`

Runtime wrapper:

- `scripts/run-control-room.sh`

The install script:

- ensures `CONTROL_ROOM_SESSION_SECRET` exists
- derives `CONTROL_ROOM_PASSWORD_HASH` from the existing VPS/host password when no explicit control-room hash is set
- builds the repo
- installs `imon-engine-control-room.service`
- enables and starts the service

The nginx helper keeps the Node service on `127.0.0.1:4177`, installs an nginx site on ports `80` and `443`, forwards the hosted app through standard web ports, disables proxy buffering for the SSE stream, and writes `CONTROL_ROOM_PUBLIC_URL=https://<domain>` into `.env`.

The certbot helper adds TLS and HTTP-to-HTTPS redirection after the domain already resolves to the VPS.

The runtime wrapper now follows the same auth bootstrap rule for manual starts. When `CONTROL_ROOM_PASSWORD_HASH` is blank, `scripts/run-control-room.sh` reads `IMON_ENGINE_HOST_PASSWORD` first and `IMON_ENGINE_VPS_PASSWORD` second, derives a temporary control-room hash for the running process, and keeps the hosted login usable without requiring a separate pre-step. If neither a hash nor a fallback password exists, the wrapper exits immediately with a clear error instead of starting a server that cannot accept logins.

The direct repo CLI now follows the same auth bootstrap rule. When you run `npm run dev -- control-room-serve` or `npm run dev -- control-room-health` without `CONTROL_ROOM_PASSWORD_HASH`, the app derives the control-room login from `IMON_ENGINE_HOST_PASSWORD` first and `IMON_ENGINE_VPS_PASSWORD` second so the dev path matches the wrapper behavior.

`control-room-serve` now binds the hosted app first and treats the startup `engine-sync` as a best-effort background refresh. If the live runtime state makes that refresh fail, the control room stays online against the latest durable snapshot instead of exiting before the login page comes up.

The hourly VPS autopilot now also rebuilds the repo and restarts the control-room service so the hosted app stays aligned with pulled code.

## Publish Checklist

For control-room changes that affect the webpage:

1. Run `npm test`.
2. Run `npm run build`.
3. Run `npm run test:control-room-ui`.
4. Sync the updated repo to `/opt/imon-engine`.
5. Run the VPS-side rebuild or sync flow.
6. Restart `imon-engine-control-room.service`.
7. Verify the hosted app at `CONTROL_ROOM_PUBLIC_URL` when the public domain path is enabled, or at the loopback/tunnel URL when it is not.
8. Verify the local webpage at `http://127.0.0.1:4310/` when you still use the tunnel or local-operator path.

## Read-Only Data Rules

The hosted app displays:

- executive office summary
- business office detail
- department office detail
- workflow ownership
- approval queue
- task inspector
- activity feed
- spend and reinvestment context

It also surfaces:

- freshness from the latest engine/office sync
- verified-data-only warnings from allocation and collective-fund snapshots
- stale-data warnings when the control plane is out of date

The local and hosted apps do not:

- approve arbitrary actions outside the small supported approval set
- execute workflows
- mutate budgets
- override control-plane data
