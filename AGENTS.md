# Workspace Instructions

If `docs/autopilot/state.json` says the `imonengine-store-autopilot` program is `active`, every future Codex run in this workspace must:

1. Read [docs/autopilot/roadmap.md](docs/autopilot/roadmap.md).
2. Read [docs/autopilot/handoff-protocol.md](docs/autopilot/handoff-protocol.md).
3. Read [docs/autopilot/state.json](docs/autopilot/state.json).
4. Read the current phase file under [docs/autopilot/phases](docs/autopilot/phases).

Then:

- Execute only the current phase.
- Update the autopilot docs and any affected operational docs.
- Commit and push durable repo changes.
- Sync `/opt/imon-engine` on the VPS.
- Keep the dedicated signed-in browser session open when possible.
- If the Playwright browser wrapper cannot reattach but the signed-in automation browser is still open, use [scripts/chrome_cdp.py](scripts/chrome_cdp.py) against the active `mcp-chrome` session instead of restarting the browser.
- Use free tiers, the ImonEngine browser session, OpenAI API usage, and OpenClaw/VPS access when they reduce human intervention without spending money.
- Advance the phase state when the current phase is complete.
- Continue this loop until the final phase sends the completion email to `joshuabigaud@gmail.com`.

## Imon Engine Context Hub

All agents working in this repo should read these files before making durable changes outside a purely trivial task:

1. [docs/autonomy/agents/README.md](docs/autonomy/agents/README.md)
2. [docs/autonomy/agents/auto-documentation.md](docs/autonomy/agents/auto-documentation.md)

Use that folder as the repo-aware custom-agent profile for ImonEngine work. It maps the canonical docs, code surfaces, runtime artifacts, validation defaults, and documentation contract.

When a change affects commands, env vars, routes, runtime artifacts, or operational behavior:

- update the nearest canonical docs in the same change set
- create a new doc only when no existing canonical doc owns the new subsystem
- add new docs back into the context hub so future agents can discover them
