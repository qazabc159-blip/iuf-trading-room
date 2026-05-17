# Codex Evidence - Industry Graph Error State

Date: 2026-05-18
Branch: fix/web-industry-graph-error-state-2026-05-18
Scope: company detail My-TW-Coverage `IndustryGraphPanel`

## Shipped

- `IndustryGraphPanel` now distinguishes temporary coverage fetch failures from real coverage-not-found states.
- A failed coverage endpoint renders `圖譜資料暫時無法讀取` with a red `暫停` badge instead of misleading `coverage 待補` wording.
- The graph panel footer now includes the same `/companies?tab=graph&q=...` search handoff used by the coverage panel, keeping My-TW-Coverage discovery visible even in empty/error states.

## Safety

- Frontend-only change under `apps/web/app/companies/[symbol]/IndustryGraphPanel.tsx`.
- No API implementation, heatmap data source, broker/risk/contracts, live order path, execution-mode default, secrets, or vendor tactical homepage changes.
- Browser smoke used a local mock API only. The mock intentionally returned HTTP 500 for the coverage endpoint to verify the error state.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` passed.
- Browser smoke with local mock API and owner-session cookie:
  - `/companies/2330` desktop 1366x900 rendered successfully.
  - `/companies/2330` mobile 390x844 rendered successfully.
  - Required visible content found: `台積電`, `知識圖譜`, `上下游圖譜`, `研究資料暫時無法讀取`, `圖譜資料暫時無法讀取`, `在公司圖譜搜尋 2330`.
  - DOM checks:
    - `._ig-panel` exists.
    - `._ig-panel` contains `圖譜資料暫時無法讀取`.
    - `._ig-panel` does not contain `本檔 (2330) coverage 待補` when the endpoint returns 500.
    - `._ig-panel a[href="/companies?tab=graph&q=2330"]` exists.
  - Expected coverage endpoint 500 responses: 4.
  - Non-coverage page errors, failed requests, and >=400 responses: none.

## Screenshots

- `evidence/w7_paper_sprint/industry-graph-error-state-1366x900.png`
- `evidence/w7_paper_sprint/industry-graph-error-state-mobile-390x844.png`

## Known External Blocker

- Deploy to Railway remains blocked by missing GitHub Actions secrets `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD`.
- Owner: Jason / repo admin.
