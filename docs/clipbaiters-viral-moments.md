# ClipBaiters - Viral Moments

ClipBaiters - Viral Moments is a separate managed ImonEngine business for approved short-form clipping, commentary-led packaging, and creator-paid auto clipping. It launches as a YouTube-first lane with explicit compliance review rather than as a raw reposting or blind social-publishing workflow.

## Current Posture

- Business id: `clipbaiters-viral-moments`
- Category: `faceless_social_brand`
- Stage: `scaffolded`
- Approval posture: `compliance`
- Canonical plans:
	- `docs/plans/2026-04-07-clipbaiters-viral-moments.md`
	- `docs/plans/2026-04-08-clipbaiters-autonomy-gap-closure.md`
- Active lanes: `clipbaiters-political`, `clipbaiters-media`
- Passive lanes: `clipbaiters-streaming`, `clipbaiters-animated`, `clipbaiters-celebs`

Step 1 registers the business, seeds its venture blueprint, and documents the lane-level guardrails. The ingest pipeline, clip automation, publishing flow, and monetization reports land in later plan steps.

Step 2 adds the first channel registry for the lane. ClipBaiters now seeds one shared Gmail alias, one optional umbrella `facebook_page`, and five planned `youtube_channel` records inside the repo-controlled social profile state.

Step 3 adds the first business-specific operating system for the lane. ClipBaiters now has a durable lane registry, source registry, event radar, story-candidate state, a planning dossier, and a review-gated daily brief. The ingest pipeline, clip automation, publishing flow, and monetization reports still land in later plan steps.

Step 4 now covers both draft planning and the first real render pipeline. ClipBaiters can read approved manual source manifests from `runtime/source-feeds/clipbaiters/clipbaiters-viral-moments/`, synthesize transcript segments and clip moments, split longer source sequences into ordered short-form parts, write `clip-candidates.json` and `clip-jobs.json`, and either stop at draft packages in `--dry-run` mode or execute `yt-dlp`, Whisper, and `ffmpeg` in non-dry-run mode to leave final MP4s, transcripts, attribution text, and render logs inside `runtime/ops/clipbaiters/clipbaiters-viral-moments/draft-clips/`.

Step 5 now adds explicit fair-use gates plus a persisted posting scheduler. ClipBaiters turns prepared clip jobs into a publish queue only when the source class, attribution, transformation tactics, duration, and review posture all pass, writes `posting-schedule.json` with randomized peak windows under the business schedule, records upload batches and publish history, and captures channel metrics that expose scheduled counts, render-ready counts, and the next allocated posting slot.

Step 6 adds the first direct monetization layer. `ClipBaitersStreaming` now writes a creator-offer catalog, syncs manual creator-order manifests from a dedicated intake folder, records revenue snapshots from paid orders, opens approval tasks when payment links or delivery review are missing, and writes a monetization report without pretending channel rev share is the primary launch cash source.

Step 7 wires ClipBaiters into the organization control plane and scheduled engine flow. The lane now has explicit workflow ownership in the business office, runtime-aware execution items in the department workspaces, a generated launch checklist, roadblock notification artifacts, a posting-schedule artifact, and a guarded VPS cadence that can promote itself from dry-run to controlled live upload only when business stage, render readiness, queue state, and the persistent browser session all agree.

The rights-and-review blocker now has a durable approval surface. `clipbaiters-approve-policy` writes a signed-off rights policy statement to `runtime/state/clipbaiters/clipbaiters-viral-moments/rights-review-approval.json` plus `runtime/ops/clipbaiters/clipbaiters-viral-moments/rights-review-approval.md`, refreshes the planning dossier, and lets `org-sync` close the business approval task once the source-policy signoff is recorded. Remaining launch blockers still stay visible in the launch checklist instead of being silently discarded.

The gated-lane rollout posture now has the same durable approval path. `clipbaiters-approve-lane-posture` writes `runtime/state/clipbaiters/clipbaiters-viral-moments/lane-posture-approval.json` plus `runtime/ops/clipbaiters/clipbaiters-viral-moments/lane-posture-approval.md`, records that the current active-versus-gated lane mix is intentional, and clears only the `rights-gated-lanes` blocker while keeping future lane changes capable of reopening that review. The hosted and local control-room apps can record both ClipBaiters approvals directly from the `Approval Actions` panel instead of forcing the CLI path.

The autonomy-gap-closure follow-through now extends that baseline with roster collection, skim summaries, multi-lane draft and queue runs, creator-deals tracking, publish history, a daily summary surface, and a controlled Studio upload helper for lanes that clear review and channel-readiness gates.

## Monetization Priority

1. `ClipBaitersStreaming` creator retainers, event packages, and rush-turnaround clipping work.
2. YouTube monetization for lanes that satisfy reused-content and transformation rules.
3. Sponsorships or affiliate placements that fit the lane and can be disclosed cleanly.
4. Later licensing or syndication only for creator-authorized or otherwise owned editorial packages.

## Editorial Lanes

- `ClipBaitersPolitical`: politics, government, elections, hearings, and official-news moments.
- `ClipBaitersMedia`: non-political news plus official film, television, and press surfaces that pass the rights policy.
- `ClipBaitersAnimated`: animation and anime surfaces that stay rights-gated until an approved source policy exists.
- `ClipBaitersCelebs`: celebrity interviews, press junkets, and official public clips that pass review.
- `ClipBaitersStreaming`: creator-authorized streaming and content-creator clipping services.

The niches are primarily platform and content filters. They should separate audiences on channels and searches first. Future per-lane `clipbaiters.com` aliases can exist, but only when those lane accounts actually need their own recovery or notification path.

## Current Channel Registry

- Shared alias: `contact@clipbaiters.com`
- Optional umbrella Facebook surface: one deferred `facebook_page` for later distribution or ad reuse only
- Creator contact surface: `CLIPBAITERS_CREATOR_CONTACT_EMAIL` plus `CLIPBAITERS_CREATOR_BOOKING_URL`
- Active-lane default: `CLIPBAITERS_ACTIVE_LANES=clipbaiters-political,clipbaiters-media`
- Future finance planning metadata: `CLIPBAITERS_SHARED_STRIPE_ACCOUNT_ID`, `CLIPBAITERS_SHARED_STRIPE_PUBLISHABLE_KEY`, optional private `CLIPBAITERS_SHARED_STRIPE_SECRET_KEY`, plus masked Relay metadata through `CLIPBAITERS_RELAY_CHECKING_LABEL` and `CLIPBAITERS_RELAY_CHECKING_LAST4`
- Planned YouTube lanes:
	- `clipbaiters-political`
	- `clipbaiters-media`
	- `clipbaiters-animated`
	- `clipbaiters-celebs`
	- `clipbaiters-streaming`

Run `npm run dev -- social-profiles --business clipbaiters-viral-moments` whenever the social registry needs to be refreshed. The resulting records live in `runtime/state/socialProfiles.json` and the generated registry artifacts under `runtime/ops/social-profiles.*`.

## Planning, Discovery, Draft, Publish, And Monetization Commands

- Run `npm run dev -- social-profiles --business clipbaiters-viral-moments` to refresh the shared alias, creator-contact metadata, optional Facebook page placeholder, and per-lane YouTube bindings.
- Run `npm run dev -- clipbaiters-plan --business clipbaiters-viral-moments [--notify-roadblocks]` to refresh the lane registry, source registry, planning dossier, `roadblock-email.md`, and the throttled `roadblock-notification.json` state.
- Run `npm run dev -- clipbaiters-approve-policy --business clipbaiters-viral-moments [--approved-by <name-or-email>] [--note <text>]` to record the owner signoff for the rights-cleared and fair-use operating policy, write the approval statement artifacts, refresh the plan, and allow the business approval task to close on the next `org-sync`.
- Run `npm run dev -- clipbaiters-approve-lane-posture --business clipbaiters-viral-moments [--approved-by <name-or-email>] [--note <text>]` to record the owner signoff for the current active-versus-gated lane rollout, write the lane-posture approval artifacts, refresh the plan, and let `org-sync` close the lane-posture approval task when the approved rollout signature still matches the live lane registry.
- Run `npm run dev -- clipbaiters-collect --business clipbaiters-viral-moments [--lane <id>]` to refresh approved source watchlists and discovered candidate videos. Omit `--lane` to refresh every currently active YouTube lane.
- Run `npm run dev -- clipbaiters-skim --business clipbaiters-viral-moments [--lane <id>]` to rank the collected discovery set into skim summaries before a draft run. Omit `--lane` to skim every currently active YouTube lane.
- Run `npm run dev -- clipbaiters-radar --business clipbaiters-viral-moments --lane clipbaiters-political` to generate the first ranked daily brief for the political lane.
- Run `npm run dev -- clipbaiters-autonomy-run --business clipbaiters-viral-moments [--lane <id>] [--all-active-lanes] [--dry-run]` to convert approved source manifests, discovery feeds, or fallback story briefs into lane-scoped clip candidates, clip jobs, draft clip packages, and autonomy summaries. Omit `--dry-run` only when the worker toolchain is healthy and you want the lane to download source media, refresh transcripts, and render final MP4s.
- Run `npm run dev -- clipbaiters-publish --business clipbaiters-viral-moments [--lane <id>] [--all-active-lanes] [--dry-run]` to turn those clip jobs into a review-gated publishing queue, `posting-schedule.json`, upload batches, publish history, review markdown, daily summary output, and per-channel queue metrics. Omit `--dry-run` only when the queue already contains render-ready approved items and the persistent VPS browser is healthy.
- Run `npm run dev -- clipbaiters-source-creators --business clipbaiters-viral-moments` to refresh the lightweight streaming-creator lead roster.
- Run `npm run dev -- clipbaiters-draft-creator-outreach --business clipbaiters-viral-moments` to write approval-gated creator outreach drafts from the current lead roster.
- Run `npm run dev -- clipbaiters-deals-report --business clipbaiters-viral-moments` to materialize the current creator-deals backlog and accepted-order handoff status.
- Run `npm run dev -- clipbaiters-intake --business clipbaiters-viral-moments` to normalize manual creator-order manifests from `runtime/source-feeds/clipbaiters/clipbaiters-viral-moments/creator-orders/` into durable creator-order state.
- Run `npm run dev -- clipbaiters-monetization-report --business clipbaiters-viral-moments` to refresh the creator-offer catalog, sync creator orders, write revenue snapshots, and open any missing payment-link or delivery-review approvals.
- Run `npm run dev -- org-sync`, `npm run dev -- org-report --business clipbaiters-viral-moments`, or `npm run dev -- office-dashboard` when the office view, launch checklist, or workflow ownership summary needs to be regenerated after a ClipBaiters pass.
- Use `runtime/source-feeds/clipbaiters/clipbaiters-viral-moments/` for approved source-manifest JSON files, creator briefs, official schedules, and other manual ingest handoff files.
- Use `runtime/source-feeds/clipbaiters/clipbaiters-viral-moments/creator-orders/` for manual creator-order JSON manifests. The monetization flow keeps a `README.md` in that folder with the expected schema.
- Use `scripts/business-worker-start.sh clipbaiters-viral-moments "ClipBaiters - Viral Moments"` plus `scripts/vps-tooling-status.sh` when the lane needs the isolated worker image and a host-level `ffmpeg`, `yt-dlp`, and Whisper readiness check.
- Use `python3 scripts/youtube_studio_upload.py --help` to inspect the browser-assisted Studio upload helper before moving a lane beyond pure dry-run queue refreshes.

## Control Plane And Scheduled Flow

- Workflow ownership now resolves to `ClipBaiters Launch Governance`, `ClipBaiters Source Collection`, `ClipBaiters Source Skimming`, `ClipBaiters Editorial Radar`, `ClipBaiters Draft Autonomy`, `ClipBaiters Review-Gated Publishing`, `ClipBaiters YouTube Channel Ops`, `ClipBaiters Creator Deals`, and `ClipBaiters Monetization Reporting` inside the business office.
- `org-sync` writes `runtime/ops/clipbaiters/clipbaiters-viral-moments/launch-checklist.md` alongside `runtime/ops/org-control-plane.json` and `runtime/ops/office-views.json` so the lane's review posture, runtime artifacts, and scheduled commands stay visible in one place.
- The default VPS cadence now runs `clipbaiters-plan --business clipbaiters-viral-moments --notify-roadblocks`, `clipbaiters-collect --business clipbaiters-viral-moments`, `clipbaiters-skim --business clipbaiters-viral-moments`, a guarded `clipbaiters-autonomy-run --business clipbaiters-viral-moments --all-active-lanes`, a guaranteed dry-run `clipbaiters-publish --business clipbaiters-viral-moments --all-active-lanes --dry-run`, and then a second guarded live `clipbaiters-publish` pass only when the queue is render-ready and the VPS browser stack is healthy.
- That scheduled flow refreshes office artifacts, discovery state, creator-deals state, queue state, and posting windows first. It only attempts controlled live publishing for currently active lanes that are already approved and render-ready, and it still skips review-gated political or rights-sensitive items instead of forcing them live.
- Controlled live uploads reuse `scripts/youtube_studio_upload.py` against the shared signed-in Chrome profile. The currently active YouTube lanes are the eligible controlled-upload targets once their channels are live, the queue is approved, and review gates are clear.

## Direct Monetization Surface

- ClipBaiters creator leads are tracked in `runtime/state/clipbaiters/clipbaiters-viral-moments/creator-leads.json`.
- Creator outreach drafts are tracked in `runtime/state/clipbaiters/clipbaiters-viral-moments/creator-outreach.json`.
- ClipBaiters creator offers are tracked in `runtime/state/clipbaiters/clipbaiters-viral-moments/creator-offers.json`.
- Creator orders are tracked in `runtime/state/clipbaiters/clipbaiters-viral-moments/creator-orders.json` and are sourced from manual manifests in `runtime/source-feeds/clipbaiters/clipbaiters-viral-moments/creator-orders/`.
- Revenue snapshots are tracked in `runtime/state/clipbaiters/clipbaiters-viral-moments/revenue-snapshots.json`.
- The creator-deals summary lives at `runtime/ops/clipbaiters/clipbaiters-viral-moments/creator-deals.md`.
- The canonical monetization summary lives at `runtime/ops/clipbaiters/clipbaiters-viral-moments/monetization-report.md`.
- Configure `CLIPBAITERS_CREATOR_CONTACT_EMAIL` and `CLIPBAITERS_CREATOR_BOOKING_URL` so deal and delivery drafts can point creators at the correct human contact surface.
- Configure `CLIPBAITERS_STREAMING_PAYMENT_LINK_RETAINER`, `CLIPBAITERS_STREAMING_PAYMENT_LINK_EVENT_PACK`, and `CLIPBAITERS_STREAMING_PAYMENT_LINK_RUSH_PACK` before sending live offers; missing links reopen approval tasks instead of silently pretending checkout exists.
- Track any shared Stripe or Relay cashout metadata in the ClipBaiters env surface as planning context only; verified paid creator orders remain the source of truth for revenue.
- Paid creator orders remain review-gated until the delivery review task is closed and the intake manifest records `deliveredAt` plus any delivery artifacts.

## Planning Surface

- Primary editorial lane: `clipbaiters-political`
- Primary revenue lane: `clipbaiters-streaming`
- Current active autonomous lanes: `ClipBaitersPolitical` and `ClipBaitersMedia`
- Passive or research-only lanes: `ClipBaitersStreaming`, `ClipBaitersAnimated`, `ClipBaitersCelebs`
- Current operating status: review-gated until the rights policy stays approved, the current lane posture stays signed off, the eligible YouTube channels move from `planned` to `live`, approved source drops move beyond seeded placeholders, and sensitive queues clear manual review

Once `rights-review-approval.json` exists, the source-rights signoff is considered satisfied. Once `lane-posture-approval.json` exists and still matches the current lane registry signature, the current active-versus-gated rollout posture is considered satisfied too. Channel readiness and review-queue blockers can still keep the business in `scaffolded` or `blocked` status until they are resolved.

The step-3 source registry is intentionally conservative. Political uses discovery feeds plus official calendars and official YouTube sources, Media uses official YouTube channels only, and Streaming stays visible as the direct-revenue lane without joining the current active publish set.

## Operating Guardrails

- Only use rights-cleared, creator-authorized, public-domain, official-government, or materially transformed commentary-led source material.
- Keep political, celebrity, and any rights-sensitive material behind a manual review gate before publishing.
- Reuse the signed-in ImonEngine Chrome and Gmail profile for YouTube setup and future Studio automation.
- Start with one umbrella alias for approvals and recovery. Add per-lane domain aliases only when a lane actually needs its own account footprint.
- Treat `ClipBaitersAnimated` as rights-gated until its source policy is approved, and keep `ClipBaitersStreaming` out of the active YouTube channel loop until the current lanes are stable.

## Current Runtime Surface

- `runtime/state/businesses.json`
- `runtime/state/socialProfiles.json`
- `runtime/state/clipbaiters/clipbaiters-viral-moments/lane-registry.json`
- `runtime/state/clipbaiters/clipbaiters-viral-moments/source-registry.json`
- `runtime/state/clipbaiters/clipbaiters-viral-moments/source-watchlists.json`
- `runtime/state/clipbaiters/clipbaiters-viral-moments/video-discovery.json`
- `runtime/state/clipbaiters/clipbaiters-viral-moments/skim-summaries.json`
- `runtime/state/clipbaiters/clipbaiters-viral-moments/event-radar.json`
- `runtime/state/clipbaiters/clipbaiters-viral-moments/story-candidates.json`
- `runtime/state/clipbaiters/clipbaiters-viral-moments/clip-candidates.json`
- `runtime/state/clipbaiters/clipbaiters-viral-moments/clip-candidates-<lane-id>.json`
- `runtime/state/clipbaiters/clipbaiters-viral-moments/clip-jobs.json`
- `runtime/state/clipbaiters/clipbaiters-viral-moments/clip-jobs-<lane-id>.json`
- `runtime/state/clipbaiters/clipbaiters-viral-moments/publishing-queue.json`
- `runtime/state/clipbaiters/clipbaiters-viral-moments/posting-schedule.json`
- `runtime/state/clipbaiters/clipbaiters-viral-moments/channel-metrics.json`
- `runtime/state/clipbaiters/clipbaiters-viral-moments/publish-history.json`
- `runtime/state/clipbaiters/clipbaiters-viral-moments/creator-leads.json`
- `runtime/state/clipbaiters/clipbaiters-viral-moments/creator-outreach.json`
- `runtime/state/clipbaiters/clipbaiters-viral-moments/creator-offers.json`
- `runtime/state/clipbaiters/clipbaiters-viral-moments/creator-orders.json`
- `runtime/state/clipbaiters/clipbaiters-viral-moments/revenue-snapshots.json`
- `runtime/state/clipbaiters/clipbaiters-viral-moments/rights-review-approval.json`
- `runtime/state/clipbaiters/clipbaiters-viral-moments/lane-posture-approval.json`
- `runtime/ops/social-profiles.json`
- `runtime/ops/social-profiles.md`
- `runtime/ops/clipbaiters/clipbaiters-viral-moments/plan.json`
- `runtime/ops/clipbaiters/clipbaiters-viral-moments/plan.md`
- `runtime/ops/clipbaiters/clipbaiters-viral-moments/rights-review-approval.md`
- `runtime/ops/clipbaiters/clipbaiters-viral-moments/lane-posture-approval.md`
- `runtime/ops/clipbaiters/clipbaiters-viral-moments/roadblock-email.md`
- `runtime/ops/clipbaiters/clipbaiters-viral-moments/roadblock-notification.json`
- `runtime/ops/clipbaiters/clipbaiters-viral-moments/launch-checklist.md`
- `runtime/ops/clipbaiters/clipbaiters-viral-moments/daily-brief.md`
- `runtime/ops/clipbaiters/clipbaiters-viral-moments/daily-summary.md`
- `runtime/ops/clipbaiters/clipbaiters-viral-moments/autonomy-run.json`
- `runtime/ops/clipbaiters/clipbaiters-viral-moments/autonomy-run.md`
- `runtime/ops/clipbaiters/clipbaiters-viral-moments/autonomy-run-<lane-id>.json`
- `runtime/ops/clipbaiters/clipbaiters-viral-moments/autonomy-run-<lane-id>.md`
- `runtime/ops/clipbaiters/clipbaiters-viral-moments/draft-clips/`
- `runtime/ops/clipbaiters/clipbaiters-viral-moments/upload-batches.json`
- `runtime/ops/clipbaiters/clipbaiters-viral-moments/review-queue.md`
- `runtime/ops/clipbaiters/clipbaiters-viral-moments/channel-metrics.md`
- `runtime/ops/clipbaiters/clipbaiters-viral-moments/creator-deals.md`
- `runtime/ops/clipbaiters/clipbaiters-viral-moments/monetization-report.md`
- `runtime/ops/org-control-plane.json`
- `runtime/ops/office-views.json`
- `runtime/ops/venture-blueprints/clipbaiters-viral-moments.json`
- `runtime/ops/venture-blueprints/clipbaiters-viral-moments.md`
- `runtime/ops/venture-studio.json`
- `runtime/ops/venture-studio.md`
- `runtime/source-feeds/clipbaiters/clipbaiters-viral-moments/README.md`

## Next Implementation Boundaries

- The April 9 YouTube-growth execution plan's steps 1-6 are now in the repo.
- Discovery, skimming, render execution, randomized scheduling, creator-deals tracking, publish history, and daily-summary reporting are all file-backed and schedulable.
- Publishing remains review-gated where it should: political and ambiguous-rights material stay blocked behind manual review, synthetic story briefs cannot enter the publish queue, and live uploads only use the controlled Studio helper when a lane is explicitly eligible.
- `clipbaiters-political` and `clipbaiters-media` are the current YouTube-first rollout lanes.
- `clipbaiters-streaming`, `clipbaiters-animated`, and `clipbaiters-celebs` remain passive until their channels and source-policy posture are ready.