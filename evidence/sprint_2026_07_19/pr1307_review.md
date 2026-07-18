# PR #1307 Desk Review — Pete 2026-07-19

## 1. PR Intent
- 加一個最低優先權「official_close」報價 tier（讀 `quote_last_close` DB 表），只掛在
  `GET /api/v1/market-data/effective-quotes` 這一支 route，讓週末/deploy 重啟後 in-memory
  quote cache 全空時，desk-exact 側欄/報價表不再整片空白，而是顯示昨收/最後交易日收盤價。
- 對應症狀：週末+deploy 重啟後 desk 全空（本輪派工背景一句話）。
- Base branch：`main`（非 stacked chain 的中間節點，直接對 main）。

## 2. Diff Summary
- 改 5 個檔：`apps/api/src/market-data.ts`（+/-224）、新測試檔
  `effective-quotes-official-close-fallback.test.ts`（+238，7 tests）、
  `apps/api/src/server.ts`（route 改一行呼叫）、`packages/contracts/src/marketData.ts`
  （enum +1 member）、`package.json`（註冊新測試檔）。
- LOC：+485 / -9。
- 主要改動：`_isMarketDataOffHours()`（reuse `isTwTradingDay`，不重寫）、
  `_applyOfficialCloseFallback()`（純函式，only fills `selectedQuote === null` 的 item）、
  `getEffectiveMarketQuotesWithOfficialCloseFallback()`（route-only wrapper，DB 查
  `quote_last_close`，fail-open）。

## 3. IUF Blocker Checklist

### A. Kill-switch / Real-order Safety — PASS
- diff 全文 grep `kill_switch|execution_mode|place_order|submit_order|kgi.order.create|order/create` 零命中。
- 逐 call-site 驗證（見 Findings ✅ Praise）：`getEffectiveMarketQuotes()`（base，未改）仍是
  `getMarketDataConsumerSummary`/`SelectionSummary`/`DecisionSummary`（server.ts:2733/2877/3274 一帶）
  與 `strategy-engine.ts:1312`（autopilot 下單 sizing 用的那支）唯一呼叫者；新 wrapper
  `getEffectiveMarketQuotesWithOfficialCloseFallback` 全 repo 只有 `server.ts` 這支
  `/effective-quotes` route 一處呼叫（grep 驗證）。s1-sim-runner / v34 / v51 runner 完全不碰
  effective-quotes。風控隔離主張成立。
- `official_close` 刻意不進 `quoteProviderSources` 陣列（硬編字面陣列，非從 enum 動態展開），
  grep 驗證陣列本身沒被 diff 動到。

### B. Auth / Secret Hygiene — PASS
- route 沿用既有 `session: c.get("session")`，未新增 endpoint、未動 middleware。
- 無 hardcoded secret/token；無新 env var。

### C. State / Schema Integrity — PASS（無 DB migration，本 PR 不動 schema）
- 無新 migration（`quote_last_close` 表已存在，僅新增讀取路徑）。
- `quoteSourceSchema` enum 擴充：additive-only，`quoteProviderSources` 字面陣列排除
  `official_close`，grep `QuoteSource` 全 repo downstream 消費點（`apps/web/lib/api.ts`、
  `paper-order-vocab.ts`）確認沒有窮舉 switch 會漏 case 而炸掉——但發現**另一個未在 PR 描述
  提及的欄位型別落差**，見 🟡 #1。
- 無 runtime module-level Map/Set 新增（`_tradingDayCache` 是既有 `trading-calendar.ts` 的，
  非本 PR 新增）。

### D. PR Hygiene — PASS
- Branch 命名符合慣例；commit message conventional（`fix(market-data): ...`）。
- PR description 完整列出 scope／test plan／acceptance criteria mapping，且誠實揭露已知限制
  （grouped map 只收曾有 quote 的 symbol，見 🟡 #3）。
- Base branch 對（main），非 stacked chain 中段。

### E. IUF 不可越線 — PASS
- 無 lane 越界；無 governance bypass；無 KGI gateway `/order/create` 呼叫；無 redaction 違規。

## 4. Findings — Priority Ranked

### 🔴 Blockers
無。

### 🟡 Suggestions (should fix)

1. **前端兩個實際消費端沒被同步更新，會把合法的收盤快照誤標成「缺資料／略舊」**
   - 位置：`apps/web/app/quote/page.tsx:68-72`（`freshnessLabel()`，fallback 回傳「缺資料」）、
     `apps/web/public/desk-exact/index.html:1004-1009`（`effectiveQuoteStateLabel()`，非 "fresh"
     一律顯示「（略舊）」，且 `srcLabel` 對 `official_close` 落到預設「行情」）。
   - 原因：backend 新增的 `freshnessStatus: "closed_snapshot"` 與 `closedSnapshotTradeDate`
     欄位，兩個實際會收到這支 API 回應的前端（親自 grep 確認：全 repo 只有這兩處呼叫
     `getEffectiveQuotes`/`fetchEffectiveQuotes`）都沒有對應分支——`quote/page.tsx` 會把週末
     合法收盤快照顯示成「缺資料」（比修之前的「無資料」在語意上沒有真正變好，只是現在有
     價格數字但標籤還是說沒資料，前後矛盾）；`desk-exact` 會顯示「行情（略舊）」而非設計
     comment 裡講的「MM/DD 收盤」。失敗方向是「多疑不少疑」（不會假裝即時），不算違反
     「不假綠」鐵律，但與 PR 自己 code comment 宣稱的「so the frontend can render 'MM/DD
     收盤'」不符——那句話目前只是伏筆，這輪沒有兌現。
   - 建議：後續 PR（Jim/Codex）補這兩處的 `closed_snapshot` 分支＋用
     `closedSnapshotTradeDate` 顯示「MM/DD 收盤」；在此之前不算功能完整，但不阻擋這支
     backend-only PR ready（backend 症狀本身已修：desk-exact 現在會顯示價格而非空白）。

2. **`strategyUsable/paperUsable/liveUsable` 恆 false 目前只在唯一呼叫點成立，不是型別系統
   強制——未來新呼叫者若把這支 wrapper 接進下單決策鏈，可能繞過風控**
   - 位置：`apps/api/src/market-data.ts` 新增的 `getEffectiveMarketQuotesWithOfficialCloseFallback`
     （export 的一般 async function，無任何呼叫端限制）；對照風險場景：
     `apps/api/src/strategy-engine.ts:1324-1339`（autopilot 下單 sizing）目前呼叫的是
     **base** `getEffectiveMarketQuotes()`，其邏輯只檢查 `entryPrice === null || entryPrice <= 0`
     ——因為目前 base 函式在 `includeStale:false` 時 `selectedQuote !== null` **隱含** fresh
     （`market-data.ts:2615` 一帶的 eligible filter），所以這段程式碼現在是安全的。
   - Failure scenario：若日後有人為了修「autopilot 週末/重啟後也會拿不到價」這個很自然的
     下一個票（跟本票背景幾乎同款描述），把 `strategy-engine.ts:1312` 的
     `getEffectiveMarketQuotes` 換成這支新 wrapper——`entryPrice === null` 這個檢查仍會通過
     （因為 official_close 會填 `selectedQuote`），週末/重啟後的收盤價就會被當成即時價
     拿去 `deriveQuantity` + 送單，而完全不會被目前這幾個 `false` 攔下（因為呼叫端根本沒
     檢查 `strategyUsable`/`freshnessStatus`，只看 `entryPrice`）。目前的「架構性保證」只
     防住了**已知的三個 summary 函式**（它們有檢查 usable flags），沒有防住「繞過 summary、
     直接讀 selectedQuote.last」這種既有 call pattern。
   - 建議：非本 PR 阻擋項（本 PR 本身零風險鏈觸碰），但建議 Jason 開一張小 hardening 票：
     幫這支 wrapper 加型別或執行期斷言（例如回傳型別跟 base 函式不同名/加
     `readonly __routeOnly` 標記，或至少在 export 處的 docstring 加大寫警告），避免未來
     "順手" 誤用。

3. **作者已誠實揭露、本 PR 未修的殘餘缺口：從未被快取過任一報價的 symbol，仍會整個從
   response 消失，不會拿到 official_close 補值**
   - 位置：新測試檔 docstring（`effective-quotes-official-close-fallback.test.ts` 開頭
     Note 段）自陳 `resolveMarketQuotes()` 的 `grouped` map 只收「曾經被任何 provider 快取過」
     的 symbol；`getEffectiveMarketQuotesWithOfficialCloseFallback` 的
     `blockedSymbols = effective.items.filter(...)` 只能對「有出現在 items 裡」的 symbol
     生效。
   - 影響：桌面自選清單若剛好加入一支「這個 workspace 這個 process 生涯內從沒被解析過
     任何報價」的冷門 symbol，遇到週末/重啟，仍會完全消失（不是「blocked 但誠實顯示」，
     是直接不出現在陣列）。緩解因子：`loadPersistedQuoteEntries()`（既有機制，非本 PR
     新增）在重啟時會把 persisted quote 重新灌回 in-memory，所以「deploy 重啟」這個主症狀
     實際發生時，多數 symbol 早已在之前的 polling cycle 留有記錄，此邊界情況機率不高，
     但仍是誠實應該記下來的殘餘 gap。
   - 建議：不阻擋本票，但排進下一輪待辦（跟 🟡 #1 一起走前端補完那輪）。

### 💭 Nits
1. `desk-exact/index.html:1007` 的 `srcLabel` 三元鏈沒有 `official_close` 分支，退回泛用
   「行情」——等 🟡 #1 修的時候一起補標籤文字即可，不需要單獨開票。
2. `_applyOfficialCloseFallback` 保留原 item 的 `staleReason`/`fallbackReason` 不覆寫（只在
   `reasons[]` 附加新原因）——語意上讀者可能困惑「為什麼 blocked reason 還在但已經有報價
   了」，屬 cosmetic，非阻擋。

### ✅ Praise
- 風控隔離主張這次是**真的逐一 call-site 驗證過的**，不是文件宣稱：`official_close` 刻意
  排除在 `quoteProviderSources` 字面陣列外、新 wrapper 全 repo僅一處呼叫、三個
  summary 函式與 strategy-engine.ts 的 autopilot 路徑都還在呼叫未改動的 base 函式——
  這輪追出來唯一沒被覆蓋到的是「假設性未來誤用」而非「現在就存在的漏洞」。
- `_isMarketDataOffHours()` 沒有重新發明 trading-calendar 判斷，正確重用已經被 P0 修過、
  帶 DB 查詢逾時保護的 `isTwTradingDay()`，避免了 #1298 那次「新查核邏輯自己重寫一份」
  的病灶重演。
- `closed_snapshot` vs `stale` 的三態設計本身是誠實的：離峰用 closed_snapshot（不假裝新鮮也
  不假裝過期）、盤中活feed全死用 stale——且兩種狀態都不是 "fresh"，所以
  strategyUsable/paperUsable/liveUsable 在**目前這個函式的回傳值本身**是硬編 false 雙重保險
  （不只依賴後續某處的 gate 邏輯）。
- 測試品質高：7 個 test 涵蓋週末填值、盤中 byte-compatible passthrough、DB 也沒資料的誠實
  no_quote、盤中活 feed 死掉的 stale 分支、以及 `_isMarketDataOffHours` 三個邊界（週末/盤中/
  盤後）——且 docstring 主動揭露已知限制（🟡 #3），沒有藏起來，值得肯定。

## 5. Verdict
- [x] APPROVED — 可 ready，無 blocker（3 🟡 建議排下一輪跟進，不阻擋這支 backend-only 修復
      merge；核心症狀「desk-exact 週末/重啟空白」已解決，風控鏈零觸碰主張逐點驗證成立）。

## 6. Suggested Owner for Fixes
- 🟡 #1（前端 closed_snapshot 標籤分支）→ Jim（或原作者 Jason 收尾都可，非 backend-only 範圍）
- 🟡 #2（wrapper 誤用防呆 hardening）→ Jason
- 🟡 #3（冷門 symbol 從未快取過的殘餘 gap）→ Jason，排進同一輪待辦

## 7. Re-review Required
NO（3 🟡 為下一輪跟進項，非本票 re-review 條件；若 owner 選擇在本 PR 內順手一併修，
再麻煩 Elva 指派 Pete 重審一次即可）。

---
Reviewer: Pete
Date: 2026-07-19
Sprint: W6 Day 19（沿用 dispatch 標記 sprint_2026_07_19）
