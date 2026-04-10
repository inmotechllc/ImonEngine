# Auto-Funding

ImonEngine-based portfolio controller for multiple AI businesses, with the original home-services agency preserved as one managed lane. The repo now ships a file-backed operations stack that can register businesses, watch VPS capacity, consolidate revenue, rank launch order, and still run the original agency workflow for prospecting, outreach, delivery, and retention while staging new lanes such as ClipBaiters under explicit review gates.

## What It Does

- Boots an `ImonEngine` parent layer that tracks managed businesses, portfolio readiness, and VPS resource pressure.
- Seeds a ranked rollout queue: digital asset store, niche content sites, faceless social brand, the ClipBaiters clipping lane, micro-SaaS factory, print-on-demand, then the original agency lane.
- Registers ClipBaiters - Viral Moments as a separate compliance-gated business beside Velora so the YouTube-first clipping workflow can be built without replacing the broader faceless social placeholder.
- Stages ClipBaiters planning, source watchlists, discovery and skim summaries, lane-scoped draft packages, blocked publish queues, publish history, creator-lead and outreach state, creator-order intake, creator-deals reporting, revenue snapshots, manual review artifacts, and channel metrics in repo-visible runtime state while the channels are still under review and setup.
- Surfaces ClipBaiters workflow ownership, launch checklist, office-view execution lanes, and review-gated scheduled cadence through the org control plane and VPS sync artifacts.
- Consolidates portfolio-level revenue and cost signals with JSON-backed state.
- Writes VPS bootstrap and cron artifacts for a Contabo/OpenClaw style host.
- Generates a Gumroad-first digital asset launch queue with pack manifests, listing copy, and production checklists.
- Builds an Imonic POD operating system with design prompts, Shopify-ready listing drafts, collection plans, growth loops, ad gates, analytics, and revenue guardrails.
- Imports public business lists from CSV or JSON and converts them into typed `LeadRecord` objects.
- Collects Northline prospects from OpenStreetMap/Overpass into deterministic JSON feeds, with collection areas and trades resolved from the selected managed business profile, then watches only changed CSV or JSON source files before outreach drafting.
- Centralizes shared and business-specific AI route assignments in `src/ai/api-map.ts`, so provider, model, and base-URL swaps happen in one file instead of at each caller.
- Scores prospects against the selected Northline business profile's target industries, services, and offer summary using heuristics by default, or the configured AI route map when the selected route provider keys are available.
- Drafts compliant outreach with approval fallbacks written to email or `runtime/notifications/`.
- Creates `ClientJob` records from intake briefs, builds static landing pages, and runs QA checks before deploy.
- Runs a Northline autonomy pass that ingests hosted intake into tracked proposal work, keeps the default Northline lane in `controlled_launch` until proof-cohort criteria promote it to `autonomous`, auto-builds and QA's paid clients, and surfaces the remaining manual checkpoints explicitly in the plan and autonomy summary artifacts.
- Supports per-business Northline targeting through managed-business `northlineProfile` data, including service area, trade filters, offer summary, sender identity, and proof-page copy.
- Adds dedicated Northline profile admin commands so business-scoped `northlineProfile` data, including Lead Generation, Founding, Standard, and optional Growth-upgrade payment metadata, can be inspected and updated without hand-editing business state.
- Generates operational run reports and monthly retention reports with review-response drafts and upsell ideas.
- Builds a Northline proof-page surface at `runtime/agency-site/`, including the homepage, intake page, privacy page, and launch checklist.
- Can host the Northline proof page and intake endpoint directly from the VPS with a lightweight Node service.

## Quick Start

1. Fill the business-scoped sections in `.env.example`. If you want machine-local overrides, add only the missing values to `.env`.
2. Install dependencies with `npm install`.
3. Bootstrap the workspace:

```bash
npm run bootstrap
```

4. Run the sample pipeline:

```bash
npm run dev -- engine-report
npm run dev -- businesses
npm run dev -- seed-asset-packs
npm run dev -- asset-packs
npm run daily
npm run dev -- create-client --brief examples/briefs/sunrise-plumbing.json
npm run dev -- create-client --brief examples/briefs/northline-generated-brand-template.json --generated-brand
npm run dev -- build-site --client sunrise-plumbing
npm run dev -- qa --client sunrise-plumbing
npm run dev -- retain --client sunrise-plumbing
npm run dev -- northline-autonomy-run --notify-roadblocks
```

## Commands

- `npm run dev -- bootstrap`
- `npm run dev -- prospect --input <file>`
- `npm run dev -- daily-run --input <file>`
- `npm run dev -- create-client --brief <file> [--generated-brand]`
- `npm run dev -- build-site --client <id>`
- `npm run dev -- qa --client <id>`
- `npm run dev -- deploy --client <id>`
- `npm run dev -- retain --client <id>`
- `npm run dev -- handle-reply --lead <id> --message-file <file>`
- `npm run dev -- businesses`
- `npm run dev -- engine-sync`
- `npm run dev -- engine-report`
- `npm run dev -- activate-business --business <id>`
- `npm run dev -- pause-business --business <id>`
- `npm run dev -- vps-artifacts`
- `npm run dev -- seed-asset-packs`
- `npm run dev -- stage-asset-pack --pack <id>`
- `npm run dev -- ready-asset-pack --pack <id>`
- `npm run dev -- publish-asset-pack --pack <id> --url <gumroad-url>`
- `npm run dev -- social-profiles [--business <id>] [--all]`
- `npm run dev -- venture-studio [--business <id>]`
- `npm run dev -- clipbaiters-plan --business clipbaiters-viral-moments`
- `npm run dev -- clipbaiters-collect --business clipbaiters-viral-moments [--lane clipbaiters-political]`
- `npm run dev -- clipbaiters-skim --business clipbaiters-viral-moments [--lane clipbaiters-political]`
- `npm run dev -- clipbaiters-radar --business clipbaiters-viral-moments --lane clipbaiters-political`
- `npm run dev -- clipbaiters-autonomy-run --business clipbaiters-viral-moments [--lane clipbaiters-political] [--all-active-lanes] --dry-run`
- `npm run dev -- clipbaiters-publish --business clipbaiters-viral-moments [--lane clipbaiters-political] [--all-active-lanes] --dry-run`
- `npm run dev -- clipbaiters-source-creators --business clipbaiters-viral-moments`
- `npm run dev -- clipbaiters-draft-creator-outreach --business clipbaiters-viral-moments`
- `npm run dev -- clipbaiters-deals-report --business clipbaiters-viral-moments`
- `npm run dev -- clipbaiters-intake --business clipbaiters-viral-moments`
- `npm run dev -- clipbaiters-monetization-report --business clipbaiters-viral-moments`
- `npm run dev -- northline-plan [--business auto-funding-agency]`
- `npm run dev -- northline-profile-show [--business auto-funding-agency] [--probe-payments]`
- `npm run dev -- northline-profile-update --business <id> --file <json> [--replace] [--skip-payment-probe]`
- `npm run dev -- northline-payment-check [--business auto-funding-agency] [--skip-probe]`
- `npm run dev -- northline-collect-prospects [--business auto-funding-agency] [--force]`
- `npm run dev -- northline-source-prospects [--business auto-funding-agency]`
- `npm run dev -- northline-autonomy-run [--business auto-funding-agency] [--notify-roadblocks]`
- `npm run dev -- northline-billing-handoff --client <id> --status paid|retainer_active [--form-endpoint <url>] [--next-action <text>]`
- `npm run dev -- northline-site-serve`
- `npm run dev -- northline-site-health`
- `npm run dev -- micro-saas-plan [--business imon-micro-saas-factory] [--notify-roadblocks]`
- `npm run dev -- pod-plan --business imon-pod-store --reference-dir <path> [--notify-roadblocks]`
- `npm run dev -- pod-autonomy --business imon-pod-store --reference-dir <path> [--notify-roadblocks]`
- `npm run dev -- asset-packs`
- `npm run dev -- approvals`
- `npm run dev -- report`
- `npm run dev -- build-agency-site`

## Agent Context

- Repo-aware agent hub: `docs/autonomy/agents/README.md`
- Auto-documentation contract: `docs/autonomy/agents/auto-documentation.md`
- Structured context map: `docs/autonomy/agents/context-map.json`

Use these when you want an LLM or automation agent to work on ImonEngine with repo-specific context instead of generic coding defaults.

## AI Route Map

- Shared and business-specific AI assignments live in `src/ai/api-map.ts`.
- Current stage-1 defaults are `fast -> NVIDIA microsoft/phi-3.5-mini-instruct`, `deep -> NVIDIA deepseek-ai/deepseek-v3.1`, and `research -> OpenAI gpt-5` with `web_search_preview`.
- `AI_PROVIDER_NVIDIA_API_KEY` enables the shared `fast` and `deep` routes. `AI_PROVIDER_NVIDIA_BASE_URL` is optional and defaults to `https://integrate.api.nvidia.com/v1` when unset.
- Legacy `NVIDIA_API_KEY` still hydrates the NVIDIA provider during the migration window if your local `.env` already uses that older name.
- `AI_PROVIDER_OPENAI_API_KEY` keeps the `research` route active during the first NVIDIA migration window. Legacy `OPENAI_API_KEY` still hydrates the OpenAI provider config.
- Provider secrets and optional base-URL overrides stay in `.env` or private host env storage through `AI_PROVIDER_*` keys.
- Legacy `OPENAI_API_KEY`, `OPENAI_MODEL_FAST`, and `OPENAI_MODEL_DEEP` still hydrate the new config during the migration window, but the model override keys should stay unset unless you intentionally want to override the shared route models.

## Required Owner Actions

- Add `AI_PROVIDER_NVIDIA_API_KEY` if you want the shared `fast` and `deep` routes active on the current stage-1 NVIDIA defaults. Set `AI_PROVIDER_NVIDIA_BASE_URL` only when you need to override the default NVIDIA Catalog host.
- Keep `AI_PROVIDER_OPENAI_API_KEY` if you want the `research` route and `web_search_preview` path active during the first NVIDIA migration window. Legacy `OPENAI_API_KEY` still works during the migration window.
- Add `CLIPBAITERS_SHARED_ALIAS_EMAIL`, `CLIPBAITERS_CREATOR_CONTACT_EMAIL`, `CLIPBAITERS_CREATOR_BOOKING_URL`, `CLIPBAITERS_ACTIVE_LANES`, the per-lane `CLIPBAITERS_YOUTUBE_*_CHANNEL_URL` values, and any future Stripe or Relay planning metadata before moving ClipBaiters beyond planning. Optional `CLIPBAITERS_FACEBOOK_PAGE_ID` and `CLIPBAITERS_YOUTUBE_*_CHANNEL_ID` bindings tighten channel verification, but Facebook can stay deferred while the political and media YouTube lanes are the active rollout.
- Add `CLIPBAITERS_STREAMING_PAYMENT_LINK_RETAINER`, `CLIPBAITERS_STREAMING_PAYMENT_LINK_EVENT_PACK`, and `CLIPBAITERS_STREAMING_PAYMENT_LINK_RUSH_PACK` before sending live ClipBaiters creator offers; the monetization report opens approval tasks until those links exist.
- Keep raw ClipBaiters Stripe secret keys and unmasked Relay bank details out of the tracked `.env.example`; the repo uses payment-link readiness plus masked finance-planning metadata, not direct Stripe or bank automation.
- Add `NORTHLINE_STRIPE_PAYMENT_LINK_LEAD_GENERATION`, `NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING`, and `NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD` before taking the default Northline business live, or override those links per business through `northlineProfile`.
- Optionally add `NORTHLINE_STRIPE_PAYMENT_LINK_GROWTH_UPGRADE` plus `NORTHLINE_GROWTH_UPGRADE_COUPON_LABEL` and `NORTHLINE_GROWTH_UPGRADE_COUPON_TERMS` when Lead Generation clients should get a dedicated discounted Growth System upgrade path.
- Connect a real `NORTHLINE_SALES_EMAIL` inbox. SMTP is optional unless you want live approval or intake notifications.
- Keep `NORTHLINE_LEAD_FORM_ACTION=/api/northline-intake` if you want the VPS-hosted proof page to own intake submissions.
- Keep `NORTHLINE_BOOKING_URL=/book.html` if you want the repo-hosted booking page to stay live beside the intake form.
- Set `NORTHLINE_PROSPECT_COLLECTION_AREAS` if you want automated collection beyond the primary service area, and keep `NORTHLINE_PROSPECT_COLLECTION_TRADES` aligned with the home-services niches Northline should target.
- Drop refreshed CSV or JSON source feeds into `runtime/prospect-sources/northline/` or set `NORTHLINE_PROSPECT_SOURCE_DIR` if you want to supplement the repo-generated OSM feeds before outreach drafting.
- Use `northline-profile-update --business <id> --file <json>` when you want to update `northlineProfile` without hand-editing `runtime/state/businesses.json`; the default `auto-funding-agency` still falls back to `NORTHLINE_*` values when a field is missing.
- Run `northline-profile-show --business <id> --probe-payments` or `northline-payment-check --business <id>` before taking a business live so the resolved Lead Generation, Founding, and Standard Stripe links are checked for reachability and the optional Growth upgrade link is surfaced when configured.
- Keep raw Stripe API credentials out of the tracked `.env.example`; the repo currently uses public Northline payment links plus the webhook secret, not direct Stripe API administration.
- Add Cloudflare Pages credentials before running `deploy`.
- Review `docs/northline-launch-checklist.md` and the generated `runtime/agency-site/launch-checklist.md` before taking Northline live.
- Run `northline-plan` to generate the current Northline launch dossier under `runtime/ops/northline-growth-system/` and inspect the lane's current `operatingMode`, promotion criteria, and manual checkpoints.
- Run `northline-autonomy-run --business auto-funding-agency --notify-roadblocks` to refresh the Northline plan and autonomy summary, promote hosted intake into tracked proposal work, and recompute which operating-mode criteria are still missing.
- Use `northline-billing-handoff` when a hosted intake or proposal becomes paid so the autonomous build and QA path can start safely without waiting for Stripe ingestion.

## State Layout

- `runtime/state/engine.json`
- `runtime/state/businesses.json`
- `runtime/state/businessRuns.json`
- `runtime/state/assetPacks.json`
- `runtime/state/resourceSnapshots.json`
- `runtime/state/revenueLedger.json`
- `runtime/state/engineReports.json`
- `runtime/state/socialProfiles.json`
- `runtime/state/clipbaiters/<business-id>/`
- `runtime/state/clipbaiters/<business-id>/source-watchlists.json`
- `runtime/state/clipbaiters/<business-id>/video-discovery.json`
- `runtime/state/clipbaiters/<business-id>/skim-summaries.json`
- `runtime/state/clipbaiters/<business-id>/publish-history.json`
- `runtime/state/clipbaiters/<business-id>/creator-leads.json`
- `runtime/state/clipbaiters/<business-id>/creator-outreach.json`
- `runtime/state/clipbaiters/<business-id>/creator-offers.json`
- `runtime/state/clipbaiters/<business-id>/creator-orders.json`
- `runtime/state/clipbaiters/<business-id>/revenue-snapshots.json`
- `runtime/state/leads.json`
- `runtime/state/clients.json`
- `runtime/state/outreach.json`
- `runtime/state/approvals.json`
- `runtime/state/northlineIntakeSubmissions.json`
- `runtime/state/northlineAutonomy.json`
- `runtime/state/northlineProspectCollection.json`
- `runtime/state/northlineProspectSourcing.json`
- `runtime/state/northline/<business-id>/`
- `runtime/reports/*.json`
- `runtime/previews/<client-id>/`
- `runtime/agency-site/`
- `runtime/prospect-sources/northline/`
- `runtime/prospect-sources/northline/<business-id>/`
- `runtime/source-feeds/clipbaiters/<business-id>/`
- `runtime/source-feeds/clipbaiters/<business-id>/creator-orders/`
- `runtime/ops/clipbaiters/<business-id>/`
- `runtime/ops/clipbaiters/<business-id>/launch-checklist.md`
- `runtime/ops/clipbaiters/<business-id>/daily-summary.md`
- `runtime/ops/clipbaiters/<business-id>/creator-deals.md`
- `runtime/ops/clipbaiters/<business-id>/monetization-report.md`
- `runtime/ops/northline-growth-system/`
- `runtime/ops/northline-growth-system/<business-id>/`
- `runtime/ops/micro-saas-businesses/<business-id>/`
- `runtime/ops/pod-businesses/<business-id>/`

## Notes

- The system is intentionally conservative: it creates approval tasks instead of guessing through payments, marketplace access, email, or deployment when account credentials are missing.
- `ImonEngine` does not auto-activate new businesses blindly. It ranks what should launch next and checks the VPS before you promote another business into the active set.
- The first live business path is Gumroad-first. `IMON_STORE_GUMROAD_SELLER_EMAIL` is enough to connect the seller identity before you buy a Northline inbox.
- After a Gumroad product goes live, record it with `publish-asset-pack`, then run `engine-sync` so ImonEngine reflects the live store state.
- When a generated pack is complete but not yet published, mark it with `ready-asset-pack` so the queue distinguishes upload-ready products from drafts.
- Run `northline-plan` when you want the current Northline proof-page audit, outbound sprint, proof checklist, and launch blockers written to disk.
- Run `northline-profile-show --business <id>` when you want to inspect the stored and resolved Northline business profile plus business-scoped runtime paths.
- Run `northline-payment-check --business <id>` when you want to validate the resolved Stripe payment links before attempting a live checkout.
- Run `northline-collect-prospects --force` when you want the repo to refresh Northline's OSM/Overpass market feeds immediately instead of waiting for the normal collection cadence.
- Run `northline-source-prospects` when you want the repo to process newly dropped Northline source feeds without waiting for the full autonomy pass.
- Run `northline-autonomy-run --notify-roadblocks` when you want the repo to promote hosted intake, queue Northline gates, and advance paid clients through build and QA.
- Use `northline-billing-handoff` as the explicit fast-path billing confirmation until Stripe payment events are ingested automatically; `northline-payment-check` validates link readiness only and does not replace a real checkout.
- ClipBaiters now exposes the lane in org-control-plane and office-view artifacts, writes `runtime/ops/clipbaiters/<business-id>/launch-checklist.md`, schedules collect plus skim, all-active-lanes autonomy dry-run, all-active-lanes publish dry-run, creator-deals refreshes, and monetization refreshes on the VPS wrapper, and keeps controlled live uploads behind the persistent Chrome plus review gates.
- Use `create-client --generated-brand` with `examples/briefs/northline-generated-brand-template.json` when you want an internal rehearsal client that must stay non-proof-eligible until an operator reclassifies it.
- Run `northline-site-serve` when you want the repo to host the Northline proof page and intake endpoint directly.
- Run `micro-saas-plan` when you are ready to operationalize QuietPivot Labs; it writes a concrete product backlog, launch calendar, social plan, income stack, and blocker list under `runtime/ops/micro-saas-businesses/`.
- Run `pod-autonomy` when you are ready to operationalize Imonic; it writes the launch plan, storefront engine, growth engine, analytics, revenue guardrails, and owner checklist under `runtime/ops/pod-businesses/`.
- `.env.example` is the canonical business-scoped config file in this workspace, and `.env` is treated as an optional fallback layer for keys that are still missing there.
- Outreach validation rejects guarantee language and unsupported performance claims by default.
- Northline prospect collection resolves configured markets through Nominatim, queries Overpass for the configured trades, caches market bounds in `runtime/state/northlineProspectCollection.json`, and writes `runtime/ops/northline-growth-system/prospect-collection-summary.json`.
- Northline prospect sourcing reads changed CSV or JSON files from `runtime/prospect-sources/northline/` by default and writes its run summary under `runtime/ops/northline-growth-system/prospect-sourcing-summary.json`.
- Northline plan, collection, sourcing, and autonomy commands resolve the selected managed business's `northlineProfile` from `runtime/state/businesses.json`; the default `auto-funding-agency` keeps `NORTHLINE_*` env fallbacks.
- The default Northline business keeps the legacy root artifact paths, while other business IDs use `runtime/ops/northline-growth-system/<business-id>/`, `runtime/prospect-sources/northline/<business-id>/`, and `runtime/state/northline/<business-id>/`.
- The default Northline dossier and autonomy summary now expose `operatingMode.current`, `promotionCriteria`, `scheduledAutomation`, and `manualCheckpoints` so every run shows whether the lane is still in `controlled_launch` or has earned `autonomous` mode.
- Repo-generated Northline leads now carry target metadata such as market, trade, collection area, industries, services, and offer summary into scoring and outreach.
- Northline still keeps the irreducible manual checkpoints explicit: live payment authorization, disputed or ambiguous replies, public proof publication review, and exception deploy rollback.
- The stack is file-backed so it can run before you add a database or hosted queue.
