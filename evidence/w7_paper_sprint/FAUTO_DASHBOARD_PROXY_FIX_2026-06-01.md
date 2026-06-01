# F-AUTO dashboard proxy fix - 2026-06-01

## Scope

- Fix `/ops/f-auto` data access so browser-side reads use the same-origin backend proxy.
- Add proxy allowlist entries for S1 SIM, KGI SIM, daily smoke, reconstructed SIM positions, and SIM funds.
- Add GET-only fallback from same-origin proxy 401/403 to direct `NEXT_PUBLIC_API_BASE_URL` reads. This keeps iframe dashboards readable when the browser only holds API-domain owner cookies.
- No KGI live broker write path touched.
- No real-order promotion.

## Root Cause

Production web-origin calls to `/api/v1/internal/s1-sim/*` returned Next 404 HTML. The F-AUTO dashboard needs to consume API-domain owner-only endpoints through the same-origin backend proxy, otherwise the dashboard can degrade into a client-side exception or blank product panel.

CI also exposed a related final-v031 issue: owner auth can exist on the API domain while the app-domain proxy lacks the cookie. For GET reads only, the frontend now retries against the real API base after proxy 401/403. POST order submit does not use this fallback.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS
- `pnpm.cmd --filter @iuf-trading-room/web test` PASS, 244/244
- After GET fallback addition: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS
- After GET fallback addition: `pnpm.cmd --filter @iuf-trading-room/web test` PASS, 245/245
- PR smoke harness fix: `pnpm.cmd --filter @iuf-trading-room/qa-playwright typecheck` PASS
- Local proxy smoke against `NEXT_PUBLIC_API_BASE_URL=https://api.eycvector.com`:
  - `/api/v1/internal/s1-sim/status` -> HTTP 401 owner gate, not 403/404
  - `/api/v1/internal/s1-sim/basket` -> HTTP 401 owner gate, not 403/404
  - `/api/v1/internal/s1-sim/eod-report` -> HTTP 401 owner gate, not 403/404
  - `/api/v1/kgi/sim/orders` -> HTTP 401 owner gate, not 403/404
  - `/api/v1/paper/positions?source=sim` -> HTTP 401 owner gate, not 403/404
  - `/api/v1/paper/funds?source=sim` -> HTTP 401 owner gate, not 403/404

## Production Safety

The production no-click smoke confirmed the trading room KGI SIM button is visible and enabled after entering a valid ticket price. I did not click the KGI SIM submit button because that would create a real broker SIM order and needs Yang's explicit test-order approval.

## CI Gate Fix

PR Playwright smoke was validating stale production instead of the checked-out PR branch. The workflow now starts a local PR web app on `127.0.0.1:3300` for pull requests. Main pushes and Daily Production Smoke still validate production.

The PR-local web app cannot fully reuse production owner cookies because browser SameSite scoping keeps the production API/app session tied to `eycvector.com`. The PR smoke therefore validates that the PR route renders without server errors and that the live API payload is healthy; the full owner-session render remains covered by production smoke.
