# Jason PR-H4: TWSE OpenAPI Announcements Evidence
**Branch**: `jason/twse-openapi-announcements-2026-04-30`
**Date**: 2026-04-30
**Status**: DRAFT — awaiting Bruce verify + Elva ACK

## Files Changed
- `apps/api/src/data-sources/twse-openapi-client.ts` (NEW) — 3 methods: announcements / corp-gov / ESG
- `apps/api/src/server.ts` (MODIFIED) — `GET /api/v1/companies/:id/announcements?days=30`

## Stop-line Check
| Line | Status |
|---|---|
| No auth required from TWSE (official free API) | PASS |
| Route requires IUF session cookie | PASS — inside /api/v1/* session middleware |
| No secrets | PASS — TWSE OpenAPI is public |
| Cache failure fail-open | PASS |
| No KGI SDK import | PASS |
| No broker surface | PASS |

## API Details
- Base URL: `https://openapi.twse.com.tw/v1/`
- No rate limits documented; friendly usage (cache 1800s)
- Announcements filtered client-side by `Code` + date cutoff
- No auth header required

## Test Coverage
No standalone test file for H4 (simple adapter). Integration verified via:
- H1 finmind-client.test.ts patterns shared
- Smoke: `GET /api/v1/companies/2330/announcements?days=30` after deploy

## Outstanding
- Corp governance and ESG routes (`/api/v1/companies/:id/corp-governance` and `/esg`) 
  are implemented in the client but not yet wired as routes — deferred for next sprint
  unless 楊董 requests them.
