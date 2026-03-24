# Operations Runbook

## Local Scheduler

- Install with `powershell -ExecutionPolicy Bypass -File scripts/install-windows-autopilot.ps1`.
- The scheduled task runs `scripts/run_local_autopilot.ps1` hourly.
- The local runner executes one work unit, publishes one ready Gumroad pack when the signed-in browser is available, commits tracked changes, pushes to GitHub, and syncs the VPS when `IMON_ENGINE_VPS_PASSWORD` is set.
- Catalog expansion is now paced by config instead of running unbounded:
  - `STORE_MAX_NEW_PACKS_7D`
  - `STORE_MAX_PUBLISHED_PACKS`
  - `STORE_MAX_ASSET_TYPE_SHARE`
  - `STORE_MAX_OPEN_PACK_QUEUE`
- Browser-backed publishing is handled by `scripts/publish_gumroad_product.py`.
- Gumroad uploads are only considered complete after the content row shows `Download` and the transient `Cancel` action disappears.
- Gumroad product media is only considered complete after at least one cover image exists and the square thumbnail no longer shows the `Upload` placeholder.
- If a listing ever publishes without a square thumbnail, repair it with `npm run dev -- repair-asset-pack-media --pack <id>`.
- If a listing ever publishes without a file, repair it with `npm run dev -- repair-asset-pack-content --pack <id>`.
- The VPS sync step now uploads `runtime/state/assetPacks.json` so published Gumroad URLs are mirrored into `/opt/imon-engine` even though `runtime/` is not stored in git.
- Growth operations now have their own runtime outputs:
  - `runtime/ops/growth-queue.json`
  - `runtime/ops/growth-queue.md`
  - `runtime/marketing/manifest.json`
- Revenue tracking now has its own runtime outputs:
  - `runtime/ops/revenue-report.json`
  - `runtime/ops/revenue-report.md`
- Manual refresh commands:
  - `npm run dev -- growth-queue`
  - `npm run dev -- import-gumroad-sales --file <csv>`
  - `npm run dev -- import-relay-transactions --file <csv> [--business imon-digital-asset-store]`
  - `npm run dev -- revenue-report [--business imon-digital-asset-store] [--days 30]`

## VPS Scheduler

- Install with `sudo bash scripts/install-vps-autopilot.sh` inside `/opt/imon-engine`.
- The VPS runner is safe for headless phases and runtime sync work.
- Browser-dependent tasks should stay on the local runner because the signed-in Gumroad and Gmail session lives there.

## Runtime Rules

- `runtime/` is local operational state and remains git-ignored.
- Durable instructions belong in `docs/autopilot/` and tracked scripts belong in `scripts/`.
- The authoritative secrets stay on the VPS `.env`; local scheduler-only sync secrets should be injected through local environment variables instead of tracked files.
- Growth assets are regenerated automatically when the live published catalog changes, so the queue should not point at dead teaser files.
