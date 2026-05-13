# TR Common-Window Snapshot UI Mapping — v1

**Date**: 2026-05-12  
**Author**: Jason (backend-strategy)  
**PR**: #387 `feat/api+web-common-window-snapshot-mapping-2026-05-12`  
**Commit**: 39cca57

---

## 1. 任務來源

Codex v46 (lab side) 統一了 `common-window 0050` 為單一共用數字，並分離了：
- `strategyNetAbsoluteReturnPct` — 策略淨報酬
- `benchmark0050ReturnPct` — 0050 基準（同窗，三大策略共用同一個數字）
- `excessVs0050Pp` — 超額報酬

舊的 `compoundReturn` / `compoundReturnNetOfBenchmark` 語意不清，禁用。

---

## 2. API 端變更 (`apps/api/src/server.ts`)

新增 `mapSnapshotToV46()` helper，在 BLOCK #10 `/api/v1/lab/strategy/:strategyId/snapshot` 路由的所有回應路徑（cache-hit / fresh / stale）中應用。

### 映射規則

| v46 output field | 從 raw JSON 取得 | fallback |
|---|---|---|
| `strategyNetAbsoluteReturnPct` | `headlineMetrics.strategyNetAbsoluteReturnPct` | null |
| `benchmark0050ReturnPct` | `headlineMetrics.benchmark0050ReturnPct` | null |
| `excessVs0050Pp` | `headlineMetrics.excessVs0050Pp` | 自動計算 (net - benchmark) |
| `hitRatePct` | `headlineMetrics.hitRatePct` | fallback: `hitRate` |
| `maxDrawdownNetPct` | `headlineMetrics.maxDrawdownNetPct` | fallback: `maxDrawdown` |
| `maxDrawdownInternalExcessPct` | `headlineMetrics.maxDrawdownInternalExcessPct` | null |
| `estimatedEntryTicketCount` | `headlineMetrics.estimatedEntryTicketCount` | null |
| `displayMode` | top-level `displayMode` | `"research_only"` |
| `orderState` | top-level `orderState` | `"blocked"` |
| `brokerWriteAllowed` | top-level `brokerWriteAllowed` | `false` |
| `realOrderAllowed` | top-level `realOrderAllowed` | `false` |
| `registryChangeAllowed` | top-level `registryChangeAllowed` | `false` |

### 舊欄位政策

- `compoundReturn`: 仍傳遞（legacy fallback）；若 `strategyNetAbsoluteReturnPct` 為 null 則 console.warn 記錄 (pre-v46 Lab JSON)
- `compoundReturnNetOfBenchmark`: **不傳遞** — v46 移除
- `_v46Mapped: true` 加入 response 方便 Bruce 驗證

---

## 3. 型別變更 (`apps/web/lib/api.ts`)

`LabStrategySnapshotHeadlineMetrics` 新增 optional v46 欄位 (backward compatible)：
- `strategyNetAbsoluteReturnPct?`
- `benchmark0050ReturnPct?`
- `excessVs0050Pp?`
- `hitRatePct?`
- `maxDrawdownNetPct?`
- `maxDrawdownInternalExcessPct?`
- `estimatedEntryTicketCount?`
- `compoundReturn?` — 改為 optional + @deprecated JSDoc

`LabStrategySnapshot` 新增 optional v46 top-level 欄位：
- `displayMode?` — `"paper" | "shadow" | "live" | "research_only"`
- `orderState?` — `"blocked" | "paper_allowed" | "live_allowed"`
- `brokerWriteAllowed?`, `realOrderAllowed?`, `registryChangeAllowed?`
- `spec.commonWindowStart?`, `spec.commonWindowEnd?`
- `uiCopyHints.commonWindowCaveat_zh?`

---

## 4. 前端變更 (`apps/web/app/lab/three-strategy/[strategyId]/StrategyChartPanel.tsx`)

### D. KPI Grid 更新
- `HeadlineKpiGrid` 改用 `LabStrategySnapshot["headlineMetrics"]` type
- 顯示 `strategyNetAbsoluteReturnPct` (v46) 為主；fallback 到 `compoundReturn` + console.warn
- `最大回撤 (net)` 改用 `maxDrawdownNetPct` (fallback: `maxDrawdown`)
- `Hit Rate` 改用 `hitRatePct` (fallback: `hitRate`)
- 標籤改為「策略淨報酬」（清楚標示 net）

### 新增：ExcessVs0050Card
- 顯示：策略淨報酬 / 0050 同窗 / 超額報酬 (pp)
- 測量窗口 (commonWindowStart → commonWindowEnd)
- Common-window caveat 文字

### 新增：OperationalStateBanner
- 依 `displayMode` 切換顏色/標籤：research_only(灰) / paper(amber) / shadow(紫) / live(綠)
- 顯示 `orderState` → 下單封鎖 / Paper下單開放 / 真實下單開放
- BROKER_WRITE=ON / REAL_ORDER=ON 警告

---

## 5. 嵌入式 Fallback 更新 (`apps/web/app/lab/three-strategy/[strategyId]/StrategyDetailClient.tsx`)

`CONT_LIQ_V36_SNAPSHOT` 更新：
- `displayMode: "research_only"`, `orderState: "blocked"`, `brokerWriteAllowed: false`
- `strategyNetAbsoluteReturnPct: 2.2202`
- `benchmark0050ReturnPct: 0.3840` (**placeholder** — 尚待 Codex v46 確認的共窗 0050 數字)
- `excessVs0050Pp: 2.2202 - 0.3840 = 1.8362`
- `hitRatePct: 0.9231`, `maxDrawdownNetPct: -0.1051`
- `spec.commonWindowStart: "2024-05-30"`, `spec.commonWindowEnd: "2026-03-26"`

---

## 6. 0050 共窗驗證規格 (Bruce)

**必須驗證**：`benchmark0050ReturnPct` 在 cont_liq_v36 / MAIN / rs_20_60 三個 snapshot 回應中**相同**。

驗證指令：
```bash
curl -s /api/v1/lab/strategy/cont_liq_v36/snapshot | jq '.snapshot.headlineMetrics.benchmark0050ReturnPct'
curl -s /api/v1/lab/strategy/strategy_002/snapshot | jq '.snapshot.headlineMetrics.benchmark0050ReturnPct'
curl -s /api/v1/lab/strategy/strategy_003/snapshot | jq '.snapshot.headlineMetrics.benchmark0050ReturnPct'
```

三個輸出必須相等。若 Lab JSON 尚未帶有 v46 欄位，三個都會是 `null` — 這是正確行為（不偽造）。

---

## 7. Build / Test 結果

| Check | Result |
|---|---|
| contracts build | PASS |
| api build | PASS |
| web tsc --noEmit | 0 new errors (pre-existing validator.ts 1 error 不變) |
| pnpm test | 233/233 PASS |
| Lane boundary | PASS — no broker/risk/migration touched |

---

## 8. 假設 (Assumptions)

1. `benchmark0050ReturnPct: 0.3840` 是 placeholder。Lab 確認 v46 JSON 後需更新嵌入式 fallback 數字。
2. Lab JSON 從 GitHub raw URL 讀取，若尚未更新為 v46 schema，所有 v46 欄位為 null（graceful degradation，舊欄位仍可用）。
3. `strategy_002` / `strategy_003` 嵌入式 fallback (`STAGE2_SNAPSHOTS`) 尚未更新 — 此二策略目前無 Stage 2 chart snapshot，與任務範圍無關。
