# Scheduler Notes

## Required Environment Variables For Local VPS Sync

- `IMON_ENGINE_VPS_HOST`
- `IMON_ENGINE_VPS_USER`
- `IMON_ENGINE_VPS_PASSWORD`
- `IMON_ENGINE_VPS_REPO_PATH`
- `IMON_ENGINE_VPS_BRANCH`

## Execution Model

- The local task is the primary scheduler because it can reuse the signed-in browser session when needed.
- The VPS cron job is optional and best for headless build and sync work.
- If the browser is closed, the final-phase Gmail delivery will block until the session is reopened.
