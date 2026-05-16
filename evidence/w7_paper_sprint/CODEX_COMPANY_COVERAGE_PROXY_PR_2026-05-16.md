# CODEX_COMPANY_COVERAGE_PROXY_PR_2026-05-16

## Scope
- Branch: `fix/web-company-coverage-proxy-2026-05-16`
- Promoted from local queue commit: `c031787 fix(web): proxy company coverage endpoints`
- Fresh base: `origin/main` at `6728473`

## Change
- Added same-origin frontend proxy route:
  - `apps/web/app/api/v1/companies/[ticker]/coverage/route.ts`
  - `apps/web/app/api/v1/themes/[token]/companies/route.ts`
- Purpose: Company profile `CoverageSection` and theme wikilink radar can call the My-TW-Coverage backend endpoints without browser CORS/session split.
- No `apps/api`, broker, risk, contract, KGI, or real-order path changes.

## Verification
- `git diff --check origin/main..HEAD` PASS.
- `pnpm.cmd install --frozen-lockfile --prefer-offline` PASS.
- `pnpm.cmd --filter @iuf-trading-room/contracts build` PASS.
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS.
- Route-level smoke via `pnpm.cmd exec tsx` PASS:
  - bad company ticker returns `400`.
  - empty theme token returns `400`.
  - both route responses include `Cache-Control: no-store, no-cache, max-age=0, must-revalidate`.
