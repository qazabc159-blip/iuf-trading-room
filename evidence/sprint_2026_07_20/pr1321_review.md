# PR #1321 Desk Review — Pete 2026-07-20

## 1. PR Intent
- P0 熱修：KGI SDK 原始 tick `datetime`（`YYYYMMDDHHmmss`，無分隔符/時區）被 `Date.parse`/`new Date` 解成 NaN，導致 kgi 來源在多處消費端被永久誤標「fresh」，污染顯示層與 `execution-gate.ts` → `getMarketDataDecisionSummary()` 的 stale_quote 風控閘。修法：`kgi-subscription-manager.ts` 新增純函式 `_parseKgiRawDatetime()`，在 `fetchKgiLatestTick()` 內優先用它解析，失敗才 fallback 到 gateway 自蓋的 `_received_at`。
- 對應：盤中 P0 RCA（Elva 11:20 實測觸發），非既定 sprint 排程任務。
- Base branch：main（正確）。

## 2. Diff Summary
- 改 3 個檔：`apps/api/src/kgi-subscription-manager.ts`（+32/-1）、`apps/api/src/__tests__/kgi-subscription-manager.test.ts`（+76 新測試）、`reports/kgi_false_tick_20260720/RCA_KGI_FALSE_TICK_2026_07_20.md`（新 RCA 文件）。
- LOC: +277 / -1。單檔案 root-cause 修復，未觸碰 `market-data.ts`（受限檔案，作者自陳有意保守）。

## 3. IUF Blocker Checklist

**A. Kill-switch / Real-order safety** — PASS。全 diff grep `KILL_SWITCH|EXECUTION_MODE|place_order|submit_order|order.create` 零命中；未觸碰 `execution-gate.ts`/`trading-service.ts`/`kgi-sim-env.ts`/`read_only_guard.py`/`w6_no_real_order_audit.py`；本票修的是風控閘的**輸入資料品質**（讓 stale 真的被判 stale），不動閘本身邏輯。CI「W6 No-Real-Order Audit」綠。

**B. Auth / Secret hygiene** — PASS。無新 endpoint；grep `api_key|secret|token|password` 全 diff 僅命中 RCA 文件裡描述既有 CI 失敗（`FINMIND_TOKEN` 污染）的中文敘述，非洩漏。CI「Secret Regression Check」綠。

**C. State / schema integrity** — N/A。無 DB schema/migration 變更；無新 enum/status。

**D. PR hygiene** — PASS。Title `fix(kgi): parse raw KGI SDK datetime before freshness comparison (P0 false-fresh tick)` 符合 conventional commits；branch `fix/kgi-false-tick-jason-20260720`；PR description 完整列出 root cause、fix、deploy timing judgment、test plan（含 CI 結果與已排除的 2 個既有無關失敗）。

**E. IUF 不可越線** — PASS。單一 lane（kgi ingest 純函式），未越權碰 governance/其他 agent 檔案；本票原判「排收盤後 merge」被 Elva 明確改判熱修上（風控閘失效 > 空窗代價），非作者自行繞過流程。

## 4. Findings — Priority Ranked

### 🔴 Blockers
無。

### 🟡 Suggestions

1. **RCA 文件對「NaN 如何致命」的機制描述不完全精準，實際路徑分岔** — 追過 diff 之外的既有程式碼，發現有兩條不同的中毒機制，PR/RCA 文字只點出其中一條：
   - **Path A（`getKgiMarketOverview`/`getKgiCoreHeatmap`，即 ^TWII/^TPEX 大盤與熱力圖 tile）**：`staleSec = Math.round(Date.now() - Date.parse(ts))`，`ts` 若是原始無效字串 → `Date.parse` 真的是 `NaN` → `staleSec` 是 `NaN` → 下游 `staleSec > staleAfterSec` 恆 false。這條路徑跟 RCA 描述完全一致。
   - **Path B（ingest cron → `_mapKgiTicksToUpsertQuotes` → `upsertKgiQuotes` → `market-data.ts` `withFreshness()`，即 effective-quotes / `execution-gate.ts` 真正吃到的路徑）**：`_mapKgiTicksToUpsertQuotes` 直接把原始無效字串當 `timestamp` 傳出（`server.ts:18399` `tick.ts ?? ...`，原始字串是 truthy，不會 fallback），再到 `upsertProviderQuotes` 呼叫 `toIso(item.timestamp)`（`market-data.ts:650-657`）——`toIso` 對 `new Date(無效字串)` 判 `NaN` 後**不是讓 NaN 流下去，而是靜默預設成 `new Date().toISOString()`（現在）**。所以 `entry.timestamp` 從來不是 NaN，是被寫入時偷偷蓋成「現在」，`withFreshness()` 算出的 `ageMs` 是正常數字（≈0），`NaN > threshold` 這個比較根本沒發生在這條路徑上——但症狀一樣是永久 fresh。
   - 兩條路徑本票都修對了（因為修復點在共同上游 `fetchKgiLatestTick` 的 `ts` 計算，兩條路徑都吃這個值），**不影響本票正確性**，純粹是文件精準度問題。但這也代表 `toIso()` 本身有一個更廣泛的「垃圾輸入靜默蓋成 now」的 fail-open 缺陷（`market-data.ts:650-657`，受限檔案），比單純 NaN 更隱蔽——因為它連 `ageMs` 這種可觀測異常值都不會留下，未來任何來源塞爛字串都會被無聲美化成剛剛。RCA 文件末尾已列「NaN fail-open 方向是更廣系統性風險」為建議後續，但沒抓到 `toIso()` 這個更精確的落點；建議 Elva 派工時把這個具體位置一併記進追蹤票。
   - 位置：`apps/api/src/server.ts:18398-18402`、`apps/api/src/market-data.ts:650-657`
   - 建議：不擋本票；追蹤票標註 `toIso()` 的 silent-now-fallback 為根因位置。

2. **`_parseKgiRawDatetime` 對日曆有效性零檢查** — regex 只驗證「14 位數字」形狀，不驗證月份 01-12／日期 01-31 等語意合法性。若 KGI SDK 某次吐出形狀正確但日曆不合法的髒值（如月份 `13`），`new Date("2026-13-01T...")` 這類建構子在 V8 通常不是拋錯／NaN，而是「溢位捲動」到下個日期（例如捲成隔年 1 月），會靜默產生一個**看似合理但完全錯誤**的時間戳，且未必落在明顯異常區間讓人一眼發現。相較於現有測試涵蓋的「完全不合法格式」（空字串/非數字/已是 ISO），這個「形狀對但值錯」的子案例沒有測試覆蓋。
   - 位置：`apps/api/src/kgi-subscription-manager.ts` `_parseKgiRawDatetime`
   - 建議：非本票必修（KGI 交易所來源日曆值異常機率低），可加一條測試/月日範圍檢查列入下次順手修。

### 💭 Nits
1. 新增的 regression fixture 測試（`fetchKgiLatestTick — freshness must reflect true tick age`）用「今天往回推算 UTC 分量」建構 fixture 字串，邏輯正確但稍繞；可考慮之後補一個更直白的「hardcode 已知過去日期」測試當可讀性錨點，非必要。

### ✅ Praise
- Root cause 挖得很深：不是停在「Date.parse 對這個格式回 NaN」表面症狀，而是往下追出兩條不同的下游消費路徑各自有什麼後果（顯示層 vs 風控閘），且誠實標註「今天已有實際下單被此污染的證據：未查到，但閘門本身確定失效」——不誇大也不淡化。
- Deploy timing 判斷本身寫得很負責：PR 描述里明確給出「排收盤後 merge」的預設判斷與理由，同時留白讓 Elva 可依當下損害程度覆寫改熱修——本票正是被 Elva 明確改判熱修上，不是作者自行繞過稽慎判斷。
- 新測試踩在真實 KGI 格式 fixture 上（`"20260423090038"` 14 位數字，非隨手塞 `toISOString()`），且包含一條「regression guard」測試鎖死 `Date.parse` 對此格式恆 NaN 的前提本身（若這個 JS 行為未來改變，測試會主動報警提醒重新檢視整組假設）——這種鎖前提的寫法在這個 repo 少見，值得推廣。
- 修復點選在唯一上游共用函式（`fetchKgiLatestTick`），親自 grep 驗證過 `fetchKgiLatestTick` 是 `getKgiMarketOverview`/`getKgiCoreHeatmap`/ingest cron 三個消費端的唯一 tick 來源，一次修復覆蓋全部路徑，不是頭痛醫頭。

## 5. Verdict
- [x] APPROVED — 可 ready，無 blocker（2 條 🟡 為文件精準度與非本票範圍的邊界測試缺口，不擋熱修）

## 6. Suggested Owner for Fixes
- 🟡 #1（RCA 精準度＋`toIso()` silent-now-fallback 追蹤票）→ Jason（原作者，另案）
- 🟡 #2（日曆有效性測試）→ Jason，順手修或另票

## 7. Re-review Required
NO

---
Reviewer: Pete
Date: 2026-07-20
Sprint: W6 Day (P0 熱修，非排定 sprint task)
