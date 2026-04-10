# NVIDIA AI Catalog Switch Plan

## Goal

Replace the current OpenAI-backed ImonEngine routes with NVIDIA API Catalog-hosted alternatives wherever the swap is low-risk, while preserving the centralized route-map architecture in `src/ai/api-map.ts` and staging the harder `research` migration separately from the `fast` and `deep` cutover.

## Execution Status

- Completed on `2026-04-09`: step 1 added the NVIDIA provider contract, env scaffolding, and default NVIDIA Catalog base URL handling.
- Completed on `2026-04-09`: step 2 switched the shared `fast` route to the validated runtime id `microsoft/phi-3.5-mini-instruct` and the shared `deep` route to `deepseek-ai/deepseek-v3.1`, while keeping `research` on OpenAI.
- Validated on `2026-04-09` with `npm test`, `npm run build`, `npm run dev -- engine-report`, `npm run dev -- northline-plan --business auto-funding-agency`, and a live `AIClient` smoke test against the NVIDIA Catalog endpoint.
- Intentionally deferred in this first execution pass: step 3 business-specific quality overrides, step 4 `research` re-architecture, and step 5 Whisper changes.

## Current Runtime Model Inventory

| Current surface | Current model or tool | Active repo paths | Current live usages |
| --- | --- | --- | --- |
| Shared `fast` route | `gpt-4.1-mini` | `src/ai/api-map.ts` | `imon-engine.office-chat`, `auto-funding-agency.qualify-lead`, `auto-funding-agency.outreach-draft`, `auto-funding-agency.reply-classification` |
| Shared `deep` route | `gpt-5` | `src/ai/api-map.ts` | `imon-digital-asset-store.asset-blueprint`, `auto-funding-agency.site-copy`, `auto-funding-agency.retention-report` |
| Shared `research` route | `gpt-5` plus `web_search_preview` | `src/ai/api-map.ts` | `imon-engine.market-research`, `auto-funding-agency.prospect-research` |
| ClipBaiters transcription | local `python3 -m whisper` CLI | `src/services/clipbaiters-ingest.ts`, `src/services/clipbaiters-editor.ts`, `src/services/clipbaiters-renderer.ts`, `scripts/bootstrap-vps-tools.sh`, `scripts/vps-tooling-status.sh` | ClipBaiters transcript and caption generation |
| Legacy compatibility overrides | `OPENAI_MODEL_FAST`, `OPENAI_MODEL_DEEP` | `src/config.ts`, `.env.example`, `src/agents/store-autopilot.ts` | Migration-only fallback surface |

## Verified Free-Endpoint Alternatives

This section is now restricted to the models from the attached free-endpoint inventory the user supplied on `2026-04-09`. Anything not present in that attachment is out of scope for the first NVIDIA migration pass, even if it appeared in earlier catalog research.

### Shared `fast` route alternatives for `gpt-4.1-mini`

Recommended first-choice models:

- `phi-3.5-mini-instruct`
- `granite-3.3-8b-instruct`
- `nemotron-mini-4b-instruct`
- `jamba-1.5-mini-instruct`
- `mistral-small-3.1-24b-instruct-2503`

Additional verified free-endpoint candidates from the attachment:

- `phi-3-small-8k-instruct`
- `phi-3-small-128k-instruct`
- `phi-3-mini-128k-instruct`
- `gemma-3n-e4b-it`
- `gemma-3n-e2b-it`
- `gemma-2-2b-it`
- `gemma-7b`
- `marin-8b-instruct`
- `rakutenai-7b-instruct`
- `rakutenai-7b-chat`
- `falcon3-7b-instruct`
- `chatglm3-6b`
- `qwen2-7b-instruct`
- `baichuan2-13b-chat`
- `sea-lion-7b-instruct`
- `breeze-7b-instruct`
- `mistral-7b-instruct-v0.2`

Recommended stage-1 assignment:

- Switch shared `fast` in `src/ai/api-map.ts` to `phi-3.5-mini-instruct` first.
- Keep `granite-3.3-8b-instruct` as the immediate fallback if the lightweight route needs stronger instruction following without jumping to a much larger model.
- If office-chat or outreach quality still drops, use a business-specific override to `mistral-small-3.1-24b-instruct-2503` instead of replacing the whole shared `fast` route.

### Shared `deep` route alternatives for `gpt-5`

Recommended first-choice models:

- `deepseek-v3.1`
- `deepseek-v3.1-terminus`
- `deepseek-v3.2`
- `mistral-large-3-675b-instruct-2512`
- `mistral-medium-3-instruct`
- `kimi-k2-thinking`
- `kimi-k2-instruct`
- `glm-4.7`
- `step-3.5-flash`
- `seed-oss-36b-instruct`

Additional verified free-endpoint candidates from the attachment that may work for select business overrides:

- `kimi-k2-instruct-0905`
- `mistral-nemotron`
- `devstral-2-123b-instruct-2512`
- `qwen3-coder-480b-a35b-instruct`
- `gemma-3-27b-it`
- `gemma-2-27b-it`
- `colosseum_355b_instruct_16k`
- `dracarys-llama-3.1-70b-instruct`
- `llama-4-maverick-17b-128e-instruct`
- `llama-4-scout-17b-16e-instruct`
- `magistral-small-2506`
- `phi-3-medium-128k-instruct`

Recommended stage-1 assignment:

- Switch shared `deep` in `src/ai/api-map.ts` to `deepseek-v3.1` first.
- Keep `mistral-large-3-675b-instruct-2512` as the immediate fallback if structured long-form output quality regresses.

### Shared `research` route alternatives for `gpt-5` plus `web_search_preview`

There is no verified one-call NVIDIA API Catalog replacement for OpenAI `web_search_preview`.

Verified free-endpoint retrieval components from the attachment that can support a staged replacement:

- Embeddings:
  - `llama-3_2-nemoretriever-300m-embed-v1`
  - `nv-embedcode-7b-v1` only for code-heavy retrieval, not general market or prospect research
- Reranking:
  - `rerank-qa-mistral-4b`
- Research-oriented synthesis:
  - `llama3-chatqa-1.5-8b`
  - reuse the selected `deep` route model from the previous section

Recommended stage-1 assignment:

- Keep `research` on OpenAI in `src/ai/api-map.ts` during the first switch.
- Treat the NVIDIA migration of `research` as a stage-2 architecture change: `search acquisition -> embed -> rerank -> synthesize`.

### ClipBaiters transcription alternatives for local Whisper

Current cost note:

- The current Whisper path is already local and is not consuming paid API calls.

The attached free-endpoint inventory does not include a clean speech-to-text replacement for Whisper.

Nearest attached models:

- `nemotron-voicechat`
- `phi-4-multimodal-instruct`

Neither is a clear transcript-only drop-in for the current `python3 -m whisper` workflow.

Recommended assignment:

- Do not prioritize a Whisper replacement for API-cost reduction.
- Revisit this only if there is a quality, maintenance, or deployment reason to unify on NVIDIA-hosted ASR.

### Candidate-Pool Rules

- Do not pull primary defaults from outside the attached free-endpoint inventory.
- Do not use multimodal, voice, OCR, safety, digital-twin, or synthetic-data models as shared text defaults unless a specific workflow requires them.
- Keep `nv-embedcode-7b-v1` limited to code retrieval rather than general research.
- Keep `nemotron-voicechat` and `phi-4-multimodal-instruct` out of the first ClipBaiters migration pass unless execution proves a stable transcript-only interface.

## Subsystems Touched

- AI routing and provider config
  - `src/ai/api-map.ts`
  - `src/ai/client.ts`
  - `src/config.ts`
  - `.env.example`
  - `src/agents/store-autopilot.ts`
- Active AI consumers that should not need direct provider edits after the route swap
  - `src/services/office-chat.ts`
  - `src/services/northline-prospect-collector.ts`
  - `src/agents/qualifier.ts`
  - `src/agents/outreach-writer.ts`
  - `src/agents/site-builder.ts`
  - `src/agents/reply-handler.ts`
  - `src/agents/digital-asset-factory.ts`
  - `src/services/reports.ts`
- Optional stage-2 research migration surfaces
  - `src/services/office-chat.ts`
  - `src/services/northline-prospect-collector.ts`
  - `src/ai/client.ts`
  - either `src/ai/api-map.ts` or a new retrieval helper under `src/ai/`
- Optional stage-3 transcription migration surfaces
  - `src/services/clipbaiters-ingest.ts`
  - `src/services/clipbaiters-editor.ts`
  - `src/services/clipbaiters-renderer.ts`
  - `src/services/clipbaiters-autonomy.ts`
  - `scripts/bootstrap-vps-tools.sh`
  - `scripts/vps-tooling-status.sh`
- Canonical docs that should be updated during implementation
  - `README.md`
  - `docs/setup.md`
  - `docs/imon-engine.md`
  - `docs/clipbaiters-viral-moments.md` only if the transcription stack changes
  - `docs/vps-tooling.md` only if the transcription stack changes

## Prerequisites

- Verify the signed-in NVIDIA account's actual API base URL, auth flow, rate limits, logging terms, and whether the catalog remains OpenAI-compatible for the targeted models.
- The local `.env` already contains `AI_PROVIDER_NVIDIA_API_KEY`; execution still needs the resolved NVIDIA base URL and live request-format validation.
- Decide whether the first implementation should use a single provider id such as `nvidia` in `src/ai/api-map.ts`, or whether multiple provider ids are needed because the selected models resolve through different endpoint contracts.
- Accept that the `research` route should stay on OpenAI for the first cut unless the implementation also lands an external search source and retrieval pipeline.
- Accept that Whisper is already local and should not be treated as an API-spend problem.
- Treat the attached free-endpoint inventory as the default benchmarking pool; if a chosen model later appears deprecated in the signed-in catalog, replace it with another model from the same attachment-backed pool instead of widening back out to download-only models.

## Ordered Steps

### 1. Add the NVIDIA provider contract without changing behavior yet

Files and docs:

- `src/ai/api-map.ts`
- `src/config.ts`
- `.env.example`
- `src/agents/store-autopilot.ts`
- `docs/setup.md`

Implementation details:

- Add a provider entry for the NVIDIA API Catalog in `src/ai/api-map.ts`.
- Add `AI_PROVIDER_NVIDIA_API_KEY` and `AI_PROVIDER_NVIDIA_BASE_URL` to `.env.example` and `src/agents/store-autopilot.ts`.
- The local secret-entry step is already satisfied for the current machine because `.env` now contains the NVIDIA API key.
- Keep the existing OpenAI provider intact because `research` stays on OpenAI for stage 1.
- Preserve the legacy `OPENAI_API_KEY`, `OPENAI_MODEL_FAST`, and `OPENAI_MODEL_DEEP` fallbacks in `src/config.ts`.
- Update `docs/setup.md` so operators know where the new NVIDIA credentials belong and that route assignments still live in `src/ai/api-map.ts`.

### 2. Switch the shared `fast` and `deep` routes first

Files and docs:

- `src/ai/api-map.ts`
- `src/ai/client.ts`
- `src/workflows.test.ts`
- `src/pod-autonomy.test.ts`
- `docs/imon-engine.md`
- `README.md`

Implementation details:

- Point `fast` at `phi-3.5-mini-instruct` in `src/ai/api-map.ts`.
- Point `deep` at `deepseek-v3.1` in `src/ai/api-map.ts`.
- Keep `research` on OpenAI and leave its `web_search_preview` tool untouched.
- Update any tests that assert provider labels or model names so they reflect the new shared-route defaults.
- Update `docs/imon-engine.md` and `README.md` so the route map examples no longer imply that OpenAI is the only default provider.

### 3. Add business-specific overrides only if the shared swap regresses quality

Files and docs:

- `src/ai/api-map.ts`
- `docs/imon-engine.md`

Implementation details:

- If `phi-3.5-mini-instruct` is strong for lead qualification and reply classification but weak for office chat or outreach drafting, override only those specific capabilities in `src/ai/api-map.ts`.
- First override candidates:
  - `imon-engine.office-chat -> granite-3.3-8b-instruct`
  - `auto-funding-agency.outreach-draft -> mistral-small-3.1-24b-instruct-2503`
  - keep `auto-funding-agency.qualify-lead` and `auto-funding-agency.reply-classification` on `phi-3.5-mini-instruct`
- If `deepseek-v3.1` is weak for asset blueprints or long-form copy, override those deep tasks to `mistral-large-3-675b-instruct-2512` or `kimi-k2-thinking` before changing the shared `deep` route again.

### 4. Plan the `research` replacement as a separate architecture change

Files and docs:

- `src/ai/api-map.ts`
- `src/ai/client.ts`
- optionally a new helper under `src/ai/`, for example `src/ai/retrieval.ts`
- `src/services/northline-prospect-collector.ts`
- `src/services/office-chat.ts`
- `docs/setup.md`
- `docs/imon-engine.md`
- `README.md`

Implementation details:

- Do not try to fake a one-call model replacement for `web_search_preview`.
- Add explicit retrieval support using a dedicated embedding route and rerank route if the repo wants research off OpenAI.
- Use an external search source for document acquisition, then feed results into:
  - `llama-3_2-nemoretriever-300m-embed-v1`
  - `rerank-qa-mistral-4b`
  - `llama3-chatqa-1.5-8b` or the selected `deep` synthesis model
- Keep `nv-embedcode-7b-v1` optional and code-only rather than using it as the general research embedder.
- Update docs only when the actual search and retrieval behavior changes.

### 5. Leave Whisper alone unless there is a non-cost reason to replace it

Files and docs:

- `src/services/clipbaiters-ingest.ts`
- `src/services/clipbaiters-editor.ts`
- `src/services/clipbaiters-renderer.ts`
- `src/services/clipbaiters-autonomy.ts`
- `scripts/bootstrap-vps-tools.sh`
- `scripts/vps-tooling-status.sh`
- `docs/clipbaiters-viral-moments.md`
- `docs/vps-tooling.md`

Implementation details:

- Keep the current local Whisper CLI path in the first NVIDIA migration pass.
- Do not schedule a ClipBaiters ASR swap from the attached free-endpoint list because there is no clean transcript-only replacement in that inventory.
- Revisit hosted audio only if the team later confirms that `nemotron-voicechat` or `phi-4-multimodal-instruct` can be used as a stable speech-to-text backend.

## Current Repo-Owned Stage-1 File Set

This section isolates the current repo worktree files that belong to the AI route-map plus NVIDIA stage-1 switch from the much larger unrelated dirty tree.

Core route-map and provider-switch files that are currently new in the repo worktree:

- `src/ai/api-map.ts`
- `src/ai/client.ts`
- `src/ai/prompts.ts`
- `docs/plans/2026-04-09-ai-api-routing-map.md`
- `docs/plans/2026-04-09-nvidia-ai-catalog-switch-plan.md`

Supporting compatibility, config, docs, and validation files in the current repo worktree that still belong to the same switch:

- `src/openai/client.ts`
- `src/openai/prompts.ts`
- `src/config.ts`
- `src/agents/store-autopilot.ts`
- `src/pod-autonomy.test.ts`
- `src/workflows.test.ts`
- `README.md`
- `docs/setup.md`
- `docs/imon-engine.md`

Related but not part of the NVIDIA switch itself:

- `docs/control-room-hosting.md` belongs to the later control-room auth-bootstrap fix, not the route-provider migration.

Historical note:

- `.env.example` was part of the stage-1 switch implementation, but it is not currently dirty in this local repo state.

## Live Deployment Finalization Blockers

The repo worktree and the live deployed tree are not currently aligned. Finalizing the switch for the live hosted control room and VPS-side business flows still requires these operational steps:

1. Sync the intended AI route-map change set from `/root/ImonEngine` into `/opt/imon-engine` so the deployed tree gains the `src/ai/*` route-map client layer and the NVIDIA-aware config logic.
2. Add a NVIDIA provider key in the deployed env using either `AI_PROVIDER_NVIDIA_API_KEY` or the legacy alias `NVIDIA_API_KEY`.
3. Clear `OPENAI_MODEL_FAST` and `OPENAI_MODEL_DEEP` in the deployed env unless a temporary forced override is explicitly intended.
4. Rebuild the deployed tree with `npm run build` under `/opt/imon-engine`.
5. Restart `imon-engine-control-room.service` and any VPS-side scheduled or operator flows that depend on the deployed build.
6. Re-run the live smoke checks for `fast`, `deep`, and `research` plus the control-room login path.

Observed deployment gap on `2026-04-10`:

- the live `/opt/imon-engine` deployment was still on a pre-route-map source layout without the new `src/ai/*` files
- the deployed env still lacked a NVIDIA key and still pinned `OPENAI_MODEL_FAST` and `OPENAI_MODEL_DEEP`

## Concrete Stage-2 Research Replacement Execution Plan

The `research` route should be replaced as a pipeline, not as a one-line model swap. The concrete implementation sequence should be:

### 1. Add a research acquisition layer

Files:

- `src/ai/retrieval.ts` or `src/services/research-acquisition.ts`
- `src/services/office-chat.ts`
- `src/services/northline-prospect-collector.ts`

Implementation:

- Introduce a typed `ResearchDocument` shape with at minimum `url`, `title`, `snippet`, `content`, `source`, and scoring metadata.
- Split external search acquisition from LLM synthesis so `AIClient.researchText(...)` no longer assumes a provider-native web-search tool.
- Keep the initial acquisition source simple and explicit. The repo can use a deterministic external search plus page-fetch step before touching embeddings or reranking.

### 2. Add explicit research pipeline routes to the AI registry

Files:

- `src/ai/api-map.ts`
- `src/config.ts`

Implementation:

- Keep shared user-facing routes as `fast`, `deep`, and `research`, but add internal provider assignments for:
  - embedding: `llama-3_2-nemoretriever-300m-embed-v1`
  - reranking: `rerank-qa-mistral-4b`
  - synthesis: `llama3-chatqa-1.5-8b` or the selected `deep` route
- Do not overload `nv-embedcode-7b-v1` for general market research. Reserve it for code-heavy retrieval only.

### 3. Refactor `AIClient.researchText(...)` into a pipeline orchestrator

Files:

- `src/ai/client.ts`
- `src/ai/retrieval.ts`

Implementation:

- Acquire candidate documents.
- Embed the query and candidate documents.
- Rerank by relevance.
- Build a grounded synthesis prompt from the top ranked results.
- Return both the synthesized answer and enough provenance metadata for debugging and future UI citation support.

### 4. Add a guarded rollout mode

Files:

- `src/config.ts`
- `docs/setup.md`
- `README.md`

Implementation:

- Add an explicit research-mode selector such as `AI_RESEARCH_MODE=openai|retrieval_pipeline`.
- Default to `openai` until the retrieval path reaches parity for office chat and Northline prospect research.
- Make rollback a config flip, not another refactor.

### 5. Add runtime artifacts for inspection

Files and artifacts:

- `runtime/ops/research/` or business-scoped research artifacts under `runtime/ops/`
- `docs/imon-engine.md`

Implementation:

- Persist the top documents, rerank order, and final synthesis inputs for smoke runs.
- Keep artifacts lightweight and inspectable so the owner can tell whether the pipeline failed at acquisition, ranking, or synthesis.

### 6. Validate against the current real consumers

Validation targets:

- `src/services/office-chat.ts`
- `src/services/northline-prospect-collector.ts`
- `npm test`
- `npm run build`
- `npm run dev -- engine-report`
- `npm run dev -- northline-plan --business auto-funding-agency`

Validation rule:

- Do not remove the OpenAI research path until the retrieval pipeline consistently produces usable office-chat summaries and prospect-research outputs on those two real consumer surfaces.

## Validation

- `npm test`
- `npm run build`
- `npm run dev -- engine-report`
- `npm run dev -- northline-plan --business auto-funding-agency`
- If any ClipBaiters transcription code changes later: `npm run dev -- clipbaiters-plan --business clipbaiters-viral-moments`

## Risks And Notes

- NVIDIA free preview endpoints can change availability and may not carry the privacy or uptime guarantees you would expect from a paid production contract.
- The attached free-endpoint inventory should be treated as the candidate source of truth for this plan, but execution should still trust the signed-in account view and live API tests over scraped page badges.
- `research` is the only route that is not a model-only swap. It is a workflow change because the current repo depends on integrated web search.
- `nv-embedcode-7b-v1` should stay code-specific and not become the default general research embedder.
- Whisper is already local and is not part of the paid API problem.

## Handoff Instructions For @imon-engine

- Implement only steps 1 and 2 in the first execution pass.
- Keep `research` on OpenAI until a real search plus retrieval replacement lands.
- Keep Whisper unchanged in the first execution pass.
- Use only models from the attached free-endpoint inventory as the candidate pool for the first execution pass.
- Use the centralized route map in `src/ai/api-map.ts` as the only place where the new default models are chosen.
- Update `README.md`, `docs/setup.md`, and `docs/imon-engine.md` in the same change set as the route switch.
- Preserve legacy `OPENAI_*` fallbacks during the first NVIDIA migration window.
- If `phi-3.5-mini-instruct` underperforms for office chat or outreach, add business-specific overrides instead of immediately undoing the shared provider addition.