# CODEX_COMPANY_PAGE_DEGRADED_STATE_PR_2026-05-18

## Scope

- Route: `/companies/[symbol]`
- Test symbol: `2330`
- Goal: company page must not render blank/fake panels when the company master endpoint is blocked, and company-side panels must not show unreadable/mojibake product text.

## Shipped

- Replaced the company master fetch failure screen with a product-grade `BLOCKED` state:
  - names the missing endpoint: `GET /api/v1/companies`
  - names owner: Jason / Bruce
  - explains next action: check API health, owner cookie, and company endpoint
  - states no fake quote/K-line/AI report is rendered
- Cleaned company-page secondary data panels:
  - Five-level bid/ask
  - Live tick stream
  - Institutional investors
  - Margin/short
  - Derivatives
  - Static tick status
  - Source status card
- Converted expected company master degradation from `console.error` to `console.warn` so local QA does not surface a red app issue for an intentional blocked state.

## Verified

- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- `git diff --check`
- Source mojibake scan:
  - checked 8 company page files
  - hit count: 0
- Local browser smoke against `http://localhost:3115/companies/2330?codexCompanySmoke=1`, connected to production API:
  - desktop `1366x900`: status 200, no login redirect, endpoint/owner/no-fake copy present, no page error, no mojibake signal
  - mobile `390x844`: status 200, no login redirect, endpoint/owner/no-fake copy present, no page error, no mojibake signal

## Evidence

- `screens/local-company-2330-desktop-after.png`
- `screens/local-company-2330-mobile-after.png`
- `local-company-2330-after-smoke.json`
- `company-source-mojibake-check.json`

## Remaining

- Owner-session production verification still belongs to Bruce/Elva because dummy cookies intentionally exercise the auth/company-master blocked path.
- This PR does not invent company data and does not change broker/risk/KGI write paths.
