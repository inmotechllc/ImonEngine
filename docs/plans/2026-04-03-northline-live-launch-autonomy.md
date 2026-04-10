### Plan: Northline Live Launch And Autonomy Wiring

Historical note: this plan predates the lead-generation-first proof repositioning. Keep it as rollout history, but treat the external proof cohort language in the newer 2026-04-04 Northline plan as canonical for future work.

**Direct answers**:

1. The page for the live validation purchase is https://northlinegrowthsystems.com/validation.html.
2. The live validation workflow can be mostly automated, but the real card payment itself should stay manual. The page, checkout link, webhook ingestion, persisted status sync, billing handoff, preview build, QA, and proof capture can all be wired around that manual payment step.
3. Outbound sending can be automated. The repo already has the draft queue, approval tasks, a Gmail CDP sender, and a reply-classification path; the missing work is sender orchestration, inbox sync, and durable reply ingestion.
4. Proposal billing handoff is now wired through automated client handoff packaging. Validation-page billing and tracked proposal or client Stripe payments are webhook-capable, and once QA plus proof artifacts pass, the default lane now emits a client-readable handoff package instead of treating repo-managed hosting as the completion gate. Legacy deploy approvals and auto-deploy toggles remain optional manual tooling only.
5. Proof wiring should be finished before broad traffic, but it does not require waiting for a full ads launch. The controlled launch can start now with the live site, a real validation checkout, a small outbound or referral cohort, and proof capture after the first delivered wins.
6. Proof comes from a controlled launch, not from waiting for scale. The first three explicitly external clients should create the before/after screenshots, testimonial snippets, review asks, and retention artifacts that later make the broader lane credible.

**Goal**: Move Northline from a live but manual-assisted proof site into a controlled-launch business lane that can handle intake, outbound send, reply ingestion, billing transitions, build, QA, proof capture, client handoff packaging, and reporting with minimal human intervention, while keeping only irreducible money-movement and exception checkpoints manual until the first proof cohort succeeds.

**Execution status**:
- Phase 1 is complete. The live validation checkout succeeded, the hosted proof artifacts were verified, and the live readiness recalculation was rerun against the VPS state.
- Phase 2 code and docs are deployed to `/opt/imon-engine`. Local and deployed validation passed with `npm test`, `npm run build`, `python3 scripts/send_gmail_message.py --help`, and `python3 scripts/chrome_cdp.py list-tabs` on 2026-04-03.
- The safer Phase 2 rollout was executed on 2026-04-03. Before the live pass, 33 approved no-recipient drafts were removed from the active send cohort, their stale outbound approvals were completed, and the original state files were backed up under `runtime/ops/deploy-backups/northline-phase2-canary-*`.
- A single internal canary draft was then sent successfully through the VPS Gmail CDP path to `imonengine+northline-phase2@gmail.com`. The canary lead moved to `contacted`, the draft recorded a `gmail_cdp` send receipt, and the deployed queue no longer has any open outbound-send approvals.
- The first real external cohort is now curated as `Northline Batch A1` in `runtime/ops/northline-growth-system/first-real-batch-2026-04-03.{json,md}`. The selected leads are `nyc-steam-cleaning`, `baschnagel-bros-inc`, and `proline-roofing`.
- `Northline Batch A1` was sent on 2026-04-03 through the VPS Gmail CDP path and recorded in `runtime/ops/northline-growth-system/first-real-batch-send-2026-04-03.{json,md}`. The sent recipients were `info@nycsteamcleaning.com`, `sales@baschnagel.com`, and `info@proline-roofing.com`.
- The Batch A1 leads now have draft records plus `gmail_cdp` send receipts in `runtime/state/outreach.json`, and each lead moved from `stage: prospecting` to `stage: contacted`. The cohort remains mixed-trade because the clean unsent pool did not contain three verified-email prospects inside a single trade.
- Batch A1 reply monitoring and follow-up timing is recorded in `runtime/ops/northline-growth-system/batch-a1-reply-monitoring-2026-04-03.{json,md}` with check windows on 2026-04-04, 2026-04-05, and 2026-04-07 plus first and second follow-up not-before timestamps.
- Phase 3 code and docs are now deployed to `/opt/imon-engine`. Local and deployed validation passed with `npm test`, `npm run build`, `python3 scripts/sync_northline_inbox.py --help`, and `npm run dev -- northline-inbox-sync --business auto-funding-agency` on 2026-04-03. The live inbox sync completed successfully and found no new replies.
- Phase 4 code and docs are now deployed to `/opt/imon-engine`. Local and deployed validation passed with `npm test`, `npm run build`, `npm run dev -- build-agency-site`, and `npm run test:northline-site-ui` on 2026-04-03. A live `npm run dev -- northline-autonomy-run --business auto-funding-agency` smoke also stayed safely blocked with `1 billing handoff, 2 deploy-ready clients`; both Northline deploy approvals remained `open`, and no auto-deploy was triggered because the live VPS environment does not enable `NORTHLINE_AUTO_DEPLOY_*`.
- Phase 5 code and docs are now deployed to `/opt/imon-engine`. Local and deployed validation passed with `npm test`, `npm run build`, `npm run dev -- build-agency-site`, and `npm run test:northline-site-ui` on 2026-04-03 after increasing the Playwright screenshot timeout for the live VPS font-loading path. A live `npm run dev -- northline-autonomy-run --business auto-funding-agency` smoke stayed safely blocked with `1 billing handoff, 2 deploy-ready clients, 2 proof bundle refreshes`; the live repo still has no `NORTHLINE_AUTO_DEPLOY_*` entries in `.env`, so the deploy approvals remained manual.
- Phase 6 code and docs are now deployed to `/opt/imon-engine`. Local and deployed validation passed with `npm test`, `npm run build`, `npm run dev -- build-agency-site`, and `npm run dev -- northline-autonomy-run --business auto-funding-agency --notify-roadblocks` on 2026-04-03. The refreshed dossier and autonomy summary now surface `operatingMode`, promotion criteria, scheduled automation, and manual checkpoints; the live lane remains in `controlled_launch` with `1/5` promotion criteria met. A follow-on live classification fix now counts legacy Northline pilot records in the default lane's proof metrics while excluding internal `/validation.html` artifacts from the operator-facing billing and deploy queues, so the deployed autonomy refresh now reports `1 deploy-ready client` and `1 proof bundle refresh` with no billing-handoff queue item. On 2026-04-04, the Sunrise follow-up also fixed a stale host-specific preview path that had left the client with an empty screenshot bundle on Linux; proof refresh and deploy now resolve the current `runtime/previews/<client-id>/` directory automatically, and Sunrise can refresh proof on the VPS without hand-editing state. Before the live rerun, the stale approved Summit Ridge outreach draft was defused so the proof refresh could execute without sending an unrelated converted lead. A second live autonomy refresh then recorded the hosted Sunrise screenshot bundle, marked the proof-mix criterion `met`, kept `approval-northline-deploy-sunrise-plumbing` open, and advanced the lane to `2/5` promotion criteria met. The runner now rewrites the Northline plan and autonomy summary after queue work finishes, so the live dossier no longer needs a manual `northline-plan` catch-up pass to reflect the same proof and gate state. A follow-up live verification pass on 2026-04-03T23:53Z confirmed that `plan.json` and `autonomy-summary.json` stayed aligned at `2/5` in the same run while Sunrise's production deploy approval remained open. The earlier local inbox-sync CDP error did not reproduce during the deployed runs.
- On 2026-04-04, the source repo shifted the default Northline completion point from legacy deploy approval to automated client handoff packaging. The repo now writes `runtime/reports/handoff-packages/<client-id>/handoff-package.json` plus `README.md`, treats successful handoff packaging as the delivery endpoint, keeps legacy deploy approvals only as optional manual compatibility state, and updates operator-facing copy to tell clients how to publish on their own host or hand the package to their developers. Source validation for that change passed with `npm test` and `npm run build`, and the same handoff-model files are now mirrored to `/opt/imon-engine` where `npm test` and `npm run build` also passed.
- On 2026-04-04, the handoff-package README was hardened into a plain-language publish guide. Source validation passed with `npm test` plus direct `./node_modules/.bin/tsc -p tsconfig.json`; the updated `src/services/reports.ts`, `src/workflows.test.ts`, and `docs/northline-hosting.md` were then backed up on the VPS under `runtime/ops/deploy-backups/northline-handoff-readme-20260404T091647Z.tgz`, mirrored to `/opt/imon-engine`, revalidated there with the same test and direct build commands, and used to refresh the live Sunrise Plumbing handoff package so the deployed README now includes `Start here`, `Fastest publish path`, `Send this to your web person`, and `If you do not have a developer` sections.

**Subsystems touched**: northline, setup-vps, engine

**Prerequisites**:
- Keep the hosted site live at `https://northlinegrowthsystems.com` and keep `imon-engine-northline-site.service` healthy via `npm run dev -- northline-site-health` or `curl http://127.0.0.1:4181/api/health`.
- Keep the VPS Chrome profile running and signed in because the current browser-backed automation path depends on `scripts/chrome_cdp.py` and `scripts/send_gmail_message.py`.
- Complete one real validation purchase through `https://northlinegrowthsystems.com/validation.html` before removing any launch-readiness manual gates.
- Treat the first three explicitly external clients as a proof cohort, not a scale phase. Do not add paid traffic until the proof loop in this plan has completed.
- Keep `NORTHLINE_SALES_EMAIL`, `NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING`, `NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD`, `NORTHLINE_STRIPE_PAYMENT_LINK_VALIDATION`, and `NORTHLINE_STRIPE_WEBHOOK_SECRET` accurate on the VPS. SMTP is still optional for public launch, but required for autonomous approval and outreach notifications.
- Assume `runtime/state/approvals.json` may contain stale account-level approval tasks. Phase 1 should refresh those rules against current live state instead of treating every waiting task as a real blocker.

**Ordered steps**:

| # | Phase | Outcome | Files to inspect or change | Docs to update | Depends on |
|---|-------|---------|----------------------------|----------------|------------|
| 1 | Controlled live cutover and proof-of-life | Northline is explicitly launched in controlled mode, one real validation checkout is completed, validation artifacts are verified, and stale readiness signals are recalculated against the live VPS state. | `src/services/northline-validation.ts`, `src/services/northline-site-server.ts`, `src/services/northline-ops.ts`, `src/index.ts`, `src/workflows.test.ts`, `runtime/state/northlineValidationConfirmations.json`, `runtime/state/approvals.json`, `runtime/ops/northline-growth-system/autonomy-summary.json` | `docs/northline-hosting.md`, `docs/northline-launch-checklist.md`, `docs/playbook.md` | — |
| 2 | Automated outbound send from the VPS | Approved Northline outreach drafts can be sent automatically from the VPS browser session or a configured SMTP sender, and successful sends update lead stage and outreach state without a manual approval click. | `src/services/northline-autonomy.ts`, `src/agents/outreach-writer.ts`, `src/agents/account-ops.ts`, `src/index.ts`, `scripts/send_gmail_message.py`, `scripts/chrome_cdp.py`, `src/workflows.test.ts` | `docs/playbook.md`, `docs/vps-tooling.md`, `docs/setup.md`, `docs/northline-hosting.md` | Phase 1 |
| 3 | Inbox sync and reply-state automation | Northline replies are pulled into the file-backed workflow automatically, classified with the existing reply handler, and routed into contacted, responded, booked-call, or intake follow-up states without manual message-file drops. | `src/index.ts`, `src/agents/reply-handler.ts`, `src/services/northline-autonomy.ts`, `src/storage/store.ts`, `scripts/send_gmail_message.py`, `scripts/chrome_cdp.py`, `scripts/sync_northline_inbox.py`, `src/workflows.test.ts` | `docs/playbook.md`, `docs/setup.md`, `docs/vps-tooling.md`, `docs/imon-engine.md` | Phase 2 |
| 4 | Billing, QA, and handoff package automation | Stripe-linked payments beyond the validation page can promote proposals automatically, QA outcomes can clear the delivery lane deterministically, and the default autonomy pass can finish by generating a client handoff package instead of expecting repo-managed hosting. Legacy deploy approvals stay opt-in manual tooling only. | `src/services/northline-site-server.ts`, `src/services/northline-validation.ts`, `src/services/northline-autonomy.ts`, `src/services/reports.ts`, `src/config.ts`, `.env.example`, `src/index.ts`, `src/workflows.test.ts` | `docs/northline-hosting.md`, `docs/setup.md`, `docs/playbook.md`, `docs/imon-engine.md` | Phases 1-3 |
| 5 | Proof capture, handoff, and publication loop | Each successful Northline delivery emits a screenshot set, testimonial request, review ask, proof-ready artifact bundle, and a client-readable handoff package that can be published back to the hosted site and handed to the client's existing host or developer team. | `scripts/test-northline-site-ui.ts`, `src/services/reports.ts`, `src/services/northline-ops.ts`, `src/services/agency-site.ts`, `src/agents/site-builder.ts`, `src/domain/contracts.ts`, `src/workflows.test.ts` | `docs/northline-launch-checklist.md`, `docs/northline-hosting.md`, `docs/playbook.md` | Phases 1-4 |
| 6 | Autonomous operating mode promotion | Northline moves from controlled launch into a mostly autonomous VPS-run lane with only explicit exception handling, manual money authorization, public-proof publication review, and host-specific publish troubleshooting left as human checkpoints. | `src/services/northline-autonomy.ts`, `src/services/northline-ops.ts`, `scripts/imon-engine-sync.sh`, `scripts/install-cron.sh`, `scripts/run_vps_autopilot.sh`, `src/workflows.test.ts` | `docs/vps-tooling.md`, `docs/setup.md`, `docs/playbook.md`, `docs/imon-engine.md`, `README.md` | Phases 1-5 |

**Phase notes**:

1. **Phase 1: Controlled live cutover and proof-of-life**
   - Treat the site as live immediately after the first real validation charge succeeds on `https://northlinegrowthsystems.com/validation.html` and `runtime/state/northlineValidationConfirmations.json` records the Stripe completion plus hosted result.
   - Re-run `npm run dev -- northline-autonomy-run --notify-roadblocks` after the real validation purchase so `runtime/state/approvals.json` and `runtime/ops/northline-growth-system/autonomy-summary.json` reflect the current live state instead of older placeholder readiness assumptions.
   - Tighten readiness logic in `src/services/northline-ops.ts` so the approval tasks for Stripe links and the branded sales inbox are closed or downgraded when the VPS configuration is already live.
   - Keep the validation payment itself manual. Do not attempt to automate live card entry.

2. **Phase 2: Automated outbound send from the VPS**
   - Replace the current `awaiting_owner_send` stopping point in `src/services/northline-autonomy.ts` with a sender policy that can dispatch approved drafts automatically.
   - Use `scripts/send_gmail_message.py` plus `scripts/chrome_cdp.py` as the first sender path because the VPS browser session already exists. Keep SMTP as a parallel or future sender path if `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, and `NORTHLINE_SMTP_FROM` are configured.
   - Update `src/agents/outreach-writer.ts` and `src/agents/account-ops.ts` so approval and notification behavior reflects the new sender policy instead of assuming manual send forever.
   - Persist send receipts back into `runtime/state/outreach.json` and lead stage changes in `runtime/state/leads.json` through `src/index.ts` and the existing file-backed store.

3. **Phase 3: Inbox sync and reply-state automation**
   - A scheduled Gmail/CDP inbox sync now exists at `scripts/sync_northline_inbox.py`, and `npm run dev -- northline-inbox-sync --business auto-funding-agency` exposes the same path for manual pulls when a direct smoke test is needed.
   - Synced replies now flow through the shared reply-ingest helper and the existing reply classifier instead of a parallel code path, so manual `handle-reply` and automated inbox sync write the same `runtime/state/leadReplies.json` records.
   - Deduplication now uses durable `externalMessageId` and `externalThreadId` reply records rather than a separate cursor file, which keeps replay protection inside the file-backed store.
   - `src/services/northline-autonomy.ts` now includes reply sync inside `northline-autonomy-run`, routes positive replies into booked-call or intake-follow-up next steps, and sizes the Gmail helper timeout to the live candidate cohort so larger contacted queues do not false-fail after two minutes.

4. **Phase 4: Billing, QA, and handoff package automation**
   - `src/services/northline-site-server.ts` now identifies non-validation Northline purchases and passes tracked proposal or client payment metadata into `src/services/northline-autonomy.ts` so the billing handoff gate can clear automatically.
   - The default Northline delivery lane now expects `src/services/northline-validation.ts` and `src/services/northline-autonomy.ts` to finish with proof capture plus a durable handoff package under `runtime/reports/handoff-packages/<client-id>/`, including clear publish instructions for the client or their developer team.
   - `src/config.ts` and `.env.example` still expose `NORTHLINE_AUTO_DEPLOY_ENABLED`, `NORTHLINE_AUTO_DEPLOY_MIN_COMPLETED_DELIVERIES`, and `NORTHLINE_AUTO_DEPLOY_REQUIRE_ZERO_QA_BLOCKERS`, but those toggles are now legacy or manual-only tooling for cases where a client explicitly wants repo-managed deploy help.
   - `src/index.ts` still preserves the manual exception path, and the live lane should now treat host-specific publish troubleshooting as the manual checkpoint instead of using deploy approval as the default completion gate.

5. **Phase 5: Proof capture and publication loop**
   - `scripts/test-northline-site-ui.ts` and the proof-bundle report flow now capture consistent desktop and mobile preview screenshots for each delivered site; the screenshot timeout was widened so the live VPS Playwright run remains stable while remote fonts finish loading.
   - `src/domain/contracts.ts`, `src/storage/store.ts`, and `runtime/state/clients.json` now carry a durable proof bundle on each client, and `runtime/state/proofBundles.json` keeps the same artifact shape as a repo-owned registry instead of introducing a separate database.
   - `src/services/reports.ts` and `src/services/northline-ops.ts` now create and track proof bundles for delivered pilots, including screenshot paths, testimonial and review-request drafts, publication copy, and the retention or upsell reference when one exists.
   - `src/services/agency-site.ts` now publishes stored proof bundles back onto the hosted Northline page and copies their screenshots into `runtime/agency-site/proof/` so the live proof page can show real delivered-client artifacts immediately.

6. **Phase 6: Autonomous operating mode promotion**
   - The shared VPS wrapper cadence is already in place. Phase 6 makes the Northline target explicit by running `northline-autonomy-run --business auto-funding-agency --notify-roadblocks` through `scripts/imon-engine-sync.sh`, `scripts/install-cron.sh`, and `scripts/run_vps_autopilot.sh` so the default agency lane cannot drift behind another business context.
   - Keep the irreducible manual checkpoints explicit even in autonomous mode: live payment authorization, disputed or ambiguous replies, public proof publication approval, and host-specific publish troubleshooting when the client's stack behaves differently than the preview package.
   - Change the default status in `src/services/northline-ops.ts` from controlled launch to autonomous only after the cohort metrics below are met, and surface that decision in both `runtime/ops/northline-growth-system/plan.{json,md}` and `runtime/ops/northline-growth-system/autonomy-summary.{json,md}`.

**Autonomy promotion criteria**:
- 1 successful real validation charge recorded in `runtime/state/northlineValidationConfirmations.json`
- 3 paid explicitly external clients delivered end to end
- 0 unresolved QA-stall tasks across the latest 3 deliveries
- 1 working send-and-reply loop on the VPS inbox path for at least 7 days
- 3 proof assets published: at least 1 before/after screenshot set, 1 testimonial snippet, and 1 review ask or review result

**Validation**:
- Run `npm test`.
- Run `npm run build`.
- Run `npm run dev -- build-agency-site`.
- Run `npm run test:northline-site-ui`.
- Run `npm run dev -- northline-site-health`.
- Run `npm run dev -- northline-payment-check --business auto-funding-agency`.
- Run `npm run dev -- northline-autonomy-run --notify-roadblocks` after each phase that changes queueing, approvals, proof readiness, or handoff-package generation.
- Use `python3 scripts/send_gmail_message.py --help` and the live VPS browser session as the smoke test for sender wiring before any send is allowed to batch.
- For Phase 3, validate `python3 scripts/sync_northline_inbox.py --help`, then run `npm run dev -- northline-inbox-sync --business auto-funding-agency` against the live VPS browser session. Keep `handle-reply --lead <lead-id> --message-file <path>` as the manual fallback when a reply body must be captured outside Gmail automation.
- For Phase 4, verify that a completed Stripe event moves a proposal from `billingStatus: proposal` to `paid` or `retainer_active` without a manual `northline-billing-handoff` command, and that the next autonomy run can emit a handoff package once QA and proof prerequisites are met.
- For Phase 5, verify the proof loop by checking `output/playwright/`, `runtime/reports/proof-bundles/`, `runtime/reports/handoff-packages/`, `runtime/state/proofBundles.json`, the relevant client record in `runtime/state/clients.json`, and the copied hosted assets under `runtime/agency-site/proof/`.

**Risks and notes**:
- The real validation payment should remain manual. Automating live payment entry is not an acceptable default for this lane.
- Gmail UI automation is inherently brittle. If the browser path is kept, Phase 2 and Phase 3 should preserve a non-browser sender or inbox fallback instead of hard-coding Gmail UI selectors as the only path.
- The current `approval-payment-links` and `approval-sales-inbox` tasks appear stale relative to live VPS config. Phase 1 should fix the readiness logic, not just ignore those tasks.
- SMTP is still genuinely incomplete on the VPS. `NORTHLINE_SALES_EMAIL` is present, but `SMTP_HOST`, `SMTP_USER`, and `NORTHLINE_SMTP_FROM` are not fully configured yet.
- Do not move the default lane back to repo-managed hosting before the first three explicitly external clients produce stable QA, proof, and handoff artifacts. Any deployer path should stay explicit, manual, and client-specific.
- Proof should come from a controlled launch cohort, referrals, or founder-led outreach. Do not fabricate testimonials or before-and-after screenshots to fill the proof gap.
- Keep `runtime/agency-site/` generated. All durable proof, automation, and routing changes should be made in source and regenerated.

**Handoff instructions for `@imon-engine`**:
- Wait for explicit manual handoff before executing any phase in this plan.
- Execute phases in order. Do not skip Phase 1 just because the site is already publicly reachable.
- Treat Phase 1 as the launch boundary: complete the real validation charge first, refresh autonomy state second, and only then start removing manual gates.
- Keep documentation aligned in the same change set for each phase, especially when env vars, queue behavior, or VPS operational rules change.
- Do not auto-launch ads or broad outbound volume during this plan. Stay inside a controlled proof cohort until the autonomy promotion criteria are met.
- Stop after each phase and report whether the lane is still in controlled launch mode or has earned the next gate removal.