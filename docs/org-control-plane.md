# Organization Control Plane

ImonEngine now has a real organization layer that sits between the portfolio state and the task workers.

The rule is simple:

- the control plane is the source of truth
- the office views are derived from that source of truth
- positions are operating responsibilities, not fake employees

## Scopes

The org model is built around five scopes:

1. `engine`
2. `business`
3. `department`
4. `position`
5. `task`

The control-room explorer collapses those scopes into three navigation layers:

- `engine office`
- `business office`
- `department workspace`

Engine and business stay in the explorer. Departments open the execution workspace where task agents and sub-agents do the work.

## What It Stores

- organization blueprints
- department definitions
- position definitions
- reporting lines
- position assignments
- permission policies
- memory namespace policies
- approval routes
- workflow ownership records
- task envelopes
- office handoff records
- department execution records
- office chat threads and messages
- office chat actions and report artifacts
- office operating configs and business scaffold drafts
- org audit records
- office view snapshots

These are written into `runtime/state` and `runtime/ops` during `engine-sync`.

The file-backed store now serializes writes per state artifact, so concurrent department routing and audit updates do not drop task envelopes when multiple Northline workers persist work at the same time.

## Default Department Catalog

- Executive / Management
- Operations
- Marketing / Growth
- Product / Content
- Finance
- Analytics / Research
- Customer Support / QA

Category-specific variants are layered on top:

- POD / Shopify: `Merchandising`, `Storefront Ops`
- Faceless social: `Content Studio`, `Community / QA`
- Micro-SaaS: `Product Ops`
- Engine layer: `Technology / Systems`, `Risk / Compliance`

## Template Profiles

Business categories are normalized into reusable office templates:

- `catalog_store`: `digital_asset_store`, `print_on_demand_store`
- `audience_brand`: `niche_content_site`, `faceless_social_brand`
- `product_business`: `micro_saas_factory`
- `service_business`: `client_services_agency`

Each template defines:

- required departments
- approval and handoff sections
- worker labels for engine, brand, department, task, and sub-agent layers
- default department workspace widgets

## Workflow Ownership

Durable workflows now resolve to a real owner:

- department
- position
- allowed model tier
- allowed tools
- escalation target
- success metric

Examples:

- `store-autopilot` -> `Operations / Operations Manager`
- `digital-asset-factory` -> `Product / Content / Product / Content Lead`
- `product-production` -> `Product / Content / Product / Content Lead` for `client_services_agency` delivery lanes
- `pod-planning` -> `Merchandising / Merchandising Lead`
- `growth-publishing` -> `Marketing / Growth / Growth And Marketing Manager`
- `clipbaiters-collect` -> `Analytics / Research / Analytics And Research Lead`
- `clipbaiters-skim` -> `Analytics / Research / Analytics And Research Lead`
- `clipbaiters-radar` -> `Analytics / Research / Analytics And Research Lead`
- `clipbaiters-publish` -> `Marketing / Growth / Growth And Marketing Manager`
- `clipbaiters-youtube-channel-ops` -> `Marketing / Growth / Growth And Marketing Manager`
- `clipbaiters-source-creators` -> `Operations / Operations Manager`
- `clipbaiters-draft-creator-outreach` -> `Marketing / Growth / Growth And Marketing Manager`
- `clipbaiters-deals-report` -> `Finance / Finance Lead`
- `finance-allocation-reporting` -> `Finance / Finance Lead` or `Chief Financial Officer / Controller`

For service businesses, the Product / Content lane owns client deliverables, proof bundles, and approved offer or site-update assets rather than sitting as an unassigned placeholder department.

For Northline-compatible service businesses, the execution layer now consumes real runtime state instead of only template ownership. The service-business office pulls live work signals from:

- `runtime/ops/northline-growth-system/plan.json`
- `runtime/ops/northline-growth-system/autonomy-summary.json`
- `runtime/state/leads.json`
- `runtime/state/clients.json`
- `runtime/state/outreach.json`
- `runtime/state/proofBundles.json`
- `runtime/state/retention.json`
- `runtime/state/northlineValidationConfirmations.json`

That means the Northline business office can show governance, operations, growth, delivery, finance, analytics, and support lanes as department-owned execution work with live queue counts, proof artifacts, QA blockers, validation confirmations, and handoff coverage.

ClipBaiters now uses the same runtime-aware execution layer for its audience-brand office. The control plane pulls live work signals from:

- `runtime/ops/clipbaiters/<business-id>/plan.json`
- `runtime/state/clipbaiters/<business-id>/rights-review-approval.json`
- `runtime/state/clipbaiters/<business-id>/lane-posture-approval.json`
- `runtime/ops/clipbaiters/<business-id>/rights-review-approval.md`
- `runtime/ops/clipbaiters/<business-id>/lane-posture-approval.md`
- `runtime/ops/clipbaiters/<business-id>/roadblock-email.md`
- `runtime/ops/clipbaiters/<business-id>/roadblock-notification.json`
- `runtime/ops/clipbaiters/<business-id>/daily-brief.md`
- `runtime/ops/clipbaiters/<business-id>/daily-summary.md`
- `runtime/ops/clipbaiters/<business-id>/autonomy-run.json`
- `runtime/state/clipbaiters/<business-id>/source-watchlists.json`
- `runtime/state/clipbaiters/<business-id>/video-discovery.json`
- `runtime/state/clipbaiters/<business-id>/skim-summaries.json`
- `runtime/state/clipbaiters/<business-id>/publishing-queue.json`
- `runtime/state/clipbaiters/<business-id>/posting-schedule.json`
- `runtime/state/clipbaiters/<business-id>/publish-history.json`
- `runtime/ops/clipbaiters/<business-id>/review-queue.md`
- `runtime/state/clipbaiters/<business-id>/creator-leads.json`
- `runtime/state/clipbaiters/<business-id>/creator-outreach.json`
- `runtime/ops/clipbaiters/<business-id>/creator-deals.md`
- `runtime/state/clipbaiters/<business-id>/creator-orders.json`
- `runtime/state/clipbaiters/<business-id>/revenue-snapshots.json`

That lets the ClipBaiters business office show governance, collect, skim, radar, YouTube channel ops, draft automation, publishing, creator-deals, intake, and monetization lanes with current queue counts, next randomized posting windows, render backlog, roadblock notification state, channel-readiness state, publish history, review posture, finance-planning metadata, monetization artifacts, and a generated `launch-checklist.md` for the business.

For ClipBaiters, the business-level approval task now tracks the owner signoff on the rights and fair-use policy specifically. Once `rights-review-approval.json` exists and the planner no longer emits the `rights-and-review-policy` blocker, `org-sync` completes the business approval task while leaving unrelated operational launch blockers in the business office and launch checklist.

ClipBaiters also keeps a second business-scoped approval task for the current active-versus-gated lane posture. That task is satisfied by `lane-posture-approval.json` only while the saved rollout signature still matches the live lane registry, so later lane changes can reopen the blocker without corrupting the main business approval lifecycle.

## Approval And Data Rules

- low-risk internal work can auto-run inside a department
- medium-risk public or customer-facing work escalates to the business GM
- high-risk financial, compliance, or cross-business work escalates to ImonEngine
- only verified financial data can drive reinvestment, earnings, and collective-fund decisions
- inferred or manual-unverified data can be visible, but cannot drive spend or allocation policy

## Commands

- `npm run dev -- org-sync`
- `npm run dev -- org-report`
- `npm run dev -- org-report --business <id>`
- `npm run dev -- office-views`
- `npm run dev -- office-dashboard`
- `npm run dev -- control-room-build`
- `npm run dev -- control-room-serve`
- `npm run dev -- control-room-health`
- `npm run dev -- route-task --title "<title>" --summary "<summary>" --workflow <id> --business <id>`
- `npm run dev -- northline-department-smoke [--business <id>] [--skip-route-drills]`
- `npm run test:control-room-ui`

## Runtime Artifacts

- `runtime/ops/org-control-plane.json`
- `runtime/ops/org-control-plane.md`
- `runtime/ops/office-views.json`
- `runtime/ops/office-views.md`
- `runtime/ops/clipbaiters/<business-id>/launch-checklist.md`
- `runtime/ops/clipbaiters/<business-id>/rights-review-approval.md`
- `runtime/ops/clipbaiters/<business-id>/lane-posture-approval.md`
- `runtime/ops/clipbaiters/<business-id>/roadblock-email.md`
- `runtime/state/clipbaiters/<business-id>/rights-review-approval.json`
- `runtime/state/clipbaiters/<business-id>/lane-posture-approval.json`
- `runtime/state/clipbaiters/<business-id>/posting-schedule.json`
- `runtime/ops/northline-growth-system/department-smoke.json`
- `runtime/ops/northline-growth-system/department-smoke.md`
- `runtime/ops/control-room/index.html`
- `runtime/ops/control-room/data.json`
- `runtime/ops/org-blueprints/<blueprint-id>.json`
- `runtime/ops/org-blueprints/<blueprint-id>.md`

For alternate Northline-managed service businesses, the same smoke artifacts are written under `runtime/ops/northline-growth-system/<business-id>/`.

## Control Room

The first office UI pass now has two delivery modes:

- a static export at `runtime/ops/control-room/index.html`
- a private hosted app served from the VPS

Both modes are backed by the same shared control-room snapshot:

- latest engine report
- latest office snapshot
- office tree hierarchy
- office handoffs
- department workspaces
- department execution items
- office chat summaries
- approvals
- task envelopes
- audit records
- revenue allocation and collective-fund context when available

The hosted app adds:

- owner-only login
- JSON endpoints
- SSE-based live refresh
- `/engine`, `/business/:id`, and `/department/:businessId/:departmentId` routes
- freshness and stale-data reporting
- control-room approval actions for directly supported governance signoffs
- private VPS service hosting

It still does not invent or mutate its own business state. The only direct approval mutations currently supported are the explicit ClipBaiters governance approvals that already have durable file-backed artifacts and planner integration.

The department route is the final execution layer where blockers, artifacts, metrics, outputs, and recent activity are tracked.

For service-business lanes, those artifacts and metrics are no longer limited to approvals and generic task envelopes. Northline workspaces also reflect live intake, outbound, reply, delivery, proof, retention, and validation state so the business-level orchestrator sees what each department is actually handling.

`northline-department-smoke` is the live-safe office validation pass for that lane. It reads the current Northline business office, checks each department workspace and execution item, runs concurrent internal routing drills across governance, operations, growth, delivery, finance, analytics, and support, then restores `runtime/state/taskEnvelopes.json` and `runtime/state/orgAuditRecords.json` so the smoke run does not leave operator clutter behind. Use `--skip-route-drills` when you want the snapshot inspection and artifact report without the internal routing exercise.

UI validation for this surface is browser-based Playwright against `control-room-local` with `npm run test:control-room-ui`. Electron is intentionally out of scope for this phase.

See [control-room-hosting.md](C:/AIWorkspace/Projects/Auto-Funding/docs/control-room-hosting.md) for the hosted service and VPS setup.

## Current Migration Target

The live digital asset store and the Imonic POD lane are the first real businesses mapped into this operating model. Future business launches should reuse the same control-plane structure instead of inventing a separate agent hierarchy.
