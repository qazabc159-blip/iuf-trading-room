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

---

## 修復進度追蹤（誠實記錄，尚未 RESOLVED）— 2026-07-23 稍晚

**PR #1344（maxTokens 修復）**：Pete round 1 NEEDS_FIX（沿用 `#991` 自己當天就被
`#996`(`0f71c1bd`) 推翻的舊值）→ round 2 對齊 `#996` 已實戰驗證值（synthesis 8000→28000、
react_reason 4000→16000，並連帶修正 `openalice-strategy-brief.ts` 同款零呼叫紀錄的
`MAX_TOKENS_GENERATOR`）→ Pete round 2 APPROVED → **已 merge（merge commit
`abd3946d`）+ deploy 完成**（`GET /health` `buildCommit=abd3946d` 核對一致）。

**Post-merge 真觸發驗證（本輪，2330）— 發現第二個真 bug，非 RESOLVED**：用與前端相同的
prompt/context（`buildCompanyAiAnalystPrompt("2330")`）打
`POST /api/v1/admin/brain/react/run`，`run_id=bccb4f1a-0cf3-4942-8ae4-1b9452fa2732`。
**仍然回傳同一句佔位訊息**「報告生成失敗（LLM 配額不足）」，但這次原因不同：查
`GET /api/v1/admin/llm/calls` 該筆 `brain_react_synthesis` 呼叫顯示
`status=failed, errorCode=FETCH_ERROR, latencyMs=25002`——`25002ms` 精準對上
`llm-gateway.ts:108` 的 `DEFAULT_TIMEOUT_MS=25_000`（`AbortController` 在整整 25 秒觸發，
非真網路錯誤）。根因：`react-loop.ts` 的 synthesis `callLlm()` 呼叫從未設定 `timeoutMs`，
沿用 25 秒預設——`maxTokens=1500/8000` 時代夠用，但 #1344 把它拉到 28000 後，一次
28000-token 的 gpt-5.5 生成經常超過 25 秒，請求會在生成中途被中止。`orchestrator-v3.ts`
的姊妹 synthesis callsite（同樣 `maxTokens=28000`、同模型）一直都設
`V3_SYNTHESIS_TIMEOUT_MS=240_000`，本輪對齊此值修正。

**PR #1346（timeout 修復，new）**：`apps/api/src/brain/react-loop.ts` 該 callsite
補 `timeoutMs: 240_000`。CI 5/5 綠（validate/DB-mode/Playwright P0/Secret
Regression/W6）。**DRAFT，尚未 merge**：https://github.com/qazabc159-blip/iuf-trading-room/pull/1346

**目前狀態**：`BLOCKED_PENDING_PR_1346_MERGE`——公司報告 synthesis 仍會在 prod 失敗
（timeout 而非 token 不足），直到 #1346 merge+deploy 後才能重新真觸發驗證。**不宣稱
RESOLVED**，待 #1346 merge 後本人會立刻重新觸發並回填最終驗證結果段落。

---

## ✅ RESOLVED — 2026-07-23 第三度真觸發驗證通過

**PR #1346 merge+deploy**：Pete round APPROVED，merge commit `2d9d78dc`。deploy workflow
（databaseId `29975569823`，headSha 精準核對）api job 綠；`GET /health` `buildCommit=
2d9d78dc337fe2b20b7d45792b7a9ce5c7d8a849` 與 merge commit 逐字核對一致。

**第三度真觸發（2330，正式同步阻塞 HTTP 呼叫，`--max-time 300`）**：
`POST /api/v1/admin/brain/react/run`（與前端相同 prompt/context）→ `HTTP 200`，
`TIME_TOTAL=65.78s`（遠低於新 240s 上限，也遠低於 Railway edge 常見 timeout 門檻，
訊號形狀=乾淨完成，非 502/504/連線中斷，排除第三層 infra timeout 假設）。
`run_id=2b0eff39-baf5-4ec1-8e43-b25cbaf13cbd`，`status=complete`，`cost_usd=0.196275`
（`prompt_tokens=11112`、`completion_tokens=7408`，符合 round-2 PR body 估算的
$0.21-0.24/次區間）。

**`admin/llm/calls` 逐筆核對**（owner session）：
```
2026-07-23T02:59:49.540Z brain_react_synthesis react_synthesis gpt-5.5
  status=success errorCode=None promptTokens=3603 completionTokens=3699
  costUsd=0.128985 latencyMs=50086
```
`status=success`、`errorCode=None`（非 `EMPTY_CONTENT_length`、非 `FETCH_ERROR`）、
`completionTokens=3699`（真實輸出，非空內容）——`finish_reason` 未直接入庫，但
`errorCode=None` 且有非零 `completionTokens` 已足以排除 `length`/`FETCH_ERROR` 兩種
已知失敗模式；`latencyMs=50086`（~50s）落在新 240s 上限內、遠低於舊 25s 上限，正是
先前兩輪失敗的直接反證。同批 5 個 `brain_react` 推理輪全數 `status=success`。

**`report_md` 內容真實性驗證**（非佔位、非「品質保護版」樣板）：
- 全文 2736 字元，9 段標題與 `COMPANY_AI_ANALYST_REQUIRED_SECTIONS` **逐字相符**（程式化
  比對，非肉眼判讀），順序正確、無改名無省略。
- 內容引用真實資料：最新價 2400 元、漲跌 -0.41%、成交量 31,653,123 股、資料日期
  2026-07-22、RSI14 40.87、20 日均線 2414.25、60 日均線 2334.10、20 日量比 0.76；三大法人
  與融資融券欄位誠實標註「未取得可用數值」而非造假或籠統帶過。
- 禁字掃描（`get_company_technical`/`run_id`/`too_short`/`保證獲利`/`必漲`/`勝率` 等）：
  **0 命中**。

**前端顯示層驗證（#1341 prod e2e，順收 Pete 的 🟡）**：
- `GET /api/v1/admin/brain/react/company-report/2330`（前端 `AiAnalystReportPanel` 掛載時
  實際呼叫的持久化端點）回傳 `run_id` 與內容跟上述觸發完全一致，證明前端能拿到這份真報告。
- 用 Node 逐行複製 `apps/web/app/companies/[symbol]/aiAnalystReportQuality.ts` 的
  `assessCompanyAiReportQuality()` 判準（9 段字面比對＋
  `ENGINEERING_REPORT_LEAK_PATTERNS`＋`品質保護版`/`保守分析版`字串＋資料缺口句數／可驗證
  數字數／來源類型數門檻），對這份真報告程式化重放：
  `{ ok: true, reason: "ok", dataGapSentences: 2, numericFacts: 86, sourceMentions: 8 }`
  ——全數通過（門檻：缺口句 ≤5、數字 ≥3、來源 ≥3），確認前端嚴格閘門**不會**把這份真報告
  誤判為 `missing_sections`/`low_substance`/`engineering_leak`，會走 `reportQuality.ok`
  分支正常渲染，而非顯示品質攔截空狀態卡。
- **範圍說明（誠實揭露）**：本輪未使用真瀏覽器/Playwright 對 `/companies/2330` 頁面截圖，
  是用「持久化端點內容 = 觸發內容」+「逐行複製前端閘門邏輯程式化重放」兩層替代驗證，
  非畫面級 e2e。若需要畫面級證據（截圖/DOM 檢查），需另一輪派 Playwright 驗證。

**Fast-follow（Pete 抓到同款組合）**：`openalice-strategy-brief.ts:909-918` 的
`generation` callsite 同樣是 `maxTokens=28000`＋gpt-5.5 卻沒設 `timeoutMs`（該
callerModule 過去 7+ 週零呼叫紀錄，未曾在 prod 真的觸發過，屬於「同款組合但未爆」）。
補 `timeoutMs: 240_000`（同款註記）。PR：
https://github.com/qazabc159-blip/iuf-trading-room/pull/1347（CI 5/5 綠，DRAFT，
待 Elva 裁 merge）。

**最終判定**：公司報告 synthesis 12+ 天（實為 ~7 週，since 2026-06-05）100% 失敗
**RESOLVED**（後端 synthesis 成功產出真報告＋前端閘門邏輯驗證會正常渲染）。剩餘非阻擋
待辦：①PR #1347 merge（同款組合的第二個 callsite，防守性修復非本次故障本身）
②畫面級 Playwright e2e（非阻擋，資料層與邏輯層已雙重驗證）。
