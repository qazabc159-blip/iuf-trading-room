# Jason M2 — OpenAlice 安全動作集 (Action Execution Layer)

**Owner**: Jason  
**Branch**: `feat/openalice-actions-m2-20260624`  
**Epic**: `reports/epic_openalice_brain_20260624/EPIC_OPENALICE_BRAIN.md`  
**Date**: 2026-06-25  

---

## Plan（實作前決策）

### 1. 執行器架構

選擇「分開 tick」方案（決策產出 vs 動作執行解耦）：

| 元素 | 值 | 理由 |
|---|---|---|
| 新 tick | `runOpenAliceActionTick()` | 與 M1 `runOpenAliceDecisionTick()` 完全獨立 |
| Cadence | 7 min | 偏移 M1 的 10min，不同時觸發 |
| Boot-fire | 90s | M1 是 60s boot-fire，確保 M1 先跑完再執行 |
| 每 tick 上限 | 5 decisions | 最多 3 個 deep_analyze = 最多 $1.50/tick |
| 新檔案 | `openalice-action-executor.ts` | 乾淨分離，不塞入 orchestrator |

### 2. Status 機台

```
proposed  →  executing  →  done     (成功執行)
proposed  →  executing  →  skipped  (低信心/payload 缺欄/不適用)
proposed  →  executing  →  proposed  (重置，讓下一 tick 重試；outer error)
```

migration 0046 的 status CHECK 已包含 `('proposed','executing','done','skipped')`。**不需要 migration 0047**。

### 3. 4 動作對接（file:line）

#### deep_analyze
- **對接點**: `apps/api/src/brain/react-loop.ts` → `runReactLoop()` (line 693)
- **呼叫方式**: dynamic import（`await import("./brain/react-loop.js")`）—— 保持 startup cost 低，與 server.ts brain/react endpoint 同模式
- **初始 prompt**: 含 `COMPANY_AI_ANALYST_REPORT_TEMPLATE_VERSION` marker（line 88）+ `分析標的: TICKER` — 觸發 9 軸公司深析模板
- **工具白名單**: `DEEP_ANALYZE_TOOL_WHITELIST = ["get_company_technical", "get_news_top10", "get_market_overview", "get_institutional_flow", "finmind_sync"]` — 全唯讀
- **預算**: `costCapUsd=$0.50` per call, `maxRounds=4`
- **outcome**: `{ actionType, tickers, analyses: [{ticker, runId, status, costUsd, decisionId, reportSummary}], totalCostUsd }`
- **skip 條件**: `confidence < 0.4` 或 payload 無 tickers

#### priority_alert
- **對接點**: raw SQL `INSERT INTO iuf_events` — 同 `openalice-event-rule-engine.ts` line 883 的 INSERT 模式
- **注意**: `writeEvent()` 在 event-rule-engine 是 `async function`（非 export）。M2 直接 raw SQL，不修改產生端。
- **規格**: `rule_id = 'R_OPENALICE_DECISION'`, `acknowledged = false`, severity 由 priority 映射（1-2→critical, 3→high, 4-5→info）
- **outcome**: `{ actionType, eventId, severity, message, ticker }`
- **冪等**: 每個 decision id 只會執行一次（status 從 executing 更新完就變 done/skipped；fetchProposed 不再取到）

#### rec_reweight
- **對接點**: 無（advisory-only）
- **不改**: 推薦系統任何持久化資料（v3 orchestrator runs / ai_recommendations_runs 表）
- **outcome**: `{ advisory:true, direction, reason, suggestedWeightDelta, realOrderPath:false, recommendationMutated:false }`
- **skip 條件**: payload 缺 `direction` 欄位

#### rebalance_suggest
- **對接點**: 無（advisory-only）
- **不改**: 任何 position 表、訂單表、broker adapter
- **outcome**: `{ advisory:true, suggestedTickers, suggestedAction, reason, realOrderPath:false, positionMutated:false, orderSubmitted:false }`
- **skip 條件**: payload 無 tickers 且無 action

### 4. 安全護欄 (W6 真單零路徑確認)

- `openalice-action-executor.ts` 中**零個** `submitOrder` / `placeOrder` 呼叫（import 層面）
- 零個 `from "./broker/"` 或 `from "../broker/"` import
- `rec_reweight` / `rebalance_suggest` 都附 outcome 欄位 `realOrderPath: false`, `positionMutated: false`, `orderSubmitted: false`
- `deep_analyze` 只呼叫 `runReactLoop()` — Phase A read-only whitelist（無 write 工具）
- **migration 不需要更新**（0046 已含全部 status 值）

### 5. 修改檔案清單

| 檔案 | 類型 | 說明 |
|---|---|---|
| `apps/api/src/openalice-action-executor.ts` | NEW | M2 行動執行器主體 |
| `apps/api/src/openalice-orchestrator.ts` | MODIFY | `getOrchestratorObservability()` 加 `actionTick` state |
| `apps/api/src/server.ts` | MODIFY | import `runOpenAliceActionTick` + tick 註冊 (7min + 90s) + log string |
| `tests/ci.test.ts` | MODIFY | +6 tests OPENALICE-M2-1..6 |

**未動的檔案**:
- `openalice-event-rule-engine.ts` — 只「呼叫」(raw SQL 同模式)，不改產生端
- `brain/react-loop.ts` — dynamic import 呼叫，不改
- `risk-engine.ts`, `broker/*`, `apps/web/*` — lane 邊界全清
- DB schema/migrations — 0046 已足夠，無 migration 0047

---

## 實作

### openalice-action-executor.ts 架構

```
runOpenAliceActionTick(workspaceId?)
  └─ fetchProposedDecisions() → LIMIT 5 ORDER BY priority ASC
  └─ per decision:
       markExecuting(id)
       switch(action_type):
         deep_analyze     → handleDeepAnalyze()  → runReactLoop() (dynamic import)
         priority_alert   → handlePriorityAlert() → INSERT INTO iuf_events (raw SQL)
         rec_reweight     → handleRecReweight()   → advisory outcome only
         rebalance_suggest→ handleRebalanceSuggest()→ advisory outcome only
       markDone(id, outcome) or markSkipped(id, outcome)
       on error: resetToProposed(id) for retry
  └─ try/finally: _actionTickRunning = false
```

### getOrchestratorObservability 改動

在返回物件中加入 `actionTick?: ActionTickState`。動態 import `getActionExecutorTickState()` 避免循環依賴。狀態端點現在同時顯示 M1 決策 tick 和 M2 執行 tick 狀態。

---

## 測試結果

6 tests OPENALICE-M2-1..6（source-text assertions，不需 DB/HTTP）：

| Test | 驗證點 | 結果 |
|---|---|---|
| M2-1 | exports + all 4 action_types in switch | PASS |
| M2-2 | advisory-only (W6 zero broker import paths) | PASS |
| M2-3 | priority_alert → INSERT iuf_events + rule_id + acknowledged=false | PASS |
| M2-4 | status machine (markExecuting/Done/Skipped) + try/finally guard | PASS |
| M2-5 | deep_analyze: DEEP_ANALYZE_TOOL_WHITELIST + dynamic import + template marker | PASS |
| M2-6 | server.ts wires 7min tick + 90s boot-fire | PASS |

TypeScript: 0 errors (apps/api + packages/db)。

---

## Migration 狀態

**不需要 migration 0047**。migration 0046（已由 Mike 審批並上線）的 status CHECK 已包含：`('proposed','executing','done','skipped')`。M2 只需讀取 `status='proposed'` 並更新 status + outcome，均為現有欄位。

---

## W6 真單零路徑確認

M2 行動執行器**確認**零個真實下單路徑：

1. `deep_analyze` — 呼叫 `runReactLoop()` (brain Phase A, read-only whitelist)，不呼叫任何 broker adapter
2. `priority_alert` — 僅寫入 `iuf_events`（告警通知中心），無任何訂單邏輯
3. `rec_reweight` — 純 advisory outcome，不改任何 recommendation 表或 weight 欄位
4. `rebalance_suggest` — 純 advisory outcome，不提交訂單，不改任何 position

零個 `from "./broker/"` 或 `from "../broker/"` import。

---

## 下一步建議

1. **M3 決策閉環 UI** (Jim) — `GET /api/v1/openalice/orchestrator/state` 現在回傳 `actionTick` 欄位，可直接渲染 done/skipped 分布 + 最近 20 decisions 的 outcome
2. **M4 決策成效追蹤** (Jason) — 對 `deep_analyze` 的 outcome 中 brain_decisions.runId 做事後漲跌驗證，回填 `iuf_decisions.outcome.verification`
