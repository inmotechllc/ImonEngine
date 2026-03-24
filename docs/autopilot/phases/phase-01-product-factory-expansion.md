# Phase 1: Product Factory Expansion

## Objective

Expand the digital asset store from one live product to a repeatable factory with at least 2 finished products and a path to 5 total products.

## Immediate Priorities

1. Mark the second digital asset pack as ready for upload or publish it if the browser workflow allows.
2. Create 3 additional products using scripts, templates, or generation workflows that can be reused later.
3. Keep all products under the existing Gumroad store.

## Required Outputs

- The second product is `published`.
- At least 3 additional product directories exist with real deliverables, covers, listing copy, and upload zips.
- Product-generation scripts are improved if that reduces future manual work.
- [docs/gumroad-store.md](C:/AIWorkspace/Projects/Auto-Funding/docs/gumroad-store.md) reflects the expanded catalog.

## Suggested Tactics

- Reuse [build_social_template_pack.py](C:/AIWorkspace/Projects/Auto-Funding/scripts/build_social_template_pack.py) or extend it.
- Prefer templates, icon packs, wallpaper packs, checklists, prompt packs, and similar assets that do not require heavy support.
- Use the signed-in Gumroad browser session to publish when file-upload constraints can be solved safely.
- If the Playwright wrapper fails against the existing browser, use [chrome_cdp.py](C:/AIWorkspace/Projects/Auto-Funding/scripts/chrome_cdp.py) to keep the session alive instead of starting over.
- Use free tooling only.

## Completion Criteria

- Two products are finished, with the second product tracked in ImonEngine.
- At least 3 more product candidates are built or materially underway with reusable scripts.
- The repo, GitHub, and VPS are synced.

## Handoff

When complete:

- Update [state.json](C:/AIWorkspace/Projects/Auto-Funding/docs/autopilot/state.json) to mark this phase `completed` and Phase 2 `in_progress`.
- Update [log.md](C:/AIWorkspace/Projects/Auto-Funding/docs/autopilot/log.md).
- Create or update the next automation so it runs Phase 2 and repeats the same handoff protocol.
