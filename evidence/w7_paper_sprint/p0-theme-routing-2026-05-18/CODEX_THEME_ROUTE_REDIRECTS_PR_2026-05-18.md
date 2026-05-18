# CODEX Theme Route Redirects PR - 2026-05-18

## Scope

P0-7 company/theme route cleanup. This PR only updates `apps/web/next.config.ts` redirects and adds a redirect regression test. It does not change theme UI, company UI, backend APIs, broker paths, SIM/live wording, or homepage layout.

## Root Cause

Production smoke showed canonical `/themes` and `/themes/:slug` load, but legacy/mobile-style paths still returned 404:

- `/mobile/themes/ai-server`
- `/companies/themes/ai-server`
- `/company-themes/ai-server`

These are the exact paths that can make the company/theme flow feel like it jumped to an old/mobile route and got stuck.

## Shipped

- Redirect `/mobile/themes` and `/mobile/themes/:path*` to `/themes` and `/themes/:path*`.
- Redirect `/m/themes` and `/m/themes/:path*` to `/themes` and `/themes/:path*`.
- Redirect `/companies/themes` and `/companies/themes/:path*` to `/themes` and `/themes/:path*`.
- Redirect `/company-themes` and `/company-themes/:path*` to `/themes` and `/themes/:path*`.
- Added `apps/web/next-config-redirects.test.ts`.

## Verification

- `pnpm.cmd install --offline --frozen-lockfile`
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web test -- next-config-redirects.test.ts`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- `git diff --check`
- Local Playwright smoke on `http://localhost:3117`:
  - desktop and mobile
  - `/mobile/themes/ai-server` -> `/themes/ai-server`
  - `/m/themes/ai-server` -> `/themes/ai-server`
  - `/companies/themes/ai-server` -> `/themes/ai-server`
  - `/company-themes/ai-server` -> `/themes/ai-server`
  - `/mobile/themes` -> `/themes`
  - `/companies/themes` -> `/themes`
- Local header check:
  - `curl -I /mobile/themes/ai-server` returned `301` with `location: /themes/ai-server?...`
  - `curl -I /companies/themes/ai-server` returned `301` with `location: /themes/ai-server?...`

## Evidence

- Before production smoke: `prod-theme-routing-before-smoke.json`
- After local smoke: `local-theme-redirect-after-smoke.json`
- Screenshots: `screens/`

## Pending

Production after-merge smoke is required once the PR is merged and deployed. Owner-session theme data remains Bruce/Elva responsibility; this PR only fixes route dead-ends.
