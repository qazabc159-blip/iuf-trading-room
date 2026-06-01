# S1 Auto Scheduler Hardening — 2026-06-01

## Why

Yang correctly challenged that a quant strategy must decide and trade automatically. The owner-only manual trigger is only a rescue switch; it cannot be the main operating path.

## Change

- Kept the S1/F-AUTO cadence as automatic KGI SIM only.
- Added an automatic signal catch-up before the Monday order-submit window.
- Prevented order submit from using stale prior-day baskets.
- Exposed the automatic scheduler policy through `/api/v1/internal/s1-sim/status`.
- Updated `/ops/f-auto` to show that automatic scheduling is the primary path and manual trigger is Owner backup only.

## Guardrails

- `sim_only: true`
- `prod_write_blocked: true`
- No KGI real-order path.
- No daily-cadence change; S1 remains a weekly Monday strategy.
- Manual trigger remains confirmation-gated and Owner-only.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/api typecheck` — PASS
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` — PASS
- `pnpm.cmd test` — PASS, 474/474
- `git diff --check` — PASS (Windows CRLF warnings only)
