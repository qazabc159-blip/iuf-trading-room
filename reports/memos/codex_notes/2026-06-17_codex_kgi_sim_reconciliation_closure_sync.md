# 2026-06-17 Codex Sync - KGI SIM Reconciliation Closure

## Latest State

- Main already contains:
  - #1100 F-AUTO portfolio prefers latest S1 audit holdings over unrelated raw gateway positions.
  - #1101 KGI daily smoke shifted to 09:05-09:35 TST to avoid pre-open false red.
  - #1102 QA iframe false alarm fix from another agent.
- No open PRs before this work started.

## Chosen Frontend/API-Safe Task

Close the KGI SIM/S1 observability gap: make `/ops/f-auto` show strategy ledger orders, broker report evidence, confirmed fills, and pending broker confirmation explicitly.

## Changes

- API:
  - Added reconciliation evidence summary in `apps/api/src/broker/kgi-order-reconciliation.ts`.
  - Extended `GET /api/v1/kgi/sim/orders` to return `data.reconciliation`.
  - Stopped silently flattening broker evidence fetch errors into empty data.
- Web:
  - Updated `apps/web/lib/fauto-sim-api.ts` to return `KgiSimOrdersResult`.
  - Updated `/ops/f-auto` order panel to show reconciliation status and broker evidence source counts.

## Verification

- `pnpm.cmd test` -> 572/572 pass
- `pnpm.cmd --filter @iuf-trading-room/api typecheck` -> pass
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` -> pass
- `pnpm.cmd --filter @iuf-trading-room/web test -- f-auto-observability` -> 358/358 pass

## Blockers / Owners

- No Yang decision needed for this bounded task.
- Broker-side fills remain unconfirmed if KGI gateway `/events/order/recent`, `/trades`, and `/deals` return no matching evidence. The UI must not claim confirmed fills until those reports exist.

## Next

Open one PR, watch checks, merge only if green, deploy manually, and verify production endpoint behavior.
