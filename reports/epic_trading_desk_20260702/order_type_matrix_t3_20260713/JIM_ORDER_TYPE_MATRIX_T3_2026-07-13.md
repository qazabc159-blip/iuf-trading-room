# 台股下單能力矩陣 T-3（下單面板 UI）— 2026-07-13

Spec: `reports/epic_trading_desk_20260702/ORDER_TYPE_MATRIX_DESIGN_v1.md` §5 T-3。
Backend 依賴：T-1（`orderCond`/`session` schema + `order-rules.ts` 七條規則）已於 #1250 merge。

## 這輪做了什麼

`apps/web/public/ui-final-v031/paper_trading_room/index.html`（下單票）新增五組控制項：

1. **交易類別（session）** — 整股／盤中零股／盤後零股／盤後定價，`seg4` 四鍵。
2. **委託種類（orderCond）** — 現股／融資／融券／當沖，`seg4` 四鍵。
3. **委託效期（TIF）** — ROD／IOC／FOK，`seg3` 三鍵。
4. **委託類型／委託價**（既有，未動位置）— 委託價旁新增即時 tick + 漲跌停區間提示。
5. **單位／數量**（既有，1000 倍風險關鍵控件，未動位置，僅接上鎖定邏輯）。

即時（client-side）鏡射 `order-rules.ts` 七條規則中適用於「建立委託」的六條（§4.1-4.6；§4.7
改量 reduce-only 屬 T-4 範圍不在此片）：

- 市價單 → TIF 只能 IOC/FOK，ROD 自動灰化並切換
- 盤後零股／盤後定價 → TIF 只能 ROD，IOC/FOK 灰化
- 零股／盤後定價（session≠regular）→ 委託種類只能現股，融資/融券/當沖灰化並自動切回現股
- 零股／盤後定價 → 單位自動鎖定「股」，「張」灰化
- 限價 → tick 檔位即時檢查（沿用 `getTickSize` 相同的 6 階梯表），非法即顯示「最近合法價」
- 限價 → 漲跌停 ±10% 即時檢查（refPrice 取前收，同後端語意），超出即顯示合法區間
- 數量 → 整股須整張（1,000 股倍數）／零股須 1-999 股，違規即顯示中文原因

所有違規訊息為產品級繁中文案（直接沿用 order-rules.ts 的中文 message 文字，未新增裸英文/enum）。

## 真正 live-enforce 的範圍（重要，誠實揭露）

下單票的「送出模擬訂單」按鈕目前送到 **`POST /api/v1/trading/orders`**（統一下單流，非舊版
`/api/v1/paper/preview`+`/submit`）。這條路徑的 `orderCreateInputSchema` 已含 `orderCond`/
`session`/`timeInForce`（T-1），且 `submitOrder()` → `placePaperOrder()` 已跑
`validateOrderTypeMatrix()`。本輪把這三個欄位接進 `orderPayload`（`apps/web/lib/
final-v031-live.ts`）——**這是真正 live 的一段**，不是裝飾性 UI：

- 真瀏覽器驗證：`legal ticket submits via /api/v1/trading/orders with orderCond/session/
  timeInForce in the payload` 測試直接攔截真實 POST body，斷言 `session/orderCond/
  timeInForce` 三個欄位確實出現在打向 prod API 的請求裡。
- 新增 `order.status==="rejected"` 防呆：矩陣在 `placePaperOrder()` 拒單時 HTTP 仍回 201（不是
  422），若不特判會誤顯示「紙上單已送出」的假成功訊息——已修正為顯示對應中文原因（新
  `ORDER_RULE_REASON_LABELS` map）。

**KGI SIM 通道（T-2，尚未做）**：`送出 KGI 模擬單` 走同一個統一端點，但 KGI 分支
（`KgiBrokerAdapter.submitOrder`）目前不認得 orderCond/session，無法對映到 KGI gateway 參數。
本輪未動 KGI adapter（backend/T-2 範圍）。前端誠實處理：只要委託種類≠現股或交易類別≠整股，
KGI SIM 按鈕即灰化並顯示「KGI SIM 尚未支援融資／融券／當沖」/「KGI SIM 尚未支援零股／盤後委託」
——不會送出一個後端不知道怎麼處理的組合。

## 過程中的一個重要更正（誠實記錄）

任務訊息假設下單票走 `/api/v1/paper/preview`+`/submit`（舊版 `paperOrderCreateInputSchema`，
無 orderCond/session 欄位）。實際查證（先在一個過時分支上讀碼，後 `git fetch` 對 origin/main
重新核對）發現：那條舊路徑其實已在稍早的「統一下單流」epic（PR-3/PR-4，#1193/#1195）裡被換掉，
目前的送出鍵走 `/api/v1/trading/orders`——已經是 live-enforced 的路徑，不需要額外的 contracts/
backend 改動就能讓 orderCond/session 真正生效。原本以為需要的「T-1b 後端擴充 paperOrderCreateInputSchema」
評估為不需要，已放棄該方向，避免做多餘的 backend-lane 改動。

## 驗證

- typecheck 15/15 green
- `pnpm --filter @iuf-trading-room/web test` 681/681 green（零新增/零回歸）
- `pnpm run build:web` 全綠（含 `/portfolio`）
- 真瀏覽器 Playwright（本機 `next start` 打 `https://api.eycvector.com` + 真 SEED_OWNER session）：
  - 新 `jim_order_type_matrix_20260713.spec.ts` 8/8 desktop-chromium pass（見 screenshots/）
  - 既有 `jim_pr3_unified_order_20260709.spec.ts` 3/3 desktop-chromium pass（見下方「順手修的既有測試」）
  - 既有 `jim_uta_orders_report_20260710.spec.ts` 零回歸

### 順手修的既有測試（誠實揭露一個自己造成的先破後修）

`jim_pr3_unified_order_20260709.spec.ts` 原本對 2330 打限價 10 元（早於 T-1/T-3 時代的任意
placeholder 值）——T-3 的漲跌停即時檢查正確判定「10 元」相對 2330 現價（~2,440）荒謬地超出
±10% 區間，灰化送出鍵，讓這個測試原本仰賴的「離峰時段被風控擋」情境永遠打不到（client-side
先擋，網路請求根本沒發生）。修法：不再手打價格，改等 ticket 的 hydration 自動帶入真實報價
（`waitForTicketReady`），保證永遠是 tick/漲跌停合法值；同時移除 SHARE 單位切換（regular
session 下 1 股不是整張的倍數，也會被矩陣擋——這個舊測試原本用 SHARE 只是想壓低名目金額，
非本意測試零股語意）。desktop-chromium 3/3 green。**mobile-iphone-13 這支測試有 pre-existing
flake**（用乾淨 origin/main + 原始未改測試碼一樣會斷在同一步，已隔離驗證非本輪引入）——
未追查到底，因為這整個下單票本來就是桌面 only 功能（2026-07-13 桌面重排定案），不在本片範圍。

## 已驗過的買法組合（screenshots/ 目錄）

| 場景 | 檔案 |
|---|---|
| 預設狀態（整股/現股/ROD/限價） | matrix_default_state |
| 盤中零股 → 強制現股+股（張/融資灰化） | matrix_intraday_odd_forces_cash_share |
| 盤後零股／盤後定價 → TIF 鎖 ROD | matrix_afterhours_tif_locked |
| 市價 → TIF 鎖 IOC/FOK | matrix_market_order_tif_locked |
| 非法 tick 價格灰化 + 合法價格解除 | matrix_illegal_tick_blocked / matrix_legal_tick_cleared |
| 合法組合送出（盤中零股/IOC/市價）→ 真 POST /trading/orders 帶正確欄位 | matrix_legal_combo_before_submit / matrix_legal_combo_after_submit |
| KGI SIM 通道對非現股誠實灰化（T-2 待做） | matrix_kgi_sim_blocked_non_cash |

## 未做（明確排除，非本片範圍）

- **T-2**：KGI SIM 送單對映 orderCond/session 到 KGI gateway 參數（backend，KgiBrokerAdapter）
- **T-4**：委託回報表顯示 orderCond/session/TIF；撤單/改量 reduce-only 串接
- 改量流（§4.7）：本片只做建立委託時的六條規則，改量規則已存在於 order-rules.ts 但沒有前端消費點（尚無改量 UI）

## 修改檔案

- `apps/web/public/ui-final-v031/paper_trading_room/index.html`
- `apps/web/public/ui-final-v031/paper_trading_room/trading.css`
- `apps/web/lib/final-v031-live.ts`
- `packages/qa-playwright/tests/jim_order_type_matrix_20260713.spec.ts`（new）
- `packages/qa-playwright/tests/jim_pr3_unified_order_20260709.spec.ts`（既有測試修復，見上）
