# Autopilot Runner

This file exists for the recurring Codex automation that drives the store roadmap.

## Runner Contract

- Read [AGENTS.md](C:/AIWorkspace/Projects/Auto-Funding/AGENTS.md) first.
- Execute only the phase named by [state.json](C:/AIWorkspace/Projects/Auto-Funding/docs/autopilot/state.json).
- Follow [handoff-protocol.md](C:/AIWorkspace/Projects/Auto-Funding/docs/autopilot/handoff-protocol.md).
- Keep the Gumroad/Gmail browser session open when available.
- If Playwright cannot relaunch into the existing signed-in browser, recover the session with [chrome_cdp.py](C:/AIWorkspace/Projects/Auto-Funding/scripts/chrome_cdp.py) instead of creating a fresh login.
- Use the VPS for headless or durable tasks.
- Use the browser for Gumroad, Gmail, and free-tier signups.
- Do not spend money.
- At the end of each run, leave the repo, GitHub, and VPS in sync.

## Phase Advance Rule

When the current phase is finished:

1. Update `state.json`.
2. Update `log.md`.
3. Commit and push changes.
4. Pull the latest commit on `/opt/imon-engine`.
5. Let the recurring automation wake up again and continue with the next phase.
