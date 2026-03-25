# Scheduler Notes

## Required Environment Variables For Local VPS Sync

- `IMON_ENGINE_VPS_HOST`
- `IMON_ENGINE_VPS_USER`
- `IMON_ENGINE_VPS_PASSWORD`
- `IMON_ENGINE_VPS_REPO_PATH`
- `IMON_ENGINE_VPS_BRANCH`
- `runtime/state/assetPacks.json`, `growthQueue.json`, `growthPolicies.json`, `allocationPolicies.json`, `allocationSnapshots.json`, `collectiveSnapshots.json`, `salesTransactions.json`, and `socialProfiles.json` are uploaded explicitly after each local run so store-ops state is mirrored to the VPS.

## Execution Model

- The local task is the primary scheduler when browser-only accounts still live there.
- The VPS cron job can now handle headless build/sync work and browser work once the server-side Chrome profile is signed in.
- `scripts/publish_gumroad_product.py` should only run on the local scheduler because it depends on the signed-in Gumroad browser session.
- `scripts/publish_growth_post.py` can run on the local scheduler or the VPS; Facebook prefers `META_PAGE_ACCESS_TOKEN`, while Pinterest still depends on the signed-in browser session.
- `runtime/state/growthQueue.json` should be uploaded from local and not regenerated on the VPS, so scheduled post ids stay aligned with the browser host.
- `scripts/build_growth_assets.py` is now refreshed from the local runner whenever new published packs are missing promo assets.
- `runtime/ops/growth-queue.md` is the operator-facing post queue for free distribution channels.
- `runtime/ops/social-profiles.md` is the current live-vs-blocked registry for channel accounts.
- `runtime/ops/revenue-report.md` becomes meaningful after Gumroad and Relay CSV imports are added.
- `runtime/ops/collective-fund-report.md` is the current view of what brands can transfer into the shared ImonEngine fund and how much shared tool spend is allowed.
- Catalog growth is intentionally capped so publishing volume does not outrun free traffic capacity.
- If the browser is closed, Gmail delivery, Pinterest, and any server-side marketplace automation will block until the session is reopened.
