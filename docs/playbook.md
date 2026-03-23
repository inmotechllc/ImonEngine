# Operating Playbook

## Daily

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

- Once 3 retained clients exist, add white-label fulfillment briefs as another `ClientJob` source.
- Once 10 completed jobs share the same process shape, extract the narrowest repeatable internal tool into a micro-SaaS.
