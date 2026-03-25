# Operations Runbook

## VPS Scheduler

- Install with `sudo bash scripts/install-vps-autopilot.sh` inside `/opt/imon-engine`.
- `scripts/run_vps_autopilot.sh` is the primary hourly runner.
- The VPS runner should own publishing, growth posting, roadblock emails, and runtime-state updates.
- The VPS runner can safely use Gmail, Gumroad, Pinterest, and other browser-backed flows once the server-side Chrome profile is signed in.
- `scripts/publish_growth_post.py` prefers the Meta Graph API for Facebook when `META_PAGE_ACCESS_TOKEN` is present, and falls back to the signed-in browser only when no token is configured.
- `scripts/publish_gumroad_product.py` and `scripts/publish_growth_post.py` should run on the VPS whenever the matching server-side session exists.
- `growthQueue.json`, `socialProfiles.json`, and the revenue snapshots are authored on the VPS and treated as the primary runtime state.

## Brand And Channel Rules

- Reserve `ImonEngine` and `Imon` for the parent system or the legacy first store only.
- Every future business should get a distinct umbrella brand name and `imonengine+<brandhandle>@gmail.com` alias.
- Use Facebook sparingly and strategically:
  - umbrella brands for scalable businesses
  - the parent ImonEngine system if it becomes public
  - physical-item or Shopify/POD lanes that can share one paid-growth surface
- When a business can support multiple niches, keep one umbrella Facebook Page and create separate niche Instagram accounts under it.
- Niche Instagram accounts should use plus-tag aliases such as `imonengine+canvascurrentabstractart@gmail.com`.
- Keep each Instagram cluster to ten accounts or fewer per device or browser profile before rotating into a fresh environment.
- X signup should prefer visual input and simulated clicks, then pause for manual owner completion only when an anti-bot or identity challenge appears.

## Catalog And Growth Rules

- Catalog expansion is capped so the store cannot outrun its growth queue and channel bandwidth.
- Browser-backed publishing is handled by `scripts/publish_gumroad_product.py`.
- Gumroad uploads are only considered complete after the content row shows `Download` and the transient `Cancel` action disappears.
- Gumroad product media is only considered complete after at least one cover image exists and the square thumbnail no longer shows the `Upload` placeholder.
- If a listing publishes without a square thumbnail, repair it with `npm run dev -- repair-asset-pack-media --pack <id>`.
- If a listing publishes without a file, repair it with `npm run dev -- repair-asset-pack-content --pack <id>`.
- Growth outputs live in:
  - `runtime/ops/growth-queue.json`
  - `runtime/ops/growth-queue.md`
  - `runtime/marketing/manifest.json`
  - `runtime/ops/social-profiles.json`
  - `runtime/ops/social-profiles.md`

## Finance Rules

- Brand revenue flows into a brand growth reinvestment bucket and a collective ImonEngine transfer bucket.
- Shared ImonEngine tool spend should never exceed the same reinvestment rate used for brand growth.
- Revenue and collective reports live in:
  - `runtime/ops/revenue-report.json`
  - `runtime/ops/revenue-report.md`
  - `runtime/ops/collective-fund-report.json`
  - `runtime/ops/collective-fund-report.md`

## Local Fallback

- `scripts/run_local_autopilot.ps1` is now a manual fallback, not the primary scheduler.
- The Windows scheduled task should stay disabled unless the VPS runner is unavailable.
- If you temporarily re-enable the Windows task, disable it again after the VPS path is healthy.

## Runtime Rules

- `runtime/` is operational state and remains git-ignored.
- Durable instructions belong in `docs/autopilot/` and tracked scripts belong in `scripts/`.
- The authoritative secrets and browser cookies live on the VPS in `/opt/imon-engine/.env` and `/opt/imon-engine/.chrome-profile`.
- Growth assets are regenerated automatically when the live published catalog changes, so the queue should not point at dead teaser files.
