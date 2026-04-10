# Plan: ClipBaiters - Viral Moments

**Goal**

Create a new managed business lane, `clipbaiters-viral-moments`, that uses ImonEngine workers to discover upcoming viral moments, ingest approved source video, cut short-form clips, publish them to niche-specific YouTube channels, and monetize through creator clipping services first and audience monetization second. The implementation should stay file-backed, worker-friendly, and conservative about rights, platform policy, and political/news integrity.

**Subsystems touched**

- engine
- venture-studio
- faceless social brand / social profiles
- organization control plane
- VPS worker and browser tooling
- setup and runtime-state contracts
- docs and autonomy context hub

**Prerequisites**

- Decide whether ClipBaiters replaces the deferred `imon-faceless-social-brand` / `Velora Echo Media` placeholder or ships as a separate managed business beside it. This plan assumes a separate new business: `clipbaiters-viral-moments`.
A: This will be a separate new business.
- Keep the initial platform scope to niche-specific YouTube channels under the ImonEngine Gmail alias family plus one optional umbrella `facebook_page`. Leave TikTok and Instagram deferred until the YouTube workflow, proof loop, and review gates are stable.
A: Yes this sounds good.
- Treat raw repost clipping as out of scope. Only ingest rights-cleared, creator-authorized, public-domain, official-government, or materially transformed commentary-led clips that pass a compliance gate.
A: Sounds good, as long as the clips fall under fair use we should be fine. 
- Keep `ClipBaitersMedia` and `ClipBaitersAnimated` in `research_only` or equivalent gated mode until a rights policy is approved. Their source surface is too risky to treat as monetization-ready on day one.
A: The different Niches should pretty much exist only for social media platforms, and content searches. So each ClipBaiters sub brand would used to filter the kind of clips we are using and to separate audience. They should not have separate email addresses or accounts outside of the platforms.
- Use `ClipBaitersPolitical` as the first editorial lane for trend/event radar and `ClipBaitersStreaming` as the first direct-revenue lane for creator-paid auto clipping.
ClipBaitersPolitical would be specifically for politics, government news, etc. Non political news can be added to ClipBaitersMedia 
- Keep the signed-in VPS Chrome profile available for Gmail and future YouTube Studio reuse, and keep the worker path available through `scripts/business-worker-start.sh`.
A: This is fine because the youtube channel uses the ImonEngine chrome profile

**Monetization priority stack**

1. `ClipBaitersStreaming` paid clipping service: creator retainers, event packages, and rush-turnaround clip packs.
2. YouTube monetization for lanes that meet platform eligibility and reused-content rules with original commentary, packaging, and proof of transformation.
3. Sponsorship and affiliate placements that fit the lane and can be disclosed cleanly.
4. Later licensing or syndication only for creator-authorized or otherwise owned editorial packages.

**Ordered steps**

1. **Register the business and create the canonical lane docs**
   - Outcome: ClipBaiters exists as a first-class managed business with a clear business ID, approval posture, summary, launch blockers, and venture-blueprint output.
   - Files to inspect or change:
     - `src/domain/defaults.ts`
     - `src/agents/imon-engine.ts`
     - `src/services/venture-studio.ts`
     - `src/domain/venture.ts`
     - `src/index.ts`
     - `src/domain/contracts.ts`
     - `runtime/state/businesses.json`
     - `runtime/ops/venture-blueprints/clipbaiters-viral-moments.json`
     - `runtime/ops/venture-blueprints/clipbaiters-viral-moments.md`
   - Docs to update:
     - `docs/clipbaiters-viral-moments.md`
     - `docs/venture-studio.md`
     - `docs/imon-engine.md`
     - `README.md`
     - `docs/autonomy/agents/README.md`
     - `docs/autonomy/agents/context-map.json`
   - Validation:
     - `npm test`
     - `npm run build`
     - `npm run dev -- engine-sync`
     - `npm run dev -- venture-studio`
     - `npm run dev -- org-report --business clipbaiters-viral-moments`
   - Depends on: none
   - Notes:
     - Set the new business approval posture to `compliance` or another explicit manual-review gate, not a blind content-publishing default.
     - If you choose to replace Velora instead of adding a new seed, update this phase before implementation so runtime state and docs do not describe two competing faceless-social businesses.

2. **Expand the social/channel model for YouTube-first niche operations**
   - Outcome: the repo can represent one umbrella Facebook surface plus multiple manual YouTube channels for a single business, while keeping TikTok and Instagram optional and deferred.
   - Files to inspect or change:
     - `src/domain/social.ts`
     - `src/services/store-ops.ts`
     - `src/services/venture-studio.ts`
     - `src/services/micro-saas-studio.ts`
     - `src/services/storefront-site.ts`
     - `src/domain/micro-saas.ts`
     - `src/workflows.test.ts`
     - `src/config.ts`
     - `.env.example`
     - `runtime/state/socialProfiles.json`
   - Docs to update:
     - `docs/setup.md`
     - `docs/venture-studio.md`
     - `docs/vps-tooling.md`
     - `docs/clipbaiters-viral-moments.md`
   - Validation:
     - `npm test`
     - `npm run build`
     - `npm run dev -- social-profiles --business clipbaiters-viral-moments`
     - `npm run dev -- venture-studio --business clipbaiters-viral-moments`
   - Depends on: step 1
   - Notes:
     - Add a new `youtube_channel` social platform type now.
     - Add `tiktok_account` only if you want the schema ready for later work, but keep the actual business rollout and docs marked as deferred.
     - The niche roster should exist as data even if the user creates the actual channels manually:
       - `clipbaiters-political`
       - `clipbaiters-media`
       - `clipbaiters-animated`
       - `clipbaiters-celebs`
       - `clipbaiters-streaming`
     - Default social policy for this lane should be: separate YouTube channels per niche, zero Instagram or TikTok launch obligations, and one optional umbrella `facebook_page` only if organic distribution or later ads justify it.

3. **Create the ClipBaiters domain model, planning service, and source radar**
   - Outcome: the lane has durable file-backed state for niche definitions, approved sources, event forecasts, story candidates, and editorial briefs.
   - Files to inspect or change:
     - `src/domain/clipbaiters.ts`
     - `src/services/clipbaiters-studio.ts`
     - `src/services/clipbaiters-radar.ts`
     - `src/storage/store.ts`
     - `src/index.ts`
     - `src/config.ts`
     - `runtime/state/clipbaiters/clipbaiters-viral-moments/lane-registry.json`
     - `runtime/state/clipbaiters/clipbaiters-viral-moments/source-registry.json`
     - `runtime/state/clipbaiters/clipbaiters-viral-moments/event-radar.json`
     - `runtime/state/clipbaiters/clipbaiters-viral-moments/story-candidates.json`
     - `runtime/ops/clipbaiters/clipbaiters-viral-moments/plan.json`
     - `runtime/ops/clipbaiters/clipbaiters-viral-moments/plan.md`
     - `runtime/ops/clipbaiters/clipbaiters-viral-moments/daily-brief.md`
     - `runtime/source-feeds/clipbaiters/clipbaiters-viral-moments/`
   - Docs to update:
     - `docs/clipbaiters-viral-moments.md`
     - `docs/imon-engine.md`
     - `docs/setup.md`
     - `docs/playbook.md`
     - `docs/autonomy/agents/README.md`
     - `docs/autonomy/agents/context-map.json`
   - Validation:
     - `npm test`
     - `npm run build`
     - `npm run dev -- clipbaiters-plan --business clipbaiters-viral-moments`
     - `npm run dev -- clipbaiters-radar --business clipbaiters-viral-moments --lane clipbaiters-political`
   - Depends on: steps 1-2
   - Notes:
     - Use source types that fit the lane and stay realistic for low-cost automation:
       - `ClipBaitersPolitical`: Google News RSS, GDELT, official press calendars, White House / campaign / agency schedules, official YouTube live or upcoming pages, C-SPAN-style public feeds.
       - `ClipBaitersStreaming`: creator-authorized channel registry, scheduled stream feeds, manual creator brief drops, and approved calendar entries.
       - `ClipBaitersCelebs`: official interview channels, press junkets, award-show owned clips, and public social posts where the platform terms allow reuse.
       - `ClipBaitersMedia`: official trailers, press clips, interviews, and licensed snippets only.
       - `ClipBaitersAnimated`: licensed or publisher-authorized footage only until rights strategy changes.
     - The daily radar should rank candidates by event imminence, novelty, emotional charge, clip potential, policy risk, and source trust.

4. **Build the approved-source ingest, transcription, and clip-draft pipeline**
   - Outcome: workers can ingest approved sources, transcribe them, detect likely short-form moments, and output draft clip packages with captions and edit metadata.
   - Files to inspect or change:
     - `src/services/clipbaiters-ingest.ts`
     - `src/services/clipbaiters-editor.ts`
     - `src/services/clipbaiters-autonomy.ts`
     - `src/config.ts`
     - `src/index.ts`
     - `docker/business-worker/Dockerfile`
     - `docker/business-worker/compose.yml`
     - `scripts/bootstrap-vps-tools.sh`
     - `scripts/vps-tooling-status.sh`
     - `scripts/business-worker-start.sh`
     - `runtime/state/clipbaiters/clipbaiters-viral-moments/clip-candidates.json`
     - `runtime/state/clipbaiters/clipbaiters-viral-moments/clip-jobs.json`
     - `runtime/ops/clipbaiters/clipbaiters-viral-moments/draft-clips/`
   - Docs to update:
     - `docs/clipbaiters-viral-moments.md`
     - `docs/setup.md`
     - `docs/vps-tooling.md`
   - Validation:
     - `npm test`
     - `npm run build`
     - `scripts/business-worker-start.sh clipbaiters-viral-moments "ClipBaiters - Viral Moments"`
     - `scripts/business-worker-status.sh clipbaiters-viral-moments`
     - `npm run dev -- clipbaiters-autonomy-run --business clipbaiters-viral-moments --lane clipbaiters-political --dry-run`
   - Depends on: step 3
   - Notes:
     - Install and document the tools that best fit the workflow and cost target:
       - `ffmpeg` for clipping, reframing, subtitles, loudness, and packaging
       - `yt-dlp` only for approved-source acquisition
       - Whisper, whisper.cpp, or OpenAI transcription for searchable transcripts
       - scene and silence detection tooling such as PySceneDetect plus audio-spike heuristics
       - optional OCR for on-screen text and chyron extraction
     - Keep raw source URLs and rights basis attached to every clip job so the system can prove why a clip entered the queue.

5. **Add publishing, review gates, and analytics capture**
   - Outcome: the lane can queue titles, thumbnails, descriptions, and uploads for niche channels while keeping a manual-review checkpoint for political, celebrity, and any rights-sensitive material.
   - Files to inspect or change:
     - `src/services/clipbaiters-publisher.ts`
     - `src/services/clipbaiters-analytics.ts`
     - `src/storage/store.ts`
     - `src/index.ts`
     - `src/domain/social.ts`
     - `scripts/chrome_cdp.py`
     - `scripts/publish_growth_post.py`
     - `runtime/state/clipbaiters/clipbaiters-viral-moments/publishing-queue.json`
     - `runtime/state/clipbaiters/clipbaiters-viral-moments/channel-metrics.json`
     - `runtime/ops/clipbaiters/clipbaiters-viral-moments/upload-batches.json`
     - `runtime/ops/clipbaiters/clipbaiters-viral-moments/review-queue.md`
   - Docs to update:
     - `docs/clipbaiters-viral-moments.md`
     - `docs/playbook.md`
     - `docs/vps-tooling.md`
     - `README.md`
   - Validation:
     - `npm test`
     - `npm run build`
     - `npm run dev -- clipbaiters-publish --business clipbaiters-viral-moments --lane clipbaiters-political --dry-run`
     - `npm run dev -- org-report --business clipbaiters-viral-moments`
     - `npm run dev -- office-views`
   - Depends on: step 4
   - Notes:
     - Political and news lanes should never auto-publish without a human review gate that checks context, attribution, and editing integrity.
     - The first live upload path should target YouTube only. Treat umbrella-Facebook reposting as optional secondary distribution once the clip QA path is stable.
     - Track watch-through, retention, click-through, subscriber delta, and strike or claim events in the same lane state so growth and policy health stay visible together.

6. **Build the direct monetization path before waiting on channel rev share**
   - Outcome: `ClipBaitersStreaming` can sell auto-clipping services with explicit package tiers, approval tasks, payment links, and delivery artifacts, while channel monetization remains a second track.
   - Files to inspect or change:
     - `src/domain/clipbaiters.ts`
     - `src/services/clipbaiters-monetization.ts`
     - `src/services/clipbaiters-intake.ts`
     - `src/storage/store.ts`
     - `src/index.ts`
     - `src/config.ts`
     - `.env.example`
     - `runtime/state/clipbaiters/clipbaiters-viral-moments/creator-offers.json`
     - `runtime/state/clipbaiters/clipbaiters-viral-moments/creator-orders.json`
     - `runtime/state/clipbaiters/clipbaiters-viral-moments/revenue-snapshots.json`
     - `runtime/ops/clipbaiters/clipbaiters-viral-moments/monetization-report.md`
   - Docs to update:
     - `docs/clipbaiters-viral-moments.md`
     - `docs/setup.md`
     - `docs/playbook.md`
     - `docs/imon-engine.md`
   - Validation:
     - `npm test`
     - `npm run build`
     - `npm run dev -- clipbaiters-monetization-report --business clipbaiters-viral-moments`
     - `npm run dev -- approvals`
   - Depends on: steps 3-5
   - Notes:
     - Prioritize revenue offers that fit the source-rights reality:
       - monthly streamer clipping retainers
       - event-based clipping packages for debates, launches, and creator collabs
       - premium rush editing fee
       - later sponsorship inventory once the channel proof exists
     - Do not plan the first revenue month around Instagram or TikTok monetization.
     - Keep financial decisions tied to verified exports and actual paid orders, not estimated platform dashboards.

7. **Wire the lane into the control plane, workers, and scheduled engine flow**
   - Outcome: ClipBaiters appears in office views, has explicit workflow ownership, uses isolated workers, and can run on a scheduled cadence without bypassing review gates.
   - Files to inspect or change:
     - `src/services/org-templates.ts`
     - `src/services/organization-control-plane.ts`
     - `src/services/office-templates.ts`
     - `src/agents/imon-engine.ts`
     - `scripts/install-cron.sh`
     - `scripts/run_vps_autopilot.sh`
     - `docs/autonomy/agents/README.md`
     - `docs/autonomy/agents/context-map.json`
     - `runtime/ops/org-control-plane.json`
     - `runtime/ops/office-views.json`
     - `runtime/ops/clipbaiters/clipbaiters-viral-moments/launch-checklist.md`
   - Docs to update:
     - `docs/org-control-plane.md`
     - `docs/vps-tooling.md`
     - `docs/playbook.md`
     - `docs/imon-engine.md`
     - `README.md`
     - `docs/clipbaiters-viral-moments.md`
   - Validation:
     - `npm test`
     - `npm run build`
     - `npm run dev -- engine-sync`
     - `npm run dev -- org-sync`
     - `npm run dev -- org-report --business clipbaiters-viral-moments`
     - `npm run dev -- office-dashboard`
     - `scripts/business-worker-status.sh clipbaiters-viral-moments`
   - Depends on: steps 1-6
   - Notes:
     - The default scheduled workflow should run radar, candidate refresh, review-queue generation, and monetization reporting. It should not auto-publish rights-sensitive clips without the review gate clearing them.
     - Use one business worker for the umbrella lane first, then split by niche only if CPU, storage, or policy isolation requires it.

**Risks and notes**

- The largest risk is rights and reused-content policy, not clip-detection quality. A plan built around raw TV, movie, or anime reposts is unlikely to stay monetizable.
- `ClipBaitersMedia` and `ClipBaitersAnimated` should stay intentionally gated until their source strategy is licensed, creator-authorized, or otherwise explicitly approved.
- Political and news content requires stronger review than the other lanes. Do not publish misleading edits, manipulated context, or clips that create defamation or misinformation risk.
- The fastest trustworthy revenue is the `ClipBaitersStreaming` service offer, not YouTube rev share. Treat audience monetization as a second-stage upside, not the first cash source.
- The business should not depend on paid ads at launch. Organic discovery plus direct creator offers are a better fit for the lane the user described.
- Keep account creation manual at first. Build the niche registry, channel checklists, and workflow automation before trying to script account creation.
- Keep TikTok and Instagram deferred until the YouTube pipeline, rights review process, and monetization loop are working.
- If a source cannot be tied back to a stored rights basis, it should not reach the clip queue.
- Keep all generated outputs file-backed under source control-visible runtime paths, not in hidden worker-local state.

**Default execution assumptions**

- `clipbaiters-viral-moments` should ship as a new managed business alongside `Velora Echo Media`; do not replace Velora unless the owner later asks for consolidation.
- Launch scope should remain rights-cleared and creator-authorized. `ClipBaitersMedia` and `ClipBaitersAnimated` stay blocked behind an explicit rights-policy approval gate.
- The first monetization sprint should prioritize `ClipBaitersStreaming` paid clipping services ahead of broader audience-led monetization.
- Initial platform scope should be YouTube-only plus one optional umbrella `facebook_page`. TikTok and Instagram stay deferred.
- `ClipBaitersPolitical` should start with U.S. politics and English-language news only. Expand only after the first source, compliance, and clip-review loop is stable.

**Execution status**

- Step 1 completed on 2026-04-07.
- Outcome: `clipbaiters-viral-moments` is now a seeded managed business with a compliance approval posture, a venture blueprint, a canonical lane doc, and autonomy-context-hub entries.
- Validation passed: `npm test`, `npm run build`, `npm run dev -- engine-sync`, `npm run dev -- venture-studio`, and `npm run dev -- org-report --business clipbaiters-viral-moments`.
- Step 2 completed on 2026-04-07.
- Outcome: the social registry now supports `youtube_channel` records and ClipBaiters seeds one shared alias, one optional umbrella `facebook_page`, and five planned niche YouTube channels without creating Instagram or off-platform niche alias obligations.
- Validation passed: `npm test`, `npm run build`, `npm run dev -- social-profiles --business clipbaiters-viral-moments`, and `npm run dev -- venture-studio --business clipbaiters-viral-moments`.
- Step 3 completed on 2026-04-07.
- Outcome: ClipBaiters now has a file-backed lane registry, source registry, event radar, story-candidate state, planning dossier, source-feed drop directory, and a review-gated daily brief for the political lane.
- Validation passed: `npm test`, `npm run build`, `npm run dev -- clipbaiters-plan --business clipbaiters-viral-moments`, and `npm run dev -- clipbaiters-radar --business clipbaiters-viral-moments --lane clipbaiters-political`.
- Step 4 completed on 2026-04-07.
- Outcome: ClipBaiters now has a dry-run autonomy path that reads approved source manifests or fallback story briefs, writes clip candidate and clip job state, produces draft clip packages with caption and edit metadata, and records host tooling plus manual gates in an autonomy summary.
- Validation passed: `npm test`, `npm run build`, `scripts/business-worker-start.sh clipbaiters-viral-moments "ClipBaiters - Viral Moments"`, `scripts/business-worker-status.sh clipbaiters-viral-moments`, `npm run dev -- clipbaiters-autonomy-run --business clipbaiters-viral-moments --lane clipbaiters-political --dry-run`, and `scripts/business-worker-stop.sh clipbaiters-viral-moments`.
- Step 5 completed on 2026-04-07.
- Outcome: ClipBaiters now has a dry-run publishing layer that converts draft clip jobs into a blocked publish queue, writes upload batches plus review markdown, opens manual approval gates for sensitive clips, and captures per-channel queue metrics without pretending the YouTube lanes are already live.
- Validation passed: `npm test`, `npm run build`, `npm run dev -- clipbaiters-publish --business clipbaiters-viral-moments --lane clipbaiters-political --dry-run`, `npm run dev -- org-report --business clipbaiters-viral-moments`, and `npm run dev -- office-views`.
- Step 6 completed on 2026-04-07.
- Outcome: ClipBaiters now writes a creator-offer catalog, syncs manual creator-order manifests into durable state, records revenue snapshots, opens payment-link and delivery-review approvals, and writes a monetization report for the `ClipBaitersStreaming` direct-revenue lane.
- Validation passed: `npm test`, `npm run build`, `npm run dev -- clipbaiters-monetization-report --business clipbaiters-viral-moments`, and `npm run dev -- approvals`.
- Step 7 completed on 2026-04-07.
- Outcome: ClipBaiters now has business-specific workflow ownership in the org control plane, runtime-aware office execution lanes, a generated `runtime/ops/clipbaiters/clipbaiters-viral-moments/launch-checklist.md`, and a default VPS cadence that refreshes radar, autonomy dry runs, publish dry runs, and monetization reporting without bypassing review gates.
- Validation passed: `npm test`, `npm run build`, `npm run dev -- engine-sync`, `npm run dev -- org-sync`, `npm run dev -- org-report --business clipbaiters-viral-moments`, `npm run dev -- office-dashboard`, and `scripts/business-worker-status.sh clipbaiters-viral-moments`.

**Handoff instructions for `@imon-engine`**

- Steps 1-7 are complete and validated. Treat new work as follow-on improvement or launch-hardening tasks rather than another unfinished plan step in this document.
- Build the lane in order. Finish steps 1-3 before any live uploads, and finish steps 4-6 before treating the lane as operational.
- Start with `ClipBaitersPolitical` for the editorial-radar proof loop and `ClipBaitersStreaming` for the direct-revenue proof loop.
- Keep `ClipBaitersMedia` and `ClipBaitersAnimated` blocked behind an explicit rights-policy gate until approved.
- Keep documentation aligned in the same change set whenever commands, env vars, runtime artifacts, or worker behavior change.
- Stop after each phase and report three things explicitly: rights/compliance status, monetization readiness, and whether the lane is still review-gated.
- Use the existing worker container path and VPS browser session; do not introduce a hidden hosted queue or database for this lane.
- If the user decides to replace Velora instead of adding a new business, revise step 1 and the doc plan before touching source.

**Optional owner confirmations**

1. Confirm whether you want to keep `Velora Echo Media` as a separate future social-brand lane or merge it into ClipBaiters later.
2. Confirm whether you want the rights-cleared launch posture to remain strict for Media and Animated until licensing or creator authorization is in place.
3. Confirm whether the first paid offer should stay focused on `ClipBaitersStreaming` retainers and event packages.
4. Confirm whether you want TikTok and Instagram to remain fully deferred until the YouTube workflow proves itself.
5. Confirm whether U.S.-only, English-first political coverage is the correct starting scope for the first radar implementation.