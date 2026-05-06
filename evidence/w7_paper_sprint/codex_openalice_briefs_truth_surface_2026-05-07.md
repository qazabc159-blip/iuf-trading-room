# Codex OpenAlice Briefs Truth Surface - 2026-05-07

Status: READY FOR PR
Branch: `fix-web-briefs-openalice-truth-surface-2026-05-07`
Trade Capability Score: `+1`

## Why This Exists

`/briefs` is the product surface for the automated daily research workflow, but the page still contained corrupted Traditional Chinese labels and made the OpenAlice pipeline difficult to diagnose. Production logs show the worker and daily-brief producer are active, so the frontend must clearly distinguish: already published, awaiting review, missing, or blocked.

## Files

- `apps/web/app/briefs/page.tsx`

## Endpoint / Source List

- `GET /api/v1/briefs`
- `GET /api/v1/content-drafts?status=awaiting_review&limit=100`
- `GET /api/v1/openalice/jobs`
- `GET /api/v1/openalice/observability`
- `GET /api/v1/internal/openalice/dispatcher-debug`

## Behavior

- Rebuilds `/briefs` as a readable Traditional Chinese OpenAlice control surface.
- Shows daily brief state as `已發布 / 待審核 / 未產生 / 受阻`.
- Shows runner, dispatcher, queue, latest generation/review/publish timestamps, next run, source pack count, and reviewer verdict.
- Shows dispatcher last tick result and the next action when the daily brief is not visible.
- Shows awaiting-review daily-brief drafts with links to content-draft review.
- Shows formal brief sections only when a published row exists.
- When no published brief exists, keeps the page honest instead of filling with old or fake content.

## Source Semantics

- `PUBLISHED`: today has a published daily brief row.
- `AWAITING_REVIEW`: today has an awaiting-review daily brief draft.
- `MISSING`: no today published row and no today awaiting-review draft.
- `BLOCKED`: API/source unavailable.

## Checks

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` - PASS
- `pnpm.cmd --filter @iuf-trading-room/web build` - PASS
- `git diff --check` - PASS with CRLF warning only
- Mojibake marker scan on `apps/web/app/briefs/page.tsx` - PASS
- Stop-line grep - PASS

## Stop-Line Proof

- No token value in UI, logs, or evidence.
- No OpenAI key or secret touched.
- No auto-publish behavior added.
- No order route, no `/order/create`, no KGI write-side.
- No backend schema, migration, or destructive DB action.
- No fake daily brief; missing content remains missing.
- No buy/sell recommendation; unsafe advice words are masked.
