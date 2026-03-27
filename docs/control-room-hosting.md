# Control Room Hosting

The control room now has two outputs backed by the same control-plane snapshot:

- a static fallback export at `runtime/ops/control-room/index.html`
- a private hosted app served directly from the repo
- a local operator app that proxies the private VPS app over an SSH tunnel

The control plane remains the source of truth. The hosted app holds the durable state and execution environment. The local operator app renders the same control-room view-model locally while sending guided write actions back to the VPS control plane.

## Commands

- `npm run dev -- control-room-build`
- `npm run dev -- control-room-serve`
- `npm run dev -- control-room-local`
- `npm run dev -- control-room-health`
- `npm run dev -- control-room-password-hash --password "<value>"`

`office-dashboard` still exists and now uses the same shared snapshot and renderer as the hosted app.

## Environment

- `CONTROL_ROOM_BIND_HOST`
- `CONTROL_ROOM_PORT`
- `CONTROL_ROOM_SESSION_SECRET`
- `CONTROL_ROOM_PASSWORD_HASH`
- `CONTROL_ROOM_SESSION_TTL_HOURS`
- `CONTROL_ROOM_STALE_THRESHOLD_MINUTES`
- `CONTROL_ROOM_SERVICE_LOG_PATH`
- `CONTROL_ROOM_LOCAL_BIND_HOST`
- `CONTROL_ROOM_LOCAL_PORT`
- `CONTROL_ROOM_REMOTE_URL`
- `CONTROL_ROOM_AUTO_TUNNEL`
- `CONTROL_ROOM_TUNNEL_PORT`
- `CONTROL_ROOM_TUNNEL_PYTHON_BIN`

Default v1 behavior:

- bind host: `127.0.0.1`
- port: `4177`
- auth: owner-only password gate with signed httpOnly cookies
- exposure: private VPS only, via the VPS browser or SSH tunneling
- local app bind host: `127.0.0.1`
- local app port: `4310`
- local tunnel target: `127.0.0.1:4311 -> VPS 127.0.0.1:4177`

## Routes

Hosted routes:

- `/login`
- `/logout`
- `/`
- `/business/:id`
- `/department/:businessId/:departmentId`

JSON routes:

- `/api/control-room/snapshot`
- `/api/control-room/business/:id`
- `/api/control-room/activity`
- `/api/control-room/approvals`
- `/api/control-room/tasks`
- `/api/control-room/health`
- `/api/control-room/stream`
- `/api/control-room/commands/engine-sync`
- `/api/control-room/commands/activate-business`
- `/api/control-room/commands/pause-business`
- `/api/control-room/commands/route-task`

The command routes stay inside the control plane:

- `engine-sync` refreshes the engine, organization, and dashboard artifacts
- `activate-business` and `pause-business` change managed-business stage through `ImonEngineAgent`
- `route-task` injects an operator directive into the task-routing layer with department/position ownership

The app is still intentionally limited. It does not expose direct mutation routes for approvals, budgets, payouts, or workflow execution beyond routed operator guidance.

## Local Operator App

Run the local control room with:

- `npm run dev -- control-room-local`
- `scripts/start-local-control-room.ps1`
- `Start-Imon-Control-Room.cmd`

That process:

- opens an SSH tunnel to the VPS private control-room port when `CONTROL_ROOM_AUTO_TUNNEL=true`
- signs into the VPS control room with the owner password
- renders the office/dashboard locally
- proxies read endpoints and approved operator commands back to the VPS

Normal operator flow:

1. Start the VPS control room service.
2. Start the local operator app on your machine.
3. Open `http://127.0.0.1:4310/`.
4. Sign in once using the control-room password.
5. Use the local UI for business switching, engine sync, activation/pause, and routed operator directives.

For Windows, the easiest launcher is:

- `C:\AIWorkspace\Projects\Auto-Funding\Start-Imon-Control-Room.cmd`

That wrapper:

- starts the local control-room server in a minimized PowerShell window when needed
- waits for the local port to open
- opens the dashboard in the default browser

noVNC remains the fallback path for:

- browser-only sign-ins
- captchas
- account recovery
- any manual steps needed inside the VPS Chrome profile

## VPS Service

Install the hosted control room on the VPS with:

- `scripts/install-control-room-service.sh`

Runtime wrapper:

- `scripts/run-control-room.sh`

The install script:

- ensures `CONTROL_ROOM_SESSION_SECRET` exists
- derives `CONTROL_ROOM_PASSWORD_HASH` from the existing VPS/host password when no explicit control-room hash is set
- builds the repo
- installs `imon-engine-control-room.service`
- enables and starts the service

The hourly VPS autopilot now also rebuilds the repo and restarts the control-room service so the hosted app stays aligned with pulled code.

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

- approve actions
- execute workflows
- mutate budgets
- override control-plane data
