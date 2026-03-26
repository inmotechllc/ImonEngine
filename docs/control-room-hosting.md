# Control Room Hosting

The control room now has two outputs backed by the same control-plane snapshot:

- a static fallback export at `runtime/ops/control-room/index.html`
- a private hosted app served directly from the repo

The control plane remains the source of truth. The hosted app is read-only in v1 and does not mutate business state.

## Commands

- `npm run dev -- control-room-build`
- `npm run dev -- control-room-serve`
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

Default v1 behavior:

- bind host: `127.0.0.1`
- port: `4177`
- auth: owner-only password gate with signed httpOnly cookies
- exposure: private VPS only, via the VPS browser or SSH tunneling

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

The app does not:

- approve actions
- execute workflows
- mutate budgets
- override control-plane data

