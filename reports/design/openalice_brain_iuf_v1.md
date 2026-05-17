# OpenAlice Brain（LLM Decision Engine）— IUF 自刻 Design Memo v1

**作者**: Jason (backend-strategy lane)  
**日期**: 2026-05-17  
**狀態**: DESIGN_ONLY — 不含實作程式碼，不含 migration  
**AGPL 合規聲明**: 本 memo 僅參考 OpenAlice 公開 GitHub README/docs 的概念架構，未引用任何 OpenAlice source code。所有 schema、命名、endpoint 設計均為 IUF 自行撰寫。

---

## 1. What is Brain（OpenAlice 概念）

OpenAlice（https://github.com/TraderAlice/OpenAlice）的 Brain 是整個系統的 LLM-powered 決策引擎，職責為：

1. **多模型路由（Model Router）**：根據任務類型、成本預算、速度需求，自動選擇最合適的 LLM 模型（GPT-4o, GPT-4o-mini, Claude...）。不 hardcode 單一模型。
2. **記憶整合（Memory-Aware Reasoning）**：Brain 在推理時可以存取 EventLog（歷史事件）、ToolCenter（可用工具）、UTA（當前持倉）的上下文，做出有全局視野的決策。
3. **自主工具調用（Autonomous Tool Use）**：Brain 不只是一個 LLM wrapper，它可以呼叫 ToolCenter 中的工具（data fetch、analysis、notification），將工具結果整合回推理鏈。
4. **決策記錄（Decision Audit）**：每次 Brain 的推理（prompt、選擇的工具、中間結果、最終輸出）都有完整記錄，讓人類可以 review 和 override。
5. **成本追蹤（Cost Ledger）**：每次 LLM call 的 token 用量和估算成本都記錄，提供 per-workspace 的 LLM 使用量統計。

Brain 是 OpenAlice 整個系統的「指揮官」——它整合了 UTA（執行）、ToolCenter（工具）、EventLog（記憶）、Trading-as-Git（版本歷史），做出高品質的交易決策。

---

## 2. Pattern：ReAct + LLM Cost Ledger

Brain 的工程模式建立在兩個研究成果和一個工程 pattern 上：

### 2.1 ReAct（Reason + Act）

來自 2022 年 Google Brain 論文《ReAct: Synergizing Reasoning and Acting in Language Models》：

> 讓 LLM 在推理（Thought）和行動（Action）之間交替進行，每次 Action 可以呼叫外部工具，工具結果作為 Observation 回填給 LLM，再繼續推理。

```
Thought: 我需要查 2330 的當前持倉
Action: callTool("get_position", { symbol: "2330" })
Observation: { qty: 1000, avgCost: 850 }
Thought: 持倉 1000 股，建議...
Action: callTool("create_content_draft", { ... })
Final Answer: ...
```

IUF Brain 的 ReAct loop：
- Thought = LLM 推理（gpt-4o-mini）
- Action = ToolCenter 工具呼叫
- Observation = 工具返回結果
- 終止條件 = max_rounds 或 LLM 宣告 Final Answer

### 2.2 Cost Ledger

LLM API 費用是 per-token 計費，必須有 per-call 的 token 計數和費用估算：

- `prompt_tokens` + `completion_tokens` → `total_tokens`
- `cost_usd = (prompt_tokens * prompt_price + completion_tokens * completion_price) / 1_000_000`
- 每個 workspace 有 daily / monthly 費用上限，超過上限停止 Brain 呼叫

### 2.3 Model Registry（類 MLflow 概念）

多模型環境需要一個 model registry 管理「哪些模型可用、各自的 cost 和能力」：

| Model | 用途 | Cost (input/output per 1M tokens) |
|-------|------|----------------------------------|
| gpt-4o-mini | 低成本、快速任務（quota guard, brief） | $0.15 / $0.60 |
| gpt-4o | 高品質決策（Brain final reasoning） | $2.50 / $10.00 |
| claude-3-haiku | 備援（若 OpenAI quota 滿） | $0.25 / $1.25 |

---

## 3. IUF 現有對應

### 3.1 分散式 LLM Wrapper（多個獨立 module）

IUF 目前有多個 OpenAI 相關 module，各自獨立：

- `openalice-ai-reviewer.ts` — 內容審核（gpt-4o-mini）
- `openalice-adversarial-reviewer.ts` — 對抗性審核（gpt-4o-mini）
- `openalice-factual-reviewer.ts` — 事實性審核（gpt-4o-mini）
- `openai-news-sentiment.ts` — 新聞情緒分析（gpt-4o-mini）
- `openai-brief-strategy-commentary.ts` — 策略評論（gpt-4o-mini）
- `openai-signal-confidence.ts` — 信號信心度（gpt-4o-mini）
- `openai-strategy-ranker.ts` — 策略排名（gpt-4o-mini）
- `hallucination-rag.ts` — 幻覺偵測（gpt-4o-mini, claim extraction）
- `news-ai-selector.ts` — 新聞選擇（gpt-4o-mini）
- `data-sources/discover.ts` — 主題發現（gpt-4o-mini）

每個 module 各自 hardcode 模型名稱、各自建立 OpenAI client、各自處理 quota（部分走 `openai-quota-guard.ts`，部分不走）。

### 3.2 openai-quota-guard.ts（Cost Control 前身）

`openai-quota-guard.ts` 提供全域每日呼叫次數上限（`OPENAI_DAILY_LIMIT`，default 200）。但：
- 只記錄 call count，不記錄 token 用量
- 不記錄每次呼叫的實際費用
- 沒有 per-workspace 的費用追蹤
- 沒有 DB 持久化（process 重啟後 count 歸零）
- 不支援多模型（只有 gpt-4o-mini 使用路徑）

### 3.3 openalice-bridge.ts（ReAct 前身）

`openalice-bridge.ts` 是 OpenAlice job 管理的橋接層，有 job 佇列（`openalice_jobs` table）和任務分派邏輯。這是 Brain 的「任務管理」部分的前身，但：
- 不是 ReAct loop（沒有 Thought/Action/Observation 結構）
- 沒有 autonomous tool selection（task type 是靜態 mapping）
- 沒有 multi-model routing

### 3.4 openalice-event-rule-engine.ts（Rule-based Decision 前身）

`openalice-event-rule-engine.ts` 是一個 rule-based 的事件觸發器（不是 LLM-powered）。是 Brain 的「決策」功能的規則版，但缺乏 LLM 推理能力。

---

## 4. Gap Analysis

### Gap A：無統一 LLM Call Layer

目前 10 個 LLM module 各自建立 `new OpenAI({ apiKey })` client，各自決定 model、temperature、max_tokens。若要換模型（e.g. 從 gpt-4o-mini 升級到 gpt-4o），需要改 10 個地方。

### Gap B：無 Token 計量與成本追蹤

每次 LLM call 的 `usage.prompt_tokens` 和 `usage.completion_tokens` 沒有記錄到 DB。無法知道：
- 上週用了多少 token？
- 哪個功能最耗費 token？
- 每個 workspace 的 LLM 費用是多少？

### Gap C：無 Model Registry

目前沒有一個地方定義「哪些 model 可用、各自的 cost rate」。若 OpenAI 更新定價，需要人工 grep 所有 module 修改。

### Gap D：無 ReAct Loop

現有 LLM 呼叫都是單輪（single-turn）：送 prompt → 收 response → 結束。Brain 的 ReAct 模式（多輪工具呼叫）目前不存在。`openalice-bridge.ts` 的 job queue 是最接近的，但沒有 LLM 自主選擇工具的能力。

### Gap E：Quota Guard 無持久化

`openai-quota-guard.ts` 的計數器在 process 重啟後歸零。Railway 每次 deploy 都重啟 process，導致 quota 計數無法跨 deploy 持續。若當日 deploy 了 3 次，有效 quota 是 600（3 × 200），不是 200。

### Gap F：無 Brain Override / Human Review

Brain 做出的推理和工具呼叫決策沒有「人類 override」機制。若 Brain 選錯工具或推理錯誤，只能從 log 事後找，沒辦法在決策前插入人工確認步驟。

---

## 5. IUF Brain v1 Design（Proposed）

### 5.1 Schema Delta

```sql
-- Model registry（LLM 模型宣告 + 定價）
CREATE TABLE llm_models (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  model_key       TEXT    NOT NULL UNIQUE,   -- e.g. "gpt-4o-mini", "gpt-4o", "claude-3-haiku"
  provider        TEXT    NOT NULL,          -- "openai" | "anthropic" | "local"
  display_name    TEXT    NOT NULL,
  input_price_per_1m_tokens  NUMERIC(10,6) NOT NULL,  -- USD
  output_price_per_1m_tokens NUMERIC(10,6) NOT NULL,  -- USD
  max_context_tokens INTEGER NOT NULL,
  capabilities    JSONB   NOT NULL DEFAULT '{}'::jsonb,
  -- { "vision": false, "functionCalling": true, "streaming": true }
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- LLM call log（每次 LLM API 呼叫記錄）
CREATE TABLE llm_calls (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID    NULL REFERENCES workspaces(id),  -- NULL = system-level
  model_id         UUID    NOT NULL REFERENCES llm_models(id),
  caller_module    TEXT    NOT NULL,  -- e.g. "ai_reviewer", "brain", "news_sentiment"
  task_type        TEXT    NOT NULL,  -- e.g. "review", "summary", "ranking", "reasoning"
  prompt_tokens    INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens     INTEGER NOT NULL DEFAULT 0,
  cost_usd         NUMERIC(10,8) NOT NULL DEFAULT 0,  -- 估算費用
  latency_ms       INTEGER NULL,
  status           TEXT    NOT NULL DEFAULT 'success',  -- success | failed | quota_exceeded
  error_code       TEXT    NULL,
  -- 不存 prompt / completion 本文（隱私 + 成本），只存摘要
  input_summary    TEXT    NULL,     -- prompt 首 100 字
  output_summary   TEXT    NULL,     -- response 首 100 字
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Brain decision log（ReAct loop 完整記錄）
CREATE TABLE brain_decisions (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID    NOT NULL REFERENCES workspaces(id),
  actor_id         UUID    NULL REFERENCES users(id),  -- NULL = system-initiated
  task_description TEXT    NOT NULL,        -- 任務描述（human-readable）
  task_type        TEXT    NOT NULL,        -- e.g. "strategy_review", "brief_generation", "risk_assessment"
  status           TEXT    NOT NULL DEFAULT 'running',
  -- status: running → completed | failed | awaiting_review
  rounds           INTEGER NOT NULL DEFAULT 0,   -- ReAct 輪數
  tool_calls_made  JSONB   NOT NULL DEFAULT '[]'::jsonb,
  -- [{ round, toolKey, inputSummary, outputSummary, latencyMs }]
  reasoning_trace  TEXT    NULL,            -- LLM 推理摘要（不含完整 prompt）
  final_output     JSONB   NOT NULL DEFAULT '{}'::jsonb,
  human_override   BOOLEAN NOT NULL DEFAULT FALSE,
  override_note    TEXT    NULL,
  total_cost_usd   NUMERIC(10,8) NOT NULL DEFAULT 0,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ NULL
);

-- 每日費用彙總（per workspace per day）
CREATE TABLE llm_cost_daily (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID    NULL REFERENCES workspaces(id),  -- NULL = system-level
  date             DATE    NOT NULL,
  total_calls      INTEGER NOT NULL DEFAULT 0,
  total_tokens     INTEGER NOT NULL DEFAULT 0,
  total_cost_usd   NUMERIC(10,6) NOT NULL DEFAULT 0,
  by_model         JSONB   NOT NULL DEFAULT '{}'::jsonb,
  -- { "gpt-4o-mini": { calls: 150, tokens: 120000, cost: 0.018 }, ... }
  by_module        JSONB   NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, date)
);

-- index
CREATE INDEX llm_calls_workspace_date_idx ON llm_calls (workspace_id, created_at DESC);
CREATE INDEX llm_calls_model_idx ON llm_calls (model_id, created_at DESC);
CREATE INDEX brain_decisions_workspace_idx ON brain_decisions (workspace_id, started_at DESC);
```

### 5.2 統一 LLM Call Layer

```typescript
// llm-gateway.ts — 統一 LLM 呼叫入口
interface LlmCallOptions {
  modelKey?: string;     // 預設從 LLM_DEFAULT_MODEL env 讀
  callerModule: string;  // "ai_reviewer" | "brain" | "news_sentiment" ...
  taskType: string;
  workspaceId?: string | null;
  maxTokens?: number;
  temperature?: number;
}

interface LlmCallResult {
  content: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  costUsd: number;
  callId: string;  -- llm_calls.id
}

// 所有 LLM 呼叫透過此函數，不直接 new OpenAI()
async function callLlm(
  messages: ChatMessage[],
  opts: LlmCallOptions
): Promise<LlmCallResult>
```

**Model 選擇策略**：
1. 呼叫者指定 `modelKey` → 直接用
2. 未指定 → 查 `LLM_DEFAULT_MODEL` env（default: `gpt-4o-mini`）
3. 若 quota 超限（`openai-quota-guard` 返回 false）→ 查 `LLM_FALLBACK_MODEL` env（可設 `claude-3-haiku`）

### 5.3 Brain ReAct Loop（最小版）

```typescript
// brain.ts — ReAct loop
interface BrainTask {
  workspaceId: string;
  taskType: string;
  taskDescription: string;
  context: Record<string, unknown>;  // 初始上下文（持倉、策略狀態等）
  maxRounds?: number;                // default 5
}

interface BrainResult {
  decisionId: string;      -- brain_decisions.id
  finalOutput: unknown;
  rounds: number;
  totalCostUsd: number;
  status: "completed" | "failed" | "awaiting_review";
}

async function runBrain(task: BrainTask): Promise<BrainResult>
```

ReAct 迴圈（偽程式碼）：

```
decision = createBrainDecision(task)

for round = 1 to maxRounds:
  prompt = buildReActPrompt(task, toolManifests, previousObservations)
  llmResponse = callLlm(prompt, { callerModule: "brain", taskType: task.taskType })

  if llmResponse includes "Final Answer":
    break
  
  if llmResponse includes "Action: <toolKey>(<input>)":
    toolResult = callTool(toolKey, "brain", workspaceId, input, fn)
    addObservation(toolResult)
    updateBrainDecision(decision, round, toolKey, toolResult)

updateBrainDecision(decision, status="completed", finalOutput)
return { decisionId, finalOutput, ... }
```

### 5.4 Endpoint Design

**查詢 LLM 模型清單**

```
GET /api/v1/brain/models
Response: 200 {
  models: [{ modelKey, provider, displayName, inputPricePer1mTokens, outputPricePer1mTokens, isActive }]
}
```

**查詢 LLM 呼叫記錄**

```
GET /api/v1/brain/calls
Query: { workspaceId?, callerModule?, limit?, before? }
Response: 200 {
  calls: [{ id, modelKey, callerModule, taskType, totalTokens, costUsd, status, createdAt }],
  hasMore
}
```

**查詢費用統計**

```
GET /api/v1/brain/cost
Query: { workspaceId?, from?, to? }
Response: 200 {
  totalCalls, totalTokens, totalCostUsd,
  byModel: [...], byModule: [...],
  daily: [{ date, calls, tokens, costUsd }]
}
```

**觸發 Brain 任務**

```
POST /api/v1/brain/run
Body: { taskType, taskDescription, context?, maxRounds? }
Response: 202 { decisionId, status: "running" }
```

**查詢 Brain 決策結果**

```
GET /api/v1/brain/decisions/:id
Response: 200 {
  id, taskType, status, rounds, toolCallsMade, reasoningTrace,
  finalOutput, totalCostUsd, startedAt, completedAt
}
```

**Human Override（Owner only）**

```
POST /api/v1/brain/decisions/:id/override
Body: { overrideNote }
Response: 200 { id, humanOverride: true }
```

---

## 6. Phase A（3 天可實作 Increment）

**目標**：最小可用 Brain — 統一 LLM call layer + cost 記錄，不要求 ReAct loop。

**Day 1**：
- 新增 `llm_models` + `llm_calls` migration（additive-only）
- Seed `llm_models`（gpt-4o-mini, gpt-4o, claude-3-haiku 三筆）
- `llm-gateway.ts`：`callLlm()` 函數，統一 OpenAI client 建立 + `llm_calls` 寫入
- 從 `openai-quota-guard.ts` 把 daily limit 邏輯移入 `callLlm()` + 持久化（count 存 `llm_cost_daily`）

**Day 2**：
- 更新 2 個現有 LLM module 使用 `callLlm()` 替代直接 `new OpenAI()`（選 `openalice-ai-reviewer.ts` + `openai-news-sentiment.ts` 作示範）
- `GET /api/v1/brain/models` 路由
- `GET /api/v1/brain/calls` 路由（Owner only）
- `GET /api/v1/brain/cost` 路由（Owner only）

**Day 3**：
- 新增 `brain_decisions` migration
- `brain.ts`：最小版 `runBrain()`（單輪 LLM call，不做 tool loop）
- `POST /api/v1/brain/run` + `GET /api/v1/brain/decisions/:id` 路由
- CI test：`callLlm()` mock + cost record round-trip

**範圍邊界**：
- ReAct multi-round loop（Phase B，需要 ToolCenter 整合）
- Multi-model fallback routing（Phase B）
- Brain autonomous strategy decision（Phase C，需要楊董明確 ACK）
- `LLM_FALLBACK_MODEL`（Phase B）

---

## 7. Risks

### R1：llm_calls Volume 爆增

若全部 LLM call 都走 `llm_gateway.ts`，`llm_calls` table 每日可能新增 200+ rows（gpt-4o-mini quota 限制 200）。長期看 30 天 = 6000+ rows。  
緩解：Phase A 只記錄關鍵 module 的呼叫（ai_reviewer + news_sentiment），其他 module 逐步遷移；`llm_cost_daily` 做每日彙總，`llm_calls` 只保留最近 30 天。

### R2：cost_usd 估算精度

`cost_usd` 是基於 model 定價的估算，實際 OpenAI 帳單可能因 cached tokens / batch API 折扣有差異。  
緩解：明確標注 `llm_calls.cost_usd` 為「估算值」（estimated），以 OpenAI dashboard 為帳單 source of truth；`llm_cost_daily` 加 `is_estimated: true` flag。

### R3：callLlm() 遷移期間雙軌並行

遷移到 `callLlm()` 期間，部分 module 已遷移、部分未遷移，`llm_calls` 記錄不完整，`llm_cost_daily` 彙總低估實際用量。  
緩解：Phase A 誠實標注「覆蓋率 ~20%（2/10 modules）」；前端 cost dashboard 加免責注意；Phase B 完成全部 module 遷移。

### R4：ReAct Loop 工具呼叫風險

Brain 自主呼叫 ToolCenter 中的工具（包含 `create_order`, `paper_submit`）時，若 ReAct loop 判斷錯誤，可能觸發非預期的交易操作。  
緩解：Phase B 的 ReAct loop 初始版「只能呼叫唯讀工具」（data fetch、analysis）；任何「寫入」操作（create_order, content_draft）需要 `awaiting_review` 狀態 + 人工 override ACK，禁止 Brain 全自動觸發。此規則硬寫在 `runBrain()` 中，非 config 可關閉。

### R5：Quota Persistent 與舊 openai-quota-guard.ts 衝突

Phase A 把 daily count 持久化到 `llm_cost_daily`，但 `openai-quota-guard.ts` 仍有 in-memory counter。兩者並行可能導致 quota 雙重扣除或不扣除。  
緩解：Phase A 完成 `callLlm()` 遷移的 module 不再呼叫 `checkAndConsumeQuota()`；Phase B 廢止 `openai-quota-guard.ts` 改為純 DB-driven quota check。

---

## 8. References

| 來源 | URL | 用途 |
|------|-----|------|
| OpenAlice GitHub | https://github.com/TraderAlice/OpenAlice | 架構概念參考（僅 README/docs） |
| ReAct Paper | https://arxiv.org/abs/2210.03629 | ReAct Reasoning+Acting 原始論文 |
| OpenAI Function Calling | https://platform.openai.com/docs/guides/function-calling | Tool calling 實作參考 |
| OpenAI Pricing | https://openai.com/api/pricing | cost_usd 計算基準 |
| Anthropic Pricing | https://www.anthropic.com/pricing | fallback model 定價 |
| IUF openai-quota-guard | apps/api/src/openai-quota-guard.ts | 現有 quota 管理參考 |
| IUF openalice-bridge | apps/api/src/openalice-bridge.ts | OpenAlice job queue 架構參考 |

---

**AGPL 合規聲明（重申）**：  
本文件所有 schema 設計、TypeScript interface、endpoint 命名、ReAct loop 設計均為 IUF 獨立設計，未引用 OpenAlice 任何 source file。對 OpenAlice 的參考限於其公開 GitHub README 與 docs 層級的架構說明。
