### Plan: Northline Site Conversion Rework

**Goal**: Rework the Northline proof site so cold home-service operators understand the offer faster, see credible proof earlier, face less form friction, and reach a clearer next step on desktop and mobile before wider traffic is sent to the site.

**Subsystems touched**: northline

**Prerequisites**:
- Treat `runtime/agency-site/` as generated output only. Make durable changes in `src/services/agency-site.ts`, `src/domain/defaults.ts`, and any supporting Northline source files, then regenerate the site with `npm run dev -- build-agency-site`.
- Keep the existing `NORTHLINE_BOOKING_URL`, `NORTHLINE_LEAD_FORM_ACTION`, and Stripe payment-link flow intact while the CTA hierarchy and copy are reworked, unless a step intentionally updates both the copy and the routing behavior together.
- Have repo dependencies installed before validation so `npx ts-node scripts/test-northline-site-ui.ts`, `npm test`, and `npm run build` can run locally.
- If form fields are removed, renamed, or reprioritized, update the generated HTML and the `POST /api/northline-intake` submission handling in the same change so booking and intake do not drift out of sync.

**Steps**:

| # | Task | Files to change | Docs to update | Depends on |
|---|------|----------------|----------------|------------|
| 1 | Reframe the homepage offer, hero copy, and CTA hierarchy around booked jobs, missed leads, and one primary next step | `src/domain/defaults.ts`, `src/services/agency-site.ts` | `docs/northline-hosting.md`, `docs/northline-launch-checklist.md` | — |
| 2 | Add stronger proof and trust surfaces near the top of the homepage so the page earns confidence before pricing or checkout asks | `src/domain/contracts.ts`, `src/domain/defaults.ts`, `src/services/agency-site.ts` | `docs/northline-hosting.md`, `docs/northline-launch-checklist.md` | Step 1 |
| 3 | Simplify the booking and intake forms, rewrite the side panels around outcomes and expectations, and clarify what happens after submission | `src/services/agency-site.ts`, `src/services/northline-site-server.ts`, `src/workflows.test.ts` | `docs/northline-hosting.md`, `docs/northline-launch-checklist.md` | Step 1 |
| 4 | Tighten mobile typography, spacing, and section density so the headline, proof, and CTA land earlier on small screens across home, book, and intake | `src/services/agency-site.ts` | `docs/northline-launch-checklist.md` | Steps 1-3 |
| 5 | Expand Northline UI regression coverage to the homepage, booking page, and intake page, then run Playwright and review screenshots before sign-off | `scripts/test-northline-site-ui.ts`, `src/workflows.test.ts`, `src/services/agency-site.ts` | `docs/northline-hosting.md`, `docs/northline-launch-checklist.md` | Steps 1-4 |

**Validation**:
- Run `npm run dev -- build-agency-site` and confirm the regenerated `runtime/agency-site/index.html`, `runtime/agency-site/book.html`, and `runtime/agency-site/intake.html` reflect the new copy, CTA ordering, and simplified form structure.
- Run `npm run dev -- northline-site-serve` and confirm `npm run dev -- northline-site-health` still reports a healthy hosted site.
- Run Playwright explicitly with `npx ts-node scripts/test-northline-site-ui.ts`; extend that script first if needed so it captures and validates the homepage, booking page, and intake page at desktop and mobile breakpoints.
- Review the generated screenshots under `output/playwright/` to verify the revised layout, CTA visibility, and form states visually, not just through assertions.
- Run `npm test` to confirm the Northline workflow assertions still match the updated page copy and form behavior.
- Run `npm run build` to confirm the TypeScript build still passes after the content and test updates.

**Risks & notes**:
- `src/workflows.test.ts` currently asserts existing booking copy, so copy changes will fail tests unless the expectations are updated in the same patch.
- `scripts/test-northline-site-ui.ts` currently covers the homepage and validation flow more than the booking and intake pages; extend it rather than assuming those screens are already protected.
- If stronger proof sections need more structured content than the current `AgencyProfile` supports, update `src/domain/contracts.ts` and `src/domain/defaults.ts` together instead of hardcoding more ad hoc strings into `buildAgencySite()`.
- Do not edit files under `runtime/agency-site/` directly; they are generated artifacts and will be overwritten on the next site build.