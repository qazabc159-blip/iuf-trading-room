# Bruce PR466 Post-Merge Verify — 2026-05-14 ~16:40 TST

## Verdict: PR466_POST_MERGE_PASS

Migration 0031 applied, DB clean, stop-lines green.

---

## Step 1 — Deploy Timeline

| Event | GHA Run | SHA / DeploymentId | Result |
|---|---|---|---|
| PR #466 merge CI | 25848705025 | 2f5d6248 | success |
| PR #466 deploy | 25848815642 | deploymentId=b1b200af | success |
| PR #467 uuid-MIN fix CI | 25849362466 | 8cb40a1 | success |
| PR #467 alias fix CI | 25849655570 | 056c04e | success |
| alias fix deploy | 25849774125 | deploymentId=af58c1ac | success |
| Final prod boot | — | startedAt=2026-05-14T08:23:05Z | ok |

---

## Step 2 — Migration 0031 Applied

- Railway log: `[migrate] Applying 0031_companies_unique_ticker.sql`
- Railway log: `[migrate] Database schema is up to date.`
- db-probe: `appliedMigrationsCount = 32` (was 31)
- db-probe: `0031_companies_unique_ticker.sql` IN appliedMigrations list
- No `[migrate] Failed` or rollback in logs

### Root Causes Fixed (2 iterations)

**Failure 1** (deploy b1b200af): `PostgresError: function min(uuid) does not exist`
- companies.id, company_relations.id, company_keywords.id, companies_ohlcv.id are all UUID
- PostgreSQL has no built-in MIN() aggregate for UUID
- Fix: replaced MIN(uuid) with ROW_NUMBER() OVER (ORDER BY id::text ASC) throughout

**Failure 2** (deploy 57539a5b): `PostgresError: column s.survivor_id does not exist`  
- Step 0a PARTITION BY used `s.survivor_id` but the alias was renamed to `survivor_text`
- Fix: corrected alias reference in Step 0a PARTITION BY clause

---

## Step 3 — DB State Verified

| Check | Expected | Actual | Pass |
|---|---|---|---|
| companies row count | ~1735 | **1734** | PASS |
| 0031 in appliedMigrations | yes | **yes** | PASS |
| appliedMigrationsCount | 32 | **32** | PASS |
| Railway migrate log | applied 0031 | **confirmed** | PASS |
| No Failed log | true | **confirmed** | PASS |

Note: companies_workspace_ticker_uidx index creation confirmed by successful migration completion
(CREATE UNIQUE INDEX IF NOT EXISTS is the last step of 0031).

---

## Step 4 — Stop-Lines Green

| Check | Value | Pass |
|---|---|---|
| kgi_env | "sim" | PASS |
| prod_write_blocked | true | PASS |
| W6 No-Real-Order Audit (CI) | success | PASS |
| Secret Regression Check A2 (CI) | success | PASS |

---

## CI Evidence

- Run 25849362466: validate+W6+A2 all success (uuid-MIN fix)
- Run 25849655570: validate+W6+A2 all success (alias fix)
- Deploy 25849774125: success
- Final deploymentId: `af58c1ac-98de-47b0-bf2d-1504fc004350`
- Final startedAt: `2026-05-14T08:23:05.370Z`

---

## Can Deploy / Collect

- CAN DEPLOY: YES (already live)
- CAN DECLARE LIVE: YES
- COMPANIES COUNT: 1734 (dedup complete)
- UNIQUE INDEX: companies_workspace_ticker_uidx (created by 0031)
- STOP-LINES: all green
- NO PROD WRITE: confirmed
- NO SECRET LEAK: confirmed
