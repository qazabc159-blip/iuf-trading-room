# CODEX_QUANT_SUBSCRIBE_LANE_2026-05-15

## Scope
- Frontend owner lane: `apps/web`.
- Normalized `/quant-strategies/[strategyId]` subscription action after Jason #525.
- Goal: create SIM-only strategy subscription records through the backend subscribe contract, not direct per-stock KGI SIM order submission.

## Changes
- Added same-origin web proxy:
  - `POST /api/quant-strategies/:strategyId/subscribe`
  - `GET /api/quant-strategies/:strategyId/subscriptions/my`
- Updated strategy detail subscribe panel:
  - removed `submitKgiSimOrder()` usage from quant strategy detail
  - posts `{ capital_twd, executionMode: "paper" }` to the same-origin subscribe proxy
  - keeps UI copy honest: SIM-only strategy subscription, no direct individual-stock order
- Updated "我的訂閱" panel:
  - reads through same-origin proxy instead of browser-direct `NEXT_PUBLIC_API_BASE_URL`
  - keeps owner-session cookie/CORS behavior aligned with other web proxy routes

## Verification
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` => PASS
- `git diff --check` => PASS
- Safety scan over touched quant strategy files:
  - no `submitKgiSimOrder`
  - no `/api/v1/kgi/sim/order`
  - no `/api/v1/paper/submit`
  - no `PAPER_LIVE`
  - no `executionMode: "live"`
  - no secret/token patterns
- Browser smoke with local fake #525 backend:
  - detail page POSTed to `/api/quant-strategies/cont_liq_v36/subscribe`
  - web proxy forwarded upstream body as `{"capital_twd":100000,"executionMode":"paper","sim_only":true}`
  - subscribe response status `201`
  - subscriptions tab loaded `/api/quant-strategies/cont_liq_v36/subscriptions/my`
  - no request to KGI SIM order endpoint or paper submit endpoint
  - browser console errors: 0

## Screenshot
- `evidence/w7_paper_sprint/CODEX_QUANT_SUBSCRIBE_LANE_2026-05-15.png`

## Remaining QA
- Bruce/Elva should still run production owner-session QA after merge/deploy because the real backend is auth-gated and local smoke used a synthetic local session cookie only to pass frontend middleware.
