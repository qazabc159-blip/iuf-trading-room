# JIM CYCLE 4 — Company Full Profile API Swap

**Date**: 2026-05-14
**Issue**: ISSUE_002 — base route `/api/v1/companies/:id` missing PE / 殖利率 / 月營收; full data at `/full-profile`
**Fix owner**: Jim (frontend-consume lane)

## Root Cause

`CompanyHeroBar` 7-cell KPI strip only received server-side data from OHLCV + realtime quote.
`getCompanyFullProfile` was only called inside `FullProfilePanels` (client component, loads after initial render).
Hero bar therefore always showed `--` for PE / 殖利率 / 月營收 — data was present in backend but not fetched at render time for the hero strip.

## Changes

### `apps/web/app/companies/[symbol]/page.tsx`
- Import `getCompanyFullProfile` + `FullProfileEnvelope` from `@/lib/api`
- Added `getCompanyFullProfile(company.id)` to Phase 2 `Promise.allSettled` (now 5 concurrent fetches)
- Extract `heroPE`, `heroDividendYield`, `heroRevenue` from result (fail-soft: null on error)
- Pass `pe`, `dividendYield`, `latestRevenue` to `<CompanyHeroBar>`

### `apps/web/app/companies/[symbol]/CompanyHeroBar.tsx`
- Added `pe`, `dividendYield`, `latestRevenue` optional props to component
- Added `fmtRevenue()` helper (億/兆/萬 scale, null-safe)
- Expanded KPI grid from 7 to 10 cells (responsive: 10 → 5 at 1200px → 2 at 640px)
- Added cells [8] 本益比 / [9] 殖利率 / [10] 月營收 — all show `--` when data unavailable

## Endpoint Consumed

- `GET /api/v1/companies/:id/full-profile` (already live, PR #259)
- Fields used: `marketIntel.valuation.latest.{pe, dividendYield}` + `fundamentals.monthlyRevenue.latest.revenue`

## Validation

- typecheck: EXIT 0 (no output)
- build: green (all routes compiled, /companies/[symbol] dynamic ƒ present)
- No backend / contracts changes

## Files Modified

1. `apps/web/app/companies/[symbol]/page.tsx`
2. `apps/web/app/companies/[symbol]/CompanyHeroBar.tsx`
