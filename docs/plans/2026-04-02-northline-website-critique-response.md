### Plan: Northline Website Critique Response

**Goal**: Turn the findings in `docs/Northline-web_Critiques` into a phased website update that makes Northline easier for cold home-service operators to understand, trust, and act on, while preserving the current repo-hosted site routes and intake storage flow.

**Subsystems touched**: northline

**Prerequisites**:
- Use `docs/Northline-web_Critiques` as the conversion brief for this plan. Treat it as the source for message, proof, CTA, form-friction, and mobile-readability priorities.
- Treat `runtime/agency-site/` as generated output only. Make durable changes in `src/services/agency-site.ts`, `src/domain/defaults.ts`, `src/domain/contracts.ts`, `src/services/northline-site-server.ts`, `scripts/test-northline-site-ui.ts`, and `src/workflows.test.ts`, then regenerate the site.
- Keep the current public paths and handlers intact unless a phase explicitly updates both implementation and docs together: `/`, `/book.html`, `/intake.html`, `/api/northline-intake`, `NORTHLINE_BOOKING_URL`, and `NORTHLINE_LEAD_FORM_ACTION`.
- If booking or intake fields are shortened or renamed, preserve canonical submission storage by updating the field-alias normalization in `src/services/northline-site-server.ts` in the same phase.
- Have repo dependencies installed before implementation so the validation commands in this plan can run without adding environment work midstream.
- Use this plan instead of `docs/plans/2026-04-01-northline-site-conversion-rework.md` for the next Northline website pass. That earlier plan is directionally aligned, but this one is more tightly mapped to the critique file and split into explicit execution phases.

**Ordered steps**:

| # | Phase | Outcome | Files to change | Docs to update | Depends on |
|---|-------|---------|-----------------|----------------|------------|
| 1 | Buyer-language message reset | Rewrite the homepage promise, audience framing, and CTA language around booked jobs, missed calls, quote requests, and after-hours follow-up instead of internal Northline terminology. Reduce the early decision load to one primary action and one secondary action, and demote payment asks below proof. | `src/domain/defaults.ts`, `src/services/agency-site.ts` | `docs/northline-hosting.md`, `docs/northline-launch-checklist.md` | — |
| 2 | Proof-first homepage rebuild | Add concrete trust and proof immediately after the hero or inside the first viewport flow: a teardown-style proof block, stronger trust stack, clearer buyer specificity, and tangible deliverable language. If the current `AgencyProfile` shape cannot represent the needed proof assets cleanly, extend the profile contract first instead of hardcoding ad hoc strings in the renderer. | `src/domain/contracts.ts`, `src/domain/defaults.ts`, `src/services/agency-site.ts` | `docs/northline-hosting.md`, `docs/northline-launch-checklist.md` | Phase 1 |
| 3 | Booking and intake conversion cleanup | Shorten the booking form aggressively, reframe the intake page around utility and response expectations, and turn the right-side panels into sales assets such as a sample audit summary, a 48-hour deliverable block, or a trust stack. Keep form submissions compatible with the current stored payload keys. | `src/services/agency-site.ts`, `src/services/northline-site-server.ts`, `src/workflows.test.ts` | `docs/northline-hosting.md`, `docs/northline-launch-checklist.md`, `docs/playbook.md` | Phases 1-2 |
| 4 | Mobile-first readability pass | Reduce hero height and copy density on mobile, tighten type scale and spacing, and ensure proof, target trades, and the primary CTA appear earlier on small screens across home, book, and intake. Keep the editorial design language only where it still serves speed and clarity for local-service buyers. | `src/services/agency-site.ts`, `src/domain/defaults.ts` | `docs/northline-launch-checklist.md` | Phases 1-3 |
| 5 | Pricing and qualification alignment | Move direct payment links lower in the decision path or place them behind clearer qualification copy so cold traffic sees proof and deliverables before checkout. Keep the existing Stripe link resolution flow intact unless a separate implementation decision changes routing behavior. | `src/services/agency-site.ts`, `src/domain/defaults.ts` | `docs/northline-hosting.md`, `docs/northline-launch-checklist.md` | Phases 1-4 |
| 6 | Regression coverage and launch review | Extend UI and workflow coverage so the new CTA hierarchy, proof blocks, shortened forms, and intake normalization stay protected. Rebuild the site, run the Northline UI suite, inspect screenshots, and confirm the hosted endpoint still behaves correctly before launch approval. | `scripts/test-northline-site-ui.ts`, `src/workflows.test.ts`, `src/services/agency-site.ts`, `src/services/northline-site-server.ts` | `docs/northline-hosting.md`, `docs/northline-launch-checklist.md` | Phases 1-5 |

**Phase notes**:

1. **Phase 1 scope details**
   - Replace insider phrases on public pages, especially wording like `operator intake`, `submission mode`, `connected to a live endpoint`, and other implementation-facing labels in `src/services/agency-site.ts`.
   - Update `DEFAULT_AGENCY_PROFILE` in `src/domain/defaults.ts` so the headline, supporting copy, audience, differentiators, service stack, FAQ copy, and closing note all speak in the buyer's language from the critique.
   - Keep one primary homepage CTA. The secondary action should stay lower-friction than payment and should not compete with the primary action above the fold.

2. **Phase 2 scope details**
   - Add proof that feels like execution, not positioning. The critique specifically calls for concrete artifacts such as a teardown sample, before-and-after framing, a short operator story, a response-time promise, or deliverable clarity.
   - Use `src/domain/contracts.ts` if the current `proofPoints` and `trustSignals` arrays are too narrow for the new proof surface. Keep the data structured so the profile can still be overridden later through `northlineProfile.agencyProfile`.
   - Ensure the homepage names the target businesses early: plumbers, HVAC, electrical, roofing, and cleaning teams, especially owner-led or small dispatch-led shops with weak conversion from traffic they already have.

3. **Phase 3 scope details**
   - Reduce the booking form to the minimum set the critique calls for: name, business, email, phone, website, and one short problem field, unless a clearly necessary scheduling field still needs to survive for live-review requests.
   - Rework booking and intake side panels in `src/services/agency-site.ts` so they earn space with conversion content instead of static helper copy.
   - If new public field names are introduced, map them back to `ownerName`, `serviceArea`, `primaryServices`, `preferredCallWindow`, `leadGoal`, and `biggestLeak` in `src/services/northline-site-server.ts` so downstream autonomy and workflow tests do not break.
   - Update `docs/playbook.md` if the site starts promising a specific response window or a changed qualification path that the operator workflow must honor.

4. **Phase 4 scope details**
   - Use the mobile screenshots from `output/playwright/` as the review artifact for whether the hero is still too tall or proof is still pushed too far below the fold.
   - Keep the mobile hero to one headline, one supporting sentence, one proof strip, and one CTA if possible.
   - Verify that pricing, trust, and CTA sections do not crowd the first mobile screen or force long scrolling before the user understands the offer.

5. **Phase 5 scope details**
   - Keep the Stripe payment-link plumbing from `src/config.ts` and the resolved Northline business profile behavior intact. The phase is about placement, qualification, and buyer sequencing, not a payment integration rewrite.
   - Make the path from homepage to intake or booking unambiguous before exposing checkout links more prominently.

6. **Phase 6 scope details**
   - Expand `scripts/test-northline-site-ui.ts` assertions for the new hero copy, CTA hierarchy, proof sections, shortened forms, and side-panel content.
   - Update `src/workflows.test.ts` assertions for any renamed copy or form-field aliases while preserving the stored canonical submission payload.
   - Rebuild the site and review both automated checks and screenshots before launch approval.

**Validation**:
- Run `npm run dev -- build-agency-site` after each implemented phase that changes page output.
- Run `npm run test:northline-site-ui` after Phases 2, 3, 4, and 6.
- Run `npm test` after Phases 3 and 6 to confirm workflow and intake-storage behavior still pass.
- Run `npm run build` after Phase 6.
- Run `npm run dev -- northline-site-serve` and `npm run dev -- northline-site-health` before final approval to confirm the hosted site and intake endpoint still respond correctly.
- Review `output/playwright/home-desktop.png`, `output/playwright/home-mobile.png`, `output/playwright/book-desktop.png`, `output/playwright/book-mobile.png`, `output/playwright/intake-desktop.png`, `output/playwright/intake-mobile.png`, and `output/playwright/report.json` as part of sign-off.

**Risks and notes**:
- The critique asks for stronger proof than the current site may honestly have on hand. If there is no real testimonial, teardown sample, or before-and-after artifact yet, use concrete deliverable proof and response clarity first rather than inventing fabricated results.
- The current site already improved the CTA hierarchy compared with the older sales surface, but the critique shows the remaining gap is now about buyer comprehension, trust density, and page efficiency. Treat this as a second-pass conversion rewrite, not a greenfield redesign.
- Shortening the booking form may remove data that the current live-review workflow expects. Preserve only the fields that are necessary for follow-up, and collect the rest later.
- The hosted intake route is shared by both booking and intake pages. Any public-field rename must be mirrored in `src/services/northline-site-server.ts` and covered in `src/workflows.test.ts`.
- Keep `runtime/agency-site/` out of manual edits. It must be regenerated from source to avoid drift.
- If a real proof asset needs a tracked static file instead of text-only content, define the source location and generation approach before implementation rather than dropping unmanaged assets into the generated output directory.

**Handoff instructions for `@imon-engine`**:
- Wait for explicit manual approval before executing this plan. Do not start Phase 1 automatically.
- Execute phases in order. Do not combine Phases 1-5 into one large patch unless an implementation dependency makes separation impractical.
- Keep docs aligned in the same change set as each implemented phase, especially `docs/northline-hosting.md`, `docs/northline-launch-checklist.md`, and `docs/playbook.md` when public promises or action-page flow change.
- Do not edit `runtime/agency-site/` directly. Regenerate it with `npm run dev -- build-agency-site`.
- If real proof material is missing, stop before Phase 2 completion and surface the content gap instead of shipping invented testimonials or outcomes.