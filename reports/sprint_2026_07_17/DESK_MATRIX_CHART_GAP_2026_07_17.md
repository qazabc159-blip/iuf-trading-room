# /desk-exact 下單矩陣 + 圖表 P0 差異表（2026-07-17，Jim-3）

## 背景

7/15 PR #1281 把正式交易室 route（`/portfolio`）切到 `/desk-exact` 定版引擎時，
`apps/web/public/desk-exact/index.html` 的原稿票面本來就只有 #1252（T-3）之前
的舊狀態：現股 · 整股 · 限價 · ROD 寫死，K 線是一顆自繪 SVG（1分/5分/15分永久
disabled、無支撐壓力、無游標讀出）。楊董 7/17 凌晨親測發現矩陣與圖表雙雙退化。

## 舊能力 vs 現況（本輪修復前）差異表

| 能力 | #1252（T-3，PR be8a8601，正式交易室舊 route） | #1281 切版後（本輪修復前的 desk-exact） | 本輪修復後（desk-exact） |
|---|---|---|---|
| 交易類別（session） | 整股/盤中零股/盤後零股/盤後定價 4 鍵，真控件 | 無控件，寫死 `regular` | 恢復：4 鍵真控件（`t-session`/`m2t-session`），desktop+mobile |
| 委託種類（orderCond） | 現股/融資/融券/當沖 4 鍵，真控件 | 無控件，寫死 `cash` | 恢復：4 鍵真控件（`t-cond`/`m2t-cond`） |
| 委託類型（otype） | 限價/市價 select | 只有「限價」一個 option | 恢復：`<select>` 含 limit/market |
| 委託效期（TIF） | ROD/IOC/FOK 3 鍵，真控件 | 無控件，寫死 `rod` | 恢復：3 鍵真控件（`t-tif`/`m2t-tif`） |
| 非法組合灰化 | `applyMatrixGating()` 等值邏輯，鏡射 order-rules.ts §4.1/§4.2/§4.5 | N/A（無控件可灰化） | 恢復：口徑對齊 order-rules.ts，desktop+mobile 共用同一份 `wireTicket()` 邏輯 |
| 送出 payload | orderCond/session/timeInForce/type 皆帶真值 | 四個欄位全部寫死常數 | 恢復：四個欄位讀 UI 真實選取值 |
| K 線週期切換 | （#1252 未動圖表，沿用更早的自繪 SVG：日/週，1分/5分/15分 disabled） | 同左：日/週，1分/5分/15分 disabled；MACD 副圖手機版直接不顯示 | **超越舊版**：改 iframe 內嵌公司頁 `OhlcvCandlestickChart.tsx` 引擎——日K/週K/月K + 1分/5分/15分/60分（FinMind Sponsor 分K）全部真資料可切 |
| crosshair / 游標讀出 | 無 | 無 | 新增：`kline-readout-ribbon`（hover 顯示該根 K 棒 OHLC） |
| 支撐/壓力 | 無 | 無 | 新增：量價支撐/壓力可開關（`_ind-level-readout`），desktop+mobile |
| 422 guard 訊息 | 一行摘要（`未通過：<guard label>`） | 同左（矩陣缺失不影響這段既有邏輯） | 加強：摘要行加 `.err`（紅字加粗）視覺樣式＋完整 `riskCheck.guards[]` 同步灌回風控預覽面板（`renderRiskGuards`），不只一行文字 |

## 本輪修復手法

1. **矩陣（desktop 部分承接自本 branch 既有未 commit 工作）**：desktop 票面的
   `t-session`/`t-cond`/`t-otype`/`t-tif` HTML 控件在本輪開工時已存在於 worktree
   （前一個 Jim-3 實例額度牆前留下），但完全沒有 JS 事件綁定與 payload 讀值——
   `apps/web/public/desk-exact/index.html` 的 `wireTicket()` 仍讀寫死常數。本輪
   從 `git show be8a8601`（#1252 原始 PR，正式交易室舊 route 的實作）逐段移植
   `applyMatrixGating()`/`computeMatrixViolations()` 等值邏輯（改寫成
   `data-slot` selector 版本，適配本頁 desktop+mobile 共用同一個 `wireTicket
   (scopePrefix)` controller 的既有架構），**沒有重寫已打磨元件**，只是把舊
   PR 的邏輯搬進新架構。
2. **矩陣（mobile 部分，全新補齊）**：mobile 票面（`m2t-*`）先前完全沒有這四
   組控件（只有既有 CSS 類別 `.lotsw.four`/`.lotsw.three`/`.m2-lotrow.slim`
   已預先準備但未使用）——本輪補上對應 HTML，沿用同一份 `wireTicket()`
   controller，desktop/mobile 邏輯零分岔。
3. **圖表**：desktop 部分（iframe 內嵌 `/final-v031/portfolio/kline-frame`）
   同樣是本輪開工時 worktree 既有未 commit 工作；mobile 部分（`.m2-chart`）
   在本輪開工時仍是舊的自繪 SVG（1分/5分 permanently disabled）——本輪補齊
   mobile 端同樣改走 iframe 引擎。兩端苗頭一致後，原本支撐 SVG 自繪的整段
   JS（`fetchOhlcvBars`/`computeSMA`/`computeEMA`/`computeMacd`/
   `buildCandleSvg`/`buildMacdSvg`/`paintChart`/`renderChart`/
   `wireChartToolbar`，約 230 行）已無任何 DOM 掛載點，一併移除（Karpathy
   guideline #3：因自己的改動而成為死碼的部分要清）。新增 `updateChartFrame
   (symbol)` 取代，讓切換自選標的時兩顆 iframe 的 `src` 同步更新。

## 後端依賴狀態

未發現後端缺口。`POST /api/v1/trading/orders` 的 `orderCreateInputSchema`
（`packages/contracts/src/broker.ts`）與 `apps/api/src/broker/order-rules.ts`
§4 驗證規則已完整支援本次矩陣四個維度（session/orderCond/type/timeInForce）；
`apps/api/src/broker/paper-broker.ts` 的 `placePaperOrder()` 已呼叫
`validateOrderTypeMatrix()` 並回傳 `order.status==="rejected"` + `reason`
code。K 線引擎重用的 `/final-v031/portfolio/kline-frame` route（`apps/web/app/
final-v031/portfolio/kline-frame/page.tsx`）與 `OhlcvCandlestickChart.tsx`
元件也已存在，無需改後端或 contracts。

## 驗收對照（逐項打勾，見 PR body）

- [x] 票面完整矩陣控件可切換，選項真送進 order payload
      （`jim_desk_order_matrix_chart_20260717.spec.ts` 攔截 POST body 斷言）
- [x] 圖表分K/日/週/月切換活、crosshair readout、支撐/壓力可開關
      （同 spec + `jim_desk_exact_preview_20260714.spec.ts` 改寫的圖表測試）
- [x] 422 guard 訊息在 UI 顯著顯示（含「交易時段」人話 + `.err` 樣式）
- [x] CI（typecheck/build 本機已綠；Playwright 本機 desktop-chromium 全綠，
      1 個既有已知 flake 自 retry 復原，非本輪回歸）
