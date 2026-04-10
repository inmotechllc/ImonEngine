# Venture Studio

ImonEngine now has a portfolio-level venture studio layer on top of the first live store. The current digital asset business is the working template, and future businesses should copy its operating structure without copying its public brand.

## Broad Plan

1. Learn from the live store template before launching a new lane.
2. Score candidate businesses by automation fit, speed to first sale, growth surface, and support burden.
3. Launch one new brand per approved window.
4. Use broad startup phases so each lane can choose tactics without breaking portfolio policy.
5. Funnel scalable niches into one umbrella brand when they can share a Facebook page, ad account, or storefront backend.
6. Reinvest a capped share of brand profit into the brand and move the remainder into the collective ImonEngine fund.
7. Keep capital-market experiments paper-only until operating businesses create real reserves.

## Launch Policy

- Create at most one new brand per launch window.
- Launch windows are Monday between `07:00` and `09:00` in `America/New_York`.
- Before five created brands exist, new-brand windows stay weekly.
- After five created brands exist, new-brand windows slow to the first Monday of each month.
- Future brands must use their own distinct names and plus-tag aliases such as `imonengine+canvascurrent@gmail.com`.
- `ImonEngine` and `Imon` stay reserved for the parent system and the legacy first store.

## Social Architecture Policy

- Use Facebook Pages only at the umbrella-brand level for scalable lanes, the parent system, and Shopify/POD businesses.
- When a business supports multiple niches, route those niches through one umbrella Facebook Page and create separate niche Instagram accounts beneath it.
- Niche Instagram accounts should use plus-tag aliases derived from the umbrella brand and lane name.
- ClipBaiters - Viral Moments is the current exception: start with one umbrella alias, manual niche YouTube channels, and no separate off-platform niche aliases or Instagram obligations until the YouTube workflow is proven.
- The `social-profiles` registry now reflects that exception directly: one shared alias, one optional umbrella `facebook_page`, and five planned `youtube_channel` lane records for ClipBaiters.
- Keep Instagram niche clusters to ten accounts or fewer per device or browser profile before rotating to another environment.

## Broad Startup Phases

1. Opportunity framing
   Define the niche, first offer, success metrics, and stop-loss rules.
2. Identity and account surface
   Create a distinct brand name, alias email, handles, and platform accounts in an isolated browser profile or container.
3. Core production loop
   Automate creation, QA, publishing, analytics, and payout visibility.
4. Organic growth loop
   Use randomized timing inside policy ranges for posting, stories, reels, and audience interaction.
5. Reinvestment and learning transfer
   Reinvest into the brand first, then feed the remaining profit into the collective ImonEngine fund.

## Agent Roles

- `Venture Strategist`: scores the lane and defines launch/stop rules.
- `Launch Ops Agent`: creates accounts, browser profiles, and isolated environments.
- `Production Agent`: builds the sellable or publishable outputs.
- `Growth Agent`: tests hooks, timing, and low-cost acquisition loops.
- `Finance And Allocation Agent`: tracks revenue, enforces reinvestment, and proposes shared-tool spend.

## Org Structure

Every venture blueprint now emits a real-world operating structure alongside the older lane strategy:

- department roster
- position roster
- workflow ownership map
- approval model summary

That structure is generated from the same control-plane templates used by the live engine sync, so new business blueprints and live businesses no longer drift apart structurally.

## Capital Experiments

- Equities, crypto, forex, and other capital-market experiments are treated as `paper-only` tracks at first.
- No live trading capital should come from the system until operating businesses are profitable and the paper strategy proves itself over time.
- Mining should be treated as an infrastructure ROI study, not as a default use of the current VPS.

## Commands

- `npm run dev -- venture-studio`
- `npm run dev -- venture-studio --business <id>`
- `npm run dev -- social-profiles`
- `npm run dev -- social-profiles --business clipbaiters-viral-moments`
- `npm run dev -- micro-saas-plan --business imon-micro-saas-factory [--notify-roadblocks]`
- `npm run dev -- autopilot-run-once`

## Runtime Artifacts

- `runtime/ops/venture-studio.json`
- `runtime/ops/venture-studio.md`
- `runtime/ops/venture-calendar.json`
- `runtime/ops/venture-calendar.md`
- `runtime/ops/venture-blueprints/<business-id>.json`
- `runtime/ops/venture-blueprints/<business-id>.md`
- `runtime/ops/micro-saas-businesses/<business-id>/plan.json`
- `runtime/ops/micro-saas-businesses/<business-id>/plan.md`
- `runtime/ops/org-control-plane.json`
- `runtime/ops/org-blueprints/<blueprint-id>.json`

## VPS Execution Surface

- Use `scripts/bootstrap-vps.sh` to install the base repo dependencies and the VPS tooling layer.
- Use `scripts/vps-browser-start.sh` to bring up a persistent Chrome profile on the VPS under Xvfb.
- Use `scripts/vps-tooling-status.sh` to verify Docker, Chrome, Playwright, Codex CLI, and DevTools availability.
- Use `scripts/business-worker-start.sh <business-id> "<business-name>"` to start an isolated Docker worker for a new lane.
- Use `scripts/vps-codex-login.sh` when the VPS Codex CLI needs an authenticated browser session.
