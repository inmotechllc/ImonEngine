# Gumroad Store

## Current Store State

- Store URL: `https://imonengine.gumroad.com`
- Seller email: `imonengine@gmail.com`
- Store name: `ImonEngine`
- Profile bio: `Minimal wallpapers, creator templates, and AI-built digital assets for focused work and clean interfaces.`
- Active storefront tab: `Store`
- Active storefront section: `Products`

## Live Products

- Product: `Minimal Productivity Desktop Background Pack`
- Product URL: `https://imonengine.gumroad.com/l/vkiqq`
- Status: `published`
- Suggested price: `$9`
- Local pack dir: `C:\AIWorkspace\Projects\Auto-Funding\runtime\asset-store\gumroad-clean-gradients-with-subtle-depth-minimal-productivity-desktop-backgrounds`

- Product: `Neutral Instagram Carousel Template Pack`
- Product URL: `https://imonengine.gumroad.com/l/wvhzrhl`
- Status: `published`
- Suggested price: `$12`
- Local pack dir: `C:\AIWorkspace\Projects\Auto-Funding\runtime\asset-store\gumroad-editorial-beige-and-monochrome-layouts-neutral-instagram-carousel-templates-for-small-creators`

- Product: `Glassmorphism Icon Set for Indie Builders`
- Product URL: `https://imonengine.gumroad.com/l/dbfftq`
- Status: `published`
- Suggested price: `$19`
- Local pack dir: `C:\AIWorkspace\Projects\Auto-Funding\runtime\asset-store\gumroad-soft-translucent-surfaces-with-muted-accents-soft-glassmorphism-icon-set-for-indie-builders`

- Product: `Muted Paper Grain Texture Pack`
- Product URL: `https://imonengine.gumroad.com/l/vjqjxm`
- Status: `published`
- Suggested price: `$14`
- Local pack dir: `C:\AIWorkspace\Projects\Auto-Funding\runtime\asset-store\gumroad-soft-scanned-paper-and-matte-grain-overlays-muted-paper-grain-textures-for-brand-designers`

- Product: `Warm Monochrome Desktop Background Pack`
- Product URL: `https://imonengine.gumroad.com/l/laxvlh`
- Status: `published`
- Suggested price: `$9`
- Local pack dir: `C:\AIWorkspace\Projects\Auto-Funding\runtime\asset-store\gumroad-warm-gradients-with-soft-shadow-geometry-warm-monochrome-desktop-backgrounds-for-creative-studios`

- Product: `Charcoal gradients with low-contrast geometry Charcoal developer desktop backgrounds`
- Product URL: `https://imonengine.gumroad.com/l/sdhts`
- Status: `published`
- Suggested price: `$9`
- Local pack dir: `C:\AIWorkspace\Projects\Auto-Funding\runtime\asset-store\gumroad-charcoal-gradients-with-low-contrast-geometry-charcoal-developer-desktop-backgrounds`

- Product: `Stone Paper Texture Pack for Pitch Decks`
- Product URL: `https://imonengine.gumroad.com/l/yclwyd`
- Status: `published`
- Suggested price: `$14`
- Local pack dir: `C:\AIWorkspace\Projects\Auto-Funding\runtime\asset-store\gumroad-stone-fibers-and-quiet-grain-overlays-stone-paper-textures-for-pitch-decks`

- Product: `Cool blue gradients with soft diffused shadows Blue haze desktop backgrounds for operators`
- Product URL: `https://imonengine.gumroad.com/l/jsgyil`
- Status: `published`
- Suggested price: `$9`
- Local pack dir: `C:\AIWorkspace\Projects\Auto-Funding\runtime\asset-store\gumroad-cool-blue-gradients-with-soft-diffused-shadows-blue-haze-desktop-backgrounds-for-operators`

## Ready To Upload

## Repo-Controlled Autopilot

- Primary local runner: `scripts/run_local_autopilot.ps1`
- Install local schedule: `scripts/install-windows-autopilot.ps1`
- VPS wrapper: `scripts/run_vps_autopilot.sh`
- VPS cron installer: `scripts/install-vps-autopilot.sh`
- Local Gumroad publisher: `scripts/publish_gumroad_product.py`
- VPS sync helper: `scripts/sync_vps_repo.py`

## Browser Recovery

- Keep the signed-in automation browser open for Gumroad and Gmail access.
- If the Playwright wrapper fails to reattach, recover the session with `python scripts/chrome_cdp.py list-tabs`.
- Publish the next ready pack through the live browser session with `python scripts/publish_gumroad_product.py --pack-dir <pack-dir>`.
- Repair a published listing's missing download with `npm run dev -- repair-asset-pack-content --pack <id>`.
- Use `python scripts/send_gmail_message.py --to ... --subject ... --body-file ...` for the final owner notification once Gmail is open.

## Post-Publish Sync Flow

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
