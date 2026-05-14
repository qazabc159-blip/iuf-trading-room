# Jason — My-TW-Coverage Loader Evidence
**Date:** 2026-05-15 | **Branch:** feat/api-tw-coverage-loader-2026-05-15

## Capability Added
- `getCompanyCoverageBrief(ticker)` — reads and parses single ticker md file into structured brief (businessOverview, supplyChain upstream/midstream/downstream, majorCustomers, majorSuppliers, rawMarkdown)
- `findCompaniesByWikilink(token)` — reverse-graph search across all 1,735 tickers; returns matches with relation inference (customer/supplier/upstream/downstream/related)
- `listSectorCompanies(sector)` — list all tickers in a sector folder
- In-process LRU cache (30 slots, 5-min TTL); `_resetCoverageCache()` for test isolation
- Path resolution: env `TW_COVERAGE_PATH` → bundled `apps/api/data/tw-coverage/` → sibling repo fallback
- `scripts/sync-tw-coverage.ts` — copies 1,735 files / 98 sectors into bundled path for Railway deploy

## Files Modified
- `apps/api/src/data-sources/tw-coverage-loader.ts` (NEW, 290 lines)
- `apps/api/src/data-sources/__tests__/tw-coverage-loader.test.ts` (NEW, 85 lines)
- `scripts/sync-tw-coverage.ts` (NEW, 80 lines)

## Build / Test Results
- `api typecheck`: GREEN (tsc --noEmit, 0 errors)
- `TWCV0–TWCV5`: 6/6 PASS (file-I/O only, no DB, no network)
- `sync-tw-coverage --dry-run`: 1,735 files across 98 sectors detected
- No DB migration, no endpoint added, no lane violation

## Lane Boundary
- No changes to risk-engine, broker, market-data, contracts, or frontend
- No endpoint added in this PR (next PR by Codex will add /api/v1/companies/:ticker/coverage)

## Key Technical Notes
- Windows `\r\n` line endings in source md files — regex uses `\r?\n##` lookahead anchor to avoid matching `## ` inside `###` sub-headings (root cause of TWCV1 initial failure)
- `findCompaniesByWikilink` is O(N×filesize) linear scan; acceptable for v1 (1,735 small files, infrequent call). Upgrade to boot-time index if called frequently.
- Metadata field values already include "百萬台幣" suffix in source — stored as-is, not double-appended.
