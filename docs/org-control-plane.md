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
- org audit records
- office view snapshots

These are written into `runtime/state` and `runtime/ops` during `engine-sync`.

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
- `pod-planning` -> `Merchandising / Merchandising Lead`
- `growth-publishing` -> `Marketing / Growth / Growth And Marketing Manager`
- `finance-allocation-reporting` -> `Finance / Finance Lead` or `Chief Financial Officer / Controller`

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

## Runtime Artifacts

- `runtime/ops/org-control-plane.json`
- `runtime/ops/org-control-plane.md`
- `runtime/ops/office-views.json`
- `runtime/ops/office-views.md`
- `runtime/ops/control-room/index.html`
- `runtime/ops/control-room/data.json`
- `runtime/ops/org-blueprints/<blueprint-id>.json`
- `runtime/ops/org-blueprints/<blueprint-id>.md`

## Control Room

The first office UI pass now has two delivery modes:

- a static export at `runtime/ops/control-room/index.html`
- a private hosted app served from the VPS

Both modes are backed by the same shared control-room snapshot:

- latest engine report
- latest office snapshot
- approvals
- task envelopes
- audit records
- revenue allocation and collective-fund context when available

The hosted app adds:

- owner-only login
- JSON endpoints
- SSE-based live refresh
- freshness and stale-data reporting
- private VPS service hosting

It still does not invent or mutate its own business state.

See [control-room-hosting.md](C:/AIWorkspace/Projects/Auto-Funding/docs/control-room-hosting.md) for the hosted service and VPS setup.

## Current Migration Target

The live digital asset store and the Imonic POD lane are the first real businesses mapped into this operating model. Future business launches should reuse the same control-plane structure instead of inventing a separate agent hierarchy.
