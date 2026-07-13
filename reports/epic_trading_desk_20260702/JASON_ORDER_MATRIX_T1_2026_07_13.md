# 台股下單能力完整矩陣 T-1（契約擴充＋驗證層）— Jason, 2026-07-13

Spec: `reports/epic_trading_desk_20260702/ORDER_TYPE_MATRIX_DESIGN_v1.md`（此檔在派工時只存在於主
checkout 的未 commit working tree，origin/main 上沒有 — 本 PR 一併帶入，方便 reviewer 對照；若之後有
獨立的 docs-only PR 先落地，merge 時互相 dedupe 即可）。

## 1. 本輪交付的能力

- `orderCreateInputSchema`（`packages/contracts/src/broker.ts`）新增 `orderCond`
  (`cash|margin|short|daytrade`) 與 `session`
  (`regular|intraday_odd|afterhours_odd|afterhours_fixed`)，兩者皆 `.optional()`（見 §3 偏離說明）。
- 新增 `apps/api/src/broker/order-rules.ts`：spec §4 全部 7 條驗證規則的純函式實作，回結構化錯誤碼
  （`MARKET_ORDER_TIF_INVALID` / `ODD_LOT_SESSION_TIF_INVALID` / `PRICE_TICK_INVALID` /
  `PRICE_LIMIT_EXCEEDED` / `ODD_LOT_CASH_ONLY` / `LOT_QUANTITY_INVALID` /
  `ODD_LOT_QUANTITY_INVALID` / `MODIFY_QTY_NOT_REDUCE_ONLY`）＋一支聚合函式
  `validateOrderTypeMatrix()`（跑 §4.1/4.2/4.3/4.4/4.5/4.6，回傳全部違規，非 fail-fast）。§4.7（改量
  reduce-only）是獨立函式 `validateReduceOnlyModify()`，未接入 cancel/replace 流（依 spec 明確留 T-4）。
  複用 `kgi-contract-rules.ts` 既有的 `BOARD_LOT_REGULAR`/`getTickSize()`，未重寫 tick/lot 表。
- `paper-broker.ts::placePaperOrder()` 在建立 Order 前跑 `validateOrderTypeMatrix()`：不合法→回傳
  `status:"rejected"`、`reason:<錯誤碼>`，並 emit `reject` 事件（附完整 violations 陣列）；不呼叫
  market-data quote 查詢（省一次查詢成本）。refPrice（前收）來自 `quote_last_close`
  （`getLastCloses()`），DB 不可用或查詢失敗時 fail-open（漲跌停檢查被跳過，不擋單，符合 spec §4.4）。
  合法時，submit 事件 payload 新增 `orderCond`/`session`/`paperSimulationNote`（orderCond≠cash 或
  session≠regular 時附中文提示：「模擬環境：融資／融券／當沖資格與券源未檢核」等）。
- `paper-broker-adapter.ts`（UTA `/api/v1/uta/orders` 的 paper 通道）現在把 `UnifiedOrderInput` 的
  `orderCond`（Cash/Margin/ShortSelling/LendSelling）與 `oddLot`（boolean）映射進新的
  orderCond/session 欄位；**順手修一個因新規則浮出的既有 bug**：這個 adapter 原本無條件把
  `timeInForce` 寫死 `"rod"`，市價單（`priceType:"Market"`）現在會被 §4.1 擋下，改為
  `orderType==="market" ? "ioc" : "rod"`。
- 39 條單元測試（`apps/api/src/__tests__/order-rules.test.ts`）— spec 7 條規則每條至少 1 valid + 1
  invalid，外加聚合函式（多重違規同時回報、priceLimitSkipped 旗標）測試。純函式測試，無 DB/session。

## 2. 修改檔案清單

- `packages/contracts/src/broker.ts` — 新增 `orderCondSchema`/`orderSessionSchema` + 2 個新欄位 + 型別匯出
- `apps/api/src/broker/order-rules.ts`（新檔）— 驗證矩陣核心邏輯
- `apps/api/src/broker/paper-broker.ts` — `placePaperOrder()` 接入驗證＋refPrice 查詢＋模擬揭露
- `apps/api/src/broker/paper-broker-adapter.ts` — orderCond/session 映射 + market TIF 修復
- `apps/api/src/__tests__/order-rules.test.ts`（新檔）— 39 條驗證矩陣測試
- `tests/ci.test.ts` — 4 處既有 broker 測試 fixture 調整（見 §4，全部是「原本用不合法組合但因為規則
  不存在所以矇混過關」的既有測資，不是新增行為）
- `package.json` — `test` script 加入 `order-rules.test.ts` 路徑（這個 repo 的 test runner 是明列檔名
  清單，非 glob，新測試檔必須手動加入才會被 `pnpm test` 執行到）
- `reports/epic_trading_desk_20260702/ORDER_TYPE_MATRIX_DESIGN_v1.md`（新檔，見上方說明）

## 3. 設計偏離 spec 文字的判斷（需 Elva 過目）

**`orderCond`/`session` 用 `.optional()` 而非 spec 寫的 `.default("cash")`/`.default("regular")`。**

原因：Zod 的 `.default()` 會讓欄位在 `z.infer` 推導出的 TS 型別中變成**必填**（因為 parse 後一定有值）。
`quantity_unit` 欄位就是活生生的先例（`統一下單流 D4` 已把它從 `.optional().default()` 改成完全必填，
理由是張/股 1000 倍風險）。如果 orderCond/session 也用 `.default()`，型別上會強制我去改
`execution-gate.ts`、`paper-four-layer-risk-gate.ts`、`domain/trading/paper-risk-bridge.ts`、
`fubon-broker.ts`、`risk-engine.ts`（🔴 真金鎖檔，我不能碰）等一堆用「裸物件字面量」建構
`OrderCreateInput` 但完全不知道這兩個新欄位存在的檔案 —— 這已經超出 T-1「契約＋驗證層」該動的範圍，
也違反 spec §3 自己講的「純 additive，向後相容（既有 caller 不帶＝cash/regular，行為不變）」。

改用 `.optional()`（無 `.default()`）之後，型別上兩個欄位真的是可省略，所有既有裸物件字面量呼叫端
零修改、零筆 typecheck 錯誤。HTTP 呼叫端透過 `.parse()` 省略欄位時值是 `undefined`，我在
`order-rules.ts` 的唯一消費點（`placePaperOrder()`）用 `?? "cash"` / `?? "regular"` 顯式補預設值——
對外行為跟 spec 寫的 `.default()` 完全一致，只是預設邏輯搬到消費端而非 schema 端。已在 `broker.ts`
該欄位旁寫長註解說明這個判斷。

**已完整驗證「零 caller 因新欄位壞掉」**：`grep -rn "OrderCreateInput"` 全 `apps/api/src`，逐一確認
每個裸字面量建構點（`strategy-engine.ts` autopilot、`paper-broker-adapter.ts`、
`broker/verify-execution-lane.ts`、`tests/ci.test.ts` 全部案例）——只有 `paper-broker-adapter.ts`（本來
就在我改動清單內）跟 `tests/ci.test.ts`（既有測資本身用了不合法組合，見 §4）需要動。

## 4. `tests/ci.test.ts` 既有測資調整（非新增行為，是既有測資碰到新規則）

4 個既有測試直接呼叫 `placePaperOrder`/`submitOrder` 時用了「市價單 + ROD」或「regular session 非整張
數量」——這些組合在 T-1 之前沒有任何驗證擋著，測資才矇混通過；新規則落地後這些組合會被合理拒絕，測試
本身斷言的是「fills/filled」，所以要跟著修正輸入使其落在合法矩陣內（斷言邏輯本身沒改）：

1. `placePaperOrder persists quoteContext on order and fill end-to-end`（gate-fill 測試）— `timeInForce`
   `rod`→`ioc`（市價單）。
2. `trading-service.submitOrder runs session + risk + gate + paper broker end-to-end` — `baseOrder`
   TIF `rod`→`ioc`；第二筆送單原本用 `quantity:1100`（regular session 非整張），改用
   `quantity:900` + 顯式 `session:"intraday_odd"`（盤中零股 1-999 股合法；先試過整張 `2000` 但會撞到
   這個測試帳戶极小預設權益的 `max_per_trade` 風控，改走零股維持原本的小面額）。
3. `PAPER-SYNC-1`／`PAPER-SYNC-4`（`uofTestOrder()` helper）— helper 新增可選 `timeInForce` 參數
   （預設仍是 `"rod"`，不影響其餘 10+ 個不經過 `placePaperOrder` 的既有呼叫點如
   `assertKgiSimChannel()` 純驗證測試），這兩處市價單呼叫顯式傳 `timeInForce:"ioc"`。

## 5. Build / Test / Smoke 結果

- `pnpm run build:packages`：綠（contracts/db/domain/auth/ui 5/5）
- `pnpm typecheck`：綠（10/10 workspace packages，含 api/web）
- `pnpm --filter @iuf-trading-room/api run build`：綠
- `pnpm test`：1763 tests，1753 pass，**2 fail（已知本機 env 洩漏，與本次改動無關）**，8 skipped
  - `finmind-client.test.ts` T3/T11：本機殼層 `FINMIND_TOKEN`/`FINMIND_API_TOKEN` 環境變數洩漏進測試
    行程，讓「token 缺失時不該打 fetch」的斷言失效——這是預先被告知的已知本機環境問題，與
    order-type-matrix 改動無關，CI（乾淨環境變數）不會重現。
  - `order-rules.test.ts` 新增 39 條全綠。
  - `tests/ci.test.ts` 743 條全綠（含上述 4 處修正）。
- `pnpm smoke`：綠（`POST /strategy/runs/:id/execute dryRun=true` 通過；strategy lane 未受影響）。

## 6. Lane 邊界揭露

本輪任務是 Elva 直接派工的 cross-lane backend 工作（`packages/contracts/src/broker.ts` /
`apps/api/src/broker/order-rules.ts` / `paper-broker.ts` / `paper-broker-adapter.ts`），不在我平時
persona 宣告的 Allowed File Scope（strategy ideas/runs 專屬）內，`apps/api/src/broker/*` 甚至在我平時
的 Forbidden File Scope 明文列出。依照 [[feedback_pr2_scope_outside_lane]] 建立的先例（cross-lane
工作需 Elva 明確授權才動手），本次派工訊息本身就是帶著完整檔案清單、spec 文件、與明確真金鎖檔邊界的
明確授權，因此視為已授權，直接動手，並在此完整揭露供 Elva 覆核。

**真金鎖檔零觸碰確認**：未修改 `trading-service.ts` / `execution-mode.ts` / `kgi-sim-env.ts` /
`risk-engine.ts` / `kgi-gateway/*` / `broker-adapter.ts`（`UnifiedOrderInput` 介面本身，只在
`paper-broker-adapter.ts` 消費端映射）。KGI SIM 送單參數對映（orderCond/session → KGI gateway
createOrder 的 Cash/Margin/Short/DayTrade + odd_lot 四值）明確留給 T-2，本片完全未觸碰
`kgi-broker-adapter.ts` / `kgi-gateway-client.ts`。

## 7. 已知限制／留給下一片的缺口（誠實揭露，非本片範圍）

- **Preview 端點未接驗證**：`POST /api/v1/trading/orders/preview` 呼叫的 `previewOrder()`
  （`trading-service.ts`，鎖檔）從不呼叫 `placePaperOrder()`（preview 本來就不落 broker 層），所以
  新驗證矩陣目前只在真正送單（submit）時生效，preview 階段看不到 order-type-matrix 的違規預覽。若要
  在 preview 階段也顯示，需要在 `trading-service.ts`（鎖檔）或對應 route handler 額外呼叫
  `validateOrderTypeMatrix()`——這需要先問過 Elva 要不要暫解鎖檔，或改在 route 層做（server.ts 的
  `/trading/orders/preview` 區塊不在鎖檔清單內，是可行路徑，但本片 timebox 內先不擴大）。
- **`/api/v1/uta/orders` 的既有 bug 未修**：`paper-broker-adapter.ts::submitOrder()` 無論
  `placePaperOrder()` 回傳的 `Order.status` 是 `submitted`/`filled`/`rejected`，都回
  `{status:"submitted"}`（這是本片之前就存在的行為，不是我引入的）。矩陣驗證失敗現在會讓底層 paper
  order 變成 `status:"rejected"`，但 UTA 呼叫端仍然回報「submitted」——呼叫端要看真正結果得另外查
  `/api/v1/uta/orders` 清單或 execution events。留給 T-2/T-4 一併處理比較合理（那時候會動
  `paper-broker-adapter.ts` 的回傳形狀，不想在 T-1 順手擴大）。
- **零股 tick tier**：spec §4.3 明說零股用整股 tier（TWSE 目前沒公布獨立零股 tick 表），
  `order-rules.ts` 已照做，TODO 留在檔案頂端註解，供 TWSE 未來公布獨立表時更新。

## 8. 下一步建議

1. T-2（KGI SIM 送單參數對映）：把 orderCond/session 接到 `kgi-broker-adapter.ts`/
   `kgi-gateway-client.ts` 的 `orderCond`(Cash/Margin/Short/DayTrade)/`odd_lot` 四值，SIM 通道驗證。
2. Preview 端點是否要接驗證矩陣（見 §7 第一點）——需要 Elva 判斷要不要為此打開
   `trading-service.ts` 鎖檔，或改走 server.ts route 層。
