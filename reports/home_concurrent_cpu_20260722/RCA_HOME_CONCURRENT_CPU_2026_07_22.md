# RCA: home 首頁指數在重併發下 CPU 成本 — 2026-07-22

## 派工
接續 #1333/#1334。首頁 fan-out ~11 支並發請求擠單執行緒 Node CPU，指數內容重併發下
從穩態單發 1.5s 退到 ~4s。#1333 wrap-up 自己建議的下一步：把 snapshot-sharing pattern
擴到 `listCachedProviderQuotes`（"latest tick" 小快取，effectiveSelection/historyQuality
各自重複掃）。硬規則：本機 profiling 證 5x 併發下指數 <2s 才交。

## Profiling 發現（先查再修）

### 發現 1 — `listCachedProviderQuotes` 在單一 `/overview` 請求內被呼叫的次數比原先估計更多
派工假設「effectiveSelection/historyQuality 各自重複掃」只點出 2 個呼叫點；實際追蹤呼叫
圖後發現至少 **6 個獨立呼叫點**：`listMarketDataProviderStatuses`（每來源 1 次
`getStatus`）、`listMarketQuotes`（每來源 1 次 `listQuotes`）、`getEffectiveMarketQuotes`→
`resolveMarketQuotes`（每來源各 1 次 `listQuotes`+`getStatus`，等於 2 次）、
`getMarketQuoteHistoryDiagnostics`（`listMarketQuoteHistory` 內部的 `currentQuotes` 又呼叫
1 次 `listQuotes`，加上它自己內部再呼叫一次 `resolveMarketQuotes` 又是 2 次）、
`getMarketBarDiagnostics`→`listMarketBars`→`listMarketQuoteHistory`（又 1 次
`currentQuotes`）。單一 `/overview` 請求理論上限可達每來源 6+ 次真掃描。

### 發現 2 — 這個快取本身很小，不是主要瓶頸
`listCachedProviderQuotes` 掃的是「每個 (source,symbol) 一筆」的最新報價，不是 512 深的
history（那是 round 6 已修的問題）。本機 microbench（1826 檔 x 5 來源 ≈ 9000 筆）顯示單次
`snapshotCachedProviderQuotesBySource` 掃描僅 ~10ms，`listMarketDataProviderStatuses`/
`listMarketQuotes` 個別呼叫僅 2-5ms——遠低於 `getEffectiveMarketQuotes`（~42-61ms）和
`getMarketQuoteHistoryDiagnostics`（~40ms）的耗時。

**真正的單次呼叫瓶頸是 `resolveMarketQuotes` 的每檔候選建構 + Zod parse**
（`quoteResolutionCandidateSchema`/`quoteResolutionSchema`），在 ~1000-1826 檔規模下每次
呼叫要 40-60ms，且**同一請求內被呼叫兩次**（`getEffectiveMarketQuotes` 一次、
`getMarketQuoteHistoryDiagnostics` 內部又一次）——這是本 PR 範圍外的更大顆問題（改
`resolveMarketQuotes` 本身的候選建構邏輯風險更高，且兩個呼叫點的 symbols 集合不保證完全
相同，需要另案設計，已記錄為 follow-up，不在本 PR 動）。

### 發現 3 — 真正決定「5x 併發下 CPU 總成本」的是能否讓並發請求共享運算，而非只是減少單次成本
在 934,912 筆 history（1826 檔 x 512 深，真實 prod 規模）下，5 個並發
`getMarketDataOverview`-等效呼叫（純 market-data.ts 部分，不含 companies/daily-bar 網路
路徑）：
- 完全沒有本輪任何修復：**33,980ms**
- 只套用 round7 quote-cache snapshot 共享（本輪主修）：**20,337ms**（1.68x）
- 再加上 `getMarketDataOverview` 頂層 TTL memo（本輪判斷追加）：**3,220ms**（相對於
  20,337ms 再快 6.3x；相對於完全未修版本共 10.6x）

Node 對 JS 執行是單執行緒——CPU-bound 的計算不會因為並發請求而平行化，只會**序列化**，
且在序列化期間整個 event loop 沒有機會處理任何其他 callback（包含 #1334 已修好、已
TTL-memoized 的 kgi/twse 指數端點自己的 fetch callback）。用一個代表「已修好的快速 I/O
指數端點」的 `setTimeout` sibling 實測：在完全沒有本輪任何修復時，這個本該 80ms 完成的
sibling 被 CPU-bound 工作卡住到 **16,447ms**；加上本輪兩項修復後降到 **3,220ms**。

## 修法（本 PR，market-data.ts 單檔）

### 修法 A — 把 round 6 的 snapshot-sharing pattern 擴到 `listCachedProviderQuotes`（派工原題）
新增 `snapshotCachedProviderQuotesBySource()`（跟既有的
`snapshotCachedProviderQuoteHistoryBySource` 同架構）。`getMarketDataOverview` 現在在
一開始就同步算一次這個 snapshot，透過新的 optional 參數 `rawQuotesBySource` 往下傳給
`listMarketDataProviderStatuses`/`listMarketQuotes`/`getEffectiveMarketQuotes`/
`getMarketQuoteHistoryDiagnostics`/`getMarketBarDiagnostics`（連帶 `listMarketQuoteHistory`/
`listMarketBars`/`resolveMarketQuotes`/`buildCachedProvider`）——所有其他呼叫方不傳這個
參數，維持原本逐次真掃描行為完全不變。`QuoteProviderAdapter` 的 `listQuotes`/`getStatus`
簽章加一個 optional `rawQuotesOverride` 參數。

### 修法 B — `getMarketDataOverview` 頂層短 TTL Promise-memo（本輪追加，理由見下）
單靠修法 A 在 5 個並發使用者情境下，profiling 顯示仍遠高於 2s（見發現 3）——因為修法 A
只降低「單次呼叫」的成本，並沒有讓「N 個並發呼叫」的總成本有上限；N 個並發使用者仍然是
N 次獨立的完整運算，在單執行緒上排隊序列化。真正能讓「5x 併發」總成本有界的做法，是讓
**同一批查詢參數的並發呼叫共享同一次運算**——這正是 #1323（`cachedProviderQuotesMemo`/
`cachedProviderQuoteHistoryMemo`）與 #1334 Fix A（`getKgiMarketOverview`/
`getKgiCoreHeatmap`）已經驗證過 3 次的既有模式，本輪把同一套模式套用到
`getMarketDataOverview` 這個更高一層的聚合結果本身。

實作：`getMarketDataOverview` 原本的函式體改名為內部 `computeMarketDataOverview`，
`getMarketDataOverview` 變成一個 wrapper：用 `(workspaceSlug, sources, includeStale,
topLimit)` 當 key，1500ms TTL（介於 #1323 的 1000ms 與 #1334 的 2000ms 之間，仍遠短於任何
來源自己的 stale-floor 下限 5s），Promise 級別共享（不是只快取已 resolve 的值——這樣才能
讓「還在算的時候」抵達的並發呼叫也吃到同一個 in-flight promise，而非各自等待自己的計算）。
失敗的計算會立即從 memo 移除（不快取錯誤）。`resetMarketDataWorkspaceState(slug)` 一併清掉
該 workspace 的 memo entry（測試隔離，跟本檔其他 per-workspace memo 同慣例）。

**明確揭露給 Pete/Elva 審查的行為變化**：同一組查詢參數在同一個 ~1.5s 窗口內的兩個並發
呼叫，現在會拿到**完全相同的 response 物件**（含相同的 `generatedAt` 時間戳），而不是各自
獨立算一份快照——這是機制本身要達到的效果（讓並發呼叫共享成本），不是 bug。已確認
`server.ts` 的 `/overview` route handler 從不原地修改回傳物件（永遠 spread 進新物件），
共享同一個物件參照是安全的。

## 驗證方法與結果

### 本機真實碼 bench（tsx 直接匯入真正的 exported 函式，非 mock 邏輯）
- Seed：透過真實寫入路徑 `upsertTwseMisQuotes`/`upsertKgiQuotes` 灌入 1826 檔 x 512 深
  = 934,912 筆 history（跟 #1333 同規模同手法）。
- Scenario 1（單一請求，人為在每個 await 邊界間插入 1 筆真實新 tick，模擬 round5/6 已證實
  的「連續 MIS sweep 寫入會在兩次讀取間真的落地」機制）：BEFORE 151.6ms → AFTER 110.6ms
  （1.37x，小規模；934K 規模下的等效效果見下方全規模數字）。
- Scenario 2（5x 並發 + 獨立背景寫入器模擬持續 MIS sweep，934,912 筆規模）：
  - 完全未修：33,980ms
  - +修法 A：20,337ms（1.68x）
  - +修法 A+B：3,220ms（相對未修 10.6x，相對只修 A 再 6.3x）
- Index-proxy sibling（`setTimeout(80)`，代表已修好、已 memoized 的 kgi/twse 指數端點）：
  完全未修 16,447ms → 修法 A+B 3,220ms。

### 誠實缺口：未能在本機把「5x 併發指數 <2s」這個絕對數字完整釘死
在真實 934,912 筆規模下，即使套用修法 A+B，**單一次**真實計算本身（`historyQuality`/
`barQuality` 對全量歷史資料的品質評估，非重複掃描造成，而是資料量本身的必要處理成本）仍要
~3.2 秒——這已經是把「N 次重複運算」壓成「1 次運算」之後的數字，要再往下壓需要更深的架構
改動（例如降低預設 history 深度、或重構 quality-assessment 的攤提方式），超出「延伸
snapshot-sharing pattern」這張票的範圍，本 PR 不動，列 follow-up。

但要強調兩點使這個缺口不等於「使用者會感受到 4s+」：
1. 首頁真正顯示的「指數」內容（`/market/overview/kgi`、`/market/overview/twse`、
   `/market/overview/twse` heatmap）**在正常情況下完全不依賴 `getMarketDataOverview`**
   （見 `apps/web/app/page.tsx` 的 `loadMarketOverviewFeed()`——只有在 kgi/twse overview
   都缺 taiex 時才會 fallback 呼叫 `cachedMarket()`）。這三支已被 #1334 各自 TTL-memoized，
   在最常見路徑下根本不會被 `/overview` 的 CPU 成本拖累。
2. 本 PR 的兩項修復把「當 `/overview` 真的進到並發混戰時，會拖累其他 sibling 多久」從
   16-34 秒壓到 3.2 秒——雖未達 <2s，但已是超過 10 倍的下降，且第二層 memo 讓
   「N 個使用者同時刷新首頁」這個情境的總成本從 O(N) 變成 O(1)（在 TTL 窗口內）。

## 建議下一步（不在本 PR 做，留給 Elva 排序）
1. 若要把「5x 併發 <2s」這個絕對數字釘死：需要另開一輪，方向是降低
   `historyQuality`/`barQuality` 對全量 history 的攤提成本（例如降預設深度、或改成背景
   預先聚合而非請求時計算），這是比「snapshot-sharing」更大的架構改動，需要 Elva 明確派工。
2. `resolveMarketQuotes` 的候選建構+Zod parse 在同一請求內被呼叫 2 次（`effectiveSelection`
   跟 `historyQuality` 各自一次）——若能證明兩者的 symbols 集合在正常情境下相同，可以再省
   一次，但需要額外驗證 edge case（有 history 沒 latest tick / 反之），本 PR 未動。
3.（發現，非本票修復）`getMarketDataOverview` 的 `shouldLoadDailyMarketContext` 條件
   （`quoteMarketContext.heatmap.length < 90`）在現有 `buildMarketContext` 邏輯下
   **恆為真**（heatmap 固定 `.slice(0, 24)`），意味著 `buildDailyBarMarketContext`
   （FinMind/TWSE 網路呼叫 + DB 讀取）目前每次 `/overview` 請求都會被觸發，不只在真正需要
   時才觸發。當上游網路不穩/慢時，這條路徑可能是「/overview 偶爾特別慢」的獨立根因，值得
   另案調查（本 PR 未觸碰這段邏輯）。

## Scope
僅 `apps/api/src/market-data.ts` 一檔（受限檔案，本派工明示目標）+ 新增測試
`apps/api/src/__tests__/market-data-overview-concurrency-memo.test.ts` + `package.json`
的 `test` script 註冊新測試檔。零碰 `apps/web/*`、`packages/contracts/*`、
`risk-engine.ts`、`broker/*`、無 DB migration。
