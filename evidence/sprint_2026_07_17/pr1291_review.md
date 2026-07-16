# PR #1291 Desk Review — Pete 2026-07-17

## 1. PR Intent
- 恢復 #1281 切版蓋掉的 #1252 T-3 下單能力矩陣（session×orderCond×otype×TIF 真控件＋灰化）＋圖表改回 iframe 內嵌公司頁真引擎；422 guard 顯著化。
- 對應：楊董 7/17 凌晨親測退件（P0）。
- Base branch：main（merge-base f9368ea；main 領先 2 個 docs-only commit，不觸碰 index.html/order-rules.ts，不構成衝突）。

## 2. Diff Summary
- 改 2 檔（apps/web/public/desk-exact/index.html, packages/qa-playwright/tests/jim_desk_exact_preview_20260714.spec.ts）＋新增 2 檔（新 spec、gap report）。
- 主要改動：desktop+mobile 下單票新增 4 組矩陣控件（session/orderCond/otype/TIF）與 `applyMatrixGating()`/`matrixViolation()`；兩處 K 線自繪 SVG（~230 行死碼）整段移除，改 iframe 內嵌既有 `/final-v031/portfolio/kline-frame`；422 訊息加 `.err` 樣式＋完整 guards 面板重繪。
- LOC：+714 / −360（index.html 本體 +324/−335）。

## 3. IUF Blocker Checklist
- A（kill-switch/real-order）：PASS — 後端完全未動；下單仍走既有 `POST /api/v1/trading/orders`（統一下單流），無 KGI `/order/create`、無 kill-switch/EXECUTION_MODE 字樣。
- B（Auth/secret）：PASS — 無新 endpoint；iframe 走同源相對路徑 `/final-v031/portfolio/kline-frame`，該 route 是既有 server component，走既有 session cookie，未登入時已有 friendly empty state（非本 PR 觸碰）。
- C（State/schema）：N/A — 無 DB/contracts/schema 變更；核對 `orderCond`(cash/margin/short/daytrade)、`orderSession`(regular/intraday_odd/afterhours_odd/afterhours_fixed)、`timeInForce` 枚舉與前端 data-attribute 值逐一比對一致。
- D（PR hygiene）：PASS — DRAFT 起手、branch 命名符合、commit message 完整說明 gap 分析與移植手法，body 附測試計畫與已知 gap（CI/coordinator 驗證未跑，誠實標為 unchecked）。
- E（越線）：PASS — 純前端 markup+JS+測試+報告，未動 packages/apps/api 任何後端邏輯；order-rules.ts 只被讀取比對，未修改。

## 4. Findings — Priority Ranked

### 🔴 Blockers
無。

### 🟡 Suggestions
1. **矩陣正確性交叉驗證（逐格核對，結論：正確）**：`applyMatrixGating()` 的三條規則與 `apps/api/src/broker/order-rules.ts` 逐條比對零分岔——
   - session→orderCond（§4.5，`order-rules.ts:170-181`）：`isOdd = session !== "regular"` 對應前端 `index.html` 內 `applyMatrixGating()` 的 cond 灰化條件，涵蓋全部 3 個非 regular session，未漏。
   - 市價 TIF（§4.1，`order-rules.ts:96-105`）與零股 session×TIF（§4.2，`order-rules.ts:111-133`）的交集邏輯（`isAfterhoursFixedTif` 只含 afterhours_odd/afterhours_fixed，不含 intraday_odd）正確推導出「盤後零股/定價下市價選項本身不合法」，intraday_odd+market 的合法交集 {ioc,fok} 也算對。
   - 唯一未做前端預防性灰化的是 §4.3（tick）/§4.4（漲跌停）/§4.6（數量 1000 倍數 vs 1-999 股），但這三條後端 `paper-broker.ts:597` 已呼叫 `validateOrderTypeMatrix()` authoritative 擋下（已驗證存在），且 PR 描述本就只承諾鏡射 §4.1/§4.2/§4.5，非隱藏 gap。建議 owner 若下一輪要做，補這三條的前端灰化以減少 round-trip 到 422。
2. **`/api/v1/paper/preview`（風控預覽步驟）未帶 session/orderCond/timeInForce**：`server.ts:13780` 該 route 對 `order.timeInForce` 寫死 `"rod"`，且完全不讀 session/orderCond（此為既有後端行為，非本 PR 引入的回歸）。實際送單（`/api/v1/trading/orders`）payload 正確帶真值，此為安全關鍵路徑，沒問題；但送單前的風控預覽面板（`renderRiskGuards`）在使用者選了融資/融券/當沖或非 ROD TIF 時，看到的 guard 結果是以 cash/rod 算出來的，可能與實際送單後的風控結果有落差。跟本 PR 無關但既然這次補齊了矩陣真送出，建議下一輪一併把 preview payload 也帶上這三個欄位。

### 💭 Nits
1. `.m2-chart` 固定高度改 300px、`.m2-scroll` 改 `overflow-y:auto` 是合理的版面因應（真引擎工具列比舊 118px 卡片高很多），但沒有截圖佐證手機版捲動後的實際觀感，純讀 CSS 推斷合理，建議 coordinator 上線後翻一下手機版視覺確認 fade-out 漸層跟真捲軸疊加沒有違和。
2. iframe 的 `onload` 沒有搭配 `onerror`；同源路徑下該 route 就算資料抓取失敗也會回一個 friendly empty state（仍算「載入完成」），所以 loading 遮罩會正常消失，不會卡死——只是未來若改成跨源就要重新評估。

### ✅ Praise
- 這輪矩陣邏輯不是照抄 UI 外觀，而是真的把 `order-rules.ts` §4.1/§4.2/§4.5 的判斷式在前端重新推導一次並交叉驗證過（例如 afterhours session 下市價選項會自動失效，是靠「TIF 交集為空」推出來的，而不是寫死一條規則）——這是本輪抓進度最花時間但也是唯一可能出真正資金風險的地方，做得紮實。
- K 線 iframe 複用點驗證：`/final-v031/portfolio/kline-frame` route 與 `OhlcvCandlestickChart.tsx` 確認完全沒被本 PR 觸碰，是真的「零重寫、純接線」，符合「已打磨元件只准複用不准重寫」鐵律。
- 新舊 spec 的斷言替換不是偷懶放寬：兩處改寫的斷言（`.kline-toolbar`、`[data-indicator-readout="volume-price"]`、`.kline-tab`/`is-active`）我都回頭到 `OhlcvCandlestickChart.tsx` 原始碼核對過，選到的都是真實存在的 class/attribute，不是憑空造的假斷言。
- 新增的 4 支 spec 用 `page.route()` 攔截真實 POST body 斷言 payload 欄位值（`session`/`orderCond`/`quantity_unit`/`type`/`timeInForce`），是行為驗證而非字串存在性檢查，技術上紮實。

## 5. Verdict
- [x] APPROVED — 可 ready，無 blocker（2 條 🟡 建議後續處理，不阻擋本輪合併）

## 6. Suggested Owner for Fixes
- 🟡 #1（§4.3/4.4/4.6 前端灰化補齊）→ Jim（下一輪 desk-exact 迭代）
- 🟡 #2（paper/preview 帶完整矩陣欄位）→ Jason/Bruce（backend lane，跟 order-rules.ts 相關）

## 7. Re-review Required
NO（僅 🟡，不需重 review；CI 綠燈 + coordinator prod 視覺驗證仍是 merge 前必做項，屬 Bruce/Elva 範疇非本輪 re-review）

---
Reviewer: Pete
Date: 2026-07-17
Sprint: W6+ Day (paper sprint 延伸, sprint_2026_07_17)
