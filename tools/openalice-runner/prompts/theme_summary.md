---
prompt_id: openai_theme_summary
version: 1
task_type: theme_summary
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
  themeName: string
  themeId: string (optional; falls back to targetEntityId)
  companyCount: int
  memberCompanies: string[] (optional context; first 20 used)
output_schema:
  type: json_object
  properties:
    summary: string (3–5 sentences, Traditional Chinese, ≤4000 chars)
---

# theme_summary — prompt registry (v1)

**Provider-neutral spec.** The openai backend embeds the system + user strings in
`tools/openalice-runner/llm/openai_backend.py`. This file is the single source of
truth for what we *claim* the prompt does, and how we *validate* what comes back.

## Intent

Given a theme row (themeName + linked-company count + optional sample of member
companies), produce a concise 3–5 sentence research brief in Traditional Chinese
explaining **what the theme is** and **why it matters for the desk**. Used to
seed the review queue; reviewer refines before promoting to the formal
`theme_briefs` table.

## Hard lines (enforced by system prompt + output validator)

- Traditional Chinese (繁體中文) plain text only. No markdown headers, no emojis.
- No trade/order/price/target suggestion. No forward return claims.
- Output JSON: `{"summary": string}`. Anything else is rejected by the validator
  in `openai_backend._validate_theme_summary` → `LlmError("schema_invalid", ...)`
  → registry falls back to rule-template with fallback_reason annotated.

## Evidence flow

1. Runner calls `llm.generate("openai", "theme_summary", params, context)`.
2. Registry resolves backend, runs with timeout / retry / fallback-model.
3. On success: `payload.llm_meta = {provider, model, prompt_id: openai_theme_summary,
   prompt_version: 1, tokens_in, tokens_out, est_cost_usd, attempts, finish_reason}`.
4. On any failure: rule-template draft + `fallback_reason` + `fallback_from`.
5. Draft lands in `content_drafts` with `status=awaiting_review`, Admin guard
   (`REVIEW_ROLES = {Owner, Admin}`) gates approve/reject.
