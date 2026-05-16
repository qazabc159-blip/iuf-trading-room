# CODEX_REVIEWS_TRADING_ROOM_BOUNDARY_PR_2026-05-16

## Scope
- Updated `/reviews` read-only boundary copy.
- Removed the stale statement that paper preview/submit lives on the individual stock page.
- New copy points simulation preview, risk review, and order submit back to the trading room.

## Intent
- Company pages are research/coverage surfaces after #557 removed the dead company order panel.
- Trading room remains the only order-entry lane.
- `/reviews` remains read-only.

## Verification
- `git diff --check origin/main..HEAD`
- `pnpm.cmd install --frozen-lockfile --prefer-offline`
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- Static scan:
  - `rg -n "個股頁|模擬預覽、風控核對與委託送出集中在交易室" apps/web/app/reviews/page.tsx`
- Local route smoke:
  - started Next dev on `127.0.0.1:3029`
  - `GET /reviews` -> served `/login?next=%2Freviews` because the route is auth-gated in this local session
  - the auth-gated route did not crash
  - content assertion was not claimed from the login response; source/static scan above verifies the copy change
  - stopped the local dev process after smoke

## Safety
- No `apps/api`, broker, risk, contracts, `IUF_QUANT_LAB`, or `IUF_SHARED_CONTRACTS` edits.
- No KGI live broker write.
- No real-order path promotion.
- No default live execution mode.
- No `PAPER_LIVE` promotion.
- No secrets.
