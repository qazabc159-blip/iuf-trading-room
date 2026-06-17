# 2026-06-17 Codex Sync - KGI Daily Smoke False-Red Fix

## Latest state

- PR #1100 is merged and deployed. F-AUTO now shows the latest 8 S1 strategy holdings instead of raw unrelated KGI account `0050`.
- Production KGI gateway login/account read is healthy.
- Daily smoke still reports fail because it fires before the product quote lane is reliably available.

## Root cause

The KGI SIM daily smoke ran at `08:25-08:55 TST`. That is after EC2 boot, but before the TWSE MIS-backed product quote lane is reliably live. Since KGI quote-token entitlement is unavailable externally, the smoke had no usable product quote and sent false-red alerts.

## Chosen bounded task

Move KGI SIM daily smoke to `09:05-09:35 TST`, after:

- EC2 KGI gateway 08:20 boot.
- TWSE MIS quote-cron 08:55 warmup.
- Market open at 09:00.

## Safety

- No KGI live broker write path touched.
- No credentials touched or logged.
- SIM-only smoke remains guarded.
- Trade smoke still requires dual confirmation.

## Remaining gap

KGI SIM order lifecycle closure still depends on broker reports from gateway `/events/order/recent`, `/trades`, or `/deals`. Production currently returns no matching reports for the 8 S1 orders, so `/api/v1/kgi/sim/orders` correctly remains `unconfirmed`.
