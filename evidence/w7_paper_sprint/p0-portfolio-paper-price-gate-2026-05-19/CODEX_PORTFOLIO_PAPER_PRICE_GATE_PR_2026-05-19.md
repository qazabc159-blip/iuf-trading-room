# Codex P0 Portfolio Paper Price Gate

## Scope
- Route: `/portfolio`
- Surface: Final v031 paper trading room ticket
- P0 class: misleading paper/KGI SIM submit readiness

## Problem
Owner-session production scan showed the ticket could render a ready-looking submit CTA with `@ 0.00` and `0 NTD` estimate when the limit price input was not valid. That makes the trading room look as if a zero-price paper/SIM order can be submitted.

## Fix
- Static ticket preview now computes a readiness gate from quantity, order type, valid price, and owner-session lock state.
- Invalid ticket state renders `紙上單未就緒`, `請輸入有效委託價` / `請輸入有效數量`, and `待輸入 NTD`.
- Submit button is disabled and marked `aria-disabled`/`data-blocked="invalid_ticket"` until input becomes valid.
- Live hydration no longer falls back to the selected quote for invalid limit/stop submits; market orders still require a valid selected quote.
- Unit copy uses `張` / `股` instead of `lot` / `share` in the submit CTA.

## Endpoints
- No backend endpoint changes.
- Existing paper path remains:
  - `POST /api/v1/paper/preview`
  - `POST /api/v1/kgi/sim/order`
  - fallback `POST /api/v1/paper/submit`

## Verification
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web test -- final-v031-paper-ticket.test.ts`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- Local browser smoke: `http://127.0.0.1:3021/portfolio`

## Browser Evidence
- Screenshot: `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_portfolio_price_p0_20260519\evidence\w7_paper_sprint\p0-portfolio-paper-price-gate-2026-05-19\local-portfolio-paper-price-gate.png`
- Browser result JSON: `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_portfolio_price_p0_20260519\evidence\w7_paper_sprint\p0-portfolio-paper-price-gate-2026-05-19\local-browser-result.json`

## Browser Result Summary
- Initial valid state: `送出紙上單 2330 買進 1 張 @ 2240.00`
- After clearing limit price: `紙上單未就緒 請輸入有效委託價`
- Disabled after invalid price: `true`
- Contains `@ 0.00` after invalid price: `false`
