# AI API Routing Map Plan

## Goal

Introduce a single typed AI routing map at `src/ai/api-map.ts` that owns both shared engine routes and business-specific AI routes, so the rest of the code only asks for a route id or business-capability pair instead of hardcoding provider, model, or base URL assumptions. The first implementation should preserve current OpenAI behavior by default, keep provider secrets in env, and make future swaps to self-hosted or lower-cost OpenAI-compatible backends a one-file route change plus any needed `.env` additions.

## Execution Status

- Completed on 2026-04-09.
- Step 1 completed: `src/ai/api-map.ts`, the generic `config.ai` surface, and the env templates now define the central routing contract.
- Step 2 completed: `src/ai/client.ts` now resolves provider and model selection through the route map, and route-aware research gating replaced the old global OpenAI checks.
- Step 3 completed: active callers now import from `src/ai/*`, while `src/openai/*` remains as a temporary re-export shim for compatibility.
- Step 4 completed: test coverage now includes legacy `OPENAI_*` hydration plus business-route inheritance, and both `npm test` and `npm run build` passed.

## Subsystems Touched

- AI routing and config
  - `src/ai/api-map.ts`
  - `src/ai/client.ts`
  - `src/config.ts`
  - `src/domain/defaults.ts`
  - optional compatibility shims: `src/openai/client.ts`, `src/openai/prompts.ts`
- Current AI call sites that should stop depending on an OpenAI-named transport path
  - `src/index.ts`
  - `src/agents/reply-handler.ts`
  - `src/agents/qualifier.ts`
  - `src/agents/orchestrator.ts`
  - `src/agents/outreach-writer.ts`
  - `src/agents/digital-asset-factory.ts`
  - `src/agents/site-builder.ts`
  - `src/services/office-chat.ts`
  - `src/services/reports.ts`
  - `src/services/northline-prospect-collector.ts`
- Current business and brand coverage that should be represented in the map
  - `imon-engine` for office-chat and engine-level research
  - `imon-digital-asset-store` for asset-pack blueprint generation
  - `auto-funding-agency` / Northline Growth Systems for lead scoring, outreach drafting, site copy, reply classification, retention reporting, and prospect research
  - reserved business namespaces aligned with `src/domain/defaults.ts` for `imon-niche-content-sites`, `imon-faceless-social-brand`, `clipbaiters-viral-moments`, `imon-micro-saas-factory`, and `imon-pod-store`
- Env and setup surfaces
  - `.env.example`
  - `src/agents/store-autopilot.ts`
- Docs that must be updated in the same change set when the config contract changes
  - `docs/setup.md`
  - `README.md`
  - `docs/imon-engine.md`
- Validation surfaces
  - `src/workflows.test.ts`
  - `src/pod-autonomy.test.ts`
  - generated `build/**` via `npm run build`

## Prerequisites

- Decide whether the first pass should support only OpenAI-compatible APIs. Recommended answer: yes. The current `openai` SDK already supports a custom `baseURL`, which covers most self-hosted or lower-cost swaps without adding a second SDK yet.
- Keep provider secrets in private env storage. `src/ai/api-map.ts` should contain route defaults and env key names, not raw secrets.
- Keep the `research` route on a provider that actually supports web search until there is a tested replacement for `web_search_preview`.
- Use the managed-business ids already defined in `src/domain/defaults.ts` as the canonical business namespaces in the map instead of inventing a second naming layer.
- Confirm whether committed `build/**` output should continue mirroring source changes. If the repo still expects tracked build artifacts, the implementation handoff must include the regenerated build tree.

## Ordered Steps

### 1. Add the route map and make config route-aware

Files and docs:

- `src/ai/api-map.ts`
- `src/config.ts`
- `.env.example`
- `src/agents/store-autopilot.ts`
- `docs/setup.md`

Implementation details:

- Create `src/ai/api-map.ts` as the single source of truth for:
  - provider ids
  - provider display names
  - provider transport type, initially `openai-compatible`
  - provider env keys for `apiKey` and optional `baseUrl`
  - shared default route ids `fast`, `deep`, and `research`
  - business-scoped route groups keyed by managed business id
  - default model per route
  - optional route tools, for example `web_search_preview` on `research`
- Keep route selection in `src/ai/api-map.ts`, not in env, so moving a shared route or a business-specific route from `openai` to `local` stays a one-file edit.
- Seed explicit route namespaces for:
  - `imon-engine`
  - `imon-digital-asset-store`
  - `imon-niche-content-sites`
  - `imon-faceless-social-brand`
  - `clipbaiters-viral-moments`
  - `imon-micro-saas-factory`
  - `imon-pod-store`
  - `auto-funding-agency`
- In the same file, mark which business routes are active today versus reserved. Recommended initial active inventory:
  - `imon-engine.office-chat.fast`
  - `imon-engine.market-research.research`
  - `imon-digital-asset-store.asset-blueprint.deep`
  - `auto-funding-agency.qualify-lead.fast`
  - `auto-funding-agency.outreach-draft.fast`
  - `auto-funding-agency.site-copy.deep`
  - `auto-funding-agency.reply-classification.fast`
  - `auto-funding-agency.retention-report.deep`
  - `auto-funding-agency.prospect-research.research`
- Reserved namespaces for Northbeam, Velora, ClipBaiters, QuietPivot, and Imonic should still appear in the map even if they inherit shared defaults initially, so future per-brand AI APIs are added in the same file instead of ad hoc across services.
- Update `AppConfig` in `src/config.ts` from `openAiApiKey` and `models.fast/deep` to a generic `ai` section that resolves providers and routes from the map.
- Add example env keys for provider secrets and host overrides to `.env.example`, for example:
  - `AI_PROVIDER_OPENAI_API_KEY`
  - `AI_PROVIDER_OPENAI_BASE_URL`
  - `AI_PROVIDER_LOCAL_API_KEY`
  - `AI_PROVIDER_LOCAL_BASE_URL`
- Keep `OPENAI_API_KEY`, `OPENAI_MODEL_FAST`, and `OPENAI_MODEL_DEEP` as temporary fallbacks in `src/config.ts` so existing local and VPS environments do not break on the first rollout.
- Update `src/agents/store-autopilot.ts` `composeEnvExample()` so generated env scaffolding matches `.env.example` exactly.

### 2. Route AI calls through the map instead of hardcoded OpenAI config

Files and docs:

- `src/ai/client.ts`
- `src/openai/client.ts`
- `src/services/northline-prospect-collector.ts`
- `src/services/office-chat.ts`
- `docs/imon-engine.md`

Implementation details:

- Move the current transport logic from `src/openai/client.ts` into a provider-neutral `src/ai/client.ts`.
- Have `AIClient` resolve a provider and model from `src/ai/api-map.ts` for each route instead of reading `config.openAiApiKey` and `config.models.*` directly.
- Add route-resolution precedence that supports business coverage cleanly:
  - business-specific route override
  - shared capability default
  - fallback route disablement
- Cache SDK clients per provider id so `fast`, `deep`, and `research` can share or split endpoints without extra call-site work.
- Replace the current global `enabled` flag with route-aware checks such as `canUse("fast")` and `canUse("research")`, then update `src/services/northline-prospect-collector.ts` to gate web-research supplementation on the research route specifically.
- Update `AIClient` so callers can provide business context without passing transport details. Accept either a business id plus capability id or a pre-resolved route id, but do not let callers pass raw provider names, model names, or base URLs.
- Remove hardcoded OpenAI attribution strings in `src/services/northline-prospect-collector.ts` and response-source display text in `src/services/office-chat.ts`; those strings should use the resolved provider label from the route map.
- If the repo wants a low-churn rollout, keep `src/openai/client.ts` as a thin re-export of `src/ai/client.ts` for one pass. If the repo prefers a clean cut, update imports in the same change and delete the shim immediately.

### 3. Rename or shim the import surface so the repo depends on AI routes, not an OpenAI path

Files and docs:

- `src/index.ts`
- `src/agents/reply-handler.ts`
- `src/agents/qualifier.ts`
- `src/agents/orchestrator.ts`
- `src/agents/outreach-writer.ts`
- `src/agents/digital-asset-factory.ts`
- `src/agents/site-builder.ts`
- `src/services/office-chat.ts`
- `src/services/reports.ts`
- `src/services/northline-prospect-collector.ts`
- `src/pod-autonomy.test.ts`
- `src/workflows.test.ts`
- optional shims: `src/openai/prompts.ts`, `src/openai/client.ts`

Implementation details:

- Update importers to read from `src/ai/client.ts` and, if prompts move, `src/ai/prompts.ts`.
- Keep the public method names `generateJson`, `generateText`, and `researchText` so this stays a transport and config refactor, not a workflow rewrite.
- Do not let any caller pass raw provider names, model names, or base URLs. Callers should request shared behavior through the `AIClient` API or supply business context so the client resolves the correct business route.
- Update the current business callers explicitly:
  - `src/agents/digital-asset-factory.ts` should resolve through the `imon-digital-asset-store` route group.
  - `src/agents/qualifier.ts`, `src/agents/outreach-writer.ts`, `src/agents/site-builder.ts`, `src/agents/reply-handler.ts`, `src/services/reports.ts`, and `src/services/northline-prospect-collector.ts` should resolve through the `auto-funding-agency` route group.
  - `src/services/office-chat.ts` should resolve through `imon-engine` for engine scope and through the selected business id for business scope, with inheritance to the shared defaults when a brand has no explicit override yet.
- If prompt files stay in `src/openai/prompts.ts`, document that only prompts remain there and the provider transport has moved. If prompts are moved to `src/ai/prompts.ts`, update all imports in one pass and delete the old files or leave temporary re-export shims.

### 4. Expand tests so route swaps are verified, not assumed

Files and docs:

- `src/workflows.test.ts`
- `src/pod-autonomy.test.ts`
- `docs/setup.md`
- `README.md`

Implementation details:

- Update existing tests that currently hardcode `OPENAI_API_KEY` and `source: "openai"` so they reflect the new route-aware contract.
- Add focused coverage for:
  - route fallback when a configured provider has no key or no reachable base URL
  - `research` staying disabled while `fast` and `deep` remain usable on another provider
  - changing a route's provider in `src/ai/api-map.ts` without touching any caller files
  - business-specific overrides not leaking across brands, for example changing `imon-digital-asset-store` routes without altering Northline behavior
  - brands without explicit route overrides inheriting shared defaults deterministically
- Keep at least one backward-compatibility test that proves legacy `OPENAI_*` env keys still hydrate the new config during the transition.
- Update setup docs and README copy to tell operators that shared and business-specific route assignments live in `src/ai/api-map.ts`, while secrets and provider host overrides live in `.env` or private env storage.

## Validation

- `npm test`
- `npm run build`
- Confirm the compiled output refreshes the tracked build tree so the new AI layer is mirrored under `build/`.
- Verify the route-map change path with one source-level swap:
  - point `fast` in `src/ai/api-map.ts` at a second provider id
  - rerun `npm test`
  - confirm no caller files needed edits for the route change
- Verify the business-map change path with one source-level swap:
  - point `imon-digital-asset-store.asset-blueprint.deep` at a second provider id
  - rerun `npm test`
  - confirm Northline tests and engine-level office-chat tests still resolve their original routes
- Verify the research gate still fails closed by running the existing Northline prospect-collector test coverage without a research-capable provider configured.

## Risks And Notes

- The current repo already centralizes almost all AI traffic in a single class. Keep this change at the routing layer; do not build a large plugin framework unless a truly non-OpenAI-compatible provider is an immediate requirement.
- `researchText` is the one materially different route today because it depends on OpenAI's `web_search_preview` tool. A cheaper local model may be fine for `fast` and `deep` while `research` remains on OpenAI.
- Most current direct AI usage is in the Northline lane, the digital asset store, and the control-room office chat. The other managed brands should still have reserved namespaces in the map so their future AI APIs land in the same registry file.
- If `src/openai/client.ts` is deleted in the same change, the import churn is straightforward but broad. A one-release re-export shim is a lower-risk rollout if you want smaller diffs.
- Preserve the old `OPENAI_*` env names as fallbacks for at least one migration window, then remove them only after local and VPS environments have the new `AI_PROVIDER_*` keys.
- Do not store provider secrets or local tunnel credentials in `src/ai/api-map.ts`. That file should describe routing, not secret material.
- Business-specific AI-adjacent dependencies that are not HTTP model routes yet, such as ClipBaiters transcription tooling, should be listed as reserved or non-LLM entries in the same map or in a clearly linked adjacent inventory. Do not leave brand-level AI dependencies implicit.
- If the repo continues to commit `build/`, the execution handoff must include the regenerated `build/**` output from `npm run build`.

## Handoff Instructions For @imon-engine

- Implement this as a routing and config refactor, not as a workflow rewrite. The main behavior change should be that route assignments move into `src/ai/api-map.ts`.
- Prefer the `openai` SDK plus `baseURL` override for the first pass so self-hosted or lower-cost OpenAI-compatible endpoints can be adopted without adding a second transport library yet.
- Keep `research` mapped to an OpenAI-capable provider unless you also land a tested replacement for `web_search_preview`.
- Make the route map business-aware on day one. Include explicit namespaces for every managed Imon business id from `src/domain/defaults.ts`, even when a brand only inherits shared defaults initially.
- Wire the currently active business consumers first: `imon-engine`, `imon-digital-asset-store`, and `auto-funding-agency`. Leave the other brands as explicit reserved map entries rather than omitting them.
- Update `.env.example`, `src/agents/store-autopilot.ts`, `docs/setup.md`, `README.md`, and `docs/imon-engine.md` in the same change set as the new map.
- Preserve legacy `OPENAI_*` fallbacks in `src/config.ts` until the current VPS and local environments are migrated.
- If you keep compatibility shims under `src/openai/`, mark them as temporary and remove them only after the import sweep and tests are green.