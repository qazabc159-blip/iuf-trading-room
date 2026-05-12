# cont_liq v36 Forward Observation Period 1 Panel — Integration Evidence v1

**Date**: 2026-05-12
**Branch**: feat/web-cont-liq-period1-panel-2026-05-12
**Author**: Jim (frontend-consume-jim)

---

## 1. Panel Route

URL: `/lab/three-strategy/cont_liq_v36`

Next.js static segment — takes priority over `[strategyId]` dynamic route.
Route file: `apps/web/app/lab/three-strategy/cont_liq_v36/page.tsx`

## 2. Panel Name

「持續流動性強勢策略 — Forward Observation Period 1」

## 3. Holdings (Athena Day-0 鎖倉 2026-05-06)

| Ticker | Fallback Name | Entry Source |
|--------|---------------|-------------|
| 3707   | 漢磊          | FinMind OHLCV 5/6 close (server-side) |
| 2426   | 飛弘          | FinMind OHLCV 5/6 close (server-side) |
| 6205   | 詮欣          | FinMind OHLCV 5/6 close (server-side) |
| 2486   | 一詮          | FinMind OHLCV 5/6 close (server-side) |

## 4. Data Sources

| Data | Source | Fetch Pattern |
|------|--------|---------------|
| entry_price | FinMind OHLCV via `/api/v1/companies/:id/ohlcv?from=2026-05-06&to=2026-05-06&interval=1d` | Server-side `resolveHolding()` |
| company name | `/api/v1/companies` list-scan via `getCompanyByTicker()` | Server-side |
| latest_price | KGI EC2 gateway `/api/v1/kgi/quote/ticks?symbol=<T>&limit=1` | Client-side 30s poll |
| 0050 benchmark | Same OHLCV (entry) + KGI ticks (latest) | Server + client |

## 5. Panel Sections

### Section 1: Day-0 Anchor Hero
- `2026-05-06` in 32px amber bold
- Eyebrow: "DAY-0 ANCHOR DATE — Athena 5/6 鎖倉"
- Sub: strategy name, entry date, expected exit, equal-weight count

### Section 2: Forward Observation Progress
- `approxTradingDays(DAY0, today)` — approximate Taiwan trading days elapsed
- Progress bar (visual) — fills proportional to H20 target
- Meta: start / today / expected exit dates

### Section 3: Basket KPI Hero (4 cells)
- Basket unrealized return (4-stock equal-weight average)
- Equal-weight P&L trial (TWD, assuming 10,000 TWD / holding — research illustration only)
- 0050 same-period return (5/6 OHLCV close → KGI latest)
- Excess vs 0050 (basket − benchmark)

### Section 4: Per-holding Table (4 rows)
- stock_id (ticker)
- stock_name (from company lookup or fallback)
- entry_date (Day-0 = 2026-05-06)
- entry_price (OHLCV 5/6 close; "--" if unavailable — honest about data gaps)
- latest_price (KGI ticks last close)
- unrealized_return (%)
- unrealized_pnl_twd (equal-weight trial amount)
- latest_quote_time (from KGI tick datetime)
- Quote state badge: 即時 / 盤後 / BLOCKED / 載入中

### Section 5: Status Banner (ALWAYS SHOWN — cannot be removed)
"研究前向觀察期間（Research Forward Observation） — 無真實下單，無生產環境執行。
結果在 H20 觀察期結束前不算成熟（pending H20 maturation）。
非交易建議。非已驗證策略。不適合跟單。"

## 6. Forbidden Wording Check

```
grep -E "approved|alpha confirmed|live-ready|實單策略|已驗證|可以跟單|保證獲利" \
  apps/web/app/lab/three-strategy/cont_liq_v36/ContLiqPeriod1Panel.tsx \
  apps/web/app/lab/three-strategy/cont_liq_v36/page.tsx
```

Result: 0 matches (clean)

## 7. Hard Rules Compliance

| Rule | Status |
|------|--------|
| entry_price not fake | PASS — null if OHLCV unavailable, never hardcoded |
| latest_price from KGI | PASS — 30s poll, stale flagged post-market |
| status banner always shown | PASS — rendered before all other content, no conditional |
| forbidden wording absent | PASS — grep clean |
| broker/risk/migration untouched | PASS — only new files created |
| globals.css untouched | PASS |

## 8. Files Changed

**New files (2):**
- `apps/web/app/lab/three-strategy/cont_liq_v36/page.tsx` — server component, resolves OHLCV entry prices + company names, renders panel
- `apps/web/app/lab/three-strategy/cont_liq_v36/ContLiqPeriod1Panel.tsx` — client component, 30s KGI poll, all UI sections

**New files (evidence + reports):**
- `reports/trading_room/cont_liq_period1_panel_integration_evidence_v1.md` — this file

**No files modified.**

## 9. Typecheck

```
pnpm tsc --noEmit → EXIT 0 (0 errors, 0 new errors introduced)
```

## 10. Assumptions

- 2026-05-06 is a Taiwan trading day (Tuesday — confirmed: not a public holiday)
- OHLCV may return stale/empty if FinMind backfill hasn't reached 5/6 yet — handled gracefully (null entry price shown as "--")
- KGI quote for 3707/2426/6205/2486 may not be subscribed — handled as "盤後" or "BLOCKED" state
- `approxTradingDays` uses Mon-Fri calendar approximation (no TW holiday exclusion) — close enough for H20 progress display
- 0050 company lookup via `getCompanyByTicker("0050")` — may return null if 0050 is not in the companies table; benchmark then shows "--"
