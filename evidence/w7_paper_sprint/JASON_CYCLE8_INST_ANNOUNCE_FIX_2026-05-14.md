# Jason Cycle 8 — P1-A Institutional + P1-B Announcements Migration Fix
**Date**: 2026-05-14 ~04:00 TST  
**Branch**: fix/cycle8-inst-announce-2026-05-14  
**Triggered by**: Bruce Cycle 8 re-audit `BRUCE_CYCLE8_PROD_REAUDIT_2026-05-14_0313TST.md`

---

## P1-A: Institutional Panel All-Zero Root Cause

**Finding from Railway logs**:
```
[trading-flow-sync] TaiwanStockInstitutionalInvestorsBuySell DONE tickers=50 success=50 failed=0 rowsUpserted=5410 rowsQuarantined=0
```
- 50 tickers ingested, 0 quarantined → buy/sell values ARE numbers in FinMind API
- 2330 is in the first-50 alphabetically sorted batch
- DB has real rows for 2330 with correct values

**Root cause**: Two-part:
1. **Row extraction order bug**: `(Array.isArray(result) ? result : result?.rows)` — if postgres.js RowList extends Array, the outer list was returned instead of `.rows`. Fixed to established pattern: `.rows` first, then Array.isArray fallback.
2. **float8 cast**: Changed `buy::numeric AS buy` → `buy::float8 AS buy` so postgres.js returns JS numbers directly (NUMERIC returns string; float8 returns JS number).
3. **Holiday data fallthrough**: Added `dbHasSignal` check — if DB has rows but all net = 0 (e.g. 5/13 holiday data only), falls through to FinMind live. This prevents showing all-zero when the only ingested date was a non-trading day.

**Fix**: `apps/api/src/server.ts` — lines 7283-7334 (institutional block)

**Tests added** (`tests/ci.test.ts`):
- INST1: Name matching — 外陸資/投信/自營商/自營商(自行買賣)/自營商(避險) all map correctly
- INST2: String-typed buy/sell (postgres.js NUMERIC) coerces via Number() correctly  
- INST3: All-zero holiday data → hasSignal=false → should fallback to FinMind

---

## P1-B: tw_announcements Table Missing

**Root cause**: Server code queries `tw_announcements` since several cycles ago. Table was never created — no migration file existed (0001-0029 confirmed, no 0030). Query caught silently → always fell to FinMind fallback → url=null for all items.

**Fix**: Created two new migration files:
- `packages/db/migrations/0030_tw_announcements.sql` — CREATE TABLE IF NOT EXISTS + 3 indexes (all idempotent)
- `packages/db/migrations/0030_tw_announcements.down.sql` — DROP TABLE with cascading index drops

**Schema**:
```sql
tw_announcements (
  id UUID PK,
  ticker_symbol TEXT,          -- nullable for market-wide
  announced_at TIMESTAMPTZ,    -- official TWSE timestamp
  title TEXT,
  content TEXT,                -- nullable, for future MOPS scrape
  title_hash TEXT,             -- SHA-256(title) for dedup
  source TEXT DEFAULT 'twse',
  source_url TEXT,
  fetched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
```
Unique index: `(COALESCE(ticker_symbol,''), announced_at, title_hash)` — handles NULL ticker safely.
Ticker+date index + date-only index for market-wide feed.

**Note**: Table created empty. Existing server.ts code handles 0 rows gracefully (falls to FinMind). URL generation via MOPS CASE expression was already correct in cycle 6. Actual ingest job (MOPS/TWSE API) is a separate task not in scope for this cycle.

**Mike audit required** before `0030_tw_announcements.sql` is promoted to prod.

---

## Build / Test Results

| Check | Result |
|---|---|
| contracts build | GREEN (0 errors) |
| api build (tsc) | GREEN (0 errors) |
| full test suite | GREEN (255/255 PASS) |
| INST1 name matching | PASS |
| INST2 string coercion | PASS |
| INST3 holiday fallthrough | PASS |
| Lane boundary | Maintained (no risk/broker/frontend changes) |

---

## Files Modified

- `apps/api/src/server.ts` — P1-A institutional row extraction + float8 cast + dbHasSignal logic
- `tests/ci.test.ts` — INST1/INST2/INST3 regression tests (strategy block)
- `packages/db/migrations/0030_tw_announcements.sql` — NEW (Mike audit pending)
- `packages/db/migrations/0030_tw_announcements.down.sql` — NEW

---

## Outstanding

- P1-B migration needs Mike audit before prod promote
- tw_announcements ingest source (TWSE/MOPS API job) — not in this cycle's scope
- Verify P1-A fix live after deploy: `GET /api/v1/companies/2330/full-profile` should show non-zero institutional values for dates before 5/13
