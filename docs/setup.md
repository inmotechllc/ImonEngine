# Setup

## Minimum

- Node 24+
- Windows OpenSSH client when you plan to use `Start-Imon-Control-Room.cmd` from a local PC
- An approval email address
- A business domain and sending inbox when outbound starts
- A signed-in VPS Chrome profile for the business inbox when Gmail-backed Northline outbound or reply sync is active, or IMAP access for the mailbox that receives `NORTHLINE_SALES_EMAIL`

## Environment Variables

- `AI_PROVIDER_NVIDIA_API_KEY`: enables the default shared `fast` and `deep` routes.
- `AI_PROVIDER_NVIDIA_BASE_URL`: optional NVIDIA API Catalog host override. It defaults to `https://integrate.api.nvidia.com/v1` when unset.
- Legacy `NVIDIA_API_KEY` and `NVIDIA_BASE_URL` still hydrate the NVIDIA provider during the migration window if an existing machine has not been renamed to the `AI_PROVIDER_NVIDIA_*` keys yet.
- `AI_PROVIDER_OPENAI_API_KEY`: keeps the shared `research` route active during the first NVIDIA migration window.
- `AI_PROVIDER_OPENAI_BASE_URL`: optional OpenAI-compatible host override for the retained `research` route or any future OpenAI-backed overrides.
- `AI_PROVIDER_LOCAL_API_KEY` and `AI_PROVIDER_LOCAL_BASE_URL`: optional secondary provider credentials for future route swaps in `src/ai/api-map.ts`.
- Shared route ids `fast`, `deep`, and `research`, plus the current business capability assignments, live in `src/ai/api-map.ts`. The current stage-1 defaults are `fast -> NVIDIA microsoft/phi-3.5-mini-instruct`, `deep -> NVIDIA deepseek-ai/deepseek-v3.1`, and `research -> OpenAI gpt-5` with `web_search_preview`. Caller files do not choose providers, models, or base URLs directly.
- `OPENAI_API_KEY`, `OPENAI_MODEL_FAST`, and `OPENAI_MODEL_DEEP`: legacy fallback and model-override keys that still hydrate the new AI routing config during the transition window, including route-level model overrides after the `fast` and `deep` NVIDIA cutover. Leave `OPENAI_MODEL_FAST` and `OPENAI_MODEL_DEEP` unset unless you intentionally want those overrides active.
- Shared engine and infra:
  `IMON_ENGINE_NAME`, `IMON_ENGINE_TIMEZONE`,
  `IMON_ENGINE_HOST_LABEL`, `IMON_ENGINE_HOST_PROVIDER`, `IMON_ENGINE_HOST_IP`,
  `IMON_ENGINE_MAX_CONCURRENT_BUSINESSES`,
  `IMON_ENGINE_CPU_TARGET`, `IMON_ENGINE_MEMORY_TARGET`, `IMON_ENGINE_MIN_DISK_FREE_GB`
- Shared owner and platform access:
  `APPROVAL_EMAIL`,
  `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`,
  `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_PAGES_PROJECT`,
  `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN`,
  `META_INSTAGRAM_ACCOUNT_ID`, `META_INSTAGRAM_ACCESS_TOKEN`
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
  `NORTHLINE_LINKEDIN_URL`, `NORTHLINE_SMTP_FROM`, `NORTHLINE_STRIPE_PAYMENT_LINK_LEAD_GENERATION`,
  `NORTHLINE_INBOX_ALIAS_FILTER`, `NORTHLINE_IMAP_MAILBOX`, `NORTHLINE_ZOHO_APP_PASS`,
  `NORTHLINE_INBOX_PROVIDER`, `NORTHLINE_OUTBOUND_CHANNEL`, `NORTHLINE_IMAP_HOST`,
  `NORTHLINE_IMAP_PORT`, `NORTHLINE_IMAP_SECURE`, `NORTHLINE_IMAP_USER`, `NORTHLINE_IMAP_PASS`,
  `NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING`, `NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD`,
  `NORTHLINE_STRIPE_PAYMENT_LINK_GROWTH_UPGRADE`, `NORTHLINE_GROWTH_UPGRADE_COUPON_LABEL`,
  `NORTHLINE_GROWTH_UPGRADE_COUPON_TERMS`, `NORTHLINE_STRIPE_PAYMENT_LINK_VALIDATION`,
  `NORTHLINE_STRIPE_WEBHOOK_SECRET`, `NORTHLINE_AUTO_DEPLOY_ENABLED`,
  `NORTHLINE_AUTO_DEPLOY_MIN_COMPLETED_DELIVERIES`, `NORTHLINE_AUTO_DEPLOY_REQUIRE_ZERO_QA_BLOCKERS`,
  `NORTHLINE_SITE_BIND_HOST`,
  `NORTHLINE_PROSPECT_SOURCE_DIR`, `NORTHLINE_PROSPECT_COLLECTION_AREAS`,
  `NORTHLINE_PROSPECT_COLLECTION_TRADES`, `NORTHLINE_PROSPECT_COLLECTION_INTERVAL_HOURS`,
  `NORTHLINE_PROSPECT_COLLECTION_MAX_RECORDS_PER_TRADE`,
  `NORTHLINE_SITE_PORT`, `NORTHLINE_SUBMISSION_STORE_PATH`
- Northline uses payment-link URLs for checkout. Keep raw Stripe account or API keys out of the tracked `.env.example` and in private env storage if external tools need them. `NORTHLINE_STRIPE_WEBHOOK_SECRET` is the only tracked Northline Stripe secret expected on the hosted server, and it is only for validating incoming webhook signatures.
- `META_INSTAGRAM_ACCESS_TOKEN` is optional unless you want the repo to publish `instagram_account` growth-queue items directly through the Meta Graph API. If it is unset, the publisher falls back to `META_PAGE_ACCESS_TOKEN` and tries to resolve the connected Instagram business account from the business-scoped Facebook Page record in `runtime/state/socialProfiles.json`, falling back to `META_PAGE_ID` only when no stored page id exists.
- `META_INSTAGRAM_ACCOUNT_ID` is optional. When it is unset, the Instagram publisher attempts to discover the connected Instagram business account from the business-scoped Facebook Page.
- If `META_PAGE_ACCESS_TOKEN` is unset, the Facebook publisher falls back to the signed-in browser session and posts through the live Facebook Page UI referenced by the business social profile instead of the generic Meta Business Suite composer.
- `NORTHLINE_SMTP_FROM` is the canonical Northline SMTP sender address and reply identity for SMTP fallback sends. Legacy `SMTP_FROM` still loads as a fallback.
- `INBOX_PROVIDER` selects the default reply-sync path for the shared Zoho-owned mailbox. Use `imap` for the Zoho-backed mailbox path or `gmail_cdp` when the VPS browser session owns the inbox directly. `NORTHLINE_INBOX_PROVIDER` still overrides it for Northline if needed.
- `OUTBOUND_CHANNEL` selects the default sender path for the shared Zoho-owned mailbox. It defaults to `smtp` when the resolved inbox provider is `imap`, otherwise it defaults to `gmail_cdp`. `NORTHLINE_OUTBOUND_CHANNEL` still overrides it for Northline if needed.
- `NORTHLINE_INBOX_ALIAS_FILTER` lets IMAP inbox sync match replies that were addressed to the branded Northline alias inside a shared mailbox.
- Shared `IMAP_HOST`, `IMAP_PORT`, `IMAP_SECURE`, and `IMAP_USER` configure the Zoho mailbox path. `NORTHLINE_IMAP_*` still override them for Northline when the lane needs different inbox settings.
- `NORTHLINE_ZOHO_APP_PASS` is the Northline-specific SMTP or IMAP auth fallback when the lane should not use the shared mailbox password. `NORTHLINE_IMAP_PASS`, `IMAP_PASS`, and `SMTP_PASS` still take precedence when present.
- `NORTHLINE_PROSPECT_SOURCE_DIR` defaults to `runtime/prospect-sources/northline` when it is not set.
- `NORTHLINE_PROSPECT_COLLECTION_AREAS` defaults to `NORTHLINE_PRIMARY_SERVICE_AREA` when it is not set.
- `NORTHLINE_PROSPECT_COLLECTION_TRADES` defaults to `plumbing;hvac;electrical;roofing;cleaning`.
- `NORTHLINE_PROSPECT_COLLECTION_INTERVAL_HOURS` defaults to `24`, and `NORTHLINE_PROSPECT_COLLECTION_MAX_RECORDS_PER_TRADE` defaults to `20`.
- `NORTHLINE_STRIPE_PAYMENT_LINK_LEAD_GENERATION`, `NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING`, `NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD`, and `NORTHLINE_STRIPE_PAYMENT_LINK_VALIDATION` are the fallback payment links for the default Northline business. Other agency businesses can override them through `northlineProfile`, while the public site maps those stable keys back onto the current Lead Generation, Pilot Launch, and Growth System labels.
- `NORTHLINE_STRIPE_PAYMENT_LINK_GROWTH_UPGRADE` is the preferred dedicated discounted checkout for Lead Generation clients upgrading into the Growth System. If the upgrade still uses the standard Growth System link, keep that env unset and store only `NORTHLINE_GROWTH_UPGRADE_COUPON_LABEL` plus `NORTHLINE_GROWTH_UPGRADE_COUPON_TERMS` until the dedicated link exists.
- `NORTHLINE_AUTO_DEPLOY_ENABLED=false`, `NORTHLINE_AUTO_DEPLOY_MIN_COMPLETED_DELIVERIES=3`, and `NORTHLINE_AUTO_DEPLOY_REQUIRE_ZERO_QA_BLOCKERS=true` remain available only for the older standalone deployer path. The default Northline lane now ends in a client handoff package, so those settings are optional and not needed for normal delivery.
- `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and `CLOUDFLARE_PAGES_PROJECT` are likewise optional unless you intentionally use the standalone deployer outside the default Northline handoff model.
- Northline prospect collection uses Nominatim only for cached market resolution and Overpass for public business retrieval; both require normal outbound HTTP access from the host that runs the command.
- QuietPivot Labs, Northbeam Atlas Network, and Velora Echo Media currently have reserved sections in `.env.example` so future lane-specific keys do not collide with the live businesses.
- ClipBaiters now uses a business-scoped env surface for its shared identity, lane bindings, and future finance planning: `CLIPBAITERS_SHARED_ALIAS_EMAIL`, `CLIPBAITERS_CREATOR_CONTACT_EMAIL`, `CLIPBAITERS_CREATOR_BOOKING_URL`, `CLIPBAITERS_ACTIVE_LANES`, `CLIPBAITERS_FACEBOOK_PAGE_URL`, `CLIPBAITERS_FACEBOOK_PAGE_ID`, the per-lane `CLIPBAITERS_YOUTUBE_*_CHANNEL_URL` plus optional `CLIPBAITERS_YOUTUBE_*_CHANNEL_ID` pairs, `CLIPBAITERS_SHARED_STRIPE_ACCOUNT_ID`, `CLIPBAITERS_SHARED_STRIPE_PUBLISHABLE_KEY`, optional private `CLIPBAITERS_SHARED_STRIPE_SECRET_KEY`, and masked Relay metadata through `CLIPBAITERS_RELAY_CHECKING_LABEL` plus `CLIPBAITERS_RELAY_CHECKING_LAST4`. The lane still reuses the shared ImonEngine Gmail plus the signed-in Chrome profile on the active machine or VPS, and it does not require separate ClipBaiters inbox credentials.
- ClipBaiters still keeps creator-service checkout links separate from the channel bindings: `CLIPBAITERS_STREAMING_PAYMENT_LINK_RETAINER`, `CLIPBAITERS_STREAMING_PAYMENT_LINK_EVENT_PACK`, and `CLIPBAITERS_STREAMING_PAYMENT_LINK_RUSH_PACK`.
- Keep raw ClipBaiters Stripe secret keys and unmasked bank details out of the tracked `.env.example`. The repo uses payment-link readiness plus masked finance-planning metadata, not direct Stripe or bank automation.
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
12. Run `npm run dev -- northline-collect-prospects --force` when you want the repo to refresh its own Northline OSM feeds immediately.
13. Drop refreshed CSV or JSON prospect feeds into `runtime/prospect-sources/northline/`, or set `NORTHLINE_PROSPECT_SOURCE_DIR` to another watched folder, when you want to supplement the repo-generated feeds.
14. Run `npm run dev -- northline-source-prospects` when you want to process only the new source files without waiting for the full autonomy run.
15. Run `npm run dev -- northline-autonomy-run --business auto-funding-agency --notify-roadblocks` to refresh the Northline plan, collect market feeds on cadence, process changed source feeds, promote hosted intake into tracked proposal work, and surface the current operating mode, promotion criteria, and manual checkpoints.
16. Run `npm run dev -- build-agency-site` to regenerate the Northline proof page.
17. Run `npm run dev -- northline-site-serve` if you want the VPS to host the proof page and intake endpoint directly; live submissions will also queue an immediate Northline autonomy pass.
18. Run `npm run dev -- micro-saas-plan --business imon-micro-saas-factory` when you are ready to operationalize QuietPivot Labs beyond the generic venture blueprint.
19. Run `npm run dev -- social-profiles --business clipbaiters-viral-moments` followed by `npm run dev -- clipbaiters-plan --business clipbaiters-viral-moments` when you are ready to refresh the ClipBaiters identity bindings, lane registry, source registry, and planning dossier.
20. Run `npm run dev -- clipbaiters-collect --business clipbaiters-viral-moments`, `npm run dev -- clipbaiters-skim --business clipbaiters-viral-moments`, and `npm run dev -- clipbaiters-autonomy-run --business clipbaiters-viral-moments --all-active-lanes --dry-run` when you want the first multi-lane ClipBaiters cycle across the currently active political and media lanes.
21. Fill only the setup tasks that apply to the currently active businesses. Northline phone, Google Business Profile, and review keys are optional while the faceless proof-page pipeline is the focus. The repo-hosted booking page can stay at `NORTHLINE_BOOKING_URL=/book.html`.
22. Import a real prospect list with `npm run dev -- prospect --input <file>` only when you want a one-off manual import outside the watched source directory.
23. Review outreach drafts in `runtime/state/outreach.json` when a compliance or send-failure task opens. Approved Northline drafts now send automatically on the next autonomy pass and append their latest send receipts to the same file.
24. Use `npm run dev -- northline-inbox-sync --business auto-funding-agency` when you want an on-demand inbox pull outside the scheduled autonomy pass. Synced replies are recorded in `runtime/state/leadReplies.json`; `handle-reply --lead <id> --message-file <path>` remains the fallback if inbox automation cannot read a thread.
25. Use `/validation.html` when you want to run the low-risk $1 system check. The hosted page now stores the intake, appends a Stripe checkout reference, persists its status through `/api/northline-validation-status`, and auto-runs the hosted handoff after checkout when `NORTHLINE_STRIPE_WEBHOOK_SECRET` is configured. `northline-validation-run` remains the fallback if the hosted callback is unavailable.
26. When a Northline proposal becomes paid outside `/validation.html`, either send the operator through a Stripe link that carries `client_reference_id=client:<client-id>:paid|retainer_active` so the webhook can promote the client automatically, or run `npm run dev -- northline-billing-handoff --client <id> --status paid|retainer_active [--form-endpoint <url>]` as the manual fallback.
27. Add Cloudflare credentials only if you intentionally use the standalone deployer outside the default Northline handoff workflow. `northline-autonomy-run` now ends in a QA-passed proof bundle plus handoff package for the client's own host or developer; it does not publish client sites automatically.
28. For VPS staging, copy the repo to the server and run `scripts/bootstrap-vps.sh`, then `scripts/install-cron.sh`.
29. Run `scripts/install-northline-site-service.sh` on the VPS if you want a persistent Northline proof-page service on port `4181`.
30. Run `scripts/install-northline-nginx-proxy.sh` on the VPS if you want the domain to terminate on standard HTTP port `80` instead of `:4181`.
31. After the domain resolves to the VPS, run `scripts/install-northline-certbot.sh northlinegrowthsystems.com` so the live proof page works over HTTPS.
32. Start the persistent VPS Chrome profile with `scripts/vps-browser-start.sh` if you need browser-based auth or automation on the server.
33. If Northline outbound or reply sync will use the Gmail path, keep that browser signed into the inbox behind `NORTHLINE_SALES_EMAIL` and smoke-test the helpers with `python3 scripts/send_gmail_message.py --help` and `python3 scripts/sync_northline_inbox.py --help`. If Northline uses the IMAP path, smoke-test `python3 scripts/sync_northline_inbox_imap.py --help` and confirm `NORTHLINE_IMAP_*` resolves the mailbox that receives the Northline alias.
34. Verify the VPS toolchain with `scripts/vps-tooling-status.sh`.
35. Start isolated business sandboxes with `scripts/business-worker-start.sh <business-id> "<business-name>"` when a new brand needs its own containerized workspace.

## ClipBaiters Planning And Social Setup

- Set `CLIPBAITERS_SHARED_ALIAS_EMAIL`, `CLIPBAITERS_CREATOR_CONTACT_EMAIL`, `CLIPBAITERS_CREATOR_BOOKING_URL`, `CLIPBAITERS_ACTIVE_LANES`, the per-lane `CLIPBAITERS_YOUTUBE_*_CHANNEL_URL` plus optional `CLIPBAITERS_YOUTUBE_*_CHANNEL_ID` values, and any future Stripe or Relay planning metadata before taking a lane beyond planning. Facebook remains optional and can stay deferred.
- Run `npm run dev -- social-profiles --business clipbaiters-viral-moments` to seed the shared alias, creator-contact metadata, the optional umbrella Facebook placeholder, active-lane notes, and the five planned YouTube lane records.
- Run `npm run dev -- clipbaiters-plan --business clipbaiters-viral-moments [--notify-roadblocks]` to refresh the lane registry, source registry, planning dossier, and the ClipBaiters roadblock-email/notification artifacts.
- Run `npm run dev -- clipbaiters-approve-policy --business clipbaiters-viral-moments [--approved-by <name-or-email>] [--note <text>]` after you accept the source-rights and fair-use statement. This writes `runtime/state/clipbaiters/clipbaiters-viral-moments/rights-review-approval.json`, writes the operator-facing markdown approval, refreshes the plan, and lets `org-sync` close the ClipBaiters business approval task while leaving unrelated launch blockers visible.
- Run `npm run dev -- clipbaiters-approve-lane-posture --business clipbaiters-viral-moments [--approved-by <name-or-email>] [--note <text>]` after you accept the current active-versus-gated rollout posture. This writes `runtime/state/clipbaiters/clipbaiters-viral-moments/lane-posture-approval.json`, writes the operator-facing lane-posture markdown approval, refreshes the plan, and lets `org-sync` close the dedicated lane-posture approval task while the approved rollout signature still matches the live lane registry.
- Run `npm run dev -- clipbaiters-collect --business clipbaiters-viral-moments [--lane <id>]` to refresh `source-watchlists.json` and `video-discovery.json` from the approved rosters. Omit `--lane` to refresh all currently active YouTube lanes.
- Run `npm run dev -- clipbaiters-skim --business clipbaiters-viral-moments [--lane <id>]` to refresh `skim-summaries.json` before the heavier draft pass. Omit `--lane` to skim all currently active YouTube lanes.
- Run `npm run dev -- clipbaiters-radar --business clipbaiters-viral-moments --lane clipbaiters-political` to generate the current review-gated daily brief.
- Run `npm run dev -- clipbaiters-autonomy-run --business clipbaiters-viral-moments [--lane <id>] [--all-active-lanes] [--dry-run]` to turn approved source-manifest JSON files, discovery state, or fallback story briefs into lane-scoped clip packages. `--dry-run` stops at draft assets; omitting it lets the worker download approved media, refresh Whisper transcripts, and render final MP4s.
- Run `npm run dev -- clipbaiters-publish --business clipbaiters-viral-moments [--lane <id>] [--all-active-lanes] [--dry-run]` to queue those jobs for the eligible YouTube lanes, open any required manual review tasks, persist `posting-schedule.json`, write publish history, and refresh publish metrics. Keep `--dry-run` on until the queue has render-ready approved items and the VPS browser session is healthy.
- Run `npm run dev -- clipbaiters-source-creators --business clipbaiters-viral-moments` to refresh the lightweight streaming-creator lead roster.
- Run `npm run dev -- clipbaiters-draft-creator-outreach --business clipbaiters-viral-moments` to write approval-gated creator outreach drafts.
- Run `npm run dev -- clipbaiters-deals-report --business clipbaiters-viral-moments` to summarize creator-deal stages and accepted-order handoffs.
- Run `npm run dev -- clipbaiters-intake --business clipbaiters-viral-moments` after dropping manual creator-order manifests into the intake folder.
- Run `npm run dev -- clipbaiters-monetization-report --business clipbaiters-viral-moments` to refresh creator offers, creator orders, revenue snapshots, and payment-link or delivery-review approvals.
- Set `CLIPBAITERS_STREAMING_PAYMENT_LINK_RETAINER`, `CLIPBAITERS_STREAMING_PAYMENT_LINK_EVENT_PACK`, and `CLIPBAITERS_STREAMING_PAYMENT_LINK_RUSH_PACK` before sending live ClipBaiters offers. These are public checkout links, not raw Stripe credentials.
- `CLIPBAITERS_ACTIVE_LANES` now defaults to `clipbaiters-political,clipbaiters-media` in the tracked setup, keeping the initial rollout focused on YouTube while streaming stays the direct-revenue lane.
- Manual creator briefs, approved schedule exports, and approved source-manifest JSON files belong in `runtime/source-feeds/clipbaiters/clipbaiters-viral-moments/`.
- Manual creator-order JSON manifests belong in `runtime/source-feeds/clipbaiters/clipbaiters-viral-moments/creator-orders/`.
- The collection and skim passes write `runtime/state/clipbaiters/clipbaiters-viral-moments/source-watchlists.json`, `runtime/state/clipbaiters/clipbaiters-viral-moments/video-discovery.json`, and `runtime/state/clipbaiters/clipbaiters-viral-moments/skim-summaries.json`.
- The planning pass writes `runtime/ops/clipbaiters/clipbaiters-viral-moments/roadblock-email.md` plus `runtime/ops/clipbaiters/clipbaiters-viral-moments/roadblock-notification.json` when `--notify-roadblocks` is enabled and roadblocks remain.
- The approval passes write `runtime/state/clipbaiters/clipbaiters-viral-moments/rights-review-approval.json` plus `runtime/ops/clipbaiters/clipbaiters-viral-moments/rights-review-approval.md`, and `runtime/state/clipbaiters/clipbaiters-viral-moments/lane-posture-approval.json` plus `runtime/ops/clipbaiters/clipbaiters-viral-moments/lane-posture-approval.md`. The rights-policy approval removes only the rights-policy blocker; the lane-posture approval removes only the `rights-gated-lanes` blocker while the rollout signature stays current.
- The hosted and local control-room apps expose the same two ClipBaiters approvals through the `Approval Actions` panel if you prefer not to use the CLI.
- The autonomy pass writes `runtime/state/clipbaiters/clipbaiters-viral-moments/clip-candidates.json`, `runtime/state/clipbaiters/clipbaiters-viral-moments/clip-candidates-<lane-id>.json`, `runtime/state/clipbaiters/clipbaiters-viral-moments/clip-jobs.json`, `runtime/state/clipbaiters/clipbaiters-viral-moments/clip-jobs-<lane-id>.json`, `runtime/ops/clipbaiters/clipbaiters-viral-moments/autonomy-run.md`, `runtime/ops/clipbaiters/clipbaiters-viral-moments/autonomy-run-<lane-id>.md`, and per-job draft packages under `runtime/ops/clipbaiters/clipbaiters-viral-moments/draft-clips/`. Non-dry-run passes also leave rendered MP4s, transcripts, attribution text, and render logs there.
- The publishing pass writes `runtime/state/clipbaiters/clipbaiters-viral-moments/publishing-queue.json`, `runtime/state/clipbaiters/clipbaiters-viral-moments/posting-schedule.json`, `runtime/state/clipbaiters/clipbaiters-viral-moments/channel-metrics.json`, `runtime/state/clipbaiters/clipbaiters-viral-moments/publish-history.json`, `runtime/ops/clipbaiters/clipbaiters-viral-moments/upload-batches.json`, `runtime/ops/clipbaiters/clipbaiters-viral-moments/review-queue.md`, `runtime/ops/clipbaiters/clipbaiters-viral-moments/channel-metrics.md`, and `runtime/ops/clipbaiters/clipbaiters-viral-moments/daily-summary.md`.
- The creator-deals and monetization flow writes `runtime/state/clipbaiters/clipbaiters-viral-moments/creator-leads.json`, `runtime/state/clipbaiters/clipbaiters-viral-moments/creator-outreach.json`, `runtime/state/clipbaiters/clipbaiters-viral-moments/creator-offers.json`, `runtime/state/clipbaiters/clipbaiters-viral-moments/creator-orders.json`, `runtime/state/clipbaiters/clipbaiters-viral-moments/revenue-snapshots.json`, `runtime/ops/clipbaiters/clipbaiters-viral-moments/creator-deals.md`, and `runtime/ops/clipbaiters/clipbaiters-viral-moments/monetization-report.md`.
- `scripts/business-worker-start.sh` now boots a worker image with `ffmpeg`, `yt-dlp`, and the OpenAI Whisper CLI, and `scripts/vps-tooling-status.sh` reports all three tool versions for the host-level readiness check.
- Keep the signed-in ImonEngine Chrome profile ready for manual YouTube channel creation, review-queue triage, and the controlled `scripts/youtube_studio_upload.py` path that eligible lanes use once they are cleared for live upload.

## Northline Profile Admin

- Run `npm run dev -- northline-profile-show [--business <id>] [--probe-payments]` to inspect the stored and resolved Northline business profile plus the business-scoped runtime paths.
- Run `npm run dev -- northline-profile-update --business <id> --file <json> [--replace] [--skip-payment-probe]` to patch `ManagedBusiness.northlineProfile` without editing `runtime/state/businesses.json` by hand.
- When the patch includes `agencyProfile`, keep the proof-page structures explicit: each `proofPoints` item needs `stat`, `label`, and `detail`, and each `trustSignals` item needs `label`, `title`, and `body`.
- When the patch includes `agencyProfile.pricing`, each tier now needs `id`, `label`, `amount`, `details`, `idealFor`, and `includes`. Optional `paymentLinkKey`, `cta`, and `upgradeOffer` metadata are preserved by the admin sanitizer.
- Run `npm run dev -- northline-payment-check [--business <id>] [--skip-probe]` before launch if you want the repo to validate the resolved Lead Generation, Pilot Launch, and Growth System Stripe payment paths and surface the optional Growth upgrade link state.
- These checks validate configuration and optional HTTP reachability only. They do not replace completing a real Stripe checkout. Validation-page checkouts can now trigger the hosted handoff automatically through the Stripe webhook path, and non-validation billing can do the same when the checkout carries `client_reference_id=client:<client-id>:paid|retainer_active`. Keep `northline-billing-handoff` as the manual fallback when a checkout needs a repo-owned override.

## Northline Scheduler Notes

- `scripts/imon-engine-sync.sh` now runs both `engine-sync` and `northline-autonomy-run --business auto-funding-agency --notify-roadblocks`, then advances ClipBaiters through `clipbaiters-plan --notify-roadblocks`, collect, skim, a guarded autonomy pass, a guaranteed dry-run publish pass, and a guarded live publish retry only when the queue is render-ready and the VPS browser stack is healthy.
- `scripts/install-cron.sh` installs that shared wrapper on a 30-minute cadence.
- `scripts/run_vps_autopilot.sh` now runs the Northline sync before the optional Imonic POD refresh so hourly VPS work still advances hosted intake and delivery even if the POD lane hits a notification error.
- `northline-autonomy-run` now refreshes Northline's market feeds on its configured cadence before it processes changed prospect feed files from `runtime/prospect-sources/northline/`.
- `northline-autonomy-run` now also calls the configured Northline reply-sync path and records deduplicated reply history in `runtime/state/leadReplies.json`; `northline-inbox-sync` is the manual fallback command for the same path.
- The generated Northline plan and autonomy summary now expose `operatingMode.current`, the five promotion criteria, scheduled automation, and explicit manual checkpoints so you can see why the lane is still in `controlled_launch` or has earned `autonomous` mode.
- Use `npm run dev -- northline-collect-prospects --force` when you need an immediate collector refresh instead of waiting for the default 24-hour cadence.
- `NORTHLINE_SUBMISSION_STORE_PATH` remains the raw hosted-intake archive; the autonomy run promotes complete submissions into `runtime/state/clients.json`.
