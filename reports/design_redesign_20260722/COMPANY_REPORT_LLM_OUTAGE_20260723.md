# 公司頁 AI 分析報告 synthesis 連續失敗根因診斷 — 2026-07-23（Jason-2，唯讀診斷）

## 結論（≤10 行）

1. **層級：既非 IUF 預算牆、既非 OpenAI 帳務 429、既非排程搶額度——是單一 callsite 的
   `maxTokens` 設太小，撞上 gpt-5.5 推理模型的隱藏 reasoning-token 開銷**，導致
   `finish_reason=length` 時 `message.content` 為空字串，`callLlm()` 判為失敗回傳 `null`。
2. **檔案:行號**：`apps/api/src/brain/react-loop.ts:843-849`（company report 最終 synthesis
   呼叫，`maxTokens: 1500`）；模型解析在 `:87`（`LOOP_MODEL_KEY = OPENAI_MODEL_AI_REC ?? ...`）；
   佔位訊息文字在 `:888`。
3. **Log 原文（今晨 prod 實錄）**：`[llm-gateway][brain_react_synthesis] empty content finish_reason=length`。
4. **DB 實證（prod `/api/v1/admin/llm/calls?limit=200`，owner session）**：`brain_react_synthesis`
   / `react_synthesis` 近 5 筆 **5/5 = 100% status=failed, errorCode=EMPTY_CONTENT_length,
   modelKey=gpt-5.5**；同一批次的推理輪 `brain_react`/`react_reason` **20/20 全部
   status=success（同 gpt-5.5）**——證明不是模型或帳務全域故障，是這一個 callsite 的
   token 預算特化問題。HTTP 429 出現次數 = 0（近 500 行 log 掃描）。
5. **對照組**：同檔 `ai-recommendation-v2/orchestrator.ts:792` 的 synthesis 呼叫同樣用
   gpt-5.5 但 `maxTokens: 2048`，且該模組另一支 react_reason 呼叫用 `maxTokens: 768`——
   6/1-7/23 彙總 `ai_rec_v2` 有多筆 `synthesis` 成功記錄（含 gpt-5.5），證明 gpt-5.5 並非
   不能做 synthesis，是這條 company-report 專屬 callsite 預算不夠。

## 故障始點 + 嫌疑 commit

- **嫌疑 commit：`f0816a7b`「feat(ai): upgrade AI rec + brief to gpt-5.5 with deep prompt
  hardening (#991)」，2026-06-05 09:53 +0800**。此 commit 把 `LOOP_MODEL_KEY` 從固定讀
  `OPENAI_MODEL`（預設 gpt-4o-mini）改成優先讀 `OPENAI_MODEL_AI_REC`（現值 `gpt-5.5`，
  `railway variables --service api` 已核）——**這個 key 同時被 react_reason 與
  brain_react_synthesis 兩處呼叫共用**。同一 commit 把 react_reason 的 `maxTokens` 從
  512→2048（commit message 明寫「to accommodate gpt-5.5 internal reasoning token
  overhead」），也把 `ai_rec_v2` 的 synthesis 從 5500→8000/7000→10000 做了同樣調整，
  **唯獨漏了 `react-loop.ts` 自己這條 company-report synthesis 呼叫**——它的 `maxTokens:
  1500` 是 2026-05-19 `7496da88`（#736）設的舊值，自那之後從未被觸碰。
- **保守推斷**：故障極可能自 2026-06-05（該 commit 部署日）起持續至今（~7 週），
  非僅 Bruce 抽查窗口的 12 天。`GET /api/v1/admin/llm/usage?from=2026-06-01&to=2026-07-23`
  彙總顯示 `brain_react_synthesis` 6/1 起共 302 筆呼叫，總成本僅 $0.0513（平均每筆
  $0.00017）——與「幾乎全數空內容、只有極少數舊模型時期成功」的模式吻合（`callLlm` 對
  `EMPTY_CONTENT_*` 一律記 `costUsd:0`）。未能取得比 200 筆更早的逐筆記錄以精確標出
  6/05 之後第一筆失敗，此為**未查證項**，不影響結論方向。

## 修法建議（≤5 行，兩案，不實作等 Elva 裁）

1. **立即恢復（低風險，單行）**：把 `react-loop.ts:847` 的 `maxTokens: 1500` 調高到與
   `ai_rec_v2` 同數量級（建議 6000-8000），比照 6/05 commit 對其他 gpt-5.5 callsite 的
   做法補齊這一處遺漏。**副作用**：每筆真報告會從 $0 變成真實花費（估算全長 9 段報告
   ~$0.03-0.06/筆，遠低於 `LLM_DAILY_BUDGET_USD=8` 日頂），非結構性變更但涉及實際支出
   增加——**列楊董/Elva ACK 項**（即使金額很小，仍是「本來 0 現在有」的行為改變）。
2. **結構性防再發**：`callLlm()` 對 `finish_reason=length` 的空內容目前與其他失敗原因
   （429/parse error/refusal）用同一組 `null` 回傳語意，呼叫端無從分辨「錢不夠」還是
   「token 預算不夠」；建議未來新增 gpt-5.5/o-series 專屬 callsite 時，把 `finish_reason`
   一併寫回 `llm_calls.errorCode`（現有機制其實已經有寫 `EMPTY_CONTENT_${finishReason}`，
   只是沒有告警／CI 檢查會在新 callsite 上線時提醒「這個模型家族的 maxTokens 是否夠」）——
   可考慮加一條輕量測試斷言：所有讀取 `OPENAI_MODEL_AI_REC`/`gpt-5.5` 的 callsite
   `maxTokens` 不得低於某下限（如 4000），CI 掛掉即提醒漏改。

## 與 7/22 既有診斷的關係（重要，避免誤導後續工作）

昨天（2026-07-22）`reports/design_redesign_20260722/AI_PIPELINE_DIAGNOSIS_20260722.md`
（本人前一輪產出）診斷的是「前後端閘門判準不一致導致已生成的真報告被前端二次攔截」，
**前提是後端已經成功產出真報告**。今天的證據顯示這個前提本身不成立——後端
synthesis 自 6/05 起幾乎從未真正產出內容（100% `EMPTY_CONTENT_length`），閘門判準
不一致問題雖然仍是真實存在的架構缺口，但目前**排在更上游的 token 預算問題之後**：
先修好本票的 `maxTokens`，才有真報告可以讓昨天診斷的閘門邏輯發揮作用（或繼續攔截）。
兩票需依序處理，不要只挑昨天那張做就以為報告會恢復。

## 查證方法備忘

- `railway variables --service api` 確認 `OPENAI_MODEL_AI_REC=gpt-5.5`、
  `LLM_DAILY_BUDGET_USD=8`（非 0，非撞頂）、`OPENAI_MODEL=gpt-4o-mini`（僅預設 fallback，
  未被此路徑使用）。
- `railway logs --service api`（近 500 行）grep `llm-gateway|429|quota` 抓到單一關鍵行
  `[llm-gateway][brain_react_synthesis] empty content finish_reason=length`，`HTTP 429`
  出現 0 次。
- Owner session（`POST /auth/login` with `SEED_OWNER_EMAIL`/`SEED_OWNER_PASSWORD`）+
  `GET /api/v1/admin/llm/calls?limit=200` 逐筆核對 `callerModule`/`taskType`/`status`/
  `errorCode`/`modelKey` 分布；`GET /api/v1/admin/llm/usage?from=2026-06-01&to=2026-07-23`
  取得 module 層彙總成本佐證。
- `git log --oneline -- apps/api/src/brain/react-loop.ts` + `git show f0816a7b -- <file>`
  + `git log -p -L 843,850:apps/api/src/brain/react-loop.ts` 定位 maxTokens 修改歷史。
- 全程 0 次觸發新的真實 LLM 生成呼叫（僅讀取既有歷史 log/DB record），未動任何 guard
  邏輯或 `OPENAI_MODEL` 系列環境變數。

## Scope 確認

僅讀取（`Read`/`Grep`/`git log`/`git show`/`railway logs`/`railway variables`/`curl` 唯讀
admin 端點）。0 code change。未碰 `OPENAI_MODEL` 釘選、未碰任何 guard 邏輯、未碰
KGI gateway、未觸發 >3 次真實 LLM 呼叫（本輪 0 次新觸發）。
