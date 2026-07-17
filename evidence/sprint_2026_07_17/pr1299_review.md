# PR #1299 Desk Review — Pete 2026-07-18

## 1. PR Intent
- 修 #1298 merge 後 Elva prod re-verify 抓到的同頁自相矛盾：首頁指數 headline 顯示 45,624.98／標「07/16」（平盤），但熱力圖磚/漲跌排行同頁顯示真實 -7~-10% 崩盤值標「07/17」。
- 根因：`_fetchTwseMarketOverviewUncached()` Tier 1（MI_5MINS_INDEX）永遠查 wall-clock「今天」；一旦跨午夜進入非交易日（07/18 週六），「今天」正確查無資料，但直接落到更落後的 Tier 2（OpenAPI MI_INDEX，親測仍卡 07/16），而非改查「最近一個真交易日」同一可靠源。
- 對應 sprint task：續 #1297/#1298 market-data-integrity-gate 系列，非新開任務。
- Base branch：`main`（正確，非疊層 chain 的一部分，獨立 hotfix）。

## 2. Diff Summary
- 改了 4 個檔，+244/−1
- `apps/api/src/data-sources/twse-openapi-client.ts`：新增 `mostRecentTradingDayYYYYMMDD()`（純函式，逐日往回查 `isTwTradingDay()`，bound 10 天）＋ Tier 1.5（今天查無資料時，改用同一 MI_5MINS_INDEX 源查最近交易日，成功即用，否則才落 Tier 2）
- `apps/api/src/__tests__/twse-market-overview.test.ts`：+4 測試（T7/T7b/T7c/T7d）
- `package.json`：把既有但從未被 `pnpm test` 引用的 `twse-market-overview.test.ts`（含 T1-T6 共 14 個既有測試）補接進 CI 測試清單
- `reports/sprint_2026_07_17/MARKET_DATA_INTEGRITY_GATE_DESIGN_2026_07_17.md`：Round 3 RCA 追記（含官方源互證、多管線缺口誠實揭露）

## 3. IUF Blocker Checklist
- §A Kill-switch/Real-order：PASS — diff 僅觸及 market-data 讀取層 + test + package.json + 報告文件，grep 無 `KILL_SWITCH`/`EXECUTION_MODE`/`place_order`/`submit_order`/`kgi.order.create`，W6 No-Real-Order Audit CI 綠。
- §B Auth/Secret：N/A — 無新 endpoint、無 secret、無 session 邊界改動。Secret Regression Check CI 綠。
- §C State/Schema：N/A — 無 migration、無 enum/status 變更、無新 runtime state（`mostRecentTradingDayYYYYMMDD` 是純函式，唯一 in-memory 依賴 `_tradingDayCache` 是既有 #1294 已審過的模組級快取，本 PR 未新增）。
- §D PR Hygiene：PASS — 分支/commit 命名符合慣例，conventional commit `fix(market-data): ...`，DRAFT 起手，body 含根因/修法/測試結果/已知 gap（多管線架構張力誠實列為 explicitly NOT attempted），CI 5 項全綠（validate/W6/Secret/DB-mode/Playwright P0）。
- §E 不可越線：PASS — 未越 lane（Jason 動的是他自己 backend 領域）、未 governance bypass、無 KGI `/order/create`、報告文件無 person_id/token 明碼。

## 4. Findings — Priority Ranked

### 🔴 Blockers (must fix before ready)
無。核心修復邏輯經逐行推演驗證安全（見下方推演），無真金/kill-switch 觸碰，CI 全綠。

### 🟡 Suggestions (should fix)
1. **T7d 會在本週末後永久靜默退化成空測試**：`apps/api/src/__tests__/twse-market-overview.test.ts:684-686`（`if (lastTradingDay !== "20260717") { return; }`）。T7d 是唯一驗證「Tier 1.5 真的被 `getTwseMarketOverview()` wiring 呼叫且解出正確崩盤值 42,671.27/-6.47%」的整合測試，但它靠 wall-clock 判斷「今天」是否解出 20260717 才執行斷言 — 過了這個週末（約 2026-07-20 起），這個條件永遠不成立，測試會每次都靜默 `return`（0 assertion 執行）但仍回報 PASS，且無任何警示。PR 自己文件宣稱測試「fully deterministic」只對 T7/T7b/T7c 成立，T7d 不成立卻沒有在 PR body 中特別註明這個時效性。
   - 建議：比照本檔既有 `fetchOverride` DI pattern，替 `_fetchTwseMarketOverviewUncached`/`getTwseMarketOverview` 加一個輕量 `todayOverride` 參數（純測試用），讓 T7d 可以強制模擬「今天=07/18」而不必依賴真實 wall-clock，使其成為永久回歸測試而非週末限定的一次性驗證。
   - Owner: Jason（fast-follow，非本次 P0 hotfix 阻擋項）。

2. **順便揪出的系統性缺口，建議另立稽核任務**：本 PR 誠實揭露 `twse-market-overview.test.ts`（T1-T6 共 14 個既有測試，涵蓋 MI_5MINS_INDEX 主/備援切換、LKG fallback、heatmap 聚合等本次事故最相關的既有防線）在此之前**從未被 `pnpm test`/CI 引用過**（`package.json` 舊版完全不含這個檔名）。這解釋了「跟這次 headline 走同一段程式碼的既有測試」為何沒能在 #1298 之前就攔住這類問題。建議 Elva 排一次全 repo 掃描，確認 `apps/api/src/__tests__/*.test.ts` 底下沒有其他孤兒測試檔案未被 `test`/`test:db` 任一清單引用。
   - Owner: Elva 排查任務（非本 PR 阻擋項，PR 本身已修正這一個孤兒）。

### 💭 Nits (nice to have)
1. `mostRecentTradingDayYYYYMMDD()` 逐日呼叫 `isTwTradingDay()`（`twse-openapi-client.ts:1337`），該函式本身已有 3s DB timeout race（#1294 已修）+ 週末快速路徑免查 DB，但農曆春節等最長連假情境下理論上最壞可堆疊到 ~10 次序列 DB 查詢（若剛好遇上 DB 壓力全部 timeout，約 30s）。有界、非掛死，且 `_tradingDayCache` 模組級快取會讓同一 process 內第二次以後的請求全部命中快取，僅首次請求付出此代價 — 影響面小，記錄備查即可，不需本輪處理。

## 5. 核心正確性逐項推演（Elva 要求最高優先審查點回覆）

1. **`mostRecentTradingDayYYYYMMDD()` 交易日曆正確性**：
   - 跨午夜邊界驗證：現在（`date -u` = 2026-07-17 17:13 UTC = 台北 2026-07-18 01:13）呼叫 `mostRecentTradingDayYYYYMMDD("20260718")` — back=0 查 2026-07-18（週六，`dow===6` 週末快速路徑，免查 DB）立即回 false；back=1 查 2026-07-17（週五，非假日，DB 查無列即預設 true）回 true → 函式回傳 `"20260717"`。**正確**，且新測試 T7（`twse-market-overview.test.ts:687`）直接鎖死這個確切案例，T7b 鎖週日、T7c 鎖平日不誤走。
   - 週末/連假：週末走免 DB 的 `dow` 快速路徑；連假（國定假日）走 `tw_trading_calendar` DB 表，若某天不在表裡預設「視為交易日」（既有 `isTwTradingDay` 保守慣例，非本 PR 新增行為）— 若某假日剛好沒進表，效果等同 fallback 回本 PR修復前的行為（直接落 Tier 2），不會比修復前更差，只是沒能改善那個特例，判非阻擋。
   - 台北時區處理：`fromYYYYMMDD` 拆解年月日後全程用 `Date.UTC(...)` 操作，逐日用 `getTime() - back*86400000` 位移再取 `getUTCFullYear/Month/Date`——避免了本環境常踩的「本機 wall-clock 非台北時區」陷阱（因為輸入本身已經是呼叫方算好的台北日期字串，這裡只做純日期算術，不重新讀 `new Date()` 取現在時間）。
   - **盤中呼叫會不會誤抓不完整當日資料**：不會 — Tier 1.5 只在 Tier 1（查「今天」）失敗時才觸發，且觸發後若 `mostRecentTradingDayYYYYMMDD(todayStr)` 算出的最近交易日等於 `todayStr` 本身（今天就是交易日，只是這次查詢失敗或盤前無資料），程式碼會直接跳過 Tier 1.5 重查（`_fetchTwseMarketOverviewUncached` 內 `if (lastTradingDayStr !== todayStr)` 判斷），落到既有 Tier 2 行為——**結構上不可能讓 Tier 1.5 用「今天」的日期去抓一份不完整的當日快照**，這正是 Elva 最擔心的情境，程式碼設計已排除。

2. **會不會過猶不及（該顯示 07/16 卻硬抓 07/17）**：不會 — Tier 1.5 抓到的資料仍要通過既有 `isTwseIndexSnapshotConsistent()` 自洽性檢查（value/change/changePct 三者勾稽），若 07/17 資料當下還沒發布完整（例如剛過午夜 TWSE 尚未 finalize），`fetchTaiwanMarketIndexToday` 會回 `stat!=="OK"` 或空 `data[]` 而回 null，Tier 1.5 失敗後才落 Tier 2——沒有繞過既有防線硬吃資料的路徑。

3. **掛死風險**：Tier 1.5 重用既有 `fetchTaiwanMarketIndexToday()`（本身已有 3 次重試+指數退避+`MI5MINS_TIMEOUT_MS` timeout），`isTwTradingDay()` 也已有 3s `Promise.race` 界限（#1294 P0 fix）。無新增無界 await。

4. **4 個新測試**：T7/T7b/T7c 是純日期字串運算、無 wall-clock 依賴，永久有效地鎖死本次 prod repro（07/18→07/17、07/19→07/17、平日回自己）。T7d 驗證完整 wiring 進 `getTwseMarketOverview()` 解出真崩盤值，但如上 🟡#1 所述，其自我跳過條件會在本週末後永久失效——**這是本輪審查發現的唯一實質瑕疵**，但不影響本次修復本身的正確性（判非阻擋，建議 fast-follow）。

5. **跨 lane 確認**：diff 檔案清單僅 `data-sources/twse-openapi-client.ts` + 其 test + `package.json` + 一份報告文件；grep 全 diff 無真金/W6/migration 觸碰。CI 五項（validate/W6/Secret Regression/DB-mode Tests/Playwright P0 Smoke）全 SUCCESS。

## ✅ Praise
- 誠實揭露並順手修正一個系統性 CI 缺口（`twse-market-overview.test.ts` 14 個既有測試從未被 `pnpm test` 引用），沒有藉這次 P0 hotfix 掩蓋，反而在 PR body/commit message 主動指出——這正是 Elva 反覆強調的「查證不憑印象」精神的正面示範。
- `if (lastTradingDayStr !== todayStr)` 的短路判斷，結構性排除了 Elva 最擔心的「盤中誤抓不完整當日資料」風險，不是靠註解承諾，是靠程式碼結構保證。
- Root cause 交叉驗證扎實：直接 curl TWSE 官方 MI_5MINS_INDEX + MIS `tse_t00.tw` 兩個獨立官方源互證 07/17 真崩盤值，且誠實區分「這次真根因」與「#1298 沒碰到的另一條 kgi-core 熱力圖獨立管線」（Round 3 RCA 段落），沒有把兩個不同問題混為一談硬修。

## 5. Verdict
- [x] APPROVED — 可 ready，無 blocker（2 項 🟡 為 fast-follow，不阻擋本次 P0 hotfix）

## 6. Suggested Owner for Fixes
- 🟡 #1（T7d wall-clock 時效性）→ Jason，下個 fast-follow PR 補 `todayOverride` DI hook
- 🟡 #2（孤兒測試檔全 repo 稽核）→ Elva 排查任務

## 7. Re-review Required
NO（🟡 為 fast-follow，非重審條件；若 Jason 補 T7d fix 可選擇性請 Pete 快速複核）

---
Reviewer: Pete
Date: 2026-07-18
Sprint: W6 Day (2026-07-17 sprint 延續, 07-18 凌晨 hotfix)
