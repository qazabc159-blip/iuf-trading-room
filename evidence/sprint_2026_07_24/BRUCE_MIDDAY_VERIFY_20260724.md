# Bruce Midday Post-Deploy Verify — 2026-07-24 (4-merge batch)

Scope: #1358 (boot warmup) / #1359 (institutional honest fallback title) / #1360 (backfill R2 tool, DRY-RUN) / #1361 (qa spec gate). Read-only. Zero order submission. Zero APPLY.

## Pre-check: deploy convergence

- `git fetch origin main` at verify start: tip `ff5e2be1` (#1361), containing `6c48d160` (#1359) < `29585547` (#1360) < `ca8a4d2c` (#1358) < `d0312605`/`bc94544d` (creds sweep) — all 4 target commits present on origin/main.
- `curl https://api.eycvector.com/health` → `buildCommit=6c48d1602d6a4f0636fc4aad94f67fa97e843114`, `deployedAt=2026-07-24T02:21:36.349Z` (10:21:36 Taipei), `deploymentId=72cfa69e-9d77-485a-a99d-92f84983f505`. This buildCommit is `6c48d160` (#1359), which is a descendant of both `ca8a4d2c` (#1358) and `29585547` (#1360) — satisfies the "at least 6c48d160" threshold. #1360 is a non-runtime tool (no server import — see item 3). #1361 is qa-spec-only; its "Deploy to Railway" run had not completed by verify time but is functionally irrelevant to runtime items 1/2/4/5.
- **Gap disclosed**: verify session started ~10:59 Taipei, ~38 min *after* deploy convergence (10:21:36). The literal "immediately after deploy, time the first hit" instruction for item 1 could not be executed live — the window was already gone (uptime was already ~2211s at first check). Substituted with authoritative boot-time log evidence (below) instead of a live capture.

## Item 1 — #1358 boot warmup — PASS (with disclosed timing gap, see above)

- Railway deploy log (`railway logs -d --since 2026-07-24T02:21:00Z --until 2026-07-24T02:25:00Z`), boot sequence for deployment `72cfa69e`:
  ```
  IUF Trading Room API listening on http://0.0.0.0:8080
  [risk-store] Hydrated workspace "primary-desk" from persistent store.
  [schedulers] Using workspace "primary-desk" for FinMind/OpenAlice schedulers.
  [boot-warmup] /overview warmed for workspace "primary-desk" in 6644ms
  ```
  Confirms the non-awaited warmup fired right after `listening` (never delayed readiness) and completed in 6.644s — this is the fire-and-forget call that absorbs `ensurePersistedQuoteHistoryLoaded()`'s one-shot JSONL replay cost that previously landed on whichever real request hit it first (the 6.348s cold outlier from #1357's deploy that motivated this PR). Prod duration (6.6s) is consistent with the local bench range (3.8-4.9s) scaled to prod's larger persisted-history dataset.
- Supplementary current-state check (owner session, 38 min post-deploy, necessarily warm not cold): 4x `curl -b <owner cookie> .../api/v1/market-data/overview`:
  `0.494s / 0.329s / 0.376s / 0.371s` — p50 ≈ 0.37s, all well under the 2s bar and consistent with the "~0.3s warm" expectation.
- Could not retrieve a literal first-real-user-hit timestamp from the 0-6.644s cold window — Railway's HTTP log tail buffer (both `--since/--until`, which errored with "Problem processing request" on any range tested, and `-n 2000`) only reached back to ~02:46:48Z, short of the 02:21:36Z boot. No way to confirm whether a real user landed inside the cold window; boot log is the strongest available evidence that the fix executes as designed.

## Item 2 — #1359 institutional panel fallback title — PASS

- Script: `packages/qa-playwright/scripts/bruce-1348-frontend-check-20260724.mjs` (pre-existing from #1348 re-verify, env-based creds), run with `IUF_QA_OWNER_EMAIL`/`IUF_QA_OWNER_PASSWORD` set inline (not persisted to any file).
- Fresh owner login (HTTP 200) → `https://app.eycvector.com/market-intel` (HTTP 200) → `._mi-instpanel` innerText:
  ```
  INSTITUTIONAL
  三大法人 · 07/23 收盤
  非即時
  單位 億元 · 紅買綠賣
  外資 FOREIGN  買 26.39 億 · 賣 24.91 億  +1.48 NET 億
  投信 INV TRUST 買 1.42 億 · 賣 1.02 億  +0.40 NET 億
  自營商 DEALER  買 22.64 億 · 賣 23.24 億  -0.60 NET 億
  依 FinMind 收盤結算 · ...
  ```
- Matches expected intraday fallback state exactly: `三大法人 · 07/23 收盤` + `非即時` badge (today's 07/24 FinMind values not yet published mid-session). `--` occurrences: 0. `pageErrors`: 0. No engineering strings (`stale`/`isFallback`/`state=`) leaked into the rendered panel.
- Screenshot: `C:\Users\User\AppData\Local\Temp\claude\C--Users-User\87b68ef2-b09d-4f9a-a232-0b0a22165cfd\scratchpad\market_intel_institutional_20260724.png`

## Item 3 — #1360 backfill R2 tool — zero runtime wiring + DRY-RUN — PASS

- Confirmed both new files present on origin/main tip (`ff5e2be1`): `apps/api/src/sim-go-live-audit-backfill-round2-20260724.ts` + companion `.test.ts`.
- `grep -rn "sim-go-live-audit-backfill-round2-20260724" apps/api/src` (excluding the file itself and its test): 0 hits outside the file's own docstring/log-message self-references — **no import from `server.ts` or any runtime route**. Zero runtime接線 confirmed.
- Ran the DRY-RUN logic locally in an isolated clean worktree (`git worktree add ... origin/main --detach` → `pnpm install --frozen-lockfile` → `pnpm run build:packages`, to avoid touching the dirty/stale main checkout — see caveat below): `node --import ./tests/setup-test-env.mjs --import tsx --test apps/api/src/sim-go-live-audit-backfill-round2-20260724.test.ts` → **15/15 PASS**, exercising Batch A (45-order v51 reproduction) and Batch B (28-order residual resolution incl. phase1/phase2 requote disambiguation + 4 INVALID rejections) against mocked persistence (`fake-id-N`, no real DB writes) — deterministic across repeated builds, matches hand-verified ground truth. Default mode is DRY_RUN (APPLY requires explicit `APPLY=true` env var per script header, not set).
- Worktree cleaned up after use (`git worktree remove --force` + prune); no residue left in main repo git metadata.

## Item 4 — full-site scan — 4/4 PASS

Owner session, `waitUntil: networkidle`, console+pageerror listeners:

| Page | Path | HTTP | console_errors | page_errors |
|---|---|---|---|---|
| 首頁 | `/` | 200 | 0 | 0 |
| 晨報 | `/ai-recommendations` | 200 | 0 | 0 |
| 市場情報 | `/market-intel` | 200 | 0 | 0 |
| 交易室 | `/desk-exact` | 200 | 0 | 0 |

## Item 5 — audit_logs baseline (v51/v34 zero new INSERT since last night) — PASS

- Direct prod DB query via `ssh railway-api` (host alias in `~/.ssh/config`, `StrictHostKeyChecking no`) + a one-off `postgres` client script run inside `/app` on the live api container (no `psql` binary available in-container, no public DB TCP proxy — this is the only working direct-query path for this environment).
- `SELECT ... FROM audit_logs WHERE action IN ('v51_sim.order_submit','v34_sim.order_submit') AND created_at > '2026-07-23 15:50:00+00'` → **0 rows**. (Cutoff chosen 90 min after the actual last INSERT to give margin.)
- Most recent 3 rows ever written to these two actions (unfiltered, DESC LIMIT 5 returned 3):
  ```
  9df694a1-fea7-43b5-bcda-e8024fda4462  v34_sim.order_submit  entity_id=2026-07-21  created_at=2026-07-23T14:18:05.957Z  (last night's real backfill APPLY)
  2f617f6e-a4a1-415e-b3a0-c7d464d2cf00  v34_sim.order_submit  entity_id=2026-07-14  created_at=2026-07-15T00:33:30.141Z
  a851467f-3768-43aa-8e65-33ea5dfcc9de  v51_sim.order_submit  entity_id=2026-07-13  created_at=2026-07-14T00:26:09.898Z  (known collision row)
  ```
- Confirms #1345 cron is UPDATE-only against these actions since last night — no unexpected new source has INSERTed. #1360's DRY-RUN batches (would-be entityIds `2026-07-13:adhoc-20260723` / `2026-07-24:adhoc-resend`) are correctly absent from prod — APPLY has not been executed, consistent with Elva-gate-only policy.

## Summary

| # | Item | Result |
|---|---|---|
| 1 | #1358 boot warmup | PASS (boot log 6644ms + warm p50 0.37s; live cold-hit capture window missed, disclosed) |
| 2 | #1359 fallback title honesty | PASS |
| 3 | #1360 tool wiring + DRY-RUN | PASS (15/15 tests, 0 runtime imports) |
| 4 | full-site scan | PASS 4/4 |
| 5 | audit_logs zero-new-INSERT baseline | PASS |

**Deploy status**: converged to `6c48d160` (covers #1358+#1359+#1360-content; #1360/#1361 don't require deploy for their scope). **Deployable/declarable**: yes — all 5 verification items PASS, no blockers, no functional changes touched outside verify tooling/reports, zero writes to prod (all DB access read-only SELECT).

**Escalation**: none required this round.
