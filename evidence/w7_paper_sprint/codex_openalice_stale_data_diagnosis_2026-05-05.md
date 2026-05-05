# Codex OpenAlice / stale data diagnosis - 2026-05-05

Status: FRONTEND TRUTHFULNESS PATCHED
Owner: Codex frontend product owner lane
Timezone: Asia/Taipei

## User concern

The site still shows old information, and OpenAlice-related content appears stale.

## What I verified

- Public API probes to OpenAlice/brief endpoints return `401` without a session; this is expected auth behavior, not proof of backend failure.
- The frontend reads daily briefs from `/api/v1/briefs`.
- OpenAlice generated output does not become a formal daily brief immediately. It can sit in `content_drafts` awaiting review before it is written into `daily_briefs`.
- The worker has a fallback path that can write a backend-generated brief when no active OpenAlice device is available.
- The daily brief producer skips new work if today's formal brief, a non-rejected draft, or a pending job already exists.

## Current working explanation

Old visible information can happen when any of these are true:

1. OpenAlice runner/device is missing or stale.
2. OpenAlice result exists but is still awaiting review in `content_drafts`.
3. A draft or job blocks the worker from enqueueing a fresh daily brief.
4. The formal `daily_briefs` table still has an older latest row, and the frontend previously labeled it as normal.

## Frontend repair applied

Files changed:

- `apps/web/app/briefs/page.tsx`
- `apps/web/app/ops/page.tsx`
- `apps/web/app/globals.css`

Behavior:

- Daily brief now compares the latest formal brief date with today's Taipei date.
- If the latest brief is not today, the page shows red `過期` instead of green `正常`.
- Daily brief now surfaces OpenAlice worker/sweep state and pending daily brief draft count.
- Ops page now warns when OpenAlice worker/sweep is stale or missing.
- Ops latest rows now show `新鮮` / `偏舊` / `過期` based on timestamp age.

## Checks

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS.
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- `git diff --check` PASS for the touched frontend files.

## Stop-line proof

- No token printed, stored, or uploaded.
- No Railway secrets touched.
- No backend schema or migration touched.
- No KGI write-side touched.
- No live submit touched.
- No fake new brief generated.

## Next required backend / ops follow-up

- Bruce/Jason/Elva should verify authenticated `/api/v1/openalice/observability`, `/api/v1/content-drafts?status=awaiting_review`, and `/api/v1/briefs` in production.
- If OpenAlice is stale, restart or re-register the runner/device and inspect queued/running jobs.
- If drafts are awaiting review, approve/reject the daily brief draft explicitly before expecting the formal daily brief page to update.
