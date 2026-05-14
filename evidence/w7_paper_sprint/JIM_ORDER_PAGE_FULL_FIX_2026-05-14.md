# JIM — Order Page Full Fix 2026-05-14

## 4-State Audit (before fix)

### Surface 1: /companies/[symbol]
| Component | State Before | Root Cause |
|---|---|---|
| CompanyHeroBar | live_real_data | already wired (PR #442) |
| OhlcvCandlestickChart | live_real_data | has error fallback |
| BidAskPanel | live_real_data / blocked | KGI gateway dependent |
| LiveTickStreamPanel | live_real_data / blocked | KGI gateway dependent |
| InstitutionalPanel | live_real_data | FinMind wired |
| MarginShortPanel | live_real_data | FinMind wired |
| FinancialsPanel | live_real_data | PR #455 fixed |
| FullProfilePanels | live_real_data | PR #455 fixed |
| PaperOrderPanel — preview | live_real_data | API wired |
| PaperOrderPanel — SUBMIT | blank_or_error | COMPANY_PAGE_PAPER_SUBMIT_ENABLED=false |

### Surface 2: /paper-trading-room (PTR iframe)
| Component | State Before | Root Cause |
|---|---|---|
| K-line | live_real_data | drawChart wired (PR #438) |
| Orderbook (#depth) | stale_but_visible (fake 962.xx) | no empty-state fallback when bidAsk null |
| Tape (recent ticks) | stale_but_visible (fake 13:24 rows) | no empty-state fallback |
| Price header (.symhead) | live_real_data | hydration wires selected symbol |
| OHLC legend | stale_but_visible (fake 956/965/954/962) | hardcoded in HTML, only updates when ohlcvLast present |
| Price input (#t-price) | stale_but_visible (962.00 default) | hardcoded input value |
| Submit button label | stale_but_visible (2330 買進 1 張 @ 962.00) | hardcoded |
| Preview block numbers | blank_or_error (962,000 / 1,371 / etc.) | hardcoded fake numbers |
| Risk gate display | blank_or_error (fake 1.92% / 87% etc.) | hardcoded fake checks |
| Orders table | live_real_data | PR #444 wired |
| Fills table | live_real_data | PR #444 wired |
| Positions table | live_real_data | hydration wired |
| Submit → API POST | loading_stuck | vendor script only did UI animation, hydration handler wired in PR #438 |

### Surface 3: /portfolio
| Component | State Before |
|---|---|
| Full PTR iframe | live_real_data — same as /paper-trading-room |
| Holdings/positions table | live_real_data |

## Fixes Applied

### PaperOrderPanel.tsx
- `COMPANY_PAGE_PAPER_SUBMIT_ENABLED = true` — enables direct submit to `/api/v1/paper/submit`
- No dual-confirm gating added; existing CompanyOrderReviewModal already built; submit flow: preview → review modal → confirm → POST

### paper_trading_room/index.html
- `#depth` — replaced 11 hardcoded fake orderbook rows with single "五檔資料同步中…" placeholder
- `#tape` — replaced 9 hardcoded fake tick rows with "逐筆資料同步中…" placeholder
- `#ohlc-o/h/l/c` — reset from 956/965/954/962 to "—"
- `#t-price` — reset from `value="962.00"` to `value="" placeholder="自動填入"`
- `#submit-btn-label` — id added to `<b>` tag; reset label to "選擇股票與方向"
- Preview block (p-notional/p-fee/p-avail/p-after-avail/p-after-pos/p-after-avg) — reset all to "—"
- Risk gate list — replaced hardcoded fake checks with honest "送出後由後端風控閘門即時判斷"
- `.symhead .price .v / .d` — reset from 962.00 / ▲ +8.00 to "—" / "可用資料"
- `.symhead .stats` — reset open/high/low/prev/vol from hardcoded to "—"

### final-v031-live.ts
- `depth` handling: added else branch — when `live.bidAsk` is null, renders "五檔：等待 KGI 連線" empty-state
- OHLC legend: always update ohlc-o/h/l/c (removed `if (ohlcvLast)` guard); falls back to selected.open/high/low/price, then "—"
- Submit handler: `submit.querySelector("b")` → dynamic `getSubmitLabel()` to survive vendor JS innerHTML rebuild
- Submit success: replaces `setTimeout(() => location.reload(), 900)` with `refreshClientLive()` — updates orders/fills/positions without full page reload

## Files Changed
- `apps/web/app/companies/[symbol]/PaperOrderPanel.tsx`
- `apps/web/public/ui-final-v031/paper_trading_room/index.html`
- `apps/web/lib/final-v031-live.ts`

## CI Results
- typecheck: EXIT 0
- build: 3/3 green (Tasks: 3 successful, 3 total)
