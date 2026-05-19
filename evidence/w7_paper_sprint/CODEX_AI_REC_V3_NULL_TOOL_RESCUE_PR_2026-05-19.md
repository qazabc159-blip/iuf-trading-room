# CODEX AI Recommendation v3 Null Tool Rescue - 2026-05-19

## Production finding

`GET https://api.eycvector.com/api/v1/ai-recommendations/v3` returned:

- `status=failed`
- `itemCount=0`
- `usedFallback=false`
- `fullAiReportParsed=true`
- `finalReportMarkdown=Tool not in whitelist: null`

The v3 ReAct loop received `toolName: "null"` as a string from the LLM. The orchestrator treated that literal string as an invalid tool instead of treating it as the model's final-answer sentinel.

## Fix

- Added `normalizeMarketToolNameV3()`.
- Normalizes common final-answer sentinels (`"null"`, `"none"`, `"no tool"`, `"final answer"`, etc.) to real `null`.
- Leaves real tool names unchanged, so the existing whitelist still blocks unapproved tools.
- The existing min-5 backed-card gate remains unchanged.

## Verification

Commands run locally:

```powershell
pnpm.cmd --filter @iuf-trading-room/api typecheck
pnpm.cmd exec node --import ./tests/setup-test-env.mjs --import tsx --test ./tests/ci.test.ts --test-name-pattern "AI-REC-V3-P0-GATE"
```

Results:

- API typecheck: PASS
- Targeted AI-REC-V3 gate tests: PASS
- Full observed `ci.test.ts` run in the targeted process: 430/430 PASS

## Post-merge required verification

After merge and deploy:

1. Trigger `POST /api/v1/admin/ai-recommendations/v3/refresh`.
2. Verify `GET /api/v1/ai-recommendations/v3`.
3. Acceptance remains:
   - `status=complete`
   - `itemCount>=5`
   - `usedFallback=false`
   - `synthesisFallbackUsed=false`
   - cards include entry/stop/TP/reason/risk/source fields

If the LLM still produces fewer than 5 backed cards, the UI must show the degraded status honestly and must not pad fake cards.
