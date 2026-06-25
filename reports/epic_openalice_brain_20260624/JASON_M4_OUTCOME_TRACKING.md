# Jason M4 — OpenAlice 決策成效追蹤

**Owner**: Jason (backend-strategy lane)
**Branch**: `feat/openalice-m4-outcome-20260625`
**Date**: 2026-06-25
**Epic**: EPIC_OPENALICE_BRAIN.md — 最後里程碑

---

## Plan

### 驗證基準

- entry_date = iuf_decisions.created_at UTC date（決策日）
- entry_close = 決策日收盤（`getCloseOnOrBefore(ticker, entry_date)`，companies_ohlcv）
- ret_1d = 決策日後第 1 個交易日收盤 vs entry_close
- ret_5d = 決策日後第 5 個交易日收盤 vs entry_close
- excess = ret - 0050 同期 return（同 ai-rec-perf 的 benchmark）
- hit = excess > 0

### 只驗「真有產報告」的 deep_analyze

- status = 'done'
- action_type = 'deep_analyze'
- outcome.analyses 至少一個 status='complete' 且 reportSummary 不含「報告生成失敗」sentinel
- skip/budget_exhausted/dedup 的不納入

### 儲存

回填 iuf_decisions.outcome JSONB（jsonb_set），不需 migration。

```jsonb
{
  "verification": {
    "entry_date": "2026-06-25",
    "entry_close": 912.0,
    "ret_1d": 0.0152,
    "ret_5d": null,
    "excess_1d": 0.0087,
    "excess_5d": null,
    "hit_1d": true,
    "hit_5d": null,
    "updated_at": "2026-06-26T15:10:00.000Z"
  }
}
```

### 誠實說明 forward maturity

今日以前的 deep_analyze 決策若 companies_ohlcv 還沒有足夠的 forward 資料（例如今天以前的決策但 +1d 收盤尚未入庫），ret_Nd 保持 null。驗證 cron 每日重跑，直到資料補足為止。M4 是建管道，成績單隨日累積 —— **今天開始的 deep_analyze 決策最快明天才有 ret_1d，5d 要再等 4 個交易日**，這正常。

---

## 複用 ai-rec-perf-store 哪些

| 複用的 pattern | 說明 |
|---|---|
| `getCloseOnOrBefore(db, ticker, dateStr)` | 完全相同 SQL 邏輯（companies_ohlcv + companies JOIN）|
| `getCloseNDaysAfter(db, ticker, dateStr, n)` | 完全相同（OFFSET n-1 pattern）|
| `calcReturn(start, end)` | 完全相同（null-safe, div by zero guard）|
| benchmark = "0050" | 同 ai-rec-perf (0000/TAIEX 不存在於 companies_ohlcv，6/11 prod 驗證)  |
| `execRows<T>(res)` | 從 `@iuf-trading-room/db` 直接 import（ai-rec-perf 也用）|
| daily cron window pattern | 比照 ai-rec-perf cron（15:05–15:25 TST，after ai-rec-perf 14:40–15:00）|

**不 import ai-rec-perf-store.ts** — 保持 lane boundary 乾淨。Price helper 在 verifier 模組內自定義（邏輯相同，scope 獨立）。

---

## outcome.verification schema

```typescript
interface DecisionVerification {
  entry_date: string;        // YYYY-MM-DD (決策日 UTC)
  entry_close: number | null; // 決策日收盤
  ret_1d: number | null;     // +1 trading day return
  ret_5d: number | null;     // +5 trading days return
  excess_1d: number | null;  // ret_1d - 0050_ret_1d
  excess_5d: number | null;  // ret_5d - 0050_ret_5d
  hit_1d: boolean | null;    // excess_1d > 0
  hit_5d: boolean | null;    // excess_5d > 0
  updated_at: string;        // ISO timestamp
}
```

---

## 改的檔 + 行位置

| 檔案 | 改動 |
|---|---|
| `apps/api/src/openalice-decision-verifier.ts` | **新建** — 完整 M4 模組（verifier + cron function + perf summary + test exports）|
| `apps/api/src/openalice-orchestrator.ts` | `getOrchestratorObservability` 加 `decisionPerformance` 欄位（動態 import verifier）|
| `apps/api/src/server.ts` | 在 ai-rec-perf cron 後加 M4 cron block（15:05–15:25 TST 窗口，15min poll）|
| `tests/openalice-orchestrator.test.ts` | 加 12 個 OA-M4-* tests（CI-wired）|

---

## 測試

**29/29 全綠**（含原有 17 個 OA-CAL/OA-GOV tests + 新 12 個 OA-M4-*）

新增測試覆蓋：
- `OA-M4-1/2`: return / excess 計算 + null/zero guard
- `OA-M4-3/4/5`: hasRealReport — clean report vs sentinel vs empty
- `OA-M4-6/7/8`: ticker extraction — tickers[0] / analyses fallback / both missing
- `OA-M4-9`: sentinel string parity（verifier == executor）
- `OA-M4-10`: verifier 只寫 outcome JSONB（no CREATE/ALTER TABLE）
- `OA-M4-11`: SIM-safe — no broker import / no submitOrder
- `OA-M4-12`: orchestrator observability 含 decisionPerformance

---

## Typecheck

`npx tsc --noEmit --project apps/api/tsconfig.json` → 0 errors

---

## Migration 需要嗎？

**不需要**。outcome 已是 JSONB 欄位（migration 0046 建表時即 JSONB），使用 PostgreSQL `jsonb_set` 直接 merge verification sub-object。

---

## Lane 邊界

- openalice-decision-verifier.ts：只讀 companies_ohlcv（price data），只寫 iuf_decisions.outcome
- 不碰：ai-rec-perf-store / risk-engine / broker / market-data / web / ai_rec_pick_snapshots
- orchestrator.ts 改動：僅加 optional `decisionPerformance` 欄位（動態 import，fail-open）
- server.ts 改動：僅加 cron block（M4 範圍內）

---

## decisionPerformance endpoint 輸出

`GET /api/v1/openalice/orchestrator/state` 的 `decisionPerformance` 欄位（M3 UI 可讀）：

```json
{
  "eligible": 8,
  "verified_1d": 3,
  "verified_5d": 0,
  "hit_rate_1d": 0.667,
  "hit_rate_5d": null,
  "avg_excess_1d": 0.0043,
  "avg_excess_5d": null,
  "benchmark": "0050",
  "computed_at": "2026-06-26T15:12:00.000Z"
}
```

eligible=8：今日有 8 個有真報告的 deep_analyze。verified_1d=3：其中 3 個昨天以前的已有 +1d 資料。hit_rate_5d=null：還沒到期，honest。
