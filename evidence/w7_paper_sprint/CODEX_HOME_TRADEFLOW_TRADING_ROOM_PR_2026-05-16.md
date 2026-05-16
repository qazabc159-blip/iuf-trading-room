# CODEX_HOME_TRADEFLOW_TRADING_ROOM_PR_2026-05-16

## Scope
- Updated homepage trade-flow copy and hrefs after the company-page order panel removal.
- `公司頁預覽` became `交易室預覽`.
- Strategy candidate rows now hand off to `/portfolio?ticker=...&prefill=true&from_strategy=home` instead of a removed company-page `#paper-order` anchor.
- The workflow paper preview card now links to `/portfolio?prefill=true&from_home=paper_preview` and says the risk preview happens in the trading room.

## Intent
- Company pages remain research/coverage surfaces.
- Trading room remains the only order-entry lane.
- Preserve the tactical homepage layout and vendor visual structure; only copy and hrefs were changed.

## Verification
- `git diff --check origin/main..HEAD`
- `pnpm.cmd install --frozen-lockfile --prefer-offline`
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- Static scan:
  - `rg -n "#paper-order|公司頁預覽|可進公司頁|from_home=paper_preview|from_strategy=home|交易室預覽" apps/web/app/page.tsx`
- Local route smoke:
  - started Next dev on `127.0.0.1:3030`
  - `GET /` -> served `/login?next=%2F` because the route is auth-gated in this local session
  - the auth-gated route did not crash
  - content assertion was not claimed from the login response; source/static scan above verifies the copy and href changes
  - stopped the local dev process after smoke

## Safety
- No `apps/api`, broker, risk, contracts, `IUF_QUANT_LAB`, or `IUF_SHARED_CONTRACTS` edits.
- No KGI live broker write.
- No real-order path promotion.
- No default live execution mode.
- No `PAPER_LIVE` promotion.
- No secrets.
