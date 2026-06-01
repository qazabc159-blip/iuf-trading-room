# S1 capital-backed quant SIM PR evidence (2026-06-01)

## Scope

- Keep `/quant-strategies` as a single formal product lane: S1 / F-AUTO / KGI SIM.
- Let Yang configure S1 capital up to TWD 10,000,000.
- Wire that capital into the backend S1 runner so the next S1 basket sizing uses the latest `quant_strategy.subscribe` audit-log record.
- Expose the resolved capital and source on `/api/v1/internal/s1-sim/status` and `/ops/f-auto`.
- Keep all execution SIM-only. No KGI real-order path is enabled.

## Real KGI SIM submit proof

Production KGI SIM order submit was tested after Yang explicitly allowed SIM testing:

```json
{
  "sim_only": true,
  "prod_write_blocked": true,
  "data": {
    "tradeId": "1780305214293428001",
    "status": "accepted",
    "symbol": "0050",
    "side": "buy",
    "qty": 1,
    "quantityUnit": "SHARE",
    "effectiveQtyShares": 1,
    "price": 1,
    "orderType": "limit",
    "timeInForce": "IOC",
    "orderCond": "Cash",
    "isOddLot": true,
    "submittedAt": "2026-06-01T09:13:33.814Z"
  }
}
```

HTTP status: `201`.

This proves the KGI SIM write path accepts a guarded SIM order while keeping `prod_write_blocked: true`.

## Backend wiring

- `apps/api/src/quant-strategy-subscribe.ts`
  - Raises capital range to `50,000 - 10,000,000`.
  - Marks only `cont_liq_v36` as `paper_ready` after Yang's S1/F-AUTO KGI SIM ACK.
- `apps/api/src/s1-sim-runner.ts`
  - Adds `resolveS1SimCapitalTwd(workspaceId)`.
  - Reads the latest `audit_logs` row where:
    - `action = "quant_strategy.subscribe"`
    - `entityId = "cont_liq_v36"`
  - Falls back to `S1_SIM_CAPITAL_TWD`, then TWD 10,000,000 default.
  - Uses the resolved capital for S1 basket sizing.
- `apps/api/src/server.ts`
  - Adds S1 capital fields to `/api/v1/internal/s1-sim/status`:
    - `configured_capital_twd`
    - `capital_source`
    - `capital_subscription_id`
    - `capital_subscription_created_at`

## Frontend wiring

- `/quant-strategies` now presents S1 as the only formal quant product lane.
- `/quant-strategies/cont_liq_v36` writes S1 capital configuration instead of pretending multiple quant products are production-ready.
- `/ops/f-auto` displays configured S1 capital and source from the same backend status endpoint.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/api typecheck` — PASS
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` — PASS
- `pnpm.cmd --filter @iuf-trading-room/web test` — PASS, 246 tests
- `pnpm.cmd test` — PASS, 472 tests

## Known timing constraint

S1 currently opens signal/order windows on Monday morning:

- Signal: Monday 08:30-08:55 TST
- Order submit: Monday 09:00-09:20 TST

The 2026-06-01 Monday order window was already missed during this PR cycle. The capital wiring is ready for the next S1 run. If Yang wants a controlled catch-up run before the next Monday window, the next safe PR should add an owner-only manual S1 trigger with explicit SIM-only guardrails and audit logging.
