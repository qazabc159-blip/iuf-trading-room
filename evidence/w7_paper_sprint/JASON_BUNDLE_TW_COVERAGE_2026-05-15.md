# Jason — Bundle My-TW-Coverage Pilot_Reports (2026-05-15)

## Root Cause
GET /api/v1/companies/:ticker/coverage → all 404 on Railway prod.
- apps/api/data/tw-coverage/ directory existed but was NOT committed (gitignored by default untracked).
- Railway build context has no sibling My-TW-Coverage repo, sync script exits 0 with empty bundled dir.
- Loader falls through all paths → null → 404.

## Fix
1. Committed 1735 md files into apps/api/data/tw-coverage/ (sector folder structure preserved).
2. Added apps/api/data/tw-coverage/README.md with MIT attribution (Source: My-TW-Coverage).
3. No changes to loader — path resolution already correct: env → bundled → local dev fallback.
4. No changes to sync script — Railway skip-if-missing logic kept as-is (correct for non-Railway dev).

## Loader Path Resolution (verified correct before this fix)
1. process.env.TW_COVERAGE_PATH (operator override)
2. apps/api/data/tw-coverage/ (bundled — NOW POPULATED)
3. ../../../../My-TW-Coverage/Pilot_Reports (local dev sibling)
4. graceful null

## Local Test Evidence
getCompanyCoverageBrief("2330") → PASS name=台積電

## Files Changed
- apps/api/data/tw-coverage/README.md (new)
- apps/api/data/tw-coverage/**/*.md (1735 files, new)

## Commit
branch: feat/api-bundle-tw-coverage-data-2026-05-15
commit: b6ea41b — 1736 files changed, 127606 insertions(+)

## Build / Test
- No code changes → no contracts/api build required for this PR.
- Local loader test: PASS.
- Railway deploy: after merge, bundled path will be populated → coverage endpoints return 200.

## Lane Boundary
- No contracts touched.
- No risk/broker/frontend files touched.
- MIT licence: My-TW-Coverage (https://github.com/Timeverse/My-TW-Coverage) — safe to bundle.
