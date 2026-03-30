# Auto-Funding

ImonEngine-based portfolio controller for multiple AI businesses, with the original home-services agency preserved as one managed lane. The repo now ships a file-backed operations stack that can register businesses, watch VPS capacity, consolidate revenue, rank launch order, and still run the original agency workflow for prospecting, outreach, delivery, and retention.

## What It Does

- Boots an `ImonEngine` parent layer that tracks managed businesses, portfolio readiness, and VPS resource pressure.
- Seeds a ranked rollout queue: digital asset store, niche content sites, faceless social brand, micro-SaaS factory, print-on-demand, then the original agency lane.
- Consolidates portfolio-level revenue and cost signals with JSON-backed state.
- Writes VPS bootstrap and cron artifacts for a Contabo/OpenClaw style host.
- Generates a Gumroad-first digital asset launch queue with pack manifests, listing copy, and production checklists.
- Builds an Imonic POD operating system with design prompts, Shopify-ready listing drafts, collection plans, growth loops, ad gates, analytics, and revenue guardrails.
- Imports public business lists from CSV or JSON and converts them into typed `LeadRecord` objects.
- Scores prospects for a home-services website and follow-up offer using heuristics by default, or OpenAI when `OPENAI_API_KEY` is available.
- Drafts compliant outreach with approval fallbacks written to email or `runtime/notifications/`.
- Creates `ClientJob` records from intake briefs, builds static landing pages, and runs QA checks before deploy.
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
npm run dev -- build-site --client sunrise-plumbing
npm run dev -- qa --client sunrise-plumbing
npm run dev -- retain --client sunrise-plumbing
```

## Commands

- `npm run dev -- bootstrap`
- `npm run dev -- prospect --input <file>`
- `npm run dev -- daily-run --input <file>`
- `npm run dev -- create-client --brief <file>`
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
- `npm run dev -- northline-plan [--business auto-funding-agency]`
- `npm run dev -- northline-site-serve`
- `npm run dev -- northline-site-health`
- `npm run dev -- micro-saas-plan [--business imon-micro-saas-factory] [--notify-roadblocks]`
- `npm run dev -- pod-plan --business imon-pod-store --reference-dir <path> [--notify-roadblocks]`
- `npm run dev -- pod-autonomy --business imon-pod-store --reference-dir <path> [--notify-roadblocks]`
- `npm run dev -- asset-packs`
- `npm run dev -- approvals`
- `npm run dev -- report`
- `npm run dev -- build-agency-site`

## Required Owner Actions

- Add `OPENAI_API_KEY` if you want model-generated scoring, copy, and reports instead of fallback heuristics.
- Add `NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING` and `NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD` before taking Northline live.
- Connect a real `NORTHLINE_SALES_EMAIL` inbox. SMTP is optional unless you want live approval or intake notifications.
- Keep `NORTHLINE_LEAD_FORM_ACTION=/api/northline-intake` if you want the VPS-hosted proof page to own intake submissions.
- Keep `NORTHLINE_BOOKING_URL=/book.html` if you want the repo-hosted booking page to stay live beside the intake form.
- Add Cloudflare Pages credentials before running `deploy`.
- Review `docs/northline-launch-checklist.md` and the generated `runtime/agency-site/launch-checklist.md` before taking Northline live.
- Run `northline-plan` to generate the current Northline launch dossier under `runtime/ops/northline-growth-system/`.

## State Layout

- `runtime/state/engine.json`
- `runtime/state/businesses.json`
- `runtime/state/businessRuns.json`
- `runtime/state/assetPacks.json`
- `runtime/state/resourceSnapshots.json`
- `runtime/state/revenueLedger.json`
- `runtime/state/engineReports.json`
- `runtime/state/leads.json`
- `runtime/state/clients.json`
- `runtime/state/outreach.json`
- `runtime/state/approvals.json`
- `runtime/reports/*.json`
- `runtime/previews/<client-id>/`
- `runtime/agency-site/`
- `runtime/ops/micro-saas-businesses/<business-id>/`
- `runtime/ops/pod-businesses/<business-id>/`

## Notes

- The system is intentionally conservative: it creates approval tasks instead of guessing through payments, marketplace access, email, or deployment when account credentials are missing.
- `ImonEngine` does not auto-activate new businesses blindly. It ranks what should launch next and checks the VPS before you promote another business into the active set.
- The first live business path is Gumroad-first. `IMON_STORE_GUMROAD_SELLER_EMAIL` is enough to connect the seller identity before you buy a Northline inbox.
- After a Gumroad product goes live, record it with `publish-asset-pack`, then run `engine-sync` so ImonEngine reflects the live store state.
- When a generated pack is complete but not yet published, mark it with `ready-asset-pack` so the queue distinguishes upload-ready products from drafts.
- Run `northline-plan` when you want the current Northline proof-page audit, outbound sprint, proof checklist, and launch blockers written to disk.
- Run `northline-site-serve` when you want the repo to host the Northline proof page and intake endpoint directly.
- Run `micro-saas-plan` when you are ready to operationalize QuietPivot Labs; it writes a concrete product backlog, launch calendar, social plan, income stack, and blocker list under `runtime/ops/micro-saas-businesses/`.
- Run `pod-autonomy` when you are ready to operationalize Imonic; it writes the launch plan, storefront engine, growth engine, analytics, revenue guardrails, and owner checklist under `runtime/ops/pod-businesses/`.
- `.env.example` is the canonical business-scoped config file in this workspace, and `.env` is treated as an optional fallback layer for keys that are still missing there.
- Outreach validation rejects guarantee language and unsupported performance claims by default.
- The stack is file-backed so it can run before you add a database or hosted queue.
