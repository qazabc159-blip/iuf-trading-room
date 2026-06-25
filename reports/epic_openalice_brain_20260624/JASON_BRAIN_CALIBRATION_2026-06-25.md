# Jason Brain Calibration — 2026-06-25

## Skip 根因確認

**真因：`no_tickers_in_payload`（executor line 217，修前）**

4 個 deep_analyze 決策全部 status=skipped，原因：
1. orchestrator 在 `buildUserPrompt` 時雖然把 `ticker` 帶入事件描述，但沒有明確指示 LLM 把 ticker 填入 `action_payload.tickers`
2. LLM 回傳的 `action_payload` 通常是空物件 `{}` 或缺少 `tickers` key
3. executor `handleDeepAnalyze` 在 payload 無 tickers 時直接 skip，沒有嘗試從 `trigger_ref.ticker` 補救

---

## A — observability 漏 SELECT outcome

**檔案：** `apps/api/src/openalice-orchestrator.ts`

**修法：**
- `getOrchestratorObservability()` 的 recentRows SQL SELECT 加 `outcome` 欄位（舊：缺 outcome）
- 回傳型別的 `recent` 陣列加 `outcome: Record<string, unknown> | null`
- map 時加 `outcome: r.outcome ?? null`

**修改位置：**
- 回傳型別 interface：line 383-392 → 加 `outcome` 欄位
- SQL SELECT：`SELECT id, trigger_type, action_type, confidence, priority, status, reasoning, created_at` → 加 `outcome`
- map：加 `outcome: r.outcome ?? null`

---

## B — 主腦決定了卻不執行（ticker 未進 payload）

雙保險修法：

### 保險一：orchestrator prompt 明確要求 ticker 進 action_payload

**檔案：** `apps/api/src/openalice-orchestrator.ts`

修改 `buildUserPrompt()`：
- event 路徑：若有 `ticker`，在 prompt 末加 `IMPORTANT: ... If you choose deep_analyze, you MUST include {"tickers": ["<ticker>"]} in action_payload.`
- signal 路徑：同上，若無 ticker 則提示填相關標的

**修改位置：** `buildUserPrompt()` 函式（line 137-176 修前版本）

### 保險二：executor trigger_ref fallback

**檔案：** `apps/api/src/openalice-action-executor.ts`

修改 `handleDeepAnalyze()`（executor line 210-220 修前）：
- 先嘗試從 `payload["tickers"]` / `payload["ticker"]` 取
- 若仍為空，從 `triggerRef["ticker"]` 補救（orchestrator 在 INSERT triggerRef 時已把原始 iuf_events.ticker 帶入）
- 仍無 ticker → skip，reason 改為 `no_tickers_in_payload_or_trigger_ref`（改名讓 log 更精確）

**效果：** 即使 LLM 忘記填 action_payload.tickers，只要 trigger 本身有 ticker（事件/信號帶股票代號），deep_analyze 仍可執行。

---

## C — 推理英文 → 繁中

**檔案：** `apps/api/src/openalice-orchestrator.ts`

**修改位置：** `SYSTEM_PROMPT` 常數（line 111-135 修前）

加入：
```
- action_type and all JSON keys MUST remain in English (enum values unchanged)
- The "reasoning" field MUST be written in Traditional Chinese (繁體中文)
- If the trigger involves a specific stock ticker, include it in action_payload.tickers as an array
```
JSON schema 範例也改為：
```
"reasoning": "2-3 句繁體中文說明"
```

同時加入禁字規則：
```
- NEVER mention specific returns, profit guarantees, or follow-trade suggestions
```

---

## 測試覆蓋

新增測試檔：`tests/openalice-orchestrator.test.ts`

覆蓋：
- **A**: `getOrchestratorObservability` mock 回傳包含 `outcome` 欄位
- **B1**: `handleDeepAnalyze` 有 ticker 在 payload → 執行（不 skip）
- **B2**: `handleDeepAnalyze` payload 無 ticker 但 triggerRef.ticker 有值 → fallback 執行（不 skip）
- **B3**: `handleDeepAnalyze` payload + triggerRef 均無 ticker → skip with `no_tickers_in_payload_or_trigger_ref`
- **C**: SYSTEM_PROMPT 包含「繁體中文」要求

---

## 修改檔案清單

| 檔案 | 類型 | 變動 |
|------|------|------|
| `apps/api/src/openalice-orchestrator.ts` | 修改 | A（SELECT+型別+map） + B（prompt ticker 指令） + C（SYSTEM_PROMPT 繁中） |
| `apps/api/src/openalice-action-executor.ts` | 修改 | B（trigger_ref fallback） |
| `tests/openalice-orchestrator.test.ts` | 新增 | A/B/C 測試 |
| `reports/epic_openalice_brain_20260624/JASON_BRAIN_CALIBRATION_2026-06-25.md` | 新增 | 本報告 |

---

## SIM-safe 確認

- deep_analyze 仍走 `runReactLoop()` 唯讀路徑（`DEEP_ANALYZE_TOOL_WHITELIST` 不含任何 write tool）
- 無 broker adapter call、無 submitOrder、無 position mutation
- reasoning 繁中不含「跟單」「保證獲利」等禁字（SYSTEM_PROMPT 新增明文禁止）
- 全修改在 openalice-orchestrator.ts + openalice-action-executor.ts + 測試，未碰 web/broker/risk

---

## Lane 邊界

已維持。未碰：`risk-engine.ts`、`broker/*`、`market-data.ts`、`apps/web/*`、任何 migration 檔。
