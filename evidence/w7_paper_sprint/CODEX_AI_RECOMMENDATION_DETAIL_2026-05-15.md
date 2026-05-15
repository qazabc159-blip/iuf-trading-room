# CODEX AI Recommendation Detail Route — 2026-05-15

## Scope
- Added a shareable AI recommendation detail route: `/ai-recommendations/[id]`.
- Added `getRecommendationDetail(id)` for existing backend `GET /api/v1/recommendations/:id`.
- Added same-origin GET proxy at `/api/recommendations/[id]` for future drawer/client consumption.
- Added a `查看詳情` link on each `/ai-recommendations` card.

## Safety
- Frontend-only change under `apps/web`.
- No broker/risk/contracts edits.
- No KGI live broker write.
- No default live execution mode.
- Detail page only displays Orchestrator-returned fields; missing values render as `-` or `資料同步中`.

## Verification
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` → PASS.
- Browser smoke with local fake Recommendation API:
  - `/ai-recommendations` renders ticker `2330`.
  - Card has `/ai-recommendations/rec-2330` detail link.
  - `/ai-recommendations/rec-2330` renders detail page with `QUOTE` / `PENALTY` data quality badges.
  - Handoff link resolves to `/portfolio?ticker=2330&prefill=true&from_rec=rec-2330&entry=910-925&stop=880&tp=960`.
  - No hard console errors.
- Screenshot: `evidence/w7_paper_sprint/CODEX_AI_RECOMMENDATION_DETAIL_2026-05-15.png`.

## Runtime Finding Fixed
- Browser smoke caught a Next runtime error from `<style jsx>` inside the new server page.
- Fixed by switching the new detail page to ordinary `<style>` tags with scoped `_rec-detail-*` class names.
