# Imonic Store

## Purpose

`Imonic` is the print-on-demand lane under `imon-pod-store`. The repo now includes a single command that refreshes the launch plan, listing drafts, growth engine, analytics and revenue guardrails, and the owner checklist in one pass.

## Main Command

```bash
npm run dev -- pod-autonomy --business imon-pod-store --reference-dir <path-to-style-references>
```

This refreshes:

- `runtime/ops/pod-businesses/imon-pod-store/plan.md`
- `runtime/ops/pod-businesses/imon-pod-store/autonomy-summary.md`
- `runtime/ops/pod-businesses/imon-pod-store/commerce-engine.json`
- `runtime/ops/pod-businesses/imon-pod-store/growth-engine.json`
- `runtime/ops/pod-businesses/imon-pod-store/analytics-engine.json`
- `runtime/ops/pod-businesses/imon-pod-store/launch-calendar.json`
- `runtime/ops/pod-businesses/imon-pod-store/owner-checklist.md`

## What Is Automated Now

- Original-design prompt bank generation from the style dossier
- Deduplicated product scheduling across the launch window
- Shopify-ready listing drafts with pricing, tags, SEO fields, and cross-sells
- Collection planning for homepage, family collections, and design-led bundles
- Organic posting calendar for Instagram, Facebook, and Pinterest
- Email-flow planning, ad gating, analytics metrics, and verified-only revenue policy

## What Still Needs The Owner

- Shopify store creation plus Admin API credentials
- At least one POD vendor connection, such as Printify or Printful
- Social-account setup for any still-planned Imonic profiles
- Pixel, payout, shipping, tax, and storefront-basics confirmation after Shopify is live

## Revenue Rule

Imonic follows the same verified-only allocation model as the rest of ImonEngine:

- use verified platform exports as the source of truth for earnings
- keep inferred or manual-unverified transactions out of reinvestment and cashout decisions
- unlock paid growth only after the store has real conversion proof

## Recommended Loop

1. Run `pod-autonomy` after any reference-kit update or setup change.
2. Complete the current `owner-checklist.md`.
3. Publish the first live products in Shopify once the account blockers are gone.
4. Start the scheduled social queue only after the linked product pages are live.
5. Import verified storefront and vendor exports before making revenue or ad-budget decisions.
