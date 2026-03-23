# Setup

## Minimum

- Node 24+
- An approval email address
- A business domain and sending inbox when outbound starts

## Environment Variables

- `OPENAI_API_KEY`: enables AI scoring, outreach, site copy, and retention reports.
- `OPENAI_MODEL_FAST`: low-cost model for classification and draft generation.
- `OPENAI_MODEL_DEEP`: stronger model for site composition and deeper reports.
- `BUSINESS_NAME`, `BUSINESS_PHONE`, `BUSINESS_SALES_EMAIL`, `BUSINESS_SITE_URL`, `BUSINESS_DOMAIN`
- `STRIPE_PAYMENT_LINK_FOUNDING`, `STRIPE_PAYMENT_LINK_STANDARD`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_PAGES_PROJECT`

## First Live Run

1. Run `npm run bootstrap`.
2. Review `runtime/state/approvals.json`.
3. Fill the payment and email setup tasks first.
4. Import a real prospect list with `npm run dev -- prospect --input <file>`.
5. Review outreach drafts in `runtime/state/outreach.json`.
6. Convert a paying client with `create-client`, then build and QA the site.
7. Add Cloudflare credentials and run `deploy`.
