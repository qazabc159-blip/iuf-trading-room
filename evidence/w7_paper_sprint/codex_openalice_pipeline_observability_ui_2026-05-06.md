# Codex OpenAlice Pipeline Observability UI - 2026-05-06

## Scope

Trade Capability Score: +1.

Workflow improved: `/briefs` now shows the autonomous OpenAlice daily pipeline lifecycle instead of only worker/sweep counters. This helps explain why the daily brief is stale, awaiting review, published, or blocked without fabricating content.

## Files

- `apps/web/lib/api.ts`
- `apps/web/app/briefs/page.tsx`
- `evidence/w7_paper_sprint/codex_openalice_pipeline_observability_ui_2026-05-06.md`
- `evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md`

## Endpoint / Source

- `GET /api/v1/openalice/observability`
- New frontend fields are read from the backend `pipeline` addendum:
  - `lastGeneratedAt`
  - `lastReviewedAt`
  - `lastPublishedAt`
  - `nextRunAt`
  - `lastFailureReason`
  - `sourcePackCount`
  - `reviewerVerdict`

## State Semantics

- `已發布`: `lastPublishedAt` exists.
- `AI 已通過`: reviewer verdict is `approve`, but the brief is not published yet.
- `需要人工審核`: reviewer verdict is `manual_review`.
- `已退回`: reviewer verdict is `reject`.
- `等待 AI 審核`: content has been generated but no reviewer verdict yet.
- `尚未產文`: no generation timestamp exists yet.
- `錯誤`: `lastFailureReason` exists.
- `待接資料`: backend has not exposed the pipeline addendum.

## Stop-Line Proof

- No token value is rendered or logged.
- No fake published daily brief is created.
- No buy/sell recommendation, target price, Sharpe, equity curve, or strategy ranking is added.
- No `/order/create`, KGI write-side, paper submit, migration, schema, or DB destructive path is touched.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/contracts build` PASS.
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS.
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Added-line stop-line grep PASS (`addedLineHits: []`).
- `git diff --check` PASS with CRLF warnings only.
- Production smoke after merge: `/briefs` authenticated view should show the pipeline badge and seven lifecycle fields if `/api/v1/openalice/observability` returns `pipeline`.
