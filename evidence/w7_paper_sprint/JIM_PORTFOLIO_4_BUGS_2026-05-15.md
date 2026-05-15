# Jim Portfolio 4 Bugs Fix — 2026-05-15

Engineer: Jim (frontend-consume)
Branch: fix/web-portfolio-4-bugs-2026-05-15
Triggered by: BRUCE_PORTFOLIO_DEEP_AUDIT_2026-05-15_1200TST.md

---

## Bugs Fixed

### P1-1: Watchlist hydration blank (FIXED)
- File: `apps/web/lib/final-v031-live.ts`
- Location: `hydratePaper()` watchlist section (was line 930-931)
- Fix: guard `if (wlItems.length === 0)` — keeps SSR static 5 rows, only updates group label text to "ideas pool 整備中，預設展示熱門 5 檔"; live rows only rendered when `wlItems.length > 0`
- Re-attaches `.wrow` click listeners in both branches

### P1-2: K-line timeframe buttons re-fetch (FIXED)
- File: `apps/web/public/ui-final-v031/paper_trading_room/index.html`
- Location: `/* ---------- timeframe ---------- */` script block
- Fix: button click now async-fetches `/api/v1/companies/:id/ohlcv?interval=<tf>` and calls `drawChart()` with fresh bars
- Uses `window.__IUF_FINAL_V031_LIVE__._companyId` (cached from hydration) to avoid re-calling the 1.84MB companies endpoint
- Fallback: if `_companyId` not cached, fetches companies once and caches result
- Added `_companyId` field to `clientPaperPayload()` return in `final-v031-live.ts`

### P1-3: Off-hours orderbook wording (FIXED)
- File: `apps/web/lib/final-v031-live.ts`
- Location: `hydratePaper()` depth section
- Fix: changed "五檔：等待 KGI 連線" → "目前為非交易時段，盤口暫不更新（次日 09:00 重新連線）"

### P2: Mobile viewport (FIXED)
- File: `apps/web/public/ui-final-v031/paper_trading_room/index.html`
- Fixes:
  1. `<meta name="viewport" content="width=1440" />` → `content="width=device-width, initial-scale=1"`
  2. Added `<style>@media (max-width:767px){...}</style>` with mobile-first stacking layout:
     - `.troom` flex column, `.lpane/.rpane` full width
     - chart height 220px, tape single column, font/button size adjustments
     - safety bar wrapping, top bar wrapping

---

## Files Changed
- `apps/web/lib/final-v031-live.ts` — P1-1 watchlist fallback + P1-3 off-hours wording + _companyId field
- `apps/web/public/ui-final-v031/paper_trading_room/index.html` — P1-2 timeframe re-fetch + P2 viewport + mobile CSS

## typecheck
EXIT 0 (`npx tsc --project apps/web/tsconfig.json --noEmit`)

## Not Fixed (escalate to Jason)
- P0-1: companies API 1.84MB / 2.07s on every PTR load (needs backend lightweight endpoint)
- P0-2: kgi/positions 3.35s timeout blocks Promise.all (needs AbortController on backend call)
- P1-3 price field "−" off-hours: timing issue (lastBar.close fills after hydration — acceptable)
