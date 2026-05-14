# CODEX_OVERNIGHT ai recommendations 2026-05-15

## Scope

- Branch: `feat/web-codex-ai-recommendations-2026-05-15`
- Worktree: `IUF_TRADING_ROOM_APP_dock_draggable_worktree`
- Files changed:
  - `apps/web/app/ai-recommendations/page.tsx`
  - `apps/web/lib/api.ts`
- Product request: replace the `/ai-recommendations` stub with a frontend wired to Recommendation Orchestrator v1.

## Implementation

- Added `getRecommendationsToday()` client for `GET /api/v1/recommendations/today`.
- Added `sendRecommendationFeedback()` client for `POST /api/v1/recommendations/:id/feedback`.
- `/ai-recommendations` now groups backend `StockRecommendation[]` into the 5 frozen buckets:
  - 今日首選
  - 可布局
  - 等回檔
  - 高風險排除
  - 資料不足暫不推薦
- Primary buckets render open; exclusion/data-insufficient buckets render collapsed.
- Recommendation cards render:
  - ticker / companyName / rank / action / direction / timeHorizon
  - confidence and totalScore bars
  - quant score / strategySource / gateStatus
  - entryZone, invalidation, targets, positionSizing
  - reason sections: technical / chip / news / theme / quant / macro
  - risks
  - dataQuality badges including OK / STALE / MISSING / WEAK and confidencePenalty
  - sourceTrail
  - `/portfolio?ticker=<ticker>&prefill=true&from_rec=<id>&entry=<entry>&stop=<stop>&tp=<tp>`
- If the backend returns no usable data, the page shows "資料同步中" or the auth/sync state. It does not invent frontend scores.
- If backend marks `_mock: true`, the panel marks the source mode as `MOCK FEED`.

## Verification

Command:

```text
pnpm.cmd --filter @iuf-trading-room/web typecheck
```

Result: PASS.

Browser smoke:

```text
Local URL: http://127.0.0.1:3013/ai-recommendations
Cookie gate: local smoke cookie only, no real credentials.
```

Observed:

- Page visible: true.
- Bucket count: 5.
- Empty/degraded bucket blocks: 5.
- Recommendation cards in local smoke: 0 because local smoke did not have a real Owner API session.
- Visible page text contains no `TODO`, no `敬請期待`, no `from_rec=stub`.
- Screenshot: `evidence/w7_paper_sprint/screenshots/overnight_ai_recommendations_desktop.png`.
- Screenshot SHA256: `AA90E8AF06A5F7CC9F6A4CB16487E28AA326E2E9D9202F3917206AB7B267BB02`.

Known follow-up:

- Bruce/Elva should run an Owner-session browser audit after deploy to verify live cards from `GET /api/v1/recommendations/today` render with production auth cookies.

## Safety

- No KGI live broker write path touched.
- No execution mode defaults changed.
- No `apps/api` broker/risk/contracts files touched.
- No IUF_QUANT_LAB or IUF_SHARED_CONTRACTS files touched.
- One-click action only navigates to the trading room prefill route; it does not submit an order.
