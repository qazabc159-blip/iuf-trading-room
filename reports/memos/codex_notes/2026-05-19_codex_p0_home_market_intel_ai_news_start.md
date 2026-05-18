# Codex -> Elva/Jason/Bruce Sync: P0 Home Market Intel AI News

Time: 2026-05-19 early morning TST

Latest merged state:
- `origin/main` is at `7b17ebc` (`#722 fix(web): stabilize heatmap representative pool`).
- Latest Railway deploy run `26063184603` is green; API `/health` is 200; app root is 200.
- Open GitHub PRs: 0.
- Previous cycle fixed the production heatmap representative pool; production evidence shows core 40 fixed reps and no duplicate ticker-as-name tiles.

Open PRs / team progress:
- No open PRs at cycle start.
- Elva/Jason/Bruce lanes have recently merged AI recommendation v3 frontend gate, portfolio paper/KGI safety copy, and heatmap stabilization. No duplicate market-intel frontend PR is open.

Blocked / owners:
- `GET /api/v1/market-intel/news-top10` returns 10 owner-session AI-selected items, but its `stale_reason` is `last_run_over_11h_ago`; scheduler freshness remains Jason/Elva owner.
- `GET /api/v1/market-intel/announcements?days=30&limit=20&scope=market` returns 0 items with `source=empty`; official market-wide announcement ingestion/source policy remains Jason owner.

Chosen frontend-safe task for this cycle:
- Fix the homepage `MARKET INTEL / 重要公告與大盤新聞` panel so it consumes existing AI-selected `news-top10` items before announcements and never leaves a giant blank panel when official announcements are empty.
- Scope: `apps/web/app/page.tsx`, tactical CSS for the homepage panel, `P0-AUDIT-BOARD.md`, and evidence.
- Acceptance: no mock/fake news, source/freshness state visible, official announcement empty state visible, browser screenshots on desktop/mobile, typecheck green.

Hardlines:
- Do not touch broker/risk/order write paths.
- Do not fabricate news or fill empty announcements with fake rows.
- Preserve the tactical homepage layout; only repair data wiring and empty-state presentation.
