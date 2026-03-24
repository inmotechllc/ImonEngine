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
5. Stage the chosen pack with `npm run dev -- stage-asset-pack --pack <id>`.
6. When the generated pack is complete but not live yet, run `npm run dev -- ready-asset-pack --pack <id>`.
7. After the product is published on Gumroad, record it with `npm run dev -- publish-asset-pack --pack <id> --url <gumroad-url>`.
8. Run `npm run dev -- engine-sync` so ImonEngine reflects the published product.
9. Run `npm run dev -- vps-artifacts` if the VPS reports or cron-facing artifacts need a refresh.
10. Run `npm run dev -- venture-studio` to refresh the current launch windows, business blueprints, and capital-experiment policy.
11. Fill only the setup tasks that apply to the currently active businesses. Stripe and business email can wait while the digital asset store is the only live lane.
12. Import a real prospect list with `npm run dev -- prospect --input <file>`.
13. Review outreach drafts in `runtime/state/outreach.json`.
14. Convert a paying client with `create-client`, then build and QA the site.
15. Add Cloudflare credentials and run `deploy`.
16. For VPS staging, copy the repo to the server and run `scripts/bootstrap-vps.sh`, then `scripts/install-cron.sh`.
17. Start the persistent VPS Chrome profile with `scripts/vps-browser-start.sh` if you need browser-based auth or automation on the server.
18. Verify the VPS toolchain with `scripts/vps-tooling-status.sh`.
19. Start isolated business sandboxes with `scripts/business-worker-start.sh <business-id> "<business-name>"` when a new brand needs its own containerized workspace.
