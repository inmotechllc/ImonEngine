# Scheduler Notes

## Required Environment Variables For VPS Posting

- `META_PAGE_ID`
- `META_PAGE_ACCESS_TOKEN`
- `APPROVAL_EMAIL`
- a signed-in VPS Chrome profile for Gmail, Gumroad, Pinterest, and any other browser-backed services

## Execution Model

- The VPS cron job is the primary scheduler.
- `scripts/run_vps_autopilot.sh` should pull the latest code when the worktree is clean, then execute one store-autopilot work unit on the server.
- `scripts/publish_gumroad_product.py` and `scripts/publish_growth_post.py` should run on the VPS whenever the matching server-side session exists.
- `growthQueue.json`, `socialProfiles.json`, and the finance snapshots are authoritative on the VPS and should not depend on a laptop-side mirror to keep moving.
- `runtime/ops/social-profiles.md` is the current registry of live vs blocked channel accounts, including umbrella Facebook assets and niche Instagram lanes.
- `runtime/ops/revenue-report.md` and `runtime/ops/collective-fund-report.md` are the current control surfaces for reinvestment review.
- If the VPS browser is closed, Gmail delivery, Pinterest, Gumroad publishing, and any browser-backed signup or posting flow will block until the session is reopened.
- When the runner hits a real roadblock, it should email `APPROVAL_EMAIL` through the signed-in ImonEngine Gmail session, with throttling so repeated blockers do not spam you.

## Local Fallback

- The Windows task is no longer the default scheduler.
- Keep `ImonEngineStoreAutopilot` disabled unless the VPS runner is down.
- The Codex desktop automation should remain paused so it does not race the VPS cron job.
