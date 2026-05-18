# 2026-05-19 Codex P0 Portfolio KGI Quote Degraded Proxy Start

## Latest merged state
- `origin/main` is at `8f319e1` (`#719 fix(web): keep portfolio paper submit paper-only`).
- Open PRs: none at cycle start.
- #719 deploy completed and production smoke confirmed Paper submit no longer calls KGI SIM.

## Production QA finding
- `/portfolio?symbol=2603` is usable: search, chart, paper preview, paper risk-block, and real-order lock are visible.
- Browser console still shows 422 resource errors from KGI read-only quote endpoints:
  - `/api/v1/kgi/quote/bidask?symbol=2603`
  - `/api/v1/kgi/quote/ticks?symbol=2603&limit=16`
- UI already displays non-trading-hours/degraded quote copy, but the same-origin final-v031 proxy forwards KGI quote 422/503 as browser-level failures.

## Blockers / owners
- KGI quote upstream availability/support remains Jason/Bruce backend gateway/session owner.
- Frontend can safely normalize known read-only quote failures to a degraded null-data envelope so UI stays honest and console is not polluted.

## Chosen frontend-safe task
Target only final-v031 same-origin proxy behavior for KGI quote `bidask` / `ticks`: convert non-OK upstream responses into HTTP 200 degraded `data:null`, preserving no-store headers and leaving all other proxy paths unchanged.

## Verification target
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- Browser smoke: `/portfolio?symbol=2603` no longer logs console resource errors for KGI quote degraded responses; UI still shows non-trading-hours quote/tape empty state.
