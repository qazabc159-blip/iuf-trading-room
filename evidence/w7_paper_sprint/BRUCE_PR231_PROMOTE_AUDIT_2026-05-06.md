# Bruce PR #231 Promote Audit
**Date:** 2026-05-06  
**PR:** #231 — chore(db): promote 0022 + 0023 finmind migrations from DRAFT to applied  
**Commit:** f76ea61c582cedfca733a9587483ad52b551f384  
**Auditor:** Bruce (verifier-release)  
**Verdict:** APPROVE

---

## 1. Rename Verify

**Command:** `git show --stat f76ea61`

```
 ...{0022_finmind_fundamentals.DRAFT.sql => 0022_finmind_fundamentals.sql} | 0
 ...{0023_finmind_trading_flow.DRAFT.sql => 0023_finmind_trading_flow.sql} | 0
 2 files changed, 0 insertions(+), 0 deletions(-)
```

Result: PASS — 100% rename. 0 insertions. 0 deletions. Content byte-identical to DRAFT versions audited in PR #224 + PR #226.

---

## 2. No-Secret Scan

Files scanned:
- `packages/db/migrations/0022_finmind_fundamentals.sql`
- `packages/db/migrations/0023_finmind_trading_flow.sql`

Patterns: `OPENAI_API_KEY`, `FINMIND_API_TOKEN`, `RAILWAY`, `password`, `secret` (case-insensitive)

Result: 0 matches in both files. PASS.

Schema content is pure DDL (CREATE TABLE, CREATE INDEX, IF NOT EXISTS). No hardcoded values, no credentials.

---

## 3. migrate.ts Filter Not Regressed

File: `scripts/migrate.ts` lines 18-24

Filter logic confirmed:
```ts
(file) =>
  file.endsWith(".sql") &&
  !file.endsWith(".down.sql") &&
  // .DRAFT.sql migrations must NOT auto-apply.
  !file.includes(".DRAFT.")
```

- 0022_finmind_fundamentals.sql → matches filter → WILL run. CORRECT.
- 0023_finmind_trading_flow.sql → matches filter → WILL run. CORRECT.
- 0024_finmind_market_intel.DRAFT.sql → still has .DRAFT. → STILL SKIPPED. CORRECT.
- *.down.sql → excluded. CORRECT.

Result: PASS — filter intact, no regression, 0022+0023 now correctly picked up on next API start.

---

## 4. Prior Audit Chain

- PR #224: Mike 8/8 PASS + Bruce 0/23 stop-line trigger (0022 DRAFT content approved)
- PR #226: Mike 8/8 PASS + Bruce 0/23 stop-line trigger (0023 DRAFT content approved)
- This PR adds 0 new content — only strips .DRAFT. infix from filename

Content already approved. This audit is rename-only verification.

---

## 5. Post-Deploy Smoke Plan

After Railway deploy picks up the new main HEAD (f76ea61), on next API service start migrate.ts will execute 0022 + 0023 DDL against prod DB.

### PowerShell Smoke Commands

```powershell
# A. Check FinMind status endpoint — expect 7 datasets to transition
$h = @{ Cookie = "iuf_session=<TOKEN>" }
Invoke-RestMethod -Uri "https://api.eycvector.com/api/v1/diagnostics/finmind" -Headers $h | ConvertTo-Json -Depth 5

# B. Check individual dataset states — expect LIVE or EMPTY (not DEGRADED/MISSING)
# Target datasets: tw_monthly_revenue, tw_financial_statements, tw_balance_sheet,
#                  tw_cashflow_statement, tw_institutional_buysell, tw_margin_short, tw_shareholding
Invoke-RestMethod -Uri "https://api.eycvector.com/api/v1/data-sources/finmind/status" -Headers $h | ConvertTo-Json -Depth 5

# C. Row count check — confirm tables created (0 rows pre-sync is acceptable)
# If DB access available:
# SELECT table_name, COUNT(*) FROM information_schema.tables WHERE table_name LIKE 'tw_%' GROUP BY 1;

# D. Health gate — must remain 200 after migration
Invoke-RestMethod -Uri "https://api.eycvector.com/health" | ConvertTo-Json
```

### Expected Transitions
| Dataset | Pre-deploy State | Post-deploy Expected |
|---------|-----------------|----------------------|
| tw_monthly_revenue | DEGRADED/MISSING | LIVE or EMPTY |
| tw_financial_statements | DEGRADED/MISSING | LIVE or EMPTY |
| tw_balance_sheet | DEGRADED/MISSING | LIVE or EMPTY |
| tw_cashflow_statement | DEGRADED/MISSING | LIVE or EMPTY |
| tw_institutional_buysell | DEGRADED/MISSING | LIVE or EMPTY |
| tw_margin_short | DEGRADED/MISSING | LIVE or EMPTY |
| tw_shareholding | DEGRADED/MISSING | LIVE or EMPTY |

EMPTY = tables created, no sync yet (acceptable). LIVE = tables + data present. Either = migration success.

### Failure Indicators
- /health returns 500 → migration threw, check Railway API logs for SQL error
- Dataset states still MISSING → migrate.ts did not run (check PERSISTENCE_MODE=database in Railway API env)
- 0022/0023 tables absent in DB → filter regression (re-run step 3)

---

## Verdict

| Check | Result |
|-------|--------|
| 1. Rename 100% | PASS |
| 2. No secrets | PASS |
| 3. migrate.ts filter intact | PASS |
| 4. Prior audit chain | PASS (0/23 stop-lines × 2) |
| Stop-lines triggered | 0 |

**APPROVE — safe to merge. Post-deploy: run smoke commands A+B+D. EMPTY result on datasets is acceptable.**
