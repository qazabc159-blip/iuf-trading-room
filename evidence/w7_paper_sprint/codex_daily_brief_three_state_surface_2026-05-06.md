# Codex Daily Brief Three-State Surface — 2026-05-06

Trade Capability Score: +1

## Changed

- `/briefs` now distinguishes `PUBLISHED`, `AWAITING_REVIEW`, `MISSING`, and `ERROR` for today's daily brief.
- Today awaiting-review drafts are no longer shown as stale failure.
- Owner-only fallback override controls render for awaiting daily-brief drafts and call existing backend endpoints:
  - `POST /api/v1/content-drafts/:id/approve`
  - `POST /api/v1/content-drafts/:id/reject`
- Published brief sections include source trail metadata and mask obvious investment-advice wording.

## Endpoints / Sources

- `GET /api/v1/briefs`
- `GET /api/v1/content-drafts?status=awaiting_review&limit=100`
- `GET /api/v1/session`
- `GET /api/v1/openalice/observability`
- `GET /api/v1/openalice/jobs`

## Verification

- `pnpm.cmd --filter @iuf-trading-room/contracts build` PASS
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS
- Browser QA 1365 + 390 local authenticated awaiting-review fixture PASS
- Manifest: `evidence/w7_paper_sprint/local_visual_qa_daily_brief_three_state_2026-05-06/manifest.json`

## Stop-Line Proof

- no token display/log: PASS
- no fake-live: PASS; old 2026-05-05 brief remains latest history, not today's published brief.
- no order route or submit: PASS
- no buy/sell recommendation: obvious advice terms are masked in published sections.
