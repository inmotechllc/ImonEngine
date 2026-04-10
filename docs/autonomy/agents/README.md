# Imon Engine Agent Context Hub

Use this folder as the repo-aware custom-agent profile for any agent working in this workspace. Read [AGENTS.md](../../../AGENTS.md) first, then this file, then [auto-documentation.md](./auto-documentation.md).

## Read Order

1. [AGENTS.md](../../../AGENTS.md)
2. [README.md](../../../README.md)
3. [docs/imon-engine.md](../../imon-engine.md)
4. This hub
5. [auto-documentation.md](./auto-documentation.md)
6. The capability docs and code paths for the area you are changing

If the root `AGENTS.md` autopilot gate is active, follow that gate first and treat this hub as supporting context only.

## Core Repo Model

- This is a file-backed TypeScript operations system for `ImonEngine` and its managed businesses.
- [src/index.ts](../../../src/index.ts) is the command router and service-composition root. Treat it as the authoritative CLI surface.
- [src/config.ts](../../../src/config.ts) is the environment and default-config contract.
- [src/storage/store.ts](../../../src/storage/store.ts) is the durable JSON persistence contract.
- [src/domain](../../../src/domain) holds the core types and business rules.
- [src/agents](../../../src/agents) holds higher-level workflow agents.
- [src/services](../../../src/services) holds operational services, generators, servers, and UI-support logic.
- [runtime/state](../../../runtime/state) is durable state.
- [runtime/ops](../../../runtime/ops) is generated operational output.
- [runtime/asset-store](../../../runtime/asset-store), [runtime/marketing](../../../runtime/marketing), [runtime/previews](../../../runtime/previews), [runtime/agency-site](../../../runtime/agency-site), and [runtime/storefront-site](../../../runtime/storefront-site) are generated artifacts, not the main source of truth.

## Operating Rules

- Prefer extending the existing file-backed architecture over introducing hidden services, databases, or state layers.
- Read the nearest canonical doc before changing behavior in that area.
- Keep commands, env vars, runtime artifacts, and docs aligned in the same change.
- Follow [auto-documentation.md](./auto-documentation.md) for every durable change.
- If a task touches multiple domains, update the domain doc plus any cross-cutting docs listed below.

## Capability Map

### Engine And Portfolio

- Canonical doc: [docs/imon-engine.md](../../imon-engine.md)
- Code to inspect: [src/agents/imon-engine.ts](../../../src/agents/imon-engine.ts), [src/domain/engine.ts](../../../src/domain/engine.ts), [src/services/system-monitor.ts](../../../src/services/system-monitor.ts)
- Common artifacts: [runtime/state/engine.json](../../../runtime/state/engine.json), [runtime/state/businesses.json](../../../runtime/state/businesses.json), [runtime/ops/engine-overview.json](../../../runtime/ops/engine-overview.json)

### Organization Control Plane

- Canonical doc: [docs/org-control-plane.md](../../org-control-plane.md)
- Code to inspect: [src/domain/org.ts](../../../src/domain/org.ts), [src/services/organization-control-plane.ts](../../../src/services/organization-control-plane.ts), [src/services/org-templates.ts](../../../src/services/org-templates.ts), [src/services/office-templates.ts](../../../src/services/office-templates.ts)
- Common artifacts: [runtime/ops/org-control-plane.json](../../../runtime/ops/org-control-plane.json), [runtime/ops/office-views.json](../../../runtime/ops/office-views.json), [runtime/state/taskEnvelopes.json](../../../runtime/state/taskEnvelopes.json)

### Control Room And Operator UI

- Canonical doc: [docs/control-room-hosting.md](../../control-room-hosting.md)
- Code to inspect: [src/services/control-room-server.ts](../../../src/services/control-room-server.ts), [src/services/control-room-local-server.ts](../../../src/services/control-room-local-server.ts), [src/services/control-room-renderer.ts](../../../src/services/control-room-renderer.ts), [src/services/control-room-remote-client.ts](../../../src/services/control-room-remote-client.ts), [src/services/office-chat.ts](../../../src/services/office-chat.ts), [src/services/office-chat-shared.ts](../../../src/services/office-chat-shared.ts), [scripts/test-control-room-ui.ts](../../../scripts/test-control-room-ui.ts)
- Common artifacts: [runtime/ops/control-room](../../../runtime/ops/control-room), [runtime/state/officeChatThreads.json](../../../runtime/state/officeChatThreads.json), [runtime/state/officeChatMessages.json](../../../runtime/state/officeChatMessages.json), [runtime/state/officeChatActions.json](../../../runtime/state/officeChatActions.json)

### Store Ops, Gumroad, Growth, And Revenue

- Canonical doc: [docs/gumroad-store.md](../../gumroad-store.md)
- Code to inspect: [src/agents/digital-asset-factory.ts](../../../src/agents/digital-asset-factory.ts), [src/agents/store-autopilot.ts](../../../src/agents/store-autopilot.ts), [src/services/store-ops.ts](../../../src/services/store-ops.ts), [src/domain/digital-assets.ts](../../../src/domain/digital-assets.ts), [src/domain/store-ops.ts](../../../src/domain/store-ops.ts), [scripts/publish_gumroad_product.py](../../../scripts/publish_gumroad_product.py), [scripts/publish_growth_post.py](../../../scripts/publish_growth_post.py)
- Common artifacts: [runtime/state/assetPacks.json](../../../runtime/state/assetPacks.json), [runtime/state/socialProfiles.json](../../../runtime/state/socialProfiles.json), [runtime/state/salesTransactions.json](../../../runtime/state/salesTransactions.json), [runtime/asset-store](../../../runtime/asset-store), [runtime/marketing](../../../runtime/marketing)

### Venture Studio And Business Templates

- Canonical doc: [docs/venture-studio.md](../../venture-studio.md)
- Code to inspect: [src/services/venture-studio.ts](../../../src/services/venture-studio.ts), [src/domain/venture.ts](../../../src/domain/venture.ts)
- Common artifacts: [runtime/ops/venture-studio.json](../../../runtime/ops/venture-studio.json), [runtime/ops/venture-calendar.json](../../../runtime/ops/venture-calendar.json), [runtime/ops/venture-blueprints](../../../runtime/ops/venture-blueprints)

### ClipBaiters Viral Moments

- Canonical doc: [docs/clipbaiters-viral-moments.md](../../clipbaiters-viral-moments.md)
- Code to inspect: [src/domain/defaults.ts](../../../src/domain/defaults.ts), [src/domain/clipbaiters.ts](../../../src/domain/clipbaiters.ts), [src/agents/imon-engine.ts](../../../src/agents/imon-engine.ts), [src/services/venture-studio.ts](../../../src/services/venture-studio.ts), [src/services/store-ops.ts](../../../src/services/store-ops.ts), [src/services/org-templates.ts](../../../src/services/org-templates.ts), [src/services/organization-control-plane.ts](../../../src/services/organization-control-plane.ts), [src/services/clipbaiters-studio.ts](../../../src/services/clipbaiters-studio.ts), [src/services/clipbaiters-collector.ts](../../../src/services/clipbaiters-collector.ts), [src/services/clipbaiters-skimmer.ts](../../../src/services/clipbaiters-skimmer.ts), [src/services/clipbaiters-radar.ts](../../../src/services/clipbaiters-radar.ts), [src/services/clipbaiters-ingest.ts](../../../src/services/clipbaiters-ingest.ts), [src/services/clipbaiters-editor.ts](../../../src/services/clipbaiters-editor.ts), [src/services/clipbaiters-autonomy.ts](../../../src/services/clipbaiters-autonomy.ts), [src/services/clipbaiters-publisher.ts](../../../src/services/clipbaiters-publisher.ts), [src/services/clipbaiters-analytics.ts](../../../src/services/clipbaiters-analytics.ts), [src/services/clipbaiters-deals.ts](../../../src/services/clipbaiters-deals.ts), [src/services/clipbaiters-intake.ts](../../../src/services/clipbaiters-intake.ts), [src/services/clipbaiters-monetization.ts](../../../src/services/clipbaiters-monetization.ts), [scripts/chrome_cdp.py](../../../scripts/chrome_cdp.py), [scripts/youtube_studio_upload.py](../../../scripts/youtube_studio_upload.py), [src/domain/venture.ts](../../../src/domain/venture.ts)
- Common artifacts: [runtime/state/businesses.json](../../../runtime/state/businesses.json), [runtime/state/socialProfiles.json](../../../runtime/state/socialProfiles.json), [runtime/state/clipbaiters](../../../runtime/state/clipbaiters), [runtime/ops/clipbaiters](../../../runtime/ops/clipbaiters), [runtime/ops/org-control-plane.json](../../../runtime/ops/org-control-plane.json), [runtime/ops/office-views.json](../../../runtime/ops/office-views.json), [runtime/ops/venture-blueprints/clipbaiters-viral-moments.json](../../../runtime/ops/venture-blueprints/clipbaiters-viral-moments.json), [runtime/ops/venture-blueprints/clipbaiters-viral-moments.md](../../../runtime/ops/venture-blueprints/clipbaiters-viral-moments.md), [runtime/source-feeds/clipbaiters](../../../runtime/source-feeds/clipbaiters), [runtime/source-feeds/clipbaiters/clipbaiters-viral-moments/creator-orders](../../../runtime/source-feeds/clipbaiters/clipbaiters-viral-moments/creator-orders), [runtime/state/clipbaiters/clipbaiters-viral-moments/source-watchlists.json](../../../runtime/state/clipbaiters/clipbaiters-viral-moments/source-watchlists.json), [runtime/state/clipbaiters/clipbaiters-viral-moments/video-discovery.json](../../../runtime/state/clipbaiters/clipbaiters-viral-moments/video-discovery.json), [runtime/state/clipbaiters/clipbaiters-viral-moments/skim-summaries.json](../../../runtime/state/clipbaiters/clipbaiters-viral-moments/skim-summaries.json), [runtime/state/clipbaiters/clipbaiters-viral-moments/clip-candidates.json](../../../runtime/state/clipbaiters/clipbaiters-viral-moments/clip-candidates.json), [runtime/state/clipbaiters/clipbaiters-viral-moments/clip-jobs.json](../../../runtime/state/clipbaiters/clipbaiters-viral-moments/clip-jobs.json), [runtime/state/clipbaiters/clipbaiters-viral-moments/publishing-queue.json](../../../runtime/state/clipbaiters/clipbaiters-viral-moments/publishing-queue.json), [runtime/state/clipbaiters/clipbaiters-viral-moments/channel-metrics.json](../../../runtime/state/clipbaiters/clipbaiters-viral-moments/channel-metrics.json), [runtime/state/clipbaiters/clipbaiters-viral-moments/publish-history.json](../../../runtime/state/clipbaiters/clipbaiters-viral-moments/publish-history.json), [runtime/state/clipbaiters/clipbaiters-viral-moments/creator-leads.json](../../../runtime/state/clipbaiters/clipbaiters-viral-moments/creator-leads.json), [runtime/state/clipbaiters/clipbaiters-viral-moments/creator-outreach.json](../../../runtime/state/clipbaiters/clipbaiters-viral-moments/creator-outreach.json), [runtime/state/clipbaiters/clipbaiters-viral-moments/creator-offers.json](../../../runtime/state/clipbaiters/clipbaiters-viral-moments/creator-offers.json), [runtime/state/clipbaiters/clipbaiters-viral-moments/creator-orders.json](../../../runtime/state/clipbaiters/clipbaiters-viral-moments/creator-orders.json), [runtime/state/clipbaiters/clipbaiters-viral-moments/revenue-snapshots.json](../../../runtime/state/clipbaiters/clipbaiters-viral-moments/revenue-snapshots.json), [runtime/ops/clipbaiters/clipbaiters-viral-moments/launch-checklist.md](../../../runtime/ops/clipbaiters/clipbaiters-viral-moments/launch-checklist.md), [runtime/ops/clipbaiters/clipbaiters-viral-moments/daily-summary.md](../../../runtime/ops/clipbaiters/clipbaiters-viral-moments/daily-summary.md), [runtime/ops/clipbaiters/clipbaiters-viral-moments/autonomy-run.json](../../../runtime/ops/clipbaiters/clipbaiters-viral-moments/autonomy-run.json), [runtime/ops/clipbaiters/clipbaiters-viral-moments/autonomy-run.md](../../../runtime/ops/clipbaiters/clipbaiters-viral-moments/autonomy-run.md), [runtime/ops/clipbaiters/clipbaiters-viral-moments/draft-clips](../../../runtime/ops/clipbaiters/clipbaiters-viral-moments/draft-clips), [runtime/ops/clipbaiters/clipbaiters-viral-moments/upload-batches.json](../../../runtime/ops/clipbaiters/clipbaiters-viral-moments/upload-batches.json), [runtime/ops/clipbaiters/clipbaiters-viral-moments/review-queue.md](../../../runtime/ops/clipbaiters/clipbaiters-viral-moments/review-queue.md), [runtime/ops/clipbaiters/clipbaiters-viral-moments/channel-metrics.md](../../../runtime/ops/clipbaiters/clipbaiters-viral-moments/channel-metrics.md), [runtime/ops/clipbaiters/clipbaiters-viral-moments/creator-deals.md](../../../runtime/ops/clipbaiters/clipbaiters-viral-moments/creator-deals.md), [runtime/ops/clipbaiters/clipbaiters-viral-moments/monetization-report.md](../../../runtime/ops/clipbaiters/clipbaiters-viral-moments/monetization-report.md)

### Imonic POD Lane

- Canonical doc: [docs/imonic-store.md](../../imonic-store.md)
- Code to inspect: [src/services/pod-studio.ts](../../../src/services/pod-studio.ts), [src/services/pod-autonomy.ts](../../../src/services/pod-autonomy.ts), [src/domain/pod.ts](../../../src/domain/pod.ts)
- Common artifacts: [runtime/ops/pod-businesses](../../../runtime/ops/pod-businesses), [runtime/state/businesses.json](../../../runtime/state/businesses.json)

### Micro-SaaS Lane

- Canonical doc: [docs/micro-saas-factory.md](../../micro-saas-factory.md)
- Code to inspect: [src/services/micro-saas-studio.ts](../../../src/services/micro-saas-studio.ts), [src/domain/micro-saas.ts](../../../src/domain/micro-saas.ts)
- Common artifacts: [runtime/ops/micro-saas-businesses](../../../runtime/ops/micro-saas-businesses)

### Northline Agency And Proof Site

- Canonical docs: [docs/northline-hosting.md](../../northline-hosting.md), [docs/northline-launch-checklist.md](../../northline-launch-checklist.md), [docs/playbook.md](../../playbook.md)
- Code to inspect: [src/agents/orchestrator.ts](../../../src/agents/orchestrator.ts), [src/agents/site-builder.ts](../../../src/agents/site-builder.ts), [src/agents/qa-reviewer.ts](../../../src/agents/qa-reviewer.ts), [src/agents/deployer.ts](../../../src/agents/deployer.ts), [src/services/agency-site.ts](../../../src/services/agency-site.ts), [src/services/northline-business-profile.ts](../../../src/services/northline-business-profile.ts), [src/services/northline-profile-admin.ts](../../../src/services/northline-profile-admin.ts), [src/services/northline-ops.ts](../../../src/services/northline-ops.ts), [src/services/northline-autonomy.ts](../../../src/services/northline-autonomy.ts), [src/services/northline-prospect-collector.ts](../../../src/services/northline-prospect-collector.ts), [src/services/northline-prospect-sourcing.ts](../../../src/services/northline-prospect-sourcing.ts), [src/services/northline-site-server.ts](../../../src/services/northline-site-server.ts), [src/domain/northline.ts](../../../src/domain/northline.ts), [src/domain/northline-autonomy.ts](../../../src/domain/northline-autonomy.ts)
- Common artifacts: [runtime/agency-site](../../../runtime/agency-site), [runtime/previews](../../../runtime/previews), [runtime/reports](../../../runtime/reports), [runtime/state/northlineIntakeSubmissions.json](../../../runtime/state/northlineIntakeSubmissions.json), [runtime/state/northlineAutonomy.json](../../../runtime/state/northlineAutonomy.json), [runtime/state/northlineProspectCollection.json](../../../runtime/state/northlineProspectCollection.json), [runtime/state/northlineProspectSourcing.json](../../../runtime/state/northlineProspectSourcing.json), [runtime/ops/northline-growth-system](../../../runtime/ops/northline-growth-system), [runtime/prospect-sources/northline](../../../runtime/prospect-sources/northline), plus business-scoped state under `runtime/state/northline/<business-id>/` and business-scoped source feeds under `runtime/prospect-sources/northline/<business-id>/`

### Setup, VPS, And Browser Automation

- Canonical docs: [docs/setup.md](../../setup.md), [docs/vps-tooling.md](../../vps-tooling.md)
- Code to inspect: [src/config.ts](../../../src/config.ts), [scripts](../../../scripts)
- Common artifacts: [runtime/ops/bootstrap-vps.sh](../../../runtime/ops/bootstrap-vps.sh), [runtime/ops/imon-engine-sync.sh](../../../runtime/ops/imon-engine-sync.sh), [runtime/ops/imon-engine.cron](../../../runtime/ops/imon-engine.cron), [runtime/ops/autopilot-last-run.json](../../../runtime/ops/autopilot-last-run.json)

### Autopilot

- Canonical docs: [docs/autopilot/roadmap.md](../../autopilot/roadmap.md), [docs/autopilot/handoff-protocol.md](../../autopilot/handoff-protocol.md), [docs/autopilot/state.json](../../autopilot/state.json), current phase file under [docs/autopilot/phases](../../autopilot/phases)
- Code to inspect: [src/agents/store-autopilot.ts](../../../src/agents/store-autopilot.ts), [scripts/run_local_autopilot.ps1](../../../scripts/run_local_autopilot.ps1), [scripts/run_vps_autopilot.sh](../../../scripts/run_vps_autopilot.sh)
- Common artifacts: [runtime/ops/autopilot-runner.log](../../../runtime/ops/autopilot-runner.log), [runtime/ops/autopilot-last-run.json](../../../runtime/ops/autopilot-last-run.json)

## Cross-Cutting Docs

- [README.md](../../../README.md): update when top-level capabilities, quick-start flow, or public command surface changes.
- [docs/setup.md](../../setup.md): update when env vars, defaults, ports, prerequisites, or first-run steps change.
- [docs/playbook.md](../../playbook.md): update when daily, delivery, or retention operating flows change.
- [docs/imon-engine.md](../../imon-engine.md): update when the engine model, state layout, command surface, or VPS flow changes.

## Validation Defaults

- Default validation: `npm test`, `npm run build`
- Control-room UI work: `npm run test:control-room-ui`
- Docs-only changes: validate the changed structured files and do a diff sanity check instead of running unrelated flows
- When you change runtime artifact formats, regenerate or verify the matching generator path if practical

## Structured Context Map

For agents or tooling that want a compact machine-readable map, read [context-map.json](./context-map.json).
