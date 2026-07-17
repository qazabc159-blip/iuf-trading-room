# 熱力圖資料誠實 gating 修復 — 2026-07-17（Jason）

## 背景
Elva 用 owner session 抓 prod `/api/v1/market/heatmap/kgi-core` 素材，發現 40 格裡 2 格壞：
- `3707`（漢磊）：`price:68.7, change:null, changePct:null, sourceState:"twse_eod"`
- `2395`（研華）：`price:513, change:0, changePct:0, sourceState:"twse_eod"`

07/17 是真跌停日（TAIEX -6.47%），本輪修復**不動**任何真實極端值；只治「抓不到資料時
顯示成看起來正常但其實不完整/不可信」的呈現層。

## 根因查證（curl 官方源交叉驗證，非猜測）

### Bug #1：3707 changePct=null 但仍有 price
`kgi-heatmap-enricher.ts` 的 Tier 2（`twseMap`，來源 TWSE STOCK_DAY_ALL）**只涵蓋上市
(TWSE)**，3707 是上櫃 (TPEX) 股票，直接 curl TWSE STOCK_DAY_ALL 確認它從未出現在該資料集
裡。3707 唯一能命中的是 Tier 2.5（`quote_last_close` DB 表，寫入端同時涵蓋 TWSE+TPEX 收盤
價）——但這張表的 schema **只存 `close_price`，沒有 `prevClose`/`change` 欄位**，結構性地
永遠無法算出漲跌幅。舊版把 Tier 2.5 標成跟 Tier 2 一樣的 `sourceState:"twse_eod"`，導致「看
起來像正常完整格但漲跌幅是 null」。

### Bug #2：2395 changePct=0（疑似無資料被當 0）
用 TWSE MIS 即時報價 API 交叉驗證 07/17 真實收盤：`z:513.0000`（收盤價，跟 kgi-core 顯示的
513 一致）、`y:519.0000`（前一日收盤）。真實漲跌 = 513-519 = -6（-1.16%），**不是 0%**。但
kgi-core 顯示 `change:0, changePct:0`——代表 TWSE STOCK_DAY_ALL 那筆資料的 `Change` 欄位當
下確實回傳字串 `"0.0000"`（非空字串，`parseTwseNumber` 正確解析出 0，不是既有的
comma-truncation/empty-string bug），但這個 0 跟 MIS 官方報價矛盾——判定為 TWSE 批次處理當
下尚未算出正確 Change 值的暫態上游資料瑕疵（partial-day publish artifact），非真平盤。

## 修法

`apps/api/src/kgi-heatmap-enricher.ts`：

1. **Tier 2 / Tier 2.5 / Tier 3 統一 gating**：任何 tile 若 `changePct` 無法確定（結構性
   缺口，或下述 #2 guard 判定不可信），一律重分類為 `sourceState:"no_data"`（而非沿用原本
   tier 的名稱），price/ts 仍誠實保留供 API/ops 查閱。前端既有的 `isUsableTile()`
   （`industry-heatmap.tsx`，2026-07-14 楊董定案「缺角遞補真公司」時已加上
   `sourceState==="no_data"` 排除邏輯）本來就會排除 no_data tile 不渲染、改用候選池裡的真
   公司遞補——本次修復**不需要改前端渲染邏輯**，只需要後端誠實回報。
2. **新增 `isZeroChangePlausible()` 防呆**：TWSE STOCK_DAY_ALL 一筆 `Change==="0.0000"` 是
   歧義的（可能真平盤，也可能上游批次還沒算完）。跟我方自己快取的「前一交易日收盤價」
   （`_lastCloseCache`，寫入時序上早於本次更新）交叉比對：若前一日收盤價跟本次
   ClosingPrice 不一致（超出容忍度），判定這個 0 不可信，nullify changePct/change
   （tile 落 Tier2 → no_data）。若沒有前一日快取（例如 process 剛啟動、還沒任何一次成功
   fetch），則無從反駁，接受這個 0（已知限制，belt-and-suspenders 非完整解）。真平盤（跟
   前一日收盤價一致）仍誠實顯示 changePct=0，不誤殺。

## 前端

`apps/web/app/page.tsx` 的 `readMarketIndex()`：修 banner 日期跟 tile 日期不一致（原因：
`/market/overview/twse`〔MI_INDEX 獨立來源〕跟 `market-data/overview` 的
`marketContext.index`〔跟熱力圖磚同一次後端回應〕各自從 TWSE 不同上游資料集擷取，發布時
序不保證同步）。新增 `apps/web/lib/index-snapshot-freshness.ts` 的
`isNewerTaipeiTradeDate()`：當 `marketContext.index` 的交易日期比 `twseOverview` 新時，
banner 改用前者的價格+日期整組（絕不把一邊的價格跟另一邊的日期混用，避免重蹈 6/10
sign-contradiction bug）。

`apps/web/app/components/industry-heatmap.tsx` 的 `isUsableTile()`/`isUsableTile` 相關
渲染邏輯**未改動**——2026-07-14 已有的 `sourceState==="no_data"` 排除規則本來就是正確行為，
本輪只是讓後端誠實地把該分類的 tile 標成 no_data。

## 測試

- `apps/api/src/__tests__/heatmap-consistency.test.ts`：新增 5 個測試（3707 OTC-only 情境
  / 2395 fake-zero 情境 / 真平盤 regression guard / 無前一日快取時的已知限制 /
  `isZeroChangePlausible` 單元測試）。
- `apps/api/src/__tests__/kgi-core-afterhours-close.test.ts`：更新既有「Tier 2.5」測試斷言
  （`sourceState` 從 `"twse_eod"` 改為 `"no_data"`，`twseEodTileCount` 從 1 改為 0）——這是
  本輪刻意的行為變更，非退化：quote_last_close 結構性沒有漲跌幅資料，不該再冒充完整 EOD
  tile。
- `apps/web/lib/index-snapshot-freshness.test.ts`：新增 7 個測試涵蓋 `isNewerTaipeiTradeDate`
  （含跨日 UTC/Taipei 邊界案例）。

## 驗證結果
- `pnpm run build:packages` / `pnpm run build:api` 綠。
- `pnpm --filter @iuf-trading-room/api tsc --noEmit` 綠、`pnpm --filter @iuf-trading-room/web tsc --noEmit` 綠。
- `heatmap-consistency.test.ts` 12/12 pass；`kgi-core-afterhours-close.test.ts` 8/8 pass
  （單獨執行時該檔案 import `server.js` 觸發完整開機流程含多個 cron，process 不會自然退出——
  這是該測試檔案既有特性，非本輪引入；完整 `pnpm test` 套件一次性跑完不受影響）。
- `apps/web` vitest 新測試 7/7 pass。
- 完整 `pnpm test` / `pnpm typecheck` 結果見 PR。
