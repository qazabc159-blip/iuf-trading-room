# Codex P0 Audit + Route Redirect Evidence

Date: 2026-05-18
Branch: `p0/product-audit-board-20260518`
Base: `origin/main` @ `5fb641f`

## Shipped in this branch

- Created `P0-AUDIT-BOARD.md`.
- Added a Codex/Elva/Jason/Bruce sync note before product edits.
- Added a PR-A backend blocker note because production currently has 4 AI recommendations and v3 returns `no_v3_run_yet`.
- Fixed frontend-owned route aliases:
  - `/event-log` -> `/admin/events`
  - `/portfolio-snapshot` -> `/admin/portfolio/snapshots`
  - `/tool-center` -> `/admin/tools`
  - `/uta` -> `/admin/uta/accounts`

## Production audit inputs

- `prod-route-scan.json`: authenticated CDP scan against `https://app.eycvector.com`.
- `prod-api-scan-summary.json`: authenticated API count/status checks against `https://api.eycvector.com`.
- `screens/`: production screenshots for home, market intel, AI recommendations, portfolio, company detail, and lab strategy detail.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/contracts build` — PASS
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` — PASS
- Local Next redirect smoke on port 3107 — PASS:
  - `/event-log` returns 301 location `/admin/events`
  - `/portfolio-snapshot` returns 301 location `/admin/portfolio/snapshots`
  - `/tool-center` returns 301 location `/admin/tools`
  - `/uta` returns 301 location `/admin/uta/accounts`
  - Existing `/heatmap` and `/news` redirects still return 301 to `/market-intel`

## Still blocked / not fixed by this PR

- `/api/v1/recommendations/today` returns 4 cards, below Yang's minimum 5.
- `/api/v1/ai-recommendations/v3` returns `404 no_v3_run_yet`.
- `/api/v1/portfolio/snapshots?limit=20` returns 404; this route alias fix does not create the missing backend.
- All-market heatmap still includes English sector names in provider data.
