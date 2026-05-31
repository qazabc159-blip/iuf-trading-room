# F-AUTO SIM 前端顯示 Gap Plan
**盤點日期**: 2026-05-30  
**盤點人**: Jim (frontend-consume)  
**狀態**: 唯讀盤點 — apps/web 尚未動

---

## 背景

北極星 F-AUTO 10M SIM auto-trade 已在後端全部 wired：
- S1 SIM pipeline: signal(Monday 08:30) + orders(09:00) + EOD(daily 14:00)
- KGI SIM 帳戶 proxy endpoints (positions/orders/balance/status) 全已存在
- 前端 `/portfolio` 路由走 PTR iframe，已有部分 consume，但有具體 gap

---

## 一、現況盤點：前端已有哪些

### 1. PTR iframe — `/portfolio` + `/final-v031/portfolio`

**入口**: `apps/web/app/portfolio/page.tsx` → `FinalOnlyFrame` iframe  
**資料來源**: `apps/web/lib/final-v031-live.ts` (client-side hydration JS)

已 consume 的 API：
- `GET /api/v1/paper/health` → `getPaperHealth()`
- `GET /api/v1/paper/portfolio` → `getPaperPortfolioRaw()` (paper-broker in-memory positions)
- `GET /api/v1/paper/fills` → `listPaperFills()`
- `GET /api/v1/paper/orders` → `listPaperOrders()`
- `GET /api/v1/portfolio/kgi/positions` → `getKgiPositions()` (KGI live positions)
- `GET /api/v1/strategy/ideas?decisionMode=paper` → S1 signal ideas (indirect)

**顯示內容**：
- paper-broker positions 倉位表
- KGI 位置 badge (`live.kgi?.positions?.length`)
- 成交事件 (fills/orders table)
- 策略候選 watchlist (wl-sig)

**問題**：
- PTR iframe 是 vendor HTML 注入，`kgi` 資料只用來更新一個 badge count，**沒有展示完整 SIM 部位明細**
- `GET /api/v1/paper/portfolio` 走的是 paper-broker in-memory，**不是 KGI SIM 重建倉位**
- KGI SIM fund/balance 完全未 consume

### 2. `apps/web/lib/paper-orders-api.ts`

已有：
- `getKgiPositions()` → `GET /api/v1/portfolio/kgi/positions`
- `submitKgiSimOrder()` → `POST /api/v1/kgi/sim/order`
- `getPaperHealth()` → `GET /api/v1/paper/health`
- `getPaperPortfolioRaw()` → `GET /api/v1/paper/portfolio`
- `listPaperFills()`, `listPaperOrders()`

未有：
- `GET /api/v1/paper/positions?source=sim` (KGI SIM reconstructed positions)
- `GET /api/v1/paper/funds?source=sim` (KGI SIM reconstructed balance)
- `GET /api/v1/kgi/sim/positions` (raw KGI SIM positions — Owner only)
- `GET /api/v1/kgi/sim/orders` (KGI SIM trades — Owner only)
- `GET /api/v1/kgi/sim/balance` (derived balance — Owner only)
- `GET /api/v1/kgi/status` (KGI connection state, sim smoke results)
- `GET /api/v1/internal/kgi/sim/daily-smoke-status` (7-day smoke history)

### 3. S1 SIM 報告 — 完全未接

S1 pipeline 在後端每日寫 JSON 到 `runtime-data/trading_room/`:
- `s1_sim_basket/{date}.json` — 每週一訊號 basket
- `s1_sim_daily/{date}_orders.json` — 委託結果
- `s1_sim_daily/{date}.json` — EOD 報告 (JSON)
- `s1_sim_daily/{date}.md` — EOD 報告 (Markdown)

**後端無 REST endpoint** 可讓前端讀這些 file-based 報告。  
前端完全沒有 S1 SIM 狀態/報告入口。

### 4. KGI 連線狀態 — 部分有、未完整顯示

`GET /api/v1/kgi/status` 存在，回傳 `quote_connected`, `trade_connected`, `last_sim_order_status` 等。  
前端 `apps/web/lib/api.ts` 只有 `getKgiQuoteStatus()` → `GET /api/v1/kgi/quote/status`（報價層），**沒有 consume `GET /api/v1/kgi/status`（整體 SIM 連線狀態）**。  
Homepage 只顯示 `BrokerAccessDashboard`，不顯示 SIM 連線細節。

---

## 二、Gap 清單

| # | Gap | 後端 API | 前端現況 | 影響 |
|---|-----|---------|---------|------|
| G1 | KGI SIM 重建倉位未顯示 | `GET /api/v1/paper/positions?source=sim` | 未 consume | 看不到 SIM 已建倉部位 |
| G2 | KGI SIM 餘額/資金未顯示 | `GET /api/v1/paper/funds?source=sim` | 未 consume | 看不到 SIM 帳戶資金狀態 |
| G3 | KGI SIM raw positions/orders/balance 未接 | `GET /api/v1/kgi/sim/positions`, `/orders`, `/balance` | 未 consume | Owner 層無法看原始 KGI 回傳 |
| G4 | S1 SIM basket 無 frontend 入口 | 無 REST endpoint（file only） | 無 | 看不到每週訊號 basket |
| G5 | S1 EOD report 無 frontend 入口 | 無 REST endpoint（file only） | 無 | 看不到每日 EOD P&L 報告 |
| G6 | KGI SIM 連線狀態 (`trade_connected`) 未顯示 | `GET /api/v1/kgi/status` | 未 consume | 無法知道 SIM 登入是否通 |
| G7 | Daily smoke 7-day history 未顯示 | `GET /api/v1/internal/kgi/sim/daily-smoke-status` | 未 consume | 無法確認 SIM 每日健診 |
| G8 | PTR kgi panel 只顯示 badge count，未顯示倉位明細 | `GET /api/v1/portfolio/kgi/positions` | 有 consume，未渲染 | KGI 倉位明細不可見 |

---

## 三、後端還需要什麼（Jim 不能自己補）

**G4/G5 是最大 blocker**：S1 basket/EOD report 只寫到 disk，沒有 REST endpoint。  
前端無法直接讀 Railway volume 上的 JSON 檔案。

需要 Jason 補：
1. `GET /api/v1/internal/s1-sim/status` — 返回 `{ lastSignalDate, lastOrderDate, lastEodDate, regime, basketSymbols[], ordersAccepted, ordersRejected }`（從 disk 讀最近一筆）
2. `GET /api/v1/internal/s1-sim/eod-report?date=YYYY-MM-DD` — 返回當日 EOD JSON（`S1EodReport` schema 已有）
3. `GET /api/v1/internal/s1-sim/basket?date=YYYY-MM-DD` — 返回當日 basket JSON（`S1Basket` schema 已有）

以上都是唯讀 disk-read，Owner-only，估 Jason 1-2h 可做。

---

## 四、實作 Plan（等 apps/web Codex lane 釋出後執行）

### Phase 1 — KGI SIM 連線 + 帳戶現況（G1-G3, G6, G8）
**估工**: 0.5 天  
**前提**: 無（後端 API 已存在）

**Step 1.1 — `paper-orders-api.ts` 補 client helpers**
- `getSimPositions()` → `GET /api/v1/paper/positions?source=sim`
- `getSimFunds()` → `GET /api/v1/paper/funds?source=sim`  
- `getKgiSimStatus()` → `GET /api/v1/kgi/status`

**Step 1.2 — PTR kgi panel 渲染倉位明細 (G8)**
- 檔案: `apps/web/lib/final-v031-live.ts`
- 在 `buildPaperPayload()` 改 `GET /api/v1/paper/positions?source=sim` 代替 paper-broker portfolio
- 在 `hydratePaperLive()` 補倉位 table 渲染（各 symbol, shares, avgCost, unrealizedPnl）

**Step 1.3 — KGI SIM 連線狀態 banner**
- 新增 `SimStatusBanner` client component
- 位置: `/portfolio` 頁面頂部（PTR iframe 外，非 iframe 內）
- 顯示: `trade_connected: true/false`, `last_sim_order_status`, `fetchedAt`
- 若 `trade_connected=false` 顯示 amber warning banner

**檔案清單**:
- `apps/web/lib/paper-orders-api.ts` (+3 functions)
- `apps/web/lib/final-v031-live.ts` (修 source + hydration)
- `apps/web/app/portfolio/SimStatusBanner.tsx` (new)
- `apps/web/app/portfolio/page.tsx` (+import SimStatusBanner)

---

### Phase 2 — S1 SIM 報告頁 (G4, G5)
**估工**: 1 天  
**前提**: Jason 先補 3 個 `/api/v1/internal/s1-sim/*` endpoints

**Step 2.1 — `lib/api.ts` 補 S1 SIM helper functions**
- `getS1SimStatus()` → `GET /api/v1/internal/s1-sim/status`
- `getS1SimEodReport(date)` → `GET /api/v1/internal/s1-sim/eod-report?date=`
- `getS1SimBasket(date)` → `GET /api/v1/internal/s1-sim/basket?date=`

**Step 2.2 — `/admin/s1-sim` 頁面 (Owner only)**
- 路徑: `apps/web/app/admin/s1-sim/page.tsx`
- 顯示區塊:
  - Status card: regime / lastSignalDate / ordersAccepted / ordersRejected
  - Basket table: top-8 symbols, score_cont_liq, shares, target_notional_twd, sizing_note
  - EOD report table: symbol / shares / avg_cost / last_price / unrealized_pnl_twd
  - Summary: total_unrealized_pnl_twd / total_market_value_twd / cash_residual
  - Notes 欄位 (failsafe_notes + data_source)
- 日期 selector: 今日 / 昨日 / D-2 (3 buttons)
- Owner-only gate: `apiGetMe()` role check pattern (同 AiAnalystReportPanel)

**Step 2.3 — Sidebar 加 admin 入口**
- 檔案: `apps/web/components/Sidebar.tsx`
- 在 admin section 加 "S1 SIM" nav item

**檔案清單**:
- `apps/web/lib/api.ts` (+3 functions under `// ── S1 SIM Pipeline ──`)
- `apps/web/app/admin/s1-sim/page.tsx` (new)
- `apps/web/components/Sidebar.tsx` (+1 nav item)

---

### Phase 3 — Daily Smoke History (G7)
**估工**: 0.25 天  
**前提**: 無（endpoint 已存在）

**Step 3.1 — `/admin/s1-sim/page.tsx` 補 smoke history section**
- 在 Phase 2 頁面下方加一個 panel
- `GET /api/v1/internal/kgi/sim/daily-smoke-status` → 7-day ring buffer
- 顯示: date / status / lastProdBrokerAuditCount / pass/fail badge

---

## 五、優先順序建議

| 優先 | Phase | 前提 | 給楊董的價值 |
|------|-------|------|------------|
| P0 | Phase 1 Step 1.3 (SimStatusBanner) | 無 | 立刻知道 SIM 是否登入通 |
| P0 | Phase 1 Step 1.2 (PTR kgi positions) | 無 | PTR 顯示真實 KGI SIM 倉位 |
| P1 | Phase 2 (S1 SIM admin page) | Jason 補 3 endpoints | 可看 basket + EOD report |
| P2 | Phase 3 (smoke history) | 無 | audit trail |

---

## 六、估工總覽

| Phase | 估工 | 前提 |
|-------|------|------|
| Phase 1 (G1/G2/G3/G6/G8) | 0.5 天 | 無 |
| Phase 2 (G4/G5) | 1 天 | Jason 補 endpoints (1-2h) |
| Phase 3 (G7) | 0.25 天 | 無 |
| **合計** | **1.75 天** | Jason 0.5 天 |

---

## 七、Jason 所需的後端補項（Jim escalation）

後端 **缺 3 個 endpoint**，前端無法呈現 S1 EOD 報告：

```
GET /api/v1/internal/s1-sim/status
  → 讀最近一筆 basket + order submit JSON
  → 返回: { lastSignalDate, lastOrderDate, lastEodDate, regime, exposureWeight,
             basketSymbols, ordersAttempted, ordersAccepted, failsafeNotes }

GET /api/v1/internal/s1-sim/eod-report?date=YYYY-MM-DD
  → 讀 runtime-data/trading_room/s1_sim_daily/{date}.json
  → 返回: S1EodReport schema (已定義在 s1-sim-runner.ts)
  → 404 if file not found

GET /api/v1/internal/s1-sim/basket?date=YYYY-MM-DD
  → 讀 runtime-data/trading_room/s1_sim_basket/{date}.json
  → 返回: S1Basket schema (已定義在 s1-sim-runner.ts)
  → 404 if file not found
```

Owner-only。無 DB migration。估 Jason 1-2h。

---

*盤點: Jim 2026-05-30 / 唯讀，不改 apps/web code*
