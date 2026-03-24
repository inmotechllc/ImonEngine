# Workspace Instructions

If `docs/autopilot/state.json` says the `imonengine-store-autopilot` program is `active`, every future Codex run in this workspace must:

1. Read [docs/autopilot/roadmap.md](C:/AIWorkspace/Projects/Auto-Funding/docs/autopilot/roadmap.md).
2. Read [docs/autopilot/handoff-protocol.md](C:/AIWorkspace/Projects/Auto-Funding/docs/autopilot/handoff-protocol.md).
3. Read [docs/autopilot/state.json](C:/AIWorkspace/Projects/Auto-Funding/docs/autopilot/state.json).
4. Read the current phase file under [docs/autopilot/phases](C:/AIWorkspace/Projects/Auto-Funding/docs/autopilot/phases).

Then:

- Execute only the current phase.
- Update the autopilot docs and any affected operational docs.
- Commit and push durable repo changes.
- Sync `/opt/imon-engine` on the VPS.
- Keep the dedicated signed-in browser session open when possible.
- If the Playwright browser wrapper cannot reattach but the signed-in automation browser is still open, use [scripts/chrome_cdp.py](C:/AIWorkspace/Projects/Auto-Funding/scripts/chrome_cdp.py) against the active `mcp-chrome` session instead of restarting the browser.
- Use free tiers, the ImonEngine browser session, OpenAI API usage, and OpenClaw/VPS access when they reduce human intervention without spending money.
- Advance the phase state when the current phase is complete.
- Continue this loop until the final phase sends the completion email to `joshuabigaud@gmail.com`.
