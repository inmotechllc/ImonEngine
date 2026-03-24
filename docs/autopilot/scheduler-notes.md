# Scheduler Notes

## Required Environment Variables For Local VPS Sync

- `IMON_ENGINE_VPS_HOST`
- `IMON_ENGINE_VPS_USER`
- `IMON_ENGINE_VPS_PASSWORD`
- `IMON_ENGINE_VPS_REPO_PATH`
- `IMON_ENGINE_VPS_BRANCH`
- `runtime/state/assetPacks.json` is uploaded explicitly after each local run so live Gumroad publish state is mirrored to the VPS.

## Execution Model

- The local task is the primary scheduler because it can reuse the signed-in browser session when needed.
- The VPS cron job is optional and best for headless build and sync work.
- `scripts/publish_gumroad_product.py` should only run on the local scheduler because it depends on the signed-in Gumroad browser session.
- If the browser is closed, the final-phase Gmail delivery will block until the session is reopened.
