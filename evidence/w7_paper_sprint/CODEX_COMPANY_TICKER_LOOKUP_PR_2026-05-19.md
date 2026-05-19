# CODEX company ticker lookup PR evidence - 2026-05-19

## Problem

Production `/companies/2330` was reported as degraded even though direct backend lookup for ticker `2330` returns the company record.

Root cause from code inspection:

- `apps/web/app/companies/[symbol]/page.tsx` fetched the broad list endpoint `GET /api/v1/companies`.
- The page then scanned the list client-side/server-side for the requested ticker.
- If the broad list endpoint or SSR owner-session path failed, the whole company detail route entered `03-ERR` before any quote/K-line/company panels could render.

## Change

- `getCompanyByTicker()` now calls `GET /api/v1/companies?ticker=...`.
- `/companies/[symbol]` now resolves the company through `getCompanyByTicker(symbol)`.
- Degraded copy now points at the specific ticker endpoint instead of the broad company list.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/contracts build` PASS.
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS.
- Local browser smoke launched on `http://localhost:3002`; unauthenticated local middleware redirected to `/login`, so final route proof must be done on production after PR deploy with owner-session cookie.

## Hardline Check

- No mock company data added.
- No KGI live write path touched.
- No homepage or tactical layout rewrite.
