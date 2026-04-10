### Plan: Northline Growth Systems Daily Autonomy

**Goal**: Turn Northline into a scheduled, file-backed operating lane that can refresh its own plan, keep outreach drafting moving, ingest hosted intake, advance paid clients through build and QA, generate retention work on cadence, and notify the owner only at explicit approval gates.

**Subsystems touched**: northline, engine, setup-vps

**Prerequisites**:
- Run `npm run bootstrap` once on the target environment so `runtime/state` and `runtime/ops` exist; this workspace currently has no generated `runtime/` tree.
- Keep `OPENAI_API_KEY`, `APPROVAL_EMAIL`, and the current `NORTHLINE_*` values accurate on the VPS. SMTP is optional for launch, but required if Northline should notify without someone reading files under `runtime/notifications/`.
- Seed a real prospect backlog with `npm run dev -- prospect --input <file>` if outbound drafting should continue without waiting for inbound-only leads.
- Decide the manual gates up front: recommended minimum manual gates are outbound send approval, production deploy approval, cashouts/payouts, and any public proof/testimonial publication.
- Move any live billing secrets out of `.env.example` and rotate them before wider automation. The example config appears to contain live billing credentials that are not consumed by `src/config.ts` today.

**Steps**:

| # | Task | Files to change | Docs to update | Depends on |
|---|------|----------------|----------------|------------|
| 1 | Add a Northline autonomy runner and durable run state | `src/index.ts`, `src/services/northline-autonomy.ts`, `src/domain/northline-autonomy.ts`, `src/workflows.test.ts` | `README.md`, `docs/imon-engine.md`, `docs/playbook.md` | — |
| 2 | Bridge hosted intake and queued outbound into tracked work items | `src/services/northline-autonomy.ts`, `src/agents/orchestrator.ts`, `src/agents/outreach-writer.ts`, `src/workflows.test.ts` | `docs/northline-hosting.md`, `docs/playbook.md` | Step 1 |
| 3 | Add paid-client activation and safe handoff into delivery | `src/index.ts`, `src/services/northline-autonomy.ts`, `src/workflows.test.ts` | `README.md`, `docs/setup.md`, `docs/playbook.md` | Step 1 |
| 4 | Automate build, QA, deploy gating, and monthly retention for Northline clients | `src/services/northline-autonomy.ts`, `src/agents/site-builder.ts`, `src/agents/qa-reviewer.ts`, `src/agents/deployer.ts`, `src/services/reports.ts`, `src/workflows.test.ts` | `docs/playbook.md`, `docs/northline-hosting.md`, `docs/northline-launch-checklist.md` | Steps 2-3 |
| 5 | Put the Northline runner on the VPS schedule and refresh artifacts on each pass | `src/index.ts`, `scripts/imon-engine-sync.sh`, `scripts/install-cron.sh`, `scripts/run_vps_autopilot.sh` | `docs/setup.md`, `docs/vps-tooling.md`, `docs/imon-engine.md` | Steps 1-4 |
| 6 | Emit daily summary and roadblock notifications with explicit manual gates | `src/services/northline-autonomy.ts`, `src/agents/account-ops.ts`, `src/workflows.test.ts` | `docs/playbook.md`, `docs/northline-hosting.md`, `README.md` | Steps 1-5 |

**Validation**:
- Run `npm test`.
- Run `npm run build`.
- Run `npm run dev -- bootstrap` in a clean workspace, then `npm run dev -- northline-plan` and the new `npm run dev -- northline-autonomy-run`.
- Confirm the runner writes deterministic artifacts under `runtime/ops/northline-growth-system/` and updates `runtime/state` without duplicating intakes, drafts, or client actions across repeated runs.
- Confirm `npm run dev -- approvals` shows new gate tasks only for manual checkpoints: outbound sends, production deploys, stalled QA, and explicit owner decisions.
- On the VPS, confirm the scheduled job runs the Northline runner in addition to `engine-sync`, and that `northline-site-health` still reports a healthy hosted intake service.

**Risks & notes**:
- The repo can draft outreach today, but it cannot actually send outbound or parse mailbox replies on its own. The first autonomy pass should stop at draft generation plus approval notification unless a sender/inbox integration is added later.
- Northline uses Stripe payment links, but the codebase does not currently ingest Stripe payment events. The fast path is to add an explicit billing-status handoff so paid clients can enter delivery safely; full payment autonomy is a later integration.
- The current workspace has no generated `runtime/` artifacts, so actual Northline readiness cannot be judged from live state here yet.
- Keep production deployment behind an approval task until the first few Northline deliveries prove the build and QA path is stable.
- Reuse the existing file-backed state, approvals, reports, and Northline artifact paths instead of introducing a new queue or database layer.
