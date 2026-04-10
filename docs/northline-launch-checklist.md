# Northline Launch Checklist

This is the owner-facing checklist for taking Northline Growth Systems from repo scaffolding to a real revenue lane.

## Repo Side

The repo now covers:

- a stronger Northline homepage under `runtime/agency-site/index.html` with one primary CTA to the leak review, a lower-friction live-review path, and section navigation that explains the offer instead of loading the header with competing asks
- proof and trust sections that stay hidden on the homepage until a real hosted external signup or public proof artifact exists, then show what gets reviewed, what comes back, the reply window, and target-trade fit before pricing asks
- a review-first pricing ladder that shows Lead Generation and Pilot Launch by default, keeps cold traffic in leak review or live review first, moves the first public checkout into a lower qualified-buyer block once fit is already clear, and only reveals Growth System after real delivered proof exists
- an after-the-first-win Growth System upgrade panel that reads any configured coupon copy or dedicated discounted checkout link from business-scoped Northline profile data, but only after real delivered proof exists
- mobile breakpoints that shorten the homepage hero, keep the optional trust-and-trade strip compact once it is earned, and bring the live-review and leak-review forms earlier in the viewport on smaller screens
- a self-hosted live-review page under `runtime/agency-site/book.html` that only asks for business, contact, email, phone, page URL, review window, and one short problem summary while keeping the supporting guidance in one lighter sidebar instead of stacked nested panels
- a public leak-review page under `runtime/agency-site/intake.html` that explains the one-business-day reply window, keeps only page URL, main problem, and optional market context beyond the core contact fields, and uses a calmer support rail instead of multiple boxed callouts
- a baseline privacy page under `runtime/agency-site/privacy.html`
- a generated launch checklist under `runtime/agency-site/launch-checklist.md`
- a generated Northline launch dossier under `runtime/ops/northline-growth-system/`
- a generated Northline autonomy summary under `runtime/ops/northline-growth-system/autonomy-summary.json`
- proof bundles under `runtime/reports/proof-bundles/<client-id>/` plus a durable proof bundle registry in `runtime/state/proofBundles.json`
- handoff packages under `runtime/reports/handoff-packages/<client-id>/` with a JSON manifest and README for client-managed publication, including a Growth upgrade section when the retained client started on Lead Generation
- retention reports under `runtime/reports/<client-id>-retention.json` that now carry structured Growth upgrade data for Lead Generation clients when the broader rollout path is configured
- hosted proof publication under `runtime/agency-site/proof/<client-id>/` once delivered-client proof bundles exist, while internal validation and manual-only preview fixtures stay excluded from the public proof cards
- explicit proof-cohort metadata on `runtime/state/clients.json`, where only `provenance=external_inbound|external_outbound` plus `proofEligible=true` can count toward Northline proof and operating-mode promotion
- explicit acquisition-pipeline metadata on Northline leads, where repo-generated prospect feeds now carry `pipeline=agency_client_acquisition` and any future customer-demand work for signed operators must stay in a separate `pipeline=client_demand_generation` feed
- a controlled-launch `validation-proof` readiness item in the default Northline dossier that stays blocked until one real Stripe-backed `/validation.html` run succeeds end to end
- automated VPS-backed outreach sends for approved Northline drafts, with delivery receipts persisted on each draft in `runtime/state/outreach.json`
- a shared promotion queue in `runtime/state/growthQueue.json` plus `runtime/ops/growth-queue.{json,md}` that can carry Facebook and Instagram-ready Northline social posts for worker-driven publishing
- teaser PNG assets under `runtime/agency-site/social/` for each queued Northline promotion post
- a generated Northline prospect collection summary under `runtime/ops/northline-growth-system/prospect-collection-summary.json`
- a generated Northline prospect sourcing summary under `runtime/ops/northline-growth-system/prospect-sourcing-summary.json`
- updated buyer-language headline, CTA, homepage navigation, workflow, and FAQ copy in source so booked jobs, missed calls, quote requests, and after-hours follow-up stay clearer than internal service language
- buyer-facing live-review and leak-review aliases like `contactName`, `pageUrl`, `targetArea`, `targetJobs`, `reviewWindow`, and `mainProblem` that still normalize into the canonical stored submission payload for Northline autonomy
- Northline launch blockers and owner actions in the managed-business defaults
- a repo-owned intake endpoint that can be hosted from the VPS at `/api/northline-intake`
- a hosted validation page and webhook path that can auto-confirm the Northline system check after Stripe records the checkout
- live Northline Facebook and Instagram surfaces in the social-profile scaffolding when their public URLs are configured

Refresh the dossier with:

- `npm run dev -- northline-plan`
- `npm run dev -- northline-promotion-queue --business auto-funding-agency`
- `npm run dev -- northline-profile-show --business auto-funding-agency --probe-payments`
- `npm run dev -- northline-collect-prospects --force`
- `npm run dev -- northline-source-prospects`
- `npm run dev -- northline-autonomy-run --notify-roadblocks`
- `npm run dev -- build-agency-site`
- `npm run test:northline-site-ui`
- `npm run dev -- northline-site-health`
- `npm run dev -- engine-sync`

Keep the hosted proof page running on the VPS with:

- `scripts/install-northline-site-service.sh`

## Owner Roadblocks

Northline already has these surfaced in `.env.example`:

- `NORTHLINE_NAME`
- `NORTHLINE_SALES_EMAIL`
- `NORTHLINE_SITE_URL`
- `NORTHLINE_DOMAIN`
- `NORTHLINE_PRIMARY_SERVICE_AREA`
- `NORTHLINE_PROSPECT_COLLECTION_AREAS`
- `NORTHLINE_PROSPECT_COLLECTION_TRADES`
- `NORTHLINE_FACEBOOK_URL`
- `NORTHLINE_INSTAGRAM_URL`
- `NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING`
- `NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD`
- `NORTHLINE_STRIPE_PAYMENT_LINK_VALIDATION`
- `NORTHLINE_STRIPE_WEBHOOK_SECRET`

You still need to do the account-bound work that the repo cannot complete alone:

- keep `NORTHLINE_LEAD_FORM_ACTION=/api/northline-intake` if you want the VPS-hosted proof page to own intake
- keep `NORTHLINE_BOOKING_URL=/book.html` if you want the repo-hosted booking page live, or replace it later with a real calendar link
- set `NORTHLINE_PROSPECT_COLLECTION_AREAS` if you want automated collection beyond the primary service area that Northline already uses by default
- adjust `NORTHLINE_PROSPECT_COLLECTION_TRADES` if Northline should emphasize a narrower home-services mix than the default plumbing, HVAC, electrical, roofing, and cleaning trades
- use `northline-profile-update --business <id> --file <json>` when a non-default agency business needs its own Northline targeting, proof-page copy, or payment-link overrides
- run `northline-payment-check --business <id>` before launch day so the resolved Stripe payment links are probed from the repo side
- point Stripe `checkout.session.completed` events for the validation payment link at `https://northlinegrowthsystems.com/api/northline-stripe-webhook` or the matching live `NORTHLINE_SITE_URL` before relying on automatic hosted validation handoff
- drop refreshed CSV or JSON lead feeds into `runtime/prospect-sources/northline/` or set `NORTHLINE_PROSPECT_SOURCE_DIR` if you want to supplement the repo-generated OSM feeds before outreach drafting
- use `/validation.html` for the low-risk Northline system check once the webhook secret is installed; keep `northline-billing-handoff` for non-validation proposals or any paid intake that does not come through the validation page
- on `/validation.html`, submit the validation intake before opening Stripe so the page can mint the hosted confirmation token and the `validation:<submission-id>` checkout reference
- use the low-risk diagnostic order before any broad rerun: `northline-site-health`, then `northline-payment-check --business <id>`, then `northline-inbox-sync --business <id>`. Only use `northline-validation-run --submission latest` after `/validation.html` has been submitted at least once, and only use `northline-autonomy-run --notify-roadblocks` after you have intentionally accepted any live send risk.
- rerun `northline-autonomy-run --notify-roadblocks` after the first real `/validation.html` checkout so the dossier recalculates proof-of-life and clears stale direct-billing or branded-inbox approval tasks when the live config is already present
- treat SMTP as optional during controlled launch; leave it as a hardening task until automated notices are actually needed
- optionally set `NORTHLINE_PHONE` if you want a forwarding line for sales calls
- optionally verify Google Business Profile and create the review-request link
- optionally set `NORTHLINE_GOOGLE_BUSINESS_PROFILE_URL` and `NORTHLINE_GOOGLE_REVIEW_URL`
- set `NORTHLINE_LINKEDIN_URL` if LinkedIn will be part of the proof surface
- keep the shared Meta browser session signed into the umbrella business workspace if you want queued Northline Facebook promotion posts to publish through the existing worker path without a Page access token
- set `META_INSTAGRAM_ACCESS_TOKEN` or confirm that `META_PAGE_ACCESS_TOKEN` already has Instagram publishing scope before treating queued Instagram posts as a live automated lane
- point `northlinegrowthsystems.com` at the VPS later if you want the branded domain live instead of the temporary VPS URL and port

## Proof Before Scale

Do not try to scale Northline on ads or heavy automation before these are done:

- review the latest Playwright screenshots in `output/playwright/` to confirm the homepage CTA hierarchy, shorter hero height, hidden-by-default proof and trust surfaces, leaner live-review and leak-review sidebars, qualified checkout gate, and the leak-review response-window copy still look correct on desktop and mobile
- confirm the pricing section still makes the order obvious: Lead Generation review first for cold traffic, Pilot Launch as the first public checkout, Growth System only after real delivered proof exists, and the later upgrade panel only shows configured link or coupon terms once proof is live
- keep `npm run dev -- northline-site-serve` running long enough to confirm `npm run dev -- northline-site-health` still reports the current site root and submission store before launch approval
- complete one real `/validation.html` system check after the Stripe webhook endpoint is live so the persisted status panel and automatic hosted handoff are verified before real traffic depends on them
- if Stripe charges before the intake is stored, treat that as an unreconciled payment until the session is attached back to a stored validation submission; do not mark `validation-proof` complete on the charge alone
- confirm `runtime/state/northlineValidationConfirmations.json` and the default dossier now show `validation-proof` as live after that real check
- use controlled generated brands only for internal end-to-end rehearsals before the first three real operators exist; keep those client records at `provenance=internal_validation|internal_manual` with `proofEligible=false` so they can exercise intake, billing, delivery, QA, proof-bundle packaging, and handoff without advancing the proof cohort
- do not count `legacy_unverified`, `internal_manual`, or `internal_validation` client records as Northline proof; only explicitly external clients with real delivery artifacts should move the proof cohort forward
- do not count `legacy_unverified`, `internal_manual`, or `internal_validation` client records as Northline revenue either; retained revenue and retained-client metrics should only move on explicitly external `external_inbound|external_outbound` records
- keep internal validation and manual-only preview proof bundles off the public homepage even if their screenshots exist in repo state
- if any generated-brand screenshots, copy, or bundles are shown outside the repo for review, label them as mock or simulated; do not present them as customer proof
- keep the active Northline mail path healthy before relying on automated outreach sends: VPS browser session for Gmail CDP, or IMAP plus SMTP credentials for the Zoho-backed mailbox path
- confirm `approval-payment-links` and `approval-sales-inbox` are no longer left waiting when the live Stripe links and branded inbox are already configured; missing SMTP can stay waiting until notification automation is required
- close the first three real operators through outbound or direct referrals
- collect three real testimonials or review quotes
- confirm the proof bundle loop is capturing screenshots under `runtime/reports/proof-bundles/<client-id>/` and publishing the copied proof assets under `runtime/agency-site/proof/<client-id>/`
- confirm the handoff-package loop is writing `runtime/reports/handoff-packages/<client-id>/README.md` with clear client and developer publishing steps plus the Growth upgrade section when the client is on Lead Generation
- confirm any Lead Generation client retention report under `runtime/reports/<client-id>-retention.json` carries the configured Growth upgrade link or coupon terms verbatim instead of inventing new discount language
- refresh `northline-promotion-queue` and confirm the shared growth queue contains the next Facebook and Instagram-ready Northline proof posts plus their teaser assets before relying on worker-driven self-promotion
- publish teardown-style proof posts on the Northline page, Facebook, Instagram, or LinkedIn
- verify that queued Instagram posts have a public teaser image URL before treating the Instagram lane as operational
- use `examples/briefs/northline-pilot-template.json` for the first tracked pilot client record
- use `npm run dev -- create-client --brief examples/briefs/northline-generated-brand-template.json --generated-brand` when you want a realistic internal rehearsal client that cannot accidentally advance proof, promotion, or revenue gates

## Channel Order

Use this sequence:

1. Publish the proof page and hosted intake.
2. Run outbound to 50-100 operators in one niche or metro.
3. Keep Northline's own operator-acquisition leads separate from any later homeowner or end-customer demand feeds for retained clients.
4. Use generated-brand rehearsals only to pressure-test the workflow before real operator volume exists; they do not replace the real proof-client gate.
5. Close the first three proof clients.
6. Let the repo-generated proof bundle package the testimonial and review asks immediately after delivery, then send them.
7. Add Google Search or LSA-support landing pages after the close path is proven.
8. Add Meta for remarketing, lead forms, or retargeting once traffic exists.

## Manual Gates

Northline is intentionally not fully hands-off yet. Keep these checkpoints explicit:

- outreach compliance review or sender-failure recovery before a blocked draft is treated as sent
- billing handoff when a proposal or hosted intake becomes paid or retainer-active
- validation-page webhook setup before the automated system-check path is treated as live
- client-managed publish troubleshooting only when the operator's host or developer needs a manual intervention
- QA fix review when the automated preview fails QA
