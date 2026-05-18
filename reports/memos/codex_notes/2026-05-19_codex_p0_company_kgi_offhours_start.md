# 2026-05-19 06:55 TST - Codex P0 Company KGI Off-hours Sync

## Latest merged state
- `origin/main` is at `196f4b5` after PR #723 (`fix(web): surface AI selected news on homepage`).
- Recent product rescue PRs #721-#723 are merged and deployed: AI rec v3 gate state, heatmap representative pool, and homepage AI selected news.
- Production deploy run `26064649146` is green, API `/health` returns 200, and GitHub open PR list is empty at cycle start.

## Cross-team progress
- Elva/Jason/another Codex already cleared the migration blocker; current production schema/deploy lane is healthy.
- Bruce-style route evidence still shows `/companies/2330` producing KGI quote `503` network errors while the UI renders BLOCKED states.
- This is frontend-visible product noise: no fake data is shown, but browser verification still sees failed KGI resources.

## Blocked items / owners
- KGI read-only quote gateway/session readiness remains Jason/Bruce owned.
- Frontend can safely prevent off-hours polling from hitting known unavailable KGI endpoints and keep the state honest.

## Chosen frontend-safe task
- Fix `/companies/[symbol]` KGI five-level quote and tick panels so they do not call KGI quote endpoints outside the documented weekday trading window.
- Scope: web frontend only (`BidAskPanel`, `LiveTickStreamPanel`, shared KGI time helper/tests), P0 board, and evidence.
- Acceptance:
  - `/companies/2330` still renders company data and KGI quote/tick panels.
  - Outside KGI trading hours, panels show `BLOCKED` with source, owner, and next open time.
  - Browser verify no longer sees 503 network failures from `/api/v1/kgi/quote/bidask` or `/api/v1/kgi/quote/ticks` on the company page.
  - No mock quote/tick data, no broker write paths, no tactical homepage changes.
