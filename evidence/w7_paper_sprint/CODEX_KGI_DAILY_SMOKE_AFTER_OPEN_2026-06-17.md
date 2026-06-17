# Codex Evidence - KGI Daily Smoke After-Open Window

## Problem

Production daily smoke kept sending false-red alerts:

- Gateway reachable.
- KGI SIM login succeeds.
- Account is set.
- KGI quote token is externally unavailable.
- Product quote lane falls back to TWSE MIS, but the smoke fired pre-open when MIS was not reliably usable yet.

This made the health board look broken even when the product quote path would be valid after open.

## Fix

- Move KGI SIM daily smoke scheduler from `08:25-08:55 TST` to `09:05-09:35 TST`.
- Update owner status API copy to the same window.
- Update scheduler startup description to the same window.
- Update CI guard for the new window.

## Files

- `apps/api/src/broker/kgi-sim-env.ts`
- `apps/api/src/server.ts`
- `tests/ci.test.ts`

## Verification

- `pnpm.cmd test` - 571/571 passed.
- `pnpm.cmd --filter @iuf-trading-room/api typecheck` - passed.
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` - passed.
- `git diff --check` - passed with CRLF conversion warnings only.

## Production verification after deploy

- `/api/v1/internal/kgi/sim/daily-smoke-status` must show scheduledWindow `09:05-09:35 TST`.
- Next morning's daily smoke should run after market open and should no longer fail solely because pre-open MIS data is unavailable.
- If KGI quote entitlement remains unavailable, it should remain visible in `quoteCheck.kgiQuoteCapability` while product quote usability is judged from the MIS-backed path.
