# 市場資料完整性閘門（Market Data Integrity Gate）— 設計 + RCA — 2026-07-17（Jason，續 PR #1297）

---

## Round 3 追加（2026-07-18 凌晨）：Elva 部署後三度複驗 — 指數 stale regression 真根因 + 多管線問題誠實回報

### 先定死權威真值（楊董/Elva 要求：別信 finmind，用 TWSE 官方指數源）
直接 curl TWSE 主站官方 **MI_5MINS_INDEX**（逐 5 秒指數統計，非批次落後的 OpenAPI
`MI_INDEX`/`STOCK_DAY_ALL`）：

```
07/16 (四) 09:00:00 開盤 45,631.59 → 13:30:00 收盤 45,624.98
07/17 (五) 09:00:00 開盤 45,624.98 → 13:30:00 收盤 42,671.27
```

07/17 開盤值（45,624.98）精確銜接 07/16 收盤值，收盤 42,671.27，真實漲跌
= 42,671.27 − 45,624.98 = **−2,953.71（−6.47%）**。同時 curl TWSE MIS 即時報價
（`tse_t00.tw`）目前（07/18 凌晨，TWSE 系統 `sysDate=20260718`）仍卡在
`d="20260717"`（尚未有新交易日蓋掉），其 `y`（昨收）=45,624.98、`z`（成交）=42,671.27，
兩個獨立官方源完全互證。**結論：07/17 是真交易日，−6.47% 真崩盤，非 finmind 髒 bar，
之前判斷正確；07/17 才是「現在最新完整交易日」，07/16 是它的前一日。**

### 真根因：`getTwseMarketOverview()` Tier 1 用「今天」（wall-clock）查詢，非「最近交易日」
`apps/api/src/data-sources/twse-openapi-client.ts` 的 `_fetchTwseMarketOverviewUncached()`
Tier 1（MI_5MINS_INDEX 主站）永遠用 `todayTaipeiYYYYMMDD()`（wall-clock「今天」）當查詢
日期。**平日盤中/盤後當天查詢完全正確**；但一旦跨過午夜進入非交易日（本例：07/18 週六
凌晨），wall-clock「今天」= 07/18，MI_5MINS_INDEX 對 07/18 查詢正確回報「查無資料」
（非交易日，這部分行為本身無誤），程式碼卻**直接**落到 Tier 2（OpenAPI `MI_INDEX`，
自己已知會 lag 到隔天甚至更久 — 親測目前仍卡在 07/16），而不是先試同一個可靠的
MI_5MINS_INDEX 源、但查詢日期換成「最近一個真交易日」（07/17，其實有完整資料、剛剛
curl 證實）。這正是首頁大盤指數顯示 45,624.98／標「07/16」（過時但非假資料，是 Tier 2
落後版本）而非 42,671.27／07/17 真崩盤值的根因——**跟 #1298 的 `resolveAuthoritativeTradeDate`
無關，是更上游、資料抓取層本身選錯查詢日期**。

### 修法（同分支 `feat/market-data-integrity-gate-jason-20260717` 續作）
新增 `mostRecentTradingDayYYYYMMDD(fromYYYYMMDD)`（`twse-openapi-client.ts`）：純函式，
用既有 `lib/trading-calendar.ts` 的 `isTwTradingDay()` 逐日往回查（bound 10 天，涵蓋最長
的農曆春節連假），找到「wall-clock 今天」以前（含）第一個真交易日。`_fetchTwseMarketOverviewUncached()`
新增 **Tier 1.5**：Tier 1（今天）失敗時，若「最近交易日」≠「今天」，用同一個可靠的
MI_5MINS_INDEX 源、換成該交易日的日期再試一次，成功即直接採用（真值 42,671.27/-6.47%），
只有這一步也失敗才落到 Tier 2。純日期運算、無網路依賴，`mostRecentTradingDayYYYYMMDD` 本身
用字串參數而非 wall-clock，可完全決定性單元測試（07/18→07/17、07/19→07/17、平日回自己）。

### 多管線問題（熱力圖磚/強勢股排行）— 誠實回報，未硬幹
Elva 觀察到「kgi-core 端點 JSON（curl）07/16，但首頁渲染 DOM 卻是 07/17」——這代表**至少
兩個不同的資料新鮮度來源**：一個是我剛 curl 到的、真的卡在 07/16 的 TWSE 上游（STOCK_DAY_ALL
本身，我親測也還卡在 07/16，並非我方 bug，是 TWSE 官方批次檔案本身還沒發布 07/17 全量）；
另一個是「渲染 DOM 顯示 07/17」——最可能的解釋是 **prod 那台 Railway process 從 07/17 盤中
就一直在跑，其 in-process cache（enricher Tier 3 `_lastCloseCache`，48h TTL）在市場時間內已經
用 KGI live tick/MIS 抓到 07/17 的真實收盤值並快取住**，而我從沙盒環境新 curl TWSE 官方
STOCK_DAY_ALL 拿到的是「這個當下上游批次檔還沒更新」的狀態——兩者並不矛盾，只是反映
「prod 熱的 in-process 快取」vs「TWSE 批次檔尚未發布」的時間差，不是我方管線邏輯錯誤。

**但這確實暴露 Elva 說的真問題**：熱力圖磚走的是 kgi-core 專屬 enricher（5-tier fallback，
per-symbol 各自选最佳可用值），跟指數/banner 走的 `getTwseMarketOverview()`/
`marketContext.index` 是完全不同的程式碼路徑與快取層，**沒有共用同一個
`resolveAuthoritativeTradeDate()` 判斷**。#1298 的 `resolveAuthoritativeTradeDate()`
目前只 wire 到 `readMarketIndex()`（指數大字+banner），**沒有觸及 kgi-core enricher 這條
獨立管線**——這是 Elva 診斷正確的架構缺口。

**未動手的原因（誠實揭露，非拖延）**：
1. **無法在沙盒環境直接觀察 prod 的即時狀態**——只有 owner session 能看到 prod 這台
   process 實際快取了什麼、DOM 渲染當下真正吃到哪個 tier。我這邊能做的驗證僅限於：程式碼
   邏輯推演＋對外部官方源的獨立 curl，無法重現「prod 那個特定 process 的 in-process 快取
   狀態」。
2. **架構張力未解決**：熱力圖 tier 制度的設計初衷是「per-symbol 各自找最佳可用值，
   絕不因為某一天全域日期對不上就整批拒絕」（40 檔裡任何一檔缺某天資料，其他 39 檔仍該
   正常顯示）。若粗暴地讓每個 tile 都被迫套用「全域唯一 resolved trade-date」，可能反而
   讓原本個別 tile 有效的資料被誤判剔除（例如某檔股票剛好 07/17 的資料還沒到，但 07/16
   的仍然完全誠實可信，不該因為「日期不是全域選定的那天」就被丟成 no_data）。這不是
   「改起來很大」這種純工作量問題，是需要先決定「熱力圖到底要不要犧牲 per-symbol 韌性
   換全頁日期一致」這個產品/架構取捨，值得楊董/Elva 明確裁決後再做，不要我自己猜方向
   硬做。
3. 本輪已完成、驗證過、風險可控的部分（指數/banner 那條管線的權威日期解析）已交付；
   熱力圖磚那條管線的統一，留待下一輪依裁決方向實作（若裁定「全頁一致優先」，設計方向：
   在 `server.ts` 的 `/heatmap/kgi-core` 與 `/market-data/overview` 之間新增一個共用的
   「resolved trade-date」中介層，讓 enricher 的 tier 選擇在同一天內部排序時，同分優先選
   跟全頁解析日期一致的候選，而非直接砍掉不一致的——保留 per-symbol 韌性同時盡量貼齊
   全域日期）。

### Invariant 測試新增（本輪，`twse-market-overview.test.ts`，本次順手掛回 `package.json`
`test` script——這份測試檔案先前是孤兒檔案，從未被 CI 執行過，本次修復順手補上）
- T7：`mostRecentTradingDayYYYYMMDD("20260718")` → `"20260717"`（週六回週五）
- T7b：`mostRecentTradingDayYYYYMMDD("20260719")` → `"20260717"`（週日回週五）
- T7c：平日輸入回傳自己（不做多餘查詢）
- T7d：`getTwseMarketOverview()` 端到端整合測試——模擬 wall-clock「今天」查無資料時，
  必須先試「最近交易日」的 MI_5MINS_INDEX（Tier 1.5）成功取得真值
  （42,671.27/-6.47%），才不會落到更落後的 Tier 2；本測試在真實跑測當下（wall-clock
  今天）剛好落在 07/17 之後的窗口內完整執行並通過（非 skip），證實修復對現在這個真實
  時間窗確實生效。

### 驗證
- `pnpm run build:api` 綠、`pnpm typecheck`（全 monorepo 15/15）綠
- `twse-market-overview.test.ts` 18/18 全綠（含新增 4 條 T7 系列）
- 完整 `pnpm test` 1896/1898（2 個 pre-existing 跟本次無關的 `finmind-client.test.ts` 失敗，
  已連續三輪確認零改動該檔案）
- `apps/web` vitest 695/695 綠（未受影響，本輪為純後端修復）
- W6 本機 6/6 PASS；secret regression 0 findings

### 下一步交給 Elva 裁決
1. Review + merge 本輪指數 stale regression 修復（風險低、已驗證、直接解決確認過的
   regression）
2. **裁決熱力圖/強勢股排行是否要犧牲 per-symbol 韌性換取全頁日期一致**——裁決後我才能
   對那條管線動手，避免猜錯方向重工
3. Merge 後請用 owner session 複驗：首頁大盤指數應顯示 42,671.27／-6.47%／標 07/17，
   不再是 45,624.98／07/16

## 升級背景
PR #1297（3707 no_data 歸類 + banner 日期優先序修正）部署後，Elva 用 owner session + curl
TWSE MIS 官方源複驗，抓到兩個殘留：
1. 2395 仍顯示假 0%（`isZeroChangePlausible()` 用同源前一日快取反證，該快取本身已被同一批
   壞資料污染，變成自我印證）。
2. 首頁頂 banner 仍顯示 07/16，跟指數/磚 07/17 不一致——根因不在 `readMarketIndex()`（#1297
   已修），而是 `<MarketStateBanner />` 在首頁被無 prop 呼叫，落入元件自己「無 prop 時
   client-side 自行呼叫 `getMarketDataOverview()`」的分支，是跟頁面其他版面完全獨立解耦的
   第二次請求。

楊董裁示：這一串 bug（#1294 端點掛死／#1295 千分位截斷／#1297 no_data 歸類／2395 假 0%／
banner 日期不一致）是同一種病的不同臉——**沒有單一、經交叉驗證的權威資料層，顯示層信任任何
拿到的值**。本輪任務從「補 2395」升級為「建市場資料完整性閘門」，2395/banner 是這道閘門的
第一組 test case，不是終點。

## 2395 Round 1 為何不夠：同源自證的結構性缺陷
`isZeroChangePlausible()`（#1297）拿 `_lastCloseCache`（我方自己維護的快取）的「前一日」條目
反證一筆 `Change="0.0000"` 是否可信。但 `_lastCloseCache` 本身是從**同一份** TWSE
STOCK_DAY_ALL feed write-through填入的。在一次全新的部署（deploy 重啟洗掉 in-memory 快取）
之後，2395 當天第一次遇到這個壞 Change 值時，快取裡完全沒有「前一日」條目可反證——判定
「無從反證，接受」（文件裡明寫的已知限制），並把這個壞值（513/0%）連同今天的 dateTag
快取下來。**問題在於**：同一天後續每一次輪詢，這個已經被污染的「今天」快取條目都會被拿來
跟「今天」新抓到的同一筆壞資料比較——`isZeroChangePlausible()` 裡 `dateTag < dateTag` 的
判斷發現兩者是同一天，判定「不是真正的 prior，無從比較，接受」，於是整天都不會被抓到。用
自己的快取反證自己的來源，在快取被污染的當下就永久失效。

## 治本設計：`apps/api/src/market-data-integrity-gate.ts`

新模組，四道結構性檢查，取代原本散落在 enricher 裡的 ad-hoc 判斷：

1. **`verifyQuoteTuple()`** — 一個報價值只有在 `close/change/changePct` 全部存在且算術上
   自洽（`change ≈ close - prevClose`、`changePct ≈ change/prevClose*100`）且落在 ±10.5%
   帶內時才算「已驗證」。這是「有 price 但 change=null/0 卻當有效」這整類 bug 的結構性防線。
2. **`isPriceMagnitudePlausible()`** — 跟一個可信參考價比對，任何超過 3 倍/低於 1/3 的落差
   一律判為量級異常（獨立於 #1 的算術檢查，防的是「某個未來的 parse bug 讓 close 跟 change
   一起壞掉、算出來的 % 剛好還落在合法帶內」這種巧合）。這是 `#1295` 千分位截斷 bug 的
   generic 版防線——不靠字串解析層面的修正，而是任何量級異常的股票都會被獨立攔下。
3. **`crossValidateWithIndependentSource()`**（fail-CLOSED，2395 教訓）——一個可疑值（目前
   只窄定義：`changePct===0`）只有在**獨立來源**（TWSE MIS `getStockInfo.jsp` 的
   `y`＝昨收）證實時才可信；沒有獨立來源可用，或獨立來源對不上，一律判不可信——**絕不因為
   「無法反證」就預設接受**（這正是 Round 1 的漏洞）。
4. **`resolveAuthoritativeTradeDate()`** — n 選 1 的日期解析器，挑選多個候選（source,
   tradeDate）裡日期最新且合法的一個，前後端各有一份鏡像實作（`apps/web/lib/
   index-snapshot-freshness.ts` 同名函式），確保 banner／指數／熱力圖磚結構上不可能各說
   各話。

`verifyQuoteTuple()`／`crossValidateWithIndependentSource()` 皆為 pure function 並 export，
供未來的每日資料品質 canary（Elva 另外派工）直接 import 呼叫驗證任意候選值——本輪未另建
HTTP 端點（架構取捨：canary 若跟這個 repo 同進程/同 workspace 執行，直接 import TS 函式比
新增一個端點更輕量；若 canary 需要跨進程/跨語言呼叫，屆時再依實際需求加端點，避免現在猜測
性建置）。

## Wiring

- **`kgi-heatmap-enricher.ts`**：移除 `isZeroChangePlausible()`（同源自證，已證實不可靠）。
  Tier 2 的 `updateLastCloseFromTwse()` 與 `twseMap` 建構迴圈改用
  `crossValidateWithIndependentSource()` + 新參數 `independentPrevCloseMap`（呼叫端
  server.ts 用 TWSE MIS 抓來的獨立 prevClose）。新增 `isPriceMagnitudePlausible()` 量級
  防線（比對 mutate 前的 `priorCloseSnapshot`，避免自我參照變成 no-op）。新增
  `symbolsNeedingCrossCheck()` export，讓呼叫端知道該對哪些 symbol 打 MIS（僅限
  `changePct===0` 的少數幾檔，不是全 40 檔）。
- **`server.ts` `/api/v1/market/heatmap/kgi-core`**：抓完 `twseRows` 後，用
  `symbolsNeedingCrossCheck()` 篩出需要驗證的 symbol，平行呼叫既有的
  `getTwseMisQuoteSnapshot()`（`data-sources/twse-mis-quote-client.ts`，已存在、有自己的
  timeout+retry，本輪重用不重造），5 秒整體 timeout race（沿用同檔案既有 `withDbTimeout`
  pattern），fail-open——MIS 抓不到就是「無法確認」，per 設計 #3 直接歸 no_data，不會卡住
  端點本身。
- **`apps/web/app/page.tsx`**：`readMarketIndex()` 的 twse-vs-context 判斷從 pairwise
  `isNewerTaipeiTradeDate` 改呼叫 `resolveAuthoritativeTradeDate()`（跟後端同名鏡像函式）。
  新增 `MarketStateBannerSection`（獨立 async Suspense 區塊，複用既有 `cache()` 記憶化的
  `cachedMarket()`/`cachedRealtimeMarket()`，不多打一次後端），把 `readMarketIndex()` 算出
  的 `updatedAt` 直接以 `lastCloseDate` prop 餵給 `<MarketStateBanner>`——徹底拔除該元件在
  首頁的「無 prop 時自行 client-side fetch」分支（該分支保留給 `/companies/*` 等其他頁面，
  未刪除，只是首頁不再依賴它）。`Suspense fallback={null}` 保持既有 streaming 節奏，不阻塞
  mast 靜態殼（2026-07-14 冷啟動優化的既有承諾）。

## 測試（invariant 套件，測類不測單股）

`apps/api/src/__tests__/market-data-integrity-gate.test.ts`（新檔，19 條）：
- 有 price 但 change/changePct 為 null → 永不算已驗證
- 算術自洽的完整元組 → 驗證通過
- change/changePct 互相矛盾 → 拒絕（不管哪個看起來多合理）
- 缺交易日期 → 永不驗證
- 真實 -9.97%／-7.29% 崩盤日移動（±10.5% 帶內）→ 通過，不誤殺
- 超過 ±10.5% 帶 → 拒絕
- 已知大型股顯示個位數（2330 close=2 vs 參考價 2470）→ 量級異常，拒絕
- 真實崩盤日價格不誤觸量級防線
- 無參考價時無法判定異常 → 放行（不誤控）
- `needsIndependentCrossCheck` 只窄定義 exact-zero
- exact-zero 無獨立來源確認 → 不可信（fail-closed）
- exact-zero 被獨立來源反證（513 vs 真 519）→ 不可信
- exact-zero 被獨立來源證實（56.4 vs 56.4）→ 可信
- `resolveAuthoritativeTradeDate`：07/16 vs 07/17 選新的／無日期來源永不勝出／全缺回傳
  null（不猜測 wall-clock）

`apps/api/src/__tests__/heatmap-consistency.test.ts`（更新）：2395 prod repro 改用
`independentPrevCloseMap` 參數重現（無確認→no_data；MIS 反證→no_data；MIS 證實→合法
twse_eod/0%）；新增 `symbolsNeedingCrossCheck` 專屬測試（只標記 exact-zero 且屬於 kgi
40-symbol 名單的 symbol，不誤標全市場）。

`apps/web/lib/index-snapshot-freshness.test.ts`（更新）：`resolveAuthoritativeTradeDate`
4 條（07/16 vs 07/17 選新／無日期永不勝出／全缺回傳 null／順序無關）。

## 驗證
- `pnpm run build:packages`／`pnpm run build:api` 綠
- `pnpm typecheck`（全 monorepo 15/15）綠
- 新增後端 gate 測試 19/19、更新後 `heatmap-consistency.test.ts` 全綠、
  `apps/web` vitest 695/695（含新增 15 條 freshness 測試）綠
- 完整 `pnpm test`／CI 結果見 PR

## 架構取捨揭露
- 未建立獨立 HTTP 端點給 canary 打；改為 export pure function（`verifyQuoteTuple`／
  `crossValidateWithIndependentSource`／`resolveAuthoritativeTradeDate`）供 in-repo import。
  若 canary 需要跨進程存取，屬 follow-up。
- `isPriceMagnitudePlausible()` 目前只在 Tier 2（TWSE STOCK_DAY_ALL）套用；Tier 1（KGI
  live tick）跟 Tier 1.5（MIS intraday）未套用（來源不同、且 #1295 comma-truncation bug
  只出現在 STOCK_DAY_ALL 的字串解析路徑，KGI/MIS 走的是不同 client 各自的數值型別，暫不視為
  同類風險——若之後那兩層也出現類似量級異常，屬 follow-up 擴大套用範圍）。
- `crossValidateWithIndependentSource` 目前只窄定義 `changePct===0` 需要跨源驗證（未涵蓋
  「極端移動」——那部分已由既有 `isPlausibleChangePct` ±10.5% 檔住，不需要再打一次外部
  API；也未涵蓋量級異常——那部分已由 `isPriceMagnitudePlausible` 同步驟內處理，不需外部
  來源）。這個範圍收斂是刻意的：每多一種需要跨源驗證的情境，就多一次網路呼叫的延遲/失敗
  風險，本輪只對已知被證實無法用內部資料自證的情境（exact-zero）加這一層。
- Tier 2.5（quote_last_close）跟 Tier 3（cache）未套用 MIS 跨源驗證，因為它們本來就已經
  被歸類為 `no_data`（Tier 2.5，#1297 既有）或直接繼承 Tier 2 已驗證過的值（Tier 3 快取
  的是 Tier 1/Tier 2 已經跑過閘門的值，不會有未驗證的 exact-zero 進到 Tier 3）。
