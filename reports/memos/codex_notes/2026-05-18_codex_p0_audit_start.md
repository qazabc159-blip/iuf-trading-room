# 2026-05-18 Codex P0 Audit Start

Owner: Codex frontend
Base: `origin/main` @ `5fb641f` (`fix(api): preserve company names in v3 fallback (#697)`)

## Latest merged state

- Open PR: 0.
- Latest main CI: green.
- Latest deploy: `Deploy to Railway` run `26031744549`, commit `5fb641f`, success.
- Production API health: `/health` returns 200.
- Railway API deployment observed healthy at latest main.

## Cross-team watch

- Elva/Jason have repaired the migration blocker and recommendation/news backend fallbacks through #692-#697.
- Bruce-style production verification is still required page by page; CI green is not accepted as product green.
- Mike/schema lane currently has no open PR, but any new table/migration must be audited before merge.

## Blocked / suspicious items found before editing

- `/api/v1/ai-recommendations/v3` returns `404 no_v3_run_yet`; `/api/v1/recommendations/today` returns 4 items, below Yang's minimum 5.
- `/api/v1/market-intel/news-top10` returns 10 items, but announcements are empty.
- `/api/v1/portfolio/snapshots?limit=20` returns 404.
- Direct public routes `/event-log`, `/portfolio-snapshot`, `/tool-center`, `/uta` return 404 while admin routes exist.
- All-market heatmap source still includes English sector names from provider data.

## Chosen safe task for this cycle

Produce `P0-AUDIT-BOARD.md` first, with production route/capability evidence and PR-A to PR-F repair mapping. No broad product code changes before this board is written.
