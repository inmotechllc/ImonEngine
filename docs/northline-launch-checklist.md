# Northline Launch Checklist

This is the owner-facing checklist for taking Northline Growth Systems from repo scaffolding to a real revenue lane.

## Repo Side

The repo now covers:

- a stronger Northline homepage under `runtime/agency-site/index.html`
- a self-hosted booking page under `runtime/agency-site/book.html`
- a public intake page under `runtime/agency-site/intake.html`
- a baseline privacy page under `runtime/agency-site/privacy.html`
- a generated launch checklist under `runtime/agency-site/launch-checklist.md`
- a generated Northline launch dossier under `runtime/ops/northline-growth-system/`
- updated Northline offer copy, workflow copy, and FAQ copy in source
- Northline launch blockers and owner actions in the managed-business defaults
- a repo-owned intake endpoint that can be hosted from the VPS at `/api/northline-intake`
- Meta/Facebook and Instagram planning in the social-profile scaffolding

Refresh the dossier with:

- `npm run dev -- northline-plan`
- `npm run dev -- build-agency-site`
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
- `NORTHLINE_FACEBOOK_URL`
- `NORTHLINE_INSTAGRAM_URL`
- `NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING`
- `NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD`

You still need to do the account-bound work that the repo cannot complete alone:

- keep `NORTHLINE_LEAD_FORM_ACTION=/api/northline-intake` if you want the VPS-hosted proof page to own intake
- keep `NORTHLINE_BOOKING_URL=/book.html` if you want the repo-hosted booking page live, or replace it later with a real calendar link
- optionally set `NORTHLINE_PHONE` if you want a forwarding line for sales calls
- optionally verify Google Business Profile and create the review-request link
- optionally set `NORTHLINE_GOOGLE_BUSINESS_PROFILE_URL` and `NORTHLINE_GOOGLE_REVIEW_URL`
- set `NORTHLINE_LINKEDIN_URL` if LinkedIn will be part of the proof surface
- point `northlinegrowthsystems.com` at the VPS later if you want the branded domain live instead of the temporary VPS URL and port

## Proof Before Scale

Do not try to scale Northline on ads or heavy automation before these are done:

- close the first three real operators through outbound or direct referrals
- collect three real testimonials or review quotes
- capture before-and-after screenshots for one homepage, one landing page, and one intake or follow-up workflow
- publish teardown-style proof posts on the Northline page, Facebook, Instagram, or LinkedIn
- use `examples/briefs/northline-pilot-template.json` for the first tracked pilot client record

## Channel Order

Use this sequence:

1. Publish the proof page and hosted intake.
2. Run outbound to 50-100 operators in one niche or metro.
3. Close the first three proof clients.
4. Request testimonials and optional reviews immediately after delivery.
5. Add Google Search or LSA-support landing pages after the close path is proven.
6. Add Meta for remarketing, lead forms, or retargeting once traffic exists.
