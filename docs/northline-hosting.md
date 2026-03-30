# Northline Hosting

This lane can run as a lightweight VPS-hosted proof page without a separate CMS, booking stack, or third-party form tool.

## Repo Commands

- `npm run dev -- build-agency-site`
- `npm run dev -- northline-plan`
- `npm run dev -- northline-site-serve`
- `npm run dev -- northline-site-health`

## Expected Northline Config

- `NORTHLINE_SITE_URL`: public URL you want prospects to see
- `NORTHLINE_DOMAIN`: inbox domain
- `NORTHLINE_SALES_EMAIL`: branded inbox
- `NORTHLINE_BOOKING_URL=/book.html`
- `NORTHLINE_LEAD_FORM_ACTION=/api/northline-intake`
- `NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING`
- `NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD`
- `NORTHLINE_SITE_BIND_HOST=0.0.0.0`
- `NORTHLINE_SITE_PORT=4181`

## VPS Service

The repo includes:

- `scripts/run-northline-site.sh`
- `scripts/install-northline-site-service.sh`
- `scripts/install-northline-nginx-proxy.sh`
- `scripts/install-northline-certbot.sh`

`install-northline-site-service.sh` installs a systemd unit named `imon-engine-northline-site.service` and serves the generated site on the configured Northline port.
`install-northline-nginx-proxy.sh` installs an nginx reverse proxy on port `80` and forwards standard web traffic to the Northline service on port `4181`.
`install-northline-certbot.sh` adds TLS after the domain is already pointed at the VPS and nginx is live.

## Domain Cutover

The repo-hosted proof page now includes:

- `/book.html` for call requests
- `/intake.html` for async intake
- `/api/northline-intake` for stored submissions

If the domain stays on GoDaddy-managed DNS, point the root A record to `158.220.99.144` and point `www` to the same host. The VPS can then reverse-proxy standard web traffic to the Northline service.
After the A record change has propagated and `http://northlinegrowthsystems.com` reaches the VPS, run `scripts/install-northline-certbot.sh northlinegrowthsystems.com` so `https://northlinegrowthsystems.com` matches the current Northline site URL.

## Intake Storage

- Submissions are written to `NORTHLINE_SUBMISSION_STORE_PATH`
- Notifications are written to `runtime/notifications/northline-intake-latest.txt`
- If `SMTP_*` is configured, the server also emails the intake notification

You can launch on the VPS IP and port first, then point the Northline domain to the VPS later. Phone, Google Business Profile, and review links are optional for the initial faceless outbound model.
