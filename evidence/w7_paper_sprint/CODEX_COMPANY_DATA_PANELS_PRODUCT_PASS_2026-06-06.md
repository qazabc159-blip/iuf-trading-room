# Codex Company Data Panels Product Pass — 2026-06-06

## Scope

- `/companies/[symbol]` company-page data panels only.
- No API, KGI write path, S1/F-AUTO, contracts, migrations, or Lab changes.

## Shipped Locally

- Rebuilt `AnnouncementsPanel` as an expandable official-announcement timeline.
  - Every row is a button with `aria-expanded`.
  - Detail view shows summary/body, date, source, company, and official link when available.
  - Empty state remains explicit and does not show fake announcements.
- Rebuilt `TickStreamPanel` so the lower data dock is not blank when KGI tick is unavailable.
  - KGI tick remains first choice.
  - If KGI has no tick, the panel uses FinMind intraday K bars as a recent-trade aggregate table.
  - The UI states this is a FinMind K-bar aggregate and does not fake tick data.
- Cleaned `BidAskPanel` and `LiveTickStreamPanel` customer-facing copy.
  - Closed / waiting / blocked / live states are readable Traditional Chinese.
  - Off-hours and no-return states say this is not a system failure and will return to LIVE when KGI data arrives.
- Rebuilt `DerivativesPanel` into a product-grade pending datasource panel.
  - Does not fake warrants/options.
  - Clearly lists future required fields: strike, expiry, implied volatility, moneyness, liquidity warnings.

## Verification

- `apps\web\node_modules\.bin\vitest.CMD run apps/web/lib/company-page-panels.test.ts apps/web/lib/final-v031-paper-ticket.test.ts`
  - 2 files passed
  - 48 tests passed
- `pnpm.cmd --filter @iuf-trading-room/web build`
  - Passed
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
  - Passed after build generated fresh `.next/types`

## Browser Smoke

- Local browser attempt against `http://127.0.0.1:3106/companies/2330` redirected to `/login?next=%2Fcompanies%2F2330`.
- No owner storageState was available in this worktree, so I did not claim a company-page browser pass.
- Required follow-up after PR deploy: production owner-session smoke on `/companies/2330`, click one `重大訊息` row, capture screenshot, and confirm no console/page errors.

## Risk

- This pass improves the product surface and removes blank/garbled panels.
- It does not create new warrant/options data sources.
- It does not enable KGI live order writes.
