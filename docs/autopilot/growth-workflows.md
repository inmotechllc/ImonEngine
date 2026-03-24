# Growth Workflows

## Repeatable Traffic Workflow

- Generate promo assets with `python scripts/build_growth_assets.py --state-file runtime/state/assetPacks.json --output-dir runtime/marketing`.
- Use the generated square teasers for X, LinkedIn, Pinterest Idea Pins, and Gumroad profile updates.
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
- Reuse `captions.md` as the base copy for social posts, Gumroad updates, and email blurbs.

## No-Cost Channels

- Gumroad profile updates
- X posts with one featured asset and one CTA link
- LinkedIn carousel teasers for the creator-template and icon products
- Pinterest pins for wallpaper and texture packs

## Pacing Rules

- Keep catalog growth under the configured 7-day cap.
- Maintain a mixed catalog instead of publishing only wallpaper packs.
- Do not seed new products when the open queue is already full.
