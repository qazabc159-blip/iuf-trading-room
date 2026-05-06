# Codex OpenAlice Dispatcher Debug Surface - 2026-05-07

Status: READY FOR REVIEW

Trade Capability Score: +1

## Why this exists

The current daily brief product problem is not styling. The site can show Runner/Dispatcher as healthy while the actual daily brief remains missing or stale. This patch exposes the read-only dispatcher tick result so the operator can see whether today's `daily_brief` job was enqueued, skipped because a job already exists, skipped because a published brief exists, or failed before reaching OpenAlice.

## Files

- `apps/web/lib/api.ts`
- `apps/web/app/briefs/page.tsx`

## Endpoint / Source

- `GET /api/v1/internal/openalice/dispatcher-debug`
- `GET /api/v1/openalice/observability`
- `GET /api/v1/openalice/jobs`
- `GET /api/v1/content-drafts`
- `GET /api/v1/briefs`

## Behavior

- Adds an Owner-only read path for the existing dispatcher debug endpoint.
- `/briefs` now shows `每日簡報派工診斷` with:
  - last dispatcher tick time
  - tick result
  - enqueue error presence
  - next blocker hint
- The panel does not trigger generation, review, publish, or any POST route.
- If today's brief is missing, the operator can now distinguish scheduler/enqueue failure from runner/reviewer/publish backlog.

## Stop-line Proof

- No token value is rendered.
- No OpenAI prompt/result content is fabricated.
- No daily brief is published by this PR.
- No AI reviewer action is triggered.
- No order route, KGI write-side, migration, schema, or DB destructive action is touched.
- No buy/sell recommendation or unapproved strategy metric is added.

## Checks

- `pnpm.cmd --filter @iuf-trading-room/contracts build` PASS
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS
- `git diff --check` PASS with existing CRLF warnings only
- Stop-line grep PASS

## Next

After this is merged/deployed, use `/briefs` to inspect whether the stale daily brief is blocked at dispatcher enqueue, OpenAlice runner claim/result, reviewer verdict, or formal publish.
