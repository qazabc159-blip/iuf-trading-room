# Codex Portfolio Trading Room Truth-State PR - 2026-05-18

## Scope

- Route: `/portfolio`
- Frame: `/api/ui-final-v031/paper-trading-room?rev=portfolio`
- Task: remove fake/default trading-room data when the paper/portfolio endpoints are not authorized or not loaded.

## Finding

Production QA with dummy session proved the page was wired to real endpoints, but when those endpoints returned 401 the UI still showed default-looking values:

- watchlist default 5 stocks
- simulated capital `10,000,000`
- paper inventory badge `1`
- KGI badge `2`
- execution events badge `12`
- search failures did not clearly say the endpoint was blocked

This violates Yang's P0 rule: missing data must be LIVE, formal degraded/empty/pending, or hidden. It cannot look like real paper data.

## Shipped Fix

- `apps/web/lib/final-v031-live.ts`
  - When paper portfolio fetch is blocked, `baseCapitalTWD` becomes a UI-level `null` state instead of falling back to `10,000,000`.
  - Watchlist no longer keeps static fallback rows when portfolio/ideas are unavailable.
  - Search errors now show `GET /api/v1/companies/lookup` + owner + no fake results.
  - Paper submit is disabled when capital/portfolio state is not authorized.
  - Ledger and watchlist badges are driven by live payload counts, defaulting to `0`.
  - Strategy/Paper candidate tabs no longer show static fallback rows when ideas are unavailable.
- `apps/web/public/ui-final-v031/paper_trading_room/index.html`
  - Static first-paint values no longer show fake capital or fake counts.
  - `updPreview()` no longer defaults available cash to `10,000,000`.

## Endpoints Connected / Truth-State

- `GET /api/v1/paper/portfolio`
- `GET /api/v1/paper/fills`
- `GET /api/v1/paper/orders`
- `GET /api/v1/portfolio/kgi/positions`
- `GET /api/v1/strategy/ideas?decisionMode=paper&includeBlocked=true&limit=8&sort=score`
- `GET /api/v1/companies/lookup?q=...`

When those endpoints fail in a non-owner/dummy session, the UI now reports blocked state instead of showing default data.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- `git diff --check`
- Local browser smoke at `http://localhost:3113/portfolio`
  - desktop `1366x900`
  - mobile `390x844`
  - search `1101`
  - strategy tab
  - paper tab

## Evidence Files

- `prod-portfolio-smoke.json`
- `prod-portfolio-frame-interactions.json`
- `local-portfolio-smoke-after.json`
- `local-portfolio-smoke-after-2.json`
- `local-portfolio-tabs-after.json`
- `screens/prod-portfolio-desktop.png`
- `screens/prod-portfolio-mobile.png`
- `screens/local-portfolio-desktop-after-2.png`
- `screens/local-portfolio-tabs-after.png`

## Remaining Owner-Session Requirement

Bruce/Elva still need to verify with a real owner session:

- real paper portfolio summary
- real orders/fills
- paper preview/submit success path
- KGI read-only positions

Codex did not test real owner credentials and did not touch KGI live order paths.
