---
prompt_id: openai_company_note
version: 1
task_type: company_note
language: zh-Hant
tone_ch: 專業中立、研究筆記口吻
safety:
  - no trade / price / target / order suggestion
  - no speculation on future performance
  - research note only — never an execution signal
no_broker_reminder: >-
  本 prompt 僅用於內部研究筆記。絕不輸出下單、買賣、價格目標、止損止盈建議。
  全部輸出須 route 進 content_drafts.awaiting_review，再經 Owner/Admin 人工覆核。
input_schema:
  companyName: string
  companyId: string (optional; falls back to targetEntityId)
  ticker: string (optional)
  industry: string (optional)
output_schema:
  type: json_object
  properties:
    note: string (3–5 sentences, Traditional Chinese, ≤4000 chars)
---

# company_note — prompt registry (v1)

Short factual company note used to seed the review queue.

## Hard lines

- Traditional Chinese plain text only.
- No trade / order / target / forward-return claims.
- Output JSON `{"note": string}`; anything else is rejected by
  `openai_backend._validate_company_note` → LlmError → rule-template fallback.

## Evidence flow

Same as `theme_summary.md` — registry handles provider + fallback; meta lands
in `content_drafts.payload.llm_meta`; Admin guard `{Owner, Admin}` gates
approve/reject.
