# Company Page Data Recovery - 2026-06-05

## Scope

Product rescue follow-up after pg-volume expansion. Focused on company page data panels and customer-facing state copy. No broker live order path, no KGI live write, no mock/fake data.

## Production API Verification

Authenticated production checks against `https://api.eycvector.com` after pg-volume recovery:

| Symbol | Financials | Monthly Revenue | Institutional | Margin/Short | Dividend | Valuation |
| --- | --- | --- | --- | --- | --- | --- |
| 2330 | LIVE / 204 records | STALE / 11 records | STALE / 90 records | LIVE / 22 records | LIVE / 20 records | LIVE / 22 records |
| 6202 | LIVE / 204 records | STALE / 11 records | STALE / 65 records | LIVE / 22 records | LIVE / 4 records | LIVE / 22 records |
| 2603 | LIVE / 220 records | STALE / 11 records | STALE / 75 records | LIVE / 22 records | LIVE / 5 records | LIVE / 22 records |
| 9958 | LIVE / 192 records | STALE / 11 records | STALE / 75 records | LIVE / 22 records | LIVE / 5 records | LIVE / 22 records |

Conclusion: the main company page data sources are not empty after pg-volume expansion. Remaining visible issues are UI state semantics or source-specific panel availability, not broad DB loss.

## Production Browser Evidence

Screenshots captured with owner cookie in a real Chromium browser:

- `evidence/w7_paper_sprint/screenshots/company-prod-audit-20260605/_companies.png`
- `evidence/w7_paper_sprint/screenshots/company-prod-audit-20260605/_companies_2330.png`

Observed production state:

- `/companies` renders 1,938 companies, no blank registry, no "0 company" pause state.
- `/companies/2330` renders 2,436 official daily K bars and full-profile panels with financial, monthly revenue, institutional, margin/short, dividend, valuation data.
- KGI bid/ask and tick panels are unavailable outside KGI quote windows. This PR changes off-hours wording from product-broken `BLOCKED` to yellow `休市`, while keeping genuine gateway/auth failures red `BLOCKED`.

## Changed

- `apps/web/app/companies/[symbol]/BidAskPanel.tsx`
  - Adds explicit `closed` state for off-hours KGI read-only bid/ask.
  - Shows yellow `休市` with next read window instead of red `BLOCKED`.

- `apps/web/app/companies/[symbol]/LiveTickStreamPanel.tsx`
  - Adds explicit `closed` state for off-hours KGI read-only ticks.
  - Shows yellow `休市` with next read window instead of red `BLOCKED`.

- `apps/web/lib/final-v031-paper-ticket.test.ts`
  - Adds guard to keep off-hours company KGI panels from regressing to product-broken `BLOCKED`.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` - PASS
- `apps/web/node_modules/.bin/vitest.CMD run lib/final-v031-paper-ticket.test.ts` - PASS, 41/41
- Production browser audit - PASS for `/companies` and `/companies/2330`, no console/page errors captured.

## Remaining Product Work

- AI Analyst report should be regenerated/quality-gated when source data is available; empty report state is honest but not a finished premium experience.
- KGI bid/ask and tick panels can only show live data during quote windows. A later PR should add a non-fake "last official quote snapshot" compact card for after-hours context if the product wants less empty space.
