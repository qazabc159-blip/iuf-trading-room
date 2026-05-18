# 2026-05-18 Frontend Post-Merge QA — AI Recommendation Labels

## Scope
- Clean worktree: `IUF_TRADING_ROOM_APP_frontend_qa_20260518_worktree`
- Branch: `fix/frontend-post-merge-qa-20260518`
- Base after final rebase: `9c43b60`
- Frontend-owned task: remove visible mojibake/garbled labels from the AI Recommendation surface while preserving backend data contracts and SIM-only handoff behavior.

## Shipped in this cycle
- Replaced garbled UI copy in `/ai-recommendations`.
- Added display-label mappings over existing backend enum values instead of changing recommendation data.
- Repaired directly mounted AI recommendation components:
  - `MarketStateBadge`
  - `ReactTracePanel`
  - `RecommendationHandoffLink`
  - `RecommendationFeedbackActions`
  - source-mode label helper
  - AI recommendation handoff helper
- Repaired shared `PageFrame` labels so AI panels do not show broken code labels.

## Verification
- `pnpm.cmd install --offline --frozen-lockfile`
- `pnpm.cmd run build:packages`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- `pnpm.cmd --filter @iuf-trading-room/web exec vitest run app/ai-recommendations/ai-rec-v3-sop-ui.test.ts lib/admin-strategies-3-lane.test.ts`
  - Result: 2 files passed, 75 tests passed.
- `pnpm.cmd --filter @iuf-trading-room/web build`
  - Result: Next build passed. Existing Sentry/OpenTelemetry dynamic-import warning remains.
- Mojibake guard over touched files:
  - Result: no U+FFFD replacement characters and no Unicode private-use characters in touched AI recommendation/PageFrame files.
- Local browser smoke against `http://localhost:3337/ai-recommendations` with a local QA session cookie:
  - desktop screenshot: `post-merge-qa-ai-recommendations-1366x900.png`
  - mobile screenshot: `post-merge-qa-ai-recommendations-390x844.png`
  - result: page renders clean Traditional Chinese labels, no runtime console errors, no horizontal overflow reported by the QA script.

## Known Limit
- `/admin/strategies` is still owner-session protected during local QA. A fake local cookie is not enough because the client auth check calls production `/auth/me` and CORS blocks localhost. This needs a real owner browser session or Bruce/Elva authenticated prod verification.
