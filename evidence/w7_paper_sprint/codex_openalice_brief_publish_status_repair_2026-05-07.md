# Codex OpenAlice Brief Publish Status Repair - 2026-05-07

Status: READY FOR PR
Branch: `fix-openalice-brief-published-status-2026-05-07`
Trade Capability Score: `+1`

## Why This Exists

Production worker logs show the daily-brief producer is running and skipping because a formal row already exists:

`producer daily-brief ok {"date":"2026-05-06","skipped":true,"route":"skipped_existing_formal_row",...}`

But the frontend can still show no published daily brief because approved OpenAlice rows were written as `status = "approved"` while the public `DailyBrief` contract only accepts `draft | published`. Worker fallback rows also wrote `status = "draft"` even though the producer treated them as formal daily brief rows. This made the website look empty even when the automation had produced content.

## Files

- `apps/api/src/content-draft-store.ts`
- `apps/worker/src/jobs/daily-brief-producer.ts`
- `packages/domain/src/postgres-repository.ts`
- `evidence/w7_paper_sprint/codex_openalice_briefs_truth_surface_2026-05-07.md`

## Behavior

- Future approved OpenAlice daily-brief drafts now write formal `daily_briefs.status = "published"`.
- Future worker fallback daily briefs write `status = "published"` because that path directly creates a formal daily-brief row.
- Legacy `approved` daily-brief rows are normalized to `published` at the repository boundary.
- Legacy worker fallback `draft` rows are normalized to `published` only when `generatedBy = "worker"`.
- Manual draft rows remain `draft`.

## Endpoint / Source List

- `GET /api/v1/briefs`
- `POST /api/v1/content-drafts/:draftId/approve`
- worker `runDailyBriefProducer()`

## Checks

- `pnpm.cmd --filter @iuf-trading-room/api typecheck` - PASS
- `pnpm.cmd --filter @iuf-trading-room/worker typecheck` - PASS
- `pnpm.cmd --filter @iuf-trading-room/domain build` - PASS
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` - PASS
- `pnpm.cmd --filter @iuf-trading-room/api build` - PASS
- `pnpm.cmd --filter @iuf-trading-room/worker build` - PASS
- `pnpm.cmd --filter @iuf-trading-room/web build` - PASS
- `git diff --check` - PASS with CRLF warning only

## Stop-Line Proof

- No token value, OpenAI key, FinMind token, or Railway secret touched.
- No auto-publish gate relaxation for red/yellow content.
- No order route, no KGI write-side, no broker submit.
- No migration, schema, or destructive DB action.
- No fake daily brief; this only makes already formal rows visible through the public contract.
- No buy/sell recommendation or strategy metric added.
