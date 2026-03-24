# Autopilot Handoff Protocol

Every phase agent must follow this protocol.

## Before Doing Work

1. Read [roadmap.md](C:/AIWorkspace/Projects/Auto-Funding/docs/autopilot/roadmap.md).
2. Read [state.json](C:/AIWorkspace/Projects/Auto-Funding/docs/autopilot/state.json).
3. Read the matching phase file under [phases](C:/AIWorkspace/Projects/Auto-Funding/docs/autopilot/phases).
4. Review [docs/gumroad-store.md](C:/AIWorkspace/Projects/Auto-Funding/docs/gumroad-store.md) and current repo status.

## Execution Rules

- Run without asking for human input unless blocked by a hard external constraint.
- Keep the dedicated browser session open for continuous Gumroad and Gmail access.
- Use any relevant skills, integrations, freeware, free tiers, OpenAI API usage, or VPS tooling that does not require spending money.
- Prefer repeatable scripts and tracked docs over one-off local-only actions.
- Use the ImonEngine Gmail account and signed-in browser session when a signup or email step is needed.
- Reserve `ImonEngine` and `Imon` for parent-system accounts only unless a legacy store already depends on them.
- Give every new business a distinct, relevant brand name and use `imonengine+<brandhandle>@gmail.com` for signup aliases.
- For X signup, prefer visual input and simulated clicks for the normal flow, then pause for a manual owner solve if Arkose or a similar human challenge appears.
- If OpenClaw on the VPS can reduce human effort safely, use it and document how.

## Required Outputs For Every Phase

- Update [state.json](C:/AIWorkspace/Projects/Auto-Funding/docs/autopilot/state.json).
- Append a short entry to [log.md](C:/AIWorkspace/Projects/Auto-Funding/docs/autopilot/log.md).
- Update any affected operational docs.
- Commit all durable repo changes.
- Push to GitHub.
- Pull the latest commit on the VPS and sync any required runtime state there.

## Scheduling Rule

At the end of the current phase:

1. Mark the current phase `completed` in `state.json`.
2. Mark the next phase `in_progress` in `state.json`.
3. Create or update the next automation run so it executes the next phase without asking the user.
4. The next automation prompt must tell the next agent to repeat this protocol until all phases are complete.

## Blocker Rule

If blocked by a hard constraint:

- Do the maximum safe work around the blocker.
- Record the blocker in `log.md` and `state.json`.
- If the blocker requires human help and cannot wait until the final phase, send a short status email to `joshuabigaud@gmail.com`.
- Otherwise continue with adjacent work inside the same phase.
