# F-AUTO SIM 帳本 NAV 續寫停擺 — Root Cause + Fix

**Jason — Backend Strategy Lane — 2026-07-09**
**Branch: `fix/ledger-hook-stall-jason-20260709`**

---

## TL;DR

- **確認的 root cause**：2026-07-07（週二 rebalance 日）TWSE `STOCK_DAY_ALL` EOD 收盤價在
  14:45–15:30 TST EOD 視窗內全程未發布最新一天的資料（date-guard 判定為 stale），導致
  `officialCloseMarkedCount` 全天維持 0。`pricingComplete` 因此永遠是 `false`，而 Phase 2
  帳本寫入（`writeLiveLedgerAfterEod` / `writeDailyNavRow`）**與** EOD audit log 寫入 **共用同一個
  `if (snapshot.pricingComplete)` gate**，兩者一起被跳過整天。**帳本沒有任何補寫/catch-up 機制**，
  視窗一過（15:30）當天就永久留空。
- 這是 Phase 2 live cron **上線後第一個真正的週二**（前 5 週 6/2–6/30 全部走 Phase 1 backfill dry-run，
  不是 live cron 路徑），所以這個 gate 的副作用在此之前從未在 prod 實際發生過。
- **修復**：在 `s1-sim-runner.ts` 新增 `fullyPriced` 判定（官方 TWSE/TPEX ∪ 已做 date-guard 的 MIS
  fallback，兩者皆已同日期驗證，均計入；**明確排除** tier 1d 的 DB persisted-close fallback，因為那
  一層可能回放前一天的舊收盤價）。帳本寫入的觸發條件從單一 `pricingComplete` 放寬為
  `pricingComplete || fullyPriced`；**EOD audit log 寫入與 `s1_sim_daily` 報告的 `completion_status`
  語意完全不變**（仍然只吃 `pricingComplete`，YELLOW-1 的 stale-data 防呆原封不動）。
- **本輪未修的部分**：2026-07-07 那一天已經過去，EOD 視窗不會重開，程式碼修復是「防止未來再發生同
  類永久缺口」，**不會**自動回補 7/7 缺的那筆 week 6 + NAV row。回補方案見下方「歷史缺口回補提案」，
  屬 apply 級操作，本輪只出方案、不執行。

---

## 一、prod 證據（2026-07-09 ~12:10 TST 直接查證，非推測）

用 `railway variables --service api --kv` 取 owner 帳密登入 `https://api.eycvector.com`，直接打
prod API 驗證（非本地/非 memory）：

### 1. `/api/v1/portfolio/f-auto/nav`（Owner-only，同源 `/api/v1/track-record/nav`）

```
navCurve: 23 筆，2026-06-02 ~ 2026-07-08，逐日連續，唯一缺口在 2026-07-07
weeks:    5 筆，最後一筆 weekNum=5 basketDate=2026-06-30 — 沒有 week 6
```

navCurve 尾段（原始 JSON）：
```
2026-06-30  9263514  week5  backfill_dry_run
2026-07-03 10426350  week5  live_eod
2026-07-06 10532600  week5  live_eod
2026-07-08  9790150  week5  live_eod          <<< 2026-07-07 缺這一筆
```

- **navCurve 沒有任何 `date`/`navDate` 為 `null` 的紀錄**（全 23 筆逐一檢查過）。
- `/api/v1/track-record/nav`（public whitelist 版本，欄位真的叫 `date`）同樣沒有 null。

### 2. `/api/v1/internal/s1-sim/status`

```
latest_basket: date=2026-07-07（週二 rebalance 有生成新籃子，8 檔）
today_orders:  date=2026-07-07, accepted=8/8（KGI SIM 送單成功）
today_eod:     date=2026-07-08（這是「最近 7 天內找到的最新一份『完整』EOD 報告」，
               不是「今天」的意思 — 見下方端點邏輯說明）
```

### 3. `/api/v1/internal/s1-sim/eod-report?date=2026-07-07`

```json
{ "found": false, "report": null, "source": null }
```

**確認**：2026-07-07 完全沒有產出完整的 EOD 報告（canonical `2026-07-07.json` 不存在，audit_log 也沒
有 `s1_sim.eod_generated` for 2026-07-07）。7/8 的報告存在且完整（`total_market_value_twd=3,577,300`，
`position_count=8`）。

### 與任務描述的落差（誠實記錄）

任務描述（2026-07-09 11:56 的觀察）說 navCurve「停在 7/6，7/7、7/8、7/9 三天 MISSING，且最新一點
`date` 為 `null`」。我在 ~12:10（約 15 分鐘後）直接查證 prod DB 讀出的結果是：**只有 7/7 缺，7/8 已經
有資料，且沒有任何 `null` 的 date 欄位**。7/8 的 EOD 視窗（14:45–15:30 TST）在 7/8 當天就已結束，沒有
任何機制會在 7/9 早上才回頭補寫 — 所以 7/8 的資料理論上不可能在 11:56 之後才「突然出現」。

可能原因（未深入查證，超出本 lane）：11:56 當時測的是 web iframe/proxy 快取的舊回應，或當時剛好卡在
某次短暫請求失敗。**這不影響本次 root cause 的有效性** — `weeks` 卡在 6/30、7/7 沒有 week 6 這件事，
是可重現、有 prod audit_log 佐證、且能在程式碼裡精確定位的真實 bug，也正是任務描述裡明確點出的核心
症狀（「7/7 週二 rebalance 未建新 week」）。7/9 尚未產出資料是正常狀態（今天 EOD 視窗 14:45–15:30 TST
還沒到，現在 ~12:10）。

---

## 二、程式碼層級的因果鏈

### 呼叫鏈
`server.ts`（S1-SIM-PIPELINE scheduler，15 分鐘 poll，`isS1EodWindow()` 開在平日 14:45–15:30 TST）
→ `s1-sim-runner.ts` `runS1EodReportTick()` → `runS1EodReportTickOnce()`
→ `buildS1PositionsSnapshot()` 算出 `pricingComplete` / `pricedPositionCount`
→ 若 `pricingComplete === true`：寫 audit log **且**（修復前）觸發 Phase 2 帳本寫入
  （`writeLiveLedgerAfterEod` 週二 / `writeDailyNavRow` 其他平日，皆在 `sim-ledger-backfill.ts`）

### `pricingComplete` 的定義（未改動，`s1-sim-runner.ts`）
```ts
const pricingComplete = positions.length > 0 &&
  officialCloseMarkedCount > 0 &&
  pricedPositions.length === positions.length;
```
`officialCloseMarkedCount` 只在 tier 1b（TWSE `STOCK_DAY_ALL` + TPEX 收盤，且已做「今天日期」驗證，
即 YELLOW-1 fix）成功時才會 > 0。若 TWSE 當天資料在整個 EOD 視窗內都還是「昨天」的日期
（`stockDateIso !== todayTst`），`officialCloseMarkedCount` 全程維持 0，**即使** tier 1c（MIS 逐檔
post-session 收盤，同樣有 per-symbol 的「今天日期」驗證）成功把全部部位都定價了，
`pricingComplete` 仍然是 `false`（因為 `officialCloseMarkedCount > 0` 是硬性條件，跟
`pricedPositions.length === positions.length` 是 AND 關係，不是 OR）。

這是 YELLOW-1（6/30 fix）刻意的設計：防止「TWSE 還沒發布」被誤判為「已發布但剛好等於基準價」
（unrealized=0 鎖死不再重試）。**但這個防呆的副作用沒有被之前的 session 意識到**：它同時擋住了
Phase 2 帳本寫入 — 而帳本寫入跟 EOD 報告的「誠實度」考量不一樣：帳本只需要「今天每一檔都有一個
已驗證是今天的收盤價」，不需要「非官方 TWSE 來源不算」。MIS fallback（tier 1c）本身就有
`d === todayYmd` 的逐檔日期驗證，可信度跟官方源相同，只是資料來源不同。

### 為什麼這是 Phase 2 上線後第一次真的踩到
`sim_ledger_weeks` 目前 5 筆全部 `source='backfill_dry_run'`（6/2, 6/9, 6/16, 6/23, 6/30），是
Phase 1/2 的歷史回補一次性寫入，**不是**經過 live cron 的 `writeLiveLedgerAfterEod()`。Phase 2 live
cron 是 楊董 2026-07-02 ACK 上線的，之後的第一個週二就是 2026-07-07 —— 也就是說，
`writeLiveLedgerAfterEod()` 這個函式在 prod **第一次真正被呼叫**的那天，就撞上了「TWSE 全天沒發布」
這個從未在 live 路徑上測試過的邊界情況。

---

## 三、修復內容

### 檔案
- `apps/api/src/s1-sim-runner.ts`
- `apps/api/src/sim-ledger-backfill.ts`
- `tests/ci.test.ts`（新增 SIM-LEDGER-16/17/18）

### 邏輯
1. `S1PositionsSnapshot` 新增 `fullyPriced: boolean` 欄位：
   `positions.length > 0 && (officialCloseMarkedCount + misTodayMarkedCount) === positions.length`。
   `misTodayMarkedCount` 是新增的計數器，只計入 tier 1c（MIS，已做同日期驗證）成功定價的檔數 —
   **刻意不含** tier 1d（DB persisted-close fallback，可能回放舊收盤）。
2. `runS1EodReportTickOnce()`：
   - EOD audit log 寫入（`writeS1ObservationAudit`，決定 `s1_sim_daily` 報告的
     `completion_status`）維持原本 `if (snapshot.pricingComplete)` 單一 gate，**完全不變** — YELLOW-1
     防呆對這個面向沒有鬆動。
   - Phase 2 帳本寫入拆成獨立的 `if (snapshot.pricingComplete || snapshot.fullyPriced)` block。
   - 帳本寫入時額外算出 `pricingQuality: "official" | "mis_fallback_full"`，往下傳給
     `writeLiveLedgerAfterEod` / `writeDailyNavRow`。
3. `sim-ledger-backfill.ts`：兩個寫入函式新增可選參數 `pricingQuality`，非 `"official"` 時把
   `pricing_quality: mis_fallback_full` 附加到該筆 `sim_ledger_weeks.notes` / `sim_ledger_nav.notes`
   欄位裡，方便之後追溯哪些帳本點是靠 MIS fallback 補上的。**`source` 欄位維持 `'live'` /
   `'live_eod'` 不變，沒有新增 CHECK constraint 值、不需要 migration**。

### 沒有動的地方（有意識的邊界）
- `pricingComplete` 本身的公式、YELLOW-1 的 TWSE 日期防呆、`s1_sim_daily` 報告的
  `completion_status` 語意 — 全部不變。這幾個是給「顯示給人看的 EOD 報告」用的誠實度保證，跟帳本
  的連續性需求是兩件事，不應該混在一起改。
- `trading-service.ts`、`broker/*`、risk 相關檔案 — 未觸碰。
- 沒有新增 DB migration。
- 沒有補寫 7/7 的歷史缺口（見下方提案，屬 apply 級）。

---

## 四、驗證

| 項目 | 結果 |
|---|---|
| `pnpm run build:packages` | 綠（5/5 cached） |
| `pnpm typecheck`（全 workspace，含 api/web） | 綠（15/15，0 error） |
| `pnpm test` | 綠（1543 pass / 0 fail / 8 skipped，含新增 3 個 SIM-LEDGER-16/17/18） |
| `pnpm run smoke`（本機起 server + memory workspace） | 綠（1/1 checks pass） |
| prod live 驗證 | 讀到目前真實 gap 位置（見上），非本地推測 |

新增測試（`tests/ci.test.ts`）：
- **SIM-LEDGER-16**：`fullyPriced` 必須是 `officialCloseMarkedCount + misTodayMarkedCount ===
  positions.length`，且明確禁止用 `pricedPositions.length === positions.length`（會誤含 tier 1d
  可能過期的 DB fallback）。
- **SIM-LEDGER-17**：帳本寫入 gate 必須是 `pricingComplete || fullyPriced`；EOD audit log 寫入必須
  維持獨立、只吃 `pricingComplete` 的 if block（回歸測試：防止之後有人把兩個 gate 又合併回去）。
- **SIM-LEDGER-18**：`pricingQuality` 必須從 `s1-sim-runner.ts` 傳到
  `sim-ledger-backfill.ts` 的兩個寫入函式，且非官方定價要留下 `pricing_quality` 追蹤註記；`source`
  欄位值不可變動（防止意外新增需要 migration 的 CHECK constraint 值）。

---

## 五、歷史缺口回補提案（本輪只出方案，不執行 — 需 楊董/Elva ACK 才 apply）

7/7 那天已經過去，EOD 視窗不會重開，程式碼修復是「防未來」，不會自動補上 7/7 的 week 6 + NAV row。
若要把 7/7 補起來，資料來源與作法如下：

### 資料來源
- **新籃子（week 6 進場）**：`s1_sim.signal_generated` / `s1_sim.orders_submitted` 的 7/7 audit_log
  已存在（`internal/s1-sim/status` 證實 basket_size=8、orders accepted=8/8），可直接拿 8 檔
  symbol/shares/target price。
- **7/7 當天收盤價（用來結算 week 5 出場 + week 6 進場定價）**：TWSE `STOCK_DAY_ALL` 現在（7/9）查
  只會回傳最新資料，查不到歷史某天的快照；但 **FinMind `TaiwanStockPrice`**（Phase 1/2 backfill
  引擎既有的 PIT 資料源）可以直接查任何歷史日期的官方收盤，不受「當天有沒有及時發布」影響 —
  這正是 `sim-ledger-backfill.ts` 既有 `fetchFinMindPrices()` 的能力。

### 建議作法（新增一個小工具，不是重跑既有 `runBackfill()`）
`runBackfill()` 目前的設計是「從 `initialEquity=10M` 在給定的 `rebalanceDates[]` 上從頭全部重算」，
不是「對一條已經在跑的 live 帳本補一天」的工具 — 直接把 7/7 塞進 `rebalanceDates` 重跑，會產生一筆
`source='backfill_dry_run'` 的 week 6，跟現有 `source='live'`/`'live_eod'` 的 7/3, 7/6, 7/8 資料並存，
語意會混亂（虛擬回補跟真實 live 資料混在一起）。

較乾淨的做法：寫一個新的 admin-only「single-date live catch-up」端點（沿用
`writeLiveLedgerAfterEod()` 的計算邏輯，但價格來源改成 FinMind PIT 而不是即時 TWSE/TPEX/MIS），
產出的 week 6 / NAV row 一樣標 `source='live'`/`'live_eod'`，但在 `notes` 裡清楚標記
`pricing_quality: finmind_catchup_backfill` 以便日後追溯這筆是事後補的，不是當天即時定價的。

**這屬於新功能開發 + prod 資料寫入，本輪不做**，只在此記錄可行方案；若 楊董/Elva 決定要補，下一輪
可以直接照此方案實作＋走 dry-run→apply 流程。

---

## 六、Lane 邊界

- 只動了 `s1-sim-runner.ts` / `sim-ledger-backfill.ts` / `tests/ci.test.ts` — 帳本 hook 實作本身，
  符合任務指派範圍。
- 沒有動 `trading-service.ts` / `broker/*` / risk 相關檔案 / `apps/web/*` / migration。
- 沒有執行任何 prod 資料寫入或 apply 級操作（只用 owner session 做唯讀 GET 查證）。
- 歷史缺口回補方案只提案，不執行，等待 楊董/Elva ACK。

---

*Jason — IUF Trading Room Backend Strategy Lane*
*2026-07-09*
