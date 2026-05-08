# Bruce PR #232 Audit — FinMind PR C: 4 Market-Intel Datasets
Date: 2026-05-06  
Branch: feat/finmind-pr-c-market-intel-2026-05-06  
Commit: 2c8cb64  
Auditor: Bruce (verifier-release)  
Pattern: same 6-point checklist as PR #224 / #226

---

## 6-Point Audit Results

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | no-token (FINMIND_API_TOKEN 0 leak) | PASS | All 18 hits in server.ts + sync file = `!!process.env.FINMIND_API_TOKEN` boolean-only. URL log strips token via `.replace(/token=[^&]+/, "token=<REDACTED>")` at finmind-client.ts:402. Sync file logs only `skipped=no_token` (string, not value x4). |
| 2 | no-fake-live (DEGRADED honest, news=experimental explicit) | PASS | state=LIVE only when real SQL rows exist (`queryMarketIntelDatasetStats`). Empty endpoint → state=DEGRADED. news: `experimental: true` at server.ts DatasetEntry + label="台股新聞 (experimental)" + missingReason="experimental_may_degrade". T7/T8 tests verify `experimental=true` on all skipped paths. |
| 3 | no-order | PASS | git show grep for order/submit/execute/buy/sell/KGI/broker (excluding paper/comment) = 0 hits in PR #232 delta. `/order/create` 409 line 4357 = pre-existing "finmind_does_not_enable_broker_submit" annotation (no change). |
| 4 | idempotent upsert keys (Athena spec) | PASS | dividend: `ON CONFLICT (stock_id, year, dividend_type)` line 268. market_value: `ON CONFLICT (stock_id, date)` line 396. valuation: `ON CONFLICT (stock_id, date)` line 517. news: `ON CONFLICT (content_hash)` line 653 — sha256(title+url+date) computed via Node crypto. All match DRAFT.sql UNIQUE index definitions. |
| 5 | graceful fallback | PASS | All 4 sync functions: (a) killswitch check → makeSkipped, (b) no token → makeSkipped, (c) no DB → makeSkipped, (d) table not migrated → makeSkipped(state=DEGRADED). tableExists() guard wraps every sync entry. No throw propagated to scheduler. |
| 6 | migration DRAFT not auto-applied | PASS | scripts/migrate.ts:24 `!file.includes(".DRAFT.")` filter active. Migration file: `packages/db/migrations/0024_finmind_market_intel.DRAFT.sql`. Filter confirmed unchanged (per PR #224 Mike audit). |

---

## Stop-Line Scan (23+ lines)

- S1 No affirmative paper-ready/live-ready/production-ready wording: PASS (0 hits in new files)
- S2 No real broker.submit / kgi.submit: PASS
- S3 No /order/create new route: PASS
- S4 No contracts mutation: PASS (6 files only — finmind-client.ts, sync.ts, sync.test.ts, server.ts, 0024 DRAFT.sql, 0024 down.sql)
- S5 No raw secrets: PASS (token boolean-only, URL redacted)
- S6 No frontend / apps/web changes: PASS (0 web files in PR)
- S7 DRAFT filter not removed from migrate.ts: PASS
- S8 down.sql present and correct: PASS (drops quarantine bins first, then main tables, IF EXISTS, wrapped in transaction)
- S9 No strategy-engine / risk-engine / market-data modification: PASS
- S10 No KGI SDK import in new files: PASS

---

## News Experimental Gate

- news dataset explicitly marked `experimental: true` in DatasetEntry (server.ts)
- Label: "台股新聞 (experimental)"
- missingReason: "experimental_may_degrade" when no rows
- runStockNewsSync: if endpoint returns 0 rows consistently → state=DEGRADED, not LIVE
- T7/T8 unit tests verify experimental=true flag on skipped result
- No hallucinated content path possible (empty → DEGRADED, never fabricated)

---

## Test Count

- Commit message: typecheck PASS / 124 CI tests PASS / 12 PR-C unit tests PASS
- Verified T1-T12 in market-intel-finmind-sync.test.ts (grep confirmed)
- Runtime CI deferred (Bash environment limitation, static analysis complete)

---

## Verdict

**APPROVE**

All 6 audit points PASS. All 10 stop-lines PASS. News experimental gate PASS. DRAFT filter active. down.sql present. No token leak. No fake LIVE. No order routes. Idempotent upsert keys match Athena spec. Graceful degradation on every failure path.

Merge gate: CI `validate` GREEN required (typecheck + 124 tests). Mike promote gate still required before 0024 DRAFT → applied (rename removes .DRAFT. infix).
