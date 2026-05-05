# Codex / Elva Coordination Board - 2026-05-05

Status: ACTIVE COORDINATION BOARD
Owner: Codex frontend product owner lane
Cadence: 15-minute heartbeat, gate-aware
Scope: apps/web real-data + product polish coordination only

## Current Frame

- `iuf-25` remains PAUSED.
- This board is for Codex/Elva file-based coordination while Elva reopens the board and path locks.
- Codex must not resume autonomous code changes until the reopen gates below are green or Elva manual dispatch is explicit.

## Reopen Gates

| Gate | Status | Owner | Evidence |
| --- | --- | --- | --- |
| BOARD_REOPEN_2026-05-05.md | READY | Codex draft for Elva/PM review | Created after Commander manual dispatch |
| path_locks_2026-05-05.md | READY | Codex draft for Elva/PM review | Created after Commander manual dispatch |
| Bruce production smoke baseline GREEN | WAITING | Bruce | Required routes: /login, /register, /companies/2330 |
| Operator explicit resume phrase | WAITING | Yang / Elva | Required before reviving old iuf-25; this 15-min board monitor is separate |

## Stop-Lines

- No live submit.
- No Railway secrets.
- No migration 0020 promotion.
- No KGI SDK or broker write-side changes.
- No destructive DB action.
- No fake or mock data presented as live.
- No FinMind or TradingView data as paper fill or risk source.
- No buy/sell recommendation or strategy promotion claim.
- No fake Sharpe, fake equity curve, fake win rate, fake backtest, or fake strategy ranking.
- No ambiguity between odd-lot shares and board-lot lots: 1 board lot = 1,000 shares.

## FinMind Sponsor Rule

FinMind Sponsor 999 is data fuel, not a governance pass. More datasets do not relax Athena schema, Bruce harness, paper, live, or strategy promotion gates.

## Codex Work Allowed Before Full Reopen

- Read Elva/Jason/Bruce/Pete/Mike/Athena handoff files.
- Check git, GitHub, Railway deployment status without secrets.
- Maintain this coordination board.
- Prepare frontend task slices, QA checklists, screenshot manifests, and endpoint gap lists.
- Respond to explicit Elva manual dispatch inside `apps/web/**` and frontend evidence only.

## Codex Work Deferred Until Gate / Dispatch

- Apps/web code changes without Elva manual dispatch.
- New visual redesigns.
- New deferred news/RSS/commercial-data functionality.
- Any backend schema, DB migration, KGI write-side, live-submit, or Railway secret work.

## Next Safe Sequence

1. Confirm #177 evidence-only deploy and latest production web code deploy status.
2. Wait for or ingest `BOARD_REOPEN_2026-05-05.md`.
3. Wait for or ingest `path_locks_2026-05-05.md`.
4. Prepare authenticated dashboard QA checklist for:
   - /login
   - /register
   - dashboard command deck
   - market tape
   - source rail
   - data freshness
   - no fake live
   - no console error
   - no 5xx
   - no mobile overflow
5. Prepare next manual-dispatch slices:
   - FinMind diagnostics UI for `/api/v1/data-sources/finmind/status`
   - Company page real-data refinement
   - OpenAlice daily brief source trail
   - Quant bundle inbox state display

## Heartbeat Log

### 2026-05-05 initial

- Read source: user-provided Commander directive and Elva 9-point gap review.
- Automation: created `iuf-codex-reopen-coordination-15`.
- Gate status: reopen docs not found yet; `iuf-25` remains paused.
- Current action: file-based coordination board created.
- Next action: next heartbeat checks for BOARD_REOPEN/path locks and records safe dispatch readiness.

### 2026-05-05 manual dispatch - restart frame

- Source: Yang instructed Codex to start and push progress immediately.
- Completed: created `BOARD_REOPEN_2026-05-05.md` and `path_locks_2026-05-05.md`.
- Deploy evidence read: latest confirmed web code deploy in local evidence is `738d068` SUCCESS; #177 `8a25331` evidence-only deploy was previously captured as BUILDING and needs fresh verification.
- Gate status: reopen docs READY; Bruce production smoke still WAITING; old `iuf-25` remains PAUSED.
- Next action: verify current Railway/GitHub deployment state, then prepare dashboard QA and frontend manual-dispatch slices without touching forbidden paths.

### 2026-05-05 manual dispatch - deploy and queue check

- Railway status: project `iuf-trading-room`, environment `production`, service `web`.
- Railway deployment list: `893c43f2-c7fd-49f8-9baa-6c62f5c0f33f` is now SUCCESS at 2026-05-05 13:30 Taipei, closing stale BUILDING evidence for #177 / `8a25331`.
- GitHub open PR check: only #39 remains open, draft, and destructive; still BLOCKED by Mike/Pete migration audit.
- Completed: created `codex_frontend_dispatch_slices_2026-05-05.md` with dashboard QA, FinMind diagnostics, company refinement, OpenAlice daily brief, Quant inbox, Pete/Jason/Bruce support slices.
- Next action: run a non-secret local/static frontend readiness pass and prepare the first concrete QA manifest for authenticated dashboard/company pages.

### 2026-05-05 manual dispatch - readiness check

- Typecheck: PASS via `pnpm.cmd --filter @iuf-trading-room/web typecheck`.
- Build: PASS via `pnpm.cmd --filter @iuf-trading-room/web build`; Next generated 13/13 static pages.
- Public route probe: `/login` 200, `/register` 200, `/companies/2330` unauthenticated 307 to `/login?next=%2Fcompanies%2F2330`.
- Evidence: `codex_reopen_readiness_check_2026-05-05.md`.
- Remaining blocker: authenticated production smoke still needs Bruce/test-session path; no token/no secret/no order path was used in this pass.
- Next action: prepare authenticated dashboard/company QA manifest and wait for Bruce/Jason login-path evidence or explicit safe session handoff.

### 2026-05-05 manual dispatch - OpenAlice stale data truthfulness

- User issue: site and OpenAlice surfaces still show old information.
- Diagnosis: stale visible data can come from OpenAlice runner/device missing or stale, pending `content_drafts`, blocked daily brief jobs, or old formal `daily_briefs` rows being presented as normal.
- Files changed: `apps/web/app/briefs/page.tsx`, `apps/web/app/ops/page.tsx`, `apps/web/app/globals.css`.
- Behavior changed: daily brief now compares latest formal brief date to today's Taipei date and marks older rows red `過期`; OpenAlice worker/sweep status and pending daily brief draft count are surfaced; ops latest rows now show `新鮮` / `偏舊` / `過期`.
- Checks: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; `git diff --check` PASS.
- Evidence: `codex_openalice_stale_data_diagnosis_2026-05-05.md`.
- Stop-line proof: no token, no Railway secrets, no backend schema/migration, no KGI write-side, no live submit, no fake brief generation.
- Next action: run local/browser visual QA on `/briefs` and `/ops`; then continue company/K-line/order-desk polish under the same truthful-data rules.

### 2026-05-05 manual dispatch - dashboard OpenAlice source rail

- User issue: dashboard can still imply the system is normal while OpenAlice-backed content is stale.
- Files changed: `apps/web/app/page.tsx`, plus updated diagnosis evidence.
- Behavior changed: dashboard now loads `/api/v1/openalice/observability` and adds `OpenAlice` to the source rail and hero stats; stale/missing worker or sweep renders red `暫停` with latest heartbeat age.
- Checks: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; `git diff --check` PASS for `apps/web/app/page.tsx`.
- Stop-line proof: frontend-only, no token, no schema/migration, no KGI write-side, no live-submit.
- Next action: keep PR #178 as the stale-data truthfulness PR; next slice is authenticated visual QA or company/K-line/order-desk polish if QA session remains unavailable.
