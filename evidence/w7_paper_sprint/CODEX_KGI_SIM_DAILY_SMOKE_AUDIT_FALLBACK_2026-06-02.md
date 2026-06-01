# KGI SIM Daily Smoke Audit Fallback

Date: 2026-06-02
Owner: Codex
Scope: API observation durability for F-AUTO / KGI SIM readiness

## Shipped

- Persisted `kgi.sim.daily_smoke` audit payloads with the full daily smoke entry.
- Added `getDailySmokeHistoryDurable(workspaceId)` to merge in-memory smoke rows with latest `audit_logs` rows.
- Updated `/api/v1/internal/kgi/sim/daily-smoke-status` so deploys/restarts do not wipe the F-AUTO daily smoke panel.
- Added a v3 recommendation card alias type fix required by latest `origin/main` so CI typecheck stays green.
- Fixed `news-top10` source-row selection so a short 6h sample expands to wider real-data windows instead of publishing a half-empty AI Top 10.

## Safety

- No KGI live broker writes.
- No real-order path promotion.
- No SIM order submission in this PR.
- F-AUTO manual run remains guarded outside automatic S1 windows.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/api typecheck` PASS
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS
- `pnpm.cmd test` PASS, 482/482

## Production Evidence Before This PR

- F-AUTO production browser page opened successfully.
- Screenshot: `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_kgi_sim_manual_20260601\evidence\w7_paper_sprint\screenshots\fauto-prod-1780332687701.png`
- The daily smoke endpoint was reachable but history could be empty after deploy because the previous ring buffer was memory-only.

## Follow-Up After Deploy

- Verify `/api/v1/internal/kgi/sim/daily-smoke-status` after the next scheduled smoke or forced smoke.
- Re-test KGI SIM quote auth during a valid market window; after-hours status previously showed `KGI_QUOTE_AUTH_UNAVAILABLE`.
