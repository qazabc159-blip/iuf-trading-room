# PR #1297 Desk Review — Pete 2026-07-17

## 1. PR Intent
- 治「熱力圖一堆 0%/空缺」：3707（TPEX，只落 Tier2.5 quote_last_close，schema 無 prevClose/change 卻標成 twse_eod）+ 2395（TWSE STOCK_DAY_ALL 給假 `Change="0.0000"`，MIS 交叉驗證真跌 -1.16%）。修法：新 `isZeroChangePlausible()` 用自身前一日快取反證假 0；changePct 不可確定的 tile 一律重分類 `sourceState="no_data"`。附帶修 banner 日期跟熱力圖 tile 日期不一致（`readMarketIndex()` 新 `isNewerTaipeiTradeDate()`）。
- 對應 sprint task：7/17 資料誠實 P0 系列（同批 #1294/#1295 之後續）。
- Base branch：`main`（merge-base = `404d43d3`，即 origin/main HEAD，正確；DRAFT 狀態確認）。

## 2. Diff Summary
- 改了 7 個檔（不含 evidence md 則 6 個 code/test 檔）
- 主要改動：`kgi-heatmap-enricher.ts`（Tier2/2.5/3 統一 no_data 重分類 + `isZeroChangePlausible`）／`page.tsx`（`readMarketIndex()` 加 newer-date 偏好邏輯）／新檔 `index-snapshot-freshness.ts`+test／既有測試檔更新
- LOC: +457 / -29（gh 統計）

## 3. IUF Blocker Checklist
- §A Kill-switch/真單：PASS — grep 全 diff 對 `KILL_SWITCH|EXECUTION_MODE|place_order|submit_order|order.create` 0 命中；純資料呈現層，不碰 broker/trading-service。
- §B Auth/Secret：PASS — 0 secret/token 明碼；無新 endpoint。
- §C State/Schema：N/A — 無 migration；`LastCloseEntry` export 可見度變動（interface→export interface）為既有型別擴大可見範圍，非破壞性；`enrichHeatmapTiles`/`updateLastCloseFromTwse` 新增可選參數（`priorSnapshot`），既有呼叫端不傳沿用舊行為，向後相容 PASS。
- §D PR Hygiene：PASS — title `fix(heatmap): ...` 符合 conventional commits；DRAFT 起手；base=main 正確；PR body 列出 root cause/files/test plan，evidence md 已附。
- §E 越線：PASS — `industry-heatmap.tsx` 確認**零改動**（`isUsableTile()` pre-existing 排除 `no_data` 邏輯本來就在，本 PR 只是讓後端誠實標記）；`page.tsx` 改動僅限 `readMarketIndex()` 一個函式，未動其他區塊；未見 lane 越界。

## 4. Findings — Priority Ranked

### 🔴 Blockers
（無）

### 🟡 Suggestions
1. **banner newer-date 偏好未驗證資料品質，只驗證「日期比較新」** — `apps/web/app/page.tsx:849-859`
   - 條件：`contextIndex.last !== null && contextIndex.state !== "EMPTY" && isNewerTaipeiTradeDate(...)`，會接受 `state==="STALE"`（甚至理論上 `"BLOCKED"`，雖然 `stateFromEffectiveQuote`——`market-data.ts:1195-1199`——在 `freshnessStatus` 型別只有 `fresh|stale|missing` 時 BLOCKED 分支實務不可達）。
   - Failure scenario：若 `marketContext.index`（來自 effective-quote pipeline）在上游暫態異常時吐出一筆時間戳記已跨日但數值不完整/尚未收斂的 STALE quote（跟本輪 2395 假 0% 同一類「上游批次未算完」瑕疵，或 Elva 提到的「今晚 index STALE 07/17 殘缺 bar」同類風險），本函式會把它整組（價格+日期）拿來蓋掉原本正確的舊日期 banner，且無下限值域檢查（不像 enricher 側有 `isPlausibleChangePct` ±10.5% 防呆）。
   - 目前只有純函式 `isNewerTaipeiTradeDate()` 有 7 個單元測試，`readMarketIndex()` 整合行為（含 `state`/`last` 門檻）**零測試覆蓋**。
   - 建議：collapse 條件至只信任 `state === "LIVE"`（比照 enricher 對「不可確定」寧可從嚴的一貫態度），或至少替 `readMarketIndex()` 補一條整合測試鎖住「STALE+跨日」情境的預期行為（目前是有意還是意外，PR 沒明說）。owner 可自行判斷是否此輪要收斂，不影響本輪其餘修復。
2. **`isZeroChangePlausible` 已知限制未加運行期可觀測性** — `apps/api/src/kgi-heatmap-enricher.ts:128-152`
   - Cold-cache 窗口（process 剛重啟、尚無前一日快取）會照單全收任何 exact-zero，即本輪要治的 2395 那類 bug 在此窗口內會原樣重演，PR 文件已誠實揭露此限制（非隱瞞），但沒有 log/metric 標記這個「未驗證的 0%」被放行過，之後排查會跟正常情況混在一起。建議加一行 debug log 或 counter，供下次真的撞見時能快速定位（non-blocking，nice-to-have）。

### 💭 Nits
1. `isZeroChangePlausible` 的 tolerance `Math.max(0.01, priorEntry.price*0.001)` 對低價股（如 <10 元）容忍度可能過緊（0.1% of 5元=0.005，比 0.01 下限還小，實際用 0.01），可接受，僅記錄供未來調整參考。

### ✅ Praise
- Root cause 查證扎實：用 TWSE MIS 官方即時源交叉驗證兩個真實案例（3707 OTC 結構性缺口、2395 假零值），evidence md 附完整 curl 證據鏈，不是憑空猜測。
- Gating 邏輯正確方向「寧可標 no_data 也不假造/留半殘格」，且用「自身前一日快取」做反證，避免誤殺真平盤股（`heatmap-consistency.test.ts` 的 2354 regression guard 明確鎖住這點）——問題①的核心疑慮（會不會誤殺真跌停/真平盤）驗證後成立：**不會誤殺**，真平盤/真跌停都不受影響。
- 前端零改動的判斷正確且經核實：`industry-heatmap.tsx` 確認不在本次 diff 內，`isUsableTile()` 既有排除邏輯直接生效，避免了不必要的重工。
- 對既有測試的斷言修改（`kgi-core-afterhours-close.test.ts`）誠實標註「這是刻意行為變更非退化」並在 evidence md 說明理由，不是偷偷放寬。

## 5. Verdict
- [x] APPROVED — 可 ready，無 blocker。2 個 🟡 為 follow-up 等級，不阻擋本輪 merge。

## 6. Suggested Owner for Fixes
- 🟡 #1（banner STALE 門檻）→ Jason（自己判斷是否本輪收斂或開 follow-up ticket）
- 🟡 #2（cold-cache 可觀測性）→ Jason（nice-to-have，可併入下次相關修復）

## 7. Re-review Required
NO（🟡 非 merge 前置條件；若 owner 選擇本輪順手修，貼 diff 我可快速複審）

---
Reviewer: Pete
Date: 2026-07-17
Sprint: W6+ 7/17 資料誠實系列（PR #1297，commit 3d6a07c1）
