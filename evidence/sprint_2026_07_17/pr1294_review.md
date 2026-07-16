# PR #1294 Desk Review — Pete 2026-07-17

## 1. PR Intent
- 修復昨晚 P0：`isTwTradingDay()` 的裸 `db.execute()` 零 timeout/零快取，被 3 個獨立端點（`heatmap/twse`、`heatmap/kgi-core`、`companies/:id/quote/realtime`）共用呼叫鏈命中；一次未 bound 的查詢真的掛住（非 reject）→ `getStockDayAllRows()` 的模組級單例 in-flight promise `_stockDayAllInflight` 的 cleanup 只在內層 `finally` 跑，內層永不 settle → cleanup 永不跑 → 單例永久指向掛死 promise → 全端點集體卡死 14 小時，僅重啟能清。
- 三段修復：① `trading-calendar.ts` `isTwTradingDay()` 加 3s `Promise.race` bound + per-date 成功結果快取 ② `getStockDayAllRows`/`getTpexMainboardCloseRows` 把 cleanup 從內層 `finally` 移到外層 20s `Promise.race` 的 `.finally`，結構性保證單例必清 ③ `server.ts` kgi-core 兩處直接 DB 呼叫（`quote_last_close` fallback、sector lookup）套同款 3s `withDbTimeout` wrapper。
- 對應 sprint task：W6 2026-07-17 P0 hotfix（獨立於同日 #1292 web 層 timeout 修復，各自 merge）。
- Base branch：`main`（PR 描述的 base #1292 已於 2026-07-16 17:36 MERGED，本 PR CI 已在 rebase 後的 main 上跑綠，非 stale base）。

## 2. Diff Summary
- 改了 4 個檔（+405 / -27 LOC，多數是 §8/§9 RCA 報告文字）
- 主要改動：
  - `apps/api/src/lib/trading-calendar.ts` — `isTwTradingDay()` 加 3s bound + `_tradingDayCache: Map<string, boolean>`（只快取「成功讀到的答案」，timeout/DB 缺表兩種 fail-open 路徑刻意不快取）
  - `apps/api/src/data-sources/twse-openapi-client.ts` — `getStockDayAllRows()`/`getTpexMainboardCloseRows()` 的 in-flight 單例改成外層 20s race 包住，cleanup 移到外層 `.finally`
  - `apps/api/src/server.ts` — `heatmap/kgi-core` handler 內兩處直接 DB 呼叫加本地 `withDbTimeout()` helper（3s）
  - `reports/sprint_2026_07_17/MARKET_INTEL_OUTAGE_RCA_2026_07_17.md` — 補 §8（isTwTradingDay 根因）+ §9（in-flight 單例 wedge 機制，含重啟秒復原證據表）

## 3. IUF Blocker Checklist

### A. Kill-switch / Real-order Safety — PASS
- grep 全 diff：`kill_switch`/`KILL_SWITCH`/`EXECUTION_MODE`/`place_order`/`submit_order`/`order.create`/`order/create` 零命中。
- 額外驗證：`git grep -ln isTwTradingDay` 全 repo 呼叫者只 6 處（`twse-openapi-client.ts`、`openalice-pipeline.ts`×3、`server.ts`×2），全部是**行情展示/OpenAlice 內容產製節流**用途（heatmap 顯示 tier 選擇、EOD cron fallback 判斷、daily-brief 補產生日期），**沒有一處落在下單/broker/strategy-engine 路徑**（`git grep isTwTradingDay -- broker/ strategy-engine.ts order-driver.ts` 零命中）。這條快取即使算錯也不影響送單 gate。

### B. Auth / Secret Hygiene — PASS
- 無新 endpoint；`heatmap/kgi-core` 既有 `c.get("session")` 用法不變。
- grep 全 diff：無 hardcoded key/token/password。
- 無 env var 新增。
- 無 person_id/userId/sessionId log 洩漏（新增 log 只印 timeout 訊息 + label 字串）。

### C. State / Schema Integrity — N/A（無 DB migration / enum / state machine 變更）
- Runtime state 風險：本 PR **正是修復** module-level singleton 卡死問題（見 Findings #1 對「修復是否徹底」的追加分析），非新增此類風險。

### D. PR Hygiene — PASS
- Title 對應 `fix(api): ... (P0)` pattern，符合 sprint。
- Commit message 遵循 conventional commits（`fix(api):` / `docs(reports):`）。
- Base branch = main，非 stacked chain 誤指；#1292 已 merge，非同批衝突風險（PR body 已誠實揭露 RCA 檔 add/add 衝突處理方式）。
- 🟡 PR body 測試清單 CI 勾選框仍是 `[ ]` 未打勾，但 `gh pr checks 1294` 實測 **5/5 全綠**（validate/W6/A2/DB-mode/Playwright）— body 描述落後於實際 CI 結果，非阻擋但建議更新。

### E. IUF-Specific 不可越線 — PASS
- 無 agent 越 lane（本 PR 純 Jason backend lane 範圍）。
- 無 governance bypass（DRAFT 狀態、未 merge，mergeStateStatus=CLEAN）。
- 無 KGI gateway `/order/create` 呼叫。
- Evidence/報告內容無 person_id 明碼、無 token。

## 4. Findings — Priority Ranked

### 🔴 Blockers
（無）

### 🟡 Suggestions (should fix)

1. **[結構性殘留風險] `Promise.race` timeout 不會真的取消底層 DB 呼叫，重複發生時仍可能耗盡連線池**
   - 位置：`apps/api/src/lib/trading-calendar.ts:63-70`（3s race）、`apps/api/src/data-sources/twse-openapi-client.ts:44-56`（20s outer race）、`apps/api/src/server.ts:209-249`（`withDbTimeout`）
   - 原因：三處修復都是「client 端不等了」，底層真正掛住的 `db.execute()`/`getLastCloses()`/`db.select()` 呼叫本身**沒有被 abort**，仍佔用 postgres-js pool 連線直到它自己 settle（可能永遠不 settle）。若同一種 DB 壓力事件在製程存活期間重複出現多次，每次都會留下一個孤兒 promise 佔住一個連線，pool（`max: 10-20`，RCA §8.2 自己引用）可能被慢慢耗盡，屆時新請求會在**連線取得階段**卡住——這是 Promise.race 包裝完全防不住的下一層失敗模式，等於把「應用層可見的掛死」換成「不可見的資源洩漏」。
   - 驗證：手動追蹤三處 race 實作，確認皆無 `AbortController`/取消底層 query 的機制；作者在 RCA §8.6/§9.6 已誠實揭露「exact cause of pool pressure 未查證」，但沒提到 race-不取消=潛在連線洩漏這一點。
   - 建議：後續 PR 在 `packages/db/src/client.ts` 的 postgres-js 連線設定加 `statement_timeout`（DB 端真正終止查詢，而非 client 端假裝不等），並監控 pool 使用率/等待佇列長度作為告警訊號。不阻擋本次 P0 merge（本次修的是「client 集體卡死 14 小時」這個已發生且更嚴重的問題，且已比修前好非常多）。

2. **[缺回歸測試] 本 PR 修復的正是「wedge 不可再發生」這個結構保證，但零新增測試驗證它**
   - 位置：diff 只觸及 `trading-calendar.ts` / `twse-openapi-client.ts` / `server.ts` / RCA 報告，`apps/api/src/__tests__/` 或任何 `*.test.ts` 皆無改動；`git grep getStockDayAllRows -- apps/api/src/__tests__` 零命中——這個函式（包含它的 in-flight 單例）目前完全沒有單元測試涵蓋，包含這次修復前後。
   - 原因：`getStockDayAllRows(fetchOverride?, isTradingDayOverride?)` 本身已經預留測試用 DI hook（見函式簽名 + doc comment "isTradingDayOverride is test-only DI"），加一個「`isTradingDayOverride` 回傳一個永不 resolve 的 promise，用 fake timer 快轉 20s，斷言 `_stockDayAllInflight` 已清空且下一次呼叫會重新嘗試」的測試成本很低，且直接對應這次事故的根因機制。RCA §9.4 自己承認上一次犯的錯就是「in-flight dedup pattern 早於 isTwTradingDay 加入，沒人重新稽核過它的 settlement 保證」——這次修復同一個不變式，若未來又有人在 `attempt` IIFE 裡加一個新的未 bound await，沒有測試會攔到同一類迴歸。
   - 建議：非阻擋本次 P0 合併（我已手動逐行推導過三處 race 的 clear 語意，結構正確——見下方 Praise），但強烈建議下一個 non-P0 PR 立刻補上這個測試，優先序高於一般 backlog（同一個不變式已經無聲 regress 過一次）。

3. **[快取 key 依賴上游 TZ 正確性未在本 PR 內驗證，但本 PR 未改變此假設]**
   - 位置：`apps/api/src/lib/trading-calendar.ts:33`（`isTwTradingDay(tradingDate: string)` 快取 key = 呼叫者傳入的字串）
   - 原因：追蹤全部 6 個呼叫者的 `tradingDate` 來源——`server.ts:13231`（`_isKgiHeatmapAfterHours` 用 `new Date(nowMs + 8*3600*1000).toISOString().slice(0,10)` 手動 +8）、`server.ts:19490`（`_twseEodCronTodayIso()` 用 `toLocaleDateString("en-CA",{timeZone:"Asia/Taipei"})`）、`openalice-pipeline.ts` 三處用 `getTaipeiDate()` helper——全部已是台北時區正確算法，非本 PR 新增或修改。新增的 per-date 快取只是把「同一個已經算對的日期字串」的查詢結果記起來，不會把一個原本錯誤的 UTC 跨日答案「放大成永久快取」——因為若上游真的算錯日期，快取前後给出的答案本來就相同（fail-open 邏輯也沒變）。此項純粹是驗證「快取沒有把既有假設變得更脆弱」，非新發現的 bug。
   - 建議：無需在本 PR 動作；下次任何人改動這 6 個呼叫點的日期計算邏輯時，記得快取是 keyed by 呼叫者傳入的字串，任何上游 TZ 算法變動都會直接反映在快取行為上（一體適用，非額外風險）。

### 💭 Nits
1. PR body 的 test-plan checklist（CI 未勾）已落後於 `gh pr checks 1294` 顯示的 5/5 全綠實況，merge 前順手勾起來即可，純文書。
2. `withDbTimeout()` 在 `server.ts` 是函式內部 local function（每次 request 重新定義一次），跟同檔案其他 helper 慣例（module-level function）不一致；功能上無影響，且改動範圍已經很克制（Surgical Changes），不要求本輪動它。

### ✅ Praise
- Surgical Changes 教科書等級：三處程式碼改動每一行都直接對應 RCA 找到的三個具體病灶（isTwTradingDay 無 bound、in-flight 單例 cleanup 卡在內層 finally、kgi-core 兩處裸 DB call），沒有夾帶任何無關重構或順手美化。
- Timeout/degraded 讀取「刻意不快取」的區分（成功答案才快取，timeout/缺表答案永遠重試）是正確且深思熟慮的設計——避免把一次性 DB 壓力事件錯誤地固化成永久答案，這正是本 PR 想避免的「假資料」風險的鏡像版本。
- RCA §9 誠實記錄了「這個不變式為何在第一次就沒被稽核到」（in-flight dedup pattern 早於 isTwTradingDay 存在），這種歸因層級的誠實揭露，對後續類似 PR 的可信度很有幫助。

## 5. Verdict
- [x] APPROVED — 可 ready，無 blocker（0 🔴，3 🟡 建議 fast-follow，非阻擋）
- [ ] NEEDS_FIX
- [ ] BLOCKED

**Verdict 理由**：這是一個結構正確、範圍克制的 P0 事故修復。我逐行手動推導了兩個最擔心的競態場景：
1. 「timeout 後舊 promise 晚 settle 是否把新 in-flight 蓋掉」——不會：`if (_stockDayAllInflight) return _stockDayAllInflight;` guard 保證同一時間只有一個單例存活，新的 attempt 只會在舊的外層 race 已經 `.finally()` 清空之後才被建立，JS 單執行緒 + `.finally` 緊接 settle 執行（無 I/O 插入空間），不存在「新單例被舊 settle 蓋掉」的窗口。
2. 「交易日快取是否會把 DB 暫時掛的結果誤存成非交易日」——不會：兩處 fail-open 分支（timeout catch / DB 缺表 catch）都明確標註「deliberately NOT cached」，且 code 對應正確（只 return true，沒有 `_tradingDayCache.set` 呼叫）。

唯一保留的 🟡 是「client 端 timeout 不等於底層取消」這個更深一層的資源洩漏可能性，以及「這麼關鍵的不變式應該有測試」——兩者都不阻擋這次把「14 小時全端點卡死」換成「3s/20s 內優雅降級」的淨改善，且都已列為明確 fast-follow。

## 6. Suggested Owner for Fixes
- 🟡 #1（pool 連線洩漏/statement_timeout）→ Jason（下個 non-P0 PR，`packages/db/src/client.ts`）
- 🟡 #2（缺回歸測試）→ Jason（優先序高於一般 backlog，同不變式已無聲 regress 一次）
- 🟡 #3（TZ 假設記錄）→ 無需分派，純知識記錄
- 💭 #1/#2 → Jason（順手，merge 前後皆可）

## 7. Re-review Required
NO — 三個 🟡 皆非阻擋項，可在 fast-follow PR 處理；若 owner 選擇在本 PR 內順手補測試，歡迎但不要求。

---
Reviewer: Pete
Date: 2026-07-17
Sprint: W6 Day (2026-07-17 P0 hotfix)
