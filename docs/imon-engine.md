# ImonEngine

ImonEngine is the parent portfolio layer for this repo. It sits above the original agency workflow and manages a ranked set of AI businesses while watching VPS pressure, launch readiness, and consolidated revenue.

It now also has a `venture studio` layer that turns the first live store into a reusable business template, enforces launch windows for new brands, and keeps speculative capital ideas in paper-only mode until the operating businesses produce real profit.

It now also has a real `organization control plane`. That layer maps the engine and each business into departments, positions, workflow ownership, approval routes, memory boundaries, and office views. The office is only a view of the control plane, not the source of truth.

It now also has a private hosted `control room` app on top of the control plane. The app is served from the VPS, uses an owner-only login gate, stays read-only in v1, and keeps the static dashboard export as a fallback.

## Managed Business Order

1. Digital asset store
2. Niche content site network
3. Faceless social brand
4. Micro-SaaS factory
5. Print-on-demand store
6. Auto-Funding agency

The first two businesses are marked `ready` by default because they have the lightest setup burden and lowest ongoing support load. The later businesses are scaffolded under management but stay behind explicit owner or platform setup steps.

## What It Tracks

- Managed business roster and launch stage
- Consolidated monthly revenue and costs
- VPS resource snapshots
- Recommended active-business concurrency
- Approval tasks for business launch blockers
- Generated bootstrap and cron artifacts for VPS staging
- Organization blueprints, workflow ownership, and office-view snapshots

## Commands

- `npm run dev -- bootstrap`
- `npm run dev -- businesses`
- `npm run dev -- engine-sync`
- `npm run dev -- engine-report`
- `npm run dev -- venture-studio`
- `npm run dev -- venture-studio --business <id>`
- `npm run dev -- org-sync`
- `npm run dev -- org-report`
- `npm run dev -- org-report --business <id>`
- `npm run dev -- office-views`
- `npm run dev -- office-dashboard`
- `npm run dev -- control-room-build`
- `npm run dev -- control-room-serve`
- `npm run dev -- control-room-health`
- `npm run dev -- control-room-password-hash --password "<value>"`
- `npm run dev -- route-task --title "<title>" --summary "<summary>" --workflow <id> --business <id>`
- `npm run dev -- autopilot-run-once`
- `npm run dev -- activate-business --business <id>`
- `npm run dev -- pause-business --business <id>`
- `npm run dev -- vps-artifacts`
- `npm run dev -- seed-asset-packs`
- `npm run dev -- stage-asset-pack --pack <id>`
- `npm run dev -- ready-asset-pack --pack <id>`
- `npm run dev -- publish-asset-pack --pack <id> --url <gumroad-url>`
- `npm run dev -- asset-packs`

## State Files

- `runtime/state/engine.json`
- `runtime/state/businesses.json`
- `runtime/state/businessRuns.json`
- `runtime/state/assetPacks.json`
- `runtime/state/resourceSnapshots.json`
- `runtime/state/revenueLedger.json`
- `runtime/state/engineReports.json`
- `runtime/state/organizationBlueprints.json`
- `runtime/state/departmentDefinitions.json`
- `runtime/state/positionDefinitions.json`
- `runtime/state/workflowOwnership.json`
- `runtime/state/taskEnvelopes.json`
- `runtime/state/orgAuditRecords.json`
- `runtime/ops/venture-studio.json`
- `runtime/ops/venture-calendar.json`
- `runtime/ops/venture-blueprints/`
- `runtime/ops/org-control-plane.json`
- `runtime/ops/office-views.json`
- `runtime/ops/control-room/index.html`
- `runtime/ops/control-room/data.json`
- `runtime/ops/org-blueprints/`

## Venture Rules

- The first live store is the template, not the forever-public brand for every future business.
- New brands should launch only during Monday morning creation windows in `America/New_York`.
- Before five created brands exist, launch windows stay weekly.
- After five created brands exist, launch windows slow to the first Monday of each month.
- Brand reinvestment and shared-system reinvestment should use the same percentage cap.
- Capital-market ideas such as stocks, crypto, forex, or mining stay in research or paper-only mode until profitable operating businesses build enough reserve.

## VPS Flow

1. Copy the repo to the VPS at `/opt/imon-engine`.
2. Fill in `.env`.
3. Run `scripts/bootstrap-vps.sh`.
4. Run `scripts/install-cron.sh` to keep `engine-sync` scheduled.
5. Start the persistent VPS browser with `scripts/vps-browser-start.sh` when a virtual display session is needed.
6. Verify Docker, Chrome, Playwright, Codex CLI, and DevTools with `scripts/vps-tooling-status.sh`.
7. Install the hosted control room with `scripts/install-control-room-service.sh`.
8. Start isolated business containers with `scripts/business-worker-start.sh <business-id> "<business-name>"`.
9. Review `runtime/ops/engine-overview.json`, `runtime/state/approvals.json`, `runtime/ops/venture-studio.json`, and the private control room.

See [control-room-hosting.md](C:/AIWorkspace/Projects/Auto-Funding/docs/control-room-hosting.md) for the hosted control-room service.

## Gumroad Publish Flow

1. Stage the selected pack.
2. When generation is complete, mark it with `ready-asset-pack`.
3. Publish it on Gumroad.
4. Record the live URL with `publish-asset-pack`.
5. Run `engine-sync`.
6. Review `runtime/ops/engine-overview.json` again before moving to the next pack.
