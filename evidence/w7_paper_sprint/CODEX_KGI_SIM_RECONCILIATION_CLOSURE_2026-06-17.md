# CODEX KGI SIM Reconciliation Closure Evidence - 2026-06-17

## Scope

F-AUTO / S1 KGI SIM observation lane.

## Problem

`/ops/f-auto` showed S1 submitted orders, but the product did not clearly answer:

- how many orders came from the durable S1 strategy ledger;
- how many broker reports were actually matched;
- how many fills were confirmed by broker evidence;
- whether missing confirmations were caused by no broker evidence or gateway read errors.

This made the product look like "maybe it bought, maybe it did not".

## Shipped

- `GET /api/v1/kgi/sim/orders` now returns `data.reconciliation`:
  - `auditOrderCount`
  - `brokerReportConfirmedCount`
  - `settlementConfirmedCount`
  - `filledCount`
  - `unconfirmedCount`
  - evidence row counts for order events, trade reports, and deals
  - fetch status and errors per broker evidence source
  - `closureState`
- `/ops/f-auto` now renders a product-level reconciliation card above the order table:
  - strategy ledger count
  - broker report count
  - fill confirmation count
  - waiting confirmation count
  - broker source health

## Verification

- `pnpm.cmd test` -> 572/572 pass
- `pnpm.cmd --filter @iuf-trading-room/api typecheck` -> pass
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` -> pass
- `pnpm.cmd --filter @iuf-trading-room/web test -- f-auto-observability` -> 358/358 pass

## Guardrails

- Does not promote real orders.
- Does not mark S1 orders as filled unless broker evidence matches.
- Keeps `submission_only` orders visible but explicitly shows them as awaiting broker report.
- Keeps gateway failures distinct from zero broker evidence.

## Next

Open PR, wait for CI, merge only when green, deploy manually, then verify production endpoint shape and `/ops/f-auto` behavior.
