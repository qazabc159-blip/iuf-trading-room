# S1 SIM manual window guard - 2026-06-02

## Scope

Keep the S1/F-AUTO SIM strategy automatic cadence authoritative. Manual owner triggers remain backup-only and now require an explicit outside-window override when used outside the configured automatic windows.

## Production verification before this patch

- API health: `https://api.eycvector.com/health` returned HTTP 200.
- Active API deployment: `cea5a142-f075-4266-8a11-c1c646e02cac`.
- Deploy run `26766384762` for PR #890 was green for web, api, and worker.
- Safe manual `signal` trigger only generated a basket; it did not submit orders.
- New basket persisted at `2026-06-02T00:17:13+08:00`.
- Basket result: 8/8 entries have `target_shares > 0`.
- Zero-share candidate `3026` was skipped and recorded in `failsafe_notes`.
- Audit log row persisted: `s1_sim.signal_generated`, entity `2026-06-02`.

## Fix

- `/api/v1/internal/s1-sim/manual-run` now checks the relevant automatic S1 window before accepting `signal`, `order_submit`, or `eod`.
- If the action is outside its automatic window, the endpoint returns `409 OUTSIDE_AUTOMATIC_WINDOW` unless owner also passes `outsideWindowConfirm='ALLOW_S1_SIM_OUTSIDE_WINDOW'`.
- This preserves owner rescue ability while preventing accidental manual activity from looking like normal strategy cadence.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/api typecheck` passed.
- `pnpm.cmd test` passed: 480/480.

## Guardrail

No real-order path was touched. KGI SIM remains isolated from real order writes.
