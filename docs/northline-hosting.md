# Northline Hosting

This lane can run as a lightweight VPS-hosted proof page without a separate CMS, booking stack, or third-party form tool.

## Repo Commands

- `npm run dev -- build-agency-site`
- `npm run test:northline-site-ui`
- `npm run dev -- northline-plan`
- `npm run dev -- northline-promotion-queue [--business auto-funding-agency]`
- `npm run dev -- northline-profile-show [--business auto-funding-agency] [--probe-payments]`
- `npm run dev -- northline-profile-update --business <id> --file <json> [--replace] [--skip-payment-probe]`
- `npm run dev -- northline-payment-check [--business auto-funding-agency] [--skip-probe]`
- `npm run dev -- northline-collect-prospects [--business auto-funding-agency] [--force]`
- `npm run dev -- northline-source-prospects [--business auto-funding-agency]`
- `npm run dev -- northline-inbox-sync [--business auto-funding-agency]`
- `npm run dev -- northline-autonomy-run [--business auto-funding-agency] [--notify-roadblocks]`
- `npm run dev -- northline-billing-handoff --client <id> --status paid|retainer_active [--form-endpoint <url>] [--next-action <text>]`
- `npm run dev -- northline-validation-run [--business auto-funding-agency] [--submission latest|<id>] [--status paid|retainer_active] [--form-endpoint <url>]`
- `npm run dev -- northline-site-serve`
- `npm run dev -- northline-site-health`

## Business Profile Resolution

Northline commands resolve the selected `--business` from the managed business roster, not just from the global `NORTHLINE_*` env block.

- The durable business profile lives on `ManagedBusiness.northlineProfile` in `runtime/state/businesses.json`.
- `northlineProfile` can override `primaryServiceArea`, `collectionAreas`, `collectionTrades`, `targetIndustries`, `targetServices`, `offerSummary`, `salesEmail`, `siteUrl`, `domain`, `bookingUrl`, `leadFormAction`, `stripeLeadGeneration`, `stripeFounding`, `stripeStandard`, structured `growthUpgrade` metadata, `stripeValidation`, and the proof-page `agencyProfile`. Those stable payment fields still back the public Lead Generation, Pilot Launch, and Growth System ladder through each tier's `paymentLinkKey` metadata.
- `collectionAreas` accepts literal markets such as `Cleveland, OH` and the special `nationwide:us` alias. That alias expands to the current primary service area first, then the curated nationwide U.S. market list the collector uses for broad prospecting.
- Lead scoring, outreach drafting, autonomy queues, and business-office lead views now treat the resolved `collectionAreas` or fallback `primaryServiceArea` as the active market scope. When a business narrows from nationwide to a local area, stale out-of-area leads stay in historical state but are no longer surfaced for that business unless their stored market, collection area, or geo still matches the current scope.
- Northline lead records now carry explicit `pipeline` metadata. The repo-generated Northline collector and sourcing flow writes `pipeline=agency_client_acquisition`, which means those records are businesses Northline is trying to sell to. Future customer-demand leads for signed operators must stay in a separate `pipeline=client_demand_generation` feed so they do not leak into Northline's own outbound queue.
- `auto-funding-agency` still falls back to `NORTHLINE_*` env values when a field is not set on the stored business record.
- `build-agency-site` and `northline-site-serve` render from the resolved default Northline business profile, so stored business overrides, including payment-link overrides, carry through to the hosted proof page.
- `build-agency-site` and `northline-site-serve` also publish stored Northline proof bundles from `runtime/state/proofBundles.json`, copying their screenshots into `runtime/agency-site/proof/` so delivered-client proof stays available as repo-owned artifacts without a separate CMS. Public proof still requires an explicitly external, proof-eligible client with non-placeholder contact details plus a delivered, QA-passed bundle; internal validation artifacts, manual-only preview fixtures, and placeholder test records stay excluded from those proof bundles.

## Profile Admin And Payment Checks

- `northline-profile-show` prints the stored profile, the resolved operational profile, and the business-scoped runtime paths. Add `--probe-payments` when you want it to probe the resolved Stripe links as part of that inspection.
- `northline-profile-update --business <id> --file <json>` applies a sanitized JSON patch to `ManagedBusiness.northlineProfile`. Pass `--replace` if the file should replace the stored profile instead of merging with it.
- When the patch includes `agencyProfile`, use the same structured fields the proof page renders: `proofPoints` entries need `stat`, `label`, and `detail`; `trustSignals` entries need `label`, `title`, and `body`.
- When the patch includes `agencyProfile.pricing`, each tier now carries a stable `id` plus optional `paymentLinkKey`, `cta`, and `upgradeOffer` metadata so the public site can stop depending on anonymous array positions. The hosted homepage sorts the standard tier ids (`lead-generation`, `pilot-launch`, `growth-system`), shows Lead Generation and Pilot Launch by default, keeps the Growth System card and later upgrade panel hidden until real delivered proof exists, uses the tier CTA metadata for the review-first card action, and renders the qualified checkout block only from the payment-link-backed tiers that are currently allowed to surface.
- `northline-payment-check` validates the resolved Northline payment paths for the selected business by mapping the stable `lead_generation`, `founding`, and `standard` keys back to the current pricing labels. Pilot Launch and Growth System are the required qualified-checkout links; Lead Generation is still reported, but it stays optional while the public Lead Generation CTA remains review-first. By default it makes a lightweight HTTP probe; `--skip-probe` limits the check to URL and host validation. The optional `growthUpgrade.paymentLink` is reported alongside those links when it is configured.
- Payment checks confirm that the link looks usable from the repo's point of view. They do not replace a real Stripe checkout. Automatic validation-page handoff now depends on `NORTHLINE_STRIPE_WEBHOOK_SECRET`, and non-validation proposal billing can use the same webhook path when the checkout carries `client_reference_id=client:<client-id>:paid|retainer_active`. Keep `northline-billing-handoff` as the fallback when a payment link did not carry a repo-owned client reference or needs a manual override.
- When `northline-site-serve` is live, each stored booking or leak-review submission also queues the same Northline autonomy pass immediately instead of waiting only for the next scheduled wrapper run.
- Validation-page submissions now receive a hosted confirmation token, a Stripe checkout reference, and a server-backed status route so `/validation.html` can persist the payment and handoff state across reloads. The validation page should store the intake before it unlocks the checkout button; that stored submission is what lets the Stripe link carry the `validation:<submission-id>` reference the webhook needs. When `NORTHLINE_STRIPE_WEBHOOK_SECRET` is configured, Stripe `checkout.session.completed` events trigger the hosted validation handoff automatically. `northline-validation-run` remains the CLI fallback.
- `northline-validation-run --submission latest` still requires at least one stored `/validation.html` submission in `NORTHLINE_SUBMISSION_STORE_PATH`. If no validation-page submission exists yet, the command exits before it records any billing handoff or delivery state. Use it only after the validation page has actually been submitted once.
- The default Northline dossier now reads `runtime/state/northlineValidationConfirmations.json` as its controlled-launch proof source. The lane stays blocked until at least one `/validation.html` run records both a Stripe completion and a successful hosted validation result.

## Autonomy Loop

`northline-autonomy-run` is the file-backed Northline operating pass for the agency lane.

- Refreshes the Northline launch dossier under `runtime/ops/northline-growth-system/` for the default business, or `runtime/ops/northline-growth-system/<business-id>/` for other agency businesses
- Refreshes deterministic Northline prospect feeds for the configured markets on the collection cadence, starting with OSM/Overpass and then supplementing with AI-assisted public web search when OpenAI web research is configured
- Processes changed CSV or JSON prospect feeds from `NORTHLINE_PROSPECT_SOURCE_DIR`
- Reads hosted submissions from `NORTHLINE_SUBMISSION_STORE_PATH`
- Promotes complete submissions into proposal-stage `ClientJob` records under `runtime/state/clients.json`, stamping hosted booking or intake submissions as `provenance=external_inbound` with `proofEligible=true`
- Stamps `/validation.html` submissions as `provenance=internal_validation` with `proofEligible=false`, and leaves older client records without explicit proof metadata in `legacy_unverified` until an operator reclassifies them deliberately
- The engine and Northline run reports now count retained revenue only from clients whose explicit or resolved provenance is `external_inbound` or `external_outbound`. `internal_validation`, `internal_manual`, and other rehearsal-only records stay visible in state for workflow validation, but they no longer count as customer revenue or acquisition work.
- Refreshes `runtime/state/approvals.json`, completing stale direct-billing and branded-inbox tasks when that config is already live, keeping SMTP as a waiting hardening task for approval notifications and SMTP fallback sends during controlled launch, and only opening explicit outbound manual gates when compliance or sender delivery fails
- Completed approvals now reset their owner instructions to a no-action-needed message, and repo flows that pass `reopenCompleted: false` no longer overwrite the stored completion text on an already-completed task.
- Attempts to send approved outreach drafts automatically through the configured Northline outbound channel. When the shared or overridden inbox provider resolves to `imap`, outbound defaults to SMTP; Gmail CDP remains available when explicitly selected.
- Persists outbound send receipts back into each draft record in `runtime/state/outreach.json` so retries and manual recovery do not depend on shell history
- Syncs replies for sent Northline leads through `scripts/sync_northline_inbox_imap.py` when the shared or overridden inbox provider resolves to `imap`, otherwise through `scripts/sync_northline_inbox.py`, stores deduplicated reply history in `runtime/state/leadReplies.json`, and routes positive replies into booked-call or intake-follow-up work without relying on manual message files
- Keeps `northline-inbox-sync` as the low-risk reply-path probe. A clean targeted inbox run can close the reply-sync approval directly without requiring a full autonomy pass.
- Auto-builds and auto-QA's Northline clients after the billing handoff is recorded, refreshes proof bundles for QA-passed work, generates a client handoff package with publish instructions, and closes any stale legacy deploy approvals that no longer apply to the default lane
- Generates a proof bundle for each QA-passed Northline delivery, including desktop/mobile preview screenshots, testimonial and review-request drafts, and publication-ready proof copy stored on the client plus `runtime/state/proofBundles.json`
- Generates a handoff package for each QA-passed Northline delivery under `runtime/reports/handoff-packages/<client-id>/`, including a JSON manifest and a README that starts with a plain-language publish path, a copy-forward section for the client's web person, a non-technical fallback for owners using hosting support or freelancers, and a `Growth upgrade path` section when the retained client started on Lead Generation
- Writes `runtime/reports/<client-id>-retention.json` with structured `upgradeOffer` data for Lead Generation clients so the retained artifact can carry the configured Growth upgrade checkout, coupon label, terms, and next-step language instead of a single freeform upsell string
- Resolves legacy client preview paths against the current host's `runtime/previews/<client-id>/` directory before QA, proof refresh, or handoff packaging so older pilots can still be republished after a repo move or VPS sync
- Rewrites both `runtime/ops/northline-growth-system/plan.{json,md}` and `runtime/ops/northline-growth-system/autonomy-summary.{json,md}` after the queue work finishes so promotion criteria, proof counts, and manual gates reflect the same post-run state
- Targeted commands such as `northline-inbox-sync`, `northline-payment-check`, and manual approval updates can advance `runtime/state/approvals.json` after the last full autonomy pass. If you have not rerun `northline-autonomy-run` yet, treat the targeted command output plus `runtime/state/approvals.json` as current state and treat the last autonomy summary as historical.
- Refreshes the shared `runtime/state/growthQueue.json` plus `runtime/ops/growth-queue.{json,md}` with Facebook and Instagram-ready Northline promotion posts derived from the current social plan whenever those live surfaces are configured
- Generates teaser PNG assets for those queue items under `runtime/agency-site/social/` so the hosted Northline site can serve the same public image URLs the Instagram publisher needs
- Refreshes `runtime/ops/northline-growth-system/autonomy-summary.json` plus the matching markdown summary, or the matching business-scoped summary path for non-default businesses
- The hosted site server queues that same autonomy pass immediately after each stored submission when the site is live; the scheduled/manual `northline-autonomy-run` remains the backstop when the server is offline


`northline-promotion-queue` is the manual version of that promotion refresh. It regenerates the Northline-derived entries inside the shared growth queue, refreshes the teaser assets under `runtime/agency-site/social/`, and preserves other businesses' queue items in the same file-backed registry.


`northline-collect-prospects` runs only the external collection pass. It resolves collection areas and trades from the selected business profile, resolves the configured markets through Nominatim, queries Overpass for the configured trades, then, when OpenAI web research is configured, supplements those feeds with public web-search leads prioritized from free sources such as official sites, public business profiles, BBB, Yelp, chamber directories, and other public local directories. The collector writes deterministic `auto-osm-*.json` files into the business source directory, caches market bounds in the matching collection state file, and refreshes the matching prospect-collection summary under `runtime/ops/northline-growth-system/`. HTTP fetches and web-research enrichment now run with explicit timeouts, the Overpass pass retries across the managed mirror list before a market is marked failed, and a failed market clears its stale managed feed so sourcing does not keep scoring old data.

`northline-source-prospects` runs only the file-backed sourcing pass. It watches `runtime/prospect-sources/northline/` by default for `auto-funding-agency`, or `runtime/prospect-sources/northline/<business-id>/` for other agency businesses, processes only changed CSV or JSON files, writes the matching sourcing state file, and refreshes the matching prospect-sourcing summary. The shared state writers now commit JSON and text artifacts through a temp-file-plus-rename path so live autonomy, collection, and sourcing runs do not leave malformed `runtime/state/*.json` files when multiple processes touch the same records.

Lead scoring now normalizes stage from score before the sourced lead is saved, so high-fit prospects cannot get stranded in `prospecting` when the model returns an inconsistent stage label. Outbound drafting also treats any high-scoring Northline lead with a public email as draftable even if an older record is still tagged `prospecting`, which lets the live queue recover after staging drift without hand-editing lead state.

`northline-billing-handoff` is the safe fast path for delivery outside the hosted validation flow. Use it to mark a Northline proposal as `paid` or `retainer_active` and optionally attach the live form endpoint before the next autonomy run when the payment did not come through `/validation.html`, when the Stripe checkout did not carry `client_reference_id=client:<client-id>:paid|retainer_active`, or when a client needs a manual override.

Approved outreach drafts no longer stop at a standing manual send-approval step. `northline-autonomy-run` now uses the configured Northline outbound channel, writes the latest send receipts into `runtime/state/outreach.json`, syncs replies through the configured inbox helper (`scripts/sync_northline_inbox_imap.py` for IMAP or `scripts/sync_northline_inbox.py` for Gmail CDP), and only opens an outbound manual gate when compliance, delivery, or inbox access fails.

The business metrics that `northline-autonomy-run` writes back now reuse the same scoped active-work calculation as `engine-sync`, so a focused metro profile keeps its in-scope qualified or contacted work visible in `runtime/state/businesses.json` instead of collapsing that count to only manual gates and roadblocks.

Internal validation artifacts still stay hidden from the visible Northline billing and handoff queues, and proposal-stage internal validation clients now also auto-complete any stale billing-handoff approval instead of reopening customer-facing approval work in `runtime/state/approvals.json`.

Northline social scaffolding now promotes the configured `NORTHLINE_FACEBOOK_URL` and `NORTHLINE_INSTAGRAM_URL` into live social-profile records instead of leaving them as plan-only placeholders. The shared promotion queue now has automated publishing paths for `facebook_page` and `instagram_account`; Facebook can use either the Meta Graph API or the signed-in page browser flow, while Instagram requires a public teaser image plus a Meta access token with Instagram publishing scope. LinkedIn still remains a proof or planning surface until a repo publisher exists for it.

## Expected Northline Config

- `NORTHLINE_SITE_URL`: public URL you want prospects to see
- `NORTHLINE_DOMAIN`: inbox domain
- `NORTHLINE_SALES_EMAIL`: branded inbox
- `NORTHLINE_BOOKING_URL=/book.html`
- `NORTHLINE_LEAD_FORM_ACTION=/api/northline-intake`
- `INBOX_PROVIDER=imap|gmail_cdp` (shared default for the Zoho-owned mailbox path)
- `OUTBOUND_CHANNEL=smtp|gmail_cdp` (shared default; resolves to `smtp` automatically when the inbox provider is `imap`)
- `NORTHLINE_INBOX_ALIAS_FILTER` (recommended when the branded Northline alias lands in a shared or super-admin mailbox)
- `IMAP_HOST`, `IMAP_PORT`, `IMAP_SECURE`, `IMAP_USER` (shared Zoho mailbox defaults)
- `NORTHLINE_IMAP_MAILBOX` (business-scoped mailbox selection)
- `NORTHLINE_ZOHO_APP_PASS` or `NORTHLINE_IMAP_PASS` (business-scoped auth override when Northline should not use the shared SMTP or IMAP password)
- `NORTHLINE_INBOX_PROVIDER`, `NORTHLINE_OUTBOUND_CHANNEL`, `NORTHLINE_IMAP_HOST`, `NORTHLINE_IMAP_PORT`, `NORTHLINE_IMAP_SECURE`, `NORTHLINE_IMAP_USER`, `NORTHLINE_IMAP_PASS` (optional per-business overrides; these still take precedence when set)
- `NORTHLINE_PROSPECT_SOURCE_DIR` (optional; defaults to `runtime/prospect-sources/northline`)
- `NORTHLINE_PROSPECT_COLLECTION_AREAS` (optional; defaults to `NORTHLINE_PRIMARY_SERVICE_AREA`; set it to `nationwide:us` to expand from the current home market into the curated nationwide U.S. list)
- `NORTHLINE_PROSPECT_COLLECTION_TRADES` (optional; defaults to `plumbing;hvac;electrical;roofing;cleaning`)
- `NORTHLINE_PROSPECT_COLLECTION_INTERVAL_HOURS` (optional; defaults to `24`)
- `NORTHLINE_PROSPECT_COLLECTION_MAX_RECORDS_PER_TRADE` (optional; defaults to `20`)
- `NORTHLINE_STRIPE_PAYMENT_LINK_LEAD_GENERATION` (optional while Lead Generation stays review-first; add it when Northline wants a dedicated smaller-step checkout)
- `NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING`
- `NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD`
- `NORTHLINE_STRIPE_PAYMENT_LINK_GROWTH_UPGRADE` (optional but preferred for the Lead Generation to Growth System upgrade path)
- `NORTHLINE_GROWTH_UPGRADE_COUPON_LABEL` (optional text fallback when the discounted upgrade still uses a manual coupon or the standard Growth System link)
- `NORTHLINE_GROWTH_UPGRADE_COUPON_TERMS` (optional text fallback for the upgrade timing or discount rules)
- `NORTHLINE_STRIPE_PAYMENT_LINK_VALIDATION`
- `NORTHLINE_STRIPE_WEBHOOK_SECRET` (optional; enables automatic `/validation.html` handoff from Stripe webhook events)
- `NORTHLINE_SITE_BIND_HOST=0.0.0.0`
- `NORTHLINE_SITE_PORT=4181`
- `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN` for shared Meta publishing
- `META_INSTAGRAM_ACCOUNT_ID` (optional override) and `META_INSTAGRAM_ACCESS_TOKEN` (optional when the page token already has Instagram publishing scope)

When `META_PAGE_ACCESS_TOKEN` is missing, the repo falls back to the signed-in Facebook browser session and switches into the live Northline Page before posting. When Instagram account discovery needs a page id, the repo first uses the business-scoped `facebook_page` record in `runtime/state/socialProfiles.json` and only falls back to `META_PAGE_ID` when that record does not carry an external id.

For automated outbound sends, keep the active sender path healthy. Gmail CDP mode needs the VPS browser signed into the Northline inbox that matches `NORTHLINE_SALES_EMAIL`. IMAP mode expects the shared `IMAP_*` settings or business-scoped `NORTHLINE_IMAP_*` overrides, plus either the shared SMTP or IMAP password or `NORTHLINE_ZOHO_APP_PASS`, and typically uses SMTP as the outbound channel when `SMTP_*` and `NORTHLINE_SMTP_FROM` are configured.

Cloudflare Pages credentials and the older `NORTHLINE_AUTO_DEPLOY_*` toggles are not required for the default Northline delivery model. The standard lane now ends in a client handoff package, not a repo-managed production publish. Keep those settings only if you still run the standalone deployer outside the normal Northline workflow.

The repo currently uses one Northline Stripe setup with business-specific payment links, not separate Stripe accounts per offer. Keep any raw Stripe account or API credentials in private env storage instead of the tracked `.env.example`. Those env vars remain the fallback defaults for `auto-funding-agency`; alternate Northline businesses can override them on `northlineProfile`.

## VPS Service

The repo includes:

- `scripts/run-northline-site.sh`
- `scripts/install-northline-site-service.sh`
- `scripts/install-northline-nginx-proxy.sh`
- `scripts/install-northline-certbot.sh`

`install-northline-site-service.sh` installs a systemd unit named `imon-engine-northline-site.service` and serves the generated site on the configured Northline port.
`install-northline-nginx-proxy.sh` installs an nginx reverse proxy on port `80` and forwards standard web traffic to the Northline service on port `4181`.
`install-northline-certbot.sh` adds TLS after the domain is already pointed at the VPS and nginx is live.

When you verify the public Northline site on the VPS, assume the live service is running from `/opt/imon-engine` unless you intentionally repointed the systemd unit. The workspace checkout under `/root/ImonEngine` is the source-edit tree, but the public domain and its runtime state usually come from the deployed copy.

That means live validation and intake checks should inspect `/opt/imon-engine/runtime/state/northlineIntakeSubmissions.json`, `/opt/imon-engine/runtime/state/northlineValidationConfirmations.json`, and `/opt/imon-engine/runtime/ops/northline-growth-system/plan.md` before treating a missing workspace-side runtime file as a hosted-flow failure.

## Domain Cutover

The repo-hosted proof page now includes:

- `/` as the Northline conversion-first homepage with one primary CTA to the leak review, a lower-friction live-review path in supporting copy and lower-page CTAs, section navigation that stays informational instead of action-heavy, and pricing kept below proof instead of competing with the hero ask
- `/book.html` for live review requests
- `/intake.html` for the quick leak review
- `/validation.html` for the internal low-risk checkout and post-payment system check
- `/api/northline-intake` for stored submissions
- `/api/northline-validation-confirm` for the explicit hosted validation handoff after the checkout succeeds or when you need the manual fallback button
- `/api/northline-validation-status` for the server-backed validation status panel on `/validation.html`
- `/api/northline-stripe-webhook` for verified Stripe `checkout.session.completed` events that can auto-trigger the validation handoff or promote tracked proposal clients when the checkout carries a repo-owned client reference

The current Northline site model is intentionally simple:

- homepage first, leak-review first: the homepage is framed around booked jobs, missed calls, quote-request drop-off, and one primary next step before pricing or checkout asks
- buyer language first: the homepage hero, masthead section links, live-review page, and leak-review page talk about booked jobs, missed calls, quote requests, after-hours follow-up, what gets fixed, and what comes back next instead of internal operator-system terms or action-heavy navigation
- proof stays off the homepage: the public page does not render a dedicated proof section, even after real external proof exists
- delivered proof loop: once a real client delivery reaches QA pass, the repo still generates the stored proof bundle plus copied assets under `runtime/agency-site/proof/<client-id>/`; those artifacts support internal review and the Growth System gate, while internal validation and manual-only preview artifacts stay excluded
- validation stays off the buyer path: `/validation.html` remains available for controlled launch checks, but it should not be linked from the normal public footer or cold-traffic journey
- qualification before checkout: pricing cards now render a review-first ladder from the structured tier ids, keep cold visitors in the leak review or the live review first, show Lead Generation and Pilot Launch before any monthly path, and keep direct checkout in a lower qualified-buyer block that starts with Pilot Launch
- structured upgrade path: when real delivered proof exists and `growthUpgrade` copy or a dedicated discounted link is configured, the homepage shows the later Growth System upgrade panel without hard-coded coupon text in the template
- low-friction forms: the live-review page now asks only for business, contact, email, phone, page URL, review window, and one short problem summary, while the leak-review page keeps optional service-area and target-job context without forcing a long intake
- response clarity: the leak-review page promises a one-business-day next step so operators know when to expect either the async review, a live-review recommendation, or one request for missing detail
- canonical storage: `POST /api/northline-intake` normalizes newer buyer-facing aliases like `contactName`, `pageUrl`, `targetArea`, `targetJobs`, `reviewWindow`, and `mainProblem`, plus the earlier short-field aliases, back into the canonical stored submission payload used by Northline autonomy and workflow tests
- validation defaults: hosted validation runs now default the generated preview form action to the live Northline intake endpoint when no explicit form endpoint is supplied, so the automatic webhook path can still complete QA cleanly

If the domain stays on GoDaddy-managed DNS, point the root A record to `158.220.99.144` and point `www` to the same host. The VPS can then reverse-proxy standard web traffic to the Northline service.
After the A record change has propagated and `http://northlinegrowthsystems.com` reaches the VPS, run `scripts/install-northline-certbot.sh northlinegrowthsystems.com` so `https://northlinegrowthsystems.com` matches the current Northline site URL.

## Intake Storage

- Submissions are written to `NORTHLINE_SUBMISSION_STORE_PATH`
- Hosted submissions can arrive through the newer `contactName`, `pageUrl`, `targetArea`, `targetJobs`, `reviewWindow`, and `mainProblem` aliases or the earlier short-field names, but the site server stores the normalized canonical payload so downstream Northline services still see `ownerName`, `serviceArea`, `primaryServices`, `preferredCallWindow`, `leadGoal`, and `biggestLeak`
- When those submissions become `ClientJob` records, `runtime/state/clients.json` now carries explicit `provenance` and `proofEligible` fields so proof-cohort metrics stop inferring proof from note text or legacy defaults
- When `northline-site-serve` is live, each stored submission queues an immediate background autonomy pass. That pass promotes complete submissions into tracked proposal work and leaves incomplete submissions behind an owner-review approval task. The next scheduled or manual `northline-autonomy-run` still acts as the backstop if the hosted server was offline.
- Validation-page submissions also write hosted confirmation state to `runtime/state/northlineValidationConfirmations.json`, including the latest hosted result, the latest observed Stripe checkout metadata, and a deduped list of processed Stripe event ids so automatic and manual retries stay safe from the hosted page.
- On the VPS, those live state files normally exist under `/opt/imon-engine/runtime/state/` because that is where the public site service runs. If `/root/ImonEngine/runtime/state/` disagrees, treat `/opt/imon-engine` as the live truth until the workspace and deployed copies are synced deliberately.
- Proposal-payment webhook runs append the Stripe event id, checkout reference, and customer email to the matching client's intake notes when the checkout carries a repo-owned client reference.
- If a checkout is completed before `/validation.html` stores the intake, Stripe can still charge successfully but the webhook will not have a matching submission reference to attach. In that case, the checkout does not satisfy `validation-proof` until the paid session is reconciled to a stored validation submission.
- That confirmation file also drives the default dossier's `validation-proof` readiness item, so controlled launch is not treated as proven until one record shows both the Stripe completion and a successful hosted result.
- When you need a live-safe proof recompute after a hosted validation event, `cd /opt/imon-engine && npm run dev -- northline-plan --business auto-funding-agency` is the lowest-risk way to refresh the dossier before deciding whether a broader `northline-autonomy-run` is necessary.
- Notifications are written to `runtime/notifications/northline-intake-latest.txt`
- If `SMTP_*` is configured, the server also emails the intake notification. Without SMTP, Northline can still run in controlled-launch mode, but automated SMTP sends and approval notifications stay unavailable until those credentials are configured.

## UI Validation

- Run `npm run dev -- build-agency-site` before visual checks so `runtime/agency-site/index.html`, `runtime/agency-site/book.html`, `runtime/agency-site/intake.html`, and `runtime/agency-site/validation.html` match the current source.
- Run `npm run test:northline-site-ui` to execute the Playwright regression for homepage, booking, and intake on desktop and mobile, including the hidden homepage proof sections, the proof-gated Growth System pricing, the qualified-checkout gate, the Lead Generation upgrade panel, shortened alias-based forms, and the intake thank-you redirect.
- Review `output/playwright/home-desktop.png`, `output/playwright/home-mobile.png`, `output/playwright/book-desktop.png`, `output/playwright/book-mobile.png`, `output/playwright/intake-desktop.png`, and `output/playwright/intake-mobile.png` after the run.
- Use `output/playwright/report.json` as the machine-readable review artifact for headings, CTAs, labels, section ids, and overflow checks captured during the same Playwright run.
- Review `runtime/reports/proof-bundles/<client-id>/proof-bundle.json` plus the copied site assets under `runtime/agency-site/proof/<client-id>/` after the first delivered-client proof bundle is generated.
- Review `runtime/reports/<client-id>-retention.json` after `retain --client <id>` or the automated retention refresh when the client is on Lead Generation; the `upgradeOffer` block should match the configured Growth checkout or coupon terms and should not invent discount values.
- Review `runtime/reports/handoff-packages/<client-id>/README.md` after QA passes so the `Start here`, `Fastest publish path`, `Send this to your web person`, `If you do not have a developer`, and conditional `Growth upgrade path` sections are clear before the delivery is marked complete.
- Before launch approval, keep `npm run dev -- northline-site-serve` running in one terminal and run `npm run dev -- northline-site-health` in another so the hosted site still reports ready with the current generated site root and submission store path.

## Prospect Source Storage

- Source feeds are read from `NORTHLINE_PROSPECT_SOURCE_DIR`, which defaults to `runtime/prospect-sources/northline/` for the default Northline business.
- Non-default `--business` runs append the business id under that source root, for example `runtime/prospect-sources/northline/<business-id>/`.
- Repo-generated market feeds are written into that folder as deterministic `auto-osm-<market>.json` files. Those files start with OSM/Overpass results and can also include web-search-enriched public leads when OpenAI web research is configured. When the business profile uses `nationwide:us`, the collector writes one managed feed per expanded market.
- Those managed market feeds now stamp `pipeline=agency_client_acquisition` at both the file and record level. Keep any end-customer lead generation for signed Northline clients in separate feeds marked `pipeline=client_demand_generation` so sourcing, draft generation, and office views do not mix Northline's own sales prospects with deliverables for retained operators.
- The default business keeps collection, sourcing, and autonomy state at `runtime/state/northlineProspectCollection.json`, `runtime/state/northlineProspectSourcing.json`, and `runtime/state/northlineAutonomy.json`.
- Non-default businesses write those files under `runtime/state/northline/<business-id>/`.
- The default business keeps summaries under `runtime/ops/northline-growth-system/`; non-default businesses use `runtime/ops/northline-growth-system/<business-id>/`.
- The latest collection summary is written to `runtime/ops/northline-growth-system/prospect-collection-summary.json` for the default business, or the matching business-scoped summary path for other businesses.
- Changed CSV or JSON files are processed once until their contents change again
- The latest sourcing summary is written to `runtime/ops/northline-growth-system/prospect-sourcing-summary.json` for the default business, or the matching business-scoped summary path for other businesses.
- Repo-generated and imported Northline leads carry `market`, `trade`, `collectionArea`, `targetIndustries`, `targetServices`, `offerSummary`, and `matchReasons` into scoring and outreach.

The collector cadence defaults to once every 24 hours. Use `northline-collect-prospects --force` when you need the repo to bypass that interval and refresh the generated feeds immediately.

You can launch on the VPS IP and port first, then point the Northline domain to the VPS later. Phone, Google Business Profile, and review links are optional for the initial faceless outbound model.
