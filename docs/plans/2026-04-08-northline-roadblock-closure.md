# Plan: Northline Roadblock Closure For Validation, Zoho Alias Inbox Sync, And Safe Autonomy Reruns

**Goal**

Close the current Northline blocked state with one coordinated plan that covers the three requested tracks together:

- the shortest safe unblock path for the default Northline lane
- the Northline alias inbox-sync trace and repair through the Zoho-backed IMAP plus SMTP path
- the hosted `/validation.html` proof-path trace and repair from checkout to dossier state

The immediate target is not full Northline autonomy. The immediate target is to remove the current launch blocker, repair reply ingestion, reconcile stale or drifting runtime artifacts, and leave the lane in an honest `controlled_launch` state with only the longer-horizon promotion criteria still missing.

**Subsystems touched**

- Northline hosted site and validation flow in `/root/ImonEngine/src/services/northline-site-server.ts`, `/root/ImonEngine/src/services/northline-validation.ts`, and `/root/ImonEngine/src/services/agency-site.ts`
- Northline autonomy, dossier generation, approvals, and readiness logic in `/root/ImonEngine/src/services/northline-autonomy.ts`, `/root/ImonEngine/src/services/northline-ops.ts`, and `/root/ImonEngine/src/services/organization-control-plane.ts`
- Northline CLI entrypoints in `/root/ImonEngine/src/index.ts`
- Northline mail-provider resolution in `/root/ImonEngine/src/config.ts`
- IMAP and SMTP helpers in `/root/ImonEngine/scripts/sync_northline_inbox_imap.py` plus the SMTP path inside `/root/ImonEngine/src/services/northline-autonomy.ts`
- Gmail CDP helpers in `/root/ImonEngine/scripts/sync_northline_inbox.py`, `/root/ImonEngine/scripts/send_gmail_message.py`, and `/root/ImonEngine/scripts/chrome_cdp.py` only as fallback or drift-diagnosis surfaces when the Northline lane resolves incorrectly to `gmail_cdp`
- Validation and workflow coverage in `/root/ImonEngine/src/workflows.test.ts`
- Northline runtime artifacts under `/root/ImonEngine/runtime/ops/northline-growth-system/` and `/root/ImonEngine/runtime/state/`
- Canonical operating docs in `/root/ImonEngine/docs/northline-hosting.md`, `/root/ImonEngine/docs/northline-launch-checklist.md`, `/root/ImonEngine/docs/playbook.md`, `/root/ImonEngine/docs/vps-tooling.md`, and `/root/ImonEngine/docs/setup.md`

**Prerequisites**

- Keep `docs/autopilot/state.json` unchanged. The current autopilot state is paused, and this plan is source-side planning only.
- Treat `auto-funding-agency` as the execution target unless a later handoff explicitly says otherwise.
- Before any live rerun that could touch outreach state, back up `/root/ImonEngine/runtime/state/outreach.json` and `/root/ImonEngine/runtime/state/approvals.json`.
- Treat Northline as a Zoho-backed alias business by default. The intended provider model is `INBOX_PROVIDER=imap` or `NORTHLINE_INBOX_PROVIDER=imap`, with outbound defaulting to `smtp` when IMAP resolves.
- Do not expand the Northline mail env surface as part of this plan. `/root/ImonEngine/.env.example` already carries the shared Zoho defaults and Northline-specific overrides needed for this lane, including `OUTBOUND_CHANNEL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `INBOX_PROVIDER`, `IMAP_HOST`, `IMAP_USER`, `IMAP_PORT`, `NORTHLINE_SMTP_FROM`, `NORTHLINE_INBOX_ALIAS_FILTER`, `NORTHLINE_ZOHO_APP_PASS`, and `NORTHLINE_IMAP_MAILBOX`.
- Keep those shared IMAP and SMTP values resolved on the execution host for the Northline alias. Treat any missing runtime values as host sync or secret drift, not as a missing `.env.example` contract.
- Keep the VPS Chrome profile available only if execution discovers that the live host is still resolving Northline to `gmail_cdp` unexpectedly. That should be treated as a config or drift issue, not the intended Northline operating model.
- Confirm the resolved Northline config on the execution host before changing code:
  - `NORTHLINE_SITE_URL`
  - `NORTHLINE_SALES_EMAIL`
  - `NORTHLINE_STRIPE_PAYMENT_LINK_VALIDATION`
  - `NORTHLINE_STRIPE_WEBHOOK_SECRET`
  - `INBOX_PROVIDER` or `NORTHLINE_INBOX_PROVIDER`
  - `OUTBOUND_CHANNEL` or `NORTHLINE_OUTBOUND_CHANNEL`
  - `IMAP_HOST` or `NORTHLINE_IMAP_HOST`
  - `IMAP_USER` or `NORTHLINE_IMAP_USER`
  - `NORTHLINE_ZOHO_APP_PASS` or `NORTHLINE_IMAP_PASS`
- Treat `/root/ImonEngine/runtime/ops/northline-growth-system/plan.{json,md}` and `/root/ImonEngine/runtime/ops/northline-growth-system/autonomy-summary.{json,md}` as authoritative only after a fresh rerun from the same code revision. The checked-in runtime artifacts currently show drift between the later plan and the older autonomy summary.
- Do not use `npm run dev -- northline-autonomy-run --business auto-funding-agency --notify-roadblocks` as a casual diagnostic until the live send queue is intentionally safe.

**Ordered steps**

1. **Establish a safe Northline baseline and reconcile artifact drift**
   - Outcome: one trusted picture of current Northline state, one safe rerun order, and one clear answer for whether the source repo or the live VPS holds the latest validation artifacts.
   - Files to inspect or change:
     - `/root/ImonEngine/runtime/ops/northline-growth-system/plan.json`
     - `/root/ImonEngine/runtime/ops/northline-growth-system/plan.md`
     - `/root/ImonEngine/runtime/ops/northline-growth-system/autonomy-summary.json`
     - `/root/ImonEngine/runtime/ops/northline-growth-system/autonomy-summary.md`
     - `/root/ImonEngine/runtime/ops/northline-growth-system/department-smoke.json`
     - `/root/ImonEngine/runtime/state/approvals.json`
     - `/root/ImonEngine/runtime/state/outreach.json`
     - `/root/ImonEngine/runtime/state/northlineAutonomy.json`
     - `/root/ImonEngine/runtime/state/northlineValidationConfirmations.json` if it exists on the execution host
     - `/root/ImonEngine/src/services/northline-ops.ts`
     - `/root/ImonEngine/src/services/northline-autonomy.ts`
   - Docs to update during execution if behavior or operator guidance changes:
     - `/root/ImonEngine/docs/playbook.md`
     - `/root/ImonEngine/docs/northline-hosting.md`
   - Required actions:
     - Confirm whether `/root/ImonEngine/runtime/state/northlineValidationConfirmations.json` is absent because no hosted validation run has written it yet, or because the current source workspace is behind the live VPS state.
     - Reconcile the mismatch where `/root/ImonEngine/runtime/state/approvals.json` shows the six `approval-outbound-send-*` records as completed, while `/root/ImonEngine/runtime/ops/northline-growth-system/autonomy-summary.{json,md}` still reports six drafts awaiting manual send.
    - Capture the exact rerun order that is safe for a live lane: profile and payment check first, targeted IMAP inbox-sync reproduction second, validation proof rerun third, full autonomy rerun last.
   - Validation:
     - `npm run dev -- northline-profile-show --business auto-funding-agency --probe-payments`
     - `npm run dev -- northline-plan --business auto-funding-agency`
     - `npm run dev -- approvals`

2. **Trace and repair the hosted validation proof path**
   - Outcome: one real `/validation.html` run can produce the exact proof state the Northline dossier expects, and the current launch blocker can clear without manual JSON repair.
   - Files to inspect or change:
     - `/root/ImonEngine/src/services/northline-site-server.ts`
     - `/root/ImonEngine/src/services/northline-validation.ts`
     - `/root/ImonEngine/src/services/agency-site.ts`
     - `/root/ImonEngine/src/services/northline-ops.ts`
     - `/root/ImonEngine/src/services/organization-control-plane.ts`
     - `/root/ImonEngine/src/index.ts`
     - `/root/ImonEngine/src/workflows.test.ts`
   - Docs to update during execution:
     - `/root/ImonEngine/docs/northline-hosting.md`
     - `/root/ImonEngine/docs/northline-launch-checklist.md`
     - `/root/ImonEngine/docs/playbook.md`
     - `/root/ImonEngine/docs/setup.md` if the env contract or fallback behavior changes
   - Required actions:
     - Inspect `/root/ImonEngine/src/services/northline-site-server.ts` around `handleSubmission(...)`, `handleValidationConfirmation(...)`, `handleValidationStatus(...)`, and `handleStripeWebhook(...)` to confirm the hosted intake is persisted before checkout and that the checkout carries `validation:<submission-id>`.
     - Inspect `/root/ImonEngine/src/services/northline-validation.ts` and `/root/ImonEngine/src/services/northline-ops.ts` to confirm the dossier only clears `validation-proof` when both `lastStripeCompletedAt` and `lastResult.status === "success"` are present on the same confirmation record.
     - Verify that the first hosted validation interaction creates or updates `/root/ImonEngine/runtime/state/northlineValidationConfirmations.json` safely even when the file does not exist yet.
     - Verify both proof paths:
       - webhook path through `/api/northline-stripe-webhook`
       - fallback confirmation path through `/api/northline-validation-confirm` or `npm run dev -- northline-validation-run --submission <id>`
     - Fix any out-of-order path where Stripe can complete before the repo has a stored submission and confirmation token to reconcile back to.
     - After the code and hosted path are stable, run one real hosted `/validation.html` check and then rerun the Northline dossier so `approval-auto-funding-agency` can close.
   - Validation:
     - `npm test`
     - `npm run build`
     - `npm run dev -- build-agency-site`
     - `npm run test:northline-site-ui`
     - `npm run dev -- northline-site-health`
     - `npm run dev -- northline-payment-check --business auto-funding-agency`
     - `npm run dev -- northline-validation-run --business auto-funding-agency --submission latest`
     - After one real hosted validation checkout: `npm run dev -- northline-autonomy-run --business auto-funding-agency --notify-roadblocks`

3. **Trace and repair the Northline Zoho alias inbox path**
   - Outcome: `northline-inbox-sync` and the inbox-sync portion of `northline-autonomy-run` follow the intended Zoho-backed IMAP plus SMTP path for Northline, and any current Gmail-facing failure is either removed or downgraded to a config-drift issue instead of a Northline business-model assumption.
   - Files to inspect or change:
     - `/root/ImonEngine/src/config.ts`
     - `/root/ImonEngine/scripts/sync_northline_inbox_imap.py`
     - `/root/ImonEngine/src/services/northline-autonomy.ts`
     - `/root/ImonEngine/src/index.ts`
     - `/root/ImonEngine/scripts/sync_northline_inbox.py`
     - `/root/ImonEngine/scripts/chrome_cdp.py`
     - `/root/ImonEngine/scripts/send_gmail_message.py`
   - Docs to update during execution:
     - `/root/ImonEngine/docs/vps-tooling.md`
     - `/root/ImonEngine/docs/playbook.md`
     - `/root/ImonEngine/docs/northline-hosting.md`
     - `/root/ImonEngine/docs/setup.md` only if provider-selection or fallback guidance changes; no new mail env keys are expected from this plan
   - Required actions:
     - First confirm provider resolution in `/root/ImonEngine/src/config.ts`. The source currently resolves Northline to `imap` only when `requestedNorthlineInboxProvider === "imap"` and IMAP host, user, and pass all resolve successfully. Otherwise it falls back to `gmail_cdp`.
      - Use `/root/ImonEngine/.env.example` as the env-contract baseline while debugging the host. The expected Northline mail keys already exist there, so execution should compare live resolved values against that baseline instead of proposing new IMAP or SMTP variables.
     - Reproduce the intended Northline path first:
       - `python3 /root/ImonEngine/scripts/sync_northline_inbox_imap.py --help`
       - `npm run dev -- northline-inbox-sync --business auto-funding-agency`
     - If the live host still routes Northline into Gmail-facing behavior, treat that as a drift investigation and then inspect:
       - `python3 /root/ImonEngine/scripts/chrome_cdp.py list-tabs`
       - `python3 /root/ImonEngine/scripts/sync_northline_inbox.py --help`
     - Determine which of these is true on the execution host:
       - IMAP is intended and configured, and the current runtime artifact is just stale
      - IMAP is intended but not resolving because the live host is missing one of the already-defined values such as `IMAP_HOST`, `IMAP_USER`, `NORTHLINE_ZOHO_APP_PASS`, `NORTHLINE_IMAP_PASS`, `NORTHLINE_SMTP_FROM`, or the per-business overrides
       - the host is unexpectedly still configured for Gmail CDP and must be brought back to the Zoho alias model
     - Keep the alias-aware IMAP path primary. The execution focus should be `sync_northline_inbox_imap.py`, the alias filter, and SMTP send readiness, not Gmail tab automation.
     - If a Gmail repair is still required on the live host, keep it tightly scoped and do not let that fallback work redefine the Northline business model in docs or plan artifacts.
   - Validation:
     - `python3 /root/ImonEngine/scripts/sync_northline_inbox_imap.py --help`
     - `npm run dev -- northline-inbox-sync --business auto-funding-agency`
     - `npm run dev -- northline-profile-show --business auto-funding-agency`
     - After the queue is confirmed safe: `npm run dev -- northline-autonomy-run --business auto-funding-agency`

4. **Make autonomy reruns safe and make manual-gate state truthful**
   - Outcome: after the validation and inbox fixes land, rerunning Northline does not accidentally send unintended drafts and does not leave the generated artifacts disagreeing about what is still blocked.
   - Files to inspect or change:
     - `/root/ImonEngine/src/services/northline-autonomy.ts`
     - `/root/ImonEngine/runtime/state/approvals.json`
     - `/root/ImonEngine/runtime/state/outreach.json`
     - `/root/ImonEngine/runtime/ops/northline-growth-system/autonomy-summary.json`
     - `/root/ImonEngine/runtime/ops/northline-growth-system/autonomy-summary.md`
     - `/root/ImonEngine/docs/playbook.md`
     - `/root/ImonEngine/docs/northline-launch-checklist.md`
   - Docs to update during execution:
     - `/root/ImonEngine/docs/playbook.md`
     - `/root/ImonEngine/docs/northline-launch-checklist.md`
   - Required actions:
     - Align the approval registry and the generated autonomy summary so a completed outbound-send approval is not still counted as `awaiting_manual_send` on the next dossier pass.
     - Decide how the lane should treat no-recipient drafts. If they remain non-sendable, the summary should describe them as data-quality or contactability issues rather than delivery failures.
     - Ensure an inbox-sync failure leaves one clear repair gate, not a growing pile of duplicate owner-decision tasks across reruns.
    - Update operator instructions so `northline-inbox-sync` is the first rerun target after IMAP or alias-path repair, and the full autonomy pass happens only after the send queue is deliberately safe.
   - Validation:
     - `npm run dev -- approvals`
     - After sender safety is confirmed: `npm run dev -- northline-autonomy-run --business auto-funding-agency --notify-roadblocks`
     - Inspect:
       - `/root/ImonEngine/runtime/ops/northline-growth-system/plan.md`
       - `/root/ImonEngine/runtime/ops/northline-growth-system/autonomy-summary.md`
       - `/root/ImonEngine/runtime/state/approvals.json`

5. **Run the shortest-path unblock sequence and confirm the remaining blockers are the right ones**
   - Outcome: Northline stays in `controlled_launch`, but the explicit `validation-proof` blocker and the broken inbox-sync blocker are removed, leaving only the longer-horizon promotion criteria still missing.
   - Files to inspect or change:
     - `/root/ImonEngine/runtime/ops/northline-growth-system/plan.json`
     - `/root/ImonEngine/runtime/ops/northline-growth-system/plan.md`
     - `/root/ImonEngine/runtime/ops/northline-growth-system/autonomy-summary.json`
     - `/root/ImonEngine/runtime/ops/northline-growth-system/autonomy-summary.md`
     - `/root/ImonEngine/runtime/state/approvals.json`
     - `/root/ImonEngine/runtime/state/northlineAutonomy.json`
   - Docs to update during execution:
     - `/root/ImonEngine/docs/northline-hosting.md`
     - `/root/ImonEngine/docs/northline-launch-checklist.md`
     - `/root/ImonEngine/docs/playbook.md`
     - `/root/ImonEngine/docs/vps-tooling.md`
     - `/root/ImonEngine/docs/setup.md` if any runtime contract or env expectations changed during steps 2 through 4
   - Success criteria:
     - `approval-auto-funding-agency` is closed or no longer points at `validation-proof`
     - `approval-northline-inbox-sync-auto-funding-agency` is closed
     - the regenerated Northline plan no longer reports `Current validation confirmations: 0` if the real hosted validation check completed successfully
     - the regenerated Northline plan still shows the longer-horizon promotion criteria honestly, including:
       - paid explicitly external clients delivered end to end
       - one working send-and-reply loop for at least seven days
       - published proof mix
   - Validation:
     - `npm test`
     - `npm run build`
     - `npm run dev -- northline-plan --business auto-funding-agency`
     - `npm run dev -- northline-autonomy-run --business auto-funding-agency --notify-roadblocks`
     - `npm run dev -- approvals`

**Validation**

- Default source validation after each code-changing step:
  - `npm test`
  - `npm run build`
- Validation-path checks:
  - `npm run dev -- build-agency-site`
  - `npm run test:northline-site-ui`
  - `npm run dev -- northline-site-health`
  - `npm run dev -- northline-payment-check --business auto-funding-agency`
  - `npm run dev -- northline-validation-run --business auto-funding-agency --submission latest`
- Northline mail-path checks:
  - `python3 /root/ImonEngine/scripts/sync_northline_inbox_imap.py --help`
  - `npm run dev -- northline-inbox-sync --business auto-funding-agency`
  - `npm run dev -- northline-profile-show --business auto-funding-agency`
- Gmail fallback checks only if the execution host unexpectedly resolves Northline to `gmail_cdp`:
  - `python3 /root/ImonEngine/scripts/chrome_cdp.py list-tabs`
  - `python3 /root/ImonEngine/scripts/send_gmail_message.py --help`
  - `python3 /root/ImonEngine/scripts/sync_northline_inbox.py --help`
- Final Northline rerun checks after queue safety is confirmed:
  - `npm run dev -- northline-plan --business auto-funding-agency`
  - `npm run dev -- northline-autonomy-run --business auto-funding-agency --notify-roadblocks`
  - `npm run dev -- approvals`

**Risks and notes**

- The source workspace currently does not contain `/root/ImonEngine/runtime/state/northlineValidationConfirmations.json`. The executor must confirm whether the live VPS has newer state before concluding that hosted validation is broken.
- The later Northline plan and the older autonomy summary disagree about whether the validation payment link is configured. Treat the first post-fix rerun from one code revision as the source of truth.
- Any autonomy rerun can mutate live outreach state. Do not use `northline-autonomy-run` as a low-risk debug primitive until the send queue is intentionally safe.
- The intended Northline model is Zoho-backed IMAP plus SMTP, not Gmail. If the execution host still resolves Northline to `gmail_cdp`, that is a configuration or state-drift issue to correct first.
- The source config currently falls back to `gmail_cdp` whenever `requestedNorthlineInboxProvider === "imap"` is set but IMAP host, user, and pass do not all resolve. That fallback makes drift easy to miss, so the executor should verify provider resolution explicitly before debugging the wrong path.
- No new Northline IMAP or SMTP env keys should be introduced during this plan. `/root/ImonEngine/.env.example` already contains the expected shared Zoho defaults and Northline-specific mail overrides, so missing live values should be treated as deployment drift or secret mismatch.
- If a Gmail fallback repair is required on the live host, keep it narrow. It should not regress the IMAP alias path or leave the docs implying that Gmail is the normal Northline business model.
- Do not expand this pass into the broader 5-criterion autonomy promotion work. Those longer-horizon proof and cohort tasks should remain visible but out of scope for this unblock plan.

**Handoff instructions for `@imon-engine`**

- Do not execute this plan automatically.
- Execute the steps in order.
- Start in `/root/ImonEngine` and validate source changes there first.
- If source validation passes and the live queue is safe, mirror the validated change set to `/opt/imon-engine`, then rerun the host-level checks there.
- Keep code changes, runtime-artifact meaning changes, and canonical doc updates in the same change set.
- After step 2 and again after step 3, stop and report the exact state of:
  - `/root/ImonEngine/runtime/ops/northline-growth-system/plan.md`
  - `/root/ImonEngine/runtime/ops/northline-growth-system/autonomy-summary.md`
  - `/root/ImonEngine/runtime/state/approvals.json`
- If the live VPS state differs from the source repo, record which host is authoritative before continuing.
- Treat real card entry and any real outbound send as explicit operator-approved actions, not background automation.
- Treat Northline as a Zoho-alias business during execution. If the host resolves to Gmail, record that as a drift condition and fix the provider selection before treating Gmail automation as the main workstream.