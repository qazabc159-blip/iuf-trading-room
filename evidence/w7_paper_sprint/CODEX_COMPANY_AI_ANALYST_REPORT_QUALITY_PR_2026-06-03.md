# Codex Company AI Analyst Report Quality PR — 2026-06-03

## Scope

- Route/page: `/companies/[symbol]` AI 分析師報告 panel.
- Backend: `apps/api/src/brain/react-loop.ts`.
- Frontend: `apps/web/app/companies/[symbol]/AiAnalystReportPanel.tsx`, `aiAnalystReportContract.ts`.
- No broker write path, no KGI live order path, no F-AUTO/S1 SIM lane, no Quant Lab changes.

## Root Cause

公司頁 AI 分析師在 LLM 最終彙整未通過 9 段品質檢查時，會落到 contract fallback。舊 fallback 雖然避免白屏，但把 `too_short`、`generic_data_gap_reason`、`get_company_technical` 等工程標籤與「資料不足」占位文字直接呈現在產品畫面，造成報告看起來像錯誤訊息，不像分析師報告。

## Shipped

- 將 fallback 升級為「保守分析版 / 品質保護版」：
  - 整理已取得的價格、漲跌幅、日K日期、均線、RSI、量能、AI 精選新聞、三大法人資料。
  - 不補故事、不做下單建議。
  - 缺資料時說明缺口與影響，不再逐段顯示「資料不足」。
- 新增品質閘門：
  - final report 不可含 `too_short`、`generic_data_gap_reason`、`generic_placeholder_line`。
  - final report 不可含 raw tool key：`get_company_technical`、`get_news_top10`、`get_market_overview`、`get_institutional_flow`。
  - final report 不可含 template version `company_ai_analyst_report_v1`。
- 前端 prompt 與後端 synthesis prompt 同步要求：
  - 使用產品語言來源標籤，例如「日K線資料」、「AI 精選新聞」、「三大法人籌碼」。
  - 不輸出工具 key、run_id、token、模板版本或工程除錯內容。
- 前端 meta strip:
  - fallback report 顯示「品質保護版」與「保守整理」，不再像壞掉的 `-- / 0`。
  - 加上品質保護 banner，清楚說明只整理已驗證來源、不作下單建議。

## Verification

- `pnpm.cmd --filter @iuf-trading-room/db build` — pass
- `pnpm.cmd --filter @iuf-trading-room/domain build` — pass
- `pnpm.cmd --filter @iuf-trading-room/integrations build` — pass
- `pnpm.cmd exec node --import ./tests/setup-test-env.mjs --import tsx --test apps/api/src/brain/react-loop.test.ts` — 4/4 pass
- `pnpm.cmd --filter @iuf-trading-room/web test -- ai-analyst-report-panel` — 248/248 pass
- `pnpm.cmd --filter @iuf-trading-room/api typecheck` — pass
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` — pass
- `pnpm.cmd test` — 490/490 pass
- `git diff --check` — pass, CRLF warnings only

## Sample Output Guard

Generated fallback sample for `2330` now contains:

- `2330（台積電）`
- `最新可讀價格為 998`
- `MA20 960、MA60 915、MA200 820`
- `半導體先進製程需求升溫`
- `近 30 日三大法人合計淨買賣 1,230,000 股`
- `品質保護版`

And does not contain:

- `too_short`
- `generic_data_gap_reason`
- `generic_placeholder_line`
- `get_company_technical`
- `get_news_top10`
- `get_institutional_flow`

