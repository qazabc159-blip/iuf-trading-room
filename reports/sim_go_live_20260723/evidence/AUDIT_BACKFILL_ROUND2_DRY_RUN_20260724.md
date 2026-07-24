# audit_logs backfill Round 2 — DRY RUN record (2026-07-24)

## Scope
Round 2 of the sim-go-live audit_logs backfill (see
`AUDIT_BACKFILL_APPLY_20260723.md` for the Round 1 incident this responds
to). Script: `apps/api/src/sim-go-live-audit-backfill-round2-20260724.ts`.
PR: `feat/audit-backfill-r2-distinct-entityid-jason-20260724` (DRAFT — not
merged, APPLY not run).

## Why Round 2 exists
Round 1's v51 entityId="2026-07-13" collided at APPLY time with a REAL
`v51-sim-basket-runner.ts` row (`a851467f`, written 2026-07-14T00:26Z) —
insert-only design correctly SKIPped rather than overwrite, but left the
45 orders from 2026-07-23 with zero audit_logs coverage. Separately,
2026-07-24's residual re-send (28 orders across 2 phases) never wrote
audit_logs either (same `resend_residual_20260724.mjs` standalone-tool
limitation as `send_three_sleeve.mjs`).

## Approach (per Elva's directive)
Insert-only, DISTINCT entityId per batch — never UPDATE/overwrite an
existing row:
- Batch A (7/23 v51, 45 orders): `entityId="2026-07-13:adhoc-20260723"`
- Batch B (7/24 residual, 28 orders): `entityId="2026-07-24:adhoc-resend"`
  for both the v51_sim row (24 orders) and the v34_sim row (4 orders) —
  same entityId string across two different entityTypes is not a
  collision (composite key includes entityType/action).

Both `readLatestV51OrderSubmitAuditRow()` and
`readLatestV34OrderSubmitAuditRow()` (#1345 cron's read path) select
`ORDER BY createdAt DESC LIMIT 1` with no entityId filter — verified via
static-scan regression test (no local/CI Postgres fixture exists in this
repo to test this live; see the test file's own header for why). Combined
with `audit_logs.createdAt`'s DB-level `defaultNow()` (this script never
sets it explicitly, same as Round 1), any successful INSERT here is
guaranteed to sort as "latest", so the cron naturally starts watching these
rows.

## DRY RUN result (2026-07-24 09:55 TST, zero DB/network calls)
```
[backfill-r2] Batch A (7/23 v51): 45 results, {"partially_filled":6,"accepted":9,"filled":26,"rejected":3,"unconfirmed":1}
[backfill-r2] Batch B v51 (7/24 residual): 24 results, {"filled":11,"partially_filled":4,"accepted":3,"rejected":6}
[backfill-r2] Batch B v34 (7/24 residual): 4 results, {"filled":2,"rejected":2}
```
Full row payloads: `audit_backfill_round2_dry_run_1784858123368.json`
(this dir).

Batch A's breakdown is byte-identical to Round 1's actual APPLY'd payload
(`audit_backfill_dry_run_container_1784816245942.json`) — only the
entityId differs.

## Batch B ground truth methodology
Source: `trades_manual_0724.json` (per-KGI-order-id buckets — 20 valid +
an 8-entry `無效單`/invalid bucket), NOT `deals_manual_0724.json` (a
per-symbol summary that loses the phase1-vs-phase2 distinction for the 3
requoted-and-filled symbols). Join key: `(symbol, price rounded to 2dp)` —
`orders_20260724_residual.jsonl`'s own `trade_id` does not match KGI's
order_id/nid namespace (same open question as Round 1's KNOWN ISSUE #2).
Verified exhaustively against all 28 rows in the test file.

**4 INVALID symbols** (1271/5267/6808/6505, order_id="0000") rejected in
BOTH phase1 and phase2 — matches the task's explicit callout.

**Phase1/phase2 same-symbol handling** (4113/2465/8059 retried; no
cancel/amend endpoint exists so phase2 is always a new stacked order): kept
as TWO separate result entries per symbol (additive `phase` field), not
merged — phase1 resolves `accepted` (still open, unfilled, superseded but
never cancelled), phase2 resolves `filled`. Partial fills with no phase2
retry (6177/2101/6885/4416) stay terminal `partially_filled`.

## Re-running with a fresh (13:55 EOD) evidence file
`RESIDUAL_ORDERS_FILE` / `RESIDUAL_TRADES_FILE` env vars override the
default input paths — point them at whatever the EOD-refreshed file ends
up being named and re-run DRY RUN (default APPLY=false) before any APPLY.

## Validation
- `pnpm run build:packages` / `pnpm run build:api` — green (tsc typecheck
  included)
- `pnpm run test` — 2044/2044 pass (2 pre-existing unrelated failures in
  `finmind-client.test.ts` T3/T11 traced to a leaked local `FINMIND_TOKEN`
  env var on this machine — confirmed environment-only by unsetting it and
  rerunning green; zero relation to this PR's files)
- `pnpm run smoke` — PASS
- `python scripts/audit/w6_no_real_order_audit.py` — PASS (6/6)
- `python scripts/audit/secret_regression_check.py` — PASS (0 findings)
- New test file: `apps/api/src/sim-go-live-audit-backfill-round2-20260724.test.ts`
  — 15/15 pass, registered in root `package.json`'s explicit test list.

## Not done here (APPLY)
APPLY=true execution to prod remains Elva's gate (same as Round 1 — this
repo's `pg` Railway service has no public TCP proxy; APPLY must run from
inside Railway, e.g. `ssh railway-api`).
