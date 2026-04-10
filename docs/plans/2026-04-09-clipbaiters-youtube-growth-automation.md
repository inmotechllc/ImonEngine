# ClipBaiters YouTube Growth Automation Plan

## Goal

Move ClipBaiters from a review-only YouTube draft loop to a controlled automation loop for the two live channels, `clipbaiters-media` and `clipbaiters-political`, that can:

- discover approved source media
- generate materially transformed Shorts under 60 seconds
- split longer source windows into ordered multi-part clips when needed
- schedule 1-3 total uploads per day across the two live channels inside randomized peak windows
- notify the owner when roadblocks change
- update ImonEngine business and control-plane status once live posting is genuinely operating

This plan is audience-growth-first. Stripe creator-service checkout work stays out of scope for this phase.

## Subsystems Touched

- Planning and business state
  - `src/services/clipbaiters-studio.ts`
  - `src/index.ts`
  - `runtime/state/businesses.json`
- Clip discovery, ingest, and draft generation
  - `src/services/clipbaiters-collector.ts`
  - `src/services/clipbaiters-skimmer.ts`
  - `src/services/clipbaiters-radar.ts`
  - `src/services/clipbaiters-ingest.ts`
  - `src/services/clipbaiters-editor.ts`
  - `src/services/clipbaiters-autonomy.ts`
  - `src/domain/clipbaiters.ts`
- Live publish and schedule allocation
  - `src/services/clipbaiters-publisher.ts`
  - `src/services/clipbaiters-analytics.ts`
  - `runtime/state/clipbaiters/clipbaiters-viral-moments/publishing-queue.json`
  - `runtime/state/clipbaiters/clipbaiters-viral-moments/publish-history.json`
  - `runtime/state/clipbaiters/clipbaiters-viral-moments/posting-schedule.json`
- VPS and worker execution
  - `scripts/imon-engine-sync.sh`
  - `scripts/business-worker-start.sh`
  - `scripts/youtube_studio_upload.py`
- ImonEngine status and control plane
  - `src/services/organization-control-plane.ts`
  - `src/services/control-room-renderer.ts`
  - `runtime/ops/org-control-plane.json`
  - `runtime/ops/org-control-plane.md`
  - `runtime/ops/control-room/data.json`
- Canonical docs that must be updated in the same change set if behavior changes
  - `docs/clipbaiters-viral-moments.md`
  - `docs/setup.md`
  - `docs/vps-tooling.md`
  - `docs/org-control-plane.md`

## Prerequisites

- Keep the rollout limited to `clipbaiters-media` and `clipbaiters-political`. Do not widen scope to `clipbaiters-streaming`, `clipbaiters-celebs`, or `clipbaiters-animated` during this phase.
- Keep the VPS Chrome profile signed into the two live YouTube channels and keep `scripts/youtube_studio_upload.py` usable on the host.
- Keep the worker toolchain healthy on the host or business worker: `ffmpeg`, `yt-dlp`, and Whisper.
- Finalize the owner-approved source policy for what is allowed to move beyond discovery. The current repo still treats rights and fair-use review as a blocking requirement before unattended publishing.
- Accept a stricter operating mode for politics than for general media. If the political lane cannot be made safe under explicit policy thresholds, it should remain hybrid or review-gated instead of being silently pushed to unattended upload.

## Ordered Steps

### 1. Encode the fair-use policy and live-readiness thresholds in the ClipBaiters model

Update the planning and state surfaces so the system can distinguish draft-only work from live-ready work instead of inferring readiness from loose notes.

Files and docs:

- `src/domain/clipbaiters.ts`
- `src/services/clipbaiters-studio.ts`
- `src/index.ts`
- `docs/clipbaiters-viral-moments.md`
- `docs/setup.md`

Implementation details:

- Extend the ClipBaiters domain types to store transformation evidence, part sequencing, schedule-allocation state, and live-post eligibility instead of only `pipelinePreview` and generic review notes.
- Add a new persisted schedule artifact at `runtime/state/clipbaiters/clipbaiters-viral-moments/posting-schedule.json` so randomized peak windows are durable across runs.
- Extend `clipbaiters-plan` in `src/index.ts` to accept `--notify-roadblocks` and wire that flag into `src/services/clipbaiters-studio.ts`.
- In `src/services/clipbaiters-studio.ts`, add the same throttled roadblock-email pattern already used by `micro-saas-studio.ts` and `pod-studio.ts`, writing:
  - `runtime/ops/clipbaiters/clipbaiters-viral-moments/roadblock-email.md`
  - `runtime/ops/clipbaiters/clipbaiters-viral-moments/roadblock-notification.json`
- Update `src/services/clipbaiters-studio.ts` business-state rules so ClipBaiters can move from `scaffolded` to `ready` when launch blockers are actually cleared, and from `ready` to `active` once successful live publish proof exists for the current rollout.

### 2. Turn the draft-only autonomy loop into a real acquisition-and-render pipeline

The current autonomy path produces draft packages and command previews only. It does not yet download approved source media, render final MP4s, or leave upload-ready assets behind.

Files and docs:

- `src/services/clipbaiters-ingest.ts`
- `src/services/clipbaiters-editor.ts`
- `src/services/clipbaiters-autonomy.ts`
- `src/domain/clipbaiters.ts`
- `src/services/clipbaiters-renderer.ts`
- `docs/clipbaiters-viral-moments.md`
- `docs/vps-tooling.md`

Implementation details:

- Create `src/services/clipbaiters-renderer.ts` to execute approved `yt-dlp`, Whisper, and `ffmpeg` steps instead of leaving them as preview-only commands.
- Keep `src/services/clipbaiters-ingest.ts` responsible for approved-source selection, transcript inputs, first-moment targeting, and provenance metadata.
- Extend `src/services/clipbaiters-editor.ts` so each job includes explicit transformation tactics, for example:
  - commentary or voiceover requirement
  - caption/overlay template choice
  - crop and speed-change instructions
  - attribution block
  - part-series metadata for long segments broken into `Part 1`, `Part 2`, and so on
- Update `src/services/clipbaiters-autonomy.ts` so non-dry-run execution downloads approved source media, renders final MP4s into `runtime/ops/clipbaiters/clipbaiters-viral-moments/draft-clips/<job-id>/`, and records execution results alongside the existing draft artifacts.
- Enforce a hard output limit below 60 seconds. If a usable source sequence exceeds that bound, generate ordered multi-part jobs instead of a single oversized clip.

### 3. Replace vague “materially transformed” notes with explicit fair-use gates

Right now the repo says clips should remain transformed, but it does not store enough structured evidence to automate that decision safely.

Files and docs:

- `src/services/clipbaiters-skimmer.ts`
- `src/services/clipbaiters-radar.ts`
- `src/services/clipbaiters-ingest.ts`
- `src/services/clipbaiters-editor.ts`
- `src/services/clipbaiters-publisher.ts`
- `src/domain/clipbaiters.ts`
- `docs/clipbaiters-viral-moments.md`

Implementation details:

- Add structured review fields for:
  - approved source class
  - rights basis
  - transformation tactic used
  - attribution present or missing
  - part-series membership
  - policy-risk score
- Keep `clipbaiters-media` eligible for progressively more automation once the source class, attribution, and transformation rubric all pass.
- Keep `clipbaiters-political` on a stricter path. The existing `requiresManualReview` logic in `src/services/clipbaiters-publisher.ts` intentionally forces political uploads through a manual gate, so any reduction there must be explicit, narrow, and backed by a concrete approved-source rule set.
- Require the publish queue to reject items that lack transformation metadata, exceed the duration limit, or point to a source still marked `review_required` or `manual_review_required`.

### 4. Replace the fixed 30-minute queue spacing with a real randomized peak-window allocator

The current publisher sets `scheduledFor` to `Date.now() + index * 30 minutes`, which does not meet the requested posting behavior.

Files and docs:

- `src/services/clipbaiters-publisher.ts`
- `src/services/clipbaiters-analytics.ts`
- `src/domain/clipbaiters.ts`
- `runtime/state/businesses.json`
- `docs/clipbaiters-viral-moments.md`
- `docs/setup.md`

Implementation details:

- Reuse the existing ClipBaiters business schedule already stored in `runtime/state/businesses.json`:
  - timezone: `America/New_York`
  - `maxRunsPerDay: 3`
  - preferred windows: `08:00-10:00`, `13:00-15:00`, `19:00-21:00`
- In `src/services/clipbaiters-publisher.ts`, allocate 1-3 total daily posts across the two live channels, not 1-3 per channel, to stay conservative while the channels are still proving out.
- Randomize posting times inside those windows, but persist the chosen slots in `runtime/state/clipbaiters/clipbaiters-viral-moments/posting-schedule.json` so the schedule does not reshuffle on every run.
- Add cooldown logic so the same lane does not dominate the same day unless there is no safe alternative inventory.
- Add ordered-series handling so multipart clips cannot publish out of order.
- Record the chosen slot, actual publish timestamp, and lane assignment in channel metrics so later scheduling decisions can avoid clustering and spammy repeats.

### 5. Promote the VPS cadence from reporting-only to controlled live operation

The current VPS wrapper keeps ClipBaiters publishing in `--dry-run`, which is correct today but cannot satisfy autonomous posting once render and gate logic are in place.

Files and docs:

- `scripts/imon-engine-sync.sh`
- `src/services/clipbaiters-studio.ts`
- `src/services/clipbaiters-autonomy.ts`
- `src/services/clipbaiters-publisher.ts`
- `docs/vps-tooling.md`
- `docs/setup.md`

Implementation details:

- Insert `npm run dev -- clipbaiters-plan --business clipbaiters-viral-moments --notify-roadblocks` near the front of `scripts/imon-engine-sync.sh` so changed blockers are surfaced on the scheduled path.
- Keep the scheduled path dry-run while any of these remain true:
  - no rendered MP4 exists
  - open manual gates remain for the candidate
  - source policy is still unresolved
  - the host YouTube session is missing or stale
  - the business is still `scaffolded`
- Once those conditions clear, let `scripts/imon-engine-sync.sh` promote ClipBaiters into a live-ready path that runs `clipbaiters-autonomy-run` and `clipbaiters-publish` without `--dry-run` for the active lanes only.
- Keep browser-backed upload on the host through `scripts/youtube_studio_upload.py`. Worker containers should handle download and render, but YouTube Studio automation should remain tied to the persistent host Chrome profile documented in `docs/vps-tooling.md`.
- Do not allow the scheduler to bypass the political review gate. If a queue item is still awaiting review, the scheduled pass should skip it, record the block, and notify rather than forcing it live.

### 6. Surface roadblocks, scheduling, and live-post proof in the ImonEngine control plane

If the lane becomes capable of sourcing, rendering, and posting safely, the business status needs to change inside ImonEngine instead of leaving ClipBaiters permanently marked as scaffolded.

Files and docs:

- `src/services/clipbaiters-studio.ts`
- `src/services/organization-control-plane.ts`
- `src/services/control-room-renderer.ts`
- `docs/org-control-plane.md`
- `docs/clipbaiters-viral-moments.md`

Implementation details:

- Extend the ClipBaiters execution context in `src/services/organization-control-plane.ts` to include:
  - next randomized posting windows
  - per-lane queue counts
  - render backlog and render success state
  - roadblock notification state
  - open manual gate counts
  - last live upload per lane
- Refresh the business office and control-room renderer so those signals appear in:
  - `runtime/ops/org-control-plane.json`
  - `runtime/ops/org-control-plane.md`
  - `runtime/ops/control-room/data.json`
- Make `src/services/clipbaiters-studio.ts` treat successful live publishing as proof that can promote the business beyond `scaffolded`.
- When the rollout is truly live, refresh the generated artifacts that operators will actually inspect:
  - `runtime/ops/clipbaiters/clipbaiters-viral-moments/launch-checklist.md`
  - `runtime/ops/org-control-plane.json`
  - `runtime/ops/org-control-plane.md`
  - `runtime/ops/control-room/data.json`

## Validation

Build and tests:

- `npm run build`
- `npm test`
- `npm run test:control-room-ui` if `src/services/control-room-renderer.ts` or the control-room data contract changes

ClipBaiters planning and dry-run validation:

- `npm run dev -- clipbaiters-plan --business clipbaiters-viral-moments --notify-roadblocks`
- `npm run dev -- clipbaiters-collect --business clipbaiters-viral-moments`
- `npm run dev -- clipbaiters-skim --business clipbaiters-viral-moments`
- `npm run dev -- clipbaiters-autonomy-run --business clipbaiters-viral-moments --all-active-lanes --dry-run`
- `npm run dev -- clipbaiters-publish --business clipbaiters-viral-moments --all-active-lanes --dry-run`

Worker and VPS readiness:

- `scripts/vps-tooling-status.sh`
- `scripts/business-worker-status.sh clipbaiters-viral-moments`
- `python3 scripts/youtube_studio_upload.py --help`

Live-path validation after the dry-run gates are cleared:

- `npm run dev -- clipbaiters-autonomy-run --business clipbaiters-viral-moments --all-active-lanes`
- `npm run dev -- clipbaiters-publish --business clipbaiters-viral-moments --all-active-lanes`
- `npm run dev -- org-sync`
- `npm run dev -- org-report --business clipbaiters-viral-moments`
- `npm run dev -- control-room-build`

Artifact checks after live promotion:

- Verify `runtime/state/businesses.json` shows ClipBaiters no longer stuck in `scaffolded` once launch blockers are truly cleared.
- Verify `runtime/ops/clipbaiters/clipbaiters-viral-moments/launch-checklist.md` reflects the new live/dry-run posture accurately.
- Verify `runtime/state/clipbaiters/clipbaiters-viral-moments/posting-schedule.json` shows stable randomized windows and total daily quota of 1-3 posts across the live channels.
- Verify `runtime/state/clipbaiters/clipbaiters-viral-moments/publish-history.json` records actual uploads and skipped review-gated items distinctly.

## Risks And Notes

- The current repo still treats rights and fair-use signoff as a launch blocker. Until that policy is encoded clearly, “fully automatic” publishing is not a defensible operating mode.
- `clipbaiters-political` is explicitly hardwired into manual review in `src/services/clipbaiters-publisher.ts` today. That is not an accident, and it should only be relaxed with a much narrower rule set than the media lane.
- The present autonomy loop drafts packages only. The lack of real source download and final render execution is a real blocker, not a minor gap.
- Fair use is not something the code can guarantee on its own. The automation should store transformation evidence and source provenance, but initial spot checks should remain part of the rollout.
- Source coverage may be uneven. Some days the system may not find enough approved material to safely fill all three posting slots, and it should under-post rather than pad the schedule with weak or risky clips.
- The VPS YouTube session remains an operational dependency. If the shared Chrome profile logs out, live upload should fail closed and notify.
- Stripe creator-service checkout links can remain blocked without preventing this audience-growth plan from being executed.

## Handoff Instructions For @imon-engine

- Implement these steps in order. Do not remove the scheduled dry-run guard before the render pipeline and the structured fair-use gates both exist.
- Reuse the existing ClipBaiters business schedule in `runtime/state/businesses.json` before introducing any new env-based scheduling knobs. The existing `preferredWindows` and `maxRunsPerDay` are already aligned with the requested cadence.
- Reuse the throttled roadblock-email pattern from `src/services/micro-saas-studio.ts` or `src/services/pod-studio.ts` instead of inventing a new notification transport.
- Keep `clipbaiters-media` and `clipbaiters-political` as the only rollout lanes for this phase.
- If fully unattended political uploads still are not safe after the policy work lands, keep that lane review-gated and ship a mixed mode where media can auto-post first. Record that as the remaining roadblock instead of bypassing the guardrail.
- Update `docs/clipbaiters-viral-moments.md`, `docs/setup.md`, `docs/vps-tooling.md`, and `docs/org-control-plane.md` in the same change set as any durable CLI, scheduler, env, or control-plane behavior change.
- When live posting proof exists, rerun `clipbaiters-plan`, `org-sync`, `org-report --business clipbaiters-viral-moments`, and `control-room-build` so ImonEngine status reflects the cleared roadblocks and new operating state.