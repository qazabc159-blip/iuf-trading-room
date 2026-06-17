# 2026-06-17 Codex Sync - S1 F-AUTO Audit-Primary Portfolio

## Latest merged state

- `origin/main` already has the KGI SIM account-read after-hours fix and odd-lot position quantity fix.
- Production KGI gateway login was verified through AWS SSM watchdog without printing secrets.
- Production raw KGI account currently exposes an unrelated `0050` odd-lot position while S1 audit logs contain the latest Tuesday basket/order submissions.

## Open / coordination notes

- Avoid overlapping the full-site health gate work from PR #1097.
- This cycle is backend-owned but product-surface critical for the F-AUTO SIM observer page.
- No KGI live broker write path is touched.

## Blocker / owner

- KGI gateway `/events/order/recent`, `/trades`, and `/deals` still return no broker-side fill/deal confirmation for the 8 S1 orders. Owner: KGI SIM reconciliation lane / Jason.
- Until that exists, product copy must distinguish strategy-audit simulated holdings from broker-confirmed fills.

## Chosen bounded task

Fix `/api/v1/portfolio/f-auto` and `/api/v1/internal/s1-sim/status` so the S1/F-AUTO product surface shows the latest S1 cycle instead of being hidden by unrelated raw KGI account positions or today's empty files.

## Implementation intent

- F-AUTO holdings are strategy holdings: durable S1 audit is the primary source.
- KGI gateway rows may enrich matching S1 symbols only.
- Extra gateway positions, such as a manual/leftover `0050`, are ignored for the S1 observer and called out in notes.
- S1 status reads the latest basket/orders/EOD from a 7-day observation window because the strategy is weekly.
