# 2026-05-19 Codex PR-A AI Recommendations v3 Frontend Gate Start

## Latest merged state
- `origin/main` is at `07fd643` (`#720 fix(web): normalize portfolio kgi quote degraded state`).
- Open PRs: none at cycle start.
- Previous portfolio fixes (#719/#720) are merged and deployed.

## Backend acceptance context from Yang/Elva
- v3 endpoint must not 404.
- Frontend must use `/api/v1/ai-recommendations/v3` as source of truth, not mock-filled cards.
- If backend `itemCount < 5` or `status !== complete`, UI must show backend status explicitly and must not fake-fill to 5 cards.
- Cards must render entry range, stop, TP1/TP2, reason/rationale, risk, source/sourceTrail/source state, synthesis flags, and official announcement source state.

## Production v3 response checked before editing
- HTTP 200 from `https://api.eycvector.com/api/v1/ai-recommendations/v3`.
- `status=synthesis_format_error`
- `itemCount=5`
- `usedFallback=true`
- `fullAiReportParsed=false`
- `synthesisRetryUsed=false`
- `synthesisFallbackUsed=true`

## Chosen frontend-safe task
Tighten `/ai-recommendations` frontend gate so the v3 page/card UI is honest about non-complete/fallback backend state and visibly renders all acceptance fields/source/synthesis flags from the real v3 response.

## Verification target
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- True Browser/Playwright screenshot with owner session.
- Report screenshot absolute path, verified URL, console/network errors, and v3 response summary.
