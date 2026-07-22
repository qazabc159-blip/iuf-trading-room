# PR #1337 Desk Review — Pete 2026-07-22

## 1. PR Intent
- 首頁併發 CPU 續治（round 7，接續 #1333/#1334/#1335）：①擴 snapshot-sharing 到 `listCachedProviderQuotes`（新 module-private `snapshotCachedProviderQuotesBySource`＋各下游函式新增 optional `rawQuotesBySource`/`rawQuotesOverride` 參數），讓單一 `/overview` request 內原本被 `listMarketDataProviderStatuses`/`listMarketQuotes`/`getEffectiveMarketQuotes` 內部 `resolveMarketQuotes` 重複掃描的 "latest tick" cache 只掃一次 ②`getMarketDataOverview` 頂層加 1500ms TTL Promise-memo，讓同組參數的併發呼叫者共享同一次計算（同一 response 物件參照）。宣稱 5x 併發 34s→3.2s。
- 對應 sprint task：W6+ 首頁效能 P0 系列（round 5/6/7 連號 RCA）。
- Base branch：`main`（PR #1337 `baseRefName=main`，正確；merge-base 檢查非必要，本輪窄域單檔）。

## 2. Diff Summary
- 改 4 個檔：`apps/api/src/market-data.ts`（+/-，核心）、新測試 `apps/api/src/__tests__/market-data-overview-concurrency-memo.test.ts`（320 行）、`package.json`（把新測試檔掛進 `test` script）、新 RCA doc。
- LOC：+646 / -24。
- `package.json` diff 確認新測試檔已被加入 CI 實際執行的 test 指令字串（非孤兒檔案，呼應「CI 綠≠新 spec 真被跑到」教訓，此輪 PASS）。

## 3. IUF Blocker Checklist
- A. Kill-switch/real-order safety：N/A（零觸碰下單/KILL_SWITCH/EXECUTION_MODE，grep 全 diff 無 `place_order`/`submit_order`/`kgi.order.create`）。PASS
- B. Auth/secret hygiene：N/A，無新 endpoint/新 secret。PASS
- C. State/schema integrity：無 DB migration。新 module-level state 為 `overviewMemo`（`Map<string, {expiresAt, promise}>`），有對應 `resetMarketDataWorkspaceState()` 逐 workspace 清除（含 process-restart 語意：純記憶體 TTL memo，restart 後自然清空，非需要持久化的狀態）。PASS
- D. PR hygiene：branch 命名符合慣例；PR 為 DRAFT；commit 對應單一主題。PASS
- E. IUF 不可越線：無 lane 越界、無 governance bypass、無 KGI `/order/create` 呼叫、無 redaction 違規。PASS

## 4. Findings — Priority Ranked（聚焦本輪指定兩個新點＋既定第三點確認）

### 🔴 Blockers
無。

### 🟡 Suggestions
1. **共用參照 mutation 風險已核實無害，但值得留一句書面記錄**：親讀 `server.ts` `/overview` handler（唯一生產呼叫點，`apps/api/src/server.ts:1232-1370`）全程走 spread/`.map()` 建新物件（`finalOverviewData = {...overviewData, marketContext: {...}}`、`enrichedHeatmap = baseHeatmap.map(tile => ({...tile, ...}))`），從未對 `overviewData` 本體或其巢狀陣列做原地 mutation；`market-data.ts` 內下游消費鏈（`dedupePreferredQuotes`/`compareQuotes`/`resolveMarketQuotes`/`getEffectiveMarketQuotes`）逐一確認：唯一一處 `quotes.sort(compareQuotes)`（`listMarketQuotes` L2590）是對 `.flat().filter()` 產生的**全新陣列**排序，非對 Map 內共享的 per-source snapshot 陣列排序；`resolveMarketQuotes` L2829 也是 `[...quotes].sort(...)` 先拷貝再排序。物件層級（`withFreshness()` 回傳的 `Quote`）全程只讀，無屬性賦值。建議 PR description 補這段「已驗證零 mutation」的具體位置清單，讓下一輪 reviewer 不必重查。
2. **1500ms TTL 內回同參照的新鮮度語意已核實低於各源 staleness 下限，但屬於「多方案疊加後」的新組合，建議追蹤票記錄邊界**：`getQuoteStaleMs()` 最低下限為 5000ms（kgi/tradingview 預設），本 TTL 1500ms < 5000ms 成立；但 round 5/6（`cachedProviderQuotesMemo`/`cachedProviderQuoteHistoryMemo`，TTL 1000ms）+ round 7 頂層 memo（1500ms）疊加後，理論上單一 request 最壞情況下 ageMs 可能已比其內部子快取多凍結 500ms（非累加，因為頂層 memo 命中時整個 sub-computation 含其內部快取都不會重跑）——不影響正確性判準（仍遠低於 5s），純粹記錄疊加後的心智模型给下一輪 reviewer。

### 💭 Nits
1. 新增測試 `market-data-overview-concurrency-memo.test.ts` 開頭註解自陳「rawQuotesBySource threading」測試只驗證「連續呼叫兩次無穿插寫入時 byte-identical」，未直接構造「傳 override vs 不傳 override」的 A/B 對照斷言（snapshot helper 本身未 export，只能端到端驗證）。目前端到端驗證足夠（`computeMarketDataOverview` 必然會用到這條路徑，且既有 `market-data-overview.test.ts` 的 changePct/breadth 正確性測試在新實作下仍過），但若日後 `snapshotCachedProviderQuotesBySource` 邏輯跟 `listCachedProviderQuotes` 產生語意分歧（例如未來有人在 snapshot 函式裡加額外過濾），這條測試不會抓到，建議未來補一支直接 export 後單元測試。

### ✅ Praise
- **併發同物件參照的安全宣稱是本輪唯一需要人工複核的新風險，而測試直接斷言了最強形式**：`results.every((r) => r === results[0])`（真的引用相等）＋「不同 `includeStale` 參數不可共享 memo」＋「TTL 過期後不可重用」＋「`resetMarketDataWorkspaceState` 必須清除」四條測試皆為真斷言，非裝飾性 mock，且都命中本 PR 自己宣稱的具體行為（同金鑰共享、不同金鑰隔離、TTL 到期重算、reset 立即失效）。
- **`rawQuotesOverride ?? listCachedProviderQuotes(...)` 的 nullish-fallback 寫法讓「未傳 override 的呼叫方零行為變化」在型別層面就是顯而易見的**，不需要額外測試就能高信心判斷其他 5 個呼叫點（省略 `rawQuotesBySource` 的所有既有呼叫方）行為不變。
- 延續 round 5/6 已建立的「先同步建 snapshot、再 threading 進所有下游」架構，一致性佳；TTL 選值（1500ms，介於既有 1000ms/2000ms 之間且明確小於 5s stale-floor）有數字依據非拍腦袋。

## 5. Verdict
- [x] APPROVED — 可 ready，無 blocker

## 6. Suggested Owner for Fixes
- 🟡 #1 → Jason（PR description 補 mutation 核實位置清單，非阻擋性，可在下輪順手補）
- 🟡 #2 → Jason（記錄疊加 TTL 心智模型到追蹤票或本 PR 註解，非阻擋性）

## 7. Re-review Required
NO

---
Reviewer: Pete
Date: 2026-07-22
Sprint: W6+ 首頁效能 P0 round 7
