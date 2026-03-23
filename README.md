# Auto-Funding

Autonomous revenue engine for a home-services productized agency. The repo ships a file-backed operations stack that can import and score prospects, draft compliant outreach, queue human approvals, build static client landing pages, run QA gates, prepare deployment handoff, and generate monthly retention reports.

## What It Does

- Imports public business lists from CSV or JSON and converts them into typed `LeadRecord` objects.
- Scores prospects for a home-services website and follow-up offer using heuristics by default, or OpenAI when `OPENAI_API_KEY` is available.
- Drafts compliant outreach with approval fallbacks written to email or `runtime/notifications/`.
- Creates `ClientJob` records from intake briefs, builds static landing pages, and runs QA checks before deploy.
- Generates operational run reports and monthly retention reports with review-response drafts and upsell ideas.
- Builds an agency marketing site for inbound traffic at `runtime/agency-site/`.

## Quick Start

1. Copy `.env.example` to `.env` and fill in the fields you have.
2. Install dependencies with `npm install`.
3. Bootstrap the workspace:

```bash
npm run bootstrap
```

4. Run the sample pipeline:

```bash
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
- `npm run dev -- approvals`
- `npm run dev -- report`
- `npm run dev -- build-agency-site`

## Required Owner Actions

- Add `OPENAI_API_KEY` if you want model-generated scoring, copy, and reports instead of fallback heuristics.
- Add Stripe payment links for the founding and standard offers.
- Connect a real sales inbox and SMTP if you want live approval notifications.
- Add Cloudflare Pages credentials before running `deploy`.

## State Layout

- `runtime/state/leads.json`
- `runtime/state/clients.json`
- `runtime/state/outreach.json`
- `runtime/state/approvals.json`
- `runtime/reports/*.json`
- `runtime/previews/<client-id>/`
- `runtime/agency-site/`

## Notes

- The system is intentionally conservative: it creates approval tasks instead of guessing through payments, email, or deployment when account credentials are missing.
- Outreach validation rejects guarantee language and unsupported performance claims by default.
- The stack is file-backed so it can run before you add a database or hosted queue.
