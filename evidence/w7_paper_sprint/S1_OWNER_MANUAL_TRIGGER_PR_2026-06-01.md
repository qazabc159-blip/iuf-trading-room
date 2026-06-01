# S1 owner manual trigger PR evidence (2026-06-01)

## Scope

Add an owner-only S1 SIM manual trigger so operations can recover from a missed S1 window without changing the automatic S1 Monday cadence.

2026-06-01 production validation showed the synchronous trigger can take several minutes while building the full FinMind universe. The endpoint was therefore changed to return `202 Accepted` immediately and run the selected action in the background. Operators should watch `/api/v1/internal/s1-sim/status` for the resulting basket/order/EOD state.

## Endpoint

`POST /api/v1/internal/s1-sim/manual-run`

Body:

```json
{
  "action": "signal",
  "confirm": "RUN_S1_SIM_MANUAL"
}
```

Allowed actions:

- `signal` → queues `runS1SignalTick()`
- `order_submit` → queues `runS1OrderSubmitTick()`
- `eod` → queues `runS1EodReportTick()`

## Guardrails

- Owner-only.
- Requires explicit confirmation string: `RUN_S1_SIM_MANUAL`.
- Response always includes `sim_only: true` and `prod_write_blocked: true`.
- Returns immediately with `status: "accepted"` and `result_path: "/api/v1/internal/s1-sim/status"`.
- Does not modify the automatic Monday S1 schedule.
- Does not enable or touch any KGI real-order path.

## Why this is needed

S1 automatic windows are:

- Signal: Monday 08:30-08:55 TST
- Order submit: Monday 09:00-09:20 TST

The 2026-06-01 window had already closed when S1 capital wiring was verified. This manual trigger lets Yang run an explicit SIM catch-up when operations needs it, without pretending the strategy is daily-cadence or silently changing research assumptions.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/api typecheck`
- `pnpm.cmd test`
