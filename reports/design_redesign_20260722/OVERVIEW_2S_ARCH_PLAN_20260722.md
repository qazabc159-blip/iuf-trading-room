# /overview <2s 最後一哩：架構方案（Plan agent opus，2026-07-22 夜；Elva 收案落檔）

## 結論

`/overview` 的最後一哩瓶頸不是「快取失效」而是**演算法複雜度錯配**：historyQuality/barQuality 只消費「每檔一列的品質摘要」（grade 計數），但現行實作為了產出那份摘要，必須把 twse_mis 全量 history（~1826 檔 × 最多 512 tick ≈ 93 萬筆）整包 `withFreshness` materialize + 全域 sort + group，成本是 O(#ticks) 而非 O(#symbols)。#1323→#1337 的七輪修法（per-source generation、split memo、round6 共用 history snapshot、round7 共用 quote snapshot + 頂層 promise memo）已把「重複掃描」與「並發重算」壓乾，warm 1.3s 就是單次全掃的地板——**再優化 memo 不會再往下掉**，必須改掉「算摘要要先攤開全部 tick」這件事本身。

**推薦案：A（增量維護 per-(source,symbol) 聚合索引）為主 PR，尾隨折入 D-lite（boot 暖機）殺 cold-after-deploy。**
- 理由：A 從根源把 quality 摘要從 O(93萬 ticks) 降到 O(1826 symbols)，warm/cold 同時受益；不引入新 infra、無 B 的「預算快照時間點 vs 請求時點」freshness 造假風險（正是 #1321 剛修掉的失敗形狀）；/diagnostics 明細端點完全不動、可 100% 快照對拍驗證等價；bars 品質因 `approximate` 恆真，grade 只對「≥2 桶?」敏感，聚合可退化成一個布林，難度大降。B/C 都只是把成本藏到別處並各自加 staleness/CPU/多副本負擔。

## 1. 現況根因（origin/main 原始碼確認，非背景複述）

熱路徑（`apps/api/src/market-data.ts`，origin/main）：

- `computeMarketDataOverview()` (L4204) 已於 round6/7 前置 `snapshotCachedProviderQuoteHistoryBySource()` (L768) 與 `snapshotCachedProviderQuotesBySource()` (L792)，把 history/quote 全掃各壓成「每 source 一次」，再把 snapshot 以 `rawHistoryBySource`/`rawQuotesBySource` 參數往下穿。
- 但那「一次」本身仍是重成本：`listCachedProviderQuoteHistory()` (L731) 對 twse_mis 做 `[...historyCache.entries()].filter(startsWith source).flatMap(entries.map(withFreshness)).sort(...)`——~93 萬筆的 map + 全域 `localeCompare` sort。
- `getMarketQuoteHistoryDiagnostics()` (L2670) 拿到全量 history 後 `getPreferredSourceBySymbol()` (L1053) 每檔只留 preferred source，再 group、每檔算 first/last/count/freshness → `buildHistoryQualityAssessment()` (L920) → `summarizeQualityAssessments()` (L1000)。**最終 overview 只用 `.summary`**（L4390 `quality.history = historyQuality.summary`），items 丟棄。
- `getMarketBarDiagnostics()` (L4037) 同理，經 `listMarketBars()` (L3965) 把 tick 分桶成 1m bar 再 group；overview 也只用 `.summary`。關鍵：bar 的 `approximate = true` 恆真 (L4155)，故非 synthetic 且 fresh 且 ≥2 桶 → 一律 `reference_only`；grade 只對「桶數 ≥2?」與 freshness 敏感。

Cold-after-deploy：部署後記憶體 Map 空，首請求觸發 `ensurePersistedQuoteHistoryLoaded()` (L666) → `loadPersistedQuoteEntries()`（`market-data-store.ts` L49，讀 `/data/market-data/<slug>.quotes.jsonl`、逐行 Zod parse + `pushQuoteEntry`），把整份持久化 history 重放進記憶體，再疊上首次全掃。這是 cold 慢的獨立來源。

Memo 常數：`overviewMemoTtlMs = 1500` (L4171)、`CACHED_PROVIDER_MEMO_TTL_MS = 1000` (L710)。

## 2. 三案比較

### 案 A — 增量維護聚合索引（推薦）
在唯一寫入口 `pushQuoteEntry()` (L620) 增量維護 `Map<QuoteSource, Map<identityKey, HistoryAggregate>>`；`HistoryAggregate = { count, firstTimestamp, lastTimestamp, lastSource, synthetic, hasTwoDistinctBars, lastBarBucketStart }`。overview 的 quality 摘要改由聚合 O(#symbols) 計算，不再 materialize/sort 全量 tick。

- **改動面**
  - `apps/api/src/market-data.ts`：新增聚合 Map 與 `updateHistoryAggregate()`（在 `pushQuoteEntry` 的 `!isDuplicateHistoryEntry` 分支內、含 `history.splice` 淘汰時同步修正 firstTimestamp/count）；新增 `buildOverviewQualitySummaries(workspaceSlug, qualitySymbols, rawQuotesBySource)` 直接吐 history/bar `summary`；`computeMarketDataOverview` 的 quality 區塊改呼叫它（`getMarketQuoteHistoryDiagnostics`/`getMarketBarDiagnostics` 及其 `/diagnostics` 路由**原封不動**，明細仍走全掃）；`resetMarketDataWorkspaceState()` (L4425) 清聚合。
  - `apps/api/src/__tests__/`：新增 `overview-quality-aggregate-parity.test.ts`。
- **複用**：`pushQuoteEntry`（唯一寫路徑，天然攔截點）、generation-counter 慣例、`getPreferredSourceBySymbol`（在小的 latest-quote snapshot 上選 source）、`buildHistoryQualityAssessment`/`buildBarQualityAssessment`/`summarizeQualityAssessments`（不改，餵聚合輸入）、`historyQualityReasonBuckets`/`barQualityReasonBuckets`。
- **新建**：聚合 index、`updateHistoryAggregate`、`buildOverviewQualitySummaries`、parity 測試。
- **風險**：(1) `history.splice` 淘汰最舊 tick 時 firstTimestamp 前移——最棘手；緩解：淘汰量小且可從 `history.at(0)` 讀新 first。(2) preferred-source 每檔單選必須複刻，否則多/漏計。(3) bars 桶數需增量，靠 `lastBarBucketStart` 變動時把 `hasTwoDistinctBars` 拉真即可（因 approximate 恆真，只需布林非精確桶數）。(4) 與全掃路徑的等價性——用 parity 測試釘死。
- **預估效果**：quality 區塊 O(93萬)→O(1826)，warm 與 cold 首請求同降；預期把 warm quality 段的 ~1.3s 地板打穿至數十 ms，overview 進 <2s 且有餘裕。
- **驗收**：parity 測試（多組 seeded 狀態下聚合摘要 == 全掃摘要，byte-equal）；prod-scale bench cold/warm <2s；沿用 `market-data-overview-concurrency-memo.test.ts` 的 determinism guard 不得破。

### 案 B — 預算落地 api-volume（背景重算 + 持久化快照）
背景 job（掛現有 MIS sweep cron 或獨立 interval）週期性跑 `getMarketQuoteHistoryDiagnostics`/`getMarketBarDiagnostics`，把兩份 `summary` 寫成小 JSON 到 `/data`；overview 直接讀快照。

- **改動面**：新增 `apps/api/src/market-data-quality-store.ts`（讀寫 `<slug>.quality.json`，仿 `market-data-store.ts`）；`market-data.ts` overview 改讀快照 + fallback；排程掛入既有 cron 註冊處（`server.ts` 附近的 cron/interval 區）。
- **複用**：`getMarketQuoteHistoryDiagnostics`/`getMarketBarDiagnostics` 當背景 kernel、`market-data-store.ts` 持久化模式、`RAILWAY_VOLUME_MOUNT_PATH` 慣例（L3181 附近已用）、既有 cron infra。
- **新建**：quality store、排程項、讀取/fallback 邏輯。
- **風險**：**freshness 造假**——快照的 `fresh/stale` 是「上次 job 時點」的判定，wall-clock 走動後可能該 stale 卻回 fresh（正是 #1321 修掉的形狀）；緩解須讀取時用 lastTimestamp 重算 freshness，等於仍要每檔資料。多一顆 cron + volume 寫入競爭；cold-after-deploy 的 JSONL 重放未解（除非快照也讓 overview 跳過 ensureLoaded，牽連更廣）。每個 Railway 副本各自需要（快照落 volume 可共享，較 C 好）。
- **預估效果**：overview quality 讀取 O(1)；把重算徹底移出請求路徑。
- **驗收**：快照 schema 測試、staleness-fallback 測試、deploy-verify 首請求 <2s。

### 案 C — 背景 cron 暖機（不改演算法，只保溫）
不動計算；背景 timer 週期呼叫 `getMarketDataOverview` 保 `overviewMemo` + `cachedProviderQuoteHistoryMemo` 常熱，boot 時先暖機再收流量。

- **改動面**：新增 warmer（`server.ts` boot + `setInterval`/現有排程）；可能上調 `overviewMemoTtlMs` 並做 refresh-ahead；`market-data.ts` 匯出暖機入口。
- **複用**：現成 `getMarketDataOverview` memo、cron infra、`resetMarketDataWorkspaceState`。
- **新建**：warmer 排程 + boot warmup。
- **風險**：memo TTL 僅 1500ms，要保溫得 sub-TTL 刷新，即使零流量也持續燒 CPU（N workspace × 每 1.5s）；Node 單執行緒下 warmer 與真實請求爭時間片（正是 round7 的隱憂）；**未降低單次成本**只是遮蔽；部署後首請求仍與 warmup 賽跑；多副本各自暖機。
- **預估效果**：warm 已 1.3s，主要價值在 cold-after-deploy；memo miss 時計算本身仍不達標。
- **驗收**：boot→首請求計時、memo hit-rate。

### D-lite（尾隨併入推薦案，非獨立大案）
Boot warmup 一次性呼叫 + （選配）把 A 的聚合索引快照落 `/data`，使 cold start 跳過整份 JSONL 重放的 quality 段，直接殺 cold-after-deploy。

## 3. 推薦案落地步驟（每步一個可獨立驗證、可 merge 的 PR）

- **PR-1（特徵化，零行為變更）**：建 prod-scale bench + 擷取現行 historyQuality/barQuality `summary` 的 golden 快照（read-only 特徵化）。驗收：bench 數字與 golden 落地、無端點變更。
- **PR-2（純新增聚合，無消費者）**：在 `pushQuoteEntry` 內維護聚合 index（含 splice 淘汰修正），無任何端點改讀它；單測斷言「聚合推導值 == 全掃推導值」跨多組 seeded 狀態。驗收：新測試綠、既有測試不動。
- **PR-3（收割 PR）**：`computeMarketDataOverview` 的 quality 區塊改讀 `buildOverviewQualitySummaries`（僅 overview 的 summary 消費；`/diagnostics` 明細不變）；對拍 PR-1 golden 等價；bench 證 overview cold/warm <2s。驗收：parity + bench + determinism guard。
- **PR-4（選配，cold-after-deploy）**：boot warmup +（選配）聚合快照落 api-volume，使 cold 首請求跳過 quality 段全量重放。驗收：deploy-verify 首請求計時 <2s。

## 4. 明確複用 vs 新建（推薦案）
- **複用（不改）**：`buildHistoryQualityAssessment`、`buildBarQualityAssessment`、`summarizeQualityAssessments`、`getPreferredSourceBySymbol`、reason buckets、`/diagnostics` 兩端點與其全掃路徑、generation-counter 與 memo 慣例、`market-data-overview-concurrency-memo.test.ts`（回歸護欄）。
- **改**：`pushQuoteEntry`（加聚合維護）、`computeMarketDataOverview` 的 quality 區塊（改讀聚合）、`resetMarketDataWorkspaceState`（清聚合）。
- **新建**：聚合 index 型別與 `updateHistoryAggregate`、`buildOverviewQualitySummaries`、parity 測試；PR-4 才動 boot warmup / quality 快照 store。

## 關鍵檔案
- `apps/api/src/market-data.ts`（`pushQuoteEntry` L620、`listCachedProviderQuoteHistory` L731、`getMarketQuoteHistoryDiagnostics` L2670、`getMarketBarDiagnostics` L4037、`computeMarketDataOverview` L4204、`resetMarketDataWorkspaceState` L4425）
- `apps/api/src/market-data-store.ts`（cold-path 重放來源；案 B / PR-4 快照持久化模板）
- `apps/api/src/server.ts`（/overview 路由 L1237 與 cron/boot 掛載點）
- `apps/api/src/__tests__/market-data-overview-concurrency-memo.test.ts`（回歸護欄 + parity/bench 測試落點）
- `packages/contracts/src/marketData.ts`（quality summary schema，若快照/聚合需新 schema 邊界）

---
Elva 裁決記錄（2026-07-22 夜）：採推薦案 A＋D-lite，按 PR-1→PR-4 序落地。market-data.ts 與 Jason 現行任務同 lane，等 Jason 本輪三票收工後接續派工，不並行動同檔。
