# Taiwan Stock Coverage Data

Source: https://github.com/Timeverse/My-TW-Coverage
License: MIT (https://opensource.org/licenses/MIT)
Sync date: 2026-05-15

This directory contains 1,735 Taiwan-listed company research markdown files,
bundled into the IUF repo so Railway deployments can serve
GET /api/v1/companies/:ticker/coverage without requiring the My-TW-Coverage
sibling repository to be present in the build context.

Do NOT hand-edit files here. Re-sync by running:
  pnpm tsx scripts/sync-tw-coverage.ts
