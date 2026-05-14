# Jason P0 Perf Fix — listCompaniesLite + 5min Cache

**Date**: 2026-05-15 02:30 TST  
**Branch**: `fix/api-perf-companies-lite-query-2026-05-15`  
**Commit**: 16731e8  
**Status**: build green, tests 265/266 (1 pre-existing KGI SIM 401 failure, unrelated)

---

## Root Cause (from Bruce audit)

Both `getMarketDataOverview()` and `getOpsSnapshot()` called `repo.listCompanies(undefined, ...)` on every request:
- `SELECT * FROM companies WHERE workspace_id=?` — 3470 rows, `SELECT *` includes JSONB columns (exposure/validation/notes)
- `SELECT ... FROM company_theme_links WHERE company_id IN (3470 UUIDs)` — massive IN clause
- `companySchema.parse()` × 3470 (CPU-bound Zod validation)

Result: `/` TTFB = 15.3s, `/companies/2330` TTFB = 9.9s

---

## Fix Applied

### 1. New `CompanyLite` type (packages/domain/src/types.ts)
7-field projection: `id, ticker, name, market, chainPosition, beneficiaryTier, updatedAt`

### 2. `listCompaniesLite()` in postgres-repository.ts
```sql
SELECT id, ticker, name, chain_position, beneficiary_tier, updated_at
FROM companies WHERE workspace_id = ?
ORDER BY updated_at DESC
```
No JSONB columns, no theme_link IN clause, no Zod schema validation.

### 3. `getCompaniesLiteCached()` in market-data.ts (exported)
- `Map<workspaceId, { data, expiresAt }>` with 5-min TTL
- First call: DB query; subsequent calls within TTL: in-memory hit
- Shared between `getMarketDataOverview` and `getOpsSnapshot` (second caller gets free cache hit)

### 4. Callers updated
- `getMarketDataOverview` (market-data.ts:~3032): `listCompanies(3470)` → `getCompaniesLiteCached()`
- `getOpsSnapshot` (ops-snapshot.ts:249): `listCompanies(3470)` → `getCompaniesLiteCached()`
- Internal functions updated to accept `CompanyLite[]`: `dedupeSymbolMasters`, `buildSymbolNameLookup`, `buildMarketContext`, `buildDailyBarMarketContext`, `loadDailyBarRowsFromDb`, `maybeSelfHealDailyBarRows`, `selectDailyContextOhlcvSelfHealTargets`

---

## Files Changed

| File | Change |
|------|--------|
| `packages/domain/src/types.ts` | +`CompanyLite` type, +`listCompaniesLite()` in interface |
| `packages/domain/src/index.ts` | export `CompanyLite` |
| `packages/domain/src/postgres-repository.ts` | implement `listCompaniesLite()` — 7-column SELECT |
| `packages/domain/src/memory-repository.ts` | implement `listCompaniesLite()` — map from in-memory store |
| `apps/api/src/market-data.ts` | `getCompaniesLiteCached()` + replace hot-path caller + type updates |
| `apps/api/src/ops-snapshot.ts` | replace hot-path caller + type updates |

---

## Build / Test Results

| Check | Result |
|-------|--------|
| `pnpm --filter @iuf-trading-room/domain build` | green |
| `pnpm --filter @iuf-trading-room/api build` | green |
| `pnpm test` | 265/266 pass (1 pre-existing KGI SIM 401 failure, baseline was also 265/266) |

---

## Expected Performance Impact

| Endpoint | Before | Expected After |
|----------|--------|----------------|
| `GET /api/v1/market-data/overview` | ~9.7–10.7s | <0.5s |
| `GET /api/v1/ops/snapshot` | ~3s | <0.5s |
| `/` (戰情台) TTFB | ~15.3s | <3s |
| `/companies/2330` TTFB | ~9.9s | <3s |

First request after cold start: 1 DB query (~0.3s). Subsequent requests within 5 min: 0 DB queries (cache hit).

---

## Lane Boundary

- No contracts changes
- No KGI broker changes
- No DB schema/migration changes
- No frontend changes
- Only Jason lane: market-data.ts, ops-snapshot.ts, domain types/repos

Jason — 2026-05-15 02:30 TST
