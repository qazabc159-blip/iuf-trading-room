# CODEX AI Recommendations v3 Frontend Wiring

## Scope

- Page: `/ai-recommendations`
- Frontend task: connect the SOP v3 panel to `GET /api/v1/ai-recommendations/v3`.
- Hardline: no mock or padded recommendation cards. If v3 has no readable payload, the page shows endpoint, owner, and next action instead of pretending live.

## Changed

- Added `getAiRecommendationsV3()` and flexible v3 response types in `apps/web/lib/api.ts`.
- Added `apps/web/app/ai-recommendations/v3-view.ts` to map real v3 payload into `StockRecCard`.
- Updated `/ai-recommendations` SOP panel:
  - displays real v3 cards when backend items exist,
  - displays `BLOCKED` / `PENDING` / `DEGRADED` state when data is unavailable,
  - names endpoint, owner, and next action,
  - removes the static `等待 Jason v3 payload` placeholder.

## Connected Endpoint

- `GET /api/v1/ai-recommendations/v3`

## Still Pending

- PR #703 backend gate must merge/deploy before production has real v3 items.
- Bruce must verify with an owner session after #703 deploys.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web test -- v3-view ai-rec-v3-sop-ui`
  - 11 files passed, 164 tests passed.
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
  - pass.
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
  - pass.
- `git diff --check`
  - pass; CRLF warning only.
- Browser smoke on local dev `http://localhost:3110/ai-recommendations` with dummy session:
  - desktop 1366x900: route 200, v3 title present, endpoint present, owner present, old waiting placeholder removed, no console/page errors.
  - mobile 390x844: route 200, v3 title present, endpoint present, owner present, old waiting placeholder removed, no console/page errors.

## Screenshots

- `evidence/w7_paper_sprint/p0-ai-rec-v3-panel-2026-05-18/screens/ai-rec-v3-desktop.png`
- `evidence/w7_paper_sprint/p0-ai-rec-v3-panel-2026-05-18/screens/ai-rec-v3-mobile.png`
