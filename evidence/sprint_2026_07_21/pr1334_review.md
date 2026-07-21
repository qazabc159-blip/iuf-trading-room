# PR #1334 Desk Review — Pete 2026-07-21

## 1. PR Intent
- 首頁 4 支行情源端點中，KGI 兩支（`getKgiMarketOverview`／`getKgiCoreHeatmap`）零快取——每次呼叫都直打 KGI gateway（2 個/40 個 round-trip）——加 2000ms TTL Promise-memo；`/market/heatmap/kgi-core` route 內兩個互不依賴的 await（`getKgiCoreHeatmap()` + `getStockDayAllRows()`）從 sequential 改 `Promise.all`。續 #1333 首頁延遲工作，RCA 明確排除 `market-data.ts` 的 `withFreshness()` Zod 熱路徑（那是別票，這裡零觸碰）。
- 對應 sprint task：7/21 首頁行情內容延遲 P0（Elva dispatch，「~11-way concurrent fan-out」症狀）。
- Base branch：main（正確，CI 5/5 綠：validate / W6 audit / Secret Regression / Playwright P0 / DB-mode tests）。

## 2. Diff Summary
- 改 3 個生產檔 + 1 個 RCA 報告：`kgi-subscription-manager.ts`（+65/-0）、`server.ts`（+18/-4，僅 1 條 route）、`__tests__/kgi-subscription-manager.test.ts`（+42，QM17/QM18）。
- LOC: +281 / -4（含 RCA 文件 160 行）。
- 主要改動：兩個 module-level 2s TTL memo（存 promise 非已 resolve 值）＋一條 route 的 `Promise.all` 重排。

## 3. IUF Blocker Checklist
- A Kill-switch/真單：PASS — 零觸碰 `broker/*`、`execution-mode.ts`、`risk-engine.ts`；grep 全 diff 無 `place_order`/`KILL_SWITCH`/`EXECUTION_MODE`。兩支函式僅被 `server.ts` 兩條 GET 顯示路由呼叫（`/market/overview/kgi`、`/market/heatmap/kgi-core`），親自 grep 全 repo 確認無其他呼叫端。
- B Auth/Secret：PASS — 未新增 endpoint，未動 middleware；無 hardcode secret。
- C State/Schema：PASS — 無 DB migration；純 in-process module-level變數，`_resetSubscriptionManager()` 已同步加清除（`_overviewMemo=null`/`_coreHeatmapMemo=null`），沒有遺漏既有 test isolation 慣例。
- D PR Hygiene：PASS — DRAFT 起手、branch 命名符規、conventional commit、PR description 與 diff 完全一致（親對照確認）、明寫「not self-merging」。
- E 越線：PASS — 無 governance bypass；PR 誠實承認自己不解決 CPU-contention（#1333 的殘留），未越權宣稱戰功。

## 4. Findings — Priority Ranked

### 🔴 Blockers
無。

### 🟡 Suggestions
1. **2s TTL memo 只測「並發共享一次 fetch」與「reset 清空」，沒測「TTL 過期後真的重打」**
   - 位置：`apps/api/src/__tests__/kgi-subscription-manager.test.ts` QM17/QM18
   - 原因：兩個新測試只驗證「3 個並發呼叫在 TTL 窗內共用 1 次 gateway round-trip」，靠 `_resetSubscriptionManager()` 才驗到「清空後重打」；沒有一個測試驗證「等超過 2000ms 後、不 reset 的情況下也會自然重打」（即 memo 過期語意本身）。`node:test` 沒用 fake timer，補這項要嘛注入時間源、要嘛用短 TTL 常數 export 出來配合真 sleep。
   - 建議：追加 QM19（或 Jason 自行擴充現有兩案）驗證 TTL 到期後 `tickCallCount` 會再增加，鎖死「memo 不會變相永久快取」這個安全承諾。非本票 blocker（邏輯本身是簡單 `now - at < TTL` 比較，人工審查已可信；只是自動化覆蓋有缺口）。

2. **RCA 文件的 Promise-memo pattern 描述「mirrors #1323」，但兩者失效語意其實不同，值得補一句避免未來誤讀**
   - 位置：`kgi-subscription-manager.ts` 兩處 docstring；`RCA_HOME_MARKET_ENDPOINTS_2026_07_21.md`
   - 原因：#1323（`market-data.ts`）的 memo 是「TTL + write-generation 雙閘」，因為它快取的是本地可變 cache 的衍生值（有寫入會使其失真的風險，round4/round5 還為此修正過 invalidation 粒度）；本票是純外部 gateway fetch 的 memo，沒有本地寫入源可失真，TTL-only 語意正確、不需要 generation 閘（我親自驗證過這個差異合理，不是漏做）。但兩處 docstring 用「mirrors #1323」可能讓未來讀者誤以為兩者是同一種安全模型並直接複製貼上到一個「有寫入源」的場景。
   - 建議：docstring 加一句「TTL-only 在此安全，因為沒有本地 write path 可使其失真；若未來這兩支函式改成讀本地 cache，需比照 #1323 加 generation 閘」，防止下次不同場景誤搬。

### 💭 Nits
- `getKgiCoreHeatmap()` 的 `_coreHeatmapMemo` 型別用 `ReturnType<typeof _getKgiCoreHeatmapUncached>`（是 Promise 型別），跟 `_overviewMemo` 寫法一致，命名/風格工整，無需改動——僅記錄「兩處 memo 實作完全對稱」方便下次回審快速比對。

### ✅ Praise
- **Promise-memo（非 resolved-value-memo）是正確選擇**：兩處都是「先建 promise、存 promise、回傳 promise」，並發呼叫者共享同一個 in-flight promise，不會出現「兩個呼叫都 miss、各自重打」的 race（這正是我原本最擔心 #1323 那類 memo 會踩的坑——但 #1323 其實是同步函式無此風險，本票才是真正的 async 並發場景，且做對了）。QM17/QM18 用 mock `tickCallCount` 精確驗證「3 併發呼叫只打 2 次 round-trip」「2 併發只打 40 次（非 80 次）」，是真打中并发去重症狀的斷言，非裝飾性。
- **2s TTL < 端點自報 5s staleAfterSec 契約**：docstring 兩處都明講這個算術關係，不是隨手選數字；且底層 `fetchKgiLatestTick` 本身已有 `AbortSignal.timeout(3_000)`，就算 gateway 真掛，memo 持有的 promise 最多 3s 內 reject/resolve，不會製造新的永久掛死風險（掛死三連問全過：①有 timeout ②不需要外層 race，本身已夠短 ③module-level singleton 有 TTL 自癒，非 #1292 那種永久 wedge）。
- **RCA 文件誠實度高**：明確排除自己不是 CPU-contention 的解方（那是 #1333 的地盤），Scenario 2 甚至誠實寫出「Fix B 的效益在這個 4 端點 batch 裡被 TWSE 端既有的 `_stockDayAllInflight` dedup 機制部分掩蓋」——沒有誇大戰功，數字來自可重跑腳本（`git stash` 前後對照真程式碼），不是憑空聲稱。
- **`Promise.all` 重排零資料依賴**：親自讀完整條 route（`kgiResult.tiles` 只用於後續 `dbCloseMap`/`sectorMap` 查詢，`twseRows` 獨立用於 Tier 2 fallback），確認兩個 await 之間毫無耦合，重排合法。

## 5. Verdict
- [x] APPROVED — 可 ready，無 blocker（2 條 🟡 建議合併時一併記錄，不擋 merge）

## 6. Suggested Owner for Fixes
- 🟡 #1（TTL 過期測試缺口）→ Jason（順手票或下次碰這支檔案時補）
- 🟡 #2（docstring 補一句差異說明）→ Jason（cosmetic，非阻擋）

## 7. Re-review Required
NO

---
Reviewer: Pete
Date: 2026-07-21
Sprint: W7 Day (盤中熱修)
