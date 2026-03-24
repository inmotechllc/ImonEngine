# Operating Playbook

## Daily

- Run `engine-sync` to refresh resource pressure and launch recommendations.
- After any Gumroad launch, run `publish-asset-pack` first, then `engine-sync`, before deciding what to stage next.
- When a product bundle is built but not yet published, run `ready-asset-pack` so the queue reflects real production progress.
- Review the ready queue in `businesses` before activating another business.
- For the digital asset store, run `seed-asset-packs` until a starter queue exists, then work from `runtime/asset-store/<pack-id>/listing.md`.
- Run `daily-run` against a new or refreshed public business list.
- Review new approval tasks.
- Review generated outreach drafts before first live send from a new inbox.
- Record replies and update stages with `handle-reply`.

## Delivery

- Use `create-client` from an intake brief.
- Build the site preview.
- Run `qa`.
- Deploy only after form routing is real and QA passes.

## Monthly Retention

- Run `retain --client <id>`.
- Review update suggestions and review-response drafts.
- Send one upsell candidate per active client.

## Expansion Path

- Keep the digital asset store and niche content sites active first, then move into faceless social only after platform accounts are warmed.
- Once 3 retained clients exist, add white-label fulfillment briefs as another `ClientJob` source.
- Once 10 completed jobs share the same process shape, extract the narrowest repeatable internal tool into a micro-SaaS.
