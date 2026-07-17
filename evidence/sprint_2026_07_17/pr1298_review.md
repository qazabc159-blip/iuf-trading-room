# PR #1298 Desk Review — Pete 2026-07-18

## 1. PR Intent
- 升級 #1297（治本不補丁，楊董裁示）：把 7/17 一整串熱力圖 bug（#1294 端點掛死／#1295 千分位截斷／#1297 no_data 歸類／2395 假 0%／banner-tile 日期不一致）當同一種病治——「沒有單一、經交叉驗證的權威資料層」。新模組 `market-data-integrity-gate.ts` 提供 4 條結構性 invariant：①`verifyQuoteTuple` 算術自洽 ②`isPriceMagnitudePlausible` 量級異常 ③`crossValidateWithIndependentSource` fail-closed 跨源驗證（treat 2395：同源自證的 `isZeroChangePlausible` 證實不可靠，換 TWSE MIS 獨立源）④`resolveAuthoritativeTradeDate` 單一權威交易日（banner/index n 選 1，取代 pairwise `isNewerTaipeiTradeDate`）。
- 對應 sprint task：7/17 資料誠實 P0 系列 Round 2（延續 #1294/#1295/#1297，同日楊董升級令）。
- Base branch：`main`（merge-base = origin/main HEAD `151942e0`，正確；DRAFT 確認；`mergeStateStatus=CLEAN`）。

## 2. Diff Summary
- 改 10 個檔（含 1 份新設計文件）
- 主要改動：新檔 `market-data-integrity-gate.ts`（234 行純函式模組）／`kgi-heatmap-enricher.ts` 移除 `isZeroChangePlausible`、Tier 2 改用新模組 + 新增 `symbolsNeedingCrossCheck()`／`server.ts` 在 `/heatmap/kgi-core` 加一段有 timeout 的 MIS 跨源驗證 wiring／`page.tsx` banner 改吃 `resolveAuthoritativeTradeDate()`、新增 `MarketStateBannerSection` 拔除 banner 獨立 client-side fetch／`index-snapshot-freshness.ts` 前端鏡像實作／19+4 條新測試。
- LOC: +798 / -122（gh 統計）
- CI：validate / W6 No-Real-Order Audit / Secret Regression Check / DB-mode Tests / Playwright P0 Smoke 全 5/5 SUCCESS。

## 3. IUF Blocker Checklist

### §A Kill-switch/真單
PASS — grep 全 diff 對 `KILL_SWITCH|EXECUTION_MODE|place_order|submit_order|order.create|kill_switch` 0 命中；純資料呈現層，不碰 broker/trading-service/execution-mode。

### §B Auth/Secret
PASS — 0 secret/token 明碼；沒有新增 endpoint（沿用既有 `/api/v1/market/heatmap/kgi-core`，auth middleware 未動）。

### §C State/Schema
N/A — 無 migration；`enrichHeatmapTiles()`/`updateLastCloseFromTwse()` 新增可選參數（`independentPrevCloseMap`），既有呼叫端不傳沿用「unconfirmed ⇒ rejected」行為，向後相容 PASS（`heatmap-consistency.test.ts` 舊測試已同步改寫確認）。

### §D PR Hygiene
PASS — title `feat(market-data): ...` conventional commits；branch `feat/market-data-integrity-gate-jason-20260717` 符合命名慣例；DRAFT 起手；PR body 列 root cause/wiring/test plan/architecture tradeoffs，設計文件 `MARKET_DATA_INTEGRITY_GATE_DESIGN_2026_07_17.md` 附完整 RCA。**唯一瑕疵**：PR body 稱「19 new invariant tests」，`market-data-integrity-gate.test.ts` 實數 `test()` 為 16 條（+ `index-snapshot-freshness.test.ts` 4 條、`heatmap-consistency.test.ts` 改寫 3 條），總數對得上「新增覆蓋面」的實質但單檔數字誤植——見 nit。

### §E 越線
PASS — `page.tsx` 改動範圍確認僅 `readMarketIndex()` + 新增 `MarketStateBannerSection`（банner 專用 Suspense 區塊），未動其他版面／熱力圖呈現層（`industry-heatmap.tsx` 不在 diff 內）；未碰真金/W6/migration；`market-data-integrity-gate.ts` 檔頭明寫 hard lines「pure functions only, no DB/network I/O in this module itself」且**核實成立**（I/O 呼叫全在 `server.ts` 呼叫端）。

## 4. Findings — Priority Ranked

### 🔴 Blockers
（無）

**掛死類 failure scenario 逐項核實（本輪最高優先查核項）**：
- MIS 呼叫本身（`data-sources/twse-mis-quote-client.ts`，**本 PR 未新增此檔**，僅重用既有）每個 fetch attempt 帶 `signal: AbortSignal.timeout(4_000)`，`fetchExchangeSnapshotWithRetry` 最多 2 attempts × 2 exchanges，任何單一 attempt 皆有硬上限，不會無限掛。
- `server.ts:13358` 呼叫端再包一層 `withDbTimeout(..., 5_000, "misZeroChangeCrossCheck")`（`Promise.race` 對 5s timeout），5s 到就放棄等待、`independentPrevCloseMap` 維持 `undefined`、受影響 symbol 直接落 `no_data`（fail-closed 在資料值上，fail-open 在端點可用性上）——**不會卡住 `/heatmap/kgi-core` 端點本身**。
- 沒有重蹈今晚 `_stockDayAllInflight` 的坑：`getTwseMisQuoteSnapshot()` 每次呼叫都是全新 promise，**沒有 module-level singleton/memoized in-flight promise**，不會出現「一次未 bound 呼叫掛死全 process」的同類病灶。
- N 個 tile 不會同步等 N 次 MIS：`symbolsNeedingCrossCheck()` 把範圍窄限在「屬於 40 檔 kgi 名單 **且** `changePct===0`」（`needsIndependentCrossCheck` 只窄定義 exact-zero），實務通常 0-few 檔，且用 `Promise.allSettled(suspectSymbols.map(...))` **平行**呼叫，非序列，不會 N 倍疊加延遲。
- `withDbTimeout` 是 `Promise.race`，**不會真的 cancel** 底層 `Promise.allSettled` — race 輸的那組 MIS fetch 仍在背景跑到 AbortSignal 4s 觸發才收尾。因為沒有 singleton 快取，這只是短暫的背景資源佔用（bounded ≤ ~16.5s/symbol），不會累積成掛死；但仍記一條 🟡（見下）。

結論：**沒有踩到今晚 #1292/#1294 的掛死坑**，bounded + fail-open + 無 singleton memoization 三條防線都成立。

### 🟡 Suggestions
1. **MIS 跨源驗證每次 request 都重打，無 cache/TTL 去重** — `apps/api/src/server.ts:13350-13369`
   - `symbolsNeedingCrossCheck()` 純函式，每次 `/heatmap/kgi-core` 被打就對當下的 `twseRows` 重新掃描，若某 symbol 當天持續呈現 `Change="0.0000"`（例如真平盤股、或停牌股、或另一次批次異常）並且該端點被頻繁輪詢，**每次輪詢都會對 `mis.twse.com.tw` 打一次全新即時請求**，直到當天 TWSE STOCK_DAY_ALL 批次更新為止（`_lastCloseCache` 的寫入門檻是 `dateTag > existing.dateTag`，同日不會二次寫入，但不影響這裡的網路呼叫觸發條件）。
   - 對照既有 `_misTileCache`（Tier 1.5 有 30 分鐘 freshness window）已示範過同類問題的解法。目前這個新跨源驗證呼叫沒有等效的短 TTL cache。
   - 建議：加一層以 `symbol+dateTag` 為 key 的短 TTL（例如 5-15 分鐘，比照既有 MIS cron 頻率）快取 `independentPrevCloseMap` 的結果，避免同一天對同一檔重複打外部 API；沒有惡意流量放大風險（範圍鎖 40 檔+exact-zero），但屬今晚同一類「未節流的外部呼叫」体質，值得順手補上而非留到下次真的被打爆才修。

2. **`verifyQuoteTuple()` 是本模組「四道 invariant」的第一道，但沒有被 wiring 進實際 enrichment pipeline** — `apps/api/src/market-data-integrity-gate.ts:18-27` 對比 `kgi-heatmap-enricher.ts` 全檔。
   - 檔頭文件明寫「every display surface... this module is that guard」且把 `verifyQuoteTuple()` 列為 tier 輸出「must satisfy」的第一項；但實際 `kgi-heatmap-enricher.ts` 的 Tier 2 迴圈並未 import/呼叫 `verifyQuoteTuple`，仍是自己手刻的算術（`prevClose = close-changeVal`／`pctRaw` 計算／`isPlausibleChangePct` 判帶）——功能上跟 `verifyQuoteTuple` 想抓的 class 大致重疊但不是同一份程式碼，兩份邏輯未來可能各自修改而分岔。PR body/design doc 對此有一句話揭露（「Exported for external verification... 供未來 canary import」），但檔頭核心文件的措辭讀起來像「enricher 輸出已經被這個函式把關」，容易讓下一位讀者誤判涵蓋範圍。
   - 這不是掛死/資料誠實的實際生產風險（現有 inline 邏輯確實也擋住同一批 bug，`heatmap-consistency.test.ts` 有覆蓋），純粹是「文件宣稱 vs 實際 wiring」有落差，屬 PR 描述與 diff 一致性瑕疵。
   - 建議：要嘛把 Tier 2 迴圈改成真的呼叫 `verifyQuoteTuple()`（一次性收斂成單一實作，避免兩份算術邏輯分岔），要嘛把檔頭文件改成明確寫「僅 #2/#3/#4 已 wiring，#1 目前只給未來 canary 用」，兩者擇一即可，不影響本輪 merge。

3. **Tier 1/1.5 未套 `isPriceMagnitudePlausible` 的範圍限縮，只在 PR 文字揭露，未開對應 follow-up ticket 追蹤** — design doc 已誠實寫明理由（KGI/MIS 走不同 client 數值型別，非本次 #1295 comma-truncation 同類風險），推理站得住腳，但目前只是 prose 揭露，沒有一個可被下次追蹤的 ticket/TODO。建議事後補一行 backlog 項目，避免「這是刻意範圍縮小」跟「這是忘了做」在半年後混淆。

### 💭 Nits
1. PR body「19 new invariant tests」與 `market-data-integrity-gate.test.ts` 實際 `test()` 數（16）對不上（含其他兩檔新增測試合計約 23 條，若指全部新增測試則數字仍不精確）——純文字誤植，不影響驗收，建議下次 PR body 寫測試數字前跑一次 `grep -c "^test("` 核對。
2. `resolveAuthoritativeTradeDate()` 前後端各自實作一份鏡像（`apps/api/src/market-data-integrity-gate.ts` + `apps/web/lib/index-snapshot-freshness.ts`），因無跨 web/api 共用型別 package 而合理，但長期有兩份邏輯漂移風險（尤其 `MAGNITUDE_ANOMALY_RATIO`/`DAILY_LIMIT_PCT` 這類常數若未來只改一邊）。非本輪範圍，記錄供未來若要抽 shared package 時參考。

### ✅ Praise
- **2395 Round 1→Round 2 的根因升級推理清楚且誠實**：明確指出「用自己同源快取反證自己同源的值」在結構上不可能抓到同源 bug（cold-cache 窗口污染鏈完整寫在檔頭文件），不是含糊帶過，換成真正獨立源（TWSE MIS）並且 fail-closed（無獨立確認 = 不可信，不是預設接受）——這正是把「先前 Round 1 的已知限制」正面收斂掉，而非另開一個補丁繞過去。
- **掛死教訓確實被吸收而非重蹈**：沿用今晚 #1294 剛立的 `withDbTimeout` pattern、既有 MIS client 的 per-fetch `AbortSignal.timeout`、無新增 module-level singleton in-flight cache，三層防線在本輪查核下都成立——面對「治本大改動」最容易在新增外部呼叫時舊病重犯，這次沒有。
- **測試沒有誤殺真值**：`isPriceMagnitudePlausible`/`verifyQuoteTuple` 兩邊都各自對「真實 -9.97%/-7.29% 崩盤日移動」寫了明確 regression test 確認不誤觸量級或算術防線，`heatmap-consistency.test.ts` 也把「MIS 證實的真平盤（56.4 vs 56.4）」與「MIS 反證的假平盤（513 vs 519 = 2395 原案）」兩條路徑都各自鎖住——問題②（over-gate 誤殺真值）的疑慮驗證後不成立。
- **banner 根因跟 2395 是完全不同的第二個病灶，作者沒有偷懶把兩者混為一談**：`<MarketStateBanner>` 無 prop 落入獨立 client-side fetch 分支，是跟本輪其他修復平行的獨立 RCA，PR body 清楚分開陳述，`MarketStateBannerSection` 改用既有 `cache()` 記憶化的 `cachedMarket()`/`cachedRealtimeMarket()` 而非新開一次後端呼叫，且用 `<Suspense fallback={null}>` 保留既有 streaming 節奏（不阻塞 mast 靜態殼）——沒有為了修一個 bug 又引入新的效能回歸。

## 5. Verdict
- [x] APPROVED — 可 ready，0 blocker。3 個 🟡 皆為 follow-up 等級（資源效率/文件與 wiring 一致性/追蹤缺口），不阻擋本輪 merge；CI 5/5 綠、W6/Secret Regression 皆 PASS。

## 6. Suggested Owner for Fixes
- 🟡 #1（MIS 跨源驗證無 cache/TTL）→ Jason（建議本輪或下輪順手補，屬同一類「未節流外部呼叫」體質，優先權中等偏高）
- 🟡 #2（`verifyQuoteTuple` 未 wiring，文件措辭 vs 實際落差）→ Jason（文件澄清可本輪順手改一行；真正 wiring 收斂可列 follow-up）
- 🟡 #3（Tier 1/1.5 範圍限縮未開 ticket）→ Elva（決定是否值得開一個輕量 backlog 項目追蹤）

## 7. Re-review Required
NO（3 個 🟡 非 merge 前置條件；若 owner 選擇本輪順手修 #1/#2，貼 diff 我可快速複審）

---
Reviewer: Pete
Date: 2026-07-18
Sprint: W6+ 7/17 資料誠實系列 Round 2（PR #1298，commit b47d4c8d）
