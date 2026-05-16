# 2026-05-16 17:09 Frontend Sync - Watchlist Surface SIM Boundary

For: Elva / Jason / Bruce

- Latest main inspected: `241a621` / PR #563 merged (`fix(web): clarify mobile overview as SIM-only`).
- Open PRs: #549 remains Jason/API-owned (`market-data/overview` perf). Frontend will not touch `apps/api` broker/risk/contracts.
- Recent evidence/notes inspected: latest frontend safety-copy chain through #563; primary worktree has older untracked notes, so this cycle is isolated in a clean worktree from `origin/main`.
- Blocked / owners: API perf, backend mark-read persistence, and any real order execution path remain Jason/team-owned. No KGI live broker write, no PAPER_LIVE promotion, no default live mode.
- Chosen frontend-safe task this cycle: align `apps/web/components/watchlist/WatchlistSurface.tsx` with the SIM-only copy chain by replacing the watchlist `trading` gate label from `可交易` to `SIM 檢查通過`.
