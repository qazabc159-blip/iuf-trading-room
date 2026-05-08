# Migration 0024 Audit — Mike 2026-05-06

## 1. Migration Intent
- Add 4 FinMind market-intel cache tables: tw_dividend / tw_market_value / tw_valuation / tw_stock_news
- Plus 4 quarantine bins (_quarantine_*)
- Sprint: BLOCK #4 PR C (Athena spec §1 datasets 5/9/10/11 + valuation)
- forward + down pair: PRESENT (both files confirmed)

## 2. Schema Changes Summary
- New tables: tw_dividend, tw_market_value, tw_valuation, tw_stock_news
- New quarantine bins: _quarantine_ x4
- New FKs: NONE (standalone cache tables; no FK to companies/users — intentional, noted in spec)
- New UNIQUE indexes: tw_dividend(stock_id,year,dividend_type) / tw_market_value(stock_id,date) / tw_valuation(stock_id,date) / tw_stock_news(content_hash)
- New regular indexes: tw_dividend(stock_id,year DESC) / tw_market_value(stock_id,date DESC) / tw_valuation(stock_id,date DESC) / tw_stock_news(stock_id,published_at DESC) / tw_stock_news(fetched_at DESC)
- Drops: NONE (forward only adds)

## 3. IUF Audit Checklist (§A-G)

### A. Forward + Down Pair
- [x] down.sql EXISTS: 0024_finmind_market_intel.down.sql
- [x] down.sql drops quarantine bins FIRST, then main tables — correct reverse-dependency order
- [x] Every DROP uses IF EXISTS
- [x] forward → down → forward leaves no orphan state (pure CREATE/DROP, no data mutation)
- [x] down.sql wrapped in BEGIN/COMMIT transaction

### B. Foreign Key Cascade
- [x] No FKs declared — standalone cache tables. Intentional per spec (no cascade risk)
- [x] No parent table dependency ordering issue
- N/A: cascade data loss risk

### C. Idempotency / UNIQUE Constraint
- [x] tw_dividend: UNIQUE(stock_id, year, dividend_type) — matches Athena spec
- [x] tw_market_value: UNIQUE(stock_id, date) — matches Athena spec
- [x] tw_valuation: UNIQUE(stock_id, date) — matches Athena spec
- [x] tw_stock_news: UNIQUE(content_hash) — sha256(title+url+published_at), consistent across SQL comment + schema + sync.ts:643
- [x] All UNIQUE constraints have corresponding indexes (they ARE the index in PG)

### D. Index Coverage
- [x] tw_dividend: UNIQUE covers upsert key; (stock_id, year DESC) covers list-by-stock query
- [x] tw_market_value: UNIQUE(stock_id,date) covers upsert; separate (stock_id,date DESC) is REDUNDANT with UNIQUE index — nit only
- [x] tw_valuation: same redundancy as market_value — nit only
- [x] tw_stock_news: content_hash UNIQUE for dedup; (stock_id, published_at DESC) for per-stock feed; (fetched_at DESC) for ingest monitoring
- [x] No missing query-path indexes for stated use cases

### E. NOT NULL / DEFAULT / Data Backfill
- [x] All NOT NULL columns have DEFAULT or are naturally provided at INSERT time
- [x] New tables only — no backfill needed on existing rows
- [x] fetched_at NOT NULL (no default) — caller must supply; consistent with source-trail spec §3.3
- [x] No large-table lock risk (brand new tables, zero rows at creation)

### F. IUF-Specific
- [x] No DROP DATABASE / TRUNCATE
- [x] No production-only data
- [x] No existing row mutation — schema-only
- [x] No secret / token / person_id in SQL text

### G. Migration File Hygiene
- [x] Numbering: 0024 is consecutive after 0023 — no gap, no collision
- [x] Filename clearly describes intent: 0024_finmind_market_intel
- [x] Sprint label in header: implied via "BLOCK #4 PR C 2026-05-06" author line; first-line comment says "DRAFT: FinMind 4 Market-Intel Dataset Cache Tables"
- [x] All statements IF NOT EXISTS — fully idempotent re-run safe

## 4. Findings — Priority Ranked

### Blockers
NONE

### Suggestions
1. **Redundant indexes on tw_market_value and tw_valuation**: Both have UNIQUE(stock_id,date) AND a separate regular index on (stock_id,date DESC). PostgreSQL UNIQUE indexes are already usable for ORDER BY queries. The regular index adds write overhead with no query benefit. Recommend dropping tw_market_value_stock_date_idx and tw_valuation_stock_date_idx at promote time. Not a blocker for DRAFT approval.

### Nits
1. **PR brief hash spec shorthand**: Dispatch message said `sha256(title+url)` but SQL + sync.ts both correctly implement `sha256(title+url+published_at)`. No action needed — SQL and code agree; brief was shorthand.
2. **`date` column typed TEXT**: Standard IUF pattern for FinMind date strings (YYYY-MM-DD from API). Consistent with 0022/0023 pattern. Not a blocker, but note that date-range queries will need CAST or lexicographic sort discipline.
3. **Forward SQL missing BEGIN/COMMIT**: down.sql has transaction wrapper; forward does not. For DRAFT this is acceptable — runner wraps each file. Note for promote review.

## 5. Rollback Dry-Run Plan
1. Identify that tables exist: `\dt tw_*` in psql
2. Run 0024_finmind_market_intel.down.sql (BEGIN/COMMIT wrapped — single atomic op)
3. Drop sequence: _quarantine_tw_stock_news → _quarantine_tw_valuation → _quarantine_tw_market_value → _quarantine_tw_dividend → tw_stock_news → tw_valuation → tw_market_value → tw_dividend
4. Verify: `\dt tw_dividend` returns "did not find any relation"
5. market-intel-finmind-sync.ts will emit state=DEGRADED (not throw) — no crash

- Estimated rollback time: < 5 seconds (empty tables at rollback, no FK deps)
- Data loss risk: ALL cached FinMind data in these 4 tables is lost. Acceptable — data is re-fetchable from FinMind API on next sync cycle.

## 6. Verdict
- [x] APPROVE_DRAFT_FOR_LATER_PROMOTE — schema safe, all 8 audit points PASS, down.sql exists and correct, DRAFT filter enforced, no blockers

## 7. Re-audit Required at Promote Time
YES — standard promote checklist:
- Confirm DRAFT infix stripped cleanly (filename = 0024_finmind_market_intel.sql, no .DRAFT. substring)
- Confirm 0022 and 0023 are already LIVE in schema_migrations before 0024 runs
- Consider dropping redundant (stock_id,date DESC) indexes on market_value and valuation

---
Auditor: Mike
Date: 2026-05-06
Migration: 0024_finmind_market_intel.DRAFT.sql + 0024_finmind_market_intel.down.sql
PR: #232 branch feat/finmind-pr-c-market-intel-2026-05-06
