# CODEX V0.3.1 Client Session Hydration Fix — 2026-05-13

## Problem

The v0.3.1 vendor pages were visually loaded, but their live payload could still be empty when rendered through the Next route. The server-side HTML route can only forward cookies available on `app.eycvector.com`; if the authenticated API session is only available to browser calls against the API host, the server-injected payload falls back to empty data.

Observed unauthenticated smoke:

- `/api/ui-final-v031/market-intel` rendered vendor HTML and a valid hydration script.
- The injected payload had `items=0` and `sourceOk=0/4`, which explains the "pretty but wrong/static data" failure mode.

## Fix

`apps/web/lib/final-v031-live.ts`

- Keeps the existing server-injected payload as a first paint fallback.
- Adds browser-side API hydration using `NEXT_PUBLIC_API_BASE_URL` with `credentials: "include"`.
- Rehydrates the same vendor DOM after the browser session fetches real data.
- Applies this to:
  - Market Intel: news top 10, market announcements, FinMind source status.
  - Strategy Ideas: paper-mode strategy ideas.
  - Paper Trading Room: paper health, portfolio, orders, fills, KGI read-only positions, company quote, OHLCV, bid/ask, ticks.
- Paper order actions now prefer direct paper API preview/submit with browser credentials and retain the previous same-origin proxy as fallback.
- No KGI write-side or live order path was added. Paper submit remains `/api/v1/paper/submit`.

`apps/web/app/{market-intel,ideas,portfolio}/page.tsx`

- Replaces stale fixed `rev=1561feb` iframe query with a per-render cache buster so the embedded v0.3.1 route does not stick to old HTML after deploy.

## Safety Boundary

- Paper only.
- Real order disabled.
- KGI remains read-only.
- No `/order/create`.
- No token/env/secret changes.
- No backend schema or migration changes.

## Verification

- `pnpm.cmd --filter web typecheck` PASS
- `pnpm.cmd --filter web lint` PASS
- `pnpm.cmd --filter web build` PASS
  - Existing Sentry/OpenTelemetry dynamic dependency warning only.
- `pnpm.cmd test -- --runInBand` PASS
  - 252 tests passed.

