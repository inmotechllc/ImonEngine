# Operations Runbook

## Local Scheduler

- Install with `powershell -ExecutionPolicy Bypass -File scripts/install-windows-autopilot.ps1`.
- The scheduled task runs `scripts/run_local_autopilot.ps1` hourly.
- The local runner executes one work unit, publishes one ready Gumroad pack when the signed-in browser is available, commits tracked changes, pushes to GitHub, and syncs the VPS when `IMON_ENGINE_VPS_PASSWORD` is set.
- Browser-backed publishing is handled by `scripts/publish_gumroad_product.py`.
- The VPS sync step now uploads `runtime/state/assetPacks.json` so published Gumroad URLs are mirrored into `/opt/imon-engine` even though `runtime/` is not stored in git.

## VPS Scheduler

- Install with `sudo bash scripts/install-vps-autopilot.sh` inside `/opt/imon-engine`.
- The VPS runner is safe for headless phases and runtime sync work.
- Browser-dependent tasks should stay on the local runner because the signed-in Gumroad and Gmail session lives there.

## Runtime Rules

- `runtime/` is local operational state and remains git-ignored.
- Durable instructions belong in `docs/autopilot/` and tracked scripts belong in `scripts/`.
- The authoritative secrets stay on the VPS `.env`; local scheduler-only sync secrets should be injected through local environment variables instead of tracked files.
