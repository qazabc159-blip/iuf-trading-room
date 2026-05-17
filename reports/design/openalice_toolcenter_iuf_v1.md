# OpenAlice ToolCenter — IUF 自刻 Design Memo v1

**作者**: Jason (backend-strategy lane)  
**日期**: 2026-05-17  
**狀態**: DESIGN_ONLY — 不含實作程式碼，不含 migration  
**AGPL 合規聲明**: 本 memo 僅參考 OpenAlice 公開 GitHub README/docs 的概念架構，未引用任何 OpenAlice source code。所有 schema、命名、endpoint 設計均為 IUF 自行撰寫。

---

## 1. What is ToolCenter（OpenAlice 概念）

OpenAlice（https://github.com/TraderAlice/OpenAlice）的 ToolCenter 是一個**工具註冊中心（Tool Registry）**，職責為：

1. **工具宣告（Tool Manifest）**：每個可被 agent / Brain 呼叫的工具（function、API endpoint、data source）都有一份結構化的 manifest，描述工具的輸入 schema、輸出 schema、使用成本、呼叫頻率限制。
2. **中央 Discovery**：Brain 或任何 agent 想呼叫工具時，不是 hardcode 工具 URL，而是透過 ToolCenter discovery 查詢「哪些工具可以處理這個 task type」。
3. **統一呼叫記錄**：每次工具呼叫都有 audit record（呼叫者、輸入摘要、耗時、成功/失敗），讓工具使用模式可被分析。
4. **版本管理（Tool Versioning）**：工具可以有版本，呼叫者可以 pin 到特定版本，或追蹤「latest stable」。
5. **能力地圖（Capability Map）**：快速查詢「目前系統有什麼工具」，Brain 決策時可以 introspect 自己的能力邊界。

ToolCenter 讓整個 OpenAlice agent 系統的工具呼叫從「隱性 hardcode 依賴」變成「顯性可觀測的中央管理」。

---

## 2. Pattern：Service Registry + Schema-Validated Tool Call

ToolCenter 的工程基礎來自兩個成熟模式：

### 2.1 Service Registry（Microservices Pattern）

來自微服務架構的服務發現（Service Discovery）模式：

- 每個服務（工具）啟動時向 Registry 登記自己的 endpoint、版本、能力
- Client（呼叫者）透過 Registry 查詢 endpoint，不 hardcode URL
- Registry 提供 health check、load balancing、版本路由

在 ToolCenter 語境：「服務」是「工具」，「Client」是「Brain / agent」，Registry 就是 ToolCenter 本身。

### 2.2 JSON Schema Function Calling（OpenAI / Anthropic Tool Use）

LLM 的 Function Calling 機制本質上就是 ToolCenter 模式：

- 每個 function 有 JSON Schema 定義 `parameters`（name, type, description, required）
- LLM 從 function 清單中選擇最合適的呼叫
- 呼叫結果回填給 LLM 繼續推理

ToolCenter 把這個模式推廣到整個系統（不只是 LLM 呼叫的工具，而是所有可程式化呼叫的 capability）。

| 比較項目 | 目前 IUF 模式 | ToolCenter 模式 |
|---------|-------------|-----------------|
| 工具發現 | 直接 import function | Registry discovery |
| 輸入驗證 | 每個工具各自用 Zod | 統一 manifest schema |
| 使用記錄 | 各自 console.log | 統一 tool_calls table |
| 版本管理 | code deploy = 唯一版本 | manifest 版本號 |
| Brain 調用 | hardcode function name | tool name lookup |

---

## 3. IUF 現有對應

### 3.1 Admin Endpoints（分散式 tool manifest 前身）

IUF 目前有多個 admin endpoints，本質上是「手動觸發工具」的 API：

- `POST /api/v1/admin/themes/links-rebuild` — 觸發 company_theme_links rebuild
- `POST /api/v1/admin/content-drafts/retry-review` — 觸發 AI reviewer retry
- `POST /api/v1/internal/finmind/backfill` — 觸發 FinMind 批次 ingest
- `GET /api/v1/admin/openalice/adversarial-warns` — 查詢高風險 AI 審核

這些都是「工具呼叫」，但沒有：中央 manifest、統一 discovery API、呼叫記錄。

### 3.2 OpenAlice Sub-agents（agent 呼叫工具前身）

IUF 目前的 agent 體系（Pete / Mira / Athena / Bruce / Scott / Diana）是「agent 呼叫工具」的人工層，但工具路由是靠 Elva 人工決策分派，不是程式化 discovery。

- `openalice-ai-reviewer.ts` — AI 審核工具
- `openalice-adversarial-reviewer.ts` — 對抗性審核工具
- `openalice-factual-reviewer.ts` — 事實性審核工具
- `hallucination-rag.ts` — 幻覺偵測工具
- `openalice-bridge.ts` — OpenAlice 橋接工具

每個都是獨立 module，無統一 registry。

### 3.3 openai-quota-guard.ts（工具使用限流前身）

`openai-quota-guard.ts` 是 OpenAI API 的呼叫計數器（daily quota）。這是「工具使用限流」的基礎，但只針對 OpenAI API，沒有 per-tool 粒度，也沒有 DB 持久化。

### 3.4 data-sources/ 目錄（Data Tool 集合）

`apps/api/src/data-sources/` 下有多個 data 工具：
- `finmind-client.ts` — FinMind 財務資料工具
- `discover.ts` — LLM-powered 主題發現工具

這些都是功能完整的「工具」，但無 manifest，無 ToolCenter 可以 introspect。

---

## 4. Gap Analysis

### Gap A：缺乏中央 Tool Manifest Registry

目前沒有一個地方可以查「IUF 系統目前有哪些工具、每個工具接受什麼輸入、有什麼限制」。工具知識只在 code 裡，Brain 無法 programmatically introspect。

### Gap B：缺乏統一 Tool Call Audit

每個工具各自決定要不要 log。部分工具有 `audit_logs` 記錄（如 content draft 相關），但 FinMind sync、hallucination-rag、quota-guard 等都沒有 per-call audit record。

### Gap C：缺乏 Tool Versioning

工具版本隱含在 code deploy 中。若 `openalice-ai-reviewer.ts` 的 prompt 改了，沒辦法追溯「這個 brief 是用哪個版本的 reviewer 生成的」。

### Gap D：Brain 無法自主選擇工具

目前 Brain（LLM 推理）要用工具需要 Elva 人工決策（e.g. 「要用哪個 reviewer？先跑 factual 還是 adversarial？」）。若 Brain 能 query ToolCenter，理論上可以自主選擇最合適的工具組合。

### Gap E：呼叫頻率限制分散管理

OpenAI 有 `openai-quota-guard.ts`，FinMind 有自己的 rate limit 邏輯，KGI 有 40 檔訂閱上限。這些限制沒有在同一個地方管理，新工具接入時容易遺漏限流設計。

---

## 5. IUF ToolCenter v1 Design（Proposed）

### 5.1 Schema Delta

```sql
-- Tool manifest registry（工具靜態宣告）
CREATE TABLE tools (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_key         TEXT    NOT NULL UNIQUE,   -- e.g. "ai_reviewer", "finmind_sync", "hallu_rag"
  display_name     TEXT    NOT NULL,
  description      TEXT    NOT NULL,
  tool_type        TEXT    NOT NULL,
  -- tool_type: "ai", "data_fetch", "admin_action", "analysis", "notification"
  version          TEXT    NOT NULL DEFAULT '1.0.0',
  input_schema     JSONB   NOT NULL DEFAULT '{}'::jsonb,
  -- JSON Schema for input validation
  -- e.g. { "type": "object", "properties": { "draftId": { "type": "string" } }, "required": ["draftId"] }
  output_schema    JSONB   NOT NULL DEFAULT '{}'::jsonb,
  capabilities     JSONB   NOT NULL DEFAULT '{}'::jsonb,
  -- capabilities: { "maxCallsPerDay": 200, "avgLatencyMs": 1500, "requiresDB": true, "requiresOpenAI": true }
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  endpoint_path    TEXT    NULL,     -- 若有 HTTP 觸發路徑，例如 "/api/v1/admin/themes/links-rebuild"
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tool call audit（每次工具呼叫記錄）
CREATE TABLE tool_calls (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id          UUID    NOT NULL REFERENCES tools(id),
  workspace_id     UUID    NULL REFERENCES workspaces(id),  -- NULL = system-level call
  actor_id         UUID    NULL REFERENCES users(id),       -- NULL = system-initiated
  caller_type      TEXT    NOT NULL DEFAULT 'api',
  -- caller_type: "api", "brain", "job", "admin", "test"
  input_summary    JSONB   NOT NULL DEFAULT '{}'::jsonb,    -- 輸入摘要（不含敏感資料）
  output_summary   JSONB   NOT NULL DEFAULT '{}'::jsonb,    -- 輸出摘要
  status           TEXT    NOT NULL DEFAULT 'pending',
  -- status: pending → running → success | failed | timeout
  latency_ms       INTEGER NULL,
  error_message    TEXT    NULL,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ NULL
);

-- index
CREATE INDEX tools_tool_type_idx ON tools (tool_type, is_active);
CREATE INDEX tool_calls_tool_id_idx ON tool_calls (tool_id, started_at DESC);
CREATE INDEX tool_calls_workspace_idx ON tool_calls (workspace_id, started_at DESC) WHERE workspace_id IS NOT NULL;
```

### 5.2 Tool Manifest Format

每個 tool 的 `input_schema` 是標準 JSON Schema（Draft-07），讓 Brain / LLM 可以理解如何呼叫：

```json
{
  "tool_key": "ai_reviewer",
  "display_name": "AI 內容審核",
  "description": "對 content draft 執行 AI 品質審核，返回通過/拒絕/人工複核三態",
  "tool_type": "ai",
  "version": "2.0.0",
  "input_schema": {
    "type": "object",
    "properties": {
      "draftId": { "type": "string", "description": "content_drafts.id" },
      "mode": {
        "type": "string",
        "enum": ["factual", "adversarial", "both"],
        "default": "factual"
      }
    },
    "required": ["draftId"]
  },
  "capabilities": {
    "maxCallsPerDay": 200,
    "avgLatencyMs": 1500,
    "requiresDB": true,
    "requiresOpenAI": true,
    "idempotent": false
  },
  "endpoint_path": "/api/v1/admin/content-drafts/retry-review"
}
```

### 5.3 Endpoint Design

**查詢工具清單（Discovery）**

```
GET /api/v1/tools/registry
Query: { toolType?, isActive? }
Response: 200 {
  tools: [{
    toolKey, displayName, description, toolType, version,
    inputSchema, capabilities, isActive, endpointPath?
  }],
  total
}
```

**查詢單一工具**

```
GET /api/v1/tools/registry/:toolKey
Response: 200 { ...fullManifest }
```

**查詢工具呼叫記錄**

```
GET /api/v1/tools/calls
Query: { toolKey?, workspaceId?, callerType?, status?, limit?, before? }
Response: 200 {
  calls: [{ id, toolKey, callerType, status, latencyMs, startedAt, inputSummary }],
  hasMore
}
```

**工具呼叫統計**

```
GET /api/v1/tools/stats
Query: { windowHours? }
Response: 200 {
  byTool: [{ toolKey, callCount, avgLatencyMs, successRate }],
  totalCalls, windowHours
}
```

**管理：新增/更新工具 Manifest（Owner only）**

```
POST /api/v1/admin/tools
Body: { toolKey, displayName, description, toolType, version, inputSchema, capabilities }
Response: 201 { id, toolKey }

PATCH /api/v1/admin/tools/:toolKey
Body: { displayName?, description?, isActive?, capabilities? }
Response: 200 { toolKey, version }
```

### 5.4 Tool Wrapper Pattern

在現有工具模組加入 ToolCenter 整合，不改變工具本身的邏輯：

```typescript
// 工具呼叫包裝器（偽程式碼）
async function callTool<T>(
  toolKey: string,
  callerType: "api" | "brain" | "job",
  workspaceId: string | null,
  input: unknown,
  fn: () => Promise<T>
): Promise<T> {
  const callId = createToolCallRecord(toolKey, callerType, workspaceId, summarize(input));
  const startMs = Date.now();
  try {
    const result = await fn();
    updateToolCallRecord(callId, "success", Date.now() - startMs, summarize(result));
    return result;
  } catch (err) {
    updateToolCallRecord(callId, "failed", Date.now() - startMs, null, err.message);
    throw err;
  }
}

// 使用範例（在 openalice-ai-reviewer.ts 外部包裝）
const result = await callTool("ai_reviewer", "api", workspaceId, { draftId }, () =>
  fireAiReviewerForDraft(draftId)
);
```

---

## 6. Phase A（3 天可實作 Increment）

**目標**：最小可用 ToolCenter — 靜態 manifest registry + call audit，不改變現有工具邏輯。

**Day 1**：
- 新增 `tools` + `tool_calls` migration（additive-only）
- `tool-registry-store.ts`：`registerTool()`, `listTools()`, `getToolByKey()`
- Seed 現有工具 manifest（7 個核心工具）：
  - `ai_reviewer`, `adversarial_reviewer`, `factual_reviewer`
  - `hallu_rag`, `finmind_sync`, `themes_links_rebuild`, `content_drafts_retry`

**Day 2**：
- `tool-call-store.ts`：`createToolCallRecord()`, `updateToolCallRecord()`, `listToolCalls()`
- `callTool()` wrapper function（純 TypeScript，不改工具本身）
- 在 `fireAiReviewerForDraft()` 的呼叫點包裝 `callTool()`（選擇 1-2 個作為示範）

**Day 3**：
- `GET /api/v1/tools/registry` 路由（公開，只讀 active tools）
- `GET /api/v1/tools/calls` 路由（Owner only，查詢呼叫記錄）
- `GET /api/v1/tools/stats` 路由（Owner only，統計）
- CI test：registry 查詢、call record round-trip

**範圍邊界**：
- `POST /api/v1/admin/tools` 管理 manifest（Phase B 再做，Phase A 靠 seed 腳本）
- Tool versioning 路由（Phase B 再做）
- Brain 自主 tool selection（Phase B 再做，需要 Brain design 確認後整合）

---

## 7. Risks

### R1：tool_calls Volume 爆增

若對每個 OpenAI call、每個 FinMind API call 都建立 `tool_calls` record，日流量可能很大（200+ OpenAI calls/day + FinMind sync 數千筆）。  
緩解：Phase A 只對「顯式觸發型工具」建立 record（admin action、Brain call）；batch job 型工具（FinMind sync）只記錄 job-level summary，不記錄 per-row。

### R2：input_summary 敏感資料外洩

`tool_calls.input_summary` 若不小心存入完整 input（可能含 personId、token、draft content），會造成安全問題。  
緩解：`callTool()` wrapper 的 `summarize()` 函數必須只取 `id` 欄位等非敏感 key，不存任何 content 本體。Lint rule：禁止在 summarize 中存 `content`, `text`, `body` 欄位。

### R3：Manifest 與 Code 不同步

`tools` table 的 `input_schema` 是靜態宣告，若工具的實際輸入 schema 改了但沒更新 manifest，會造成 Brain 基於錯誤 manifest 呼叫工具。  
緩解：Phase A 明確在工具 module 頂部加上 `TOOL_MANIFEST` const export，方便未來自動化 sync；Phase B 引入 CI check 驗證 manifest 與 Zod schema 一致性。

### R4：呼叫者不使用 Wrapper

若工程師直接呼叫工具 function 而不透過 `callTool()` wrapper，audit record 就不會被建立。  
緩解：Phase A 接受不完整覆蓋（先 wrap 最重要的 2-3 個工具），建立 pattern 和 convention；Phase B 做 lint rule 或強制 interface。

---

## 8. References

| 來源 | URL | 用途 |
|------|-----|------|
| OpenAlice GitHub | https://github.com/TraderAlice/OpenAlice | 架構概念參考（僅 README/docs） |
| OpenAI Function Calling | https://platform.openai.com/docs/guides/function-calling | Tool manifest JSON Schema 設計 |
| Anthropic Tool Use | https://docs.anthropic.com/en/docs/build-with-claude/tool-use | Tool definition 格式參考 |
| Netflix Eureka | https://github.com/Netflix/eureka | Service Registry 概念參考 |
| JSON Schema Draft-07 | https://json-schema.org/specification.html | input_schema / output_schema 標準 |

---

**AGPL 合規聲明（重申）**：  
本文件所有 schema 設計、endpoint 命名、wrapper pattern 均為 IUF 獨立設計，未引用 OpenAlice 任何 source file。對 OpenAlice 的參考限於其公開 GitHub README 與 docs 層級的架構說明。
