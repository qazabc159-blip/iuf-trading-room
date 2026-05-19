# Codex AI Recommendation v3 Min-5 Gate PR Evidence - 2026-05-19

## Scope

- Restore the v3 AI recommendation product gate to at least 5 backed cards before a run can be considered complete.
- Keep C bucket / high-risk-exclusion cards visible instead of dropping them, so the UI can honestly show risk exclusions rather than thin results.
- No broker, KGI live order, real-order, risk-contract, or frontend layout changes.

## Production Finding Before Fix

- Endpoint checked: `/api/v1/ai-recommendations/v3`
- Observed after PR #741 deploy:
  - `status=complete`
  - `itemCount=2`
  - `usedFallback=false`
  - `fullAiReportParsed=true`
- Product issue: a 2-item result was marked complete, which violates Yang's PR-A acceptance gate of 5+ real backed cards.

## Code Fix

- `apps/api/src/ai-recommendation-v2/orchestrator-v3.ts`
  - `MIN_V3_RECOMMENDATION_ITEMS` restored to `5`.
  - C bucket parser exclusion removed.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/api typecheck`
- `pnpm.cmd exec node --import ./tests/setup-test-env.mjs --import tsx --test ./tests/ci.test.ts --test-name-pattern "AI-REC-V3"`
- Result: 419 AI-REC-V3 related tests passed.

## Acceptance After Deploy

Bruce/Codex should trigger or wait for a fresh v3 run, then verify:

- GREEN only if:
  - `status=complete`
  - `itemCount>=5`
  - `usedFallback=false`
  - `synthesisFallbackUsed=false`
  - cards include entry, stop, TP1/TP2, rationale, risk, and source trail.
- YELLOW if:
  - less than 5 backed cards, or
  - fallback is used, but the UI clearly shows fallback/non-complete state.

