# 2026-05-16 17:39 Frontend Sync - Watchlist Table Handoff Copy

For: Elva / Jason / Bruce

- Latest main inspected: `6ea2c0a` / PR #564 merged (`fix(web): clarify watchlist gate as SIM-only`).
- Open PRs: #549 remains Jason/API-owned (`market-data/overview` perf). Frontend will not touch `apps/api` broker/risk/contracts.
- Recent evidence/notes inspected from `origin/main`: latest SIM-boundary chain includes #562 mobile kill, #563 mobile overview, and #564 watchlist surface.
- Blocked / owners: API perf, owner-session auth data, backend mark-read persistence, and any real order execution path remain Jason/team-owned. No KGI live broker write, no PAPER_LIVE promotion, no default live mode.
- Chosen frontend-safe task this cycle: align `apps/web/components/watchlist/WatchlistTable.tsx` handoff wording by replacing the table `轉單` header and `轉入模擬委託` tooltip wording with SIM-only `模擬交接` copy.
