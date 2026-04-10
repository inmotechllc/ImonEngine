# Plan: Northline Lead-Generation Tier, External Proof Cohort, And Growth Upgrade Coupons

Status: Source implementation completed on 2026-04-04. The original phased plan is preserved below as a historical handoff record. Source validation passed with `npm test`, `npm run build`, `npm run dev -- build-agency-site`, `npm run test:northline-site-ui`, `npm run dev -- northline-profile-show --business auto-funding-agency --probe-payments`, `npm run dev -- northline-payment-check --business auto-funding-agency`, and `npm run dev -- northline-plan --business auto-funding-agency`. No `/opt/imon-engine` sync or `northline-autonomy-run` was performed for this plan because `docs/autopilot/state.json` remained paused and the safe validation pass intentionally avoided live outreach side effects.

## Goal

Shift Northline's front door from ambiguous pilot proof to an honest lead-generation-first offer stack. The implementation should do three things together:

- count proof only from real external signups and delivered external clients
- add a lower-friction Lead-Generation tier across Northline ops, profile data, and the public site
- add a coupon-assisted upgrade path from Lead Generation into the Growth System without introducing Stripe API complexity the repo does not already own

This plan was written as a handoff for `@imon-engine`. The source-first implementation described here is now complete in `/root/ImonEngine`; rollout to `/opt/imon-engine` remains a separate approval step while autopilot stays paused.

## Subsystems Touched

- Northline proof and operating-mode logic in `src/services/northline-ops.ts`
- Client and pricing contracts in `src/domain/contracts.ts`, `src/domain/northline.ts`, and `src/domain/engine.ts`
- Default offers and public pricing copy in `src/domain/defaults.ts`
- Business-profile resolution and admin patching in `src/services/northline-business-profile.ts` and `src/services/northline-profile-admin.ts`
- Public-site pricing and qualified-checkout rendering in `src/services/agency-site.ts`
- Client creation, hosted intake promotion, and state persistence in `src/index.ts`, `src/services/northline-autonomy.ts`, `src/services/northline-site-server.ts`, and `src/storage/store.ts`
- Retention and upgrade artifacts in `src/services/reports.ts`, `src/openai/prompts.ts`, `src/openai/client.ts`, and `src/services/northline-validation.ts`
- Regression coverage in `src/workflows.test.ts` and `scripts/test-northline-site-ui.ts`
- Canonical docs in `docs/northline-hosting.md`, `docs/northline-launch-checklist.md`, `docs/playbook.md`, `docs/setup.md`, `docs/imon-engine.md`, and `README.md`

## Historical Prerequisites

- The original implementation waited for manual owner approval before editing source, runtime state, or `/opt/imon-engine`.
- Keep the current autopilot state unchanged. `docs/autopilot/state.json` is paused and this plan does not change that.
- Treat `/root/ImonEngine` as the only execution target for the first pass. Do not sync to `/opt/imon-engine` until source validation passes and the owner separately approves rollout.
- Take the current Northline proof metrics as a baseline by preserving the current generated artifacts before implementation:
  - `runtime/ops/northline-growth-system/plan.json`
  - `runtime/ops/northline-growth-system/autonomy-summary.json`
- Use Stripe payment links, not dynamic Stripe coupon creation, as the default coupon implementation model. The repo already resolves and validates payment-link URLs; it does not own Stripe coupon administration.
- Before rollout, prepare the commercial inputs outside the repo:
  - one Lead-Generation Stripe payment link
  - one Growth System upgrade path, preferably a dedicated discounted payment link
  - final coupon label, terms, and copy that can be stored in Northline profile data
- Do not auto-promote legacy Northline clients into the new proof cohort. Legacy records should remain excluded until they are explicitly verified.

## Ordered Steps

### 1. Phase 1: Establish An Explicit External Proof Cohort

Outcome: Northline promotion criteria stop relying on inferred legacy behavior. Proof counts come only from explicitly marked external clients that complete the real delivery path.

Implementation files:

- `src/domain/contracts.ts`
  Add explicit client provenance and proof-eligibility fields on `ClientJob` so proof logic stops depending on note text and missing `businessId` fallbacks.
- `src/storage/store.ts`
  Normalize any new `ClientJob` fields on read and write so older JSON records remain loadable without hand-editing `runtime/state/clients.json`.
- `src/index.ts`
  Update `createClientFromBrief(...)` so brief-created or internal fixture clients default to non-external proof status unless a future approved import path sets otherwise.
- `src/services/northline-site-server.ts`
  Mark hosted intake or proposal-created clients as external inbound candidates.
- `src/services/northline-autonomy.ts`
  Mark sourced and outreach-converted Northline clients as external outbound candidates at the moment they become tracked client work.
- `src/services/northline-validation.ts`
  Mark validation-page artifacts as internal validation records and proof-ineligible.
- `src/services/northline-ops.ts`
  Replace the current `trackedPilotClient(...)` default-lane inference with explicit proof-cohort predicates that require external provenance plus completed handoff.
- `src/workflows.test.ts`
  Add regressions covering:
  - a legacy client with no provenance
  - a `/validation.html` internal artifact
  - a manual brief-created synthetic client
  - an external sourced client that becomes paid and handoff-complete

Docs to update in the same change:

- `docs/northline-launch-checklist.md`
- `docs/playbook.md`
- `docs/northline-hosting.md`
- `docs/imon-engine.md`

Phase validation:

- `npm test`
- `npm run build`
- `npm run dev -- northline-plan --business auto-funding-agency`
- `npm run dev -- northline-autonomy-run --business auto-funding-agency --notify-roadblocks`
- Review:
  - `runtime/ops/northline-growth-system/plan.json`
  - `runtime/ops/northline-growth-system/autonomy-summary.json`
  - `runtime/state/clients.json`

Execution notes:

- Backfill rules should be conservative. Existing legacy records should default to `legacy_unverified` or an equivalent non-counting state, not auto-count as proof.
- This phase should land before any lead-generation pricing work so the dashboard reflects real proof semantics first.

### 2. Phase 2: Add The Lead-Generation Tier Contract And Config Surface

Outcome: Northline has a third offer tier that is durable in ops state, business profile overrides, env fallbacks, and payment readiness checks.

Implementation files:

- `src/domain/contracts.ts`
  Replace the anonymous `AgencyProfile.pricing` item shape with a named pricing-tier contract that supports tier ids, CTA metadata, payment-link keys, and optional upgrade-offer metadata.
- `src/domain/defaults.ts`
  Add a new `lead-generation-offer` entry to `DEFAULT_OFFERS` and add the corresponding Lead-Generation pricing card to `DEFAULT_AGENCY_PROFILE.pricing`.
- `src/domain/northline.ts`
  Extend `NorthlineBusinessProfileConfig` and `ResolvedNorthlineBusinessProfile` with new payment and upgrade fields. The minimum expected additions are:
  - `stripeLeadGeneration`
  - one structured Growth System upgrade object or equivalent fields for discounted checkout link, coupon label, and terms
- `src/domain/engine.ts`
  Keep `ManagedBusiness.northlineProfile` as the canonical storage path and update type references only as needed.
- `src/services/northline-business-profile.ts`
  Resolve the new lead-generation and upgrade fields from stored business profile data plus default env fallbacks.
- `src/services/northline-profile-admin.ts`
  Extend patch sanitization, merge behavior, and payment readiness checks so the new tier and upgrade fields are admin-editable and validated.
- `src/config.ts`
  Add business-scoped env fallbacks for the new payment-link fields. Recommended names:
  - `NORTHLINE_STRIPE_PAYMENT_LINK_LEAD_GENERATION`
  - `NORTHLINE_STRIPE_PAYMENT_LINK_GROWTH_UPGRADE`
  - optional text-only coupon envs only if the owner does not use a dedicated discounted payment link
- `.env.example`
  Add the matching Northline env keys with comments that keep Stripe API credentials out of tracked env files.
- `src/workflows.test.ts`
  Add coverage for default-offer seeding, business-profile resolution, and admin patch sanitization for the new fields.

Docs to update in the same change:

- `docs/setup.md`
- `docs/northline-hosting.md`
- `docs/imon-engine.md`
- `README.md`

Phase validation:

- `npm test`
- `npm run build`
- `npm run dev -- northline-profile-show --business auto-funding-agency --probe-payments`
- `npm run dev -- northline-payment-check --business auto-funding-agency`

Execution notes:

- Prefer a dedicated discounted Growth System payment link over a raw coupon code. That keeps the implementation aligned with the repo's existing payment-link model.
- Do not hard-code final commercial numbers into multiple places. Defaults should live in `src/domain/defaults.ts` and stay overrideable through `ManagedBusiness.northlineProfile`.

### 3. Phase 3: Make Public Pricing And Checkout Behavior Data-Driven

Outcome: The hosted Northline site stops assuming exactly two pricing cards and can render Lead Generation plus coupon-assisted Growth upgrades from structured tier data.

Implementation files:

- `src/services/agency-site.ts`
  Replace the current index-based pricing logic with tier-id or CTA-metadata-driven rendering. The site should:
  - render three tiers without relying on array order
  - show Lead Generation as the lower-friction paid option
  - keep cold traffic routed into leak review or live review before direct checkout when qualification is missing
  - render the qualified-buyer checkout block from structured payment-link metadata
  - surface the configured Growth System upgrade coupon or discounted-link message without hard-coding it into the template
- `src/services/northline-business-profile.ts`
  Pass any new site-surface payment or upgrade fields through the resolved business profile.
- `src/services/northline-profile-admin.ts`
  Keep `agencyProfile.pricing` admin-editable after the richer pricing-tier contract lands.
- `src/domain/defaults.ts`
  Align default CTA copy, qualification copy, and tier order with the new rendering contract.
- `scripts/test-northline-site-ui.ts`
  Extend UI assertions and screenshot expectations for:
  - three pricing tiers
  - Lead-Generation CTA placement
  - coupon-assisted Growth upgrade copy or panel
- `src/workflows.test.ts`
  Add generated-site assertions so the HTML contract is covered in unit or workflow tests, not only in Playwright.

Docs to update in the same change:

- `docs/northline-hosting.md`
- `docs/northline-launch-checklist.md`
- `docs/playbook.md`

Phase validation:

- `npm test`
- `npm run build`
- `npm run dev -- build-agency-site`
- `npm run test:northline-site-ui`
- Review:
  - `runtime/agency-site/index.html`
  - `output/playwright/report.json`
  - `output/playwright/home-desktop.png`
  - `output/playwright/home-mobile.png`

Execution notes:

- Keep the CTA path honest. Lead Generation is the low-friction paid tier; the Growth System remains the higher-commitment upgrade after fit is clear.
- Do not reintroduce a top-of-page checkout-first layout that bypasses the leak-review qualification flow.

### 4. Phase 4: Add Coupon-Assisted Upgrade Artifacts For Lead-Generation Clients

Outcome: Lead-Generation clients receive a structured upgrade path into the Growth System through retention and handoff artifacts, not only through static homepage copy.

Implementation files:

- `src/domain/contracts.ts`
  Extend `RetentionReport` with structured upgrade-offer data if a plain `upsellCandidate` string is no longer sufficient.
- `src/openai/client.ts`
  Update the retention schema to support any new structured upgrade fields.
- `src/openai/prompts.ts`
  Update the retention prompt so generated upsell guidance can reference the Lead-Generation-to-Growth upgrade path without inventing unsupported discount terms.
- `src/services/reports.ts`
  Update retention, proof, and handoff packaging so Lead-Generation clients can receive:
  - coupon-aware upgrade messaging
  - the configured upgrade link or code
  - clear next-step language for moving into the Growth System
- `src/services/northline-validation.ts`
  Keep validation and returned retention payloads aligned if `RetentionReport` becomes richer than a single `upsellCandidate` string.
- `src/workflows.test.ts`
  Add coverage for Lead-Generation client retention output and any new handoff README or proof-bundle upgrade copy.

Docs to update in the same change:

- `docs/playbook.md`
- `docs/northline-hosting.md`
- `docs/northline-launch-checklist.md`

Phase validation:

- `npm test`
- `npm run build`
- `npm run dev -- retain --client <lead-generation-client-id>`
- Review:
  - `runtime/reports/<lead-generation-client-id>-retention.json`
  - `runtime/reports/handoff-packages/<lead-generation-client-id>/README.md` if handoff copy changes

Execution notes:

- Keep upgrade language factual. The repo should surface configured coupon terms, not invent discount values in generated copy.
- If no real Lead-Generation client exists yet, validate this phase with fixtures and `src/workflows.test.ts` rather than manufacturing live state.

### 5. Phase 5: Reconcile Dossier Outputs, Docs, And Rollout Gates

Outcome: The generated Northline plan, autonomy summary, setup docs, and owner-facing workflow docs all match the new strategy before any VPS rollout is attempted.

Implementation files and generated artifacts:

- `src/services/northline-ops.ts`
  Ensure operating-mode summaries and promotion criteria text describe the new external-only proof semantics and the Lead-Generation-first motion.
- `docs/northline-hosting.md`
- `docs/northline-launch-checklist.md`
- `docs/playbook.md`
- `docs/setup.md`
- `docs/imon-engine.md`
- `README.md`
- Generated artifacts to inspect after source validation:
  - `runtime/ops/northline-growth-system/plan.json`
  - `runtime/ops/northline-growth-system/autonomy-summary.json`
  - `runtime/agency-site/index.html`

Phase validation:

- `npm test`
- `npm run build`
- `npm run dev -- build-agency-site`
- `npm run test:northline-site-ui`
- `npm run dev -- northline-profile-show --business auto-funding-agency --probe-payments`
- `npm run dev -- northline-payment-check --business auto-funding-agency`
- `npm run dev -- northline-plan --business auto-funding-agency`
- `npm run dev -- northline-autonomy-run --business auto-funding-agency --notify-roadblocks`

Execution notes:

- Do not update `/opt/imon-engine` as part of this phase unless the owner explicitly approves rollout after source validation.
- If rollout is later approved, use the existing live-safety pattern: back up the touched `/opt` files first, then narrow-sync only the approved source files.

## Validation

Run these checks after the full approved implementation lands in source:

- `npm test`
- `npm run build`
- `npm run dev -- build-agency-site`
- `npm run test:northline-site-ui`
- `npm run dev -- northline-profile-show --business auto-funding-agency --probe-payments`
- `npm run dev -- northline-payment-check --business auto-funding-agency`
- `npm run dev -- northline-plan --business auto-funding-agency`
- `npm run dev -- northline-autonomy-run --business auto-funding-agency --notify-roadblocks`

Review these artifacts after validation:

- `runtime/ops/northline-growth-system/plan.json`
- `runtime/ops/northline-growth-system/autonomy-summary.json`
- `runtime/agency-site/index.html`
- `output/playwright/report.json`
- `runtime/state/clients.json`
- `runtime/reports/handoff-packages/<client-id>/README.md` for any affected test or fixture client

## Risks And Notes

- The main correctness risk is silent proof inflation. The implementation must prefer explicit provenance metadata over heuristics derived from note text, `geo`, or missing `businessId` values.
- Do not fabricate proof to satisfy the new promotion criteria. The point of this strategy is to make the dashboard truthful, not easier to game.
- Lead-Generation pricing, coupon amount, and coupon wording are commercial inputs, not engineering guesses. Keep them data-driven and owner-editable.
- `northline-payment-check` currently validates founding and standard links. Once the new tier lands, the same readiness path must be extended or its limitations documented.
- Existing live state may contain clients that no longer qualify as proof once provenance becomes explicit. That drop is expected and should not be patched around.
- `/opt/imon-engine` is a dirty live environment. Any future rollout must keep the narrow backup-and-sync pattern already used for Northline changes.
- Avoid introducing a Stripe API dependency just to issue coupons. The repo is currently payment-link-centric, and a dedicated discounted payment link is the lowest-risk implementation.

## Handoff Instructions For `@imon-engine`

- Wait for explicit manual approval before executing any phase.
- Execute phases in order. Do not start Lead-Generation pricing work before the external proof cohort contract lands.
- Keep all durable behavior changes and doc updates in the same change set for each phase.
- Treat `src/domain/contracts.ts` as the source of truth for any new pricing, proof, or retention data contracts. Avoid duplicating anonymous shapes across services.
- Keep the public site honest: lead review first for cold traffic, Lead Generation as the lower-friction paid tier, Growth System as the post-fit upgrade.
- Keep legacy clients excluded from proof unless a later approved migration explicitly verifies them.
- Stop after source validation. Do not sync `/opt/imon-engine`, update live runtime state, or regenerate live artifacts without a separate owner approval.