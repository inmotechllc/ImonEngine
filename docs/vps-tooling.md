# VPS Tooling

The VPS now has a browser and worker layer so ImonEngine can reuse authenticated sessions, isolate new brands, and run Codex/Playwright directly on the server.

## What Bootstrap Installs

- Docker Engine and the Docker Compose plugin
- Google Chrome
- Xvfb for a persistent virtual display
- ffmpeg
- yt-dlp
- OpenAI Whisper CLI for local transcription checks and live transcript backends
- Playwright CLI plus Chromium dependencies
- Codex CLI
- A reusable Docker worker template for future business containers

Bootstrap entrypoints:

- `scripts/bootstrap-vps.sh`
- `scripts/bootstrap-vps-tools.sh`

## Persistent VPS Browser

Use the VPS browser helpers when a workflow needs a saved Chrome profile or DevTools access on the server:

- Start: `scripts/vps-browser-start.sh`
- Status: `scripts/vps-browser-status.sh`
- Stop: `scripts/vps-browser-stop.sh`
- Full tooling check: `scripts/vps-tooling-status.sh`

`scripts/vps-tooling-status.sh` now reports `ffmpegVersion`, `ytDlpVersion`, and `whisperVersion` alongside the existing browser, Docker, and control-room fields so media and transcription readiness are visible before a ClipBaiters autonomy pass.

## Remote Desktop For The VPS Browser

The browser profile on the VPS now supports a remote desktop layer on top of the same Xvfb display.

- Start: `scripts/vps-remote-desktop-start.sh`
- Status: `scripts/vps-remote-desktop-status.sh`
- Stop: `scripts/vps-remote-desktop-stop.sh`

Default ports:

- VNC backend: `5900` on `127.0.0.1`
- noVNC web UI: `6080`

The noVNC session is wired to the existing Chrome profile, so once you sign into Gumroad, Gmail, or Pinterest there, server-side automation can reuse the same cookies even when your local machine is offline.

For Meta/Facebook, prefer the official Page API path instead of a VPS browser login whenever possible:

- `META_PAGE_ID`
- `META_PAGE_ACCESS_TOKEN`
- optional `META_GRAPH_API_VERSION` override

With those set in `/opt/imon-engine/.env`, `scripts/publish_growth_post.py` can post Facebook Page growth content from the VPS without an authenticated Meta browser session on the server.

Default behavior:

- Xvfb display: `:99`
- Chrome profile dir: `/opt/imon-engine/.chrome-profile`
- Remote DevTools port: `9222`

This lets ImonEngine keep browser cookies and account sessions on the VPS instead of rebuilding them every run.

Because the VPS is now the primary scheduler, Gmail, Gumroad, Pinterest, and any other browser-backed services should stay signed into this server-side Chrome profile instead of depending on a local machine.

Northline outbound and reply automation now reuse that same Chrome profile through `scripts/send_gmail_message.py`, `scripts/sync_northline_inbox.py`, and `scripts/chrome_cdp.py`, so keep the branded Northline inbox signed into Gmail on the VPS whenever Gmail is the primary sender path.

ClipBaiters steps 2-7 use that same persistent Chrome profile for manual YouTube channel creation, channel warming, review-queue triage, roadblock recovery, and future Studio reuse. Keep the ImonEngine Gmail and YouTube session signed into the VPS browser before refreshing `social-profiles --business clipbaiters-viral-moments`, reviewing channel readiness, running `clipbaiters-plan --notify-roadblocks`, invoking the controlled `scripts/youtube_studio_upload.py` helper, or promoting the scheduled publish pass beyond dry-run.

## Scheduled Portfolio Runs

The shared VPS sync wrapper now advances the portfolio layer, the Northline agency lane, and the ClipBaiters review-gated lane.

Use the deployment path that matches the question you are answering:

- Use `/root/ImonEngine` for source edits, tests, and pre-deploy validation in the workspace checkout.
- Use `/opt/imon-engine` for live Northline verification on the VPS. The public Northline site service and nginx-backed domain normally run from that deployed copy, so hosted submission and validation-proof state land there first.
- When a live `/validation.html` run or public intake looks missing from the workspace checkout, inspect `/opt/imon-engine/runtime/state/northlineIntakeSubmissions.json`, `/opt/imon-engine/runtime/state/northlineValidationConfirmations.json`, and `/opt/imon-engine/runtime/ops/northline-growth-system/plan.md` before concluding that the hosted flow failed.
- When you need a live-safe dossier recompute on the VPS after a hosted validation or intake event, prefer `cd /opt/imon-engine && npm run dev -- northline-plan --business auto-funding-agency` before a broader `northline-autonomy-run`.

- `scripts/imon-engine-sync.sh` runs `npm run dev -- engine-sync`, `npm run dev -- northline-autonomy-run --business auto-funding-agency --notify-roadblocks`, `npm run dev -- clipbaiters-plan --business clipbaiters-viral-moments --notify-roadblocks`, `npm run dev -- clipbaiters-collect --business clipbaiters-viral-moments`, `npm run dev -- clipbaiters-skim --business clipbaiters-viral-moments`, a guarded `clipbaiters-autonomy-run --business clipbaiters-viral-moments --all-active-lanes`, a guaranteed dry-run `clipbaiters-publish --business clipbaiters-viral-moments --all-active-lanes --dry-run`, an optional guarded live `clipbaiters-publish --business clipbaiters-viral-moments --all-active-lanes`, `npm run dev -- clipbaiters-source-creators --business clipbaiters-viral-moments`, `npm run dev -- clipbaiters-draft-creator-outreach --business clipbaiters-viral-moments`, `npm run dev -- clipbaiters-deals-report --business clipbaiters-viral-moments`, and `npm run dev -- clipbaiters-monetization-report --business clipbaiters-viral-moments`
- `scripts/install-cron.sh` installs that wrapper on a 30-minute cron cadence
- `scripts/run_vps_autopilot.sh` now runs the same Northline and ClipBaiters cadence after `engine-sync` and before the optional Imonic POD refresh so the portfolio lanes do not stall behind unrelated POD roadblock-email failures
- `northline-autonomy-run` now auto-sends approved Northline outreach drafts from the VPS Gmail session first, falls back to SMTP when it is configured, syncs Gmail replies into `runtime/state/leadReplies.json`, and only leaves an outbound manual gate behind when delivery or inbox access fails
- The ClipBaiters scheduled path now promotes in stages instead of staying permanently dry-run. It always refreshes planning, collection, skimming, a dry-run publish queue, creator-deals artifacts, and monetization artifacts; it only runs non-dry-run autonomy when the business is no longer scaffolded and the plan is unblocked, and it only retries live publish when the queue already contains render-ready approved items and `scripts/vps-browser-status.sh` reports a healthy persistent browser session.
- `runtime/ops/northline-growth-system/plan.{json,md}` and `runtime/ops/northline-growth-system/autonomy-summary.{json,md}` now surface `operatingMode.current`, the five promotion criteria, scheduled automation, and the remaining manual checkpoints for the default Northline lane
- `org-sync` writes `runtime/ops/clipbaiters/clipbaiters-viral-moments/launch-checklist.md` so the ClipBaiters control-plane posture and default scheduled commands stay visible after each portfolio refresh
- Even after promotion to `autonomous`, live payment authorization, disputed or ambiguous replies, public proof publication review, and exception deploy rollback stay manual

When a ClipBaiters lane is explicitly cleared for live upload, the controlled path still uses `scripts/youtube_studio_upload.py` against the persistent VPS Chrome profile instead of a YouTube API integration. Only the currently active YouTube lanes are eligible for that controlled path, and rights-sensitive queues still stay review-gated until they are explicitly approved. The scheduled wrapper uses the dry-run publish pass as the gating snapshot, then only retries live publish for already approved render-ready items.

This keeps hosted intake promotion, build and QA progression, retention refreshes, and Northline roadblock notifications moving even when the owner is not watching the repo directly, while still making it obvious whether the lane is running in `controlled_launch` or `autonomous` mode.

## Codex CLI On VPS

Use `scripts/vps-codex-login.sh` after the VPS browser is running. It starts the browser if needed, then opens the Codex authentication flow against the saved Chrome profile so the CLI can be used directly from the server.

## Private Control Room Service

The organization control room can now run as a persistent private VPS service.

Helper scripts:

- Install: `scripts/install-control-room-service.sh`
- Run wrapper: `scripts/run-control-room.sh`

Default behavior:

- bind host: `127.0.0.1`
- default port: `4177`
- auth: owner-only password gate with signed httpOnly cookies

The service is intended for:

- the VPS Chrome profile through noVNC
- SSH tunnel access later if needed

`scripts/vps-tooling-status.sh` now reports whether the control-room service is up in addition to the browser stack.

## Containerized Business Workers

Each new brand can run inside its own Docker container instead of sharing the root host environment.

Worker template:

- `docker/business-worker/Dockerfile`
- `docker/business-worker/compose.yml`

The shared worker image now includes `ffmpeg`, `yt-dlp`, and the OpenAI Whisper CLI so ClipBaiters ingest, render execution, and host-level transcription checks can use the same standard toolchain inside the containerized workspace. Non-dry-run autonomy can now download approved media, refresh transcripts, and render final MP4s into the file-backed repo artifacts, while controlled live uploads still keep running against the persistent host Chrome session rather than from inside the worker.

Helper scripts:

- Start: `scripts/business-worker-start.sh <business-id> "<business-name>"`
- Status: `scripts/business-worker-status.sh <business-id>`
- Stop: `scripts/business-worker-stop.sh <business-id>`

Each worker mounts:

- a writable per-brand workspace under `/opt/imon-engine/workspaces/<business-id>`
- a writable per-brand state directory under `runtime/ops/business-workers/<business-id>`
- the repo itself as read-only under `/repo`

## Operating Rule

- Use the VPS browser when the account session should persist on the server.
- Use the VPS remote desktop when you need to log into the server-side Chrome profile yourself.
- Use the private hosted control room for read-only executive/business/department operations instead of relying only on generated HTML artifacts.
- Use a business worker container when a new brand needs isolated dependencies, code, or experimental tooling.
- Use the shared VPS Chrome profile for ClipBaiters channel setup instead of creating separate browser identities per niche.
- Treat `clipbaiters-publish --dry-run` as the first readiness pass for every scheduled cycle, even after the lane is partly live.
- Treat the scheduled ClipBaiters publish pass as guarded, not blind: it can retry live upload only when the queue is render-ready, approved, and backed by a healthy VPS browser session, and it must still skip review-gated uploads instead of bypassing them.
- Use the controlled `scripts/youtube_studio_upload.py` path only for lanes that are explicitly marked upload-eligible; `clipbaiters-streaming` is the first intended lane and political material remains review-gated.
- Keep the local Windows scheduler disabled unless the VPS runner is unavailable.
