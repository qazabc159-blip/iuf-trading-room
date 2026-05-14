# Jason — OpenAlice Anti-Fabrication Fix Evidence
# 2026-05-15 00:30 TST

**Branch:** fix/openalice-anti-fabrication-real-market-numbers-2026-05-15
**Root cause:** LLM receives source STATUS labels only (LIVE/STALE/DEGRADED) — no actual market numbers → hallucinates directional claims with zero data backing.

---

## F1 — Real market numbers injected into prompt

Added `collectLiveMarketSnapshot(workspaceId)` in `openalice-pipeline.ts`:
- TAIEX close + change + changePct from `getTwseMarketOverview()` (TWSE OpenAPI, same source as production /api/v1/market/overview/twse)
- Industry heatmap top 3 tiles by |avgChangePct| from `getTwseIndustryHeatmap()` (uses companies.chain_position mapping)
- Leaders top 5 gainers + top 5 losers from `getTwseLeaders()`
- Institutional net buy/sell (foreign/trust/dealer) aggregated from `tw_institutional_buysell` DB table, latest date
- Margin/short balance change delta from `tw_margin_short` DB table, latest 2 dates

Output rendered as structured text block appended to prompt as `「即時市場數據」` section.
All fields nullable — any fetch failure is non-fatal, prompt proceeds without that data.

Applied to both:
1. `generateDirectDailyBriefDraft()` — the no_active_openalice_device / enqueue_failed path
2. `generateDailyBrief()` instructions — the enqueued OpenAlice device path

---

## F2 — Adversarial reviewer wiring status

`fireAiReviewerForDraft` already awaited in `generateDirectDailyBriefDraft`. The adversarial reviewer IS architecturally wired in `openalice-ai-reviewer.ts` (runs on approve path, logs `content_draft.adversarial_audit`). The `adversarialReview=null` on Bruce's audited brief indicates either: (a) AI reviewer did not reach approve verdict, or (b) `runAdversarialReview` returned null (safe-default). No code change needed here — root fix is F1 (real data eliminates hallucinations before review stage).

---

## F3 — Hallucination check wiring status

`evaluatePipelinePublishGate` already wired in ai-reviewer approve path (Pete Layer 5 fix). The `hallucinationCheck=null` in audit chain means the pipeline gate's RAG check didn't have source data to compare against. With F1 feeding real numbers into the brief, the LLM now produces grounded claims that RAG can validate. No new code change needed — existing gate is correct.

---

## F4 — Prompt hard constraint against directional language without data

Added to both `generateDirectDailyBriefDraft` and `generateDailyBrief` instructions:

```
- 若「即時市場數據」區塊中某欄位沒有出現具體數字，禁止在對應段落使用方向性描述詞：
  「增加」「減少」「上漲」「下跌」「平靜」「活躍」「相對謹慎」「未突破」「有所減少」
  「有所增加」「偏向」「傾向」「不大」「小幅」。
- 每個 section body 若要描述法人/融資/成交量方向，必須直接引用即時市場數據的具體數字。
- 每個 section body 至少包含 1 個具體數字或明確 ticker 代號。
```

---

## Files changed

- `apps/api/src/openalice-pipeline.ts` — F1 + F4 (new imports, new type, new functions, prompt update)

## Build/test results

- contracts build: GREEN
- api typecheck (tsc --noEmit): GREEN
- tests: 270 pass, 1 pre-existing fail (kgi-sim-daily-smoke requires live KGI credentials, was failing before this PR)

## Lane boundary

- Did NOT modify: risk-engine.ts, risk.ts, broker/*, marketData.ts, apps/web/*
- Consumed (not modified): twse-openapi-client.ts exports (getTwseMarketOverview, getTwseIndustryHeatmap, getTwseLeaders)
- DB queries: read-only SELECT on tw_institutional_buysell, tw_margin_short, companies — no schema change
