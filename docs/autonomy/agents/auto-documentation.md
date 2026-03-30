# Auto-Documentation Protocol

Agents that change durable repo behavior must update documentation in the same change set. Do not leave docs as a follow-up task when the code, commands, runtime artifacts, or operating rules already changed.

## Documentation Is Required When

- A command in [src/index.ts](../../../src/index.ts) is added, removed, renamed, or changes behavior
- A config key, default, port, or environment variable changes in [src/config.ts](../../../src/config.ts) or [.env.example](../../../.env.example)
- A runtime artifact format, path, or meaning changes under [runtime/state](../../../runtime/state) or [runtime/ops](../../../runtime/ops)
- A server route, auth rule, UI behavior, or operator control changes in the control-room stack
- A business lane changes its planning, publishing, revenue, or launch workflow
- A VPS, browser-automation, deployment, or sync script changes behavior
- A risk, approval, verified-data, or money-movement rule changes
- A new durable subsystem, business lane, or document is introduced

## Update The Right Canonical Docs

- Engine and portfolio behavior: update [docs/imon-engine.md](../../imon-engine.md)
- Org model, task routing, ownership, permissions, or office snapshots: update [docs/org-control-plane.md](../../org-control-plane.md)
- Control-room routes, auth, local app, or hosted UI flows: update [docs/control-room-hosting.md](../../control-room-hosting.md)
- Gumroad, asset packs, growth publishing, sales imports, or revenue reporting: update [docs/gumroad-store.md](../../gumroad-store.md)
- Venture-studio rules or launch templates: update [docs/venture-studio.md](../../venture-studio.md)
- POD or Imonic flows: update [docs/imonic-store.md](../../imonic-store.md)
- Micro-SaaS planning flows: update [docs/micro-saas-factory.md](../../micro-saas-factory.md)
- Northline site, hosting, or launch operations: update [docs/northline-hosting.md](../../northline-hosting.md), [docs/northline-launch-checklist.md](../../northline-launch-checklist.md), or [docs/playbook.md](../../playbook.md) as appropriate
- Env vars, setup, ports, or first-run instructions: update [docs/setup.md](../../setup.md)
- VPS, remote desktop, browser reuse, or service scripts: update [docs/vps-tooling.md](../../vps-tooling.md)
- Top-level capabilities or quick-start expectations: update [README.md](../../../README.md)

## Create A New Doc Only When

- No existing canonical doc cleanly owns the behavior
- The change introduces a durable subsystem rather than a one-off task note
- The new file will be linked from this folder hub and from the nearest domain doc in the same change

Do not create parallel docs for the same subsystem just because the current doc needs editing.

## Required Follow-Through

1. Identify the subsystem and impacted runtime artifacts before editing.
2. Update the nearest canonical doc in the same patch as the code or config change.
3. Update cross-cutting docs when the change affects setup, CLI, or top-level behavior.
4. If a new doc is added, link it from [README.md](./README.md) in this folder and from the nearest domain doc.
5. If a generated artifact contract changed, regenerate or verify the generator path when practical.
6. In the final handoff, mention which docs were updated and note any docs you intentionally left unchanged.

## Writing Rules

- Describe the behavior that changed, not just that files changed.
- Name real commands, env vars, routes, file paths, and runtime outputs.
- Keep docs aligned with actual defaults from [src/config.ts](../../../src/config.ts).
- Prefer concise operational language over aspirational language.
- Do not document temporary experiments as stable workflow unless the repo now depends on them.

## Completion Checklist

- [ ] Canonical docs updated for the subsystem
- [ ] Cross-cutting docs updated when setup, commands, or top-level behavior changed
- [ ] New docs linked from the context hub when created
- [ ] Structured files validated if changed
- [ ] Final handoff lists doc impact
