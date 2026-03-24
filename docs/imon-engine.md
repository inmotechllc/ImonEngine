# ImonEngine

ImonEngine is the parent portfolio layer for this repo. It sits above the original agency workflow and manages a ranked set of AI businesses while watching VPS pressure, launch readiness, and consolidated revenue.

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

## Commands

- `npm run dev -- bootstrap`
- `npm run dev -- businesses`
- `npm run dev -- engine-sync`
- `npm run dev -- engine-report`
- `npm run dev -- activate-business --business <id>`
- `npm run dev -- pause-business --business <id>`
- `npm run dev -- vps-artifacts`
- `npm run dev -- seed-asset-packs`
- `npm run dev -- stage-asset-pack --pack <id>`
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

## VPS Flow

1. Copy the repo to the VPS at `/opt/imon-engine`.
2. Fill in `.env`.
3. Run `scripts/bootstrap-vps.sh`.
4. Run `scripts/install-cron.sh` to keep `engine-sync` scheduled.
5. Review `runtime/ops/engine-overview.json` and `runtime/state/approvals.json`.

## Gumroad Publish Flow

1. Stage the selected pack.
2. Publish it on Gumroad.
3. Record the live URL with `publish-asset-pack`.
4. Run `engine-sync`.
5. Review `runtime/ops/engine-overview.json` again before moving to the next pack.
