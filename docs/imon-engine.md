# ImonEngine

ImonEngine is the parent portfolio layer for this repo. It sits above the original agency workflow and manages a ranked set of AI businesses while watching VPS pressure, launch readiness, and consolidated revenue.

It now also has a `venture studio` layer that turns the first live store into a reusable business template, enforces launch windows for new brands, and keeps speculative capital ideas in paper-only mode until the operating businesses produce real profit.

It now also has a real `organization control plane`. That layer maps the engine and each business into departments, positions, workflow ownership, approval routes, memory boundaries, and office views. The office is only a view of the control plane, not the source of truth.

It now also has a private hosted `control room` app on top of the control plane plus a local `operator app` that connects back to the VPS. The VPS remains the execution and state layer. The local app is the normal dashboard/control surface, and the static dashboard export remains a fallback artifact.

That control room now renders a folder-style office explorer:

- `engine office`
- `business office`
- `department workspace`

It also exposes scoped orchestrator chat inside each office:

- engine chat for portfolio summaries, reports, and new deferred-business scaffolds
- business chat for accounting, analytics, market-data summaries, and multi-department routing
- department chat for worker steering, prompt overlays, schedule overrides, and execution briefs

Business categories are normalized into reusable office-template profiles so department workspaces and worker cards stay consistent across store, audience, product, and service businesses.

## AI Route Registry

`src/ai/api-map.ts` is the single source of truth for shared AI routes, provider labels, and business-specific capability overrides.

- Shared routes: `fast`, `deep`, and `research`
- Active business route groups: `imon-engine` for office chat and market research, `imon-digital-asset-store` for asset blueprint generation, and `auto-funding-agency` for Northline scoring, outreach, site copy, reply classification, retention reporting, and prospect research
- Reserved namespaces stay pre-registered for Northbeam, Velora, ClipBaiters, QuietPivot, and Imonic so future lane-specific AI APIs land in the same registry instead of spreading across callers

Current stage-1 defaults are split by provider: `fast -> NVIDIA microsoft/phi-3.5-mini-instruct`, `deep -> NVIDIA deepseek-ai/deepseek-v3.1`, and `research -> OpenAI gpt-5` with `web_search_preview`.

Provider secrets and optional host overrides stay in env through the `AI_PROVIDER_*` keys. NVIDIA defaults to `https://integrate.api.nvidia.com/v1` when no override is set, while OpenAI stays active for the current `research` route. The route map owns which provider and model each shared or business-specific capability uses.

## Agent Context Hub

Use [docs/autonomy/agents/README.md](C:/AIWorkspace/Projects/Auto-Funding/docs/autonomy/agents/README.md) as the repo-aware custom-agent briefing for any agent working on ImonEngine. It points agents at the canonical docs, code surfaces, runtime artifacts, and validation paths for each subsystem.

Use [docs/autonomy/agents/auto-documentation.md](C:/AIWorkspace/Projects/Auto-Funding/docs/autonomy/agents/auto-documentation.md) for the required documentation follow-through whenever agents change commands, config, routes, runtime outputs, or operating rules.

## Managed Business Order

1. Digital asset store
2. Niche content site network
3. Faceless social brand
4. ClipBaiters - Viral Moments
5. Micro-SaaS factory
6. Print-on-demand store
7. Northline Growth Systems

The first two businesses are marked `ready` by default because they have the lightest setup burden and lowest ongoing support load. The later businesses are scaffolded under management but stay behind explicit owner or platform setup steps. ClipBaiters is a separate compliance-gated clipping lane; it does not replace the broader deferred Velora social-brand placeholder.

## What It Tracks

- Managed business roster and launch stage
- ClipBaiters business registration, compliance blockers, venture-blueprint state, source-watchlists, discovery and skim artifacts, multi-lane draft-package outputs, blocked publishing queues, publish history, creator-lead and outreach state, creator-offer catalogs, creator-order intake, revenue snapshots, manual review artifacts, launch checklist state, org-control-plane ownership, office-view execution lanes, and per-channel queue metrics while the YouTube-first clipping workflow is staged
- Managed-business `northlineProfile` overrides for agency service areas, trade filters, target services, offer identity, and the full Lead Generation / Growth payment-link surface
- Consolidated monthly revenue and costs
- VPS resource snapshots
- Recommended active-business concurrency
- Approval tasks for business launch blockers
- Generated bootstrap and cron artifacts for VPS staging
- Organization blueprints, workflow ownership, and office-view snapshots
- Northline autonomy run state, hosted-intake promotion, and manual gate reporting for the agency lane
- Northline hosted validation confirmation state for the low-risk paid handoff check
- Northline prospect-source ingestion state and summary artifacts for the agency lane

## Commands

- `npm run dev -- bootstrap`
- `npm run dev -- businesses`
- `npm run dev -- engine-sync`
- `npm run dev -- engine-report`
- `npm run dev -- venture-studio`
- `npm run dev -- venture-studio --business <id>`
- `npm run dev -- clipbaiters-plan --business clipbaiters-viral-moments`
- `npm run dev -- clipbaiters-collect --business clipbaiters-viral-moments [--lane clipbaiters-political]`
- `npm run dev -- clipbaiters-skim --business clipbaiters-viral-moments [--lane clipbaiters-political]`
- `npm run dev -- clipbaiters-radar --business clipbaiters-viral-moments --lane clipbaiters-political`
- `npm run dev -- clipbaiters-autonomy-run --business clipbaiters-viral-moments [--lane clipbaiters-political] [--all-active-lanes] --dry-run`
- `npm run dev -- clipbaiters-publish --business clipbaiters-viral-moments [--lane clipbaiters-political] [--all-active-lanes] --dry-run`
- `npm run dev -- clipbaiters-source-creators --business clipbaiters-viral-moments`
- `npm run dev -- clipbaiters-draft-creator-outreach --business clipbaiters-viral-moments`
- `npm run dev -- clipbaiters-deals-report --business clipbaiters-viral-moments`
- `npm run dev -- clipbaiters-intake --business clipbaiters-viral-moments`
- `npm run dev -- clipbaiters-monetization-report --business clipbaiters-viral-moments`
- `npm run dev -- northline-collect-prospects [--business auto-funding-agency] [--force]`
- `npm run dev -- northline-source-prospects [--business auto-funding-agency]`
- `npm run dev -- northline-autonomy-run [--business auto-funding-agency] [--notify-roadblocks]`
- `npm run dev -- northline-billing-handoff --client <id> --status paid|retainer_active [--form-endpoint <url>] [--next-action <text>]`
- `npm run dev -- northline-validation-run [--business auto-funding-agency] [--submission latest|<id>] [--status paid|retainer_active] [--form-endpoint <url>]`
- `npm run dev -- northline-site-serve`
- `npm run dev -- northline-site-health`
- `npm run dev -- org-sync`
- `npm run dev -- org-report`
- `npm run dev -- org-report --business <id>`
- `npm run dev -- office-views`
- `npm run dev -- office-dashboard`
- `npm run dev -- control-room-build`
- `npm run dev -- control-room-serve`
- `npm run dev -- control-room-local`
- `npm run dev -- control-room-health`
- `npm run dev -- control-room-password-hash --password "<value>"`
- `npm run test:control-room-ui`
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

All repo-managed JSON and text state artifacts now write through an atomic temp-file-plus-rename path. That keeps concurrent VPS processes from leaving partial or duplicated `runtime/state/*` and `runtime/ops/*` files when autonomy, sourcing, reporting, or other workers update the same artifact family close together.

- `runtime/state/engine.json`
- `runtime/state/businesses.json`
- `runtime/state/businessRuns.json`
- `runtime/state/assetPacks.json`
- `runtime/state/resourceSnapshots.json`
- `runtime/state/revenueLedger.json`
- `runtime/state/engineReports.json`
- `runtime/state/northlineIntakeSubmissions.json`
- `runtime/state/northlineValidationConfirmations.json`
- `runtime/state/northlineAutonomy.json`
- `runtime/state/northlineProspectCollection.json`
- `runtime/state/northlineProspectSourcing.json`
- `runtime/state/northline/<business-id>/northlineAutonomy.json`
- `runtime/state/northline/<business-id>/northlineProspectCollection.json`
- `runtime/state/northline/<business-id>/northlineProspectSourcing.json`
- `runtime/state/organizationBlueprints.json`
- `runtime/state/departmentDefinitions.json`
- `runtime/state/positionDefinitions.json`
- `runtime/state/workflowOwnership.json`
- `runtime/state/taskEnvelopes.json`
- `runtime/state/officeHandoffs.json`
- `runtime/state/departmentExecutionItems.json`
- `runtime/state/orgAuditRecords.json`
- `runtime/state/clipbaiters/<business-id>/lane-registry.json`
- `runtime/state/clipbaiters/<business-id>/source-registry.json`
- `runtime/state/clipbaiters/<business-id>/source-watchlists.json`
- `runtime/state/clipbaiters/<business-id>/video-discovery.json`
- `runtime/state/clipbaiters/<business-id>/skim-summaries.json`
- `runtime/state/clipbaiters/<business-id>/event-radar.json`
- `runtime/state/clipbaiters/<business-id>/story-candidates.json`
- `runtime/state/clipbaiters/<business-id>/clip-candidates.json`
- `runtime/state/clipbaiters/<business-id>/clip-candidates-<lane-id>.json`
- `runtime/state/clipbaiters/<business-id>/clip-jobs.json`
- `runtime/state/clipbaiters/<business-id>/clip-jobs-<lane-id>.json`
- `runtime/state/clipbaiters/<business-id>/publishing-queue.json`
- `runtime/state/clipbaiters/<business-id>/channel-metrics.json`
- `runtime/state/clipbaiters/<business-id>/publish-history.json`
- `runtime/state/clipbaiters/<business-id>/creator-leads.json`
- `runtime/state/clipbaiters/<business-id>/creator-outreach.json`
- `runtime/state/clipbaiters/<business-id>/creator-offers.json`
- `runtime/state/clipbaiters/<business-id>/creator-orders.json`
- `runtime/state/clipbaiters/<business-id>/revenue-snapshots.json`
- `runtime/ops/venture-studio.json`
- `runtime/ops/venture-calendar.json`
- `runtime/ops/venture-blueprints/`
- `runtime/ops/clipbaiters/<business-id>/plan.json`
- `runtime/ops/clipbaiters/<business-id>/plan.md`
- `runtime/ops/clipbaiters/<business-id>/launch-checklist.md`
- `runtime/ops/clipbaiters/<business-id>/daily-brief.md`
- `runtime/ops/clipbaiters/<business-id>/daily-summary.md`
- `runtime/ops/clipbaiters/<business-id>/autonomy-run.json`
- `runtime/ops/clipbaiters/<business-id>/autonomy-run.md`
- `runtime/ops/clipbaiters/<business-id>/autonomy-run-<lane-id>.json`
- `runtime/ops/clipbaiters/<business-id>/autonomy-run-<lane-id>.md`
- `runtime/ops/clipbaiters/<business-id>/draft-clips/`
- `runtime/ops/clipbaiters/<business-id>/upload-batches.json`
- `runtime/ops/clipbaiters/<business-id>/review-queue.md`
- `runtime/ops/clipbaiters/<business-id>/channel-metrics.md`
- `runtime/ops/clipbaiters/<business-id>/creator-deals.md`
- `runtime/ops/clipbaiters/<business-id>/monetization-report.md`
- `runtime/ops/org-control-plane.json`
- `runtime/ops/office-views.json`
- `runtime/ops/control-room/index.html`
- `runtime/ops/control-room/data.json`
- `runtime/ops/org-blueprints/`
- `runtime/ops/northline-growth-system/plan.json`
- `runtime/ops/northline-growth-system/autonomy-summary.json`
- `runtime/ops/northline-growth-system/prospect-collection-summary.json`
- `runtime/ops/northline-growth-system/prospect-sourcing-summary.json`
- `runtime/ops/northline-growth-system/<business-id>/`
- `runtime/prospect-sources/northline/<business-id>/`
- `runtime/source-feeds/clipbaiters/<business-id>/`
- `runtime/source-feeds/clipbaiters/<business-id>/creator-orders/`

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
4. Run `scripts/install-cron.sh` to keep `engine-sync`, `northline-autonomy-run --business auto-funding-agency --notify-roadblocks`, and the ClipBaiters collect/skim/all-active-lanes draft plus publish/creator-deals/monetization cadence scheduled through the shared sync wrapper.
5. Start the persistent VPS browser with `scripts/vps-browser-start.sh` when a virtual display session is needed.
6. Verify Docker, Chrome, Playwright, Codex CLI, and DevTools with `scripts/vps-tooling-status.sh`.
7. Install the hosted control room with `scripts/install-control-room-service.sh`.
8. Start the local operator app with `npm run dev -- control-room-local` when you want the dashboard/offices locally instead of through noVNC.
9. Start isolated business containers with `scripts/business-worker-start.sh <business-id> "<business-name>"`.
10. Review `runtime/ops/engine-overview.json`, `runtime/state/approvals.json`, `runtime/ops/venture-studio.json`, and the private control room.

See [control-room-hosting.md](C:/AIWorkspace/Projects/Auto-Funding/docs/control-room-hosting.md) for the hosted/local control-room split and operator workflow.

## Northline Autonomy

Northline now has a file-backed autonomy loop that reuses the existing planning, approval, reporting, and client-delivery stack instead of introducing a separate queue.

The selected `--business` resolves a managed business's `northlineProfile` from `runtime/state/businesses.json`. That profile can override primary service area, collection areas, collection trades, target industries, target services, offer summary, sender identity, and proof-page copy. The default `auto-funding-agency` still falls back to `NORTHLINE_*` env values when a field is missing.

`northline-profile-show` prints the stored and resolved Northline profile for a managed business, including the business-scoped ops, source, and state paths. `northline-profile-update --business <id> --file <json>` applies a sanitized JSON patch to `northlineProfile` so operators do not need to hand-edit `runtime/state/businesses.json` for Northline-only changes. The resolved profile now includes the Lead Generation payment link plus structured Growth upgrade metadata so business-scoped pricing and upgrade copy can stay in managed state instead of being hard-coded into the public site.

Non-default Northline businesses keep their own source, ops, and run-state subdirectories under `runtime/prospect-sources/northline/<business-id>/`, `runtime/ops/northline-growth-system/<business-id>/`, and `runtime/state/northline/<business-id>/`. The default Northline business keeps the legacy root paths for backward compatibility.

- `northline-collect-prospects` refreshes deterministic Northline market feeds from OpenStreetMap/Overpass, caches market bounds in `runtime/state/northlineProspectCollection.json`, and writes `runtime/ops/northline-growth-system/prospect-collection-summary.json`.
- `northline-source-prospects` processes changed CSV or JSON feed files from `runtime/prospect-sources/northline/` by default and writes `runtime/ops/northline-growth-system/prospect-sourcing-summary.json`. Those repo-generated Northline feeds now carry `pipeline=agency_client_acquisition` so sourcing, outreach, and office views only treat them as businesses Northline wants to close. Any later end-customer lead feeds for retained operators should be marked `pipeline=client_demand_generation` and kept separate from Northline's own acquisition queue.
- `northline-inbox-sync` pulls replies for sent Northline leads through the configured inbox provider, records deduplicated reply history in `runtime/state/leadReplies.json`, and routes each message through the existing reply handler without needing a manual message file.
- `northline-autonomy-run` refreshes the Northline launch dossier, refreshes collector feeds on cadence, ingests hosted submissions from `runtime/state/northlineIntakeSubmissions.json`, opens explicit manual gates in `runtime/state/approvals.json`, and writes `runtime/ops/northline-growth-system/autonomy-summary.json`.
- The generated Northline plan and autonomy summary now surface `operatingMode.current`, the five promotion criteria, scheduled automation, and the remaining manual checkpoints so the lane's `controlled_launch` versus `autonomous` status is explicit on every run.
- The hourly VPS autopilot wrapper now runs `engine-sync` and `northline-autonomy-run --business auto-funding-agency --notify-roadblocks` before the optional Imonic POD refresh, so the Northline lane keeps moving even if the POD lane fails while sending a roadblock email.
- The shared VPS sync wrapper and generated `vps-artifacts` output now also run `clipbaiters-collect`, `clipbaiters-skim`, `clipbaiters-autonomy-run --all-active-lanes --dry-run`, `clipbaiters-publish --all-active-lanes --dry-run`, `clipbaiters-source-creators`, `clipbaiters-draft-creator-outreach`, `clipbaiters-deals-report`, and `clipbaiters-monetization-report` for `clipbaiters-viral-moments`, keeping the lane scheduled without bypassing manual review.
- Controlled ClipBaiters live uploads reuse `scripts/youtube_studio_upload.py` against the persistent Chrome session instead of a YouTube API integration, with eligibility following the currently active YouTube lanes once review gates clear.
- The autonomy runner now calls the market collector and then the prospect-source pass before it drafts outreach, so new external feed refreshes and manual feed drops can move into the outbound queue on the same scheduled run.
- Hosted intakes queue an immediate autonomy pass when `northline-site-serve` is live and still become proposal-stage `ClientJob` records automatically on the next scheduled or manual autonomy run when the hosted server was offline.
- `northline-billing-handoff` remains the explicit fast path for marking a proposal or intake as `paid` or `retainer_active` when a checkout did not carry a repo-owned client reference or needs a manual override.
- `/validation.html` now issues a hosted confirmation token, a Stripe checkout reference, and a server-backed status route for validation submissions so the same page can track the Stripe event and hosted result after the $1 checkout. When `NORTHLINE_STRIPE_WEBHOOK_SECRET` is configured, Stripe `checkout.session.completed` events can trigger the hosted validation handoff automatically. That same webhook path can also promote tracked proposal clients when the checkout carries `client_reference_id=client:<client-id>:paid|retainer_active`. `northline-validation-run` remains the CLI fallback.
- The default Northline dossier now reads `runtime/state/northlineValidationConfirmations.json` into a `validation-proof` readiness item, and controlled launch stays blocked until one real Stripe-backed `/validation.html` run records both the checkout completion and a successful hosted result.
- `northline-payment-check` resolves the business profile's Lead Generation, Pilot Launch, and Growth System Stripe payment paths from the stable `lead_generation`, `founding`, and `standard` keys, validates that they point at Stripe over HTTPS, and optionally probes them over HTTP before launch. It does not replace a real Stripe checkout, and it does not replace the explicit handoff paths that still apply outside the validation-page webhook flow.
- `northline-autonomy-run` now attempts to send approved Northline outreach drafts automatically through the configured outbound channel, recording each send attempt inside `runtime/state/outreach.json`.
- `northline-autonomy-run` now also syncs replies for contacted Northline leads through the configured inbox provider, stores them in `runtime/state/leadReplies.json`, and writes booked-call or intake-follow-up routing into the autonomy summary so reply handling no longer depends on manual message-file drops.
- For the default `auto-funding-agency` lane, the dossier's proof-cohort and operating-mode metrics now read the explicit `provenance` and `proofEligible` metadata on `runtime/state/clients.json`. Only `external_inbound` and `external_outbound` clients with `proofEligible=true` can advance the proof cohort. `legacy_unverified`, `internal_manual`, and `internal_validation` records stay excluded from proof until an operator reclassifies them, while the operator-facing billing and handoff queues in `runtime/ops/northline-growth-system/autonomy-summary.json` continue to exclude internal `/validation.html` artifacts.
- The engine's `auto-funding-agency` revenue and active-work metrics now use that same provenance boundary. Only `retainer_active` clients whose explicit or resolved provenance is `external_inbound` or `external_outbound` count toward Northline retained revenue, and only Northline `agency_client_acquisition` leads count toward the lane's acquisition work. Internal validation and rehearsal records stay in state for testing, but they no longer surface as customer revenue.
- Those Northline acquisition-work metrics now also respect the business's current Northline service scope, so narrowing the business profile from nationwide to a first metro stops stale out-of-area leads from inflating the active-work count.
- Once billing is confirmed, the autonomy runner builds the preview, runs QA, refreshes the proof bundle, writes a client handoff package under `runtime/reports/handoff-packages/<client-id>/`, and closes any stale legacy deploy approvals because the default Northline delivery endpoint is client-managed publication rather than repo-managed hosting.
- `build-agency-site` and `northline-site-serve` render the default proof page from the resolved `auto-funding-agency` business profile, so stored business overrides, including business-scoped payment links, flow into the hosted site.
- Operational approval refresh now closes stale direct-billing and branded-inbox tasks when the selected business already has live config. Missing SMTP remains a waiting hardening task until automated notices are required.
- The irreducible manual checkpoints remain explicit even after promotion: live payment authorization, disputed or ambiguous replies, public proof publication review, and host-specific publish troubleshooting.

## Gumroad Publish Flow

1. Stage the selected pack.
2. When generation is complete, mark it with `ready-asset-pack`.
3. Publish it on Gumroad.
4. Record the live URL with `publish-asset-pack`.
5. Run `engine-sync`.
6. Review `runtime/ops/engine-overview.json` again before moving to the next pack.
