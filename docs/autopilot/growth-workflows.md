# Growth Workflows

## Repeatable Traffic Workflow

- Generate promo assets with `python scripts/build_growth_assets.py --state-file runtime/state/assetPacks.json --output-dir runtime/marketing`.
- Use the generated square teasers for the live channel set first: Pinterest pins for the `Imon Digital Assets` board, then Facebook Page posts from the signed-in `Imon` page.
- Publish due Facebook or Pinterest posts with `python scripts/publish_growth_post.py --queue-file runtime/state/growthQueue.json --social-profiles-file runtime/state/socialProfiles.json --item-id <id>`.
- Review channel readiness in `runtime/ops/social-profiles.md`.
- X remains in the registry but stays blocked until the Arkose challenge is cleared safely.
- Refresh the scheduled post queue with `npm run dev -- growth-queue`.
- Review the live queue in `runtime/ops/growth-queue.md`.
- Rotate product focus weekly in this order:
  - Minimal Productivity Desktop Background Pack
  - Neutral Instagram Carousel Template Pack
  - Glassmorphism Icon Set for Indie Builders
  - Muted Paper Grain Texture Pack
  - Warm Monochrome Desktop Background Pack
  - Charcoal gradients with low-contrast geometry Charcoal developer desktop backgrounds
  - Stone Paper Texture Pack for Pitch Decks
  - Cool blue gradients with soft diffused shadows Blue haze desktop backgrounds for operators

## Repurposing Workflow

- Pull the first cover image from each pack.
- Generate three teaser formats: landscape, square, and story.
- Reuse `captions.md` as the base copy for Facebook posts, future X/Pinterest posts, and email blurbs.

## No-Cost Channels

- Facebook Page posts from `Imon`
- X posts with one featured asset and one CTA link once the X profile is live
- Pinterest pins for wallpaper and texture packs from the live `Imon Digital Assets` board

## Pacing Rules

- Keep catalog growth under the configured 7-day cap.
- Maintain a mixed catalog instead of publishing only wallpaper packs.
- Do not seed new products when the open queue is already full.
