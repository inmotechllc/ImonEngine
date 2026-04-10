# Plan: ClipBaiters Autonomy Gap Closure

**Goal**

Close the post-step-7 gaps in `clipbaiters-viral-moments` so the business can run with low-friction, high-autonomy loops across niche YouTube lanes: discover promising new, live, or recently popular videos from approved source rosters, skim them into ranked clip opportunities, draft and queue niche-specific uploads, and run a lightweight creator-deals pipeline for `ClipBaitersStreaming`. The design should stay lean: one shared ClipBaiters identity, manual channel creation by the owner, YouTube-first automation, optional umbrella Facebook reuse, and no new heavyweight external setup such as separate niche inboxes or required YouTube API credentials.

**Subsystems touched**

- ClipBaiters lane model and services
- shared config and `.env.example`
- social profile registry
- engine CLI surface
- VPS cadence and worker flow
- organization control plane and office views
- setup and operating docs

**Prerequisites**

- Keep the current business id as `clipbaiters-viral-moments`.
- Keep one shared ClipBaiters identity only. Do not add separate off-platform email accounts per niche.
- Keep initial live scope to YouTube channels per niche plus one optional umbrella `facebook_page`.
- Keep `clipbaiters-political` and `clipbaiters-streaming` as the only initially active autonomous lanes. Leave `clipbaiters-media`, `clipbaiters-animated`, and `clipbaiters-celebs` present in state but gated or passive until channels and source policy are ready.
- Treat political, celebrity, and any ambiguous-rights surfaces as manual-review lanes even after upload automation exists.
- Avoid adding a required YouTube API key in v1. Prefer channel URLs, channel RSS, official pages, `yt-dlp --flat-playlist`, and the existing signed-in Chrome profile to keep setup minimal.

**Ordered steps**

1. **Expand the ClipBaiters config and identity surface without increasing account sprawl**
   - Outcome: the repo can store the owner-created channel and platform metadata needed for lane-specific publishing and verification while keeping setup minimal.
   - Files to inspect or change:
     - `/root/ImonEngine/.env.example`
     - `/root/ImonEngine/src/config.ts`
     - `/root/ImonEngine/src/services/store-ops.ts`
     - `/root/ImonEngine/src/services/clipbaiters-studio.ts`
     - `/root/ImonEngine/src/domain/clipbaiters.ts`
     - `/root/ImonEngine/runtime/state/socialProfiles.json`
   - Docs to update:
     - `/root/ImonEngine/docs/setup.md`
     - `/root/ImonEngine/docs/clipbaiters-viral-moments.md`
     - `/root/ImonEngine/docs/imon-engine.md`
     - `/root/ImonEngine/README.md`
   - Add these ClipBaiters placeholders to `.env.example`:
     - Required:
       - `CLIPBAITERS_SHARED_ALIAS_EMAIL=`
       - `CLIPBAITERS_FACEBOOK_PAGE_URL=`
       - `CLIPBAITERS_YOUTUBE_POLITICAL_CHANNEL_URL=`
       - `CLIPBAITERS_YOUTUBE_MEDIA_CHANNEL_URL=`
       - `CLIPBAITERS_YOUTUBE_ANIMATED_CHANNEL_URL=`
       - `CLIPBAITERS_YOUTUBE_CELEBS_CHANNEL_URL=`
       - `CLIPBAITERS_YOUTUBE_STREAMING_CHANNEL_URL=`
       - `CLIPBAITERS_CREATOR_CONTACT_EMAIL=`
       - `CLIPBAITERS_CREATOR_BOOKING_URL=`
     - Optional, only if upload routing or validation needs stronger channel binding:
       - `CLIPBAITERS_FACEBOOK_PAGE_ID=`
       - `CLIPBAITERS_YOUTUBE_POLITICAL_CHANNEL_ID=`
       - `CLIPBAITERS_YOUTUBE_MEDIA_CHANNEL_ID=`
       - `CLIPBAITERS_YOUTUBE_ANIMATED_CHANNEL_ID=`
       - `CLIPBAITERS_YOUTUBE_CELEBS_CHANNEL_ID=`
       - `CLIPBAITERS_YOUTUBE_STREAMING_CHANNEL_ID=`
       - `CLIPBAITERS_ACTIVE_LANES=clipbaiters-political,clipbaiters-streaming`
   - Validation:
     - `npm test`
     - `npm run build`
     - `npm run dev -- social-profiles --business clipbaiters-viral-moments`
     - `npm run dev -- clipbaiters-plan --business clipbaiters-viral-moments`
   - Notes:
     - Keep per-lane channel metadata in the existing social-profile system, not a second channel-registry subsystem.
     - Do not add TikTok or Instagram env requirements in this phase.

2. **Replace synthetic radar templates with real lane-specific source collection**
   - Outcome: ClipBaiters can collect candidate videos and events from approved niche rosters instead of relying mainly on synthetic templates and manual manifests.
   - Files to inspect or change:
     - `/root/ImonEngine/src/services/clipbaiters-radar.ts`
     - `/root/ImonEngine/src/services/clipbaiters-studio.ts`
     - `/root/ImonEngine/src/services/clipbaiters-autonomy.ts`
     - `/root/ImonEngine/src/services/clipbaiters-ingest.ts`
     - `/root/ImonEngine/src/domain/clipbaiters.ts`
     - `/root/ImonEngine/src/storage/store.ts`
     - `/root/ImonEngine/src/index.ts`
     - `/root/ImonEngine/src/services/clipbaiters-collector.ts`
     - `/root/ImonEngine/src/services/clipbaiters-skimmer.ts`
     - `/root/ImonEngine/runtime/state/clipbaiters/clipbaiters-viral-moments/source-registry.json`
     - `/root/ImonEngine/runtime/state/clipbaiters/clipbaiters-viral-moments/source-watchlists.json`
     - `/root/ImonEngine/runtime/state/clipbaiters/clipbaiters-viral-moments/video-discovery.json`
     - `/root/ImonEngine/runtime/state/clipbaiters/clipbaiters-viral-moments/skim-summaries.json`
     - `/root/ImonEngine/runtime/ops/clipbaiters/clipbaiters-viral-moments/daily-brief.md`
   - Docs to update:
     - `/root/ImonEngine/docs/clipbaiters-viral-moments.md`
     - `/root/ImonEngine/docs/imon-engine.md`
     - `/root/ImonEngine/docs/setup.md`
     - `/root/ImonEngine/docs/playbook.md`
   - Add CLI commands:
     - `npm run dev -- clipbaiters-collect --business clipbaiters-viral-moments [--lane <id>]`
     - `npm run dev -- clipbaiters-skim --business clipbaiters-viral-moments [--lane <id>]`
   - Collector scope by lane:
     - `clipbaiters-political`: official YouTube channels, official live and upcoming streams, government calendars, and news discovery feeds used only as discovery, not direct source-of-truth clips.
     - `clipbaiters-streaming`: creator-authorized YouTube channels, creator stream schedules, and manual creator briefs.
     - `clipbaiters-media`, `clipbaiters-celebs`, `clipbaiters-animated`: track only approved official or licensed rosters; do not auto-activate broad scraping.
   - Validation:
     - `npm test`
     - `npm run build`
     - `npm run dev -- clipbaiters-collect --business clipbaiters-viral-moments --lane clipbaiters-political`
     - `npm run dev -- clipbaiters-skim --business clipbaiters-viral-moments --lane clipbaiters-political`
     - `npm run dev -- clipbaiters-radar --business clipbaiters-viral-moments --lane clipbaiters-streaming`
   - Notes:
     - Prefer `yt-dlp --flat-playlist`, channel RSS, and official page parsing over authenticated YouTube API setup.
     - Skimming should start from metadata, transcript excerpts, and short preview windows before any heavier clip pipeline runs.

3. **Make autonomy multi-lane and roster-driven instead of single-lane and manual-manifest-heavy**
   - Outcome: ClipBaiters can run a daily loop across all active lanes and only fall back to manual manifests where rights or creator authorization require it.
   - Files to inspect or change:
     - `/root/ImonEngine/src/services/clipbaiters-autonomy.ts`
     - `/root/ImonEngine/src/services/clipbaiters-radar.ts`
     - `/root/ImonEngine/src/services/clipbaiters-publisher.ts`
     - `/root/ImonEngine/src/services/clipbaiters-analytics.ts`
     - `/root/ImonEngine/src/domain/clipbaiters.ts`
     - `/root/ImonEngine/src/index.ts`
     - `/root/ImonEngine/scripts/imon-engine-sync.sh`
     - `/root/ImonEngine/scripts/run_vps_autopilot.sh`
     - `/root/ImonEngine/runtime/ops/clipbaiters/clipbaiters-viral-moments/autonomy-run.json`
     - `/root/ImonEngine/runtime/ops/clipbaiters/clipbaiters-viral-moments/autonomy-run.md`
     - `/root/ImonEngine/runtime/ops/clipbaiters/clipbaiters-viral-moments/channel-metrics.md`
     - `/root/ImonEngine/runtime/ops/clipbaiters/clipbaiters-viral-moments/daily-summary.md`
   - Docs to update:
     - `/root/ImonEngine/docs/clipbaiters-viral-moments.md`
     - `/root/ImonEngine/docs/vps-tooling.md`
     - `/root/ImonEngine/docs/imon-engine.md`
     - `/root/ImonEngine/docs/playbook.md`
     - `/root/ImonEngine/README.md`
   - Add CLI commands or flags:
     - `npm run dev -- clipbaiters-autonomy-run --business clipbaiters-viral-moments --all-active-lanes --dry-run`
     - `npm run dev -- clipbaiters-publish --business clipbaiters-viral-moments --all-active-lanes --dry-run`
   - Validation:
     - `npm test`
     - `npm run build`
     - `npm run dev -- clipbaiters-autonomy-run --business clipbaiters-viral-moments --all-active-lanes --dry-run`
     - `npm run dev -- clipbaiters-publish --business clipbaiters-viral-moments --all-active-lanes --dry-run`
     - `npm run dev -- engine-sync`
   - Notes:
     - Keep `clipbaiters-media`, `clipbaiters-celebs`, and `clipbaiters-animated` passive until their channel URLs and source rosters are present.
     - The scheduled VPS cadence should switch from one hard-coded lane to all active lanes once this step is complete.

4. **Add a lightweight creator-roster and deals pipeline instead of a full CRM**
   - Outcome: ClipBaiters can identify promising creator prospects, draft offers, track deal stages, and convert accepted deals into creator-order intake manifests without introducing a second business-development stack.
   - Files to inspect or change:
     - `/root/ImonEngine/src/services/clipbaiters-intake.ts`
     - `/root/ImonEngine/src/services/clipbaiters-monetization.ts`
     - `/root/ImonEngine/src/services/clipbaiters-deals.ts`
     - `/root/ImonEngine/src/services/clipbaiters-studio.ts`
     - `/root/ImonEngine/src/domain/clipbaiters.ts`
     - `/root/ImonEngine/src/storage/store.ts`
     - `/root/ImonEngine/src/index.ts`
     - `/root/ImonEngine/runtime/state/clipbaiters/clipbaiters-viral-moments/creator-leads.json`
     - `/root/ImonEngine/runtime/state/clipbaiters/clipbaiters-viral-moments/creator-outreach.json`
     - `/root/ImonEngine/runtime/state/clipbaiters/clipbaiters-viral-moments/creator-orders.json`
     - `/root/ImonEngine/runtime/ops/clipbaiters/clipbaiters-viral-moments/creator-deals.md`
     - `/root/ImonEngine/runtime/source-feeds/clipbaiters/clipbaiters-viral-moments/creator-orders/README.md`
   - Docs to update:
     - `/root/ImonEngine/docs/clipbaiters-viral-moments.md`
     - `/root/ImonEngine/docs/setup.md`
     - `/root/ImonEngine/docs/playbook.md`
     - `/root/ImonEngine/docs/imon-engine.md`
   - Add CLI commands:
     - `npm run dev -- clipbaiters-source-creators --business clipbaiters-viral-moments`
     - `npm run dev -- clipbaiters-draft-creator-outreach --business clipbaiters-viral-moments`
     - `npm run dev -- clipbaiters-deals-report --business clipbaiters-viral-moments`
   - Validation:
     - `npm test`
     - `npm run build`
     - `npm run dev -- clipbaiters-source-creators --business clipbaiters-viral-moments`
     - `npm run dev -- clipbaiters-draft-creator-outreach --business clipbaiters-viral-moments`
     - `npm run dev -- clipbaiters-monetization-report --business clipbaiters-viral-moments`
   - Notes:
     - Keep the deals model small: `prospect`, `contacted`, `interested`, `quoted`, `paid`, `active`, `paused`, `closed_lost`.
     - Reuse the existing shared Gmail path only if configured; otherwise generate approval-gated outbound drafts and keep sending manual.
     - The goal is not a general-purpose CRM. The goal is just enough creator pipeline to feed `ClipBaitersStreaming` with recurring work.

5. **Move publishing from permanent dry-run to controlled live upload for eligible lanes**
   - Outcome: once channels exist and review gates are satisfied, ClipBaiters can upload to the correct YouTube lane using the shared signed-in Chrome profile while preserving manual review for high-risk content.
   - Files to inspect or change:
     - `/root/ImonEngine/src/services/clipbaiters-publisher.ts`
     - `/root/ImonEngine/src/services/clipbaiters-analytics.ts`
     - `/root/ImonEngine/src/services/clipbaiters-autonomy.ts`
     - `/root/ImonEngine/src/index.ts`
     - `/root/ImonEngine/scripts/chrome_cdp.py`
     - `/root/ImonEngine/scripts/youtube_studio_upload.py`
     - `/root/ImonEngine/src/domain/clipbaiters.ts`
     - `/root/ImonEngine/runtime/state/clipbaiters/clipbaiters-viral-moments/publishing-queue.json`
     - `/root/ImonEngine/runtime/state/clipbaiters/clipbaiters-viral-moments/publish-history.json`
     - `/root/ImonEngine/runtime/ops/clipbaiters/clipbaiters-viral-moments/upload-batches.json`
     - `/root/ImonEngine/runtime/ops/clipbaiters/clipbaiters-viral-moments/review-queue.md`
   - Docs to update:
     - `/root/ImonEngine/docs/clipbaiters-viral-moments.md`
     - `/root/ImonEngine/docs/vps-tooling.md`
     - `/root/ImonEngine/docs/setup.md`
     - `/root/ImonEngine/docs/playbook.md`
     - `/root/ImonEngine/README.md`
   - Validation:
     - `npm test`
     - `npm run build`
     - `python3 /root/ImonEngine/scripts/chrome_cdp.py --help`
     - `npm run dev -- clipbaiters-publish --business clipbaiters-viral-moments --lane clipbaiters-streaming --dry-run`
     - `npm run dev -- clipbaiters-publish --business clipbaiters-viral-moments --lane clipbaiters-political --dry-run`
   - Notes:
     - Keep `clipbaiters-political` review-gated even after live upload exists.
     - The first live-upload target should be `clipbaiters-streaming` once a creator-authorized channel and test clip flow exist.
     - Do not require the YouTube API in this phase; prefer Studio automation through the existing persistent Chrome profile.

6. **Expose the new autonomy and deals states in the control plane and VPS cadence**
   - Outcome: the office view shows lane readiness, creator-deal backlog, and live-upload eligibility, and the VPS wrapper runs the right ClipBaiters steps automatically.
   - Files to inspect or change:
     - `/root/ImonEngine/src/services/org-templates.ts`
     - `/root/ImonEngine/src/services/organization-control-plane.ts`
     - `/root/ImonEngine/src/services/office-templates.ts`
     - `/root/ImonEngine/src/agents/imon-engine.ts`
     - `/root/ImonEngine/scripts/imon-engine-sync.sh`
     - `/root/ImonEngine/scripts/run_vps_autopilot.sh`
     - `/root/ImonEngine/runtime/ops/org-control-plane.json`
     - `/root/ImonEngine/runtime/ops/office-views.json`
     - `/root/ImonEngine/runtime/ops/clipbaiters/clipbaiters-viral-moments/launch-checklist.md`
   - Docs to update:
     - `/root/ImonEngine/docs/org-control-plane.md`
     - `/root/ImonEngine/docs/clipbaiters-viral-moments.md`
     - `/root/ImonEngine/docs/vps-tooling.md`
     - `/root/ImonEngine/docs/imon-engine.md`
   - Validation:
     - `npm test`
     - `npm run build`
     - `npm run dev -- org-sync`
     - `npm run dev -- org-report --business clipbaiters-viral-moments`
     - `npm run dev -- office-dashboard`
     - `bash /root/ImonEngine/scripts/imon-engine-sync.sh`
   - Notes:
     - The control plane should clearly distinguish `collect`, `skim`, `draft`, `review`, `upload`, and `creator-deals` stages so the lane can be supervised without opening raw JSON.

**Validation**

- Default validation after each implementation step:
  - `npm test`
  - `npm run build`
- Feature validation sequence once all steps are complete:
  - `npm run dev -- social-profiles --business clipbaiters-viral-moments`
  - `npm run dev -- clipbaiters-collect --business clipbaiters-viral-moments --lane clipbaiters-political`
  - `npm run dev -- clipbaiters-skim --business clipbaiters-viral-moments --lane clipbaiters-political`
  - `npm run dev -- clipbaiters-autonomy-run --business clipbaiters-viral-moments --all-active-lanes --dry-run`
  - `npm run dev -- clipbaiters-draft-creator-outreach --business clipbaiters-viral-moments`
  - `npm run dev -- clipbaiters-monetization-report --business clipbaiters-viral-moments`
  - `npm run dev -- org-sync`
  - `bash /root/ImonEngine/scripts/imon-engine-sync.sh`
  - `bash /root/ImonEngine/scripts/vps-tooling-status.sh`

**Risks and notes**

- The main business risk remains rights and platform-policy enforcement, not clip detection. The plan should keep risky lanes gated by default.
- The autonomy target should be “roster-driven and review-aware,” not “blind trend scraping.” Curated rosters of official or authorized channels are safer and simpler than broad search crawling.
- `clipbaiters-political` and `clipbaiters-streaming` are the only lanes that should become autonomous first. The other lanes can keep passive discovery until their channels and source rules are mature.
- Creator deals should stay lightweight and file-backed. Do not build a second Northline-sized sales system for this business.
- Manual channel creation remains outside scope. The repo should only assume that channel URLs and optional IDs are filled into `.env.example` and synced into social profiles.
- Do not require separate niche inboxes, Meta app setup per lane, or per-lane browser profiles.
- If the Studio-upload path proves brittle, keep the queue and review automation intact and leave final upload as a browser-assisted manual step for high-risk lanes.

**Handoff instructions for `@imon-engine`**

- Treat this as a follow-on plan after `docs/plans/2026-04-07-clipbaiters-viral-moments.md`. Do not reopen or rewrite the completed step-1 through step-7 plan unless an overlap needs to be explicitly amended.
- Implement this plan in order. Do step 1 before collector work so the channel and identity data model is stable first.
- Keep the setup surface lean: one shared alias, one optional umbrella Facebook page, one YouTube channel URL per niche, and no required YouTube API credentials.
- Only graduate `clipbaiters-political` and `clipbaiters-streaming` into the autonomous schedule first.
- Update `/root/ImonEngine/docs/clipbaiters-viral-moments.md`, `/root/ImonEngine/docs/setup.md`, `/root/ImonEngine/docs/imon-engine.md`, and `/root/ImonEngine/README.md` in the same change set whenever commands, env vars, or runtime artifacts change.
- If new runtime artifacts are added for creator leads, outreach, discovery, or skim summaries, surface them in the control plane and add them to the ClipBaiters section of `docs/autonomy/agents/README.md` or `docs/autonomy/agents/context-map.json` as needed.
- Keep political and celebrity uploads behind manual review even after live upload support exists.