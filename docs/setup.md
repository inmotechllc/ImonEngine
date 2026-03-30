# Setup

## Minimum

- Node 24+
- An approval email address
- A business domain and sending inbox when outbound starts

## Environment Variables

- `OPENAI_API_KEY`: enables AI scoring, outreach, site copy, and retention reports.
- `OPENAI_MODEL_FAST`: low-cost model for classification and draft generation.
- `OPENAI_MODEL_DEEP`: stronger model for site composition and deeper reports.
- Shared engine and infra:
  `IMON_ENGINE_NAME`, `IMON_ENGINE_TIMEZONE`,
  `IMON_ENGINE_HOST_LABEL`, `IMON_ENGINE_HOST_PROVIDER`, `IMON_ENGINE_HOST_IP`,
  `IMON_ENGINE_MAX_CONCURRENT_BUSINESSES`,
  `IMON_ENGINE_CPU_TARGET`, `IMON_ENGINE_MEMORY_TARGET`, `IMON_ENGINE_MIN_DISK_FREE_GB`
- Shared owner and platform access:
  `APPROVAL_EMAIL`,
  `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`,
  `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_PAGES_PROJECT`,
  `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN`
- Imon Digital Asset Store:
  `IMON_STORE_GUMROAD_SELLER_EMAIL`, `IMON_STORE_GUMROAD_PROFILE_URL`,
  `IMON_STORE_SITE_URL`, `IMON_STORE_EMAIL_CAPTURE_ACTION`, `IMON_STORE_EMAIL_CAPTURE_EMAIL`,
  `IMON_STORE_MAX_NEW_PACKS_7D`, `IMON_STORE_MAX_PUBLISHED_PACKS`, `IMON_STORE_MAX_ASSET_TYPE_SHARE`,
  `IMON_STORE_MAX_OPEN_PACK_QUEUE`, `IMON_STORE_POSTS_PER_WEEK`, `IMON_STORE_GROWTH_QUEUE_DAYS`,
  `IMON_STORE_TAX_RESERVE_RATE`, `IMON_STORE_REINVESTMENT_RATE`, `IMON_STORE_REFUND_BUFFER_RATE`,
  `IMON_STORE_CASHOUT_THRESHOLD`
- Imonic:
  `IMONIC_SHOPIFY_STORE_DOMAIN`, `IMONIC_SHOPIFY_ADMIN_ACCESS_TOKEN`,
  `IMONIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN`, `IMONIC_SHOPIFY_LOCATION_ID`,
  `IMONIC_PRINTIFY_API_TOKEN`, `IMONIC_PRINTIFY_SHOP_ID`, `IMONIC_PRINTFUL_API_TOKEN`
- Northline Growth Systems:
  `NORTHLINE_NAME`, `NORTHLINE_PHONE`, `NORTHLINE_SALES_EMAIL`, `NORTHLINE_SITE_URL`,
  `NORTHLINE_DOMAIN`, `NORTHLINE_BOOKING_URL`, `NORTHLINE_LEAD_FORM_ACTION`,
  `NORTHLINE_PRIMARY_SERVICE_AREA`, `NORTHLINE_GOOGLE_BUSINESS_PROFILE_URL`,
  `NORTHLINE_GOOGLE_REVIEW_URL`, `NORTHLINE_FACEBOOK_URL`, `NORTHLINE_INSTAGRAM_URL`,
  `NORTHLINE_LINKEDIN_URL`, `NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING`,
  `NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD`, `NORTHLINE_SITE_BIND_HOST`,
  `NORTHLINE_SITE_PORT`, `NORTHLINE_SUBMISSION_STORE_PATH`
- QuietPivot Labs, Northbeam Atlas Network, and Velora Echo Media currently have reserved sections in `.env.example` so future lane-specific keys do not collide with the live businesses.
- `.env.example` is the canonical business-scoped config file in this workspace. `.env` is optional and only fills gaps that are still missing there.
- Legacy generic keys still load as fallbacks for now, but new setup should use the business-scoped names from `.env.example`.

## First Live Run

1. Run `npm run bootstrap`.
2. Review `runtime/ops/engine-overview.json` and `runtime/state/businesses.json`.
3. Review `runtime/state/approvals.json`.
4. If the digital asset store is your first live lane, add `IMON_STORE_GUMROAD_SELLER_EMAIL` first and run `npm run dev -- seed-asset-packs`.
5. Stage the chosen pack with `npm run dev -- stage-asset-pack --pack <id>`.
6. When the generated pack is complete but not live yet, run `npm run dev -- ready-asset-pack --pack <id>`.
7. After the product is published on Gumroad, record it with `npm run dev -- publish-asset-pack --pack <id> --url <gumroad-url>`.
8. Run `npm run dev -- engine-sync` so ImonEngine reflects the published product.
9. Run `npm run dev -- vps-artifacts` if the VPS reports or cron-facing artifacts need a refresh.
10. Run `npm run dev -- venture-studio` to refresh the current launch windows, business blueprints, and capital-experiment policy.
11. Run `npm run dev -- northline-plan` when you are ready to operationalize Northline beyond the public site and need the current surface audit, outbound sprint, proof checklist, and blocker list.
12. Run `npm run dev -- build-agency-site` to regenerate the Northline proof page.
13. Run `npm run dev -- northline-site-serve` if you want the VPS to host the proof page and intake endpoint directly.
14. Run `npm run dev -- micro-saas-plan --business imon-micro-saas-factory` when you are ready to operationalize QuietPivot Labs beyond the generic venture blueprint.
15. Fill only the setup tasks that apply to the currently active businesses. Northline phone, Google Business Profile, and review keys are optional while the faceless proof-page pipeline is the focus. The repo-hosted booking page can stay at `NORTHLINE_BOOKING_URL=/book.html`.
16. Import a real prospect list with `npm run dev -- prospect --input <file>`.
17. Review outreach drafts in `runtime/state/outreach.json`.
18. Convert a paying client with `create-client --brief examples/briefs/northline-pilot-template.json`, then build and QA the site.
19. Add Cloudflare credentials and run `deploy`.
20. For VPS staging, copy the repo to the server and run `scripts/bootstrap-vps.sh`, then `scripts/install-cron.sh`.
21. Run `scripts/install-northline-site-service.sh` on the VPS if you want a persistent Northline proof-page service on port `4181`.
22. Run `scripts/install-northline-nginx-proxy.sh` on the VPS if you want the domain to terminate on standard HTTP port `80` instead of `:4181`.
23. After the domain resolves to the VPS, run `scripts/install-northline-certbot.sh northlinegrowthsystems.com` so the live proof page works over HTTPS.
24. Start the persistent VPS Chrome profile with `scripts/vps-browser-start.sh` if you need browser-based auth or automation on the server.
25. Verify the VPS toolchain with `scripts/vps-tooling-status.sh`.
26. Start isolated business sandboxes with `scripts/business-worker-start.sh <business-id> "<business-name>"` when a new brand needs its own containerized workspace.
