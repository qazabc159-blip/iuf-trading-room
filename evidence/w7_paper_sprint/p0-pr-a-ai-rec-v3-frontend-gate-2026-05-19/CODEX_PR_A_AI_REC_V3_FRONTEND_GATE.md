# PR-A AI Recommendations v3 Frontend Gate Evidence

## Scope
- Page: `/ai-recommendations`
- Endpoint source of truth: `GET /api/v1/ai-recommendations/v3`
- Rule: no mock cards, no padding to 5 cards, no promotion to live/complete when backend status is not `complete`.

## Production v3 response summary before/after frontend change
- HTTP: `200`
- `status`: `synthesis_format_error`
- `itemCount`: `5`
- `usedFallback`: `true`
- `fullAiReportParsed`: `false`
- `synthesisRetryUsed`: `false`
- `synthesisFallbackUsed`: `true`

Full capture:
- `evidence/w7_paper_sprint/p0-pr-a-ai-rec-v3-frontend-gate-2026-05-19/prod-ai-rec-v3-response.json`
- `evidence/w7_paper_sprint/p0-pr-a-ai-rec-v3-frontend-gate-2026-05-19/prod-ai-rec-v3-summary.json`

## Frontend behavior verified
- The primary AI recommendation panel now uses the v3 response when the v3 endpoint returns.
- Because `status=synthesis_format_error`, the primary gate is shown as `DEGRADED`, not live.
- `itemCount=5` and `visibleCards=5` are displayed.
- `usedFallback=true`, `fullAiReportParsed=false`, `synthesisRetryUsed=false`, and `synthesisFallbackUsed=true` are displayed.
- Cards render backend fields for entry range, stop, TP1, TP2, reason/rationale, risk, source, sourceTrail, sourceState, official announcement source state, and synthesis flags.
- Official announcement source state is visible as `pending` because the v3 response does not include an explicit official announcement `sourceState`.

## Browser evidence
- Browser verified URL: `http://127.0.0.1:3127/ai-recommendations?codexPrA=frontend-gate-20260519`
- Screenshot: `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_pr_a_ai_rec_v3_frontend_gate_20260519\evidence\w7_paper_sprint\p0-pr-a-ai-rec-v3-frontend-gate-2026-05-19\local-ai-recommendations-v3-gate-playwright.png`
- Playwright verify JSON: `evidence/w7_paper_sprint/p0-pr-a-ai-rec-v3-frontend-gate-2026-05-19/local-playwright-verify.json`
- Browser body text capture: `evidence/w7_paper_sprint/p0-pr-a-ai-rec-v3-frontend-gate-2026-05-19/local-playwright-body-text.txt`

## Browser console/network
- `pageErrors`: `0`
- `requestfailed`: `0`
- bad HTTP responses captured by Playwright: `0`
- Console errors: `1` local dev resource message, text: `Failed to load resource: the server responded with a status of 404 (Not Found)`.

## Tests
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web test -- app/ai-recommendations/v3-view.test.ts`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
