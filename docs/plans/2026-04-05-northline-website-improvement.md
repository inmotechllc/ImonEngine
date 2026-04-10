### Plan: Northline Website Improvement

**Goal**: Use `docs/Northline_SiteCritiques/Northline-web_Critiques02` as the execution brief for a staged Northline website cleanup that reduces crowding, removes premature proof, aligns the offer and pricing with small-business and home-service buyers, and makes the homepage, booking page, and intake page feel more professional and modern without breaking the current hosted routes, intake storage, or payment-link resolution flow.

**Subsystems touched**: northline

**Prerequisites**:
- Treat `docs/Northline_SiteCritiques/Northline-web_Critiques02` as the source brief for messaging, layout, proof, spacing, CTA, and pricing-priority decisions.
- Treat `runtime/agency-site/` as generated output only. Make durable changes in source files such as `src/services/agency-site.ts`, `src/domain/defaults.ts`, `src/domain/contracts.ts`, `src/services/northline-business-profile.ts`, `src/services/northline-profile-admin.ts`, `src/services/northline-site-server.ts`, `scripts/test-northline-site-ui.ts`, and `src/workflows.test.ts`, then regenerate the site.
- Preserve the current public paths and handlers unless a phase explicitly updates implementation, tests, and docs together: `/`, `/book.html`, `/intake.html`, `/validation.html`, `/api/northline-intake`, `/api/northline-validation-confirm`, and `/api/northline-validation-status`.
- Keep the current `ManagedBusiness.northlineProfile` resolution flow in `runtime/state/businesses.json`. If the public package names or tier copy change, prefer preserving stable internal tier ids unless payment-link and dossier behavior are intentionally migrated in the same phase.
- Treat `docs/plans/2026-04-04-northline-lead-generation-proof-plan.md` as the current proof-cohort and Lead Generation foundation. This plan should improve presentation, sequencing, and buyer trust on top of that work rather than reintroducing placeholder proof or undoing the existing proof-eligibility rules.
- If booking or intake field labels are shortened, renamed, or reordered, preserve canonical submission storage by updating the alias normalization in `src/services/northline-site-server.ts` in the same phase.
- Have repo dependencies installed before implementation so `npm run dev -- build-agency-site`, `npm run test:northline-site-ui`, `npm test`, and `npm run build` can run without adding environment work midstream.
- Use this plan instead of `docs/plans/2026-04-02-northline-website-critique-response.md` for the next critique-driven Northline website pass. That earlier plan is directionally useful, but this one is more explicit about proof suppression, pricing realism, and the validation page's role.

**Ordered steps**:

| # | Phase | Outcome | Files to change | Docs to update | Depends on |
|---|-------|---------|-----------------|----------------|------------|
| 1 | Message and CTA reset | Reframe the homepage around booked jobs, missed calls, quote requests, and follow-up gaps. Reduce early decision load to one primary CTA and one secondary CTA, and remove internal or system-facing language from public copy. | `src/domain/defaults.ts`, `src/services/agency-site.ts` | `docs/northline-hosting.md`, `docs/northline-launch-checklist.md` | — |
| 2 | Layout, spacing, and container cleanup | Reduce bordered-card density, unify spacing rhythm, shorten hero height, and remove large low-value containers so home, book, and intake stop feeling crowded on desktop and mobile. | `src/services/agency-site.ts` | `docs/northline-launch-checklist.md` | Phase 1 |
| 3 | Proof suppression and trust replacement | Remove or suppress placeholder proof until Northline has real external proof. Replace it with honest deliverable, process, fit, and response-clarity sections, while keeping delivered-client proof conditional on real proof bundles only. | `src/domain/contracts.ts`, `src/domain/defaults.ts`, `src/services/agency-site.ts` | `docs/northline-hosting.md`, `docs/northline-launch-checklist.md`, `docs/playbook.md` | Phases 1-2 |
| 4 | Offer ladder and pricing alignment | Simplify the public buying path into a credible low-risk entry offer, a clearer one-time implementation offer, and an optional retained path only after proof exists. Keep payment-link resolution and profile overrides aligned with any public-label or tier-structure changes. | `src/domain/contracts.ts`, `src/domain/defaults.ts`, `src/services/agency-site.ts`, `src/services/northline-business-profile.ts`, `src/services/northline-profile-admin.ts` | `docs/northline-hosting.md`, `docs/northline-launch-checklist.md`, `docs/playbook.md` | Phases 1-3 |
| 5 | Booking, intake, and validation-path cleanup | Make the booking and intake pages calmer and lighter, turn side panels into useful conversion content, preserve canonical submission storage, and remove `/validation.html` from the normal buyer journey while keeping it available for controlled-launch checks. | `src/services/agency-site.ts`, `src/services/northline-site-server.ts`, `src/workflows.test.ts` | `docs/northline-hosting.md`, `docs/northline-launch-checklist.md`, `docs/playbook.md` | Phases 1-4 |
| 6 | Mobile-first regression and launch review | Tighten small-screen readability, update UI and workflow regression coverage, rebuild the site, inspect screenshots, and confirm the hosted pages plus intake flow still behave correctly before launch approval. | `scripts/test-northline-site-ui.ts`, `src/workflows.test.ts`, `src/services/agency-site.ts`, `src/services/northline-site-server.ts` | `docs/northline-hosting.md`, `docs/northline-launch-checklist.md` | Phases 1-5 |

**Phase notes**:

1. **Phase 1 scope details**
   - Replace internal phrasing on public pages, especially wording like `proof page`, `operator intake`, `submission mode`, `connected to a live endpoint`, and similar implementation-facing labels in `src/services/agency-site.ts`.
   - Update `src/domain/defaults.ts` so the homepage headline, support copy, audience framing, service summaries, FAQ language, and closing CTA all speak to plumbers, HVAC teams, electrical shops, roofers, cleaners, startups, and other small operators in buyer language.
   - Keep one primary homepage CTA. The secondary CTA should remain lower-friction than checkout and should not compete with the primary action above the fold.

2. **Phase 2 scope details**
   - Reduce the number of bordered cards and stacked panel groups across `src/services/agency-site.ts`.
   - Establish a more disciplined spacing rhythm between hero content, supporting text, cards, forms, and section transitions so the site stops feeling visually compressed.
   - Trim low-value empty containers on the booking and intake pages. If a panel takes visual space, it should contribute trust, deliverable clarity, or next-step confidence.
   - Keep the premium editorial direction only where it still supports speed and comprehension for small local-service buyers.

3. **Phase 3 scope details**
   - The critique explicitly calls for removing proof that is not backed by real user signups, real delivery, and real outcomes. Do not replace removed proof with fabricated testimonials, invented stats, or simulated case studies.
   - If the current `AgencyProfile` contract in `src/domain/contracts.ts` cannot express a better non-proof trust surface cleanly, extend it for structured working-method, deliverable, or fit content instead of adding more ad hoc strings in the renderer.
   - Keep real delivered-client proof conditional on the existing proof-bundle path. Public proof should only appear when the repo has actual eligible proof assets to publish.
   - Update `docs/playbook.md` if proof publication, proof expectations, or operator review steps change as part of this phase.

4. **Phase 4 scope details**
   - The public site should present a believable progression: low-risk review first, implementation second, optional retained improvement third.
   - If possible, keep existing internal pricing ids stable even if public labels or descriptions change. If the tier structure itself changes, update `src/services/northline-business-profile.ts` and `src/services/northline-profile-admin.ts` in the same phase so stored `northlineProfile` data and payment-link metadata do not drift.
   - Keep checkout lower in the journey than proof, deliverables, and fit. The phase is about pricing realism and buyer sequencing, not rewriting the Stripe integration.
   - Update the docs in the same phase if the public descriptions, tier order, or qualification logic change.

5. **Phase 5 scope details**
   - Reduce the booking page to the minimum information genuinely needed to continue the conversation. Preserve only fields that materially help scheduling or follow-up.
   - Rework the booking and intake side panels in `src/services/agency-site.ts` so they earn space with concrete content such as what gets reviewed, what comes back, response timing, best-fit criteria, or the next step after submission.
   - Keep `/validation.html` as an internal controlled-launch page, but remove it from the normal prospect decision path if it currently distracts from the main buyer journey.
   - If public field names or labels change, map them back to canonical stored payload keys in `src/services/northline-site-server.ts` and cover those aliases in `src/workflows.test.ts`.

6. **Phase 6 scope details**
   - Use `scripts/test-northline-site-ui.ts` to protect the new CTA hierarchy, reduced card density, revised proof behavior, updated pricing sequence, shortened forms, and validation-page positioning.
   - Expand `src/workflows.test.ts` so stored Northline submissions remain compatible even after booking and intake copy changes.
   - Use the current Playwright screenshots and report artifacts to confirm the site no longer feels visually crowded on mobile and that the primary CTA lands earlier in the viewport.

**Validation**:
- Run `npm run dev -- build-agency-site` after each implemented phase that changes rendered page output.
- Run `npm run test:northline-site-ui` after Phases 2, 3, 5, and 6.
- Run `npm test` after Phases 4, 5, and 6 to confirm pricing, intake, and workflow expectations still pass.
- Run `npm run dev -- northline-profile-show --business auto-funding-agency --probe-payments` after Phase 4.
- Run `npm run dev -- northline-payment-check --business auto-funding-agency` after Phase 4.
- Run `npm run build` after Phase 6.
- Run `npm run dev -- northline-site-serve` and `npm run dev -- northline-site-health` before final approval to confirm the hosted site and intake endpoints still respond correctly.
- Review `runtime/agency-site/index.html`, `runtime/agency-site/book.html`, `runtime/agency-site/intake.html`, and `runtime/agency-site/validation.html` after regeneration.
- Review `output/playwright/home-desktop.png`, `output/playwright/home-mobile.png`, `output/playwright/book-desktop.png`, `output/playwright/book-mobile.png`, `output/playwright/intake-desktop.png`, `output/playwright/intake-mobile.png`, and `output/playwright/report.json` after UI validation. If the run is captured into the named Northline artifact folder, also review `output/playwright/Northline/report.json`.

**Risks and notes**:
- The current canonical Northline docs still describe proof-first sections and a three-tier pricing presentation. This plan intentionally revisits both, so docs must be updated in the same phase as any code change.
- The critique is correct that weak or simulated proof hurts trust. If no real external proof exists yet, finish Phase 3 with honest deliverable and working-method content instead of invented outcomes.
- Changing public pricing copy is low risk. Changing tier structure or ids is higher risk because it can affect `northlineProfile` overrides, payment-link resolution, and qualified-checkout behavior. Prefer stable internal ids unless a deliberate migration is approved.
- Shortening booking or intake forms can break stored submission expectations if alias normalization and workflow tests are not updated in the same patch.
- `/validation.html` still matters for controlled-launch verification. Remove it from the buyer journey only if the internal validation workflow remains intact for operators.
- Do not edit `runtime/agency-site/` manually. It must stay generated from source.

**Handoff instructions for `@imon-engine`**:
- Wait for explicit approval before executing this plan. Do not start Phase 1 automatically.
- Execute phases in order. Do not collapse all six phases into one patch unless a hard dependency makes separation impractical.
- Keep `docs/northline-hosting.md`, `docs/northline-launch-checklist.md`, and `docs/playbook.md` aligned in the same change set whenever public behavior, promises, proof handling, or qualification flow change.
- Do not edit `runtime/agency-site/` directly. Regenerate it with `npm run dev -- build-agency-site`.
- If pricing changes require more than public-label edits, stop and confirm whether internal tier ids should stay stable or whether a tier-and-payment migration is actually approved.
- If no real proof asset exists, complete the trust and deliverable rewrite without public proof cards rather than shipping fabricated proof.