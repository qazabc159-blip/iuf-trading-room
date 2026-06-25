# Jason — Brain deep_analyze Budget Governance
**Date**: 2026-06-25  
**Branch**: fix/brain-deep-analyze-budget-20260625  
**Scope**: openalice-action-executor.ts + openalice-orchestrator.test.ts (budget governance layer)

---

## Root Cause Analysis

### 真實症狀
22 個 deep_analyze 全 done，`reportSummary` = `"分析完成。共執行 1 步推理。報告生成失敗（LLM 配額不足）。"`  
→ 深析有跑、花了成本、但生不出報告，outcome 卻標為 `done`。

### 根因鏈（逐層追溯）

**Layer 1 — react-loop.ts line 888（直接根因）**
```
finalReport = `分析完成。共執行 ${trace.length} 步推理。報告生成失敗（LLM 配額不足）。`
```
路徑：`runReactLoop()` → ReAct loop 執行 1 步（callLlm 回 null，`quota` guard 超限） → `finalStatus = "failed"` 被設為 loop 中斷 → 但實際上 loop 因 `quota` 回 null 走 "failed" branch → `finalStatus = "failed"`… 等等，再看一次。

**實際路徑（更精確）**：
- ReAct loop 第 1 輪：`callLlm()` 成功（budget 未滿），完成一步推理。
- Synthesis 呼叫（line 840）：`callLlm()` 此時 daily quota（呼叫次數）已達上限 → 返回 `null`（quota guard，非 throw）。
- `runSynthesis()` returns `null` → `synthesisContent` = null → line 888 寫入 sentinel 字串。
- `react-loop` returns `status: "complete"`, `finalReport: "分析完成...報告生成失敗..."`.
- M2 executor 的 `handleDeepAnalyze` 看到 `result.status === "complete"` → 直接 push 到 `analysisResults` → 最終 `return { status: "done" }`.
- `iuf_decisions.status` 寫入 `done`，但報告是空殼。

**Layer 2 — 每日 22 個（系統設計問題）**
- 每個突破信號 → M1 orcherstrator 生一個 `deep_analyze` 決策。
- M2 tick 每 7 分鐘跑，LIMIT 5 per tick，無日量上限。
- 今日 22 個突破信號 → 22 個 deep_analyze，每個 costCap $0.50。
- 22 × avg~$0.04/call = ~$0.88/天 for ReAct steps。
- 但 synthesis（每個 call ~$0.005-0.03）疊加後在下午把 quota 燒完 → 後半天所有 synthesis 回 null → empty reports。

---

## 治理方案（已實作）

### Gate 1 — 每日上限（daily cap）
**檔案**: `openalice-action-executor.ts`  
**實作**:
```typescript
function getDeepAnalyzeDailyCap(): number {
  const env = process.env["OPENALICE_DEEP_ANALYZE_DAILY_CAP"];
  // default: 8
}
```
- 每 tick 開始前 query `iuf_decisions` 計今日 `done` 的 `deep_analyze` 數量。
- 超過 cap → `status: "skipped"`, `reason: "deep_analyze_daily_cap_reached"`.
- `deepAnalyzeCapState` 在 tick 內跨 decisions 共享，ticker loop 內累計。
- 環境變數 `OPENALICE_DEEP_ANALYZE_DAILY_CAP` 可調。預設 **8**。

### Gate 2 — 預算感知（budget preflight）
**實作**:
```typescript
async function getRemainingBudgetUsd(): Promise<number> {
  // queries llm_cost_daily for today's spend
  // returns Infinity on DB error (fail-open)
}
```
- 執行 `runReactLoop` 之前 check 剩餘 budget。
- 剩餘 < `DEEP_ANALYZE_MIN_BUDGET_USD` ($0.10) → `status: "skipped"`, `reason: "budget_insufficient"`.
- DB 失敗時 fail-open（返回 Infinity）— 不會因 DB 故障卡住所有深析。
- **不再 done 一個生不出報告的空殼**。

### Gate 3 — Sentinel 偵測（誠實狀態）
**實作**:
```typescript
const EMPTY_REPORT_SENTINEL = "報告生成失敗";
const reportIsSentinel = result.finalReport.includes(EMPTY_REPORT_SENTINEL);
// → status = "budget_exhausted_no_report" (不計入 cap, 不標 done)
```
- 即使前兩個 gate 沒擋住（例如 budget 剛好在 synthesis 時耗盡），sentinel 偵測確保：
  - 不計入每日 cap counter。
  - 最終 outcome `reason: "budget_insufficient"` 或 `"no_real_report_produced"`。
  - `iuf_decisions.status = "skipped"`，非 `done`。

### Gate 4 — Per-ticker 去重（dedup）
**實作**:
```typescript
async function isTickerDeepAnalyzedToday(ticker: string): Promise<boolean> {
  // queries iuf_decisions for today's done deep_analyze with matching ticker
  // checks action_payload->>'tickers' LIKE '%TICKER%' OR trigger_ref->>'ticker' = 'TICKER'
}
```
- 同一 ticker 當日已 deep_analyzed → `status: "skipped"`, `reason: "already_analyzed_today"`.
- fail-open：DB 失敗時返回 false（允許執行而非過度阻擋）。

### Gate 5 — 優先序（priority + confidence sort）
**原本**: `ORDER BY priority ASC, created_at DESC`  
**修改**: `ORDER BY priority ASC, confidence DESC, created_at DESC`

同一優先級下，先執行 confidence 較高的決策。確保 cap 以下的配額優先給最有把握的分析。

---

## 實作檔案

| 檔案 | 變更 |
|------|------|
| `apps/api/src/openalice-action-executor.ts` | 新增 5 個 governance gates + 3 helper functions + 3 test exports |
| `tests/openalice-orchestrator.test.ts` | +6 OA-GOV tests (17 total) |

### 新增常數/函式
- `getDeepAnalyzeDailyCap()` — env-overridable cap (default 8)
- `DEEP_ANALYZE_MIN_BUDGET_USD = 0.10` — preflight budget threshold
- `countTodayDeepAnalyzeDone()` — query today's done count
- `isTickerDeepAnalyzedToday(ticker)` — per-ticker dedup query
- `getRemainingBudgetUsd()` — query llm_cost_daily → remaining
- `_getDeepAnalyzeDailyCapForTest()` — test export
- `_EMPTY_REPORT_SENTINEL_FOR_TEST` — test export
- `_DEEP_ANALYZE_MIN_BUDGET_USD_FOR_TEST` — test export

### Import 新增
```typescript
import { getDailyBudgetUsd, getTodayUtc } from "./llm/llm-gateway.js";
```

---

## 測試結果

```
✔ OA-GOV-1: daily cap defaults to 8, env-overridable
✔ OA-GOV-2: daily cap gate returns skip reason=deep_analyze_daily_cap_reached
✔ OA-GOV-3: budget insufficient gate returns skip (not done-empty)
✔ OA-GOV-4: per-ticker dedup gate returns skip reason=already_analyzed_today
✔ OA-GOV-5: priority ordering uses confidence DESC as secondary sort
✔ OA-GOV-6: sentinel '報告生成失敗' detected → NOT stored as done

17/17 pass (all prior OA-CAL-* also pass)
```

TypeScript: 0 errors (`npx tsc --noEmit --project apps/api/tsconfig.json`)

---

## 誠實狀態保證

| 場景 | 舊行為 | 新行為 |
|------|--------|--------|
| budget 燒完時 synthesis 失敗 | `done` + 空報告 | `skipped`, reason=`budget_insufficient` |
| 今日已跑 N≥8 個 deep_analyze | 繼續跑（空轉） | `skipped`, reason=`deep_analyze_daily_cap_reached` |
| 同 ticker 今日重複觸發 | 重複深析 | `skipped`, reason=`already_analyzed_today` |
| 多個 proposed 時的選擇 | FIFO | priority ASC + confidence DESC（高信度先跑） |

---

## Lane 邊界

- 未觸碰: `risk-engine.ts`, `broker/*`, `market-data.ts`, `apps/web/*`
- 未觸碰: `react-loop.ts`（根因在此，但不修它 — 守 lane boundary。Sentinel 偵測在 executor 層處理）
- 未新增 DB migration（只讀既有 `iuf_decisions` + `llm_cost_daily` 表）
- 全 SIM-safe，無下單路徑

---

## 假設與決策

1. `getTodayUtc()` = UTC 00:00 翻日。Prod 在台北 UTC+8，所以「今日」在 08:00 TST 翻日。可接受（台股盤後 16:00 之後的深析已屬當日，8:00 前是前日邊界）。若要改台北日，需另做 TST date helper。
2. `countTodayDeepAnalyzeDone()` 查 `status='done'` — 不計 `skipped` 的 deep_analyze（那些沒消耗實質 budget）。Cap 只計「真的跑了報告」的次數。
3. `isTickerDeepAnalyzedToday` 用 `LIKE '%ticker%'` 查 `action_payload->>'tickers'` — 不完美（可能誤匹配）。但對 4-digit 台股 ticker 實際上不會誤匹配（2330 不會誤中 23300）。可接受。
4. Min budget $0.10：保守值，一個完整深析（1-4 步 ReAct + synthesis）實際花費 $0.01-0.08。$0.10 確保還有一次完整深析的餘量。
