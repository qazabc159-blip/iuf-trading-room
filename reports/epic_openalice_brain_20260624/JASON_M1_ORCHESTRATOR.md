# Jason M1 — OpenAlice 決策編排核心

**Owner**: Jason  
**Branch**: `feat/openalice-orchestrator-m1-20260624`  
**Epic**: `reports/epic_openalice_brain_20260624/EPIC_OPENALICE_BRAIN.md`  
**Date**: 2026-06-24  

---

## Plan（實作前思清楚）

### 1. iuf_decisions schema 設計

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | UUID PK | gen_random_uuid() |
| `trigger_type` | TEXT NOT NULL | `"event"` 或 `"signal"` |
| `trigger_id` | TEXT NOT NULL | iuf_events.id (UUID as text) 或 signals.id (UUID as text) |
| `trigger_ref` | JSONB NOT NULL DEFAULT '{}' | 完整 trigger 快照 `{type, id, ruleId/source, ticker, payload}` |
| `reasoning` | TEXT NOT NULL | LLM 推理文 |
| `action_type` | TEXT NOT NULL | enum: `deep_analyze` / `rec_reweight` / `rebalance_suggest` / `priority_alert` |
| `action_payload` | JSONB NOT NULL DEFAULT '{}' | 動作資料（ticker list、weight delta、alert msg 等） |
| `confidence` | REAL NOT NULL DEFAULT 0 | LLM 輸出的置信度 [0.0, 1.0] |
| `priority` | INTEGER NOT NULL DEFAULT 3 | 1=最高, 5=最低 |
| `status` | TEXT NOT NULL DEFAULT 'proposed' | M1 永遠 `proposed`；M2 加 `executing / done / skipped` |
| `outcome` | JSONB NULL | M4 回填驗證結果 |
| `created_at` | TIMESTAMPTZ NOT NULL DEFAULT NOW() | |
| `model_key` | TEXT NULL | 產出本決策的 LLM model |
| `cost_usd` | NUMERIC(10,8) NOT NULL DEFAULT 0 | 本決策 LLM 消耗 |

**UNIQUE guard**: `(trigger_type, trigger_id)` — 同一 event/signal 不產生第二個決策（dedup）。

**CHECK constraints**:
- `action_type IN ('deep_analyze','rec_reweight','rebalance_suggest','priority_alert')`
- `status IN ('proposed','executing','done','skipped')`
- `confidence >= 0 AND confidence <= 1`
- `priority >= 1 AND priority <= 5`
- `cost_usd >= 0`

**Indexes**:
- `(status, created_at DESC)` — M2 讀 proposed 決策用
- `(action_type, created_at DESC)` — 依動作類型查詢
- `(created_at DESC)` — 時序查詢
- UNIQUE index on `(trigger_type, trigger_id)` — dedup

### 2. 編排流（runOpenAliceDecisionTick）

```
每 10 分鐘 poll（比 event-rule-engine 的 5min 慢一拍，讓 events 先寫進去）

1. 讀 iuf_decisions 裡已處理過的 trigger_id 集合（過去 48h 內的 proposed/done/skipped）
2. 讀 iuf_events WHERE triggered_at > NOW() - INTERVAL '2h' — 最近 2h 未決策的 events
   - LEFT JOIN iuf_decisions ON trigger_id = iuf_events.id → 過濾掉已有決策的 events
   - 取最多 10 筆（每 tick 處理有上限）
3. 讀 signals WHERE created_at > NOW() - INTERVAL '2h' — 最近 2h 的 signals
   - 同樣 dedup 過濾
   - 取最多 5 筆
4. 若 events + signals 均為空 → early return (log "no new triggers")
5. 每個 trigger → callLlm() 產結構化決策物件：
   - system prompt: 主腦角色 + action_type enum 定義
   - user prompt: 事件/信號摘要 + 要求輸出 JSON {action_type, action_payload, confidence, priority, reasoning}
   - responseFormat: "json_object"
   - maxTokens: 800, temperature: 0.1
   - callerModule: "openalice_orchestrator", taskType: "decision"
6. parse LLM JSON → validate (action_type whitelist check) → fallback to "priority_alert" on parse failure
7. INSERT iuf_decisions (conflict on trigger dedup → DO NOTHING)
8. 每個 trigger 包在 try/catch → 單一失敗不中斷 tick（safe-default，學 event-rule-engine）
9. 全 tick 包在 try/catch → tick 從不 throw
```

**Budget 護欄**: 沿用 `callLlm()` 的 `getDailyBudgetUsd()` (預設 $10)。每決策 ~800 tokens gpt-4o-mini = ~$0.0005。每 tick 最多 15 calls = ~$0.008/tick，10min 一次 = ~$1.1/day。完全在 budget 內。

### 3. 要動的檔案

| 檔案 | 類型 | 改動 |
|---|---|---|
| `packages/db/migrations/0046_iuf_decisions.sql` | NEW | forward migration |
| `packages/db/migrations/0046_iuf_decisions.down.sql` | NEW | down migration |
| `packages/db/src/schema.ts` | MODIFY | 加 `iufDecisions` Drizzle table |
| `apps/api/src/openalice-orchestrator.ts` | NEW | 決策編排主體 |
| `apps/api/src/server.ts` | MODIFY | 加 tick 註冊 (10min interval, 60s boot-fire) |
| `tests/ci.test.ts` | MODIFY | +4 tests OPENALICE-M1-* |

### 4. 不動的檔案

- `openalice-event-rule-engine.ts` — 只消費 iuf_events，不改產生端
- `signal-auto-emitter.ts` — 只消費 signals，不改產生端
- `risk-engine.ts`, `broker/*`, `apps/web/*` — 嚴守 lane 邊界
- `market-data.ts`, `marketData.ts` — 不碰

---

## 給 M2/M3 的契約

### iuf_decisions 讀法

M2 執行動作時，讀 `status='proposed'` 的決策：

```sql
SELECT id, trigger_ref, action_type, action_payload, confidence, priority, reasoning, created_at
FROM iuf_decisions
WHERE status = 'proposed'
ORDER BY priority ASC, created_at DESC
LIMIT 20;
```

M2 執行後更新狀態：
```sql
UPDATE iuf_decisions SET status = 'done' WHERE id = $id;
-- 或 'skipped' 如果條件不符合執行
```

M4 回填 outcome：
```sql
UPDATE iuf_decisions SET outcome = $jsonb WHERE id = $id;
```

### action_type 語意

| action_type | 觸發條件示例 | M2 執行邏輯 |
|---|---|---|
| `deep_analyze` | 法人連買 / 月營收暴增 / 突破信號 | 呼叫個股 AI 分析 pipeline |
| `rec_reweight` | 市場風險告警 / 籌碼集中 | 調整當日推薦權重 |
| `rebalance_suggest` | S1 EOD 空部位 / 組合風險累積 | 產投組調倉建議（不下單） |
| `priority_alert` | KGI gateway 斷線 / 預算>80% / smoke fail | 推通知中心 + email digest |

### action_payload 結構（按 action_type）

```json
// deep_analyze
{ "tickers": ["2330", "2454"], "reason_tags": ["institutional_buy", "revenue_surge"] }

// rec_reweight  
{ "direction": "reduce_risk", "reason": "market risk flags detected", "weight_delta": -0.2 }

// rebalance_suggest
{ "tickers": ["2330"], "action": "reduce", "reason": "S1 EOD zero positions" }

// priority_alert
{ "message": "KGI gateway state change detected", "severity": "critical", "rule_id": "R10" }
```

---

## 測試清單

1. `OPENALICE-M1-1`: 給假 event (R01 revenue surge) → action_type = `"deep_analyze"` (LLM mock path)
2. `OPENALICE-M1-2`: 同 trigger_id 第二次不產生重複決策（dedup guard）
3. `OPENALICE-M1-3`: LLM 回傳不合法 JSON → fallback to `"priority_alert"`, tick 不 throw
4. `OPENALICE-M1-4`: migration forward SQL 含正確 UNIQUE constraint + CHECK constraints

---

## 改的檔 file:line 摘要

- `packages/db/migrations/0046_iuf_decisions.sql` — 全新
- `packages/db/migrations/0046_iuf_decisions.down.sql` — 全新
- `packages/db/src/schema.ts` — 末尾加 `iufDecisions` table (~25 行)
- `apps/api/src/openalice-orchestrator.ts` — 全新 (~250 行)
- `apps/api/src/server.ts` — 加 import + tick 呼叫 (~15 行，在 BLOCK#6 event engine 段附近)
- `tests/ci.test.ts` — 末尾加 4 個 test (~80 行)
