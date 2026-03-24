# Gumroad Store

## Current Store State

- Store URL: `https://imonengine.gumroad.com`
- Seller email: `imonengine@gmail.com`
- Store name: `ImonEngine`
- Profile bio: `Minimal wallpapers, creator templates, and AI-built digital assets for focused work and clean interfaces.`
- Active storefront tab: `Store`
- Active storefront section: `Products`

## First Live Product

- Product: `Minimal Productivity Desktop Background Pack`
- Product URL: `https://imonengine.gumroad.com/l/vkiqq`
- Marketplace category: `Design > Wallpapers`
- Launch price: `$9`
- Discover tags:
  - `desktop wallpaper`
  - `minimalist wallpaper`
  - `backgrounds`
  - `abstract wallpaper`

## No-Spend Decisions

- `Shopify` is deferred.
- `Stripe` is deferred for direct checkout and can stay out of the critical path while Gumroad is the active storefront.
- The store uses the free Gumroad profile and the existing Gmail account instead of a paid support inbox.

## Post-Publish Sync Flow

After a product is published on Gumroad:

1. Record the public product URL:

```bash
npm run dev -- publish-asset-pack --pack <id> --url <gumroad-url>
```

2. Refresh ImonEngine state:

```bash
npm run dev -- engine-sync
```

3. Refresh VPS-facing artifacts when needed:

```bash
npm run dev -- vps-artifacts
```

## Owner-Only Tasks Still Deferred

- Gumroad payout completion and risk review
- Any paid business inbox setup
- Any direct-checkout payment configuration outside Gumroad

## Resume Notes

- The first product is live and exposed on the storefront.
- The next product in the queue should stay inside the digital asset store lane instead of opening a new business line.
- If browser automation is reused, keep the dedicated signed-in Gumroad automation session open instead of relying on the local Chrome profile.
