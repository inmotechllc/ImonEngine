# Setup

## Minimum

- Node 24+
- An approval email address
- A business domain and sending inbox when outbound starts

## Environment Variables

- `OPENAI_API_KEY`: enables AI scoring, outreach, site copy, and retention reports.
- `OPENAI_MODEL_FAST`: low-cost model for classification and draft generation.
- `OPENAI_MODEL_DEEP`: stronger model for site composition and deeper reports.
- `IMON_ENGINE_NAME`, `IMON_ENGINE_TIMEZONE`
- `IMON_ENGINE_HOST_LABEL`, `IMON_ENGINE_HOST_PROVIDER`, `IMON_ENGINE_HOST_IP`
- `IMON_ENGINE_MAX_CONCURRENT_BUSINESSES`
- `IMON_ENGINE_CPU_TARGET`, `IMON_ENGINE_MEMORY_TARGET`, `IMON_ENGINE_MIN_DISK_FREE_GB`
- `GUMROAD_SELLER_EMAIL`, `GUMROAD_PROFILE_URL`
- `BUSINESS_NAME`, `BUSINESS_PHONE`, `BUSINESS_SALES_EMAIL`, `BUSINESS_SITE_URL`, `BUSINESS_DOMAIN`
- `STRIPE_PAYMENT_LINK_FOUNDING`, `STRIPE_PAYMENT_LINK_STANDARD`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_PAGES_PROJECT`

## First Live Run

1. Run `npm run bootstrap`.
2. Review `runtime/ops/engine-overview.json` and `runtime/state/businesses.json`.
3. Review `runtime/state/approvals.json`.
4. If the digital asset store is your first live lane, add `GUMROAD_SELLER_EMAIL` first and run `npm run dev -- seed-asset-packs`.
5. Fill only the setup tasks that apply to the currently active businesses. Stripe and business email can wait while the digital asset store is the only live lane.
6. Import a real prospect list with `npm run dev -- prospect --input <file>`.
7. Review outreach drafts in `runtime/state/outreach.json`.
8. Convert a paying client with `create-client`, then build and QA the site.
9. Add Cloudflare credentials and run `deploy`.
10. For VPS staging, copy the repo to the server and run `scripts/bootstrap-vps.sh`, then `scripts/install-cron.sh`.
